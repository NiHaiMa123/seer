/**
 * 「N回合内攻击造成伤害恢复体力」是持续的吸血窗口（drain_atk），不是孤立的命中 rider。
 *
 * e38-17 原本把 "自身所有攻击造成的伤害都将恢复体力" 发成 attachDamage.drain，
 * 抬升后成为 applyDrainRider。属性招本身不打出伤害时，这个 rider 挂不上任何一击，
 * 装载时被分组规则当孤儿拒载（peak 91 条）。
 *
 * 引擎已有 drain_atk（"攻击吸血窗"）：每次造成伤害按分数回血，读法在
 * ops/damage-riders.ts。带回合窗的写 turns，无窗口是永久窗。
 *
 * 注意「分数吸血」的两种语境不要混淆：
 *   - 单个技能句 "造成伤害的1/3恢复体力" → attachDamage.drain，编译器合并时会把
 *     damage 合成出来当宿主，所以 applyDrainRider 是正确表达，不改。
 *   - 持续窗 "N回合内…恢复体力" → drain_atk + turns。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("攻击吸血窗 = drain_atk", () => {
  it("N回合内自身所有攻击恢复体力 → drain_atk + turns", () => {
    const r = parseEffectText("3回合内自身所有攻击造成的伤害都将恢复体力");
    expect(r.effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 }, turns: 3 },
    ]);
  });

  it("「为自己恢复体力」变体同样走 drain_atk", () => {
    const r = parseEffectText("必中；3回合内自身所有攻击造成的伤害将为自己恢复体力");
    expect(r.effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 }, turns: 3 },
    ]);
  });

  it("带窗口的全部攻击吸血句都不再产出孤立 rider", () => {
    for (const t of [
      "3回合内自身所有攻击造成的伤害都将恢复体力",
      "必中；3回合内自身所有攻击造成的伤害将为自己恢复体力",
    ]) {
      const r = parseEffectText(t);
      expect(r.effects.filter((e) => e.op === "applyDrainRider"), t).toEqual([]);
    }
  });

  it("单句分数吸血仍是 rider（编译器会合成 damage 宿主）", () => {
    const r = parseEffectText("造成伤害的1/3恢复体力");
    expect(r.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 3 } },
    ]);
  });
});
