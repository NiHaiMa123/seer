/**
 * 两维之和的百分比——把 defSumPct 泛化成任意两维。
 *
 * 语料 187 处、21 种组合（防御+特防 91、特攻+速度 13、体力+速度 10、攻击+防御 8…），
 * 引擎原来只有 defSumPct，写死「防御+特防」一种。
 *
 * 泛化方案：新增 statSumPct: { a, b, pct }（两维名 + 百分比），defSumPct 保留兼容。
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir } from "@seer/battle-core";
import { healOp } from "../../../packages/battle-core/src/ops/heal.ts";
import { join } from "node:path";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");

const mkUnit = () => ({
  unitId: "u1",
  base: { hp: 1000, atk: 200, def: 300, spa: 150, sdf: 400, spd: 250 },
  currentHp: 100,
  stages: {},
  effects: [],
});

const mkCtx = (unit: ReturnType<typeof mkUnit>) => ({
  pack: PACK,
  events: [],
  side: "p1",
  targetSide: "p2",
  unit,
  foe: unit,
  target: unit,
  rng: { drawBelow: () => 0 },
  next: { sides: { p1: { unit, bench: [] }, p2: { unit, bench: [] } } },
}) as never;

describe("statSumPct：两维之和的百分比", () => {
  it("攻击+特攻 40% → (200+150)*0.4 = 140", () => {
    const u = mkUnit();
    healOp(mkCtx(u), { op: "heal", target: "self", statSumPct: { a: "atk", b: "spa", pct: 40 } } as never);
    expect(u.currentHp).toBe(100 + 140);
  });

  it("体力+速度 20% → (1000+250)*0.2 = 250", () => {
    const u = mkUnit();
    healOp(mkCtx(u), { op: "heal", target: "self", statSumPct: { a: "hp", b: "spd", pct: 20 } } as never);
    expect(u.currentHp).toBe(100 + 250);
  });

  it("防御+特攻 10% → (300+150)*0.1 = 45", () => {
    const u = mkUnit();
    healOp(mkCtx(u), { op: "heal", target: "self", statSumPct: { a: "def", b: "spa", pct: 10 } } as never);
    expect(u.currentHp).toBe(100 + 45);
  });

  it("原有 defSumPct 不回归（防御+特防）", () => {
    const u = mkUnit();
    healOp(mkCtx(u), { op: "heal", target: "self", defSumPct: 50 } as never);
    expect(u.currentHp).toBe(100 + Math.floor((300 + 400) * 50 / 100));
  });
});