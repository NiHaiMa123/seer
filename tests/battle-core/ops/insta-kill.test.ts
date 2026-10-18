/**
 * 秒杀（一击必杀）——**本就已实现**，这里锁住既有形态，避免误以为它缺失。
 *
 * 排查过程：一度以为"秒杀"是未建模的 insta-KO 域，实际查工具链后发现
 * 已有 20+ 条规则覆盖各种措辞，统一表达为 damage{kind:"percent", power:100}
 * （100% 百分比伤害 = 打掉对手全部剩余体力）：
 *   · 直接/必定/裸形秒杀        → attach-all-36 / batch-e30 / heal-120
 *   · 血量阈值秒杀              → attach-all-35 / batch-remain-*
 *   · N% 概率秒杀               → deferred-125 / batch-e26 / batch-e53
 *   · 满连击秒杀                → batch-e5f-31 / batch-e35-05
 *
 * 真正缺的只有「免疫秒杀」——它等价于免疫百分比伤害（flat_immune 通道）。
 * 「免疫秒杀」的测试在 tests/battle-core/parser/insta-kill-immune.test.ts。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const isPercentKo = (r: { effects: { op?: string; power?: number; kind?: string }[] }) =>
  r.effects.some((e) => e.op === "damage" && e.power === 100 && e.kind === "percent");

describe("秒杀已实现的形态（回归锁）", () => {
  it.each([
    ["直接秒杀对手"],
    ["秒杀对手"],
    ["必定秒杀对手"],
    ["1%秒杀对手"],
    ["25%概率秒杀对手"],
    ["若对手体力不足350则直接秒杀"],
  ])("%s → percent-100 damage", (text) => {
    const r = parseEffectText(text, { hasDamage: true });
    expect(r.unparsed, text).toEqual([]);
    expect(isPercentKo(r), JSON.stringify(r.effects)).toBe(true);
  });

  it("概率形态带 chance 门", () => {
    const r = parseEffectText("1%秒杀对手", { hasDamage: true });
    expect(JSON.stringify(r.effects)).toMatch(/"chance":1/);
  });

  it("血量阈值形态带 foeHpBelowAbs 门", () => {
    const r = parseEffectText("若对手体力不足350则直接秒杀", { hasDamage: true });
    expect(JSON.stringify(r.effects)).toMatch(/350/);
  });
});