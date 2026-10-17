/**
 * add-effect-w03：seer-w03 这一路（w03.md 点名的「写清了数字的算力句子」）的结论记录。
 *
 * 全库含「算力」的片段逐条核对（`content/creatures/creatures.json` 6 处字符串 + `content/peak/*.json` 2 处）
 * 后，没有一条能在触点预算内落成规则：
 *   - 技能侧唯一的完整整句是 `极渊·渎神`（pet-4797），其中算力片段是条件半句
 *     `若自身处于算力限制则本次攻击无法造成伤害`——**已经落地**：`condOf` 把「处于算力限制」认成
 *     `markCountAtLeast{mark:"算力限制",n:1}`，挂成 `cap:0` 的 `if`，
 *     `content/claims/_effects-coverage.json` 里该招 `unparsed` 为空（无残留）；
 *   - `算力拆解`（pet-4711）是**招式名**，不是效果文本；
 *   - `获得100点算力` / `获得20点算力` / `自身消耗50点算力以触发算力乱流` / `则额外触发算力共振`
 *     只出现在**魂印**文本里（霸颚鲛 pet-4798、极渊DS-001 pet-4797 的 `soulMark.text`），
 *     是 w03.md 点名的**没有宿主的半句**：算力这一路没有任何已建模的产出或数值域
 *     （`算力限制` 只被当条件读、`算力乱流`/`算力共振` 全库无定义），
 *     魂印解析器已按 `named-resource/form domain unmodeled (deferred)` 留档
 *     （tools/soulmark-parse.mjs:253）。
 *
 * 按 w03.md「没写系数、没有宿主的半句不做」，这一路**不加规则**
 * （tools/effects-rules/batch-w03.mjs 保持 `export const rules = []`）。
 * 本文件因此只锁既有句子的结果不变，不引入新 IR。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect (w03 · 算力)", () => {
  it("w03-算力条件半句：既有 IR 不变（宿主句 极渊·渎神）", () => {
    const next = parseEffectText("使用时解除自身所处的异常状态，若自身处于算力限制则本次攻击无法造成伤害") as {
      effects: unknown[];
      unparsed: unknown[];
    };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "cap", of: "cap", value: 0 },
      { op: "cleanse", target: "self", scope: "ailment", if: { markCountAtLeast: { mark: "算力限制", n: 1, on: "self" } } },
    ]);
    // 去掉「解除异常」半句，条件半句单独出现时仍是同一对（cap + 孤儿谓词转成的 if）
    const lone = parseEffectText("若自身处于算力限制则本次攻击无法造成伤害") as {
      effects: unknown[];
      unparsed: unknown[];
      orphanCond: unknown;
    };
    expect(lone.unparsed).toEqual([]);
    expect(lone.effects).toEqual([{ op: "cap", of: "cap", value: 0 }]);
    expect(lone.orphanCond).toEqual({ markCountAtLeast: { mark: "算力限制", n: 1, on: "self" } });
  });

  it("w03-算力产出半句：停在未解析，不凭空造资源域", () => {
    // 魂印里的资源写入半句（无技能宿主、无产出规则）：parser 不产出任何 op
    for (const src of ["获得20点算力", "获得100点算力并获得算力限制", "自身消耗50点算力以触发算力乱流"]) {
      const r = parseEffectText(src) as { effects: unknown[]; unparsed: { reason?: string }[] };
      expect(r.effects, src).toEqual([]);
      expect(r.unparsed.length, src).toBeGreaterThan(0);
      expect(r.unparsed.every((u) => u.reason === "no-rule"), src).toBe(true);
    }
    // 招式名不是效果文本
    const name = parseEffectText("算力拆解") as { effects: unknown[] };
    expect(name.effects).toEqual([]);
  });
});
