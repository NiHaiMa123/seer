/**
 * PersistedBattleHost —— BattleHost + BattleStore 事务化。
 * 写序纪律：
 *   submit     → tx1{receipt+input事件+state(inbox)+meta} → 若收齐则 resolve →
 *                tx2{state+新增事件+公开流+resolvedInput+stateHash}
 *   expire     → 同上（timeout receipt 一并入 tx）
 *   ack        → tx{state(cursors)+meta}
 * 崩溃恢复：restore() 从 store 重建 HostState；若有未决 inbox 且无
 * resolvedInput → 补跑确定性 resolve（事件按恢复的 seqCounter 续号，
 * INSERT OR IGNORE 保证幂等）。
 */
import type { Command, Observation, BattleEvent } from "@seer/contracts";
import type { InternalEvent, ResolvedInput } from "@seer/contracts/internal";
import { canonicalJson } from "@seer/contracts";
import type { FrozenPack } from "@seer/battle-core";
import { BattleHost } from "./host.ts";
import { BattleStore, StoreError, coreHashOf } from "./store.ts";
import { HostError, type HostConfig, type HostState, type SubmitResult, type SubmissionRecord } from "./types.ts";
import type { BattleState } from "@seer/contracts/internal";
import type { BattleEvent as PublicEv } from "@seer/contracts";

export class PersistedBattleHost {
  readonly host: BattleHost;
  readonly store: BattleStore;
  private lastCommittedInternalSeq = 0;
  private lastCommittedPublicSeq = 0;
  private lastCommittedResolved = 0;

  private constructor(host: BattleHost, store: BattleStore) {
    this.host = host;
    this.store = store;
  }

  static create(store: BattleStore, cfg: HostConfig): PersistedBattleHost {
    const host = new BattleHost(cfg);
    const w = new PersistedBattleHost(host, store);
    const b = host.state.battle;
    store.createBattle(
      cfg.battleId,
      canonicalJson(w.initSnapshot(cfg)),
      canonicalJson(b),
      { seqCounter: host.state.seqCounter, publicSeq: host.state.publicSeq },
    );
    w.commitOpenDecision();
    return w;
  }

  private initSnapshot(cfg: HostConfig) {
    // 持久 init 快照 = 当前 battle 减去协议字段（CoreState 形状）
    return {
      schemaVersion: 1,
      battleId: cfg.battleId,
      rules: this.host.state.battle.rules,
      revision: 0,
      turn: 1,
      phase: "collect",
      rng: this.host.state.battle.rng,
      sides: this.host.state.battle.sides,
      speedTiebreak: null,
      terminal: null,
    };
  }

  /** 恢复：从 store 重建；未决完整 inbox → 补 resolve。 */
  static restore(store: BattleStore, cfg: Omit<HostConfig, "battleId" | "seedHex">, battleId: string): PersistedBattleHost {
    const row = store.loadBattle(battleId);
    if (!row) throw new StoreError(`battle ${battleId} not found`);
    const battle = JSON.parse(row.stateJson) as BattleState;
    const receipts = new Map(store.loadReceipts(battleId).map((r) => [r.idempotencyKey, r]));
    const internalEvents = store.loadInternalEvents(battleId);
    const publicStream = store.loadPublicStream(battleId).map((p) => ({ seq: p.seq, event: JSON.parse(p.json) as PublicEv }));
    const resolvedInputs = store.loadResolvedInputs(battleId).map((r) => r.resolved);
    const state: HostState = {
      battle,
      internalEvents,
      publicStream,
      publicSeq: row.meta.publicSeq,
      receipts,
      resolvedInputs,
      seqCounter: row.meta.seqCounter,
    };
    const seedHex = battle.rng.seedHex;
    const host = new BattleHost(
      { ...cfg, battleId, seedHex },
      state,
    );
    const w = new PersistedBattleHost(host, store);
    w.lastCommittedInternalSeq = internalEvents.length === 0 ? 0 : internalEvents[internalEvents.length - 1]!.seq;
    w.lastCommittedPublicSeq = publicStream.length === 0 ? 0 : publicStream[publicStream.length - 1]!.seq;
    w.lastCommittedResolved = resolvedInputs.length;

    // 崩溃恢复：decision 开着 + inbox 已收齐 + 无 resolvedInput → 补 resolve
    const pending = store.pendingDecisionId(battleId, battle);
    const inboxComplete = battle.inbox.p1 !== null && battle.inbox.p2 !== null;
    if (pending !== null && inboxComplete) {
      w.resolveAndCommit();
    }
    return w;
  }

  // ---------- 公开 API（委托 + 持久化） ----------

  observe(playerId: string): Observation {
    return this.host.observe(playerId);
  }
  history(playerId: string, sinceSeq = 0): { cursor: number; events: BattleEvent[] } {
    return this.host.history(playerId, sinceSeq);
  }
  resync(playerId: string, sinceSeq = 0): { cursor: number; events: BattleEvent[]; observation: Observation } {
    return this.host.resync(playerId, sinceSeq);
  }
  receiptFor(playerId: string, key: string): SubmissionRecord | undefined {
    return this.host.receiptFor(playerId, key);
  }

