/**
 * 逐只处理：pet-3637 不灭地威·萨瑞卡 / pet-3839 索格瑞亚
 * ＋「且」内联切分的分组修正。
 *
 * 三个缺口：
 * 1. pet-3637「反弹给对手造成伤害50%的固伤」：e36-15 只认「…%的伤害」，
 *    「固伤」这种别称不认 → 整段 no-rule。
 * 2. pet-3839「…则将受到的攻击伤害降低50%」：heal-184 只认句首的「受到…伤害降低N%」，
 *    句中的「将」（把字标记）剥不掉（normalizeClause 的剥除锚定句首）→ 整段 no-rule。
 * 3. 「且」内联切分（"A，B且C"）：切出的前半段被直接塞进当前组，于是 A 的触发词与
 *    守卫罩住了 C——C 的触发词丢失，条件还可能被 A 的守卫反号
 *    （pet-3839：双防提升条件把「不处于」取反成「处于」，效果永远不触发）。
 *
 * 改法：
 *  - tools/effects-rules/batch-e36.mjs e36-15：尾词收「固伤/固定伤害」。
 *  - tools/effects-rules/heal.mjs heal-184：句首允许「将/把」。
 *  - tools/soulmark-parse.mjs：「且」切分时前半段按普通分段处理（自带触发词则另起一组），
 *    但**结果分支标记**（"触发成功/未触发…"）所在分支不拆——它的尾句必须跟着该分支作用域，
 *    否则会逃成无条件条目（见 soulmark-parse.test 的「不误伤并列子句」用例）。
 * 没有新 op、没有新状态名、没有新 params 键、没有新的结算分支。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const effectsOf = (s: string) =>
  (parseEffectText(s) as { effects: unknown[]; unparsed: { clause?: string; reason?: string }[] });

describe("逐只处理 pet-3637 萨瑞卡：「反弹…50%的固伤」", () => {
  it("新句：固伤别称落到 reflect_dmg（比例 50%）", () => {
    const r = effectsOf("反弹给对手造成伤害50%的固伤");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 50, d: 100 } },
    ]);
  });

  it("旧句不回归：「…%的伤害」写法结果不变", () => {
    const r = effectsOf("反弹给对手造成伤害50%的伤害");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 50, d: 100 } },
    ]);
  });
});

describe("逐只处理 pet-3839 索格瑞亚：「则将受到的攻击伤害降低50%」", () => {
  it("新句：句中的「将」不挡规则", () => {
    const r = effectsOf("将受到的攻击伤害降低50%");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } },
    ]);
  });

  it("旧句不回归：不带「将」的写法结果不变", () => {
    const r = effectsOf("受到的攻击伤害降低50%");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } },
    ]);
  });
});

describe("「且」内联切分：A，B且C 的 C 拿到自己的触发词与条件", () => {
  const text =
    "攻击命中对手时若自身处于双防能力提升状态则造成的伤害提高100%，受到攻击时若自身不处于双防能力提升状态则将受到的攻击伤害降低50%且回合结束时恢复自身最大体力的1/3";

  it("两条分支各自成条目，条件互为反号", () => {
    const r = parseSoulmarkText(text, "索格瑞亚");
    expect(r.unparsed).toEqual([]);
    const boost = r.entries.find((e) => e.ops?.some((o) => o.op === "apply_status" && o.name === "dmg_boost"));
    const reduce = r.entries.find((e) => e.ops?.some((o) => o.op === "apply_status" && o.name === "dmg_taken_down"));
    expect(boost?.hook).toBe("onMoveUsed");
    expect(reduce?.hook).toBe("onDamaged");
    // 正号分支：处于双防提升；反号分支：不处于双防提升——不能串成同一条
    expect(JSON.stringify(boost?.guard)).toContain("selfStatAtLeast");
    expect(JSON.stringify(reduce?.guard)).toContain("not");
  });

  it("结果分支标记不拆：「触发成功则…」的尾句仍跟着该分支作用域", () => {
    const r = parseSoulmarkText(
      "回合开始时消除对手能力提升状态，触发成功则阈值降低100点且本场战斗造成的攻击伤害提升10%",
    );
    // 尾句不得逃成无条件条目（不误伤并列子句）
    expect(r.entries.flatMap((e) => e.ops ?? []).some((o) => o.name === "dmg_boost")).toBe(false);
    expect(r.unparsed.some((u) => u.reason?.includes("prevApplied branch continuation"))).toBe(true);
  });
});
