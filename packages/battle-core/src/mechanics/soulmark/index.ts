/**
 * mechanics/soulmark —— 魂印机制模块。
 *
 * 魂印 = 精灵固有被动（合成版，映射 4399 图鉴文本到 op 集合）。单位字段 soulMark 引用
 * pack.files.soulmarks 目录条目；initBattle 可经 mechanics.soulmark[side][slot] 覆盖装配。
 * 运行时状态 unit.soul = {id, endured?, endurePending?, shield?, shieldUsed?, prev}：
 * prev 为"上回合结束时"快照（hp/pp/stages），供 endure 回卷。
 * flag 集合已冻住，与 content/schemas/soulmarks.schema.json 的 soulOp 枚举一致，不再加成员。
 * revive / endure 的致命判定在 fatal.ts。那个文件不收回合末回血、回 PP、固伤。
 * 流水线只经 Mechanic 钩子触达；删除本目录 + 注册行即卸载。
 */
import Ajv from "ajv";
import soulmarksSchemaJson from "../../../../../content/schemas/soulmarks.schema.json" with { type: "json" };
import movesSchemaJson from "../../../../../content/schemas/moves.schema.json" with { type: "json" };
import { sha256hex } from "../../sha256.ts";
import { EngineFault, OTHER, type CoreEvent, type CoreState, type SideId } from "../../types.ts";
import type { CompiledEffect, CompiledMove, Condition, FrozenPack } from "../../loader.ts";
import { OPS } from "../../ops/index.ts";
import { magnitudeAcc, magnitudeTracks } from "../../ops/grow.ts";
import { priorityRange } from "../../ops/priority.ts";
import { damageKeyHits } from "../../ops/damage-keys.ts";
import { groupHitRiders } from "../../ops/hit-rider.ts";
import { validateEffects } from "../../ops/validate.ts";
import { condEval } from "../../ops/cond.ts";
import { fireTriggers, type TriggerResume } from "../../ops/trigger.ts";
import { accTransform, type MechChance, type MechEnv } from "../../ops/mechanism.ts";
import { readSoul, subjectOk, type SoulChance, type SoulGuard, type SoulScene } from "./read.ts";
import { hpCapOf } from "../../ops/effects.ts";
import type { KoCtx, Mechanic, MechanicCompileCtx, MechanicContribution, MechanicMove, MoveUsedCtx, OrderRollCtx, PackMechView, SwitchOutCtx, TurnEndCtx } from "../types.ts";
import { decideFatal, restoreSnapshot } from "./fatal.ts";

/** 魂印 flag op（与 content/schemas/soulmarks.schema.json soulOp 对齐）。枚举已冻住，不再加成员。 */
export interface SoulFlagOp {
  op:
    | "immune_control"
    | "immune_stage_down"
    | "priority_high_hp"
    | "endure"
    | "revive"
    | "turn_heal"
    | "turn_pp_restore"
    | "turn_flat"
    | "entry_dispel"
    | "hit_shield";
  boost?: number;
  numerator?: number;
  denominator?: number;
  count?: number;
  of?: "lost" | "max";
  /** 致命判定概率（"50%概率重生"——drawBelow(100) 未过则正常 KO） */
  chance?: number;
  /** true=对手携带 mode overlay（boss 战）时不触发（"boss免疫/无效"） */
  bossGate?: boolean;
}

/**
 * 魂印 hook op（与 schema soulHook 对齐）：hook × guard × chance × 原子 ops。
 * 主语和概率不在本接口的顶层字段上，只经 readSoul 读 guard / chance。
 * - guard：主语谓词，或原来的世界 Condition；两者都有时世界谓词在 guard.if。
 * - chance：概率闭类型（base/dyn/grow/resetOnFire/once）。once 仍是原来那一次判定里的每场一次。
 * - bossGate：true=对手携带 mode overlay（boss 战）时整条不触发（"boss无效"）。
 * - ops：原子 op 序列。幅度成长是开头的 grow，先制区间是 priority。都不在条目上留字段。
 */
export interface SoulHookOp {
  hook: "onTurnStart" | "onTurnEnd" | "onEntry" | "onDamaged" | "onKO" | "onSwitchOut" | "onMoveUsed" | "onBattleStart" | "beforeOrder" | "onDamageDealt" | "onMiss";
  guard?: SoulGuard | Condition;
  chance?: SoulChance;
  bossGate?: boolean;
  ops?: readonly CompiledEffect[];
  elseOps?: readonly CompiledEffect[];
}

export type SoulOp = SoulFlagOp | SoulHookOp;

export interface CompiledSoulMark {
  id: string;
  name: string;
  desc?: string;
  effects: readonly SoulOp[];
}

/** pack.mechanics.soulmark 的形状。 */
export interface SoulmarkPackData {
  soulmarks: ReadonlyMap<string, CompiledSoulMark>;
}

