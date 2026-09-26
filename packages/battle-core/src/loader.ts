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

export const ENGINE_VERSION = "0.1.0";
export const IR_VERSION = 1;

export class PackLoadError extends Error {
  readonly code = "PACK_LOAD_ERROR";
}

export interface CompiledMove {
  id: string;
  pp: number;
  priority: number;
  effects: CompiledEffect[];
}

export type CompiledEffect =
  | { op: "damage"; power: number }
  | { op: "apply_stat_stage"; stat: "atk" | "def" | "spd"; delta: number; target: "self" }
  | { op: "heal"; numerator: number; denominator: number; target: "self" };

export interface CompiledUnit {
  id: string;
  base: { hp: number; atk: number; def: number; spd: number };
  moveIds: string[];
}

export interface FrozenPack {
  rules: BattleState["rules"];
  unitsById: ReadonlyMap<string, CompiledUnit>;
  movesById: ReadonlyMap<string, CompiledMove>;
  limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number };
  stageRange: { min: number; max: number };
  operatorAllowlist: readonly string[];
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vRuleset = ajv.compile(rulesetSchemaJson);
const vPack = ajv.compile(packSchemaJson);
const vUnits = ajv.compile(unitsSchemaJson);
const vMoves = ajv.compile(movesSchemaJson);

function fail(msg: string): never {
  throw new PackLoadError(msg);
}

interface RawContent {
  ruleset: unknown;
  pack: unknown;
  units: unknown;
  moves: unknown;
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
    statStageRange: [number, number];
    limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number };
  };
  const pack = raw.pack as { packId: string; rulesetId: string };
  const units = (raw.units as { units: CompiledUnit[] }).units;
  const moves = (raw.moves as { moves: { id: string; pp: number; priority: number; effects: CompiledEffect[] }[] }).moves;

  if (pack.rulesetId !== ruleset.rulesetId) {
    fail(`pack rulesetId "${pack.rulesetId}" != ruleset "${ruleset.rulesetId}"`);
  }

  const allow = new Set(ruleset.operatorAllowlist);
  const movesById = new Map<string, CompiledMove>();
  for (const m of moves) {
    if (movesById.has(m.id)) fail(`duplicate move id ${m.id}`);
    for (const fx of m.effects) {
      if (!allow.has(fx.op)) fail(`move ${m.id} uses op "${fx.op}" not in allowlist`);
    }
    movesById.set(m.id, { id: m.id, pp: m.pp, priority: m.priority, effects: m.effects });
  }

  const unitsById = new Map<string, CompiledUnit>();
  for (const u of units) {
    if (unitsById.has(u.id)) fail(`duplicate unit id ${u.id}`);
    for (const mid of u.moveIds) {
      if (!movesById.has(mid)) fail(`unit ${u.id} references unknown move ${mid}`);
    }
    unitsById.set(u.id, { id: u.id, base: u.base, moveIds: u.moveIds });
  }

  const rulesetHash = `sha256:${sha256hex(canonicalJson(raw.ruleset))}`;
  const contentHash = `sha256:${sha256hex(canonicalJson({ pack: raw.pack, units: raw.units, moves: raw.moves }))}`;
  const executableHash = `sha256:${sha256hex(canonicalJson({ engine: "@seer/battle-core", engineVersion: ENGINE_VERSION, irVersion: IR_VERSION }))}`;

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
    limits: ruleset.limits,
    stageRange: { min: ruleset.statStageRange[0], max: ruleset.statStageRange[1] },
    operatorAllowlist: ruleset.operatorAllowlist,
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
  return compilePack({
    ruleset: read(join("rulesets", `${pack.rulesetId}.json`)),
    pack,
    units: read(join(packId, pack.files?.units ?? "units.json")),
    moves: read(join(packId, pack.files?.moves ?? "moves.json")),
  });
}
