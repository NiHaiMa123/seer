/**
 * 命中程序。这里是唯一还按旧键名从 DamageFx 上取值的地方。
 * riders 的顺序是这些键在今天源码里被读到的次序：damage.ts 的调用点从上到下，函数体内从上到下。
 * 同一个 at 里反复读到的同一个键只收一次。跨 at 的不并（flatRange 占位和累加、hits 的次数/必杀/成长）。
 * hitsNoDecay 没人读，不进程序。执行仍走原来的调用点，不按 riders 下标重放。
 * 家族键不在 DamageFx 上：分组器收进 rider 之后，从那条片段按原来的次序补进 riders。
 */
import type { CompiledEffect, DamageKind, HitFields, OpTarget } from "../loader.ts";
import { DRAIN_RIDER_KEYS, drainSliceOf, hitFieldsOf, type DrainRiderKey } from "./hit-rider.ts";

export type DamageFx = Extract<CompiledEffect, { op: "damage" }>;

/** 源码读取顺序。改结算顺序时先改调用点，再改这张表。 */
export const HIT_READ_ORDER = [
  { at: "formula.trade", key: "selfTradeFrac" },
  { at: "power.base", key: "powerRange" },
  { at: "power.base", key: "powerPerSelfStage" },
  { at: "power.base", key: "powerPerFoeStage" },
  { at: "power.base", key: "powerPerStageScale" },
  { at: "power.base", key: "scaleIf" },
  { at: "power.base", key: "powerMul" },
  { at: "power.rest", key: "powerAdd" },
  { at: "power.rest", key: "resetStacks" },
  { at: "power.rest", key: "powerPerMissing" },
  { at: "power.rest", key: "powerPerUse" },
  { at: "power.rest", key: "powerPerUseCap" },
  { at: "power.rest", key: "useCap" },
  { at: "power.rest", key: "powerPerAliveDiff" },
  { at: "power.rest", key: "powerMulPerUse" },
  { at: "power.rest", key: "powerMulPerUseCap" },
  { at: "formula.resist", key: "noResist" },
  { at: "formula.resist", key: "forceStab" },
  { at: "formula.resist", key: "forceStabIf" },
  { at: "strike.count", key: "hits" },
  { at: "strike.count", key: "hitsPerStage" },
  { at: "strike.count", key: "hitsPerPpGap" },
  { at: "strike.count", key: "hitsPerPrio" },
  { at: "formula.fixed", key: "selfHp" },
  { at: "flat.hidesPower", key: "flatRange" },
  { at: "formula.percent", key: "percentSelfStatPct" },
  { at: "formula.percent", key: "percentBase" },
  { at: "formula.percent", key: "fracRange" },
  { at: "formula.percent", key: "fracIf" },
  { at: "formula.percent", key: "frac" },
  { at: "formula.offense", key: "useBestOffense" },
  { at: "formula.offense", key: "useFoeBestOffense" },
  { at: "formula.immune", key: "kindIfImmune" },
  { at: "strike.pierce", key: "pierce" },
  { at: "onHit.immune", key: "flatIfFoeImmune" },
  { at: "crit", key: "crit" },
  { at: "crit", key: "critIf" },
  { at: "crit", key: "critChance" },
  { at: "crit", key: "critChanceIf" },
  { at: "crit", key: "critInitPct" },
  { at: "crit", key: "critPerUsePct" },
  { at: "crit", key: "critPerUseCap" },
  { at: "crit", key: "critChanceFrac" },
  { at: "power.drop", key: "powerDropPerHit" },
  { at: "scale.mul", key: "mulIf" },
  { at: "scale.mul", key: "mul" },
  { at: "scale.mul", key: "mulPerMark" },
  { at: "scale.mul", key: "mulChance" },
  { at: "scale.mul", key: "mulChancePerUse" },
  { at: "scale.mul", key: "mulChancePerMark" },
  { at: "scale.mul", key: "mulChanceUseCap" },
  { at: "scale.range", key: "mulRange" },
  { at: "scale.stage", key: "pctPerSelfStage" },
  { at: "flat.head", key: "flatBonus" },
  { at: "flat.head", key: "flatStackCap" },
  { at: "flat.head", key: "flatChance" },
  { at: "flat.head", key: "flatRange" },
  { at: "flat.head", key: "flatRangeIf" },
  { at: "flat.head", key: "flatSelfPct" },
  { at: "flat.head", key: "flatFoeDefPct" },
  { at: "flat.head", key: "flatSelfDefSumPct" },
  { at: "flat.head", key: "flatSelfCurPct" },
  { at: "flat.head", key: "flatSelfOverflowPct" },
  { at: "flat.head", key: "flatSelfFrac" },
  { at: "flat.head", key: "flatFoeFrac" },
  { at: "flat.head", key: "flatFoeCurPctPerUse" },
  { at: "flat.head", key: "lastDmgFrac" },
  { at: "flat.head", key: "flatFoeFracIf" },
  { at: "flat.head", key: "flatSelfFracIf" },
  { at: "flat.head", key: "flatPerMissing" },
  { at: "flat.head", key: "flatIf" },
  { at: "flat.head", key: "flatPerMark" },
  { at: "flat.head", key: "flatPerRemoved" },
  { at: "flat.head", key: "flatMulIf" },
  { at: "flat.head", key: "flatMul" },
  { at: "strike.consume", key: "consumeShield" },
  { at: "flat.tail", key: "flatPerUse" },
  { at: "flat.tail", key: "flatPerUseCap" },
  { at: "flat.tail", key: "flatPerStage" },
  { at: "flat.tail", key: "flatPerHpPct" },
  { at: "flat.tail", key: "flatPerAilment" },
  { at: "flat.tail", key: "flatSelfAtkPct" },
  { at: "flat.tail", key: "flatSelfSpdFrac" },
  { at: "flat.tail", key: "flatFoeShieldPct" },
  { at: "flat.tail", key: "flatFoeDefSumPct" },
  { at: "flat.tail", key: "flatSelfShieldPct" },
  { at: "flat.tail", key: "flatHpDiffPct" },
  { at: "flat.tail", key: "flatMaxHpDiffPct" },
  { at: "flat.tail", key: "flatFoeLastDmg" },
  { at: "flat.tail", key: "flatSelfLastTaken" },
  { at: "flat.tail", key: "flatPerDead" },
  { at: "flat.tail", key: "shieldAbsorbPct" },
  { at: "flat.tail", key: "flatPerPpZero" },
  { at: "flat.tail", key: "flatSelfLastHeal" },
  { at: "flat.tail", key: "flatSelfLastDmgPct" },
  { at: "flat.tail", key: "flatPrevTakenPct" },
  { at: "flat.tail", key: "flatFoeCurPct" },
  { at: "flat.tail", key: "flatPrevTurnTakenPct" },
  { at: "flat.tail", key: "flatPowerMul" },
  { at: "flat.tail", key: "flatDefStageMul" },
  { at: "flat.tail", key: "flatStageUpCountMul" },
  { at: "flat.tail", key: "flatFoeStageUpCountMul" },
  { at: "flat.tail", key: "flatBothStageUpCountMul" },
  { at: "flat.tail", key: "flatSelfStatPct" },
  { at: "flat.tail", key: "flatFoeStatPct" },
  { at: "flat.tail", key: "flatPerFoeMissing" },
  { at: "flat.tail", key: "flatPerMatchedStage" },
  { at: "flat.tail", key: "flatFoePpMissing" },
  { at: "flat.tail", key: "flatPerTurn" },
  { at: "flat.tail", key: "flatPerFoeDead" },
  { at: "flat.tail", key: "flatRepIf" },
  { at: "scale.late", key: "dmgPerUsePct" },
  { at: "scale.late", key: "dmgPerUsePctCap" },
  { at: "scale.late", key: "dmgPctPerSelfAilTurn" },
  { at: "scale.late", key: "dmgPctPerFoeAil" },
  { at: "scale.late", key: "dmgPctPerFoeDownStage" },
  { at: "cap.match", key: "matchSelfHp" },
  { at: "strike.shield", key: "pierceShield" },
  { at: "cap.floor", key: "minDamage" },
  { at: "cap.floor", key: "leaveHp" },
  { at: "cap.cap", key: "cap" },
  { at: "cap.cap", key: "flatIfBelow" },
  { at: "onHit.selfCost", key: "selfCostEcho" },
  { at: "strike.ko", key: "koIfHitsMax" },
  { at: "strike.ko", key: "hits" },
  { at: "onHit.recoil", key: "recoilFrac" },
  { at: "onHit.flatEcho", key: "flatEcho" },
  { at: "onHit.nextMax", key: "foeNextMaxHpAcc" },
  { at: "onHit.shield", key: "shieldEcho" },
  { at: "onHit.foeShield", key: "foeShieldEcho" },
  { at: "onHit.trueEcho", key: "trueEcho" },
  { at: "onHit.trueEcho", key: "trueEchoIf" },
  { at: "onHit.heal", key: "healOnHit" },
  { at: "onHit.flatOnHit", key: "flatOnHit" },
  { at: "onHit.ailment", key: "ailmentOnHit" },
  { at: "onHit.stage", key: "stageOnHit" },
  { at: "strike.grow", key: "hits" },
] as const satisfies readonly { readonly at: string; readonly key: keyof HitFields }[];

