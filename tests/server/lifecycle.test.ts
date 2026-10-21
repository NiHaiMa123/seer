import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type ModuleEntry } from "../../apps/server/src/index.ts";
import { HTTP_ROUTER_SERVICE, type Router } from "../../apps/server/src/router.ts";
import { WorldStore } from "@seer/world";

afterEach(() => vi.restoreAllMocks());
const plugin = (id: string, setup: ModuleEntry["spec"]["setup"]): ModuleEntry => ({
  spec: { manifest: { manifestVersion: 1, pluginId: id, version: "1.0.0", name: id, kind: "service", requestedCapabilities: [], entrypoints: { module: `plugins/${id}/index.js` } }, setup },
  policy: { grantedCapabilities: [] },
});

describe("server 生命周期和插件路由", () => {
  it("后注册的插件路由不会被静态 catch-all 截走，错误方法返回 405", async () => {
    const server = await startServer(0, undefined, { extra: [plugin("late-route", (ctx) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      ctx.own(router.register("late-route", "POST", "/api/late", (r) => r.json(200, { ok: true })));
    })] });
    try {
      expect((await fetch(`${server.url}/api/late`, { method: "POST" })).status).toBe(200);
      expect((await fetch(`${server.url}/api/late`)).status).toBe(405);
      expect((await fetch(`${server.url}/api/battle/%ZZ/observe`)).status).toBe(400);
      expect((await fetch(`${server.url}/assets`)).status).toBe(404);
    } finally { await server.close(); }
  });

  it("后续插件装载失败会撤销前面插件的资源", async () => {
    const dispose = vi.fn();
    await expect(startServer(0, undefined, { extra: [
      plugin("loaded-probe", (ctx) => { ctx.own(dispose); }),
      plugin("failed-probe", () => { throw new Error("setup failed"); }),
    ] })).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("监听失败正常 reject 并释放世界数据库；正常关闭也释放一次", async () => {
    const close = vi.spyOn(WorldStore.prototype, "close");
    const first = await startServer(0);
    try {
      await expect(startServer(first.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(close).toHaveBeenCalledTimes(1);
    } finally { await first.close(); }
    expect(close).toHaveBeenCalledTimes(2);
    await first.close();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("自定义数据库名仍有独立世界库和队伍文件，不写项目共享存档", async () => {
    const dir1 = mkdtempSync(join(tmpdir(), "seer-iso-")), dir2 = mkdtempSync(join(tmpdir(), "seer-iso-"));
    const first = await startServer(0, join(dir1, "custom.db"));
    const second = await startServer(0, join(dir2, "custom.db"));
    try {
      await fetch(`${first.url}/api/local/team`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: ["pet-one"], loadout: {}, carried: {} }) });
      expect(await (await fetch(`${second.url}/api/local/team`)).json()).toMatchObject({ team: [] });
      expect(existsSync(join(dir1, "world.db"))).toBe(true);
      expect(existsSync(join(dir1, "local-team.json"))).toBe(true);
    } finally { await first.close(); await second.close(); }
  });
});
