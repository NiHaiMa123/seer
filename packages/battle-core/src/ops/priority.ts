/**
 * ops/priority.ts —— beforeOrder 的先制区间。
 *
 * 掷点必须发生在排序当时。orderRoll 读 min/max，不在 applyOp 里掷，
 * 否则 rng 会计到出招之后。条目上因此不再留 prio。
 */
import type { CompiledEffect } from "../loader.ts";
import { EngineFault } from "../types.ts";
import type { OpHandler } from "./types.ts";

/** 这条被动的先制区间。没有 priority op 时不加权，和旧的 prio 缺席一样。 */
export function priorityRange(ops: readonly CompiledEffect[] | undefined): { min: number; max: number } | undefined {
  if (ops === undefined) return undefined;
  for (const fx of ops) {
    if (fx.op !== "priority") continue;
    return { min: fx.min, max: fx.max };
  }
  return undefined;
}

export const priorityOp: OpHandler = (_ctx, fx) => {
  if (fx.op !== "priority") throw new EngineFault("OP_DISPATCH", `priority handler got ${fx.op}`);
  return "continue";
};
// 命中窗判定要跳过它：它不是出伤窗本体。
priorityOp.frame = true;
