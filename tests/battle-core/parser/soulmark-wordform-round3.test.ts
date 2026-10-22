/**
 * 魂印词形/归一修复（2026-10-21 第三轮）——4 只闭合 + 1 只效果开始生效。
 *
 * 闭合的 4 只（残文 1 → 0）：
 *   pet-4088 「令对手受到自身最大体力**值**30%的固定伤害」 → flatSelfPct（e8-ft-11 收「值」）
 *   pet-3361 「对手处于烧伤状态时**我方**攻击必定致命」      → 我方=自身，且不凭空套「若」
 *   pet-3463 「**出手后**恢复自身最大体力的1/3」             → 「后」残头剥字移到 part 级
 *   pet-3675 「**之后**恢复自身所有体力」                    → 同上
 *
 * 另有一只效果开始生效（残文未归零，仍属 deferred 族）：
 *   pet-3629 「对手使用攻击技能则我方受到的伤害减少260点」——此前整句 no-rule（完全没生效），
 *           修好后产出 dmg_reduce；剩余残文是「boss 门跨 react 窗」这一已知机制缺口。
 *
 * 三处根因（都不是「规则表少认一种写法」，而是归一/剥字层的顺序 bug）：
 *
 * 1. **「我方」→「若自身」凭空加「若」**
 *    soulmark-parse.mjs 的归一链写的是 `.replace(/^若?我方(?=…)/, "若自身")`——
 *    替换串写死成「若自身」，原句没有「若」时（pet-3361「我方攻击必定致命」）也被套上「若」，
 *    于是整句变成「若自身攻击必定致命」，效果层认不出。
 *    改为 `^(若?)我方` → `"$1自身"`，原句有「若」才带「若」。
 *
 * 2. **「后」残头剥字抢在 PART_PRE_STRIP 前面**
 *    effects-parse.mjs 归一链里有 `.replace(/(?<!然)后(?=恢复|回复)/, "")`，它跑在 part 循环
 *    **之前**，于是把「出手后恢复」「之后恢复」统统切成「出手恢复」「之恢复」——
 *    完整词形本该由 PART_PRE_STRIP 的「出手后」「命中后」「使用后」「之后」分支整词剥掉。
 *    修法：把剥字从 text 级归一链**移到 part 级、PART_PRE_STRIP 之后**。
 *    注意不能简单改成「前字不是汉字才剥」——技能侧的残头「后恢复自身体力250」前面正是汉字，
 *    那样会漏（实测 pet-2486 的「斩灵涡轮」回归）；剥字移到 part 级后两边都成立。
 *
 * 3. **「令对手受到自身最大体力值N%的固定伤害」的「值」字**
 *    e8-ft-11 只收「最大体力N%」，不收「最大体力值N%」。
 *
 * 护栏：
 *   - 技能侧的「后恢复自身体力250」残头仍要能解析（剥字移到 part 级后每 part 各剥一次）。
 *   - 「然后恢复体力」「命中后恢复」「使用技能后恢复」不被误伤。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("魂印归一修复：「我方」不再凭空套「若」", () => {
  it("pet-3361：对手烧伤时我方攻击必定致命 + 50% 令对手焚烬", () => {
    const r = parseSoulmarkText(
      "回合开始时50%令对手烧伤，50%令己方烧伤；对手处于烧伤状态时我方攻击必定致命且50%令对手焚烬，回合结束时我方处于烧伤状态则恢复自身最大体力1/3（boss无效）",
      "炎龙圣帝",
    );
    expect(r.unparsed).toHaveLength(0);
    const burnGate = { hook: "onTurnStart", ops: [
      { op: "apply_status", name: "ember", target: "opponent", chance: 50, if: { foeHas: "burn" } },
      { op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 }, if: { foeHas: "burn" } },
    ] };
    expect(r.entries).toContainEqual(burnGate);
  });

  it("护栏：原句带「若」时仍然带「若」（不丢条件）", () => {
    const r = parseSoulmarkText("若我方使用攻击技能则令对手速度-1", "测试");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toContainEqual({
      hook: "onMoveUsed",
      ops: [{ op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" }],
      guard: { actor: "self", cat: [2, 3] },
    });
  });
});

describe("魂印归一修复：「后」残头剥字移到 part 级", () => {
  it("pet-3463：出手后恢复自身最大体力的1/3（并造成等量固伤）", () => {
    const r = parseSoulmarkText(
      "回合开始时自身体力低于1/2则当回合技能先制+1且出手后恢复自身最大体力的1/3并造成等量固伤；回合开始时自身体力高于1/2则当回合攻击必定致命一击并附加自身最大体力1/3的固伤。",
      "时空界皇",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries[0]?.ops).toContainEqual(expect.objectContaining({ op: "heal", numerator: 1, denominator: 3, target: "self", foeEcho: true, if: { selfHpBelow: { numerator: 1, denominator: 2 } } }));
  });

  it("pet-3675：之后恢复自身所有体力", () => {
    const r = parseSoulmarkText(
      "回合结束时若自身体力低于最大体力1/3则下回合攻击技能先制+1且100%秒杀对手，之后恢复自身所有体力并清空自身全部PP（boss无效）",
      "聆风",
    );
    expect(r.unparsed).toHaveLength(0);
    const turnEnd = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(turnEnd?.ops).toContainEqual({ op: "heal", numerator: 1, denominator: 1, target: "self" });
  });

  it("护栏：技能侧残头「后恢复自身体力250」仍能解析", () => {
    const p = parseEffectText("后恢复自身体力250");
    expect(p.unparsed).toHaveLength(0);
    expect(p.effects).toEqual([{ op: "heal", flat: 250, target: "self" }]);
  });

  it("护栏：完整词形「使用后/命中后/然后」不被误伤", () => {
    for (const [text, flat] of [
      ["使用技能后恢复自身体力250", 250],
      ["命中后恢复自身体力300", 300],
      ["然后恢复体力", undefined],
    ] as const) {
      const p = parseEffectText(text);
      expect(p.unparsed).toHaveLength(0);
      expect(p.effects?.[0]?.op).toBe("heal");
      if (flat !== undefined) expect(p.effects?.[0]?.flat).toBe(flat);
    }
  });
});

describe("魂印词形修复：「最大体力值」的「值」字", () => {
  it("pet-4088：令对手受到自身最大体力值30%的固定伤害", () => {
    const r = parseSoulmarkText(
      "每回合开始时令自身防御+1、特防+1，自身受到攻击时若双防提升等级总和&ge;6则回合结束时令对手受到自身最大体力值30%的固定伤害；",
      "环·圣芒",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toContainEqual({
      hook: "onTurnEnd",
      guard: { selfStageSumAtLeast: { stats: ["def", "sdf"], n: 6 } },
      ops: [
        { op: "damage", kind: "fixed", power: 0 },
        { op: "flat", of: "flatSelfPct", value: 30 },
      ],
    });
  });
});

describe("魂印归一修复：副作用——效果从「完全不生效」变为「生效」", () => {
  it("pet-3629：对手使用攻击技能则我方受到的伤害减少260点", () => {
    const r = parseSoulmarkText(
      "回合结束时恢复260点体力，体力低于1/3时效果翻倍；自身使用攻击技能则对手受到的伤害不少于260点，对手使用攻击技能则我方受到的伤害减少260点（boss无效）",
      "龙裳",
    );
    // 这半句此前整句 no-rule（完全没生效）；现在产出 dmg_reduce。
    expect(r.entries).toContainEqual({
      hook: "onMoveUsed",
      guard: { actor: "foe", cat: [2, 3] },
      ops: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 260 } }],
      bossGate: true,
    });
    // 剩余残文是「boss 门跨 react 窗」这一已知机制缺口，不是规则缺口
    expect(r.unparsed.every((u) => u.reason?.includes("move-use scope") === true)).toBe(true);
  });
});
