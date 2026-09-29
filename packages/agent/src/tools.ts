/**
 * ToolServer：Agent 的受限工具面。
 * - 请求先过 tool.schema.json（Ajv strict）——未知字段/工具直接拒绝；
 * - observe/history/legal_actions 走 AgentView（只读公开投影）；
 * - simulate_batch/calculate_damage 在假设世界上跑纯 transition，无 battle DB；
 * - submit_action 走注入的 SubmitFn（身份/idempotency 由 Host 兜底）；
 * - 响应不携带任何内部字段（seq/RNG/causeId/stateHash 不出此层）。
 */
import Ajv from "ajv";
import { toolSchema, canonicalJson, type BattleEvent, type Observation } from "@seer/contracts";
import { sha256hex, deriveStats, effectivenessOf, sixstatOf, type FrozenPack, type SideId, type StatSpread } from "@seer/battle-core";
import type { AgentView, SubmitFn } from "./views.ts";
import { simulateBatch, type SimHypothesis, type SimResponse } from "./simulate.ts";
import { counterplayFor } from "./knowledge.ts";

const ajv = new Ajv({ allErrors: false, strict: true });
const validate = ajv.compile(toolSchema);

export interface ToolResponse {
  ok: boolean;
  tool: string;
  error?: { code: "INVALID_SCHEMA" | "TOOL_ERROR"; message: string };
  data?: unknown;
}

export interface ToolsDeps {
  view: AgentView;
  pack: FrozenPack;
  submit: SubmitFn;
}

interface HypothesisIn {
  opponentMoveIds?: string[];
  oppStages?: { atk?: number; def?: number; spd?: number };
  note?: string;
}

export class ToolServer {
  private readonly view: AgentView;
  private readonly pack: FrozenPack;
  private readonly submit: SubmitFn;
  /** 工具调用计数——M3 预算门禁的计量点 */
  callCount = 0;
  transitionsSpent = 0;

  constructor(deps: ToolsDeps) {
    this.view = deps.view;
    this.pack = deps.pack;
    this.submit = deps.submit;
  }

  call(request: unknown): ToolResponse {
    if (!validate(request)) {
      return { ok: false, tool: "unknown", error: { code: "INVALID_SCHEMA", message: ajv.errorsText(validate.errors) } };
    }
    this.callCount += 1;
    const req = request as { tool: string } & Record<string, unknown>;
    try {
      switch (req.tool) {
        case "observe":
          return this.ok(req, this.view.observe() satisfies Observation);
        case "history":
          return this.ok(req, this.view.history(req.cursor as number | undefined));
        case "legal_actions": {
          const obs = this.view.observe();
          if (req.decisionId !== obs.decision?.decisionId) {
            return this.ok(req, { legalActions: [], reason: "no open decision for this id" });
          }
          return this.ok(req, { legalActions: obs.legalActions.map((a) => a.actionId) });
        }
        case "lookup_rule":
          return this.ok(req, this.lookupRule(req.id as string));
        case "explain_trace":
          return this.ok(req, this.explainTrace(req.cursor as number | undefined));
        case "simulate_batch": {
          const obs = this.view.observe();
          const r = simulateBatch(this.pack, {
            observation: obs,
            hypotheses: req.hypotheses as SimHypothesis[],
            candidates: req.candidates as string[],
            seed: req.seed as number,
            maxTransitions: req.budget !== undefined ? (req.budget as { maxTransitions: number }).maxTransitions : 2048,
          });
          this.transitionsSpent += r.transitionsUsed;
          return this.ok(req, r satisfies SimResponse);
        }
        case "calculate_damage":
          return this.ok(req, this.calculateDamage(req.moveId as string, req.assumptions as Record<string, unknown>));
        case "search_counterplay":
          return this.ok(req, this.searchCounterplay(req.mechanismQuery as { trigger: string; produces?: string; targetPath?: string }));
        case "submit_action": {
          const r = this.submit({
            battleId: req.battleId as string,
            decisionId: req.decisionId as string,
            baseRevision: req.baseRevision as number,
            actionId: req.actionId as string,
            idempotencyKey: req.idempotencyKey as string,
          });
          return this.ok(req, r);
        }
        default:
          return { ok: false, tool: req.tool, error: { code: "INVALID_SCHEMA", message: `unknown tool ${req.tool}` } };
      }
    } catch (e) {
      return { ok: false, tool: req.tool, error: { code: "TOOL_ERROR", message: (e as Error).message } };
    }
  }

