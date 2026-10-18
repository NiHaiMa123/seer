/**
 * 「每次使用后**此技能**造成的攻击伤害额外提升N%，最高M%」。
 *
 * 引擎已有 dmgPerUsePct / dmgPerUsePctCap，e40-05c 也认「每次使用(后/则)造成伤害提升N%」，
 * 但语料里常插入「此技能」作定语（刑天铠甲/火光剑法），导致整句失配。
 * 只放宽这一处插入语，不动其它措辞。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const OPS = [
  { op: "scale", of: "dmgPerUsePct", value: 30 },
  { op: "scale", of: "dmgPerUsePctCap", value: 120 },
];

describe("每次使用后此技能造成的伤害提升", () => {
  it("带「此技能」插入语能识别", () => {
    const r = parseEffectText("每次使用后此技能造成的攻击伤害额外提升30%，最高120%", { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(OPS);
  });

  it("不带插入语的原有写法不回归", () => {
    for (const t of [
      "每次使用造成伤害提升30%，最高120%",
      "每次使用后造成伤害提升30%，最高120%",
      "每次使用攻击伤害额外提升30%，最高120%",
    ]) {
      const r = parseEffectText(t, { hasDamage: true });
      expect(r.unparsed, t).toEqual([]);
      expect(r.effects, t).toEqual(OPS);
    }
  });

  it("只给单值（无上限）时 cap 缺席，不编造", () => {
    const r = parseEffectText("每次使用后此技能造成的攻击伤害额外提升30%", { hasDamage: true });
    expect(r.effects).toEqual([{ op: "scale", of: "dmgPerUsePct", value: 30 }]);
  });
});
