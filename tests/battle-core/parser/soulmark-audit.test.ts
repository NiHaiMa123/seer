import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditSoulmarkState, MANUAL_PEAK_IDS } from "../../../tools/soulmark-audit.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const toolPath = join(dirname(fileURLToPath(import.meta.url)), "../../../tools/soulmark-audit.mjs");

function makeFixture() {
  const supported = "回合开始时自身攻击+1";
  const partial = `${supported}；自身每回合固定增加未知的芜湖效果`;
  const catalog = {
    creatures: {
      "encyclopedia-row-a": { id: "pet-9000-a", petNo: "9000", name: "测试形态甲", soulMark: { text: supported } },
      "encyclopedia-row-b": { id: "pet-9000-b", petNo: "9000", name: "测试形态乙", soulMark: { text: partial } },
      "encyclopedia-no-trait": { id: "pet-9001", petNo: "9001", name: "无特性记录", soulMark: { text: "该精灵暂无特性" } },
      "encyclopedia-empty": { id: "pet-9002", petNo: "9002", name: "静默空记录", soulMark: { text: "问：这是什么？" } },
      "encyclopedia-residual": { id: "pet-9003", petNo: "9003", name: "只有残留", soulMark: { text: "关于该精灵的某种无法解释的特效" } },
      "encyclopedia-outside": { id: "pet-9004", petNo: "9004", name: "包外记录", soulMark: { text: supported } },
      "encyclopedia-manual": { id: "pet-5000", petNo: "5000", name: "手工巅峰单位", soulMark: { text: supported } },
      "encyclopedia-partial-2": { id: "pet-9005", petNo: "9005", name: "另一条部分记录", soulMark: { text: partial } },
      "pet-fallback": { petNo: "9010", name: "缺ID但有图鉴键", soulMark: { text: supported } },
      "duplicate-row-1": { id: "pet-duplicate", petNo: "9011", name: "重复ID甲", soulMark: { text: supported } },
      "duplicate-row-2": { id: "pet-duplicate", petNo: "9012", name: "重复ID乙", soulMark: { text: supported } },
    },
  };
  const units = [
    { id: "pet-9000-a", name: "测试形态甲", soulMark: "sm-9000-a" },
    { id: "pet-9000-b", name: "测试形态乙" },
    { id: "pet-9001", name: "无特性记录" },
    { id: "pet-9002", name: "静默空记录" },
    { id: "pet-9003", name: "只有残留" },
    { id: "pet-9005", name: "另一条部分记录" },
    { id: "pet-5000", name: "手工巅峰单位" },
    { id: "pet-fallback", name: "缺ID但有图鉴键", soulMark: "sm-fallback" },
    { id: "pet-duplicate", name: "重复ID应保持歧义" },
  ];
  const soulmarks = {
    "sm-9000-a": { id: "sm-9000-a", effects: parseSoulmarkText(supported, "测试形态甲").entries },
    "sm-9000-b": { id: "sm-9000-b", effects: [{ op: "heal", target: "self", amount: 999 }] },
    "sm-5000": { id: "sm-5000", effects: parseSoulmarkText(supported, "手工巅峰单位").entries },
    "sm-fallback": { id: "sm-fallback", effects: parseSoulmarkText(supported, "缺ID但有图鉴键").entries },
  };
  return { catalog, units, soulmarks, partial };
}

