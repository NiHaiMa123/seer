/**
 * Host 协议层类型。HostState = 完整 internal BattleState
 * （CoreState 字段 + decision/inbox/eventSeq/publicCursors）。
 */
import type {
  BattleState,
  InternalEvent,
  ResolvedAction,
} from "@seer/contracts/internal";
import type { CoreState, FrozenPack, SideId } from "@seer/battle-core";

/** 玩家身份绑定：playerId → side（外部 session 抽象，Host 内只用确定性字符串 id）。 */
export type PlayerBinding = Readonly<Record<string, SideId>>;

export interface SubmissionRecord {
  decisionId: string;
  side: SideId;
  actionId: string;
  origin: "player" | "timeout_default";
  idempotencyKey: string;
  baseRevision: number;
  receiptId: string;
  canonicalDigest: string;
  acceptedSeq: number;
}

export interface HostState {
  battle: BattleState; // internal 完整权威态（含 inbox/decision/cursors）
  internalEvents: InternalEvent[];
  /** idempotency key → 提交记录（决策关闭后仍可查取 receipt）。 */
  receipts: Map<string, SubmissionRecord>;
  /** 已 resolved 的输入（replay 重放源）。 */
  resolvedInputs: { decisionId: string; baseRevision: number; resolvedSeq: number; actions: { p1: ResolvedAction; p2: ResolvedAction } }[];
  seqCounter: number;
}

export interface HostConfig {
  pack: FrozenPack;
  battleId: string;
  seedHex: string;
  species: { p1: string; p2: string };
  players: { p1: string; p2: string }; // side → playerId
  deadlineMs: number; // 逻辑 deadline（不接 wall-clock）
}

export class HostError extends Error {
  readonly retryable: boolean;
  constructor(
    public readonly code:
      | "INVALID_SCHEMA"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "STALE_DECISION"
      | "ILLEGAL_ACTION"
      | "ALREADY_SUBMITTED"
      | "IDEMPOTENCY_CONFLICT"
      | "DEADLINE_EXCEEDED"
      | "ENGINE_FAULT",
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "HostError";
    this.retryable = retryable;
  }
}

export type SubmitResult =
  | { ok: true; receipt: { decisionId: string; side: SideId; actionId: string; baseRevision: number; status: "accepted" | "duplicate-replay"; resolved: boolean } }
  | { ok: false; error: HostError };

/** CoreState ↔ BattleState 适配：Host 权威态内嵌 core 字段，transition 后写回。 */
export function toCore(battle: BattleState): CoreState {
  return {
    schemaVersion: 1,
    battleId: battle.battleId,
    rules: battle.rules,
    revision: battle.revision,
    turn: battle.turn,
    phase: battle.phase as CoreState["phase"],
    rng: battle.rng,
    sides: battle.sides,
    speedTiebreak: battle.speedTiebreak,
    terminal: battle.terminal,
  };
}

export function fromCore(battle: BattleState, core: CoreState): void {
  battle.revision = core.revision;
  battle.turn = core.turn;
  battle.phase = core.phase;
  battle.rng = core.rng;
  battle.sides = core.sides;
  battle.speedTiebreak = core.speedTiebreak;
  battle.terminal = core.terminal;
}
