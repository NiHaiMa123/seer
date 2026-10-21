/**
 * index.ts —— server 装配根（composition root）。
 * 只做三件事：建基础设施（store/generations/manager）、按 profile 装插件、把请求交给路由注册表。
 * 功能域全部是插件：content / battle-manager / battle-api / world-api / static-web。
 * 加一个域 = 写 PluginSpec + 进 profile；删一个域 = profile 去掉它（端点随之消失）。
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleManager, BattleStore, HostError, RuntimeArtifactCatalog, RuntimeGenerationRegistry, TeamError, generationIdOf } from "@seer/host";
import { WorldError, WorldService, WorldStore } from "@seer/world";
import {
  BATTLE_MANAGER_POLICY,
  BATTLE_MANAGER_SERVICE,
  PluginHost,
  battleManagerPlugin,
  type LoadPolicy,
  type PluginSpec,
} from "@seer/plugin-runtime";
import { TransportError } from "./transport.ts";
import { HTTP_ROUTER_SERVICE, Router } from "./router.ts";
import { contentPlugin, CONTENT_CATALOG_SERVICE, type ContentCatalog } from "./plugins/content.ts";
import { battleApiPlugin, BATTLE_API_POLICY } from "./plugins/battle.ts";
import { worldApiPlugin, WORLD_API_POLICY, WORLD_SERVICE_KEY } from "./plugins/world.ts";
import { staticPlugin, STATIC_POLICY } from "./plugins/static.ts";
import { localBagPlugin } from "./plugins/localbag.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKS = Object.fromEntries(
  ["synthetic-v1", "synthetic-v2", "peak"].map((id) => [id, loadPackFromDir(join(ROOT, "content"), id)]),
);
const CLIENT_DIST = join(ROOT, "apps", "client");

export interface ServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
  battles: BattleManager;
  plugins: PluginHost;
  router: Router;
}

export interface ModuleEntry {
  spec: PluginSpec;
  policy: LoadPolicy;
}

export async function startServer(port = 0, dbPath?: string, opts?: { exclude?: string[]; extra?: ModuleEntry[] }): Promise<ServerHandle> {
  const db = dbPath ?? join(mkdtempSync(join(tmpdir(), "seer-srv-")), "battle.db");
  const store = new BattleStore(db);
  const plugins = new PluginHost();
  let worldStore: WorldStore | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let released = false;
  const releaseResources = async () => {
    if (released) return;
    released = true;
    try { await plugins.disposeAll(); }
    finally { try { worldStore?.close(); } finally { store.close(); } }
  };
  try {
    const worldDbPath = db === ":memory:" ? ":memory:"
      : join(dirname(db), basename(db) === "world.db" ? "world-state.db" : "world.db");
    worldStore = new WorldStore(worldDbPath);
    const world = new WorldService(worldStore);
    const localTeamPath = join(db === ":memory:" ? mkdtempSync(join(tmpdir(), "seer-team-")) : dirname(db), "local-team.json");
    const artifacts = new RuntimeArtifactCatalog(Object.values(PACKS));
    // 每个已装载规则包各占一代。默认上限是 2，第三包会一直排队，启动卡死。
    const generations = new RuntimeGenerationRegistry(Object.keys(PACKS).length);
    const generationByPackId = new Map<string, string>();
    for (const [packId, pack] of Object.entries(PACKS)) {
      generationByPackId.set(packId, generationIdOf(pack));
      await generations.activate(pack);
    }
    const manager = new BattleManager(store, generations, artifacts);
    const catalog: ContentCatalog = { packs: PACKS, generationByPackId, defaultPackId: "synthetic-v1" };

    // 插件装配：基础设施服务由 host 直接 provide，功能域走 loadPlugin（依赖在执行入口前校验）
    const router = new Router();
    plugins.provideService(HTTP_ROUTER_SERVICE, router);
    plugins.provideService(WORLD_SERVICE_KEY, world);
    const excluded = new Set(opts?.exclude ?? []);
    const modules = [...defaultModulesFor(manager, catalog, localTeamPath), ...(opts?.extra ?? [])]
      .filter((m) => !excluded.has(m.spec.manifest.pluginId));
    for (const m of modules) await plugins.loadPlugin(m.spec, m.policy);
    const battles = plugins.require<BattleManager>(BATTLE_MANAGER_SERVICE);

    server = createServer(async (req, res) => {
      try {
        const handled = await router.dispatch(req, res);
        if (!handled) {
          res.writeHead(404);
          res.end("not found");
        }
      } catch (error) {
        // handler 已写响应后抛错——头不可再写，仅收尾并记录（否则 ERR_HTTP_HEADERS_SENT 打挂进程）
        if (res.headersSent) {
          console.error("post-response handler error:", error);
          res.end();
          return;
        }
        const json = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (error instanceof TransportError) return json(error.status, { code: error.code, message: error.message });
        if (error instanceof TeamError) return json(400, { code: error.code, message: error.message });
        if (error instanceof HostError || error instanceof WorldError) {
          const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "NOT_FOUND" ? 404 : 400;
          return json(status, { code: error.code, message: error.message });
        }
        return json(500, { code: "ENGINE_FAULT", message: String(error) });
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server!.once("error", onError);
      server!.listen(port, () => { server!.off("error", onError); resolve(); });
    });
    const address = server.address() as { port: number };
    let closed = false;
    return {
      port: address.port,
      url: `http://127.0.0.1:${address.port}`,
      battles,
      plugins,
      router,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
        } finally { await releaseResources(); }
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await releaseResources().catch(() => {});
    throw error;
  }
}

function defaultModulesFor(manager: BattleManager, catalog: ContentCatalog, localTeamPath: string): ModuleEntry[] {
  return [
    { spec: contentPlugin(catalog), policy: { grantedCapabilities: [] } },
    { spec: battleManagerPlugin(manager), policy: BATTLE_MANAGER_POLICY },
    { spec: battleApiPlugin(), policy: BATTLE_API_POLICY },
    { spec: worldApiPlugin(), policy: WORLD_API_POLICY },
    { spec: localBagPlugin(localTeamPath), policy: { grantedCapabilities: [] } },
    { spec: staticPlugin(CLIENT_DIST), policy: STATIC_POLICY },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8787);
  // CLI 默认用稳定库路径——对局/令牌/世界归属跨进程重启可恢复（测试仍走临时库）
  const dbDir = join(ROOT, "data");
  mkdirSync(dbDir, { recursive: true });
  startServer(port, join(dbDir, "battle.db")).then((server) => console.log(`seer host-server @ ${server.url}`));
}
