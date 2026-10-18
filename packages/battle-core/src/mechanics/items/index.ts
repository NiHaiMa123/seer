/**
 * items 机制：巅峰对决消耗品。每场开局按持有上限把目录填满，用掉一次少一个。
 * 删除本目录 + mechanics/index.ts 的注册行即卸载：开局不再写 stocks，道具动作不再合法。
 *
 * 数字来源（不另造）：
 * - 极限活力药剂 +20 PP、巅峰/极限体力药剂 +200/+250、龙的振奋药水解能力下降 +5 PP，
 *   百度百科写明可在巅峰对决使用或持有上限 5。
 * - 修的神奇药水：4399 / 专栏 cv6278378，巅峰奖章兑换，解除全部异常并恢复 170。
 *   百科没有单独的「持有上限」句；赛季奖励一次发 5 个，与上面那一系列的持有上限相同，这里用 5。
 * - 「恢复 N 点 PP」没有写每个技能都加，落地为玩家选定的一个技能，不超过该技能 PP 上限。
 * 完全净化药剂仅限雷小伊，不进这套通用目录。
 */
import Ajv from "ajv";
import itemsSchemaJson from "../../../../../content/schemas/items.schema.json" with { type: "json" };
import { sha256hex } from "../../sha256.ts";
import { effectDefOf, isMod } from "../../ops/effects.ts";
import type { Mechanic, MechanicCompileCtx, MechanicContribution, PackMechView } from "../types.ts";

export interface ItemDef {
  id: string;
  name: string;
  kind: "pp" | "hp" | "cleanse";
  cap: number;
  pp?: number;
  heal?: number;
  clearDown?: boolean;
  cleanse?: boolean;
  note: string;
}

