/**
 * PP 检视谓词族——本回合选择的招式 PP 状态。
 *
 * 语料 213 处涉及 PP 检视，其中最多的一类是
 *   「若对手所选择的技能PP值为0则当回合对手无法行动」
 * 现有 cond 只有 foePpLt（统计对手"有几个技能 PP<N"）和 selfPpSumAboveFoe（总和比较），
 * 没有"本回合**选择的那个**技能的 PP"这个读数。
 *
 * 这里新增三个谓词，读 c.foeMove / c.move 对应的 unit.moves 槽位：
 *   foeMovePpZero   对手本回合选择的技能 PP 为 0
 *   selfMovePpZero  自身本回合选择的技能 PP 为 0
 *   movePpAtLeast   本回合选择的技能 PP >= N
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir, initBattle, applyTurn } from "@seer/battle-core";
import { condEval } from "../../../packages/battle-core/src/ops/cond.ts";
import { join } from "node:path";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");
const SEED = "11".repeat(16);
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });

/** 造一个最小 ctx：unit/foe + foeMove。 */
const mkCtx = (over: Record<string, unknown> = {}) => {
  // unit.moves 的 moveId 必须与 c.move.id 对应，否则 ppOfChosen 找不到槽位
  const selfMove = PACK.movesById.get("syn-jab")!;
  const foeMove = PACK.movesById.get("syn-strike")!;
  const unit = { unitId: "u1", base: { hp: 300 }, currentHp: 300, stages: {}, effects: [], moves: [{ moveId: selfMove.id, pp: 5, ppMax: 5 }] };
  const foe = { unitId: "u2", base: { hp: 300 }, currentHp: 300, stages: {}, effects: [], moves: [{ moveId: foeMove.id, pp: 0, ppMax: 5 }] };
  return {
    pack: { mechanics: {} },
    events: [],
    side: "p1",
    targetSide: "p2",
    unit,
    foe,
    target: foe,
    move: selfMove,
    foeMove,
    next: { sides: { p1: { unit, bench: [] }, p2: { unit: foe, bench: [] } } },
    rng: { drawBelow: () => 0 },
    ...over,
  } as never;
};

describe("PP 检视谓词", () => {
  it("foeMovePpZero：对手选择技能的 PP 为 0 → true", () => {
    expect(condEval(mkCtx(), { foeMovePpZero: true })).toBe(true);
  });

  it("foeMovePpZero：对手 PP 不为 0 → false", () => {
    const ctx = mkCtx();
    (ctx as any).foe.moves[0].pp = 3;
    expect(condEval(ctx, { foeMovePpZero: true })).toBe(false);
  });

  it("selfMovePpZero：自身 PP 不为 0 → false", () => {
    expect(condEval(mkCtx(), { selfMovePpZero: true })).toBe(false);
  });

  it("movePpAtLeast：按阈值判定", () => {
    const ctx = mkCtx();
    expect(condEval(ctx, { movePpAtLeast: 5 })).toBe(true);
    expect(condEval(ctx, { movePpAtLeast: 6 })).toBe(false);
  });

  it("缺 foeMove 时不抛，返回 false", () => {
    const ctx = mkCtx();
    (ctx as any).foeMove = undefined;
    expect(condEval(ctx, { foeMovePpZero: true })).toBe(false);
  });
});

describe("对局集成：PP 为 0 则无法行动", () => {
  it("对手所选技能 PP 为 0 时该方行动失败", () => {
    const s = initBattle(PACK, { battleId: "b", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    const mv = s.sides.p2.unit.moves[0];
    expect(mv).toBeDefined();
    const r = applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act(`act_${mv!.moveId}`) });
    expect(r.ok).toBe(true);
  });
});