  private ok(req: { tool: string }, data: unknown): ToolResponse {
    return { ok: true, tool: req.tool, data };
  }

  /** 公开规则查询：move/unit/ruleset 特性——数据来自 pack（公开内容），无隐藏信息。 */
  private lookupRule(id: string): Record<string, unknown> {
    const move = this.pack.movesById.get(id);
    if (move) {
      return { kind: "move", id, pp: move.pp, priority: move.priority, effects: move.effects };
    }
    const unit = this.pack.unitsById.get(id);
    if (unit) {
      return { kind: "unit", id, base: unit.base, moveIds: unit.moveIds, ...(unit.mode !== undefined ? { mode: unit.mode } : {}), ...(unit.revives !== undefined ? { revives: unit.revives } : {}) };
    }
    if (id === this.pack.rules.rulesetId) {
      return { kind: "ruleset", id, features: [...this.pack.features], limits: this.pack.limits };
    }
    return { kind: "unknown", id };
  }

  /** 公开事件的因果摘要——只消费 publicStream，不给内部 trigger/cause 链。 */
  private explainTrace(cursor: number | undefined): Record<string, unknown> {
    const { cursor: cur, events } = this.view.history(cursor ?? 0);
    const causal: Array<{ index: number; type: string; summary: string }> = [];
    let lastMove: string | null = null;
    events.forEach((ev, index) => {
      switch (ev.type) {
        case "action-declared":
          lastMove = ev.moveId ?? null;
          causal.push({ index, type: ev.type, summary: `${ev.side} declared ${ev.moveId}` });
          break;
        case "damage":
          causal.push({ index, type: ev.type, summary: `${lastMove ?? "?"} → ${ev.side} took ${ev.amount}${ev.damageKind !== undefined ? ` (${ev.damageKind})` : ""}` });
          break;
        case "heal":
          causal.push({ index, type: ev.type, summary: `${ev.side} healed ${ev.amount}` });
          break;
        case "ko":
          causal.push({ index, type: ev.type, summary: `${ev.side} KO` });
          break;
        case "revive":
          causal.push({ index, type: ev.type, summary: `${ev.side} revived to ${ev.hpAfter.current}` });
          break;
        case "switch":
          causal.push({ index, type: ev.type, summary: `${ev.side} switched ${ev.outUnitId}→${ev.inUnitId} (${ev.via})` });
          break;
        case "action-failed":
          causal.push({ index, type: ev.type, summary: `${ev.side} failed: ${ev.reason}` });
          break;
        case "battle-end":
          causal.push({ index, type: ev.type, summary: `battle ended: ${ev.result} by ${ev.reason}` });
          break;
        default:
          break;
      }
    });
    return { cursor: cur, events: causal };
  }

