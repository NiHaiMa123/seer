/**
 * 「使用体力药剂变成降低相应的体力」——药剂回复翻转为扣血。
 *
 * 语料 6 处（卡鲁维德/奈诺里特/庚辰/瀚海界神/魔剪·塞泽丝…）：
 *   使用体力药剂变成降低相应的体力
 *   对手使用体力药剂时效果变成减少相应的体力
 *
 * 语义：持有该状态的一方使用 hp 类道具时，heal 变成等量 fixed 伤害。
 * 不同于 heal_block（禁疗=不回复），这里是**翻转**：回复量全额变成伤害。
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir, initBattle } from "@seer/battle-core";
import { join } from "node:path";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");

describe("item_heal_reverse：药剂回复翻转", () => {
  it("状态已注册（EFFECT_DEFS 里有）", () => {
    const it = PACK.mechanics;
    expect(it).toBeDefined();
    // 通过解析产物间接验证注册名合法（compile 检查会拦未注册名）
    const r = parseEffectText("使用体力药剂变成降低相应的体力");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.effects)).toMatch(/item_heal_reverse/);
  });

  it("对手版本：对手使用药剂时翻转", () => {
    const r = parseEffectText("对手使用体力药剂变成降低相应的体力");
    expect(r.unparsed).toEqual([]);
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/item_heal_reverse/);
    expect(s).toMatch(/opponent/);
  });
});

describe("魂印形态", () => {
  it("「体力药剂的体力增加效果失效」仍留档（是禁疗不是翻转，语义不同）", () => {
    const r = parseSoulmarkText("体力药剂的体力增加效果失效", "工程型TOH");
    // 这条需要 item 使用事件钩子，暂不做；锁住它仍留档而不是被误解成翻转
    expect(r.unparsed.length).toBeGreaterThan(0);
  });
});