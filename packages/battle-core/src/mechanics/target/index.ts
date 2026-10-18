/**
 * mechanics/target —— 招式目标范围元数据（组队语句的目标描述）。
 *
 * 赛尔号原文里的「组队时可以向己方任意目标使用」不只是排版说明，它决定该招在
 * 组队语境下能指向谁。这类句子在 1v1 引擎里不改变结算，但属于 move 上的真实
 * 数据，必须有人认领——否则 loader 的字段认领检查会把整个包拒载
 * （loader.ts:803：非 CORE_MOVE_FIELDS 的字段无人 moveFieldClaims 即 fail）。
 *
 * 本模块只声明归属，不做结算：
 *   - targetScope: "anyAlly" 可作用己方任意目标；"any" 任意目标。
 *   - targets: 影响目标数（组队 N 体语境）。
 * 1v1 下两者都不参与判定，引擎不读取；它们是给组队模式与 UI 的数据。
 *
 * 删除本目录 + mechanics/index.ts 注册行即卸载；此后带这两字段的包会被拒载。
 */
import type { Mechanic } from "../types.ts";

/** 招式上的目标范围字段。 */
export interface TargetScopeFields {
  /** anyAlly=可作用己方任意目标；any=任意目标。 */
  targetScope?: "anyAlly" | "any";
  /** 组队时可影响的目标数。 */
  targets?: number;
}

export const targetMechanic: Mechanic = {
  id: "target",
  moveFieldClaims: ["targetScope", "targets"],
};
