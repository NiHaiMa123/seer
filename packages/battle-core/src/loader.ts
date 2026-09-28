/**
 * synthetic pack loader：把 content JSON 编译成冻结的运行时规则对象。
 * schema 校验复用 content/schemas/*.schema.json（Ajv strict）；
 * 语义校验：operator ⊆ allowlist、单位引用动作存在、rulesetId/packId 匹配。
 * computeHashes: rulesetHash/contentHash/executableHash 用 canonicalJson+sha256。
 */
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import type { BattleState } from "@seer/contracts/internal";
import { sha256hex } from "./sha256.ts";
import rulesetSchemaJson from "../../../content/schemas/ruleset.schema.json" with { type: "json" };
import packSchemaJson from "../../../content/schemas/pack.schema.json" with { type: "json" };
import unitsSchemaJson from "../../../content/schemas/units.schema.json" with { type: "json" };
import movesSchemaJson from "../../../content/schemas/moves.schema.json" with { type: "json" };
import typechartSchemaJson from "../../../content/schemas/typechart.schema.json" with { type: "json" };
import naturesSchemaJson from "../../../content/schemas/natures.schema.json" with { type: "json" };

export const ENGINE_VERSION = "0.1.0";
export const IR_VERSION = 1;
export const ENGINE_EXECUTABLE_HASH = `sha256:${sha256hex(canonicalJson({ engine: "@seer/battle-core", engineVersion: ENGINE_VERSION, irVersion: IR_VERSION }))}`;

export class PackLoadError extends Error {
  readonly code = "PACK_LOAD_ERROR";
}

export interface CompiledMove {
  id: string;
  pp: number;
  priority: number;
  effects: CompiledEffect[];
  type?: string;
  /** six-stat 规则下伤害招式必填：physical 用 攻→防，special 用 特攻→特防。 */
  category?: "physical" | "special";
}

export type DamageKind = "standard" | "fixed" | "percent" | "true";
export type StatKey = "hp" | "atk" | "def" | "spa" | "sdf" | "spd";
export type StageStatKey = Exclude<StatKey, "hp">;
export type StatSpread = Record<StatKey, number>;

export type CompiledEffect =
  | { op: "damage"; power: number; kind?: DamageKind }
  | { op: "apply_stat_stage"; stat: StageStatKey; delta: number; target: "self" | "opponent" }
  | { op: "heal"; numerator: number; denominator: number; target: "self" | "opponent" }
  | { op: "transfer_stages" }
  | { op: "clear_stages"; target: "self" | "opponent" }
  | { op: "control"; name: string; turns: number; target: "self" | "opponent" }
  | { op: "cleanse"; target: "self" | "opponent" }
  | { op: "apply_status"; name: string; turns: number; target: "self" | "opponent" }
  | { op: "apply_effect"; name: string; turns: number; target: "self" | "opponent" };

export interface CompiledUnit {
  id: string;
  /** 种族值（six-stat 模式）或面板值（legacy 四维）。 */
  base: { hp: number; atk: number; def: number; spd: number; spa?: number; sdf?: number };
  moveIds: string[];
  types?: string[];
  revives?: number;
  mode?: string;
  /** six-stat：个体实例参数（loader 补默认 level=100/ivs=31/evs=0/nature=无修正）。 */
  level?: number;
  ivs?: StatSpread;
  evs?: StatSpread;
  nature?: string;
}

export type FeatureFlag =
  | "bench"
  | "damage_kinds"
  | "control"
  | "revive"
  | "stat_ops"
  | "mode_overlay";

export interface FrozenPack {
  rules: BattleState["rules"];
  unitsById: ReadonlyMap<string, CompiledUnit>;
  movesById: ReadonlyMap<string, CompiledMove>;
  /** 属性克制表（attack[攻方][守方]=倍率）；ruleset 未声明则 undefined → 无属性系统。 */
  typeChart?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** 属性一致加成（STAB）：招式属性 ∈ 自身属性时的倍率。 */
  stabMultiplier: number;
  /** six-stat：精灵有 种族值/等级/个体值/努力值/性格 → 推导六维面板 + Seer 伤害公式。 */
  statModel?: "six-stat";
  /** six-stat：性格表（性格名 → {up,down}，平衡性格为空对象）。 */
  natures?: ReadonlyMap<string, { up?: StageStatKey; down?: StageStatKey }>;
  limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number; maxBenchSize?: number };
  stageRange: { min: number; max: number };
  operatorAllowlist: readonly string[];
  features: ReadonlySet<FeatureFlag>;
  modeOverlays: ReadonlyMap<string, { immuneControl?: boolean; immuneClearStages?: boolean }>;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vRuleset = ajv.compile(rulesetSchemaJson);
