/**
 * add-effect-r2e：r2e 这一路加的技能规则（对手造成的伤害 → 转为自己回血，承伤侧）。
 * 步骤见 plans/add-effect.md、预算见 plans/touch-budget.md。
 * 用的是已有格子 apply_status name dmg_to_heal（params 只用已读取的 n/d 与 pct），
 * 没有新 op、没有新 params 键、没有新状态名。规则只在 tools/effects-rules/batch-r2e.mjs。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect (r2e)", () => {
  it("r2e-foe-dmg-heal-*：对手造成的伤害转为自己回血", () => {
    const dmgToHeal = (pct: number | { n: number; d: number }) =>
      [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: typeof pct === "number" ? { pct } : { n: pct.n, d: pct.d } }];

    // 句里写了「所有」而没写系数 → 全额 pct 100（就是「把对手造成的伤害全部转成自己的体力」）
    for (const src of [
      "对手所有攻击造成的伤害都将为自己恢复体力",
      "对手所有攻击造成的伤害都将恢复体力",
      "对手造成的所有伤害都将为自己恢复体力",
      "对手所有技能造成的伤害都将为自己恢复体力",
    ]) {
      const r = parseEffectText(src) as { effects: unknown[]; unparsed: unknown[] };
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual(dmgToHeal(100));
    }
    // 语料原句「1合内…」「2合内…」：回合窗落在同一条 dmg_to_heal 上
    const one = parseEffectText("1合内对手所有攻击造成的伤害都将为自己恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(one.unparsed).toEqual([]);
    expect(one.effects).toEqual([{ ...dmgToHeal(100)[0], turns: 1 }]);
    const two = parseEffectText("2合内对手所有攻击造成的伤害都将为自己恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(two.unparsed).toEqual([]);
    expect(two.effects).toEqual([{ ...dmgToHeal(100)[0], turns: 2 }]);

    // 句里写了分数或百分数的，用句里的数
    const frac = parseEffectText("对手造成的伤害的1/2会为自身恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(frac.unparsed).toEqual([]);
    expect(frac.effects).toEqual(dmgToHeal({ n: 1, d: 2 }));
    const fracAll = parseEffectText("对手所有攻击造成的伤害的1/4都将为自己恢复体力") as { effects: unknown[] };
    expect(fracAll.effects).toEqual(dmgToHeal({ n: 1, d: 4 }));
    const pct = parseEffectText("对手打出的伤害的50%将会恢复自身体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(pct.unparsed).toEqual([]);
    expect(pct.effects).toEqual(dmgToHeal(50));
    const pct2 = parseEffectText("对手造成的伤害数值的100%为自身恢复体力") as { effects: unknown[] };
    expect(pct2.effects).toEqual(dmgToHeal(100));
  });

  it("r2e：没写「所有」也没写数字的不收", () => {
    const bare = parseEffectText("对手造成的伤害为自身恢复体力") as { unparsed: unknown[] };
    expect(bare.unparsed.length).toBe(1);
    // 写了「所有」但没写系数、也没写「都/将」的，仍算写清了「全部」→ 全额
    const allNoVerb = parseEffectText("对手所有攻击造成的伤害为自己恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(allNoVerb.unparsed).toEqual([]);
    expect(allNoVerb.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 100 } }]);
  });

  it("r2e：自己打出的伤害那一侧仍是 drain_atk，不被本路截走", () => {
    const self = parseEffectText("自身所有攻击造成的伤害都将为自己恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(self.unparsed).toEqual([]);
    expect(self.effects).toEqual([{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 } }]);
    const stock = parseEffectText("3回合内自身所有攻击造成的伤害都将为自己恢复体力") as { effects: unknown[] };
    expect(stock.effects).toEqual([{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 }, turns: 3 }]);
  });

  it("r2e：旧句 IR 不变（batch-mech 的 mech-foe-dmg-heal-01/02 仍是原样）", () => {
    const n1d2 = parseEffectText("对手造成的伤害的1/2会为自身恢复体力") as { effects: unknown[] };
    expect(n1d2.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 2 } }]);
    const pct50 = parseEffectText("对手造成的伤害的50%为自身恢复体力") as { effects: unknown[] };
    expect(pct50.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 50 } }]);
    const foeSide = parseEffectText("对方造成伤害的1/3恢复自身体力") as { effects: unknown[] };
    expect(foeSide.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 3 } }]);
    // 承伤侧全额转化的裸形（attach-damage-56）没写「所有」，结果不变
    const bareConvert = parseEffectText("伤害转化为体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(bareConvert.unparsed).toEqual([]);
    expect(bareConvert.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self" }]);
  });
});
