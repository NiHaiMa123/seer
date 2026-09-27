/**
 * M3-04：ModelProvider + 提案管线 + deadline/fallback。
 * 全部用 EchoProvider/inject 离线 mock——不碰真网络。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import {
  EchoProvider, LlmPolicy, DecisionClock, LOCAL_BUDGET, BattleAgent,
  type AgentView, type SubmitFn, type ModelRequest, type ModelResponse,
} from "@seer/agent";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000042";
const OK = (text: string): ModelResponse => ({ ok: true, text, usage: { inputTokens: 50, outputTokens: 10, source: "estimated" } });

const mkHost = (bench?: { p1?: string[]; p2?: string[] }) =>
  new BattleHost({
    pack: PACK, battleId: "btl_llm", seedHex: SEED,
    species: { p1: "syn-gamma", p2: "syn-delta" },
    ...(bench !== undefined ? { bench } : {}),
    players: { p1: "A", p2: "B" }, deadlineMs: 30000,
  });
const decide = (p: EchoProvider, host: BattleHost) => {
  const obs = host.observe("A");
  const policy = new LlmPolicy(p, { ...LOCAL_BUDGET, totalMs: 60_000, modelMs: 30_000 });
  return policy.decide(obs, PACK, new DecisionClock({ ...LOCAL_BUDGET, totalMs: 60_000, modelMs: 30_000 }), new AbortController().signal);
};

describe("LLM 提案管线", () => {
  it("echo 正常提案 → path=llm + 合法 actionId", async () => {
    const h = mkHost();
    const r = await decide(new EchoProvider(), h);
    expect(r.path).toBe("llm");
    expect(h.observe("A").legalActions.map((a) => a.actionId)).toContain(r.proposal.actionId);
    expect(r.modelCalls).toBe(1);
  });
  it("非法 JSON → 修复重试成功 → llm-repaired", async () => {
    const p = new EchoProvider();
    let n = 0;
    p.inject = (req: ModelRequest) => {
      n++;
      return Promise.resolve(n === 1 ? OK("not json at all") : OK("{\"actionId\":\"act_syn-strike\",\"rationale\":\"fixed\"}"));
    };
    const r = await decide(p, mkHost());
    expect(r.path).toBe("llm-repaired");
    expect(r.proposal.actionId).toBe("act_syn-strike");
    expect(r.modelCalls).toBe(2);
  });
  it("非法 actionId → 修复也非法 → fallback（仍返回合法动作）", async () => {
    const p = new EchoProvider();
    p.inject = () => Promise.resolve(OK("{\"actionId\":\"act_admin_smite\",\"rationale\":\"cheat\"}"));
    const r = await decide(p, mkHost());
    expect(r.path).toBe("fallback");
    expect(r.proposal.actionId).toMatch(/^act_/);
    expect(r.errors.some((e) => e.includes("act_admin_smite"))).toBe(true);
  });
  it("provider 挂起 → modelMs 超时 → fallback", async () => {
    const p = new EchoProvider();
    p.inject = () => new Promise<ModelResponse>(() => { /* 永不返回 */ });
    const h = mkHost();
    const spec = { ...LOCAL_BUDGET, totalMs: 10_000, modelMs: 80 };
    const policy = new LlmPolicy(p, spec);
    const t0 = Date.now();
    const r = await policy.decide(h.observe("A"), PACK, new DecisionClock(spec), new AbortController().signal);
    expect(r.path).toBe("fallback");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it("≥3 次模型调用被 cap 拒绝（maxModelCalls=2）", async () => {
    const p = new EchoProvider();
    let n = 0;
    p.inject = () => { n++; return Promise.resolve(OK("garbage")); };
    const r = await decide(p, mkHost());
    expect(r.modelCalls).toBeLessThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(2);
  });
  it("remaining≤reserveMs → 直接 fallback 不花模型调用", async () => {
    const p = new EchoProvider();
    let called = 0;
    p.inject = () => { called++; return Promise.resolve(OK("{}")); };
    const spec = { ...LOCAL_BUDGET, totalMs: 1000, reserveMs: 1000 };
    const policy = new LlmPolicy(p, spec);
    const r = await policy.decide(mkHost().observe("A"), PACK, new DecisionClock(spec), new AbortController().signal);
    expect(r.path).toBe("fallback");
    expect(called).toBe(0);
  });
  it("usage 累计 + output token cap 记录", async () => {
    const p = new EchoProvider();
    p.inject = () => Promise.resolve({ ok: true, text: "{\"actionId\":\"act_syn-strike\",\"rationale\":\"x\"}", usage: { inputTokens: 100, outputTokens: 5000, source: "provider" } });
    const r = await decide(p, mkHost());
    expect(r.usage.outputTokens).toBe(5000);
    expect(r.errors.some((e) => e.includes("output token"))).toBe(true);
  });
});

describe("provider 纪律", () => {
  it("OpenAiProvider 拒绝非 env 名 credentialRef", async () => {
    const { OpenAiProvider } = await import("@seer/agent");
    expect(() => new OpenAiProvider({ endpoint: "https://x", model: "m", credentialRef: "sk-live-secret" })).toThrow();
    expect(() => new OpenAiProvider({ endpoint: "https://x", model: "m", credentialRef: "MISSING_ENV_VAR_XYZ" })).toThrow();
  });
  it("prompt 不含隐藏字段（PP 估值对手/RNG/内部 seq）", async () => {
    const p = new EchoProvider();
    let captured = "";
    p.inject = (req) => { captured = req.prompt; return Promise.resolve(OK("{}")); };
    const r = await decide(p, mkHost());
    expect(captured).not.toMatch(/seedHex|drawCounter|inbox|ppEstimate|eventSeq/i);
  });
});

describe("llm agent 完赛", () => {
  it("echo provider 的 llm agent 对 baseline 打完一局", async () => {
    const h = mkHost({ p2: ["syn-epsilon"] });
    const llmAgent = new BattleAgent({ view: createReadOnlyView(h, "A") as AgentView, pack: PACK, submit: (c) => h.submit("A", c) as ReturnType<SubmitFn>, policy: "llm", provider: new EchoProvider() });
    const baseline = new BattleAgent({ view: createReadOnlyView(h, "B") as AgentView, pack: PACK, submit: (c) => h.submit("B", c) as ReturnType<SubmitFn> });
    let guard = 0;
    while (h.state.battle.terminal === null && guard++ < 400) {
      await llmAgent.stepAsync();
      baseline.step();
    }
    expect(h.state.battle.terminal).not.toBeNull();
  }, 15000);
});
