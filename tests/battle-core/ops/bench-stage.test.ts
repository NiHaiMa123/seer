/**
 * 「自身背包内每存活/阵亡 N 只精灵则 X% 的概率强化效果翻倍」的结算读法。
 * 直接喂 IR（不经中文规则）：`apply_stat_stage` 的正 delta 条目带
 *   `deltaMulChance = { chance: X, numerator: 2, denominator: 1, perBench: { of, per } }`
 * 判定概率 = min(100, X × max(1, ⌊背包计数 / per⌋))——背包计数 0 时保底一次 X% 判定。
 * 计数读法与 `dmgOutPctOf` 同一份（`ops/damage.ts` 的 `benchCountsOf`）：己方 bench 里
 * `currentHp > 0 && banished !== true` 记存活，`currentHp <= 0` 记阵亡
 * ——banished 过滤只作用在存活侧（现成读法就是这样，这里不另立一份）。
 *
 * 这里锁三件事：
 *   ① 概率算得对——统计「这一回合翻倍没翻倍」的实际结果，而不是读内部字段；
 *   ② 边界——背包 0 只仍是 X%（不是 0%）；计数封顶在 100%；一次判定，没有「每 N 只多判定一次」；
 *   ③ 旧行为不变——不带 perBench 的 deltaMulChance 与不带 deltaMulChance 的普通强化逐字照旧。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, sha256hex, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

const benchUnit = (id: string) => ({ id, name: id.toUpperCase(), base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mnone"] });

/** 每个招式都是「自身攻击 +1」加一个待测的 deltaMulChance 变体；对手是空招。 */
const pack = (): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "bench-stage", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mplain", "mchance", "malive50", "malive30", "malive100", "mdead50", "mnone"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mnone"] },
      benchUnit("b1"), benchUnit("b2"), benchUnit("b3"),
    ],
  },
  moves: {
    moves: [
      // 不带 deltaMulChance 的素强化（对照组）
      { id: "mplain", name: "素强化", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
      // 不带 perBench 的旧句（"30%概率强化效果翻倍"——行为必须逐字不变）
      { id: "mchance", name: "概率翻倍", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulChance: { chance: 30, numerator: 2, denominator: 1 } }] },
      { id: "malive50", name: "背包存活50", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulChance: { chance: 50, numerator: 2, denominator: 1, perBench: { of: "alive", per: 1 } } }] },
      { id: "malive30", name: "背包存活30每2", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulChance: { chance: 30, numerator: 2, denominator: 1, perBench: { of: "alive", per: 2 } } }] },
      { id: "malive100", name: "背包存活40封顶", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulChance: { chance: 40, numerator: 2, denominator: 1, perBench: { of: "alive", per: 1 } } }] },
      { id: "mdead50", name: "背包阵亡50", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulChance: { chance: 50, numerator: 2, denominator: 1, perBench: { of: "dead", per: 1 } } }] },
      { id: "mnone", name: "空招", type: "普通", pp: 20, priority: 0, effects: [] },
    ],
  },
} as never);

const PACK = pack();
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });

type Slot = { currentHp: number; banished?: boolean };

/** 开局带 3 只后备，再按 benchState 摆好每个槽位。 */
const setup = (seed: string, benchState: Slot[]): CoreState => {
  const s = initBattle(PACK, { battleId: "btl_bench_stage", seedHex: seed, p1: "u1", p2: "u2", bench: { p1: ["b1", "b2", "b3"] } }) as CoreState;
  const bench = s.sides.p1.bench!;
  for (let i = 0; i < bench.length; i++) {
    bench[i]!.currentHp = benchState[i]!.currentHp;
    if (benchState[i]!.banished === true) bench[i]!.banished = true;
  }
  return s;
};

const ALIVE3: Slot[] = [{ currentHp: 400 }, { currentHp: 400 }, { currentHp: 400 }];
const DEAD3: Slot[] = [{ currentHp: 0 }, { currentHp: 0 }, { currentHp: 0 }];
const ONE_ALIVE: Slot[] = [{ currentHp: 400 }, { currentHp: 0 }, { currentHp: 0 }];

const seedOf = (i: number) => sha256hex(`bench-stage-${i}`).slice(0, 32);

