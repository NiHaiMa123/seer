/**
 * add-effect-r5d：「护盾/护罩消失」这一类破盾触发句。
 *
 * 引擎侧本来就有这个反应窗——`damage.ts` 吸收池耗尽处 `fireReactive 4`，ward/shield 同钩，
 * `e28-df-02` 给它发的就是 `react trigger4`。本路只补「后文写清了、但 e28-df-02 的正则没接住」的形状：
 * 「回合结束时若(自身)护盾或护罩(任意一个|均)消失则X」——前窗带「回合结束时若」时从句首就对不上，
 * 整句落不到任何规则。主体复用 e28-df-02 的 `reactWrap(4)`，e28-df-02 本体一字未动。
 *
 * 后文为空的、和后文还落不下去的，全部继续留档，不在这里做成效果。
 * 见 `tools/effects-rules/batch-e28.mjs` 里 `r5d-shield-react` 的注释：还写了两种后文清楚、
 * 但因为规则顺序 / 外层条件切分而接不住的形状，也一律留在留档里。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { rules as e28Rules } from "../../../tools/effects-rules/batch-e28.mjs";

type Parsed = { effects: Record<string, unknown>[]; unparsed: { clause?: string; reason?: string }[] };

const react4 = (payload: unknown[], extra: Record<string, unknown> = {}) => [
  { op: "apply_status", name: "react", target: "self", params: { trigger: 4 }, payload, ...extra },
];

const deferred = (r: Parsed) => r.effects.length === 0 && r.unparsed.length > 0;

describe("add one effect (r5d · 护盾/护罩消失触发)", () => {
  it("r5d-01：后文能解析的「回合结束时若…消失则X」进 trigger 4", () => {
    // 千花魂印（content/creatures/creatures.json → peak/soulmarks.json）
    const qianhua = parseEffectText(
      "回合结束时若自身护盾或护罩任意一个消失则恢复自身最大体力的1/3",
    ) as Parsed;
    expect(qianhua.unparsed).toEqual([]);
    expect(qianhua.effects).toEqual(react4([{ op: "heal", numerator: 1, denominator: 3, target: "self" }]));

    // 裳魂印：同一前窗，后文是下回合暴击窗（窗口 turns 由 reactWrap 内的回合前缀给出）
    const shang = parseEffectText(
      "回合结束时若自身护盾或护罩任意一个消失则下回合自身攻击技能100%的几率打出致命一击",
    ) as Parsed;
    expect(shang.unparsed).toEqual([]);
    expect(shang.effects).toEqual(react4([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 100, d: 100 }, turns: 1 },
    ]));

    // 主语/「任意一个」缺失的变体也走同一窗
    for (const src of [
      "回合结束时若护盾或护罩消失则恢复自身最大体力的1/3",
      "回合结束时若自身护盾和护罩均消失则恢复自身最大体力的1/3",
    ]) {
      expect((parseEffectText(src) as Parsed).effects, src).toEqual(
        react4([{ op: "heal", numerator: 1, denominator: 3, target: "self" }]),
      );
    }
  });

  it("r5d-02：没有后文的仍然 deferred，不发空反应", () => {
    // 纯生命周期声明（"此护盾或护罩任意一个消失"整句没有结果）——留在留档里，不发空反应
    const bare = parseEffectText("此护盾或护罩任意一个消失") as Parsed;
    expect(deferred(bare)).toBe(true);
    expect(JSON.stringify(bare.effects)).not.toContain("\"trigger\":4");

    // 前窗对上了、但结果句仍落不下去的（重新激活没有通道）——继续留档
    const reactivate = parseEffectText(
      "回合结束时若自身护盾或护罩任意一个消失则2回合重新被激活",
    ) as Parsed;
    expect(deferred(reactivate)).toBe(true);
    expect(JSON.stringify(reactivate.effects)).not.toContain("\"trigger\":4");

    // 未收的另外两种形状也仍然 deferred：
    //   洛基：守卫「堕恶神祇层数达到3层」会被外层「若A且B则C」的切分吞掉，接住就是发无门控 trigger4
    const loki = parseEffectText(
      "若堕恶神祇层数达到3层且2回合内此护盾或护罩任意一个消失则触发额外效果：令对手下1次攻击技能失效",
    ) as Parsed;
    expect(deferred(loki)).toBe(true);
    //   该护盾消失时反转对手能力提升状态：已由 r6c 的 attach-damage.r6c-shield-invert 接住 → react trigger4
    //   （见 add-effect-r6c.test.ts）。后文不是「反转对手能力提升状态」的「该护盾消失时X」仍走 attach-damage-96 留档。
    const xuepu = parseEffectText("该护盾消失时反转对手能力提升状态") as Parsed;
    expect(xuepu.unparsed).toEqual([]);
    expect(xuepu.effects).toEqual(react4([{ op: "invert_stages", sign: "up", target: "opponent" }]));
    const xuepuOther = parseEffectText("该护盾消失时吸取对手300点体力") as Parsed;
    expect(deferred(xuepuOther)).toBe(true);
    expect(xuepuOther.unparsed[0]!.reason).toBe("shield lifecycle — E4");
  });

  it("r5d-03：旧的、本来就能解析的破盾句结果不变", () => {
    // heal-215 的「此护盾消失时X」
    expect(parseEffectText("此护盾消失时100%令对手烧伤、失明")).toEqual({
      effects: react4([{ op: "apply_status", name: "random", target: "opponent", random: { list: ["burn", "blind"], count: 1 }, chance: 100 }]),
      flags: {},
      unparsed: [],
    } as unknown as Parsed & { flags: Record<string, unknown> });
    // heal-215 的「自身护盾或护罩消失时X」（魂印 sm-4838 的形式，e28-df-02 第一条臂也能收）
    expect(parseEffectText("自身护盾或护罩消失时吸取对手所有2点pp值")).toEqual({
      effects: react4([{ op: "pp_delta", amount: -2, target: "opponent", scope: "all" }]),
      flags: {},
      unparsed: [],
    } as unknown as Parsed & { flags: Record<string, unknown> });
    // e28-df-02 第一条臂（带「则」）
    expect(parseEffectText("护盾或护罩任意一个消失则使对手进入焚烬")).toEqual({
      effects: react4([{ op: "apply_status", name: "ember", target: "opponent" }]),
      flags: {},
      unparsed: [],
    } as unknown as Parsed & { flags: Record<string, unknown> });
    // 承伤上限那一支的孤儿条件（"护盾消失时X" 由 condOf 转 not.selfHas）不是反应窗，旧结果照旧
    const orphan = parseEffectText("护盾消失时附加300点固定伤害") as Parsed;
    expect(orphan.unparsed).toEqual([]);
    expect(orphan.effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { not: { selfHas: "shield" } }, flat: 300 } },
    ]);
  });

  it("r5d-04：e28-df-02 本体未动，r5d 规则排在它前面", () => {
    const ids = e28Rules.map((r: { id: string }) => r.id);
    expect(ids.indexOf("r5d-shield-react")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("r5d-shield-react")).toBeLessThan(ids.indexOf("e28-df-02"));

    const df02 = e28Rules.find((r: { id: string }) => r.id === "e28-df-02")! as unknown as {
      re: RegExp; go: (m: RegExpExecArray) => unknown;
    };
    expect(df02.re.source).toBe(
      /^(?:自身|自己)?(?:的)?(?:护盾|护罩)(?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失(?:时)?则(.+)$|^(?:护盾|护罩)(?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失|^此?护[盾罩]消失时(.+)$/.source,
    );
    // 无后文的裸形仍走 e28-df-02 的留档分支（r5d 规则不接它）
    const bare = df02.re.exec("护盾或护罩任意一个消失") as RegExpExecArray;
    expect(df02.go(bare)).toEqual({ unparsedReason: "shield-destroyed trigger — unmodeled (deferred)" });
  });

  it("r5d-05：本路不动 e28 里放逐/背包/层数/PP 的留档", () => {
    for (const [id, reason] of [
      ["e28-df-01", "per-PP-count predicate — unmodeled (deferred)"],
      ["e28-df-03", "not-used-move predicate — unmodeled (deferred)"],
      ["e28-df-04", "mark countRange — unmodeled (deferred)"],
      ["e28-df-05", "stack-increment trigger — unmodeled (deferred)"],
      ["e28-df-06", "mark-cap / stack-threshold clause — unmodeled (deferred)"],
      ["e28-df-07", "bench/banish — unmodeled (deferred)"],
    ]) {
      const rule = e28Rules.find((r: { id: string }) => r.id === id) as { go: () => unknown } | undefined;
      expect(rule, id).toBeDefined();
      expect(rule!.go(), id).toEqual({ unparsedReason: reason });
    }
  });
});
