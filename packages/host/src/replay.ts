/**
 * headless replay：从 init 快照 + 已提交 resolved_inputs 重放，
 * 逐 transition 比对 core 口径 state_hash。工件不匹配/篡改/缺失 → 明确失败码。
 */
import type { CoreState, FrozenPack } from "@seer/battle-core";
import { canonicalJson } from "@seer/contracts";
import { sha256hex } from "@seer/battle-core";
import { internalValidators, type BattleState } from "@seer/contracts/internal";
import type { BattleStore } from "./store.ts";
import { generationIdFromRules, generationIdOf } from "./generations.ts";
import {
  InProcessTransitionExecutor,
  assertCoreState,
  assertExecutorBinding,
  assertTransitionResult,
  type TransitionExecutor,
} from "./executor.ts";

export type ReplayOutcome =
  | { ok: true; turns: number; finalHash: string }
  | { ok: false; code: "ARTIFACT_UNAVAILABLE" | "REPLAY_MISMATCH" | "MALFORMED_RECORD"; detail: string };

function parseCore(json: string): CoreState {
  const s = JSON.parse(json) as CoreState;
  if (s.schemaVersion !== 1 || typeof s.battleId !== "string" || !s.rules || !s.rng || !s.sides) {
    throw new Error("malformed init snapshot");
  }
  return s;
}

export function replayBattle(
  store: BattleStore,
  pack: FrozenPack,
  battleId: string,
  executor?: TransitionExecutor,
): ReplayOutcome {
  let runner: TransitionExecutor;
  try {
    runner = executor ?? new InProcessTransitionExecutor(pack.rules.executableHash);
    assertExecutorBinding(runner, pack);
  } catch (error) {
    return { ok: false, code: "ARTIFACT_UNAVAILABLE", detail: (error as Error).message };
  }
  const row = store.loadBattle(battleId);
  if (!row) return { ok: false, code: "ARTIFACT_UNAVAILABLE", detail: `battle ${battleId} missing` };

  let state: CoreState;
  try {
    state = parseCore(row.initJson);
  } catch (e) {
    return { ok: false, code: "MALFORMED_RECORD", detail: `init snapshot: ${(e as Error).message}` };
  }

  // 工件一致性：持久化三类 hash 必须与当前 pack 一致（旧/篡改工件显式失败）
  let persistedState: BattleState;
  try {
    const parsed = JSON.parse(row.stateJson) as unknown;
    if (!internalValidators.state(parsed)) {
      const first = internalValidators.state.errors?.[0];
      throw new Error(`${first?.instancePath || "/"} ${first?.message ?? "is invalid"}`);
    }
    persistedState = parsed;
  } catch (error) {
    return { ok: false, code: "MALFORMED_RECORD", detail: `state snapshot: ${(error as Error).message}` };
  }
  const persistedRules = persistedState.rules;
  if (
    generationIdFromRules(state.rules) !== generationIdOf(pack)
    || generationIdFromRules(persistedRules) !== generationIdOf(pack)
    || state.rules.rulesetId !== pack.rules.rulesetId
    || state.rules.rulesetVersion !== pack.rules.rulesetVersion
    || state.rules.irVersion !== pack.rules.irVersion
    || persistedRules.rulesetId !== pack.rules.rulesetId
    || persistedRules.rulesetVersion !== pack.rules.rulesetVersion
    || persistedRules.irVersion !== pack.rules.irVersion
  ) {
    return {
      ok: false,
      code: "ARTIFACT_UNAVAILABLE",
      detail: `artifact mismatch: stored ${generationIdFromRules(persistedRules)} vs pack ${generationIdOf(pack)}`,
    };
  }
  try {
    assertCoreState(state, pack, battleId);
    if (persistedState.battleId !== battleId || persistedState.rng.seedHex !== state.rng.seedHex) {
      throw new Error("snapshot identity mismatch");
    }
  } catch (error) {
    return { ok: false, code: "MALFORMED_RECORD", detail: `snapshot identity: ${(error as Error).message}` };
  }

  const inputs = store.loadResolvedInputs(battleId);
  for (const { resolved, stateHash } of inputs) {
    // 挂起态 → replacement transition；否则常规回合 transition
    let r;
    try {
      r = state.suspension !== undefined && state.suspension !== null
        ? runner.applyReplacement(pack, state, resolved.actions)
        : runner.applyTurn(pack, state, resolved.actions);
      assertTransitionResult(r, pack, state);
    } catch (error) {
      return { ok: false, code: "REPLAY_MISMATCH", detail: `executor fault on replay @${resolved.decisionId}: ${(error as Error).message}` };
    }
    if (!r.ok) return { ok: false, code: "REPLAY_MISMATCH", detail: `engine fault on replay @${resolved.decisionId}: ${r.fault.reason}` };
    state = r.state;
    const actual = `sha256:${sha256hex(canonicalJson(state))}`;
    if (actual !== stateHash) {
      return { ok: false, code: "REPLAY_MISMATCH", detail: `hash mismatch @${resolved.decisionId}: expected ${stateHash}, got ${actual}` };
    }
  }

  return { ok: true, turns: inputs.length, finalHash: `sha256:${sha256hex(canonicalJson(state))}` };
}
