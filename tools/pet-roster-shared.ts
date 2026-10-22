import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEffectText, isHitRider } from "./effects-parse.mjs";
import { damageKeyHits, unknownAttachDamageKeys } from "../packages/battle-core/src/ops/damage-keys.ts";
import { mergeAttachDamage } from "./attach-damage.ts";

export const ROOT = join(import.meta.dirname, "..");
export const OUT = join(ROOT, "content", "peak");

const chart = JSON.parse(readFileSync(join(ROOT, "content/rulesets/typechart.json"), "utf8"));
const atoms = new Set<string>(Object.keys(chart.attack));

// 类型归一：图鉴系名 ≠ 图表原子名（双系倒序/缩写/别名）
const TYPE_MAP: Record<string, string | null> = {
  "冰雪": "冰", "地": "地面", "圣光": "圣灵光", "龙暗": "暗影龙", "龙暗影": "暗影龙",
  "地暗": "地面暗影", "地龙": "地面龙", "战地": "战斗地面", "飞超能": "飞行超能",
  "光飞": "飞行光", "超冰": "冰超能", "超能冰": "冰超能", "超能火": "火超能",
  "灵光": "光", "光飞行": "飞行光", "飞行火": "火飞行",
  "火电": "电火", "暗影神秘": "神秘暗影", "远古光": "光远古", "圣灵远古": "远古圣灵",
  "混沌暗影": "暗影混沌", "地面机械": "机械地面", "飞行龙": "飞龙",
  "火虫": null, // 无法确定（虫/火歧义）——跳过该精灵
};
export const revAtom = (t: string): string | null => {
  const r = [...t].reverse().join("");
  return atoms.has(r) ? r : null;
};
export const typeOf = (t: string | null | undefined): string | null => {
  if (t == null) return null;
  if (atoms.has(t)) return t;
  if (Object.prototype.hasOwnProperty.call(TYPE_MAP, t)) return TYPE_MAP[t] ?? null;
  return revAtom(t);
};

