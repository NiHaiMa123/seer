import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeConditionLoss, analyzeSoulmarkDiffs, classifyShape } from "../../../tools/soulmark-diff-shapes.mjs";

const heal = { op: "heal", flat: 100, target: "self" };
const entry = { hook: "onTurnEnd", ops: [heal] };

describe("魂印 differ 分类保留全部差异", () => {
  it("条件、概率、boss和else分支的变化不会被忽略", () => {
    for (const next of [
      { ...entry, guard: { prevCrit: true } },
      { ...entry, chance: { base: 50 } },
      { ...entry, bossGate: true },
      { ...entry, ops: [{ ...heal, if: { prevCrit: true } }] },
      { ...entry, ops: [{ ...heal, chance: 50 }] },
    ]) expect(classifyShape([entry], [next])).toBe("条件/概率/门控改写");
    expect(classifyShape([entry], [{ ...entry, elseOps: [heal] }])).not.toBeNull();
  });

  it("只分类真正的differ，有序增删不能混进统计", () => {
    expect(classifyShape([entry], [entry])).toBeNull();
    expect(classifyShape([entry, entry], [entry])).toBeNull();
    expect(classifyShape([entry], [entry, entry])).toBeNull();
    const start = { ...entry, hook: "onTurnStart" };
    expect(classifyShape([entry, start], [start, entry])).toBe("条目顺序改写");
  });

  it("真实的守卫差异不再漏掉，分类总数等于differ桶", () => {
    const catalog = JSON.parse(readFileSync("content/creatures/creatures.json", "utf8"));
    const marks = JSON.parse(readFileSync("content/peak/soulmarks.json", "utf8")).soulmarks;
    const report = analyzeSoulmarkDiffs(catalog, marks, new Set(["pet-4733", "pet-4751"]));
    expect(report.buckets.differ).toBe(2);
    expect(report.records.map((r: { id: string }) => r.id).sort()).toEqual(["pet-4733", "pet-4751"]);
    expect(Object.values(report.byShape).reduce((sum: number, n) => sum + Number(n), 0)).toBe(2);
  });

  it("解析丢条件被单独标出（回填=改成无条件执行，禁止回填）", () => {
    // 同条目数、包里有条件而解析没有 → 丢条件
    expect(analyzeConditionLoss([{ ...entry, guard: { prevCrit: true } }], [entry]).lost).toEqual(['guard:{"prevCrit":true}']);
    expect(analyzeConditionLoss([{ ...entry, guard: { prevCrit: true } }], [entry]).sameCount).toBe(true);
    // 条件只是换位置（guard ↔ op.if）→ 不算丢
    expect(analyzeConditionLoss([{ ...entry, guard: { prevCrit: true } }], [{ ...entry, ops: [{ ...heal, if: { prevCrit: true } }] }]).lost).toEqual([]);
    // 条目数变了 → 整条改写，另判
    expect(analyzeConditionLoss([entry], [entry, entry]).sameCount).toBe(false);
    // 全库：pet-4751 的 prevCrit 条件在包里、当前解析没有
    const catalog = JSON.parse(readFileSync("content/creatures/creatures.json", "utf8"));
    const marks = JSON.parse(readFileSync("content/peak/soulmarks.json", "utf8")).soulmarks;
    const report = analyzeSoulmarkDiffs(catalog, marks, new Set(["pet-4751"]));
    expect(report.condLost.map((r: { id: string }) => r.id)).toEqual(["pet-4751"]);
    expect(report.condLost[0]!.lost.some((x: string) => x.includes("prevCrit"))).toBe(true);
  });
});