const vPack = ajv.compile(packSchemaJson);
const vUnits = ajv.compile(unitsSchemaJson);
const vMoves = ajv.compile(movesSchemaJson);
const vTypeChart = ajv.compile(typechartSchemaJson);
const vNatures = ajv.compile(naturesSchemaJson);

/** six-stat 面板推导（BWIKI 培养机制 × 4399 计算解析交叉验证）：
 *  HP  = floor((2·种族 + 个体 + 努力/4) · 等级/100) + 等级 + 10
 *  其余 = floor((floor((2·种族 + 个体 + 努力/4) · 等级/100) + 5) · 性格系数)
 *  性格系数 11/10 或 9/10（整数运算）；体力不受性格影响。 */
export function deriveStats(
  base: StatSpread,
  opts: { level: number; ivs: StatSpread; evs: StatSpread; nature?: { up?: StageStatKey; down?: StageStatKey } | undefined },
): StatSpread {
  const L = opts.level;
  const inner = (s: StatKey) => 2 * base[s] + opts.ivs[s] + opts.evs[s] / 4;
  const out = {} as StatSpread;
  out.hp = Math.floor((inner("hp") * L) / 100) + L + 10;
  for (const s of ["atk", "def", "spa", "sdf", "spd"] as const) {
    const raw = Math.floor((inner(s) * L) / 100) + 5;
    const mult = opts.nature?.up === s ? 11 : opts.nature?.down === s ? 9 : 10;
    out[s] = Math.floor((raw * mult) / 10);
  }
  return out;
}

function fail(msg: string): never {
  throw new PackLoadError(msg);
}

interface RawContent {
  ruleset: unknown;
  pack: unknown;
  units: unknown;
  moves: unknown;
  /** ruleset.typeChartFile 指向的克制表文档（loadPackFromDir 负责读取注入）。 */
  typeChart?: unknown;
  /** ruleset.naturesFile 指向的性格表文档。 */
  natures?: unknown;
}

