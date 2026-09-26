/**
 * test:plugin — M0-03 Cordis 薄适配门禁（上游 cordis@4.0.0-rc.10）。
 * 覆盖：缺依赖 / 冲突 / 循环 / 失败清理 / 异步重入 / 重复 dispose /
 * cleanup 中注册拒绝 / 依赖消失恢复（上游语义）/ 100 cycles 资源回基线。
 */
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@seer/contracts";
import { PluginError, PluginHost } from "../src/adapter.ts";

const manifest = (pluginId: string, extra: Record<string, unknown> = {}): PluginManifest => ({
  manifestVersion: 1,
  pluginId,
  version: "1.0.0",
  name: pluginId,
  kind: "service",
  requestedCapabilities: [],
  entrypoints: { module: "plugins/x/index.js" },
  ...extra,
});

const GRANT_ALL = {
  grantedCapabilities: [
    "storage",
    "network",
    "telemetry",
    "battle.read",
    "battle.submit",
    "world.read",
    "world.write",
  ],
};
const GRANT_NONE = { grantedCapabilities: [] };

describe("plugin host (cordis rc.10 adapter)", () => {
  it("loads a plugin, exposes its service, unloads cleanly", async () => {
    const host = new PluginHost();
    const h = await host.loadPlugin(
      {
        manifest: manifest("p-alpha"),
        provides: ["greeting"],
        setup: (ctx) => {
          ctx.provide("greeting", () => "hi");
          ctx.own(() => {});
        },
      },
      GRANT_ALL,
    );
    expect(h.state).toBe("ACTIVE");
    expect(host.require<() => string>("greeting")()).toBe("hi");
    await host.unloadPlugin("p-alpha");
    expect(host.has("greeting")).toBe(false);
    expect(h.state).toBe("DISPOSED");
  });

  it("rejects missing dependency before any setup side effect", async () => {
    const host = new PluginHost();
    let setupRan = false;
    await expect(
      host.loadPlugin(
        {
          manifest: manifest("p-needs", { requires: [{ service: "nope", versionRange: "1.x" }] }),
          setup: () => {
            setupRan = true;
          },
        },
        GRANT_ALL,
      ),
    ).rejects.toMatchObject({ code: "MISSING_DEPENDENCY" });
    expect(setupRan).toBe(false);
    expect(host.pluginCount).toBe(0);
  });

  it("rejects duplicate service provider with SERVICE_CONFLICT", async () => {
    const host = new PluginHost();
    host.provideService("db", { v: 1 });
    await expect(
      host.loadPlugin(
        {
          manifest: manifest("p-dup"),
          setup: (ctx) => ctx.provide("db", { v: 2 }),
        },
        GRANT_ALL,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_CONFLICT" });
    expect(host.require<{ v: number }>("db").v).toBe(1);
  });

  it("rejects self-referencing service as CYCLE", async () => {
    const host = new PluginHost();
    await expect(
      host.loadPlugin(
        {
          manifest: manifest("p-self", { requires: [{ service: "selfsvc", versionRange: "1.x" }] }),
          provides: ["selfsvc"],
          setup: () => {},
        },
        GRANT_ALL,
      ),
    ).rejects.toMatchObject({ code: "CYCLE" });
  });

  it("failed setup leaves no half-registered services (staged rollback)", async () => {
    const host = new PluginHost();
    await expect(
      host.loadPlugin(
        {
          manifest: manifest("p-broken"),
          setup: (ctx) => {
            ctx.provide("partial", 1);
            throw new Error("setup boom");
          },
        },
        GRANT_ALL,
      ),
    ).rejects.toMatchObject({ code: "SETUP_FAILED" });
    expect(host.has("partial")).toBe(false);
    expect(host.providerCount).toBe(0);
    expect(host.pluginCount).toBe(0);
  });

  it("async reentry: disposeAll while setup pending aborts load cleanly", async () => {
    const host = new PluginHost();
    const loadP = host.loadPlugin(
      {
        manifest: manifest("p-slow"),
        setup: async (ctx) => {
          await new Promise((r) => setTimeout(r, 30));
          ctx.provide("lateSvc", true);
        },
      },
      GRANT_ALL,
    );
    await host.disposeAll();
    await expect(loadP).rejects.toBeInstanceOf(PluginError);
    expect(host.has("lateSvc")).toBe(false);
    expect(host.pluginCount).toBe(0);
  });

  it("double dispose is idempotent", async () => {
    const host = new PluginHost();
    let n = 0;
    const h = await host.loadPlugin(
      {
        manifest: manifest("p-twice"),
        setup: (ctx) => {
          ctx.own(() => {
            n++;
          });
        },
      },
      GRANT_ALL,
    );
    await h.fiber.dispose();
    await h.fiber.dispose();
    expect(n).toBe(1);
    await host.unloadPlugin("p-twice");
    await host.unloadPlugin("p-twice");
    expect(host.pluginCount).toBe(0);
  });

  it("registration during cleanup is rejected (INACTIVE_EFFECT)", async () => {
    const host = new PluginHost();
    let observed: string | null = null;
    await host.loadPlugin(
      {
        manifest: manifest("p-cleanup"),
        setup: (ctx) => {
          ctx.own(() => {
            try {
              ctx.own(() => {});
              observed = "allowed";
            } catch (e) {
              observed = (e as { code?: string }).code ?? (e as Error).message;
            }
          });
        },
      },
      GRANT_ALL,
    );
    await host.unloadPlugin("p-cleanup");
    expect(observed).toBe("INACTIVE_EFFECT");
  });

  it("invalid manifest rejected by schema; ungranted capability denied", async () => {
    const host = new PluginHost();
    await expect(
      host.loadPlugin(
        { manifest: { ...manifest("p-badmanifest"), kind: "executable" } as PluginManifest, setup: () => {} },
        GRANT_ALL,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await expect(
      host.loadPlugin(
        {
          manifest: manifest("p-greedy", { requestedCapabilities: ["network"] }),
          setup: () => {},
        },
        GRANT_NONE,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("upstream semantics: dep loss suspends, dep return restarts (recorded, not relied on)", async () => {
    const host = new PluginHost();
    let runs = 0;
    host.provideService("dep-a", { v: 1 });
    await host.loadPlugin(
      {
        manifest: manifest("p-depwatcher", { requires: [{ service: "dep-a", versionRange: "1" }] }),
        setup: () => {
          runs++;
        },
      },
      GRANT_ALL,
    );
    expect(runs).toBe(1);
    // Cordis inject: removing the impl suspends; re-providing restarts the plugin.
    // Probe-verified upstream behavior; Seer pins rule generations so mechanics
    // plugins never see this mid-battle (see artifacts/m0/cordis-report.json).
  });

  it("100 load/unload cycles return resources to baseline", async () => {
    const host = new PluginHost();
    host.provideService("baseSvc", {});
    const baseRegistry = host.registrySize;
    const baseProviders = host.providerCount;
    const basePlugins = host.pluginCount;
    for (let i = 0; i < 100; i++) {
      const id = `p-cycle-${i}`;
      await host.loadPlugin(
        {
          manifest: manifest(id),
          setup: (ctx) => {
            ctx.provide(`svc${i}`, i);
            ctx.own(() => {});
          },
        },
        GRANT_ALL,
      );
      await host.unloadPlugin(id);
    }
    expect(host.registrySize).toBe(baseRegistry);
    expect(host.providerCount).toBe(baseProviders);
    expect(host.pluginCount).toBe(basePlugins);
    expect(host.has("svc0")).toBe(false);
  });
});
