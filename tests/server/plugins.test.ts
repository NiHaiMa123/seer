/**
 * 万物可插件验收：功能域 = Cordis 插件经 http.router 注册路由。
 * - exclude "world-api" → 世界端点整域 404，战斗域不受影响
 * - 运行中 unloadPlugin("world-api") → 路由即撤
 * - 缺依赖插件在执行入口前被拒（MISSING_DEPENDENCY），不留半成品
 */
import { describe, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/index.ts";
import { PluginError } from "@seer/plugin-runtime";
import type { PluginManifest } from "@seer/contracts";

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("server 插件化装配", () => {
  it("exclude world-api：世界端点 404，battle/content 正常", async () => {
    const server = await startServer(0, undefined, { exclude: ["world-api"] });
    try {
      const w = await post(`${server.url}/api/world/player`, { playerId: "wpl_t1", name: "t" });
      expect(w.status).toBe(404);
      // 战斗域不受影响
      const b = await (await post(`${server.url}/api/battle`, {
        pack: "synthetic-v1", seedHex: "aa".repeat(16),
      })).json() as { battleId: string };
      expect(b.battleId).toMatch(/^btl_/);
      // content 端点仍在
      const c = await fetch(`${server.url}/api/content/synthetic-v2`);
      expect(c.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("运行中 unloadPlugin：路由随插件消失", async () => {
    const server = await startServer(0);
    try {
      const ok = await post(`${server.url}/api/world/player`, { playerId: "wpl_t2", name: "t" });
      expect(ok.status).toBe(200);
      await server.plugins.unloadPlugin("world-api");
      const gone = await post(`${server.url}/api/world/player`, { playerId: "wpl_t3", name: "t" });
      expect(gone.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("缺依赖插件：MISSING_DEPENDENCY 拒绝且不留半成品", async () => {
    const manifest: PluginManifest = {
      manifestVersion: 1, pluginId: "orphan", version: "1.0.0", name: "Orphan",
      kind: "service", requestedCapabilities: [],
      requires: [{ service: "nonexistent.svc", versionRange: "*" }],
      entrypoints: { module: "plugins/orphan/index.js" },
    };
    await expect(startServer(0, undefined, {
      extra: [{ spec: { manifest, setup: () => {} }, policy: { grantedCapabilities: [] } }],
    })).rejects.toMatchObject({ code: "MISSING_DEPENDENCY" });
  });

  it("未授权能力：CAPABILITY_DENIED", async () => {
    const manifest: PluginManifest = {
      manifestVersion: 1, pluginId: "greedy", version: "1.0.0", name: "Greedy",
      kind: "service", requestedCapabilities: ["network"],
      entrypoints: { module: "plugins/greedy/index.js" },
    };
    await expect(startServer(0, undefined, {
      extra: [{ spec: { manifest, setup: () => {} }, policy: { grantedCapabilities: [] } }],
    })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });
});
