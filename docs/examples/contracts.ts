/** Design example, not a battle engine. IDs/integers/hashes require runtime validation. */
export type Side = "p1" | "p2";
export type Hash = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface RulesRef {
  rulesetId: string;
  rulesetHash: Hash;
  contentHash: Hash;
  executableHash: Hash;
  irVersion: 1;
}
export type Action =
  | { kind: "move"; moveSlot: number; target: "self" | "opponent" }
  | { kind: "switch"; unitId: string }
  | { kind: "struggle" }
  | { kind: "concede" };
export interface LegalAction { actionId: string; action: Action; label: string }
export interface Decision {
  id: string;
  kind: "turn" | "replacement";
  baseRevision: number;
  actors: Side[];
}
export interface UnitState {
  id: string;
  side: Side;
  speciesId: string;
  hp: number;
  maxHp: number;
  speed: number;
  attack: number;
  defense: number;
  stages: Record<"attack" | "defense" | "speed", number>;
  moves: { moveId: string; pp: number }[];
  effects: { instanceId: string; definitionId: string; remaining: number }[];
}
/** Internal only: do not export from the future public contracts entrypoint. */
export interface BattleState {
  schemaVersion: 1;
  battleId: string;
  rules: RulesRef;
  revision: number;
  turn: number;
  phase: "decision" | "resolving" | "terminal" | "fault";
  decision: Decision | null;
  active: Record<Side, string>;
  units: UnitState[];
  rng: { algorithmId: string; words: number[]; draws: number };
  internalEventSeq: number;
  outcome: "p1" | "p2" | "draw" | null;
}
export type OwnUnit = Pick<UnitState, "id" | "speciesId" | "hp" | "maxHp" | "moves" | "effects" | "stages" | "speed" | "attack" | "defense">;
export interface VisibleOpponent {
  id: string;
  speciesId: string | null;
  hp: { kind: "exact"; current: number; max: number }
    | { kind: "bucket"; value: number; buckets: number } | { kind: "unknown" };
  revealedMoves: string[];
  visibleStatuses: string[];
}
export interface Observation {
  schemaVersion: 1;
  battleId: string;
  perspective: Side;
  rules: RulesRef;
  revision: number;
  viewCursor: number;
  turn: number;
  decision: Decision | null;
  remainingBudgetMs: number | null; // transport metadata, excluded from observation hash
  own: OwnUnit[];
  opponent: VisibleOpponent[];
  legalActions: LegalAction[];
  outcome: "p1" | "p2" | "draw" | null;
}
/** Identity/side comes from authenticated transport, never from this payload. */
export interface Command {
  schemaVersion: 1;
  battleId: string;
  decisionId: string;
  baseRevision: number;
  idempotencyKey: string;
  actionId: string;
}
/** Internal inputs are admitted and recorded by Authority, not accepted over public API. */
export interface ResolvedInput {
  decisionId: string;
  baseRevision: number;
  actions: { side: Side; action: Action; origin: "player" | "timeout" }[];
  timeoutPolicyVersion: string | null;
}
export type EffectOp =
  | { op: "damage"; targetId: string; amount: number; damageKind: "normal" | "fixed" | "percent" | "special" }
  | { op: "heal"; targetId: string; amount: number }
  | { op: "modify_stage"; targetId: string; stat: "attack" | "defense" | "speed"; delta: number };
export type Condition =
  | { op: "always" }
  | { op: "hp_below_bp"; subject: "self" | "opponent"; basisPoints: number };
export interface EffectDefinition {
  id: string;
  version: number;
  trigger: "entry" | "before_action" | "after_action" | "turn_end";
  condition: Condition;
  operations: EffectOp[];
  priority: number;
  stack: "replace" | "add" | "reject";
  lifetime: { kind: "turns"; count: number } | { kind: "battle" };
  evidence: { status: "SYNTHETIC" | "VERIFIED"; claimIds: string[] };
}
export interface InternalEvent {
  seq: number;
  phase: string;
  causeId: string | null;
  effectId: string | null;
  op: EffectOp;
  rngDrawRefs: number[];
}
/** A separately authored union, NOT Omit<InternalEvent, ...>. */
export type BattleEvent =
  | { schemaVersion: 1; cursor: number; kind: "hp_changed"; unitId: string; hp: VisibleOpponent["hp"] }
  | { schemaVersion: 1; cursor: number; kind: "move_revealed"; unitId: string; moveId: string }
  | { schemaVersion: 1; cursor: number; kind: "decision_opened"; decisionId: string; revision: number }
  | { schemaVersion: 1; cursor: number; kind: "ended"; outcome: "p1" | "p2" | "draw" }
  | { schemaVersion: 1; cursor: number; kind: "suspended"; code: "ENGINE_FAULT" };
