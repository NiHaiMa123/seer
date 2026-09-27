/**
 * simulate_batch 执行核心：由公开 Observation + 显式假设构造 CoreState
 * （"假定世界"），在纯 battle-core transition 上推演。
 * 纪律：
 *  - 输入只含 Observation（公开）+ hypotheses（调用方显式给出）——无 battle DB；
 *  - 模拟 RNG 由请求 seed 派生（sha256），绝不复用真实局 RNG；
 *  - 同一请求 → 同一结果；transition 计数受 budget.maxTransitions 上限约束。
 */
import { applyTurn, legalActions as coreLegalActions, sha256hex, type CoreState, type FrozenPack, type SideId } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { canonicalJson } from "@seer/contracts";

export interface SimHypothesis {
  opponentMoveIds?: string[];
  oppStages?: { atk?: number; def?: number; spd?: number };
  oppBenchSpeciesIds?: string[];
  note?: string;
}

export interface SimRequest {
  observation: Observation;
  hypotheses: SimHypothesis[]; // ≤16
  candidates: string[]; // 己方 actionId ≤8
  seed: number;
  maxTransitions: number;
}

export interface SimBranchResult {
  hypothesisIndex: number;
  candidate: string;
  opponentAction: string;
  outcome: {
    selfHpDelta: number;
    foeHpDelta: number;
    winner: "p1" | "p2" | "draw" | null;
    suspended: boolean;
  };
}

export interface SimCandidateSummary {
  candidate: string;
  branchCount: number;
  /** 整数 basis points（0..10000）——canonicalJson 只收整数 */
  koRateBps: number;
  selfKoRateBps: number;
  /** 净 HP 收益均值 ×1000（整数毫单位） */
  expectedHpSwingMilli: number;
}

export interface SimResponse {
  assumptionsHash: string;
  transitionsUsed: number;
  truncated: boolean;
  perCandidate: SimCandidateSummary[];
  branches: SimBranchResult[];
}

type PubUnit = { unitId: string; effects: Observation["own"]["effects"] };

const toEffects = (u: PubUnit) =>
  u.effects.map((e, i) => ({
    kind: e.kind,
    effectInstanceId: `sim_${u.unitId}_${i}`,
    ...(e.remainingTurns !== undefined ? { remainingTurns: e.remainingTurns } : {}),
    ...(e.stack !== undefined ? { stack: e.stack } : {}),
  }));

/** 公开观察 + 假设 → 假定 CoreState。对手隐藏字段由 hypothesis 显式填充。 */
export function assumedState(pack: FrozenPack, obs: Observation, hypo: SimHypothesis, seed: number): CoreState {
  const selfSide: SideId = obs.side;
  const foeSide: SideId = selfSide === "p1" ? "p2" : "p1";

  const mkSelf = (): CoreState["sides"]["p1"] => {
    const o = obs.own;
    const u = pack.unitsById.get(o.speciesId);
    if (!u) throw new Error(`species ${o.speciesId} not in pack`);
    const bench = (o.bench ?? []).map((b, i) => {
      const bu = pack.unitsById.get(b.speciesId);
      if (!bu) throw new Error(`bench species ${b.speciesId} not in pack`);
      return {
        unitId: b.unitId, speciesId: b.speciesId, base: { ...bu.base },
        currentHp: b.hp.current, stages: { atk: 0, def: 0, spd: 0 },
        moves: bu.moveIds.map((mid) => ({ moveId: mid, pp: pack.movesById.get(mid)!.pp, ppMax: pack.movesById.get(mid)!.pp })),
        revealedMoveIds: [], effects: [],
      };
    });
    return {
      unit: {
        unitId: o.unitId, speciesId: o.speciesId, base: { ...u.base },
        currentHp: o.hp.current,
        stages: { ...o.stages },
        moves: Object.entries(o.ppByMoveId).map(([moveId, pp]) => ({
          moveId, pp, ppMax: pack.movesById.get(moveId)?.pp ?? pp,
        })),
        revealedMoveIds: [],
        effects: toEffects(o),
        ...(o.mode !== undefined ? { mode: o.mode } : {}),
        ...(o.revives !== undefined ? { revives: o.revives } : {}),
      },
      ...(bench.length > 0 ? { bench } : {}),
    };
  };

  const mkFoe = (): CoreState["sides"]["p1"] => {
    const f = obs.opponent;
    const u = pack.unitsById.get(f.speciesId);
    if (!u) throw new Error(`opponent species ${f.speciesId} not in pack`);
    // 隐藏 move 集合 = 已揭示 ∪ 假设（取 unit.moveIds 内的合法交集，顺序确定）
    const assumed = (hypo.opponentMoveIds ?? u.moveIds).filter((id) => u.moveIds.includes(id));
    const moveIds = [...new Set([...f.revealedMoveIds, ...assumed])].slice(0, u.moveIds.length);
    const st = hypo.oppStages ?? {};
    const bench = (hypo.oppBenchSpeciesIds ?? []).map((sp, i) => {
      const bu = pack.unitsById.get(sp);
      if (!bu) throw new Error(`assumed bench species ${sp} not in pack`);
      return {
        unitId: `unit_${foeSide}-b${i}`, speciesId: sp, base: { ...bu.base },
        currentHp: bu.base.hp, stages: { atk: 0, def: 0, spd: 0 },
        moves: bu.moveIds.map((mid) => ({ moveId: mid, pp: pack.movesById.get(mid)!.pp, ppMax: pack.movesById.get(mid)!.pp })),
        revealedMoveIds: [], effects: [],
      };
    });
    return {
      unit: {
        unitId: f.unitId, speciesId: f.speciesId, base: { ...u.base },
        currentHp: f.hp.current,
        stages: { atk: st.atk ?? f.stages.atk, def: st.def ?? f.stages.def, spd: st.spd ?? f.stages.spd },
        moves: moveIds.map((moveId) => ({ moveId, pp: pack.movesById.get(moveId)!.pp, ppMax: pack.movesById.get(moveId)!.pp })),
        revealedMoveIds: [...f.revealedMoveIds],
        effects: toEffects(f),
        ...(f.mode !== undefined ? { mode: f.mode } : {}),
      },
      ...(bench.length > 0 ? { bench } : {}),
    };
  };

  const seedHex = sha256hex(`sim-seed:${seed}`).slice(0, 32);
  return {
    schemaVersion: 1,
    battleId: obs.battleId,
    rules: pack.rules,
    revision: obs.revision,
    turn: obs.turn,
    phase: "collect",
    rng: { algorithmId: "xoshiro128**", seedHex, drawCounter: 0 },
    sides: { p1: selfSide === "p1" ? mkSelf() : mkFoe(), p2: selfSide === "p2" ? mkSelf() : mkFoe() },
    speedTiebreak: null,
    terminal: null,
  };
}