// 技能行 kind → {type,category}：脏数据归一（错别字/缩写/别名/标点）
export const kindOf = (kind: string | null | undefined, ownType: string): { type: string; category?: string } => {
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

// ── 数据形状（creatures.json / moves.json 的最小结构）──
export interface SkillRow {
  name: string;
  effect?: string;
  pp?: number | null;
  power?: number | null;
  kind?: string | null;
}
export interface CreatureRow {
  id: string;
  petNo: number | string;
  name: string;
  type?: string | null;
  baseStats?: Record<string, number> | null;
  skills?: SkillRow[];
  fifthSkill?: string;
  signatureSkill?: string;
  soulMark?: { text?: string };
}
export interface CompiledMove {
  id: string;
  name: string;
  pp: number;
  priority: number;
  effects: Record<string, unknown>[];
  type: string;
  category?: string;
  fifth?: boolean;
  priorityIf?: unknown;
  hitIf?: unknown;
  prioPerUse?: unknown;
  prioPerFoeLowPp?: unknown;
  targets?: unknown;
  targetScope?: unknown;
  ignoreFoeSpeed?: boolean;
}
export interface CompileReport {
  skippedUnits?: { petNo: number | string; name: string; reason: string }[];
  skippedMoves?: { petNo: number | string; name: string; skill: string; reason: string }[];
  guessCategory?: { petNo: number | string; skill: string; kind: string }[];
  fifthNotAttack?: number;
  droppedAccCrt?: number;
  [k: string]: unknown;
}

/**
 * 编译一个技能条目（moves.json 里的一条）。
 * 与 build-pet-roster.mjs 原实现逐行一致——`report` 只用于累加 droppedAccCrt 计数。
 */
export function assemble(id: string, ownType: string, skill: SkillRow, fifth?: boolean, report: CompileReport = { droppedAccCrt: 0 }): CompiledMove {
  if (skill.pp == null) throw new Error(`${id} ${skill.name} has no pp`);
  const { flags, effects } = parseEffectText((skill.effect ?? "").trim(), { hasDamage: (skill.power ?? 0) > 0 });
  const effs = structuredClone(effects) as Record<string, unknown>[];
  const ad = flags.attachDamage;
  let dmg = effs.find((e) => e.op === "damage" && (e.kind === undefined || e.kind === "standard" || e.kind === "true"));
  // 合成宿主的两种情形：
  //   ① 有威力的招 → power 用原威力；
  //   ② 属性招却带了命中 rider（applyDrainRider / flat{of:…} 等）→ rider 必须有
  //      damage 宿主，否则装载期被 groupHitRiders 判孤儿、整包拒载。
  //      这类句子语义是「命中后附加」，宿主就是那一击本身，power:0 表示不额外造伤。
  const hasRider = effs.some((e) => isHitRider(e.op as string));
  if (dmg === undefined && ((skill.power ?? 0) > 0 || hasRider)) {
    dmg = { op: "damage", power: skill.power ?? 0 };
    effs.unshift(dmg);
  }
  if (ad !== undefined) {
    const bad = unknownAttachDamageKeys(ad as Record<string, unknown>);
    if (bad.length > 0) throw new Error(`${id} ${skill.name} attachDamage key outside the list: ${bad.join(",")}`);
  }
  if (ad !== undefined && dmg !== undefined) mergeAttachDamage(dmg as never, ad as never);
  const keyHits = damageKeyHits(effs as never[]);
  if (keyHits.length > 0) throw new Error(`${id} ${skill.name} damage key outside the list: ${keyHits.map((h) => h.key).join(",")}`);
  const scaled = effs.some((e) => e.op === "damage" && (e.kind === undefined || e.kind === "standard" || e.kind === "true"));
  // peak-v1 已启用 accuracy；仅暴击等级 crt 仍不属于 stage 域。
  const before = effs.length;
  for (let i = effs.length - 1; i >= 0; i--) {
    const st = (effs[i] as { stat?: string } | undefined)?.stat;
    if (st === "crt") effs.splice(i, 1);
  }
  report.droppedAccCrt = (report.droppedAccCrt ?? 0) + (before - effs.length);
  const typed = kindOf(skill.kind, ownType);
  if (scaled && typed.category === undefined) {
    // 威力有伤害 op 但类别认不出：按 spa/atk 大小兜底太像编数——用物理（普攻族惯例），报告里标注
    typed.category = "physical";
  }
  const move: CompiledMove = {
    id, name: skill.name, pp: skill.pp, priority: (flags.priority as number | undefined) ?? 0, effects: effs,
    type: typed.type,
    ...(scaled ? { category: typed.category } : {}),
    ...(fifth ? { fifth: true } : {}),
  };
  for (const k of ["priorityIf", "hitIf", "prioPerUse", "prioPerFoeLowPp", "targets", "targetScope"] as const) {
    if (flags[k] !== undefined) (move as unknown as Record<string, unknown>)[k] = flags[k];
  }
  if (flags.ignoreFoeSpeed === true) move.ignoreFoeSpeed = true;
  return move;
}

/**
 * 稳定序列化（键序无关）——**键存在但值为 undefined 的键要跳过**。
 *
 * 为什么：`JSON.stringify` 会省略 undefined 值的键，所以「解析产物里有 `params: undefined`」
 * 与「包内 JSON 里没有 params 这个键」在**字节层面完全等价**。
 * 若把 undefined 渲染成 null，两者会被误判成不同（实测误判 7 条技能条目）。
 */
export const stable = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
};

/** 同名技能 pp 回填表（全库口径：同名且 pp 唯一才可信）。 */
export function buildPpFill(cat: { creatures: Record<string, CreatureRow> }): (name: string) => number | null {
  const ppByName = new Map<string, Set<number>>();
  for (const x of Object.values(cat.creatures)) {
    for (const s of x.skills ?? []) {
      if (s.pp == null) continue;
      if (!ppByName.has(s.name)) ppByName.set(s.name, new Set());
      ppByName.get(s.name)!.add(s.pp);
    }
  }
  return (name: string) => {
    const v = ppByName.get(name);
    return v !== undefined && v.size === 1 ? [...v][0]! : null;
  };
}

/**
 * 「可装配精灵」判定——build-pet-roster.mjs 的整库循环与 sync-moves.mjs（定点同步）**共用**。
 *
 * 条件（与 build-pet-roster 原实现逐条一致）：
 *   - petNo >= 2500
 *   - 属性可映射（typeOf 非 null）
 *   - 有 baseStats，且六维都 >= 1
 *   - 至少一个技能
 * 不满足的按原因记入 report.skippedUnits。
 */