export type ErrorCode =
  | "INVALID_SCHEMA" | "UNAUTHORIZED" | "NOT_FOUND" | "STALE_DECISION"
  | "ILLEGAL_ACTION" | "ALREADY_SUBMITTED" | "IDEMPOTENCY_CONFLICT"
  | "DEADLINE_EXCEEDED" | "BUDGET_EXCEEDED" | "RULESET_MISMATCH"
  | "UNSUPPORTED_OPERATOR" | "ARTIFACT_UNAVAILABLE" | "PLUGIN_IN_USE"
  | "ENGINE_FAULT" | "PROVIDER_UNAVAILABLE";
export type Result<T> = { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; retryable: boolean; requestId: string } };
export interface Receipt { receiptId: string; decisionId: string; status: "accepted" }
export interface TransitionResult { state: BattleState; events: InternalEvent[] }
export interface FrozenRules {
  ref: RulesRef;
  effects: EffectDefinition[];
  phaseOrder: string[];
  maxApplications: number;
  maxCauseDepth: number;
  integerPolicyVersion: string;
}
export type Transition = (
  state: DeepReadonly<BattleState>, input: DeepReadonly<ResolvedInput>,
  frozenRules: DeepReadonly<FrozenRules>
) => Result<TransitionResult>;

export type Capability = "battle.observe" | "battle.submit" | "battle.simulate"
  | "content.register" | "ui.register" | "storage.namespace" | "model.request";
export interface PluginManifest {
  id: string;
  version: string;
  apiRange: string;
  kind: "content" | "mechanic" | "service" | "presentation" | "agent" | "adapter";
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  requestedCapabilities: Capability[];
  entrypoints: Partial<Record<"host" | "client" | "agent", string>>;
  artifactHash: Hash;
}
export interface Disposable { dispose(): Promise<void> }
export interface ServiceMap {
  observation: { get(battleId: string): Promise<Result<Observation>> };
  actions: { submit(command: Command): Promise<Result<Receipt>> };
}
/** Seer-facing API example, NOT a Cordis native API signature. */
export interface PluginContext {
  readonly signal: AbortSignal;
  require<K extends keyof ServiceMap>(key: K): ServiceMap[K];
  register<K extends keyof ServiceMap>(key: K, value: ServiceMap[K]): Disposable;
  own(disposable: Disposable): void;
}
export interface Hypothesis {
  id: string;
  weight: number;
  opponent: { speciesId: string; moveIds: string[]; assumedStats: Record<string, number> }[];
  notes: string[];
}
export interface SimRequest {
  observation: Observation;
  hypotheses: Hypothesis[];
  candidateActionIds: string[];
  simulationSeed: number;
  budget: { maxTransitions: number; maxDepth: number; maxTimeMs: number };
}
export interface SimResult {
  rules: RulesRef;
  assumptionIds: string[];
  transitionsUsed: number;
  truncated: boolean;
  candidates: { actionId: string; samples: number; meanValue: number; worstValue: number }[];
}
export interface ToolMap {
  observe: { input: { battleId: string }; output: Observation };
  simulate_batch: { input: SimRequest; output: SimResult };
  submit_action: { input: Command; output: Receipt };
}
export interface AgentTools {
  call<K extends keyof ToolMap>(name: K, input: ToolMap[K]["input"], signal: AbortSignal):
    Promise<Result<ToolMap[K]["output"]>>;
}
export interface ModelProvider {
  generate(input: {
    model: string; context: Json; maxOutputTokens: number;
  }, signal: AbortSignal): Promise<Result<{
    candidateActionIds: string[]; evidenceIds: string[];
    usage: { inputTokens: number; outputTokens: number; estimated: boolean };
  }>>;
}

/** Fully runnable wire-schema example. Other schemas are M0 work, not implied implemented. */
export const commandSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "urn:seer:command:1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "battleId", "decisionId", "baseRevision", "idempotencyKey", "actionId"],
  properties: {
    schemaVersion: { const: 1 },
    battleId: { type: "string", pattern: "^[a-zA-Z0-9_.:-]{1,96}$" },
    decisionId: { type: "string", pattern: "^[a-zA-Z0-9_.:-]{1,96}$" },
    baseRevision: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    idempotencyKey: { type: "string", pattern: "^[a-zA-Z0-9_-]{16,96}$" },
    actionId: { type: "string", pattern: "^[a-zA-Z0-9_.:-]{1,96}$" }
  }
} as const;
export const sampleCommand = {
  schemaVersion: 1, battleId: "demo:1", decisionId: "turn:1",
  baseRevision: 0, idempotencyKey: "demo_request_0001", actionId: "p1:move:0"
} satisfies Command;
