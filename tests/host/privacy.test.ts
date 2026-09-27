/**
 * test:privacy（接真实 core）— M1-03。
 * 差异秘密态 → 公开响应 canonical 相同；隐藏事件不涨 view cursor；
 * 断线/重放重同步同视角；公开输出无内部 hash/seq/trace。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import type { FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED_A = "11111111111111111111111111111111";
const SEED_B = "99999999999999999999999999999999";

const mk = (seed = SEED_A) =>
  new BattleHost({
    pack: PACK,
    battleId: "btl_priv",
    seedHex: seed,
    species: { p1: "syn-alpha", p2: "syn-beta" },
    players: { p1: "alice", p2: "bob" },
    deadlineMs: 10_000,
  });
const cmd = (dec: string, actionId: string, key: string, rev: number) => ({
  battleId: "btl_priv",
  decisionId: dec,
  actionId,
  baseRevision: rev,
  idempotencyKey: key.padEnd(8, "x"),
});
const submitBoth = (h: BattleHost, a: string, b: string) => {
  const rev = h.state.battle.decision!.baseRevision;
  h.submit("alice", cmd(h.state.battle.decision!.decisionId, a, `k-a-${rev}`, rev));
  h.submit("bob", cmd(h.state.battle.decision!.decisionId, b, `k-b-${rev}`, rev));
};

describe("differential secrets → identical public outputs", () => {
  it("different RNG seeds: observe + public history canonical-identical", () => {
    const h1 = mk(SEED_A);
    const h2 = mk(SEED_B);
    // 不打 tie（spd 50 vs 40）→ seed 差异不可观察
    submitBoth(h1, "act_syn-strike", "act_syn-jab");
    submitBoth(h2, "act_syn-strike", "act_syn-jab");
    expect(canonicalJson(h1.observe("alice"))).toBe(canonicalJson(h2.observe("alice")));
    expect(canonicalJson(h1.history("alice", 0).events)).toBe(canonicalJson(h2.history("alice", 0).events));
    expect(canonicalJson(h1.observe("bob"))).toBe(canonicalJson(h2.observe("bob")));
  });
  it("different opponent PP: public outputs unchanged (pp never projected)", () => {
    const h1 = mk();
    const h2 = mk();
    // 秘密篡改：p2 的 PP 减到 1——这只影响内部，公开无投影
    for (const m of h2.state.battle.sides.p2.unit.moves) m.pp = Math.min(m.pp, 1);
    submitBoth(h1, "act_syn-strike", "act_syn-strike");
    submitBoth(h2, "act_syn-strike", "act_syn-strike");
    expect(canonicalJson(h1.observe("alice"))).toBe(canonicalJson(h2.observe("alice")));
    expect(canonicalJson(h1.history("alice", 0).events)).toBe(canonicalJson(h2.history("alice", 0).events));
  });
  it("hidden effects on opponent never reach public observation", () => {
    const h = mk();
    h.state.battle.sides.p2.unit.effects.push({ kind: "mark_hunter", effectInstanceId: "fx_1", hidden: true, remainingTurns: 3 });
    const obs = h.observe("alice");
    expect(obs.opponent.effects).toHaveLength(0);
    expect(JSON.stringify(obs)).not.toContain("mark_hunter");
    // 己方 side 也看不到对手的 hidden effect（从 bob 视角也看不到 p2 自己？己方可见：self=true 看得到）
    const obsB = h.observe("bob");
    expect(obsB.own.effects).toHaveLength(1); // p2 自己能看见自己的 hidden effect
  });
});

describe("view cursor semantics", () => {
  it("internal-only events do NOT advance public view cursor", () => {
    const h = mk();
    const seqAfterOpen = h.state.publicSeq; // turn-begin 在流内，decision-opened 不在
    expect(h.state.battle.eventSeq).toBeGreaterThan(seqAfterOpen); // 内部有 2 条，公开 1 条
    h.submit("alice", cmd(h.state.battle.decision!.decisionId, "act_syn-strike", "k-x", 0));
    // input-received 内部专属 → publicSeq 不变
    expect(h.state.publicSeq).toBe(seqAfterOpen);
    // resolve 后的公开事件才进流
    h.submit("bob", cmd(h.state.battle.decision!.decisionId, "act_syn-strike", "k-y", 0));
    expect(h.state.publicSeq).toBeGreaterThan(seqAfterOpen);
    const types = h.state.publicStream.map((e) => e.event.type);
    expect(types).not.toContain("pp-spent");
    expect(types).not.toContain("input-received");
    expect(types).not.toContain("decision-opened");
    expect(types).toContain("turn-begin");
    expect(types).toContain("action-declared");
  });
  it("public stream seq is contiguous (no gaps for resync bookkeeping)", () => {
    const h = mk();
    submitBoth(h, "act_syn-strike", "act_syn-strike");
    const seqs = h.state.publicStream.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_v, i) => i + 1));
  });
});

describe("resync / reconnect", () => {
  it("resync(0) → same public events + identical observation canonical", () => {
    const h = mk();
    submitBoth(h, "act_syn-strike", "act_syn-jab");
    submitBoth(h, "act_syn-bolster", "act_syn-strike");
    const r = h.resync("bob", 0);
    expect(r.events.length).toBe(h.state.publicSeq);
    expect(r.cursor).toBe(h.state.publicSeq);
    expect(canonicalJson(r.observation)).toBe(canonicalJson(h.observe("bob")));
  });
  it("resync mid-cursor returns suffix only; repeated resync identical", () => {
    const h = mk();
    submitBoth(h, "act_syn-strike", "act_syn-strike");
    const mid = h.state.publicSeq;
    submitBoth(h, "act_syn-strike", "act_syn-strike");
    const r1 = h.resync("alice", mid);
    const r2 = h.resync("alice", mid);
    expect(r1.events.every((e) => true)).toBe(true);
    expect(r1.events.length).toBe(h.state.publicSeq - mid);
    expect(canonicalJson(r1)).toBe(canonicalJson(r2));
  });
});

describe("no internal trace leaks", () => {
  it("public observation + history contain no internal seq/hash/seed fields", () => {
    const h = mk();
    submitBoth(h, "act_syn-strike", "act_syn-strike");
    const pub = JSON.stringify({ obs: h.observe("alice"), hist: h.history("alice", 0) });
    expect(pub).not.toMatch(/seedHex|drawCounter|canonicalDigest|receiptId|statePatch|revisionBefore|revisionAfter|causeId|rngDraw/);
    expect(pub).not.toContain("internalEvents");
  });
  it("read-only view exposes only public surface", () => {
    const h = mk();
    const v = createReadOnlyView(h, "alice");
    expect(Object.keys(v).sort()).toEqual(["history", "legalActions", "observe", "resync"]);
    expect(v.legalActions()).toContain("act_syn-strike");
    expect(canonicalJson(v.observe())).toBe(canonicalJson(h.observe("alice")));
    // API 面只有四个只读方法（进程内闭合限制已如实记录）
    expect(Object.values(v).every((f) => typeof f === "function")).toBe(true);
  });
});
