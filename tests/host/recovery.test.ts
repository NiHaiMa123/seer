/**
 * test:recovery — M1-04：SQLite 持久化 + 崩溃恢复 + replay。
 * 三个断点：收 A 后/收 B 后结算 commit 前/结算 commit 后 ACK 前。
 * 恢复语义：不丢已 ACK 意图、不重复 transition、receipt 可查、视图一致。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir, DeterministicRng, type FrozenPack } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost, replayBattle, type HostConfig } from "@seer/host";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v1");

const tmpDb = () => {
  const dir = mkdtempSync(join(tmpdir(), "seer-test-"));
  return { dir, path: join(dir, "battle.db") };
};

const CFG: Omit<HostConfig, "pack"> = {
  battleId: "btl_rec",
  seedHex: "abcdef0123456789abcdef0123456789",
  species: { p1: "syn-alpha", p2: "syn-beta" },
  players: { p1: "alice", p2: "bob" },
  deadlineMs: 10_000,
};
const cmd = (dec: string, actionId: string, key: string, rev: number, battleId = "btl_rec") => ({
  battleId,
  decisionId: dec,
  actionId,
  baseRevision: rev,
  idempotencyKey: key,
});
const openDec = (h: PersistedBattleHost) => h.host.state.battle.decision!;

describe("crash recovery", () => {
  it("断点1：收 A 后、收 B 前崩溃 → 恢复后 receipt 可查、B 可继续提交", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h1 = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      const dec = openDec(h1).decisionId;
      h1.submit("alice", cmd(dec, "act_syn-strike", "k-a-1", 0));
      // 崩溃：只持久化了 A 的 receipt/inbox，未 resolve
      store.close();

      const store2 = new BattleStore(path);
      const h2 = PersistedBattleHost.restore(store2, { pack: PACK, species: CFG.species, players: CFG.players, deadlineMs: CFG.deadlineMs }, "btl_rec");
      expect(h2.receiptFor("alice", "k-a-1")?.actionId).toBe("act_syn-strike");
      expect(h2.host.state.battle.inbox.p1?.actionId).toBe("act_syn-strike");
      expect(h2.host.state.battle.inbox.p2).toBeNull();
      expect(h2.host.state.battle.decision?.decisionId).toBe(dec);

      // B 提交 → 正常 resolve，不重复 transition
      h2.submit("bob", cmd(dec, "act_syn-jab", "k-b-1", 0));
      expect(h2.host.state.battle.turn).toBe(2);
      expect(h2.host.state.resolvedInputs).toHaveLength(1);
      store2.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("断点2：收 B 后、结算 commit 前崩溃 → 恢复补 resolve 且事件不重复", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h1 = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      const dec = openDec(h1).decisionId;
      h1.submit("alice", cmd(dec, "act_syn-strike", "k-a-1", 0));

      // 模拟 "B 的 receipt 已持久化、resolve 未提交"：直接往 store 写 B 的 receipt + inbox 态
      const b = h1.host.state.battle;
      const bRec = {
        decisionId: dec,
        side: "p2" as const,
        actionId: "act_syn-jab",
        origin: "player" as const,
        idempotencyKey: "k-b-1",
        baseRevision: 0,
        receiptId: "rcpt_9",
        canonicalDigest: "sha256:" + "0".repeat(64),
        acceptedSeq: b.eventSeq + 1,
      };
      b.inbox.p2 = { actionId: "act_syn-jab", idempotencyKey: "k-b-1", canonicalDigest: bRec.canonicalDigest, receiptId: "rcpt_9", receivedSeq: bRec.acceptedSeq };
      store.recordReceiptTx("btl_rec", bRec, canonicalJson(b), [], { seqCounter: h1.host.state.seqCounter, publicSeq: h1.host.state.publicSeq });
      store.close();

      const store2 = new BattleStore(path);
      const h2 = PersistedBattleHost.restore(store2, { pack: PACK, species: CFG.species, players: CFG.players, deadlineMs: CFG.deadlineMs }, "btl_rec");
      // 恢复补跑了 resolve：turn=2，resolvedInputs=1，事件 seq 连续无重复
      expect(h2.host.state.battle.turn).toBe(2);
      expect(h2.host.state.resolvedInputs).toHaveLength(1);
      const seqs = h2.host.state.internalEvents.map((e) => e.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(h2.host.state.battle.sides.p2.unit.currentHp).toBe(118); // strike 22
      store2.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("断点3：结算 commit 后、ACK 前崩溃 → 恢复不重复 resolve，ACK 正常推进", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h1 = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      const dec = openDec(h1).decisionId;
      h1.submit("alice", cmd(dec, "act_syn-strike", "k-a-1", 0));
      h1.submit("bob", cmd(dec, "act_syn-strike", "k-b-1", 0));
      // 已 commit resolution（state_json 已是 turn2）；未 ack
      store.close();

      const store2 = new BattleStore(path);
      const h2 = PersistedBattleHost.restore(store2, { pack: PACK, species: CFG.species, players: CFG.players, deadlineMs: CFG.deadlineMs }, "btl_rec");
      expect(h2.host.state.battle.turn).toBe(2);
      expect(h2.host.state.resolvedInputs).toHaveLength(1); // 未重复 resolve
      // ACK 恢复后正常工作
      h2.ack("alice", 5);
      expect(h2.host.state.battle.publicCursors.p1).toBe(Math.min(5, h2.host.state.publicSeq));
      store2.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("恢复后观察/历史与崩溃前 canonical 一致", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h1 = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      const dec = openDec(h1).decisionId;
      h1.submit("alice", cmd(dec, "act_syn-strike", "k-a-1", 0));
      const preObs = canonicalJson(h1.observe("alice"));
      const preHist = canonicalJson(h1.history("bob", 0));
      store.close();

      const store2 = new BattleStore(path);
      const h2 = PersistedBattleHost.restore(store2, { pack: PACK, species: CFG.species, players: CFG.players, deadlineMs: CFG.deadlineMs }, "btl_rec");
      expect(canonicalJson(h2.observe("alice"))).toBe(preObs);
      expect(canonicalJson(h2.history("bob", 0))).toBe(preHist);
      store2.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });
});

describe("replay", () => {
  it("≥20 seeded battles replay byte-identical to stored hashes", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const N = 20;
      for (let i = 0; i < N; i++) {
        const seed = (i + 1).toString(16).padStart(32, "0");
        const h = PersistedBattleHost.create(store, { pack: PACK, ...CFG, battleId: `btl_r${i}`, seedHex: seed });
        const driver = new DeterministicRng(seed);
        let turns = 0;
        // 随机策略可能互奶到 turn-limit——cap 220 覆盖 spec 200 上限
        while (h.host.state.battle.terminal === null && turns++ < 220) {
          const dec = openDec(h).decisionId;
          const rev = h.host.state.battle.decision!.baseRevision;
          const pick = (acts: string[]) => acts[driver.drawBelow(acts.length, "pick")]!;
          const a1 = pick(h.observe("alice").legalActions.map((l) => l.actionId));
          const a2 = pick(h.observe("bob").legalActions.map((l) => l.actionId));
          h.submit("alice", cmd(dec, a1, `k-a-${i}-${turns}`, rev, `btl_r${i}`));
          h.submit("bob", cmd(dec, a2, `k-b-${i}-${turns}`, rev, `btl_r${i}`));
        }
        expect(h.host.state.battle.terminal).not.toBeNull();
      }
      for (let i = 0; i < N; i++) {
        const r = replayBattle(store, PACK, `btl_r${i}`);
        expect(r.ok, `battle ${i} replay`).toBe(true);
        if (r.ok) expect(r.turns).toBeGreaterThan(0);
      }
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  }, 60_000);

  it("tampered resolved input → REPLAY_MISMATCH", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      const dec = openDec(h).decisionId;
      h.submit("alice", cmd(dec, "act_syn-strike", "k-a-1", 0));
      h.submit("bob", cmd(dec, "act_syn-jab", "k-b-1", 0));
      // 篡改 resolved input：把 p1 的 actionId 换掉
      store.db.prepare("UPDATE resolved_inputs SET json=? WHERE battle_id=?").run(
        canonicalJson({ decisionId: dec, baseRevision: 0, resolvedSeq: 99, actions: { p1: { actionId: "act_syn-jab", origin: "player", idempotencyKey: "k-a-1" }, p2: { actionId: "act_syn-jab", origin: "player", idempotencyKey: "k-b-1" } } }),
        "btl_rec",
      );
      const r = replayBattle(store, PACK, "btl_rec");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("REPLAY_MISMATCH");
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("corrupt init snapshot → MALFORMED_RECORD", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      store.db.prepare("UPDATE battles SET init_json=? WHERE battle_id=?").run('{"broken":true}', "btl_rec");
      const r = replayBattle(store, PACK, "btl_rec");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("MALFORMED_RECORD");
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("missing battle → ARTIFACT_UNAVAILABLE", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const r = replayBattle(store, PACK, "btl_ghost");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("ARTIFACT_UNAVAILABLE");
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });

  it("ruleset artifact mismatch (tampered rules hash) → ARTIFACT_UNAVAILABLE", () => {
    const { dir, path } = tmpDb();
    try {
      const store = new BattleStore(path);
      const h = PersistedBattleHost.create(store, { pack: PACK, ...CFG });
      // 篡改存储的 rulesetHash
      const b = h.host.state.battle;
      const tampered = { ...b, rules: { ...b.rules, rulesetHash: "sha256:" + "f".repeat(64) } };
      store.db.prepare("UPDATE battles SET state_json=? WHERE battle_id=?").run(canonicalJson(tampered), "btl_rec");
      const r = replayBattle(store, PACK, "btl_rec");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("ARTIFACT_UNAVAILABLE");
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows 句柄延迟：交给 OS 回收 */ }
    }
  });
});
