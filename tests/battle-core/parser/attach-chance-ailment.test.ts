/**
 * 逐只处理：pet-2695 圣瞳·天蛇太祖
 * （魂印「若每回合先出手攻击，则造成伤害的20%恢复自身体力并附带15%几率令对手睡眠」）。
 *
 * 缺口：同句后半「附带15%几率令对手睡眠」不匹配——
 * 族规则 batch-e5-13 认的是「N%令对手<异常>」，语料这里多一个「附带」前缀，
 * 于是整段 no-rule，「附带」的异常效果整条丢失。
 *
 * 改法：只加一条家族规则（tools/effects-rules/batch-e5.mjs 的 batch-e5-13b），
 * 语义与 batch-e5-13 相同——N% 概率施加该异常。没有新 op、没有新状态名、
 * 没有新 params 键、没有新的结算分支。
 *
 * 附带效果与前半句同属「则」字句，两半必须落在同一条目上：
 * 钩子（onMoveUsed）与守卫（先出手）要罩住两半。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const effectsOf = (s: string) =>
  (parseEffectText(s) as { effects: unknown[]; unparsed: { clause?: string; reason?: string }[] });

describe("逐只处理 pet-2695 圣瞳·天蛇太祖：「附带N%令对手<异常>」", () => {
  it("新句：附带前缀 + N% 概率施加异常", () => {
    const r = effectsOf("附带15%令对手睡眠");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "sleep", target: "opponent", chance: 15 },
    ]);
  });

  it("旧句不回归：同族不带「附带」的写法结果不变", () => {
    const r = effectsOf("15%另对手冻伤");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "frostbite", target: "opponent", chance: 15 },
    ]);
  });

  it("未知异常名仍保残（不编一个异常出来）", () => {
    const r = effectsOf("附带15%令对手不存在的异常");
    expect(r.unparsed?.[0]?.reason).toMatch(/ailment unparsed/);
  });

  it("魂印层：两半落在同一条目，钩子与守卫罩住两半", () => {
    const r = parseSoulmarkText(
      "栗:若每回合先出手攻击，则造成伤害的20%恢复自身体力并附带15%几率令对手睡眠",
      "圣瞳·天蛇太祖",
    );
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      {
        hook: "onMoveUsed",
        guard: { actor: "self", if: { order: "first" } },
        ops: [
          { op: "apply_status", name: "drain_atk", target: "self", params: { n: 20, d: 100 } },
          { op: "apply_status", name: "sleep", target: "opponent", chance: 15 },
        ],
      },
    ]);
  });
});