/** unit.soul 运行时状态形状（internal state schema 已声明）。 */
export interface SoulState {
  id: string;
  endured?: boolean;
  endurePending?: boolean;
  /** revive flag 已消耗（"重生一次"——每场战斗至多一次）。 */
  revived?: boolean;
  shield?: boolean;
  shieldUsed?: boolean;
  /** limitBattle 条目已触发的 effects 下标（内部状态，不经 projections 公开）。 */
  firedOnce?: Record<number, true>;
  /** chanceGrow 累积值（内部状态，不经 projections 公开）。 */
  chanceAcc?: Record<number, number>;
  /** growStep 幅度累积值（内部状态，不经 projections 公开）。 */
  magAcc?: Record<number, number>;
  /** 登场生命周期已初始化（内部状态）：首发/换入的 onEntry 只应结算一次。 */
  entryInit?: boolean;
  /** onBattleStart 已结算（内部状态）：每场战斗至多一次。 */
  battleStartDone?: boolean;
  /** hook/flag 条目内挂起的续跑游标（内部状态）：同回合同 hook 重派时从断点续跑；
   *  phase:"flags"=flag 段挂起（item=下一待结算 effects 下标）；缺省=hooks 段
   *  （item=挂起条目下标，opItem=条目内已结算 op 数，branch=已选定 else 分支）。 */
  teResume?: { hook: string; item: number; opItem: number; turn: number; phase?: "flags"; branch?: "else" };
  prev?: { hp: number; pp: Record<string, number>; stages: Record<string, number> };
}

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(movesSchemaJson); // soulHook.guard/ops 跨文件引用 moves.schema 的 condition/effect 定义
const vSoulmarks = ajv.compile(soulmarksSchemaJson);

export const soulmarkOf = (pack: PackMechView): SoulmarkPackData | undefined =>
  pack.mechanics?.["soulmark"] as SoulmarkPackData | undefined;

const soulOfUnit = (u: { soul?: unknown }): SoulState | undefined => u.soul as SoulState | undefined;
const hasOp = (soul: SoulState | undefined, pack: PackMechView, op: SoulFlagOp["op"]): SoulFlagOp | undefined =>
  soul === undefined
    ? undefined
    : soulmarkOf(pack)?.soulmarks
        .get(soul.id)
        ?.effects.find((e): e is SoulFlagOp => "op" in e && e.op === op);
const hookOps = (soul: SoulState | undefined, pack: PackMechView, hook: SoulHookOp["hook"]): readonly SoulHookOp[] =>
  soul === undefined
    ? []
    : (soulmarkOf(pack)?.soulmarks.get(soul.id)?.effects.filter((e): e is SoulHookOp => "hook" in e && e.hook === hook) ?? []);
const markName = (soul: SoulState, pack: PackMechView): string | undefined =>
  soulmarkOf(pack)?.soulmarks.get(soul.id)?.name;
const ev = (soul: SoulState, pack: PackMechView, effect: string): { type: string; detail: Record<string, unknown> } => ({
  type: "soulmark",
  detail: { mark: soul.id, ...(markName(soul, pack) !== undefined ? { name: markName(soul, pack) } : {}), effect },
});

/** hook op 派发时占位的最小招式信封（applyOp 读 move.id 供叠用计数/nextInFx 引用——魂印无招式上下文）。 */
const SOUL_STUB_MOVE = { id: "__soulmark__", name: "魂印", pp: 1, priority: 0, effects: [] } as unknown as CompiledMove;

/** 与 engine execMoveAction 的 catCode 同式：有 damage op 才是攻击（物理 2 / 特殊 3），否则属性 1。 */
const moveCatOf = (move: { effects?: readonly { op: string }[]; category?: string }): number =>
  (move.effects ?? []).some((f) => f.op === "damage") ? (move.category === "special" ? 3 : 2) : 1;

/** 出伤窗：必须在本击伤害公式之前挂上，并由 damage 的 count 消耗掉，不能留成永久加成。 */
const HIT_WINDOW_NAMES = new Set(["dmg_boost", "crit_always", "crit_up"]);
const isHitWindowOp = (fx: CompiledEffect): boolean =>
  fx.op === "apply_status" && HIT_WINDOW_NAMES.has(fx.name);
/** 幅度 op 在 ops 开头，不是出伤窗本体。 */
const isFrameOp = (fx: CompiledEffect): boolean => OPS[fx.op]?.frame === true;
const pureHitWindow = (e: SoulHookOp): boolean => {
  const ops = (e.ops ?? []).filter((fx) => !isFrameOp(fx));
  return ops.length > 0 && (e.elseOps ?? []).length === 0 && ops.every(isHitWindowOp);
};
const stampStreakHit = (e: SoulHookOp, fx: CompiledEffect): CompiledEffect => {
  const sub = readSoul(e).subject;
  if ((sub.streak === undefined && sub.sameMove !== true) || !isHitWindowOp(fx) || fx.op !== "apply_status") return fx;
  if (fx.params?.count !== undefined) return fx;
  return { ...fx, params: { ...(fx.params ?? {}), count: 1 } };
};

