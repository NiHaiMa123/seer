/**
 * add-effect-p2：p2 这一路加的技能规则。
 * 步骤见 plans/add-effect.md、预算见 plans/touch-budget.md。
 * 每条：新规则（p2-*）解析出的 IR 快照 + 被放在其后的那条更宽旧句子结果不变。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect (p2)", () => {
  it("p2-pp-13：回满所有pp值", () => {
    const next = parseEffectText("回满所有pp值") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"pp_delta","full":true,"target":"self"}]);
    const old = parseEffectText("恢复自身所有技能PP值") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"pp_delta","full":true,"target":"self","scope":"all"}]);
  });

  it("p2-pp-14：所有技能pp+1", () => {
    const next = parseEffectText("所有技能pp+1") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"pp_delta","amount":1,"target":"self","scope":"all"}]);
    const old = parseEffectText("恢复自身所有技能1点PP值") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"pp_delta","amount":1,"target":"self","scope":"all"}]);
  });

  it("p2-pp-15：恢复自身所有体力和所有技能PP值", () => {
    const next = parseEffectText("恢复自身所有体力和所有技能PP值") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"heal","numerator":1,"denominator":1,"target":"self"},{"op":"pp_delta","full":true,"target":"self"}]);
    const old = parseEffectText("恢复自身全部体力与PP值") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"heal","numerator":1,"denominator":1,"target":"self"},{"op":"pp_delta","full":true,"target":"self"}]);
  });

  it("p2-pp-11：3回合对手消耗PP翻倍", () => {
    const next = parseEffectText("3回合对手消耗PP翻倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"pp_double","target":"opponent","turns":3}]);
    const old = parseEffectText("对手释放技能PP消耗翻倍") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"pp_double","target":"opponent"}]);
  });

  it("p2-pp-11b：对手释放的PP值为3倍", () => {
    const next = parseEffectText("对手释放的PP值为3倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"pp_mul","target":"opponent","params":{"mul":3}}]);
    const old = parseEffectText("对手释放技能消耗PP为2倍") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"pp_double","target":"opponent"}]);
  });

  it("p2-pp-12：清除对手2个技能PP", () => {
    const next = parseEffectText("清除对手2个技能PP") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"pp_delta","zeroRandom":2,"target":"opponent"}]);
    const old = parseEffectText("使对手随机2项技能PP值归零") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"pp_delta","zeroRandom":2,"target":"opponent"}]);
  });

  it("p2-hit-09：必定命中目标", () => {
    const next = parseEffectText("必定命中目标") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"must_hit","target":"self"}]);
    const old = parseEffectText("必定命中") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
    expect(old.flags).toEqual({"accuracy":"always"});
  });

  it("p2-hit-08：使接下来的两回合中必定出现致命一击", () => {
    const next = parseEffectText("使接下来的两回合中必定出现致命一击") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"crit_always","target":"self","turns":2}]);
    const old = parseEffectText("所有攻击必定打出致命一击") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"crit_always","target":"self"}]);
  });

  it("p2-imm-02：3回合内不受到能力下降影响", () => {
    const next = parseEffectText("3回合内不受到能力下降影响") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"immune_degrade","target":"self","turns":3}]);
    const old = parseEffectText("免疫能力下降状态") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"immune_degrade","target":"self"}]);
  });

  it("p2-imm-03：免疫能力下降异常状态", () => {
    const next = parseEffectText("免疫能力下降异常状态") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"immune_degrade","target":"self"}]);
    const old = parseEffectText("免疫能力下降") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"immune_degrade","target":"self"}]);
  });

  it("p2-rf-03：反弹对手造成的伤害", () => {
    const next = parseEffectText("反弹对手造成的伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"reflect_dmg","target":"self","params":{"n":1,"d":1}}]);
    const old = parseEffectText("反馈受到攻击伤害的30%") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"reflect_dmg","target":"self","params":{"n":30,"d":100}}]);
  });

  it("p2-pr-03：下2回合攻击必定先出", () => {
    const next = parseEffectText("下2回合攻击必定先出") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"prio_up","target":"self","params":{"add":9},"turns":2}]);
    const old = parseEffectText("必定先手") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
    expect(old.flags).toEqual({"priority":3});
  });

  it("p2-tk-08：对手造成的伤害减半", () => {
    const next = parseEffectText("对手造成的伤害减半") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"dmg_taken_down","target":"self","params":{"pct":50}}]);
    const old = parseEffectText("对手攻击伤害减半") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_taken_down","target":"self","params":{"pct":50}}]);
  });

  it("p2-tk-09：3回合内受到的伤害降低1/2", () => {
    const next = parseEffectText("3回合内受到的伤害降低1/2") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"dmg_taken_down","target":"self","params":{"pct":50},"turns":3}]);
    const old = parseEffectText("受到伤害减半") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_taken_down","target":"self","params":{"pct":50}}]);
  });

  it("p2-dh-02：下回合受到的伤害转化为恢复自身体力", () => {
    const next = parseEffectText("下回合受到的伤害转化为恢复自身体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"dmg_to_heal","target":"self","turns":1}]);
    const old = parseEffectText("下回合受到的攻击伤害转化为自身体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_to_heal","target":"self","turns":1}]);
  });

  it("p2-prot-01：可以完全抵挡一次伤害", () => {
    const next = parseEffectText("可以完全抵挡一次伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"protect","target":"self","params":{"count":1}}]);
    const old = parseEffectText("可完全抵挡一次攻击") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_immune","target":"self","turns":99,"params":{"count":1}}]);
  });

  it("p2-ed-03：若受到致命伤害时残留1点体力", () => {
    const next = parseEffectText("若受到致命伤害时残留1点体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"endure","target":"self","params":{"hp":1}}]);
    const old = parseEffectText("自身残留1点体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"endure","target":"self","params":{"hp":1}}]);
  });

  it("p2-fail-01：对手每存在一种异常状态则附加100点固定伤害", () => {
    const next = parseEffectText("对手每存在一种异常状态则附加100点固定伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatPerAilment","value":100}]);
    const old = parseEffectText("对手每处于1种异常状态则附加60点固定伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"flat","of":"flatPerAilment","value":60}]);
  });

  it("p2-half-03：受到特攻减伤50%", () => {
    const next = parseEffectText("受到特攻减伤50%") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"spec_half","target":"self"}]);
    const old = parseEffectText("受到特攻伤害减半") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"spec_half","target":"self"}]);
  });

  it("p2-flat-selfmax：使对手受到自身最大体力1/2固伤", () => {
    const next = parseEffectText("使对手受到自身最大体力1/2固伤") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"damage","kind":"fixed","power":0,"target":"opponent"},{"op":"flat","of":"flatSelfFrac","value":{"numerator":1,"denominator":2,"base":"max"}}]);
    const old = parseEffectText("使对手受到自身最大体力1/2的固定伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"damage","kind":"fixed","power":0,"target":"opponent"},{"op":"flat","of":"flatSelfFrac","value":{"numerator":1,"denominator":2,"base":"max"}}]);
  });

  it("p2-drain-02：若对手处于烧伤则每次攻击造成伤害将恢复自身体力", () => {
    const next = parseEffectText("若对手处于烧伤则每次攻击造成伤害将恢复自身体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"applyDrainRider","drain":{"numerator":1,"denominator":1}}]);
    const old = parseEffectText("造成的伤害的1/2恢复体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"applyDrainRider","drain":{"numerator":1,"denominator":2}}]);
  });

  it("p2-heal-02：恢复自身25%HP", () => {
    const next = parseEffectText("恢复自身25%HP") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"heal","numerator":25,"denominator":100,"target":"self"}]);
    const old = parseEffectText("恢复自身25%的体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"heal","numerator":25,"denominator":100,"target":"self"}]);
  });

  it("p2-fcp-01：附加对手当前体力30%固伤", () => {
    const next = parseEffectText("附加对手当前体力30%固伤") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatFoeCurPct","value":30}]);
    const old = parseEffectText("附加对手当前体力值20%的伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"damage","power":20,"kind":"percent"},{"op":"formula","of":"percentBase","value":"current"}]);
  });

  it("p2-fcp-02：附加对手当前HP7%的伤害", () => {
    const next = parseEffectText("附加对手当前HP7%的伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatFoeCurPct","value":7}]);
    const old = parseEffectText("附加对手当前体力值25%的百分比伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"damage","power":25,"kind":"percent"},{"op":"formula","of":"percentBase","value":"current"}]);
  });

  it("p2-fstat-02：附加自身防御值与特防值之和30%的固定伤害", () => {
    const next = parseEffectText("附加自身防御值与特防值之和30%的固定伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatSelfDefSumPct","value":30}]);
    const old = parseEffectText("附加自身防御、特防总和20%的固定伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"flat","of":"flatSelfDefSumPct","value":20}]);
  });

  it("p2-clr-01：令对手所用能力增强效果消失", () => {
    const next = parseEffectText("令对手所用能力增强效果消失") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"clear_stages","target":"opponent","sign":"up"}]);
    const old = parseEffectText("对方能力增强消失") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"clear_stages","target":"opponent","sign":"up"}]);
  });

  it("p2-clr-02：消除对方能力等级", () => {
    const next = parseEffectText("消除对方能力等级") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"clear_stages","target":"opponent"}]);
    const old = parseEffectText("消除对手能力提升状态") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"clear_stages","target":"opponent","sign":"up"}]);
  });

  it("p2-flat-first：先出手加50固伤", () => {
    const next = parseEffectText("先出手加50固伤") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatIf","value":{"when":{"order":"first"},"flat":50}}]);
    const old = parseEffectText("先出手附加50点固定伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"flat","of":"flatIf","value":{"when":{"order":"first"},"flat":50}}]);
  });

  it("p2-ppz-01：对手每有1项技能PP值为0则附加200点固定伤害", () => {
    const next = parseEffectText("对手每有1项技能PP值为0则附加200点固定伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatPerPpZero","value":{"who":"foe","per":1,"add":200}}]);
    const old = parseEffectText("双方每有1项技能PP值为0吸取对手70点体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"flat","of":"flatPerPpZero","value":{"who":"both","per":1,"add":70,"drain":true}}]);
  });

  it("p2-fpm-01：每损失1点HP就附加1点固定伤害", () => {
    const next = parseEffectText("每损失1点HP就附加1点固定伤害") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"flat","of":"flatPerMissing","value":{"step":1,"add":1}}]);
    const old = parseEffectText("每损失10点体力附加2点固定伤害") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"flat","of":"flatPerMissing","value":{"step":10,"add":2}}]);
  });

  it("p2-per-01：每次使用提升20%威力，最高80%", () => {
    const next = parseEffectText("每次使用提升20%威力，最高80%") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"power","of":"powerMulPerUse","value":{"numerator":120,"denominator":100}},{"op":"power","of":"powerMulPerUseCap","value":{"numerator":180,"denominator":100}}]);
    const old = parseEffectText("连续使用威力提升20%，最高80%") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"power","of":"powerMulPerUse","value":{"numerator":120,"denominator":100}},{"op":"power","of":"powerMulPerUseCap","value":{"numerator":180,"denominator":100}}]);
  });

  it("p2-critup-01：3回合命中要害增加1/16", () => {
    const next = parseEffectText("3回合命中要害增加1/16") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"crit_up","target":"self","params":{"n":1,"d":16},"turns":3}]);
    const old = parseEffectText("攻击要害几率增加1/16") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"crit_up","target":"self","params":{"n":1,"d":16}}]);
  });

  it("p2-type-01：使自身电系招式伤害2倍", () => {
    const next = parseEffectText("使自身电系招式伤害2倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"dmg_boost","target":"self","params":{"pct":100},"moveType":"电"}]);
    const old = parseEffectText("自己使用电系招式伤害×2") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_boost","target":"self","params":{"pct":100},"moveType":"电"}]);
  });

  it("p2-type-03：自身电系威力翻倍", () => {
    const next = parseEffectText("自身电系威力翻倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"dmg_boost","target":"self","params":{"pct":100},"moveType":"电"}]);
    const old = parseEffectText("自身电系技能威力翻倍") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"dmg_boost","target":"self","params":{"pct":100},"moveType":"电"}]);
  });

  it("p2-hot-01：自身每回合恢复1/3体力", () => {
    const next = parseEffectText("自身每回合恢复1/3体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"hot","target":"self","params":{"n":1,"d":3}}]);
    const old = parseEffectText("每回合恢复自身1/3体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"hot","target":"self","params":{"n":1,"d":3}}]);
  });

  it("p2-type-02：和对手交换属性", () => {
    const next = parseEffectText("和对手交换属性") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"type_swap","target":"self"}]);
    const old = parseEffectText("自身与对方反转战斗时属性") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"type_swap","target":"self"}]);
  });

  it("p2-ed-04：受到致死攻击时则剩余下1点体力", () => {
    const next = parseEffectText("受到致死攻击时则剩余下1点体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"endure","target":"self","params":{"hp":1}}]);
    const old = parseEffectText("受到致死攻击时余下一点体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"endure","target":"self"}]);
  });

  it("p2-tick-02：每回合有60%让对手害怕", () => {
    const next = parseEffectText("每回合有60%让对手害怕") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"periodic","target":"self","params":{"win":16,"foeAlive":1},"payload":[{"op":"apply_status","name":"fear","target":"opponent","chance":60}]}]);
    const old = parseEffectText("每回合有60%令对手害怕") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"periodic","target":"self","params":{"win":16,"foeAlive":1},"payload":[{"op":"apply_status","name":"fear","target":"opponent","chance":60}]}]);
  });

  it("p2-push-02：将自身能力下降状态转移到对手身上", () => {
    const next = parseEffectText("将自身能力下降状态转移到对手身上") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"transfer_stages","direction":"push","sign":"down"}]);
    const old = parseEffectText("将自身能力下降状态转移给对手") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"copy_stages","match":true,"sign":"down","target":"opponent"}]);
  });

  it("p2-hits-01：做2-3攻击", () => {
    const next = parseEffectText("做2-3攻击") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"strike","of":"hits","value":{"min":2,"max":3}}]);
    const old = parseEffectText("1回合做2~3次攻击") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"strike","of":"hits","value":{"min":2,"max":3}}]);
  });

  it("p2-drain-03：吸收对方八分之一体力", () => {
    const next = parseEffectText("吸收对方八分之一体力") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"damage","power":1,"kind":"percent"},{"op":"formula","of":"percentBase","value":"current"},{"op":"formula","of":"frac","value":{"numerator":1,"denominator":8}},{"op":"heal","numerator":1,"denominator":8,"target":"self"}]);
    const old = parseEffectText("吸收对方1/8体力") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"damage","power":1,"kind":"percent"},{"op":"formula","of":"percentBase","value":"current"},{"op":"formula","of":"frac","value":{"numerator":1,"denominator":8}},{"op":"heal","numerator":1,"denominator":8,"target":"self"}]);
  });

  it("p2-al-03：敌我双方烧伤3回合", () => {
    const next = parseEffectText("敌我双方烧伤3回合") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"burn","target":"self","turns":3},{"op":"apply_status","name":"burn","target":"opponent","turns":3}]);
    const old = parseEffectText("令双方烧伤3回合") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"burn","target":"self","turns":3},{"op":"apply_status","name":"burn","target":"opponent","turns":3}]);
  });

  it("p2-al-04：令双方沉默", () => {
    const next = parseEffectText("令双方沉默") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"silence","target":"self"},{"op":"apply_status","name":"silence","target":"opponent"}]);
    const old = parseEffectText("令双方冻结") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
  });

  it("p2-ig-01：在战斗结束时可以获得500泰坦之灵", () => {
    const next = parseEffectText("在战斗结束时可以获得500泰坦之灵") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([]);
    const old = parseEffectText("在战斗结束时可以获得500赛尔豆") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
  });

  it("p2-scale-02：自身HP为1/2时威力为2倍", () => {
    const next = parseEffectText("自身HP为1/2时威力为2倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"power","of":"scaleIf","value":{"when":{"selfHpBelow":{"numerator":1,"denominator":2}},"numerator":2,"denominator":1}}]);
    const old = parseEffectText("自身HP低于1/2时威力为2倍") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"power","of":"scaleIf","value":{"when":{"selfHpBelow":{"numerator":1,"denominator":2}},"numerator":2,"denominator":1}}]);
  });

  it("p2-scale-03：若当前体力低于对手威力翻倍", () => {
    const next = parseEffectText("若当前体力低于对手威力翻倍") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"power","of":"scaleIf","value":{"when":{"selfHpBelowFoe":true},"numerator":2,"denominator":1}}]);
    const old = parseEffectText("体力低于对手威力翻倍") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"power","of":"scaleIf","value":{"when":{"selfHpBelowFoe":true},"numerator":2,"denominator":1}}]);
  });

  it("p2-weak-02：受到物理伤害减少30%", () => {
    const next = parseEffectText("受到物理伤害减少30%") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"atk_taken_frac","target":"self","params":{"cat":2,"n":70,"d":100}}]);
    const old = parseEffectText("受到物攻伤害减半") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"phys_half","target":"self"}]);
  });

  it("p2-hit-10：受攻35%令对手害怕", () => {
    const next = parseEffectText("受攻35%令对手害怕") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"react","target":"self","params":{"trigger":1},"payload":[{"op":"apply_status","name":"fear","target":"opponent","chance":35}]}]);
    const old = parseEffectText("受到攻击35%令对手害怕") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"react","target":"self","params":{"trigger":1},"payload":[{"op":"apply_status","name":"fear","target":"opponent","chance":35}]}]);
  });

  it("p2-hit-11：若命中100%使对方害怕", () => {
    const next = parseEffectText("若命中100%使对方害怕") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{"op":"apply_status","name":"fear","target":"opponent","chance":100}]);
    const old = parseEffectText("命中后100%使对方害怕") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([{"op":"apply_status","name":"fear","target":"opponent","chance":100}]);
  });

  it("p2-ig-03：组队时攻击3个目标", () => {
    const next = parseEffectText("组队时攻击3个目标") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([]);
    expect(next.flags).toEqual({"targets":3});
    const old = parseEffectText("组队时可影响3个目标") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
    expect(old.flags).toEqual({"targets":3});
  });

  it("p2-ig-04：组队时可影响2个目标", () => {
    const next = parseEffectText("组队时可影响2个目标") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([]);
    expect(next.flags).toEqual({"targets":2});
    const old = parseEffectText("影响2人") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
    expect(old.flags).toEqual({"targets":2});
  });

  it("p2-ig-05：组队时可向积分任意目标使用", () => {
    const next = parseEffectText("组队时可向积分任意目标使用") as { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([]);
    expect(next.flags).toEqual({"targetScope":"anyAlly"});
    const old = parseEffectText("组队时可以向己方任意目标使用") as { effects: unknown[]; flags: Record<string, unknown> };
    expect(old.effects).toEqual([]);
    expect(old.flags).toEqual({"targetScope":"anyAlly"});
  });

});
