/**
 * apply_status / apply_effect 的边界测试。
 *
 * 这个 op 是效果执行的主入口（215 行、分支密集），此前只被集成测试间接覆盖。
 * 这里直接调 handler，锁住最容易回归的几条：
 *   - 基础施加与 turns 落地
 *   - 异常反弹（reflect{of:status}）把施加重定向回行动方
 *   - 免疫拦截 + 次数盾逐次递减耗尽
 *   - params.count 的合并语义（同 kind 再施加应累加而不是新增条目）
 *   - apply_effect 走 tag: 前缀，与 apply_status 的 kind 命名空间分开
 *   - 传入错误的 op 名要抛 OP_DISPATCH
 */
import { describe, it, expect } from "vitest";
import { applyStatusOp } from "../../../packages/battle-core/src/ops/apply-effect.ts";
import { IM, RF } from "../../../packages/battle-core/src/ops/effects.ts";
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
    next: { sides: { p1: { unit, bench: [] }, p2: { unit: target, bench: [] } } },
    rng: { drawBelow: () => 0 },
    ...over,
  } as unknown as OpCtx;
  return { ctx, events, unit, target };
};

describe("apply_status 基础", () => {
  it("施加异常：落地为 kind=name 的条目，带 remainingTurns", () => {
    const { ctx, target } = mkCtx();
    const r = applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent", turns: 3 } as any);
    expect(r).toBe("continue");
    expect((target as any).effects).toHaveLength(1);
    expect((target as any).effects[0]).toMatchObject({ kind: "burn", remainingTurns: 3 });
  });

  it("同名再施加：不产生第二条（合并语义）", () => {
    const { ctx, target } = mkCtx();
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent", turns: 3 } as any);
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent", turns: 5 } as any);
    expect((target as any).effects.filter((e: any) => e.kind === "burn")).toHaveLength(1);
  });

  it("self 目标：由调用方把 ctx.target 解析成行动方（handler 不自己做这件事）", () => {
    // apply-status 只认 ctx.target；target 的解析（target:"self" → 行动方）在
    // ops/index.ts 的 targetSideOf 里完成。所以这里按调用方的契约传入。
    const base = mkCtx();
    const ctx = { ...base.ctx, target: base.unit, targetSide: "p1" } as unknown as OpCtx;
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "self", turns: 2 } as any);
    expect((base.unit as any).effects).toHaveLength(1);
    expect((base.target as any).effects).toHaveLength(0);
  });
});

describe("apply_status 反弹", () => {
  it("目标持 reflect{of:status}：异常被弹回行动方", () => {
    const { ctx, events, unit, target } = mkCtx();
    // 目标身上的反弹条目（axes 脱糖后的形状：kind=reflect + params.of）
    (target as any).effects.push({ kind: "reflect", params: { of: RF.status } });
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent", turns: 2 } as any);
    // 施加方（unit）吃到了这条异常
    expect((unit as any).effects.some((e: any) => e.kind === "burn")).toBe(true);
    expect((target as any).effects.some((e: any) => e.kind === "burn")).toBe(false);
    expect(events.some((e) => e.type === "control-immune")).toBe(true);
  });

  it("目标是自身时不触发反弹（同侧不弹）", () => {
    // 同上：self 目标需要调用方先把 target 指到行动方；targetSide === side 时反弹分支不成立
    const base = mkCtx();
    (base.unit as any).effects.push({ kind: "reflect", params: { of: RF.status } });
    const ctx = { ...base.ctx, target: base.unit, targetSide: "p1" } as unknown as OpCtx;
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "self", turns: 2 } as any);
    expect((base.unit as any).effects.filter((e: any) => e.kind === "burn")).toHaveLength(1);
  });
});

describe("apply_status 免疫", () => {
  it("目标持免疫：异常被拦下，不发落地条目", () => {
    const { ctx, events, target } = mkCtx();
    (target as any).effects.push({ kind: "immune", params: { of: IM.status } });
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent", turns: 2 } as any);
    expect((target as any).effects.some((e: any) => e.kind === "burn")).toBe(false);
    expect(events.some((e) => e.type === "control-immune")).toBe(true);
    // 免疫记账
    expect((target as any).immuneThisTurn).toBe(1);
  });

  it("次数盾：count 递减，耗尽后条目移除", () => {
    const { ctx, target } = mkCtx();
    const shield = { kind: "immune", params: { of: IM.status, count: 2 } };
    (target as any).effects.push(shield);
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent" } as any);
    expect((shield.params as any).count).toBe(1);
    applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "opponent" } as any);
    expect((target as any).effects.some((e: any) => e.kind === "immune")).toBe(false);
  });

  it("免疫只拦 ailment，自身 buff 类照常落地", () => {
    const { ctx, target } = mkCtx();
    (target as any).effects.push({ kind: "immune", params: { of: IM.status } });
    // hot 不是 ailment（effects.ts 里没有 ailment:true）
    applyStatusOp(ctx, { op: "apply_status", name: "hot", target: "opponent", turns: 3, params: { n: 1, d: 4 } } as any);
    expect((target as any).effects.some((e: any) => e.kind === "hot" || e.kind === "periodic")).toBe(true);
  });
});

describe("apply_status 随机抽取", () => {
  it("random：按 count 抽若干种，逐个落地", () => {
    const { ctx, target } = mkCtx();
    applyStatusOp(ctx, { op: "apply_status", name: "random", target: "opponent", random: { list: ["burn", "poison", "paralysis"], count: 2 } } as any);
    const got = (target as any).effects.filter((e: any) => ["burn", "poison", "paralysis"].includes(e.kind));
    expect(got).toHaveLength(2);
  });
});

describe("apply_effect", () => {
  it("走 tag: 前缀，与 apply_status 的 kind 命名空间分开", () => {
    const { ctx, target } = mkCtx();
    applyStatusOp(ctx, { op: "apply_effect", name: "mymark", target: "opponent" } as any);
    const kinds = (target as any).effects.map((e: any) => e.kind);
    expect(kinds).toContain("tag:mymark");
    expect(kinds).not.toContain("mymark");
  });
});

describe("参数守卫", () => {
  it("op 名不对：抛错并指明收到的 op", () => {
    const { ctx } = mkCtx();
    expect(() => applyStatusOp(ctx, { op: "heal", name: "x", target: "self" } as any)).toThrow(/handler got heal/);
  });
});
