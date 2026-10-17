/** ops/banish-dead.ts —— banish_dead：令目标侧场下首位阵亡精灵消逝（不可被选中/复活）。 */
import { EngineFault } from "../types.ts";
import type { OpHandler } from "./types.ts";

export const banishDeadOp: OpHandler = (ctx, fx) => {
  const { next, events, targetSide } = ctx;
  if (fx.op !== "banish_dead") throw new EngineFault("OP_DISPATCH", `banish_dead handler got ${fx.op}`);
  const bench = next.sides[targetSide].bench ?? [];
  const idx = bench.findIndex((b) => b.currentHp <= 0 && b.banished !== true);
  if (idx < 0) {
    events.push({ type: "action-failed", detail: { side: targetSide, reason: "banish-no-corpse" } });
    return "continue";
  }
  bench[idx]!.banished = true;
  events.push({ type: "effect-faded", detail: { side: targetSide, name: "banish_dead" } });
  return "continue";
};
