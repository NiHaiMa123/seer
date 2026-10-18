/**
 * battle-core 引擎：synthetic-v1 的纯确定性 transition。
 * `applyTurn(state, actions, rng)` 覆盖 ORDER→…→NEXT；Host 负责 COLLECT/decision。
 * 纪律：不写 state/input（先 clone 后改副本）、fault 时整体不落盘、
 * 无 wall-clock/环境读取、全部整数运算、draw 只发生在 §6 平速组。
 */
import { DeterministicRng } from "./rng.ts";
import { type CompiledEffect, type CompiledMove, type CompiledUnit, type FrozenPack, type StatSpread, type StageStatKey } from "./loader.ts";
import { MECHANICS, deriveBaseFor, moveSlotsFor, stageKeysFor } from "./mechanics/index.ts";
import { EngineFault, OTHER, type CoreAction, type CoreEvent, type CoreResult, type CoreState, type SideId } from "./types.ts";
import { applyOp, fireReactive, periodicEntryFire, runPeriodicWin, withOpBudget } from "./ops/index.ts";
import { groupHitRiders, hitFieldsOf } from "./ops/hit-rider.ts";
import { condEval } from "./ops/cond.ts";
import { checkpoint, clamp, effStat, entrySettle, mkHookCtx, resolveHit, targetSideOf } from "./ops/shared.ts";
import { effectBlock, tickAmountOfEntry, prioAddOf, prioNegateOn, ppCostMulOf, noSwitchOn, blockedCategories, nullifyEntryFor, effectDefOf, hpCapOf, hitFxNullOn, drainOnUseFlatOf, isMod } from "./ops/effects.ts";
export { effectivenessOf } from "./ops/shared.ts";

type SideUnit = CoreState["sides"]["p1"]["unit"];
type MoveAction =
  | { kind: "move"; moveId: string }
  | { kind: "struggle" }
  | { kind: "concede" }
  | { kind: "switch"; benchIndex: number }
  | { kind: "mech"; actionId: string };

function fault(reason: string, msg: string): CoreResult {
  return { ok: false, fault: new EngineFault(reason, msg) };
}

/** eff = floor(base × num / den)，§4 stage 系数表 */
/**
 * 属性克制查找：chart[招式属性][守方属性键] → 倍率 ×16 定点（1.0 → 16）。
 * 守方双属性按声明序 join("") 为键（"机械地面"），查不到再试逆序（"地面机械"）；
 * 单属性/未命中 → 8（即 1.0）。双属性倍率是表中手工标定的条目，不是单属性乘积
 * （验证过：如 (0.5,1.0) 组合在不同双属性上给出 0.75/0.875/1.5 不同结果）。
 */
// effectivenessOf / effStat / clamp / overlayOf / checkpoint / targetSideOf → ops/shared.ts

/**
 * §9：合法 actionId 集 = pp>0 动作 ∪ {bench 存活者 switch} ∪ {concede} ∪ 机制额外动作；全 0 → {struggle, concede}。
 * pack 省略时不展开机制动作（旧调用保持原集）。阵亡替补期间不给道具。
 */
export function legalActions(state: CoreState, side: SideId, pack?: FrozenPack): string[] {
  const s = state.sides[side];
  // v2 suspension：仅阵亡方可动，且只能选存活替补或认输
  if (state.suspension !== undefined && state.suspension !== null) {
    if (state.suspension.koSide !== side) return [];
    const repl = (s.bench ?? []).map((b, i) => (b.currentHp > 0 && b.banished !== true ? `act_switch-${i}` : null)).filter((x): x is string => x !== null);
    repl.push("act_concede");
    return repl;
  }
  const unit = s.unit;
  const acts = unit.moves.filter((m) => m.pp > 0).map((m) => `act_${m.moveId}`);
  const switches = (s.bench ?? []).map((b, i) => (b.currentHp > 0 && b.banished !== true ? `act_switch-${i}` : null)).filter((x): x is string => x !== null);
  acts.push(...switches);
  if (!unit.moves.some((m) => m.pp > 0)) acts.push("act_struggle");
  acts.push("act_concede");
  if (pack !== undefined) {
    for (const m of MECHANICS) {
      const extra = m.extraLegal?.(pack, state, side);
      if (extra !== undefined) acts.push(...extra);
    }
  }
  return acts;
}

/**
 * §9：缺省/超时的确定默认 = 字典序最小的可行动作。
 * 注意：concede 不参与默认选择（超时认输不是默认策略的本意；
 * 规范括注明确 "v1 即还剩 PP 的第一个动作，否则 struggle"）。
 */
export function defaultAction(state: CoreState, side: SideId): string {
  const unit = state.sides[side].unit;
  const moves = unit.moves.filter((m) => m.pp > 0).map((m) => `act_${m.moveId}`).sort();
  return moves[0] ?? "act_struggle";
}

/** replacement 决策的默认：bench 下标最小的存活者。 */
export function defaultReplacement(state: CoreState, side: SideId): string {
  const bench = state.sides[side].bench ?? [];
  const i = bench.findIndex((b) => b.currentHp > 0 && b.banished !== true);
  return i >= 0 ? `act_switch-${i}` : "act_concede";
}

/** resolved/null → 内部动作项；非法 actionId 返回 invalid 标记。 */
function resolveAction(state: CoreState, side: SideId, action: CoreAction): MoveAction | { kind: "invalid"; actionId: string } {
  const actionId = action?.actionId ?? defaultAction(state, side);
  if (actionId === "act_struggle") return { kind: "struggle" };
  if (actionId === "act_concede") return { kind: "concede" };
  const sw = /^act_switch-(\d+)$/.exec(actionId);
  if (sw) return { kind: "switch", benchIndex: parseInt(sw[1]!, 10) };
  for (const m of MECHANICS) {
    const parsed = m.parseAction?.(actionId);
    if (parsed !== undefined) return parsed;
  }
  if (actionId.startsWith("act_")) return { kind: "move", moveId: actionId.slice(4) };
  return { kind: "invalid", actionId };
}

/** 机制声明了携带技能时，普通槽换成那份列表；否则原单位（引用不变，无装配时字节级同前）。 */
function carriedUnit(pack: FrozenPack, unit: CompiledUnit, mechInit?: Record<string, unknown>): CompiledUnit {
  if (mechInit === undefined) return unit;
  for (const m of MECHANICS) {
    const next = m.carriedMoveIds?.(pack, unit, mechInit[m.id]);
    if (next !== undefined) return { ...unit, moveIds: [...next] };
  }
  return unit;
}

const mkUnit = (pack: FrozenPack, u: CompiledUnit, unitId: string, mechInit?: Record<string, unknown>): CoreState["sides"]["p1"]["unit"] => {
  const slotUnit = carriedUnit(pack, u, mechInit);
  // 面板推导：机制钩子接管（six-stat：种族/等级/个体/努力/性格 → 六维）；
  // 无接管 → base 即面板值（legacy v1 行为字节级不变）。
  const base = deriveBaseFor(pack, slotUnit) ?? ({ ...slotUnit.base } as StatSpread);
  // 机制加工链：各注册模块对推导面板做修饰并贡献附加状态字段（如 seals → 平面叠加+字段）。
  const mechState: Record<string, unknown> = {};
  for (const m of MECHANICS) {
    const extra = m.applyUnit?.(pack, slotUnit, mechInit?.[m.id], base);
    if (extra !== undefined) Object.assign(mechState, extra);
  }
  return {
    unitId,
    speciesId: u.id,
    base,
    currentHp: base.hp,
    stages: { atk: 0, def: 0, spd: 0, ...Object.fromEntries(stageKeysFor(pack).slice(3).map((k) => [k, 0])) },
    moves: moveSlotsFor(pack, slotUnit).map((moveId) => {
      const m = pack.movesById.get(moveId)!;
      return { moveId, pp: m.pp, ppMax: m.pp };
    }),
    revealedMoveIds: [],
    effects: [],
    // v2 additive 字段：仅当 pack 声明时才写入（v1 hash 不变靠"不写"）
    ...(u.mode !== undefined ? { mode: u.mode } : {}),
    ...(u.revives !== undefined ? { revives: u.revives } : {}),
    ...mechState,
  };
};

