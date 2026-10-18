/**
 * 「双方最大体力之差的护盾」——裸形（省略「获得」/「等同于」）。
 *
 * e49-05 / e53-shd-05 已认「获得(等同于)?双方最大体力差值的护盾」，
 * 但超级噗纽里写成裸形「…则获得100点体力上限、双方最大体力之差的护盾」，
 * 切分后剩下「双方最大体力之差的护盾」没有动词，落不到规则上。
 *
 * 用既有 params 键 flatMaxHpDiff（apply-effect 已有读取），不改引擎。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const isShieldDiff = (r: { effects: { op?: string; name?: string; params?: Record<string, unknown> }[] }) =>
  r.effects.some((e) => e.op === "apply_status" && e.name === "shield" && e.params?.["flatMaxHpDiff"] === 1);

describe("双方最大体力之差的护盾", () => {
  it("裸形能识别", () => {
    const r = parseEffectText("双方最大体力之差的护盾");
    expect(r.unparsed).toEqual([]);
    expect(isShieldDiff(r)).toBe(true);
  });

  it("带「获得」的原有形态不回归", () => {
    const r = parseEffectText("获得双方最大体力差值的护盾");
    expect(r.unparsed).toEqual([]);
    expect(isShieldDiff(r)).toBe(true);
  });

  it("「护罩」变体也认（护盾/护罩同 params）", () => {
    const r = parseEffectText("双方最大体力之差的护罩");
    expect(r.unparsed).toEqual([]);
    expect(isShieldDiff(r)).toBe(true);
  });
});