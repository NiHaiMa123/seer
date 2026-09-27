import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleManager, BattleStore, HostError, RuntimeArtifactCatalog, RuntimeGenerationRegistry, TeamError, generationIdOf, teamToConfig } from "@seer/host";
import { decideBaseline } from "@seer/agent";
import {
  BATTLE_MANAGER_POLICY,
  BATTLE_MANAGER_SERVICE,
  PluginHost,
  battleManagerPlugin,
} from "@seer/plugin-runtime";
import {
  TransportError,
  parseAck,
  parseCreateBattle,
  parseCursor,
  parseDelay,
  parseSubmit,
  parseToken,
  readJsonBody,
} from "./transport.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKS = Object.fromEntries(
  ["synthetic-v1", "synthetic-v2"].map((id) => [id, loadPackFromDir(join(ROOT, "content"), id)]),
);
const DEFAULT_PACK_ID = "synthetic-v1";
const CLIENT_DIST = join(ROOT, "apps", "client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".map": "application/json",
};

export interface ServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
  battles: BattleManager;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startServer(port = 0, dbPath?: string): Promise<ServerHandle> {
  const db = dbPath ?? join(mkdtempSync(join(tmpdir(), "seer-srv-")), "battle.db");
  const store = new BattleStore(db);
  const packs = Object.values(PACKS);
  const artifacts = new RuntimeArtifactCatalog(packs);
  const generations = new RuntimeGenerationRegistry();
  const generationByPackId = new Map<string, string>();
  for (const [packId, pack] of Object.entries(PACKS)) {
    generationByPackId.set(packId, generationIdOf(pack));
    await generations.activate(pack);
  }
  const manager = new BattleManager(store, generations, artifacts);
  const plugins = new PluginHost();
  await plugins.loadPlugin(battleManagerPlugin(manager), BATTLE_MANAGER_POLICY);
  const battles = plugins.require<BattleManager>(BATTLE_MANAGER_SERVICE);
  const tokens = new Map<string, { battleId: string; playerId: string }>();
  /** pve 席位：battleId → { bossPlayerId, packId } */
  const pveSeats = new Map<string, { boss: string; packId: string }>();
  let battleCounter = 0;

  /** PVE 驱动：boss 侧有空 decision 就按 rule baseline 自动提交（含 replacement）。 */
  const drivePve = (battleId: string): void => {
    const seat = pveSeats.get(battleId);
    if (seat === undefined) return;
    const host = battles.get(battleId);
    const pack = PACKS[seat.packId];
    if (host === undefined || pack === undefined) return;
    for (let guard = 0; guard < 8; guard++) {
      const obs = host.observe(seat.boss);
      const d = obs.decision;
      if (d === null || !d.actors.includes(obs.side)) return;
      const pick = d.kind === "replacement"
        ? (obs.legalActions.find((a) => a.actionId.startsWith("act_switch-"))?.actionId ?? "act_concede")
        : decideBaseline(pack, obs).actionId;
      const r = host.submit(seat.boss, {
        schemaVersion: 1, battleId, decisionId: d.decisionId,
        baseRevision: d.baseRevision, actionId: pick,
        idempotencyKey: `bot_${battleId}_${d.decisionId}`,
      });
      if (!r.ok) return;
    }
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const playerFor = (token: string, battleId: string): string | null => {
    const binding = tokens.get(token);
    return binding?.battleId === battleId ? binding.playerId : null;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      if (path.startsWith("/api/content/")) {
        // 公开规则知识：pack 的 moves/units 元数据（玩家有权查规则——lookup_rule 的 HTTP 等价）
        const packId = path.slice("/api/content/".length);
        const pack = PACKS[packId];
        if (!pack) return json(res, 404, { code: "NOT_FOUND", message: "pack" });
        return json(res, 200, {
          packId,
          moves: Object.fromEntries(
            [...pack.movesById.values()].map((m) => {
              const dmg = m.effects.find((e) => e.op === "damage") as { power?: number; kind?: string } | undefined;
              return [m.id, {
                label: m.id,
                power: dmg?.power ?? 0,
                damageKind: dmg?.kind ?? "standard",
                ops: m.effects.map((e) => e.op),
              }];
            }),
          ),
          units: Object.fromEntries(
            [...pack.unitsById.values()].map((u) => [u.id, { speciesId: u.id, hp: u.base.hp }]),
          ),
        });
      }

      if (path === "/api/battle") {
        if (req.method !== "POST") return json(res, 405, { code: "INVALID_SCHEMA" });
        const input = parseCreateBattle(await readJsonBody(req));
        const packId = input.pack ?? DEFAULT_PACK_ID;
        const pack = PACKS[packId];
        const generationId = generationByPackId.get(packId);
        if (generationId === undefined || pack === undefined) throw new TransportError(400, `unknown pack ${packId}`);
        // team（有序）→ species+bench 展开；缺省 species 走默认
        let species = input.species;
        let bench = input.bench;
        if (input.team !== undefined) {
          const t1 = teamToConfig(pack, input.team.p1);
          const t2 = teamToConfig(pack, input.team.p2);
          species = { p1: t1.species, p2: t2.species };
          bench = { ...(t1.bench !== undefined ? { p1: t1.bench } : {}), ...(t2.bench !== undefined ? { p2: t2.bench } : {}) };
        }
        const battleId = `btl_${(++battleCounter).toString(16)}`;
        const pve = input.mode === "pve";
        const players = { p1: `p1_${battleId}`, p2: pve ? `bot_${battleId}` : `p2_${battleId}` };
        battles.create({
          battleId,
          seedHex: input.seedHex,
          species,
          ...(bench !== undefined ? { bench } : {}),
          generationId,
          players,
          deadlineMs: input.deadlineMs,
        });
        const p1 = `tok_${randomBytes(16).toString("hex")}`;
        tokens.set(p1, { battleId, playerId: players.p1 });
        if (pve) {
          // bot 席位不发 token——外部永远无法扮演 p2
          pveSeats.set(battleId, { boss: players.p2, packId });
          drivePve(battleId); // t1 决策已开
          return json(res, 200, { battleId, mode: "pve", tokens: { p1 } });
        }
        const p2 = `tok_${randomBytes(16).toString("hex")}`;
        tokens.set(p2, { battleId, playerId: players.p2 });
        return json(res, 200, { battleId, tokens: { p1, p2 } });
      }

      const match = path.match(/^\/api\/battle\/([^/]+)\/(observe|history|submit|ack|resync)$/);
      if (match) {
        const battleId = match[1]!;
        const op = match[2]!;
        const host = battles.get(battleId);
        if (!host) return json(res, 404, { code: "NOT_FOUND", message: "battle" });

        if (op === "observe" || op === "history" || op === "resync") {
          if (req.method !== "GET") return json(res, 405, { code: "INVALID_SCHEMA" });
          const token = parseToken(url.searchParams.get("player"));
          const playerId = playerFor(token, battleId);
          if (!playerId) return json(res, 401, { code: "UNAUTHORIZED" });
          if (op === "observe") return json(res, 200, host.observe(playerId));
          const since = parseCursor(url.searchParams.get("since"));
          if (op === "history") {
            const slowMs = parseDelay(url.searchParams.get("slow"));
            if (slowMs > 0) await sleep(slowMs);
            return json(res, 200, host.history(playerId, since));
          }
          return json(res, 200, host.resync(playerId, since));
        }

        if (op === "submit") {
          if (req.method !== "POST") return json(res, 405, { code: "INVALID_SCHEMA" });
          const input = parseSubmit(battleId, await readJsonBody(req));
          const playerId = playerFor(input.token, battleId);
          if (!playerId) return json(res, 401, { code: "UNAUTHORIZED" });
          const result = host.submit(playerId, input.command);
          if (!result.ok) return json(res, 200, { ok: false, code: result.error.code, message: result.error.message });
          drivePve(battleId); // 玩家提交后 bot 立即回应（resolve 已内联发生）
          return json(res, 200, { ok: true, receipt: result.receipt });
        }

        if (req.method !== "POST") return json(res, 405, { code: "INVALID_SCHEMA" });
        const input = parseAck(await readJsonBody(req));
        const playerId = playerFor(input.token, battleId);
        if (!playerId) return json(res, 401, { code: "UNAUTHORIZED" });
        return json(res, 200, { cursor: host.ack(playerId, input.seq) });
      }

      const file = path === "/" ? "index.html" : path.slice(1);
      const full = join(CLIENT_DIST, file);
      if (existsSync(full) && !file.includes("..")) {
        const ext = `.${file.split(".").pop()}`;
        res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
        return res.end(readFileSync(full));
      }
      res.writeHead(404);
      res.end("not found");
    } catch (error) {
      if (error instanceof TransportError) return json(res, error.status, { code: error.code, message: error.message });
      if (error instanceof TeamError) return json(res, 400, { code: error.code, message: error.message });
      if (error instanceof HostError) {
        const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "NOT_FOUND" ? 404 : 400;
        return json(res, status, { code: error.code, message: error.message });
      }
      return json(res, 500, { code: "ENGINE_FAULT", message: String(error) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address() as { port: number };
  let closed = false;
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    battles,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await plugins.disposeAll();
      store.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8787);
  startServer(port).then((server) => console.log(`seer host-server @ ${server.url}`));
}
