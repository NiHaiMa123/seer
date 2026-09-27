/**
 * Planner：joint-action beam 搜索（AGENT.md §3）。
 * - 双方同时选招：root 枚举 (己方候选 ≤8) × (对手回应 ≤8)，不假装已知对手动作；
 * - 同 belief 样本同 seed 评估每个 root（降噪）；
 * - 对手 = 策略混合均值 + worst-case 保守分（对手选我方最差的回应）；
 * - 深度 ≤2 决策窗口、beam ≤8、总 transition ≤ budget；
 * - 后续策略只看模拟中当时已揭示信息（information set）；
 * - 超预算先削深度后削分支，记录截断原因。
 */
import { applyTurn, applyReplacement, legalActions as coreLegal, type CoreState, type FrozenPack, type SideId } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { assumedState, type SimHypothesis } from "./simulate.ts";
import type { BeliefSample } from "./belief.ts";

export interface PlannerConfig {
  depth: 1 | 2;
  beamWidth: number;
  maxTransitions: number;
  ownCap: number;
  oppCap: number;
}

export const DEFAULT_PLANNER: PlannerConfig = { depth: 2, beamWidth: 8, maxTransitions: 2048, ownCap: 8, oppCap: 8 };

export interface RootScore {
  actionId: string;
  meanMilli: number;   // 混合均值 ×1000 整数
  worstMilli: number;  // worst-case ×1000 整数
}

export interface PlanResult {
  actionId: string;
  scores: RootScore[];
  transitionsUsed: number;
  truncated: boolean;
  truncations: string[];
}

interface Budget { used: number; max: number; truncations: string[] }

const isSuspend = (s: CoreState): boolean => s.suspension !== undefined && s.suspension !== null;

/** 状态启发值（非终局），范围约 ±999。整数算术，与 spec 系数一致后冻结。 */
export function heuristic(state: CoreState, self: SideId): number {
  const foe: SideId = self === "p1" ? "p2" : "p1";
  const s = state.sides[self].unit;
  const f = state.sides[foe].unit;
  let v = 0;
  // HP 比例差 ×500
  const sHp = s.base.hp === 0 ? 0 : Math.floor((s.currentHp * 500) / s.base.hp);
  const fHp = f.base.hp === 0 ? 0 : Math.floor((f.currentHp * 500) / f.base.hp);
  v += sHp - fHp;
  // stage 优势
  const stDiff = (s.stages.atk + s.stages.def + s.stages.spd) - (f.stages.atk + f.stages.def + f.stages.spd);
  v += Math.max(-60, Math.min(60, stDiff * 10));
  // 控制：对手被控 +30，己方被控 -30
  const has = (e: ReadonlyArray<{ kind: string }>, k: string) => e.some((x) => x.kind === k);
  if (has(f.effects, "control")) v += 30;
  if (has(s.effects, "control")) v -= 30;
  // 资源：己方剩余 PP 比例 ×50 - 对手不可见 PP 不计
  const totPp = s.moves.reduce((a, m) => a + m.pp, 0);
  const totMax = s.moves.reduce((a, m) => a + m.ppMax, 0) || 1;
  v += Math.floor((totPp * 50) / totMax);
  // bench 优势 ×20
  const sb = (state.sides[self].bench ?? []).filter((b) => b.currentHp > 0).length;
  const fb = (state.sides[foe].bench ?? []).filter((b) => b.currentHp > 0).length;
  v += (sb - fb) * 20;
  return Math.max(-999, Math.min(999, v));
}

const terminalValue = (state: CoreState, self: SideId): number | null => {
  if (state.terminal === null) return null;
  const r = state.terminal.result;
  if (r === "draw") return 0;
  return r === self ? 1000 : -1000;
};

function evalNode(pack: FrozenPack, state: CoreState, self: SideId): number {
  const t = terminalValue(state, self);
  return t ?? heuristic(state, self);
}

