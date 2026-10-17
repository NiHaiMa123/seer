/** ops/stat-boost.ts —— stat_boost：面板基础值修正（魂印"体力+40/攻击力提升8%"族）。
 * 直接改写 target.base——sixstat 面板在 unit 创建时已推导入 base，战斗内修正
 * 即作用于后续伤害/速度判定；hp 同步抬 currentHp（上限提升即回复）。
 */
import { EngineFault } from "../types.ts";
import { hpCapOf } from "./effects.ts";
import type { OpHandler } from "./types.ts";

export const statBoostOp: OpHandler = (ctx, fx) => {
  if (fx.op !== "stat_boost") throw new EngineFault("OP_DISPATCH", `stat_boost handler got ${fx.op}`);
  const { target, targetSide, events } = ctx;
  let any = false;
  for (const k of fx.stats) {
    const cur = target.base[k];
    if (cur === undefined) continue;
    const delta = (fx.add ?? 0) + Math.floor((cur * (fx.pct ?? 0)) / 100);
    if (delta <= 0) continue;
    target.base[k] = cur + delta;
    if (k === "hp") target.currentHp = Math.min(hpCapOf(target), target.currentHp + delta);
    events.push({ type: "effect-applied", detail: { side: targetSide, name: `stat_boost:${k}`, turns: 0 } });
    any = true;
  }
  if (!any) events.push({ type: "action-failed", detail: { side: targetSide, reason: "no-boost" } });
  return "continue";
};
