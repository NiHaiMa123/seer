/**
 * BattleAgent：decision 驱动的对局循环。
 * observe → policy → submit_action，幂等 key 绑 (decisionId,actionId)。
 * 每个 open decision 至多提交一次；过期/迟到响应不再作用于新决策。
 */
import type { FrozenPack } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { sha256hex } from "@seer/battle-core";
import { ToolServer } from "./tools.ts";
import type { AgentView, SubmitFn } from "./views.ts";
import { decideBaseline } from "./baseline.ts";
import { Belief } from "./belief.ts";
import { plan, DEFAULT_PLANNER, type PlannerConfig } from "./planner.ts";
import { LlmPolicy, DecisionClock, LOCAL_BUDGET, type BudgetSpec } from "./llm.ts";
import type { ModelProvider } from "./provider.ts";

export interface AgentOptions {
  maxTurns?: number;
}

export interface AgentResult {
  submitted: number;
  final: Observation;
  transcript: Array<{ decisionId: string; actionId: string; rationale: string }>;
}

export class BattleAgent {
  private readonly tools: ToolServer;
  private readonly pack: FrozenPack;
  private readonly decided = new Set<string>();
  private readonly belief: Belief | null;
  private readonly policy: "baseline" | "planner" | "llm";
  private readonly plannerCfg: PlannerConfig;
  private readonly llm: LlmPolicy | null;
  private readonly budgetSpec: BudgetSpec;

  constructor(deps: {
    view: AgentView; pack: FrozenPack; submit: SubmitFn;
    useBelief?: boolean; policy?: "baseline" | "planner" | "llm"; planner?: Partial<PlannerConfig>;
    provider?: ModelProvider; budget?: Partial<BudgetSpec>;
  }) {
    this.tools = new ToolServer(deps);
    this.pack = deps.pack;
    // planner 必然需要 belief（joint 枚举依赖假设世界）
    this.belief = deps.useBelief === true || deps.policy === "planner" ? new Belief(deps.pack) : null;
    this.policy = deps.policy ?? "baseline";
    this.plannerCfg = { ...DEFAULT_PLANNER, ...deps.planner };
    this.budgetSpec = { ...LOCAL_BUDGET, ...deps.budget };
    this.llm = deps.provider !== undefined ? new LlmPolicy(deps.provider, this.budgetSpec) : null;
  }

  /** 单步：若当前有未处理的 open decision → 决策并提交。返回是否提交了动作。 */
  step(): { submitted: boolean; observation: Observation } {
    const obs = this.tools.call({ tool: "observe", battleId: "btl_agent" }); // view 已按 side 绑定，battleId 仅过 schema 形态
    const observation = obs.data as Observation;
    const dec = observation.decision;
    if (dec === null || this.decided.has(dec.decisionId)) {
      return { submitted: false, observation };
    }
    const samples = this.belief === null ? null : this.belief.update(observation).samples;
    const decision = this.policy === "planner"
      ? { actionId: plan(this.pack, observation, samples ?? [{}], dec.baseRevision).actionId, rationale: "planner" }
      : decideBaseline(this.pack, observation, {
          ...(samples !== null ? { hypotheses: samples } : {}),
        });
    // key 含 side——两侧同决策同动作时 key 不能撞（Host 按 key 查所属侧）
    const key = `agt_${observation.side}_${sha256hex(`${dec.decisionId}:${decision.actionId}`).slice(0, 20)}`;
    const r = this.tools.call({
      tool: "submit_action",
      schemaVersion: 1,
      battleId: observation.battleId,
      decisionId: dec.decisionId,
      baseRevision: dec.baseRevision,
      idempotencyKey: key,
      actionId: decision.actionId,
    });
    const inner = r.data as { ok?: boolean } | undefined;
    if (!r.ok || inner?.ok !== true) {
      // 提交被拒（STALE/ILLEGAL/幂等冲突等）——不记 decided，下轮重试或走 fallback
      this.lastError = r.error?.message ?? JSON.stringify(inner ?? {});
      return { submitted: false, observation };
    }
    this.decided.add(dec.decisionId);
    this.transcript.push({ decisionId: dec.decisionId, actionId: decision.actionId, rationale: decision.rationale });
    return { submitted: true, observation };
  }

  /** 异步 step：policy=llm 时用（模型调用 + 预算时钟 + fallback 提交） */
  async stepAsync(): Promise<{ submitted: boolean; observation: Observation }> {
    const obs = this.tools.call({ tool: "observe", battleId: "btl_agent" });
    const observation = obs.data as Observation;
    const dec = observation.decision;
    if (dec === null || this.decided.has(dec.decisionId)) {
      return { submitted: false, observation };
    }
    let decision: { actionId: string; rationale: string };
    if (this.policy === "llm" && this.llm !== null) {
      const r = await this.llm.decide(observation, this.pack, new DecisionClock(this.budgetSpec), new AbortController().signal);
      decision = r.proposal;
    } else {
      const samples = this.belief === null ? null : this.belief.update(observation).samples;
      decision = this.policy === "planner"
        ? { actionId: plan(this.pack, observation, samples ?? [{}], dec.baseRevision).actionId, rationale: "planner" }
        : decideBaseline(this.pack, observation, {
            ...(samples !== null ? { hypotheses: samples } : {}),
          });
    }
    const key = `agt_${observation.side}_${sha256hex(`${dec.decisionId}:${decision.actionId}`).slice(0, 20)}`;
    const r = this.tools.call({
      tool: "submit_action",
      schemaVersion: 1,
      battleId: observation.battleId,
      decisionId: dec.decisionId,
      baseRevision: dec.baseRevision,
      idempotencyKey: key,
      actionId: decision.actionId,
    });
    const inner = r.data as { ok?: boolean } | undefined;
    if (!r.ok || inner?.ok !== true) {
      this.lastError = r.error?.message ?? JSON.stringify(inner ?? {});
      return { submitted: false, observation };
    }
    this.decided.add(dec.decisionId);
    this.transcript.push({ decisionId: dec.decisionId, actionId: decision.actionId, rationale: decision.rationale });
    return { submitted: true, observation };
  }

  private transcript: AgentResult["transcript"] = [];
  lastError: string | null = null;
  get submittedCount(): number { return this.decided.size; }
  get transcriptEntries(): AgentResult["transcript"] { return this.transcript; }

  /** 循环到终局（或无新 decision 可投） */
  run(maxSteps = 500): AgentResult {
    for (let i = 0; i < maxSteps; i++) {
      const { observation } = this.step();
      if (observation.terminal !== null) {
        return { submitted: this.decided.size, final: observation, transcript: this.transcript };
      }
      // 无 decision（挂起中等待对方/对方回合未到）——继续轮询
      if (observation.decision === null) continue;
    }
    const final = this.tools.call({ tool: "observe", battleId: "btl_agent" }).data as Observation;
    return { submitted: this.decided.size, final, transcript: this.transcript };
  }
}
