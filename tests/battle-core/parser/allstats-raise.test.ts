/**
 * "全属性提升(了)" 的语义是各维 +1，不是「强化翻倍」。
 *
 * 引擎契约：apply_stat_stage 的 stat:"all" 必须带 multiplySelf（stat-stage.ts:82
 * 直接抛 OP_SCHEMA），语义是「全正级翻倍」。e53-stg-11 却发了裸 stat:"all"，
 * 导致 content:validate 在 peak 包上报 3 条
 *   move "mv-3727-s11" stat "all" requires multiplySelf
 * 且这 3 条装载即崩。
 *
 * 原文（creatures.json）：奥丽莎/丽利/莎利奥 的「龙甲强化」= "全属性提升了；3回合内…"，
 * 语义确为各维 +1。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const FIVE = ["atk", "def", "spa", "sdf", "spd"] as const;

describe("全属性提升 = 各维 +1（不是 stat:all）", () => {
  it("裸句展开成五维 +1，且不带 stat:all", () => {
    const r = parseEffectText("全属性提升");
    expect(r.effects).toEqual(FIVE.map((s) => ({ op: "apply_stat_stage", stat: s, delta: 1, target: "self" })));
    expect(JSON.stringify(r.effects)).not.toContain('"all"');
  });

  it("带「了」的完成态同形", () => {
    const r = parseEffectText("全属性提升了");
    expect(r.effects).toEqual(FIVE.map((s) => ({ op: "apply_stat_stage", stat: s, delta: 1, target: "self" })));
  });

  it("真实语料整句：龙甲强化", () => {
    const r = parseEffectText("全属性提升了；3回合内每回合所受的伤害减少150点");
    const stages = r.effects.filter((e) => e.op === "apply_stat_stage");
    expect(stages).toEqual(FIVE.map((s) => ({ op: "apply_stat_stage", stat: s, delta: 1, target: "self" })));
    // 不得出现会被引擎拒载的裸 stat:"all"
    for (const e of r.effects) {
      if (e.op === "apply_stat_stage" && e.stat === "all") expect(e.multiplySelf).toBe(true);
    }
  });

  it("真正的「强化翻倍」仍走 stat:all + multiplySelf", () => {
    const r = parseEffectText("使自身能力提升状态翻倍");
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self" },
    ]);
  });
});
