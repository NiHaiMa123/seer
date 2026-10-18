/**
 * 「免疫受到的秒杀」——秒杀已用 damage{kind:"percent",power:100} 表达，
 * 所以"免疫秒杀"就是"免疫百分比伤害"（flat_immune），已有通道，不需要新 op。
 *
 * 语料 4 只（瑞特拉尼/奥菲利娅/湮灭之主·咤克斯/琉梦）。
 * 其中多数还夹着别的未建模机制（魔王咒怨印记、体力上限变更），
 * 这里只处理能等价表达的那一句。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const flatImmune = (r: { entries: { ops?: { name?: string }[] }[] }) =>
  r.entries.some((e) => (e.ops ?? []).some((o) => o.name === "flat_immune"));

describe("免疫受到的秒杀", () => {
  it("等价于免疫百分比伤害 → flat_immune", () => {
    const r = parseSoulmarkText("自身免疫受到的秒杀", "测试精灵");
    expect(r.unparsed).toEqual([]);
    expect(flatImmune(r)).toBe(true);
  });

  it("带分号的长句里该子句不残留", () => {
    const r = parseSoulmarkText(
      "自身免疫受到的秒杀；对手执行秒杀效果时消除对手的回合类效果",
      "瑞特拉尼",
    );
    expect(r.unparsed.map((u) => String(u.clause))).not.toContain("自身免疫受到的秒杀");
    expect(flatImmune(r)).toBe(true);
  });

  it("「免疫百分比伤害」原有映射不回归", () => {
    const r = parseSoulmarkText("自身免疫受到的百分比伤害", "测试精灵");
    expect(flatImmune(r)).toBe(true);
  });

  it("「免疫固定伤害」仍是走 flat_immune（同一通道，语义由 kindMask 区分）", () => {
    const r = parseSoulmarkText("自身免疫受到的固定伤害", "测试精灵");
    expect(flatImmune(r)).toBe(true);
  });
});