/**
 * 分数型附加固伤的触发概率（2026-10-22 第十三轮）。
 *
 * 缺口形状：「攻击有50%几率附加自身最大体力1/3的固伤」——
 * 「50%」被剥成概率前缀后，**分数型**固伤（flatSelfFrac / flatFoeFrac / flatSelfPct）
 * 的概率载体不在回填名单里 → 概率整段丢失 → **该 50% 的效果变成 100%**（每次都结算）。
 * 同族的 flatBonus（"50%几率附加250点固伤"）一直是对的——概率挂在 damage op 上。
 *
 * 修法：
 *   - 效果层：概率回填名单补上分数型固伤（仅魂印语境开 opts.fracFlatChance，
 *     技能侧的 flatChance 门控语义另议——引擎只按 flatBonus 语义读它）；
 *   - 魂印层：attachDamage → op 时把概率挂到产出的 damage op 上
 *     （op 级 chance＝未过则整 op 跳过；分数固伤作为 rider 并入宿主，装载期同受门控）。
 *
 * 边界：**技能侧不动**（引擎 `flatChance` 只门控 flatBonus/flatRange，不门控分数型固伤；
 * 顺带改引擎会波及既有 7 条「flatChance + 分数固伤」条目，且其中一部分概率来自
 * 「未触发则」分支的结转——属另一个语义问题，留给专门一轮）。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("分数型附加固伤的触发概率", () => {
  it("pet-3457 亚尔娜：「50%几率附加自身最大体力1/3的固伤」的概率不丢", () => {
    const r = parseSoulmarkText("亚：攻击有50%几率附加自身最大体力1/3的固伤，未触发则附加自身攻击值50%的固伤（Boss无效）。", "亚尔娜");
    const dmg = r.entries[0]?.ops?.find((o) => (o as { op?: string }).op === "damage");
    expect(dmg).toBeDefined();
    expect((dmg as { chance?: number }).chance).toBe(50);
    expect((dmg as { power?: number }).power).toBe(0);
  });

  it("pet-3639 普约尔：低伤分支的「50%附加自身最大体力1/3的固伤」带上概率", () => {
    const r = parseSoulmarkText(
      "普：自身造成的攻击伤害高于300则50%附加对手最大体力1/3的固伤，未触发则令对手冰封；自身造成的攻击伤害低于300则50%附加自身最大体力1/3的固伤，未触发则令对手麻痹（boss无效）",
      "普约尔",
    );
    const low = r.entries.find((e) => (e.guard as { prevDamageBelowAbs?: number } | undefined)?.prevDamageBelowAbs === 300);
    expect(low).toBeDefined();
    const dmg = low!.ops?.find((o) => (o as { op?: string }).op === "damage");
    expect((dmg as { chance?: number }).chance).toBe(50);
  });

  it("同族 flatBonus 的概率不受影响（50%几率附加250点固伤）", () => {
    const r = parseSoulmarkText("攻击有50%几率附加250点固伤", "测试");
    const dmg = r.entries[0]?.ops?.find((o) => (o as { op?: string }).op === "damage");
    expect((dmg as { chance?: number }).chance).toBe(50);
  });

  it("没有概率前缀时不得凭空挂 chance", () => {
    const r = parseSoulmarkText("攻击附加自身最大体力1/3的固伤", "测试");
    const dmg = r.entries[0]?.ops?.find((o) => (o as { op?: string }).op === "damage");
    expect((dmg as { chance?: number }).chance).toBeUndefined();
  });
});
