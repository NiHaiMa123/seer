/**
 * test:protocol — M1-02 Host 协议层 ≥16 场景。
 * 覆盖：双提交/顺序无关/幂等/冲突/已提交/伪侧/过期/超时默认/
 * ACK 隔离/历史投影/隐藏字段不出网/终局拒绝/receipt 过期取回。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost } from "@seer/host";
import type { FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED = "deadbeefdeadbeefdeadbeefdeadbeef";

const mk = (seed = SEED) =>
  new BattleHost({
    pack: PACK,
    battleId: "btl_proto",
    seedHex: seed,
    species: { p1: "syn-alpha", p2: "syn-beta" },
    players: { p1: "alice", p2: "bob" },
    deadlineMs: 10_000,
  });

const cmd = (decisionId: string, actionId: string, key: string, baseRevision = 0) => ({
  battleId: "btl_proto",
  decisionId,
  actionId,
  baseRevision,
  idempotencyKey: key.padEnd(8, "x"),
});
const openDecisionId = (h: BattleHost) => h.state.battle.decision!.decisionId;

describe("decision lifecycle", () => {
  it("init opens decision for both actors with baseRevision 0", () => {
    const h = mk();
    const obs = h.observe("alice");
    expect(obs.decision).not.toBeNull();
    expect(obs.decision!.actors).toEqual(["p1", "p2"]);
    expect(obs.decision!.baseRevision).toBe(0);
    expect(obs.decision!.deadlineMs).toBe(10_000);
  });
  it("both submit → resolve → revision+1, turn 2 decision opens", () => {
    const h = mk();
    const dec = openDecisionId(h);
    expect(h.submit("alice", cmd(dec, "act_syn-strike", "k-alice-1")).ok).toBe(true);
    expect(h.submit("bob", cmd(dec, "act_syn-strike", "k-bob-1")).ok).toBe(true);
    expect(h.state.battle.revision).toBe(1);
    expect(h.state.battle.turn).toBe(2);
    expect(h.state.battle.decision!.decisionId).toContain("t2");
    const d2 = h.state.internalEvents.filter((e) => e.type === "damage");
    expect(d2).toHaveLength(2);
  });
  it("submission order swap → identical final canonical state", () => {
    const h1 = mk();
    const dec1 = openDecisionId(h1);
    h1.submit("alice", cmd(dec1, "act_syn-strike", "k-a1"));
    h1.submit("bob", cmd(dec1, "act_syn-jab", "k-b1"));
    const h2 = mk();
    const dec2 = openDecisionId(h2);
    h2.submit("bob", cmd(dec2, "act_syn-jab", "k-b1"));
    h2.submit("alice", cmd(dec2, "act_syn-strike", "k-a1"));
    // 战斗语义部分一致（events seq 因提交顺序不同→receipt seq 差异在 receipts，不入战斗 canonical）
    const stripProto = (h: BattleHost) => {
      const { inbox: _i, decision: _d, publicCursors: _c, eventSeq: _e, ...battle } = h.state.battle;
      return battle;
    };
    expect(canonicalJson(stripProto(h1))).toBe(canonicalJson(stripProto(h2)));
  });
});

describe("idempotency", () => {
  it("same key + same payload → duplicate-replay, one application", () => {
    const h = mk();
    const dec = openDecisionId(h);
    const r1 = h.submit("alice", cmd(dec, "act_syn-strike", "k-dup-1"));
    const r2 = h.submit("alice", cmd(dec, "act_syn-strike", "k-dup-1"));
    expect(r1.ok && r1.receipt.status).toBe("accepted");
    expect(r2.ok && r2.receipt.status).toBe("duplicate-replay");
    const received = h.state.internalEvents.filter((e) => e.type === "input-received" && e.detail["side"] === "p1");
    expect(received).toHaveLength(1);
  });
  it("same key + different payload → IDEMPOTENCY_CONFLICT", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-conf-1"));
    const r = h.submit("alice", cmd(dec, "act_syn-jab", "k-conf-1"));
    expect(!r.ok && r.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("second distinct key same decision → ALREADY_SUBMITTED", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-a-1"));
    const r = h.submit("alice", cmd(dec, "act_syn-jab", "k-a-2"));
    expect(!r.ok && r.error.code).toBe("ALREADY_SUBMITTED");
  });
  it("exact repeat after decision closed → stored receipt, not conflict", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-old-1"));
    h.submit("bob", cmd(dec, "act_syn-strike", "k-b-old"));
    const after = h.submit("alice", cmd(dec, "act_syn-strike", "k-old-1"));
    expect(after.ok && after.receipt.status).toBe("duplicate-replay");
    expect(after.ok && after.receipt.resolved).toBe(true);
  });
});

describe("rejection paths", () => {
  it("unbound player → UNAUTHORIZED", () => {
    const h = mk();
    const r = h.submit("mallory", cmd(openDecisionId(h), "act_syn-strike", "k-m-1"));
    expect(!r.ok && r.error.code).toBe("UNAUTHORIZED");
  });
  it("stale decisionId → STALE_DECISION", () => {
    const h = mk();
    const r = h.submit("alice", cmd("dec_btl_proto-t9", "act_syn-strike", "k-st-1"));
    expect(!r.ok && r.error.code).toBe("STALE_DECISION");
  });
  it("baseRevision mismatch → STALE_DECISION", () => {
    const h = mk();
    const r = h.submit("alice", cmd(openDecisionId(h), "act_syn-strike", "k-br-1", 7));
    expect(!r.ok && r.error.code).toBe("STALE_DECISION");
  });
  it("malformed actionId → INVALID_SCHEMA", () => {
    const h = mk();
    const r = h.submit("alice", cmd(openDecisionId(h), "nope", "k-bad-1"));
    expect(!r.ok && r.error.code).toBe("INVALID_SCHEMA");
  });
  it("short idempotencyKey → INVALID_SCHEMA", () => {
    const h = mk();
    const r = h.submit("alice", { ...cmd(openDecisionId(h), "act_syn-strike", "valid-key"), idempotencyKey: "short" });
    expect(!r.ok && r.error.code).toBe("INVALID_SCHEMA");
  });
  it("illegal action for side (struggle with PP left) → ILLEGAL_ACTION", () => {
    const h = mk();
    const r = h.submit("alice", cmd(openDecisionId(h), "act_struggle", "k-ill-1"));
    expect(!r.ok && r.error.code).toBe("ILLEGAL_ACTION");
  });
  it("battleId mismatch → NOT_FOUND", () => {
    const h = mk();
    const r = h.submit("alice", { ...cmd(openDecisionId(h), "act_syn-strike", "k-nf-1"), battleId: "btl_other" });
    expect(!r.ok && r.error.code).toBe("NOT_FOUND");
  });
});

describe("timeout", () => {
  it("one side submits, other expires → timeout_default resolves with §9 default", () => {
    const h = mk();
    h.submit("alice", cmd(openDecisionId(h), "act_syn-strike", "k-a-t1"));
    h.expireDecision();
    // bob 未提交 → 默认 act_syn-bolster（字典序最小 move）
    const stages = h.state.battle.sides.p2.unit.stages;
    expect(stages.atk).toBe(1);
    const timedOut = h.state.internalEvents.find((e) => e.type === "input-received" && e.detail["timedOut"] === true);
    expect(timedOut!.detail["side"]).toBe("p2");
  });
  it("neither submits → expire resolves both via default", () => {
    const h = mk();
    h.expireDecision();
    expect(h.state.battle.revision).toBe(1);
    expect(h.state.battle.turn).toBe(2);
    expect(h.state.battle.sides.p1.unit.stages.atk).toBe(1);
    expect(h.state.battle.sides.p2.unit.stages.atk).toBe(1);
  });
});

describe("observation isolation", () => {
  it("A ack advances only A's cursor; B's observation canonical-unchanged", () => {
    const h = mk();
    const before = canonicalJson(h.observe("bob"));
    h.ack("alice", h.state.publicSeq);
    const after = canonicalJson(h.observe("bob"));
    expect(after).toBe(before);
    // 公开 seq 只数白名单事件：eventSeq=2（turn-begin+decision-opened）但 cursor=1
    expect(h.state.battle.eventSeq).toBe(2);
    expect(h.state.battle.publicCursors.p1).toBe(1);
    expect(h.state.battle.publicCursors.p2).toBe(0);
  });
  it("own PP visible, opponent PP never projected", () => {
    const h = mk();
    const obs = h.observe("alice");
    expect(obs.own.ppByMoveId["syn-strike"]).toBe(35);
    expect(obs.opponent.ppEstimate).toEqual({ kind: "unknown" });
    // 对手字段里没有 pp/moves/seed 字样
    const foe = obs.opponent as unknown as Record<string, unknown>;
    expect(Object.keys(foe).sort()).toEqual(["effects", "hp", "ppEstimate", "revealedMoveIds", "speciesId", "stages", "unitId"].sort());
  });
  it("public history contains no internal-only event types or fields", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-h-1"));
    h.submit("bob", cmd(dec, "act_syn-bolster", "k-h-2"));
    const { events } = h.history("bob", 0);
    const types = events.map((e) => e.type);
    expect(types).not.toContain("pp-spent");
    expect(types).not.toContain("rng-draw");
    expect(types).not.toContain("input-received");
    for (const e of events) {
      expect(JSON.stringify(e)).not.toMatch(/ppAfter|canonicalDigest|receiptId|seedHex|drawCounter/);
    }
    expect(types).toContain("turn-begin");
    expect(types).toContain("action-declared");
    expect(types).toContain("damage");
  });
});

describe("revealed moves & terminal", () => {
  it("action-declared reveals moveId to opponent view", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-r-1"));
    h.submit("bob", cmd(dec, "act_syn-jab", "k-r-2"));
    const obs = h.observe("alice");
    expect(obs.opponent.revealedMoveIds).toContain("syn-jab");
    const obsB = h.observe("bob");
    expect(obsB.opponent.revealedMoveIds).toContain("syn-strike");
  });
  it("submission on terminal battle → STALE_DECISION", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_concede", "k-term-1"));
    h.submit("bob", cmd(dec, "act_syn-strike", "k-term-2"));
    expect(h.state.battle.terminal).not.toBeNull();
    const r = h.submit("alice", cmd(`dec_btl_proto-t2`, "act_syn-strike", "k-term-3"));
    expect(!r.ok && r.error.code).toBe("STALE_DECISION");
  });
  it("key replay on a new decision is fine (different key namespace)", () => {
    const h = mk();
    const dec = openDecisionId(h);
    h.submit("alice", cmd(dec, "act_syn-strike", "k-ns-1"));
    h.submit("bob", cmd(dec, "act_syn-strike", "k-ns-2"));
    const dec2 = openDecisionId(h);
    const r = h.submit("alice", cmd(dec2, "act_syn-strike", "k-ns-3", h.state.battle.decision!.baseRevision));
    expect(r.ok).toBe(true);
  });
});
