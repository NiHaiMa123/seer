/**
 * 命中 rider 的分组。
 * 吸血和命中之后的几家各是一个 op，名字就是结算函数。
 * 固伤、倍率、威力、致命、钳制、连击各是一个 op，of 区分取法。
 * 结算仍在 damageOp 内部按原来的次序读，不走这里的处理器。
 * 骑乘留在时间线上会被打第二次。
 */
import { EngineFault } from "../types.ts";
import type { OpHandler } from "./types.ts";

export const DRAIN_RIDER_KEYS = ["drain", "drainIf", "drainMul", "drainTo", "drainFlat", "drainEcho", "drainEchoIf"] as const;

export type DrainRiderKey = (typeof DRAIN_RIDER_KEYS)[number];

/** 命中之后的 rider。一个函数一个 op，字段就是这个函数今天读的键。 */
export const ON_HIT_RIDER_FIELDS = {
  applyFlatIfFoeImmune: ["flatIfFoeImmune"],
  applySelfCostEcho: ["selfCostEcho"],
  applyRecoilFrac: ["recoilFrac"],
  applyFlatEcho: ["flatEcho"],
  applyFoeNextMaxHpAcc: ["foeNextMaxHpAcc"],
  applyShieldEcho: ["shieldEcho"],
  applyFoeShieldEcho: ["foeShieldEcho"],
  applyTrueEcho: ["trueEcho", "trueEchoIf"],
  applyHealOnHit: ["healOnHit"],
  applyFlatOnHit: ["flatOnHit"],
  applyAilmentOnHit: ["ailmentOnHit"],
  applyStageOnHit: ["stageOnHit"],
} as const;

/** 并进这一击数字的家族。一个 op 名，of 是原来的键。 */
export const OF_RIDER_FIELDS = {
  power: ["powerAdd", "powerDropPerHit", "powerMul", "powerMulPerUse", "powerMulPerUseCap", "powerPerAliveDiff", "powerPerFoeStage", "powerPerMissing", "powerPerSelfStage", "powerPerStageScale", "powerPerUse", "powerPerUseCap", "powerRange", "resetStacks", "scaleIf", "useCap"],
  formula: ["forceStab", "forceStabIf", "frac", "fracIf", "fracRange", "kindIfImmune", "noResist", "percentBase", "percentSelfStatPct", "selfHp", "selfTradeFrac", "useBestOffense", "useFoeBestOffense"],
  crit: ["crit", "critChance", "critChanceFrac", "critChanceIf", "critIf", "critInitPct", "critPerUseCap", "critPerUsePct"],
  scale: ["dmgPctPerFoeAil", "dmgPctPerFoeDownStage", "dmgPctPerSelfAilTurn", "dmgPerUsePct", "dmgPerUsePctCap", "mul", "mulChance", "mulChancePerMark", "mulChancePerUse", "mulChanceUseCap", "mulIf", "mulPerMark", "mulRange", "pctPerSelfStage"],
  flat: ["flatBonus", "flatBothStageUpCountMul", "flatChance", "flatDefStageMul", "flatFoeCurPct", "flatFoeCurPctPerUse", "flatFoeDefPct", "flatFoeDefSumPct", "flatFoeFrac", "flatFoeFracIf", "flatFoeLastDmg", "flatFoePpMissing", "flatFoeShieldPct", "flatFoeStageUpCountMul", "flatFoeStatPct", "flatHpDiffPct", "flatIf", "flatMaxHpDiffPct", "flatMul", "flatMulIf", "flatPerAilment", "flatPerDead", "flatPerFoeDead", "flatPerFoeMissing", "flatPerHpPct", "flatPerMark", "flatPerMatchedStage", "flatPerMissing", "flatPerPpZero", "flatPerRemoved", "flatPerStage", "flatPerTurn", "flatPerUse", "flatPerUseCap", "flatPowerMul", "flatPrevTakenPct", "flatPrevTurnTakenPct", "flatRange", "flatRangeIf", "flatRepIf", "flatSelfAtkPct", "flatSelfCurPct", "flatSelfDefSumPct", "flatSelfFrac", "flatSelfFracIf", "flatSelfLastDmgPct", "flatSelfLastHeal", "flatSelfLastTaken", "flatSelfOverflowPct", "flatSelfPct", "flatSelfShieldPct", "flatSelfSpdFrac", "flatSelfStatPct", "flatStackCap", "flatStageUpCountMul", "lastDmgFrac", "shieldAbsorbPct"],
  cap: ["cap", "flatIfBelow", "leaveHp", "matchSelfHp", "minDamage"],
  strike: ["consumeShield", "hits", "hitsNoDecay", "hitsPerPpGap", "hitsPerPrio", "hitsPerStage", "koIfHitsMax", "pierce", "pierceShield"],
} as const;

