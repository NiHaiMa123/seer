/** ops/hp-delta.ts —— hp_delta：直接增减 HP（tick/dot/吸取类），不走招式伤害管线（无护盾/克制/骑手/onDamaged）。 */
import { EngineFault, OTHER } from "../types.ts";
import { checkpoint } from "./shared.ts";
import { flatImmuneOn, hpCapOf, statDiffOf } from "./effects.ts";
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
  // statDiff：幅值 = |自身该维 - 对手该维|（"根据双方速度值之差n…附加n点固定伤害"）
  let amt = fx.statDiff !== undefined ? statDiffOf(unit, ctx.foe, fx.statDiff, fx.statDiffDenom)
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
  const cp = checkpoint(ctx.pack, ctx.next, events, rng);
  if (cp === "terminal") return cp;
  // 持有者回血（drain_dot 吸取 of:dealt=扣多少回多少；hot 转变 of:amount=全额）
  if (fx.healSelf !== undefined && unit.currentHp > 0) {
    const base = fx.healSelf.of === "amount" ? amt : dealt;
    const healed = Math.floor((base * fx.healSelf.numerator) / fx.healSelf.denominator);
    const before = unit.currentHp;
    unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + healed);
    if (unit.currentHp > before) events.push({ type: "heal", detail: { side, amount: unit.currentHp - before, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: cause } });
  }
  // benchHealFlat：吸取结算后为不在场存活精灵定额回血（requireSelfFull=持有者满血才触发）
  if (fx.benchHeal !== undefined && (fx.benchHeal.requireSelfFull !== true || unit.currentHp >= hpCapOf(unit))) {
    for (const b of ctx.next.sides[side].bench ?? []) {
      if (b.currentHp <= 0 || b.banished === true) continue;
      const before = b.currentHp;
      b.currentHp = Math.min(b.base.hp, b.currentHp + fx.benchHeal.flat);
      if (b.currentHp > before) events.push({ type: "heal", detail: { side, amount: b.currentHp - before, hpAfter: { current: b.currentHp, max: b.base.hp }, source: `${cause}:bench` } });
    }
  }
  if (cp !== "continue") return cp;
  return "continue";
};
