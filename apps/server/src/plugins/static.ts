/**
 * plugins/static.ts —— 静态托管插件：客户端 bundle/index.html。
 * 注册 catch-all（"*"）；headless profile 不装它即无 Web 端点。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import { HTTP_ROUTER_SERVICE, type Router } from "../router.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".map": "application/json",
};

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "static-web",
  version: "1.0.0",
  name: "Static Web",
  kind: "presentation",
  requestedCapabilities: ["storage"],
  requires: [{ service: HTTP_ROUTER_SERVICE, versionRange: "*" }],
  entrypoints: { module: "plugins/static/index.js" },
};

export const STATIC_POLICY = { grantedCapabilities: ["storage"] };

export function staticPlugin(clientRoot: string): PluginSpec {
  return {
    manifest: MANIFEST,
    setup: (ctx: SeerPluginContext) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      const route = (m: string, t: string, h: Parameters<Router["register"]>[3]) => ctx.own(router.register("static-web", m, t, h));
      // 最低优先级 catch-all：必须最后注册
      route("*", "*", (r) => {
        if (r.method !== "GET") {
          r.res.writeHead(404);
          r.res.end("not found");
          return;
        }
        const file = r.path === "/" ? "index.html" : r.path.slice(1);
        const full = join(clientRoot, file);
        if (existsSync(full) && !file.includes("..")) {
          const ext = `.${file.split(".").pop()}`;
          r.res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
          r.res.end(readFileSync(full));
          return;
        }
        r.res.writeHead(404);
        r.res.end("not found");
      });
    },
  };
}
