/**
 * add-soulmark-r2b —— r2b 做的魂印句子（只改 `tools/soulmark-parse.mjs`，一次一条）。
 *
 * 这一类是"语意已经写清、而且同一处已经有一句能解的旧句"：
 *  1. 「消除对手能力提升状态」：这句要发的 `clear_stages{target:"opponent", sign:"up"}` 是现成 op
 *     （"若对手处于烧伤状态则消除对手能力提升" 一直在发），它只是被 UNSUPPORTED_TRIGGERS 提前整句拦下。
 *  2. 「自身受到攻击伤害降低N%」：`dmg_taken_down{pct:N}` 是现成状态（裸 "受到攻击伤害降低N%" 一直在发），
 *     句首「自身」跟 p3/w11 那两行一样是冗余主语。
 *  3. 「自身奇数回合使用技能后吸取对手300点体力」：同一魂印的下半句「偶数回合使用技能后吸取对手最大体力的1/3」
 *     早就解出来了（onMoveUsed + turnParity:even），奇句只多了句首「自身」。
 * 做法都是把句式改写成已经能解析的旧句（剥冗余主语 / 豁免那条只会提前拦下的分桶行），
 * 不发明系数、不新 op / 状态名 / params 键、不改数、不换主语。
 *
 * 头一条各锁一条旧句结果不变；后面几条锁"没被顺手放宽"的边界。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const first = (t: string) => parseSoulmarkText(t).entries[0];
const entries = (t: string) => parseSoulmarkText(t).entries;
const reasons = (t: string) => parseSoulmarkText(t).unparsed.map((u) => u.reason);

describe("r2b-clear-stages：'消除对手能力提升状态' 落回旧的清强格", () => {
  it("新句：'消除对手能力提升状态' → clear_stages{foe,up}，与 old 格子的 op 形状一致", () => {
    expect(first("消除对手能力提升状态")).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "clear_stages", target: "opponent", sign: "up" }],
      guard: { actor: "self" },
    });
    expect(parseSoulmarkText("消除对手能力提升状态").unparsed).toHaveLength(0);
  });

  it("同族：'消除对手能力强化状态' / '消除对方能力提升状态' 同格同值（强化=提升、对方=对手）", () => {
    for (const s of ["消除对手能力强化状态", "消除对方能力提升状态"]) {
      expect(first(s)).toEqual({
        hook: "onMoveUsed",
        ops: [{ op: "clear_stages", target: "opponent", sign: "up" }],
        guard: { actor: "self" },
      });
      expect(parseSoulmarkText(s).unparsed).toHaveLength(0);
    }
  });

  it("旧句不变：条件位上的 '若对手处于烧伤状态则消除对手能力提升' 仍是 onTurnEnd + foeHas:burn", () => {
    expect(first("若对手处于烧伤状态则消除对手能力提升")).toEqual({
      hook: "onTurnEnd",
      guard: { foeHas: "burn" },
      ops: [{ op: "clear_stages", target: "opponent", sign: "up" }],
    });
  });

  it("旧句不变：'回合开始时若对手处于能力提升状态则消除对手能力提升状态' 仍是 onTurnStart + foeStageUp", () => {
    expect(first("回合开始时若对手处于能力提升状态则消除对手能力提升状态")).toEqual({
      hook: "onTurnStart",
      guard: { foeStageUp: true },
      ops: [{ op: "clear_stages", target: "opponent", sign: "up" }],
    });
  });

  it("邻句不变：带「、回合类效果」的复合句不因放行而变形（reason 与 entries 都逐字保留）", () => {
    expect(entries("消除对手能力提升状态、回合类效果")).toEqual([]);
    expect(reasons("消除对手能力提升状态、回合类效果")).toEqual(["no-trigger-prefix"]);
  });

  it("邻句不变：'消除对手能力提升效果' 的 reason 不变（句尾不是「状态」，本来就不在那行里）", () => {
    expect(reasons("消除对手能力提升效果")).toEqual(["no-trigger-prefix"]);
  });

  it("邻句不变：'消除对手回合类效果' 不被清强行牵走，仍是清回合窗", () => {
    expect(first("消除对手回合类效果")).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "cleanse", target: "opponent", scope: "timed" }],
      guard: { actor: "self" },
    });
  });
});

describe("r2b-taken-down：句首「自身」冗余的受击减伤句", () => {
  it("新句：'自身受到攻击伤害降低10%' → dmg_taken_down{pct:10}，与裸 '受到攻击伤害降低10%' 同格", () => {
    expect(first("自身受到攻击伤害降低10%")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 10 } }],
    });
    expect(parseSoulmarkText("自身受到攻击伤害降低10%").unparsed).toHaveLength(0);
  });

  it("同族：'自身受到伤害降低30%'（省略类别词）同格，数值原样", () => {
    expect(first("自身受到伤害降低30%")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 30 } }],
    });
  });

  it("旧句不变：裸 '受到攻击伤害降低25%' 仍是 dmg_taken_down{pct:25}", () => {
    expect(first("受到攻击伤害降低25%")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 25 } }],
    });
  });

  it("旧句不变：'自身受到攻击伤害减少30%' 本来就同格（「减少」形从未被那行拦下），数值不被改写", () => {
    expect(first("自身受到攻击伤害减少30%")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 30 } }],
    });
  });

  it("邻句不变：'自身受到攻击伤害降低' 无数值时仍在 deferred，没被补出系数", () => {
    expect(parseSoulmarkText("自身受到攻击伤害降低").unparsed.length).toBeGreaterThan(0);
    expect(entries("自身受到攻击伤害降低")).toHaveLength(0);
  });

  it("邻句不变：'自身受到特殊伤害降低15%' 的 reason 不变（它从未进过那行）", () => {
    expect(reasons("自身受到特殊伤害降低15%")).toEqual(["no-trigger-prefix"]);
  });
});

describe("r2b-turn-parity：句首「自身」冗余的奇偶回合句（兔兔警探）", () => {
  const ODD = "自身奇数回合使用技能后吸取对手300点体力";
  const EVEN = "偶数回合使用技能后吸取对手最大体力的1/3";

  it("新句：'自身奇数回合使用技能后吸取对手300点体力' → 剥句首「自身」后的旧形（onMoveUsed + turnParity:odd）", () => {
    expect(first(ODD)).toEqual(first("奇数回合使用技能后吸取对手300点体力"));
    expect(first(ODD)).toEqual({
      hook: "onMoveUsed",
      ops: [
        { op: "damage", power: 300, kind: "fixed", if: { turnParity: "odd" } },
        { op: "heal", flat: 300, target: "self", if: { turnParity: "odd" } },
      ],
      guard: { actor: "self" },
    });
    expect(parseSoulmarkText(ODD).unparsed).toHaveLength(0);
  });

  it("旧句不变：同一魂印的偶句 '偶数回合使用技能后吸取对手最大体力的1/3' 仍是 turnParity:even（奇偶不串）", () => {
    expect(first(EVEN)).toEqual({
      hook: "onMoveUsed",
      ops: [
        { op: "damage", power: 1, kind: "percent", if: { turnParity: "even" } },
        { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
        { op: "heal", numerator: 1, denominator: 3, target: "self", if: { turnParity: "even" } },
      ],
      guard: { actor: "self" },
    });
  });

  it("邻句不变：'当回合自身使用技能后吸取对手300点体力' 的无条件窗不被奇偶剥除波及", () => {
    expect(first("当回合自身使用技能后吸取对手300点体力")).toEqual({
      hook: "onMoveUsed",
      ops: [
        { op: "damage", power: 300, kind: "fixed" },
        { op: "heal", flat: 300, target: "self" },
      ],
      guard: { actor: "self" },
    });
  });

  it("纯使用时句式：'自身使用技能时附加350点固定伤害' → 出招前 react（cat 无限制）", () => {
    expect(first("自身使用技能时附加350点固定伤害")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11 }, stack: true,
        payload: [{ op: "damage", kind: "fixed", power: 350, target: "opponent" }],
      }],
    });
    expect(parseSoulmarkText("自身使用技能时附加350点固定伤害").unparsed).toEqual([]);
  });
});