type OrderEntry = (typeof HIT_READ_ORDER)[number];
export type HitAt = OrderEntry["at"];
type KeyAt<A extends HitAt> = Extract<OrderEntry, { at: A }>["key"];
export type SliceOf<A extends HitAt> = Pick<HitFields, KeyAt<A>>;

export type PowerSlice = SliceOf<"power.base"> & SliceOf<"power.rest"> & SliceOf<"power.drop">;
export type FormulaSlice = SliceOf<"formula.trade"> & SliceOf<"formula.resist"> & SliceOf<"formula.fixed"> & SliceOf<"formula.percent"> & SliceOf<"formula.offense"> & SliceOf<"formula.immune">;
export type CritSlice = SliceOf<"crit">;
export type ScaleSlice = SliceOf<"scale.mul"> & SliceOf<"scale.range"> & SliceOf<"scale.stage"> & SliceOf<"scale.late">;
export type FlatSlice = SliceOf<"flat.hidesPower"> & SliceOf<"flat.head"> & SliceOf<"flat.tail">;
export type CapSlice = SliceOf<"cap.match"> & SliceOf<"cap.floor"> & SliceOf<"cap.cap">;
export type DrainSlice = Omit<Extract<CompiledEffect, { op: "applyDrainRider" }>, "op">;
export type OnHitSlice = SliceOf<"onHit.immune"> & SliceOf<"onHit.selfCost"> & SliceOf<"onHit.recoil"> & SliceOf<"onHit.flatEcho"> & SliceOf<"onHit.nextMax"> & SliceOf<"onHit.shield"> & SliceOf<"onHit.foeShield"> & SliceOf<"onHit.trueEcho"> & SliceOf<"onHit.heal"> & SliceOf<"onHit.flatOnHit"> & SliceOf<"onHit.ailment"> & SliceOf<"onHit.stage">;
export type StrikeSlice = SliceOf<"strike.count"> & SliceOf<"strike.pierce"> & SliceOf<"strike.consume"> & SliceOf<"strike.shield"> & SliceOf<"strike.ko"> & SliceOf<"strike.grow">;

