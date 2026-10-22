/**
 * 逐只处理：pet-3398 馨幻（魂印「…则出手后恢复自身最大体力的1/3并造成等量固定伤害」）。
 *
 * 缺口：触发词表里的「出手」只收 时/，/,，不收「后」。
 * 「出手后恢复自身最大体力的1/3」整组匹配不上触发词 → 回血那半句被丢掉，
 * 只剩「并造成等量固定伤害」落成 onDamageDealt（造成伤害后），语义错位。
 *
 * 改法：只把「出手」的尾词补上「后」（同一个触发词条目），没有新 op、
 * 没有新状态名、没有新 params 键、没有新的结算分支。
 *
 * 附带的既得发现（不在本轮修）：「若P则A，且B」这种并列分句里，
 * 条件 P 不随第二分句承接——把本句的「出手后」换成本来就支持的「出手时」，
 * 得到的是同一条无 guard 的 onMoveUsed 条目（见 tests 里那条对照断言），
 * 说明这是「则A且B」分句作用域的既有缺陷，不是「出手后」引入的。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("逐只处理 pet-3398 馨幻：「出手后」触发词", () => {
  it("新句：出手后回血 + 等量固伤挂在 onMoveUsed 上", () => {
    const r = parseSoulmarkText("出手后恢复自身最大体力的1/3并造成等量固定伤害", "馨幻");
    expect(r.unparsed).toEqual([]);
    expect(r.entries[0]?.hook).toBe("onMoveUsed");
    expect(r.entries[0]?.ops).toEqual([
      { op: "heal", numerator: 1, denominator: 3, target: "self", foeEcho: true },
    ]);
  });

  it("旧句不回归：「出手时」写法结果不变", () => {
    const r = parseSoulmarkText("出手时恢复自身最大体力的1/3", "馨幻");
    expect(r.unparsed).toEqual([]);
    expect(r.entries[0]?.hook).toBe("onMoveUsed");
    expect(r.entries[0]?.ops).toEqual([
      { op: "heal", numerator: 1, denominator: 3, target: "self" },
    ]);
  });

  it("对照：「出手时」与「出手后」在并列分句里同样不承接外层条件（既有缺陷，非本轮引入）", () => {
    const build = (mid: string) =>
      parseSoulmarkText(
        `回合开始时若自身不处于能力提升则当回合自身所有技能先制+1，且自身${mid}50%使自身全属性+1`,
        "瑞",
      );
    const a = build("出手时");
    const b = build("出手后");
    // 两者形态完全一致：第二条都是 onMoveUsed、都不带「不处于能力提升」这条 guard
    expect(b.entries[1]?.hook).toBe(a.entries[1]?.hook);
    expect(b.entries[1]?.guard).toEqual(a.entries[1]?.guard);
    expect(b.entries[1]?.guard).toEqual({ actor: "self" });
  });

  it("魂印层：pet-3398 整条无残文", () => {
    const r = parseSoulmarkText(
      "当回合自身造成的攻击伤害低于200则出手后恢复自身最大体力的1/3并造成等量固定伤害，同时有50%几率使对手下次攻击技能无效；当回合对手造成的攻击伤害低于300则回合结束时吸取对手最大体力的1/3（BOSS无效）",
      "馨幻",
    );
    expect(r.unparsed).toEqual([]);
  });
});
