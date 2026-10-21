/**
 * ops/mechanism.ts —— 机制信封（Mechanism Envelope）：技能 react 条目 / periodic 周期条目 /
 * 魂印 hook 条目归一化后的统一形态。fireTriggers kernel 只认信封字段——
 * 各源的编译产物（params 键 / SoulHookOp 顶层字段）由 adapter 的 mech() 归一化进来，
 * 新增子句只需让 parser/挂载点发射既有信封字段，运行时零改动。
 *
 * 信封词汇：
 * - gate：事件分发门（读 GateBag 触发现场——承伤/先制/威力/类别/异常，外加 holder 血带/foe 存活/boss 门）；
 * - guard：世界谓词（condEval，由 adapter.condCtx 提供完整 OpCtx）；
 * - chance：{base,dyn,grow{add,cap,on},resetOnFire,next}——动态概率/概率累积/单次窗消费；
 * - acc：{step,cap,point,resetOnCap,atCapNext,atCapMul,atCapPayload}——幅度累积与达顶判定；
 *   达顶负载不在信封上，由幅度 op 的处理函数派发；
 * - count："fire"=派发即计（react）/"produced"=有事件产出才计（periodic）；
 * - once：每场战斗一次（onceStore 持久）；
 * - ops/elseOps：主负载 / 概率落空负载（"未触发则"）。
 *
 * 累积存储由 adapter.store(e,i) 提供读写句柄（react=params.growAcc/count、periodic=params.count、
 * 魂印=soul.magAcc/chanceAcc/firedOnce——存储位置差异不外泄到信封）。
 */
import type { CompiledEffect, Condition } from "../loader.ts";
import { EngineFault, OTHER } from "../types.ts";
import { carryDrainSlice } from "./hit-rider.ts";
import type { OpCtx } from "./types.ts";
import { isMod } from "./effects.ts";

/** 派发上下文（与 trigger.ts 同式，避免回环 import）。 */
type TrigCtx = Omit<OpCtx, "foe" | "target" | "targetSide">;

/** 事件分发现场袋：触发点由 adapter 提供（react 的 {cat,dmg,prio,power,ailment,removed}）。
 *  removed 非门控键——trigger 7 派发时带被清段数，经 adapter.opCtx 透传进 payload op 的 OpCtx.stagesRemoved。 */
export interface GateBag {
  cat?: number;
  dmg?: number;
  prio?: number;
  power?: number;
  ailment?: string;
  removed?: number;
}

export interface MechGate {
  /** 承伤阈值带（react params.min/max：dmg<=min 不触发；dmg 存在且 >=max 不触发）。 */
  dmgMin?: number;
  dmgMax?: number;
  /** 触发招式先制门（prioMin：缺省按 0 计；prioMax：仅 bag.prio 存在时判定）。 */
  prioMin?: number;
  prioMax?: number;
  /** 触发招式威力门（同上缺省语义）。 */
  powerMin?: number;
  powerMax?: number;
  /** 触发招式类别码（1=属性 2=物理 3=特殊；4=任意非属性——bag.cat 缺席时整门跳过）。 */
  cat?: number;
  /** 触发异常名限定（"自身烧伤解除后X"——bag.ailment 必须相等）。 */
  ailment?: string;
  /** 持有者当前体力带（react params.hpAboveN/D / hpBelowN/D）。 */
  hpAbove?: { numerator: number; denominator?: number };
  hpBelow?: { numerator: number; denominator?: number };
  /** 对手存活门（periodic foeAlive：对手倒下后续窗不再结算）。 */
  foeAlive?: boolean;
  /** boss 无效门（对手携带 mode overlay 时整条不结算）。 */
  boss?: boolean;
}

export interface MechChance {
  /** 静态概率（%）。 */
  base?: number;
  /** 动态概率：判定时刻按自/敌 当前或已损体力百分比快照。 */
  dyn?: "selfHpPct" | "selfMissingHpPct" | "foeHpPct" | "foeMissingHpPct";
  /** 概率累积：每次判定后 chanceAcc += add（cap 封顶；on:"fail"=仅落空累积）。 */
  grow?: { add: number; cap?: number; on?: "fail" };
  /** 判定命中后 chanceAcc 清零。 */
  resetOnFire?: boolean;
  /** 消费持有者 effects 表里的 next_chance 单次窗（params.ei 限定条目下标）。 */
  next?: boolean;
}

