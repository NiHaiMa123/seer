/**
 * 「吸取对手N%的体力」——省略「最大」二字。
 *
 * heal-06 认「吸取对手最大体力的N%」，但语料里有 11 处写成
 * 「吸取对手100%的体力」「吸取对手50%的体力」（不写"最大"）。
 * 语义相同：按对手最大体力的百分比造成 percent 伤害并等量回复。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const isDrainPct = (r: { effects: { op?: string; power?: number; kind?: string }[] }, pct: number) =>
  r.effects.some((e) => e.op === "damage" && e.kind === "percent" && e.power === pct)
  && r.effects.some((e) => e.op === "heal");

describe("吸取对手N%的体力（省略「最大」）", () => {
  it("100%", () => {
    const r = parseEffectText("吸取对手100%的体力", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(isDrainPct(r, 100)).toBe(true);
  });

  it("50%", () => {
    const r = parseEffectText("吸取对手50%的体力", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(isDrainPct(r, 50)).toBe(true);
  });

  it("带「最大」的原有形态不回归", () => {
    const r = parseEffectText("吸取对手最大体力的100%", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(isDrainPct(r, 100)).toBe(true);
  });

  it("「吸收」同义词也认", () => {
    const r = parseEffectText("吸收对手30%的体力", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(isDrainPct(r, 30)).toBe(true);
  });
});