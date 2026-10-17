/** ops/cleanse.ts —— cleanse：移除目标效果。scope=control（缺省）| timed（回合类）| ailment（异常状态）。 */
import { EngineFault, OTHER } from "../types.ts";
import { effectDefOf, isMod } from "./effects.ts";
import { fireReactive } from "./index.ts";
import { checkpoint } from "./shared.ts";
import type { OpHandler } from "./types.ts";

export const cleanseOp: OpHandler = (ctx, fx) => {
  const { events, side, target, targetSide } = ctx;
  if (fx.op !== "cleanse") throw new EngineFault("OP_DISPATCH", `cleanse handler got ${fx.op}`);
  const effs = fx.effect === undefined ? undefined : Array.isArray(fx.effect) ? fx.effect : [fx.effect];
  const hit = effs !== undefined
    ? (e: { kind: string; remainingTurns?: number }) => effs.includes(e.kind)
    : fx.scope === "timed"
      ? (e: { kind: string; remainingTurns?: number }) => e.remainingTurns !== undefined
      : fx.scope === "ailment"
        ? (e: { kind: string; remainingTurns?: number }) => effectDefOf(e.kind)?.ailment === true
        : fx.scope === "shield"
          ? (e: { kind: string; remainingTurns?: number }) => e.kind === "shield" || effectDefOf(e.kind)?.dmgShield === "params"
          : (e: { kind: string; remainingTurns?: number }) => e.kind.startsWith("control:");
  const removed = target.effects.filter(hit);
  // cleanse_lock：目标处于封锁窗口时其效果不可被解除（"对手下N回合无法解除"——挂在被锁方）
  // timed_lock：仅挡 timed 域净化（"自身的回合类效果无法被消除"——其他域照常）
  // plain（tick 语义）：不吃封锁、空转不产 action-failed
  if (fx.plain !== true && target.effects.some((e) => isMod(e, "cleanseLock") || (fx.scope === "timed" && isMod(e, "timedLock")))) {
    events.push({ type: "protected", detail: { side: targetSide, reason: "cleanse-lock" } });
    return "continue";
  }
  if (removed.length === 0) {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "no-control" } });
    return "continue";
  }
  // 回合类效果被消除 → 目标侧 trigger 13（"若自身回合类效果被消除则X"）——先派发再移除（react 本体可能也在被清之列；noHooks/tick 不派发）
  if (fx.noHooks !== true && removed.some((e) => e.remainingTurns !== undefined)) {
    const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
    const cp = fireReactive({ ...rest, side: targetSide, unit: target }, target, 13, {});
    if (cp !== "continue") return cp;
  }
  // 异常状态被解除 → 目标侧 trigger 16（"自身烧伤状态解除后X"——按被解异常名逐个派发，ailment 守卫定向；noHooks 不派发）
  for (const e of (fx.noHooks === true ? [] : removed.filter((x) => effectDefOf(x.kind)?.ailment === true || x.kind.startsWith("control:")))) {
    const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
    const cp = fireReactive({ ...rest, side: targetSide, unit: target }, target, 16, { ailment: e.kind.startsWith("control:") ? e.kind.slice(8) : e.kind });
    if (cp !== "continue") return cp;
  }
  target.effects = target.effects.filter((e) => !hit(e));
  for (const e of removed) {
    events.push({ type: "effect-faded", detail: { side: targetSide, name: (e as { label?: string }).label ?? e.kind } });
  }
  // stealShield：被消除的盾罩按种类与剩余吸收量转移给行动方（"消除并获得对手的护盾、护罩"）
  if (fx.stealShield === true && fx.scope === "shield") {
    for (const e of removed) {
      const kind = e.kind === "ward" ? "ward" : "shield";
      ctx.unit.effects.push({ ...e, kind });
      events.push({ type: "effect-applied", detail: { side, name: kind } });
    }
  }
  // echoPct：被消除护盾的吸收量总和 ×pct% → 对 target 追加百分比伤害（"附加等同于消除护盾值总和N%的百分比伤害"）
  if (fx.echoPct !== undefined && fx.scope === "shield") {
    const shieldSum = removed.reduce((a, e) => a + (e.params?.flat ?? 0), 0);
    const d = Math.floor((shieldSum * fx.echoPct) / 100);
    if (d > 0) {
      target.currentHp = Math.max(0, target.currentHp - d);
      events.push({ type: "damage", detail: { side: targetSide, amount: d, hpAfter: { current: target.currentHp, max: target.base.hp }, damageKind: "percent", cause: "cleanse-echo" } });
      // 反伤可致死——必须过 checkpoint（KO/挂起/终局与常规伤害同口径）
      const cpc = checkpoint(ctx.pack, ctx.next, events, ctx.rng);
      if (cpc !== "continue") return cpc;
    }
  }
  // onClear rider：清除成功触发（"消除任意一项成功则附加N固伤且令对手随机M技能PP归零"——对手=施清方的对方）
  if (fx.onClear !== undefined) {
    const foeSide = OTHER[side];
    const foe = ctx.next.sides[foeSide].unit;
    if (fx.onClear.flat !== undefined && foe.currentHp > 0) {
      foe.currentHp = Math.max(0, foe.currentHp - fx.onClear.flat);
      events.push({ type: "damage", detail: { side: foeSide, amount: fx.onClear.flat, hpAfter: { current: foe.currentHp, max: foe.base.hp }, damageKind: "fixed", cause: "clear-echo" } });
      const cp = checkpoint(ctx.pack, ctx.next, events, ctx.rng);
      if (cp !== "continue") return cp;
    }
    if (fx.onClear.ppZeroFoe !== undefined && foe.currentHp > 0) {
      const live = foe.moves.filter((m) => m.pp > 0);
      for (let i = 0; i < fx.onClear.ppZeroFoe && live.length > 0; i++) {
        const slot = live.splice(ctx.rng.drawBelow(live.length, "pp_pick"), 1)[0]!;
        events.push({ type: "pp-delta", detail: { side: foeSide, moveId: slot.moveId, delta: -slot.pp, ppAfter: 0 } });
        slot.pp = 0;
      }
    }
  }
  return "continue";
};