export interface MechAcc {
  /** 每次结算累积量（判定过的本次结算即累积——非续跑才记）。 */
  step: number;
  /** 幅度封顶：注入按域钳制（分数域 +cap 上限 / 负 cap=地板；point=裸值域同吃）。 */
  cap?: number;
  /** 裸值域（power/flat）也受 cap 钳制（"每回合增加50点，最高400点"）。 */
  point?: boolean;
  /** 达顶本次结算后清零（叠满→触发→重置循环）。 */
  resetOnCap?: boolean;
  /** 达顶延一档：mag>=cap 才视为达顶（缺省=本次累加达顶即触发）。 */
  atCapNext?: boolean;
  /** 达顶倍率：atCap 结算时裸值域 ×mul。 */
  atCapMul?: number;
  /** 有达顶负载（负载本身在幅度 op 上，不放进信封）。 */
  atCapPayload?: true;
  /** 注入目标：magnitude=op 幅度字段（growOp）/ opChance=op 顶层 chance 字段（react growAcc）。 */
  inject?: "magnitude" | "opChance";
  /** 记账时机："pre"=派发前写回（魂印——续跑条目用新值）/"post"=完结后写回（react——挂起不算一次触发）。 */
  commit?: "pre" | "post";
}

export interface MechEnv {
  gate?: MechGate;
  guard?: Condition;
  chance?: MechChance;
  acc?: MechAcc;
  /** "fire"=派发即消耗（旧 react params.count）/"produced"=有事件产出才消耗（旧 periodic params.count）。 */
  count?: "fire" | "produced";
  /** 每场战斗限一次。 */
  once?: boolean;
  ops?: readonly CompiledEffect[];
  elseOps?: readonly CompiledEffect[];
}

/** 累积/计数存储句柄：kernel 经此读写，位置差异留在 adapter。 */
export interface MechStore {
  magAcc?: { get(): number; set(v: number): void };
  chanceAcc?: { get(): number; set(v: number): void };
  once?: { get(): boolean; set(): void };
  count?: { get(): number; set(v: number): void; deplete(): void };
}

/** gate 求值：全部条件过才放行。bag 缺省 {}——dmgMin/powerMin 按缺省值兜底与旧语义一致。 */
export function gateOk(g: MechGate, ctx: TrigCtx, bag: GateBag): boolean {
  const holder = ctx.unit;
  const foe = ctx.next.sides[OTHER[ctx.side]].unit;
  if (g.boss === true && foe.mode !== undefined) return false;
  if (g.foeAlive === true && foe.currentHp <= 0) return false;
  if (g.dmgMin !== undefined && (bag.dmg ?? 0) <= g.dmgMin) return false;
  if (g.dmgMax !== undefined && bag.dmg !== undefined && bag.dmg >= g.dmgMax) return false;
  if (g.prioMin !== undefined && (bag.prio ?? 0) < g.prioMin) return false;
  if (g.prioMax !== undefined && bag.prio !== undefined && bag.prio > g.prioMax) return false;
  if (g.powerMin !== undefined && (bag.power ?? 0) < g.powerMin) return false;
  if (g.powerMax !== undefined && (bag.power ?? 0) > g.powerMax) return false;
  if (g.hpAbove !== undefined && holder.currentHp * (g.hpAbove.denominator ?? 100) <= holder.base.hp * g.hpAbove.numerator) return false;
  if (g.hpBelow !== undefined && holder.currentHp * (g.hpBelow.denominator ?? 100) >= holder.base.hp * g.hpBelow.numerator) return false;
  // cat 门：bag.cat 缺席时整门跳过（旧 react 语义——非招式触发的窗不判类别）；4=任意非属性（攻击）
  if (g.cat !== undefined && bag.cat !== undefined && !(g.cat === 4 ? bag.cat !== 1 : g.cat === bag.cat)) return false;
  if (g.ailment !== undefined && bag.ailment !== g.ailment) return false;
  return true;
}

/**
 * 概率抉择：dyn 快照 → +chanceAcc 累积 → next_chance 单次窗消费 → drawBelow 判定
 * → grow 记账（on:"fail" 仅落空累积）→ 命中 resetOnFire 清零。
 * 返回 true=判定落空（走 elseOps / skip）。
 */