/** 对手策略类 → 该侧动作打分函数（联合枚举下的对手回应选择器） */
function oppPick(pack: FrozenPack, state: CoreState, opp: SideId, cls: BeliefSample["policyClass"], budget: Budget): { action: string; value: number } {
  const oppActs = coreLegal(state, opp).slice(0, 8);
  if (oppActs.length === 0) return { action: "act_concede", value: 0 };
  // aggressive: 对自己启发值最高；worst-case: 对我方最低（在 joint 枚举里天然覆盖）
  // control: 偏好带 control/clear 的 actionId 字符串特征（机制图可查但成本高，policyClass 先用低成本启发）
  const prefer = (a: string): number => {
    if (cls === "control" && /hex|ward|purge|drain/.test(a)) return 1;
    if (cls === "aggressive" && /strike|slam|blast|jab|nuke|quake/.test(a)) return 1;
    if (cls === "defensive" && /recover|bolster|ward|defend|heal/.test(a)) return 1;
    return 0;
  };
  const sorted = [...oppActs].sort((a, b) => prefer(b) - prefer(a) || (a < b ? -1 : 1));
  return { action: sorted[0]!, value: 0 };
}

/** 应用 joint action（含 replacement 续跑的简化处理） */
function jointApply(pack: FrozenPack, state: CoreState, self: SideId, aSelf: string, aFoe: string, budget: Budget): { state: CoreState; ok: boolean } {
  if (++budget.used > budget.max) return { state, ok: false };
  const foe: SideId = self === "p1" ? "p2" : "p1";
  const r = applyTurn(pack, state, {
    p1: { actionId: self === "p1" ? aSelf : aFoe, origin: "player", idempotencyKey: "sim" },
    p2: { actionId: self === "p2" ? aSelf : aFoe, origin: "player", idempotencyKey: "sim" },
  });
  if (!r.ok) return { state, ok: false };
  let s = r.state;
  // 挂起：KO 侧用最低存活 bench 补替（planner 层简化——replacement 搜索留 M3-03+）
  let guard = 0;
  while (isSuspend(s) && guard++ < 4) {
    const ko = s.suspension!.koSide;
    const pickIdx = (s.sides[ko].bench ?? []).findIndex((b) => b.currentHp > 0);
    if (pickIdx < 0) return { state: s, ok: true };
    if (++budget.used > budget.max) return { state: s, ok: false };
    const rep = applyReplacement(pack, s, {
      p1: ko === "p1" ? { actionId: `act_switch-${pickIdx}`, origin: "timeout_default", idempotencyKey: "sim" } : null,
      p2: ko === "p2" ? { actionId: `act_switch-${pickIdx}`, origin: "timeout_default", idempotencyKey: "sim" } : null,
    });
    if (!rep.ok) return { state: s, ok: false };
    s = rep.state;
  }
  return { state: s, ok: true };
}

/** 深度-2 展开：从 node 出发，self 取 max over 己动作，对手按混合/worst 覆盖 */
function expandDepth2(pack: FrozenPack, node: CoreState, self: SideId, cfg: PlannerConfig, budget: Budget): { mean: number; worst: number } {
  const foe: SideId = self === "p1" ? "p2" : "p1";
  const ownActs = coreLegal(node, self).slice(0, cfg.ownCap);
  const oppActs = coreLegal(node, foe).slice(0, cfg.oppCap);
  if (ownActs.length === 0) return { mean: evalNode(pack, node, self), worst: evalNode(pack, node, self) };
  let bestMean = -Infinity;
  let bestWorst = -Infinity;
  for (const a of ownActs) {
    const vals: number[] = [];
    for (const b of oppActs) {
      if (budget.used >= budget.max) { budget.truncations.push("depth2 branches"); break; }
      const j = jointApply(pack, node, self, a, b, budget);
      if (!j.ok) { budget.used--; continue; }
      vals.push(evalNode(pack, j.state, self));
    }
    if (vals.length === 0) continue;
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    const worst = Math.min(...vals);
    if (mean > bestMean) bestMean = mean;
    if (worst > bestWorst) bestWorst = worst;
  }
  if (bestMean === -Infinity) return { mean: evalNode(pack, node, self), worst: evalNode(pack, node, self) };
  return { mean: bestMean, worst: bestWorst };
}

