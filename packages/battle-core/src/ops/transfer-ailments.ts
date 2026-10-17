/** ops/transfer-ailments.ts —— transfer_ailments：异常状态在双方间整体迁移。
 *
 * direction="pull"：把对手（foe）的异常转移到自身（"将对手所处的异常状态转移给自身"）。
 * direction="push"：把自身的异常转给对手（"解除并附加给对手自身所处的异常状态"）。
 * 迁移的条目保留原 remainingTurns；目标已有同 kind 异常则跳过（不叠加）。
 */
import { EngineFault, OTHER } from "../types.ts";
import { effectDefOf } from "./effects.ts";
import { checkpoint } from "./shared.ts";
import type { OpHandler } from "./types.ts";

export const transferAilmentsOp: OpHandler = (ctx, ctxFx) => {
  const fx = ctxFx;
  const { pack, events, side, unit, foe } = ctx;
  if (fx.op !== "transfer_ailments") throw new EngineFault("OP_DISPATCH", `transfer_ailments handler got ${fx.op}`);
  const pull = (fx.direction ?? "pull") === "pull";
  const src = pull ? foe : unit;
  const dst = pull ? unit : foe;
  const srcSide = pull ? OTHER[side] : side;
  const dstSide = pull ? side : OTHER[side];
  const moved = src.effects.filter((e) => effectDefOf(e.kind)?.ailment === true && !dst.effects.some((x) => x.kind === e.kind));
  if (moved.length === 0) return "continue";
  src.effects = src.effects.filter((e) => !(effectDefOf(e.kind)?.ailment === true && moved.includes(e)));
  dst.effects = [...dst.effects, ...moved];
  for (const e of moved) {
    events.push({ type: "effect-faded", detail: { side: srcSide, name: e.label ?? e.kind } });
    events.push({ type: "effect-applied", detail: { side: dstSide, name: e.label ?? e.kind, turns: e.remainingTurns ?? 0 } });
  }
  // drainPer：每迁移一条异常吸取对手 flat 点体力（"每转移一项吸取对手404点体力"——失血方=被转走方，回血方=行动方）
  if (fx.drainPer !== undefined) {
    const amt = moved.length * fx.drainPer;
    if (amt > 0 && src.currentHp > 0) {
      src.currentHp = Math.max(0, src.currentHp - amt);
      events.push({ type: "damage", detail: { side: srcSide, amount: amt, hpAfter: { current: src.currentHp, max: src.base.hp }, damageKind: "fixed", cause: "transfer_drain" } });
      const cp = checkpoint(pack, ctx.next, events, ctx.rng);
      if (cp !== "continue") return cp;
      const before = unit.currentHp;
      unit.currentHp = Math.min(unit.base.hp, unit.currentHp + amt);
      if (unit.currentHp > before) events.push({ type: "heal", detail: { side, amount: unit.currentHp - before, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "transfer_drain" } });
    }
  }
  // ppZeroPer：每迁移一项令对手随机 N 项技能 PP 归零（"每转移一项令对手随机1项技能PP值归零"——失血方=被转走方）
  if (fx.ppZeroPer !== undefined && moved.length > 0) {
    const count = moved.length * fx.ppZeroPer;
    const live = src.moves.filter((m) => m.pp > 0);
    for (let i = 0; i < count && live.length > 0; i++) {
      const idx = ctx.rng.drawBelow(live.length, "transfer_pp_zero");
      const slot = live.splice(idx, 1)[0]!;
      const before = slot.pp;
      slot.pp = 0;
      events.push({ type: "pp-delta", detail: { side: srcSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: 0 } });
    }
  }
  return "continue";
};
