/**
 * 「双方每有1方精灵先制为0，对手下1回合所有技能先制-1」。
 *
 * 语义：任意一方本回合**实际**先制为 0（engine.prio() 的结果，含 prio_up/条件/钩子加成），
 * 则对手下回合 prio_up -1。谓词用新增的 prioZero。
 *
 * 星光·雷纳多/星光·极速射线整句：
 *   先制+3；消除对手回合类效果，消除成功则下1回合令对手使用的攻击技能无效；
 *   双方每有1方精灵先制为0，对手下1回合所有技能先制-1
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const CLAUSE = "双方每有1方精灵先制为0，对手下1回合所有技能先制-1";

describe("双方每有1方精灵先制为0", () => {
  it("产出带 prioZero 条件的先制削减", () => {
    const r = parseEffectText(CLAUSE);
    expect(r.unparsed).toEqual([]);
    const op = r.effects.find((e) => e.op === "apply_status");
    expect(op, JSON.stringify(r.effects)).toBeDefined();
    const o = op as { target?: string; name?: string; turns?: number; params?: { add?: number }; if?: unknown };
    expect(o.target).toBe("opponent");
    expect(o.name).toBe("prio_up");
    expect(o.turns).toBe(1);
    expect(o.params?.add).toBe(-1);
    expect(o.if).toEqual({ prioZero: true });
  });

  it("变体写法也能识别", () => {
    for (const t of ["双方每有1方先制为0，对手下1回合所有技能先制-1", "若有1方精灵先制为0，对手下1回合先制-1"]) {
      const r = parseEffectText(t);
      expect(r.unparsed, t).toEqual([]);
      expect(r.effects.some((e) => e.op === "apply_status"), t).toBe(true);
    }
  });

  it("真实整句切分后该子句不残留", () => {
    const full =
      "先制+3；消除对手回合类效果，消除成功则下1回合令对手使用的攻击技能无效；双方每有1方精灵先制为0，对手下1回合所有技能先制-1";
    const r = parseEffectText(full, { hasDamage: true });
    expect(r.unparsed.map((u) => String(u.clause))).not.toContain("双方每有1方精灵先制为0");
  });
});
