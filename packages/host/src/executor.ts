import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ENGINE_EXECUTABLE_HASH,
  EngineFault,
  applyReplacement,
  applyTurn,
  initBattle,
  legalActions,
  type CoreAction,
  type CoreResult,
  type CoreState,
  type FrozenPack,
  type SideId,
} from "@seer/battle-core";
import { internalValidators } from "@seer/contracts/internal";

export type BattleInitOptions = Parameters<typeof initBattle>[1];
export type ResolvedActions = { p1: CoreAction | null; p2: CoreAction | null };

export interface TransitionExecutor {
  readonly executableHash: string;
  init(pack: FrozenPack, options: BattleInitOptions): CoreState;
  legalActions(pack: FrozenPack, state: CoreState, side: SideId): string[];
  applyTurn(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult;
  applyReplacement(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult;
}

export class ExecutorError extends Error {
  readonly code = "EXECUTOR_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ExecutorError";
  }
}

const CORE_KEYS = new Set(["schemaVersion", "battleId", "rules", "revision", "turn", "phase", "rng", "sides", "suspension", "speedTiebreak", "terminal"]);
const CORE_PHASES = new Set(["init", "collect", "checkpoint", "end"]);
const EVENT_TYPES = new Set([
  "turn-begin", "action-declared", "pp-spent", "damage", "heal", "stat-stage", "effect-applied", "effect-faded",
  "control-immune", "stages-transferred", "stages-cleared", "switch", "revive", "action-failed", "struggle-used",
  "rng-draw", "ko", "battle-end",
]);

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const rulesMatch = (actual: CoreState["rules"], expected: FrozenPack["rules"]): boolean =>
  actual.rulesetId === expected.rulesetId
  && actual.rulesetVersion === expected.rulesetVersion
  && actual.rulesetHash === expected.rulesetHash
  && actual.contentHash === expected.contentHash
  && actual.executableHash === expected.executableHash
  && actual.irVersion === expected.irVersion;

export function assertExecutorBinding(executor: TransitionExecutor, pack: FrozenPack): void {
  if (executor.executableHash !== pack.rules.executableHash) {
    throw new ExecutorError(`executor ${executor.executableHash} cannot run ${pack.rules.executableHash}`);
  }
}

export function assertCoreState(value: unknown, pack: FrozenPack, battleId: string): asserts value is CoreState {
  const state = recordOf(value);
  if (!state || Object.keys(state).some((key) => !CORE_KEYS.has(key))) {
    throw new ExecutorError("executor state is malformed");
  }
  const candidate = {
    ...state,
    decision: null,
    inbox: { p1: null, p2: null },
    eventSeq: 0,
    publicCursors: { p1: 0, p2: 0 },
  };
  if (!internalValidators.state(candidate) || !CORE_PHASES.has(String(state.phase))) {
    const first = internalValidators.state.errors?.[0];
    throw new ExecutorError(`executor state is malformed${first ? `: ${first.instancePath || "/"} ${first.message}` : ""}`);
  }
  const core = value as CoreState;
  if (core.battleId !== battleId) throw new ExecutorError(`executor state battleId ${core.battleId} does not match ${battleId}`);
  if (!rulesMatch(core.rules, pack.rules)) throw new ExecutorError("executor state artifact mismatch");
}

export function assertLegalActionIds(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value)
    || value.some((item) => typeof item !== "string" || !/^act_[a-z0-9-]{1,60}$/.test(item))
    || new Set(value).size !== value.length
  ) {
    throw new ExecutorError("executor legal response is malformed");
  }
}

export function assertTransitionResult(
  value: unknown,
  pack: FrozenPack,
  previous: CoreState,
): asserts value is CoreResult {
  const result = recordOf(value);
  if (!result || typeof result.ok !== "boolean") throw new ExecutorError("executor transition response is malformed");
  if (result.ok === false) {
    const fault = recordOf(result.fault);
    if (!fault || typeof fault.reason !== "string" || typeof fault.message !== "string") {
      throw new ExecutorError("executor transition fault is malformed");
    }
    return;
  }
  assertCoreState(result.state, pack, previous.battleId);
  const state = result.state as CoreState;
  if (state.revision !== previous.revision + 1) throw new ExecutorError("executor transition revision is malformed");
  if (!Array.isArray(result.events)) throw new ExecutorError("executor transition events are malformed");
  for (const value of result.events) {
    const event = recordOf(value);
    const draw = event ? recordOf(event.rngDraw) : null;
    if (
      !event
      || !EVENT_TYPES.has(String(event.type))
      || !recordOf(event.detail)
      || (event.rngDraw !== undefined && (!draw || typeof draw.purpose !== "string" || !Number.isInteger(draw.value)))
    ) {
      throw new ExecutorError("executor transition event is malformed");
    }
  }
}

export class InProcessTransitionExecutor implements TransitionExecutor {
  readonly executableHash: string;

  constructor(executableHash: string) {
    if (executableHash !== ENGINE_EXECUTABLE_HASH) {
      throw new ExecutorError(`executable ${executableHash} requires an isolated runtime`);
    }
    this.executableHash = executableHash;
  }

  init(pack: FrozenPack, options: BattleInitOptions): CoreState {
    this.assertPack(pack);
    const state = initBattle(pack, options);
    assertCoreState(state, pack, options.battleId);
    return state;
  }

