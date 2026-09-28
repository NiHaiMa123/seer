/**
 * Host：单局权威 Authority —— 玩家绑定、decision 生命周期、
 * private inbox、幂等/receipt、timeout 策略、事件 seq/cursor。
 * 不接 wall-clock：deadline 是逻辑字段；超时由调用方驱动 expireDecision。
 * 单线程内顺序处理（每 resolve 是原子的）。
 */
import type { Command, Observation, BattleEvent } from "@seer/contracts";
import type { InternalEvent, ResolvedInput } from "@seer/contracts/internal";
import { canonicalJson } from "@seer/contracts";
import { legalActions as coreLegalActions, sha256hex, type FrozenPack, type SideId } from "@seer/battle-core";
import {
  ExecutorError,
  InProcessTransitionExecutor,
  assertCoreState,
  assertExecutorBinding,
  assertLegalActionIds,
  assertTransitionResult,
  type TransitionExecutor,
} from "./executor.ts";
import { HostError, type HostConfig, type HostState, type SubmissionRecord, type SubmitResult, toCore, fromCore } from "./types.ts";
import { wrapEvent, projectEvent } from "./events.ts";
import { projectObservation, projectHistory } from "./project.ts";

const SIDES: SideId[] = ["p1", "p2"];

export class BattleHost {
  readonly state: HostState;
  private readonly pack: FrozenPack;
  private readonly executor: TransitionExecutor;
  private readonly players: Readonly<Record<SideId, string>>;
  private readonly deadlineMs: number;
  private readonly byPlayer: Map<string, SideId>;

  constructor(cfg: HostConfig, restored?: HostState) {
    this.pack = cfg.pack;
    this.executor = cfg.executor ?? new InProcessTransitionExecutor(cfg.pack.rules.executableHash);
    assertExecutorBinding(this.executor, cfg.pack);
    this.players = { p1: cfg.players.p1, p2: cfg.players.p2 };
    this.byPlayer = new Map(SIDES.map((s) => [cfg.players[s], s]));
    this.deadlineMs = cfg.deadlineMs;
    if (restored !== undefined) {
      assertCoreState(toCore(restored.battle), cfg.pack, cfg.battleId);
      this.state = restored;
      return;
    }
    const core = this.executor.init(cfg.pack, {
      battleId: cfg.battleId,
      seedHex: cfg.seedHex,
      p1: cfg.species.p1,
      p2: cfg.species.p2,
      ...(cfg.bench !== undefined ? { bench: cfg.bench } : {}),
      ...(cfg.mechanics !== undefined ? { mechanics: cfg.mechanics } : {}),
    });
    assertCoreState(core, cfg.pack, cfg.battleId);
    if (core.revision !== 0 || core.turn !== 1) throw new ExecutorError("executor init state is malformed");
    this.state = {
      battle: {
        schemaVersion: 1,
        battleId: core.battleId,
        rules: core.rules,
        revision: 0,
        turn: 1,
        phase: "collect",
        rng: core.rng,
        sides: core.sides,
        decision: null,
        inbox: { p1: null, p2: null },
        eventSeq: 0,
        publicCursors: { p1: 0, p2: 0 },
        speedTiebreak: null,
        terminal: null,
      },
      internalEvents: [],
      publicStream: [],
      publicSeq: 0,
      receipts: new Map(),
      resolvedInputs: [],
      seqCounter: 0,
    };
    if (core.terminal === null) this.openDecision();
  }

  private nextSeq(): number {
    return ++this.state.seqCounter;
  }

  private snapshotProtocolState() {
    return {
      battle: structuredClone(this.state.battle),
      receipts: new Map(this.state.receipts),
      internalLength: this.state.internalEvents.length,
      publicLength: this.state.publicStream.length,
      resolvedLength: this.state.resolvedInputs.length,
      publicSeq: this.state.publicSeq,
      seqCounter: this.state.seqCounter,
    };
  }

  private rollbackProtocolState(snapshot: ReturnType<BattleHost["snapshotProtocolState"]>): void {
    this.state.battle = snapshot.battle;
    this.state.receipts = snapshot.receipts;
    this.state.internalEvents.length = snapshot.internalLength;
    this.state.publicStream.length = snapshot.publicLength;
    this.state.resolvedInputs.length = snapshot.resolvedLength;
    this.state.publicSeq = snapshot.publicSeq;
    this.state.seqCounter = snapshot.seqCounter;
  }

