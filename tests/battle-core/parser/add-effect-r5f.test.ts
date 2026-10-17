/**
 * r5f 复审：克制阶梯不能收成一条无条件 noResist。
 *
 * 唯一的技能宿主是逐界苍星 / 彼空·苍星坠梦：
 *   伤害计算时克制倍数至少为 1，
 *   1 层未来奇点则至少为 1.25，2 层 1.5，3 层 2。
 * noResist 是单值。同键后写盖先写会只留下最后一档，条件又挂不进 rider，
 * 整句会变成「永远至少 2 倍」。那比留档更错，所以不发规则。
 * 1.0 仍走 r3-noresist-01（noResist: true）。三个带层数的子句仍由 e47-08 留档。
 * 数字下限的结算读法在 ops/damage-family.ts，由 eff-floor.test.ts 直接喂 IR，
 * 解析器不发这个数字。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";

const ir = (s: string) => parseEffectText(s, { hasDamage: true }) as {
  flags: { attachDamage?: Record<string, unknown> };
  effects: { op: string; of?: string; value?: unknown }[];
  unparsed: { clause?: string; reason?: string }[];
  orphanCond?: unknown;
};

const HOST = "必中；当自身处于能力下降状态时先制+3；将自身的能力下降状态双倍反馈给对手，反馈成功则对手下1次技能无效；伤害计算时克制倍数至少为1，若自身拥有1层未来奇点则克制倍数至少为1.25，自身拥有2层未来奇点则克制倍数至少为1.5，自身拥有3层未来奇点则克制倍数至少为2";

const deferred = (clause: string) => ({ clause, reason: "type override / element settle unmodeled (deferred)" });

describe("r5f 克制阶梯仍留档", () => {
  it("宿主句：1.0 仍是 noResist true，三个层数下限留档，不收成 32", () => {
    const r = ir(HOST);
    expect(r.effects).toEqual([
      { op: "formula", of: "noResist", value: true },
      { op: "transfer_stages", direction: "push", mul: { numerator: 2, denominator: 1 } },
      { op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 }, if: { prevApplied: true } },
    ]);
    expect(r.flags).toEqual({ accuracy: "always", priorityIf: { when: { selfStageDown: true }, add: 3 } });
    expect(r.unparsed).toEqual([
      deferred("克制倍数至少为1.25"),
      deferred("克制倍数至少为1.5"),
      deferred("克制倍数至少为2"),
    ]);
    expect(JSON.stringify(r.effects)).not.toMatch(/"value":(20|24|32)/);
  });

  it("单条子句也不发数字下限", () => {
    const one = ir("若自身拥有1层未来奇点则克制倍数至少为1.25");
    expect(one.effects).toEqual([]);
    expect(one.unparsed).toEqual([deferred("克制倍数至少为1.25")]);
    expect(one.orphanCond).toEqual({ markCountAtLeast: { mark: "1层未来奇点", n: 1, on: "self" } });
    expect(ir("克制倍数至少为1.25").unparsed).toEqual([deferred("克制倍数至少为1.25")]);
    expect(ir("自身拥有2层未来奇点则克制倍数至少为1.5").unparsed).toEqual([deferred("克制倍数至少为1.5")]);
    expect(ir("自身拥有3层未来奇点则克制倍数至少为2").unparsed).toEqual([deferred("克制倍数至少为2")]);
  });

  it("至少为 1 与不微弱仍是 noResist true", () => {
    expect(ir("伤害计算时克制倍数至少为1").effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
    expect(ir("伤害计算时克制倍数至少为1").unparsed).toEqual([]);
    expect(ir("攻击时造成的伤害不会出现微弱").effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
    expect(ir("攻击时伤害不会出现微弱").effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
  });

  it("至多、随机倍数、取最大值仍按原样留档", () => {
    const upper = ir("若自身拥有1层未来奇点则克制倍数至多为2");
    expect(upper.effects).toEqual([]);
    expect(upper.unparsed).toEqual([deferred("克制倍数至多为2")]);
    const rnd = ir("火系技能威力为随机倍数");
    expect(rnd.effects).toEqual([]);
    expect(rnd.unparsed[0]?.reason).toMatch(/type override/);
    const max = ir("克制倍数取自身对对手、对手对自身克制倍数中的最大值");
    expect(max.unparsed.map((u) => u.clause)).toEqual(["克制倍数取自身对对手", "对手对自身克制倍数中的最大值"]);
    const ids = (RULES as { id: string }[]).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("r5f-efffloor-01");
  });
});
