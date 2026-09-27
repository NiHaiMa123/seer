import {
  applyReplacement,
  applyTurn,
  initBattle,
  legalActions,
  loadPackFromDir,
  type CoreResult,
  type FrozenPack,
} from "@seer/battle-core";
import type { ProcessExecutionRequest } from "../../packages/host/src/executor.ts";

export const LEGACY_EXECUTABLE_HASH = `sha256:${"7".repeat(64)}`;

const serializable = (result: CoreResult) => result.ok
  ? result
  : { ok: false, fault: { reason: result.fault.reason, message: result.fault.message } };

export function execute(request: ProcessExecutionRequest): unknown {
  const payload = request.payload as {
    contentRoot?: unknown;
    packId?: unknown;
    fail?: unknown;
    failKind?: unknown;
    malformedKind?: unknown;
    exitCode?: unknown;
    invalidJson?: unknown;
    delayMs?: unknown;
    outputBytes?: unknown;
  };
  if (typeof payload.exitCode === "number") process.exit(payload.exitCode);
  if (payload.invalidJson === true) {
    process.stdout.write("not-json");
    process.exit(0);
  }
  if (typeof payload.delayMs === "number") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, payload.delayMs);
  if (typeof payload.outputBytes === "number") return "x".repeat(payload.outputBytes);
  if (payload?.fail === true || payload?.failKind === request.kind) throw new Error("legacy fixture failure");
  if (request.executableHash !== LEGACY_EXECUTABLE_HASH) throw new Error("legacy executable hash mismatch");
  if (typeof payload?.contentRoot !== "string" || typeof payload.packId !== "string") throw new Error("legacy payload malformed");
  const loaded = loadPackFromDir(payload.contentRoot, payload.packId);
  if (
    loaded.rules.rulesetHash !== request.rules.rulesetHash
    || loaded.rules.contentHash !== request.rules.contentHash
    || loaded.rules.rulesetId !== request.rules.rulesetId
  ) {
    throw new Error("legacy content artifact mismatch");
  }
  const pack: FrozenPack = Object.freeze({
    ...loaded,
    rules: Object.freeze({ ...loaded.rules, executableHash: LEGACY_EXECUTABLE_HASH }),
  });

  if (payload.malformedKind === request.kind) {
    if (request.kind === "init") return { ...initBattle(pack, request.options), battleId: "btl_wrong" };
    if (request.kind === "legal") return ["not-an-action"];
    return { ok: true, state: {}, events: [] };
  }
  if (request.kind === "init") return initBattle(pack, request.options);
  if (request.kind === "legal") return legalActions(request.state, request.side);
  if (request.kind === "replacement") return serializable(applyReplacement(pack, request.state, request.actions));
  return serializable(applyTurn(pack, request.state, request.actions));
}
