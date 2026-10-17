/**
 * add-effect-r4f：seer-r4f 这一路（r4f.md 点名的「反弹给对手原本超出部分N%的百分比伤害」）的结论记录。
 *
 * **本路没有加任何规则**，`tools/effects-rules/heal.mjs` 逐字未动（`heal-232` 保持原样接住这句）。
 * 按 r4f.md 的顺序查完 `reflect_dmg`、`dmg_to_heal` 和已有的超出/溢出字段后，
 * **没有一个读的就是「超出承伤上限的那一段按 N% 还给对手」**：
 *   - `reflect_dmg` 的基数是**被 cap 钳过之后**的 `dmg`
 *     （`ops/damage-riders.ts:121` 读 `dmg`，`dmg` 已在 `ops/damage.ts:349` 被 `dmgCapOf` 截断，
 *     cap 前的原值没被任何一处保存）。用它写 `{n:P,d:100}` 会把 5 处宿主全部反成 0 或错值
 *     （`夜话` cap=0、`沐花释离愁` 300/300、`回想重叠` 600/600 全是静默 0），是错不是近似。
 *   - `flatSelfOverflowPct`（`ops/damage-family.ts:299`）读的是**回复封顶外溢**（`ops/heal.ts:187`），
 *     `shieldAbsorbPct`（`damage-family.ts:368`）读的是**护盾吸收掉的那一段**——语义都不是「超出」。
 *   - `cap.of: "leaveHp"/"matchSelfHp"/"minDamage"`（`damage-family.ts:421`）只改 `dmg` 本身，
 *     不产出溢出段，也没有「把差值交给对手」的通道。
 * 要落地得同时加**一段新的结算 if**（记账 + 投递）和**一个新 params 键**（基数选溢出段），
 * 正是 `plans/touch-budget.md` 里「新状态名、新 params 键、一段新的结算 if」三处同时出现的那一档。
 * 缺口与要补的结算写在 scratch/parallel/r4f-need-op.md。
 *
 * **后续**：seer-r5a 按这一档落定了这句（规则 `r5a-excess-reflect-tail`，`heal-232` 仍留着兜别的形状）。
 * P 记在宿主 `dmg_cap` 窗自己的 `params.excessPct` 上，结算点在 `ops/damage.ts` 承伤上限那一处；
 * 上面「不许落成 reflect_dmg」的理由仍然成立——反的是钳前的溢出段，不是钳后的伤害。
 *
 * 本文件仍只做事实记录：规则表里没有 r4f- 规则、五处宿主现在的形状、
 * 以及旧的 `reflect_dmg` / `dmg_to_heal` / 溢出句结果不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { rules as healRules } from "../../../tools/effects-rules/heal.mjs";

type Parsed = { flags: Record<string, unknown>; effects: unknown[]; unparsed: { clause?: string; reason?: string }[] };

const TAIL = /^反弹给(?:对手|对方|敌方)原本超出部分\d+%的百分比伤害$/;

/** 五处宿主句（content/creatures/creatures.json）：尾巴形状一致，前半的承伤上限各不相同。 */
const HOSTS: readonly { pet: string; cap: number; count: number; text: string }[] = [
  {
    pet: "pet-4781 锐寇特/回想重叠", cap: 600, count: 2,
    text: "必中；4回合内免疫所有受到的异常状态；复制对手能力提升状态，复制成功则自身免疫下1次受到的异常状态；自身下2次受到的攻击伤害不超过600，并反弹给对手原本超出部分60%的百分比伤害",
  },
  {
    pet: "pet-4803 猩猩怪/划裂围牢", cap: 300, count: 1,
    text: "必中；4回合内免疫并反弹所有受到的控制类异常状态；4回合内使用技能附加200点固定伤害，若自身体力高于对手则效果翻倍；自身下1次受到的攻击伤害不超过300，并反弹给对手原本超出部分100%的百分比伤害；3回合内对手使用攻击技能后100%令对手疲惫，未触发则令对手全属性-1",
  },
  {
    pet: "pet-4899 荣光之薇/夜话", cap: 0, count: 1,
    text: "先制+3；复制对手能力提升状态，复制成功则自身免疫下1次受到的异常状态；自身下1次受到的攻击伤害不超过0，并反弹给对手原本超出部分100%的百分比伤害",
  },
  {
    pet: "pet-4397 沐怜/沐花释离愁", cap: 300, count: 1,
    text: "必中；自身下1次受到的攻击伤害不超过300，并反弹给对手原本超出部分100%的百分比伤害；造成伤害不足300则恢复自身全部体力；使自身下2回合攻击必定致命、必定命中",
  },
  {
    pet: "pet-4494 嫉妒·哲利斯/灼魂炼骸", cap: 280, count: 1,
    text: "必中；4回合内免疫并反弹所有受到的异常状态；4回合内每回合使用技能恢复自身最大体力的1/3，恢复体力时若自身体力低于最大体力的1/2则恢复效果转变为吸取对手最大体力的1/3；自身下1次受到的攻击伤害不超过280，并反弹给对手原本超出部分100%的百分比伤害；下2回合自身所有技能先制+2",
  },
];