export interface ItemsPackData {
  items: readonly ItemDef[];
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vItems = ajv.compile(itemsSchemaJson);

export const itemsOf = (pack: PackMechView): ItemsPackData | undefined =>
  pack.mechanics?.["items"] as ItemsPackData | undefined;

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** act_item-<id> 或 act_item-<id>--<moveId>。分隔符是 `--`，因为 id 本身可以含单 `-`。 */
export function parseItemAction(actionId: string): { itemId: string; moveId?: string } | undefined {
  if (!actionId.startsWith("act_item-")) return undefined;
  const rest = actionId.slice("act_item-".length);
  const sep = rest.indexOf("--");
  const itemId = sep < 0 ? rest : rest.slice(0, sep);
  const moveId = sep < 0 ? undefined : rest.slice(sep + 2);
  if (!ID.test(itemId) || (moveId !== undefined && !ID.test(moveId))) return undefined;
  if (actionId.length > "act_".length + 60) return undefined;
  return moveId !== undefined ? { itemId, moveId } : { itemId };
}

const findDef = (pack: PackMechView, itemId: string): ItemDef | undefined =>
  itemsOf(pack)?.items.find((it) => it.id === itemId);

export const itemsMechanic: Mechanic = {
  id: "items",
  doc: { rawKey: "items", packFile: "items" },

  compile(ctx: MechanicCompileCtx): MechanicContribution | undefined {
    const { raw, ruleset, fail } = ctx;
    const feats = (ruleset["features"] as readonly string[] | undefined) ?? [];
    const packFiles = (raw["pack"] as { files?: Record<string, string> } | undefined)?.files;
    const declared = typeof packFiles?.["items"] === "string";
    if (!feats.includes("items")) {
      if (raw["items"] !== undefined || declared) fail("items document provided but ruleset has no items feature");
      return undefined;
    }
    // 正式包用 files.items 指到文档。没指文件、也没塞文档的内存夹具不启用，避免每个夹具都复制一份目录。
    if (raw["items"] === undefined) {
      if (declared) fail("ruleset feature items requires an items document");
      return undefined;
    }
    if (!vItems(raw["items"])) fail(`items schema: ${ajv.errorsText(vItems.errors)}`);
    const items = (raw["items"] as { items: ItemDef[] }).items;
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) fail(`duplicate item id ${it.id}`);
      seen.add(it.id);
      if (it.id.length > 24) fail(`item id ${it.id} too long for actionId`);
      if (it.kind === "pp" && it.pp === undefined) fail(`${it.id} needs pp`);
      if (it.kind === "hp" && it.heal === undefined) fail(`${it.id} needs heal`);
      if (it.kind === "cleanse" && it.cleanse !== true) fail(`${it.id} needs cleanse`);
    }
    return { data: { items }, hashExtra: { itemsSha256: sha256hex(JSON.stringify(raw["items"])) } };
  },

  meta(pack) {
    const data = itemsOf(pack);
    if (data === undefined) return undefined;
    return { items: Object.fromEntries(data.items.map((it) => [it.id, it])) };
  },

  onBattleStart(pack, state) {
    const data = itemsOf(pack);
    if (data === undefined) return;
    const stocks = Object.fromEntries(data.items.map((it) => [it.id, it.cap]));
    state.sides.p1.stocks = { ...stocks };
    state.sides.p2.stocks = { ...stocks };
  },

  parseAction(actionId) {
    return parseItemAction(actionId) !== undefined ? { kind: "mech", actionId } : undefined;
  },

  actionPriority(actionId) {
    return parseItemAction(actionId) !== undefined ? 0 : undefined;
  },

  extraLegal(pack, state, side) {
    const data = itemsOf(pack);
    const stocks = state.sides[side].stocks;
    if (data === undefined || stocks === undefined) return [];
    const moves = state.sides[side].unit.moves;
    const out: string[] = [];
    for (const it of data.items) {
      if ((stocks[it.id] ?? 0) <= 0) continue;
      if (it.pp !== undefined) {
        for (const m of moves) out.push(`act_item-${it.id}--${m.moveId}`);
      } else {
        out.push(`act_item-${it.id}`);
      }
    }
    return out;
  },

  planAction(ctx) {
    const parsed = parseItemAction(ctx.actionId);
    if (parsed === undefined) return undefined;
    const def = findDef(ctx.pack, parsed.itemId);
    const side = ctx.state.sides[ctx.side];
    const stocks = side.stocks;
    if (def === undefined || stocks === undefined || (stocks[def.id] ?? 0) <= 0) return undefined;
    const unit = side.unit;
    if (def.pp !== undefined) {
      if (parsed.moveId === undefined || !unit.moves.some((m) => m.moveId === parsed.moveId)) return undefined;
    }
    stocks[def.id] = (stocks[def.id] ?? 0) - 1;
    const effects: Record<string, unknown>[] = [];
    if (def.clearDown === true && Object.values(unit.stages).some((v) => v < 0)) {
      effects.push({ op: "clear_stages", target: "self", sign: "down" });
    }
    if (def.cleanse === true) {
      const kinds = unit.effects
        .filter((e) => e.kind.startsWith("control:") || effectDefOf(e.kind)?.ailment === true)
        .map((e) => e.kind);
      if (kinds.length > 0) effects.push({ op: "cleanse", target: "self", effect: kinds });
    }
    // hp 类道具：正常回复；若身上挂 item_heal_reverse 则翻转为等量固定伤害（"使用体力药剂变成降低相应的体力"）
    if (def.heal !== undefined) {
      // 脱糖后 at="itemHealReverse"（axes 表）；兼容未脱糖的裸 kind 形态
      const reversed = unit.effects.some((e) => isMod(e, "itemHealReverse") || e.kind === "item_heal_reverse");
      if (reversed) {
        const amt = Math.min(unit.currentHp, def.heal);
        effects.push({ op: "hp_delta", target: "self", flat: amt, cause: "item-reverse" });
      } else {
        effects.push({ op: "heal", target: "self", flat: def.heal });
      }
    }
    if (def.pp !== undefined && parsed.moveId !== undefined) {
      const slot = unit.moves.findIndex((m) => m.moveId === parsed.moveId) + 1;
      effects.push({ op: "pp_delta", target: "self", slot, amount: def.pp });
    }
    return effects;
  },

  projectLegal(actionId) {
    const parsed = parseItemAction(actionId);
    if (parsed === undefined) return undefined;
    return {
      action: {
        kind: "item",
        itemId: parsed.itemId,
        ...(parsed.moveId !== undefined ? { moveId: parsed.moveId } : {}),
      },
      label: parsed.itemId,
    };
  },
};
