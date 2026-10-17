/**
 * add-effect-r4d：e50-14 里「X系技能威力翻倍」和「为随机倍数」原来被一起留档。
 * 步骤见 plans/add-effect.md、预算见 plans/touch-budget.md。
 *
 * 只改 batch-e50.mjs 里 e50-14 的 go：
 *   - 「翻倍」/「加倍」就是翻 2 倍，走和「翻N倍」同一条公式（pct = (N-1)*100），
 *     发已有的 apply_status dmg_boost{pct,moveType}——没有新 op、没有新 params 键、没有新状态名；
 *   - 「为随机倍数」仍然 deferred（随机区间没有建模，不编一个范围）；
 *   - 「提升N%」和「翻N倍」的旧结果不动。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

type Parsed = { effects: unknown[]; unparsed: { clause?: string; reason?: string }[]; flags: Record<string, unknown> };

const dmgBoost = (type: string, pct: number) => [
  { op: "apply_status", name: "dmg_boost", target: "self", params: { pct }, moveType: type },
];

describe("add one effect (r4d)", () => {
  it("r4d-dbl-01：X系技能威力翻倍 = 翻2倍（pct 100 + moveType）", () => {
    for (const src of [
      "火系技能威力翻倍",
      "火系技能的威力翻倍",
      "火系招式威力翻倍",
      "火系攻击威力翻倍",
    ]) {
      const r = parseEffectText(src) as Parsed;
      expect(r.unparsed, src).toEqual([]);
      expect(r.effects, src).toEqual(dmgBoost("火", 100));
    }
    // 系别跟着那句走，不是写死
    const elec = parseEffectText("电系技能威力翻倍") as Parsed;
    expect(elec.unparsed).toEqual([]);
    expect(elec.effects).toEqual(dmgBoost("电", 100));
  });

  it("r4d-dbl-02：X系技能(造成的)伤害翻倍 同一条 IR", () => {
    for (const src of ["火系技能伤害翻倍", "火系技能造成的伤害翻倍"]) {
      const r = parseEffectText(src) as Parsed;
      expect(r.unparsed, src).toEqual([]);
      expect(r.effects, src).toEqual(dmgBoost("火", 100));
    }
    // 「加倍」是同一个意思，同样落 2 倍
    const alias = parseEffectText("火系技能威力加倍") as Parsed;
    expect(alias.unparsed).toEqual([]);
    expect(alias.effects).toEqual(dmgBoost("火", 100));
  });

  it("r4d-dbl-03：翻倍与翻N倍是同一条公式（pct = (N-1)*100）", () => {
    const two = parseEffectText("火系技能威力翻2倍") as Parsed;
    const plain = parseEffectText("火系技能威力翻倍") as Parsed;
    expect(plain.effects).toEqual(two.effects);
    expect(two.effects).toEqual(dmgBoost("火", 100));
    expect((parseEffectText("火系技能威力翻3倍") as Parsed).effects).toEqual(dmgBoost("火", 200));
    expect((parseEffectText("火系技能威力翻三倍") as Parsed).effects).toEqual(dmgBoost("火", 200));
    expect((parseEffectText("火系技能威力翻10倍") as Parsed).effects).toEqual(dmgBoost("火", 900));
  });

  it("r4d-rand-01：X系技能威力为随机倍数 仍然 deferred，不编随机范围", () => {
    for (const src of ["火系技能威力为随机倍数", "水系技能威力为随机倍数"]) {
      const r = parseEffectText(src) as Parsed;
      expect(r.effects, src).toEqual([]);
      expect(r.unparsed.length, src).toBe(1);
      expect(r.unparsed[0]?.clause, src).toBe(src);
      expect(r.unparsed[0]?.reason, src).toMatch(/deferred/);
      expect(JSON.stringify(r), src).not.toMatch(/random|min|max|range|pct/);
    }
  });

  it("r4d-old-01：提升N%（含伤害提升）的旧句结果不变——锁「火系技能威力提升50%」", () => {
    const power = parseEffectText("火系技能威力提升50%") as Parsed;
    expect(power.unparsed).toEqual([]);
    expect(power.effects).toEqual(dmgBoost("火", 50));
    const dmg = parseEffectText("火系技能伤害提升30%") as Parsed;
    expect(dmg.unparsed).toEqual([]);
    expect(dmg.effects).toEqual(dmgBoost("火", 30));
    // 同族已被 p2 锁过的旧句与裸前缀形也不受影响
    expect((parseEffectText("自身电系技能威力翻倍") as Parsed).effects).toEqual(dmgBoost("电", 100));
    expect((parseEffectText("火系技能威力提升100%") as Parsed).effects).toEqual(dmgBoost("火", 100));
  });
});