export function initBattle(
  pack: FrozenPack,
  opts: {
    battleId: string;
    seedHex: string;
    p1: string;
    p2: string;
    bench?: { p1?: string[]; p2?: string[] };
    /** 机制初始化袋：mechanics.<id>.<side> = 每槽位数组（[0]=首发，[1+i]=bench[i]；
     *  元素 undefined=该槽回落 species 预设）。各 Mechanic 自校验语义。 */
    mechanics?: Record<string, { p1?: unknown[]; p2?: unknown[] }>;
  },
): CoreState {
  const side = (s: SideId, speciesId: string, benchIds: string[] | undefined): CoreState["sides"]["p1"] => {
    const requestedBench = benchIds ?? [];
    if (requestedBench.length > 0 && !pack.features.has("bench")) {
      throw new EngineFault("FEATURE_DISABLED", `bench is not enabled for ${pack.rules.rulesetId}`);
    }
    if (requestedBench.length > (pack.limits.maxBenchSize ?? 0)) {
      throw new EngineFault("BENCH_LIMIT", `bench size ${requestedBench.length} exceeds ${pack.limits.maxBenchSize ?? 0}`);
    }
    const unitCount = 1 + requestedBench.length;
    // 机制 init 切片校验：mechanics.<id>.<side> = 每槽位数组；未注册机制键直接拒载
    for (const id of Object.keys(opts.mechanics ?? {})) {
      if (!MECHANICS.some((m) => m.id === id)) {
        throw new EngineFault("MECH_INIT", `mechanics.${id} has no registered mechanic`);
      }
    }
    for (const m of MECHANICS) {
      const arr = opts.mechanics?.[m.id]?.[s];
      if (arr !== undefined) {
        if (!Array.isArray(arr)) throw new EngineFault("MECH_INIT", `mechanics.${m.id}.${s} must be a per-slot array`);
        m.checkInitSlots?.(arr, s, unitCount);
      }
    }
    /** 该方第 idx 槽位的机制初始化数据袋（mechanics.<id>[idx]；整体 undefined=全回落预设）。 */
    const slotInit = (idx: number): Record<string, unknown> | undefined => {
      const bag = opts.mechanics;
      if (bag === undefined) return undefined;
      let any = false;
      const out: Record<string, unknown> = {};
      for (const m of MECHANICS) {
        const arr = bag[m.id]?.[s];
        if (arr !== undefined) { out[m.id] = arr[idx]; any = true; }
      }
      return any ? out : undefined;
    };
    const u = pack.unitsById.get(speciesId);
    if (!u) throw new EngineFault("UNKNOWN_SPECIES", `species ${speciesId} not in pack`);
    const benchUnits = requestedBench.map((bid, i) => {
      const bu = pack.unitsById.get(bid);
      if (!bu) throw new EngineFault("UNKNOWN_SPECIES", `bench species ${bid} not in pack`);
      return mkUnit(pack, bu, `unit_${s}-b${i}`, slotInit(i + 1));
    });
    return {
      unit: mkUnit(pack, u, `unit_${s}`, slotInit(0)),
      ...(benchUnits.length > 0 ? { bench: benchUnits } : {}),
    };
  };
  const state: CoreState = {
    schemaVersion: 1,
    battleId: opts.battleId,
    rules: pack.rules,
    revision: 0,
    turn: 1,
    phase: "collect",
    rng: { algorithmId: "xoshiro128**", seedHex: opts.seedHex, drawCounter: 0 },
    sides: { p1: side("p1", opts.p1, opts.bench?.p1), p2: side("p2", opts.p2, opts.bench?.p2) },
    speedTiebreak: null,
    terminal: null,
  };
  for (const m of MECHANICS) m.onBattleStart?.(pack, state);
  return state;
}

/**
 * 单回合 transition：inputs 为双方已 resolved 的 actionId（null→§9 默认）。
 * rng 实例以 state.rng(seedHex,drawCounter) 重建推进，写回 drawCounter。
 */
export function applyTurn(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction; p2: CoreAction },
): CoreResult {
  if (state.terminal !== null) return fault("TERMINAL_STATE", "transition on terminal battle");
  if (state.phase !== "collect") return fault("BAD_PHASE", `applyTurn requires collect, got ${state.phase}`);

  const rng = new DeterministicRng(state.rng.seedHex);
  for (let i = 0; i < state.rng.drawCounter; i++) rng.next("replay");
  try {
    // transition 预算：本 transition 全部 op 派发（含嵌套钩子/reactive）共用一份上限
    return withOpBudget(() => applyTurnInner(pack, state, actions, rng));
  } catch (e) {
    // EngineFault → Result；非 EngineFault 是引擎 bug，继续抛
    if (e instanceof EngineFault) return { ok: false, fault: e };
    throw e;
  }
}

/**
 * struggle 共享段：PP 全 0 才可挣扎；伤害 + 目标存活时的反噬。
 * applyTurn / applyReplacement 续跑共用。返回 CpResult 由调用方映射挂起/终局。
 */
function execStruggle(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
  unit: SideUnit,
  actionId: string,
): CpResult {
  if (unit.moves.some((m) => m.pp > 0)) {
    events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId } });
    return "continue";
  }
  events.push({ type: "struggle-used", detail: { side } });
  const cp1 = applyDamage(pack, next, events, rng, side, Math.floor(unit.base.hp / 4), "struggle");
  if (cp1 !== "continue") return cp1;
  const foe = next.sides[OTHER[side]].unit;
  if (foe.currentHp > 0) {
    // recoil 独立 HP 变更：目标存活才结算
    const recoil = Math.floor(unit.base.hp / 8);
    unit.currentHp = Math.max(0, unit.currentHp - recoil);
    events.push({ type: "damage", detail: { side, amount: recoil, hpAfter: { current: unit.currentHp, max: unit.base.hp }, recoil: true } });
    return checkpoint(pack, next, events, rng);
  }
  return "continue";
}

/** 机制动作（道具等）的空招式壳：效果不读招式本体，只借 applyEffect 的形参。 */
const MECH_MOVE: CompiledMove = { id: "item", pp: 1, priority: 0, effects: [], accuracy: "always" };

/**
 * 机制动作共享段（applyTurn / applyReplacement 续跑共用）。
 * 不走招式的控制/害怕门。认领失败记 action-failed 并继续；效果中断交给调用方。
 */
function execMechAction(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
  unit: SideUnit,
  actionId: string,
  firstSide: SideId,
): CpResult {
  let planned: readonly Record<string, unknown>[] | undefined;
  for (const m of MECHANICS) {
    const got = m.planAction?.({ pack, state: next, side, actionId });
    if (got !== undefined) { planned = got; break; }
  }
  if (planned === undefined) {
    events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId } });
    return "continue";
  }
  events.push({ type: "action-declared", detail: { side, actionId } });
  const myOrder: "first" | "last" = side === firstSide ? "first" : "last";
  for (const fx of planned) {
    const cp = applyEffect(pack, next, events, side, unit, MECH_MOVE, fx as unknown as CompiledEffect, rng, myOrder);
    if (cp !== "continue") return cp;
  }
  return "continue";
}

/**
 * 招式动作执行共享段（applyTurn / applyReplacement 续跑共用，B5：杜绝双份逻辑漂移）：
 * action-declared → 伤害记账/连用栈/次数制先制窗口消耗 → PP → 状态/控制/封印阻断 →
 * 招式失效 → 声明反应 → hitIf → RESOLVE_HIT → 效果循环（截断语义）→ onMoveUsed 钩子。
 * 返回 "continue" 表示本动作已结算完毕（含失败/未命中——继续下一侧）；
 * "terminal"/{suspend} 由调用方按各自挂起/终局协议处理。
 */
