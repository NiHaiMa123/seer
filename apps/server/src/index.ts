/**
 * index.ts —— server 装配根（composition root）。
 * 只做三件事：建基础设施（store/generations/manager）、按 profile 装插件、把请求交给路由注册表。
 * 功能域全部是插件：content / battle-manager / battle-api / world-api / static-web。
 * 加一个域 = 写 PluginSpec + 进 profile；删一个域 = profile 去掉它（端点随之消失）。
 */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PACKS = Object.fromEntries(
  ["synthetic-v1", "synthetic-v2"].map((id) => [id, loadPackFromDir(join(ROOT, "content"), id)]),
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
  const worldDbPath = dbPath === undefined
    ? join(mkdtempSync(join(tmpdir(), "seer-wld-")), "world.db")
    : dbPath.replace(/battle\.db$/, "world.db");
  const world = new WorldService(new WorldStore(worldDbPath));
  const artifacts = new RuntimeArtifactCatalog(Object.values(PACKS));
  const generations = new RuntimeGenerationRegistry();
  const generationByPackId = new Map<string, string>();
  for (const [packId, pack] of Object.entries(PACKS)) {
    generationByPackId.set(packId, generationIdOf(pack));
    await generations.activate(pack);
  }
  const manager = new BattleManager(store, generations, artifacts);
  const catalog: ContentCatalog = { packs: PACKS, generationByPackId, defaultPackId: "synthetic-v1" };

  // 插件装配：基础设施服务由 host 直接 provide，功能域走 loadPlugin（依赖在执行入口前校验）
  const plugins = new PluginHost();
  const router = new Router();
  plugins.provideService(HTTP_ROUTER_SERVICE, router);
  plugins.provideService(WORLD_SERVICE_KEY, world);
  const excluded = new Set(opts?.exclude ?? []);
  const modules = [...defaultModulesFor(manager, catalog), ...(opts?.extra ?? [])]
    .filter((m) => !excluded.has(m.spec.manifest.pluginId));
  for (const m of modules) await plugins.loadPlugin(m.spec, m.policy);
  const battles = plugins.require<BattleManager>(BATTLE_MANAGER_SERVICE);

  const server = createServer(async (req, res) => {
    try {
      const handled = await router.dispatch(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end("not found");
      }
    } catch (error) {
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

  await new Promise<void>((resolve) => server.listen(port, resolve));
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
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await plugins.disposeAll();
      store.close();
    },
  };
}

function defaultModulesFor(manager: BattleManager, catalog: ContentCatalog): ModuleEntry[] {
  return [
    { spec: contentPlugin(catalog), policy: { grantedCapabilities: [] } },
    { spec: battleManagerPlugin(manager), policy: BATTLE_MANAGER_POLICY },
    { spec: battleApiPlugin(), policy: BATTLE_API_POLICY },
    { spec: worldApiPlugin(), policy: WORLD_API_POLICY },
    { spec: staticPlugin(CLIENT_DIST), policy: STATIC_POLICY },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8787);
  startServer(port).then((server) => console.log(`seer host-server @ ${server.url}`));
}
