/**
 * boss 注记作用域：「当回合」的「当」不是条件守卫（2026-10-22 第二十二轮）。
 *
 * 缺口形状（pet-3422 / pet-3446 蒂亚斯）：
 * 「回合开始时自身体力低于对手则当回合自身技能有70%几率令对手害怕，未触发则回合结束时附加…（BOSS无效）」
 * - 句尾「（boss无效）」触发 boss 作用域切分，切点落在「回合结束时」上；
 * - 切分锚点里的「若/当」守卫回退把作用域起点拉到了「**当回合**」——
 *   「当回合」的「当」是**时点词**（本回合），不是条件守卫；
 * - 于是「自身体力低于对手则」被切到前一段 → **负载失去守卫 → 无条件执行**。
 *
 * 修法：守卫回退的目标不能是「当回合」——
 *   a) 「则」引出的载荷里（条件、载荷、触发词同属一个子句）→ 回退到**触发词起点**（整句同域）；
 *   b) 「若」子句把触发词包在里面（条件含快照时点、不可建模）→ 维持原回退点
 *      （负载仍跟着条件一起被扣下，不无条件执行）。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("boss 注记作用域：「当回合」的「当」不当条件守卫", () => {
  it("pet-3422 蒂亚斯：条件与负载同域，负载不得无条件执行", () => {
    const r = parseSoulmarkText(
      "每回合开始时令对手随机2项属性-1；回合开始时自身体力低于对手则当回合自身技能有70%几率令对手害怕，未触发则回合结束时附加对手最大体力1/4的固定伤害（BOSS无效）",
      "蒂亚斯",
    );
    const react = r.entries.find((e) => e.ops?.some((o) => (o as { name?: string }).name === "react"));
    expect(react).toBeDefined();
    expect(react?.hook).toBe("onTurnStart");
    // 条件必须落在负载上（op 级 if 或条目 guard），不能凭空消失
    const conds = JSON.stringify(react?.guard ?? {}) + JSON.stringify(react?.ops ?? []);
    expect(conds).toContain("selfHpBelowFoe");
    // 条件短语不该被单独切成一条残文
    expect(r.unparsed.some((u) => u.clause === "自身体力低于对手则")).toBe(false);
  });

  it("pet-3446 混沌蒂亚斯：同上（同源文本）", () => {
    const r = parseSoulmarkText(
      "回合开始时自身体力低于对手则当回合技能80%令对手害怕，未触发则回合结束时吸取对手1/4最大体力且下次触发几率提升100%（boss无效）",
      "混沌蒂亚斯",
    );
    const react = r.entries.find((e) => e.ops?.some((o) => (o as { name?: string }).name === "react"));
    expect(react).toBeDefined();
    expect(JSON.stringify(react?.guard ?? {}) + JSON.stringify(react?.ops ?? [])).toContain("selfHpBelowFoe");
  });

  it("pet-3261 暗影极夜·诺伊尔顿：条件含快照时点、不可建模 → 负载仍被扣下（不得无条件执行）", () => {
    const r = parseSoulmarkText(
      "诺：若回合开始时自身满体力则当回合自身受到攻击时使对手害怕（boss无效）；登场3回合内所有攻击造成伤害30%将恢复体力",
      "暗影极夜·诺伊尔顿",
    );
    // 「回合开始时自身满体力」没有对应谓词 → 负载必须留残文，不产生无条件条目
    expect(r.entries.some((e) => e.ops?.some((o) => (o as { name?: string }).name === "fear"))).toBe(false);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });

  it("pet-3831 魔化庚辰：「当回合未受到攻击则」的条件从句仍要当守卫", () => {
    const r = parseSoulmarkText(
      "侲:若对手为自身天敌则造成的伤害提升40%-80%；回合开始时若自身体力高于对手，当回合受到攻击伤害后80%令对手害怕，当回合未受到攻击则回合结束时恢复自身最大体力的1/3并造成等量固伤（boss无效）",
      "魔化庚辰",
    );
    // 「未受到攻击」条件（prevTakenZero）必须仍在负载上
    expect(JSON.stringify(r.entries)).toContain("prevTakenZero");
  });
});
