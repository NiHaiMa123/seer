/**
 * ops/periodic.ts —— 还没收成 periodic 的六个具名周期：
 * doom、dot_field、hot、drain_dot、foe_dot、pp_drain。
 * 挂载时脱糖成 kind:"periodic"（apply-effect.ts）。
 *
 * 新的回合窗不要加进这个 switch。家族规则直接发 name:"periodic" 和已有的 win。
 * 十二个 *_tick 已经这样发，不在这里。
 * 引擎 runPeriodicWin 按 win 序派发，次序和挂起游标不变。
 */
import { effectDefOf } from "./effects.ts";
import type { CompiledEffect, Condition } from "../loader.ts";

type P = Record<string, number>;
type Fx = CompiledEffect & { op: "apply_status"; params?: P };

/** 周期窗口序号：与 engine.runTurnEnd 内 win 递增次序一一对应（0=到期/doom，1=递减，2=dot，3=hot…）。 */
export const WIN = {
  expiry: 0,
  dot: 2,
  hot: 3,
  drainDot: 4,
  foeDot: 5,
  stage: 6,
  ppTick: 7,
  prioPush: 8,
  ppDrain: 9,
  stealStages: 10,
  stealRand: 11,
  cleanseDown: 12,
  cleanseFoe: 13,
  cleanseUp: 14, // 家族规则直接发这个窗口，不再经具名 tick
  cleanseSelfAil: 15, // 家族规则直接发这个窗口，不再经具名 tick
  ailment: 16,
  dealt: 17,
  reactTail: 18,
  transferDown: 19, // timed-85 直接发这个窗口，不再经具名 tick
  maxhp: 20,
} as const;

/** flat / flatMin-Max / flatPerStageFlat / n:d(+cur) → hp_delta 量字段。 */
const dmgAmt = (p: P): Partial<CompiledEffect & { op: "hp_delta" }> => {
  // statDiff 优先：幅值=|自身该维-对手该维|（"根据双方速度值之差n…附加n点固定伤害"）
  if (typeof p.statDiff === "string") return { statDiff: p.statDiff, ...(p.statDiffDenom !== undefined ? { statDiffDenom: p.statDiffDenom } : {}) } as Partial<CompiledEffect & { op: "hp_delta" }>;
  if (p.flat !== undefined) return { flat: p.flat };
  if (p.flatMin !== undefined && p.flatMax !== undefined) return { flatRange: { min: p.flatMin, max: p.flatMax } };
  if (p.flatPerStageFlat !== undefined) {
    return { selfStageFlat: { flat: p.flatPerStageFlat, per: p.flatPerStagePer ?? 1, sign: p.flatPerStageDown === 1 ? "down" : "up" } };
  }
  if (p.n !== undefined && p.d !== undefined) return { frac: { numerator: p.n, denominator: p.d, of: p.cur === 1 ? "cur" : "max" } };
  return {};
};

/** hot 的 HP 门参数（mulL/mulH/mulFull、conv 门共用后缀约定）→ Condition。 */
const hpGate = (p: P, pre: "mulL" | "mulH" | "drainConvHp" | "drainConvHpA" | "pctConvHp" | "pctConvHpA" | "echoL" | "echoH"): Condition | undefined =>
  pre.endsWith("A")
    ? p[`${pre}N`] !== undefined ? { selfHpAbove: { numerator: p[`${pre}N`]!, denominator: p[`${pre}D`] ?? 1 } } : undefined
    : p[`${pre}N`] !== undefined ? { selfHpBelow: { numerator: p[`${pre}N`]!, denominator: p[`${pre}D`] ?? 1 } } : undefined;

const allOf = (conds: (Condition | undefined)[]): Condition | undefined => {
  const cs = conds.filter((c): c is Condition => c !== undefined);
  return cs.length === 0 ? undefined : cs.length === 1 ? cs[0] : { and: cs };
};

