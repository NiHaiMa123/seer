/**
 * 伤害家族的读取。一个家族一个函数，函数体从 damage.ts 剪下来，分支和取整不动。
 * at 只标原来的源码位置：这些键中间夹着别的结算，不能并成一次调用。
 * 入参是命中程序切出来的片段，不再接收 DamageFx。
 */
import type { DamageKind } from "../loader.ts";
import type { UnitState } from "../mechanics/types.ts";
import { OTHER, type SideId } from "../types.ts";
import { condEval } from "./cond.ts";
import type { CapSlice, CritSlice, FlatSlice, FormulaSlice, PowerSlice, ScaleSlice, StrikeSlice } from "./damage-program.ts";
import { dmgImmuneOn, effectDefOf, flatImmuneOn, hpCapOf, isMod, prioAddOf, shieldFlatOf } from "./effects.ts";
import { markCount } from "./mark.ts";
import type { OpCtx } from "./types.ts";

/** 公式前的威力。base 在状态威力窗之前，rest 在它之后，drop 在每击 calc 时。 */
export function applyPower(ctx: OpCtx, fx: PowerSlice, at: "base", hit: UnitState, power: number): number;
export function applyPower(ctx: OpCtx, fx: PowerSlice, at: "rest", hit: UnitState, power: number): { power: number; useStacks: number };
export function applyPower(ctx: OpCtx, fx: PowerSlice, at: "drop", power: number, hitIndex: number): number;
export function applyPower(
  ctx: OpCtx,
  fx: PowerSlice,
  at: "base" | "rest" | "drop",
  hitOrPower: UnitState | number,
  powerOrIndex?: number,
): number | { power: number; useStacks: number } {
  if (at === "drop") {
    const power = typeof hitOrPower === "number" ? hitOrPower : 0;
    const i = powerOrIndex ?? 0;
    return fx.powerDropPerHit !== undefined ? Math.max(0, power - fx.powerDropPerHit * i) : power;
  }
  const { rng, unit, move } = ctx;
  const hit = hitOrPower as UnitState;
  if (at === "base") {
    let powerBase = fx.powerRange !== undefined
      ? fx.powerRange.min + rng.drawBelow(fx.powerRange.max - fx.powerRange.min + 1, "power_range")
      : (powerOrIndex ?? 0);
    if (fx.powerPerSelfStage !== undefined) {
      powerBase += fx.powerPerSelfStage * Object.values(unit.stages).filter((v) => v > 0).length;
    }
    if (fx.powerPerFoeStage !== undefined) {
      powerBase += fx.powerPerFoeStage * Object.values(hit.stages).filter((v) => v > 0).length;
    }
    if (fx.powerPerStageScale !== undefined) {
      const s = fx.powerPerStageScale;
      const pool = s.who === "self" ? unit.stages : hit.stages;
      const vals = Object.values(pool).filter((v) => (s.sign ?? "up") === "up" ? v > 0 : v < 0);
      const units = s.mode === "levels" ? vals.reduce((a, v) => a + Math.abs(v), 0) : vals.length;
      const steps = Math.floor(units / Math.max(1, s.per));
      if (s.kind === "pct") powerBase = Math.floor((powerBase * (100 + steps * s.add)) / 100);
      else powerBase += steps * s.add;
    }
    let power = fx.scaleIf !== undefined && condEval(ctx, fx.scaleIf.when)
      ? Math.floor((powerBase * fx.scaleIf.numerator) / fx.scaleIf.denominator)
      : powerBase;
    if (fx.powerMul !== undefined) power = Math.floor((power * fx.powerMul.numerator) / fx.powerMul.denominator);
    return power;
  }
  let power = powerOrIndex ?? 0;
  if (fx.powerAdd !== undefined) power += fx.powerAdd;
  const useStacks = Math.max(0, (unit.moveStacks?.[move.id] ?? 0) - 1);
  if (fx.resetStacks === true && unit.moveStacks !== undefined) unit.moveStacks = { [move.id]: 0 };
  if (fx.powerPerMissing !== undefined && unit.currentHp < unit.base.hp) {
    power += Math.floor(((unit.base.hp - unit.currentHp) * 100) / unit.base.hp / fx.powerPerMissing.per) * fx.powerPerMissing.pow;
  }
  if (useStacks > 0 && fx.powerPerUse !== undefined) {
    const addRaw = fx.powerPerUse * useStacks;
    power += fx.powerPerUseCap !== undefined ? Math.min(addRaw, fx.powerPerUseCap) : addRaw;
    if (fx.useCap !== undefined && power > fx.useCap) power = fx.useCap;
  }
  if (fx.powerPerAliveDiff !== undefined) {
    const selfAlive = (ctx.next.sides[ctx.side].bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true).length + (unit.currentHp > 0 ? 1 : 0);
    const foeAlive = (ctx.next.sides[ctx.targetSide].bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true).length + (ctx.foe !== undefined && ctx.foe.currentHp > 0 ? 1 : 0);
    const diff = Math.max(0, foeAlive - selfAlive);
    power += fx.powerPerAliveDiff.add * Math.floor(diff / Math.max(1, fx.powerPerAliveDiff.per));
    if (fx.useCap !== undefined && power > fx.useCap) power = fx.useCap;
  }
  if (useStacks > 0 && fx.powerMulPerUse !== undefined) {
    let mul = Math.pow(fx.powerMulPerUse.numerator, useStacks) / Math.pow(fx.powerMulPerUse.denominator, useStacks);
    if (fx.powerMulPerUseCap !== undefined) mul = Math.min(mul, fx.powerMulPerUseCap.numerator / fx.powerMulPerUseCap.denominator);
    power = Math.floor(power * mul);
    if (fx.useCap !== undefined && power > fx.useCap) power = fx.useCap;
  }
  return { power, useStacks };
}

