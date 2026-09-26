/**
 * BattleStore —— node:sqlite 持久化层。
 * 纪律：每次写入单元都是独立事务；resolve 的结果（battle state + events +
 * resolved_input + receipts 标记）在同一事务提交，保证"commit 后 ACK 前崩溃"
 * 恢复语义可复现。
 */
import { DatabaseSync } from "node:sqlite";
import type { BattleState, InternalEvent, ResolvedInput } from "@seer/contracts/internal";
import { canonicalJson } from "@seer/contracts";
import { sha256hex } from "@seer/battle-core";
import type { SubmissionRecord } from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS battles (
  battle_id   TEXT PRIMARY KEY,
  init_json   TEXT NOT NULL,          -- init 后的 CoreState snapshot（replay 起点）
  state_json  TEXT NOT NULL,          -- 当前权威 internal BattleState（canonical）
  meta_json   TEXT NOT NULL           -- {seqCounter, publicSeq, publicStreamJson 不重放——重放由 publicStream 表}
);
CREATE TABLE IF NOT EXISTS internal_events (
  battle_id TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  json      TEXT NOT NULL,
  PRIMARY KEY (battle_id, seq)
);
CREATE TABLE IF NOT EXISTS public_stream (
  battle_id TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  json      TEXT NOT NULL,
  PRIMARY KEY (battle_id, seq)
);
CREATE TABLE IF NOT EXISTS receipts (
  battle_id        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  json             TEXT NOT NULL,
  PRIMARY KEY (battle_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS resolved_inputs (
  battle_id   TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  json        TEXT NOT NULL,
  state_hash  TEXT NOT NULL,          -- 该 transition 之后的 canonical state hash
  PRIMARY KEY (battle_id, decision_id)
);
`;

export class StoreError extends Error {
  readonly code = "STORE_ERROR";
}

export class BattleStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    // 单进程嵌入式使用——不用 WAL（Windows 下 close() 清理 wal/shm 会 EPERM）
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 建局：init snapshot + 初始权威态一事务写入。 */
  createBattle(
    battleId: string,
    initJson: string,
    stateJson: string,
    meta: { seqCounter: number; publicSeq: number },
  ): void {
    this.tx(() => {
      this.db.prepare("INSERT INTO battles VALUES (?,?,?,?)").run(
        battleId,
        initJson,
        stateJson,
        canonicalJson(meta),
      );
    });
  }

  /** 提交受理事务：receipt + input-received 内部事件 + state_json（含 inbox）+ meta。 */
  recordReceiptTx(
    battleId: string,
    rec: SubmissionRecord,
    stateJson: string,
    newInternal: InternalEvent[],
    meta: { seqCounter: number; publicSeq: number },
  ): void {
    this.tx(() => {
      this.db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(battleId, rec.idempotencyKey, canonicalJson(rec));
      const insI = this.db.prepare("INSERT OR IGNORE INTO internal_events VALUES (?,?,?)");
      for (const e of newInternal) insI.run(battleId, e.seq, canonicalJson(e));
      this.db.prepare("UPDATE battles SET state_json=?, meta_json=? WHERE battle_id=?").run(stateJson, canonicalJson(meta), battleId);
    });
  }

  /** 超时事务：多个 timeout receipt + input-received(timedOut) 事件 + state + meta。 */
  recordTimeoutTx(
    battleId: string,
    recs: SubmissionRecord[],
    stateJson: string,
    newInternal: InternalEvent[],
    meta: { seqCounter: number; publicSeq: number },
  ): void {
    this.tx(() => {
      const insR = this.db.prepare("INSERT OR IGNORE INTO receipts VALUES (?,?,?)");
      for (const r of recs) insR.run(battleId, r.idempotencyKey, canonicalJson(r));
      const insI = this.db.prepare("INSERT OR IGNORE INTO internal_events VALUES (?,?,?)");
      for (const e of newInternal) insI.run(battleId, e.seq, canonicalJson(e));
      this.db.prepare("UPDATE battles SET state_json=?, meta_json=? WHERE battle_id=?").run(stateJson, canonicalJson(meta), battleId);
    });
  }

  /** 决策开启等只产事件的提交。 */
  commitEventsOnly(
    battleId: string,
    stateJson: string,
    newInternal: InternalEvent[],
    newPublic: { seq: number; json: string }[],
    meta: { seqCounter: number; publicSeq: number },
  ): void {
    this.tx(() => {
      const insI = this.db.prepare("INSERT OR IGNORE INTO internal_events VALUES (?,?,?)");
      for (const e of newInternal) insI.run(battleId, e.seq, canonicalJson(e));
      const insP = this.db.prepare("INSERT OR IGNORE INTO public_stream VALUES (?,?,?)");
      for (const p of newPublic) insP.run(battleId, p.seq, p.json);
      this.db.prepare("UPDATE battles SET state_json=?, meta_json=? WHERE battle_id=?").run(stateJson, canonicalJson(meta), battleId);
    });
  }

  /**
   * resolve 原子提交：新权威态 + 新增内部事件 + 新增公开流条目 + resolvedInput。
   * 若该 decision 已 resolved（崩溃恢复重放）→ 不重复写。
   */
  commitResolution(
    battleId: string,
    stateJson: string,
    newInternal: InternalEvent[],
    newPublic: { seq: number; json: string }[],
    resolved: ResolvedInput,
    meta: { seqCounter: number; publicSeq: number },
    stateHash: string,
  ): void {
    this.tx(() => {
      this.db.prepare("UPDATE battles SET state_json=?, meta_json=? WHERE battle_id=?").run(
        stateJson,
        canonicalJson(meta),
        battleId,
      );
      const insI = this.db.prepare("INSERT OR IGNORE INTO internal_events VALUES (?,?,?)");
      for (const e of newInternal) insI.run(battleId, e.seq, canonicalJson(e));
      const insP = this.db.prepare("INSERT OR IGNORE INTO public_stream VALUES (?,?,?)");
      for (const p of newPublic) insP.run(battleId, p.seq, p.json);
      this.db.prepare("INSERT OR IGNORE INTO resolved_inputs VALUES (?,?,?,?,?)").run(
        battleId,
        resolved.decisionId,
        resolved.resolvedSeq,
        canonicalJson(resolved),
        stateHash,
      );
    });
  }

  /** ACK：公开 cursor 前进（持久化在 meta）。 */
  commitMeta(battleId: string, meta: { seqCounter: number; publicSeq: number }, stateJson: string): void {
    this.tx(() => {
      this.db.prepare("UPDATE battles SET state_json=?, meta_json=? WHERE battle_id=?").run(stateJson, canonicalJson(meta), battleId);
    });
  }

  // ---------- 读 ----------

  loadBattle(battleId: string): { initJson: string; stateJson: string; meta: { seqCounter: number; publicSeq: number } } | null {
    const row = this.db.prepare("SELECT * FROM battles WHERE battle_id=?").get(battleId) as Record<string, string> | undefined;
    if (!row) return null;
    return {
      initJson: row["init_json"]!,
      stateJson: row["state_json"]!,
      meta: JSON.parse(row["meta_json"]!) as { seqCounter: number; publicSeq: number },
    };
  }

  loadInternalEvents(battleId: string): InternalEvent[] {
    const rows = this.db.prepare("SELECT json FROM internal_events WHERE battle_id=? ORDER BY seq").all(battleId) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as InternalEvent);
  }

  loadPublicStream(battleId: string): { seq: number; json: string }[] {
    const rows = this.db.prepare("SELECT seq, json FROM public_stream WHERE battle_id=? ORDER BY seq").all(battleId) as { seq: number; json: string }[];
    return rows;
  }

  loadReceipts(battleId: string): SubmissionRecord[] {
    const rows = this.db.prepare("SELECT json FROM receipts WHERE battle_id=?").all(battleId) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as SubmissionRecord);
  }

  loadResolvedInputs(battleId: string): { resolved: ResolvedInput; stateHash: string }[] {
    const rows = this.db.prepare("SELECT json, state_hash FROM resolved_inputs WHERE battle_id=? ORDER BY seq").all(battleId) as { json: string; state_hash: string }[];
    return rows.map((r) => ({ resolved: JSON.parse(r.json) as ResolvedInput, stateHash: r.state_hash }));
  }

  /** 未决提交：inbox 里有但 resolved_inputs 中无该 decision → 恢复时要补 resolve。 */
  pendingDecisionId(battleId: string, state: BattleState): string | null {
    if (state.decision === null) return null;
    const id = state.decision.decisionId;
    const done = this.db.prepare("SELECT 1 FROM resolved_inputs WHERE battle_id=? AND decision_id=?").get(battleId, id);
    return done ? null : id;
  }
}

/** core 口径 hash：剥掉协议字段（inbox/decision/cursors/eventSeq），与 replay 的 applyTurn 输出同口径。 */
export const coreHashOf = (state: BattleState): string => {
  const { inbox: _i, decision: _d, publicCursors: _c, eventSeq: _e, ...rest } = state;
  return `sha256:${sha256hex(canonicalJson(rest))}`;
};