/** hot → heal payload（mul/echo/conv 门变体全部折叠进 heal op 的条件字段）。 */
const hotPayload = (p: P): CompiledEffect[] => {
  const fx: Record<string, unknown> = { op: "heal", target: "self", plain: true };
  if (p.flat !== undefined) fx.flat = p.flat;
  else if (p.flatMin !== undefined && p.flatMax !== undefined) fx.flatRange = { min: p.flatMin, max: p.flatMax };
  else {
    const n = p.n ?? p.numerator, d = p.d ?? p.denominator;
    fx.numerator = n ?? 1; fx.denominator = d ?? 1;
    if (p.missing === 1) fx.missing = true;
  }
  // 翻倍门（mulLN/D 低于、mulHN/D 高于、mulFull 满血——互斥变体）
  const mulW = allOf([hpGate(p, "mulL"), hpGate(p, "mulH"), p.mulFull === 1 ? { selfHpFull: true } : undefined]);
  if (mulW !== undefined) fx.mulIf = { when: mulW, numerator: 2, denominator: 1 };
  // 转变：drainConvFlat（吸对手 flat）或 pctConvN/D（自身最大 n/d 百分比伤）
  if (p.drainConvFlat !== undefined) {
    const w = allOf([hpGate(p, "drainConvHp"), hpGate(p, "drainConvHpA"), p.drainConvFull === 1 ? { selfHpFull: true } : undefined]);
    fx.drainFlatIf = { flat: p.drainConvFlat, ...(w !== undefined ? { when: w } : {}) };
  }
  if (p.pctConvN !== undefined) {
    const w = allOf([hpGate(p, "pctConvHp"), hpGate(p, "pctConvHpA"), p.pctConvFull === 1 ? { selfHpFull: true } : undefined]);
    fx.pctSwapIf = { n: p.pctConvN, d: p.pctConvD ?? 1, ...(w !== undefined ? { when: w } : {}) };
  }
  // echo：回复量 n/d 反噬给对手（echoL/echoH/echoSelfHpFull 门）
  if (p.echoN !== undefined) {
    const w = allOf([hpGate(p, "echoL"), hpGate(p, "echoH"), p.echoSelfHpFull === 1 ? { selfHpFull: true } : undefined]);
    fx.foeEcho = { numerator: p.echoN, denominator: p.echoD ?? 1 };
    if (w !== undefined) fx.foeEchoIf = { when: w };
  }
  return [fx as unknown as CompiledEffect];
};

/**
 * name + params → periodic 形态；返回 undefined = 非周期名（原样挂载）。
 * params 里 win/expiry/foeAlive/count/chance 是实例级控制量，其余量化参数全部下沉进 payload op。
 */
export function periodicFormOf(fx: Fx): { params: P; payload: CompiledEffect[] } | undefined {
  if (fx.op !== "apply_status") return undefined;
  // periodic flag = "该名在 apply_status 挂载时脱糖为 periodic"——STATUS_DEFS 声明位，
  // 无 flag 的名原样落地（name:"periodic" 直写形态走 default 分支按原样挂载）。
  if (effectDefOf(fx.name)?.periodic !== "params") return undefined;
  // statDiff 可能落在 op 顶层（apply_status 的 params 限 number）——并入 p 供 dmgAmt 读取
  const fxTop = fx as unknown as { statDiff?: string; statDiffDenom?: number };
  const p = {
    ...(fx.params ?? {}),
    ...(fxTop.statDiff !== undefined ? { statDiff: fxTop.statDiff } : {}),
    ...(fxTop.statDiffDenom !== undefined ? { statDiffDenom: fxTop.statDiffDenom } : {}),
  } as P;
  const base = (win: number, payload: CompiledEffect[], extra: P = {}): { params: P; payload: CompiledEffect[] } =>
    ({ params: { win, ...extra }, payload });
  switch (fx.name) {
    case "doom":
      // "N回合后若对方没有将自己击败则对方死亡"——到期窗对对手点直损（expiry=仅在剩余1回合的窗口结算）
      return base(WIN.expiry, [{ op: "hp_delta", target: "opponent", kill: true, kind: "true", cause: "doom" } as unknown as CompiledEffect], { expiry: 1, foeAlive: 1 });
    case "dot_field":
      return base(WIN.dot, [{ op: "hp_delta", target: "self", flatImmune: "ignore", ...dmgAmt(p) } as unknown as CompiledEffect]);
    case "hot":
      return base(WIN.hot, hotPayload(p));
    case "drain_dot":
      return base(WIN.drainDot, [{
        op: "hp_delta", target: "opponent", ...dmgAmt(p), healSelf: { numerator: 1, denominator: 1, of: "dealt" },
        ...(p.kiiFlat !== undefined ? { flatImmuneConvert: { flat: p.kiiFlat } } : {}),
        ...(p.benchHealFlat !== undefined ? { benchHeal: { flat: p.benchHealFlat, requireSelfFull: p.benchHealHpFull === 1 } } : {}),
      } as unknown as CompiledEffect], { foeAlive: 1 });
    case "foe_dot":
      // 挂自身→扣持有者的对手；挂对手（"对手减少N/M体力"挂载在对手身上）→扣挂载者本人
      return base(WIN.foeDot, [{
        op: "hp_delta", target: fx.target === "opponent" ? "self" : "opponent", flatImmune: "ignore", ...dmgAmt(p),
        ...(p.anyAilDegrade === 1 ? { if: { eitherAilOrDown: true } } : {}),
      } as unknown as CompiledEffect], fx.target === "opponent" ? {} : { foeAlive: 1 });
    case "pp_drain":
      return base(WIN.ppDrain, [{ op: "pp_delta", target: "opponent", scope: "all", amount: -(p.flat ?? 0), plain: true } as unknown as CompiledEffect]);
    default:
      return undefined;
  }
}
