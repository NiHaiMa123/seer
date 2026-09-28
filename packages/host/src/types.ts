/**
 * Host 协议层类型。HostState = 完整 internal BattleState
 * （CoreState 字段 + decision/inbox/eventSeq/publicCursors）。
 */
import type {
  BattleState,
  InternalEvent,
  ResolvedAction,
} from "@seer/contracts/internal";
import type { BattleEvent } from "@seer/contracts";
import type { CoreState, FrozenPack, SideId } from "@seer/battle-core";
import type { TransitionExecutor } from "./executor.ts";

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
  /** 公开事件流：白名单投影后的公开事件 + 独立 seq；内部专属事件不进入 → 不涨 view cursor。 */
  publicStream: { seq: number; event: BattleEvent }[];
  publicSeq: number;
  /** idempotency key → 提交记录（决策关闭后仍可查取 receipt）。 */
  receipts: Map<string, SubmissionRecord>;
  /** 已 resolved 的输入（replay 重放源）。 */
  resolvedInputs: { decisionId: string; baseRevision: number; resolvedSeq: number; actions: { p1: ResolvedAction; p2: ResolvedAction } }[];
  seqCounter: number;
}

export interface HostConfig {
  pack: FrozenPack;
  executor?: TransitionExecutor;
  battleId: string;
  seedHex: string;
  species: { p1: string; p2: string };
  /** v2 bench：每方后备 speciesId 列表（v1 局不传 → bench 字段不出现） */
  bench?: { p1?: string[]; p2?: string[] };
  /** 刻印 loadout：seals.p1[0]=首发槽位，[1+i]=bench[i]；不传=用 species 预设 seals。 */
  seals?: { p1?: string[][]; p2?: string[][] };
  players: { p1: string; p2: string }; // side → playerId
  deadlineMs: number; // 逻辑 deadline（不接 wall-clock）
}

export type HostErrorCode =
  | "INVALID_SCHEMA"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "STALE_DECISION"
  | "ILLEGAL_ACTION"
  | "ALREADY_SUBMITTED"
  | "IDEMPOTENCY_CONFLICT"
  | "DEADLINE_EXCEEDED"
  | "ENGINE_FAULT";

export class HostError extends Error {
  readonly retryable: boolean;
  readonly code: HostErrorCode;
  constructor(code: HostErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "HostError";
    this.code = code;
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
    ...(battle.suspension !== undefined && battle.suspension !== null ? { suspension: battle.suspension } : {}),
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
  if (core.suspension !== undefined && core.suspension !== null) battle.suspension = core.suspension;
  else delete (battle as { suspension?: unknown }).suspension;
  battle.terminal = core.terminal;
}
