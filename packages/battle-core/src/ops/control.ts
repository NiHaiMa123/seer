/** ops/control.ts —— control：施加控制类效果（stun 等，按阻断次数消耗）。 */
import { MECHANICS } from "../mechanics/index.ts";
import { EngineFault, type CoreEvent } from "../types.ts";
import { overlayOf } from "./shared.ts";
import type { OpHandler } from "./types.ts";

export const controlOp: OpHandler = (ctx, fx) => {
  const { pack, next, events, target, targetSide } = ctx;
  if (fx.op !== "control") throw new EngineFault("OP_DISPATCH", `control handler got ${fx.op}`);
  if (overlayOf(pack, target)?.immuneControl) {
    events.push({ type: "action-failed", detail: { side: ctx.side, reason: "overlay_immune" } });
    return "continue";
  }
  if (target.effects.some((e) => e.kind === "immune_control")) {
    target.immuneThisTurn = (target.immuneThisTurn ?? 0) + 1;
    target.immunedMask = (target.immunedMask ?? 0) | 8; // 控制类异常 → bit8
    events.push({ type: "control-immune", detail: { side: targetSide, name: fx.name } });
    return "continue";
  }
  for (const m of MECHANICS) {
    const ref = m.controlImmune?.({ pack, unit: target });
    if (ref !== undefined) {
      events.push({ type: ref.type as CoreEvent["type"], detail: { side: targetSide, mark: ref.mark, name: ref.name, effect: "immune_control" } });
      return "continue";
    }
  }
  const kind = `control:${fx.name}`;
  const existing = target.effects.find((e) => e.kind === kind);
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns ?? 0, fx.turns);
    existing.appliedTurn = next.turn; // 刷新计为本回合新施加 → 本回合不减
  } else {
    target.effects.push({ kind, effectInstanceId: `efx_${targetSide}_${kind}`, remainingTurns: fx.turns, appliedTurn: next.turn });
  }
  events.push({ type: "effect-applied", detail: { side: targetSide, name: kind, turns: fx.turns } });
  return "continue";
};
