/**
 * LLM 提案管线 + deadline/fallback（AGENT.md §6）。
 * 预算（本机 monotonic，默认 10s decision）：
 *   模型 ≤4s、搜索 ≤3s、校验+提交保留 1s；
 *   模型调用 ≤2 次（含 1 次格式修复）、工具 ≤16、transition ≤2048、
 *   输入 ≤12000 / 输出 ≤2000 tokens。
 * 语义：decision 打开时先算 deterministic fallback；任一 LLM 路径失败/超时
 * → 剩 1s 时 fallback 已就绪可发；迟到回复丢弃——旧 decision 回复不作用于新决策。
 */
import type { FrozenPack } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { decideBaseline } from "./baseline.ts";
import type { ModelProvider, ModelRequest, ModelUsage } from "./provider.ts";
import type { ToolServer } from "./tools.ts";

export interface BudgetSpec {
  totalMs: number;
  modelMs: number;
  searchMs: number;
  reserveMs: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxTransitions: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const LOCAL_BUDGET: BudgetSpec = {
  totalMs: 10_000, modelMs: 4_000, searchMs: 3_000, reserveMs: 1_000,
  maxModelCalls: 2, maxToolCalls: 16, maxTransitions: 2048,
  maxInputTokens: 12_000, maxOutputTokens: 2_000,
};

export class DecisionClock {
  private readonly t0 = performance.now();
  private readonly spec: BudgetSpec;
  constructor(spec: BudgetSpec) { this.spec = spec; }
  elapsed(): number { return performance.now() - this.t0; }
  remaining(): number { return Math.max(0, this.spec.totalMs - this.elapsed()); }
  withinReserve(): boolean { return this.remaining() <= this.spec.reserveMs; }
}

export interface LlmProposal { actionId: string; rationale: string }
export interface LlmOutcome {
  proposal: LlmProposal;
  path: "llm" | "llm-repaired" | "fallback";
  modelCalls: number;
  usage: { inputTokens: number; outputTokens: number };
  errors: string[];
}

const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["actionId", "rationale"],
  properties: {
    actionId: { type: "string" },
    rationale: { type: "string" },
  },
};

function extractJson(text: string): LlmProposal | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { actionId?: unknown; rationale?: unknown };
    if (typeof v.actionId === "string" && typeof v.rationale === "string") {
      return { actionId: v.actionId, rationale: v.rationale };
    }
  } catch { /* fallthrough */ }
  return null;
}

export class LlmPolicy {
  private modelCalls = 0;
  private used: ModelUsage = { inputTokens: 0, outputTokens: 0, source: "estimated" };
  private readonly errors: string[] = [];

  private readonly provider: ModelProvider;
  private readonly spec: BudgetSpec;
  constructor(provider: ModelProvider, spec: BudgetSpec = LOCAL_BUDGET) {
    this.provider = provider;
    this.spec = spec;
  }

  /** 构造提示：只含公开字段 + 规则摘要 + 合法集（隐藏字段永不入 prompt）。 */
  buildPrompt(obs: Observation, pack: FrozenPack): string {
    const legal = obs.legalActions.map((a) => a.actionId).sort();
    const ownMoves = Object.keys(obs.own.ppByMoveId).sort();
    const lines = [
      `You are a battle policy. Pick exactly one actionId from LEGAL and reply JSON {"actionId","rationale"}.`,
      `TURN: ${obs.turn} SIDE: ${obs.side}`,
      `OWN: ${obs.own.speciesId} hp=${obs.own.hp.current}/${obs.own.hp.max} stages=${JSON.stringify(obs.own.stages)} moves=${ownMoves.join(",")}`,
      `FOE: ${obs.opponent.speciesId} hp=${obs.opponent.hp.current}/${obs.opponent.hp.max} stages=${JSON.stringify(obs.opponent.stages)} revealed=${obs.opponent.revealedMoveIds.join(",")} benchAlive=${obs.opponent.benchAlive ?? 0}`,
      `LEGAL: ${legal.join(",")}`,
    ];
    return lines.join("\n");
  }

  /**
   * 决策：LLM 提案 → 合法校验 → 失败限 1 次修复重试 → 超时/失败 fallback。
   * 永远返回一个合法 actionId（fallback 保证）。
   */
  async decide(obs: Observation, pack: FrozenPack, clock: DecisionClock, signal: AbortSignal): Promise<LlmOutcome> {
    // 预算属于本次决策，复用 policy 或并行决策不能共用计数。
    let modelCalls = 0;
    const used: ModelUsage = { inputTokens: 0, outputTokens: 0, source: "estimated" };
    const errors: string[] = [];
    const legal = new Set(obs.legalActions.map((a) => a.actionId));
    const fallback = (): LlmOutcome => ({
      proposal: decideBaseline(pack, obs), path: "fallback", modelCalls,
      usage: { inputTokens: used.inputTokens, outputTokens: used.outputTokens }, errors: [...errors],
    });
    const prompt = this.buildPrompt(obs, pack);
    for (let attempt = 0; attempt < Math.min(2, this.spec.maxModelCalls); attempt++) {
      if (signal.aborted || clock.withinReserve()) break;
      const requestPrompt = attempt === 0 ? prompt
        : prompt + "\nYour previous reply was invalid (actionId must be one of LEGAL). Reply ONLY the JSON.";
      if (used.inputTokens + requestPrompt.length / 4 > this.spec.maxInputTokens) {
        errors.push("prompt exceeds input token budget");
        break;
      }
      const remaining = Math.min(this.spec.modelMs, clock.remaining() - this.spec.reserveMs);
      if (remaining <= 0) break;
      const ctrl = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort = () => {};
      const interrupted = new Promise<never>((_, reject) => {
        onAbort = () => { ctrl.abort(); reject(new Error("model aborted")); };
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => { ctrl.abort(); reject(new Error(attempt === 0 ? "model budget timeout" : "repair budget timeout")); }, remaining);
      });
      modelCalls++;
      try {
        const req: ModelRequest = { prompt: requestPrompt, jsonSchema: PROPOSAL_SCHEMA, maxOutputTokens: this.spec.maxOutputTokens, temperature: 0 };
        const result = await Promise.race([this.provider.generate(req, ctrl.signal), interrupted]);
        if (signal.aborted || clock.withinReserve()) break;
        if (result.usage) {
          used.inputTokens += result.usage.inputTokens;
          used.outputTokens += result.usage.outputTokens;
        }
        if (used.inputTokens > this.spec.maxInputTokens || used.outputTokens > this.spec.maxOutputTokens) {
          errors.push(used.outputTokens > this.spec.maxOutputTokens ? "output token cap exceeded" : "input token cap exceeded");
          break;
        }
        if (!result.ok) { errors.push("model error: " + result.error?.code); continue; }
        const proposal = extractJson(result.text ?? "");
        if (proposal !== null && legal.has(proposal.actionId)) {
          return { proposal, path: attempt === 0 ? "llm" : "llm-repaired", modelCalls,
            usage: { inputTokens: used.inputTokens, outputTokens: used.outputTokens }, errors: [...errors] };
        }
        errors.push(proposal === null ? "invalid model JSON" : "illegal actionId " + proposal.actionId);
      } catch (error) {
        errors.push((attempt === 0 ? "model throw: " : "repair throw: ") + String(error));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    }
    return fallback();
  }
}