function execMoveAction(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
  unit: SideUnit,
  move: CompiledMove,
  slot: SideUnit["moves"][number],
  actionId: string,
  firstSide: SideId,
): CpResult {
  const myOrder: "first" | "last" = side === firstSide ? "first" : "last";
  events.push({ type: "action-declared", detail: { side, actionId, moveId: move.id } });
  unit.lastDealt = 0; // 伤害记账清零（"n=本回合自身造成的伤害"——行动内累计）
  unit.prevTaken = unit.lastTaken ?? 0; // 上回合受击快照（"若上回合自身未受到攻击伤害则X"）
  unit.lastTaken = 0; // 受击记账清零（"所受技能伤害N%附加"——跨回合本回合受击量）
  delete unit.lastTakenKind; // 受击类型记账清零（"受到真实伤害后X"谓词仅当回合有效）
  delete unit.lastHeal; // 回复记账清零（"恢复的体力值低于N则X"谓词仅当回合有效）
  // 叠用计数（"连续使用每次威力增加N"/"每次使用几率+N%"）：同一招式连用 +1，换招清零（moveStacks 仅叠用招式出现时写入，零漂移）
  // 装载时 rider 已收进片段，换招前还在列表上。叠用计数两边都要看得见。
  const perUseHit = (e: CompiledEffect): boolean => {
    if (e.op === "damage") {
      const f = hitFieldsOf(e);
      const hits = f.hits;
      const hitsPerUse = hits !== null && typeof hits === "object" && "perUse" in hits ? hits.perUse : undefined;
      return f.powerPerUse !== undefined || f.powerMulPerUse !== undefined || f.flatPerUse !== undefined || f.dmgPerUsePct !== undefined || f.critPerUsePct !== undefined || hitsPerUse !== undefined;
    }
    if (e.op === "strike" && e.of === "hits") {
      const v = e.value;
      return v !== null && typeof v === "object" && "perUse" in v && v.perUse !== undefined;
    }
    return (e.op === "power" && (e.of === "powerPerUse" || e.of === "powerMulPerUse"))
      || (e.op === "flat" && e.of === "flatPerUse")
      || (e.op === "scale" && e.of === "dmgPerUsePct")
      || (e.op === "crit" && e.of === "critPerUsePct");
  };
  const stacksMove = move.prioPerUse !== undefined || (move.effects ?? []).some((e) => e.chancePerUse !== undefined || perUseHit(e));
  if (stacksMove || unit.moveStacks !== undefined) {
    const cur = unit.lastMoveId === move.id ? (unit.moveStacks?.[move.id] ?? 0) : 0;
    unit.moveStacks = { [move.id]: cur + 1 };
    unit.lastMoveId = move.id;
  } else unit.lastMoveId = move.id;
  // 类别连用记账：与 lastMoveId 同点（失败声明也记）。本回合判定用的是回合初 prevMoveCat，这里只给下回合。
  const catCode = move.effects.some((f) => f.op === "damage") ? (move.category === "special" ? 3 : 2) : 1;
  // catStreak：同类招式连续声明计数（"连续N次使用攻击技能时X"读这个——声明点即时含本动）
  unit.catStreak = unit.lastMoveCat === catCode ? (unit.catStreak ?? 1) + 1 : 1;
  unit.lastMoveCat = catCode;
  // orderStreak：连续先/后出手计数（"连续N回合后出手则X"——同序累计、换序重置）
  unit.orderStreak = unit.orderStreak?.order === myOrder ? { order: myOrder, n: unit.orderStreak.n + 1 } : { order: myOrder, n: 1 };
  // 次数制先制窗口消耗（prio_count flag：本回合已计入加成，声明后递减直至耗尽）
  for (const e of [...unit.effects]) {
    if (!isMod(e, "prioAdd") || e.params?.prioCount !== 1 || e.params?.count === undefined) continue;
    e.params.count -= 1;
    if (e.params.count <= 0) {
      unit.effects = unit.effects.filter((x) => x !== e);
      events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
    }
  }
  // 次数制穿透窗口消耗（"下N次攻击技能无视对手攻击免疫/强化/限伤"——攻击招声明即消耗一次）
  if (catCode !== 1) {
    for (const e of [...unit.effects]) {
      if (!isMod(e, "pierce") || e.params?.count === undefined) continue;
      e.params.count -= 1;
      if (e.params.count <= 0) {
        unit.effects = unit.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
      }
    }
  }
  // 公开揭示：该 moveId 对对手可见（revealedMoveIds 是 transition 的确定性产物）
  if (!unit.revealedMoveIds.includes(move.id)) unit.revealedMoveIds.push(move.id);
  // BEFORE_ACTION: 合法动作扣 PP，失败不退还（ppCostMul 窗口可加倍消耗；ppFreeIf 条件满足时零耗——"若自身体力小于1/2每次攻击不消耗PP"）
  const foe0 = next.sides[OTHER[side]].unit;
  const ppFree = move.ppFreeIf !== undefined && condEval({ pack, next, events, side, unit, move, foe: foe0, targetSide: OTHER[side], target: foe0, rng, order: myOrder }, move.ppFreeIf);
  slot.pp = Math.max(0, slot.pp - (ppFree ? 0 : ppCostMulOf(unit)));
  events.push({ type: "pp-spent", detail: { side, moveId: move.id, ppAfter: slot.pp } });

  // 异常状态行动阻断（麻痹25%/害怕/睡眠100% 等，statuses flag 表驱动）
  const blockedBy = effectBlock(unit, (n, p) => rng.drawBelow(n, p));
  if (blockedBy !== undefined) {
    events.push({ type: "action-failed", detail: { side, reason: `status:${blockedBy}` } });
    return "continue";
  }

  // v2 §4.4：受控方 BEFORE_ACTION 判定失败；控制按"阻断次数"消耗（turns=n 阻断 n 次行动）
  // 例外：含 cleanse 的动作穿透控制——净化是被控方的反制手段
  const ctl = unit.effects.find((e) => e.kind.startsWith("control:"));
  const bypasses = ctl !== undefined && move.effects.some((f) => f.op === "cleanse");
  if (ctl && !bypasses) {
    events.push({ type: "action-failed", detail: { side, reason: "controlled" } });
    if (ctl.remainingTurns !== undefined) {
      ctl.remainingTurns -= 1;
      if (ctl.remainingTurns <= 0) {
        unit.effects = unit.effects.filter((e) => e !== ctl);
        events.push({ type: "effect-faded", detail: { side, name: ctl.label ?? ctl.kind } });
      }
    }
    return "continue";
  }

  // 封印窗口（blockCategory flag）：cat 编码 1=属性招(无 damage op)/2=物理/3=特殊（catCode 已在声明点算好）
  if (blockedCategories(unit).includes(catCode)) {
    events.push({ type: "action-failed", detail: { side, reason: "status-locked" } });
    unit.nullifiedMask = (unit.nullifiedMask ?? 0) | (1 << (catCode - 1)); // "若自身的属性技能失效则"谓词读位
    // 技能无效时补偿效果（"技能无效时X"——封印路径同样算"无效"）
    for (const fx of move.effects.filter((f) => f.nullifyOnly === true)) {
      const cpN = applyEffect(pack, next, events, side, unit, move, fx, rng, myOrder);
      if (cpN !== "continue") return cpN; // 补偿效果可致死——KO/挂起不得丢（尸体留场）
    }
    return "continue";
  }
  // 招式失效（nullifies flag，次数制）：命中 cat 的条目消耗1次并使本招失败（"下N次属性技能失效"；params.chance=每回合概率判定）
  const nullified = nullifyEntryFor(unit, catCode, move.priority, move.effects.find((f) => f.op === "damage")?.power);
  if (nullified !== undefined && (nullified.params?.chance === undefined || rng.drawBelow(100, "move_null") < nullified.params.chance)) {
    if (nullified.params?.count !== undefined) {
      nullified.params.count -= 1;
      if (nullified.params.count <= 0) {
        unit.effects = unit.effects.filter((e) => e !== nullified);
        events.push({ type: "effect-faded", detail: { side, name: nullified.label ?? nullified.kind } });
      }
    }
    events.push({ type: "action-failed", detail: { side, reason: "move-nullified" } });
    unit.nullifiedMask = (unit.nullifiedMask ?? 0) | (1 << (catCode - 1));
    for (const fx of move.effects.filter((f) => f.nullifyOnly === true)) {
      const cpN = applyEffect(pack, next, events, side, unit, move, fx, rng, myOrder);
      if (cpN !== "continue") return cpN;
    }
    // 反应式触发 15：持有者的招式被失效（"下N次技能无效时令对手X"）。
    // 派发点是失效成立之后——payload 里可以引用 foeMove（"若为攻击技能则…"由 cat 守卫过滤）。
    const cpN15 = fireReactive({ pack, next, events, side, unit, move, rng, order: myOrder }, unit, 19, { cat: catCode, power: move.effects.find((f) => f.op === "damage")?.power ?? 0 });
    if (cpN15 !== "continue") return cpN15;
    return "continue";
  }

  // 反应式触发：对手声明行动（"若对手使用属性技能则X"/"若对手使用先手技能则X"——守卫按 catCode/prio 过滤；order 取持有者序位）。
  // CpResult 传播：声明反应 KO 了行动方/留守方 → 动作不得继续（B3）
  const cpD = fireReactive({ pack, next, events, side: OTHER[side], unit: next.sides[OTHER[side]].unit, move, rng, order: OTHER[side] === firstSide ? "first" : "last" }, next.sides[OTHER[side]].unit, 3, { cat: catCode, prio: move.priority, power: move.effects.find((f) => f.op === "damage")?.power ?? 0 });
  if (cpD !== "continue") return cpD;
  // 反应式触发：持有者声明行动（"每回合使用技能时有N%的几率令对手害怕"——每招一次判定）
  const cpS = fireReactive({ pack, next, events, side, unit, move, rng, order: myOrder }, unit, 11, { cat: catCode });
  if (cpS !== "continue") return cpS;

  // MISS 处置共享块：持有者"自身MISS"(6) / 对手侧"对手MISS"(2) 触发。
  // missed 事件：accuracy 路径由 resolveHit 内部发出；hitIf 路径此处补发。
  const missSettle = (fromHitIf: boolean): CpResult => {
    if (fromHitIf) events.push({ type: "missed", detail: { side, moveId: move.id, reason: "hitIf" } });
    // missStreak：防守方连续闪避计数（"对手攻击均未命中"窗）——仅攻击招式计
    {
      const def = next.sides[OTHER[side]].unit;
      if (move.effects.some((f) => f.op === "damage")) { def.missStreak = (def.missStreak ?? 0) + 1; unit.hitStreak = 0; }
    }
    const cp6 = fireReactive({ pack, next, events, side, unit, move, rng, order: myOrder }, unit, 6, { cat: catCode });
    if (cp6 !== "continue") return cp6;
    const cp2 = fireReactive({ pack, next, events, side: OTHER[side], unit: next.sides[OTHER[side]].unit, move, rng, order: OTHER[side] === firstSide ? "first" : "last" }, next.sides[OTHER[side]].unit, 2, { cat: catCode });
    if (cp2 !== "continue") return cp2;
    // onMiss 机制钩子（魂印"对手攻击MISS时X"/"自身攻击落空时X"族——双侧派发，who 守卫定向）
    for (const obs of ["p1", "p2"] as const) {
      const msCtx = { ...mkHookCtx(pack, next, events, rng, obs), missSide: side, move };
      for (const m of MECHANICS) m.onMiss?.(msCtx);
      if (msCtx.outcome === "terminal") return "terminal";
      if (msCtx.outcome !== undefined) return { suspend: msCtx.outcome };
    }
    return "continue";
  };

  // hitIf：条件命中门控（"对方体力高于自己时才能命中"——不满足按 MISS 处理）
  if (move.hitIf !== undefined) {
    const foe0 = next.sides[OTHER[side]].unit;
    if (foe0 !== undefined && !condEval({ pack, next, events, side, unit, move, foe: foe0, targetSide: OTHER[side], target: foe0, rng, order: myOrder }, move.hitIf.when)) {
      return missSettle(true);
    }
  }
  // RESOLVE_HIT：move.accuracy 存在 → 命中判定（必中/未声明不判定）；miss → 全 op 跳过
  if (!resolveHit(events, rng, side, unit, next.sides[OTHER[side]].unit, move)) {
    return missSettle(false);
  }
  // 攻击命中 → 防守方 missStreak 清零、攻击方 hitStreak 连胜累计（"对手连续命中"谓词读 foe.hitStreak）
  if (move.effects.some((f) => f.op === "damage")) { next.sides[OTHER[side]].unit.missStreak = 0; unit.hitStreak = (unit.hitStreak ?? 0) + 1; }

  // 连用出伤窗（伤害提升/必暴）要赶上本击；onMoveUsed 在招式之后，来不及。
  {
    const bhCtx = { ...mkHookCtx(pack, next, events, rng, side), actorSide: side, move, cat: catCode, order: myOrder };
    for (const m of MECHANICS) m.beforeHit?.(bhCtx);
    if (bhCtx.outcome === "terminal") return "terminal";
    if (bhCtx.outcome !== undefined) return { suspend: bhCtx.outcome };
  }

  // hit_fx_null 次数窗消耗（"对手下1次使用的攻击技能命中效果失效"——匹配类别的招式结算前递减）
  for (const e of unit.effects) {
    if (!isMod(e, "hitFxNull") || e.params?.count === undefined) continue;
    const cat = e.params.cat;
    if (cat === undefined || (cat === 4 ? catCode !== 1 : cat === catCode)) {
      e.params.count -= 1;
      if (e.params.count <= 0) unit.effects = unit.effects.filter((x) => x !== e);
    }
  }
  let prev: PrevFx = {};
  let anyApplied = false; // "均未触发则X"谓词：本招此前所有 op 均未生效
  // 续跑时 rider 已经摘掉，再分组是空操作，游标仍指向摘过的数组。
  const riderErr = groupHitRiders(move.effects);
  if (riderErr !== undefined) throw new EngineFault("RIDER_UNGROUPED", riderErr);
  for (let fxi = 0; fxi < move.effects.length; fxi++) {
    const fx = move.effects[fxi]!;
    if (fx.nullifyOnly === true) continue; // "技能无效时X"——主路径不结算
    // hit_fx_null：持有者技能的非伤害效果被压制（"对手属性技能命中效果失效"——cat 门控）
    if (fx.op !== "damage" && hitFxNullOn(unit, catCode)) { events.push({ type: "protected", detail: { side } }); continue; }
    const evFrom = events.length;
    const cp = applyEffect(pack, next, events, side, unit, move, fx, rng, myOrder, { ...prev, noneApplied: !anyApplied });
    prev = summarizeSince(events, evFrom);
    anyApplied = anyApplied || prev.applied === true;
    if (cp === "continue") continue;
    // KO/终局截断：后续 op 若仍指向存活目标照常结算（"伤害+自愈"招击杀后回血仍生效）；
    // 指向刚倒下单位的 op 无意义跳过。截断只可能来自 damage（对手倒下），故自愈类必跑到。
    for (const fx2 of move.effects.slice(fxi + 1)) {
      if (fx2.nullifyOnly === true) continue;
      if (next.sides[targetSideOf(side, fx2)].unit.currentHp <= 0) continue;
      const evFrom2 = events.length;
      const cp2 = applyEffect(pack, next, events, side, unit, move, fx2, rng, myOrder, prev);
      prev = summarizeSince(events, evFrom2);
      // 尾效果的终局判定不得丢（自残/反噬 KO 自身）：terminal 优先于首个中断；
      // 新增的 suspend 侧由 applyReplacement 接续判定拾起——本调用方仍认第一次中断。
      if (cp2 === "terminal") return "terminal";
    }
    return cp;
  }

  // 招式完整结算后的机制钩子（魂印"使用技能时/对手使用技能时"——中断路径已 return 不触达）。
  // 钩子可产伤（如"使用攻击技能时附加固伤"）→ outcome 按 op 截断同款语义处理。
  // drain_on_use：持有者用招后吸取对手 flat 体力（"每回合使用技能则吸取对手N点体力"——本方行动结算后结算）
  if (!next.terminal) {
    const duFlat = drainOnUseFlatOf(unit);
    const duFoe = next.sides[OTHER[side]].unit;
    if (duFlat > 0 && duFoe.currentHp > 0) {
      const amt = Math.min(duFoe.currentHp, duFlat);
      duFoe.currentHp -= amt;
      unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + amt);
      events.push({ type: "damage", detail: { side: OTHER[side], amount: amt, hpAfter: { current: duFoe.currentHp, max: duFoe.base.hp }, damageKind: "fixed", cause: "drain" } });
      events.push({ type: "heal", detail: { side, amount: amt, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "drain_on_use" } });
    }
  }
  if (!next.terminal) {
    for (const obs of ["p1", "p2"] as const) {
      const muCtx = { ...mkHookCtx(pack, next, events, rng, obs), actorSide: side, move, cat: catCode, order: myOrder };
      for (const m of MECHANICS) m.onMoveUsed?.(muCtx);
      if (muCtx.outcome === "terminal") return "terminal";
      if (muCtx.outcome !== undefined) return { suspend: muCtx.outcome };
    }
  }
  return "continue";
}

