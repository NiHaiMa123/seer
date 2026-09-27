/**
 * plugins/world.ts —— 世界域插件：profile/team/map/session/op/reward 路由。
 * `act:challenge` 经 `battle.api` 服务建局（插件间协作，不走 HTTP 自调用）。
 */
import { randomBytes } from "node:crypto";
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import type { WorldService } from "@seer/world";
import { HTTP_ROUTER_SERVICE, type Router } from "../router.ts";
import { CONTENT_CATALOG_SERVICE, type ContentCatalog } from "./content.ts";
import { BATTLE_API_SERVICE, type BattleApi } from "./battle.ts";
import {
  parseClaimReward, parseOpenSession, parseRegisterPlayer, parseSaveTeam,
  parseSessionId, parseWorldOp, parseWorldPlayer, readJsonBody,
} from "../transport.ts";

export const WORLD_SERVICE_KEY = "world.service";

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "world-api",
  version: "1.0.0",
  name: "World API",
  kind: "service",
  requestedCapabilities: ["world.read", "world.write"],
  requires: [
    { service: HTTP_ROUTER_SERVICE, versionRange: "*" },
    { service: WORLD_SERVICE_KEY, versionRange: "*" },
    { service: BATTLE_API_SERVICE, versionRange: "*" },
    { service: CONTENT_CATALOG_SERVICE, versionRange: "*" },
  ],
  entrypoints: { module: "plugins/world/index.js" },
};

export const WORLD_API_POLICY = { grantedCapabilities: ["world.read", "world.write"] };

export function worldApiPlugin(): PluginSpec {
  return {
    manifest: MANIFEST,
    setup: (ctx: SeerPluginContext) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      const route = (m: string, t: string, h: Parameters<Router["register"]>[3]) => ctx.own(router.register("world-api", m, t, h));
      const world = ctx.require<WorldService>(WORLD_SERVICE_KEY);
      const battles = ctx.require<BattleApi>(BATTLE_API_SERVICE);
      const catalog = ctx.require<ContentCatalog>(CONTENT_CATALOG_SERVICE);

      route("POST", "/api/world/player", async (r) => {
        const input = parseRegisterPlayer(await readJsonBody(r.req));
        world.registerPlayer(input.playerId, input.name);
        r.json(200, { ok: true });
      });

      route("POST", "/api/world/session", async (r) => {
        const input = parseOpenSession(await readJsonBody(r.req));
        const s = world.openSession(input.playerId, { ops: input.ops, allowIrreversible: input.irreversible });
        r.json(200, { sessionId: s.sessionId, opsLeft: s.opsLeft, irreversible: s.irreversible });
      });

      route("POST", "/api/world/session/:id/stop", (r) => {
        world.stopSession(parseSessionId(r.params["id"]!));
        r.json(200, { ok: true });
      });

      route("GET", "/api/world/player/:id/map", (r) => {
        r.json(200, world.map(parseWorldPlayer(r.params["id"]!)));
      });

      route("PUT", "/api/world/player/:id/team", async (r) => {
        const input = parseSaveTeam(await readJsonBody(r.req));
        world.saveTeam(parseWorldPlayer(r.params["id"]!), input.name, input.pack, input.species);
        r.json(200, { ok: true });
      });

      const listTeams = (r: Parameters<Parameters<typeof route>[2]>[0]) => {
        r.json(200, { teams: world.teams(parseWorldPlayer(r.params["id"]!)) });
      };
      route("GET", "/api/world/player/:id/team", listTeams);
      route("GET", "/api/world/player/:id/teams", listTeams);

      route("GET", "/api/world/player/:id", (r) => {
        r.json(200, world.profile(parseWorldPlayer(r.params["id"]!)));
      });

      route("POST", "/api/world/op", async (r) => {
        const input = parseWorldOp(await readJsonBody(r.req));
        if (input.op === "move") {
          r.json(200, world.move(input.sessionId, input.nodeId!));
          return;
        }
        const actRes = world.act(input.sessionId, input.actionId!);
        // challenge：翻译成真实 pve 建局（玩家队取存档 main，boss 队由动作给）
        const ch = actRes.result["challenge"] as { pack: string; bossTeam: string[] } | undefined;
        if (ch !== undefined) {
          const sess = world.session(input.sessionId);
          const pack = catalog.packs[ch.pack];
          if (pack === undefined) throw new Error(`unknown pack ${ch.pack}`);
          const saved = world.teams(sess.playerId).find((t) => t.name === "main" && t.pack === ch.pack)?.species;
          const created = battles.create({
            pack: ch.pack,
            mode: "pve",
            team: { p1: saved ?? [[...pack.unitsById.keys()][0]!], p2: ch.bossTeam },
            owners: { p1: sess.playerId },
            seedHex: randomBytes(16).toString("hex"),
            deadlineMs: 30_000,
          });
          r.json(200, { ...actRes, battle: { battleId: created.battleId, token: created.tokens.p1 } });
          return;
        }
        r.json(200, actRes);
      });

      route("POST", "/api/world/reward", async (r) => {
        const input = parseClaimReward(await readJsonBody(r.req));
        const out = battles.outcomeFor(input.battleId);
        if (out === null) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        if (out.terminal === null) return r.json(409, { code: "STALE_DECISION", message: "battle not terminal" });
        const result = world.claimReward({
          battleId: input.battleId,
          terminal: out.terminal,
          revision: out.revision,
          owners: out.owners,
          opponentSpecies: out.species,
        }, input.playerId);
        r.json(200, result);
      });
    },
  };
}
