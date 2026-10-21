/** 可组合的整数读数。由 schema 生成类型；运行时不执行脚本，不消耗 RNG。 */
import type { BattleState } from "@seer/contracts/internal";
import { EngineFault } from "../types.ts";
import type { UnitState } from "../mechanics/types.ts";

export type NumericValue = NonNullable<BattleState["sides"]["p1"]["unit"]["effects"][number]["amountExpr"]>;

export interface ValueContext {
  self: UnitState;
  foe?: UnitState | undefined;
  target?: UnitState | undefined;
  isAilment(kind: string): boolean;
}

/** 每个除法节点向下取整。组合的层次同时明确取整次序。 */
export function evaluateValue(value: NumericValue, ctx: ValueContext): number {
  let nodes = 0;
  const checked = (value: number): number => {
    if (!Number.isSafeInteger(value)) throw new EngineFault("INVALID_VALUE", "numeric result must be a safe integer");
    return value;
  };
  const visit = (v: NumericValue, depth: number): number => {
    if (++nodes > 256 || depth > 32) throw new EngineFault("EFFECT_LIMIT", "numeric value exceeds 256 nodes or depth 32");
    const next = (child: NumericValue) => visit(child, depth + 1);
    let result: number;
    if (typeof v === "number") result = v;
    else if ("stat" in v) {
      const unit = v.of === "foe" ? ctx.foe : v.of === "target" ? ctx.target ?? ctx.self : ctx.self;
      result = unit?.base[v.stat] ?? 0;
    } else if ("count" in v) {
      const unit = v.of === "foe" ? ctx.foe : v.of === "target" ? ctx.target ?? ctx.self : ctx.self;
      result = new Set(unit?.effects.filter((e) => ctx.isAilment(e.kind)).map((e) => e.kind) ?? []).size;
    } else if ("sum" in v) result = v.sum.reduce<number>((n, child) => checked(n + next(child)), 0);
    else if ("product" in v) result = v.product.reduce<number>((n, child) => checked(n * next(child)), 1);
    else if ("difference" in v) result = Math.abs(next(v.difference[0]!) - next(v.difference[1]!));
    else if ("divide" in v) {
      if (!Number.isSafeInteger(v.divide.by) || v.divide.by <= 0) throw new EngineFault("INVALID_VALUE", "numeric divisor must be a positive integer");
      result = Math.floor(next(v.divide.value) / v.divide.by);
    } else if ("min" in v) result = Math.min(...v.min.map(next));
    else if ("max" in v) result = Math.max(...v.max.map(next));
    else {
      const exhaustive: never = v;
      throw new EngineFault("INVALID_VALUE", `unknown numeric expression: ${String(exhaustive)}`);
    }
    return checked(result);
  };
  return visit(value, 0);
}
