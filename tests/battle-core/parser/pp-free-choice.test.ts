/**
 * 逐只处理：pet-4901 特维耶（魂印「自身下回合选择使用技能不受pp限制」）。
 *
 * 缺口：族规则 batch-e5f-06 只认「使用技能不受PP值限制」三种写法，
 * 语料里这句多一个「选择」、PP 又是小写 —— 整句 no-rule。
 * 语义与原句相同（使用技能不消耗 PP），已有状态名 pp_free，不需要新格子。
 *
 * 改法：只改 tools/effects-rules/batch-e5f-06 一条家族规则（补「选择」前缀、
 * 「值」可省、PP 大小写不敏感）。没有新 op、没有新状态名、没有新 params 键。
 *
 * 本文件同时锁住三条相邻旧句子，证明新规则没有把它们截走。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const effectsOf = (s: string) => (parseEffectText(s) as { effects: unknown[]; unparsed: unknown[] });
const ppFree = [{ op: "apply_status", name: "pp_free", target: "self" }];

describe("逐只处理 pet-4901 特维耶：「选择使用技能不受pp限制」", () => {
  it("新句：选「选择」前缀 + 小写 pp + 省「值」", () => {
    const r = effectsOf("选择使用技能不受pp限制");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(ppFree);
  });

  it("旧句不回归：三种旧写法结果不变", () => {
    for (const s of ["使用技能不受PP值限制", "不受PP值限制", "技能不消耗PP"]) {
      const r = effectsOf(s);
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual(ppFree);
    }
  });

  it("魂印层：pp_free 挂「下回合」1 回合窗，不误挂成常驻", () => {
    const r = parseSoulmarkText("自身下回合选择使用技能不受pp限制", "特维耶");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      {
        hook: "onTurnEnd",
        ops: [{ op: "apply_status", name: "pp_free", target: "self", turns: 1 }],
      },
    ]);
  });

  it("魂印层：pet-4901 整条无残文", () => {
    const r = parseSoulmarkText(
      "自身攻击技能造成的伤害提升100%，若打出致命一击则额外提升100%且自身下回合选择使用技能不受pp限制、使用的技能必定命中；回合结束时，若对手体力为满则自身下回合所有技能先制+1，若不为满则恢复自身300点体力（boss无效）",
      "特维耶",
    );
    expect(r.unparsed).toEqual([]);
    // pp_free 挂在「打出致命一击则…」那一条里（原文的限定语），不独立成条
    const critEntry = r.entries.find((e) => e.guard?.prevCrit === true);
    expect(critEntry?.ops).toContainEqual({
      op: "apply_status",
      name: "pp_free",
      target: "self",
      turns: 1,
    });
  });
});
