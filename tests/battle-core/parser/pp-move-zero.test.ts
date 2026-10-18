/**
 * 「若对手所选择的技能PP值为0则当回合对手无法行动」——PP 检视谓词落地。
 *
 * 语料 213 处涉及 PP 检视，这句最常见（黯魂·索比拉特/考沃莱恩/琉梦…）。
 * 谓词 foeMovePpZero 已加进 cond.ts + schema + loader 的 Cond 联合类型。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("所选择技能 PP 为 0", () => {
  it("对手版 → 对手无法行动，带 foeMovePpZero 门", () => {
    const r = parseEffectText("若对手所选择的技能PP值为0则当回合对手无法行动");
    expect(r.unparsed).toEqual([]);
    const op = r.effects.find((e) => e.op === "control");
    expect(op, JSON.stringify(r.effects)).toBeDefined();
    expect(JSON.stringify(op)).toMatch(/foeMovePpZero/);
  });

  it("变体：省略「所」", () => {
    const r = parseEffectText("若对手选择的技能PP值为0则当回合对手无法行动");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.effects)).toMatch(/foeMovePpZero/);
  });

  it("自身版 → selfMovePpZero", () => {
    const r = parseEffectText("若自身选择的技能PP值为0则当回合自身无法行动");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.effects)).toMatch(/selfMovePpZero/);
  });
});