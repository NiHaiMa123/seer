/**
 * ops/slots/w09.ts —— eff_max：这一击的克制倍率取「自身→对手」与「对手→自身」两者中的最大值。
 *
 * 语料只有一句（4 个招式，同一字符串）：娜诺/撬动世界
 *   「自身处于异常状态时，克制倍数取自身对对手、对手对自身克制倍数中的最大值」
 * 句子自带的条件由解析器给整个 op 挂 `if:{selfStatused:true}`，处理器不用再管。
 *
 * ## 顺序
 *
 * 句子原样是**一个** part（顿号被分段器续接回同一段：前段收尾「对对手」不是 stat 名、
 * 后段也不是枚举头，两个条件都不满足 → 不切），所以此前先被 `e47-08`（改克制的总档）
 * 截走、留档 deferred。`...batchW09` 前移到 `...batchE47` 之前后本规则可达——
 * 前移与注册是一件事：规则吃得着而 op 没注册，装载期就会拒载。
 *
 * ## 结算语义
 *
 * 引擎里这一击的克制倍率是 damage.ts 的局部量 `eff16`：
 *   `eff16 = effectivenessOf(chart, move.type, foeTypes)`（×16 定点），
 * 随后 `applyFormula(..., "resist", eff16, ...)` 只做「noResist 抬到 16」。
 * 本 op 按同一张 typeChart 算另一侧（对手系别 → 自身系别），取 max 后记在**本侧单位**的
 * `effFloor` 上。克制读法不读这个字段（读它会新造克制下限，已退回）。
 * 下限是按在场有效系别现算的，编译器写不进常量，所以不走 rider 家族、也不加 damage 字段。
 *
 * 目标语义：「自身对对手」= 自身系别打对手系别（weCounterFoe 的读法），
 * 「对手对自身」= 对手系别打自身系别。两侧都读 battleTypesOf 的在场有效系别
 * （type_swap/type_copy 覆写也要算进去）。
 *
 * 只读现有 typeChart 与现有系别函数：不新开状态名、不加 params 键。
 */
import { EngineFault } from "../../types.ts";
import { battleTypesOf } from "../effects.ts";
import { effectivenessOf } from "../shared.ts";
import type { FrozenPack } from "../../loader.ts";
import type { UnitState } from "../../mechanics/types.ts";
import type { OpHandler } from "../types.ts";

/** 「自身对对手」与「对手对自身」克制倍率的最大值（×16 定点，1.0 = 16）。 */
export function maxEff16(
  pack: FrozenPack,
  self: UnitState,
  foe: UnitState,
  side: "selfToFoe" | "foeToSelf",
): number {
  const chart = pack.typeChart;
  if (chart === undefined) return 16;
  const foeTypes = battleTypesOf(pack, foe, self);
  const selfTypes = battleTypesOf(pack, self, foe);
  if (side === "selfToFoe") {
    if (selfTypes.length === 0) return 16;
    return Math.max(...selfTypes.map((t) => effectivenessOf(chart, t, foeTypes)));
  }
  if (foeTypes.length === 0) return 16;
  return Math.max(...foeTypes.map((t) => effectivenessOf(chart, t, selfTypes)));
}

export const effMaxOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, unit, foe, targetSide } = ctx;
  if (fx.op !== "eff_max") throw new EngineFault("OP_DISPATCH", `eff_max handler got ${fx.op}`);
  const self = targetSide === side ? unit : foe;
  const other = self === unit ? foe : unit;
  const eff16 = Math.max(maxEff16(pack, self, other, "selfToFoe"), maxEff16(pack, self, other, "foeToSelf"));
  // 写在本侧单位上，伤害公式不读。没有 typeChart / 任一侧无系别时按 16（1.0）记。
  self.effFloor = eff16;
  events.push({ type: "effect-applied", detail: { side: targetSide, name: "eff_max", turns: 0 } });
  return "continue";
};