export function chanceFails(
  ctx: TrigCtx,
  ch: MechChance,
  chanceAcc: { get(): number; set(v: number): void } | undefined,
  ei: number,
  drawPurpose: string,
): boolean {
  const holder = ctx.unit;
  const foe = ctx.next.sides[OTHER[ctx.side]].unit;
  const acc = ch.grow !== undefined && chanceAcc !== undefined ? chanceAcc.get() : 0;
  const dyn = ch.dyn === "selfHpPct" ? Math.floor((holder.currentHp * 100) / Math.max(1, holder.base.hp))
    : ch.dyn === "selfMissingHpPct" ? Math.floor(((holder.base.hp - holder.currentHp) * 100) / Math.max(1, holder.base.hp))
    : ch.dyn === "foeHpPct" ? Math.floor((foe.currentHp * 100) / Math.max(1, foe.base.hp))
    : ch.dyn === "foeMissingHpPct" ? Math.floor(((foe.base.hp - foe.currentHp) * 100) / Math.max(1, foe.base.hp))
    : undefined;
  let eff = (dyn ?? ch.base ?? 0) + acc;
  if (ch.next === true) {
    for (const nc of [...holder.effects]) {
      if (!isMod(nc, "nextChance") || nc.params === undefined) continue;
      if (nc.params.ei !== undefined && nc.params.ei !== ei) continue;
      if (nc.params.set !== undefined) eff = nc.params.set;
      if (nc.params.add !== undefined) eff += nc.params.add;
      if (nc.params.mul !== undefined) eff *= nc.params.mul;
      nc.params.count = (nc.params.count ?? 1) - 1;
      if (nc.params.count <= 0) {
        holder.effects = holder.effects.filter((x) => x !== nc);
        ctx.events.push({ type: "effect-faded", detail: { side: ctx.side, name: nc.label ?? "next_chance" } });
      }
    }
  }
  const failed = ctx.rng.drawBelow(100, drawPurpose) >= eff;
  if (ch.grow !== undefined && chanceAcc !== undefined && (ch.grow.on !== "fail" || failed)) {
    const cap = ch.grow.cap ?? 100;
    chanceAcc.set(Math.min(cap - (dyn ?? ch.base ?? 0), acc + ch.grow.add));
  }
  if (!failed && ch.resetOnFire === true && ch.grow !== undefined && chanceAcc !== undefined) chanceAcc.set(0);
  return failed;
}

/** acc 快照：mag=结算前累积（供注入），atCap=达顶判定（armed=有达顶语义字段才判）。
 *  magAcc 句柄缺席按 mag=0 计（魂印 growCap 单独在场时仍要判达顶）。 */
export function accPeek(acc: MechAcc | undefined, magAcc: { get(): number } | undefined): { mag: number; atCap: boolean } {
  if (acc === undefined) return { mag: 0, atCap: false };
  const mag = magAcc !== undefined ? magAcc.get() : 0;
  const armed = acc.resetOnCap === true || acc.atCapMul !== undefined || acc.atCapPayload === true;
  const atCap = armed && acc.cap !== undefined && (acc.atCapNext === true ? mag >= acc.cap : mag + acc.step >= acc.cap);
  return { mag, atCap };
}

/** acc 记账：判定过的结算写回累积值（atCap+resetOnCap 清零，否则 +step）。 */
export function accCommit(acc: MechAcc, magAcc: { get(): number; set(v: number): void }, mag: number, atCap: boolean): void {
  magAcc.set(atCap && acc.resetOnCap === true ? 0 : mag + acc.step);
}

/**
 * growStep 幅度注入：百分比域（分数/百分字段）按百分点 +mag（cap 钳制），裸值域（power/flat）仅 +mag——
 * acc.point 时裸值域同样吃 cap 钳制（封顶作用在裸值结果上）。
 * cap 符号感知：正 cap=上限（Math.min），负 cap=下限（Math.max——负 pct 叠加地板）。
 */
