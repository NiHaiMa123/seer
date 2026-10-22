/**
 * boss 注记作用域切分：**条件与负载不得被切开**（2026-10-22 第十五轮）。
 *
 * 缺口形状：「…自身受到攻击伤害高于400则回合结束时恢复自身最大体力1/3（boss无效）」——
 * 句尾「（boss无效）」触发 `splitLocalBossScopes` 的作用域切分，切点落在「回合结束时」上：
 *   - 前一段以「自身受到攻击伤害高于400则」结尾 → 条件被暂存进 pendingCond 却无人消费
 *     → 残文 `cond-orphan`；
 *   - 后一段的负载失去条件 → **每回合末无条件回血**。
 *
 * 第十二轮修的是「未触发则 + 时序」这一类（结果分支标记）；本轮把同一修法推广到
 * **任何以「条件 + 则」收尾的前缀**：条件与它的负载同属一句，切分不得落在两者之间。
 *
 * 附带修正：条件留在后段时，后续子句的读法随之归位（pet-4075 的「自身每处于1种能力
 * 提升状态则恢复60点体力」缩放基准由 foe/down 归回 self/up）。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("boss 注记作用域：条件与负载同域", () => {
  it("pet-3767 加梵迪：条件挂在回合末条目上，不再无条件回血", () => {
    const r = parseSoulmarkText(
      "迪：受到攻击时自身双防+1；自身受到攻击伤害低于400则将伤害100%反弹给对手（双方同时死亡时则对手残留1点体力），自身受到攻击伤害高于400则回合结束时恢复自身最大体力1/3（boss无效）",
      "加梵迪",
    );
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd).toBeDefined();
    expect(turnEnd!.guard).toEqual({ prevDamageAboveAbs: 400 });
    // 条件不再被甩成孤儿残文
    expect(r.unparsed.some((u) => u.reason === "cond-orphan")).toBe(false);
  });

  it("pet-4020 哀狂达尔：「未打出致命一击则」的分支带 not-prevCrit 条件", () => {
    const r = parseSoulmarkText(
      "狂 1、自身所有攻击技能50%打出致命一击 2、打出致命一击则100%令对手害怕 3、未打出致命一击则回合结束时附加自身最大体力30%的固定伤害 4、自身在本场战斗中战斗的回合数每累计超过3回合则附加的固定伤害值提升10%，最高100% 5、（boss无效）",
      "哀狂达尔",
    );
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd?.guard).toEqual({ not: { prevCrit: true } });
  });

  it("pet-3933 离歌：「未触发异常状态则」的分支带 not-prevApplied 条件", () => {
    const r = parseSoulmarkText(
      "离：对手为雌性精灵则攻击命中后50%令对手失明，对手为雄性精灵则攻击命中后50%令对手睡眠，未触发异常状态则回合结束时100%令对手随机1个技能PP值归零（boss无效）",
      "离歌",
    );
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd?.guard).toEqual({ not: { prevApplied: true } });
  });

  it("没有 boss 注记时行为不变（同一句去掉括注）", () => {
    const bare = parseSoulmarkText(
      "自身受到攻击伤害高于400则回合结束时恢复自身最大体力1/3",
      "测试",
    );
    const noted = parseSoulmarkText(
      "自身受到攻击伤害高于400则回合结束时恢复自身最大体力1/3（boss无效）",
      "测试",
    );
    // 括注只多出 boss 门控，条件与负载的归属必须一致
    const shape = (r: { entries: { hook?: string; guard?: unknown; ops?: unknown[] }[] }) =>
      r.entries.map((e) => ({ hook: e.hook, guard: e.guard, ops: e.ops }));
    expect(shape(noted)).toEqual(shape(bare));
  });
});
