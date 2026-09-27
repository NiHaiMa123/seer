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
  private readonly t0 = Date.now();
  private readonly spec: BudgetSpec;
  constructor(spec: BudgetSpec) { this.spec = spec; }
  elapsed(): number { return Date.now() - this.t0; }
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
    const legal = new Set(obs.legalActions.map((a) => a.actionId));
    const fallback = (): LlmOutcome => ({
      proposal: decideBaseline(pack, obs),
      path: "fallback",
      modelCalls: this.modelCalls,
      usage: { inputTokens: this.used.inputTokens, outputTokens: this.used.outputTokens },
      errors: [...this.errors],
    });
    if (clock.withinReserve() || this.modelCalls >= this.spec.maxModelCalls) return fallback();

    const prompt = this.buildPrompt(obs, pack);
    if (prompt.length / 4 > this.spec.maxInputTokens) {
      this.errors.push("prompt exceeds input token budget");
      return fallback();
    }

    const tryOnce = async (): Promise<LlmProposal | null> => {
      if (this.modelCalls >= this.spec.maxModelCalls) { this.errors.push("model call cap"); return null; }
      const remaining = Math.min(this.spec.modelMs, clock.remaining() - this.spec.reserveMs);
      if (remaining <= 0) { this.errors.push("no model budget left"); return null; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);
      const onOuter = () => ctrl.abort();
      signal.addEventListener("abort", onOuter, { once: true });
      this.modelCalls += 1;
      try {
        const req: ModelRequest = { prompt, jsonSchema: PROPOSAL_SCHEMA, maxOutputTokens: this.spec.maxOutputTokens, temperature: 0 };
        // 与预算超时竞速——不假设 provider 遵守 AbortSignal
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("model budget timeout")), remaining));
        const r = await Promise.race([this.provider.generate(req, ctrl.signal), timeout]);
        if (r.usage) {
          this.used.inputTokens += r.usage.inputTokens;
          this.used.outputTokens += r.usage.outputTokens;
          if (this.used.outputTokens > this.spec.maxOutputTokens) this.errors.push("output token cap exceeded");
        }
        if (!r.ok) { this.errors.push(`model error: ${r.error?.code}`); return null; }
        return extractJson(r.text ?? "");
      } catch (e) {
        this.errors.push(`model throw: ${String(e)}`);
        return null;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onOuter);
      }
    };

    const first = await tryOnce();
    if (first !== null && legal.has(first.actionId)) {
      return { proposal: first, path: "llm", modelCalls: this.modelCalls, usage: { inputTokens: this.used.inputTokens, outputTokens: this.used.outputTokens }, errors: [...this.errors] };
    }
    if (first !== null) this.errors.push(`illegal actionId ${first.actionId}`);

    // 至多 1 次修复：回指上次错误重问（仍在同一预算窗内）
    if (!clock.withinReserve() && this.modelCalls < this.spec.maxModelCalls) {
      const repairPrompt = `${prompt}\nYour previous reply was invalid (actionId must be one of LEGAL). Reply ONLY the JSON.`;
      try {
        const reqPrompt = repairPrompt;
        const remaining = Math.min(this.spec.modelMs, clock.remaining() - this.spec.reserveMs);
        if (remaining > 0) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), remaining);
          signal.addEventListener("abort", () => ctrl.abort(), { once: true });
          this.modelCalls += 1;
          try {
            const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("repair budget timeout")), remaining));
            const r = await Promise.race([this.provider.generate(
              { prompt: reqPrompt, jsonSchema: PROPOSAL_SCHEMA, maxOutputTokens: this.spec.maxOutputTokens, temperature: 0 },
              ctrl.signal,
            ), timeout]);
            if (r.usage) {
              this.used.inputTokens += r.usage.inputTokens;
              this.used.outputTokens += r.usage.outputTokens;
            }
            if (r.ok) {
              const second = extractJson(r.text ?? "");
              if (second !== null && legal.has(second.actionId)) {
                return { proposal: second, path: "llm-repaired", modelCalls: this.modelCalls, usage: { inputTokens: this.used.inputTokens, outputTokens: this.used.outputTokens }, errors: [...this.errors] };
              }
            }
            this.errors.push("repair failed");
          } finally {
            clearTimeout(timer);
          }
        }
      } catch (e) {
        this.errors.push(`repair throw: ${String(e)}`);
      }
    }
    return fallback();
  }
}
