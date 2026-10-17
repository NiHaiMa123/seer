/**
 * ops/copy-stages.ts —— 能力等级复制/反转。
 *   copy_stages：复制对方能力等级到自身（sign:"up" 仅复制正值=复制强化；缺省双向）。
 *   invert_stages：反转目标负级为正级（"反转自身能力下降"）；stat 给定时只反转那一维
 *   （"反转对手速度能力提升状态"），sign 仍按原句的提升/下降。
 * 每维度一条 stat-stage 事件；无变化 → action-failed。
 */
import { EngineFault } from "../types.ts";
import { stageKeysFor } from "../mechanics/index.ts";
import { clamp } from "./shared.ts";
import { downLockOn } from "./effects.ts";
import type { OpHandler } from "./types.ts";

export const copyStagesOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, unit, foe, target, targetSide } = ctx;
  if (fx.op !== "copy_stages") throw new EngineFault("OP_DISPATCH", `copy_stages handler got ${fx.op}`);
  // match：target 侧各维改写为另一侧同维（"使对手该能力等级变为与自身相同"）
  if (fx.match === true) {
    const dst = fx.target === "opponent" ? foe : fx.target === "self" ? unit : target;
    const src = dst === foe ? unit : foe;
    const dstSide = dst === target ? targetSide : dst === foe ? (side === "p1" ? "p2" : "p1") : side;
    let any = false;
    for (const s of stageKeysFor(pack)) {
      if (fx.stat !== undefined && s !== fx.stat) continue;
      const sv = src.stages[s] ?? 0;
      if (fx.sign === "up" && sv <= 0) continue;
      if (fx.sign === "down" && sv >= 0) continue;
      const want = clamp(sv, -6, 6);
      const before = dst.stages[s] ?? 0;
      if (want === before) continue;
      dst.stages[s] = want;
      events.push({ type: "stat-stage", detail: { side: dstSide, stat: s, deltaApplied: want - before, stageAfter: want } });
      any = true;
    }
    if (!any) events.push({ type: "action-failed", detail: { side: targetSide, reason: "no-stages" } });
    return "continue";
  }
  let any = false;
  for (const s of stageKeysFor(pack)) {
    if (fx.stat !== undefined && s !== fx.stat) continue;
    const v = foe.stages[s] ?? 0;
    if (fx.sign === "up" && v <= 0) continue;
    if (fx.sign === "down" && v >= 0) continue;
    const want = clamp(v, -6, 6);
    const before = unit.stages[s] ?? 0;
    if (want === before) continue;
    unit.stages[s] = want;
    events.push({ type: "stat-stage", detail: { side, stat: s, deltaApplied: want - before, stageAfter: want } });
    any = true;
  }
  if (!any) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
  return "continue";
};

export const invertStagesOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, target, targetSide } = ctx;
  if (fx.op !== "invert_stages") throw new EngineFault("OP_DISPATCH", `invert_stages handler got ${fx.op}`);
  const sign = fx.sign ?? "down";
  // 弱化锁（"能力下降状态无法被解除或反转"）：持有者负级禁止被清除/反转
  if (sign === "down" && downLockOn(target)) {
    events.push({ type: "action-failed", detail: { side, reason: "down_lock" } });
    return "continue";
  }
  // mul 分数倍率（"双倍反转自身能力下降"→{numerator:2,denominator:1}）
  const mulN = fx.mul?.numerator ?? 1;
  const mulD = fx.mul?.denominator ?? 1;
  let any = false;
  for (const s of stageKeysFor(pack)) {
    if (fx.stat !== undefined && s !== fx.stat) continue;
    const v = target.stages[s] ?? 0;
    if (sign === "down" ? v >= 0 : v <= 0) continue;
    const nv = clamp(Math.round((-v * mulN) / mulD), -6, 6);
    target.stages[s] = nv;
    events.push({ type: "stat-stage", detail: { side: targetSide, stat: s, deltaApplied: nv - v, stageAfter: nv } });
    any = true;
  }
  if (!any) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
  return "continue";
};
