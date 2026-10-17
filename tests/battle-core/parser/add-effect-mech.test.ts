/**
 * add-effect-mech：mech 这一路加的技能规则（要新机制才能写完整句）。
 * 步骤见 plans/add-effect.md、预算见 plans/touch-budget.md。
 * 每条：新规则解析出的 IR 快照 + 该句子原来的 no-rule 事实、以及同类旧句子结果不变。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect (mech)", () => {
  it("mech-acc-cat-01：对手所有属性技能命中减50%", () => {
    const next = parseEffectText("对手所有属性技能命中减50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 50, cat: 1 } }]);
    // 带回合窗前缀：时长落在同一条 dodge 上
    const win = parseEffectText("3回合对手所有属性技能命中减50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(win.unparsed).toEqual([]);
    expect(win.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 50, cat: 1 }, turns: 3 }]);
    // 语料原句（速度攻击防御特防+1，3回合对手所有属性技能命中减50%）：前面的属性提升不变
    const full = parseEffectText("速度攻击防御特防+1，3回合对手所有属性技能命中减50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(full.unparsed).toEqual([]);
    expect(full.effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self" },
      { op: "apply_status", name: "dodge", target: "self", params: { pct: 50, cat: 1 }, turns: 3 },
    ]);
  });

  it("mech-acc-cat-01：类别分开（特殊=cat3 物理=cat2 攻击=cat4）", () => {
    const spec = parseEffectText("对手所有特殊技能命中减50%") as { effects: unknown[] };
    expect(spec.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 50, cat: 3 } }]);
    const phys = parseEffectText("对手所有物理技能命中减30%") as { effects: unknown[] };
    expect(phys.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 30, cat: 2 } }]);
    const atk = parseEffectText("对手所有攻击技能命中减30%") as { effects: unknown[] };
    expect(atk.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 30, cat: 4 } }]);
  });

  it("mech-acc-cat-01：无类别限定的旧句子仍是裸 pct（不被截走）", () => {
    const old = parseEffectText("对手所有技能命中降低50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(old.unparsed).toEqual([]);
    expect(old.effects).toEqual([{ op: "apply_status", name: "dodge", target: "self", params: { pct: 50 } }]);
  });

  it("mech-recoil-frac-01：制造伤害的1/4反弹给自己（打出侧反噬，与承伤侧反弹分开）", () => {
    // 解析层里 attachDamage.recoilFrac 被抬成 applyRecoilFrac op（与 add-effect-p2 的 drain 同惯例）
    const next = parseEffectText("制造伤害的1/4反弹给自己") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "applyRecoilFrac", recoilFrac: { n: 1, d: 4 } }]);
    // 「将造成伤害的1/4反弹给自己」同义（语料两条）
    const v2 = parseEffectText("将造成伤害的1/4反弹给自己") as { effects: unknown[] };
    expect(v2.effects).toEqual([{ op: "applyRecoilFrac", recoilFrac: { n: 1, d: 4 } }]);
    // 承伤侧反弹（旧句 heal-282）产出的 IR 同形，但语义不同：那条是「对方所受伤害」，本条是「自身打出的伤害」
    const old = parseEffectText("对方所受伤害的1/4会反弹给自己") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "applyRecoilFrac", recoilFrac: { n: 1, d: 4 } }]);
  });

  it("mech-clear-both-01/02：消除对手能力提升和下降状态（两次现有 clear_stages）", () => {
    const both = [{ op: "clear_stages", target: "opponent", sign: "up" }, { op: "clear_stages", target: "opponent", sign: "down" }];
    for (const src of ["消除对手能力提升和下降状态", "消除对手能力下降和提升状态", "消除对手能力提升、下降状态", "消除对手的能力提升和能力下降"]) {
      const r = parseEffectText(src) as { effects: unknown[]; unparsed: unknown[] };
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual(both);
    }
    // 单方向旧句不变
    const up = parseEffectText("消除对手能力提升状态") as { effects: unknown[] };
    expect(up.effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
    const down = parseEffectText("消除对手能力下降状态") as { effects: unknown[] };
    expect(down.effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "down" }]);
  });

  it("mech-taken-cats-01：受到的物理或特殊伤害减少N%（cat:4 一条窗）", () => {
    const both = [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: 50, d: 100 } }];
    for (const src of ["受到的物理或特殊伤害减少50%", "受到物理和特殊伤害减少50%"]) {
      const r = parseEffectText(src) as { effects: unknown[]; unparsed: unknown[] };
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual(both);
    }
    // 旧句（heal-244「受到物理攻击和特殊攻击伤害减少N%」）走的是全类型 dmg_taken_down，本规则不截它
    const old = parseEffectText("受到物理攻击和特殊攻击伤害减少50%") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }]);
    const r = parseEffectText("受到的物理或特殊伤害减少30%") as { effects: unknown[] };
    expect(r.effects).toEqual([{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: 70, d: 100 } }]);
  });

  it("mech-taken-fatigue-01/02：若受伤超过N则对手疲惫N回合", () => {
    const next = parseEffectText("若受伤超过250则对手疲惫2回合") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", turns: 1,
      params: { trigger: 1, min: 250, count: 1 },
      payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: 2 }],
    }]);
    // 语料整句：3回合窗内的受击 react + 疲惫 payload 都吃同一窗
    const full = parseEffectText("速度、攻击、双防+1,3回合若受伤超过250则对手疲惫2回合") as { effects: unknown[]; unparsed: unknown[] };
    expect(full.unparsed).toEqual([]);
    expect(full.effects.length).toBe(5);
    expect(full.effects[4]).toEqual({
      op: "apply_status", name: "react", target: "self", turns: 3,
      params: { trigger: 1, min: 250, count: 1 },
      payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: 2 }],
    });
  });

  it("mech-foe-dmg-heal-01/02：对手造成的伤害为自身恢复体力（承伤方回血）", () => {
    const frac = parseEffectText("对手造成的伤害的50%为自身恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(frac.unparsed).toEqual([]);
    expect(frac.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 50 } }]);
    const pct = parseEffectText("对手造成伤害的50%恢复自身体力") as { effects: unknown[] };
    expect(pct.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 50 } }]);
    const n3 = parseEffectText("对方造成伤害的1/3恢复自身体力") as { effects: unknown[] };
    expect(n3.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 3 } }]);
    const owned = parseEffectText("对手造成的伤害的1/2会为自身恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(owned.unparsed).toEqual([]);
    expect(owned.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 2 } }]);
    // 没写比例的整句仍不解析（本句没有系数，留给以后）
    const bare = parseEffectText("对手造成的伤害为自身恢复体力") as { unparsed: unknown[] };
    expect(bare.unparsed.length).toBe(1);
  });

});
