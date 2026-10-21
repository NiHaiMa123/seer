/**
 * 双方某维之差 n —— 把 n 落成可读的「双方该维数值差」。
 *
 * 语料只有 4 只（决囚钢骨/堕魂之手/覆骸冥土/拟态绞索），结构固定：
 *   回合开始时自身根据双方<维度>之差n触发如下效果：
 *     ① <以 n 为幅值的效果 A>
 *     ② 恢复 n 点体力
 *     ③ 若 n≥200 则 <效果 B>
 * 维度四种：防御 / 特防 / 体力上限 / 速度。
 *
 * 设计：不给引擎引入局部变量作用域，而是让每个 op 各自带 statDiff:<维度>
 * 幅值来源，结算时按 |自身该维 - 对手该维| 求值。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const CASES = [
  { name: "决囚钢骨", stat: "def", text: "回合开始时自身根据双方防御值之差n触发以下效果： ①.当回合被击败时对手无法主动切换精灵n/200回合 ②.恢复n点体力 ③.若n≥200则当回合受到的非真实伤害减少30%" },
  { name: "堕魂之手", stat: "sdf", text: "回合开始时自身根据双方特防值之差n触发如下效果：①.当回合造成的攻击伤害提升n%；②.恢复n点体力；③.若n≥200则当回合免疫受到的异常状态（boss无效）" },
  { name: "覆骸冥土", stat: "hp", text: "回合开始时自身根据双方体力上限值之差n触发如下效果：①.当回合受到的攻击伤害减少n点；②.恢复n点体力；③.若n≥200则当回合攻击必定打出致命一击（boss无效）" },
  { name: "拟态绞索", stat: "spd", text: "回合开始时自身根据双方速度值之差n触发如下效果：①.当回合使用技能时附加n点固定伤害②.恢复n点体力③.若n≥200则当回合所有技能先制+1（boss无效）" },
];

describe("双方某维之差 n", () => {
  it.each(CASES)("$name：支持已冻结幅值，其余语义留显式档", ({ name, text }) => {
    const r = parseSoulmarkText(text, name);
    const expectsResidual = name === "决囚钢骨" || name === "拟态绞索";
    expect(r.unparsed, name + ": " + JSON.stringify(r.unparsed)).toHaveLength(expectsResidual ? 1 : 0);
    if (expectsResidual) expect(r.unparsed[0]?.reason).toContain("statDiff timing");
    expect(r.entries.length, name).toBeGreaterThanOrEqual(1);
    const ops = r.entries.flatMap((e) => e.ops ?? []);
    expect(ops.length, name).toBe(name === "堕魂之手" || name === "覆骸冥土" ? 3 : 2);
    expect(JSON.stringify(ops)).not.toMatch(/"name":"(?:foe_dot|no_switch)"/);
  });

  it.each(CASES)("$name：恢复 n 点体力带 statDiff=$stat", ({ name, text, stat }) => {
    const r = parseSoulmarkText(text, name);
    const healOps = r.entries.flatMap((e) => e.ops ?? []).filter((o) => o.op === "heal");
    expect(healOps.length, name).toBeGreaterThan(0);
    expect(JSON.stringify(healOps)).toMatch(new RegExp('"statDiff":"' + stat + '"'));
  });

  it("③ 的 n≥200 门控成为条件", () => {
    const r = parseSoulmarkText(CASES[0]!.text, "决囚钢骨");
    expect(r.entries[0]?.ops?.find((op) => op.name === "dmg_taken_down")).toMatchObject({
      params: { pct: 30, kindMask: 7 },
      if: { statDiffAbove: { stat: "def", atLeast: 200 } },
    });
  });

  it("回合开始时快照减伤/增伤按 apply 冻结，技能触发附伤与 KO 时长仍留档", () => {
    const red = parseSoulmarkText("回合开始时自身根据双方体力上限值之差n触发如下效果：①当回合受到的攻击伤害减少n点");
    const redOp = red.entries.flatMap((entry) => entry.ops ?? []).find((op) => op.name === "dmg_reduce");
    expect(redOp).toMatchObject({
      amountTiming: "apply",
      statDiff: "hp",
      turns: 1,
      params: { kindMask: 4 },
    });

    const unqualifiedRed = parseSoulmarkText("回合开始时自身根据双方体力上限值之差n触发如下效果：①当回合受到的伤害减少n点");
    const unqualifiedRedOp = unqualifiedRed.entries.flatMap((entry) => entry.ops ?? []).find((op) => op.name === "dmg_reduce");
    expect(unqualifiedRedOp).toMatchObject({ amountTiming: "apply", statDiff: "hp", turns: 1 });
    expect(unqualifiedRedOp).not.toHaveProperty("params.kindMask");

    const boost = parseSoulmarkText("回合开始时自身根据双方特防值之差n触发如下效果：①当回合造成的攻击伤害提升n%");
    const boostOp = boost.entries.flatMap((entry) => entry.ops ?? []).find((op) => op.name === "dmg_boost");
    expect(boostOp).toMatchObject({
      amountTiming: "apply",
      statDiff: "sdf",
      turns: 1,
      params: { kindMask: 4 },
    });

    const unqualifiedBoost = parseSoulmarkText("回合开始时自身根据双方特防值之差n触发如下效果：①当回合造成的伤害提升n%");
    const unqualifiedBoostOp = unqualifiedBoost.entries.flatMap((entry) => entry.ops ?? []).find((op) => op.name === "dmg_boost");
    expect(unqualifiedBoostOp).toMatchObject({ amountTiming: "apply", statDiff: "sdf", turns: 1 });
    expect(unqualifiedBoostOp).not.toHaveProperty("params.kindMask");

    const phrases = [
      "回合开始时自身根据双方速度值之差n触发如下效果：①当回合使用技能时附加n点固定伤害",
      "回合开始时自身根据双方防御值之差n触发如下效果：①当回合被击败时对手无法主动切换精灵n/200回合",
    ];
    for (const text of phrases) {
      const r = parseSoulmarkText(text);
      expect(r.entries).toEqual([]);
      expect(r.unparsed).toHaveLength(1);
      expect(r.unparsed[0]?.reason).toContain("statDiff timing");
    }
  });

  it("n>200 使用严格整数边界 n≥201，n≥200 保持 200", () => {
    const strict = parseSoulmarkText("回合开始时自身根据双方防御值之差n触发如下效果：①恢复n点体力②若n>200则恢复n点体力");
    const inclusive = parseSoulmarkText("回合开始时自身根据双方防御值之差n触发如下效果：①恢复n点体力②若n≥200则恢复n点体力");
    const hasStatDiffGate = (op: { if?: unknown }) => (op.if as { statDiffAbove?: unknown } | undefined)?.statDiffAbove !== undefined;
    const strictGate = strict.entries.flatMap((entry) => entry.ops ?? []).find(hasStatDiffGate);
    const inclusiveGate = inclusive.entries.flatMap((entry) => entry.ops ?? []).find(hasStatDiffGate);
    expect(strictGate?.if).toEqual({ statDiffAbove: { stat: "def", atLeast: 201 } });
    expect(inclusiveGate?.if).toEqual({ statDiffAbove: { stat: "def", atLeast: 200 } });
  });

  it("普通句子不被误吃", () => {
    const r = parseSoulmarkText("恢复自身最大体力的1/3", "别的精灵");
    expect(JSON.stringify(r.entries)).toMatch(/heal/);
    expect(JSON.stringify(r.entries)).not.toMatch(/statDiff/);
  });
});