describe("live soulmark audit", () => {
  it("keeps variants independent and reports parse, directory, mount, and identity states without changing inputs", () => {
    const { catalog, units, soulmarks, partial } = makeFixture();
    const sourceBefore = JSON.stringify(catalog);
    const unitsBefore = JSON.stringify(units);
    const soulmarksBefore = JSON.stringify(soulmarks);

    const report = auditSoulmarkState({ catalog, units, soulmarks });
    expect(auditSoulmarkState({ catalog, units, soulmarks })).toEqual(report);

    expect(report.source.recordsWithSoulmarkText).toBe(11);
    expect(report.statusCounts).toMatchObject({
      explicitNoTrait: 1,
      noEntryWithResidual: 1,
      noEntryNoResidual: 1,
      partial: 2,
      entryNoResidual: 6,
      parserError: 0,
    });
    expect(report.implementationCandidates).toBe(10);
    expect(report.emptyWithoutResidualAnomalies.map((x) => x.creatureId)).toEqual(["pet-9002"]);

    const variants = report.records.filter((row) => row.petNo === "9000");
    expect(variants.map((row) => row.creatureId)).toEqual(["pet-9000-a", "pet-9000-b"]);
    expect(variants.map((row) => row.catalogKey)).toEqual(["encyclopedia-row-a", "encyclopedia-row-b"]);
    expect(variants.map((row) => row.packDirectory)).toEqual(["same-effects", "different-effects"]);
    expect(variants.map((row) => row.defaultMount)).toEqual(["mounted", "unmounted"]);

    expect(report.residualReasons.find((row) => row.reason === "no-rule")).toMatchObject({
      fragments: 2,
      distinctRecords: 2,
    });
    expect(report.pack.directoryCounts).toMatchObject({ missing: 1, different: 1, same: 3, outsidePack: 1 });
    expect(report.pack.directoryMissing.map((row) => row.creatureId)).toEqual(["pet-9005"]);
    expect(report.pack.outsidePackEntries.map((row) => row.creatureId)).toEqual(["pet-9004"]);
    expect(report.records.find((row) => row.catalogKey === "encyclopedia-residual")?.status).toBe("no-entry-with-residual");
    expect(report.records.find((row) => row.creatureId === "pet-9001")?.status).toBe("explicit-no-trait");

    const fallback = report.records.find((row) => row.catalogKey === "pet-fallback");
    expect(fallback).toMatchObject({ creatureId: null, associationId: "pet-fallback", idSource: "catalog-key", packDirectory: "same-effects" });
    expect(report.identityIssues.missingCreatureId).toContainEqual({ catalogKey: "pet-fallback", fallbackAssociationId: "pet-fallback" });
    expect(report.identityIssues.duplicateCreatureIds).toContainEqual({ creatureId: "pet-duplicate", catalogKeys: ["duplicate-row-1", "duplicate-row-2"] });
    expect(report.records.filter((row) => row.creatureId === "pet-duplicate").every((row) => row.packDirectory === "ambiguous-source-id")).toBe(true);

    expect(MANUAL_PEAK_IDS).toHaveLength(12);
    expect(report.pack.defaultMount.manualPeakUnmounted.map((row) => row.unitId)).toEqual(["pet-5000"]);
    expect(report.pack.defaultMount.manualPeakUnmountedCount).toBe(1);
    expect(report.records.find((row) => row.creatureId === "pet-5000")?.defaultMount).toBe("manual-peak-unmounted");
    expect(report.pack.defaultMount.unmountedNonManual.map((row) => row.creatureId)).toEqual(["pet-9000-b", "pet-9005"]);
    expect(report.semantics).toContain("do not establish behavioral completeness");
    expect(report.records.find((row) => row.creatureId === "pet-9000-b")?.residualFragments).toBe(1);
    expect(report.records.find((row) => row.creatureId === "pet-9000-b")?.status).toBe("partial");
    expect(partial).toContain("未知的芜湖效果");

    expect(JSON.stringify(catalog)).toBe(sourceBefore);
    expect(JSON.stringify(units)).toBe(unitsBefore);
    expect(JSON.stringify(soulmarks)).toBe(soulmarksBefore);
  });

  it("uses an injected manual peak roster consistently in records and aggregate counts", () => {
    const { catalog, units, soulmarks } = makeFixture();
    const report = auditSoulmarkState({ catalog, units, soulmarks, manualPeakIds: ["pet-9000-b"] });

    expect(report.records.find((row) => row.creatureId === "pet-9000-b")?.defaultMount).toBe("manual-peak-unmounted");
    expect(report.pack.defaultMount.manualPeakRosterIds).toEqual(["pet-9000-b"]);
    expect(report.pack.defaultMount.manualPeakUnmountedCount).toBe(1);
    expect(report.pack.defaultMount.eligibleManualPeakUnmounted).toBe(1);
    expect(report.pack.defaultMount.manualPeakUnmounted).toHaveLength(1);
    expect(report.pack.defaultMount.manualPeakUnmounted.map((row) => row.unitId)).toEqual(["pet-9000-b"]);
    expect(report.pack.defaultMount.manualPeakUnmounted.map((row) => row.policy)).toEqual([
      "manual-peak-default-unmounted; do not auto-mount",
    ]);
    expect(report.pack.defaultMount.unmountedNonManual.map((row) => row.creatureId)).toEqual(["pet-5000", "pet-9005"]);
  });

  it("can be imported as a library without running the CLI", () => {
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(pathToFileURL(toolPath).href)})`,
    ], { encoding: "utf8" });
    expect(output).toBe("");
  });
});