export interface FormulaResist {
  eff16: number;
  stab: boolean;
}

export interface FormulaImmune {
  kindEff: DamageKind;
  override: number | undefined;
}

/** 攻防取值、克制、本系，以及固定/百分比这一击的数字。flatRange 不在这里读。 */
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "trade", hit: UnitState, hitSide: SideId, selfHit: boolean): boolean;
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "resist", eff16: number, typeStab: boolean): FormulaResist;
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "immune", kind: DamageKind, selfHit: boolean, hit: UnitState): FormulaImmune;
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "fixed", currentHp: number, power: number): number;
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "percent", hit: UnitState, pow: number): number;
export function applyFormula(ctx: OpCtx, fx: FormulaSlice, at: "offense", atk: number, spa: number | undefined, foeAtk: number, foeSpa: number | undefined): number;
export function applyFormula(
  ctx: OpCtx,
  fx: FormulaSlice,
  at: "trade" | "resist" | "immune" | "fixed" | "percent" | "offense",
  a: UnitState | number | string | boolean,
  b?: number | boolean | SideId | UnitState,
  c?: boolean | number | UnitState | undefined,
  d?: number | undefined,
): boolean | FormulaResist | FormulaImmune | number {
  if (at === "trade") {
    const hit = a as UnitState;
    const hitSide = b as SideId;
    const selfHit = c as boolean;
    const { events, side, unit } = ctx;
    if (fx.selfTradeFrac !== undefined) {
      const loss = Math.floor((unit.currentHp * fx.selfTradeFrac.n) / fx.selfTradeFrac.d);
      unit.currentHp = Math.max(0, unit.currentHp - loss);
      events.push({ type: "damage", detail: { side, amount: loss, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "percent", cause: "self-cost" } });
      if (!selfHit && loss > 0) {
        hit.currentHp = Math.max(0, hit.currentHp - loss);
        events.push({ type: "damage", detail: { side: hitSide, amount: loss, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "fixed", cause: "self-trade" } });
      }
      return true;
    }
    return false;
  }
  if (at === "resist") {
    let eff16 = a as number;
    const typeStab = b as boolean;
    // noResist 是同一个 formula 键的两种写法：true = 抬到 1.0（16）；数字 = 句里写明的倍数
    // （×16 定点，1.25→20），抬到该倍数。两边都是「至少为」——只抬不压，不比当前克制小就原样。
    if (fx.noResist !== undefined) {
      const minEff = typeof fx.noResist === "number" ? fx.noResist : 16;
      if (eff16 < minEff) eff16 = minEff;
    }
    // eff_max（w09）：行动方身上记着「自身→对手」与「对手→自身」两侧克制（×16 定点）的较大值。
    // 它是这一击的克制读法，不是常驻下限：比当前 eff16 大时抬上来，用掉即清（不跨击、不跨回合留存）。
    const floor = ctx.unit.effFloor;
    if (floor !== undefined) {
      if (floor > eff16) eff16 = floor;
      delete ctx.unit.effFloor;
    }
    const stab = typeStab || fx.forceStab === true || (fx.forceStabIf !== undefined && condEval(ctx, fx.forceStabIf.when));
    return { eff16, stab };
  }
  if (at === "immune") {
    const kind = a as DamageKind;
    const selfHit = b as boolean;
    const hit = c as UnitState;
    let kindEff: DamageKind = kind;
    let override: number | undefined;
    if (!selfHit && (kind === "fixed" || kind === "percent")) {
      const kii = fx.kindIfImmune;
      const flatImm = flatImmuneOn(hit);
      const conv = kii === "true"
        ? kind === "fixed" && (dmgImmuneOn(hit) || flatImm)
        : kii !== undefined && kii.from === kind && flatImm;
      if (conv) { kindEff = "true"; override = typeof kii === "object" ? kii.flat : undefined; }
    }
    return { kindEff, override };
  }
  if (at === "fixed") {
    const currentHp = a as number;
    const power = b as number;
    return fx.selfHp === true ? currentHp : power;
  }
  if (at === "percent") {
    const hit = a as UnitState;
    const pow = b as number;
    const { rng, unit } = ctx;
    if (fx.percentSelfStatPct !== undefined) {
      const stats = fx.percentSelfStatPct.stats ?? [fx.percentSelfStatPct.stat ?? "spd"];
      const base = stats.reduce((acc, st) => acc + (st === "hp" ? unit.base.hp : (unit.base as Record<string, number>)[st] ?? 0), 0);
      return Math.floor((base * fx.percentSelfStatPct.pct) / 100);
    }
    const hpBase = fx.percentBase === "selfCur" ? unit.currentHp : fx.percentBase === "selfMax" ? unit.base.hp : fx.percentBase === "foeMissing" ? Math.max(0, hit.base.hp - hit.currentHp) : fx.percentBase === "current" ? hit.currentHp : hit.base.hp;
    if (fx.fracRange !== undefined) {
      const lo = Math.floor((100 * fx.fracRange.min.numerator) / fx.fracRange.min.denominator);
      const hi = Math.ceil((100 * fx.fracRange.max.numerator) / fx.fracRange.max.denominator);
      return Math.floor((hpBase * (lo + rng.drawBelow(Math.max(1, hi - lo + 1), "frac_range"))) / 100);
    }
    const fracEff = fx.fracIf !== undefined && condEval(ctx, fx.fracIf.when) ? fx.fracIf : fx.frac;
    return fracEff !== undefined
      ? Math.floor((hpBase * fracEff.numerator) / fracEff.denominator)
      : Math.floor((pow * hpBase) / 100);
  }
  const atk = a as number;
  const spa = b as number | undefined;
  const foeAtk = c as number;
  const foeSpa = d;
  if (fx.useBestOffense === true) return Math.max(atk, spa ?? atk);
  if (fx.useFoeBestOffense === true) return Math.max(foeAtk, foeSpa ?? foeAtk);
  return atk;
}

