/**
 * add-effect-r5c：batch-e27 里两条 deferred 留档转正的结论记录。
 *
 *   1) `e27-df-01`「免疫受到的AIL、AIL」——具名异常清单。
 *      `immune_status` 已经能带一个 ailment 子类（`ops/axes.ts` 的 `AxisForm.ailment`，
 *      消费点 `ops/effects.ts:immuneOn` 的 `e.ailment === ailment`），
 *      所以两种异常发两条 `immune_status`，各带自己的 ailment。没有新状态名。
 *      具名清单以外的句子（单名免疫、全异常免疫）逐字未动。
 *   2) `e27-df-02`「反转对手速度能力提升状态」——单维反转。
 *      `invert_stages` 此前全维（`ops/copy-stages.ts` 无 stat 过滤）；
 *      给它加一个可选 `stat`（不是新 op，五处登记那档不动）：`CompiledEffect` 分支加字段，
 *      handler 在维循环里跳过非指名维。sign 仍按原句的提升/下降，全维旧句一字不变。
 *
 * `tools/effects-rules/order.mjs` 未动：两条规则原地改 go，id 与其在快照里的相对顺序不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as e27Rules } from "../../../tools/effects-rules/batch-e27.mjs";

type Parsed = { flags: Record<string, unknown>; effects: unknown[]; unparsed: { clause?: string; reason?: string }[] };
type Rule = { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown };

const firstHit = (s: string) => (RULES as Rule[]).find((r) => r.re.test(s))?.id;
const direct = (id: string, s: string) => {
  const r = (e27Rules as Rule[]).find((x) => x.id === id)!;
  const m = s.match(r.re);
  return m === null ? undefined : r.go(m);
};

describe("e27-df-01 具名异常免疫清单 → 两条 immune_status（各带 ailment）", () => {
  it("规则本体：两种异常各发一条，不新开状态名", () => {
    expect(direct("e27-df-01", "免疫受到的烧伤、麻痹")).toEqual({
      effects: [
        { op: "apply_status", name: "immune_status", ailment: "burn", target: "self" },
        { op: "apply_status", name: "immune_status", ailment: "paralysis", target: "self" },
      ],
    });
    // "和"/"或" 同形；"自身"前缀只影响主语，IR 一致
    expect(direct("e27-df-01", "免疫受到的烧伤和麻痹")).toEqual(direct("e27-df-01", "免疫受到的烧伤、麻痹"));
    expect(direct("e27-df-01", "免疫受到的烧伤或麻痹")).toEqual(direct("e27-df-01", "免疫受到的烧伤、麻痹"));
    expect(direct("e27-df-01", "自身免疫受到的冰封、焚烬")).toEqual({
      effects: [
        { op: "apply_status", name: "immune_status", ailment: "freeze", target: "self" },
        { op: "apply_status", name: "immune_status", ailment: "ember", target: "self" },
      ],
    });
  });

  it("裸句：不再落 unparsed，两条免疫都在", () => {
    const r = parseEffectText("免疫受到的烧伤、麻痹") as Parsed;
    expect(firstHit("免疫受到的烧伤、麻痹")).toBe("e27-df-01");
    expect(r.effects).toEqual([
      { op: "apply_status", name: "immune_status", ailment: "burn", target: "self" },
      { op: "apply_status", name: "immune_status", ailment: "paralysis", target: "self" },
    ]);
    expect(r.unparsed).toEqual([]);
  });

  it("长句里的清单也吃到了：两种异常成两条窗，回合前缀照旧进 turns", () => {
    const r = parseEffectText("当回合自身免疫受到的麻痹、害怕、疲惫异常状态") as Parsed;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "immune_status", ailment: "paralysis", target: "self", turns: 1 },
      { op: "apply_status", name: "immune_status", ailment: "fear", target: "self", turns: 1 },
    ]);
    // 清单外的第三名仍不臆造（"疲惫异常状态"是切出来的残留段，留 unparsed）
    expect(r.unparsed).toEqual([{ clause: "疲惫异常状态", reason: "no-rule" }]);
  });

  it("具名清单以外的句子逐字未动：单名、无名、名字在前面的复合形", () => {
    expect((parseEffectText("免疫受到的冰封") as Parsed).effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", ailment: "freeze" },
    ]);
    expect((parseEffectText("免疫受到的臣服状态") as Parsed).effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", ailment: "submit" },
    ]);
    expect((parseEffectText("本场战斗免疫烧伤") as Parsed).effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", ailment: "burn" },
    ]);
    expect((parseEffectText("天生免疫烧伤状态") as Parsed).effects).toEqual([
      { op: "apply_status", name: "immune_status", ailment: "burn", target: "self" },
    ]);
    // "免疫A、B"（无「受到的」）不走本条：动词继承通道先接住，IR 形状照旧
    expect((parseEffectText("免疫烧伤、麻痹") as Parsed).effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", ailment: "burn" },
      { op: "apply_status", name: "immune_status", target: "self", ailment: "paralysis" },
    ]);
  });

  it("顺序：本条仍排在 e27-df-02 / e27-df-03 之前（原地改，快照相对序不变）", () => {
    const ids = RULES.map((r: Rule) => r.id);
    expect(ids.indexOf("e27-df-01")).toBeLessThan(ids.indexOf("e27-df-02"));
    expect(ids.indexOf("e27-df-01")).toBeLessThan(ids.indexOf("e27-df-03"));
    expect(firstHit("免疫受到的烧伤、麻痹")).toBe("e27-df-01");
  });
});

describe("e27-df-02 单维反转 → invert_stages 带 stat", () => {
  it("规则本体：点名那一维进 stat，sign 按原句的「提升」= up", () => {
    expect(direct("e27-df-02", "反转对手速度能力提升状态")).toEqual({
      effects: [{ op: "invert_stages", sign: "up", target: "opponent", stat: "spd" }],
    });
    expect(direct("e27-df-02", "反转对手命中能力提升状态")).toEqual({
      effects: [{ op: "invert_stages", sign: "up", target: "opponent", stat: "acc" }],
    });
    // 「强化」同义；「的」可有可无；别名维（特防）归一
    expect(direct("e27-df-02", "反转对手特防强化状态")).toEqual({
      effects: [{ op: "invert_stages", sign: "up", target: "opponent", stat: "sdf" }],
    });
    expect(direct("e27-df-02", "反转对手速度提升")).toEqual(direct("e27-df-02", "反转对手速度能力提升状态"));
  });

  it("裸句：不再落 unparsed，只有被点名的那一维带 stat", () => {
    const r = parseEffectText("反转对手速度能力提升状态") as Parsed;
    expect(firstHit("反转对手速度能力提升状态")).toBe("e27-df-02");
    expect(r.effects).toEqual([{ op: "invert_stages", sign: "up", target: "opponent", stat: "spd" }]);
    expect(r.unparsed).toEqual([]);
    expect((parseEffectText("反转对手速度能力提升") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent", stat: "spd" },
    ]);
  });

  it("全维旧句一字不变（没有 stat 字段）", () => {
    expect((parseEffectText("反转对手能力提升状态") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
    expect((parseEffectText("反转对手的能力提升状态") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
    expect((parseEffectText("双倍反转对手能力提升状态") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "up", mul: { numerator: 2, denominator: 1 }, target: "opponent" },
    ]);
    expect((parseEffectText("反转自身能力下降状态") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "down", target: "self" },
    ]);
  });

  it("同句拆开时两条各归各：全维一条、单维一条", () => {
    expect((parseEffectText("反转对手的能力提升状态；反转对手速度能力提升状态") as Parsed).effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
      { op: "invert_stages", sign: "up", target: "opponent", stat: "spd" },
    ]);
  });

  it("顺序：本条仍排在 e27-df-03 之前，且全维句不被它截走", () => {
    const ids = RULES.map((r: Rule) => r.id);
    expect(ids.indexOf("e27-df-02")).toBeLessThan(ids.indexOf("e27-df-03"));
    // 全维句仍先命中更宽的旧规则（clear-06），不被本条截走
    expect(firstHit("反转对手能力提升状态")).toBe("clear-06");
  });
});
