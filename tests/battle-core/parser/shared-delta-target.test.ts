/**
 * 「使对手A、B-1」共享末尾 delta 的切分回归锁。
 *
 * splitEnum 用 foeDeltaTail 判断「、」后段是否续接。原正则要求列表每一项
 * 都自带 ±N，于是「使对手双攻-1、命中-1」经前置展开成
 * 「使对手攻击、特攻-1、命中-1」后不再匹配 —— 「、命中-1」被切成独立 part，
 * 落到 stages-07 的裸 stat 默认（target: self），命中维方向反了。
 *
 * 语料里该形态常见（golden 2729:沙之领域）。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("对手 stat 列表共享末尾 delta", () => {
  it("双攻展开 + 命中：全部落到 opponent", () => {
    const r = parseEffectText("使对手双攻-1、命中-1");
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent" },
    ]);
  });

  it("多个 stat 共享末尾 delta", () => {
    const r = parseEffectText("使对手攻击、特攻、速度-1");
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" },
    ]);
  });

  it("各自带 delta 的形态不回归", () => {
    const r = parseEffectText("使对手防御-1、特攻-1");
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
    ]);
  });

  it("裸 stat 片段在独立句里仍是 self（stages-07 的既有语义不变）", () => {
    expect(parseEffectText("命中-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "self" },
    ]);
  });
});
