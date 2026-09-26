/**
 * headless replay：从 init 快照 + 已提交 resolved_inputs 重放，
 * 逐 transition 比对 core 口径 state_hash。工件不匹配/篡改/缺失 → 明确失败码。
 */
import { applyTurn, type CoreState, type FrozenPack } from "@seer/battle-core";
import { canonicalJson } from "@seer/contracts";
import { sha256hex } from "@seer/battle-core";
import type { BattleState } from "@seer/contracts/internal";
import type { BattleStore } from "./store.ts";

export type ReplayOutcome =
  | { ok: true; turns: number; finalHash: string }
  | { ok: false; code: "ARTIFACT_UNAVAILABLE" | "REPLAY_MISMATCH" | "MALFORMED_RECORD"; detail: string };

function parseCore(json: string): CoreState {
  const s = JSON.parse(json) as CoreState;
  if (s.schemaVersion !== 1 || typeof s.battleId !== "string" || !s.rng || !s.sides) {
    throw new Error("malformed init snapshot");
  }
  return s;
}

export function replayBattle(store: BattleStore, pack: FrozenPack, battleId: string): ReplayOutcome {
  const row = store.loadBattle(battleId);
  if (!row) return { ok: false, code: "ARTIFACT_UNAVAILABLE", detail: `battle ${battleId} missing` };

  let state: CoreState;
  try {
    state = parseCore(row.initJson);
  } catch (e) {
    return { ok: false, code: "MALFORMED_RECORD", detail: `init snapshot: ${(e as Error).message}` };
  }

  // 工件一致性：持久化 rules hash 必须与当前 pack 一致（旧/篡改工件显式失败）
  const persistedRules = (JSON.parse(row.stateJson) as BattleState).rules;
  if (persistedRules.rulesetId !== pack.rules.rulesetId || persistedRules.rulesetHash !== pack.rules.rulesetHash) {
    return {
      ok: false,
      code: "ARTIFACT_UNAVAILABLE",
      detail: `ruleset mismatch: stored ${persistedRules.rulesetId}@${persistedRules.rulesetHash} vs pack ${pack.rules.rulesetId}@${pack.rules.rulesetHash}`,
    };
  }

  const inputs = store.loadResolvedInputs(battleId);
  for (const { resolved, stateHash } of inputs) {
    const r = applyTurn(pack, state, resolved.actions);
    if (!r.ok) return { ok: false, code: "REPLAY_MISMATCH", detail: `engine fault on replay @${resolved.decisionId}: ${r.fault.reason}` };
    state = r.state;
    const actual = `sha256:${sha256hex(canonicalJson(state))}`;
    if (actual !== stateHash) {
      return { ok: false, code: "REPLAY_MISMATCH", detail: `hash mismatch @${resolved.decisionId}: expected ${stateHash}, got ${actual}` };
    }
  }

  return { ok: true, turns: inputs.length, finalHash: `sha256:${sha256hex(canonicalJson(state))}` };
}