  private emit(
    core: { type: InternalEvent["type"]; detail: Record<string, unknown>; rngDraw?: { purpose: string; value: number } },
    revisionBefore: number,
    revisionAfter: number,
    causeId: string | null = null,
  ): InternalEvent {
    const ev = wrapEvent(core, this.nextSeq(), revisionBefore, revisionAfter, causeId);
    this.state.internalEvents.push(ev);
    this.state.battle.eventSeq = ev.seq;
    // 白名单事件 → 公开流（独立 seq）；内部专属事件不进公开流 → 不涨 view cursor
    const projected = projectEvent(ev);
    if (projected !== null) {
      this.state.publicStream.push({ seq: ++this.state.publicSeq, event: projected });
    }
    return ev;
  }

  private openDecision(): void {
    const b = this.state.battle;
    if (b.terminal) {
      b.decision = null;
      return;
    }
    // v2 挂起：replacement decision（仅阵亡方 actor）
    if (b.suspension !== undefined && b.suspension !== null) {
      b.decision = {
        decisionId: `dec_${b.battleId.slice(4)}-r${b.turn}-${b.revision}`,
        kind: "replacement",
        baseRevision: b.revision,
        actors: [b.suspension.koSide],
        deadlineMs: this.deadlineMs,
      };
      b.inbox = { p1: null, p2: null };
      this.emit({ type: "decision-opened", detail: { decisionId: b.decision.decisionId, actors: b.decision.actors, deadlineMs: b.decision.deadlineMs, kind: "replacement" } }, b.revision, b.revision);
      return;
    }
    b.decision = {
      decisionId: `dec_${b.battleId.slice(4)}-t${b.turn}`,
      kind: "turn",
      baseRevision: b.revision,
      actors: SIDES.filter((s) => b.sides[s].unit.currentHp > 0),
      deadlineMs: this.deadlineMs,
    };
    b.inbox = { p1: null, p2: null };
    this.emit({ type: "turn-begin", detail: { turn: b.turn, decisionId: b.decision.decisionId } }, b.revision, b.revision);
    this.emit({ type: "decision-opened", detail: { decisionId: b.decision.decisionId, actors: b.decision.actors, deadlineMs: b.decision.deadlineMs } }, b.revision, b.revision);
  }

  private executeLegalActions(side: SideId): string[] {
    try {
      const actions = this.executor.legalActions(this.pack, toCore(this.state.battle), side);
      assertLegalActionIds(actions);
      const state = this.state.battle.sides[side];
      for (const actionId of actions) {
        if (actionId === "act_concede" || actionId === "act_struggle") continue;
        const switched = /^act_switch-(\d+)$/.exec(actionId);
        if (switched && state.bench?.[Number(switched[1])] !== undefined) continue;
        if (actionId.startsWith("act_") && state.unit.moves.some((move) => move.moveId === actionId.slice(4))) continue;
        throw new ExecutorError(`executor legal action ${actionId} cannot be projected`);
      }
      return actions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HostError("ENGINE_FAULT", `executor fault: ${message}`);
    }
  }

  private sideFor(playerId: string): SideId {
    const s = this.byPlayer.get(playerId);
    if (!s) throw new HostError("UNAUTHORIZED", `player not bound to battle`);
    return s;
  }

  // ---------- 公开 API ----------

  observe(playerId: string): Observation {
    const side = this.sideFor(playerId);
    const battle = this.state.battle;
    const eligible = battle.decision?.actors.includes(side) === true && battle.inbox[side] === null;
    const allowed = eligible ? this.executeLegalActions(side) : [];
    return projectObservation(battle, side, allowed);
  }

  history(playerId: string, sinceSeq = 0): { cursor: number; events: BattleEvent[] } {
    this.sideFor(playerId); // 仅绑定侧可查
    return projectHistory(this.state.publicStream, sinceSeq);
  }

  ack(playerId: string, seq: number): number {
    const side = this.sideFor(playerId);
    const max = this.state.publicSeq;
    this.state.battle.publicCursors[side] = Math.min(Math.max(this.state.battle.publicCursors[side], seq), max);
    return this.state.battle.publicCursors[side];
  }

