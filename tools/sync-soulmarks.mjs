/**
 * tools/sync-soulmarks.mjs —— 魂印定点同步。
 *
 * 用途：解析器或规则改动后，只把**指定几只**精灵的魂印重新编译并写回
 * content/peak/soulmarks.json（必要时同步 content/peak/units.json 的挂载引用），
 * 不整库重建内容包。build-pet-roster.mjs 是整库生成器（会重写 moves/units/soulmarks），
 * 计划里明确禁止整库重建，所以需要这个定点入口。
 *
 * 口径与 build-pet-roster.mjs 一致：
 *   - 魂印条目 = { id: "sm-<petNo>", name: "<名字>魂印", desc: 原文前 2000 字, effects: parseSoulmarkText(...).entries }
 *   - 解析出 ≥1 条目才落条目；条目为空则不落（原条目会被删掉）
 *   - 巅峰 12 只手工单位：魂印本体照常编译，但不挂 unit.soulMark
 *     （peak-roster.test 锁的就是这一点）
 *   - 其余单位：条目存在即挂 unit.soulMark（残留也挂——部分生效）
 *   - 输出格式与生成器一致：JSON.stringify(x, null, 2) + "\n"
 *
 * 用法：
 *   node tools/sync-soulmarks.mjs --dry-run pet-3513 pet-4901     # 只看差异
 *   node tools/sync-soulmarks.mjs --write pet-3513 pet-4901       # 写回
 *   node tools/sync-soulmarks.mjs --scan                         # 全库分桶（只读）
 *   node tools/sync-soulmarks.mjs --write --bucket more          # 按桶批量写回
 *   node tools/sync-soulmarks.mjs --write --all-different         # 同步全部"与当前解析不一致"的条目
 *
 * 只读 content/creatures/creatures.json 与 content/peak/，只写 content/peak/。
 *
 * ── 分桶（--scan / --bucket）────────────────────────────────────────────
 * 「包里没有/不一样」必须分桶，不能一把 `--all-different` 全灌：
 *   same    逐字相同
 *   equiv   完整有序 IR 相同（仅键序或 undefined 字段不同）
 *   more    当前解析仅在有序条目间新增——仍需逐条验证业务语义
 *   fewer   当前解析效果**更少** —— 回填=删除，逐条判
 *   differ  有交集但不完全相同（读法改写）—— 逐条判
 *   missing 包内无条目但当前解析有 —— 该新建
 *   stale   包内有条目但当前解析无 —— 该删（逐条判）
 * 两个同步工具共用完整 IR 比较，不把 guard/op.if 改写或时序迁移认作语义等价。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSoulmarkText } from "./soulmark-parse.mjs";
import { stable, classifyEffects } from "./pet-roster-shared.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK = join(ROOT, "content/peak");
const CAT = join(ROOT, "content/creatures/creatures.json");

/** 巅峰 12 只手工装配单位：不挂魂印引用（与 build-pet-roster.mjs 的 PEAK_ROSTER 一致）。 */
const PEAK_ROSTER = new Set([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);

/**
 * **显式不挂载**的魂印（验收决策，见 tests/battle-core/content/soulmark-content-sync.test.ts）：
 * 这几只的魂印条目与挂载引用都断言为 undefined，**不许**被同步工具补上。
 * 与 PEAK_ROSTER 的区别：巅峰 12 只是「手工装配单位不带魂印」，
 * 这几只是「魂印本身不装配」（内容/语义另有安排）。
 * 注意：build-pet-roster.mjs 只按 PEAK_ROSTER 判断，所以整库重建会把它们挂上——
 * 这两处口径的差异是**已知的**，以本白名单 + 验收测试为准。
 */
const NO_MOUNT = new Set([
  "pet-4904", "pet-4943", // 验收测试：soulMark 必须 undefined
  "pet-4759", "pet-4835", // 验收测试：soulMark 与 sm-<id> 条目都必须 undefined
]);

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const dryRun = argv.includes("--dry-run");
const allDifferent = argv.includes("--all-different");
const scan = argv.includes("--scan");
const bucketOpt = (() => { const i = argv.indexOf("--bucket"); return i >= 0 ? argv[i + 1] : undefined; })();
const ids = argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--bucket");

const cat = JSON.parse(readFileSync(CAT, "utf8"));
const unitsDoc = JSON.parse(readFileSync(join(PACK, "units.json"), "utf8"));
const marksDoc = JSON.parse(readFileSync(join(PACK, "soulmarks.json"), "utf8"));
const units = unitsDoc.units;
const marks = marksDoc.soulmarks;

/** creature.id → creature（按完整 id 关联，不用 petNo 合并形态）。 */
const byId = new Map();
for (const [key, c] of Object.entries(cat.creatures)) byId.set(c.id ?? key, c);

/** 编译一只精灵的魂印条目；无条目返回 null（= 不落条目）。 */
const compile = (c) => {
  const text = String(c.soulMark?.text ?? "").trim();
  if (text === "") return null;
  const sm = parseSoulmarkText(text, c.name);
  if (sm.entries.length === 0) return null;
  const suffix = String(c.id ?? "").replace(/^pet-/, "");
  return {
    entry: { id: `sm-${suffix}`, name: `${c.name}魂印`, desc: text.slice(0, 2000), effects: sm.entries },
    residual: sm.unparsed.length,
  };
};

const unitById = new Map(units.map((u) => [u.id, u]));

const targets = [];
const buckets = { same: [], equiv: [], more: [], fewer: [], differ: [], missing: [], stale: [] };
if (scan || allDifferent || bucketOpt !== undefined) {
  // 全库扫描（--scan / --all-different / --bucket 都走这条）
  for (const [id, c] of byId) {
    // 只处理**包内**精灵：build-pet-roster.mjs 只会给建出来的单位出魂印条目，
    // 不在包范围（没有 unit）的精灵它根本不写——同步工具必须同口径，
    // 否则会往包里塞生成器不会产出的条目。
    if (!unitById.has(id)) continue;
    const suffix = String(id).replace(/^pet-/, "");
    const key = `sm-${suffix}`;
    const compiled = compile(c);
    const stored = marks[key];
    let bucket;
    if (compiled === null) bucket = stored === undefined ? "same" : "stale";
    else if (stored === undefined) bucket = "missing";
    else if (stable(stored.effects) === stable(compiled.entry.effects)) bucket = "same";
    else bucket = classifyEffects(stored.effects, compiled.entry.effects);
    buckets[bucket].push({ id, c, compiled, key });
  }
  if (bucketOpt !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(buckets, bucketOpt)) {
      console.error(`sync-soulmarks: 未知桶 ${bucketOpt}（可选：${Object.keys(buckets).join(", ")}）`);
      process.exit(1);
    }
    targets.push(...buckets[bucketOpt]);
  } else if (allDifferent) {
    for (const b of Object.keys(buckets)) if (b !== "same") targets.push(...buckets[b]);
  }
} else {
  for (const raw of ids) {
    const norm = raw.startsWith("pet-") ? raw : `pet-${raw}`;
    const c = byId.get(norm);
    if (c === undefined) { console.error(`sync-soulmarks: 找不到精灵 ${raw}`); process.exitCode = 1; continue; }
    const id = c.id ?? norm;
    if (!unitById.has(id)) { console.log(`- ${id} ${c.name}：不在包范围（没有 unit），跳过`); continue; }
    const suffix = String(id).replace(/^pet-/, "");
    targets.push({ id, c, compiled: compile(c), key: `sm-${suffix}` });
  }
}

