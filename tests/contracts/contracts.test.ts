/**
 * test:contracts — M0-02 契约正反样例。
 * 覆盖：合法样本通过；缺字段/未知字段/越界/伪 actor/伪造内部字段拒绝。
 */
import { describe, expect, it } from "vitest";
import type { ValidateFunction } from "ajv";
import { validators } from "@seer/contracts";
import { internalValidators } from "@seer/contracts/internal";

const H = `sha256:${"a".repeat(64)}`;

const CMD = {
  schemaVersion: 1,
  battleId: "btl_test-1",
  decisionId: "dec_1",
  baseRevision: 0,
  idempotencyKey: "key-12345678",
  actionId: "act_syn-strike",
};

const OBSERVATION = {
  schemaVersion: 1,
  battleId: "btl_test-1",
  side: "p1",
  viewCursor: 3,
  revision: 4,
  turn: 1,
  rules: {
    rulesetId: "synthetic-v1",
    rulesetHash: H,
    contentHash: H,
    executableHash: H,
    irVersion: 1,
  },
  own: {
    unitId: "unit_p1",
    speciesId: "syn-alpha",
    hp: { current: 120, max: 120 },
    ppByMoveId: { "syn-strike": 35 },
    stages: { atk: 0, def: 0, spd: 0 },
    effects: [],
  },
  opponent: {
    unitId: "unit_p2",
    speciesId: "syn-beta",
    hp: { current: 140, max: 140 },
    revealedMoveIds: ["syn-strike"],
    ppEstimate: { kind: "unknown" },
    stages: { atk: 0, def: 0, spd: 0 },
    effects: [],
  },
  decision: {
    decisionId: "dec_1",
    kind: "turn",
    baseRevision: 0,
    actors: ["p1", "p2"],
    deadlineMs: 10000,
  },
  legalActions: [
    {
      actionId: "act_syn-strike",
      action: { kind: "move", moveSlot: 0, target: "opponent" },
      label: "syn-strike",
    },
  ],
};

const MANIFEST = {
  manifestVersion: 1,
  pluginId: "mech-stat-stages",
  version: "1.0.0",
  name: "Stat stages mechanic",
  kind: "mechanic",
  requestedCapabilities: ["battle.read"],
  entrypoints: { module: "mechanics/stat-stages/index.js" },
};

const EFFECT = {
  schemaVersion: 1,
  effectId: "fx-bolster",
  trigger: "manual",
  condition: {
    kind: "cmp",
    path: "self.atkStage",
    op: "lt",
    value: 6,
  },
  effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }],
  duration: { kind: "instant" },
  stackPolicy: "replace",
};

const TOOL_SIM = {
  tool: "simulate_batch",
  battleId: "btl_test-1",
  hypotheses: [{ opponentMoveIds: ["syn-strike"], oppStages: { def: 0 } }],
  candidates: ["act_syn-strike"],
  seed: 42,
  budget: { maxTransitions: 256 },
};

const API_ERROR = { code: "STALE_DECISION", retryable: false, requestId: "req_abc123" };

interface C {
  name: string;
  v: ValidateFunction;
  data: unknown;
  ok: boolean;
}

const c = (name: string, v: ValidateFunction, data: unknown, ok: boolean): C => ({ name, v, data, ok });
const drop = (obj: object, key: string): Record<string, unknown> => {
  const copy = { ...(obj as Record<string, unknown>) };
  delete copy[key];
  return copy;
};

