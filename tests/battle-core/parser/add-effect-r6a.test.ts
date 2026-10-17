/**
 * r6a：e27 的两条留档（e27-df-01 / e27-df-02）收紧成规则，其余三条一字不动。
 *
 * 为什么对得上（逐字核对）：
 *  e27-df-01「免疫受到的AIL、AIL」——immune_status 本来就能带一个 ailment：
 *    batch-e12 的 e12-bt-02「本场战斗免疫烧伤」发 { name:"immune_status", ailment:"burn" }，
 *    ops/axes.ts 把它落成 scope=burn 的定向免疫（缺省 ailment = 广谱）。
 *    两种点名异常就是两条 immune_status，各带自己的 ailment，target 是 self——不新开状态名、不加 params 键。
 *    AIL_RE 是 Object.keys(AILMENTS).join("|")，本身没有捕获组，所以句子里显式补了两组括号。
 *    正则收 $：对不上整句就退回留档，不把后文吞进 clause（见「带后文」那条）。
 *  e27-df-02「反转对手<stat>能力提升状态」——invertStagesOp 已经会看 fx.stat：
 *    packages/battle-core/src/ops/copy-stages.ts 里 `if (fx.stat !== undefined && s !== fx.stat) continue`，
 *    stat 给定时只翻那一维，缺省才翻全部；sign 仍按原句的提升。
 *    这条只认提升/强化，不认下降。
 *
 * 全维句「反转对手能力提升状态」（没有能力名）不是这条接的：RULES 里 clear 家族排在 batchE27 之前，
 * clear-06 先命中，仍是 { sign:"up", target:"opponent" } 不带 stat；batch-e6-181 是同一形状的后备。
 * 不新增 op：stat 的结算读法由 tests/battle-core/ops/invert-stat.test.ts 直接喂 IR 锁住，
 * schema / CompiledEffect / operatorAllowlist 一律不动（stat 不进 moves schema，所以这里也不写进数据包）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";

interface Fx { op: string; name?: string; ailment?: string; sign?: string; target?: string; stat?: string; numerator?: number; denominator?: number }
const ir = (s: string) => parseEffectText(s, { hasDamage: true }) as {
  effects: Fx[];
  unparsed: { clause?: string; reason?: string }[];
};

/** 定向免疫：一个 ailment 一条，target 恒为 self。 */
const immune = (ailment: string): Fx => ({ op: "apply_status", name: "immune_status", ailment, target: "self" });
/** 单维反转：sign 取原句的提升，target 是对手。 */
const inv = (stat: string): Fx => ({ op: "invert_stages", sign: "up", target: "opponent", stat });

describe("e27-df-01 点名的两种异常免疫", () => {
  it("发两条 immune_status，各带自己的 ailment，target 是 self", () => {
    expect(ir("免疫受到的烧伤、麻痹").effects).toEqual([immune("burn"), immune("paralysis")]);
    expect(ir("自身免疫受到的麻痹、害怕").effects).toEqual([immune("paralysis"), immune("fear")]);
    // 语料原句：自身免疫受到的冰封、焚烬 / 自身免疫受到的麻痹、害怕
    expect(ir("自身免疫受到的冰封、焚烬").effects).toEqual([immune("freeze"), immune("ember")]);
    // "、"之外的分隔与尾部「状态」变体
    expect(ir("免疫受到的烧伤和麻痹").effects).toEqual([immune("burn"), immune("paralysis")]);
    expect(ir("免疫受到的烧伤或麻痹").effects).toEqual([immune("burn"), immune("paralysis")]);
    const tail = ir("免疫受到的烧伤、麻痹状态");
    expect(tail.effects).toEqual([immune("burn"), immune("paralysis")]);
    expect(tail.unparsed).toEqual([]);
  });

  it("正则收尾：带后文对不上整句就留档，绝不吞后文", () => {
    // 「害怕并反转对手能力提升状态」是逗号分句后的残余，必须原样留档，不能并进「免疫受到的…」这一条
    const a = ir("自身免疫受到的麻痹、害怕并反转对手能力提升状态");
    expect(a.effects).toEqual([immune("paralysis")]);
    expect(a.unparsed).toEqual([{ clause: "害怕并反转对手能力提升状态", reason: "no-rule" }]);
    const b = ir("免疫受到的烧伤、麻痹时造成伤害");
    expect(b.effects).toEqual([]);
    expect(b.unparsed).toEqual([{ clause: "免疫受到的烧伤、麻痹时造成伤害", reason: "no-rule" }]);
  });

  it("留档原因不再出现（两条都成规则）", () => {
    const reasons = [
      ...ir("免疫受到的烧伤、麻痹").unparsed,
      ...ir("自身免疫受到的麻痹、害怕").unparsed,
    ].map((u) => u.reason);
    expect(reasons).not.toContain("scoped ailment immunity (named list) — unmodeled (deferred)");
  });

  it("句子里的两种各成一条，同句其它子句照旧", () => {
    expect(ir("自身免疫受到的麻痹、害怕，恢复自身最大体力1/3").effects).toEqual([
      immune("paralysis"),
      immune("fear"),
      { op: "heal", numerator: 1, denominator: 3, target: "self" },
    ]);
  });
});

describe("e27-df-02 单维反转", () => {
  it("只发点名的能力那一维，sign 仍是 up", () => {
    expect(ir("反转对手速度能力提升状态").effects).toEqual([inv("spd")]); // 语料原句
    expect(ir("反转对手物攻能力提升状态").effects).toEqual([inv("atk")]);
    expect(ir("反转对手特攻能力强化状态").effects).toEqual([inv("spa")]);
    expect(ir("反转对手的防御能力提升状态").effects).toEqual([inv("def")]);
    expect(ir("反转对方速度提升").effects).toEqual([inv("spd")]);
  });

  it("全维句不被这条抢走：没有能力名时不带 stat", () => {
    expect(ir("反转对手能力提升状态").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
    // order.mjs 里 clear 家族在 batchE27 之前，先命中的是 clear-06（batch-e6-181 同形状在后）
    const first = (RULES as { id: string; re: RegExp }[]).find((r) => r.re.test("反转对手能力提升状态"));
    expect(first?.id).toBe("clear-06");
  });

  it("这条只认提升/强化：下降句仍留档", () => {
    for (const s of ["反转对手速度能力下降状态", "反转对手速度弱化状态"]) {
      const r = ir(s);
      expect(r.effects).toEqual([]);
      expect(r.unparsed).toEqual([{ clause: s, reason: "no-rule" }]);
    }
  });
});
