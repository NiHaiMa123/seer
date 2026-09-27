/**
 * M3-02：Belief 隐藏世界采样 + Knowledge 机制图。
 * 门禁：一致性（样本与公开历史兼容）、多样性、确定性、淘汰/reset、
 * counterplay 基于真实机制图而非字面正则。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import { canonicalJson } from "@seer/contracts";
import { Belief, BattleAgent, mechanismOf, counterplayFor, type AgentView, type SubmitFn } from "@seer/agent";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000042";

const mkHost = (bench?: { p1?: string[]; p2?: string[] }) =>
  new BattleHost({
    pack: PACK, battleId: "btl_bel", seedHex: SEED,
    species: { p1: "syn-gamma", p2: "syn-delta" },
    ...(bench !== undefined ? { bench } : {}),
    players: { p1: "A", p2: "B" }, deadlineMs: 30000,
  });

describe("belief 采样一致性", () => {
  it("无 bench 局：样本只覆盖 PP 子集维度，bench 假设为空", () => {
    const b = new Belief(PACK);
    const st = b.update(mkHost().observe("A"));
    expect(st.samples.length).toBeGreaterThan(0);
    expect(st.samples.length).toBeLessThanOrEqual(16);
    expect(st.samples.every((s) => s.oppBenchSpeciesIds === undefined || s.oppBenchSpeciesIds.length === 0)).toBe(true);
  });
  it("benchAlive=N → 所有样本的 bench 恰好 N 个 species", () => {
    const h = mkHost({ p2: ["syn-epsilon", "syn-gamma"] });
    const obs = h.observe("A");
    expect(obs.opponent.benchAlive).toBe(2);
    const st = new Belief(PACK).update(obs);
    expect(st.samples.every((s) => s.oppBenchSpeciesIds?.length === 2)).toBe(true);
  });
  it("揭示招 ⊆ 每个样本的 opponentMoveIds", () => {
    const h = mkHost();
    const d = h.observe("A").decision!;
    h.submit("A", { battleId: "btl_bel", decisionId: d.decisionId, baseRevision: 0, actionId: "act_syn-strike", idempotencyKey: "ka111111" });
    h.submit("B", { battleId: "btl_bel", decisionId: d.decisionId, baseRevision: 0, actionId: "act_syn-slam", idempotencyKey: "kb111111" });
    const obs = h.observe("A");
    expect(obs.opponent.revealedMoveIds).toContain("syn-slam");
    const st = new Belief(PACK).update(obs);
    expect(st.samples.every((s) => s.opponentMoveIds!.includes("syn-slam"))).toBe(true);
  });
  it("确定性：同 obs+seed → canonical 相同；不同 seed → 样本集可能不同", () => {
    const obs = mkHost({ p2: ["syn-epsilon"] }).observe("A");
    const s1 = new Belief(PACK).update(obs, 7).samples;
    const s2 = new Belief(PACK).update(obs, 7).samples;
    expect(canonicalJson(s1)).toBe(canonicalJson(s2));
  });
  it("同 obs 重复 update 幂等（lastKey 缓存）", () => {
    const b = new Belief(PACK);
    const obs = mkHost().observe("A");
    const s1 = b.update(obs);
    const s2 = b.update(obs);
    expect(canonicalJson(s2)).toBe(canonicalJson(s1));
  });
  it("淘汰全部 → reset 到宽 prior 并记录 modelError", () => {
    const b = new Belief(PACK);
    b.update(mkHost().observe("A"));
    const st = b.eliminate(() => false, "test elimination");
    expect(st.modelErrors).toBe(1);
    expect(st.samples.length).toBe(1);
    expect(String(st.samples[0]!.note)).toMatch(/^reset:/);
    expect(st.resets[0]).toContain("test elimination");
  });
  it("部分淘汰 → 样本收窄不 reset", () => {
    const b = new Belief(PACK);
    const st0 = b.update(mkHost().observe("A"));
    const keep = st0.samples.filter((_, i) => i % 2 === 0);
    const st = b.eliminate((s) => keep.includes(s as typeof keep[number]), "narrow");
    expect(st.modelErrors).toBe(0);
    expect(st.samples.length).toBe(keep.length);
  });
  it("策略类先验覆盖：样本含多类 policyClass", () => {
    const st = new Belief(PACK).update(mkHost().observe("A"));
    const classes = new Set(st.samples.map((s) => s.policyClass));
    expect(classes.size).toBeGreaterThan(1);
  });
});

describe("knowledge 机制图", () => {
  it("mechanismOf 分解 move op 语义", () => {
    const hex = mechanismOf(PACK, "syn-hex")!;
    expect(hex.appliesControl).toBe(true);
    const strike = mechanismOf(PACK, "syn-strike")!;
    expect(strike.directDamage).toBe(true);
    expect(strike.fixedOrPercent).toBe(false);
    const blast = mechanismOf(PACK, "syn-blast")!;
    expect(blast.fixedOrPercent).toBe(true); // percent kind
    expect(mechanismOf(PACK, "syn-nonexist")).toBeNull();
  });
  it("counterplayFor：bypass_target 只含固定/百分比伤害，不吞全伤害集", () => {
    const legal = ["act_syn-strike", "act_syn-jab", "act_syn-hex", "act_syn-blast", "act_concede"];
    const out = counterplayFor(PACK, legal, "stun");
    const bypass = out.find((i) => i.intervention === "bypass_target");
    expect(bypass).toBeDefined();
    expect(bypass!.candidates).toContain("act_syn-blast");
    expect(bypass!.candidates).not.toContain("act_syn-strike"); // standard 伤害不算绕目标
  });
  it("remove_precondition 用真实 op 匹配（clear_stages/transfer_stages）", () => {
    const legal = ["act_syn-purge", "act_syn-drain", "act_syn-strike"];
    const out = counterplayFor(PACK, legal, "stage_boost");
    const rm = out.find((i) => i.intervention === "remove_precondition");
    expect(rm).toBeDefined();
    // purge=clear_stages / drain=transfer_stages → 都在
    expect(rm!.candidates.sort()).toEqual(["act_syn-drain", "act_syn-purge"].sort());
  });
});

describe("belief 接入 agent", () => {
  it("useBelief 的 agent 正常完赛（belief 假设参与模拟评估）", () => {
    const h = mkHost({ p2: ["syn-epsilon"] });
    const agentA = new BattleAgent({ view: createReadOnlyView(h, "A") as AgentView, pack: PACK, submit: (c) => h.submit("A", c) as ReturnType<SubmitFn>, useBelief: true });
    const agentB = new BattleAgent({ view: createReadOnlyView(h, "B") as AgentView, pack: PACK, submit: (c) => h.submit("B", c) as ReturnType<SubmitFn>, useBelief: true });
    let guard = 0;
    while (h.state.battle.terminal === null && guard++ < 400) { agentA.step(); agentB.step(); }
    expect(h.state.battle.terminal).not.toBeNull();
  });
});
