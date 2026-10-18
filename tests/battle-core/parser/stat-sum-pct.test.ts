/**
 * 「恢复自身攻击、特攻值之和40%的体力」——两维之和百分比。
 *
 * 语料 187 处、21 种组合。引擎新增 statSumPct{a,b,pct}（泛化原来写死的 defSumPct）。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const sumOf = (r: { effects: { op?: string; statSumPct?: { a: string; b: string; pct: number } }[] }) =>
  r.effects.find((e) => e.statSumPct !== undefined)?.statSumPct;

describe("两维之和的百分比", () => {
  it("恢复自身攻击、特攻值之和40%的体力", () => {
    const r = parseEffectText("恢复自身攻击、特攻值之和40%的体力");
    expect(r.unparsed).toEqual([]);
    expect(sumOf(r)).toEqual({ a: "atk", b: "spa", pct: 40 });
  });

  it("攻击与防御总和 20%（「与」「总和」写法）", () => {
    const r = parseEffectText("恢复自身攻击与防御总和20%的体力");
    expect(r.unparsed).toEqual([]);
    expect(sumOf(r)).toEqual({ a: "atk", b: "def", pct: 20 });
  });

  it("体力、速度之和 10%", () => {
    const r = parseEffectText("恢复自身体力、速度值之和10%的体力");
    expect(r.unparsed).toEqual([]);
    expect(sumOf(r)).toEqual({ a: "hp", b: "spd", pct: 10 });
  });

  it("原有「防御、特防之和N%」不回归", () => {
    const r = parseEffectText("恢复相当于自身防御与特防之和50%的体力");
    expect(r.unparsed).toEqual([]);
    // 旧 key 或新 key 皆可，只要能量化成 def+sdf+50
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/defSumPct":50|"a":"def","b":"sdf","pct":50/);
  });
});