export function plan(
  pack: FrozenPack,
  obs: Observation,
  samples: Array<SimHypothesis & { policyClass?: BeliefSample["policyClass"] }>,
  seed: number,
  cfg: PlannerConfig = DEFAULT_PLANNER,
): PlanResult {
  const self: SideId = obs.side;
  const foe: SideId = self === "p1" ? "p2" : "p1";
  const budget: Budget = { used: 0, max: cfg.maxTransitions, truncations: [] };
  const ownCands = obs.legalActions.map((a) => a.actionId).filter((a) => a !== "act_concede").slice(0, cfg.ownCap);
  if (ownCands.length === 0) {
    return { actionId: "act_concede", scores: [], transitionsUsed: 0, truncated: false, truncations: [] };
  }

  const scores: RootScore[] = [];
  for (const a of ownCands) {
    const means: number[] = [];
    const worsts: number[] = [];
    for (const s of samples) {
      const st0 = assumedState(pack, obs, s, seed);
      const oppActs = coreLegal(st0, foe).slice(0, cfg.oppCap);
      // 对手策略类先验 → 回应权重：worst-case 覆盖全部回应；mean 以策略偏好回应为代表
      const policyAction = oppPick(pack, st0, foe, s.policyClass ?? "baseline", budget).action;
      const respSet = new Set<string>([policyAction, ...oppActs]); // worst-case 需要全集
      const vals: number[] = [];
      const policyVals: number[] = [];
      for (const b of respSet) {
        if (budget.used >= budget.max) { budget.truncations.push("root joint branches"); break; }
        const j = jointApply(pack, st0, self, a, b, budget);
        if (!j.ok) { budget.used--; continue; }
        let v = evalNode(pack, j.state, self);
        // 深度 2：非终局展开（beam=本节点直接展开，不维护全局 beam——root 已限 8）
        if (cfg.depth === 2 && terminalValue(j.state, self) === null && !isSuspend(j.state)) {
          if (budget.used + cfg.ownCap * cfg.oppCap <= budget.max * 2) {
            const d2 = expandDepth2(pack, j.state, self, cfg, budget);
            v = Math.floor((v + d2.mean) / 2); // 1层即时值与2层期望值各半
          } else {
            budget.truncations.push("depth2 skipped by budget");
          }
        }
        vals.push(v);
        if (b === policyAction) policyVals.push(v);
      }
      if (vals.length === 0) continue;
      const worst = Math.min(...vals);
      // mean：对手策略回应与全回应均匀各占一半（混合 + 保守折中）
      const meanUniform = vals.reduce((x, y) => x + y, 0) / vals.length;
      const meanPolicy = policyVals.length > 0 ? policyVals.reduce((x, y) => x + y, 0) / policyVals.length : meanUniform;
      means.push((meanUniform + meanPolicy) / 2);
      worsts.push(worst);
    }
    if (means.length === 0) {
      scores.push({ actionId: a, meanMilli: -999000, worstMilli: -999000 });
      continue;
    }
    const meanMilli = Math.round((means.reduce((x, y) => x + y, 0) / means.length) * 1000);
    const worstMilli = Math.round(Math.min(...worsts) * 1000);
    scores.push({ actionId: a, meanMilli, worstMilli });
  }

  // 选择：worst-case 优先、mean 破平——保守 baseline 语义
  scores.sort((x, y) => y.worstMilli - x.worstMilli || y.meanMilli - x.meanMilli || (x.actionId < y.actionId ? -1 : 1));
  return {
    actionId: scores[0]!.actionId,
    scores,
    transitionsUsed: budget.used,
    truncated: budget.truncations.length > 0,
    truncations: budget.truncations,
  };
}