  legalActions(pack: FrozenPack, state: CoreState, side: SideId): string[] {
    this.assertPack(pack);
    const actions = legalActions(state, side);
    assertLegalActionIds(actions);
    return actions;
  }

  applyTurn(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult {
    this.assertPack(pack);
    const result = applyTurn(pack, state, actions);
    assertTransitionResult(result, pack, state);
    return result;
  }

  applyReplacement(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult {
    this.assertPack(pack);
    const result = applyReplacement(pack, state, actions);
    assertTransitionResult(result, pack, state);
    return result;
  }

  private assertPack(pack: FrozenPack): void {
    if (pack.rules.executableHash !== this.executableHash) {
      throw new ExecutorError(`executor ${this.executableHash} cannot run ${pack.rules.executableHash}`);
    }
  }
}

export type ProcessExecutionRequest =
  | { kind: "init"; executableHash: string; rules: FrozenPack["rules"]; payload: unknown; options: BattleInitOptions }
  | { kind: "legal"; executableHash: string; rules: FrozenPack["rules"]; payload: unknown; state: CoreState; side: SideId }
  | { kind: "turn" | "replacement"; executableHash: string; rules: FrozenPack["rules"]; payload: unknown; state: CoreState; actions: ResolvedActions };

interface ProcessEnvelope {
  ok: boolean;
  pid?: number;
  executableHash?: string;
  rulesetHash?: string;
  contentHash?: string;
  value?: unknown;
  error?: string;
}

export interface ProcessExecutorConfig {
  executableHash: string;
  entrypoint: string;
  payload: unknown;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const RUNNER = fileURLToPath(new URL("./process-runner.ts", import.meta.url));

export class ProcessTransitionExecutor implements TransitionExecutor {
  readonly executableHash: string;
  readonly entrypoint: string;
  readonly payload: unknown;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  lastPid: number | null = null;

  constructor(config: ProcessExecutorConfig) {
    this.executableHash = config.executableHash;
    this.entrypoint = config.entrypoint;
    this.payload = config.payload;
    this.timeoutMs = config.timeoutMs ?? 5_000;
    this.maxOutputBytes = config.maxOutputBytes ?? 4 * 1024 * 1024;
  }

  init(pack: FrozenPack, options: BattleInitOptions): CoreState {
    const value = this.call(pack, { kind: "init", executableHash: this.executableHash, rules: pack.rules, payload: this.payload, options });
    assertCoreState(value, pack, options.battleId);
    const state = value as CoreState;
    if (state.revision !== 0 || state.turn !== 1) throw new ExecutorError("isolated init state is malformed");
    return state;
  }

  legalActions(pack: FrozenPack, state: CoreState, side: SideId): string[] {
    const value = this.call(pack, { kind: "legal", executableHash: this.executableHash, rules: pack.rules, payload: this.payload, state, side });
    assertLegalActionIds(value);
    return value;
  }

  applyTurn(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult {
    return this.transition(pack, { kind: "turn", executableHash: this.executableHash, rules: pack.rules, payload: this.payload, state, actions });
  }

  applyReplacement(pack: FrozenPack, state: CoreState, actions: ResolvedActions): CoreResult {
    return this.transition(pack, { kind: "replacement", executableHash: this.executableHash, rules: pack.rules, payload: this.payload, state, actions });
  }

  private transition(pack: FrozenPack, request: ProcessExecutionRequest): CoreResult {
    if (request.kind !== "turn" && request.kind !== "replacement") {
      throw new ExecutorError("isolated transition request is malformed");
    }
    const value = this.call(pack, request);
    assertTransitionResult(value, pack, request.state);
    if (value.ok) return value;
    return { ok: false, fault: new EngineFault(value.fault.reason, value.fault.message) };
  }

  private call(pack: FrozenPack, request: ProcessExecutionRequest): unknown {
    if (pack.rules.executableHash !== this.executableHash) {
      throw new ExecutorError(`executor ${this.executableHash} cannot run ${pack.rules.executableHash}`);
    }
    const result = spawnSync(process.execPath, [RUNNER, this.entrypoint], {
      input: JSON.stringify(request),
      encoding: "utf8",
      timeout: this.timeoutMs,
      maxBuffer: this.maxOutputBytes,
      windowsHide: true,
    });
    if (result.error) throw new ExecutorError(`isolated process failed: ${result.error.message}`);
    if (result.status !== 0) throw new ExecutorError(`isolated process exited ${result.status}: ${result.stderr.trim()}`);
    let envelope: ProcessEnvelope;
    try {
      envelope = JSON.parse(result.stdout) as ProcessEnvelope;
    } catch {
      throw new ExecutorError("isolated process returned invalid JSON");
    }
    if (!envelope.ok) throw new ExecutorError(envelope.error ?? "isolated process failed");
    if (!Number.isInteger(envelope.pid)) throw new ExecutorError("isolated process omitted pid");
    if (
      envelope.executableHash !== request.executableHash
      || envelope.rulesetHash !== request.rules.rulesetHash
      || envelope.contentHash !== request.rules.contentHash
    ) {
      throw new ExecutorError("isolated process artifact identity mismatch");
    }
    this.lastPid = envelope.pid!;
    return envelope.value;
  }
}
