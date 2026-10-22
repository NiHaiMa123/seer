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

export function analyzeSoulmarkDiffs(catalog, marks, unitIds) {
  const buckets = { same: 0, equiv: 0, more: 0, fewer: 0, differ: 0, missing: 0, stale: 0 };
  const byShape = {};
  const records = [];
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
    records.push({ id, name: c.name, shape, source: c.soulMark?.text ?? "", before: stored.effects, after: entries });
  }
  if (records.length !== buckets.differ || Object.values(byShape).reduce((sum, n) => sum + n, 0) !== buckets.differ) {
    throw new Error("differ 分类计数不守恒");
  }
  return { scanned, buckets, byShape, records };
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
    console.log("分类仅辅助审查，所有增删和改写都需核对原文，不能据此自动回填。");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
