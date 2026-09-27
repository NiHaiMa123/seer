/**
 * M3 60 战术状态 fixture（dev/holdout 30/30，6 类 ×10）。
 * 每个 = 初始对局配置 + eval-only 状态注入 + counterplay 标注。
 * 标注语义：solutionActions=有效解集（判定用），exists=false 时正确答案是"无解"。
 * 全部为自制合成态——不含原作数据。
 */
import type { BattleHost } from "@seer/host";
import { sha256hex } from "@seer/battle-core";
import type { BattleConfig } from "../packages/agent/src/eval.ts";

export interface M3Fixture extends BattleConfig {
  id: string;
  category: "basic" | "synergy" | "counterplay" | "hidden" | "novel" | "adversarial";
  split: "dev" | "holdout";
  counterplay: {
    exists: boolean;
    interventions: string[];
    solutionActions: string[];
    note: string;
  };
}

type SideStage = { atk?: number; def?: number; spd?: number };
type PatchSpec = {
  p1Stages?: SideStage; p2Stages?: SideStage;
  p1HpPct?: number; p2HpPct?: number;
  p1Effects?: Array<{ kind: string; remainingTurns?: number }>;
  p2Effects?: Array<{ kind: string; remainingTurns?: number }>;
};

const patch = (spec: PatchSpec) => (host: BattleHost) => {
  const b = host.state.battle;
  const applySide = (side: "p1" | "p2") => {
    const stages = side === "p1" ? spec.p1Stages : spec.p2Stages;
    const hpPct = side === "p1" ? spec.p1HpPct : spec.p2HpPct;
    const effects = side === "p1" ? spec.p1Effects : spec.p2Effects;
    if (stages) Object.assign(b.sides[side].unit.stages, stages);
    if (hpPct !== undefined) b.sides[side].unit.currentHp = Math.max(1, Math.floor(b.sides[side].unit.base.hp * hpPct));
    if (effects) {
      b.sides[side].unit.effects.push(...effects.map((e, i) => ({
        kind: e.kind, effectInstanceId: `fx_${side}_${i}`,
        ...(e.remainingTurns !== undefined ? { remainingTurns: e.remainingTurns } : {}),
        appliedTurn: b.turn,
      })));
    }
  };
  applySide("p1"); applySide("p2");
};

let n = 0;
const seedFor = (i: number) => sha256hex(`m3-fixture-${i}`).slice(0, 32);

const fx = (
  category: M3Fixture["category"], split: M3Fixture["split"], i: number,
  species: { p1: string; p2: string }, opts: Partial<M3Fixture> & { patchSpec?: PatchSpec },
): M3Fixture => {
  const idx = n++;
  return {
    id: `${category}-${split}-${i}`,
    category, split,
    battleId: `btl_fx${idx.toString(16)}`,
    seedHex: seedFor(idx),
    species,
    ...(opts.bench !== undefined ? { bench: opts.bench } : {}),
    ...(opts.patchSpec !== undefined ? { patch: patch(opts.patchSpec) } : {}),
    counterplay: opts.counterplay!,
  };
};

const G = "syn-gamma", D = "syn-delta", E = "syn-epsilon";
const atk = (a: string) => [`act_${a}`];

export const FIXTURES: M3Fixture[] = [
  // ── basic：正攻局面，解=直接伤害 ─────────────────────────────
  ...[0, 1, 2, 3, 4].map((i) => fx("basic", "dev", i, { p1: G, p2: i % 2 === 0 ? D : E }, {
    counterplay: { exists: true, interventions: ["bypass_target"], solutionActions: atk("syn-strike"), note: "straight damage suffices" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("basic", "holdout", i, { p1: G, p2: D }, {
    patchSpec: { p2HpPct: 0.5 },
    counterplay: { exists: true, interventions: ["bypass_target"], solutionActions: atk("syn-strike"), note: "finish weakened foe" },
  })),

  // ── synergy：强化/转强联动 ───────────────────────────────────
  ...[0, 1, 2, 3, 4].map((i) => fx("synergy", "dev", i, { p1: D, p2: G }, {
    patchSpec: { p2Stages: { atk: -2, def: -1 } },
    counterplay: { exists: true, interventions: ["remove_precondition"], solutionActions: atk("syn-drain"), note: "drain negative stages" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("synergy", "holdout", i, { p1: D, p2: G }, {
    patchSpec: { p2Stages: { atk: -3 } },
    counterplay: { exists: true, interventions: ["remove_precondition"], solutionActions: atk("syn-drain"), note: "absorb foe's atk penalty" },
  })),

  // ── counterplay：被控/被强化时的反制 ────────────────────────
  ...[0, 1, 2, 3, 4].map((i) => fx("counterplay", "dev", i, { p1: D, p2: G }, {
    patchSpec: { p1Effects: [{ kind: "control", remainingTurns: 2 }] },
    counterplay: { exists: true, interventions: ["block_execution"], solutionActions: atk("syn-purge-mind"), note: "cleanse self stun" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("counterplay", "holdout", i, { p1: D, p2: G }, {
    patchSpec: { p2Stages: { atk: 3, spd: 2 } },
    counterplay: { exists: true, interventions: ["remove_precondition"], solutionActions: atk("syn-purge"), note: "clear boosted foe" },
  })),

  // ── hidden：对手 bench 未知 ─────────────────────────────────
  ...[0, 1, 2, 3, 4].map((i) => fx("hidden", "dev", i, { p1: G, p2: D }, {
    bench: { p2: i % 2 === 0 ? [E] : [G] },
    counterplay: { exists: true, interventions: ["pay_cost"], solutionActions: atk("syn-strike"), note: "press before bench resolves" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("hidden", "holdout", i, { p1: D, p2: G }, {
    bench: { p2: [E] },
    counterplay: { exists: true, interventions: ["bypass_target"], solutionActions: atk("syn-strike"), note: "kill before epsilon enters" },
  })),

  // ── novel：未见组合（percent/fixed 对高防、drain→kill）──────
  ...[0, 1, 2, 3, 4].map((i) => fx("novel", "dev", i, { p1: G, p2: E }, {
    patchSpec: { p2Stages: { def: 5 } },
    counterplay: { exists: true, interventions: ["bypass_target"], solutionActions: atk("syn-blast"), note: "percent dmg ignores def" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("novel", "holdout", i, { p1: D, p2: E }, {
    patchSpec: { p2Stages: { def: 6, atk: -2 } },
    counterplay: { exists: true, interventions: ["remove_precondition"], solutionActions: atk("syn-drain"), note: "drain then finish" },
  })),

  // ── adversarial：诱饵/假解 ──────────────────────────────────
  ...[0, 1, 2, 3, 4].map((i) => fx("adversarial", "dev", i, { p1: G, p2: E }, {
    counterplay: { exists: false, interventions: [], solutionActions: [], note: "epsilon is boss — control/clear are bait (immune)" },
  })),
  ...[5, 6, 7, 8, 9].map((i) => fx("adversarial", "holdout", i, { p1: G, p2: D }, {
    patchSpec: { p2HpPct: 0.3 },
    counterplay: { exists: true, interventions: ["bypass_target"], solutionActions: atk("syn-blast"), note: "delta revives once — percent dmg still correct" },
  })),
];