function applyTurnInner(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction; p2: CoreAction },
  rng: DeterministicRng,
): CoreResult {
  const events: CoreEvent[] = [];
  const next = structuredClone(state) as CoreState;
  next.revision += 1;
  // 连用快照：排序和双方出招都读 prev。声明点才写 last，回合中不刷新（对方行动不能改你的连用）。
  for (const s of ["p1", "p2"] as const) {
    const u = next.sides[s].unit;
    if (u.lastMoveCat !== undefined) u.prevMoveCat = u.lastMoveCat;
    else delete u.prevMoveCat;
    if (u.lastMoveId !== undefined) u.prevMoveId = u.lastMoveId;
    else delete u.prevMoveId;
    // 回合开始快照（"体力等于回合开始时"/"回退至回合开始强化"谓词）+ 上回合提升日志结转
    u.turnStartHp = u.currentHp;
    u.turnStartStages = { ...u.stages };
    u.prevStageUpLog = u.stageUpLog ?? [];
    u.stageUpLog = [];
    u.immuneThisTurn = 0; // "成功触发免疫"谓词按回合清零
    u.immunedMask = 0; // 免疫种类位掩码同步清零（immunedKind 谓词）
    u.nullifiedMask = 0; // 招式失效类别掩码按回合清零（nullifiedCatMask 谓词）
    u.shieldAbsorbed = 0; // 护盾吸收量按回合清零（shieldAbsorbPct"护盾所吸收的伤害值N%反弹"读取窗）
    delete u.effFloor; // eff_max（克制倍数取两侧较大值）是单次命中的克制读法，没被伤害读走就按回合清零
  }

  const resolved: Record<SideId, MoveAction | { kind: "invalid"; actionId: string }> = {
    p1: resolveAction(next, "p1", actions.p1),
    p2: resolveAction(next, "p2", actions.p2),
  };

  // concede 立即判负：在排序前处理，不消耗回合动作
  const conceders = (["p1", "p2"] as const).filter((s) => resolved[s].kind === "concede");
  if (conceders.length > 0) {
    const result = conceders.length === 2 ? "draw" : OTHER[conceders[0]!];
    events.push({ type: "battle-end", detail: { result, reason: "concede" } });
    next.terminal = { result, reason: "concede" };
    next.phase = "end";
    return { ok: true, state: finish(next, rng), events };
  }

  // PRE-ORDER 登场补偿：首发单位的登场效果（"登场速度+1级"/"登场先制"）必须在
  // 速度排序之前结算——经 entrySettle 换入的单位机制内部幂等，重复调用是 no-op。
  // 可产伤 → 挂起时照常用 writeSuspension（order 尚未定型，先落结算再排序）。
  let preOrderOutcome: "terminal" | SideId | undefined;
  for (const s of ["p1", "p2"] as const) {
    if (next.sides[s].unit.currentHp <= 0) continue;
    const eCtx = mkHookCtx(pack, next, events, rng, s);
    for (const m of MECHANICS) m.preOrder?.(eCtx);
    if (eCtx.outcome === "terminal") { preOrderOutcome = "terminal"; break; }
    if (eCtx.outcome !== undefined) { preOrderOutcome = eCtx.outcome; break; }
  }
  if (preOrderOutcome === "terminal") {
    return { ok: true, state: finish(next, rng), events };
  }

  // ORDER：switch 组先于一切 move；组内 priority desc → effSpd desc → §6 平速 draw
  const isSwitch = (s: SideId) => resolved[s].kind === "switch";
  const prio = (s: SideId): number => {
    const act = resolved[s];
    if (act.kind === "mech") {
      let found: number | undefined;
      for (const m of MECHANICS) {
        const v = m.actionPriority?.(act.actionId);
        if (v !== undefined) found = v;
      }
      return found ?? -Infinity;
    }
    if (act.kind !== "move") return -Infinity;
    const mv = pack.movesById.get((resolved[s] as { moveId: string }).moveId);
    let p = mv?.priority ?? -Infinity;
    // prio_negate："先制效果失效"——所有先制加成（timed/条件/机制/叠用）不生效，仅保留招式基础 priority
    const negated = prioNegateOn(next.sides[s].unit);
    // timed 先制窗口（prio_up 效果；params.cat 招式类别门控）
    if (!negated) p += prioAddOf(next.sides[s].unit, mv?.category === "physical" ? 2 : mv?.category === "special" ? 3 : mv !== undefined ? 1 : undefined);
    // 条件先制（"遇到天敌时先制+N"）——排序时求值；order/prevApplied 类谓词在此无意义按 false 处理
    if (!negated && mv?.priorityIf !== undefined) {
      const unit = next.sides[s].unit;
      const foe = next.sides[OTHER[s]].unit;
      const foeAct = resolved[OTHER[s]];
      const foeMove = foeAct?.kind === "move" ? pack.movesById.get((foeAct as { moveId: string }).moveId) : undefined;
      if (condEval({ pack, next, events, side: s, unit, move: mv, foe, ...(foeMove !== undefined ? { foeMove } : {}), targetSide: OTHER[s], target: foe, rng, order: "first" }, mv.priorityIf.when)) {
        p += mv.priorityIf.add ?? 0;
        // priorityIf.min：条件先制下限（"先制等级大于0时提升为+2"——抬升下限非加算）
        if (mv.priorityIf.min !== undefined) p = Math.max(p, mv.priorityIf.min);
      }
    }
    // priorityMin：无条件先制下限（"先制等级提升为+2"）
    if (!negated && mv?.priorityMin !== undefined) p = Math.max(p, mv.priorityMin);
    if (!negated) for (const m of MECHANICS) {
      p += m.priorityBoost?.({ pack, unit: next.sides[s].unit, foe: next.sides[OTHER[s]].unit }) ?? 0;
    }
    // 随机先制钩子（魂印"选择技能的回合先制+N~M"）：消耗 rng，与 priorityBoost 加算
    if (!negated && mv !== undefined) {
      for (const m of MECHANICS) {
        p += m.orderRoll?.({ pack, next, events, side: s, unit: next.sides[s].unit, move: mv, foe: next.sides[OTHER[s]].unit, rng }) ?? 0;
      }
    }
    // 叠用先制（"连续使用时先制+1"）：按本回合前已累计的连用次数加成
    if (!negated && mv?.prioPerUse !== undefined) p += mv.prioPerUse * (next.sides[s].unit.moveStacks?.[mv.id] ?? 0);
    // prioPerFoeLowPp：对手低PP招式计数先制（"对手每有1个技能PP值小于3先制+1"——招式 flag，非效果窗故不受 prio_negate 影响）
    if (mv?.prioPerFoeLowPp !== undefined) {
      const foeMv = next.sides[OTHER[s]].unit.moves;
      const lowCnt = foeMv.filter((m2) => m2.pp < mv.prioPerFoeLowPp!.below).length;
      p += Math.floor(lowCnt / Math.max(1, mv.prioPerFoeLowPp.per)) * mv.prioPerFoeLowPp.add;
    }
    // ignoreFoePrioPos（"无视对手正先制等级"）：对手招式带此旗标→本侧正先制加成压掉（负加成保留；招式 flag 不受 prio_negate 影响）
    if (resolved[OTHER[s]]?.kind === "move") {
      const foeMove = pack.movesById.get((resolved[OTHER[s]] as { moveId: string }).moveId);
      if (foeMove?.ignoreFoePrioPos === true && mv !== undefined) p = mv.priority + Math.min(0, p - mv.priority);
    }
    return p;
  };
  const spdOf = (s: SideId): number => effStat(next.sides[s].unit.base.spd, next.sides[s].unit.stages.spd);
  // 无视对手速度：先制打平后不比速度。仅一方带旗标则该方先手；双方都带则落入平速。
  const ignoresFoeSpeed = (s: SideId): boolean => {
    if (resolved[s].kind !== "move") return false;
    const mv = pack.movesById.get((resolved[s] as { moveId: string }).moveId);
    return mv?.ignoreFoeSpeed === true;
  };
  // prio 结果 memoize：orderRoll 钩子消耗 rng（"随机先制+0~2"），同一侧同一回合只许求值一次
  const prioMemo: Partial<Record<SideId, number>> = {};
  const prio1 = (s: SideId): number => {
    const v = (prioMemo[s] ??= prio(s));
    // 实际先制写回 unit：cond 谓词 prioZero 要读"本回合实际先制"而不是面板 priority。
    // prio() 已经把 prio_up 窗/条件先制/机制钩子/连用加成全部算进去，这里落盘即可。
    next.sides[s].unit.turnPrio = v;
    return v;
  };
  let order: [SideId, SideId];
  if (isSwitch("p1") !== isSwitch("p2")) order = isSwitch("p1") ? ["p1", "p2"] : ["p2", "p1"];
  else if (prio1("p1") !== prio1("p2")) order = prio1("p1") > prio1("p2") ? ["p1", "p2"] : ["p2", "p1"];
  else if (ignoresFoeSpeed("p1") !== ignoresFoeSpeed("p2")) order = ignoresFoeSpeed("p1") ? ["p1", "p2"] : ["p2", "p1"];
  else if (!ignoresFoeSpeed("p1") && spdOf("p1") !== spdOf("p2")) order = spdOf("p1") > spdOf("p2") ? ["p1", "p2"] : ["p2", "p1"];
  else if (next.speedTiebreak !== null) {
    // §6：每局至多一次平速判定，memoize 后复用
    order = [next.speedTiebreak, OTHER[next.speedTiebreak]];
  } else {
    const u = rng.next("order_tiebreak");
    events.push({ type: "rng-draw", detail: { purpose: "order_tiebreak" }, rngDraw: { purpose: "order_tiebreak", value: u } });
    const winner: SideId = u < 0x80000000 ? "p1" : "p2";
    next.speedTiebreak = winner;
    order = [winner, OTHER[winner]];
  }

  // 已行动集合 → suspend 时写 remaining（阵亡者行动作废，未行动者保留）
  const acted = new Set<SideId>();
  const actionIdOf = (a: MoveAction | { kind: "invalid"; actionId: string }): string =>
    a.kind === "move" ? `act_${a.moveId}`
    : a.kind === "switch" ? `act_switch-${a.benchIndex}`
    : a.kind === "struggle" ? "act_struggle"
    : a.kind === "concede" ? "act_concede"
    : a.kind === "mech" ? a.actionId
    : a.actionId;
  const writeSuspension = (koSide: SideId, teDone = false, teCursor?: TeCursor) => {
    next.suspension = {
      koSide,
      remaining: {
        p1: acted.has("p1") || koSide === "p1" ? null : actionIdOf(resolved.p1),
        p2: acted.has("p2") || koSide === "p2" ? null : actionIdOf(resolved.p2),
      },
      // firstSide：本回合先行动方——续跑行动评估 if:{order} 条件用
      firstSide: order[0],
      // teDone/teCursor：TURN_END 产出的挂起——replacement 续跑 runTurnEnd 按游标跳过已结算窗口
      ...(teDone ? { teDone: true } : {}),
      ...(teCursor !== undefined ? { teCursor } : {}),
    };
    next.phase = "checkpoint";
  };

  // PRE-ORDER 登场补偿的挂起：order 已定型——写挂起并保留双方声明动作（acted 仍为空）
  if (preOrderOutcome !== undefined) {
    writeSuspension(preOrderOutcome);
    return { ok: true, state: finish(next, rng), events };
  }

  // TURN_START（排序后、首行动前）：机制回合开始钩子（魂印"每回合开始时"族——可产伤 → 挂起/终局）。
  // 挂起时双方动作均未执行：remaining 保留双方声明（writeSuspension 依 acted/koSide 自动失效死侧）。
  for (const s of ["p1", "p2"] as const) {
    delete next.sides[s].unit.dealtThisTurn; // 回合伤害量清零（dealt_tick 读取窗=上一回合末窗口到本回合末）
    const tsCtx = mkHookCtx(pack, next, events, rng, s);
    for (const m of MECHANICS) m.onTurnStart?.(tsCtx);
    if (tsCtx.outcome === "terminal") {
      return { ok: true, state: finish(next, rng), events };
    }
    if (tsCtx.outcome !== undefined) {
      writeSuspension(tsCtx.outcome);
      return { ok: true, state: finish(next, rng), events };
    }
  }

  outer: for (const side of order) {
    const unit = next.sides[side].unit;
    const act = resolved[side];
    if (unit.currentHp <= 0) { acted.add(side); continue; } // BEFORE_ACTION: KO 跳过，不耗 PP
    if (act.kind === "invalid") {
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: act.actionId } });
      acted.add(side);
      continue;
    }
    if (act.kind === "switch") {
      acted.add(side);
      // 束缚（noSwitch flag）：持有者不能主动换人
      if (noSwitchOn(unit)) {
        events.push({ type: "action-failed", detail: { side, reason: "bound", actionId: `act_switch-${act.benchIndex}` } });
        continue;
      }
      const sw = doSwitch(pack, next, events, side, act.benchIndex, "action", rng);
      // 换下钩子的致命结算（魂印"换下时"产伤 KO）：不换人，按挂起/终局处理
      if (sw.fatal === "terminal") break outer;
      if (sw.fatal !== undefined) { writeSuspension(sw.fatal); break outer; }
      if (sw.swapped) continue;
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: `act_switch-${act.benchIndex}` } });
      continue;
    }
    if (act.kind === "struggle") {
      acted.add(side);
      const cp = execStruggle(pack, next, events, rng, side, unit, "act_struggle");
      if (cp === "terminal") break outer;
      if (cp !== "continue") { writeSuspension(cp.suspend); break outer; }
      continue;
    }

    if (act.kind === "concede") { acted.add(side); continue; } // concede 已在排序前处理
    if (act.kind === "mech") {
      acted.add(side);
      // 道具不走招式的控制/害怕门。解控药否则没法用。换人仍比道具先。
      const cp = execMechAction(pack, next, events, rng, side, unit, act.actionId, order[0]);
      if (cp === "terminal") break outer;
      if (cp !== "continue") { writeSuspension(cp.suspend); break outer; }
      continue;
    }
    acted.add(side);
    const moveId = act.moveId;
    const move: CompiledMove | undefined = pack.movesById.get(moveId);
    const slot = unit.moves.find((m) => m.moveId === moveId);
    if (!move || !slot || slot.pp <= 0) {
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: `act_${moveId}` } });
      continue;
    }
    {
      const cp = execMoveAction(pack, next, events, rng, side, unit, move, slot, `act_${moveId}`, order[0]);
      if (cp === "terminal") break outer;
      if (cp !== "continue") { writeSuspension(cp.suspend); break outer; }
    }
  }

  // TURN_END（v2 §4.4/§4.6）：剩余回合递减，归零移除并发 effect-faded；
  // 随后机制回合末钩子（魂印回血/固伤/PP回复/endure 回卷/快照）。
  // v1 pack 无任何 remainingTurns 效果且无机制钩子 → 本段对该包是字节级 no-op。
  // 挂起（replacement 待决策）时不递减、不推进 turn——由 applyReplacement 收尾。
  if (!next.terminal && next.suspension === undefined) {
    const te = runTurnEnd(pack, next, events, rng, undefined, order[0]);
    if (te.suspend !== undefined) writeSuspension(te.suspend, true, te.cursor);
  }

  if (!next.terminal && next.suspension === undefined) {
    if (next.turn >= pack.limits.maxTurns) {
      next.terminal = { result: "draw", reason: "turn-limit" };
      events.push({ type: "battle-end", detail: { result: "draw", reason: "turn-limit" } });
      next.phase = "end";
    } else {
      next.turn += 1;
      next.phase = "collect";
    }
  } else if (next.terminal) {
    next.phase = "end";
  }
  // 挂起态：phase 保持 writeSuspension 写入的 "checkpoint"
  return { ok: true, state: finish(next, rng), events };
}

