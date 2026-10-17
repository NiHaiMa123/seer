/**
 * plugins/localbag.ts —— 本地背包域插件：队伍/刻印/技能携带落盘项目文件。
 * `data/local-team.json` 是唯一权威——web 端读写给服务端，服务端直写文件，
 * 刷新/换浏览器/重开进程不丢编队（localStorage 只是展示层缓存）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { PluginManifest } from "@seer/contracts";
import type { PluginSpec, SeerPluginContext } from "@seer/plugin-runtime";
import { HTTP_ROUTER_SERVICE, type Router } from "../router.ts";
import { readJsonBody } from "../transport.ts";

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "local-bag",
  version: "1.0.0",
  name: "Local Bag",
  kind: "service",
  requestedCapabilities: [],
  requires: [{ service: HTTP_ROUTER_SERVICE, versionRange: "*" }],
  entrypoints: { module: "plugins/localbag/index.js" },
};

const MAX_TEAM = 12;

interface LocalTeam {
  team: string[];
  loadout: Record<string, string[]>;
  carried: Record<string, string[]>;
}

const EMPTY: LocalTeam = { team: [], loadout: {}, carried: {} };

function sanitize(input: unknown): LocalTeam {
  if (input === null || typeof input !== "object") return EMPTY;
  const o = input as Record<string, unknown>;
  const team = Array.isArray(o["team"]) ? o["team"].filter((x): x is string => typeof x === "string").slice(0, MAX_TEAM) : [];
  const map = (v: unknown): Record<string, string[]> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, arr] of Object.entries(v)) {
      if (Array.isArray(arr)) out[k] = arr.filter((x): x is string => typeof x === "string");
    }
    return out;
  };
  return { team, loadout: map(o["loadout"]), carried: map(o["carried"]) };
}

export function localBagPlugin(filePath: string): PluginSpec {
  const read = (): LocalTeam => {
    if (!existsSync(filePath)) return EMPTY;
    try {
      return sanitize(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      return EMPTY; // 损坏文件按空背包处理——不挡服务启动
    }
  };
  const write = (next: LocalTeam): void => {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, filePath); // 原子替换——写一半断电不毁旧档
  };
  return {
    manifest: MANIFEST,
    setup: (ctx: SeerPluginContext) => {
      const router = ctx.require<Router>(HTTP_ROUTER_SERVICE);
      const route = (m: string, t: string, h: Parameters<Router["register"]>[3]) => ctx.own(router.register("local-bag", m, t, h));
      route("GET", "/api/local/team", (r) => r.json(200, read()));
      route("PUT", "/api/local/team", async (r) => {
        const next = sanitize(await readJsonBody(r.req));
        write(next);
        r.json(200, { ok: true });
      });
    },
  };
}
