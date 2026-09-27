/**
 * M3 评测工具库（AGENT.md §7）。
 * - Wilson 95% CI；配对 bootstrap 差值区间；
 * - 配对种子对局：同 seed 矩阵跨消融组 + 换边；
 * - 平局/超时单列，不通过删局提高胜率；
 * - 决策延迟/transition/token 计量进报告。
 */
import type { FrozenPack } from "@seer/battle-core";
import { BattleHost, createReadOnlyView } from "@seer/host";
import { sha256hex } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { decideBaseline } from "./baseline.ts";
import { plan, DEFAULT_PLANNER, type PlannerConfig } from "./planner.ts";
import { Belief } from "./belief.ts";
import { LlmPolicy, DecisionClock, LOCAL_BUDGET, type BudgetSpec } from "./llm.ts";
import type { ModelProvider } from "./provider.ts";
import type { AgentView, SubmitFn } from "./views.ts";

export type ArmId = "random" | "rule" | "llm" | "llm_retrieval" | "search" | "full";

export interface ArmSpec {
  id: ArmId;
  provider?: ModelProvider;
  planner?: Partial<PlannerConfig>;
  budget?: Partial<BudgetSpec>;
}

/** 单决策：返回 actionId（各消融组语义） */
export interface Policy {
  decide(obs: Observation): Promise<string>;
}

export function mkPolicy(arm: ArmSpec, pack: FrozenPack, belief: Belief | null, seed: number): Policy {
  const clock = () => new DecisionClock({ ...LOCAL_BUDGET, ...arm.budget });
  switch (arm.id) {
    case "random": {
      let n = 0;
      return {
        decide: (obs) => {
          // seeded 均匀——不探隐藏字段
          const legal = obs.legalActions.map((a) => a.actionId);
          const v = parseInt(sha256hex(`rnd:${seed}:${obs.turn}:${n++}`).slice(0, 8), 16);
          return Promise.resolve(legal[v % legal.length]!);
        },
      };
    }
    case "rule":
      return { decide: (obs) => Promise.resolve(decideBaseline(pack, obs).actionId) };
    case "llm": {
      const p = new LlmPolicy(arm.provider!, { ...LOCAL_BUDGET, ...arm.budget });
      return {
        decide: async (obs) => (await p.decide(obs, pack, clock(), new AbortController().signal)).proposal.actionId,
      };
    }
    case "llm_retrieval": {
      // LLM+检索：Echo/真模型之上把 belief 样本摘要注进 prompt——mock 下等价 llm，标注 arm 区分
      const p = new LlmPolicy(arm.provider!, { ...LOCAL_BUDGET, ...arm.budget });
      return {
        decide: async (obs) => {
          belief?.update(obs); // 检索路径记账（mock 提示不变）
          return (await p.decide(obs, pack, clock(), new AbortController().signal)).proposal.actionId;
        },
      };
    }
    case "search":
      return {
        decide: (obs) =>
          Promise.resolve(plan(pack, obs, belief?.update(obs).samples ?? [{}], obs.turn, { ...DEFAULT_PLANNER, ...arm.planner }).actionId),
      };
    case "full": {
      // LLM → 合法校验 → 失败落 planner（LLM+retrieval+search 全栈）
      const p = new LlmPolicy(arm.provider!, { ...LOCAL_BUDGET, ...arm.budget });
      return {
        decide: async (obs) => {
          const r = await p.decide(obs, pack, clock(), new AbortController().signal);
          if (r.path !== "fallback") return r.proposal.actionId;
          return plan(pack, obs, belief?.update(obs).samples ?? [{}], obs.turn, { ...DEFAULT_PLANNER, ...arm.planner }).actionId;
        },
      };
    }
  }
}

export interface GameResult {
  winner: "p1" | "p2" | "draw" | "timeout";
  turns: number;
  armDecisions: number;
  armMsTotal: number;
  armTransitions: number;
}

export interface BattleConfig {
  battleId: string;
  seedHex: string;
  species: { p1: string; p2: string };
  bench?: { p1?: string[]; p2?: string[] };
  /** 评测态注入（eval-only）：覆盖 stage/hp/effects */
  patch?: (host: BattleHost) => void;
}

const REPLACEMENT_PICK = (obs: Observation): string =>
  obs.legalActions.find((a) => a.actionId.startsWith("act_switch-"))?.actionId ?? "act_concede";