type CpResult = "continue" | "terminal" | { suspend: SideId };

/** TURN_END 恢复游标：win=窗口序号（代码序固定），item=窗口内已结算条目序数（该条目已落账，续跑从 item+1 起）。unitId 校验：替补换入后剩余窗口整体跳过（归属旧单位）。 */
type TeCursor = { side: SideId; unitId: string; win: number; item: number };

/**
 * TURN_END 共享段：效果递减 → 各机制 onTurnEnd（hurt 通道走 checkpoint）。
 * 返回 {suspend,cursor} = 回合末固伤等造成有替补的 KO → 调用方把 cursor 写进
 * suspension.teCursor，applyReplacement 续跑同一游标恢复（防双结算/丢结算）。
 */
function runTurnEnd(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  resume?: TeCursor,
  firstSide?: SideId,
): { suspend?: SideId; cursor?: TeCursor } {
  // 游标门控：s 在 resume.side 之前已完整结算；同侧 win 之前/之内的窗口跳过；
  // 该侧单位被替换（unitId 不符）时其剩余窗口全部跳过——回合末结算归属倒下时的在场单位。
  const sideDone = (s: SideId): boolean =>
    resume !== undefined && (s < resume.side || (s === resume.side && next.sides[s].unit.unitId !== resume.unitId));
  const skipWin = (s: SideId, w: number): boolean =>
    resume !== undefined && (sideDone(s) || (s === resume.side && w < resume.win));
  // 窗口内条目起点：游标所指条目已结算 → 从 item+1 起
  const itemFrom = (s: SideId, w: number): number =>
    resume !== undefined && s === resume.side && w === resume.win ? resume.item + 1 : 0;

  for (const s of ["p1", "p2"] as const) {
    let win = -1;
    const u = next.sides[s].unit;
    // 周期窗口统一派发：periodic{win} 条目按 effects 序逐条 applyOp payload；
    // 返回 terminal/ok/挂起——游标语义与旧 flag 窗一致（item=已结算条目下标，续跑 item+1 起）。
    const runWin = (w: number): "ok" | "terminal" | { suspend: SideId; cursor: TeCursor } => {
      if (skipWin(s, w) || u.currentHp <= 0) return "ok";
      const r = runPeriodicWin({ pack, next, events, side: s, unit: u, move: REACT_STUB_MOVE, rng, order: "first" }, u, w, itemFrom(s, w));
      if (r.cp === "terminal") return "terminal";
      if (r.cp !== "continue") return { suspend: r.cp.suspend, cursor: { side: s, unitId: u.unitId, win: w, item: r.item } };
      return "ok";
    };
    // W-1：periodic expiry 到期窗（params.expiry:1 条目在 remainingTurns===1 时派发 payload——
    // doom 的原子形态；递减前结算，foeAlive 门保证 resume 幂等不双杀）。
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W0：效果递减 + 场地印记递减
    win += 1;
    if (!skipWin(s, win)) {
      u.effects = u.effects.filter((e) => {
        if (e.remainingTurns === undefined) return true;
        if (e.kind.startsWith("control:")) return true; // 控制按阻断次数消耗，不走 TURN_END
        if (e.appliedTurn === next.turn) return true; // 本回合新施加的效果不递减
        e.remainingTurns -= 1;
        if (e.remainingTurns > 0) return true;
        events.push({ type: "effect-faded", detail: { side: s, name: e.label ?? e.kind } });
        return false;
      });
      // 场地印记递减（五行印记等 remainingTurns）——与单位效果同节律：施加回合不减、归零消散
      const fm = next.sides[s].fieldMarks;
      if (fm !== undefined) {
        next.sides[s].fieldMarks = fm.filter((e) => {
          if (e.remainingTurns === undefined || e.appliedTurn === next.turn) return true;
          e.remainingTurns -= 1;
          if (e.remainingTurns > 0) return true;
          events.push({ type: "effect-faded", detail: { side: s, name: e.kind } });
          return false;
        });
        if (next.sides[s].fieldMarks!.length === 0) delete next.sides[s].fieldMarks;
      }
    }
    // W1：dot 扣血——ailment dot flag（枚举数据）与 periodic{win} 条目按 effects 序交错（逐条 checkpoint）
    win += 1;
    if (!skipWin(s, win)) {
      for (const [i, e] of u.effects.entries()) {
        if (i < itemFrom(s, win)) continue;
        if (u.currentHp <= 0) break;
        if (e.kind === "periodic" && e.params?.win === win) {
          const cp = periodicEntryFire({ pack, next, events, side: s, unit: u, move: REACT_STUB_MOVE, rng, order: "first" }, u, e);
          if (cp === "terminal") return {};
          if (cp !== "continue") return { suspend: cp.suspend, cursor: { side: s, unitId: u.unitId, win, item: i } };
          continue;
        }
        const t = tickAmountOfEntry(u, e, "dot", (n, p) => rng.drawBelow(n, p));
        if (t === undefined) continue;
        const amount = t.amount;
        u.currentHp = Math.max(0, u.currentHp - amount);
        events.push({
          type: "damage",
          detail: { side: s, amount, hpAfter: { current: u.currentHp, max: u.base.hp }, damageKind: "fixed", cause: `status:${t.kind}` },
        });
        const cp = checkpoint(pack, next, events, rng);
        if (cp === "terminal") return {};
        if (cp !== "continue") return { suspend: cp.suspend, cursor: { side: s, unitId: u.unitId, win, item: i } };
      }
    }
    // W2：hot/转化——periodic{win} payload 结算（heal / hp_delta 转变对由信封 if 互斥）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W3：回合末吸取窗口——periodic{win} payload（hp_delta + healSelf）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W4：回合末对手侧扣血窗口——periodic{win} payload（hp_delta target:opponent）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W5：回合末能力升降窗口——periodic{win} payload（apply_stat_stage）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W6：回合末 PP 恢复窗口——periodic{win} payload（pp_delta）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W7：回合末累计先制削减——periodic{win} payload（apply_status prio_up stack）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W8：回合末 PP 削减窗口——periodic{win} payload（pp_delta target:opponent）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W9：回合末吸强窗口——periodic{win} payload（transfer_stages sign:"up"）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W10：回合末随机吸强窗口——periodic{win} payload（transfer_stages randomCount）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W11：回合末解弱化窗口——periodic{win} payload（clear_stages down / transfer_stages push）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W12：回合末消除对手回合类效果窗口——periodic{win} payload（cleanse scope:timed；params.count 逐次消耗）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W13：回合末消除对手能力提升窗口——periodic{win} payload（clear_stages up；op 自带 trigger7/17 派发）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W14：回合末自解异常窗口——periodic{win} payload（cleanse scope:ailment target:self）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W15：回合末随机异常窗口——periodic{win} payload 逐条派发
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W15b：回合末伤害量固伤窗——periodic{win} payload（hp_delta ofSelfDealt/perImmuneFlat）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    u.dealtThisTurn = 0;
    // W15c：回合末重触发窗（react trigger:18，"回合结束后额外触发N次该效果"——payload=宿主 op 复刻；
    // params.hpAboveN/hpAboveD=持有者当前体力 > 上限 n/d 才触发）
    win += 1;
    if (!skipWin(s, win) && u.currentHp > 0) {
      const foe = next.sides[OTHER[s]].unit;
      const ctx0 = { pack, next, events, side: s, unit: u, move: REACT_STUB_MOVE, foe, targetSide: OTHER[s], target: foe, rng, order: "first" as const };
      const cp = fireReactive(ctx0, u, 18, {});
      if (cp === "terminal") return {};
      if (cp !== "continue") return { suspend: cp.suspend, cursor: { side: s, unitId: u.unitId, win, item: itemFrom(s, win) } };
    }
    // W16：回合末弱化转移窗口——periodic{win} payload（transfer_stages sign:"down"）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
    // W17：回合末削上限窗口——periodic{win} payload（apply_status max_hp_down grow）
    win += 1;
    {
      const r = runWin(win);
      if (r === "terminal") return {};
      if (r !== "ok") return r;
    }
  }
  // W21：机制回合末钩子（item 粒度；win 取 21 > 全部 periodic 窗——skipWin 单调序依赖编号序=执行序）。
  // 续跑从挂起机制自身重入——机制内部经 teResume 等断点状态续跑其未结算条目
  // （仅 soulmark 实现 onTurnEnd；可挂起的机制必须持久化条目内续跑位置，否则重入即整体双结算）。其后机制正常结算。
  const WIN_MECH = 21;
  for (const s of ["p1", "p2"] as const) {
    if (skipWin(s, WIN_MECH)) continue;
    const ctx = mkHookCtx(pack, next, events, rng, s);
    if (firstSide !== undefined) ctx.firstSide = firstSide; // 直接赋值——spread 会断 hurt 闭包对 ctx.outcome 的写回
    const mechFrom = resume !== undefined && s === resume.side && resume.win === WIN_MECH ? resume.item : 0;
    for (const [mi, m] of MECHANICS.entries()) {
      if (mi < mechFrom) continue;
      m.onTurnEnd?.(ctx);
      if (ctx.outcome === "terminal") return {};
      if (ctx.outcome !== undefined) return { suspend: ctx.outcome, cursor: { side: s, unitId: next.sides[s].unit.unitId, win: WIN_MECH, item: mi } };
    }
    // react trigger 8：当回合未受攻击伤害（"回合结束时若当回合未受到攻击伤害则X"）
    // 攻击伤害判据：本回合事件流中无指向本侧的裸 damage 条目（recoil/dot/hot_echo 带 cause 不计）。
    // react8Done：游标已过机制段尾（item≥机制数）→ react8 已派发，续跑不重发。
    const u = next.sides[s].unit;
    const react8Done = resume !== undefined && s === resume.side && resume.win === WIN_MECH && resume.item >= MECHANICS.length;
    if (!react8Done && u.currentHp > 0 && !events.some((e) => e.type === "damage" && e.detail.side === s && e.detail.recoil !== true && e.detail.cause === undefined)) {
      const cp8 = fireReactive({ pack, next, events, side: s, unit: u, move: REACT_STUB_MOVE, rng, order: "first" }, u, 8, {});
      if (cp8 === "terminal") return {};
      if (cp8 !== "continue") return { suspend: cp8.suspend, cursor: { side: s, unitId: u.unitId, win: WIN_MECH, item: MECHANICS.length } };
    }
  }
  return {};
}

