/** 魂印 differ 桶的只读分类；分桶与同步工具共用完整有序 IR 比较。 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSoulmarkText } from "./soulmark-parse.mjs";
import { ROOT, stable, classifyEffects } from "./pet-roster-shared.ts";

// 仅用于给已确认的 differ 命名；完整 IR 判据始终先执行，删字段不会使差异消失。
const gateKeys = new Set(["if", "guard", "chance", "bossGate", "chanceDyn", "chanceGrow", "chanceMulIf", "chanceSetIf"]);
const withoutGates = (value) => {
  if (Array.isArray(value)) return value.map(withoutGates);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !gateKeys.has(key)).map(([key, item]) => [key, withoutGates(item)]));
};

export function classifyShape(oldEntries, newEntries) {
  if (classifyEffects(oldEntries, newEntries) !== "differ") return null;
  if (stable(oldEntries.map(stable).sort()) === stable(newEntries.map(stable).sort())) return "条目顺序改写";
  if (stable(withoutGates(oldEntries)) === stable(withoutGates(newEntries))) return "条件/概率/门控改写";
  const windows = (entries) => entries.map((e) => e.hook ?? `flag:${e.op}`);
  if (stable(windows(oldEntries)) === stable(windows(newEntries))) return "同事件负载改写";
  return "事件窗口/条目结构改写";
}

/**
 * 条件集合：条目级 guard + op 级 if。guard↔op.if 的迁移不改变条件本身，
 * 但**条件消失**会把现网的有条件效果变成无条件执行——必须单独标出来。
 */
const condSet = (entries) => {
  const out = [];
  for (const e of entries ?? []) {
    if (e.guard !== undefined) out.push(`guard:${stable(e.guard)}`);
    for (const o of e.ops ?? []) if (o.if !== undefined) out.push(`op.if:${stable(o.if)}`);
  }
  return out;
};

/**
 * 「解析丢条件」筛查：同条目数下，包里有而解析没有的条件。
 * 这批**禁止回填**——回填等于把有条件的现网效果改成无条件执行。
 */
export function analyzeConditionLoss(oldEntries, newEntries) {
  if (!Array.isArray(oldEntries) || !Array.isArray(newEntries)) return { sameCount: false, lost: [], gained: [] };
  const a = condSet(oldEntries), b = condSet(newEntries);
  // 比较只看**条件本身**——条件在 guard 与 op.if 之间换位置不算丢（条件还在），
  // 但落点迁移另有语义风险，由 differ 分类的「条件/概率/门控改写」负责暴露。
  const value = (x) => x.slice(x.indexOf(":") + 1);
  const aVal = a.map(value), bVal = b.map(value);
  return {
    sameCount: oldEntries.length === newEntries.length,
    lost: a.filter((x) => !bVal.includes(value(x))),
    gained: b.filter((x) => !aVal.includes(value(x))),
  };
}

export function analyzeSoulmarkDiffs(catalog, marks, unitIds) {
  const buckets = { same: 0, equiv: 0, more: 0, fewer: 0, differ: 0, missing: 0, stale: 0 };
  const byShape = {};
  const records = [];
  const condLost = [];
  const byId = new Map(Object.entries(catalog.creatures).map(([key, c]) => [c.id ?? key, c]));
  let scanned = 0;
  for (const [id, c] of byId) {
    if (!unitIds.has(id)) continue;
    scanned++;
    const stored = marks[`sm-${id.replace(/^pet-/, "")}`];
    const parsed = parseSoulmarkText(String(c.soulMark?.text ?? "").trim(), c.name);
    const entries = parsed.entries;
    let bucket;
    if (entries.length === 0) bucket = stored === undefined ? "same" : "stale";
    else if (stored === undefined) bucket = "missing";
    else if (stable(stored.effects) === stable(entries)) bucket = "same";
    else bucket = classifyEffects(stored.effects, entries);
    buckets[bucket]++;
    if (bucket !== "differ") continue;
    const shape = classifyShape(stored.effects, entries);
    byShape[shape] = (byShape[shape] ?? 0) + 1;
    const loss = analyzeConditionLoss(stored.effects, entries);
    if (loss.sameCount && loss.lost.length > 0) condLost.push({ id, name: c.name, shape, lost: loss.lost, gained: loss.gained });
    records.push({ id, name: c.name, shape, source: c.soulMark?.text ?? "", before: stored.effects, after: entries });
  }
  if (records.length !== buckets.differ || Object.values(byShape).reduce((sum, n) => sum + n, 0) !== buckets.differ) {
    throw new Error("differ 分类计数不守恒");
  }
  return { scanned, buckets, byShape, records, condLost };
}

export function run(args = process.argv.slice(2)) {
  const read = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const report = analyzeSoulmarkDiffs(read("content/creatures/creatures.json"), read("content/peak/soulmarks.json").soulmarks,
    new Set(read("content/peak/units.json").units.map((u) => u.id)));
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`扫描 ${report.scanned} 只；分桶 ${JSON.stringify(report.buckets)}`);
    console.log(`differ 分类：${report.records.length} 条`);
    for (const [shape, count] of Object.entries(report.byShape)) console.log(`  ${shape}: ${count}`);
    console.log(`解析丢条件（禁止回填）：${report.condLost.length} 条 —— 包里有条件、当前解析没有；`);
    console.log("  回填这批等于把现网的有条件效果改成无条件执行，须先修解析器或逐条判定。");
    console.log("  分类仅辅助审查，所有增删和改写都需核对原文，不能据此自动回填。");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
