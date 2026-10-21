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
 *   node tools/sync-soulmarks.mjs --write --all-different         # 同步全部"与当前解析不一致"的条目
 *
 * 只读 content/creatures/creatures.json 与 content/peak/，只写 content/peak/。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSoulmarkText } from "./soulmark-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK = join(ROOT, "content/peak");
const CAT = join(ROOT, "content/creatures/creatures.json");

/** 巅峰 12 只手工装配单位：不挂魂印引用（与 build-pet-roster.mjs 的 PEAK_ROSTER 一致）。 */
const PEAK_ROSTER = new Set([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const dryRun = argv.includes("--dry-run");
const allDifferent = argv.includes("--all-different");
const ids = argv.filter((a) => !a.startsWith("--"));

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
if (allDifferent) {
  for (const [id, c] of byId) {
    // 只处理**包内**精灵：build-pet-roster.mjs 只会给建出来的单位出魂印条目，
    // 不在包范围（没有 unit）的精灵它根本不写——同步工具必须同口径，
    // 否则会往包里塞 74 条生成器不会产出的条目。
    if (!unitById.has(id)) continue;
    const suffix = String(id).replace(/^pet-/, "");
    const key = `sm-${suffix}`;
    const compiled = compile(c);
    const stored = marks[key];
    const differs = compiled === null
      ? stored !== undefined
      : stored === undefined || JSON.stringify(stored.effects) !== JSON.stringify(compiled.entry.effects);
    if (differs) targets.push({ id, c, compiled, key });
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

let changedMarks = 0;
let changedMounts = 0;
for (const t of targets) {
  const stored = marks[t.key];
  const next = t.compiled?.entry;
  const same = t.compiled === null
    ? stored === undefined
    : stored !== undefined
      && JSON.stringify(stored.effects) === JSON.stringify(next.effects)
      && stored.name === next.name
      && stored.desc === next.desc;
  const unit = unitById.get(t.id);
  const wantMount = t.compiled !== null && !PEAK_ROSTER.has(t.id);
  const hasMount = unit?.soulMark === t.key;
  const mountDiff = wantMount !== hasMount;
  if (same && !mountDiff) { console.log(`= ${t.id} ${t.c.name}：已是最新（条目 ${t.compiled === null ? 0 : t.compiled.entry.effects.length}，残文 ${t.compiled?.residual ?? 0}）`); continue; }
  changedMarks += same ? 0 : 1;
  changedMounts += mountDiff ? 1 : 0;
  console.log(`${same ? "!" : "*"} ${t.id} ${t.c.name}：${same ? "条目一致" : `条目 ${stored === undefined ? "缺失" : "不同"} → ${t.compiled === null ? "删除" : `${t.compiled.entry.effects.length} 条目/残文 ${t.compiled.residual}`}`}${mountDiff ? `；挂载 ${hasMount ? "有" : "无"} → ${wantMount ? "挂" : "不挂"}` : ""}`);
  if (write) {
    if (t.compiled === null) delete marks[t.key];
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
