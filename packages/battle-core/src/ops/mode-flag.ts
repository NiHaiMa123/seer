/**
 * ops/mode-flag.ts —— set_mode_flag：具名开关位的置位/复位。
 *
 * 语料里「衍化/复原/改为逆转」这类句子改的是一个**没有计时**的单位开关：
 *   - "衍化自身的武道"            → 正转（置位）
 *   - "复原自身的武道衍化轨迹"    → 撤销（清除）
 *   - "将自身的武道衍化轨迹改为逆转" → 逆转（置位，带一个互斥的正转复位）
 *
 * 三种落点都用单位效果表里 kind="tag:name" 的条目承载（apply_effect 已用同一编码：
 * apply-effect.ts 对 apply_effect 写 `tag:${name}`），复用 selfHas 谓词
 * （cond.ts：kind === name 或 kind 以 `${name}:` 起头）。置位/清除都不带 remainingTurns——
 * 这不是回合类窗口，selfNoTimedFx 一类谓词不受影响。
 *
 * 三态用 to 与 clear 两个字段表达，不加状态名（EFFECT_DEFS 不动）：
 *   to  缺省 = 正转位；to:"revert" = 逆转位；
 *   clear:true = 清除 tag:name 全部状态（复原）。
 * 互斥复位通过 remove 给出，由本 op 自己执行——不依赖调用方先派发别的 op。
 */
import { EngineFault } from "../types.ts";
import type { OpHandler } from "./types.ts";

/**
 * 具名开关位的 kind 编码：`tag:<name>:forward` / `tag:<name>:revert`。
 * 两个状态都带后缀——selfHas 谓词是"相等或前缀+冒号"匹配（cond.ts），
 * 裸 `tag:<name>` 会把逆转位一起认进来，正转探针就会在逆转时误触发。
 */
const flagKind = (name: string, state?: string): string => `tag:${name}:${state ?? "forward"}`;

export const setModeFlagOp: OpHandler = (ctx, fx) => {
  if (fx.op !== "set_mode_flag") throw new EngineFault("OP_DISPATCH", `set_mode_flag handler got ${fx.op}`);
  const { next, events, target, targetSide } = ctx;
  const name = fx.name;
  // 三个 kind 同属一个开关：一般置位 / 正转 / 逆转。整组先清，再按本次状态置位——
  // 状态位之间天然互斥，clear 只清不置。
  const states = new Set<string>([flagKind(name, "forward"), flagKind(name, "revert")]);
  for (const rm of fx.remove ?? []) states.add(flagKind(rm, fx.removeState));
  const before = target.effects.length;
  target.effects = target.effects.filter((e) => !states.has(e.kind));
  const removed = before - target.effects.length;
  if (removed > 0) events.push({ type: "effect-faded", detail: { side: targetSide, name: `tag:${name}`, count: removed } });
  if (fx.clear === true) return "continue";
  const kind = flagKind(name, fx.to);
  target.effects.push({ kind, effectInstanceId: `efx_${targetSide}_${kind}`, appliedTurn: next.turn });
  events.push({ type: "effect-applied", detail: { side: targetSide, name: kind, turns: 0 } });
  return "continue";
};