export function buildablePets(cat: { creatures: Record<string, CreatureRow> }, report: CompileReport = {}): { c: CreatureRow; type: string }[] {
  const out: { c: CreatureRow; type: string }[] = [];
  // 按 petNo 升序遍历——report.skippedUnits 的顺序要可复现（整库构建与定点同步都读它）
  const all = Object.values(cat.creatures).sort((a, b) => +a.petNo - +b.petNo);
  for (const c of all) {
    const petNo = c.petNo;
    if (+petNo < 2500) continue;
    const type = typeOf(c.type);
    if (type === null) { report.skippedUnits?.push({ petNo, name: c.name, reason: `type ${String(c.type)} unmappable` }); continue; }
    if (c.baseStats?.hp == null) { report.skippedUnits?.push({ petNo, name: c.name, reason: "no baseStats" }); continue; }
    if (["hp", "atk", "def", "spa", "sdf", "spd"].some((k) => !((c.baseStats![k] ?? 0) >= 1))) { report.skippedUnits?.push({ petNo, name: c.name, reason: "base stat <1" }); continue; }
    if ((c.skills ?? []).length === 0) { report.skippedUnits?.push({ petNo, name: c.name, reason: "no skills" }); continue; }
    out.push({ c, type });
  }
  return out;
}

/**
 * 把一只精灵的技能编译成 moves 条目——**与 build-pet-roster.mjs 的内层循环同一份逻辑**。
 *
 * moveId 口径：
 *   - 非第五技能 → `mv-<idSuffix>-s<skills 下标>`（idSuffix = id 去 "pet-" 前缀，pet-3788-b → 3788b）
 *   - 第五技能（`c.fifthSkill`，缺省取 `c.signatureSkill`）若是攻击技 → 改判 `mv-<idSuffix>-f`（fifth:true），
 *     此时该技能**不再**单独产出 s<i>
 *   - 巅峰 12 只的装备技（keptMoveIds）原样保留，不重编译
 *   - pp 缺失时按同名回填；同名 pp 不唯一则跳过该技能
 */
export function compilePetSkills(
  c: CreatureRow,
  opts: { type: string; keptMoveIds?: Set<string>; ppFill: (name: string) => number | null; report?: CompileReport },
): {
  entries: { moveId: string; move: CompiledMove; skillIndex: number; skillName: string }[];
  emitted: Map<number, string>;
  fifthEmitted: boolean;
  fifthName: string | undefined;
  idSuffix: string;
  skillsByName: Map<string, { s: SkillRow; i: number }>;
} {
  const { type, keptMoveIds = new Set(), ppFill, report = {} } = opts;
  const skills = c.skills ?? [];
  const idSuffix = c.id.replace(/^pet-/, ""); // pet-3788-b → 3788b（同 petNo 不同形态防 id 冲突）
  const skillsByName = new Map<string, { s: SkillRow; i: number }>(skills.map((s, i) => [s.name, { s, i }]));
  const fifthName = c.fifthSkill ?? (c.signatureSkill !== undefined && skillsByName.has(c.signatureSkill) ? c.signatureSkill : undefined);
  const entries: { moveId: string; move: CompiledMove; skillIndex: number; skillName: string }[] = [];
  const emitted = new Map<number, string>(); // skillIdx → moveId
  let fifthEmitted = false;
  for (const [i, s] of skills.entries()) {
    const isFifth = s.name === fifthName;
    let mid = `mv-${idSuffix}-s${i}`;
    if (keptMoveIds.has(mid)) { emitted.set(i, mid); continue; }
    let sk = s;
    if (sk.pp == null) {
      const fill = ppFill(sk.name);
      if (fill === null) { report.skippedMoves?.push({ petNo: c.petNo, name: c.name, skill: sk.name, reason: "pp missing" }); continue; }
      sk = { ...sk, pp: fill };
    }
    const mv = assemble(mid, type, sk, false, report);
    if (isFifth) {
      if (mv.effects.some((e) => e.op === "damage")) {
        mv.id = `mv-${idSuffix}-f`; mv.fifth = true; mid = mv.id; fifthEmitted = true;
      } else {
        report.fifthNotAttack = (report.fifthNotAttack ?? 0) + 1;
      }
    }
    if (keptMoveIds.has(mv.id)) { emitted.set(i, mv.id); continue; } // 巅峰既有 -f
    if (mv.effects.some((e) => e.op === "damage") && s.kind !== undefined && !/(物|特|普通|特殊)攻|物理|攻击/.test(String(s.kind))) {
      report.guessCategory?.push({ petNo: c.petNo, skill: sk.name, kind: String(s.kind) });
    }
    entries.push({ moveId: mv.id, move: mv, skillIndex: i, skillName: sk.name });
    emitted.set(i, mv.id);
  }
  return { entries, emitted, fifthEmitted, fifthName, idSuffix, skillsByName };
}
