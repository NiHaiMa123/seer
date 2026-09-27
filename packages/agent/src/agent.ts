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

  constructor(deps: { view: AgentView; pack: FrozenPack; submit: SubmitFn; useBelief?: boolean }) {
    this.tools = new ToolServer(deps);
    this.pack = deps.pack;
    this.belief = deps.useBelief === true ? new Belief(deps.pack) : null;
  }

  /** 单步：若当前有未处理的 open decision → 决策并提交。返回是否提交了动作。 */
  step(): { submitted: boolean; observation: Observation } {
    const obs = this.tools.call({ tool: "observe", battleId: "btl_agent" }); // view 已按 side 绑定，battleId 仅过 schema 形态
    const observation = obs.data as Observation;
    const dec = observation.decision;
    if (dec === null || this.decided.has(dec.decisionId)) {
      return { submitted: false, observation };
    }
    const hypotheses = this.belief === null ? undefined : this.belief.update(observation).samples;
    const decision = decideBaseline(this.pack, observation, {
      ...(hypotheses !== undefined ? { hypotheses } : {}),
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