/** grow.on 为 always 时与缺省同义：每次判定都累积。MechChance 只把 fail 当成例外。 */
const mechGrow = (g: NonNullable<SoulChance["grow"]>): NonNullable<MechChance["grow"]> => {
  const cap = g.cap !== undefined ? { cap: g.cap } : {};
  return g.on === "fail" ? { add: g.add, ...cap, on: "fail" } : { add: g.add, ...cap };
};

/**
 * SoulHookOp → Mechanism 信封归一化。主语不进信封，由 subjectOk 在派发前滤掉。
 * 概率只从 readSoul 取，映到原来的 MechChance + once，仍是 fireTriggers 里的那一次判定。
 */
const soulMech = (e: SoulHookOp): MechEnv => {
  const view = readSoul(e);
  const mech: MechEnv = { ops: e.ops ?? [] };
  if (e.elseOps !== undefined) mech.elseOps = e.elseOps;
  if (e.bossGate === true) mech.gate = { boss: true };
  if (view.world !== undefined) mech.guard = view.world;
  const ch = view.chance;
  if (ch?.base !== undefined || ch?.dyn !== undefined) {
    mech.chance = {
      next: true,
      ...(ch.base !== undefined ? { base: ch.base } : {}),
      ...(ch.dyn !== undefined ? { dyn: ch.dyn } : {}),
      ...(ch.grow !== undefined ? { grow: mechGrow(ch.grow) } : {}),
      ...(ch.resetOnFire === true ? { resetOnFire: true } : {}),
    };
  }
  const acc = magnitudeAcc(e.ops);
  if (acc !== undefined) mech.acc = acc;
  if (ch?.once === true) mech.once = true;
  return mech;
};

/**
 * 通用 hook×ops 执行器：gate（bossGate/victim/actor/cat 由调用方谓词过滤 + guard/chance 在此判定）
 * → ops（applyOp 逐条派发，CpResult 写回 ctx.outcome）。
 * chance 未过 → elseOps（"未触发则"语义）。先推 soulmark 事件再跑 ops（可观测性）。
 */