  submit(playerId: string, cmd: Omit<Command, "schemaVersion">): SubmitResult {
    const beforeInternal = this.lastCommittedInternalSeq;
    const r = this.host.submit(playerId, cmd);
    if (!r.ok) return r;
    // duplicate-replay：服务端已有同 key 记录——不重插 receipt，也不写新事件
    if (r.receipt.status === "duplicate-replay") return r;

    // tx1: receipt + input-received 事件 + inbox 态
    const newInternal = this.host.state.internalEvents.filter((e) => e.seq > beforeInternal);
    this.store.recordReceiptTx(
      this.host.state.battle.battleId,
      this.lastReceipt(cmd.idempotencyKey)!,
      canonicalJson(this.host.state.battle),
      newInternal,
      { seqCounter: this.host.state.seqCounter, publicSeq: this.host.state.publicSeq },
    );
    this.lastCommittedInternalSeq = this.host.state.battle.eventSeq;
    this.commitResolutionIfNeeded();
    return r;
  }

  expireDecision(): void {
    const beforeInternal = this.lastCommittedInternalSeq;
    this.host.expireDecision();
    const b = this.host.state.battle;
    const newInternal = this.host.state.internalEvents.filter((e) => e.seq > beforeInternal);
    const timeoutReceipts = [...this.host.state.receipts.values()].filter(
      (rec) => rec.origin === "timeout_default" && rec.acceptedSeq > beforeInternal,
    );
    this.store.recordTimeoutTx(
      b.battleId,
      timeoutReceipts,
      canonicalJson(b),
      newInternal,
      { seqCounter: this.host.state.seqCounter, publicSeq: this.host.state.publicSeq },
    );
    this.lastCommittedInternalSeq = b.eventSeq;
    this.commitResolutionIfNeeded();
  }

  ack(playerId: string, seq: number): number {
    const v = this.host.ack(playerId, seq);
    this.store.commitMeta(this.host.state.battle.battleId, { seqCounter: this.host.state.seqCounter, publicSeq: this.host.state.publicSeq }, canonicalJson(this.host.state.battle));
    return v;
  }

  // ---------- 内部 ----------

  private lastReceipt(key: string): SubmissionRecord | undefined {
    return this.host.state.receipts.get(key);
  }

  /** 供恢复路径调用：未决完整 inbox → resolve + commit。 */
  private resolveAndCommit(): void {
    this.host.resolveNow();
    this.commitResolutionIfNeeded();
  }

  private commitResolutionIfNeeded(): void {
    const b = this.host.state.battle;
    const resolvedCount = this.host.state.resolvedInputs.length;
    if (resolvedCount <= this.lastCommittedResolved) return; // 无新 resolution
    const resolved = this.host.state.resolvedInputs[resolvedCount - 1]!;
    const newInternal = this.host.state.internalEvents.filter((e) => e.seq > this.lastCommittedInternalSeq);
    const newPublic = this.host.state.publicStream
      .filter((p) => p.seq > this.lastCommittedPublicSeq)
      .map((p) => ({ seq: p.seq, json: canonicalJson(p.event) }));
    this.store.commitResolution(
      b.battleId,
      canonicalJson(b),
      newInternal,
      newPublic,
      resolved,
      { seqCounter: this.host.state.seqCounter, publicSeq: this.host.state.publicSeq },
      coreHashOf(b),
    );
    this.lastCommittedInternalSeq = b.eventSeq;
    this.lastCommittedPublicSeq = this.host.state.publicSeq;
    this.lastCommittedResolved = resolvedCount;
  }

  /** 决策开启产生的事件（turn-begin/decision-opened）也要持久化。 */
  private commitOpenDecision(): void {
    const b = this.host.state.battle;
    const newInternal = this.host.state.internalEvents.filter((e) => e.seq > this.lastCommittedInternalSeq);
    const newPublic = this.host.state.publicStream
      .filter((p) => p.seq > this.lastCommittedPublicSeq)
      .map((p) => ({ seq: p.seq, json: canonicalJson(p.event) }));
    if (newInternal.length === 0) return;
    this.store.commitEventsOnly(
      b.battleId,
      canonicalJson(b),
      newInternal,
      newPublic,
      { seqCounter: this.host.state.seqCounter, publicSeq: this.host.state.publicSeq },
    );
    this.lastCommittedInternalSeq = b.eventSeq;
    this.lastCommittedPublicSeq = this.host.state.publicSeq;
  }

  /** resolve 后的下一决策也在 resolve 内 openDecision —— 上面 commitResolution 已把新 open 事件一并写入（内部与公开流增量）。 */
}

/** HostError re-export for callers。 */
export { HostError };
export type { ResolvedInput };
export type { InternalEvent };
