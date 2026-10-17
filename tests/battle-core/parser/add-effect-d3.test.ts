/**
 * add-effect-d3：seer-d3 这一路（技能长尾扫荡）加的技能规则。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 * 每条：新规则解析出的 IR + 相邻旧句子结果不变。
 * 只收 reason 干净（no-rule）的句子；组队/系数类/脏截断/已由 d1·d2 认领的一律不收。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

type R = { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
const p = (t: string) => parseEffectText(t, { hasDamage: true }) as unknown as R;

describe("add one effect (d3)", () => {
  it("d3-clr-typo-01：「解除成」是「解除成功」的脱字（宿主句 魔灵牵魂咒／摄魄令）", () => {
    const r = p("解除自身能力下降状态，解除成则免疫下1次受到的攻击");
    expect(r.effects).toEqual([
      { op: "clear_stages", target: "self", sign: "down" },
      { op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 }, if: { prevApplied: true } },
    ]);
    expect(r.unparsed).toEqual([]);
    // 相邻旧句（正确的「解除成功」形）结果不变：门与负载同形，不因新规则多出/少掉 op
    expect(p("解除成功则免疫下1次受到的攻击").effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 }, if: { prevApplied: true } },
    ]);
    // 「解除成功」整句仍走 attach-damage-05 的路径，不被本条的脱字形截走
    expect(p("解除自身能力下降状态，解除成功则免疫下1次受到的攻击").effects).toEqual([
      { op: "clear_stages", target: "self", sign: "down" },
      { op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 }, if: { prevApplied: true } },
    ]);
  });
  it("d3-clr-neg-01：「未进入异常」= 异常施加未落地（宿主句 轮回之狱／永恒长眠）", () => {
    const r = p("使对手随机进入2种异常状态，未进入异常则消除对手回合类效果");
    const tail = (r.effects as { op: string; name?: string; if?: unknown }[]).find((e) => e.op === "cleanse");
    expect(tail).toEqual({ op: "cleanse", target: "opponent", scope: "timed", if: { not: { prevApplied: true } } });
    expect(r.unparsed).toEqual([]);
    // 相邻旧句（无条件消除）结果不变：不带 if 门，不被这条截走
    expect(p("消除对手回合类效果").effects).toEqual([{ op: "cleanse", target: "opponent", scope: "timed" }]);
  });

  it("d3-clear-alias-01：「若清除成功」/「消除状态成功」是 e5d-09 的别名（宿主句 雷暴火环／穿刺射击／灭魂疾风刺）", () => {
    expect(p("清除对手强化，若清除成功则自身命中+1").effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "apply_stat_stage", stat: "acc", delta: 1, target: "self", if: { prevApplied: true } },
    ]);
    expect(p("消除对手能力强化状态，若消除状态成功则自身特攻等级+1").effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "apply_stat_stage", stat: "spa", delta: 1, target: "self", if: { prevApplied: true } },
    ]);
    // 相邻旧句结果不变：e5d-09 的「清除成功则…」尾句同门同形
    expect(p("清除对手能力强化，清除成功则对手石化").effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "apply_status", name: "petrify", target: "opponent", if: { prevApplied: true } },
    ]);
  });

  it("d3-stage-typo-01：「另」是「令」的脱字（宿主句 天道降魔阵）", () => {
    const evens = (t: string) => (p(t).effects as { stat?: string; delta?: number; target?: string }[]).filter((e) => e.op !== undefined);
    expect(evens("另对手全属性－1，3回合内每回合受到100点固定伤害").slice(0, 5)).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "def", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "sdf", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" },
    ]);
    expect(p("另对手全属性－1").unparsed).toEqual([]);
    // 相邻旧句（正确「令」形）结果不变：同维同值同目标
    expect(p("令对手全属性-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "def", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "sdf", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" },
    ]);
  });

  it("d3-attach-typo-01/02：「附件」是「附加」的脱字（宿主句 暴风烈焰／超震拳风／爆发冲击）", () => {
    expect(p("对方烧伤时，附件100点伤害").effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { foeHas: "burn" }, flat: 100 } },
    ]);
    expect(p("随机恢复100-200HP，随机附件100-200固定伤害").effects).toEqual([
      { op: "flat", of: "flatRange", value: { min: 100, max: 200 } },
      { op: "heal", flatRange: { min: 100, max: 200 }, target: "self" },
    ]);
    expect(p("10%几率额外附件200点固定伤害").effects).toEqual([
      { op: "flat", of: "flatBonus", value: 200 },
      { op: "flat", of: "flatChance", value: 10 },
    ]);
    // 相邻旧句（正确「附加」形）结果不变：三条同门同形
    expect(p("对方烧伤时，附加100点伤害").effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { foeHas: "burn" }, flat: 100 } },
    ]);
    expect(p("随机附加100-200固伤").effects).toEqual([{ op: "flat", of: "flatRange", value: { min: 100, max: 200 } }]);
    expect(p("附加100点伤害").effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
  });

});