if (scan) {
  console.log("魂印内容包分桶（包内精灵）：\n");
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v.length}`);
  // 挂载差异单独统计（条目一致但 unit.soulMark 引用不对）
  let mountDiffCount = 0;
  for (const b of Object.keys(buckets)) {
    for (const t of buckets[b]) {
      const unit = unitById.get(t.id);
      const wantMount = t.compiled !== null && !PEAK_ROSTER.has(t.id) && !NO_MOUNT.has(t.id);
      if ((unit?.soulMark === t.key) !== wantMount) mountDiffCount++;
    }
  }
  console.log(`  （其中挂载引用不一致：${mountDiffCount}）`);
  const out = {};
  for (const [k, v] of Object.entries(buckets)) out[k] = v.map((t) => t.id);
  writeFileSync("scratch/soulmark-buckets.json", `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log("\n桶已写到 scratch/soulmark-buckets.json（只读，未写回）");
  for (const k of Object.keys(buckets)) {
    if (k === "same" || buckets[k].length === 0) continue;
    console.log(`\n[${k}] ${buckets[k].length} 只：`);
    for (const t of buckets[k].slice(0, 12)) {
      const stored = marks[t.key];
      const oldSig = signature(stored?.effects);
      const newSig = signature(t.compiled?.entry.effects);
      const sa = new Set(oldSig), sb = new Set(newSig);
      const onlyOld = oldSig.filter((x) => !sb.has(x));
      const onlyNew = newSig.filter((x) => !sa.has(x));
      console.log(`  ${t.id} ${t.c.name}（旧 ${oldSig.length} → 新 ${newSig.length}）`);
      for (const x of onlyOld.slice(0, 2)) console.log(`      - ${x.slice(0, 160)}`);
      for (const x of onlyNew.slice(0, 2)) console.log(`      + ${x.slice(0, 160)}`);
    }
  }
  process.exit(0);
}

