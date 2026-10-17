/**
 * ops/grow.ts —— 被动幅度成长。
 *
 * 放在条目 ops 的开头。它不改这一下的数字：触发核按它交出的累积
 * 去改后面的兄弟 op。达顶后的追加负载在这里调用 applyOp，
 * 魂印钩子不按这个 op 的名字再分支。
 * 再加一种成长只加 of 的一个闭变体，不加条目字段。今天只有 magnitude。
 */
import type { CompiledEffect } from "../loader.ts";
import { EngineFault } from "../types.ts";
import type { MechAcc } from "./mechanism.ts";
import type { OpHandler } from "./types.ts";
import { applyOp } from "./index.ts";
import { groupHitRiders } from "./hit-rider.ts";

/** 条目上的幅度变成触发核认得的累积。step 缺席时不记账，和旧 growStep 缺席一样。 */
export function magnitudeAcc(ops: readonly CompiledEffect[] | undefined): MechAcc | undefined {
  if (ops === undefined) return undefined;
  for (const fx of ops) {
    if (fx.op !== "grow" || fx.of !== "magnitude") continue;
    const hasPayload = fx.payload !== undefined && fx.payload.length > 0;
    if (fx.step === undefined && fx.magCap === undefined && fx.atCapMul === undefined && !hasPayload) continue;
    return {
      step: fx.step ?? 0,
      commit: "pre",
      ...(fx.magCap !== undefined ? { cap: fx.magCap } : {}),
      ...(fx.point === true ? { point: true } : {}),
      ...(fx.resetOnCap === true ? { resetOnCap: true } : {}),
      ...(fx.atCapNext === true ? { atCapNext: true } : {}),
      ...(fx.atCapMul !== undefined ? { atCapMul: fx.atCapMul } : {}),
      ...(hasPayload ? { atCapPayload: true } : {}),
    };
  }
  return undefined;
}

/** 有 step 才给 magAcc 句柄。只有封顶、没有步长时，累积保持缺席（按 0 计）。 */
export function magnitudeTracks(ops: readonly CompiledEffect[] | undefined): boolean {
  return ops?.some((fx) => fx.op === "grow" && fx.of === "magnitude" && fx.step !== undefined) ?? false;
}

export const growOp: OpHandler = (ctx, fx) => {
  if (fx.op !== "grow") throw new EngineFault("OP_DISPATCH", `grow handler got ${fx.op}`);
  // 今天 of 只有 magnitude，真分支在类型里是 never。先放宽，才能报出装载器没拦住的值。
  const variant: string = fx.of;
  if (variant !== "magnitude") throw new EngineFault("OP_DISPATCH", `grow variant "${variant}" is not magnitude`);
  const slot = ctx.magTail;
  if (slot === undefined || slot.atCap !== true || fx.payload === undefined) return "continue";
  const payload = fx.payload;
  // 此时兄弟 op 还没跑。尾段留到触发核走完选中分支再派，顺序和旧 atCapOps 一样。
  slot.run = (runCtx) => {
    const err = groupHitRiders(payload);
    if (err !== undefined) throw new EngineFault("RIDER_UNGROUPED", err);
    for (const p of payload) {
      const cp = applyOp(runCtx, p);
      if (cp !== "continue") return cp;
    }
    return "continue";
  };
  return "continue";
};
// 命中窗判定要跳过它：它不是出伤窗本体。
growOp.frame = true;