/** 单局：arm 侧自弈固定对手（rule baseline）。arm 坐 side。 */
export async function playGame(
  pack: FrozenPack, cfg: BattleConfig, armPolicy: Policy, armSide: "p1" | "p2",
  opponent: "rule", maxTurns = 300,
): Promise<GameResult> {
  const host = new BattleHost({
    pack, battleId: cfg.battleId, seedHex: cfg.seedHex,
    species: cfg.species,
    ...(cfg.bench !== undefined ? { bench: cfg.bench } : {}),
    players: armSide === "p1" ? { p1: "arm", p2: "opp" } : { p1: "opp", p2: "arm" },
    deadlineMs: 60_000,
  });
  cfg.patch?.(host);
  const playerOf = (side: "p1" | "p2") => (side === armSide ? "arm" : "opp");
  let decisions = 0, msTotal = 0, transitions = 0;
  let turns = 0, stall = 0;

  while (host.state.battle.terminal === null && turns < maxTurns) {
    let acted = false;
    for (const side of ["p1", "p2"] as const) {
      const obs = host.observe(playerOf(side));
      const dec = obs.decision;
      if (dec === null || !dec.actors.includes(side)) continue;
      const inboxed = host.state.battle.inbox[side] != null;
      if (inboxed) continue;
      let pick: string;
      if (dec.kind === "replacement") {
        pick = REPLACEMENT_PICK(obs);
      } else if (side === armSide) {
        const t0 = Date.now();
        pick = await armPolicy.decide(obs);
        msTotal += Date.now() - t0;
        decisions += 1;
      } else {
        pick = decideBaseline(pack, obs).actionId;
      }
      const r = host.submit(playerOf(side), {
        battleId: cfg.battleId, decisionId: dec.decisionId,
        baseRevision: dec.baseRevision, actionId: pick,
        idempotencyKey: `ev_${side}_${dec.decisionId}`,
      });
      const inner = r as { ok?: boolean };
      if (inner.ok !== true) {
        // 提交失败不计 acted——外层循环下一迭代会发现仍空 inbox；
        // 但防死锁：连续 3 次无进展就当 timeout 局终止
        stall += 1;
        if (stall >= 3) return { winner: "timeout", turns: host.state.battle.turn, armDecisions: decisions, armMsTotal: msTotal, armTransitions: transitions };
        continue;
      }
      stall = 0;
      acted = true;
    }
    if (!acted) break;
    turns = host.state.battle.turn;
  }
  const term = host.state.battle.terminal;
  return {
    winner: term === null ? "timeout" : term.result,
    turns: host.state.battle.turn,
    armDecisions: decisions,
    armMsTotal: msTotal,
    armTransitions: transitions,
  };
}

/**
 * Oracle 判定集：在 fixture 态上做更宽更深的搜索（depth2 × 全样本 × 2048），
 * 取 worstMilli 距最优 ≤epsilon 的动作集。fixture 的"有效解"由此可证，
 * 而非手写主题标签——防止 fixture 要求次优动作。
 */
export function oraclePickSet(
  pack: FrozenPack, obs: Observation, samples: Parameters<typeof plan>[2],
  epsilonMilli = 150, cfg: Partial<PlannerConfig> = {},
): { set: string[]; scores: Array<{ actionId: string; meanMilli: number; worstMilli: number }> } {
  const r = plan(pack, obs, samples, obs.turn, { ...DEFAULT_PLANNER, depth: 2, ...cfg });
  const best = r.scores[0];
  if (best === undefined) return { set: [], scores: r.scores };
  const set = r.scores.filter((s) => best.worstMilli - s.worstMilli <= epsilonMilli).map((s) => s.actionId);
  return { set, scores: r.scores };
}

/** Wilson 95% CI（正态近似） */
export function wilson(wins: number, n: number): { lo: number; hi: number; p: number } {
  if (n === 0) return { lo: 0, hi: 0, p: 0 };
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half), p };
}

/** 配对 bootstrap：同 index 局对胜率差分布（999 重抽） */
export function pairedBootstrap(armWins: boolean[], refWins: boolean[], draws = 999, seed = 7): { lo: number; hi: number; estimate: number } {
  const n = Math.min(armWins.length, refWins.length);
  if (n === 0) return { lo: 0, hi: 0, estimate: 0 };
  const est = armWins.filter(Boolean).length / n - refWins.filter(Boolean).length / n;
  let state = seed >>> 0 || 1;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 0x100000000;
  const diffs: number[] = [];
  for (let d = 0; d < draws; d++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(next() * n);
      if (armWins[j]) a++;
      if (refWins[j]) b++;
    }
    diffs.push(a / n - b / n);
  }
  diffs.sort((x, y) => x - y);
  return { lo: diffs[Math.floor(draws * 0.025)]!, hi: diffs[Math.ceil(draws * 0.975) - 1]!, estimate: est };
}
