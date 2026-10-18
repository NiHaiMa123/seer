/**
 * 「每处于N种异常状态则…+M%」——按异常**种数**迭代的倍率/幅值。
 *
 * 引擎已有 foeStatused/selfStatused，但只是布尔门（有异常/无异常）。
 * 语料里 41 处用的是"每 1 种 +N%"的迭代形式，需要一个计数读数。
 *
 * 设计：沿用已有的 perStage 模式，新增 perAilment: { sign?: "self"|"foe"; per: number; pct: number }
 * —— 在 dmgOutPctOf / dmgReduceFlatOf 里按 ailment 种数累加。
 */
import { describe, it, expect } from "vitest";
import { dmgOutPctOf, dmgReduceFlatOf } from "../../../packages/battle-core/src/ops/effects.ts";

const mkUnit = (ailments: string[]) => ({
  unitId: "u1",
  base: { hp: 300, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
  currentHp: 300,
  stages: {},
  effects: ailments.map((k) => ({ kind: k, effectInstanceId: `e-${k}` })),
});

describe("perAilment：按异常种数迭代", () => {
  it("对手 2 种异常 × 每 1 种 +60% → +120%", () => {
    const u = mkUnit([]);
    const foe = mkUnit(["burn", "poison"]);
    u.effects.push({ kind: "modifier", at: "dmgOutPct", perAilment: { who: "foe", per: 1, pct: 60 } } as never);
    expect(dmgOutPctOf(u as never, foe as never)).toBe(120);
  });

  it("对手 0 种异常 → 0", () => {
    const u = mkUnit([]);
    const foe = mkUnit([]);
    u.effects.push({ kind: "modifier", at: "dmgOutPct", perAilment: { who: "foe", per: 1, pct: 60 } } as never);
    expect(dmgOutPctOf(u as never, foe as never)).toBe(0);
  });

  it("自身 1 种异常 × 每 1 种 -33 点承伤 → 减伤 33", () => {
    const u = mkUnit(["burn"]);
    u.effects.push({ kind: "modifier", at: "dmgReduceFlat", perAilment: { who: "self", per: 1, pct: 33 } } as never);
    expect(dmgReduceFlatOf(u as never, mkUnit([]) as never)).toBe(33);
  });

  it("per=2：每 2 种才算 1 档（3 种 → 1 档）", () => {
    const u = mkUnit([]);
    const foe = mkUnit(["burn", "poison", "paralysis"]);
    u.effects.push({ kind: "modifier", at: "dmgOutPct", perAilment: { who: "foe", per: 2, pct: 50 } } as never);
    expect(dmgOutPctOf(u as never, foe as never)).toBe(50);
  });

  it("布尔门 foeStatused 不回归", () => {
    const u = mkUnit([]);
    const foe = mkUnit(["burn"]);
    u.effects.push({ kind: "modifier", at: "dmgOutPct", params: { pct: 25, foeStatused: 1 } } as never);
    expect(dmgOutPctOf(u as never, foe as never)).toBe(25);
  });
});