/** 是否致命。critAlways 窗夹在 critIf 和 critChance 之间，跟着这段一起走，否则抽随机的次序会变。 */
export function applyCrit(ctx: OpCtx, fx: CritSlice, useStacks: number): boolean {
  const { events, side, unit, rng } = ctx;
  let crit = fx.crit === true || (fx.critIf !== undefined && condEval(ctx, fx.critIf.when));
  if (!crit) {
    const critEntry = unit.effects.find((e) => isMod(e, "critAlways"));
    if (critEntry !== undefined) {
      crit = true;
      if (critEntry.params?.count !== undefined) {
        critEntry.params.count -= 1;
        if (critEntry.params.count <= 0) {
          unit.effects = unit.effects.filter((e) => e !== critEntry);
          events.push({ type: "effect-faded", detail: { side, name: critEntry.label ?? critEntry.kind } });
        }
      }
    }
  }
  if (!crit && fx.critChance !== undefined && rng.drawBelow(100, "crit_chance") < fx.critChance) crit = true;
  if (!crit && fx.critChanceIf !== undefined && condEval(ctx, fx.critChanceIf.when) && rng.drawBelow(100, "crit_chance") < fx.critChanceIf.chance) crit = true;
  const critStackPct = (fx.critInitPct ?? 0) + (fx.critPerUsePct !== undefined && useStacks > 0 ? fx.critPerUsePct * useStacks : 0);
  if (!crit && critStackPct > 0 && rng.drawBelow(100, "crit_chance") < Math.min(fx.critPerUseCap ?? 100, critStackPct)) crit = true;
  if (!crit && fx.critChanceFrac !== undefined && rng.drawBelow(fx.critChanceFrac.denominator, "crit_chance") < fx.critChanceFrac.numerator) crit = true;
  return crit;
}