describe("add one effect (r4f · 反弹原本超出部分N%)", () => {
  it("规则表里没有 r4f- 规则，heal-232 仍接住这句", () => {
    expect(healRules.filter((r: { id: string }) => r.id.startsWith("r4f-"))).toEqual([]);
    const catcher = healRules.find((r: { id: string }) => r.id === "heal-232") as { go: () => unknown } | undefined;
    expect(catcher).toBeDefined();
    expect(catcher!.go()).toEqual({ unparsedReason: "excess/reflect tail — deferred" });
  });

  it("裸句：停在 unparsed（无承伤上限宿主），不许落成 reflect_dmg", () => {
    // 落成 reflect_dmg{n:60,d:100} 会变成「反弹被钳后伤害的 60%」——基数错了。
    // 兜底者是 r5a 的回挂点（找不到 dmg_cap 宿主时的留档），不是 heal-232。
    for (const pct of [60, 100]) {
      const bare = parseEffectText(`反弹给对手原本超出部分${pct}%的百分比伤害`) as Parsed;
      expect(bare.effects).toEqual([]);
      expect(bare.unparsed).toEqual([{ clause: `反弹给对手原本超出部分${pct}%的百分比伤害`, reason: "excess/reflect tail without dmg_cap host" }]);
    }
  });

  it("五处宿主：尾巴落在承伤上限窗自己的 params.excessPct 上，前半照旧", () => {
    for (const host of HOSTS) {
      const r = parseEffectText(host.text) as Parsed;
      // 尾巴不再留 unparsed（r5a 落定），也不再变成反伤窗
      const tail = r.unparsed.filter((u) => TAIL.test(u.clause ?? ""));
      expect(tail, host.pet).toEqual([]);
      expect(r.effects.some((e) => (e as { name?: string }).name === "reflect_dmg"), host.pet).toBe(false);
      // 承伤上限窗照旧，只多一个 P（"原本超出部分P%"）——基数由结算点按钳前伤害 − cap 算
      expect(r.effects, host.pet).toContainEqual({
        op: "apply_status", name: "dmg_cap", target: "self",
        params: { cap: host.cap, count: host.count, excessPct: host.cap === 600 ? 60 : 100 },
      });
    }
  });

  it("同批扫描里的「蚩庸之锁超出了上限」是印记层数上限，不是承伤上限（另开契约）", () => {
    const r = parseEffectText("必中；全属性+1，对手处于能力下降状态时强化效果翻倍；4回合内使用技能吸取对手最大体力的1/3，自身体力低于1/2时效果翻倍，吸取后若对手体力未减少则为己方所有场下存活精灵恢复200点体力；下2回合令自身所有技能先制+2；为对手附加1层蚩庸之锁，若附加的蚩庸之锁超出了上限则对手下2回合先制-1") as Parsed;
    expect(r.effects).toContainEqual({ op: "apply_mark", mark: "蚩庸之锁", count: 1, target: "opponent" });
    expect(r.unparsed).toEqual([{ clause: "若附加的蚩庸之锁超出了上限则对手下2回合先制-1", reason: "no-rule" }]);
  });

  it("旧句结果不变：reflect_dmg 读的是本次伤害，溢出/转化各有自己的字段", () => {
    expect((parseEffectText("伤害40%反馈对手") as Parsed).effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 40, d: 100 } },
    ]);
    expect((parseEffectText("受到伤害40%反馈给对手") as Parsed).effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 40, d: 100 } },
    ]);
    expect((parseEffectText("反弹给对手造成伤害值50%的百分比伤害") as Parsed).effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 50, d: 100 } },
    ]);
    expect((parseEffectText("反弹当回合受到的大于300的伤害") as Parsed).effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 }, if: { takenAboveAbs: 300 } },
    ]);
    expect((parseEffectText("将30%受到的伤害转化为自身体力") as Parsed).effects).toEqual([
      { op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 30 } },
    ]);
    expect((parseEffectText("附加溢出量26%的真实伤害") as Parsed).effects).toEqual([
      { op: "damage", kind: "true", power: 0, target: "opponent" },
      { op: "flat", of: "flatSelfOverflowPct", value: 26 },
    ]);
    expect((parseEffectText("获得等同于溢出量的护罩") as Parsed).effects).toEqual([
      { op: "apply_status", name: "ward", target: "self", params: { fromOverflow: 1, kindMask: 3 } },
    ]);
  });
});
