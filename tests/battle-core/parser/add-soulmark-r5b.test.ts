/**
 * add-soulmark-r5b —— r5b 做的魂印句子（只改 `tools/soulmark-parse.mjs` 两处：段级冗余主语剥除的锚点表
 * 加一条「自身自身…」，以及 segBoundary 的段边界判定加「自身自身…」/「自身受到物理|特殊攻击…」两种确定形）。
 *
 * 判据仍是 r4b/r3c 那一条：**语意已经写清、剥掉冗余主语（或剥掉重复写出的那个「自身」）之后，
 * 整句落在规则表里已经存在的格子上**。只改句式，不发明系数、不新 op / 状态名 / params 键、不改数、不换主语。
 *
 * 本轮落地的两条，都是"改写之后 IR 与旧格逐字相同"：
 *  1. 重复写出的冗余主语「自身自身下回合…」→ 后一个「自身」起首的旧句本来就有格子（"下回合造成的攻击伤害提升50%"
 *     在别处一直在发）。剥掉前一个「自身」，落回同一格。
 *  2. 「自身受到(物理|特殊)攻击时…」自成一组——受击反应窗是独立监听器，不该被前一段的「未触发则…」并走。
 *     单独出现时它与裸形逐字同 IR（本条只让它不被并走，挂点仍是既有的战首 react trigger 1）。
 *
 * 没放宽的（边界锁在下面）：受击后式、只带「受到特殊伤害」的降低句、逐招 rider 的 deferred 档、
 * 以及 r4b 已锁的旧边界，reason 与 IR 逐字不变。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const entries = (t: string) => parseSoulmarkText(t).entries;
const reasons = (t: string) => parseSoulmarkText(t).unparsed.map((u) => u.reason);
const clauses = (t: string) => parseSoulmarkText(t).unparsed.map((u) => u.clause);

describe("r5b-重复主语：「自身自身…」剥掉前一个冗余主语，落回旧格", () => {
  it("'自身自身下回合造成的攻击伤害提升50%' 与裸 '下回合造成的攻击伤害提升50%' 逐字同 IR", () => {
    expect(entries("自身自身下回合造成的攻击伤害提升50%")).toEqual([
      {
        hook: "onTurnEnd",
        ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 }, turns: 1 }],
      },
    ]);
    expect(parseSoulmarkText("自身自身下回合造成的攻击伤害提升50%").unparsed).toHaveLength(0);
    expect(entries("自身自身下回合造成的攻击伤害提升50%")).toEqual(entries("下回合造成的攻击伤害提升50%"));
  });

  it("极鳞魔兽那条（若自身体力高于回合开始时则自身自身下回合…）整体落回回合末窗 + hpAboveTurnStart 守卫", () => {
    const S = "若自身体力高于回合开始时则自身自身下回合造成的攻击伤害提升50%";
    expect(entries(S)).toEqual([
      {
        hook: "onTurnEnd",
        guard: { hpAboveTurnStart: true },
        ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 }, turns: 1 }],
      },
    ]);
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("极鳞魔兽整条魂印：四条条件支路各一条条目，不再留残句", () => {
    const S =
      "1、回合结束时，若自身体力等于回合开始时则自身下回合受到的攻击伤害减少50% " +
      "2、若自身体力高于回合开始时则自身自身下回合造成的攻击伤害提升50% " +
      "3、若自身体力低于回合开始时则自身下回合攻击吸取对手最大体力的1/3 " +
      "4、若当前体力低于最大体力的1/3则下回合攻击先制+3 " +
      "5、（boss无效）";
    const r = parseSoulmarkText(S);
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toHaveLength(4);
    expect(r.entries.map((e: any) => e.guard)).toEqual([
      { hpEqTurnStart: true },
      { hpAboveTurnStart: true },
      { hpBelowTurnStart: true },
      { selfHpBelow: { numerator: 1, denominator: 3 } },
    ]);
  });
});

describe("r5b-段边界：段首「自身受到(物理|特殊)攻击时…」自成一组（受击反应窗是独立监听器）", () => {
  it("单独出现时与裸形逐字同 IR（本条不改它的挂点与 op）", () => {
    const IR = [
      {
        hook: "onBattleStart",
        ops: [
          {
            op: "apply_status",
            name: "react",
            target: "self",
            params: { trigger: 1, cat: 3 },
            payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50 }],
          },
        ],
      },
    ];
    expect(entries("自身受到特殊攻击时50%令对手麻痹")).toEqual(IR);
    expect(entries("自身受到特殊攻击时50%令对手麻痹")).toEqual(entries("受到特殊攻击时50%令对手麻痹"));
    expect(parseSoulmarkText("自身受到特殊攻击时50%令对手麻痹").unparsed).toHaveLength(0);
  });

  it("K·疾羽：物理/特殊两个受击窗各自成条，不再被「未触发则…」并走后半句", () => {
    const S =
      "自身受到物理攻击时50%令对手害怕,未触发则令对手攻击-1、速度-1," +
      "自身受到特殊攻击时50%令对手麻痹,未触发则令对手特攻-1、速度-1";
    const r = parseSoulmarkText(S);
    expect(r.unparsed.map((u) => u.clause)).toEqual([
      "未触发则令对手攻击-1、速度-1",
      "未触发则令对手特攻-1、速度-1",
    ]);
    expect(r.entries).toHaveLength(2);

    // 物理窗（与前一段「未触发则…」同组，逐字未变）
    expect(r.entries[0]).toEqual({
      hook: "onBattleStart",
      ops: [
        {
          op: "apply_status",
          name: "react",
          target: "self",
          params: { trigger: 1, cat: 2 },
          payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
        },
      ],
    });
    // 第二个明确的受击事件是独立宿主，前一个失败分支不能吞掉它。
    expect(r.entries[1]).toEqual({
      hook: "onBattleStart",
      ops: [
        {
          op: "apply_status",
          name: "react",
          target: "self",
          params: { trigger: 1, cat: 3 },
          payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50 }],
        },
      ],
    });
  });

  it("K·疾羽整条魂印（含 boss 门）逐条对齐", () => {
    const r = parseSoulmarkText(
      "疾:自身受到物理攻击时50%令对手害怕,未触发则令对手攻击-1、速度-1," +
        "自身受到特殊攻击时50%令对手麻痹,未触发则令对手特攻-1、速度-1(boss无效)",
    );
    expect(r.unparsed.map((u: any) => u.clause)).toEqual([
      "未触发则令对手攻击-1、速度-1",
      "未触发则令对手特攻-1、速度-1",
    ]);
    expect(r.bossGate).toBe(true);
    expect(r.entries).toHaveLength(2);
    expect(r.entries.map((e: any) => e.bossGate)).toEqual([true, true]);
  });
});

describe("r5b-未放宽：本轮只认这两条确定形，别的句子原样", () => {
  it("受击后式 '自身受到技能伤害后…' 仍是 no-trigger-prefix，整段保持原文", () => {
    const S = "自身受到技能伤害后，对手3回合内攻击免疫效果失效";
    expect(entries(S)).toHaveLength(0);
    expect(reasons(S)).toEqual(["no-trigger-prefix"]);
    expect(clauses(S)).toEqual([S]);
  });

  it("'自身受到特殊伤害降低15%' 的 reason 不变（不是「攻击」窗，没被本轮边界收走）", () => {
    expect(reasons("自身受到特殊伤害降低15%")).toEqual(["no-trigger-prefix"]);
  });

  it("旧句 '受到攻击伤害降低N%' 的 IR 逐字不变（边界只多认一个短语，不动旧格）", () => {
    expect(entries("自身受到攻击伤害降低50%")).toEqual([
      { hook: "onBattleStart", ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] },
    ]);
  });

  it("逐招 rider 的 deferred 档没被顺手放宽：'自身所有技能吸取对手400点体力' reason 逐字保留", () => {
    const S = "自身所有技能吸取对手400点体力";
    expect(entries(S)).toHaveLength(0);
    expect(reasons(S)).toEqual(["moveset-wide drain — per-move rider cannot attach from soulmark body (deferred)"]);
  });

  it("'自身属性技能命中…' 一类还在原地（本轮不碰；命中二段窗仍是 deferred）", () => {
    expect(entries("自身属性技能命中则100%令对手烧伤")).toHaveLength(0);
    expect(reasons("自身属性技能命中则100%令对手烧伤")).toEqual([
      "hit-window — move-landed second-phase trigger unmodeled (deferred)",
    ]);
    expect(entries("自身属性技能命中时消耗30%的体力")).toHaveLength(0);
    expect(reasons("自身属性技能命中时消耗30%的体力")).toEqual(["no-rule"]);
  });

  it("r4b/r3c 的旧边界不变：'自身保留1点体力' 仍解得出、'自身吸取对手240点体力' 仍是两条旧条", () => {
    expect(entries("自身保留1点体力")).toEqual([{ op: "endure" }]);
    expect(entries("自身吸取对手240点体力")).toHaveLength(2);
  });
});
