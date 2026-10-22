/**
 * boss 注记作用域：**切点落在「若」的子句内部才回退**（2026-10-22 第十八轮）。
 *
 * 缺口形状（pet-4751 珀瑞涅 / pet-4752 镇魂约凡撒）：
 * 「自身打出致命一击后，若体力上限不大于100则消耗自身全部体力并令对手失明，
 *   且本场战斗中己方所有精灵登场时为自身附加…（boss无效）」
 * - 「自身打出致命一击后」被裸条件通道存成 pendingCond（触发词当条件用）；
 * - 句尾「（boss无效）」触发 boss 作用域切分，切点落在「登场时」上；
 * - 切分锚点里的「若/当」守卫回退把作用域起点拉到了「若体力上限不大于100」——
 *   触发词留在前一段、它的载荷落进后一段；
 * - pendingCond 跨不了 clause 边界 → 前一段末尾 cond-orphan 孤儿、后一段的载荷失去门
 *   → 「消耗自身全部体力 + 令对手失明」无条件执行。
 *
 * 修法：回退只在**切点落在该「若」自己的子句内部**时做——
 *   条件短语内部（"若自身体力低于**回合开始时**则…"）：切开会把条件短语劈开 → 必须回退；
 *   载荷段内部（"若P则每回合**结束时**X"）：切开会拆散条件与负载 → 必须回退；
 *   切点若在**别的子句**（pet-4751）：回退会把中间整段划出 boss 门作用域 → 不得回退。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("boss 注记作用域：「若」的回退只在切点落在其子句内时生效", () => {
  it("pet-4751 珀瑞涅：触发词不再与载荷分属两段，prevCrit 门保住", () => {
    const r = parseSoulmarkText(
      "自身打出致命一击后，若体力上限大于100则减少自身等同于自身初始体力上限1/8的体力上限，若体力上限不大于100则消耗自身全部体力并令对手失明，且本场战斗中己方所有精灵登场时为自身附加星哲、星赐中随机一种异常状态2回合，战斗阶段结束时，上述效果每减少过1点体力上限自身恢复1点体力(boss无效)",
      "珀瑞涅",
    );
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd).toBeDefined();
    // 触发词作为条件被负载消费（不再是无条件执行）
    expect((turnEnd!.ops ?? []).some((o) => (o as { if?: unknown }).if !== undefined)).toBe(true);
    expect(r.unparsed.some((u) => u.reason === "cond-orphan")).toBe(false);
  });

  it("pet-4752 镇魂约凡撒：同上（与 pet-4751 同源文本）", () => {
    const r = parseSoulmarkText(
      "自身打出致命一击后，若体力上限大于100则减少自身等同于自身初始体力上限1/8的体力上限，若体力上限不大于100则消耗自身全部体力并令对手失明，且本场战斗中己方所有精灵登场时为自身附加星哲、星赐中随机一种异常状态2回合，战斗阶段结束时，上述效果每减少过1点体力上限自身恢复1点体力(boss无效)",
      "镇魂约凡撒",
    );
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect((turnEnd!.ops ?? []).some((o) => (o as { if?: unknown }).if !== undefined)).toBe(true);
  });

  it("pet-3935 极鳞魔兽：触发词在条件短语内时仍要回退（回合开始时快照守卫不丢）", () => {
    const r = parseSoulmarkText(
      "鳞 1、回合结束时，若自身体力等于回合开始时则自身下回合受到的攻击伤害减少50% 2、若自身体力高于回合开始时则自身自身下回合造成的攻击伤害提升50% 3、若自身体力低于回合开始时则自身下回合攻击吸取对手最大体力的1/3 4、若当前体力低于最大体力的1/3则下回合攻击先制+3 5、（boss无效）",
      "极鳞魔兽",
    );
    // 「若自身体力低于回合开始时」这条分支的守卫仍在
    expect(r.entries.some((e) => e.guard !== undefined && JSON.stringify(e.guard).includes("hpBelowTurnStart"))).toBe(true);
  });

  it("pet-2741 吉罗德：「若P时，则每回合结束时…」的条件不被切掉", () => {
    const r = parseSoulmarkText("拓:若对手能力不处于提升状态时，则每回合结束时减少对手1/5最大HP（boss免疫）", "吉罗德");
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd?.guard).toEqual({ not: { foeStageUp: true } });
  });
});
