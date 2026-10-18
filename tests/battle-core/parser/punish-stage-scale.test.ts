/**
 * 「惩罚，对方能力等级越高此招威力越大」——按对手强化总级数提升威力。
 *
 * 原文不给系数，此前一律停在 UNVERIFIED。系数来自赛尔号实测资料，三个独立来源一致：
 *   实际威力 = 面板威力 + 20 × 对方能力强化总级数
 *   - 7k7k《对惩罚技能的简单分析》：135(基础威力) + 对方能力强化总级数*20
 *     https://news.7k7k.com/content/20110504/85587.html
 *   - Bilibili《关于变威力技能》：实际威力=面板威力+20*对手对应攻防等级强化
 *     https://www.bilibili.com/read/cv13459300/
 *   - Bilibili WIKI《赛尔号PVE概论》：实际威力=面板威力+20*对方对应攻击和防御等级
 *     https://wiki.biligame.com/seer/%E8%B5%9B%E5%B0%94%E5%8F%B7PVE%E6%A6%82%E8%AE%BA
 *
 * 落点：已有的 attachDamage.powerPerStageScale（who=foe / mode=levels / per=1 /
 * add=20 / kind=flat），不新增字段、不新增 op。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const CASES = [
  "对手能力等级越高此招威力越大",          // pet-5000 灵光之怒
  "对方能力等级越高，此技能威力越大",
  "惩罚，对方能力等级越高，此技能威力越大",
  "惩罚，对手能力等越高，此技能威力越大",  // 原文错字变体
];

describe("惩罚：对方能力等级越高威力越大", () => {
  it.each(CASES)("产出 powerPerStageScale（每级 +20，按总级数）: %s", (text) => {
    const r = parseEffectText(text, { hasDamage: true });
    expect(r.unparsed, text).toEqual([]);
    // 出口把 attachDamage 的家族键抬成紧邻的 op（不是留在 flags 上）
    const op = r.effects.find((e) => e.op === "power" && (e as { of?: string }).of === "powerPerStageScale");
    expect(op, JSON.stringify(r.effects)).toBeDefined();
    expect((op as { value?: unknown }).value).toEqual({
      who: "foe",
      sign: "up",
      per: 1,
      add: 20,
      mode: "levels",
      kind: "flat",
    });
  });

  it("不带「惩罚」的裸句同样识别", () => {
    const r = parseEffectText("对方能力等级越高，威力越大", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
  });

  it("被逗号切开的尾句「威力越大」不单独留档（同句已由能力缩放承载）", () => {
    for (const t of ["惩罚，对方能力等级越高，技能威力越大", "对方能力等级越高，此技能威力越大"]) {
      const r = parseEffectText(t, { hasDamage: true });
      expect(r.unparsed, t).toEqual([]);
      expect(r.effects.some((e) => e.op === "power" && (e as { of?: string }).of === "powerPerStageScale"), t).toBe(true);
    }
  });

  it("「个体越高，威力越大」不受影响（是另一种缩放，仍待考证）", () => {
    const r = parseEffectText("个体越高，威力越大", { hasDamage: true });
    // 这条没有权威系数，必须继续留档，不能被本次改动顺手吃掉
    expect(r.unparsed.length).toBeGreaterThan(0);
    expect(r.effects.some((e) => e.op === "power" && (e as { of?: string }).of === "powerPerStageScale")).toBe(false);
  });
});
