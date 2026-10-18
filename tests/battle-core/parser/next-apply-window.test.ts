/**
 * 「若为攻击技能则造成的伤害不少于N」→ minDamage 地板。
 *
 * 语料 2 处（决囚钢骨/十里枯监、炎龙铠甲/降魔印）：
 *   下1次技能无效时令对手瘫痪，若为攻击技能则造成的伤害不少于200
 *
 * 半句拆开：
 *   "若为攻击技能则造成的伤害不少于N" → cap{of:minDamage}（宿主是本招，条件恒真）
 *   "下N次技能无效时令对手X" → 需要引擎新增「技能无效」trigger，尚未实现，
 *     仍走留档（见下方说明性测试，锁定它**现在的**行为而不是假装已完成）。
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

describe("下N次技能无效时（尚未实现，锁现状）", () => {
  it("引擎没有「技能无效」trigger，该子句仍留档", () => {
    const r = parseEffectText("下1次技能无效时令对手瘫痪");
    // trigger 编码表里没有"技能无效"（1受击/2对手MISS/3对手行动/4破盾/5倒下/6自身MISS/14治疗），
    // 所以这一句必须继续留档，不能被悄悄解析成别的东西。
    expect(r.unparsed.length).toBeGreaterThan(0);
  });
});