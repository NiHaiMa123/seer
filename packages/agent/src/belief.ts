/**
 * Belief：与公开历史一致的隐藏世界样本集（≤16）。
 * synthetic 规则下对手的隐藏维度只有两个：
 *  1) bench 组成——公开只见 benchAlive 数量，不见具体 species；
 *  2) PP 消耗——ppEstimate 恒 unknown，已揭示招必在场，
 *     未揭示招可能耗尽 → opponentMoveIds 的合法子集 ⊇ revealed。
 * moveset/stages/effects/mode/revives 全公开，不进 belief。
 *
 * 语义（AGENT.md §3）：
 *  - 未见动作保留非零概率——子集采样不强制删任何未揭示招；
 *  - 新揭示 → 后验收窄；矛盾样本淘汰；样本全空 → reset 宽 prior 并记录 modelError；
 *  - 采样确定：同 (pack, observation, seed) → 同样本集。
 */
import { DeterministicRng, sha256hex, type FrozenPack } from "@seer/battle-core";
import type { Observation } from "@seer/contracts";
import { canonicalJson } from "@seer/contracts";
import type { SimHypothesis } from "./simulate.ts";

export interface BeliefSample extends SimHypothesis {
  /** 对手策略类先验（内部维度，不进 wire schema） */
  policyClass?: "aggressive" | "defensive" | "control" | "baseline";
}

export interface BeliefState {
  samples: BeliefSample[];
  modelErrors: number;
  /** 每次 reset 的原因记录（评测归因用） */
  resets: string[];
}

const MAX_SAMPLES = 16;
const POLICIES: BeliefSample["policyClass"][] = ["aggressive", "defensive", "control", "baseline"];

/** benchAlive=N → 从 pack 单位池取 N 元有序子集（去重，含全部池，含重复同种允许） */
function benchCombos(pool: string[], n: number): string[][] {
  if (n <= 0) return [[]];
  if (n > pool.length) return [];
  const out: string[][] = [];
  const go = (start: number, acc: string[]) => {
    if (acc.length === n) { out.push([...acc]); return; }
    for (let i = start; i < pool.length; i++) { acc.push(pool[i]!); go(i, acc); acc.pop(); }
  };
  go(0, []);
  return out;
}

/** 未揭示招的 PP-耗尽子集：⊇revealed，~2^(unrevealed) 组，deterministic 序 */
function moveSubsets(revealed: string[], pool: string[]): string[][] {
  const hidden = pool.filter((m) => !revealed.includes(m));
  const out: string[][] = [];
  for (let mask = 0; mask < (1 << hidden.length); mask++) {
    const keep = hidden.filter((_, i) => ((mask >>> i) & 1) === 1);
    out.push([...revealed, ...keep]);
  }
  return out;
}

export class Belief {
  private readonly pack: FrozenPack;
  private samples: BeliefSample[] = [];
  private modelErrors = 0;
  private resets: string[] = [];
  private lastKey = "";

  constructor(pack: FrozenPack) {
    this.pack = pack;
  }

  /** 由当前观察重建样本（deterministic——同输入同输出，天然幂等可重算） */
  update(obs: Observation, seed = 1): BeliefState {
    const key = sha256hex(canonicalJson({ obs, seed }));
    if (key === this.lastKey) return this.state();
    this.lastKey = key;

    const opp = obs.opponent;
    const unit = this.pack.unitsById.get(opp.speciesId);
    if (!unit) {
      this.samples = [];
      this.reset(`opponent species ${opp.speciesId} not in pack`);
      return this.state();
    }

    const revealed = [...opp.revealedMoveIds].sort();
    const benchN = opp.benchAlive ?? 0;
    const speciesPool = [...this.pack.unitsById.keys()].sort();
    const benches = benchCombos(speciesPool, benchN);
    const moveSets = moveSubsets(revealed, unit.moveIds);

    // 全组合 = benches × moveSets，seeded 选取至多 16，覆盖尽可能多的组合形态
    const combos: BeliefSample[] = [];
    for (const b of benches) {
      for (const ms of moveSets) {
        combos.push({
          opponentMoveIds: ms,
          ...(b.length > 0 ? { oppBenchSpeciesIds: b } : {}),
        });
      }
    }
    if (combos.length === 0) {
      this.reset(`no consistent hypothesis (revealed=${revealed.join("/")}, benchAlive=${benchN})`);
      return this.state();
    }

    // seeded 均匀采样（不打乱顺序取前 N——保证覆盖面 + 可复现）
    const rng = new DeterministicRng(sha256hex(`belief:${key}`).slice(0, 32));
    const picked: BeliefSample[] = [];
    const seen = new Set<string>();
    // 先均匀跨步采样保证多样
    const stride = Math.max(1, Math.floor(combos.length / MAX_SAMPLES));
    for (let i = 0; i < combos.length && picked.length < MAX_SAMPLES; i += stride) {
      const c = combos[i]!;
      const k = canonicalJson(c);
      if (!seen.has(k)) { seen.add(k); picked.push(c); }
    }
    // 剩余额度 seeded 随机补样
    let guard = 0;
    while (picked.length < MAX_SAMPLES && guard++ < combos.length * 4) {
      const c = combos[rng.drawBelow(combos.length, "pick")]!;
      const k = canonicalJson(c);
      if (!seen.has(k)) { seen.add(k); picked.push(c); }
    }

    // 每个样本绑一个策略类先验（deterministic 轮转，保证类覆盖）
    picked.forEach((s, i) => { s.policyClass = POLICIES[i % POLICIES.length]!; });
    this.samples = picked;
    return this.state();
  }

  /** 手工淘汰与指定谓词不符的样本（如战术证据：某招连续未用） */
  eliminate(predicate: (s: BeliefSample) => boolean, reason: string): BeliefState {
    const before = this.samples.length;
    this.samples = this.samples.filter(predicate);
    if (this.samples.length === 0 && before > 0) {
      this.reset(`all ${before} samples eliminated: ${reason}`);
    }
    return this.state();
  }

  private reset(reason: string): void {
    this.modelErrors += 1;
    this.resets.push(reason);
    // 宽 prior：不做 bench/PP 假设 → 单子集全量 + 无 bench
    this.samples = [{ note: `reset: ${reason}` }];
  }

  state(): BeliefState {
    return { samples: this.samples, modelErrors: this.modelErrors, resets: this.resets };
  }
}