export interface HitRider {
  at: HitAt | "drain";
  key: OrderEntry["key"] | DrainRiderKey;
  value: unknown;
}

export interface HitProgram {
  power: number;
  kind: DamageKind;
  target?: OpTarget;
  riders: readonly HitRider[];
  by: {
    power: PowerSlice;
    formula: FormulaSlice;
    crit: CritSlice;
    scale: ScaleSlice;
    flat: FlatSlice;
    cap: CapSlice;
    drain: DrainSlice;
    onHit: OnHitSlice;
    strike: StrikeSlice;
  };
}

const merge = (bags: ReadonlyMap<HitAt, Partial<HitFields>>, ats: readonly HitAt[]): Partial<HitFields> => {
  const out: Partial<HitFields> = {};
  for (const at of ats) {
    const bag = bags.get(at);
    if (bag !== undefined) Object.assign(out, bag);
  }
  return out;
};

/** 把一条 damage 收成程序。缺省 kind 仍是 standard。没写上的键不进 riders。家族键只从分组片段读。 */
export function compileHit(fx: DamageFx): HitProgram {
  const riders: HitRider[] = [];
  const bags = new Map<HitAt, Partial<HitFields>>();
  const fields = hitFieldsOf(fx) as Partial<HitFields>;
  const drain = drainSliceOf(fx) as DrainSlice;
  let drainPlaced = false;
  // 插在反噬之后、等量固伤之前，跟搬骑乘之前的读取次序一样。
  const placeDrain = (): void => {
    if (drainPlaced) return;
    drainPlaced = true;
    for (const key of DRAIN_RIDER_KEYS) {
      const value = drain[key];
      if (value === undefined) continue;
      riders.push({ at: "drain", key, value });
    }
  };
  for (const entry of HIT_READ_ORDER) {
    if (entry.at === "onHit.flatEcho") placeDrain();
    const value = fields[entry.key];
    if (value === undefined) continue;
    riders.push({ at: entry.at, key: entry.key, value });
    const bag: Partial<HitFields> = bags.get(entry.at) ?? {};
    (bag as Record<string, unknown>)[entry.key] = value;
    bags.set(entry.at, bag);
  }
  placeDrain();
  const program: HitProgram = {
    power: fx.power,
    kind: fx.kind ?? "standard",
    riders,
    by: {
      power: merge(bags, ["power.base", "power.rest", "power.drop"]) as PowerSlice,
      formula: merge(bags, ["formula.trade", "formula.resist", "formula.fixed", "formula.percent", "formula.offense", "formula.immune"]) as FormulaSlice,
      crit: merge(bags, ["crit"]) as CritSlice,
      scale: merge(bags, ["scale.mul", "scale.range", "scale.stage", "scale.late"]) as ScaleSlice,
      flat: merge(bags, ["flat.hidesPower", "flat.head", "flat.tail"]) as FlatSlice,
      cap: merge(bags, ["cap.match", "cap.floor", "cap.cap"]) as CapSlice,
      drain,
      onHit: merge(bags, ["onHit.immune", "onHit.selfCost", "onHit.recoil", "onHit.flatEcho", "onHit.nextMax", "onHit.shield", "onHit.foeShield", "onHit.trueEcho", "onHit.heal", "onHit.flatOnHit", "onHit.ailment", "onHit.stage"]) as OnHitSlice,
      strike: merge(bags, ["strike.count", "strike.pierce", "strike.consume", "strike.shield", "strike.ko", "strike.grow"]) as StrikeSlice,
    },
  };
  if (fx.target !== undefined) program.target = fx.target;
  return program;
}