  /** simulate 的受限包装：单技能对假定目标的确定伤害值（整数、含 damageKind）。 */
  private calculateDamage(moveId: string, assumptions: Record<string, unknown>): Record<string, unknown> {
    const move = this.pack.movesById.get(moveId);
    if (!move) return { moveId, error: "unknown move" };
    const obs = this.view.observe();
    const ownUnit = this.pack.unitsById.get(obs.own.speciesId)!;
    const six = sixstatOf(this.pack) !== undefined;
    const oppSpecies = assumptions.oppSpeciesId as string | undefined;
    const oppUnit = (oppSpecies !== undefined ? this.pack.unitsById.get(oppSpecies) : this.pack.unitsById.get(obs.opponent.speciesId));
    const stageMul = (base: number, stage: number) => Math.floor((base * (stage >= 0 ? 2 + stage : 2)) / (stage >= 0 ? 2 : 2 - stage));
    // six-stat：面板值——己方取 obs.own.stats（已投影），假定目标按其 pack 声明推导默认面板
    const atkKey = move.category === "special" ? "spa" : "atk";
    const defKey = move.category === "special" ? "sdf" : "def";
    const oppPanelDef = six && oppUnit
      ? deriveStats(oppUnit.base as StatSpread, { level: oppUnit.level ?? 100, ivs: oppUnit.ivs!, evs: oppUnit.evs!, nature: oppUnit.nature !== undefined ? sixstatOf(this.pack)!.natures.get(oppUnit.nature) : undefined })[defKey]
      : (oppUnit?.base.def ?? 1);
    const defStage = (assumptions.oppDefStage as number | undefined) ?? 0;
    const defOverride = assumptions.oppDefOverride as number | undefined;
    const effDef = defOverride ?? stageMul(oppPanelDef, defStage);
    const atkStage = (obs.own.stages as unknown as Record<string, number>)[atkKey] ?? 0;
    const ownPanelAtk = six ? ((obs.own.stats as unknown as Record<string, number> | undefined)?.[atkKey] ?? ownUnit.base[atkKey]!) : ownUnit.base.atk;
    const effAtkReal = stageMul(ownPanelAtk, atkStage);
    // 对手属性（类型）是公开的（species 已知）→ 克制/STAB 可入估计
    const eff16 = six && move.type !== undefined && this.pack.typeChart !== undefined && oppUnit !== undefined
      ? effectivenessOf(this.pack.typeChart, move.type, oppUnit.types ?? [])
      : undefined;
    const stab = eff16 !== undefined && move.type !== undefined && (ownUnit.types ?? []).includes(move.type);
    const damages = move.effects.filter((e) => e.op === "damage").map((e) => {
      const kind = (e as { kind?: string }).kind ?? "standard";
      const power = (e as { power?: number }).power ?? 0;
      if (kind === "fixed") return { kind, power, amount: power };
      if (kind === "percent") return { kind, power, amount: Math.floor((power * obs.opponent.hp.max) / 100) };
      if (six) {
        const lvf = Math.floor((obs.own.level ?? 100) * 0.4 + 2);
        let core = Math.floor((lvf * power * effAtkReal) / (effDef * 50)) + 2;
        if (eff16 !== undefined) {
          if (stab) core = Math.floor(core * this.pack.stabMultiplier);
          core = Math.floor((core * eff16) / 16);
        }
        const amountMin = eff16 === 0 ? 0 : Math.max(1, Math.floor((core * 217) / 255));
        const amountMax = eff16 === 0 ? 0 : Math.max(1, Math.floor((core * 255) / 255));
        return { kind, power, amount: amountMax, amountMin, amountMax, ...(eff16 !== undefined ? { eff16, stab } : {}) };
      }
      return { kind, power, amount: Math.max(1, Math.floor((power * effAtkReal) / (2 * effDef))) };
    });
    return { moveId, assumedDef: effDef, attackerAtk: effAtkReal, damages };
  }

  /** 机制反制候选：五类干预 × Knowledge 机制图 × 当前合法集——可重跑候选，非权威 oracle。 */
  private searchCounterplay(query: { trigger: string; produces?: string; targetPath?: string }): Record<string, unknown> {
    const obs = this.view.observe();
    const legal = obs.legalActions.map((a) => a.actionId);
    const interventions = counterplayFor(this.pack, legal, query.trigger).map((i) => ({
      kind: i.intervention,
      candidates: i.candidates,
    }));
    return {
      query,
      interventions,
      rerunnable: true,
      disclaimer: "heuristic candidates from mechanism graph, not authoritative proof",
    };
  }
}

export function hashObservation(obs: Observation): string {
  return `sha256:${sha256hex(canonicalJson(obs))}`;
}
