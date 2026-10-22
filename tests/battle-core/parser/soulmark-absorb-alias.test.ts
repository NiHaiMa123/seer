/**
 * 「吸收」/「吸取」同义族的词形收口（2026-10-22 第一轮）。
 *
 * 「吸收」在赛尔号语料里有两个完全不同的含义：
 *   1. **吸血**（吸收对手体力/属性）——与「吸取」同义；
 *   2. **护盾**（吸收伤害）——与「吸取」无关。
 * 这一轮只在**吸血语境**放行「吸收」，护盾语境与「状态被吸取」语境一律不动。
 *
 * 改动：
 *   - e8-hl-07（batch-e8）收「吸收对手N/M最大体力」的「最大HP / 最大生命值」别名
 *     （pet-2929「每2回合吸收对手1/3最大HP」）。
 *   - attach-damage-10 收「吸收效果翻倍」（pet-3423/鬼步慢移）。
 *   - batch-e6-124 收「吸收对手N点体力」（pet-3209/停梅抒意）。
 *   - batch-e6-210 收「吸收并反转对手能力提升」（少「状态」二字，pet-3323/辉灯招福）。
 *
 * **踩过的坑（已修）**：一开始把「吸收」加进更靠前的 batch-e6-121，结果它抢走了
 * 原本由 e8-hl-07 处理的「吸收对手N/M最大体力」——两条规则的 heal 读法不同
 * （e8-hl-07 是「恢复自身(N/M)体力」，batch-e6-121 是「恢复自身**已损失**体力的N/M」），
 * 抢先匹配造成 4 个技能的 heal 读法退化。**同义扩展必须落在原有那条规则上，不能新起一条**。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("「吸收」同义族：吸血语境", () => {
  it("pet-2929：每2回合吸收对手1/3最大HP（周期门 + 吸血）", () => {
    const r = parseSoulmarkText("每2回合吸收对手1/3最大HP", "奥德迪尔");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onTurnEnd",
        guard: { everyNTurns: 2 },
        ops: [
          { op: "damage", power: 1, kind: "percent" },
          { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
          { op: "heal", numerator: 1, denominator: 3, target: "self" },
        ],
      },
    ]);
  });

  it("pet-2887/无极风雷爆：若对手不处于麻痹状态则吸收对手1/5最大HP", () => {
    const p = parseEffectText("必中；消除对手回合类效果；若对手麻痹则威力翻倍；若对手不处于麻痹状态则吸收对手1/5最大HP");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toContainEqual({ op: "heal", numerator: 1, denominator: 5, target: "self", if: { not: { foeHas: "paralysis" } } });
  });

  it("pet-3323/辉灯招福：吸收并反转对手能力提升（少「状态」二字）", () => {
    const p = parseEffectText("先制+3；吸收并反转对手能力提升");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toEqual([
      { op: "transfer_stages", direction: "steal" },
      { op: "invert_stages", target: "opponent" },
    ]);
  });

  it("pet-3423/鬼步慢移：吸收效果翻倍 = 吸取量 ×2", () => {
    const p = parseEffectText("4回合内吸收对手最大体力的1/3，自身体力低于1/2时吸收效果翻倍");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toContainEqual({ op: "applyDrainRider", drainMul: { numerator: 2, denominator: 1 } });
    expect(p.effects).toContainEqual({ op: "heal", numerator: 2, denominator: 3, missing: true, target: "self" });
  });

  it("pet-3209/停梅抒意：吸收对手200点体力", () => {
    const p = parseEffectText("3回合内，先出手时额外吸收对手200点体力，下2回合所有技能先制+1");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toContainEqual({ op: "damage", kind: "fixed", power: 200, target: "opponent", if: { order: "first" } });
  });
});

describe("「吸收」同义族：护栏（不得混进吸血语义）", () => {
  it("护栏：护盾语义的「吸收伤害」不受影响", () => {
    const p = parseEffectText("为自身创造一个可以吸收100点伤害的护盾");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toEqual([{ op: "apply_status", name: "shield", target: "self", params: { flat: 100 } }]);
  });

  it("护栏：「能力提升状态被吸取」是状态被移除，不当成吸血", () => {
    const p = parseEffectText("若自身能力提升状态被吸取则令对手速度-1");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toContainEqual({ op: "apply_status", name: "react", target: "self", params: { trigger: 7 }, payload: [{ op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" }] });
  });

  it("护栏：「吸取对手N/M最大体力」仍走原读法（恢复自身N/M体力，不带 missing）", () => {
    // e8-hl-07 与 batch-e6-121 的 heal 读法不同（后者 missing=以已损失体力为基线）。
    // 同义扩展必须落在 e8-hl-07 上，否则这条会退化。
    const p = parseEffectText("吸收对手1/3最大体力");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toContainEqual({ op: "heal", numerator: 1, denominator: 3, target: "self" });
  });
});
