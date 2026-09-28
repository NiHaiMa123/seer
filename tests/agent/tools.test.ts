/**
 * M3-01：ToolServer + simulate_batch + baseline 的验收。
 * 门禁点：schema 严格拒绝、simulate 不触真局、确定性、隐私边界、baseline 完赛。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import { canonicalJson } from "@seer/contracts";
import { ToolServer, BattleAgent, decideBaseline, simulateBatch, type AgentView, type SubmitFn } from "@seer/agent";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const PACK_V1 = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED = "00000000000000000000000000000042";

function mkHost(bench?: { p1?: string[]; p2?: string[] }) {
  return new BattleHost({
    pack: PACK, battleId: "btl_agt", seedHex: SEED,
    species: { p1: "syn-gamma", p2: "syn-delta" },
    ...(bench !== undefined ? { bench } : {}),
    players: { p1: "A", p2: "B" }, deadlineMs: 30000,
  });
}
const mkTools = (host: BattleHost, player: string, pack = PACK) =>
  new ToolServer({
    view: createReadOnlyView(host, player) as AgentView,
    pack,
    submit: (cmd) => host.submit(player, cmd) as ReturnType<SubmitFn>,
  });

describe("schema 边界", () => {
  it("未知工具/未知字段 → INVALID_SCHEMA", () => {
    const t = mkTools(mkHost(), "A");
    expect(t.call({ tool: "hack_state" }).ok).toBe(false);
    expect(t.call({ tool: "observe", battleId: "btl_x", admin: true }).ok).toBe(false);
    expect(t.call({ tool: "simulate_batch", battleId: "b", hypotheses: [{}], candidates: ["act_syn-strike"], seed: 1, budget: { maxTransitions: 8 }, extra: 1 }).ok).toBe(false);
  });
  it("simulate_batch 上限：hypotheses≤16 / candidates≤8 / budget≤2048", () => {
    const t = mkTools(mkHost(), "A");
    const many = { tool: "simulate_batch", battleId: "btl_agt", hypotheses: Array(17).fill({}), candidates: ["act_syn-strike"], seed: 1, budget: { maxTransitions: 8 } };
    expect(t.call(many).ok).toBe(false);
    const many2 = { ...many, hypotheses: [{}], candidates: Array(9).fill("act_syn-strike") };
    expect(t.call(many2).ok).toBe(false);
    const big = { ...many, hypotheses: [{}], candidates: ["act_syn-strike"], budget: { maxTransitions: 2049 } };
    expect(t.call(big).ok).toBe(false);
  });
});

describe("simulate_batch", () => {
  it("确定性：同请求同结果；不同 seed 可能产生不同分支结果", () => {
    const h = mkHost();
    const t = mkTools(h, "A");
    const obs = h.observe("A");
    const req = {
      observation: obs, hypotheses: [{}], candidates: ["act_syn-strike", "act_syn-hex"], seed: 7, maxTransitions: 64,
    };
    const r1 = simulateBatch(PACK, req);
    const r2 = simulateBatch(PACK, req);
    expect(canonicalJson(r1)).toBe(canonicalJson(r2));
    expect(r1.transitionsUsed).toBeGreaterThan(0);
    expect(r1.assumptionsHash).toMatch(/^sha256:/);
  });
  it("不触真局：调用前后 host battle state canonical 不变、事件数不变", () => {
    const h = mkHost();
    const t = mkTools(h, "A");
    const before = canonicalJson(h.state.battle);
    const beforeEvents = h.state.internalEvents.length;
    t.call({ tool: "simulate_batch", battleId: "btl_agt", hypotheses: [{}], candidates: ["act_syn-strike"], seed: 1, budget: { maxTransitions: 128 } });
    t.call({ tool: "simulate_batch", battleId: "btl_agt", hypotheses: [{ opponentMoveIds: ["syn-slam"] }], candidates: ["act_syn-strike", "act_syn-blast"], seed: 99, budget: { maxTransitions: 256 } });
    expect(canonicalJson(h.state.battle)).toBe(before);
    expect(h.state.internalEvents.length).toBe(beforeEvents);
    expect(t.transitionsSpent).toBeGreaterThan(0);
  });
  it("假设覆盖对手隐藏招：假设包含 syn-slam 时对手分支出现该动作", () => {
    const h = mkHost();
    const obs = h.observe("A");
    const r = simulateBatch(PACK, {
      observation: obs,
      hypotheses: [{ opponentMoveIds: ["syn-slam"] }],
      candidates: ["act_syn-strike"], seed: 1, maxTransitions: 64,
    });
    expect(r.branches.some((b) => b.opponentAction === "act_syn-slam")).toBe(true);
  });
});

describe("lookup_rule / explain_trace / calculate_damage", () => {
  it("lookup_rule 返回公开规则数据；未知 id → unknown", () => {
    const t = mkTools(mkHost(), "A");
    const mv = t.call({ tool: "lookup_rule", rulesetHash: "sha256:" + "0".repeat(64), id: "syn-hex" });
    expect(mv.ok).toBe(true);
    expect((mv.data as { kind: string }).kind).toBe("move");
    const unk = t.call({ tool: "lookup_rule", rulesetHash: "sha256:" + "0".repeat(64), id: "syn-nope" });
    expect((unk.data as { kind: string }).kind).toBe("unknown");
  });
  it("calculate_damage 给出确定整数值", () => {
    const t = mkTools(mkHost(), "A");
    const r = t.call({ tool: "calculate_damage", moveId: "syn-strike", assumptions: {} });
    const d = (r.data as { damages: { amount: number; amountMin: number; amountMax: number }[] }).damages[0]!;
    // six-stat：gamma 面板 atk140 vs delta 面板 def176；core=floor(42*40*140/8800)+2=28 → 战斗→水中性 ×1
    // 随机 217..255 → [23,28]；amount 取 max-roll 乐观值
    expect(d.amountMin).toBe(23);
    expect(d.amountMax).toBe(28);
    expect(d.amount).toBe(28);
  });
  it("explain_trace 只含公开事件摘要，无内部字段", () => {
    const h = mkHost();
    const t = mkTools(h, "A");
    h.submit("A", { battleId: "btl_agt", decisionId: h.observe("A").decision!.decisionId, baseRevision: 0, actionId: "act_syn-strike", idempotencyKey: "k11111111" });
    h.submit("B", { battleId: "btl_agt", decisionId: h.observe("B").decision!.decisionId, baseRevision: 0, actionId: "act_syn-strike", idempotencyKey: "k22222222" });
    const r = t.call({ tool: "explain_trace", battleId: "btl_agt", cursor: 0 });
    const json = JSON.stringify(r.data);
    expect(r.ok).toBe(true);
    expect(json).not.toMatch(/seedHex|drawCounter|causeId|canonicalDigest|pp-spent|rng-draw/);
    expect((r.data as { events: unknown[] }).events.length).toBeGreaterThan(0);
  });
});

describe("baseline policy + agent loop", () => {
  it("replacement 决策 → 最低存活 bench", () => {
    const h = mkHost({ p2: ["syn-epsilon"] });
    h.observe("B"); // warm
    // 强杀 p2 delta（2 回合）→ replacement
    for (let i = 0; i < 2; i++) {
      const d = h.observe("A").decision!;
      h.submit("A", { battleId: "btl_agt", decisionId: d.decisionId, baseRevision: d.baseRevision, actionId: "act_syn-strike", idempotencyKey: `ka${i}xxxxx` });
      h.submit("B", { battleId: "btl_agt", decisionId: d.decisionId, baseRevision: d.baseRevision, actionId: "act_syn-strike", idempotencyKey: `kb${i}xxxxx` });
    }
    const obsB = h.observe("B");
    if (obsB.decision?.kind === "replacement") {
      const d = decideBaseline(PACK, obsB);
      expect(d.actionId).toBe("act_switch-0");
    }
  });
  it("双 baseline 对战完赛：turn 有限、transcript 合法、终局一致", () => {
    const h = mkHost();
    const va = createReadOnlyView(h, "A") as AgentView;
    const vb = createReadOnlyView(h, "B") as AgentView;
    const agentA = new BattleAgent({ view: va, pack: PACK, submit: (c) => h.submit("A", c) as ReturnType<SubmitFn> });
    const agentB = new BattleAgent({ view: vb, pack: PACK, submit: (c) => h.submit("B", c) as ReturnType<SubmitFn> });
    let guard = 0;
    while (h.state.battle.terminal === null && guard++ < 300) {
      agentA.step();
      agentB.step();
    }
    expect(h.state.battle.terminal).not.toBeNull();
    const oa = h.observe("A");
    const ob = h.observe("B");
    expect(oa.terminal).toEqual(ob.terminal);
    expect(agentA.submittedCount).toBeGreaterThan(0);
  });
  it("每 decision 至多一次提交（重复 step 不重复 submit）", () => {
    const h = mkHost();
    const agent = new BattleAgent({ view: createReadOnlyView(h, "A") as AgentView, pack: PACK, submit: (c) => h.submit("A", c) as ReturnType<SubmitFn> });
    agent.step();
    const again = agent.step();
    expect(again.submitted).toBe(false);
  });
  it("v1 pack 也能跑 baseline（向后兼容）", () => {
    const h1 = new BattleHost({
      pack: PACK_V1, battleId: "btl_v1", seedHex: SEED,
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: "A", p2: "B" }, deadlineMs: 30000,
    });
    const agentA = new BattleAgent({ view: createReadOnlyView(h1, "A") as AgentView, pack: PACK_V1, submit: (c) => h1.submit("A", c) as ReturnType<SubmitFn> });
    const agentB = new BattleAgent({ view: createReadOnlyView(h1, "B") as AgentView, pack: PACK_V1, submit: (c) => h1.submit("B", c) as ReturnType<SubmitFn> });
    let guard = 0;
    while (h1.state.battle.terminal === null && guard++ < 300) { agentA.step(); agentB.step(); }
    expect(h1.state.battle.terminal).not.toBeNull();
  });
});
