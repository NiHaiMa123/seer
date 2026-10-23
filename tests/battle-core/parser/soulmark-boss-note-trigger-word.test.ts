/**
 * boss 注记作用域：时点词**连「当」一起匹配**（2026-10-22 第二十三轮）。
 *
 * 缺口形状（pet-4343 凛锋剑心）：
 * 「……自身先出手则当回合对手无法通过自身技能恢复体力，对手先出手则当回合结束时恢复自身最大体力的1/3……（boss无效）」
 * - 句尾注记触发 boss 作用域切分；
 * - 切点本应落在「当回合结束时」上，但 `BOSS_SCOPE_TRIGGER_RE` 只匹配了「回合结束时」，
 *   **切点落在词中间**（「当」被留在前一段）；
 * - 于是「对手先出手则」这条条件与它的载荷被劈开 → 条件成 cond-orphan 孤儿，
 *   载荷失去守卫 → **回合末无条件回血**。
 *
 * 修法：时点词连「当」一起匹配（当回合开始/当回合结束），切点落在词首，
 *   「条件 + 则」的收尾规则便能把条件与载荷收回同一作用域。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("boss 注记作用域：时点词连「当」一起匹配", () => {
  it("pet-4343 凛锋剑心：条件与其载荷同域，载荷不得无条件执行", () => {
    const r = parseSoulmarkText(
      "自身使用攻击技能时若为连续2次使用则100%令对手冰封，自身使用属性技能时若不为连续2次使用则恢复自身所有技能1点PP值；自身先出手则当回合对手无法通过自身技能恢复体力，对手先出手则当回合结束时恢复自身最大体力的1/3并造成等量百分比伤害（boss无效）",
      "凛锋剑心",
    );
    const heal = r.entries.find((e) => e.ops?.some((o) => (o as { op?: string }).op === "heal"));
    expect(heal).toBeDefined();
    // 「对手先出手」条件（order:last）必须仍在载荷上
    expect(JSON.stringify(heal?.guard ?? {}) + JSON.stringify(heal?.ops ?? [])).toContain("order");
    // 条件短语不该被单独切成一条残文
    expect(r.unparsed.some((u) => u.clause === "对手先出手则")).toBe(false);
    // 「造成等量百分比伤害」不能收成 foeEcho：结算是固定伤直扣，不进百分比伤管线。回血留下。
    const healOp = (heal?.ops ?? []).find((o) => (o as { op?: string }).op === "heal") as { foeEcho?: unknown } | undefined;
    expect(healOp?.foeEcho).toBeUndefined();
    expect(r.unparsed.some((u) => u.clause === "造成等量百分比伤害")).toBe(true);
  });

  it("pet-3315 圣光麒麟：两个注记各管一句，第三句（无注记）不被罩", () => {
    const r = parseSoulmarkText(
      "其效果为回合结束时若对手体力高于当回合开始时，则下回合自身攻击先制+3且造成的伤害翻倍（BOSS无效）；回合结束时若当回合自身体力减少量大于400则恢复自身1/3最大体力并造成等量固定伤害（BOSS无效）；自身先出手则在回合结束时解除自身异常状态，后出手则附加自身当前体力1/3的固定伤害。",
      "圣光麒麟",
    );
    const gated = r.entries.filter((e) => e.bossGate === true);
    const ungated = r.entries.filter((e) => e.bossGate !== true);
    expect(gated.length).toBe(2);
    // 第三句（先出手/后出手）没有注记 → 不受 boss 门控
    expect(ungated.some((e) => JSON.stringify(e.ops).includes("cleanse"))).toBe(true);
    // 「自身攻击先制+3」没有「技能」二字，timed-bare-05 接不住。先制只加在攻击上。
    const prio = r.entries.flatMap((e) => e.ops ?? []).find((o) => (o as { name?: string }).name === "prio_up") as { params?: { add?: number; cat?: number } } | undefined;
    expect(prio?.params).toEqual({ add: 3, cat: 4 });
    // 第二句是等量固定伤害，foeEcho 布尔留下。
    const echo = r.entries.flatMap((e) => e.ops ?? []).find((o) => (o as { op?: string }).op === "heal") as { foeEcho?: unknown } | undefined;
    expect(echo?.foeEcho).toBe(true);
  });

  it("裸「自身先制+N」仍是全类别，不因攻击先制的类别门被误伤", () => {
    const r = parseSoulmarkText("回合结束时自身先制+1");
    const prio = r.entries.flatMap((e) => e.ops ?? []).find((o) => (o as { name?: string }).name === "prio_up") as { params?: Record<string, unknown> } | undefined;
    expect(prio?.params).toEqual({ add: 1 });
  });
});

describe("内容包：这四处不再挂错效果", () => {
  const marks = JSON.parse(readFileSync("content/peak/soulmarks.json", "utf8")).soulmarks as Record<string, { effects: Array<{ hook?: string; ops?: Array<Record<string, unknown>> }> }>;
  const units = JSON.parse(readFileSync("content/peak/units.json", "utf8")).units as Array<{ id: string; soulMark?: string }>;

  it("sm-3315 攻击先制带 cat 4，等量固定伤害仍是 foeEcho", () => {
    const ops = (marks["sm-3315"]?.effects ?? []).flatMap((e) => e.ops ?? []);
    expect(ops.find((o) => o.name === "prio_up")?.params).toEqual({ add: 3, cat: 4 });
    expect(ops.find((o) => o.op === "heal")?.foeEcho).toBe(true);
  });

  it("sm-4343 只留 1/3 回血，不挂百分比回响", () => {
    const heal = (marks["sm-4343"]?.effects ?? []).flatMap((e) => e.ops ?? []).find((o) => o.op === "heal");
    expect(heal).toMatchObject({ numerator: 1, denominator: 3, target: "self" });
    expect(heal?.foeEcho).toBeUndefined();
  });

  it("sm-4505 不再无条件回合末吸取 100", () => {
    expect((marks["sm-4505"]?.effects ?? []).some((e) => e.hook === "onTurnEnd")).toBe(false);
  });

  it("sm-4680 错误回合末拼句已卸下，单位不再挂这条魂印", () => {
    expect(marks["sm-4680"]).toBeUndefined();
    expect(units.find((u) => u.id === "pet-4680")?.soulMark).toBeUndefined();
  });
});
