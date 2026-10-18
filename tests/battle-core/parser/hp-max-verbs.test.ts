/**
 * 体力上限的两种动词变体（超级噗纽）：
 *   「消耗自身200点体力上限」→ max_hp_down（削减自己）
 *   「获得100点体力上限」    → stat_boost{stats:["hp"]}
 *   「双方最大体力之差的护盾」→ apply_status shield 的 flatMaxHpDiff（已有）
 *
 * 全部用现有能力表达，不改引擎。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("体力上限动词", () => {
  it("「消耗自身200点体力上限」→ 削减自己", () => {
    const r = parseEffectText("消耗自身200点体力上限");
    expect(r.unparsed).toEqual([]);
    const op = r.effects.find((e) => (e as { name?: string }).name === "max_hp_down");
    expect(op, JSON.stringify(r.effects)).toBeDefined();
  });

  it("「获得100点体力上限」→ 提升自己", () => {
    const r = parseEffectText("获得100点体力上限");
    expect(r.unparsed).toEqual([]);
    const op = r.effects.find((e) => e.op === "stat_boost");
    expect(op, JSON.stringify(r.effects)).toBeDefined();
    expect((op as { add?: number }).add).toBe(100);
  });

  it("「消耗」不能变成「获得」（方向不能反）", () => {
    const r = parseEffectText("消耗自身200点体力上限");
    const boost = r.effects.find((e) => e.op === "stat_boost");
    // 削减不该产出正向上限提升
    expect(boost).toBeUndefined();
  });
});