  /**
   * 断线/丢包重同步入口：返回自 sinceSeq 起的公开事件 + 当前权威观察。
   * 客户端据 seq 连续性可判定是否有缺口；相同 since → 相同输出。
   */
  resync(playerId: string, sinceSeq = 0): { cursor: number; events: BattleEvent[]; observation: Observation } {
    const { cursor, events } = this.history(playerId, sinceSeq);
    return { cursor, events, observation: this.observe(playerId) };
  }

  receiptFor(playerId: string, idempotencyKey: string): SubmissionRecord | undefined {
    const side = this.sideFor(playerId);
    const r = this.state.receipts.get(idempotencyKey);
    return r && r.side === side ? r : undefined; // receipt 只看己方
  }

  submit(playerId: string, cmd: Omit<Command, "schemaVersion">): SubmitResult {
    const fail = (code: ConstructorParameters<typeof HostError>[0], msg: string, retryable = false): SubmitResult => ({
      ok: false,
      error: new HostError(code, msg, retryable),
    });
    let side: SideId;
    try {
      side = this.sideFor(playerId);
    } catch {
      return fail("UNAUTHORIZED", "player not bound to battle");
    }
    const b = this.state.battle;
    if (cmd.battleId !== b.battleId) return fail("NOT_FOUND", "battleId mismatch");

    // 幂等：同 key 先查（精确重复 → 回执重放；异内容 → 冲突）
    const prior = this.state.receipts.get(cmd.idempotencyKey);
    if (prior) {
      if (prior.side !== side) return fail("UNAUTHORIZED", "key owned by other side");
      if (prior.actionId === cmd.actionId && prior.decisionId === cmd.decisionId) {
        return {
          ok: true,
          receipt: { decisionId: prior.decisionId, side, actionId: prior.actionId, baseRevision: prior.baseRevision, status: "duplicate-replay", resolved: b.decision === null || b.decision.decisionId !== prior.decisionId },
        };
      }
      return fail("IDEMPOTENCY_CONFLICT", "same key, different payload");
    }

    const dec = b.decision;
    if (dec === null || b.terminal !== null) return fail("STALE_DECISION", "no open decision");
    if (cmd.decisionId !== dec.decisionId) return fail("STALE_DECISION", `decision ${cmd.decisionId} not open`);
    if (cmd.baseRevision !== dec.baseRevision) return fail("STALE_DECISION", "baseRevision mismatch");
    if (!dec.actors.includes(side)) return fail("UNAUTHORIZED", "side not an actor of this decision");
    if (b.inbox[side] !== null) return fail("ALREADY_SUBMITTED", "side already submitted for this decision");
    if (typeof cmd.idempotencyKey !== "string" || cmd.idempotencyKey.length < 8 || cmd.idempotencyKey.length > 128) return fail("INVALID_SCHEMA", "bad idempotencyKey");
    if (!/^act_[a-z0-9-]{1,60}$/.test(cmd.actionId)) return fail("INVALID_SCHEMA", "bad actionId");
    // Host 侧合法性：actionId ∈ 当前 legal set（双保险；core 仍独立校验）
    const legal = new Set(this.executeLegalActions(side));
    if (!legal.has(cmd.actionId)) return fail("ILLEGAL_ACTION", `${cmd.actionId} not legal for ${side}`);

    const snapshot = this.snapshotProtocolState();
    const canonicalDigest = `sha256:${sha256hex(canonicalJson({ decisionId: dec.decisionId, baseRevision: cmd.baseRevision, actionId: cmd.actionId, idempotencyKey: cmd.idempotencyKey }))}`;
    const rec: SubmissionRecord = {
      decisionId: dec.decisionId,
      side,
      actionId: cmd.actionId,
      origin: "player",
      idempotencyKey: cmd.idempotencyKey,
      baseRevision: cmd.baseRevision,
      receiptId: `rcpt_${this.state.seqCounter + 1}`,
      canonicalDigest,
      acceptedSeq: this.nextSeq(),
    };
    this.state.receipts.set(cmd.idempotencyKey, rec);
    b.inbox[side] = {
      actionId: cmd.actionId,
      idempotencyKey: cmd.idempotencyKey,
      canonicalDigest,
      receiptId: rec.receiptId,
      receivedSeq: rec.acceptedSeq,
    };
    this.emit({ type: "input-received", detail: { side, decisionId: dec.decisionId } }, b.revision, b.revision);

    // 收齐条件：decision.actors 各自的 inbox 都非空（replacement 是单 actor 决策）
    if (dec.actors.every((a) => b.inbox[a] !== null)) {
      try {
        this.resolve();
      } catch (error) {
        this.rollbackProtocolState(snapshot);
        throw error;
      }
    }
    return { ok: true, receipt: { decisionId: rec.decisionId, side, actionId: rec.actionId, baseRevision: rec.baseRevision, status: "accepted", resolved: b.decision === null } };
  }

