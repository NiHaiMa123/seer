/**
 * invert_stages 的单维读法（stat）：直接调处理器喂 IR，不经过中文规则。
 *
 * 语料只有一句「反转对手速度能力提升状态」（e27-df-02 新接），
 * 但 stat 不在 moves schema 的 effects 放行集里（schema 只放行 sign/mul/target/onEnterTarget），
 * 所以不能靠 compilePack 装进数据包来测——这里直接调 ops/copy-stages.ts 的 invertStagesOp，
 * 手搓最小 OpCtx（handler 只读 pack/events/side/target/targetSide）。
 *
 * 三条语义：
 *   stat 给定时只翻那一维，其它维一字不动；
 *   不传 stat 时仍反转全部非零的那一侧（sign 缺省=down）；
 *   sign:"up" 只看正级（目标全负级时无变化 → action-failed no-stages）。
 */
import { describe, expect, it } from "vitest";
import { EngineFault } from "@seer/battle-core";
import { OPS } from "../../../packages/battle-core/src/ops/index.ts";
import { invertStagesOp } from "../../../packages/battle-core/src/ops/copy-stages.ts";
import type { OpCtx } from "../../../packages/battle-core/src/ops/types.ts";
import type { CoreEvent, CoreState } from "@seer/battle-core";

interface Unit {
  stages: Record<string, number>;
  effects: unknown[];
}

/**
 * 包只用来算 stage 维（mechanics/index.ts 的 stageKeysFor）：
 *   legacy  无 sixstat → 三维 atk/def/spd
 *   five    有 sixstat → 五维（补 spa/sdf）
 *   sixAcc  有 sixstat + accuracy 特性 → 六维（再补 acc）
 * 其余字段 handler 一概不读，空着即可。
 */
type PackKind = "legacy" | "five" | "sixAcc";
const pack = (kind: PackKind) => (kind === "legacy"
  ? { mechanics: {} }
  : kind === "five"
  ? { mechanics: { sixstat: {} } }
  : { mechanics: { sixstat: {} }, features: new Set(["accuracy"]) }) as never;

const mkCtx = (target: Unit, kind: PackKind): { ctx: OpCtx; events: CoreEvent[] } => {
  const events: CoreEvent[] = [];
  const ctx = {
    pack: pack(kind),
    events,
    side: "p1",
    targetSide: "p2",
    target,
  } as unknown as OpCtx;
  return { ctx, events };
};

/** 只跑一次 op，返回泛化后的目标 stages 与 stat-stage / action-failed 事件。 */
const run = (stages: Record<string, number>, fx: Record<string, unknown>, kind: PackKind = "sixAcc") => {
  const target: Unit = { stages: { ...stages }, effects: [] };
  const { ctx, events } = mkCtx(target, kind);
  const r = invertStagesOp(ctx, { op: "invert_stages", ...fx } as never);
  return {
    result: r,
    stages: target.stages,
    stage: events.filter((e) => e.type === "stat-stage").map((e) => e.detail as { side: string; stat: string; deltaApplied: number; stageAfter: number }),
    /** action-failed 的 side 是行动方（ctx.side），只锁 reason 就够。 */
    failed: events.filter((e) => e.type === "action-failed").map((e) => (e.detail as { reason: string }).reason),
  };
};

const ALL_UP = { atk: 1, def: 2, spa: 1, sdf: 0, spd: 3 };