/** react payload 在无招式上下文（回合末触发器）时占位的最小 move 信封。 */
const REACT_STUB_MOVE = { id: "__react__" } as unknown as CompiledMove;

/** damage op + CHECKPOINT */
function applyDamage(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  attackerSide: SideId,
  amount: number,
  kind: "move" | "struggle",
): CpResult {
  const foe = next.sides[OTHER[attackerSide]].unit;
  // 0 伤害命中不消耗护盾（免疫招式不该白吃护盾）
  if (amount > 0) for (const m of MECHANICS) {
    const ev = m.absorbDamage?.({ pack, unit: foe });
    if (ev !== undefined) {
      events.push({ type: ev.type as CoreEvent["type"], detail: { side: OTHER[attackerSide], ...ev.detail } });
      return "continue";
    }
  }
  foe.currentHp = Math.max(0, foe.currentHp - amount);
  events.push({ type: "damage", detail: { side: OTHER[attackerSide], amount, hpAfter: { current: foe.currentHp, max: foe.base.hp }, ...(kind === "struggle" ? { cause: "struggle" } : {}) } });
  if (foe.currentHp > 0) {
    for (const m of MECHANICS) {
      const dCtx = { ...mkHookCtx(pack, next, events, rng, OTHER[attackerSide]), amount };
      m.onDamaged?.(dCtx);
      if (dCtx.outcome === "terminal") return "terminal";
      if (dCtx.outcome !== undefined) return { suspend: dCtx.outcome };
    }
  }
  return checkpoint(pack, next, events, rng);
}

