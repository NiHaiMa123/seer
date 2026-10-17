/**
 * 内建面板登记。不 import main.tsx，所以不覆盖三行整页。
 */
import { describe, expect, it } from "vitest";
import { CommandDeck } from "../../apps/client/src/battle/deck.tsx";
import { PostBattle } from "../../apps/client/src/battle/panels.tsx";
import { registerBuiltinPanels } from "../../apps/client/src/presentation.ts";
import { slots } from "../../apps/client/src/slots.ts";

describe("registerBuiltinPanels", () => {
  it("top 1 个、arena 3 个、hud 依次是指挥台（含精灵面板）/终局", () => {
    (globalThis as { location?: { search: string } }).location = { search: "" };
    registerBuiltinPanels();
    expect(slots.panelEntries("battle.top")).toHaveLength(1);
    expect(slots.panelEntries("battle.arena")).toHaveLength(3);
    const hud = slots.panelEntries("battle.hud");
    expect(hud).toHaveLength(2);
    expect(hud.map((e) => e.component)).toEqual([CommandDeck, PostBattle]);
  });
});