/** Pure: compile from already-parsed JSON documents (usable in Worker/browser). */
export function compilePack(raw: RawContent): FrozenPack {
  if (!vRuleset(raw.ruleset)) fail(`ruleset schema: ${ajv.errorsText(vRuleset.errors)}`);
  if (!vPack(raw.pack)) fail(`pack schema: ${ajv.errorsText(vPack.errors)}`);
  if (!vUnits(raw.units)) fail(`units schema: ${ajv.errorsText(vUnits.errors)}`);
  if (!vMoves(raw.moves)) fail(`moves schema: ${ajv.errorsText(vMoves.errors)}`);

  const ruleset = raw.ruleset as {
    rulesetId: string;
    rulesetVersion: string;
    operatorAllowlist: string[];
    features?: string[];
    damageKinds?: string[];
    typeChartFile?: string;
    stabMultiplier?: number;
    statModel?: "six-stat";
    naturesFile?: string;
    modeOverlays?: Record<string, { immuneControl?: boolean; immuneClearStages?: boolean }>;
    statStageRange: [number, number];
    limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number; maxBenchSize?: number };
  };
  const pack = raw.pack as { packId: string; rulesetId: string };
  const units = (raw.units as { units: CompiledUnit[] }).units;
  const moves = (raw.moves as { moves: { id: string; pp: number; priority: number; effects: CompiledEffect[]; type?: string; category?: "physical" | "special" }[] }).moves;

  // 属性克制表：ruleset 声明 typeChartFile → 必须随包注入且通过 schema；
  // 未声明 → 任何 types/type 字段都视为误配置拒绝（静默忽略会埋坑）。
  // canonicalJson 只收安全整数 → 倍率一律存 ×16 定点（赛尔号倍率全是 1/16 的倍数：
  // 4/2.75/2.6875/2.5/1.5/1.375/0.875/0.8125/0.75/0.5/0.25/0.125/0 …），运行时 /16 还原。
  let typeChart: Map<string, Map<string, number>> | undefined;
  const knownTypeKeys = new Set<string>();
  let typeChartInt: Record<string, Record<string, number>> | undefined;
  if (ruleset.typeChartFile !== undefined) {
    if (raw.typeChart === undefined) fail(`ruleset declares typeChartFile "${ruleset.typeChartFile}" but no typeChart document was provided`);
    if (!vTypeChart(raw.typeChart)) fail(`typeChart schema: ${ajv.errorsText(vTypeChart.errors)}`);
    const attack = (raw.typeChart as { attack: Record<string, Record<string, number>> }).attack;
    typeChart = new Map();
    typeChartInt = {};
    for (const [att, row] of Object.entries(attack)) {
      const intRow: Record<string, number> = {};
      const mapRow = new Map<string, number>();
      for (const [def, mult] of Object.entries(row)) {
        const eff16 = mult * 16;
        if (!Number.isSafeInteger(eff16)) fail(`typeChart ${att}→${def} multiplier ${mult} is not a multiple of 1/16`);
        intRow[def] = eff16;
        mapRow.set(def, eff16);
      }
      typeChart.set(att, mapRow);
      typeChartInt[att] = intRow;
      knownTypeKeys.add(att);
      for (const def of Object.keys(row)) knownTypeKeys.add(def);
    }
  } else if (raw.typeChart !== undefined) {
    fail("typeChart document provided but ruleset declares no typeChartFile");
  }

  // six-stat：性格表随规则注入（与 typeChart 同纪律——声明了文件就必须给文档）。
  let natures: Map<string, { up?: StageStatKey; down?: StageStatKey }> | undefined;
  if (ruleset.naturesFile !== undefined) {
    if (raw.natures === undefined) fail(`ruleset declares naturesFile "${ruleset.naturesFile}" but no natures document was provided`);
    if (!vNatures(raw.natures)) fail(`natures schema: ${ajv.errorsText(vNatures.errors)}`);
    natures = new Map(Object.entries((raw.natures as { natures: Record<string, { up?: StageStatKey; down?: StageStatKey }> }).natures));
  } else if (raw.natures !== undefined) {
    fail("natures document provided but ruleset declares no naturesFile");
  }
  // statModel 依赖：公式含 STAB+性格修正 → 必须同时声明克制表和性格表。
  if (ruleset.statModel === "six-stat") {
    if (typeChart === undefined) fail('statModel "six-stat" requires typeChartFile (damage formula includes STAB)');
    if (natures === undefined) fail('statModel "six-stat" requires naturesFile');
  } else {
    if (ruleset.naturesFile !== undefined) fail("naturesFile declared without statModel");
  }

  if (pack.rulesetId !== ruleset.rulesetId) {
    fail(`pack rulesetId "${pack.rulesetId}" != ruleset "${ruleset.rulesetId}"`);
  }

  const features = new Set((ruleset.features ?? []) as FeatureFlag[]);
  if (features.has("bench") && ruleset.limits.maxBenchSize === undefined) fail('feature "bench" requires limits.maxBenchSize');
  if (!features.has("bench") && ruleset.limits.maxBenchSize !== undefined) fail('limits.maxBenchSize requires feature "bench"');
  // op → 所需 feature（v1 ruleset 无 features → 新 op 语义级拒绝）
  const OP_FEATURE: Partial<Record<CompiledEffect["op"], FeatureFlag>> = {
    transfer_stages: "stat_ops",
    clear_stages: "stat_ops",
    control: "control",
    cleanse: "control",
    apply_status: "control",
    apply_effect: "mode_overlay",
  };
  const allow = new Set(ruleset.operatorAllowlist);
  const damageKinds = new Set(ruleset.damageKinds ?? ["standard"]);
  const movesById = new Map<string, CompiledMove>();
  for (const m of moves) {
    if (movesById.has(m.id)) fail(`duplicate move id ${m.id}`);
    for (const fx of m.effects) {
      if (!allow.has(fx.op)) fail(`move ${m.id} uses op "${fx.op}" not in allowlist`);
      const need = OP_FEATURE[fx.op];
      if (need && !features.has(need)) fail(`move ${m.id} op "${fx.op}" requires feature "${need}"`);
      if (fx.op === "damage" && fx.kind !== undefined && fx.kind !== "standard" && !features.has("damage_kinds")) {
        fail(`move ${m.id} damage kind "${fx.kind}" requires feature "damage_kinds"`);
      }
      if (fx.op === "damage" && fx.kind !== undefined && !damageKinds.has(fx.kind)) {
        fail(`move ${m.id} damage kind "${fx.kind}" not in ruleset damageKinds`);
      }
    }
    if (typeChart === undefined) {
      if (m.type !== undefined) fail(`move ${m.id} sets type but ruleset has no type chart`);
    } else {
      if (m.type === undefined) fail(`move ${m.id} lacks type (ruleset has type chart)`);
      else if (!typeChart.has(m.type)) fail(`move ${m.id} type "${m.type}" is not an attack row of the type chart`);
    }
    if (ruleset.statModel === "six-stat") {
      const dealsScaled = m.effects.some((f) => f.op === "damage" && (f.kind === undefined || f.kind === "standard" || f.kind === "true"));
      if (dealsScaled && m.category === undefined) fail(`move ${m.id} has standard/true damage but no category (six-stat)`);
      if (!dealsScaled && m.category !== undefined) fail(`move ${m.id} sets category but deals no scaled damage (six-stat)`);
    } else if (m.category !== undefined) {
      fail(`move ${m.id} sets category but statModel is not "six-stat"`);
    }
    movesById.set(m.id, { id: m.id, pp: m.pp, priority: m.priority, effects: m.effects, ...(m.type !== undefined ? { type: m.type } : {}), ...(m.category !== undefined ? { category: m.category } : {}) });
  }

  const unitsById = new Map<string, CompiledUnit>();
  for (const u of units) {
    if (unitsById.has(u.id)) fail(`duplicate unit id ${u.id}`);
    for (const mid of u.moveIds) {
      if (!movesById.has(mid)) fail(`unit ${u.id} references unknown move ${mid}`);
    }
    if (u.revives !== undefined && u.revives > 0 && !features.has("revive")) {
      fail(`unit ${u.id} sets revives but feature "revive" not enabled`);
    }
    if (u.mode !== undefined && !features.has("mode_overlay")) {
      fail(`unit ${u.id} sets mode but feature "mode_overlay" not enabled`);
    }
    if (u.mode !== undefined && ruleset.modeOverlays !== undefined && !(u.mode in ruleset.modeOverlays)) {
      fail(`unit ${u.id} mode "${u.mode}" has no ruleset overlay entry`);
    }
    if (typeChart === undefined) {
      if (u.types !== undefined) fail(`unit ${u.id} sets types but ruleset has no type chart`);
    } else {
      if (u.types === undefined) fail(`unit ${u.id} lacks types (ruleset has type chart)`);
      else {
        const key = u.types.join("");
        const rkey = [...u.types].reverse().join("");
        if (!knownTypeKeys.has(key) && !knownTypeKeys.has(rkey)) {
          fail(`unit ${u.id} types "${key}" unknown in type chart`);
        }
      }
    }
    const hasSixFields = u.level !== undefined || u.ivs !== undefined || u.evs !== undefined || u.nature !== undefined || u.base.spa !== undefined || u.base.sdf !== undefined;
    if (ruleset.statModel === "six-stat") {
      if (u.base.spa === undefined || u.base.sdf === undefined) fail(`unit ${u.id} lacks spa/sdf base stats (six-stat)`);
      if (u.ivs !== undefined) {
        for (const [s, v] of Object.entries(u.ivs)) if (v > 31) fail(`unit ${u.id} ivs.${s}=${v} exceeds 31`);
      }
      if (u.evs !== undefined) {
        const total = Object.values(u.evs).reduce((a, b) => a + b, 0);
        if (total > 510) fail(`unit ${u.id} evs total ${total} exceeds 510`);
      }
      if (u.nature !== undefined && !natures!.has(u.nature)) fail(`unit ${u.id} nature "${u.nature}" not in natures table`);
    } else if (hasSixFields) {
      fail(`unit ${u.id} sets six-stat fields (level/ivs/evs/nature/spa/sdf) but statModel is not "six-stat"`);
    }
    unitsById.set(u.id, {
      id: u.id, base: u.base, moveIds: u.moveIds,
      ...(u.types !== undefined ? { types: u.types } : {}),
      ...(u.revives !== undefined ? { revives: u.revives } : {}),
      ...(u.mode !== undefined ? { mode: u.mode } : {}),
      ...(ruleset.statModel === "six-stat"
        ? {
            level: u.level ?? 100,
            ivs: u.ivs ?? { hp: 31, atk: 31, def: 31, spa: 31, sdf: 31, spd: 31 },
            evs: u.evs ?? { hp: 0, atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 },
            ...(u.nature !== undefined ? { nature: u.nature } : {}),
          }
        : {}),
    });
  }

  // 克制表是规则数据 → 计入 rulesetHash（换表=换规则版本，钉版对局不受影响）。
  // canonicalJson 不收浮点/非 ASCII 键 → 表体走 sha256(原始 JSON 文本)（文件本身即规范序），
  // ruleset 本体剥掉浮点 stabMultiplier 后走 canonicalJson，stab 以 ×16 定点入 hash。
  const stab = ruleset.stabMultiplier ?? 1.5;
  if (ruleset.typeChartFile !== undefined && !Number.isSafeInteger(stab * 16)) {
    fail(`stabMultiplier ${stab} is not a multiple of 1/16`);
  }
  if (ruleset.typeChartFile === undefined && ruleset.stabMultiplier !== undefined) {
    fail("stabMultiplier declared without typeChartFile");
  }
  const rulesetHash = `sha256:${sha256hex(canonicalJson(typeChartInt === undefined && raw.natures === undefined
    ? raw.ruleset
    : (() => {
        const rest = { ...(raw.ruleset as Record<string, unknown>) };
        delete rest["stabMultiplier"];
        return {
          ruleset: rest,
          ...(ruleset.stabMultiplier !== undefined ? { stabMultiplier16: Math.round(stab * 16) } : {}),
          ...(raw.typeChart !== undefined ? { typeChartSha256: sha256hex(JSON.stringify(raw.typeChart)) } : {}),
          ...(raw.natures !== undefined ? { naturesSha256: sha256hex(JSON.stringify(raw.natures)) } : {}),
        };
      })()))}`;
  const contentHash = `sha256:${sha256hex(canonicalJson({ pack: raw.pack, units: raw.units, moves: raw.moves }))}`;
  const executableHash = ENGINE_EXECUTABLE_HASH;

  const frozen: FrozenPack = {
    rules: {
      rulesetId: ruleset.rulesetId,
      rulesetVersion: ruleset.rulesetVersion,
      rulesetHash,
      contentHash,
      executableHash,
      irVersion: IR_VERSION,
    },
    unitsById,
    movesById,
    ...(typeChart !== undefined ? { typeChart } : {}),
    stabMultiplier: ruleset.stabMultiplier ?? 1.5,
    ...(ruleset.statModel !== undefined ? { statModel: ruleset.statModel } : {}),
    ...(natures !== undefined ? { natures } : {}),
    limits: ruleset.limits,
    stageRange: { min: ruleset.statStageRange[0], max: ruleset.statStageRange[1] },
    operatorAllowlist: ruleset.operatorAllowlist,
    features,
    modeOverlays: new Map(Object.entries(ruleset.modeOverlays ?? {})),
  };
  Object.freeze(frozen.rules);
  Object.freeze(frozen.limits);
  Object.freeze(frozen.stageRange);
  Object.freeze(frozen.operatorAllowlist);
  return Object.freeze(frozen);
}

/** Convenience node loader for Host/tests (fs — not used inside transitions). */
export function loadPackFromDir(contentRoot: string, packId: string): FrozenPack {
  const read = (p: string): unknown => JSON.parse(readFileSync(join(contentRoot, p), "utf8"));
  const pack = read(join(packId, "pack.json")) as {
    rulesetId: string;
    files?: { units?: string; moves?: string };
  };
  const ruleset = read(join("rulesets", `${pack.rulesetId}.json`)) as { typeChartFile?: string; naturesFile?: string };
  return compilePack({
    ruleset,
    pack,
    units: read(join(packId, pack.files?.units ?? "units.json")),
    moves: read(join(packId, pack.files?.moves ?? "moves.json")),
    ...(ruleset.typeChartFile !== undefined ? { typeChart: read(join("rulesets", ruleset.typeChartFile)) } : {}),
    ...(ruleset.naturesFile !== undefined ? { natures: read(join("rulesets", ruleset.naturesFile)) } : {}),
  });
}