/** 走一回合：返回攻击等级落点、是否翻倍、以及本回合的 draw 数。 */
const run = (seed: string, moveId: string, benchState: Slot[]) => {
  const r = applyTurn(PACK, setup(seed, benchState), { p1: act(`act_${moveId}`), p2: act("act_mnone") });
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  const atk = r.state!.sides.p1.unit.stages.atk ?? 0;
  return { atk, doubled: atk === 2, draws: r.state!.rng.drawCounter };
};

/** 概率估计：n 场不同 seed 里翻倍的比例（%）。 */
const pct = (moveId: string, benchState: Slot[], n = 400) => {
  let hit = 0;
  for (let i = 0; i < n; i++) if (run(seedOf(i), moveId, benchState).doubled) hit++;
  return (hit * 100) / n;
};

describe("apply_stat_stage deltaMulChance.perBench（背包计数放大概率）", () => {
  it("背包 0 只存活：50% 的句子仍是 50%（保底一次判定，不是 0%）", () => {
    const p = pct("malive50", DEAD3);
    expect(p).toBeGreaterThan(38);
    expect(p).toBeLessThan(62);
  });

  it("背包 1 只存活：50% → 50%（⌊1/1⌋=1）", () => {
    const p = pct("malive50", ONE_ALIVE);
    expect(p).toBeGreaterThan(38);
    expect(p).toBeLessThan(62);
  });

  it("背包 3 只存活：50% → min(100, 50×3) = 100%（必定翻倍）", () => {
    expect(pct("malive50", ALIVE3, 60)).toBe(100);
    // 100% 也是「一次判定」：draw 数与 1 只存活时相同，没有「每 N 只多判定一次」
    const seed = sha256hex("bench-stage-draws").slice(0, 32);
    expect(run(seed, "malive50", ALIVE3).draws).toBe(run(seed, "malive50", ONE_ALIVE).draws);
  });

  it("per=2 时按 ⌊计数/2⌋ 步进：3 只 → ⌊3/2⌋=1 → 仍 30%；0 只也 30%", () => {
    const three = pct("malive30", ALIVE3);
    const zero = pct("malive30", DEAD3);
    expect(three).toBeGreaterThan(24);
    expect(three).toBeLessThan(36);
    expect(zero).toBeGreaterThan(24);
    expect(zero).toBeLessThan(36);
  });

  it("min(100, …) 封顶：40%×3 → 100%；40%×1 → 40%", () => {
    expect(pct("malive100", ALIVE3, 60)).toBe(100);
    const p = pct("malive100", ONE_ALIVE);
    expect(p).toBeGreaterThan(30);
    expect(p).toBeLessThan(50);
  });

  it("banished 的槽位两边都不计（与 dmgOutPctOf 同一份计数）", () => {
    // 3 只满血但前两只被 banished → 存活计数只剩 1 → 50%
    const p = pct("malive50", [{ currentHp: 400, banished: true }, { currentHp: 400, banished: true }, { currentHp: 400 }]);
    expect(p).toBeGreaterThan(38);
    expect(p).toBeLessThan(62);
    // 阵亡计数照搬 dmgOutPctOf 的那份读法（`currentHp <= 0`，banished 不参与过滤）——
    // banished 过滤只作用在存活侧，所以被 banished 的阵亡槽仍计阵亡 → 3 只 → 必翻倍
    const d = pct("mdead50", [{ currentHp: 0, banished: true }, { currentHp: 0 }, { currentHp: 0 }], 60);
    expect(d).toBe(100);
  });

  it("of 决定读哪一份计数：阵亡句在 3 只阵亡时必翻倍，存活句在同一 bench 下只剩保底", () => {
    expect(pct("mdead50", DEAD3, 60)).toBe(100);
    const p = pct("malive50", DEAD3);
    expect(p).toBeGreaterThan(38);
    expect(p).toBeLessThan(62);
  });

  it("旧行为不变：不带 perBench 的 deltaMulChance 仍读静态 chance；不带 deltaMulChance 的强化从不翻倍", () => {
    // 30% 静态（背包 3 只存活也不放大）
    const p = pct("mchance", ALIVE3);
    expect(p).toBeGreaterThan(22);
    expect(p).toBeLessThan(38);
    // 素强化：永远 +1
    let doubled = 0;
    for (let i = 0; i < 40; i++) if (run(seedOf(i), "mplain", ALIVE3).doubled) doubled++;
    expect(doubled).toBe(0);
    expect(run(sha256hex("plain-check").slice(0, 32), "mplain", ALIVE3).atk).toBe(1);
  });
});
