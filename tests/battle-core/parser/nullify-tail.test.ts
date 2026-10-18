/**
 * 「攻击无效效果延续至下回合」的切分残留不该留档。
 *
 * 原句形如：
 *   …当回合若自身先出手则令对手使用的威力低于160的攻击技能无效，
 *   若击败对手则攻击无效效果延续至下回合
 * 主体 move_null 由前半句发；后半句的正确语义是「延长这条窗」，解析器已经
 * 通过 attachAll.extendTurns → extendIf 挂上了。但切分时多出来的裸片段
 * 「攻击无效」被 batch-e5f-21 判成 nullify tail fragment 留档，
 * 让"已实现"的句子看起来像没实现。
 *
 * 这里锁两件事：
 *   ① 延长语义确实落在 extendIf 上（不是靠留档表达）
 *   ② 不再多出一条「攻击无效」留档
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const TEXT = "令对手使用的攻击技能无效，若击败对手则攻击无效效果延续至下回合";

describe("攻击无效 + 效果延续", () => {
  it("延长语义落在 extendIf，而不是留档", () => {
    const r = parseEffectText(TEXT);
    const host = r.effects.find((e) => e.op === "apply_status" && e.extendIf !== undefined);
    expect(host, JSON.stringify(r.effects)).toBeDefined();
    expect((host as { extendIf?: unknown }).extendIf).toMatchObject({ turns: 1 });
  });

  it("不再产出「攻击无效」这类切分残留留档", () => {
    for (const t of [TEXT, "攻击无效效果延续至下回合", "攻击无效"]) {
      const r = parseEffectText(t);
      expect(r.unparsed.map((u) => u.clause), t).not.toContain("攻击无效");
    }
  });

  it("真实语料整句同样干净", () => {
    const full =
      "先制+1；必中；5回合内免疫并反弹所有受到的异常状态；5回合内免疫能力下降状态；当回合若自身先出手则令对手使用的威力低于160的攻击技能无效，若击败对手则攻击无效效果延续至下回合";
    const r = parseEffectText(full);
    expect(r.unparsed.map((u) => u.clause)).not.toContain("攻击无效");
    // 主体免疫/反弹仍在，不能为了消留档把别的效果弄丢
    expect(r.effects.some((e) => e.op === "apply_status" && e.name === "immune_status")).toBe(true);
  });
});