export type OfRiderOp = keyof typeof OF_RIDER_FIELDS;
export type OnHitRiderOp = keyof typeof ON_HIT_RIDER_FIELDS;

const ON_HIT_OPS: ReadonlySet<string> = new Set(Object.keys(ON_HIT_RIDER_FIELDS));
const OF_OPS: ReadonlySet<string> = new Set(Object.keys(OF_RIDER_FIELDS));

export const RIDER_OP_NAMES: readonly string[] = [
  "applyDrainRider",
  ...Object.keys(ON_HIT_RIDER_FIELDS),
  ...Object.keys(OF_RIDER_FIELDS),
];

const RIDER_OPS: ReadonlySet<string> = new Set(RIDER_OP_NAMES);

const ofAllowed = new Map<string, ReadonlySet<string>>(
  Object.entries(OF_RIDER_FIELDS).map(([op, keys]) => [op, new Set(keys)]),
);

const drainByHost = new WeakMap<object, Record<string, unknown>>();

export function drainSliceOf(fx: object): Record<string, unknown> {
  return drainByHost.get(fx) ?? {};
}

/** 分组后的全部家族键，键名仍是原来的名字。命中程序从这里读，不从 damage 上读。 */
export function hitFieldsOf(fx: object): Record<string, unknown> {
  return drainByHost.get(fx) ?? {};
}

/** 效果对象被摊开复制后，骑乘片段跟着新对象走。 */
export function carryDrainSlice(from: object, to: object): void {
  if (from === to) return;
  const slice = drainByHost.get(from);
  if (slice !== undefined) drainByHost.set(to, slice);
}

export function ungroupedRiderOp(op: string): OpHandler {
  return () => {
    throw new EngineFault("RIDER_UNGROUPED", `${op} 留在时间线上：分组器应已把它收进前一条 damage`);
  };
}

const NESTS = ["payload", "ops", "elseOps"] as const;

const absorb = (bag: Record<string, unknown>, rec: Record<string, unknown>): string | undefined => {
  const op = rec.op;
  if (typeof op !== "string") return undefined;
  if (op === "applyDrainRider") {
    for (const key of DRAIN_RIDER_KEYS) {
      if (rec[key] !== undefined) bag[key] = rec[key];
    }
    return undefined;
  }
  if (ON_HIT_OPS.has(op)) {
    const fields = ON_HIT_RIDER_FIELDS[op as OnHitRiderOp];
    for (const key of fields) {
      if (rec[key] !== undefined) bag[key] = rec[key];
    }
    return undefined;
  }
  const allowed = ofAllowed.get(op);
  if (allowed === undefined) return undefined;
  const of = rec.of;
  if (typeof of !== "string" || !allowed.has(of)) return `${op} 的 of "${String(of)}" 不是这个家族的键`;
  if (rec.value === undefined) return `${op} 的 of "${of}" 没有 value`;
  bag[of] = rec.value;
  return undefined;
};

/**
 * 把紧跟在 damage 后面的命中 rider 收进那一条，并从列表里摘掉。
 * 单独一条、或中间隔了别的 op，返回原因。嵌套的 payload / ops 同样走这套。
 */
export function groupHitRiders(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    for (const nest of NESTS) {
      const err = groupHitRiders(rec[nest]);
      if (err !== undefined) return err;
    }
  }
  let host: object | undefined;
  const drop: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item === null || typeof item !== "object") {
      host = undefined;
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (rec.op === "damage") {
      host = item;
      continue;
    }
    if (typeof rec.op !== "string" || !RIDER_OPS.has(rec.op)) {
      host = undefined;
      continue;
    }
    if (host === undefined) return `${rec.op} 没有紧跟在 damage 后面`;
    const prev = drainByHost.get(host) ?? {};
    const err = absorb(prev, rec);
    if (err !== undefined) return err;
    drainByHost.set(host, prev);
    drop.push(i);
  }
  for (let i = drop.length - 1; i >= 0; i--) list.splice(drop[i]!, 1);
  return undefined;
}

export const ungroupedDrainOp: OpHandler = ungroupedRiderOp("applyDrainRider");
