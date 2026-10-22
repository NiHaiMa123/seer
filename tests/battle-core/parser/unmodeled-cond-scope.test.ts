/**
 * 未建模条件的作用域：**负载不许无条件执行**（2026-10-22 第十轮）。
 *
 * 缺口形状：「自身微弱对手时 …；自身克制对手时，战斗阶段结束时自身恢复所有技能2点PP值…」——
 * 两个**未建模的条件**（克制关系/性别域）后面跟着一个负载组。
 *
 * 之前的两个 bug（都让 pet-4814 娜诺的负载**无条件执行**）：
 *   ① condHold 被消费时清掉了标记，但 guardQuarantine 仍为真 —— 下一个未建模条件组
 *      会通过「解除扣留」分支把扣留状态提前解除，负载随后被放行。
 *   ② clause 级检查（guardQuarantine && clause !== ""）只看 startsWithSupportedTrigger，
 *      没看 condHold —— 分号分隔的下一个 clause 会把扣留状态清掉。
 *
 * 修法：
 *   - 被扣下的组**不改** condHold（扣留状态由 clause 边界收口）；
 *   - 条件尚缺负载时继续扣留；同一分号子句已包含完整负载后，独立显式事件可以重新解析。
 *
 * 边界：条件作用域的**精确**边界语法上不可判定（分号既可能是分隔也可能是同句延续），
 * 这里按「clause 边界」近似——宁可多留残文（效果缺失且有记录），不可无条件执行。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("未建模条件的作用域：负载不许无条件执行", () => {
  it("同一分号子句已包含完整负载后，不吞掉后面的独立触发", () => {
    const r = parseSoulmarkText("自身克制对手时，回合结束时自身恢复100点体力；回合开始时自身攻击+1", "测试");
    expect(r.entries).toEqual([{ hook: "onTurnStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] }]);
    expect(r.unparsed.some((u) => u.clause.includes("恢复100点体力"))).toBe(true);
    expect(r.unparsed.some((u) => u.clause.includes("攻击+1"))).toBe(false);
  });

  it("未知状态的翻倍尾句不能生成无条件增伤，独立回合事件仍可解析", () => {
    const r = parseSoulmarkText("使用攻击时，若自身为圣念状态则造成伤害的50%恢复自身体力，先出手时效果翻倍；回合开始时自身攻击+1", "测试");
    expect(r.entries).toEqual([{ hook: "onTurnStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] }]);
    expect(r.unparsed.some((u) => u.clause.includes("效果翻倍"))).toBe(true);
  });

  it("且前的条件效果保留攻击事件，不默认成回合末减伤", () => {
    const r = parseSoulmarkText("对手使用攻击技能时，若对手不处于异常状态则受到伤害减少20%且受到攻击后令对手烧伤", "测试");
    expect(r.entries).toEqual([]);
    expect(r.unparsed.some((u) => u.clause.includes("对手使用攻击技能时") && u.clause.includes("减少20%"))).toBe(true);
    expect(r.unparsed.some((u) => u.clause.includes("令对手烧伤"))).toBe(true);
  });

  it("动态烧伤概率挂每次攻击，不挂开战", () => {
    const r = parseSoulmarkText("攻击有自身当前体力百分比的概率使对手烧伤", "测试");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{ hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3] }, chance: { dyn: "selfHpPct" }, ops: [{ op: "apply_status", name: "burn", target: "opponent" }] }]);
  });

  it("pet-4814 娜诺：克制关系未建模 → 负载组整句留档，不产生无条件条目", () => {
    const r = parseSoulmarkText(
      "回合开始时，若对手不为雌性精灵，自身受到的固定伤害、百分比伤害减少30%，对手处于能力提升状态时效果翻倍 自身微弱对手时，对手计算攻击伤害时的乘以克制倍数改为除以且回合结束后恢复自身最大体力的1/3;自身克制对手时，战斗阶段结束时自身恢复所有技能2点PP值且反转对手能力提升状态;若自身对对手克制系数为1，则使用技能时令对手流血，未触发则消除对手回合类效果 自身存活于出战阵容时，己方场下体力不为满的精灵体力不会下降 (boss无效)",
      "娜诺",
    );
    // 「战斗阶段结束时自身恢复所有技能2点PP值且反转对手能力提升状态」不得变成无条件条目
    const unconditional = r.entries.some((e) => (e.ops ?? []).some((o) => (o as { op?: string }).op === "pp_delta" || (o as { op?: string }).op === "invert_stages"));
    expect(unconditional).toBe(false);
    // 负载必须留有残文记录
    expect(r.unparsed.some((u) => u.clause.includes("战斗阶段结束时自身恢复所有技能2点PP值"))).toBe(true);
  });

  it("单一未建模条件 + 负载：负载同样不被放行", () => {
    const r = parseSoulmarkText("自身克制对手时，战斗阶段结束时令对手速度-1", "测试");
    expect(r.entries).toHaveLength(0);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });

  it("两个连续未建模条件 + 负载（分号分隔）：负载不被放行", () => {
    const r = parseSoulmarkText(
      "自身微弱对手时;自身克制对手时，战斗阶段结束时令对手速度-1",
      "测试",
    );
    expect(r.entries).toHaveLength(0);
    expect(r.unparsed.some((u) => u.clause.includes("战斗阶段结束时令对手速度-1"))).toBe(true);
  });

  it("可建模条件不受影响（自身处于能力提升状态时）", () => {
    const r = parseSoulmarkText("自身处于能力提升状态时，战斗阶段结束时令对手速度-1", "测试");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onTurnEnd",
        ops: [{ op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", if: { selfStageUp: true } }],
      },
    ]);
  });
});