/**
 * v2 §2：active↔bench[i] 交换；返回 {swapped, fatal}：
 * swapped=交换完成；fatal=换下前钩子致命结算（换下中止——terminal 或需挂起的 KO 侧）。
 * 合法交换 emit switch + 机制换下/登场钩子 + nextInFx 登场结算；非法返回 swapped:false。
 */
function doSwitch(pack: FrozenPack, next: CoreState, events: CoreEvent[], side: SideId, benchIndex: number, via: "action" | "replacement", rng: DeterministicRng): { swapped: boolean; fatal?: "terminal" | SideId } {
  const s = next.sides[side];
  const bench = s.bench;
  const b = bench?.[benchIndex];
  if (!b || b.currentHp <= 0 || b.banished === true) return { swapped: false };
  const out = s.unit;
  // 换下钩子（魂印"换下时"——换离前在场上结算，ops 目标仍指向场上状态）。
  // 致命结算 → 换下中止（unit 留场/已倒下由 checkpoint 判定），不换。
  if (via === "action" && out.currentHp > 0) {
    // 换下钩子双侧派发（"对手换下时"观察方魂印）；switchSide 标记换下方。
    for (const obs of ["p1", "p2"] as const) {
      const soCtx = { ...mkHookCtx(pack, next, events, rng, obs), switchSide: side };
      for (const m of MECHANICS) m.onSwitchOut?.(soCtx);
      if (soCtx.outcome !== undefined) return { swapped: false, fatal: soCtx.outcome };
    }
  }
  bench[benchIndex] = out;
  s.unit = b;
  b.entryWasSwitch = via === "action"; // 登场方式记账（"本次登场为主动切换登场则X"——action=主动换人，replacement=战后补位非主动）
  events.push({ type: "switch", detail: { side, outUnitId: out.unitId, inUnitId: b.unitId, via } });
  // 换入结算共享段（entrySettle：onEntry + nextInFx + 留守方 react9）——
  // 登场钩子可产伤 KO（"登场时给对手固伤"类）：swap 已完成但须传播中断语义
  const cp = entrySettle(pack, next, events, rng, side);
  return { swapped: true, ...(cp === "terminal" ? { fatal: "terminal" as const } : cp !== "continue" ? { fatal: cp.suspend } : {}) };
}

/**
 * 效果 op 分派：ops/ 注册表（一 op 一文件）；target 解析/foe 定位在 applyOp 内统一做。
 * 中断语义（suspend/terminal）由调用方处理。
 */