/** 威力之后的伤害倍率。mul 在固伤之前，range / stage 夹在别的倍率里，late 在固伤累加之后、并入之前。 */
export function applyScale(ctx: OpCtx, fx: ScaleSlice, at: "mul" | "range" | "stage" | "late", dmg: number, useStacks: number, selfHit: boolean, hit: UnitState): number {
  const { rng, unit } = ctx;
  if (at === "mul") {
    if (fx.mulIf !== undefined && condEval(ctx, fx.mulIf.when)) dmg = Math.floor((dmg * fx.mulIf.numerator) / fx.mulIf.denominator);
    if (fx.mul !== undefined) dmg = Math.floor((dmg * fx.mul.numerator) / fx.mul.denominator);
    if (fx.mulPerMark !== undefined) {
      const mn = markCount(ctx, fx.mulPerMark);
      if (mn > 0) dmg = Math.floor((dmg * (100 + fx.mulPerMark.add * mn)) / 100);
    }
    if (fx.mulChance !== undefined) {
      const mch0 = fx.mulChance.chance + (fx.mulChancePerUse !== undefined ? fx.mulChancePerUse * useStacks : 0) + (fx.mulChancePerMark !== undefined ? fx.mulChancePerMark.add * markCount(ctx, fx.mulChancePerMark) : 0);
      const mch1 = fx.mulChance.chanceMulIf !== undefined && condEval(ctx, fx.mulChance.chanceMulIf.when)
        ? Math.floor((mch0 * fx.mulChance.chanceMulIf.numerator) / fx.mulChance.chanceMulIf.denominator)
        : mch0;
      const mch = Math.min(fx.mulChanceUseCap ?? 100, mch1);
      if (rng.drawBelow(100, "mul_chance") < Math.min(100, mch)) {
        dmg = Math.floor((dmg * fx.mulChance.numerator) / fx.mulChance.denominator);
      }
    }
    return dmg;
  }
  if (at === "range") {
    const randPct = fx.mulRange !== undefined ? fx.mulRange.min + rng.drawBelow(fx.mulRange.max - fx.mulRange.min + 1, "mul_range") : undefined;
    if (randPct !== undefined && dmg > 0) dmg = Math.floor((dmg * (100 + randPct)) / 100);
    return dmg;
  }
  if (at === "stage") {
    if (fx.pctPerSelfStage !== undefined && dmg > 0) {
      const nUp = Object.values(unit.stages).filter((v) => v > 0).length;
      if (nUp > 0) dmg = Math.floor((dmg * (100 + fx.pctPerSelfStage * nUp)) / 100);
    }
    return dmg;
  }
  if (useStacks > 0 && fx.dmgPerUsePct !== undefined) {
    const pct = fx.dmgPerUsePctCap !== undefined ? Math.min(fx.dmgPerUsePct * useStacks, fx.dmgPerUsePctCap) : fx.dmgPerUsePct * useStacks;
    dmg = Math.floor((dmg * (100 + pct)) / 100);
  }
  if (fx.dmgPctPerSelfAilTurn !== undefined) {
    const turns = unit.effects.reduce((acc, e) => acc + (effectDefOf(e.kind)?.ailment === true ? (e.remainingTurns ?? 0) : 0), 0);
    if (turns > 0) dmg = Math.floor((dmg * (100 + Math.min(fx.dmgPctPerSelfAilTurn.cap ?? 100, turns * fx.dmgPctPerSelfAilTurn.pct))) / 100);
  }
  if (fx.dmgPctPerFoeAil !== undefined && !selfHit) {
    const ailN = hit.effects.filter((e) => effectDefOf(e.kind)?.ailment === true).length;
    if (ailN > 0) dmg = Math.floor((dmg * (100 + Math.min(fx.dmgPctPerFoeAil.cap ?? 500, ailN * fx.dmgPctPerFoeAil.pct))) / 100);
  }
  if (fx.dmgPctPerFoeDownStage !== undefined && !selfHit) {
    const downSum = Object.values(hit.stages).filter((v) => v < 0).reduce((s, v) => s + Math.abs(v), 0);
    if (downSum > 0) dmg = Math.floor((dmg * (100 + downSum * fx.dmgPctPerFoeDownStage.pct)) / 100);
  }
  return dmg;
}

