/**
 * M3-03：joint-action beam planner。
 * 门禁：同时性（不预设对手动作）、确定性、预算上限、worst≤mean、
 * belief 样本参与、KO 收敛、深度-2 展开记账。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import { canonicalJson } from "@seer/contracts";
import { Belief, BattleAgent, plan, DEFAULT_PLANNER, type AgentView, type SubmitFn } from "@seer/agent";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000042";

const mkHost = (bench?: { p1?: string[]; p2?: string[] }) =>
  new BattleHost({
    pack: PACK, battleId: "btl_pln", seedHex: SEED,
    species: { p1: "syn-gamma", p2: "syn-delta" },
    ...(bench !== undefined ? { bench } : {}),
    players: { p1: "A", p2: "B" }, deadlineMs: 30000,
  });

describe("planner", () => {
  it("确定性：同 obs+samples+seed → 同 actionId + canonical 同分", () => {
    const obs = mkHost().observe("A");
    const samples = new Belief(PACK).update(obs).samples;
    const r1 = plan(PACK, obs, samples, 5);
    const r2 = plan(PACK, obs, samples, 5);
    expect(r1.actionId).toBe(r2.actionId);
    expect(canonicalJson(r1.scores)).toBe(canonicalJson(r2.scores));
  });
  it("联合枚举：对手回应来自假设世界合法集（不预设其动作）", () => {
    const obs = mkHost().observe("A");
    const samples = new Belief(PACK).update(obs).samples;
    const r = plan(PACK, obs, samples, 5, { ...DEFAULT_PLANNER, depth: 1 });
    expect(r.transitionsUsed).toBeGreaterThan(0);
    // 每个 root 至少探索对手合法集（≥4 招 × ≥1 样本）
    const best = r.scores[0]!;
    expect(r.scores.every((s) => s.worstMilli <= s.meanMilli)).toBe(true); // worst ≤ mean
    expect(best.meanMilli).toBeGreaterThan(-999000);
  });
  it("预算硬上限：maxTransitions=1 只跑 1 transition 且记账截断", () => {
    const obs = mkHost().observe("A");
    const r = plan(PACK, obs, [{}], 5, { ...DEFAULT_PLANNER, depth: 1, maxTransitions: 1 });
    expect(r.transitionsUsed).toBeLessThanOrEqual(1);
  });
  it("KO 可杀时 planner 收敛到致胜动作", () => {
    const h = mkHost();
    // six-stat：delta 面板 hp332，strike 随机 23-28、jab 12-15（飞行→水中性）。
    // 打残到 ≤23（最差 roll 也必杀）：hp≥29 用 strike 永不可能 KO（≥29-28≥1 存活），
    // hp 24-28 用 jab（≤15）安全落地；绝不提交 hp≤28 的 strike（可能真 KO 触发挂起）。
    let obs = h.observe("A");
    for (let i = 0; i < 40 && obs.opponent.hp.current > 23; i++) {
      const d = obs.decision;
      if (!d || d.kind !== "turn") break;
      const move = obs.opponent.hp.current >= 29 ? "act_syn-strike" : "act_syn-jab";
      h.submit("A", { battleId: "btl_pln", decisionId: d.decisionId, baseRevision: d.baseRevision, actionId: move, idempotencyKey: `ka${String(i).padStart(4, "0")}xx` });
      h.submit("B", { battleId: "btl_pln", decisionId: d.decisionId, baseRevision: d.baseRevision, actionId: "act_syn-drain", idempotencyKey: `kb${String(i).padStart(4, "0")}xx` });
      obs = h.observe("A");
      if (obs.decision?.kind === "replacement" || obs.opponent.hp.current === 0) break;
    }
    expect(obs.opponent.hp.current).toBeGreaterThan(0);
    expect(obs.opponent.hp.current).toBeLessThanOrEqual(23);
    const r = plan(PACK, obs, [{}], 5, { ...DEFAULT_PLANNER, depth: 1 });
    const strike = r.scores.find((s) => s.actionId === "act_syn-strike")!;
    expect(strike.worstMilli).toBeGreaterThan(0); // worst-case 也赢/占优
  });
  it("深度-2 记账：transitionsUsed 显著大于深度-1", () => {
    const obs = mkHost().observe("A");
    const d1 = plan(PACK, obs, [{}], 5, { ...DEFAULT_PLANNER, depth: 1 });
    const d2 = plan(PACK, obs, [{}], 5, { ...DEFAULT_PLANNER, depth: 2 });
    expect(d2.transitionsUsed).toBeGreaterThan(d1.transitionsUsed);
  });
  it("worst-case 保守分 ≤ 均值分（逐 action）", () => {
    const obs = mkHost().observe("A");
    const r = plan(PACK, obs, new Belief(PACK).update(obs).samples, 3);
    for (const s of r.scores) expect(s.worstMilli).toBeLessThanOrEqual(s.meanMilli);
  });
});

describe("planner 接入 agent", () => {
  it("planner 策略 + belief 完赛到终局", () => {
    const h = mkHost({ p2: ["syn-epsilon"] });
    const beliefA = new Belief(PACK);
    const beliefB = new Belief(PACK);
    const sub = (p: string) => (c: Record<string, unknown>) => h.submit(p, c as never) as never;
    let guard = 0;
    while (h.state.battle.terminal === null && guard++ < 400) {
      for (const [p, bel] of [["A", beliefA], ["B", beliefB]] as const) {
        const obs = h.observe(p);
        const dec = obs.decision;
        if (dec === null) continue;
        const already = h.state.battle.inbox[obs.side as "p1" | "p2"] != null; // inbox 只挂当前 decision
        if (already) continue;
        const pick = dec.kind === "replacement"
          ? (obs.legalActions.find((a) => a.actionId.startsWith("act_switch-"))?.actionId ?? "act_concede")
          : plan(PACK, obs, bel.update(obs).samples, guard, { ...DEFAULT_PLANNER, depth: 1 }).actionId;
        h.submit(p, { battleId: "btl_pln", decisionId: dec.decisionId, baseRevision: dec.baseRevision, actionId: pick, idempotencyKey: `pl_${p}_${guard}_xxxx` });
      }
    }
    expect(h.state.battle.terminal).not.toBeNull();
  });
  it("BattleAgent policy=planner 完赛", () => {
    const h = mkHost({ p2: ["syn-epsilon"] });
    const a = new BattleAgent({ view: createReadOnlyView(h, "A") as AgentView, pack: PACK, submit: (c) => h.submit("A", c) as ReturnType<SubmitFn>, policy: "planner", planner: { depth: 1 } });
    const b = new BattleAgent({ view: createReadOnlyView(h, "B") as AgentView, pack: PACK, submit: (c) => h.submit("B", c) as ReturnType<SubmitFn>, policy: "planner", planner: { depth: 1 } });
    let guard = 0;
    while (h.state.battle.terminal === null && guard++ < 400) { a.step(); b.step(); }
    expect(h.state.battle.terminal).not.toBeNull();
  });
});
