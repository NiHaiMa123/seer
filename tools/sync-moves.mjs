/**
 * tools/sync-moves.mjs —— 技能条目**定点同步**入口（content/peak/moves.json）。
 *
 * 为什么需要它：`content/peak/moves.json` 是 `tools/build-pet-roster.mjs` 的**构建产物**，
 * 历史上不随解析器同步（最后一次实质更新在 22de65d，之后解析器改过很多轮）。
 * 结果是「解析器能产出正确 IR」但「包里还是旧条目」——技能侧的内容包长期漂移。
 *
 * 为什么不能直接整库重建：
 *   - `build-pet-roster.mjs` 一次重建 41524 条技能 + 全部 unit + 全部魂印，
 *     漂移量无法逐条语义复核，违反「不整库重建内容包」的纪律；
 *   - 重建会把历次所有解析器改动一次性灌进包里。
 * 实测（2026-10-22）：重建产出的 move id 集合与现网**完全一致**（不丢条目），
 * 但 41524 条里有 **3342 条**与现网不同 —— 这就是待消化的漂移量。
 *
 * 口径保证：编译逻辑（typeOf / kindOf / assemble / moveId 映射）全部来自
 * `tools/pet-roster-shared.mjs`，与 `build-pet-roster.mjs` **共用同一份实现**，
 * 定点同步的产物 == 整库重建的产物（逐字相同）。
 *
 * 用法：
 *   node tools/sync-moves.mjs --scan                 # 全库扫描 + 分桶（只读）
 *   node tools/sync-moves.mjs --dry-run mv-3323-s5   # 定点 dry-run（id 可为 mv-xxx 或 pet-xxx）
 *   node tools/sync-moves.mjs --write mv-3323-s5     # 定点写回
 *   node tools/sync-moves.mjs --write --bucket more  # 按分桶批量写回（配合 --scan 的桶名）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT, buildPpFill, compilePetSkills, buildablePets, stable, classifyMoves, isKeptMoveId } from "./pet-roster-shared.ts";

const PEAK_ROSTER = new Set([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const ids = argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--bucket");

const cat = JSON.parse(readFileSync(join(ROOT, "content/creatures/creatures.json"), "utf8"));
const movesPath = join(OUT, "moves.json");
const pack = JSON.parse(readFileSync(movesPath, "utf8")).moves;
const packById = new Map(pack.map((m) => [m.id, m]));

// 巅峰 12 只的装备技：原样保留，不重编译
const keptMoveIds = new Set(
  pack.filter((m) => isKeptMoveId(m.id, PEAK_ROSTER)).map((m) => m.id),
);

const ppFill = buildPpFill(cat);
const report = { skippedUnits: [], skippedMoves: [], guessCategory: [], fifthNotAttack: 0, droppedAccCrt: 0 };

// ── 编译全库技能条目（映射与整库构建同源：buildablePets + compilePetSkills）──
const compiledById = new Map(); // moveId → { move, petId, petNo, name }
const petOf = new Map();       // petId → 该精灵编译出的条目
for (const { c, type } of buildablePets(cat, report)) {
  const id = c.id;
  const compiled = compilePetSkills(c, { type, keptMoveIds, ppFill, report });
  petOf.set(id, compiled);
  for (const se of compiled.entries) {
    compiledById.set(se.moveId, { move: se.move, petId: id, petNo: c.petNo, name: c.name });
  }
}

// ── 目标集合 ──
const wanted = new Set();
if (ids.length > 0) {
  for (const raw of ids) {
    const hit = compiledById.get(raw);
    if (hit !== undefined) { wanted.add(raw); continue; }
    const petId = raw.startsWith("pet-") ? raw : `pet-${raw}`;
    const compiled = petOf.get(petId);
    if (compiled === undefined || compiled.entries.length === 0) { console.error(`未找到可同步目标：${raw}`); process.exitCode = 1; continue; }
    for (const se of compiled.entries) wanted.add(se.moveId);
  }
}

if (process.exitCode) process.exit(process.exitCode);

// ── 分桶 ──
const buckets = { same: [], equiv: [], more: [], fewer: [], differ: [], missing: [] };
for (const [mid, info] of compiledById) {
  const old = packById.get(mid);
  if (old === undefined) { buckets.missing.push(mid); continue; }
  if (stable(old) === stable(info.move)) { buckets.same.push(mid); continue; }
  buckets[classifyMoves(old, info.move)].push(mid);
}

// ── 输出 ──
const show = (mid) => {
  const info = compiledById.get(mid);
  const old = packById.get(mid);
  console.log(`\n=== ${mid} ${info?.name ?? ""} ${info?.move?.name ?? ""}`);
  console.log(`  现网: ${JSON.stringify(old?.effects)}`);
  console.log(`  新编: ${JSON.stringify(info?.move?.effects)}`);
};

if (flag("--scan")) {
  console.log(`扫描 ${compiledById.size} 条技能条目（包内 ${pack.length} 条）\n`);
  for (const [k, v] of Object.entries(buckets)) console.log(`${k}: ${v.length}`);
  const out = {};
  for (const [k, v] of Object.entries(buckets)) out[k] = v;
  writeFileSync("scratch/move-buckets.json", `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log("\n桶已写到 scratch/move-buckets.json");
  process.exit(0);
}

if (flag("--dry-run")) {
  const bucketName = opt("--bucket");
  let targets;
  if (bucketName !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(buckets, bucketName)) {
      console.error(`未知桶：${bucketName}（可选：${Object.keys(buckets).join(", ")}）`);
      process.exit(1);
    }
    targets = buckets[bucketName];
  } else {
    targets = ids.length > 0 ? [...wanted] : Object.values(buckets).flat();
  }
  const list = targets.filter((m) => !buckets.same.includes(m));
  console.log(`dry-run：目标 ${targets.length} 条，其中 ${list.length} 条有差异\n`);
  for (const mid of list.slice(0, 40)) {
    const b = Object.keys(buckets).find((k) => buckets[k].includes(mid));
    console.log(`  [${b}] ${mid} ${compiledById.get(mid)?.move?.name ?? ""}`);
  }
  if (list.length > 40) console.log(`  …还有 ${list.length - 40} 条`);
  console.log("\n（未写回。加 --write 才落盘。）");
  process.exit(0);
}

if (flag("--write")) {
  const bucketName = opt("--bucket");
  let targets = [...wanted];
  if (bucketName !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(buckets, bucketName)) {
      console.error(`未知桶：${bucketName}（可选：${Object.keys(buckets).join(", ")}）`);
      process.exit(1);
    }
    targets = buckets[bucketName];
    console.log(`按桶回填：${bucketName}（${targets.length} 条）`);
  }
  if (targets.length === 0) { console.log("无目标，未写回。"); process.exit(0); }
  let changed = 0, skipped = 0;
  const next = pack.map((m) => {
    if (!targets.includes(m.id)) return m;
    const info = compiledById.get(m.id);
    if (info === undefined) { skipped++; return m; }
    if (stable(m) === stable(info.move)) return m;
    changed++;
    return info.move;
  });
  writeFileSync(movesPath, `${JSON.stringify({ moves: next }, null, 2)}\n`, "utf8");
  console.log(`已写回：${changed} 条改写，${skipped} 条跳过（包内无对应条目）`);
  process.exit(0);
}

console.log("用法：--scan | --dry-run [ids...] | --write [ids...] [--bucket <桶名>]");
