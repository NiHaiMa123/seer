import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir, type FrozenPack } from "@seer/battle-core";
import {
  BattleManager,
  BattleStore,
  RuntimeArtifactCatalog,
  RuntimeGenerationRegistry,
  generationIdOf,
  replayBattle,
} from "@seer/host";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const V1 = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const V2 = loadPackFromDir(join(ROOT, "content"), "synthetic-v2");
const SEED = "abcdefabcdefabcdefabcdefabcdefab";
const players = (battleId: string) => ({ p1: `a_${battleId}`, p2: `b_${battleId}` });
const createConfig = (battleId: string) => ({
  battleId,
  seedHex: SEED,
  species: { p1: "syn-alpha", p2: "syn-beta" },
  players: players(battleId),
  deadlineMs: 30_000,
});
const restoreConfig = (battleId: string) => ({
  species: { p1: "syn-alpha", p2: "syn-beta" },
  players: players(battleId),
  deadlineMs: 30_000,
});
const tempPath = () => join(mkdtempSync(join(tmpdir(), "seer-artifact-")), "battle.db");

async function createStoredBattle(path: string, battleId: string) {
  const store = new BattleStore(path);
  const artifacts = new RuntimeArtifactCatalog([V1]);
  const generations = new RuntimeGenerationRegistry();
  await generations.activate(V1);
  const manager = new BattleManager(store, generations, artifacts);
  const host = manager.create(createConfig(battleId));
  return { store, host };
}

describe("runtime artifact catalog", () => {
  it("restores an interrupted battle by its persisted three-hash generation", async () => {
    const path = tempPath();
    const battleId = "btl_artifact-ok";
    const created = await createStoredBattle(path, battleId);
    const decision = created.host.observe(players(battleId).p1).decision!;
    created.host.submit(players(battleId).p1, {
      battleId,
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "artifact-submit-a",
    });
    const before = canonicalJson(created.host.observe(players(battleId).p1));
    created.store.close();

    const store = new BattleStore(path);
    const artifacts = new RuntimeArtifactCatalog([V1, V2]);
    const generations = new RuntimeGenerationRegistry();
    const manager = new BattleManager(store, generations, artifacts);
    const restored = await manager.restore(restoreConfig(battleId), battleId);
    expect(manager.generationOf(battleId)).toBe(generationIdOf(V1));
    expect(generations.descriptors()).toEqual([
      expect.objectContaining({ id: generationIdOf(V1), references: 1 }),
    ]);
    expect(canonicalJson(restored.observe(players(battleId).p1))).toBe(before);
    expect(restored.receiptFor(players(battleId).p1, "artifact-submit-a")?.actionId).toBe("act_syn-strike");
    store.close();
  });

  it("fails closed when the exact persisted artifact is absent", async () => {
    const path = tempPath();
    const battleId = "btl_artifact-missing";
    const created = await createStoredBattle(path, battleId);
    created.store.close();

    const store = new BattleStore(path);
    const emptyManager = new BattleManager(store, new RuntimeGenerationRegistry(), new RuntimeArtifactCatalog());
    await expect(emptyManager.restore(restoreConfig(battleId), battleId)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    const wrongManager = new BattleManager(store, new RuntimeGenerationRegistry(), new RuntimeArtifactCatalog([V2]));
    await expect(wrongManager.restore(restoreConfig(battleId), battleId)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(emptyManager.size).toBe(0);
    expect(wrongManager.size).toBe(0);
    store.close();
  });

  it("rejects tampered content/executable hashes in restore and replay", async () => {
    for (const field of ["contentHash", "executableHash"] as const) {
      const path = tempPath();
      const battleId = `btl_artifact-${field === "contentHash" ? "content" : "exec"}`;
      const created = await createStoredBattle(path, battleId);
      const row = created.store.loadBattle(battleId)!;
      const state = JSON.parse(row.stateJson) as { rules: Record<string, unknown> };
      const marker = field === "contentHash" ? "c" : "e";
      state.rules[field] = `sha256:${marker.repeat(64)}`;
      created.store.db.prepare("UPDATE battles SET state_json=? WHERE battle_id=?").run(canonicalJson(state), battleId);

      const manager = new BattleManager(created.store, new RuntimeGenerationRegistry(), new RuntimeArtifactCatalog([V1]));
      await expect(manager.restore(restoreConfig(battleId), battleId)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
      expect(replayBattle(created.store, V1, battleId)).toMatchObject({ ok: false, code: "ARTIFACT_UNAVAILABLE" });
      created.store.close();
    }

    const path = tempPath();
    const battleId = "btl_artifact-init";
    const created = await createStoredBattle(path, battleId);
    const row = created.store.loadBattle(battleId)!;
    const init = JSON.parse(row.initJson) as { rules: Record<string, unknown> };
    init.rules.contentHash = `sha256:${"d".repeat(64)}`;
    created.store.db.prepare("UPDATE battles SET init_json=? WHERE battle_id=?").run(canonicalJson(init), battleId);
    const manager = new BattleManager(created.store, new RuntimeGenerationRegistry(), new RuntimeArtifactCatalog([V1]));
    await expect(manager.restore(restoreConfig(battleId), battleId)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(replayBattle(created.store, V1, battleId)).toMatchObject({ ok: false, code: "ARTIFACT_UNAVAILABLE" });
    created.store.close();
  });

  it("rejects snapshot battle identity mismatches before activating a generation", async () => {
    for (const column of ["state_json", "init_json"] as const) {
      const path = tempPath();
      const battleId = `btl_artifact-id-${column === "state_json" ? "state" : "init"}`;
      const created = await createStoredBattle(path, battleId);
      const row = created.store.loadBattle(battleId)!;
      const snapshot = JSON.parse(column === "state_json" ? row.stateJson : row.initJson) as { battleId: string };
      snapshot.battleId = "btl_other";
      created.store.db.prepare(`UPDATE battles SET ${column}=? WHERE battle_id=?`).run(canonicalJson(snapshot), battleId);
      const generations = new RuntimeGenerationRegistry();
      const manager = new BattleManager(created.store, generations, new RuntimeArtifactCatalog([V1]));
      await expect(manager.restore(restoreConfig(battleId), battleId)).rejects.toMatchObject({ code: "MALFORMED_RECORD" });
      expect(manager.size).toBe(0);
      expect(generations.generationCount).toBe(0);
      expect(replayBattle(created.store, V1, battleId)).toMatchObject({ ok: false, code: "MALFORMED_RECORD" });
      created.store.close();
    }
  });

  it("keeps artifact registration immutable for a three-hash identity", () => {
    const catalog = new RuntimeArtifactCatalog([V1]);
    expect(catalog.register(V1)).toBe(generationIdOf(V1));
    const conflicting: FrozenPack = Object.freeze({ ...V1, movesById: new Map(V1.movesById) });
    expect(() => catalog.register(conflicting)).toThrow(/different runtime data/);
    expect(catalog.require(generationIdOf(V1))).toBe(V1);
  });
});