export const accGrow = (fx: CompiledEffect, mag: number, cap?: number, point?: boolean): CompiledEffect => {
  const cp = cap === undefined ? (v: number): number => v + mag : cap < 0 ? (v: number): number => Math.max(cap, v + mag) : (v: number): number => Math.min(cap, v + mag);
  const f = { ...fx } as Record<string, unknown>;
  for (const k of ["flatSelfPct", "flatSelfCurPct", "flatFoeShieldPct", "flatFoeDefSumPct", "flatSelfShieldPct", "flatHpDiffPct", "flatPrevTakenPct", "flatMaxHpDiffPct", "flatSelfDefSumPct", "flatFoeDefPct", "flatSelfAtkPct"] as const) {
    if (typeof f[k] === "number") f[k] = cp(f[k] as number);
  }
  for (const k of ["power", "flatBonus", "flat"] as const) {
    if (typeof f[k] === "number") f[k] = point === true ? cp(f[k] as number) : (f[k] as number) + mag;
  }
  const gfrac = (fr: { numerator: number; denominator: number }): { numerator: number; denominator: number } => ({
    numerator: Math.round((cp((fr.numerator * 100) / fr.denominator) * fr.denominator) / 100),
    denominator: fr.denominator,
  });
  if (typeof f.numerator === "number" && typeof f.denominator === "number") {
    f.numerator = gfrac({ numerator: f.numerator, denominator: f.denominator }).numerator;
  }
  if (f.frac !== undefined && typeof f.frac === "object") f.frac = gfrac(f.frac as { numerator: number; denominator: number });
  if (f.flatSelfFrac !== undefined && typeof f.flatSelfFrac === "object") f.flatSelfFrac = { ...(f.flatSelfFrac as object), ...gfrac(f.flatSelfFrac as { numerator: number; denominator: number }) };
  if (f.flatFoeFrac !== undefined && typeof f.flatFoeFrac === "object") f.flatFoeFrac = { ...(f.flatFoeFrac as object), ...gfrac(f.flatFoeFrac as { numerator: number; denominator: number }) };
  if (f.params !== undefined && typeof f.params === "object") {
    const p = { ...(f.params as Record<string, number>) };
    for (const k of ["pct", "flatPct", "defSumPct", "atkPct", "add", "flatFoeDefSumPct", "flatSelfDefSumPct", "pctMin", "pctMax"] as const) {
      if (typeof p[k] === "number") p[k] = Math.round(cp(p[k]));
    }
    if (typeof p.n === "number" && typeof p.d === "number") p.n = Math.round((cp((p.n * 100) / p.d) * p.d) / 100);
    if (typeof p.flat === "number") p.flat = point === true ? cp(p.flat) : p.flat + mag;
    f.params = p;
  }
  const out = f as unknown as CompiledEffect;
  carryDrainSlice(fx, out);
  return out;
};

/** atCapMul：达顶结算的裸值域放大（power/flatBonus/flat/params.flat ×mul 取整）。 */
export const accMul = (fx: CompiledEffect, mul: number): CompiledEffect => {
  const f = { ...fx } as Record<string, unknown>;
  for (const k of ["power", "flatBonus", "flat"] as const) {
    if (typeof f[k] === "number") f[k] = Math.round((f[k] as number) * mul);
  }
  if (f.params !== undefined && typeof f.params === "object") {
    const p = { ...(f.params as Record<string, number>) };
    if (typeof p.flat === "number") p.flat = Math.round(p.flat * mul);
    f.params = p;
  }
  const out = f as unknown as CompiledEffect;
  carryDrainSlice(fx, out);
  return out;
};

/** opChance 注入（react growAcc）：fx.chance += mag，acc.cap 封顶总值（缺省 100）。 */
export const accChance = (fx: CompiledEffect, mag: number, cap?: number): CompiledEffect => {
  const ch = (fx as { chance?: number }).chance;
  if (typeof ch !== "number" || mag <= 0) return fx;
  const out = { ...fx, chance: Math.min(cap ?? 100, ch + mag) } as CompiledEffect;
  carryDrainSlice(fx, out);
  return out;
};

/** acc 默认变换：inject 语义内置——magnitude 走 accGrow、opChance 走 accChance，达顶再乘 atCapMul。 */
export const accTransform = (fx: CompiledEffect, acc: MechAcc | undefined, mag: number, atCap: boolean): CompiledEffect => {
  if (acc === undefined) return fx;
  let out = fx;
  if (acc.inject === "opChance") out = accChance(out, mag, acc.cap);
  else if (mag !== 0 || acc.cap !== undefined) out = accGrow(out, mag, acc.cap, acc.point);
  if (atCap && acc.atCapMul !== undefined) out = accMul(out, acc.atCapMul);
  return out;
};

// ── 编译产物 → 信封归一化 ──────────────────────────────────────────────

type Params = Record<string, unknown> | undefined;
const P = (e: { params?: Params }): Record<string, unknown> => (e.params ?? {}) as Record<string, unknown>;

/** react 条目 → 信封：params 守卫键→gate、顶层 ailment→gate.ailment、chance→chance.base、growStep→acc(opChance)、count→fire。 */
type ReactGrowthMode =
  | { mode: "none" | "chance" }
  | { mode: "magnitude" }
  | { mode: "invalid"; reason: string };