describe("invert_stages: 单维（stat 给定）", () => {
  it("sign=up + stat=spd：只把速度 +3 翻成 -3，其它维一字不动", () => {
    const r = run(ALL_UP, { sign: "up", target: "opponent", stat: "spd" });
    expect(r.result).toBe("continue");
    expect(r.stages).toEqual({ atk: 1, def: 2, spa: 1, sdf: 0, spd: -3 });
    expect(r.stage).toEqual([{ side: "p2", stat: "spd", deltaApplied: -6, stageAfter: -3 }]);
    expect(r.failed).toEqual([]);
  });

  it("stat 指名的那一维是负级时不动它（sign=up 只看正级）→ action-failed no-stages", () => {
    const r = run({ atk: 1, spd: -1 }, { sign: "up", target: "opponent", stat: "spd" });
    expect(r.stages).toEqual({ atk: 1, spd: -1 });
    expect(r.stage).toEqual([]);
    expect(r.failed).toEqual(["no-stages"]);
  });

  it("stat 指名的那一维不在这个包的 stage 维里 → 同样 no-stages，不越界写", () => {
    // legacy 包只有三维 atk/def/spd，spa 不在 stageKeys 里：过滤后没有任何一维可翻
    const r = run({ atk: 1, spa: 1 }, { sign: "up", target: "opponent", stat: "spa" }, "legacy");
    expect(r.stages).toEqual({ atk: 1, spa: 1 });
    expect(r.failed).toEqual(["no-stages"]);
  });

  it("stat=acc 也照同一路径走（accuracy 特性把 acc 放进 stage 维）", () => {
    const r = run({ acc: 2, spd: 1 }, { sign: "up", target: "opponent", stat: "acc" });
    expect(r.stages).toEqual({ acc: -2, spd: 1 });
    expect(r.stage).toEqual([{ side: "p2", stat: "acc", deltaApplied: -4, stageAfter: -2 }]);
  });

  it("spa/sdf 只在六维包里有 stage 维：五维包上指名它们翻不动", () => {
    expect(run({ spa: 1 }, { sign: "up", target: "opponent", stat: "spa" }, "five").stages).toEqual({ spa: -1 });
    expect(run({ spa: 1 }, { sign: "up", target: "opponent", stat: "spa" }, "legacy").failed).toEqual(["no-stages"]);
  });
});

describe("invert_stages: 无 stat 时仍反转全部非零的那一侧", () => {
  it("sign=up：正级全翻负，负级/零不动", () => {
    const r = run(ALL_UP, { sign: "up", target: "opponent" });
    expect(r.stages).toEqual({ atk: -1, def: -2, spa: -1, sdf: 0, spd: -3 });
    expect(r.stage.map((e) => e.stat)).toEqual(["atk", "def", "spd", "spa"]); // stageKeysFor：五维在前，六维机制补 spa/sdf
  });

  it("sign 缺省=down：负级全翻正，正级不动", () => {
    const r = run({ atk: -2, def: 1, spa: -1 }, { target: "opponent" });
    expect(r.stages).toEqual({ atk: 2, def: 1, spa: 1 });
    expect(r.stage.map((e) => e.stat)).toEqual(["atk", "spa"]);
  });

  it("两侧全空 → action-failed no-stages", () => {
    const r = run({ atk: 0, def: 0 }, { sign: "up", target: "opponent" });
    expect(r.stages).toEqual({ atk: 0, def: 0 });
    expect(r.failed).toEqual(["no-stages"]);
  });
});

describe("invert_stages: 信封与兼容", () => {
  it("mul 分数倍率在单维上同样生效（双倍反转）", () => {
    const r = run({ spd: 2, atk: 2 }, { sign: "up", target: "opponent", stat: "spd", mul: { numerator: 2, denominator: 1 } });
    expect(r.stages).toEqual({ spd: -4, atk: 2 });
    expect(r.stage).toEqual([{ side: "p2", stat: "spd", deltaApplied: -6, stageAfter: -4 }]);
  });

  it("op 名不符 → EngineFault（reason=OP_DISPATCH），不静默跑别的语义", () => {
    const { ctx, events } = mkCtx({ stages: {}, effects: [] }, "sixAcc");
    let fault: unknown;
    try {
      invertStagesOp(ctx, { op: "copy_stages" } as never);
    } catch (e) { fault = e; }
    expect(fault).toBeInstanceOf(EngineFault);
    expect((fault as EngineFault).reason).toBe("OP_DISPATCH");
    expect((fault as Error).message).toMatch(/invert_stages handler got copy_stages/);
    expect(events).toEqual([]); // 抛错前不写事件、不动状态
  });

  it("不新开 op：invert_stages 仍由 OPS 注册表里的 invertStagesOp 处理", () => {
    // stat 是结算侧已有的读法（copy-stages.ts 里的 fx.stat），不是新 op、也不加新处理器。
    expect(OPS.invert_stages).toBe(invertStagesOp);
  });
});