/** 并入这一击的固伤。hidesPower 只看 flatRange 在不在（固定伤害公式里 power 是占位）。head 在耗盾之前，tail 在计时固伤窗之后。 */
export function applyFlat(ctx: OpCtx, fx: FlatSlice, at: "hidesPower"): boolean;
export function applyFlat(ctx: OpCtx, fx: FlatSlice, at: "head", hit: UnitState, useStacks: number): number;
export function applyFlat(ctx: OpCtx, fx: FlatSlice, at: "tail", hit: UnitState, selfHit: boolean, useStacks: number, power: number, flatIn: number): number;
export function applyFlat(
  ctx: OpCtx,
  fx: FlatSlice,
  at: "hidesPower" | "head" | "tail",
  hit?: UnitState,
  selfOrStacks?: boolean | number,
  useOrPower?: number,
  power?: number,
  flatIn?: number,
): boolean | number {
  if (at === "hidesPower") return fx.flatRange !== undefined;
  const { rng, unit, events, side } = ctx;
  if (at === "head") {
    const foe = hit as UnitState;
    const useStacks = selfOrStacks as number;
    let flat = fx.flatBonus ?? 0;
    if (flat > 0 && fx.flatStackCap !== undefined && useStacks > 0) flat = Math.min(flat * (useStacks + 1), fx.flatStackCap);
    if (flat > 0 && fx.flatChance !== undefined && rng.drawBelow(100, "flat_chance") >= fx.flatChance) flat = 0;
    if (fx.flatRange !== undefined) flat += fx.flatRange.min + rng.drawBelow(fx.flatRange.max - fx.flatRange.min + 1, "flat_range");
    if (fx.flatRangeIf !== undefined && condEval(ctx, fx.flatRangeIf.when)) flat += fx.flatRangeIf.min + rng.drawBelow(fx.flatRangeIf.max - fx.flatRangeIf.min + 1, "flat_range");
    if (fx.flatSelfPct !== undefined) flat += Math.floor((unit.base.hp * fx.flatSelfPct) / 100);
    if (fx.flatFoeDefPct !== undefined) flat += Math.floor((foe.base.def * fx.flatFoeDefPct) / 100);
    if (fx.flatSelfDefSumPct !== undefined) flat += Math.floor(((unit.base.def + (unit.base.sdf ?? 0)) * fx.flatSelfDefSumPct) / 100);
    if (fx.flatSelfCurPct !== undefined) flat += Math.floor((unit.currentHp * fx.flatSelfCurPct) / 100);
    if (fx.flatSelfOverflowPct !== undefined) flat += Math.floor(((unit.lastHealOverflow ?? 0) * fx.flatSelfOverflowPct) / 100);
    const fracBase = (u: UnitState, base?: "max" | "current" | "missing") =>
      base === "missing" ? Math.max(0, u.base.hp - u.currentHp) : base === "current" ? u.currentHp : u.base.hp;
    if (fx.flatSelfFrac !== undefined) flat += Math.floor((fracBase(unit, fx.flatSelfFrac.base) * fx.flatSelfFrac.numerator) / fx.flatSelfFrac.denominator);
    if (fx.flatFoeFrac !== undefined) flat += Math.floor((fracBase(foe, fx.flatFoeFrac.base) * fx.flatFoeFrac.numerator) / fx.flatFoeFrac.denominator);
    if (fx.flatFoeCurPctPerUse !== undefined) flat += Math.floor((foe.currentHp * Math.min(fx.flatFoeCurPctPerUse.cap ?? 100, fx.flatFoeCurPctPerUse.base + (fx.flatFoeCurPctPerUse.step ?? 0) * useStacks)) / 100);
    if (fx.lastDmgFrac !== undefined) flat += Math.floor(((ctx.lastDamage ?? 0) * fx.lastDmgFrac.numerator) / fx.lastDmgFrac.denominator);
    if (fx.flatFoeFracIf !== undefined && condEval(ctx, fx.flatFoeFracIf.when)) flat += Math.floor((fracBase(foe, fx.flatFoeFracIf.base) * fx.flatFoeFracIf.numerator) / fx.flatFoeFracIf.denominator);
    if (fx.flatSelfFracIf !== undefined && condEval(ctx, fx.flatSelfFracIf.when)) flat += Math.floor((fracBase(unit, fx.flatSelfFracIf.base) * fx.flatSelfFracIf.numerator) / fx.flatSelfFracIf.denominator);
    if (fx.flatPerMissing !== undefined) {
      const missing = unit.base.hp - unit.currentHp;
      const step = fx.flatPerMissing.pct === true ? Math.max(1, Math.floor((unit.base.hp * fx.flatPerMissing.step) / 100)) : fx.flatPerMissing.step;
      flat += Math.floor(missing / step) * fx.flatPerMissing.add;
    }
    if (fx.flatIf !== undefined && condEval(ctx, fx.flatIf.when)) {
      flat += fx.flatIf.flat ?? (fx.flatIf.range !== undefined ? fx.flatIf.range.min + rng.drawBelow(fx.flatIf.range.max - fx.flatIf.range.min + 1, "flat_range") : 0);
    }
    if (fx.flatPerMark !== undefined) flat += fx.flatPerMark.add * markCount(ctx, fx.flatPerMark);
    if (fx.flatPerRemoved !== undefined) flat += (ctx.stagesRemoved ?? 0) * fx.flatPerRemoved;
    if (fx.flatMulIf !== undefined && condEval(ctx, fx.flatMulIf.when)) {
      flat = Math.floor((flat * fx.flatMulIf.numerator) / fx.flatMulIf.denominator);
    }
    if (fx.flatMul !== undefined) flat = Math.floor((flat * fx.flatMul.numerator) / fx.flatMul.denominator);
    return flat;
  }
  const foe = hit as UnitState;
  const selfHit = selfOrStacks as boolean;
  const useStacks = useOrPower as number;
  const pow = power ?? 0;
  let flat = flatIn ?? 0;
  if (useStacks > 0 && fx.flatPerUse !== undefined) flat += fx.flatPerUseCap !== undefined ? Math.min(fx.flatPerUse * useStacks, fx.flatPerUseCap) : fx.flatPerUse * useStacks;
  if (fx.flatPerStage !== undefined) {
    const t = fx.flatPerStage.who === "self" ? unit : foe;
    const both = fx.flatPerStage.who === "both";
    const statF = fx.flatPerStage.stat;
    const vals = (statF !== undefined ? [t.stages[statF] ?? 0] : [...Object.values(t.stages), ...(both ? Object.values((t === unit ? foe : unit).stages) : [])]).filter((v) => (fx.flatPerStage!.sign === "up" ? v > 0 : v < 0));
    const cnt = fx.flatPerStage.mode === "levels" ? vals.reduce((s, v) => s + Math.abs(v), 0) : vals.length;
    const stageFlat = fx.flatPerStage.flat * Math.floor(cnt / fx.flatPerStage.per);
    flat += stageFlat;
    if (fx.flatPerStage.drain && stageFlat > 0) {
      const heal = Math.min(stageFlat, hpCapOf(unit) - unit.currentHp);
      unit.currentHp += heal;
      events.push({ type: "heal", detail: { side, amount: heal, hpAfter: { current: unit.currentHp, max: unit.base.hp } } });
    }
  }
  if (fx.flatPerHpPct !== undefined) {
    const t = fx.flatPerHpPct.who === "self" ? unit : foe;
    const hpPct = Math.floor((t.currentHp * 100) / Math.max(1, t.base.hp));
    flat += fx.flatPerHpPct.flat * Math.floor(hpPct / fx.flatPerHpPct.per);
  }
  if (fx.flatPerAilment !== undefined) {
    const ailCnt = foe.effects.filter((e) => effectDefOf(e.kind)?.ailment === true).length;
    flat += fx.flatPerAilment * ailCnt;
  }
  if (fx.flatSelfAtkPct !== undefined) flat += Math.floor((unit.base.atk * fx.flatSelfAtkPct) / 100);
  if (fx.flatSelfSpdFrac !== undefined) flat += Math.floor((unit.base.spd * fx.flatSelfSpdFrac.numerator) / fx.flatSelfSpdFrac.denominator);
  if (fx.flatFoeShieldPct !== undefined && !selfHit) flat += Math.floor((shieldFlatOf(foe) * fx.flatFoeShieldPct) / 100);
  if (fx.flatFoeDefSumPct !== undefined && !selfHit) flat += Math.floor(((foe.base.def + (foe.base.sdf ?? 0)) * fx.flatFoeDefSumPct) / 100);
  if (fx.flatSelfShieldPct !== undefined && !selfHit) flat += Math.floor((shieldFlatOf(unit) * fx.flatSelfShieldPct) / 100);
  if (fx.flatHpDiffPct !== undefined && !selfHit) flat += Math.floor((Math.abs(unit.currentHp - foe.currentHp) * fx.flatHpDiffPct) / 100);
  if (fx.flatMaxHpDiffPct !== undefined && !selfHit) flat += Math.floor((Math.abs(unit.base.hp - foe.base.hp) * fx.flatMaxHpDiffPct) / 100);
  if (fx.flatFoeLastDmg === true && !selfHit) flat += foe.lastDealt ?? 0;
  if (fx.flatSelfLastTaken === true) flat += unit.lastTaken ?? 0;
  if (fx.flatPerDead !== undefined) {
    const deadSpec = fx.flatPerDead;
    const deadOf = (sd: typeof side) => (ctx.next.sides[sd].bench ?? []).filter((u) => u.currentHp <= 0).length;
    const dead = deadSpec.who === "self" ? deadOf(side) : deadSpec.who === "foe" ? deadOf(OTHER[side]) : deadOf(side) + deadOf(OTHER[side]);
    flat += Math.floor(dead / Math.max(1, deadSpec.per)) * deadSpec.add;
  }
  if (fx.shieldAbsorbPct !== undefined && !selfHit) flat += Math.floor(((unit.shieldAbsorbed ?? 0) * fx.shieldAbsorbPct) / 100);
  if (fx.flatPerPpZero !== undefined) {
    const z = fx.flatPerPpZero;
    const cntOf = (u: UnitState) => u.moves.filter((m) => m.pp <= 0).length;
    const cnt = z.who === "self" ? cntOf(unit) : z.who === "foe" ? cntOf(foe) : cntOf(unit) + cntOf(foe);
    const zf = Math.floor(cnt / Math.max(1, z.per)) * z.add;
    flat += zf;
    if (z.drain === true && zf > 0 && unit.currentHp > 0) {
      const heal = Math.min(zf, hpCapOf(unit) - unit.currentHp);
      if (heal > 0) { unit.currentHp += heal; events.push({ type: "heal", detail: { side, amount: heal, hpAfter: { current: unit.currentHp, max: unit.base.hp } } }); }
    }
  }
  if (fx.flatSelfLastHeal === true) flat += unit.prevHeal ?? unit.lastHeal ?? 0;
  if (fx.flatSelfLastDmgPct !== undefined) flat += Math.floor(((unit.lastDealt ?? 0) * fx.flatSelfLastDmgPct) / 100);
  if (fx.flatPrevTakenPct !== undefined) flat += Math.floor(((unit.lastTaken ?? 0) * fx.flatPrevTakenPct) / 100);
  if (fx.flatFoeCurPct !== undefined && !selfHit) flat += Math.floor((foe.currentHp * fx.flatFoeCurPct) / 100);
  if (fx.flatPrevTurnTakenPct !== undefined) flat += Math.floor(((unit.prevTaken ?? 0) * fx.flatPrevTurnTakenPct) / 100);
  if (fx.flatPowerMul !== undefined) flat += pow * fx.flatPowerMul;
  if (fx.flatDefStageMul !== undefined) flat += (Math.max(0, unit.stages.def ?? 0) + Math.max(0, unit.stages.sdf ?? 0)) * fx.flatDefStageMul;
  if (fx.flatStageUpCountMul !== undefined) flat += Object.values(unit.stages).filter((v) => v > 0).length * fx.flatStageUpCountMul;
  if (fx.flatFoeStageUpCountMul !== undefined && !selfHit) flat += Object.values(foe.stages).filter((v) => v > 0).length * fx.flatFoeStageUpCountMul;
  if (fx.flatBothStageUpCountMul !== undefined && !selfHit) flat += (Object.values(unit.stages).filter((v) => v > 0).length + Object.values(foe.stages).filter((v) => v > 0).length) * fx.flatBothStageUpCountMul;
  if (fx.flatSelfStatPct !== undefined && !selfHit) {
    const stats = fx.flatSelfStatPct.stats ?? [fx.flatSelfStatPct.stat ?? "spd"];
    const base = stats.reduce((acc, st) => acc + (st === "hp" ? unit.base.hp : (unit.base as Record<string, number>)[st] ?? 0), 0);
    const pct = fx.flatSelfStatPct.pct ?? (fx.flatSelfStatPct.numerator !== undefined ? (fx.flatSelfStatPct.numerator * 100) / (fx.flatSelfStatPct.denominator ?? 1) : 0);
    flat += Math.floor((base * pct) / 100);
  }
  if (fx.flatFoeStatPct !== undefined && !selfHit) {
    const stats = fx.flatFoeStatPct.stats ?? [fx.flatFoeStatPct.stat ?? "spd"];
    const base = stats.reduce((acc, st) => acc + (st === "hp" ? foe.base.hp : (foe.base as Record<string, number>)[st] ?? 0), 0);
    flat += Math.floor((base * fx.flatFoeStatPct.pct) / 100);
  }
  if (fx.flatPerFoeMissing !== undefined && !selfHit) flat += Math.floor(Math.max(0, foe.base.hp - foe.currentHp) / Math.max(1, fx.flatPerFoeMissing.step)) * fx.flatPerFoeMissing.add;
  if (fx.flatPerMatchedStage !== undefined && !selfHit) {
    const matched = (Object.keys(unit.stages) as (keyof typeof unit.stages)[]).filter((k) => (unit.stages[k] ?? 0) !== 0 && (unit.stages[k] ?? 0) === (foe.stages[k] ?? 0)).length;
    flat += Math.floor(matched / Math.max(1, fx.flatPerMatchedStage.per)) * fx.flatPerMatchedStage.add;
  }
  if (fx.flatFoePpMissing !== undefined && !selfHit) {
    const lost = (u: UnitState) => u.moves.reduce((acc, mv) => acc + Math.max(0, mv.ppMax - mv.pp), 0);
    const sum = fx.flatFoePpMissing.who === "both" ? lost(foe) + lost(unit) : lost(foe);
    flat += sum * fx.flatFoePpMissing.mul;
  }
  if (fx.flatPerTurn !== undefined) flat += ctx.next.turn * fx.flatPerTurn.mul;
  if (fx.flatPerFoeDead !== undefined && !selfHit) {
    const dead = (ctx.next.sides[OTHER[side]].bench ?? []).filter((b) => b.currentHp <= 0).length;
    flat += Math.floor(dead / Math.max(1, fx.flatPerFoeDead.per)) * fx.flatPerFoeDead.add;
  }
  if (fx.flatRepIf !== undefined && (fx.flatRepIf.when === undefined || condEval(ctx, fx.flatRepIf.when))) flat = fx.flatRepIf.range.min + rng.drawBelow(Math.max(1, fx.flatRepIf.range.max - fx.flatRepIf.range.min + 1), "flat_rep");
  return flat;
}

