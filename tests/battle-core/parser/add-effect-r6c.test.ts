/**
 * add-effect-r6c：「该护盾消失时反转对手能力提升状态」这一种整句。
 *
 * `attach-damage-96` 的「护盾消失时」是未锚定子串，把这句整句留成 `shield lifecycle — E4`。
 * 本路只在它正前方加一条 `r6c-shield-invert`，只认这一种整句（「对手/对方/敌方」「的」「状态」的有无都可以）。
 * go 复用已导入的 `reactWrap(4, {}, "反转对手能力提升状态")`——破盾反应窗与 `e28-df-02` / `r5d-shield-react`
 * 同一主体（`damage.ts` 吸收池耗尽处 `fireReactive 4`）；后文那个 op 本来就已有：
 * `invert_stages` sign up / target opponent（batch-e6-181、batch-e32 系）。
 *
 * `attach-damage-95` / `attach-damage-96` 的正则与 go 一字未动：后文不是「反转对手能力提升状态」的
 * 「该护盾消失时X」、以及「护盾所吸收…」「护盾值…反弹」，全部照旧留档。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { rules as attachRules } from "../../../tools/effects-rules/attach-damage.mjs";

type Parsed = { effects: Record<string, unknown>[]; unparsed: { clause?: string; reason?: string }[] };

const react4Invert = [
  {
    op: "apply_status", name: "react", target: "self", params: { trigger: 4 },
    payload: [{ op: "invert_stages", sign: "up", target: "opponent" }],
  },
];

const deferred = (r: Parsed) => r.effects.length === 0 && r.unparsed.length > 0;
const ruleOf = (id: string) =>
  attachRules.find((r: { id: string }) => r.id === id) as { id: string; re: RegExp; go: (m?: unknown) => unknown };

describe("add one effect (r6c · 该护盾消失时反转对手能力提升状态)", () => {
  it("r6c-01：这一种整句进 trigger 4，后文是已有的 invert_stages", () => {
    const p = parseEffectText("该护盾消失时反转对手能力提升状态") as Parsed;
    expect(p.unparsed).toEqual([]);
    expect(p.effects).toEqual(react4Invert);

    // 「对手/对方/敌方」「的」「状态」的有无都走同一条
    for (const src of [
      "此护盾消失时反转对手能力提升状态",
      "该护盾消失时反转对方能力提升状态",
      "该护盾消失时反转敌方能力提升状态",
      "该护盾消失时反转敌方的能力提升状态",
      "该护盾消失时反转对手能力强化效果",
      "该护盾消失时反转对手能力提升",
    ]) {
      const r = parseEffectText(src) as Parsed;
      expect(r.effects, src).toEqual(react4Invert);
      expect(r.unparsed, src).toEqual([]);
    }

    // 真实语料（雪璞 / PLD 魂印）：整句里这一条现在被接住，同一句里其余未建模子句照旧留档
    const xuepu = parseEffectText(
      "受到的攻击伤害减少20%；自身使用攻击技能时消除对手的护盾，若对手不处于护盾则自身获得200点护盾，该护盾消失时反转对手能力提升状态，同时使对手威力最低的攻击技能PP值归零（boss无效）",
    ) as Parsed;
    expect(xuepu.effects).toContainEqual(react4Invert[0]);
    expect(xuepu.unparsed.map((u) => u.reason)).not.toContain("shield lifecycle — E4");
    expect(xuepu.unparsed.map((u) => u.clause)).not.toContain("该护盾消失时反转对手能力提升状态");
  });

  it("r6c-02：后文不是「反转能力提升」的「该护盾消失时X」仍留档", () => {
    for (const src of [
      "该护盾消失时",
      "该护盾消失时吸取对手300点体力",
      "该护盾消失时附加300点固定伤害",
      "该护盾消失时反转自身能力下降状态",
    ]) {
      const r = parseEffectText(src) as Parsed;
      expect(deferred(r), src).toBe(true);
      expect(r.unparsed[0]!.reason, src).toBe("shield lifecycle — E4");
      expect(JSON.stringify(r.effects), src).not.toContain("\"trigger\":4");
    }
  });

  it("r6c-03：旧的留档结果不变（flatIf / shield lifecycle — E4）", () => {
    // 「护盾消失时附加300点固定伤害」仍是 flatIf（attach-damage-96 的 re 接不到，condOf 转了 not.selfHas）
    const flat = parseEffectText("护盾消失时附加300点固定伤害") as Parsed;
    expect(flat.unparsed).toEqual([]);
    expect(flat.effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { not: { selfHas: "shield" } }, flat: 300 } },
    ]);

    // 「护盾所吸收…」「护盾值…反弹」仍是 shield lifecycle — E4
    for (const src of ["护盾所吸收的伤害", "护盾值反弹"]) {
      const r = parseEffectText(src) as Parsed;
      expect(deferred(r), src).toBe(true);
      expect(r.unparsed[0]!.reason, src).toBe("shield lifecycle — E4");
    }
  });

  it("r6c-04：attach-damage-95 / attach-damage-96 的正则与 go 一字未动，r6c 规则贴在 96 正前方", () => {
    const ids = attachRules.map((r: { id: string }) => r.id);
    expect(ids.indexOf("r6c-shield-invert")).toBe(ids.indexOf("attach-damage-96") - 1);
    expect(ids.indexOf("attach-damage-95")).toBe(ids.indexOf("r6c-shield-invert") - 1);

    expect(ruleOf("attach-damage-95").re.source).toBe(
      /护罩消失时|护罩所吸收(?!的?伤害值?\d+%)|护罩值(?!之和|总值|合计|低于)/.source,
    );
    expect(ruleOf("attach-damage-96").re.source).toBe(
      /护盾消失时|护盾所吸收的伤害(?!值?(?:以固定伤害的形式)?\d+%)|护盾值.*反弹|护盾值总和(?!的?体力)/.source,
    );
    expect(ruleOf("attach-damage-95").go()).toEqual({ unparsedReason: "shield lifecycle — E4" });
    expect(ruleOf("attach-damage-96").go()).toEqual({ unparsedReason: "shield lifecycle — E4" });

    // 95 的整句形态也不受影响（护罩侧的同类句不在本路）
    expect((parseEffectText("该护罩消失时反转对手能力提升状态") as Parsed).unparsed[0]!.reason)
      .toBe("shield lifecycle — E4");
  });
});
