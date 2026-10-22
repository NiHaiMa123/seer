/**
 * boss 注记作用域切分：**结果分支标记不许被甩到前一段**（2026-10-22 第十二轮）。
 *
 * 缺口形状：「A，未触发则回合结束时B（boss无效）」——
 * 句尾的「（boss无效）」触发 `splitLocalBossScopes` 的作用域切分，
 * 切点落在「回合结束时」上，于是「未触发则」被留在前一段：
 *   - 前一段以「未触发则」结尾 → 条件被暂存（pendingCond）却无人消费 → cond-orphan 残文；
 *   - 后一段「回合结束时B」失去条件 → **B 无条件执行**（每个回合末都结算）。
 *
 * 修法：作用域切分的锚点除「若/当」守卫外，再认**结果分支标记**
 *      （未触发/未命中/…+则）——标记与它的负载同属一个作用域。
 *
 * 边界：「未触发则回合结束时B」的负载跨事件（回合末 vs 伤害结算），
 *      当前 IR 表达不了 → 诚实留残文，不产生无条件条目（宁可多留残文，不可无条件执行）。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const residual = (r: { unparsed?: { clause: string; reason?: string }[] }): string[] =>
  (r.unparsed ?? []).map((u) => `${u.reason ?? ""}::${u.clause}`);

describe("boss 注记作用域：结果分支标记与负载同域", () => {
  it("pet-4081 卡娜：「未触发则回合结束时吸取…」不被拆散 → 不产生无条件回合末条目", () => {
    const r = parseSoulmarkText(
      "娜:自身攻击技能每造成1次奇数伤害则本场战斗中造成的伤害提升20%(最高100%);自身造成的伤害低于300则下1次攻击必定致命一击;自身造成的伤害高于300则50%令对手疲惫,未触发则回合结束时吸取对手最大体力的1/3(boss无效)",
      "卡娜",
    );
    // 「未触发则回合结束时吸取对手最大体力的1/3」不得变成无条件回合末条目
    const unconditionalTurnEnd = r.entries.some(
      (e) => e.hook === "onTurnEnd" && (e.ops ?? []).some((o) => (o as { op?: string }).op === "damage"),
    );
    expect(unconditionalTurnEnd).toBe(false);
    // 负载必须留有残文记录（不是静默丢失）
    expect(residual(r).some((x) => x.includes("未触发则回合结束时吸取对手最大体力的1/3"))).toBe(true);
    // 不得再出现 cond-orphan（条件被暂存却无人消费）
    expect(residual(r).some((x) => x.startsWith("cond-orphan"))).toBe(false);
  });

  it("pet-3846 花清酒：else 负载不再每回合末无条件掉血", () => {
    const r = parseSoulmarkText(
      "杏：对手每次提升能力时触发效果：50%令对手随机2个技能PP值归零，未触发则回合结束时令对手损失250点体力（boss无效）",
      "花清酒",
    );
    const unconditional = r.entries.some(
      (e) => (e.ops ?? []).some((o) => (o as { op?: string }).op === "damage" && (o as { kind?: string }).kind === "fixed"),
    );
    expect(unconditional).toBe(false);
    expect(residual(r).some((x) => x.includes("未触发则回合结束时令对手损失250点体力"))).toBe(true);
  });

  it("pet-3517 霍夫曼：跨事件 else 留档，不在受击时提前吸取", () => {
    const r = parseSoulmarkText(
      "轰：首次登场使对手下一次攻击伤害降低50%，下一回合所有技能先制-2；受到攻击50%使对手害怕，未触发回合结束时吸取对手最大体力1/3（BOSS无效）",
      "霍夫曼",
    );
    expect(r.entries.some((e) => (e.ops ?? []).some((o) => o.op === "damage" || o.op === "hp_delta" || o.op === "heal"))).toBe(false);
    expect(r.entries.some((e) => e.hook === "onDamaged" && e.ops?.some((o) => o.name === "fear"))).toBe(true);
    expect(r.unparsed.some((u) => u.clause.includes("未触发回合结束时吸取") && u.reason?.includes("cross-event"))).toBe(true);
  });

  it("无 boss 注记时行为不变（同一句去掉括注）", () => {
    const bare = parseSoulmarkText(
      "自身造成的攻击伤害高于250则领对手速度、命中-2，未触发则回合结束时恢复自身最大体力的1/3",
      "测试",
    );
    const noted = parseSoulmarkText(
      "自身造成的攻击伤害高于250则领对手速度、命中-2，未触发则回合结束时恢复自身最大体力的1/3（BOSS无效）",
      "测试",
    );
    expect(noted.entries).toEqual(bare.entries);
    // 残文**文本**一致（原因可不同：加括注后 else 负载落在独立 clause，宿主查找口径随之变）
    expect(residual(noted).map((x) => x.split("::")[1])).toEqual(residual(bare).map((x) => x.split("::")[1]));
  });

  it("「若/当」守卫的既有作用域语义不受影响", () => {
    const r = parseSoulmarkText("若自身体力低于对手，回合结束时恢复自身最大体力1/3（boss无效）", "测试");
    // 守卫与负载同域 → 条件必须落在条目上，而不是留成 cond-orphan
    expect(residual(r).some((x) => x.startsWith("cond-orphan"))).toBe(false);
    expect(r.entries.length).toBeGreaterThan(0);
  });
});
