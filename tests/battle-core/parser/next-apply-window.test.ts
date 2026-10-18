/**
 * 「若为攻击技能则造成的伤害不少于N」→ minDamage 地板。
 *
 * 语料 2 处（决囚钢骨/十里枯监、炎龙铠甲/降魔印）：
 *   下1次技能无效时令对手瘫痪，若为攻击技能则造成的伤害不少于200
 *
 * 两个半句分别处理：
 *   "若为攻击技能则造成的伤害不少于N" → cap{of:minDamage}（宿主是本招，条件恒真）
 *   "下N次技能无效时令对手X" → 引擎 trigger 19（招式被 move_null 拦下时派发），
 *     规则在 batch-e35 的 e35-null15。**已实现**（原先留档，见 git 历史）。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const minDamageOp = (r: { effects: unknown[] }, n: number) =>
  r.effects.some((e) => {
    const o = e as { op?: string; of?: string; value?: number };
    return o.op === "cap" && o.of === "minDamage" && o.value === n;
  });

describe("若为攻击技能则造成的伤害不少于 N", () => {
  it("落成 cap/minDamage 200", () => {
    const r = parseEffectText("若为攻击技能则造成的伤害不少于200", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(minDamageOp(r, 200)).toBe(true);
  });

  it("400 也认", () => {
    const r = parseEffectText("若为攻击技能则造成的伤害不少于400", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(minDamageOp(r, 400)).toBe(true);
  });

  it("不带条件的原有形态不回归", () => {
    const r = parseEffectText("造成的伤害不少于300", { hasDamage: true });
    expect(minDamageOp(r, 300)).toBe(true);
  });

  it("真实整句：炎龙铠甲 降魔印 里该子句不再留档", () => {
    const full =
      "必中；全属性+1，对手不处于能力提升状态时强化效果翻倍；4回合内每回合使用技能吸取对手最大体力的1/3；下2次技能无效时令对手烧伤，若为攻击技能则造成的伤害不少于400";
    const r = parseEffectText(full, { hasDamage: true });
    expect(r.unparsed.map((u) => String(u.clause))).not.toContain("若为攻击技能则造成的伤害不少于400");
  });
});

describe("下N次技能无效时（trigger 19）", () => {
  it("该子句不再留档，产出 reaction 窗", () => {
    const r = parseEffectText("下1次技能无效时令对手瘫痪");
    expect(r.unparsed).toEqual([]);
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/"trigger":19/);
    expect(s).toMatch(/shock/);
  });
});