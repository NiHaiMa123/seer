import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleManager, BattleStore } from "@seer/host";
import {
  BATTLE_MANAGER_POLICY,
  BATTLE_MANAGER_SERVICE,
  PluginHost,
  battleManagerPlugin,
} from "@seer/plugin-runtime";
import { startServer } from "../../apps/server/src/index.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACK = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const SEED = "0123456789abcdef0123456789abcdef";

const config = (battleId: string) => ({
  battleId,
  seedHex: SEED,
  species: { p1: "syn-alpha", p2: "syn-beta" },
  players: { p1: `a_${battleId}`, p2: `b_${battleId}` },
  deadlineMs: 30_000,
});

const post = (url: string, body: unknown) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

describe("M2-04 assembly", () => {
  it("Cordis service owns a real multi-battle manager and unloads cleanly", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "seer-m204-")), "battle.db");
    const store = new BattleStore(db);
    const manager = new BattleManager(store, PACK);
    const plugins = new PluginHost();
    await plugins.loadPlugin(battleManagerPlugin(manager), BATTLE_MANAGER_POLICY);
    const service = plugins.require<BattleManager>(BATTLE_MANAGER_SERVICE);
    const a = service.create(config("btl_multi-a"));
    const b = service.create(config("btl_multi-b"));
    expect(service.ids()).toEqual(["btl_multi-a", "btl_multi-b"]);
    expect(service.size).toBe(2);

    const decision = a.observe("a_btl_multi-a").decision!;
    const submitted = a.submit("a_btl_multi-a", {
      battleId: "btl_multi-a",
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "multi-a-submit",
    });
    expect(submitted.ok).toBe(true);
    const resolved = a.submit("b_btl_multi-a", {
      battleId: "btl_multi-a",
      decisionId: decision.decisionId,
      baseRevision: decision.baseRevision,
      actionId: "act_syn-strike",
      idempotencyKey: "multi-b-submit",
    });
    expect(resolved.ok).toBe(true);
    expect(a.observe("a_btl_multi-a").revision).toBe(1);
    expect(b.observe("a_btl_multi-b").revision).toBe(0);
    expect(() => service.create(config("btl_multi-a"))).toThrow(/already exists/);
    expect(() => new BattleManager(store, PACK).create(config("btl_multi-a"))).toThrow(/already exists/);

    await plugins.disposeAll();
    expect(plugins.has(BATTLE_MANAGER_SERVICE)).toBe(false);
    expect(plugins.pluginCount).toBe(0);
    store.close();
  });

  it("HTTP transport isolates battle tokens and rejects malformed DTOs before mutation", async () => {
    const server = await startServer(0);
    try {
      const createA = await post(`${server.url}/api/battle`, { seedHex: "a1".repeat(16) });
      const createB = await post(`${server.url}/api/battle`, { seedHex: "b2".repeat(16) });
      expect(createA.status).toBe(200);
      expect(createB.status).toBe(200);
      const a = await createA.json() as { battleId: string; tokens: { p1: string; p2: string } };
      const b = await createB.json() as { battleId: string; tokens: { p1: string; p2: string } };
      expect(server.battles.size).toBe(2);

      const cross = await fetch(`${server.url}/api/battle/${b.battleId}/observe?player=${a.tokens.p1}`);
      expect(cross.status).toBe(401);

      const before = await (await fetch(`${server.url}/api/battle/${a.battleId}/observe?player=${a.tokens.p1}`)).json() as { revision: number };
      const invalid = await post(`${server.url}/api/battle/${a.battleId}/submit`, {
        player: a.tokens.p1,
        decisionId: "dec_invalid",
        baseRevision: 0,
        actionId: "act_syn-strike",
        idempotencyKey: "assembly-invalid",
        actor: "p2",
      });
      expect(invalid.status).toBe(400);
      const after = await (await fetch(`${server.url}/api/battle/${a.battleId}/observe?player=${a.tokens.p1}`)).json() as { revision: number };
      expect(after.revision).toBe(before.revision);

      expect((await post(`${server.url}/api/battle`, "{" )).status).toBe(400);
      expect((await post(`${server.url}/api/battle`, { seedHex: SEED, extra: true })).status).toBe(400);
      expect((await post(`${server.url}/api/battle`, { seedHex: SEED, bench: { p1: ["syn-beta"] } })).status).toBe(400);
      expect((await post(`${server.url}/api/battle`, JSON.stringify({ payload: "x".repeat(70_000) }))).status).toBe(413);
      expect(server.battles.size).toBe(2);
    } finally {
      await server.close();
    }
  });
});
