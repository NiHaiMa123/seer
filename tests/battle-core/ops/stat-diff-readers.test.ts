/**
 * statDiff 幅值的**引擎级**验证。
 *
 * 解析出 statDiff 字段不等于生效——每个 reader 必须真的读它。
 * 这里直接调 reader / handler，确认读数不是 0：
 *   - statDiffOf 本身
 *   - dmgReduceFlatOf（受伤减 n 点）
 *   - dmgOutPctOf（增伤 n%）
 *   - healOp（恢复 n 点）
 *   - hpDeltaOp（扣 n 点）
 *   - condEval 的 statDiffAbove
 *
 * 之前犯过的错：只写字段不接 reader，效果静默变 0。
 */
import { describe, it, expect } from "vitest";
import {
  statDiffOf,
  dmgReduceFlatOf,
  dmgOutPctOf,
} from "../../../packages/battle-core/src/ops/effects.ts";
import { healOp } from "../../../packages/battle-core/src/ops/heal.ts";
import { hpDeltaOp } from "../../../packages/battle-core/src/ops/hp-delta.ts";
import { condEval } from "../../../packages/battle-core/src/ops/cond.ts";
import type { OpCtx } from "../../../packages/battle-core/src/ops/types.ts";

const mkUnit = (over: Record<string, unknown> = {}) => ({
  unitId: "u1",
  base: { hp: 300, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
  currentHp: 300,
  stages: {},
  effects: [] as Record<string, unknown>[],
  ...over,
});

/** 自身 def=100，对手 def=350 → n=250 */
const mkPair = () => {
  const unit = mkUnit();
  const foe = mkUnit({ unitId: "u2", base: { hp: 300, atk: 100, def: 350, spa: 100, sdf: 100, spd: 100 } });
  return { unit, foe };
};

const mkCtx = (unit: any, foe: any) => {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    ctx: {
      pack: { mechanics: {} }, events, side: "p1", targetSide: "p2",
      unit, target: foe, foe, rng: { drawBelow: () => 0 },
      next: { sides: { p1: { unit, bench: [] }, p2: { unit: foe, bench: [] } } },
    } as unknown as OpCtx,
  };
};

describe("statDiffOf", () => {
  it("取 |自身该维 - 对手该维|", () => {
    const { unit, foe } = mkPair();
    expect(statDiffOf(unit as any, foe as any, "def")).toBe(250);
  });

  it("带分母时取整", () => {
    const { unit, foe } = mkPair();
    expect(statDiffOf(unit as any, foe as any, "def", 200)).toBe(1);
  });

  it("对手缺失时返回 0（不抛）", () => {
    const { unit } = mkPair();
    expect(statDiffOf(unit as any, undefined, "def")).toBe(0);
  });
});

describe("reader 真的读 statDiff", () => {
  it("dmgReduceFlatOf：受伤减 n 点", () => {
    const { unit, foe } = mkPair();
    (unit as any).effects.push({ kind: "modifier", at: "dmgReduceFlat", params: { flat: 0, statDiff: "def" } });
    expect(dmgReduceFlatOf(unit as any, foe as any)).toBe(250);
  });

  it("dmgReduceFlatOf：statDiff 落在条目顶层也认（apply_status 的 params 限 number）", () => {
    const { unit, foe } = mkPair();
    (unit as any).effects.push({ kind: "modifier", at: "dmgReduceFlat", params: {}, statDiff: "def" });
    expect(dmgReduceFlatOf(unit as any, foe as any)).toBe(250);
  });

  it("dmgOutPctOf：增伤 n%", () => {
    const { unit, foe } = mkPair();
    (unit as any).effects.push({ kind: "modifier", at: "dmgOutPct", params: { pct: 0, statDiff: "def" } });
    expect(dmgOutPctOf(unit as any, foe as any)).toBe(250);
  });

  it("dmgOutPctOf：statDiff 落在条目顶层也认", () => {
    const { unit, foe } = mkPair();
    (unit as any).effects.push({ kind: "modifier", at: "dmgOutPct", params: {}, statDiff: "def" });
    expect(dmgOutPctOf(unit as any, foe as any)).toBe(250);
  });

  it("healOp：恢复 n 点体力", () => {
    const { unit, foe } = mkPair();
    // max hp 要够大，否则会先撞上体力上限（300）而看不出 statDiff 的实际幅值
    (unit as any).base = { ...(unit as any).base, hp: 1000 };
    (unit as any).currentHp = 100;
    const { ctx } = mkCtx(unit, foe);
    healOp(ctx, { op: "heal", target: "self", flat: 0, statDiff: "def" } as any);
    expect((unit as any).currentHp).toBe(100 + 250);
  });

  it("hpDeltaOp：扣 n 点", () => {
    const { unit, foe } = mkPair();
    const { ctx } = mkCtx(unit, foe);
    hpDeltaOp(ctx, { op: "hp_delta", target: "opponent", statDiff: "def" } as any);
    expect((foe as any).currentHp).toBe(300 - 250);
  });
});

describe("statDiffAbove 条件", () => {
  it("n ≥ 阈值 → true", () => {
    const { unit, foe } = mkPair();
    const { ctx } = mkCtx(unit, foe);
    expect(condEval(ctx, { statDiffAbove: { stat: "def", atLeast: 200 } })).toBe(true);
  });

  it("n < 阈值 → false", () => {
    const { unit, foe } = mkPair();
    const { ctx } = mkCtx(unit, foe);
    expect(condEval(ctx, { statDiffAbove: { stat: "def", atLeast: 300 } })).toBe(false);
  });
});