/**
 * react 的旧 params.growStep 只递增 payload 的 chance；直接 payload grow 帧则递增幅度。
 * 两者共用 params.growAcc，不能同时出现。幅度帧必须是唯一且首个直接子句，
 * 否则 accTransform 会影响帧前的 op；达顶尾负载在 react 没有可持久化的续跑游标。
 */
export function reactGrowthMode(e: { params?: Params; payload?: readonly unknown[] }): ReactGrowthMode {
  const p = e.params ?? {};
  const grows = (e.payload ?? []).flatMap((fx, index) => {
    if (fx === null || typeof fx !== "object" || Array.isArray(fx)) return [];
    const record = fx as Record<string, unknown>;
    return record.op === "grow" ? [{ fx: record, index }] : [];
  });
  if (grows.length === 0) return p.growStep !== undefined ? { mode: "chance" } : { mode: "none" };
  if (p.growStep !== undefined || p.growCap !== undefined) {
    return { mode: "invalid", reason: "react cannot combine legacy params.growStep/growCap with a payload magnitude grow frame" };
  }
  if (grows.length > 1) return { mode: "invalid", reason: "react payload supports only one direct grow frame" };
  const only = grows[0]!;
  if (only.index !== 0) return { mode: "invalid", reason: "react payload grow frame must be the first direct op" };
  if (only.fx.of !== "magnitude") return { mode: "invalid", reason: "react payload grow frame must use of=magnitude" };
  if (typeof only.fx.step !== "number") return { mode: "invalid", reason: "react payload magnitude grow requires step" };
  if (Object.keys(only.fx).some((key) => key === "if" || key === "nullifyOnly" || key.startsWith("chance"))) {
    return { mode: "invalid", reason: "react magnitude grow frame cannot have per-op gates" };
  }
  if (only.fx.payload !== undefined) return { mode: "invalid", reason: "react magnitude grow cannot have a deferred at-cap payload" };
  return { mode: "magnitude" };
}

export function reactMech(e: { params?: Params; payload?: readonly Record<string, unknown>[]; chance?: number; ailment?: string }): MechEnv {
  const growth = reactGrowthMode(e);
  if (growth.mode === "invalid") throw new EngineFault("REACT_GROW_MODE", growth.reason);
  const p = P(e);
  const gate: MechGate = {};
  if (p.min !== undefined) gate.dmgMin = p.min as number;
  if (p.max !== undefined) gate.dmgMax = p.max as number;
  if (p.prioMin !== undefined) gate.prioMin = p.prioMin as number;
  if (p.prioMax !== undefined) gate.prioMax = p.prioMax as number;
  if (p.powerMin !== undefined) gate.powerMin = p.powerMin as number;
  if (p.powerMax !== undefined) gate.powerMax = p.powerMax as number;
  if (p.cat !== undefined) gate.cat = p.cat as number;
  if (e.ailment !== undefined) gate.ailment = e.ailment;
  if (p.hpAboveN !== undefined) gate.hpAbove = { numerator: p.hpAboveN as number, ...(p.hpAboveD !== undefined ? { denominator: p.hpAboveD as number } : {}) };
  if (p.hpBelowN !== undefined) gate.hpBelow = { numerator: p.hpBelowN as number, ...(p.hpBelowD !== undefined ? { denominator: p.hpBelowD as number } : {}) };
  const chanceN = e.chance ?? (p.chance as number | undefined);
  const mech: MechEnv = { ops: (e.payload ?? []) as unknown as CompiledEffect[] };
  if (Object.keys(gate).length > 0) mech.gate = gate;
  if (chanceN !== undefined) mech.chance = { base: chanceN };
  if (p.growStep !== undefined) mech.acc = { step: p.growStep as number, ...(p.growCap !== undefined ? { cap: p.growCap as number } : {}), inject: "opChance", commit: "post" };
  if (p.count !== undefined) mech.count = "fire";
  return mech;
}

/** periodic 条目 → 信封：foeAlive→gate、chance→chance.base、count→produced。win/expiry 留 match 侧。 */
export function periodicMech(e: { params?: Params; payload?: readonly Record<string, unknown>[] }): MechEnv {
  const p = P(e);
  const mech: MechEnv = { ops: (e.payload ?? []) as unknown as CompiledEffect[] };
  if (p.foeAlive === 1) mech.gate = { foeAlive: true };
  if (p.chance !== undefined) mech.chance = { base: p.chance as number };
  if (p.count !== undefined) mech.count = "produced";
  return mech;
}
