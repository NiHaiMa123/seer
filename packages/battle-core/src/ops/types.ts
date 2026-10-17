/**
 * ops/types.ts —— 效果 op 处理器契约。
 *
 * 设计意图：op = 原子效果处理器，一个 op 一个文件（ops/<op>.ts）。
 * applyOp 只做信封评估与分派；ops 是核心线协议语义——新增 op 需要
 * schema/CompiledEffect/ruleset allowlist 同步，不走机制插件（机制管"钩入"，不管"新语义"）。
 */
import type { CompiledEffect, CompiledMove, FrozenPack } from "../loader.ts";
import type { UnitState } from "../mechanics/types.ts";
import type { DeterministicRng } from "../rng.ts";
import type { CoreEvent, CoreState, SideId } from "../types.ts";

/** checkpoint 结果：继续 / 终局 / 需挂起（replacement 待决策）。 */
export type CpResult = "continue" | "terminal" | { suspend: SideId };

/** op 处理器上下文：行动方 side/unit，对方场上 foe，op 目标 target/targetSide。 */
export interface OpCtx {
  pack: FrozenPack;
  next: CoreState;
  events: CoreEvent[];
  side: SideId;
  unit: UnitState;
  move: CompiledMove;
  /** 对方场上单位（damage/transfer 的固有目标）。 */
  foe: UnitState;
  /** 对手本回合声明的招式（priority 排序语境才存在——"对手选择攻击技能时此技能先制+N"）。 */
  foeMove?: CompiledMove;
  /** fx.target 解析后的目标侧与单位。 */
  targetSide: SideId;
  target: UnitState;
  rng: DeterministicRng;
  /** 本回合行动序中的先后手（if:{order} 条件用）。 */
  order: "first" | "last";
  /** 同一招式内前一个 op 是否实际生效（产生了非 action-failed/protected/immune 事件）——"消除成功则X"的 if 谓词。 */
  prevApplied?: boolean;
  /** "均未触发则X"：本招此前所有 op 均未生效（仅此前 op 全落空时为 true）。 */
  noneApplied?: boolean;
  /** 上一 damage op 本招式内造成的总伤害（"若造成的伤害不足N"谓词）。 */
  lastDamage?: number;
  /** 上一 damage op 是否产生过致命一击（"若打出致命一击则"谓词）。 */
  lastCrit?: boolean;
  /** 上一 damage op 的伤害类型（"若对手未受到固定伤害则X"谓词）。 */
  lastDamageKind?: string;
  /** 上一 damage op 的克制倍率 ×16 定点（"克制关系为微弱"谓词）。 */
  lastEff16?: number;
  /** periodic 派发时的宿主审计标签（事件 cause/source 记为 status:<label>——原 *_tick 名字）。 */
  statusLabel?: string;
  /** 刚被清除的能力等级总段数（react trigger 7 派发语境——"每消除1项则附加N点固伤"的 flatPerRemoved 计费基数）。 */
  stagesRemoved?: number;
  /** 触发核为本条目录准备的达顶尾段槽。幅度 op 写入 run，核在兄弟 op 之后调用。 */
  magTail?: MagTail;
}

/**
 * 达顶尾段的槽。幅度 op 在兄弟 op 之前武装 run，触发核在选中分支之后调用。
 * 挂起不带续跑游标：整段重派，和旧 atCapOps 一样。
 */
export interface MagTail {
  atCap: boolean;
  run?: (ctx: Omit<OpCtx, "foe" | "target" | "targetSide">) => CpResult;
}

export type OpHandler = ((ctx: OpCtx, fx: CompiledEffect) => CpResult) & {
  /** 条目框：不算命中窗本体。else 分支不含它时，触发核仍会先调用一次以武装达顶尾段。 */
  frame?: true;
};