const OPP_CAP = 8;

export function simulateBatch(pack: FrozenPack, req: SimRequest): SimResponse {
  const selfSide: SideId = req.observation.side;
  const foeSide: SideId = selfSide === "p1" ? "p2" : "p1";
  const branches: SimBranchResult[] = [];
  const perCandidate = new Map<string, { n: number; ko: number; selfKo: number; swing: number }>();
  let transitions = 0;
  let truncated = false;

  outer: for (let hi = 0; hi < req.hypotheses.length; hi++) {
    const hypo = req.hypotheses[hi]!;
    const state0 = assumedState(pack, req.observation, hypo, req.seed);
    const oppActions = coreLegalActions(state0, foeSide).slice(0, OPP_CAP);
    for (const cand of req.candidates) {
      for (const opp of oppActions) {
        if (++transitions > req.maxTransitions) { truncated = true; transitions--; break outer; }
        const r = applyTurn(pack, state0, {
          p1: { actionId: selfSide === "p1" ? cand : opp, origin: "player", idempotencyKey: "sim" },
          p2: { actionId: selfSide === "p2" ? cand : opp, origin: "player", idempotencyKey: "sim" },
        });
        if (!r.ok) continue;
        const selfAfter = r.state.sides[selfSide].unit.currentHp;
        const foeAfter = r.state.sides[foeSide].unit.currentHp;
        const selfHpDelta = selfAfter - req.observation.own.hp.current;
        const foeHpDelta = foeAfter - req.observation.opponent.hp.current;
        const winner = r.state.terminal === null ? null : r.state.terminal.result === selfSide ? selfSide : r.state.terminal.result === foeSide ? foeSide : "draw";
        branches.push({
          hypothesisIndex: hi,
          candidate: cand,
          opponentAction: opp,
          outcome: { selfHpDelta, foeHpDelta, winner, suspended: r.state.suspension !== undefined && r.state.suspension !== null },
        });
        const acc = perCandidate.get(cand) ?? { n: 0, ko: 0, selfKo: 0, swing: 0 };
        acc.n += 1;
        if (foeAfter <= 0 && req.observation.opponent.hp.current > 0) acc.ko += 1;
        if (selfAfter <= 0 && req.observation.own.hp.current > 0) acc.selfKo += 1;
        acc.swing += (-foeHpDelta) + selfHpDelta; // 敌人掉血(+)+己方血变化(掉血为负) = 净收益
        perCandidate.set(cand, acc);
      }
    }
  }

  const summaries: SimCandidateSummary[] = [...perCandidate.entries()].map(([candidate, a]) => ({
    candidate,
    branchCount: a.n,
    koRateBps: a.n === 0 ? 0 : Math.round((a.ko * 10000) / a.n),
    selfKoRateBps: a.n === 0 ? 0 : Math.round((a.selfKo * 10000) / a.n),
    expectedHpSwingMilli: a.n === 0 ? 0 : Math.round((a.swing * 1000) / a.n),
  }));

  return {
    assumptionsHash: `sha256:${sha256hex(canonicalJson({ o: req.observation, h: req.hypotheses, c: req.candidates, s: req.seed }))}`,
    transitionsUsed: transitions,
    truncated,
    perCandidate: summaries,
    branches,
  };
}
