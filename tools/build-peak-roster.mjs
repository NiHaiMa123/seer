/**
 * 巅峰常见 12 只 → content/peak/。
 * 名单：壹读 2026-10-04 竞技模式（BAN 常驻 + 常用出战）与 B 站配置记录 cv18458805。
 * 数值、配招、性格、第五技能只取 content/creatures/creatures.json，不补学习力。
 * 运行：node tools/build-peak-roster.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEffectText } from "./effects-parse.mjs";
import { damageKeyHits, unknownAttachDamageKeys } from "../packages/battle-core/src/ops/damage-keys.ts";
import { mergeAttachDamage } from "./attach-damage.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "content", "peak");
const cat = JSON.parse(readFileSync(join(ROOT, "content/creatures/creatures.json"), "utf8"));
const chart = JSON.parse(readFileSync(join(ROOT, "content/rulesets/typechart.json"), "utf8"));
const atoms = new Set(Object.keys(chart.attack));

function kindOf(kind, ownType) {
  const m = kind == null ? null : /^(.+?)(?:系)?(物攻|特攻)$/.exec(kind);
  if (m !== null && atoms.has(m[1])) return { type: m[1], category: m[2] === "物攻" ? "physical" : "special" };
  // 图鉴没写属性前缀时，类别仍写着「特殊 / 特殊攻击」，属性用精灵自己的那一系。
  if (kind === "特殊攻击" || kind === "特殊") return { type: ownType, category: "special" };
  return { type: ownType };
}

function assemble(id, ownType, skill, fifth) {
  if (skill.pp == null) throw new Error(`${id} ${skill.name} has no pp`);
  const { flags, effects, unparsed } = parseEffectText((skill.effect ?? "").trim(), { hasDamage: (skill.power ?? 0) > 0 });
  const effs = structuredClone(effects);
  const ad = flags.attachDamage;
  // 威力写在技能行上、正文没拆出伤害 op 时，补一条普通伤害。属性技没有威力，不造一条假攻击。
  let dmg = effs.find((e) => e.op === "damage" && (e.kind === undefined || e.kind === "standard" || e.kind === "true"));
  if ((skill.power ?? 0) > 0 && dmg === undefined) {
    dmg = { op: "damage", power: skill.power };
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
  const typed = kindOf(skill.kind, ownType);
  if (scaled && typed.category === undefined) throw new Error(`${id} ${skill.name} needs a category, kind=${skill.kind}`);
  const move = {
    id, name: skill.name, pp: skill.pp, priority: flags.priority ?? 0, effects: effs,
    type: typed.type,
    ...(scaled ? { category: typed.category } : {}),
    ...(fifth ? { fifth: true } : {}),
  };
  for (const k of ["priorityIf", "hitIf", "prioPerUse", "prioPerFoeLowPp"]) {
    if (flags[k] !== undefined) move[k] = flags[k];
  }
  if (flags.ignoreFoeSpeed === true) move.ignoreFoeSpeed = true;
  return { move, unparsed: flags };
}

const ROSTER = [
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
];

const units = [];
const moves = [];
const notes = [];
for (const id of ROSTER) {
  const c = cat.creatures[id];
  if (c === undefined) throw new Error(`missing ${id}`);
  const byName = new Map((c.skills ?? []).map((s) => [s.name, s]));
  const fifthName = c.fifthSkill;
  if (fifthName == null || !byName.has(fifthName)) throw new Error(`${c.name} fifth ${fifthName} missing`);
  const carried = [];
  for (const name of c.build?.moves ?? []) {
    if (name === fifthName) continue;
    const s = byName.get(name);
    if (s === undefined) throw new Error(`${c.name} build move ${name} not in skill list`);
    carried.push(s);
  }
  if (carried.length !== 4) throw new Error(`${c.name} carried ${carried.length}, want 4`);
  if (!atoms.has(c.type)) throw new Error(`${c.name} type ${c.type} not in chart`);
  const types = [c.type];
  const moveIds = [];
  carried.forEach((s, i) => {
    const mid = `mv-${c.petNo}-${i}`;
    const { move } = assemble(mid, c.type, s, false);
    moves.push(move);
    moveIds.push(mid);
  });
  const fifthId = `mv-${c.petNo}-f`;
  moves.push(assemble(fifthId, c.type, byName.get(fifthName), true).move);
  const nature = c.build?.nature;
  if (nature !== "保守" && nature !== "固执") throw new Error(`${c.name} nature ${nature}`);
  units.push({
    id, name: c.name,
    base: { hp: c.baseStats.hp, atk: c.baseStats.atk, def: c.baseStats.def, spa: c.baseStats.spa, sdf: c.baseStats.sdf, spd: c.baseStats.spd },
    nature, types, moveIds, fifthMoveId: fifthId,
  });
  notes.push(`${c.name} ${types.join("+")} 性格${nature} 第五${fifthName} 配招${carried.map((s) => s.name).join("、")} 学习力原文「${c.build?.evs ?? ""}」未拆`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "units.json"), `${JSON.stringify({ units }, null, 2)}\n`);
writeFileSync(join(OUT, "moves.json"), `${JSON.stringify({ moves }, null, 2)}\n`);
writeFileSync(join(OUT, "pack.json"), `${JSON.stringify({
  packId: "peak",
  version: "1.0.0",
  schemaVersion: 1,
  rulesetId: "peak-v1",
  verification: "UNVERIFIED",
  license: { identifier: "CC0-1.0", public: true },
  files: {
    units: "units.json",
    moves: "moves.json",
    seals: "../seals/seals.json",
    soulmarks: "../synthetic-v2/soulmarks.json",
    items: "../synthetic-v2/items.json",
  },
  assets: [],
}, null, 2)}\n`);
console.log(notes.join("\n"));
console.log(`\n${units.length} units, ${moves.length} moves`);
