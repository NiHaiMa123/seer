/**
 * host-server —— M1-05 e2e 用最小 HTTP 权威端。
 * 无认证框架：建局返回两座位的 playerToken（p1/p2 绑定的唯一凭证）。
 * 轮询协议（observe/history/resync），提交带 idempotencyKey。
 * 静态文件服务 apps/client/dist + index.html。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost, HostError } from "@seer/host";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACK = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
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
  battles: Map<string, PersistedBattleHost>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => res(d));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startServer(port = 0, dbPath?: string): Promise<ServerHandle> {
  const db = dbPath ?? join(mkdtempSync(join(tmpdir(), "seer-srv-")), "battle.db");
  const store = new BattleStore(db);
  const battles = new Map<string, PersistedBattleHost>();
  const tokens = new Map<string, string>(); // token → "battleId:playerId"
  let seqCounter = 0;

  const json = (res: ServerResponse, code: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json" });
    res.end(s);
  };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const path = u.pathname;
    try {
      // --- API ---
      if (path === "/api/battle" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const battleId = `btl_${(++seqCounter).toString(16)}`;
        const h = PersistedBattleHost.create(store, {
          pack: PACK,
          battleId,
          seedHex: body.seedHex ?? "f".repeat(32),
          species: body.species ?? { p1: "syn-alpha", p2: "syn-beta" },
          players: { p1: `p1_${battleId}`, p2: `p2_${battleId}` },
          deadlineMs: body.deadlineMs ?? 30_000,
        });
        battles.set(battleId, h);
        const t1 = `tok_${battleId}_p1_${Math.random().toString(36).slice(2, 10)}`;
        const t2 = `tok_${battleId}_p2_${Math.random().toString(36).slice(2, 10)}`;
        tokens.set(t1, `${battleId}:p1_${battleId}`);
        tokens.set(t2, `${battleId}:p2_${battleId}`);
        return json(res, 200, { battleId, tokens: { p1: t1, p2: t2 } });
      }

      const m = path.match(/^\/api\/battle\/([^/]+)\/(observe|history|submit|ack|resync)$/);
      if (m) {
        const [, battleId, op] = m;
        const host = battles.get(battleId!);
        if (!host) return json(res, 404, { code: "NOT_FOUND", message: "battle" });
        const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : null;
        const player = u.searchParams.get("player") ?? (body?.player as string | undefined) ?? null;
        const playerId = player ? tokens.get(player)?.split(":")[1] : null;
        if (!playerId) return json(res, 401, { code: "UNAUTHORIZED" });

        // e2e 的 "mock 慢工具" 入口：?slow=ms 注入延迟（history 专用）
        const slowMs = Number(u.searchParams.get("slow") ?? "0");
        if (slowMs > 0 && op === "history") await sleep(Math.min(slowMs, 5_000));

        if (op === "observe") return json(res, 200, host.observe(playerId));
        if (op === "history") return json(res, 200, host.history(playerId, Number(u.searchParams.get("since") ?? 0)));
        if (op === "resync") return json(res, 200, host.resync(playerId, Number(u.searchParams.get("since") ?? 0)));
        if (op === "ack" && req.method === "POST") {
          return json(res, 200, { cursor: host.ack(playerId, Number(body.seq ?? 0)) });
        }
        if (op === "submit" && req.method === "POST") {
          const r = host.submit(playerId, {
            battleId: battleId!,
            decisionId: body.decisionId,
            actionId: body.actionId,
            baseRevision: body.baseRevision,
            idempotencyKey: body.idempotencyKey,
          });
          if (!r.ok) return json(res, 200, { ok: false, code: r.error.code, message: r.error.message });
          return json(res, 200, { ok: true, receipt: r.receipt });
        }
        return json(res, 405, { code: "INVALID_SCHEMA" });
      }

      // --- 静态 ---
      const file = path === "/" ? "index.html" : path.slice(1);
      const full = join(CLIENT_DIST, file);
      if (existsSync(full) && !file.includes("..")) {
        const ext = "." + file.split(".").pop();
        res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
        return res.end(readFileSync(full));
      }
      res.writeHead(404);
      res.end("not found");
    } catch (e) {
      const code = e instanceof HostError ? e.code : "ENGINE_FAULT";
      json(res, 500, { code, message: String(e) });
    }
  });

  await new Promise<void>((r) => server.listen(port, r));
  const addr = server.address() as { port: number };
  return {
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}`,
    battles,
    close: () =>
      new Promise((res) => {
        store.close();
        server.close(() => res());
      }),
  };
}

// 直接运行：node apps/server/src/index.ts [port]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8787);
  startServer(port).then((s) => console.log(`seer host-server @ ${s.url}`));
}
