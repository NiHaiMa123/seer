/**
 * 逐只处理：pet-2909 鱼斯拉（魂印「若我方使用攻击技能，20%的概率令对面进入冰封」）。
 *
 * 缺口：逗号把「若我方使用攻击技能」与负载「20%的概率令对面进入冰封」切成两组。
 * 第一组是「若」形触发词、到组尾就结束（没有「时/后/则」），而通用触发词
 * （soulmark-parse.mjs 的「使用攻击技能」条目）要求尾段必须存在，匹配不上 →
 * 触发词被丢掉、负载另起一段落到 onDamageDealt。
 * 后果是语义错位：原文是「用攻击技能时」，落成「造成伤害后」——
 * 且触发条件（必须是攻击技能）整个丢失。
 *
 * 改法：只加两条「若」形触发词（攻击技能 → cat [2,3]；属性技能 → cat 1），
 * 让裸触发组把钩子结转给下一组（既有 lastHook 机制），负载继承钩子与概率。
 * 没有新 op、没有新状态名、没有新 params 键、没有新的结算分支。
 *
 * 注意：通用触发词的尾段**没有**一起放开——实测会把
 * 「每次自身使用攻击技能在…」「自身使用攻击技能前…」等组尾误落成裸触发组，
 * 4 条魂印回归（pet-3139/3525/3557/4347），残文净增。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("逐只处理 pet-2909 鱼斯拉：「若我方使用攻击技能」+ 概率负载", () => {
  it("新句：触发词不再丢，挂 onMoveUsed + 攻击类别守卫 + 20% 概率", () => {
    const r = parseSoulmarkText("若我方使用攻击技能，20%的概率令对面进入冰封", "鱼斯拉");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      {
        hook: "onMoveUsed",
        chance: { base: 20 },
        ops: [{ op: "apply_status", name: "freeze", target: "opponent" }],
        guard: { actor: "self", cat: [2, 3] },
      },
    ]);
  });

  it("旧句不回归：「使用攻击技能时…」的纯用技形态不走「若」形新规则", () => {
    const r = parseSoulmarkText("使用攻击技能时20%令对手冰封", "鱼斯拉");
    expect(r.unparsed).toEqual([]);
    // 既有的纯用技 react 窗口：onBattleStart 装窗 + 概率落在负载上
    expect(r.entries[0]?.hook).toBe("onBattleStart");
  });

  it("旧句不回归：「若我方使用属性技能」仍走属性类别守卫（cat 1）", () => {
    const r = parseSoulmarkText("若我方使用属性技能，立即恢复自身1/5最大HP", "鱼斯拉");
    expect(r.unparsed).toEqual([]);
    expect(r.entries[0]?.guard).toEqual({ actor: "self", cat: 1 });
  });

  it("魂印层：pet-2909 整条无残文，两句各归其位", () => {
    const r = parseSoulmarkText(
      "溢：若我方使用攻击技能，20%的概率令对面进入冰封(boss免疫）；若我方使用属性技能，立即恢复自身1/5最大HP",
      "鱼斯拉",
    );
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]?.guard).toEqual({ actor: "self", cat: [2, 3] });
    expect(r.entries[1]?.guard).toEqual({ actor: "self", cat: 1 });
  });
});
