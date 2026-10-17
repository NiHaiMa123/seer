/**
 * ui/art.ts —— 美术资源索引（assets/ui，Krea2 生成后抠图压缩）。物品/刻印按 id → kind 回落，缺图不报错。
 */
import type { ItemMeta } from "../meta.ts";

const A = "/assets/ui/";
export const ART = {
  bgHome: `${A}bg_home.webp`,
  bgLab: `${A}bg_lab.webp`,
  bgBag: `${A}bg_bag.webp`,
  navBattle: `${A}nav_battle.webp`,
  navStorage: `${A}nav_storage.webp`,
  navBag: `${A}nav_bag.webp`,
};

const ITEM_ART: Record<string, string> = {
  "hp-200": "item_hp200", "hp-250": "item_hp250", "pp-20": "item_pp20", "pp-5": "item_pp5", cure: "item_cure",
};
const KIND_ART: Record<ItemMeta["kind"], string> = { hp: "item_hp200", pp: "item_pp20", cleanse: "item_cure" };

export function itemArt(it: Pick<ItemMeta, "id" | "kind">): string {
  return `${A}${ITEM_ART[it.id] ?? KIND_ART[it.kind] ?? "item_hp200"}.webp`;
}

/** 物品品质：持有上限、回复量越高越稀有（用于卡面描边色，非数值规则） */
export function itemRarity(it: ItemMeta): "n" | "r" | "sr" | "ssr" {
  if (it.cleanse === true) return "ssr";
  if ((it.heal ?? 0) >= 250 || (it.pp ?? 0) >= 20) return "sr";
  if (it.clearDown === true) return "sr";
  return "r";
}

export const ITEM_KIND_ZH: Record<ItemMeta["kind"], string> = { hp: "体力药剂", pp: "活力药剂", cleanse: "净化药水" };

const SEAL_ART: Record<string, string> = { 全能刻印: "seal_all", 能力刻印: "seal_stat", 技能刻印: "seal_skill", 通用刻印: "seal_common" };
export const sealArt = (type: string): string => `${A}${SEAL_ART[type] ?? "seal_common"}.webp`;
export const SEAL_TONE: Record<string, "ssr" | "r" | "sr" | "n"> = { 全能刻印: "ssr", 能力刻印: "r", 技能刻印: "sr", 通用刻印: "n" };
