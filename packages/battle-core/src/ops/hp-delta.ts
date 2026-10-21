/** ops/hp-delta.ts —— hp_delta：直接增减 HP（tick/dot/吸取类），不走招式伤害管线（无护盾/克制/骑手/onDamaged）。 */
import { EngineFault, OTHER } from "../types.ts";
import { checkpoint } from "./shared.ts";
import { flatImmuneOn, hpCapOf, valueAmountOf } from "./effects.ts";
import type { OpHandler } from "./types.ts";

/**
 * 原子语义：对 target 造成 flat | frac{of:max|cur}（target 基数）| fracSelf（持有者基数）|
 * ofSelfDealt（持有者本回合伤害量×n/d）| perImmuneFlat（×当回合成功免疫次数）| kill 点直损。
 * healSelf={n,d,of:"dealt"|"amount"} 持有者回血（dealt=实际扣量，amount=全额）；
 * flatImmune 缺省 respect（免疫跳过），flatImmuneConvert=flat 时免疫转换为 flat 点真伤。
 * 事件 cause/source 记为 status:<ctx.statusLabel>（周期宿主名）。
 */
export const hpDeltaOp: OpHandler = (ctx, fx) => {
  const { events, side, unit, rng } = ctx;
  if (fx.op !== "hp_delta") throw new EngineFault("OP_DISPATCH", `hp_delta handler got ${fx.op}`);
  const t = fx.target === "self" ? unit : ctx.target;
  const tSide = fx.target === "self" ? side : ctx.targetSide;
  const label = ctx.statusLabel ?? "hp_delta";
  const cause = fx.cause ?? `status:${label}`;
  let amt = fx.amountExpr !== undefined || fx.statDiff !== undefined ? valueAmountOf(fx, unit, ctx.foe, t)!
    : fx.flat !== undefined ? fx.flat
    : fx.flatRange !== undefined ? fx.flatRange.min + rng.drawBelow(Math.max(1, fx.flatRange.max - fx.flatRange.min + 1), `tick_range:${label}`)
    : fx.selfStageFlat !== undefined
      ? Math.floor(Object.values(unit.stages).filter((v) => (fx.selfStageFlat!.sign ?? "up") === "up" ? v > 0 : v < 0).length / Math.max(1, fx.selfStageFlat.per)) * fx.selfStageFlat.flat
    : fx.frac !== undefined ? Math.floor(((fx.frac.of === "cur" ? t.currentHp : t.base.hp) * fx.frac.numerator) / fx.frac.denominator)
    : fx.fracSelf !== undefined ? Math.floor(((fx.fracSelf.of === "cur" ? unit.currentHp : unit.base.hp) * fx.fracSelf.numerator) / fx.fracSelf.denominator)
    : 0;
  if (fx.ofSelfDealt !== undefined) amt += Math.floor(((unit.dealtThisTurn ?? 0) * fx.ofSelfDealt.numerator) / fx.ofSelfDealt.denominator);
  if (fx.perImmuneFlat !== undefined) amt += (unit.immuneThisTurn ?? 0) * fx.perImmuneFlat;
  let kind = fx.kind ?? "fixed";
  if (flatImmuneOn(t) && fx.flatImmune !== "ignore") {
    if (fx.flatImmuneConvert === undefined) return "continue";
    amt = Math.min(t.currentHp, fx.flatImmuneConvert.flat);
    kind = "true";
  }
  if (fx.kill === true) amt = t.currentHp;
  if (amt <= 0 || t.currentHp <= 0) return "continue";
  const dealt = Math.min(t.currentHp, amt);
  t.currentHp = Math.max(0, t.currentHp - dealt);
  events.push({ type: "damage", detail: { side: tSide, amount: dealt, hpAfter: { current: t.currentHp, max: t.base.hp }, damageKind: kind, cause } });
  // hp_delta 是原子扣血/吸取：先按实扣量完成持有者与背包回血，再判 KO/挂起/终局。
  // 持有者已倒下时不能由同一笔自伤回血复活；目标是对手时，持有者可先吸满后再结算目标 KO。
  if (fx.healSelf !== undefined && unit.currentHp > 0) {
    const base = fx.healSelf.of === "amount" ? amt : dealt;
    const healed = Math.floor((base * fx.healSelf.numerator) / fx.healSelf.denominator);
    const before = unit.currentHp;
    unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + healed);
    if (unit.currentHp > before) events.push({ type: "heal", detail: { side, amount: unit.currentHp - before, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: cause } });
  }
  // benchHealFlat 同属这笔吸取原子：持有者存活且满足满血门后，在 KO/checkpoint 前恢复背包。
  if (fx.benchHeal !== undefined && unit.currentHp > 0 && (fx.benchHeal.requireSelfFull !== true || unit.currentHp >= hpCapOf(unit))) {
    for (const b of ctx.next.sides[side].bench ?? []) {
      if (b.currentHp <= 0 || b.banished === true) continue;
      const before = b.currentHp;
      b.currentHp = Math.min(b.base.hp, b.currentHp + fx.benchHeal.flat);
      if (b.currentHp > before) events.push({ type: "heal", detail: { side, amount: b.currentHp - before, hpAfter: { current: b.currentHp, max: b.base.hp }, source: `${cause}:bench` } });
    }
  }
  return checkpoint(ctx.pack, ctx.next, events, rng);
};
