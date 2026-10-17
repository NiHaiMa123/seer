/**
 * ops/force-switch.ts —— force_switch：强制换人（"令对方替换精灵"/"自身返回背包"）。
 * 最小干涉决策：自动换入第一只存活替补（真实游戏由被换方自选——决策面不扩协议，UNVERIFIED）。
 * 束缚（noSwitch flag）/无存活替补 → 失败。
 */
import { EngineFault } from "../types.ts";
import { entrySettle } from "./shared.ts";
import { noSwitchOn } from "./effects.ts";
import type { OpHandler } from "./types.ts";

export const forceSwitchOp: OpHandler = (ctx, fx) => {
  const { pack, next, events, side, target, targetSide } = ctx;
  if (fx.op !== "force_switch") throw new EngineFault("OP_DISPATCH", `force_switch handler got ${fx.op}`);
  if (noSwitchOn(target)) {
    events.push({ type: "action-failed", detail: { side, reason: "bound" } });
    return "continue";
  }
  const bench = next.sides[targetSide].bench;
  const idx = bench?.findIndex((b) => b.currentHp > 0 && b.banished !== true) ?? -1;
  if (idx < 0) {
    events.push({ type: "action-failed", detail: { side, reason: "no-bench" } });
    return "continue";
  }
  const s = next.sides[targetSide];
  const out = s.unit;
  const inU = bench![idx]!;
  bench![idx] = out;
  s.unit = inU;
  events.push({ type: "switch", detail: { side: targetSide, outUnitId: out.unitId, inUnitId: inU.unitId, via: "forced" } });
  // 换入结算共享段：onEntry 钩子 + nextInFx + 留守方 react9（此前被绕过——B4）。
  // 换下侧 onSwitchOut 不派发：强制换下的换下钩子语义 UNVERIFIED（对手发起，非自愿换下）。
  return entrySettle(pack, next, events, ctx.rng, targetSide);
};
