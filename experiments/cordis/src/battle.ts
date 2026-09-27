import type { PluginManifest } from "@seer/contracts";
import type { BattleManager } from "@seer/host";
import type { LoadPolicy, PluginSpec } from "./adapter.ts";

export const BATTLE_MANAGER_SERVICE = "battle.manager";

const MANIFEST: PluginManifest = {
  manifestVersion: 1,
  pluginId: "battle-manager",
  version: "1.0.0",
  name: "Battle Manager",
  kind: "service",
  requestedCapabilities: ["storage", "battle.read", "battle.submit"],
  entrypoints: { module: "plugins/battle-manager/index.js" },
};

export const BATTLE_MANAGER_POLICY: LoadPolicy = {
  grantedCapabilities: ["storage", "battle.read", "battle.submit"],
};

export function battleManagerPlugin(manager: BattleManager): PluginSpec {
  return {
    manifest: MANIFEST,
    provides: [BATTLE_MANAGER_SERVICE],
    setup: (ctx) => ctx.provide(BATTLE_MANAGER_SERVICE, manager),
  };
}