function runSoulHook(
  ctx: TurnEndCtx,
  hook: SoulHookOp["hook"],
  filter?: (e: SoulHookOp) => boolean,
): void {
  const unit = ctx.next.sides[ctx.side].unit;
  const soul = soulOfUnit(unit);
  if (soul === undefined) return;
  const mark = soulmarkOf(ctx.pack)?.soulmarks.get(soul.id);
  if (mark === undefined) return;
  const foe = ctx.next.sides[OTHER[ctx.side]].unit;
  // 条目级续跑（teCursor W18 重入本机制）：同回合同 hook 的挂起断点 → {item,opItem,branch} 游标；
  // 异钩挂起不消费（留待其自身重派），跨回合残留判过期清除。
  let resume: TriggerResume | undefined;
  const tr = soul.teResume;
  // ctx.outcome 已置位 = 挂起传播中（如 flag 段刚写过 teResume）→ 不消费，留给下一次重派
  if (tr !== undefined && ctx.outcome === undefined && (tr.hook === hook || tr.turn !== ctx.next.turn)) {
    if (tr.hook === hook && tr.turn === ctx.next.turn && tr.phase === undefined) {
      resume = { item: tr.item, opItem: tr.opItem, ...(tr.branch !== undefined ? { branch: tr.branch } : {}) };
    }
    delete soul.teResume;
  }
  const cm = "move" in ctx ? (ctx.move as { id: string; category?: string; type?: string }) : undefined;
  // 完整 OpCtx（condEval 守卫与 applyOp 重解析所需）；派发负载用剥掉 foe/target/targetSide 的视图
  const octx0 = {
    // 运行时钩子拿到的 pack 实为 FrozenPack（PackMechView 是编译期子集视图）
    pack: ctx.pack as unknown as FrozenPack,
    next: ctx.next,
    events: ctx.events as CoreEvent[],
    side: ctx.side,
    unit,
    // 携带招式上下文的钩子（onMoveUsed/onDamageDealt/onMiss）透传 id+category+type——
    // 槽位印记"当前技能"语义与 cat/属性守卫可读；其余钩子用占位信封
    move: cm !== undefined ? ({ ...SOUL_STUB_MOVE, id: cm.id, ...(cm.category !== undefined ? { category: cm.category } : {}), ...(cm.type !== undefined ? { type: cm.type } : {}) } as CompiledMove) : SOUL_STUB_MOVE,
    foe,
    targetSide: ctx.side,
    target: unit,
    rng: ctx.rng,
    // MoveUsedCtx 携带行动方真实先后手；onTurnEnd 经 firstSide 推导观察者序位（"后出手时则回合末X"可用）；其余钩子退化为 "first"。
    order: ("order" in ctx ? ctx.order : ("firstSide" in ctx && ctx.firstSide !== undefined ? (ctx.side === ctx.firstSide ? "first" : "last") : "first")) as "first" | "last",
    // onDamageDealt/onDamaged 携带本击结果——守卫 {prevDamageAboveAbs/prevCrit} 读它
    ...(("amount" in ctx && typeof ctx.amount === "number") ? { lastDamage: ctx.amount as number } : {}),
    ...(("crit" in ctx && ctx.crit === true) ? { lastCrit: true } : {}),
  };
  const { foe: _f, target: _t, targetSide: _ts, ...octx } = octx0;
  const out = fireTriggers<SoulOp>(octx, {
    list: () => mark.effects,
    match: (e) => "hook" in e && e.hook === hook && (filter === undefined || filter(e)),
    stop: () => ctx.outcome !== undefined,
    mech: (e) => ("hook" in e ? soulMech(e) : { ops: [] }),
    store: (e, ei) => {
      if (!("hook" in e)) return {};
      const ch = readSoul(e).chance;
      return {
        ...(magnitudeTracks(e.ops) ? { magAcc: { get: () => soul.magAcc?.[ei] ?? 0, set: (v: number) => { (soul.magAcc ??= {})[ei] = v; } } } : {}),
        ...(ch?.grow !== undefined ? { chanceAcc: { get: () => soul.chanceAcc?.[ei] ?? 0, set: (v: number) => { (soul.chanceAcc ??= {})[ei] = v; } } } : {}),
        ...(ch?.once === true ? { once: { get: () => soul.firedOnce?.[ei] === true, set: () => { (soul.firedOnce ??= {})[ei] = true; } } } : {}),
      };
    },
    condCtx: () => octx0,
    chanceDraw: `soulmark:${hook}`,
    announce: (_c) => {
      const evt = ev(soul, ctx.pack, `hook:${hook}`);
      ctx.events.push({ type: evt.type, detail: { side: ctx.side, ...evt.detail } });
    },
    // stampStreakHit 在 acc 注入前（hits 字段是门控不是幅度）
    transform: (_c, e, _i, fx, mag, atCap) =>
      "hook" in e ? accTransform(stampStreakHit(e, fx), soulMech(e).acc, mag, atCap) : fx,
    trackPrevApplied: true,
  }, resume);
  if (out.kind === "terminal") { ctx.outcome = "terminal"; return; }
  if (out.kind === "suspend") {
    // 条目内挂起：记下断点（同回合同钩重派时从此续跑），再向上传播；
    // 达顶尾段挂起无游标（resume===undefined——旧语义：条目整体重派）。
    if (out.resume !== undefined) {
      soul.teResume = {
        hook, item: out.resume.item, opItem: out.resume.opItem, turn: ctx.next.turn,
        ...(out.resume.branch === "else" ? { branch: "else" as const } : {}),
      };
    }
    ctx.outcome = out.suspend;
    return;
  }
}

/**
 * 登场生命周期补齐：首发单位（engine 不为其派发换入结算）在首个在场时补登场结算。
 * 经 entrySettle 换入的单位 entryInit/battleStartDone 已置位，不会重复。
 * battleStartDone 按"单位首次在场"计——替补后入场的常驻被动（onBattleStart 条目）
 * 随其登场初始化（B4：bench 单位换入后必须持常驻被动）。
 * 调用点：preOrder（排序前——"登场速度/先制"须影响第一回合先后手）与
 * onTurnStart（兜底——任何绕过 preOrder 的到达路径仍完成补登）。
 */
function leadEntrySettle(ctx: TurnEndCtx): void {
  const soul = soulOfUnit(ctx.next.sides[ctx.side].unit);
  if (soul !== undefined && soul.entryInit !== true) {
    soul.entryInit = true;
    if (soul.battleStartDone !== true) {
      soul.battleStartDone = true;
      runSoulHook(ctx, "onBattleStart");
    }
    runSoulHook(ctx, "onEntry");
  }
}

