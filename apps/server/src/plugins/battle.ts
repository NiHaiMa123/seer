/**
 * plugins/battle.ts —— 对局域插件：建局工厂 + observe/history/submit/ack/resync 路由 + PVE bot 驱动。
 * 提供 `battle.api` 服务供其他插件（如 world 挑战）建局，不经 HTTP 自调用。
 */
import { randomBytes } from "node:crypto";
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import type { BattleManager } from "@seer/host";
import { teamToConfig } from "@seer/host";
import { decideBaseline } from "@seer/agent";
import { BATTLE_MANAGER_SERVICE } from "@seer/plugin-runtime";
import { HTTP_ROUTER_SERVICE, type Router, type RouteRequest } from "../router.ts";
import { CONTENT_CATALOG_SERVICE, type ContentCatalog } from "./content.ts";
import {
  TransportError, parseAck, parseCreateBattle, parseCursor, parseDelay, parseSubmit, parseToken, readJsonBody,
} from "../transport.ts";

export const BATTLE_API_SERVICE = "battle.api";

export interface CreateBattleInput {
  pack?: string;
  mode?: string;
  team?: { p1: string[]; p2: string[] };
  species?: { p1: string; p2: string };
  bench?: { p1?: string[]; p2?: string[] };
  /** 刻印 loadout：loadout.p1[i] ↔ 队伍第 i 槽位（[0]=首发）的 seal id 列表 */
  loadout?: { p1?: string[][]; p2?: string[][] };
  owners?: { p1?: string; p2?: string };
  seedHex: string;
  deadlineMs: number;
  bossTeam?: string[];
}

export interface BattleApi {
  /** 建局（含 PVE bot 席位与首次驱动）；返回玩家 token（pve 只有 p1） */
  create(input: CreateBattleInput): { battleId: string; mode: "pve" | "pvp"; tokens: { p1: string; p2?: string } };
  /** 领奖/归属用的世界侧登记 */
  worldMeta(battleId: string): { owners: { p1?: string; p2?: string }; species: { p1: string; p2: string } } | undefined;
  /** 终局结果 + 世界登记；null = 无此局或未登记世界归属；terminal null = 未终局 */
  outcomeFor(battleId: string): { terminal: { result: "p1" | "p2" | "draw"; reason: string } | null; revision: number; owners: { p1?: string; p2?: string }; species: { p1: string; p2: string } } | null;
}

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "battle-api",
  version: "1.0.0",
  name: "Battle API",
  kind: "service",
  requestedCapabilities: ["battle.read", "battle.submit"],
  requires: [
    { service: BATTLE_MANAGER_SERVICE, versionRange: "*" },
    { service: CONTENT_CATALOG_SERVICE, versionRange: "*" },
    { service: HTTP_ROUTER_SERVICE, versionRange: "*" },
  ],
  entrypoints: { module: "plugins/battle/index.js" },
};

export const BATTLE_API_POLICY = { grantedCapabilities: ["battle.read", "battle.submit"] };

