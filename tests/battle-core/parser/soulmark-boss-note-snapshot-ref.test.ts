/**
 * boss 注记作用域：**快照引用里的时点词不是切点**（2026-10-22 第二十一轮）。
 *
 * 缺口形状：「…与回合开始时差值的护盾（boss无效）」——
 * `BOSS_SCOPE_TRIGGER_RE` 把「回合开始时」当成了时序锚点，可它在这句里是**名词**
 * （"自身体力与回合开始时[的体力]差值"里的快照引用）。于是作用域切在子句中间：
 *   - 尾注所属的子句被劈成两半；
 *   - 带注记的那半落进 boss 门作用域却产不出条目 → **整条注记被丢弃**；
 *   - 原文明明写了「boss无效」，现网却让该效果照常生效。
 *
 * 修法：时点词落在**名词位置**（后面紧跟「的/所/差/值/之」）时不是时序锚点，不开启新作用域。
 * 边界：「在回合结束时降低…」这类**状语**位置仍照旧切分（切开会分离触发词与其载荷）。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("boss 注记作用域：快照引用里的时点词不开启新作用域", () => {
  it("pet-4877 锢魂铁犀：注记落在唯一那句的效果上，不被整条丢弃", () => {
    const r = parseSoulmarkText(
      "回合开始时，若自身体力高于对手，则当回合自身攻击技能命中时消耗30%的体力并附加自身最大体力30%的百分比伤害且回合结束时获得等同于自身体力与回合开始时差值的护盾（boss无效）",
      "锢魂铁犀",
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ hook: "onTurnStart", bossGate: true, guard: { selfHpAboveFoe: true } });
    // 快照引用不该被劈成两半残文
    expect(r.unparsed.some((u) => u.clause === "差值的护盾")).toBe(false);
  });

  it("pet-4921 天堂极龙兽：末句的注记落在该句的回合末回血上", () => {
    const r = parseSoulmarkText(
      "战斗阶段结束时，自身恢复最大体力的1/4，上述效果每满足过1次效果提升1/4，最高不超过自身战斗开始时所记录数值，未溢出时下回合自身以最优系别计算受到的攻击伤害与造成的攻击伤害（boss无效）",
      "天堂极龙兽",
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ hook: "onTurnEnd", bossGate: true });
    expect(r.unparsed.some((u) => u.clause === "所记录数值")).toBe(false);
  });

  it("pet-3396 灾厄女神潘多拉：末段能力不再整段丢失（守卫是已建模的 hpBelowTurnStartFrac）", () => {
    const r = parseSoulmarkText(
      "回合结束时若自身体力低于当回合开始时的50%，则恢复自身最大体力的1/3并造成等量固定伤害（BOSS无效）",
      "灾厄女神潘多拉",
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      hook: "onTurnEnd",
      bossGate: true,
      guard: { hpBelowTurnStartFrac: { numerator: 50, denominator: 100 } },
    });
    // 「等量固伤」按本次实际回复量结算
    expect((r.entries[0].ops ?? []).some((o) => (o as { foeEcho?: boolean }).foeEcho === true)).toBe(true);
  });

  it("状语位置的时点词仍照旧切分（pet-2832：回合结束时的载荷不能并回用技触发）", () => {
    const r = parseSoulmarkText(
      "殇:使用技能时若对手处于冻伤状态，则100%使对手冰封；每次使用攻击技能在回合结束时降低对手1/3当前体力(boss免疫）",
      "罗迪尼奥",
    );
    expect(r.entries.some((e) => e.hook === "onTurnEnd" && e.bossGate === true)).toBe(true);
  });
});
