/**
 * plugins/content.ts —— 内容域插件：装载规则包目录 + 公开规则知识端点。
 * `content.catalog` 服务被 battle/world 插件 require（species 校验、generation 定位）。
 */
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import type { FrozenPack } from "@seer/battle-core";
import { HTTP_ROUTER_SERVICE, type Router } from "../router.ts";

export const CONTENT_CATALOG_SERVICE = "content.catalog";

export interface ContentCatalog {
  packs: Record<string, FrozenPack>;
  generationByPackId: Map<string, string>;
  defaultPackId: string;
}

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "content",
  version: "1.0.0",
  name: "Content Catalog",
  kind: "content",
  requestedCapabilities: [],
  requires: [{ service: HTTP_ROUTER_SERVICE, versionRange: "*" }],
  entrypoints: { module: "plugins/content/index.js" },
};

export function contentPlugin(catalog: ContentCatalog): PluginSpec {
  return {
    manifest: MANIFEST,
    provides: [CONTENT_CATALOG_SERVICE],
    setup: (ctx: SeerPluginContext) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      const route = (m: string, t: string, h: Parameters<Router["register"]>[3]) => ctx.own(router.register("content", m, t, h));
      ctx.provide(CONTENT_CATALOG_SERVICE, catalog);

      route("GET", "/api/content/:packId", (r) => {
        const packId = r.params["packId"]!;
        const pack = catalog.packs[packId];
        if (!pack) return r.json(404, { code: "NOT_FOUND", message: "pack" });
        r.json(200, {
          packId,
          moves: Object.fromEntries(
            [...pack.movesById.values()].map((m) => {
              const dmg = m.effects.find((e) => e.op === "damage") as { power?: number; kind?: string } | undefined;
              return [m.id, {
                label: m.id,
                power: dmg?.power ?? 0,
                damageKind: dmg?.kind ?? "standard",
                pp: m.pp,
                priority: m.priority,
                ops: m.effects.map((e) => e.op),
                effects: m.effects,
              }];
            }),
          ),
          units: Object.fromEntries(
            [...pack.unitsById.values()].map((u) => [u.id, { speciesId: u.id, hp: u.base.hp }]),
          ),
        });
      });
    },
  };
}
