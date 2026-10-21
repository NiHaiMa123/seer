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
import { parseEffectText } from "./effects-parse.mjs";
import { isHitRider } from "./effects-parse.mjs";
import { damageKeyHits, unknownAttachDamageKeys } from "../packages/battle-core/src/ops/damage-keys.ts";
import { mergeAttachDamage } from "./attach-damage.ts";
import { parseSoulmarkText } from "./soulmark-parse.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "content", "peak");
const cat = JSON.parse(readFileSync(join(ROOT, "content/creatures/creatures.json"), "utf8"));
const chart = JSON.parse(readFileSync(join(ROOT, "content/rulesets/typechart.json"), "utf8"));
const atoms = new Set(Object.keys(chart.attack));

// 类型归一：图鉴系名 ≠ 图表原子名（双系倒序/缩写/别名）
const TYPE_MAP = {
  "冰雪": "冰", "地": "地面", "圣光": "圣灵光", "龙暗": "暗影龙", "龙暗影": "暗影龙",
  "地暗": "地面暗影", "地龙": "地面龙", "战地": "战斗地面", "飞超能": "飞行超能",
  "光飞": "飞行光", "超冰": "冰超能", "超能冰": "冰超能", "超能火": "火超能",
  "灵光": "光", "光飞行": "飞行光", "飞行火": "火飞行",
  "火电": "电火", "暗影神秘": "神秘暗影", "远古光": "光远古", "圣灵远古": "远古圣灵",
  "混沌暗影": "暗影混沌", "地面机械": "机械地面", "飞行龙": "飞龙",
  "火虫": null, // 无法确定（虫/火歧义）——跳过该精灵
};
const revAtom = (t) => {
  const r = [...t].reverse().join("");
  return atoms.has(r) ? r : null;
};
const typeOf = (t) => {
  if (t == null) return null;
  if (atoms.has(t)) return t;
  if (Object.prototype.hasOwnProperty.call(TYPE_MAP, t)) return TYPE_MAP[t];
  return revAtom(t);
};

// 技能行 kind → {type,category}：脏数据归一（错别字/缩写/别名/标点）
const kindOf = (kind, ownType) => {
  if (kind == null) return { type: ownType };
  const norm = String(kind).replace(/[·•\s.。]+/g, "").replace(/特俗攻击|特击|特功|特攻斗|特攻都/g, "特攻")
    .replace(/物功|战都物攻|物理普攻/g, "物攻");
  if (/属性/.test(norm)) return { type: ownType }; // 属性技不需要 category
  const cat = /特攻|特殊/.test(norm) ? "special" : /物攻|普通攻击|物理|攻击/.test(norm) ? "physical" : null;
  const m = /^(.+?)(?:系)?(?:物攻|特攻|特殊|物理普攻|物理|普通攻击)/.exec(norm);
  const t = m?.[1] != null && m[1] !== "" ? typeOf(m[1]) : null;
  if (cat !== null) return { type: t ?? ownType, category: cat };
  return { type: ownType };
};

function assemble(id, ownType, skill, fifth) {
  if (skill.pp == null) throw new Error(`${id} ${skill.name} has no pp`);
  const { flags, effects } = parseEffectText((skill.effect ?? "").trim(), { hasDamage: (skill.power ?? 0) > 0 });
  const effs = structuredClone(effects);
  const ad = flags.attachDamage;
  let dmg = effs.find((e) => e.op === "damage" && (e.kind === undefined || e.kind === "standard" || e.kind === "true"));
  // 合成宿主的两种情形：
  //   ① 有威力的招 → power 用原威力；
  //   ② 属性招却带了命中 rider（applyDrainRider / flat{of:…} 等）→ rider 必须有
  //      damage 宿主，否则装载期被 groupHitRiders 判孤儿、整包拒载。
  //      这类句子语义是「命中后附加」，宿主就是那一击本身，power:0 表示不额外造伤。
  const hasRider = effs.some((e) => isHitRider(e.op));
  if (dmg === undefined && ((skill.power ?? 0) > 0 || hasRider)) {
    dmg = { op: "damage", power: skill.power ?? 0 };
    effs.unshift(dmg);
  }
  if (ad !== undefined) {
    const bad = unknownAttachDamageKeys(ad);
    if (bad.length > 0) throw new Error(`${id} ${skill.name} attachDamage key outside the list: ${bad.join(",")}`);
  }
  if (ad !== undefined && dmg !== undefined) mergeAttachDamage(dmg, ad);
  const keyHits = damageKeyHits(effs);
  if (keyHits.length > 0) throw new Error(`${id} ${skill.name} damage key outside the list: ${keyHits.map((h) => h.key).join(",")}`);
  const scaled = effs.some((e) => e.op === "damage" && (e.kind === undefined || e.kind === "standard" || e.kind === "true"));
  // peak-v1 已启用 accuracy；仅暴击等级 crt 仍不属于 stage 域。
  const before = effs.length;
  for (let i = effs.length - 1; i >= 0; i--) {
    const st = effs[i]?.stat;
    if (st === "crt") effs.splice(i, 1);
  }
  report.droppedAccCrt = (report.droppedAccCrt ?? 0) + (before - effs.length);
  const typed = kindOf(skill.kind, ownType);
  if (scaled && typed.category === undefined) {
    // 威力有伤害 op 但类别认不出：按 spa/atk 大小兜底太像编数——用物理（普攻族惯例），报告里标注
    typed.category = "physical";
  }
  const move = {
    id, name: skill.name, pp: skill.pp, priority: flags.priority ?? 0, effects: effs,
    type: typed.type,
    ...(scaled ? { category: typed.category } : {}),
    ...(fifth ? { fifth: true } : {}),
  };
  for (const k of ["priorityIf", "hitIf", "prioPerUse", "prioPerFoeLowPp", "targets", "targetScope"]) {
    if (flags[k] !== undefined) move[k] = flags[k];
  }
  if (flags.ignoreFoeSpeed === true) move.ignoreFoeSpeed = true;
  return move;
}

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

