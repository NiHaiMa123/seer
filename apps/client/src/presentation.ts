/**
 * 战斗页内建面板。新面板在这里加一行，不进 main.tsx 的出招循环。
 * 不 import main.tsx。整页（lobby/world/battle）仍由 main 登记。
 */
import { slots } from "./slots.ts";
import { CommandDeck } from "./battle/deck.tsx";
import { FieldLog, ArenaBanners } from "./battle/feed.tsx";
import { ArenaCards, HiddenStatus, PostBattle } from "./battle/panels.tsx";

export function registerBuiltinPanels(): void {
  slots.registerPanel("battle.top", HiddenStatus);
  slots.registerPanel("battle.arena", ArenaCards);
  slots.registerPanel("battle.arena", FieldLog);
  slots.registerPanel("battle.arena", ArenaBanners);
  slots.registerPanel("battle.hud", CommandDeck);
  slots.registerPanel("battle.hud", PostBattle);
}