let changedMarks = 0;
let changedMounts = 0;
for (const t of targets) {
  const stored = marks[t.key];
  const next = t.compiled?.entry;
  // 无活动条目也可能有大量未实现子句，不能把 null 编译结果显示成「残文0」。
  const residual = t.compiled?.residual ?? parseSoulmarkText(String(t.c.soulMark?.text ?? ""), t.c.name).unparsed.length;
  const same = t.compiled === null
    ? stored === undefined
    : stored !== undefined
      && stable(stored.effects) === stable(next.effects)
      && stored.name === next.name
      && stored.desc === next.desc;
  const unit = unitById.get(t.id);
  const wantMount = t.compiled !== null && !PEAK_ROSTER.has(t.id) && !NO_MOUNT.has(t.id);
  const hasMount = unit?.soulMark === t.key;
  const mountDiff = wantMount !== hasMount;
  if (same && !mountDiff) { console.log(`= ${t.id} ${t.c.name}：已是最新（条目 ${t.compiled === null ? 0 : t.compiled.entry.effects.length}，残文 ${residual}）`); continue; }
  changedMarks += same ? 0 : 1;
  changedMounts += mountDiff ? 1 : 0;
  console.log(`${same ? "!" : "*"} ${t.id} ${t.c.name}：${same ? "条目一致" : `条目 ${stored === undefined ? "缺失" : "不同"} → ${t.compiled === null ? `删除/残文 ${residual}` : `${t.compiled.entry.effects.length} 条目/残文 ${residual}`}`}${mountDiff ? `；挂载 ${hasMount ? "有" : "无"} → ${wantMount ? "挂" : "不挂"}` : ""}`);
  if (write) {
    // NO_MOUNT 的魂印条目也不落（验收测试断言 sm-<id> 条目为 undefined）
    if (t.compiled === null || NO_MOUNT.has(t.id)) delete marks[t.key];
    else marks[t.key] = t.compiled.entry;
    if (unit !== undefined) {
      if (wantMount) unit.soulMark = t.key;
      else delete unit.soulMark;
    }
  }
}

if (write && (changedMarks > 0 || changedMounts > 0)) {
  writeFileSync(join(PACK, "soulmarks.json"), `${JSON.stringify({ soulmarks: marks }, null, 2)}\n`);
  writeFileSync(join(PACK, "units.json"), `${JSON.stringify({ units }, null, 2)}\n`);
  console.log(`\n已写回：魂印条目 ${changedMarks} 处、挂载引用 ${changedMounts} 处`);
} else if (!write) {
  console.log(`\n（未写回。${dryRun ? "dry-run" : "默认不写"}；加 --write 才落盘）`);
}
console.log(`目标 ${targets.length} 只；条目变化 ${changedMarks}、挂载变化 ${changedMounts}`);