function applyEffect(pack: FrozenPack, next: CoreState, events: CoreEvent[], side: SideId, unit: SideUnit, move: CompiledMove, fx: CompiledEffect, rng: DeterministicRng, order: "first" | "last", prev: PrevFx = {}): CpResult {
  return applyOp({
    pack, next, events, side, unit, move, rng, order,
    prevApplied: prev.applied === true,
    noneApplied: prev.noneApplied === true,
    ...(prev.lastDamage !== undefined ? { lastDamage: prev.lastDamage } : {}),
    ...(prev.lastCrit !== undefined ? { lastCrit: prev.lastCrit } : {}),
    ...(prev.lastDamageKind !== undefined ? { lastDamageKind: prev.lastDamageKind } : {}),
    ...(prev.lastEff16 !== undefined ? { lastEff16: prev.lastEff16 } : {}),
  }, fx);
}

/** 前一 op 的结算摘要：applied="生效"判定（排除落空/被挡/失败）；lastDamage/lastCrit/lastDamageKind 供"造成的伤害不足N"/"若打出致命一击"/"若对手未受到固定伤害"谓词。 */
interface PrevFx { applied?: boolean; lastDamage?: number; lastCrit?: boolean; lastDamageKind?: string; lastEff16?: number; noneApplied?: boolean }
const NON_APPLIED = new Set<CoreEvent["type"]>(["action-failed", "protected", "control-immune", "missed"]);
const summarizeSince = (evs: CoreEvent[], from: number): PrevFx => {
  const prev: PrevFx = {};
  for (const e of evs.slice(from)) {
    if (!NON_APPLIED.has(e.type)) prev.applied = true;
    if (e.type === "damage") {
      const d = e.detail as { amount?: number; crit?: true; damageKind?: string; eff16?: number };
      prev.lastDamage = (prev.lastDamage ?? 0) + (d.amount ?? 0);
      if (d.crit === true) prev.lastCrit = true;
      prev.lastDamageKind = d.damageKind ?? "standard";
      if (d.eff16 !== undefined) prev.lastEff16 = d.eff16;
    }
  }
  return prev;
};

/**
 * v2：replacement decision 结算——KO 方提交 act_switch-<i>（或 concede）；
 * 执行换入后继续悬挂中保留的剩余行动，随后 TURN_END → 下一 collect。
 */
export function applyReplacement(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction | null; p2: CoreAction | null },
): CoreResult {
  if (state.terminal !== null) return fault("TERMINAL_STATE", "replacement on terminal battle");
  const susp = state.suspension;
  if (!susp) return fault("BAD_PHASE", "applyReplacement requires suspended battle");

  const rng = new DeterministicRng(state.rng.seedHex);
  for (let i = 0; i < state.rng.drawCounter; i++) rng.next("replay");
  try {
    return withOpBudget(() => applyReplacementInner(pack, state, actions, rng));
  } catch (e) {
    if (e instanceof EngineFault) return { ok: false, fault: e };
    throw e;
  }
}

function applyReplacementInner(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction | null; p2: CoreAction | null },
  rng: DeterministicRng,
): CoreResult {
    const susp = state.suspension;
    if (susp === undefined || susp === null) return fault("BAD_PHASE", "applyReplacement requires suspended battle");
    const events: CoreEvent[] = [];
    const next = structuredClone(state) as CoreState;
    next.revision += 1;

    const koSide = susp.koSide;
    const sub = actions[koSide];
    const choice = sub?.actionId ?? defaultReplacement(next, koSide);

    if (choice === "act_concede") {
      const result = OTHER[koSide];
      events.push({ type: "battle-end", detail: { result, reason: "concede" } });
      next.terminal = { result, reason: "concede" };
      next.phase = "end";
      delete next.suspension;
      return { ok: true, state: finish(next, rng), events };
    }
    const m = /^act_switch-(\d+)$/.exec(choice);
    const benchIndex = m ? parseInt(m[1]!, 10) : -1;
    const sw = benchIndex >= 0 ? doSwitch(pack, next, events, koSide, benchIndex, "replacement", rng) : { swapped: false as const };
    if (sw.fatal !== undefined) {
      // 登场钩子致命结算（如登场魂印 KO 对手）：terminal 由 checkpoint 写好；suspend→重新挂起
      delete next.suspension;
      if (sw.fatal !== "terminal") {
        next.suspension = { koSide: sw.fatal, remaining: { p1: null, p2: null } };
        next.phase = "checkpoint";
      }
      return { ok: true, state: finish(next, rng), events };
    }
    if (!sw.swapped) {
      return fault("INVALID_ACTION", `replacement action ${choice} is not a live bench switch`);
    }
    delete next.suspension;

    // 双 KO 接续：同一 transition 内被推迟的另一侧尸体仍在场（其 ko/onKO/印记
    // 已在产生它的 transition 内结算完毕——此处只补挂起/终局判定，不重发仪式）。
    const otherSide = OTHER[koSide];
    if (next.sides[otherSide].unit.currentHp <= 0) {
      if ((next.sides[otherSide].bench ?? []).some((b) => b.currentHp > 0 && b.banished !== true)) {
        next.suspension = {
          koSide: otherSide,
          remaining: { p1: null, p2: null },
          ...(susp.firstSide !== undefined ? { firstSide: susp.firstSide } : {}),
          ...(susp.teDone === true ? { teDone: true } : {}),
          ...(susp.teCursor !== undefined ? { teCursor: susp.teCursor } : {}),
        };
        next.phase = "checkpoint";
        return { ok: true, state: finish(next, rng), events };
      }
      // 对方无人可上：刚换入的一方已是唯一存活侧 → 其胜出
      next.terminal = { result: koSide, reason: "ko" };
      events.push({ type: "battle-end", detail: { result: koSide, reason: "ko" } });
      next.phase = "end";
      return { ok: true, state: finish(next, rng), events };
    }

    // 继续剩余行动（若存）
    const stopAtCheckpoint = (cp: CpResult): boolean => {
      if (cp === "continue") return false;
      if (cp !== "terminal") {
        // 续跑中再次触发有替补的 KO——重新挂起（continuation 为空）
        next.suspension = { koSide: cp.suspend, remaining: { p1: null, p2: null } };
        next.phase = "checkpoint";
      }
      return true;
    };
    for (const side of ["p1", "p2"] as const) {
      const rem = susp.remaining[side];
      if (rem === null) continue;
      const act = resolveAction(next, side, { actionId: rem, origin: "player", idempotencyKey: "resume" });
      const unit = next.sides[side].unit;
      if (unit.currentHp <= 0) continue;
      if (act.kind === "invalid") {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: act.actionId } });
        continue;
      }
      if (act.kind === "concede") {
        const result = OTHER[side];
        events.push({ type: "battle-end", detail: { result, reason: "concede" } });
        next.terminal = { result, reason: "concede" };
        next.phase = "end";
        break;
      }
      if (act.kind === "switch") {
        const remSw = doSwitch(pack, next, events, side, act.benchIndex, "action", rng);
        if (remSw.fatal === "terminal") break;
        if (remSw.fatal !== undefined) {
          next.suspension = { koSide: remSw.fatal, remaining: { p1: null, p2: null } };
          next.phase = "checkpoint";
          break;
        }
        if (!remSw.swapped) {
          events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: rem } });
        }
        continue;
      }
      if (act.kind === "struggle") {
        if (stopAtCheckpoint(execStruggle(pack, next, events, rng, side, unit, rem))) break;
        continue;
      }
      if (act.kind === "mech") {
        if (stopAtCheckpoint(execMechAction(pack, next, events, rng, side, unit, rem, susp.firstSide ?? "p1"))) break;
        continue;
      }
      const move = pack.movesById.get(act.moveId);
      const slot = unit.moves.find((mv) => mv.moveId === act.moveId);
      if (!move || !slot || slot.pp <= 0) {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: rem } });
        continue;
      }
      // 与主路径共用 execMoveAction——续跑动作同样走声明反应/hitIf/命中/效果/onMoveUsed 全链路
      if (stopAtCheckpoint(execMoveAction(pack, next, events, rng, side, unit, move, slot, rem, susp.firstSide ?? "p1"))) break;
      if (next.terminal) break;
    }

    if (!next.terminal && next.suspension === undefined) {
      // TURN_END（效果递减 + 机制钩子；固伤 KO → 可能重新挂起）。
      // susp.teDone：挂起本身就产自 TURN_END → 按 teCursor 续跑（跳过已结算窗口，防双结算/丢结算）。
      const te = runTurnEnd(pack, next, events, rng, susp.teDone === true ? susp.teCursor : undefined, susp.firstSide);
      if (te.suspend !== undefined) {
        next.suspension = {
          koSide: te.suspend,
          remaining: { p1: null, p2: null },
          teDone: true,
          ...(te.cursor !== undefined ? { teCursor: te.cursor } : {}),
        };
        next.phase = "checkpoint";
      }
      if (next.terminal === null && next.suspension === undefined) {
        if (next.turn >= pack.limits.maxTurns) {
          next.terminal = { result: "draw", reason: "turn-limit" };
          events.push({ type: "battle-end", detail: { result: "draw", reason: "turn-limit" } });
          next.phase = "end";
        } else {
          next.turn += 1;
          next.phase = "collect";
        }
      } else if (next.terminal !== null) {
        next.phase = "end";
      }
    }
    return { ok: true, state: finish(next, rng), events };
}

function finish(next: CoreState, rng: DeterministicRng): CoreState {
  next.rng = { ...next.rng, drawCounter: rng.drawCounter };
  return next;
}
