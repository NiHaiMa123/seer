/**
 * add-effect-r4e：「附加给对手等同于自身能力提升的能力下降状态」从保残落成已解析。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 *
 * 用的是已有格子 transfer_stages 的 direction:"upToDown"（读法在 ops/transfer-stages.ts：
 * 自身正级等额转为对手负级，自身该维清零），与 batch-e6-236／e8-st-03／batch-e5c-04 同一条 IR。
 * 没有新 op、没有新 params 键、没有新状态名、没有新结算分支；只改 tools/effects-rules/batch-e17.mjs
 * 里 e17-mk-03 的 go，规则 id 与位置都不动（前一 e17-mk-02、后一 e17-cv-01），
 * tests/fixtures/effects-rule-order.json 不用重生成（快照只锁已存 id 的相对次序，本条 id 本来就在里面）。
 *
 * e17-mk-03 原来那句（"…自身能力提升状态的能力下降状态"）被
 * tests/battle-core/parser/parser-regression.test.ts 的合法 deferred 桶锁成 stage-mirror 保残。
 * 那句就是这个句族的宿主句，sentinel 按 r2d 的先例改成断言已解析的 IR；
 * 同一个桶里「作用在自己身上」（batch-e6-84）保持 stage-mirror 不动。
 * golden 里本句族 0 条，parser-golden.json 不受影响。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

type R = { flags: Record<string, unknown>; effects: unknown[]; unparsed: { clause: string; reason: string }[] };
const p = (t: string) => parseEffectText(t) as unknown as R;

const UP_TO_DOWN = [{ op: "transfer_stages", direction: "upToDown" }];

describe("add one effect (r4e)", () => {
  it("r4e-mk-mirror-01：附加给对手等同于自身能力提升的能力下降状态 → upToDown", () => {
    for (const src of [
      "附加给对手等同于自身能力提升的能力下降状态",   // 语料原句（星光·纳多雷：自身使用攻击技能时，附加给对手等同于自身能力提升的能力下降状态）
      "附加给对手等同于自身能力提升的能力下降",
      "附加给对手等同于自身能力强化的能力下降",
      "附加给对方等同于自身能力提升状态的能力下降状态",
      "附加给敌方等同于自己能力提升的能力下降",
    ]) {
      const r = p(src);
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual(UP_TO_DOWN);
    }
  });

  it("r4e-mk-mirror-01：「等同」(不带「于」) 与「自身能力强化状态」也收", () => {
    const a = p("附加给对手等同自身能力提升的能力下降状态");
    expect(a.unparsed).toEqual([]);
    expect(a.effects).toEqual(UP_TO_DOWN);
    const b = p("附加给对手等同于自身能力强化状态的能力下降状态");
    expect(b.unparsed).toEqual([]);
    expect(b.effects).toEqual(UP_TO_DOWN);
  });

  it("r4e-mk-mirror-01：去掉主语「自身」的裸形仍是同一条 IR（不自造方向相反的读法）", () => {
    const r = p("附加给对手等同于能力提升的能力下降状态");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(UP_TO_DOWN);
  });

  it("r4e：「能力提升状态」写全的那句（宿主句 星光·纳多雷）也是同一条 IR", () => {
    const r = p("附加给对手等同于自身能力提升状态的能力下降状态");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(UP_TO_DOWN);
  });

  it("r4e：同一个保残桶里别的句子没跟着松（batch-e6-84 的「作用在自己身上」仍是 stage-mirror）", () => {
    const r = p("作用在自己身上");
    expect(r.effects).toEqual([]);
    expect(r.unparsed[0]!.reason).toMatch(/stage-mirror/);
  });

  it("r4e：同义旧句 IR 与本条一致（没被截走）", () => {
    expect(p("将自身能力提升状态附加给对手相应的能力下降效果").effects).toEqual(UP_TO_DOWN); // batch-e6-236
    expect(p("将自身相应的能力提升赋予给对手相应的能力下降").effects).toEqual(UP_TO_DOWN);   // batch-e5c-04
    expect(p("将自身的能力提升赋予给对手的能力下降").effects).toEqual(UP_TO_DOWN);           // batch-e5c-04
    expect(p("将自身能力提升状态附加给对手相应的能力下降效果").unparsed).toEqual([]);
    // 方向没被写反：反向那条（自身负级推给对手）是同一 op 的另一个 direction，本族不落那边
    expect(p("将自身能力提升状态附加给对手相应的能力下降效果").effects)
      .not.toEqual([{ op: "transfer_stages", direction: "push" }]);
  });

  it("r4e：邻句不受影响（吸强 / 反转 / 复制仍是各自那条）", () => {
    expect(p("吸取对手能力提升状态").effects).toEqual([{ op: "transfer_stages", direction: "steal", sign: "up" }]);
    expect(p("自身所有能力下降状态反转为能力提升状态").effects).toEqual([{ op: "invert_stages", sign: "down", target: "self" }]);
    expect(p("使自身能力等级与对手相同").unparsed).toEqual([]);
    expect(p("将自身的能力下降状态双倍反馈给对手").effects).toEqual([
      { op: "transfer_stages", direction: "push", mul: { numerator: 2, denominator: 1 } },
    ]);
  });

  it("r4e：同族旧句没被本条截走（e17-mk-01/02、e17-cv-02 的 IR 不变）", () => {
    expect(p("为对手附加1道天霆之律").effects).toEqual([{ op: "apply_mark", mark: "天霆之律", count: 1, target: "opponent" }]);
    expect(p("为自身附加持续3回合的回能Ⅰ").effects).toEqual([{ op: "apply_mark", mark: "回能Ⅰ", count: 1, target: "self", turns: 3 }]);
    expect(p("使自身的能力等级发生随机的改变").unparsed.map((u) => u.reason)).toEqual(["random-sign stage delta unmodeled (deferred)"]);
  });
});
