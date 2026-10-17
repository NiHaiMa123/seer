/**
 * ops/swap-hp.ts —— swap_hp：交换自身与目标当前体力（"与对手互换体力"）。
 * 交换各自 currentHp（钳制到 hpCap 上限，不下探 0）；增量为正发 heal、为负发 fixed damage（cause:"swap"）。
 */
import { EngineFault, type SideId } from "../types.ts";
import type { UnitState } from "../mechanics/types.ts";
import { hpCapOf } from "./effects.ts";
import type { OpHandler } from "./types.ts";

export const swapHpOp: OpHandler = (ctx, fx) => {
  const { events, side, targetSide, unit, target } = ctx;
  if (fx.op !== "swap_hp") throw new EngineFault("OP_DISPATCH", `swap_hp handler got ${fx.op}`);
  // swapPercent：体力百分比对调（"使自身体力百分比与对手体力百分比对调"——各自新血量=自身上限×对方百分比，与 currentHp 绝对值互换区分）
  if (fx.swapPercent === true) {
    const uPct = unit.base.hp > 0 ? unit.currentHp / unit.base.hp : 0;
    const tPct = target.base.hp > 0 ? target.currentHp / target.base.hp : 0;
    const pairs: [SideId, UnitState, number][] = [
      [side, unit, Math.min(hpCapOf(unit), Math.floor(unit.base.hp * tPct)) - unit.currentHp],
      [targetSide, target, Math.min(hpCapOf(target), Math.floor(target.base.hp * uPct)) - target.currentHp],
    ];
    for (const [s, u, delta] of pairs) {
      u.currentHp += delta;
      const hpAfter = { current: u.currentHp, max: u.base.hp };
      if (delta > 0) events.push({ type: "heal", detail: { side: s, amount: delta, hpAfter, source: "swap" } });
      else if (delta < 0) events.push({ type: "damage", detail: { side: s, amount: -delta, hpAfter, damageKind: "fixed", cause: "swap" } });
    }
    return "continue";
  }
  const pairs: [SideId, UnitState, number][] = [
    [side, unit, Math.min(hpCapOf(unit), target.currentHp) - unit.currentHp],
    [targetSide, target, Math.min(hpCapOf(target), unit.currentHp) - target.currentHp],
  ];
  for (const [s, u, delta] of pairs) {
    u.currentHp += delta;
    const hpAfter = { current: u.currentHp, max: u.base.hp };
    if (delta > 0) events.push({ type: "heal", detail: { side: s, amount: delta, hpAfter, source: "swap" } });
    else if (delta < 0) events.push({ type: "damage", detail: { side: s, amount: -delta, hpAfter, damageKind: "fixed", cause: "swap" } });
  }
  return "continue";
};
