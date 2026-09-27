/**
 * Deterministic baseline policy——消融实验的 "deterministic rule" 基线。
 * 无 LLM、无 RNG、无隐藏信息：observe → simulate 评估候选 → argmax。
 * 规则（固定顺序，第一条命中即用）：
 *  1) 有可直接 KO 的动作 → 选 swing 最大的 KO 动作
 *  2) 己方 hp ≤25% 且有 heal → 用 heal
 *  3) 否则选 expectedHpSwing 最大的动作（平手取字典序最小）
 *  4) replacement 决策 → 最低存活 bench
 */
import type { Observation } from "@seer/contracts";
import type { FrozenPack } from "@seer/battle-core";
import { simulateBatch } from "./simulate.ts";

export interface Decision {
  actionId: string;
  rationale: string;
}

const KO_BONUS = 1e6;

export function decideBaseline(pack: FrozenPack, obs: Observation): Decision {
  const legal = obs.legalActions.map((a) => a.actionId);

  // replacement 决策：最低下标存活 bench，否则 concede
  if (obs.decision?.kind === "replacement") {
    const sw = legal.filter((a) => a.startsWith("act_switch-")).sort();
    const pick = sw[0] ?? "act_concede";
    return { actionId: pick, rationale: "replacement: lowest living bench" };
  }

  if (legal.length === 0) return { actionId: "act_concede", rationale: "no legal actions" };
  const candidates = legal.filter((a) => a !== "act_concede");
  if (candidates.length === 0) return { actionId: "act_concede", rationale: "only concede legal" };

  // 假设对手满配置（宽 prior）——baseline 不做 belief，直接用 pack 全集
  const r = simulateBatch(pack, {
    observation: obs,
    hypotheses: [{}],
    candidates,
    seed: 1,
    maxTransitions: 2048,
  });

  const bySwing = [...r.perCandidate].sort((a, b) => b.expectedHpSwingMilli - a.expectedHpSwingMilli || (a.candidate < b.candidate ? -1 : 1));
  const best = bySwing[0];

  // 1) KO 动作优先
  const koable = r.perCandidate.filter((c) => c.koRateBps >= 10000);
  if (koable.length > 0) {
    koable.sort((a, b) => b.expectedHpSwingMilli - a.expectedHpSwingMilli || (a.candidate < b.candidate ? -1 : 1));
    return { actionId: koable[0]!.candidate, rationale: `ko-able (${koable[0]!.candidate})` };
  }

  // 2) 低血量有回复 → 回复
  const heal = obs.legalActions.find((a) => a.actionId.includes("recover") || a.actionId.includes("heal"));
  if (obs.own.hp.current * 4 <= obs.own.hp.max && heal) {
    return { actionId: heal.actionId, rationale: "low hp → heal" };
  }

  // 3) swing 最大
  if (best !== undefined) {
    return { actionId: best.candidate, rationale: `max expectedHpSwing=${best.expectedHpSwingMilli / 1000}` };
  }
  return { actionId: candidates.sort()[0]!, rationale: "fallback lexicographic" };
}
