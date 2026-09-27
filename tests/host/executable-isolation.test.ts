import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, loadPackFromDir, type FrozenPack } from "@seer/battle-core";
import {
  BattleHost,
  BattleManager,
  BattleStore,
  ProcessTransitionExecutor,
  RuntimeArtifactCatalog,
  RuntimeGenerationRegistry,
  generationIdOf,
  replayBattle,
} from "@seer/host";
import { LEGACY_EXECUTABLE_HASH } from "./legacy-executable.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENTRYPOINT = fileURLToPath(new URL("./legacy-executable.ts", import.meta.url));
const V1 = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const LEGACY: FrozenPack = Object.freeze({
  ...V1,
  rules: Object.freeze({ ...V1.rules, executableHash: LEGACY_EXECUTABLE_HASH }),
});
const SEED = "fedcbafedcbafedcbafedcbafedcbafe";
const tempPath = () => join(mkdtempSync(join(tmpdir(), "seer-exec-")), "battle.db");
const tempStore = () => new BattleStore(tempPath());
const processConfig = (options: {
  fail?: boolean;
  failKind?: string;
  malformedKind?: string;
  exitCode?: number;
  invalidJson?: boolean;
  delayMs?: number;
  outputBytes?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
} = {}) => {
  const { timeoutMs, maxOutputBytes, ...payload } = options;
  return {
    entrypoint: ENTRYPOINT,
    payload: { contentRoot: join(ROOT, "content"), packId: "synthetic-v1", ...payload },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
  };
};
const battleConfig = (battleId: string, generationId: string) => ({
  battleId,
  generationId,
  seedHex: SEED,
  species: { p1: "syn-alpha", p2: "syn-beta" },
  players: { p1: `a_${battleId}`, p2: `b_${battleId}` },
  deadlineMs: 30_000,
});

