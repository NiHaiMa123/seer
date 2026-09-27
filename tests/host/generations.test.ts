import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir, type FrozenPack } from "@seer/battle-core";
import {
  BattleManager,
  BattleStore,
  GenerationError,
  RuntimeGenerationRegistry,
  generationIdOf,
  replayBattle,
} from "@seer/host";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const V1 = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const V2 = loadPackFromDir(join(ROOT, "content"), "synthetic-v2");
const SEED = "1234567890abcdef1234567890abcdef";

const store = () => new BattleStore(join(mkdtempSync(join(tmpdir(), "seer-gen-")), "battle.db"));
const config = (battleId: string, species: { p1: string; p2: string }, generationId?: string) => ({
  battleId,
  seedHex: SEED,
  species,
  players: { p1: `a_${battleId}`, p2: `b_${battleId}` },
  deadlineMs: 30_000,
  ...(generationId !== undefined ? { generationId } : {}),
});
const command = (battleId: string, decisionId: string, baseRevision: number, actionId: string, key: string) => ({
  battleId,
  decisionId,
  baseRevision,
  actionId,
  idempotencyKey: key,
});

const thirdPack = (): FrozenPack => Object.freeze({
  ...V2,
  rules: Object.freeze({ ...V2.rules, contentHash: `sha256:${"3".repeat(64)}` }),
});
const incompatiblePack = (): FrozenPack => Object.freeze({
  ...V2,
  rules: Object.freeze({ ...V2.rules, executableHash: `sha256:${"4".repeat(64)}` }),
});

describe("runtime generations", () => {
  it("pins active v1 battles while v2 becomes the default for new battles", async () => {
    const db = store();
    const registry = new RuntimeGenerationRegistry();
    const v1 = await registry.activate(V1);
    const manager = new BattleManager(db, registry);
    const old = manager.create(config("btl_gen-v1", { p1: "syn-alpha", p2: "syn-beta" }, v1.id));
    const before = old.observe("a_btl_gen-v1").rules;

    const v2 = await registry.activate(V2);
    const current = manager.create(config("btl_gen-v2", { p1: "syn-gamma", p2: "syn-epsilon" }));
    expect(manager.generationOf("btl_gen-v1")).toBe(v1.id);
    expect(manager.generationOf("btl_gen-v2")).toBe(v2.id);
    expect(old.observe("a_btl_gen-v1").rules).toEqual(before);
    expect(current.observe("a_btl_gen-v2").rules.rulesetId).toBe("synthetic-v2");

    const decision = old.observe("a_btl_gen-v1").decision!;
    old.submit("a_btl_gen-v1", command("btl_gen-v1", decision.decisionId, decision.baseRevision, "act_syn-strike", "generation-a1"));
    old.submit("b_btl_gen-v1", command("btl_gen-v1", decision.decisionId, decision.baseRevision, "act_syn-strike", "generation-b1"));
    expect(replayBattle(db, V1, "btl_gen-v1").ok).toBe(true);
    expect(replayBattle(db, V2, "btl_gen-v1")).toMatchObject({ ok: false, code: "ARTIFACT_UNAVAILABLE" });
    expect(() => registry.retire(v1.id)).toThrowError(GenerationError);
    db.close();
  });

  it("queues a third generation until a draining generation releases its final reference", async () => {
    await expect(new RuntimeGenerationRegistry().activate(incompatiblePack())).rejects.toMatchObject({ code: "EXECUTABLE_ISOLATION_REQUIRED" });
    const registry = new RuntimeGenerationRegistry(2);
    const v1 = await registry.activate(V1);
    await registry.activate(V2);
    await expect(registry.activate(incompatiblePack())).rejects.toMatchObject({ code: "EXECUTABLE_ISOLATION_REQUIRED" });
    const lease = registry.acquire(v1.id);
    let promoted = false;
    const pending = registry.activate(thirdPack()).then((descriptor) => {
      promoted = true;
      return descriptor;
    });
    await Promise.resolve();
    expect(promoted).toBe(false);
    expect(registry.queuedCount).toBe(1);

    registry.markDraining(v1.id);
    expect(() => registry.retire(v1.id)).toThrowError(GenerationError);
    expect(registry.descriptors().find((item) => item.id === v1.id)).toMatchObject({ references: 1, draining: true });
    lease.release();

    const v3 = await pending;
    expect(v3.id).toBe(generationIdOf(thirdPack()));
    expect(registry.generationCount).toBe(2);
    expect(registry.queuedCount).toBe(0);
    expect(() => registry.acquire(v1.id)).toThrowError(GenerationError);
  });

  it("refuses to unload an active battle and releases its generation after terminal", async () => {
    const db = store();
    const registry = new RuntimeGenerationRegistry();
    const v1 = await registry.activate(V1);
    const manager = new BattleManager(db, registry);
    const host = manager.create(config("btl_gen-drain", { p1: "syn-alpha", p2: "syn-beta" }, v1.id));
    expect(() => manager.unload("btl_gen-drain")).toThrowError(GenerationError);

    const decision = host.observe("a_btl_gen-drain").decision!;
    host.submit("a_btl_gen-drain", command("btl_gen-drain", decision.decisionId, decision.baseRevision, "act_concede", "generation-a2"));
    host.submit("b_btl_gen-drain", command("btl_gen-drain", decision.decisionId, decision.baseRevision, "act_syn-strike", "generation-b2"));
    manager.unload("btl_gen-drain");
    expect(manager.size).toBe(0);
    expect(registry.descriptors()[0]?.references).toBe(0);
    registry.retire(v1.id);
    expect(registry.generationCount).toBe(0);
    db.close();
  });
});
