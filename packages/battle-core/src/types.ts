/**
 * battle-core 纯类型：CoreState 是 internal BattleState 的纯战斗子集
 * （无 inbox/decision/publicCursors —— 那些属于 Host 协议层）。
 * 单元/RNG/规则引用直接复用 contracts 生成类型，避免 schema 漂移。
 */
import type { BattleState, ResolvedAction } from "@seer/contracts/internal";

export type SideId = "p1" | "p2";
export const OTHER: Record<SideId, SideId> = { p1: "p2", p2: "p1" };

/** 纯战斗状态：Host 权威状态中去掉协议字段后的子集。 */
export interface CoreState {
  schemaVersion: 1;
  battleId: string;
  rules: BattleState["rules"];
  revision: number;
  turn: number;
  /** 静止相位只允许 init/collect/end；中间 phase 存在于单次 transition 内部。 */
  phase: "init" | "collect" | "end";
  rng: BattleState["rng"];
  sides: BattleState["sides"];
  speedTiebreak: BattleState["speedTiebreak"];
  terminal: BattleState["terminal"];
}

/** core 发出的事件负载：detail 形状与公共/内部事件 union 一致；Host 负责包 seq/revision/causeId。 */
export interface CoreEvent {
  type:
    | "turn-begin"
    | "action-declared"
    | "pp-spent"
    | "damage"
    | "heal"
    | "stat-stage"
    | "effect-applied"
    | "action-failed"
    | "struggle-used"
    | "rng-draw"
    | "ko"
    | "battle-end";
  detail: Record<string, unknown>;
  rngDraw?: { purpose: string; value: number };
}

export class EngineFault extends Error {
  readonly code = "ENGINE_FAULT";
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "EngineFault";
    this.reason = reason;
  }
}

export type CoreResult =
  | { ok: true; state: CoreState; events: CoreEvent[] }
  | { ok: false; fault: EngineFault };

/** resolved 动作：null = timeout/缺省（走 §9 默认策略）。 */
export type CoreAction = ResolvedAction;