export const soulmarkMechanic: Mechanic = {
  id: "soulmark",
  doc: { rawKey: "soulmarks", packFile: "soulmarks" },
  unitFieldClaims: ["soulMark"],

  compile(ctx: MechanicCompileCtx): MechanicContribution | undefined {
    const { raw, fail } = ctx;
    const declared = (raw["pack"] as { files?: Record<string, string> }).files?.["soulmarks"] !== undefined;
    if (!declared) {
      if (raw["soulmarks"] !== undefined) fail("soulmarks document provided but pack declares no files.soulmarks");
      return undefined;
    }
    if (raw["soulmarks"] === undefined) fail("pack declares files.soulmarks but no soulmarks document was provided");
    if (!vSoulmarks(raw["soulmarks"])) fail(`soulmarks schema: ${ajv.errorsText(vSoulmarks.errors)}`);
    const entries = Object.entries((raw["soulmarks"] as { soulmarks: Record<string, CompiledSoulMark> }).soulmarks);
    const soulmarks = new Map<string, CompiledSoulMark>(entries);
    for (const [id, s] of soulmarks) {
      if (s.id !== id) fail(`soulmark key ${id} != soulmark.id ${s.id}`);
      // hook 条目的 ops 必须是已注册原子 op（schema 校验形状，注册表校验语义存在性）
      for (const e of s.effects) {
        if (!("hook" in e)) continue;
        for (const [name, list] of [["ops", e.ops], ["elseOps", e.elseOps]] as const) {
          for (const hit of damageKeyHits(list, name)) {
            fail(`soulmark ${id} hook ${e.hook} ${hit.path} damage key "${hit.key}" is outside the damage key list`);
          }
        }
        for (const list of [e.ops, e.elseOps]) {
          validateEffects(list, ctx.ruleset, (message) => fail(`soulmark ${id} hook ${e.hook}: ${message}`));
          const riderErr = groupHitRiders(list);
          if (riderErr !== undefined) fail(`soulmark ${id} hook ${e.hook}: ${riderErr}`);
        }
      }
    }
    return {
      data: { soulmarks } satisfies SoulmarkPackData,
      hashExtra: { soulmarksSha256: sha256hex(JSON.stringify(raw["soulmarks"])) },
    };
  },

  checkUnit(u, pack): string | null {
    if (u.soulMark === undefined) return null;
    const d = soulmarkOf(pack);
    if (d === undefined) return `unit ${u.id} sets soulMark but pack declares no files.soulmarks`;
    if (!d.soulmarks.has(u.soulMark)) return `unit ${u.id} soulMark "${u.soulMark}" not in soulmarks catalog`;
    return null;
  },

  unitFields(u) {
    return u.soulMark !== undefined ? { soulMark: u.soulMark } : undefined;
  },

  checkInitSlots(arr, side: SideId, unitCount): void {
    if (arr.length > unitCount) {
      throw new EngineFault("SOULMARK_RULE", `soulmark loadout ${arr.length} slots > unit count ${unitCount} on ${side}`);
    }
    for (const slot of arr) {
      if (slot !== undefined && (typeof slot !== "string" || !/^sm-[a-z0-9-]+$/.test(slot))) {
        throw new EngineFault("SOULMARK_RULE", `soulmark loadout slot must be a sm-* id on ${side}`);
      }
    }
  },

  applyUnit(pack, unit, slotInit, base): Record<string, unknown> | undefined {
    const id = (slotInit as string | undefined) ?? unit.soulMark;
    if (id === undefined) return undefined;
    const d = soulmarkOf(pack);
    if (d === undefined) throw new EngineFault("SOULMARK_UNSUPPORTED", `pack ${pack.rules.rulesetId} has no soulmark catalog (unit ${unit.id})`);
    if (!d.soulmarks.has(id)) throw new EngineFault("SOULMARK_RULE", `unit ${unit.id} soulMark "${id}" not in catalog`);
    // prev 快照：对 endure 而言"上回合结束时"= 初始态。pp 从全部招式槽（含第五技能槽）推导。
    const fifth = (pack.mechanics?.["fifth"] as { enabled?: boolean } | undefined)?.enabled === true;
    const slotIds = [...unit.moveIds, ...(fifth && unit.fifthMoveId !== undefined ? [unit.fifthMoveId] : [])];
    const pp: Record<string, number> = {};
    for (const mid of slotIds) {
      const mv = pack.movesById?.get(mid);
      if (mv !== undefined) pp[mid] = mv.pp;
    }
    const stages: Record<string, number> = {};
    const soul: SoulState = { id, prev: { hp: base.hp, pp, stages } };
    return { soul };
  },

  /* ---------- 运行时钩子 ---------- */

  priorityBoost({ pack, unit, foe }) {
    const op = hasOp(soulOfUnit(unit), pack, "priority_high_hp");
    if (op === undefined) return 0;
    // "血量高于对手必先手"：满血/更高当前 HP 时优先级提升。
    return unit.currentHp > foe.currentHp ? (op.boost ?? 1) : 0;
  },

  controlImmune({ pack, unit }) {
    const soul = soulOfUnit(unit);
    if (hasOp(soul, pack, "immune_control") === undefined) return undefined;
    return { type: "soulmark", mark: soul!.id, name: markName(soul!, pack) ?? soul!.id };
  },

  stageDropImmune({ pack, unit }) {
    const soul = soulOfUnit(unit);
    if (hasOp(soul, pack, "immune_stage_down") === undefined) return undefined;
    return { type: "soulmark", mark: soul!.id, name: markName(soul!, pack) ?? soul!.id };
  },

  onTurnStart(ctx: TurnEndCtx): void {
    leadEntrySettle(ctx);
    runSoulHook(ctx, "onTurnStart");
  },

  preOrder(ctx: TurnEndCtx): void {
    // 登场补偿前置到速度排序之前——"登场速度+1级"/"登场先制"类效果要赶上第一回合排序
    leadEntrySettle(ctx);
  },

  onKO(ctx: KoCtx): void {
    // 观察侧=倒下侧 → 自身倒下；观察侧=对手 → 击败对手。
    const victim = ctx.side === ctx.deadSide ? "self" : "foe";
    runSoulHook(ctx, "onKO", (e) => subjectOk(readSoul(e), { victim }));
  },

  onSwitchOut(ctx: SwitchOutCtx): void {
    const switcher = ctx.side === ctx.switchSide ? "self" : "foe";
    runSoulHook(ctx, "onSwitchOut", (e) => subjectOk(readSoul(e), { switcher }));
  },

  onMoveUsed(ctx: MoveUsedCtx): void {
    // 连用读行动方，不读观察者。攻击连用的纯出伤窗已在 beforeHit 挂上并被本击消耗，这里不再补一次。
    const actorUnit = ctx.next.sides[ctx.actorSide].unit;
    const scene: SoulScene = {
      actor: ctx.actorSide === ctx.side ? "self" : "foe",
      checkCat: true,
      checkStreak: true,
      checkAlways: true,
      cat: ctx.cat,
      moveId: ctx.move.id,
      moveAlways: ctx.move.accuracy === "always",
      // 缺省的上一动不写入：exactOptional 不允许把 undefined 赋给可选字段。
      ...(actorUnit.prevMoveCat !== undefined ? { prevCat: actorUnit.prevMoveCat } : {}),
      ...(actorUnit.catStreak !== undefined ? { catStreak: actorUnit.catStreak } : {}),
      ...(actorUnit.prevMoveId !== undefined ? { prevMoveId: actorUnit.prevMoveId } : {}),
    };
    const primed = ctx.cat === 2 || ctx.cat === 3;
    runSoulHook(ctx, "onMoveUsed", (e) => {
      const view = readSoul(e);
      const sub = view.subject;
      const hitWindowAlready = primed && pureHitWindow(e) && (sub.streak !== undefined || sub.sameMove === true);
      return subjectOk(view, scene) && !hitWindowAlready;
    });
  },

  beforeHit(ctx: MoveUsedCtx): void {
    if (ctx.actorSide !== ctx.side) return;
    if (ctx.cat !== 2 && ctx.cat !== 3) return;
    const unit = ctx.next.sides[ctx.side].unit;
    const scene: SoulScene = {
      actor: "self",
      checkCat: true,
      checkStreak: true,
      checkAlways: true,
      cat: ctx.cat,
      moveId: ctx.move.id,
      moveAlways: ctx.move.accuracy === "always",
      ...(unit.prevMoveCat !== undefined ? { prevCat: unit.prevMoveCat } : {}),
      ...(unit.catStreak !== undefined ? { catStreak: unit.catStreak } : {}),
      ...(unit.prevMoveId !== undefined ? { prevMoveId: unit.prevMoveId } : {}),
    };
    runSoulHook(ctx, "onMoveUsed", (e) => {
      const view = readSoul(e);
      const sub = view.subject;
      return subjectOk(view, scene) && pureHitWindow(e) && (sub.streak !== undefined || sub.sameMove === true);
    });
  },

  orderRoll(ctx: OrderRollCtx): number {
    const soul = soulOfUnit(ctx.unit);
    let add = 0;
    const cat = moveCatOf(ctx.move);
    for (const e of hookOps(soul, ctx.pack, "beforeOrder")) {
      const range = priorityRange(e.ops);
      if (range === undefined) continue;
      if (e.bossGate === true && ctx.foe.mode !== undefined) continue;
      // 连用先制看的是持有者自己的上一动（本钩子只在持有者排序时调用）
      const view = readSoul(e);
      if (!subjectOk(view, {
        checkCat: true,
        checkStreak: true,
        cat,
        moveId: ctx.move.id,
        ...(ctx.unit.prevMoveCat !== undefined ? { prevCat: ctx.unit.prevMoveCat } : {}),
        ...(ctx.unit.catStreak !== undefined ? { catStreak: ctx.unit.catStreak } : {}),
        ...(ctx.unit.prevMoveId !== undefined ? { prevMoveId: ctx.unit.prevMoveId } : {}),
      })) continue;
      if (view.world !== undefined) {
        const mv = ctx.move;
        const octx = {
          pack: ctx.pack as unknown as FrozenPack,
          next: ctx.next,
          events: ctx.events as CoreEvent[],
          side: ctx.side,
          unit: ctx.unit,
          move: { ...SOUL_STUB_MOVE, id: mv.id, effects: mv.effects, ...(mv.category !== undefined ? { category: mv.category } : {}), ...(mv.type !== undefined ? { type: mv.type } : {}) } as CompiledMove,
          foe: ctx.foe,
          targetSide: ctx.side,
          target: ctx.unit,
          rng: ctx.rng,
          order: "first" as const,
        };
        if (!condEval(octx, view.world)) continue;
      }
      const span = range.max - range.min + 1;
      const roll = span > 1 ? ctx.rng.drawBelow(span, "soulmark:beforeOrder") : 0;
      const boost = range.min + roll;
      add += boost;
      const evt = ev(soul!, ctx.pack, "hook:beforeOrder");
      ctx.events.push({ type: evt.type, detail: { side: ctx.side, ...evt.detail, boost } });
    }
    return add;
  },

  onEntry(ctx: TurnEndCtx): void {
    const { pack, next, events, side } = ctx;
    const soul = soulOfUnit(next.sides[side].unit);
    // 换入结算路径（entrySettle→onEntry）至此置位——onTurnStart 不再补登场。
    // 常驻被动按"单位首次在场"初始化：替补后入场单位的 onBattleStart 条目随登场结算（B4）。
    if (soul !== undefined) {
      soul.entryInit = true;
      if (soul.battleStartDone !== true) {
        soul.battleStartDone = true;
        runSoulHook(ctx, "onBattleStart");
      }
    }
    if (hasOp(soul, pack, "entry_dispel") !== undefined) {
      const foeSide = side === "p1" ? "p2" : "p1";
      const foe = next.sides[foeSide].unit;
      const remaining = foe.effects.filter((e) => e.remainingTurns === undefined);
      if (remaining.length !== foe.effects.length) {
        foe.effects = remaining;
        events.push({ ...ev(soul!, pack, "entry_dispel"), detail: { ...ev(soul!, pack, "entry_dispel").detail, side } });
      }
    }
    runSoulHook(ctx, "onEntry");
  },

  onFatalDamage({ pack, unit, rng, foe }) {
    const soul = soulOfUnit(unit);
    if (soul === undefined) return undefined;
    const decision = decideFatal({
      endured: soul.endured === true,
      revived: soul.revived === true,
      endure: hasOp(soul, pack, "endure"),
      revive: hasOp(soul, pack, "revive"),
      foeIsBoss: foe?.mode !== undefined,
      rng,
      maxHp: unit.base.hp,
      hpCap: hpCapOf(unit),
    });
    if (decision === undefined) return undefined;
    if (decision.kind === "endure") {
      soul.endured = true;
      soul.endurePending = true;
      return { hp: decision.hp, event: ev(soul, pack, "endure") };
    }
    soul.revived = true;
    return { hp: decision.hp, event: ev(soul, pack, "revive") };
  },

  absorbDamage({ pack, unit }) {
    const soul = soulOfUnit(unit);
    if (soul === undefined || soul.shield !== true) return undefined;
    soul.shield = false;
    return ev(soul, pack, "shield_absorb");
  },

  onDamaged(ctx: TurnEndCtx & { amount: number }): void {
    const { pack, next, events, side, amount } = ctx;
    const soul = soulOfUnit(next.sides[side].unit);
    if (soul === undefined || amount <= 0) return;
    // hit_shield：受击获得一次伤害护盾（全局一次，护盾被消耗/覆盖后不再获得）。
    if (hasOp(soul, pack, "hit_shield") !== undefined && soul.shield !== true && soul.shieldUsed !== true) {
      soul.shield = true;
      soul.shieldUsed = true;
      events.push({ ...ev(soul, pack, "hit_shield"), detail: { ...ev(soul, pack, "hit_shield").detail, side } });
    }
    runSoulHook(ctx, "onDamaged");
  },

  onDamageDealt(ctx: TurnEndCtx & { amount: number; crit?: boolean; cat?: number; move?: MechanicMove }): void {
    // 攻击方视角结算：仅真实命中伤害（amount>0）；cat 门控未声明=不限类别。
    if (ctx.amount <= 0) return;
    runSoulHook(ctx, "onDamageDealt", (e) => subjectOk(readSoul(e), { checkCat: true, ...(ctx.cat !== undefined ? { cat: ctx.cat } : {}) }));
  },

  onMiss(ctx: TurnEndCtx & { missSide: SideId; move?: MechanicMove }): void {
    const who = ctx.missSide === ctx.side ? "self" : "foe";
    runSoulHook(ctx, "onMiss", (e) => subjectOk(readSoul(e), { who }));
  },

  onTurnEnd(ctx: TurnEndCtx): void {
    // 板凳单位 prev 同步到本回合末——板凳态不变，prev 即换入基准；
    // 否则久置板凳的单位换入当回合被 KO，endure 会回卷到过期的初始快照。
    for (const b of ctx.next.sides[ctx.side].bench ?? []) {
      const bs = soulOfUnit(b);
      if (bs === undefined) continue;
      const bpp: Record<string, number> = {};
      for (const mv of b.moves) bpp[mv.moveId] = mv.pp;
      bs.prev = { hp: b.currentHp, pp: bpp, stages: { ...(b.stages as Record<string, number>) } };
    }
    const u = ctx.next.sides[ctx.side].unit;
    const soul = soulOfUnit(u);
    if (soul === undefined) return;
    const d = soulmarkOf(ctx.pack);
    const mark = d?.soulmarks.get(soul.id);
    if (mark === undefined) return;
    const foe = ctx.side === "p1" ? "p2" : "p1";
    const foeU = ctx.next.sides[foe].unit;
    const sidePush = (effect: string): void => {
      const e = ev(soul, ctx.pack, effect);
      ctx.events.push({ type: e.type, detail: { side: ctx.side, ...e.detail } });
    };

    // flag 段续跑游标（teResume.phase:"flags"）：turn_flat 等 hurt 通道可挂起——
    // 挂起时已结算 flag 不重复（item=下一待结算 effects 下标），hooks 段整体未跑（fromEi=0）。
    // phase 缺省=hooks 段挂起 → flags 已完结整段跳过。陈旧/异钩游标由 runSoulHook 统一清理。
    const tres = soul.teResume?.hook === "onTurnEnd" && soul.teResume.turn === ctx.next.turn ? soul.teResume : undefined;
    const flagFrom = tres?.phase === "flags" ? tres.item : 0;
    if (tres === undefined || tres.phase === "flags") {
      for (const [fi, op] of mark.effects.entries()) {
        if ("hook" in op) continue; // hook 条目由 runSoulHook 结算
        if (fi < flagFrom) continue;
        if (op.op === "turn_heal" && u.currentHp > 0 && u.currentHp < hpCapOf(u)) {
          const amount = Math.min(hpCapOf(u) - u.currentHp, Math.max(1, Math.floor((u.base.hp * op.numerator!) / op.denominator!)));
          u.currentHp += amount;
          ctx.events.push({ type: "heal", detail: { side: ctx.side, amount, hpAfter: { current: u.currentHp, max: u.base.hp }, source: soul.id } });
          sidePush("turn_heal");
        } else if (op.op === "turn_pp_restore") {
          let restored = false;
          for (const mv of u.moves) {
            const max = ctx.pack.movesById?.get(mv.moveId)?.pp ?? mv.ppMax;
            if (mv.pp < max) { mv.pp = Math.min(max, mv.pp + op.count!); restored = true; }
          }
          if (restored) sidePush("turn_pp_restore");
        } else if (op.op === "turn_flat" && u.currentHp > 0 && foeU.currentHp > 0 && ctx.outcome === undefined) {
          const baseN = op.of === "lost" ? foeU.base.hp - foeU.currentHp : foeU.base.hp;
          const amount = Math.max(1, Math.floor((baseN * op.numerator!) / op.denominator!));
          sidePush("turn_flat");
          ctx.hurt(foe, amount, soul.id);
        }
        // flag 条目内挂起：记游标（已结算 flag 与全量 hooks 段在续跑中恢复），剩余 flag 转替补后结算
        if (ctx.outcome !== undefined && ctx.outcome !== "terminal") {
          soul.teResume = { hook: "onTurnEnd", phase: "flags", item: fi + 1, opItem: 0, turn: ctx.next.turn };
        }
        if (ctx.outcome !== undefined) break;
      }
    }

    // 通用 hook 条目（"回合结束时X"——在 flag 结算后按声明序跑原子 ops）。
    runSoulHook(ctx, "onTurnEnd");

    // endure 回卷：致命保留 1 血后，回合结束恢复至上回合结束快照。全印只此一次写入。
    if (soul.endurePending === true && soul.prev !== undefined && u.currentHp > 0) {
      restoreSnapshot(u, soul.prev);
      soul.endurePending = false;
      sidePush("endure_rewind");
    }

    // 快照更新为"本回合结束时"（供下一回合回卷基准）。
    const pp: Record<string, number> = {};
    for (const mv of u.moves) pp[mv.moveId] = mv.pp;
    soul.prev = { hp: u.currentHp, pp, stages: { ...(u.stages as Record<string, number>) } };
  },

  // soulmark 事件类型归本模块（MarkRef.type / ev() 同款）；删除本模块即离线。
  eventFields: { soulmark: ["side", "mark", "name", "effect"] },

  projections: [
    // 魂印公开（图鉴知识）：id + 消耗标记双方可见。
    {
      key: "soul",
      into: "both",
      get: (u) => {
        const s = soulOfUnit(u);
        if (s === undefined) return undefined;
        return {
          id: s.id,
          ...(s.endured === true ? { endured: true } : {}),
          ...(s.revived === true ? { revived: true } : {}),
          ...(s.shield === true ? { shield: true } : {}),
        };
      },
    },
  ],

  meta(pack) {
    const d = soulmarkOf(pack);
    if (d === undefined) return undefined;
    return {
      soulmarks: Object.fromEntries(
        [...d.soulmarks.values()].map((s) => [s.id, { name: s.name, ...(s.desc !== undefined ? { desc: s.desc } : {}), effects: s.effects }]),
      ),
    };
  },
};
