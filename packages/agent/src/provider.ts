/**
 * ModelProvider：统一模型能力面（AGENT.md §1）。
 * - generate(request, signal) 唯一入口——输出/usage/错误统一；
 * - capabilities() 声明工具调用/JSON 输出/取消/上下文——adapter 如实声明，
 *   "OpenAI-compatible" 不等于参数语义全同，探测结果进缓存键；
 * - credentialRef 是**环境变量名**——配置从不内嵌 secret；
 * - mock(EchoProvider) 供离线评测，不假装有真模型。
 */

export interface ModelRequest {
  model?: string;
  system?: string;
  prompt: string;
  /** 期望 JSON 输出 schema（仅提示/约束用途——最终仍以合法校验为准） */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ModelUsage { inputTokens: number; outputTokens: number; source: "provider" | "estimated" }

export interface ModelResponse {
  ok: boolean;
  text?: string;
  usage?: ModelUsage;
  error?: { code: "timeout" | "aborted" | "http" | "parse" | "provider" | "config"; message: string; retryable: boolean };
}

export interface ProviderCapabilities {
  toolCalls: boolean;
  jsonOutput: boolean;
  cancelable: boolean;
  contextTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  generate(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export class ProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

/** 确定性离线 mock：由 prompt 里的合法动作集取首字母序动作，输出规范 JSON。 */
export class EchoProvider implements ModelProvider {
  readonly id = "echo";
  /** 测试注入：返回特定 text、挂起、或抛错 */
  inject: ((req: ModelRequest) => Promise<ModelResponse>) | null = null;

  capabilities(): ProviderCapabilities {
    return { toolCalls: false, jsonOutput: true, cancelable: true, contextTokens: 8192 };
  }

  generate(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) return Promise.resolve({ ok: false, error: { code: "aborted", message: "aborted", retryable: false } });
    if (this.inject) return this.inject(req);
    const m = /LEGAL:\s*([a-z0-9_,\s-]+)/i.exec(req.prompt);
    const legal = (m?.[1] ?? "act_concede").split(/[,\s]+/).filter(Boolean).sort();
    const actionId = legal.find((a) => a !== "act_concede") ?? legal[0] ?? "act_concede";
    const text = JSON.stringify({ actionId, rationale: "echo picks first legal" });
    return Promise.resolve({
      ok: true, text,
      usage: { inputTokens: estimateTokens(req.prompt), outputTokens: estimateTokens(text), source: "estimated" },
    });
  }
}

export interface OpenAiConfig {
  /** OpenAI-compatible endpoint，如 https://api.openai.com/v1 */
  endpoint: string;
  model: string;
  /** 环境变量名（如 "OPENAI_API_KEY"）——值永不进配置/日志 */
  credentialRef: string;
  timeoutMs?: number;
}

export class OpenAiProvider implements ModelProvider {
  readonly id = "openai-compatible";
  private readonly cfg: OpenAiConfig;
  constructor(cfg: OpenAiConfig) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(cfg.credentialRef)) {
      throw new ProviderError("config", "credentialRef must be an env var name");
    }
    if (process.env[cfg.credentialRef] === undefined) {
      throw new ProviderError("config", `credential env ${cfg.credentialRef} is not set`);
    }
    this.cfg = cfg;
  }

  capabilities(): ProviderCapabilities {
    return { toolCalls: true, jsonOutput: true, cancelable: true, contextTokens: 128000 };
  }

  async generate(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const key = process.env[this.cfg.credentialRef]!;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 30_000);
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const r = await fetch(`${this.cfg.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: req.model ?? this.cfg.model,
          messages: [
            ...(req.system !== undefined ? [{ role: "system", content: req.system }] : []),
            { role: "user", content: req.prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: req.maxOutputTokens ?? 2000,
          temperature: req.temperature ?? 0,
        }),
      });
      if (!r.ok) {
        return { ok: false, error: { code: "http", message: `HTTP ${r.status}`, retryable: r.status === 429 || r.status >= 500 } };
      }
      const body = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      return {
        ok: true, text,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? estimateTokens(req.prompt),
          outputTokens: body.usage?.completion_tokens ?? estimateTokens(text),
          source: body.usage !== undefined ? "provider" : "estimated",
        },
      };
    } catch (e) {
      const aborted = ctrl.signal.aborted || signal.aborted;
      return { ok: false, error: { code: aborted ? "timeout" : "provider", message: String(e), retryable: !aborted } };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}