export function battleApiPlugin(): PluginSpec {
  return {
    manifest: MANIFEST,
    provides: [BATTLE_API_SERVICE],
    setup: (ctx: SeerPluginContext) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      const route = (m: string, t: string, h: Parameters<Router["register"]>[3]) => ctx.own(router.register("battle-api", m, t, h));
      const battles = ctx.require<BattleManager>(BATTLE_MANAGER_SERVICE);
      const catalog = ctx.require<ContentCatalog>(CONTENT_CATALOG_SERVICE);

      const tokens = new Map<string, { battleId: string; playerId: string }>();
      const pveSeats = new Map<string, { boss: string; packId: string }>();
      const worldMeta = new Map<string, { owners: { p1?: string; p2?: string }; species: { p1: string; p2: string } }>();
      let battleCounter = 0;

      const drivePve = (battleId: string): void => {
        const seat = pveSeats.get(battleId);
        if (seat === undefined) return;
        const host = battles.get(battleId);
        const pack = catalog.packs[seat.packId];
        if (host === undefined || pack === undefined) return;
        for (let guard = 0; guard < 8; guard++) {
          const obs = host.observe(seat.boss);
          const d = obs.decision;
          if (d === null || !d.actors.includes(obs.side)) return;
          const pick = d.kind === "replacement"
            ? (obs.legalActions.find((a) => a.actionId.startsWith("act_switch-"))?.actionId ?? "act_concede")
            : decideBaseline(pack, obs).actionId;
          const r = host.submit(seat.boss, {
            battleId, decisionId: d.decisionId,
            baseRevision: d.baseRevision, actionId: pick,
            idempotencyKey: `bot_${battleId}_${d.decisionId}`,
          });
          if (!r.ok) return;
        }
      };

      const playerFor = (token: string, battleId: string): string | null => {
        const binding = tokens.get(token);
        return binding?.battleId === battleId ? binding.playerId : null;
      };

      const api: BattleApi = {
        create: (input) => {
          const packId = input.pack ?? catalog.defaultPackId;
          const pack = catalog.packs[packId];
          const generationId = catalog.generationByPackId.get(packId);
          if (generationId === undefined || pack === undefined) throw new TransportError(400, `unknown pack ${packId}`);
          let species = input.species ?? (() => {
            const ids = [...pack.unitsById.keys()];
            return { p1: ids[0]!, p2: ids[1] ?? ids[0]! };
          })();
          let bench = input.bench;
          if (input.team !== undefined) {
            const t1 = teamToConfig(pack, input.team.p1);
            const t2 = teamToConfig(pack, input.team.p2);
            species = { p1: t1.species, p2: t2.species };
            bench = { ...(t1.bench !== undefined ? { p1: t1.bench } : {}), ...(t2.bench !== undefined ? { p2: t2.bench } : {}) };
          }
          // 刻印 loadout 桥接：线协议 loadout.p1[i] ↔ 队伍第 i 槽位 → 通用 mechanics.seals 袋
          let mechanics: Record<string, { p1?: unknown[]; p2?: unknown[] }> | undefined;
          if (input.loadout !== undefined) {
            const slotsOf = (s: "p1" | "p2") => 1 + (bench?.[s]?.length ?? 0);
            for (const s of ["p1", "p2"] as const) {
              const lo = input.loadout[s];
              if (lo === undefined) continue;
              if (lo.length > slotsOf(s)) throw new TransportError(400, `loadout.${s} has ${lo.length} slots but only ${slotsOf(s)} units`);
            }
            mechanics = {
              seals: {
                ...(input.loadout.p1 !== undefined ? { p1: input.loadout.p1 } : {}),
                ...(input.loadout.p2 !== undefined ? { p2: input.loadout.p2 } : {}),
              },
            };
          }
          const battleId = `btl_${(++battleCounter).toString(16)}`;
          const pve = input.mode === "pve";
          const players = { p1: `p1_${battleId}`, p2: pve ? `bot_${battleId}` : `p2_${battleId}` };
          battles.create({
            battleId,
            seedHex: input.seedHex,
            species,
            ...(bench !== undefined ? { bench } : {}),
            ...(mechanics !== undefined ? { mechanics } : {}),
            generationId,
            players,
            deadlineMs: input.deadlineMs,
          });
          if (input.owners !== undefined) worldMeta.set(battleId, { owners: input.owners, species });
          const p1 = `tok_${randomBytes(16).toString("hex")}`;
          tokens.set(p1, { battleId, playerId: players.p1 });
          if (pve) {
            pveSeats.set(battleId, { boss: players.p2, packId });
            drivePve(battleId);
            return { battleId, mode: "pve", tokens: { p1 } };
          }
          const p2 = `tok_${randomBytes(16).toString("hex")}`;
          tokens.set(p2, { battleId, playerId: players.p2 });
          return { battleId, mode: "pvp", tokens: { p1, p2 } };
        },
        worldMeta: (battleId) => worldMeta.get(battleId),
        outcomeFor: (battleId) => {
          const meta = worldMeta.get(battleId);
          const host = battles.get(battleId);
          if (meta === undefined || host === undefined) return null;
          const out = host.outcome();
          if (out === null) return { terminal: null, revision: 0, owners: meta.owners, species: meta.species };
          return { terminal: out.terminal, revision: out.revision, owners: meta.owners, species: meta.species };
        },
      };
      ctx.provide(BATTLE_API_SERVICE, api);

      route("POST", "/api/battle", async (r: RouteRequest) => {
        const input = parseCreateBattle(await readJsonBody(r.req));
        const created = api.create(input);
        r.json(200, { battleId: created.battleId, ...(created.mode === "pve" ? { mode: "pve" } : {}), tokens: created.tokens });
      });

      route("GET", "/api/battle/:id/observe", (r) => {
        const host = battles.get(r.params["id"]!);
        if (!host) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        const playerId = playerFor(parseToken(r.query.get("player")), r.params["id"]!);
        if (!playerId) return r.json(401, { code: "UNAUTHORIZED" });
        r.json(200, host.observe(playerId));
      });

      route("GET", "/api/battle/:id/history", async (r) => {
        const host = battles.get(r.params["id"]!);
        if (!host) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        const playerId = playerFor(parseToken(r.query.get("player")), r.params["id"]!);
        if (!playerId) return r.json(401, { code: "UNAUTHORIZED" });
        const since = parseCursor(r.query.get("since"));
        const slowMs = parseDelay(r.query.get("slow"));
        if (slowMs > 0) await new Promise((res) => setTimeout(res, slowMs));
        r.json(200, host.history(playerId, since));
      });

      route("GET", "/api/battle/:id/resync", (r) => {
        const host = battles.get(r.params["id"]!);
        if (!host) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        const playerId = playerFor(parseToken(r.query.get("player")), r.params["id"]!);
        if (!playerId) return r.json(401, { code: "UNAUTHORIZED" });
        r.json(200, host.resync(playerId, parseCursor(r.query.get("since"))));
      });

      route("POST", "/api/battle/:id/submit", async (r) => {
        const host = battles.get(r.params["id"]!);
        if (!host) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        const input = parseSubmit(r.params["id"]!, await readJsonBody(r.req));
        const playerId = playerFor(input.token, r.params["id"]!);
        if (!playerId) return r.json(401, { code: "UNAUTHORIZED" });
        const result = host.submit(playerId, input.command);
        if (!result.ok) return r.json(200, { ok: false, code: result.error.code, message: result.error.message });
        drivePve(r.params["id"]!);
        r.json(200, { ok: true, receipt: result.receipt });
      });

      route("POST", "/api/battle/:id/ack", async (r) => {
        const host = battles.get(r.params["id"]!);
        if (!host) return r.json(404, { code: "NOT_FOUND", message: "battle" });
        const input = parseAck(await readJsonBody(r.req));
        const playerId = playerFor(input.token, r.params["id"]!);
        if (!playerId) return r.json(401, { code: "UNAUTHORIZED" });
        r.json(200, { cursor: host.ack(playerId, input.seq) });
      });
    },
  };
}
