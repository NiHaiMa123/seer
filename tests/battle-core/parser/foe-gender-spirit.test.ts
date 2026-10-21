/**
 * 性别门（foeGender）的「精灵」后缀。
 *
 * 缺口：condOf 的性别门只认「对手为雄性」，语料里还有「对手为雄性**精灵**」
 * （pet-4807 黑石女妖、pet-3965 闭月之姿、pet-4132 女王使命/狂影之掠，
 *  以及 4 个技能：净世闭月断、傩舞影凋零、狂影之掠、女王使命）。
 * 认不出 → 这些条件整条被 defer（「gender domain unmodeled」），
 * 条件后面的效果全部丢失。
 *
 * 改法：tools/effects-parse.mjs 的 condOf 性别门加可选「精灵」后缀。
 * 引擎侧 foeGender 谓词本来就存在（ops/cond.ts 读 pack 的 CompiledUnit.gender），
 * 没有新 op、没有新状态名、没有新 params 键。
 *
 * 边界：时-form（"对手为雄性精灵时X"）的条件仍接不上体——**不产条目**，
 * 残文更精确（条件与体分两段），由 add-soulmark-p3.test 的邻句护栏锁住。
 */
import { describe, it, expect } from "vitest";
import { condOf } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("性别门：「对手为雄性精灵」等形态", () => {
  it("带「精灵」后缀与不带的是同一谓词", () => {
    expect(condOf("对手为雄性精灵")).toEqual(condOf("对手为雄性"));
    expect(condOf("对手为雌性精灵")).toEqual(condOf("对手为雌性"));
    expect(condOf("对手为雄性精灵")).toEqual({ foeGender: "male" });
    expect(condOf("对手为雌性精灵")).toEqual({ foeGender: "female" });
    expect(condOf("对手为无性别精灵")).toEqual({ foeGender: "none" });
  });

  it("旧写法不回归", () => {
    expect(condOf("对手为雄性")).toEqual({ foeGender: "male" });
    expect(condOf("对手为雌性")).toEqual({ foeGender: "female" });
    expect(condOf("对手为无性别")).toEqual({ foeGender: "none" });
  });

  it("魂印层：「若…则」形的性别门落位（不再是整条 defer）", () => {
    const r = parseSoulmarkText(
      "若对手为雄性精灵则当回合自身造成的攻击伤害提升50%",
      "闭月之姿",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onTurnEnd",
        guard: { foeGender: "male" },
        ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 }, turns: 1 }],
      },
    ]);
  });
});