const cases: C[] = [
  // Command — 10
  c("command valid", validators.command, CMD, true),
  c("command missing schemaVersion", validators.command, drop(CMD, "schemaVersion"), false),
  c("command missing baseRevision", validators.command, drop(CMD, "baseRevision"), false),
  c("command missing actionId", validators.command, drop(CMD, "actionId"), false),
  c("command unknown extra field", validators.command, { ...CMD, extra: 1 }, false),
  c("command fake actorId injection", validators.command, { ...CMD, actorId: "p1" }, false),
  c("command fake side injection", validators.command, { ...CMD, side: "p1" }, false),
  c("command schemaVersion mismatch", validators.command, { ...CMD, schemaVersion: 2 }, false),
  c("command negative baseRevision", validators.command, { ...CMD, baseRevision: -1 }, false),
  c("command non-integer baseRevision", validators.command, { ...CMD, baseRevision: 1.5 }, false),
  c("command bad id pattern", validators.command, { ...CMD, battleId: "BTL_Upper" }, false),
  c("command short idempotencyKey", validators.command, { ...CMD, idempotencyKey: "k" }, false),

  // Observation — 6
  c("observation valid", validators.observation, OBSERVATION, true),
  c("observation missing rules", validators.observation, drop(OBSERVATION, "rules"), false),
  c(
    "observation ppEstimate exact without value",
    validators.observation,
    { ...OBSERVATION, opponent: { ...OBSERVATION.opponent, ppEstimate: { kind: "exact" } } },
    false,
  ),
  c(
    "observation leak: opponent pp field present",
    validators.observation,
    { ...OBSERVATION, opponent: { ...OBSERVATION.opponent, ppByMoveId: { "syn-strike": 3 } } },
    false,
  ),
  c(
    "observation leak: internal hash field",
    validators.observation,
    { ...OBSERVATION, stateHash: H },
    false,
  ),
  c(
    "observation decision null allowed",
    validators.observation,
    { ...OBSERVATION, decision: null },
    true,
  ),

  // Event — 6
  c("event turn-begin", validators.event, { type: "turn-begin", turn: 1, decisionId: "dec_1" }, true),
  c(
    "event damage",
    validators.event,
    { type: "damage", side: "p2", amount: 22, hpAfter: { current: 118, max: 140 } },
    true,
  ),
  c(
    "event battle-end",
    validators.event,
    { type: "battle-end", result: "p1", reason: "ko" },
    true,
  ),
  c(
    "event leak: causeId on public damage",
    validators.event,
    { type: "damage", side: "p2", amount: 22, hpAfter: { current: 118, max: 140 }, causeId: "ev_9" },
    false,
  ),
  c("event internal-only type rng-draw", validators.event, { type: "rng-draw", value: 1 }, false),
  c(
    "event bad end reason",
    validators.event,
    { type: "battle-end", result: "p1", reason: "cheat" },
    false,
  ),

  // Manifest — 5
  c("manifest valid", validators.manifest, MANIFEST, true),
  c(
    "manifest path traversal entrypoint",
    validators.manifest,
    { ...MANIFEST, entrypoints: { module: "../escape.js" } },
    false,
  ),
  c(
    "manifest unknown capability",
    validators.manifest,
    { ...MANIFEST, requestedCapabilities: ["admin"] },
    false,
  ),
  c(
    "manifest unknown kind",
    validators.manifest,
    { ...MANIFEST, kind: "executable" },
    false,
  ),
  c("manifest bad semver", validators.manifest, { ...MANIFEST, version: "1.0" }, false),

  // Effect — 5
  c("effect valid w/ condition", validators.effect, EFFECT, true),
  c(
    "effect unknown operator",
    validators.effect,
    { ...EFFECT, effects: [{ op: "drain_soul", power: 5 }] },
    false,
  ),
  c(
    "effect heal missing numerator",
    validators.effect,
    { ...EFFECT, effects: [{ op: "heal", denominator: 2, target: "self" }] },
    false,
  ),
  c(
    "effect delta zero rejected",
    validators.effect,
    { ...EFFECT, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 0, target: "self" }] },
    false,
  ),
  c(
    "effect bad condition path",
    validators.effect,
    { ...EFFECT, condition: { kind: "cmp", path: "unit_p1.hp", op: "lt", value: 1 } },
    false,
  ),

  // Tool — 7
  c("tool simulate_batch valid", validators.tool, TOOL_SIM, true),
  c("tool observe valid", validators.tool, { tool: "observe", battleId: "btl_test-1" }, true),
  c(
    "tool submit_action valid",
    validators.tool,
    { tool: "submit_action", ...CMD },
    true,
  ),
  c(
    "tool simulate budget over 2048",
    validators.tool,
    { ...TOOL_SIM, budget: { maxTransitions: 99999 } },
    false,
  ),
  c(
    "tool simulate snapshotId smuggling",
    validators.tool,
    { ...TOOL_SIM, snapshotId: "snap_1" },
    false,
  ),
  c("tool unknown tool name", validators.tool, { tool: "admin_dump", battleId: "btl_test-1" }, false),
  c(
    "tool submit_action missing actionId",
    validators.tool,
    { tool: "submit_action", ...drop(CMD, "actionId") },
    false,
  ),

  // ApiError — 3
  c("apiError valid", validators.error, API_ERROR, true),
  c("apiError unknown code", validators.error, { ...API_ERROR, code: "PANIC" }, false),
  c("apiError missing retryable", validators.error, drop(API_ERROR, "retryable"), false),
];

describe("wire contract schemas", () => {
  it.each(cases)("$name → $ok", ({ v, data, ok }) => {
    expect(v(data), JSON.stringify(v.errors)).toBe(ok);
  });

  it("internal state/event/input validators exist and are distinct entries", () => {
    expect(typeof internalValidators.state).toBe("function");
    expect(typeof internalValidators.internalEvent).toBe("function");
    expect(typeof internalValidators.resolvedInput).toBe("function");
  });
});
