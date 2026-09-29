/**
 * plugins/content.ts —— 内容域插件：装载规则包目录 + 公开规则知识端点。
 * `content.catalog` 服务被 battle/world 插件 require（species 校验、generation 定位）。
 */
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import { deriveBaseFor, effectivenessOf, MECHANICS, type FrozenPack } from "@seer/battle-core";
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
              // 克制矩阵：招式属性 × 包内每种守方精灵属性 → eff（公开规则知识）
              const effVs = pack.typeChart !== undefined && m.type !== undefined && dmg !== undefined && (dmg.kind === undefined || dmg.kind === "standard" || dmg.kind === "true")
                ? Object.fromEntries(
                    [...pack.unitsById.values()]
                      .filter((u) => u.types !== undefined)
                      .map((u) => [u.id, effectivenessOf(pack.typeChart!, m.type!, u.types!) / 16]),
                  )
                : undefined;
              return [m.id, {
                label: m.id,
                power: dmg?.power ?? 0,
                damageKind: dmg?.kind ?? "standard",
                ...(m.type !== undefined ? { type: m.type } : {}),
                ...(effVs !== undefined ? { effVs } : {}),
                pp: m.pp,
                priority: m.priority,
                ...(m.category !== undefined ? { category: m.category } : {}),
                ops: m.effects.map((e) => e.op),
                effects: m.effects,
              }];
            }),
          ),
          units: Object.fromEntries(
            [...pack.unitsById.values()].map((u) => [
              u.id,
              (() => {
                // 机制面板推导（six-stat）：默认养成的面板六维 + 等级/性格（内容公开数据，非对局隐藏信息）
                const panel = deriveBaseFor(pack, u);
                return {
                  speciesId: u.id,
                  name: u.name,
                  hp: panel?.hp ?? u.base.hp,
                  ...(panel !== undefined
                    ? { level: u.level ?? 100, nature: u.nature, stats: panel }
                    : {}),
                ...(u.types !== undefined ? { types: u.types } : {}),
                // 预设刻印（物种默认 loadout——如 boss 预装）
                ...(u.seals !== undefined && u.seals.length > 0 ? { seals: u.seals } : {}),
                };
              })(),
            ]),
          ),
          // 机制内容片段：各注册模块贡献公开知识（如刻印图鉴库+佩戴规则）。
          ...Object.assign({}, ...MECHANICS.map((m) => m.meta?.(pack) ?? {})),
        });
      });
    },
  };
}