/** 上限、下限、留血、把体力对齐。match 在穿透钳制之前，floor 在它之后、出伤窗之前，cap 在出伤窗之后。 */
export function applyCap(ctx: OpCtx, fx: CapSlice, at: "match" | "floor" | "cap", dmg: number, hit: UnitState, selfHit: boolean): number {
  const { unit } = ctx;
  if (at === "match") {
    if (fx.matchSelfHp === true && !selfHit) dmg = Math.max(0, hit.currentHp - unit.currentHp);
    return dmg;
  }
  if (at === "floor") {
    if (fx.minDamage !== undefined && dmg > 0 && dmg < fx.minDamage) dmg = fx.minDamage;
    if (fx.leaveHp !== undefined) dmg = Math.max(0, hit.currentHp - fx.leaveHp);
    return dmg;
  }
  if (fx.cap !== undefined && dmg > fx.cap) dmg = fx.cap;
  if (fx.flatIfBelow !== undefined && dmg > 0 && dmg < fx.flatIfBelow.min) {
    dmg += fx.flatIfBelow.selfPct !== undefined ? Math.floor((unit.base.hp * fx.flatIfBelow.selfPct) / 100) : (fx.flatIfBelow.flat ?? 0);
  }
  return dmg;
}

/** 连击、穿透、耗盾。count 在进循环之前，其余调用留在原来的那一行。 */
export function applyStrike(ctx: OpCtx, fx: StrikeSlice, at: "pierce" | "shield"): boolean;
export function applyStrike(ctx: OpCtx, fx: StrikeSlice, at: "count", useStacks: number): number;
export function applyStrike(ctx: OpCtx, fx: StrikeSlice, at: "consume", hitIndex: number, flat: number): number;
export function applyStrike(ctx: OpCtx, fx: StrikeSlice, at: "ko", hit: UnitState, hits: number, hitIndex: number): void;
export function applyStrike(ctx: OpCtx, fx: StrikeSlice, at: "grow", hits: number): number;
export function applyStrike(
  ctx: OpCtx,
  fx: StrikeSlice,
  at: "pierce" | "shield" | "count" | "consume" | "ko" | "grow",
  a?: number | UnitState,
  b?: number,
  c?: number,
): boolean | number | void {
  if (at === "pierce") return fx.pierce === true;
  if (at === "shield") return fx.pierceShield === true;
  const { rng, unit, move, events, side } = ctx;
  if (at === "count") {
    const useStacks = a as number;
    const hitsMaxEff = fx.hits?.capIfPpBelow !== undefined && (unit.moves.find((mv) => mv.moveId === move.id)?.pp ?? Number.MAX_SAFE_INTEGER) < fx.hits.capIfPpBelow.pp ? fx.hits.capIfPpBelow.cap : fx.hits?.max;
    const hitsBase = fx.hits === undefined ? 1
      : fx.hits.min === hitsMaxEff ? fx.hits.min
      : fx.hits.min + rng.drawBelow((hitsMaxEff ?? fx.hits.min) - fx.hits.min + 1, "multi_hit");
    let hits = fx.hits?.perUse !== undefined
      ? Math.min(fx.hits.cap ?? Number.MAX_SAFE_INTEGER, hitsBase + fx.hits.perUse * useStacks)
      : hitsBase;
    if (hits > 1 && fx.hits?.chance !== undefined && rng.drawBelow(100, "hits_chance") >= fx.hits.chance) hits = 1;
    if (fx.hits?.capIf !== undefined && condEval(ctx, fx.hits.capIf.when)) hits = Math.min(hits, fx.hits.capIf.cap);
    else if (fx.hits?.cap !== undefined) hits = Math.min(hits, fx.hits.cap);
    if (fx.hitsPerStage !== undefined) {
      const pool = fx.hitsPerStage.who === "self" ? unit.stages : ctx.foe.stages;
      const cnt = Object.values(pool).filter((v) => (fx.hitsPerStage!.sign ?? "up") === "up" ? v > 0 : v < 0).length;
      hits += Math.floor(cnt / fx.hitsPerStage.per) * fx.hitsPerStage.add;
    }
    if (fx.hitsPerPpGap !== undefined) {
      const gap = unit.moves.filter((sl) => sl.pp < sl.ppMax).length;
      hits += Math.floor(gap / fx.hitsPerPpGap.per) * fx.hitsPerPpGap.add;
    }
    if (fx.hitsPerPrio !== undefined) {
      const prioCat = move.category === "special" ? 3 : move.category === "physical" ? 2 : 1;
      const lvl = Math.max(0, (move.priority ?? 0) + prioAddOf(unit, prioCat));
      hits += Math.floor(lvl / fx.hitsPerPrio.per) * fx.hitsPerPrio.add;
    }
    return hits;
  }
  if (at === "consume") {
    const i = a as number;
    let flat = b as number;
    if (i === 0 && fx.consumeShield === true) {
      let consumed = 0;
      for (const e of [...unit.effects]) {
        if (effectDefOf(e.kind)?.dmgShield !== "params" || e.params?.flat === undefined) continue;
        flat += e.params.flat;
        consumed += e.params.flat;
        unit.effects = unit.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
      }
      unit.lastShieldConsumed = consumed;
    }
    return flat;
  }
  if (at === "ko") {
    const hit = a as UnitState;
    const hits = b as number;
    const i = c as number;
    if (fx.koIfHitsMax === true && fx.hits !== undefined && hits >= fx.hits.max && i === hits - 1 && hit.currentHp > 0) hit.currentHp = 0;
    return;
  }
  let hits = a as number;
  if (fx.hits?.growPerHit !== undefined) hits = Math.min(fx.hits.cap ?? Number.MAX_SAFE_INTEGER, hits + fx.hits.growPerHit);
  return hits;
}
