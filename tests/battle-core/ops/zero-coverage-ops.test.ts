/**
 * 零覆盖 op 的单元测试（force_switch / swap_hp / transfer_ailments /
 * stat_boost / hp_delta）。
 *
 * 这五个 op 此前只被集成测试经 OPS 表间接走到，边界条件（无后备、免疫、
 * 上限钳制、空迁移）没有被单独锁过。这里直接调 handler，用最小 mock ctx。
 */
import { describe, it, expect } from "vitest";
import { forceSwitchOp } from "../../../packages/battle-core/src/ops/force-switch.ts";
import { swapHpOp } from "../../../packages/battle-core/src/ops/swap-hp.ts";
import { transferAilmentsOp } from "../../../packages/battle-core/src/ops/transfer-ailments.ts";
import { statBoostOp } from "../../../packages/battle-core/src/ops/stat-boost.ts";
import { hpDeltaOp } from "../../../packages/battle-core/src/ops/hp-delta.ts";
import type { OpCtx } from "../../../packages/battle-core/src/ops/types.ts";

const mkUnit = (over: Record<string, unknown> = {}) => ({
  unitId: "u1",
  base: { hp: 300, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
  currentHp: 300,
  stages: {},
  effects: [] as Record<string, unknown>[],
  ...over,
});

const mkCtx = (over: Record<string, unknown> = {}) => {
  const events: Record<string, unknown>[] = [];
  const unit = mkUnit();
  const target = mkUnit({ unitId: "u2" });
  const ctx = {
    pack: { mechanics: {} },
    events,
    side: "p1",
    targetSide: "p2",
    unit,
    target,
    foe: target,
    rng: { drawBelow: () => 0 },
    next: {
      sides: {
        p1: { unit, bench: [] },
        p2: { unit: target, bench: [] },
      },
    },
    ...over,
  } as unknown as OpCtx;
  return { ctx, events, unit, target };
};

describe("force_switch", () => {
  it("有存活后备：交换并广播 via=forced", () => {
    const benchUnit = mkUnit({ unitId: "u2b" });
    const { ctx, events, target } = mkCtx();
    (ctx as any).next.sides.p2.bench = [benchUnit];
    const r = forceSwitchOp(ctx, { op: "force_switch", target: "opponent" } as any);
    expect(r).toBe("continue");
    expect(events.some((e) => e.type === "switch" && (e.detail as any).via === "forced")).toBe(true);
    expect((ctx as any).next.sides.p2.unit).toBe(benchUnit);
    expect(target).toBeDefined();
  });

  it("无存活后备：action-failed no-bench", () => {
    const { ctx, events } = mkCtx();
    (ctx as any).next.sides.p2.bench = [];
    forceSwitchOp(ctx, { op: "force_switch", target: "opponent" } as any);
    expect(events.some((e) => e.type === "action-failed" && (e.detail as any).reason === "no-bench")).toBe(true);
  });

  it("后备全阵亡：同样 no-bench", () => {
    const { ctx, events } = mkCtx();
    (ctx as any).next.sides.p2.bench = [mkUnit({ unitId: "dead", currentHp: 0 })];
    forceSwitchOp(ctx, { op: "force_switch", target: "opponent" } as any);
    expect(events.some((e) => e.type === "action-failed" && (e.detail as any).reason === "no-bench")).toBe(true);
  });
});

describe("swap_hp", () => {
  it("绝对值互换：双方 currentHp 对调", () => {
    const { ctx, unit, target } = mkCtx();
    unit.currentHp = 100;
    target.currentHp = 250;
    swapHpOp(ctx, { op: "swap_hp", target: "opponent" } as any);
    expect(unit.currentHp).toBe(250);
    expect(target.currentHp).toBe(100);
  });

  it("上限钳制：目标体力超过自身 max 时被截断", () => {
    const { ctx, unit, target } = mkCtx();
    unit.currentHp = 100;
    target.currentHp = 999; // > unit.base.hp=300
    swapHpOp(ctx, { op: "swap_hp", target: "opponent" } as any);
    expect(unit.currentHp).toBeLessThanOrEqual(unit.base.hp);
  });

  it("百分比互换：各自按对方百分比取新血", () => {
    const { ctx, unit, target } = mkCtx();
    unit.currentHp = 150; // 50%
    target.currentHp = 75; // 25%
    swapHpOp(ctx, { op: "swap_hp", target: "opponent", swapPercent: true } as any);
    // 双方 max 都是 300：unit 拿到对方的 25% = 75，target 拿到对方的 50% = 150
    expect(unit.currentHp).toBe(75);
    expect(target.currentHp).toBe(150);
  });
});

describe("transfer_ailments", () => {
  // unit.effects 的 kind 就是效果 id（apply_status 的 name 直写），不是 "control:burn"
  const burn = { kind: "burn", label: "burn", remainingTurns: 2 };

  it("pull：把对手异常移到自身，双方各广播 faded/applied", () => {
    const { ctx, events, unit, target: foe } = mkCtx();
    (foe as any).effects = [burn];
    transferAilmentsOp(ctx, { op: "transfer_ailments", target: "opponent", direction: "pull" } as any);
    expect((unit as any).effects).toContainEqual(burn);
    expect((foe as any).effects).toEqual([]);
    expect(events.some((e) => e.type === "effect-faded")).toBe(true);
    expect(events.some((e) => e.type === "effect-applied")).toBe(true);
  });

  it("无异常可移：不发事件", () => {
    const { ctx, events } = mkCtx();
    (ctx.foe as any).effects = [];
    transferAilmentsOp(ctx, { op: "transfer_ailments", target: "opponent", direction: "pull" } as any);
    expect(events.filter((e) => e.type === "effect-faded" || e.type === "effect-applied")).toEqual([]);
  });

  it("目标已有同名异常：不重复迁移", () => {
    const { ctx, unit, target: foe } = mkCtx();
    (foe as any).effects = [burn];
    (unit as any).effects = [{ ...burn }];
    transferAilmentsOp(ctx, { op: "transfer_ailments", target: "opponent", direction: "pull" } as any);
    expect((unit as any).effects).toHaveLength(1);
  });
});

describe("stat_boost", () => {
  it("按 add 提升面板并向 hp 回填", () => {
    const { ctx, events, target } = mkCtx();
    (target as any).currentHp = 100;
    statBoostOp(ctx, { op: "stat_boost", stats: ["hp", "atk"], add: 50, target: "opponent" } as any);
    expect((target as any).base.atk).toBe(150);
    expect((target as any).base.hp).toBe(350);
    expect((target as any).currentHp).toBe(150); // 上限提升即回血
    expect(events.filter((e) => e.type === "effect-applied")).toHaveLength(2);
  });

  it("pct 按当前面板取增量", () => {
    const { ctx, target } = mkCtx();
    statBoostOp(ctx, { op: "stat_boost", stats: ["atk"], pct: 10, target: "opponent" } as any);
    expect((target as any).base.atk).toBe(110);
  });

  it("增量不为正：action-failed no-boost", () => {
    const { ctx, events } = mkCtx();
    statBoostOp(ctx, { op: "stat_boost", stats: ["atk"], add: 0, target: "opponent" } as any);
    expect(events.some((e) => e.type === "action-failed" && (e.detail as any).reason === "no-boost")).toBe(true);
  });
});

describe("hp_delta", () => {
  it("flat：按固定值扣血并广播 fixed damage", () => {
    const { ctx, events, target } = mkCtx();
    (target as any).currentHp = 200;
    hpDeltaOp(ctx, { op: "hp_delta", target: "opponent", flat: 50 } as any);
    expect((target as any).currentHp).toBe(150);
    expect(events.some((e) => e.type === "damage" && (e.detail as any).amount === 50)).toBe(true);
  });

  it("frac of max：按目标最大体力分数扣", () => {
    const { ctx, target } = mkCtx();
    hpDeltaOp(ctx, { op: "hp_delta", target: "opponent", frac: { of: "max", numerator: 1, denominator: 4 } } as any);
    expect((target as any).currentHp).toBe(300 - 75);
  });

  it("selfStageFlat：按自身正级种数计费", () => {
    const { ctx, unit, target } = mkCtx();
    (unit as any).stages = { atk: 1, def: 2, spd: -1 };
    hpDeltaOp(ctx, { op: "hp_delta", target: "opponent", selfStageFlat: { per: 1, flat: 20, sign: "up" } } as any);
    expect((target as any).currentHp).toBe(300 - 40); // 两个正级 × 20
  });

  it("扣血不会低于 0", () => {
    const { ctx, target } = mkCtx();
    (target as any).currentHp = 10;
    hpDeltaOp(ctx, { op: "hp_delta", target: "opponent", flat: 999 } as any);
    expect((target as any).currentHp).toBe(0);
  });
});
