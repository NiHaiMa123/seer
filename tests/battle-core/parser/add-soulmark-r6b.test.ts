/**
 * add-soulmark-r6b —— r6b 做的魂印句子（只改 `tools/soulmark-parse.mjs` 一处：段级冗余主语剥除表
 * redSubject 再加四条确定形）。
 *
 * 判据沿用 r4b/r5b：**语意已经写清、剥掉冗余主语（魂印语境里持有者恒为自身）之后，整句落在规则表里
 * 已经存在的格子上**。做法仍是改写成已经能解析的旧句，不发明系数、不新 op / 状态名 / params 键、不改数、不换主语。
 * 每条只认后面紧跟的动词短语本身（该短语的裸形在语料别处一直在发），不按动词泛化；
 * redTry 的门槛（剥后必须整句落到规则表、且未剥本来解不出）保证不抢旧行为。
 *
 * 本轮落地的三条：
 *  1. 段首「自身」+「每次登场首次攻击技能…」→ 登场首击窗（同格：聆风「每次登场首次攻击造成的伤害提升150%」）。
 *  2. 段首「自身」+「首次(登场)受到的…」→ 受击首击窗（克利奥 / 克里斯托）。
 *  3. 句中「免疫自身受到…」→「免疫受到…」（奥丽莎；同格：贝乌索「下回合免疫受到攻击伤害」）。
 *
 * 没放宽的（边界锁在下面）：deferred 档的逐招 rider / 带时间窗的「所有技能」句 / 未命中触发头的
 * 「下次攻击附加」/「本场战斗中…」（试过，单独整句能落地，但原文里该段是逗号碎进上一组的余文，
 * 剥了也够不着——且剥不剥都会多出一条**语料原先没有**的 onDamageDealt 条目，本轮没做）/
 * 受击后式 /「受到特殊伤害」，reason 与 IR 逐字不变。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const entries = (t: string) => parseSoulmarkText(t).entries;
const unparsed = (t: string) => parseSoulmarkText(t).unparsed;

describe("r6b-首次登场受到的…：段首「自身」是冗余主语（受击/登场首击窗）", () => {
  it("克里斯托那条：段首「自身」在 redSubject 层被剥掉，残句文本变干净（该段仍未落地）", () => {
    const S = "自身首次登场受到的伤害高于200则下回合50%令对手攻击技能无效";
    expect(entries(S)).toEqual([]);
    expect(unparsed(S)).toEqual([
      { clause: "首次登场受到的伤害高于200则下回合50%令对手攻击技能无效", reason: "no-trigger-prefix" },
    ]);
    // 剥出来的文本本身就是规则表里已有的句形（单独成句时能落地）——本条只让残句不再带着冗余主语
    expect(entries("首次登场受到的伤害高于200则下回合50%令对手攻击技能无效")).toEqual([
      {
        hook: "onEntry",
        ops: [
          {
            op: "apply_status",
            name: "status_lock",
            target: "opponent",
            params: { cat: 4 },
            turns: 1,
            if: { takenAboveAbs: 200 },
            chance: 50,
          },
        ],
        chance: { once: true },
      },
    ]);
  });

  it("克利奥整条魂印：首段落回 onDamaged + 首击守卫，其后余文按原样留残句，且条目数不变", () => {
    const S = "螽：本场战斗中，自身首次受到的攻击时伤害减少60%且40%令对手中毒，之后每次受到的攻击伤害伤害减少效果降低20%，中毒几率提升20%1当中毒几率达到100%后，自身每次受到攻击伤害的50%恢复为自身体力( boss无效)";
    const r = parseSoulmarkText(S);
    expect(r.entries).toEqual([
      {
        hook: "onDamaged",
        bossGate: true,
        ops: [
          { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 60 } },
          { op: "apply_status", name: "poison", target: "opponent", chance: 40 },
        ],
        chance: { once: true },
      },
    ]);
    expect(r.unparsed).toHaveLength(3);
  });

  it("克利奥那条剥掉段首「自身」后落回 onDamaged + dmg_taken_down/poison（同段余文仍按原样留残句）", () => {
    const S = "自身首次受到的攻击时伤害减少60%且40%令对手中毒，之后每次受到的攻击伤害伤害减少效果降低20%，中毒几率提升20%1当中毒几率达到100%后，自身每次受到攻击伤害的50%恢复为自身体力";
    const r = parseSoulmarkText(S);
    expect(r.entries).toEqual([
      {
        hook: "onDamaged",
        ops: [
          { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 60 } },
          { op: "apply_status", name: "poison", target: "opponent", chance: 40 },
        ],
        chance: { once: true },
      },
    ]);
    // 整段不再落空：段首那条被接住，后面三段照旧留档（不吞后文）
    expect(r.unparsed.map((u: any) => u.reason)).toEqual(["no-rule", "no-rule", "no-rule"]);
  });
});

describe("r6b-每次登场首次攻击技能…：段首「自身」是冗余主语（登场首击窗）", () => {
  it("佩里德那条整段落回 onEntry（首击 100% 致命 + 之后 60% 致命概率窗）", () => {
    const S = "自身每次登场首次攻击技能必定打出致命一击，之后每次攻击60%打出致命一击";
    const r = parseSoulmarkText(S);
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onEntry",
        ops: [
          {
            op: "apply_status",
            name: "react",
            target: "self",
            params: { trigger: 12, chance: 60 },
            payload: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: 50, d: 100 } }],
            turns: 1,
          },
          { op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 } },
        ],
      },
    ]);
    // 单段形态与裸形逐字同 IR（本条只剥段首主语，不动挂点/op）
    expect(entries("自身每次登场首次攻击技能必定打出致命一击")).toEqual(
      entries("每次登场首次攻击技能必定打出致命一击"),
    );
  });
});

describe("r6b-免疫自身受到…：句中的「自身」是冗余主语（与贝乌索「下回合免疫受到攻击伤害」同格）", () => {
  it("奥丽莎那条落回 onBattleStart + dmg_immune{chance:30}，与裸形逐字同 IR", () => {
    const S = "30%的几率免疫自身受到攻击伤害";
    expect(entries(S)).toEqual([
      { hook: "onBattleStart", ops: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: 30 }] },
    ]);
    expect(unparsed(S)).toHaveLength(0);
    expect(entries(S)).toEqual(entries("30%的几率免疫受到攻击伤害"));
  });

  it("整条魂印：两条都落地，不再留残句", () => {
    const S = "30%的几率免疫自身受到攻击伤害；回合结束时恢复自身100点体力，每回合叠加100点，最高300点";
    const r = parseSoulmarkText(S);
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toHaveLength(2);
  });
});

describe("r6b-没放宽的（边界锁）", () => {
  it("逐招 rider 档的「自身所有技能吸取对手…」仍是 deferred（reason 逐字不变）", () => {
    for (const S of ["自身所有技能吸取对手400点体力", "自身全部技能吸取对手400点体力"]) {
      expect(unparsed(S)).toEqual([
        { clause: S, reason: "moveset-wide drain — per-move rider cannot attach from soulmark body (deferred)" },
      ]);
    }
  });

  it("带时间窗的「自身所有技能…」与未接触发的「自身下次攻击附加…」仍不落地", () => {
    expect(unparsed("自身所有技能造成的攻击伤害提升100%")).toEqual([
      { clause: "自身所有技能造成的攻击伤害提升100%", reason: "no-trigger-prefix" },
    ]);
    expect(unparsed("自身所有技能必定打出致命一击")).toEqual([
      { clause: "自身所有技能必定打出致命一击", reason: "no-trigger-prefix" },
    ]);
    expect(unparsed("自身下次攻击附加1点固定伤害")).toEqual([
      { clause: "自身下次攻击附加1点固定伤害", reason: "no-trigger-prefix" },
    ]);
  });

  it("裸句「本场战斗自身免疫…」仍是 no-trigger-prefix（只剥段首自身，不改句中语序）", () => {
    expect(unparsed("本场战斗自身免疫受到的能力下降状态")).toEqual([
      { clause: "自身免疫受到的能力下降状态", reason: "no-trigger-prefix" },
    ]);
  });

  it("「自身在本场战斗中攻击技能命中后吸取…」仍不落地（剥了也够不着，且会多出发明出来的条目）", () => {
    expect(unparsed("自身在本场战斗中攻击技能命中后吸取对手最大体力的20%")).toEqual([
      { clause: "自身在本场战斗中攻击技能命中后吸取对手最大体力的20%", reason: "no-trigger-prefix" },
    ]);
  });

  it("受击后式与「受到特殊伤害」两条仍是 no-trigger-prefix", () => {
    expect(unparsed("自身受到技能伤害后，对手3回合内攻击免疫效果失效")).toEqual([
      { clause: "自身受到技能伤害后，对手3回合内攻击免疫效果失效", reason: "no-trigger-prefix" },
    ]);
    expect(unparsed("自身受到特殊伤害降低15%")).toEqual([
      { clause: "自身受到特殊伤害降低15%", reason: "no-trigger-prefix" },
    ]);
  });

  it("原本就解得出的旧句 IR 逐字不变（剥除不抢）", () => {
    expect(entries("自身属性技能命中后附加100点固定伤害")).toEqual([
      { hook: "onMoveUsed", guard: { actor: "self", cat: 1 }, ops: [{ op: "damage", kind: "fixed", power: 100, target: "opponent" }] },
    ]);
    const postHitBoost = parseSoulmarkText("自身攻击技能命中后造成的伤害提升50%");
    expect(postHitBoost.entries).toEqual([]);
    expect(postHitBoost.unparsed.map((u) => u.reason)).toEqual([
      "post-hit modifier — current damage/heal has already resolved before this hook (deferred)",
    ]);
    expect(entries("自身保留1点体力")).toEqual([{ op: "endure" }]);
    expect(entries("自身受到攻击伤害降低50%")).toEqual([
      { hook: "onBattleStart", ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] },
    ]);
    expect(entries("自身恢复全部体力值与PP值")).toEqual([
      {
        hook: "onTurnEnd",
        ops: [
          { op: "heal", numerator: 1, denominator: 1, target: "self" },
          { op: "pp_delta", full: true, target: "self", scope: "all" },
        ],
      },
    ]);
    expect(entries("自身吸取对手240点体力")).toEqual([
      { hook: "onMoveUsed", ops: [{ op: "damage", power: 240, kind: "fixed" }], guard: { actor: "self" } },
      { hook: "onMoveUsed", ops: [{ op: "heal", flat: 240, target: "self" }], guard: { actor: "self" } },
    ]);
    expect(entries("下回合免疫受到攻击伤害")).toEqual([
      { hook: "onTurnEnd", ops: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1 }] },
    ]);
  });
});