  /**
   * 超时：未提交的 actor 不产生 inbox 条目（超时没有 actionId/digest/receiptId 可记），
   * 但留下 timeout receipt 痕迹并 resolve——resolved action 为 null → §9 确定默认。
   */
  expireDecision(): void {
    const b = this.state.battle;
    if (b.decision === null || b.terminal !== null) return;
    const snapshot = this.snapshotProtocolState();
    try {
      for (const s of dec_actors(b)) {
        if (b.inbox[s] === null) {
          const seq = this.nextSeq();
          this.state.receipts.set(`timeout_${b.decision!.decisionId}_${s}`, {
            decisionId: b.decision!.decisionId,
            side: s,
            actionId: "(timeout)",
            origin: "timeout_default",
            idempotencyKey: `timeout_${b.decision!.decisionId}_${s}`,
            baseRevision: b.decision!.baseRevision,
            receiptId: `rcpt_${seq}`,
            canonicalDigest: `sha256:${sha256hex(canonicalJson({ decisionId: b.decision!.decisionId, side: s, timedOut: true }))}`,
            acceptedSeq: seq,
          });
          this.emit({ type: "input-received", detail: { side: s, decisionId: b.decision!.decisionId, timedOut: true } }, b.revision, b.revision);
        }
      }
      this.resolve();
    } catch (error) {
      this.rollbackProtocolState(snapshot);
      throw error;
    }
  }

  // ---------- 内部 ----------

  /** 供持久层/恢复路径调用：当前决策已收齐（或强制 resolve）时执行 transition。 */
  resolveNow(): void {
    this.resolve();
  }

  private resolve(): void {
    const b = this.state.battle;
    const dec = b.decision!;
    const resolved: ResolvedInput = {
      decisionId: dec.decisionId,
      baseRevision: dec.baseRevision,
      resolvedSeq: this.nextSeq(),
      actions: {
        // null inbox（timeout）→ null action → §9 确定默认；origin 记录仍保留在 receipts
        p1: b.inbox.p1 === null ? null : { actionId: b.inbox.p1.actionId, origin: "player", idempotencyKey: b.inbox.p1.idempotencyKey },
        p2: b.inbox.p2 === null ? null : { actionId: b.inbox.p2.actionId, origin: "player", idempotencyKey: b.inbox.p2.idempotencyKey },
      },
    };
    const revBefore = b.revision;
    let r;
    try {
      const previous = toCore(b);
      r = b.suspension !== undefined && b.suspension !== null
        ? this.executor.applyReplacement(this.pack, previous, resolved.actions)
        : this.executor.applyTurn(this.pack, previous, resolved.actions);
      assertTransitionResult(r, this.pack, previous);
    } catch (error) {
      const message = error instanceof ExecutorError ? error.message : (error as Error).message;
      throw new HostError("ENGINE_FAULT", `executor fault: ${message}`);
    }
    if (!r.ok) throw new HostError("ENGINE_FAULT", `engine fault: ${r.fault.reason}`);
    fromCore(b, r.state);
    this.state.resolvedInputs.push(resolved);
    // 事件包装（revealedMoveIds 由 core transition 维护——确定性状态的一部分）
    for (const ce of r.events) {
      this.emit(ce, revBefore, b.revision);
    }
    this.openDecision();
  }
}

const dec_actors = (b: HostState["battle"]): SideId[] => b.decision?.actors ?? [];

/** Host 视角 legality：直接复用 core legalActions（switch/suspension 语义已内建）。 */
export function legalActionIds(battle: HostState["battle"], side: SideId): Set<string> {
  return new Set(coreLegalActions(toCore(battle), side));
}