describe("isolated executable generations", () => {
  it("runs a different executableHash in child processes for live play, restore and replay", async () => {
    const path = tempPath();
    const store = new BattleStore(path);
    const artifacts = new RuntimeArtifactCatalog([V1]);
    const legacyId = artifacts.register(LEGACY, processConfig());
    const generations = new RuntimeGenerationRegistry();
    await generations.activate(V1);
    await generations.activate(LEGACY, { isolatedExecutable: true });
    expect(generations.descriptors().find((item) => item.id === legacyId)).toMatchObject({ isolated: true });

    const manager = new BattleManager(store, generations, artifacts);
    const battleId = "btl_exec-legacy";
    const host = manager.create(battleConfig(battleId, legacyId));
    const executor = artifacts.executor(legacyId) as ProcessTransitionExecutor;
    expect(executor.lastPid).not.toBeNull();
    expect(executor.lastPid).not.toBe(process.pid);
    expect(host.observe(`a_${battleId}`).rules.executableHash).toBe(LEGACY_EXECUTABLE_HASH);

    const decision = host.observe(`a_${battleId}`).decision!;
    host.submit(`a_${battleId}`, {
      battleId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "legacy-submit-a",
    });
    host.submit(`b_${battleId}`, {
      battleId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "legacy-submit-b",
    });
    expect(host.observe(`a_${battleId}`).revision).toBe(1);
    expect(executor.lastPid).not.toBe(process.pid);
    expect(replayBattle(store, LEGACY, battleId, executor).ok).toBe(true);
    expect(replayBattle(store, LEGACY, battleId)).toMatchObject({ ok: false, code: "ARTIFACT_UNAVAILABLE" });

    generations.markDraining(legacyId);
    expect(() => generations.retire(legacyId)).toThrow(/active reference/);
    const terminalDecision = host.observe(`a_${battleId}`).decision!;
    host.submit(`a_${battleId}`, {
      battleId,
      decisionId: terminalDecision.decisionId,
      baseRevision: terminalDecision.baseRevision,
      actionId: "act_concede",
      idempotencyKey: "legacy-concede-a",
    });
    host.submit(`b_${battleId}`, {
      battleId,
      decisionId: terminalDecision.decisionId,
      baseRevision: terminalDecision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "legacy-concede-b",
    });
    manager.unload(battleId);
    expect(generations.has(legacyId)).toBe(false);

    store.close();
    const restoredStore = new BattleStore(path);
    const restoredArtifacts = new RuntimeArtifactCatalog();
    restoredArtifacts.register(LEGACY, processConfig());
    const restoredManager = new BattleManager(restoredStore, new RuntimeGenerationRegistry(), restoredArtifacts);
    const restored = await restoredManager.restore({
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: `a_${battleId}`, p2: `b_${battleId}` },
      deadlineMs: 30_000,
    }, battleId);
    expect(restored.observe(`a_${battleId}`).revision).toBe(2);
    expect(restoredManager.generationOf(battleId)).toBe(generationIdOf(LEGACY));
    restoredStore.close();
  });

  it("keeps failed isolated initialization atomic and releases its generation lease", async () => {
    const store = tempStore();
    const artifacts = new RuntimeArtifactCatalog();
    const legacyId = artifacts.register(LEGACY, processConfig({ fail: true }));
    const generations = new RuntimeGenerationRegistry();
    await generations.activate(LEGACY, { isolatedExecutable: true });
    const manager = new BattleManager(store, generations, artifacts);
    expect(() => manager.create(battleConfig("btl_exec-fail", legacyId))).toThrow(/legacy fixture failure/);
    expect(manager.size).toBe(0);
    expect(store.loadBattle("btl_exec-fail")).toBeNull();
    expect(generations.descriptors()[0]).toMatchObject({ references: 0, isolated: true });
    store.close();
  });

  it("rolls back the resolving submission when the isolated transition fails", async () => {
    const store = tempStore();
    const artifacts = new RuntimeArtifactCatalog();
    const legacyId = artifacts.register(LEGACY, processConfig({ failKind: "turn" }));
    const generations = new RuntimeGenerationRegistry();
    await generations.activate(LEGACY, { isolatedExecutable: true });
    const manager = new BattleManager(store, generations, artifacts);
    const battleId = "btl_exec-transition-fail";
    const host = manager.create(battleConfig(battleId, legacyId));
    const decision = host.observe(`a_${battleId}`).decision!;
    expect(host.submit(`a_${battleId}`, {
      battleId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "legacy-fail-a",
    }).ok).toBe(true);
    expect(() => host.submit(`b_${battleId}`, {
      battleId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "legacy-fail-b",
    })).toThrow(/legacy fixture failure/);
    expect(host.host.state.battle.revision).toBe(0);
    expect(host.host.state.battle.inbox.p1?.actionId).toBe("act_syn-strike");
    expect(host.host.state.battle.inbox.p2).toBeNull();
    expect(host.receiptFor(`b_${battleId}`, "legacy-fail-b")).toBeUndefined();
    store.close();
  });

  it("binds custom executors by hash and projects their legal set without current-engine filtering", () => {
    const executor = {
      executableHash: V1.rules.executableHash,
      init: initBattle,
      legalActions: () => ["act_struggle"],
      applyTurn,
      applyReplacement,
    };
    const host = new BattleHost({
      pack: V1,
      executor,
      battleId: "btl_exec-authority",
      seedHex: SEED,
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: "a", p2: "b" },
      deadlineMs: 30_000,
    });
    expect(host.observe("a").legalActions.map((action) => action.actionId)).toEqual(["act_struggle"]);
    expect(() => new BattleHost({
      pack: V1,
      executor: { ...executor, executableHash: LEGACY_EXECUTABLE_HASH },
      battleId: "btl_exec-wrong",
      seedHex: SEED,
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: "a", p2: "b" },
      deadlineMs: 30_000,
    })).toThrow(/cannot run/);

    const store = tempStore();
    const { generationId: _, ...replayConfig } = battleConfig("btl_exec-replay-binding", generationIdOf(V1));
    new BattleManager(store, V1).create(replayConfig);
    expect(replayBattle(store, V1, "btl_exec-replay-binding", { ...executor, executableHash: LEGACY_EXECUTABLE_HASH }))
      .toMatchObject({ ok: false, code: "ARTIFACT_UNAVAILABLE" });
    store.close();
  });

  it("rejects malformed isolated init, legal and transition responses", async () => {
    for (const malformedKind of ["init", "legal", "turn"] as const) {
      const store = tempStore();
      const artifacts = new RuntimeArtifactCatalog();
      const legacyId = artifacts.register(LEGACY, processConfig({ malformedKind }));
      const generations = new RuntimeGenerationRegistry();
      await generations.activate(LEGACY, { isolatedExecutable: true });
      const manager = new BattleManager(store, generations, artifacts);
      if (malformedKind === "init") {
        expect(() => manager.create(battleConfig(`btl_exec-malformed-${malformedKind}`, legacyId))).toThrow(/battleId/);
        expect(store.loadBattle(`btl_exec-malformed-${malformedKind}`)).toBeNull();
      } else {
        const battleId = `btl_exec-malformed-${malformedKind}`;
        const host = manager.create(battleConfig(battleId, legacyId));
        if (malformedKind === "legal") {
          expect(() => host.observe(`a_${battleId}`)).toThrow(/legal response is malformed/);
        } else {
          const decision = host.observe(`a_${battleId}`).decision!;
          host.submit(`a_${battleId}`, {
            battleId,
            decisionId: decision.decisionId,
            baseRevision: decision.baseRevision,
            actionId: "act_syn-strike",
            idempotencyKey: "malformed-turn-a",
          });
          expect(() => host.submit(`b_${battleId}`, {
            battleId,
            decisionId: decision.decisionId,
            baseRevision: decision.baseRevision,
            actionId: "act_syn-strike",
            idempotencyKey: "malformed-turn-b",
          })).toThrow(/state is malformed/);
          expect(host.host.state.battle.inbox.p2).toBeNull();
        }
      }
      expect(generations.descriptors()[0]).toMatchObject({ references: malformedKind === "init" ? 0 : 1, isolated: true });
      store.close();
    }
  });

  it("fails closed on child exit, invalid JSON, timeout and output overflow", async () => {
    const cases = [
      { config: processConfig({ exitCode: 3 }), expected: /exited 3/ },
      { config: processConfig({ invalidJson: true }), expected: /invalid JSON/ },
      { config: processConfig({ delayMs: 1_000, timeoutMs: 100 }), expected: /ETIMEDOUT|timed out/ },
      { config: processConfig({ outputBytes: 10_000, maxOutputBytes: 1_024 }), expected: /ENOBUFS|maxBuffer/ },
    ];
    for (const [index, item] of cases.entries()) {
      const store = tempStore();
      const artifacts = new RuntimeArtifactCatalog();
      const legacyId = artifacts.register(LEGACY, item.config);
      const generations = new RuntimeGenerationRegistry();
      await generations.activate(LEGACY, { isolatedExecutable: true });
      const manager = new BattleManager(store, generations, artifacts);
      const battleId = `btl_exec-process-${index}`;
      expect(() => manager.create(battleConfig(battleId, legacyId))).toThrow(item.expected);
      expect(store.loadBattle(battleId)).toBeNull();
      expect(generations.descriptors()[0]).toMatchObject({ references: 0, isolated: true });
      store.close();
    }
  });

  it("does not activate a persisted foreign executable when its executor is missing", async () => {
    const path = tempPath();
    const store = new BattleStore(path);
    const artifacts = new RuntimeArtifactCatalog();
    const legacyId = artifacts.register(LEGACY, processConfig());
    const generations = new RuntimeGenerationRegistry();
    await generations.activate(LEGACY, { isolatedExecutable: true });
    new BattleManager(store, generations, artifacts).create(battleConfig("btl_exec-missing-restore", legacyId));
    store.close();

    const restoredStore = new BattleStore(path);
    const restoredGenerations = new RuntimeGenerationRegistry();
    const restoredManager = new BattleManager(restoredStore, restoredGenerations, new RuntimeArtifactCatalog([LEGACY]));
    await expect(restoredManager.restore({
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: "a_btl_exec-missing-restore", p2: "b_btl_exec-missing-restore" },
      deadlineMs: 30_000,
    }, "btl_exec-missing-restore")).rejects.toMatchObject({ code: "EXECUTABLE_ISOLATION_REQUIRED" });
    expect(restoredGenerations.generationCount).toBe(0);
    restoredStore.close();
  });
});