// 同名技能 pp 回填表（全库口径：同名且 pp 唯一才可信）
const ppByName = new Map();
for (const x of Object.values(cat.creatures)) {
  for (const s of x.skills ?? []) {
    if (s.pp == null) continue;
    if (!ppByName.has(s.name)) ppByName.set(s.name, new Set());
    ppByName.get(s.name).add(s.pp);
  }
}
const ppFill = (name) => { const v = ppByName.get(name); return v !== undefined && v.size === 1 ? [...v][0] : null; };

const NATURE_OK = new Set(JSON.parse(readFileSync(join(ROOT, "content/rulesets/natures.json"), "utf8")).natures ? Object.keys(JSON.parse(readFileSync(join(ROOT, "content/rulesets/natures.json"), "utf8")).natures) : []);

const pets = Object.values(cat.creatures)
  .filter((x) => +x.petNo >= 2500)
  .sort((a, b) => +a.petNo - +b.petNo);

const units = [];
const moves = [];
const soulmarks = {};
const report = { skippedUnits: [], fallbackMoves: [], skippedMoves: [], guessCategory: [], noFifth: [], smAttached: 0, smResidual: 0, units: 0, moves: 0 };

for (const c of pets) {
  const id = c.id;
  const petNo = c.petNo;
  const type = typeOf(c.type);
  if (type === null) { report.skippedUnits.push({ petNo, name: c.name, reason: `type ${c.type} unmappable` }); continue; }
  if (c.baseStats?.hp == null) { report.skippedUnits.push({ petNo, name: c.name, reason: "no baseStats" }); continue; }
  if (["hp", "atk", "def", "spa", "sdf", "spd"].some((k) => !(c.baseStats[k] >= 1))) { report.skippedUnits.push({ petNo, name: c.name, reason: "base stat <1" }); continue; }
  const skills = c.skills ?? [];
  if (skills.length === 0) { report.skippedUnits.push({ petNo, name: c.name, reason: "no skills" }); continue; }

  const idSuffix = id.replace(/^pet-/, ""); // pet-3788-b → 3788b（同 petNo 不同形态防 id 冲突）
  const skillsByName = new Map(skills.map((s, i) => [s.name, { s, i }]));
  const fifthName = c.fifthSkill ?? (skillsByName.has(c.signatureSkill) ? c.signatureSkill : undefined);
  if (fifthName === undefined) report.noFifth.push({ petNo, name: c.name });

  // 全技能库：非第五 s<i>，第五 -f（无伤害 op 的"第五"降级回 s<i>——loader 要求 fifth 必为攻击技）
  const emitted = new Map(); // skillIdx → moveId
  let fifthEmitted = false;
  for (const [i, s] of skills.entries()) {
    const isFifth = s.name === fifthName;
    let mid = `mv-${idSuffix}-s${i}`;
    if (keptMoveIds.has(mid)) { emitted.set(i, mid); continue; }
    let sk = s;
    if (sk.pp == null) {
      const fill = ppFill(sk.name);
      if (fill === null) { report.skippedMoves.push({ petNo, name: c.name, skill: sk.name, reason: "pp missing" }); continue; }
      sk = { ...sk, pp: fill };
    }
    const mv = assemble(mid, type, sk, false);
    if (isFifth) {
      if (mv.effects.some((e) => e.op === "damage")) {
        mv.id = `mv-${idSuffix}-f`; mv.fifth = true; mid = mv.id; fifthEmitted = true;
      } else {
        report.fifthNotAttack = (report.fifthNotAttack ?? 0) + 1;
      }
    }
    if (keptMoveIds.has(mv.id)) { emitted.set(i, mv.id); continue; } // 巅峰既有 -f
    if (mv.effects.some((e) => e.op === "damage") && s.kind !== undefined && !/(物|特|普通|特殊)攻|物理|攻击/.test(String(s.kind))) report.guessCategory.push({ petNo, skill: sk.name, kind: sk.kind });
    moves.push(mv);
    emitted.set(i, mv.id);
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
