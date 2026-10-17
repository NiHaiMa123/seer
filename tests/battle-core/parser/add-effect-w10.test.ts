/**
 * w10：能力等级历史回溯。
 *
 * 语料只有一句「(先|后)出手时将自身能力等级返回至上一回合结束时」（15 个招式，同一字符串）。
 * 规则落在 tools/effects-rules/batch-w10.mjs；结算 op stages_rewind 的处理器在 ops/slots/w10.ts，
 * 已按「一个新 op」的五处登记（OPS / CompiledEffect / moves.schema / operatorAllowlist / 本测试）。
 *
 * 下面锁三件事：
 *   1) 规则本身发什么 IR——直接跑 batch-w10.mjs 的 go()，不经 order 表；
 *   2) 规则在 order 表里的位置（排在 batch-e5-34 / penalty-08 之前，整句与裸片段都命中它）；
 *   3) 相邻能力等级句的 IR 一字不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as w10Rules } from "../../../tools/effects-rules/batch-w10.mjs";

const SENTENCE = "后出手时将自身能力等级返回至上一回合结束时";
const BODY = "将自身能力等级返回至上一回合结束时";

/** 绕过 order 顺序跑本家族规则。 */
const direct = (s: string) => {
  for (const r of w10Rules as { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown }[]) {
    const m = s.match(r.re);
    if (m) return { id: r.id, out: r.go(m) };
  }
  return undefined;
};
const firstHit = (s: string) => (RULES as { id: string; re: RegExp }[]).find((r) => r.re.test(s))?.id;
const idxOf = (id: string) => RULES.findIndex((r: { id: string }) => r.id === id);

describe("w10 能力等级回溯", () => {
  it("规则把「(先|后)出手时」剥掉，发 stages_rewind self turns=1", () => {
    const d = direct(SENTENCE) as { id: string; out: { effects: unknown[] } };
    expect(d.id).toBe("w10-rewind-01");
    expect(d.out).toEqual({ effects: [{ op: "stages_rewind", target: "self", turns: 1 }] });
    // 前缀可有可无同一 IR
    expect(direct(BODY)).toEqual(d);
  });

  it("规则只吃整段；后面还有别的子句时不接管", () => {
    expect(direct(`${BODY}；使对手攻击MISS`)).toBeUndefined();
    expect(firstHit(`${BODY}；使对手攻击MISS`)).not.toBe("w10-rewind-01");
  });

  it("顺序：本规则排在 batch-e5-34 / penalty-08 之前，整句与剥前缀的裸片段都命中它", () => {
    const mine = idxOf("w10-rewind-01");
    expect(mine).toBeGreaterThan(-1);
    expect(mine).toBeLessThan(idxOf("batch-e5-34"));
    expect(mine).toBeLessThan(idxOf("penalty-08"));
    expect(firstHit(SENTENCE)).toBe("w10-rewind-01");
    // 解析器先把「后出手时」剥成谓词，剩下的裸片段也必须先命中本规则（此前被 batch-e5-34 截走）
    expect(firstHit(BODY)).toBe("w10-rewind-01");
  });

  it("整句现在真的解析成 stages_rewind：出手序进 if，不再是 deferred 留档", () => {
    const r = parseEffectText(SENTENCE, { hasDamage: true }) as { effects: unknown[]; unparsed: unknown[]; orphanCond?: unknown };
    expect(r.effects).toEqual([{ op: "stages_rewind", target: "self", turns: 1, if: { order: "last" } }]);
    expect(r.unparsed).toEqual([]);
    expect(r.orphanCond).toBeUndefined();
    // 「先出手时」同形，只换谓词值
    expect((parseEffectText("先出手时将自身能力等级返回至上一回合结束时", { hasDamage: true }) as { effects: unknown[] }).effects).toEqual([
      { op: "stages_rewind", target: "self", turns: 1, if: { order: "first" } },
    ]);
    // 无前缀词形同一 IR，无 if
    expect((parseEffectText(BODY, { hasDamage: true }) as { effects: unknown[] }).effects).toEqual([
      { op: "stages_rewind", target: "self", turns: 1 },
    ]);
  });

  it("带前缀的整句：回溯句与后半句各出一条，前提都是 order:last", () => {
    const r = parseEffectText(`${SENTENCE}；后出手时使对手下1回合攻击技能MISS`, { hasDamage: true }) as { effects: unknown[]; unparsed: unknown[] };
    expect(r.effects).toEqual([
      { op: "stages_rewind", target: "self", turns: 1, if: { order: "last" } },
      { op: "apply_status", name: "must_miss_atk", target: "self", turns: 1, if: { order: "last" } },
    ]);
    expect(r.unparsed).toEqual([]);
  });

  it("相邻的能力等级句一字不动", () => {
    expect((parseEffectText("自身攻击等级+1") as { effects: unknown[] }).effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" },
    ]);
    expect((parseEffectText("随机使对手2种能力等级-2") as { effects: unknown[] }).effects).toEqual([
      { op: "apply_stat_stage", stat: "random", randomCount: 2, delta: -2, target: "opponent" },
    ]);
    expect((parseEffectText("反转自身能力下降状态") as { effects: unknown[] }).effects).toEqual([
      { op: "invert_stages", sign: "down", target: "self" },
    ]);
    // 消除强化 + 条件回血：prevApplied 链不许被回溯句带歪
    expect((parseEffectText("消除对手能力提升状态，消除成功则恢复自身所有体力") as { effects: unknown[] }).effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "heal", numerator: 1, denominator: 1, target: "self", if: { prevApplied: true } },
    ]);
  });
});
