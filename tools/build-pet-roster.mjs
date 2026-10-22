/**
 * 精灵库 petNo≥2500 复刻 → content/peak/（扩充而非替换）。
 * 数据源只有 content/creatures/creatures.json；不编造系数。
 *
 * - 收录条件：有 baseStats、类型可映射进 typechart、至少 1 个技能。
 * - 技能：图鉴全部技能都进 moves.json——非第五 `mv-<petNo>-s<i>`（i=技能表序号），第五 `mv-<petNo>-f`。
 * - 配招：build.moves 4 招映射到 s-id；缺配招退回技能表最后 4 个非第五（报告标 fallbackMoves）。
 * - 第五：fifthSkill → 否则 signatureSkill（须在技能表内）→ 否则不挂 fifthMoveId。
 * - pp 缺失：按全库同名技能唯一 pp 回填；仍缺则跳过该技能（报告 skippedMoves）。
 * - 魂印：soulMark.text 经 parseSoulmarkText 编译，有 ≥1 条目即出 `sm-<petNo>` 并挂 unit.soulMark（含残留也挂）。
 * - 既有 12 只巅峰单位与其装备技（mv-<petNo>-0..3/-f）原样保留，只补发全技能 s 库。
 * - nature 全量放行（natures.json 25 种）；缺失则不带 nature 字段。
 *
 * 运行：node tools/build-pet-roster.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseSoulmarkText } from "./soulmark-parse.mjs";
// 编译口径与 tools/sync-moves.mjs（定点同步）**共用同一份**——改这里两边同时生效。
import { ROOT, typeOf, kindOf, assemble, buildPpFill, compilePetSkills, buildablePets } from "./pet-roster-shared.ts";

// 输出目录：默认写 content/peak；PET_ROSTER_OUT 可指到别处（用于「重建到临时目录再对比」的
// 漂移盘点——不污染工作区，也不必整库覆盖现网包）。
const OUT = process.env.PET_ROSTER_OUT ?? join(ROOT, "content", "peak");

const cat = JSON.parse(readFileSync(join(ROOT, "content/creatures/creatures.json"), "utf8"));

// 类型归一（typeOf / kindOf）与技能编译（assemble）已抽到 tools/pet-roster-shared.mjs ——
// 与 tools/sync-moves.mjs（定点同步）共用同一份口径，避免两套实现互相漂移。

// 巅峰 12 只（手工装配的装备技 id 已被测试/文档引用）——单位与 mv-<no>-0..3/-f 原样保留；其余每次重生成
const PEAK_ROSTER = new Set([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);
const existingUnits = JSON.parse(readFileSync(join(OUT, "units.json"), "utf8")).units;
const existingMoves = JSON.parse(readFileSync(join(OUT, "moves.json"), "utf8")).moves;
const peakUnits = existingUnits.filter((u) => PEAK_ROSTER.has(u.id));
const keptMoves = existingMoves.filter((m) => {
  const mm = /^mv-(\d+)-/.exec(m.id);
  if (mm === null) return true;
  return PEAK_ROSTER.has(`pet-${mm[1]}`) && !/^mv-\d+-s\d+$/.test(m.id);
});
const keptMoveIds = new Set(keptMoves.map((m) => m.id));

// 同名技能 pp 回填表（全库口径：同名且 pp 唯一才可信）——口径与 sync-moves.mjs 共用
const ppFill = buildPpFill(cat);

const NATURE_OK = new Set(JSON.parse(readFileSync(join(ROOT, "content/rulesets/natures.json"), "utf8")).natures ? Object.keys(JSON.parse(readFileSync(join(ROOT, "content/rulesets/natures.json"), "utf8")).natures) : []);

// 可装配精灵判定与 sync-moves.mjs 共用（tools/pet-roster-shared.mjs 的 buildablePets）
const report = { skippedUnits: [], fallbackMoves: [], skippedMoves: [], guessCategory: [], noFifth: [], smAttached: 0, smResidual: 0, units: 0, moves: 0 };
const pets = buildablePets(cat, report).sort((a, b) => +a.c.petNo - +b.c.petNo);

const units = [];
const moves = [];
const soulmarks = {};

for (const { c, type } of pets) {
  const id = c.id;
  const petNo = c.petNo;
  const skills = c.skills ?? [];

  // 全技能库：非第五 s<i>，第五 -f（无伤害 op 的"第五"降级回 s<i>——loader 要求 fifth 必为攻击技）
  // 映射与编译口径在 pet-roster-shared.compilePetSkills（与 sync-moves.mjs 共用）。
  const compiled = compilePetSkills(c, { type, keptMoveIds, ppFill, report });
  const { entries: skillEntries, emitted, fifthEmitted, fifthName, idSuffix, skillsByName } = compiled;
  if (fifthName === undefined) report.noFifth.push({ petNo, name: c.name });
  for (const se of skillEntries) {
    const mv = se.move;
    moves.push(mv);
  }

  if (PEAK_ROSTER.has(id)) {
    // 巅峰 12 只是手工装配条目：单位与装备技（mv-<petNo>-0..3/-f）原样保留，
    // 只补发全技能 s 库。手工条目不声明魂印（peak-roster.test 锁的就是这一点：
    // 12 只的 evs/ivs/level/soulMark 都必须是 undefined），因此这里不再写回
    // host.soulMark；魂印本体仍照常编译进 soulmarks.json，供其他单位引用。
    const smText = c.soulMark?.text;
    if (smText != null && smText.trim() !== "") {
      const sm = parseSoulmarkText(smText, c.name);
      if (sm.entries.length > 0) {
        soulmarks[`sm-${idSuffix}`] = { id: `sm-${idSuffix}`, name: `${c.name}魂印`, desc: smText.slice(0, 2000), effects: sm.entries };
        report.smAttached++;
        if (sm.unparsed.length > 0) report.smResidual++;
      }
    }
    continue;
  }
  // 配招：build.moves 4 招 → s-id；缺失退回技能表末 4 个非第五
  let buildNames = c.build?.moves ?? [];
  let fallback = false;
  if (buildNames.length !== 4 || buildNames.some((n) => !skillsByName.has(n))) {
    const tail = skills.filter((s) => s.name !== fifthName).slice(-4).map((s) => s.name);
    if (tail.length === 0) { report.skippedUnits.push({ petNo, name: c.name, reason: "no usable moves" }); continue; }
    buildNames = tail; fallback = true;
  }
  const moveIds = [];
  for (const n of buildNames) {
    const hit = skillsByName.get(n);
    if (hit === undefined || !emitted.has(hit.i)) continue;
    const mid = emitted.get(hit.i);
    if (mid === `mv-${idSuffix}-f`) continue; // fifth:true 只能挂 fifthMoveId
    if (!moveIds.includes(mid)) moveIds.push(mid); // 同名配招重复出现去重（schema uniqueItems）
  }
  if (moveIds.length === 0) { report.skippedUnits.push({ petNo, name: c.name, reason: "moves all skipped" }); continue; }
  if (fallback) report.fallbackMoves.push({ petNo, name: c.name, moves: moveIds.length });

  const gmap = { 雄: "male", 雄性: "male", 雌: "female", 雌性: "female", 无性别: "none" };
  const unit = {
    id, name: c.name,
    base: { hp: c.baseStats.hp, atk: c.baseStats.atk, def: c.baseStats.def, spa: c.baseStats.spa, sdf: c.baseStats.sdf, spd: c.baseStats.spd },
    ...(gmap[c.gender] !== undefined ? { gender: gmap[c.gender] } : {}),
    ...(c.build?.nature !== undefined && NATURE_OK.has(c.build.nature) ? { nature: c.build.nature } : {}),
    types: [type],
    moveIds,
    ...(fifthEmitted ? { fifthMoveId: `mv-${idSuffix}-f` } : {}),
  };

  // 魂印：有 ≥1 条目即出 sm-<petNo> 并挂引用（残留也挂——部分生效）
  const smText = c.soulMark?.text;
  if (smText != null && smText.trim() !== "") {
    const sm = parseSoulmarkText(smText, c.name);
    if (sm.entries.length > 0) {
      soulmarks[`sm-${idSuffix}`] = { id: `sm-${idSuffix}`, name: `${c.name}魂印`, desc: smText.slice(0, 2000), effects: sm.entries };
      unit.soulMark = `sm-${idSuffix}`;
      report.smAttached++;
      if (sm.unparsed.length > 0) report.smResidual++;
    }
  }
  units.push(unit);
}

units.sort((a, b) => +a.id.slice(4) - +b.id.slice(4));
const allUnits = [...peakUnits, ...units];
const allMoves = [...keptMoves, ...moves];
report.units = allUnits.length;
report.moves = allMoves.length;
report.soulmarks = Object.keys(soulmarks).length;
report.newUnits = units.length;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "units.json"), `${JSON.stringify({ units: allUnits }, null, 2)}\n`);
writeFileSync(join(OUT, "moves.json"), `${JSON.stringify({ moves: allMoves }, null, 2)}\n`);
writeFileSync(join(OUT, "soulmarks.json"), `${JSON.stringify({ soulmarks }, null, 2)}\n`);
const pack = JSON.parse(readFileSync(join(OUT, "pack.json"), "utf8"));
pack.files.soulmarks = "soulmarks.json";
writeFileSync(join(OUT, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
writeFileSync(join(ROOT, "content/claims/_pet-roster-report.json"), `${JSON.stringify({ generated: "2026-10-05", ...report }, null, 2)}\n`);

console.log(`units=${allUnits.length} (+${units.length} new) moves=${allMoves.length} soulmarks=${Object.keys(soulmarks).length}`);
console.log(`skippedUnits=${report.skippedUnits.length} fallbackMoves=${report.fallbackMoves.length} skippedMoves=${report.skippedMoves.length} guessCategory=${report.guessCategory.length} noFifth=${report.noFifth.length} smAttached=${report.smAttached} smResidual=${report.smResidual}`);
