/**
 * add-effect-r5a：seer-r5a 这一路加的一条规则（`tools/effects-rules/heal.mjs` 的 `r5a-excess-reflect-tail`）。
 *
 * 句子：「自身下 N 次受到的攻击伤害不超过 M，并反弹给对手原本超出部分 P% 的百分比伤害」。
 * 结算语义：先把这次伤害钳到 M，再把钳掉的那一段（原始伤害 − M，负则 0）的 P% 打回对手。
 * 所以尾句不许落成 `reflect_dmg{n:P,d:100}`——那个读的是**被钳之后**的 `dmg`（`ops/damage-riders.ts`），
 * cap=0 / 伤害≤cap 的宿主会静默反成 0。这里把 P 记在承伤上限窗自己身上：`dmg_cap.params.excessPct`，
 * 结算点（`ops/damage.ts` 承伤上限那一处）按溢出段读取。
 *
 * 只接这一种词形；其它反弹句的结果在下面钉住不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { rules as healRules } from "../../../tools/effects-rules/heal.mjs";

type Parsed = { flags: Record<string, unknown>; effects: { name?: string; op?: string; params?: Record<string, number> }[]; unparsed: { clause?: string; reason?: string }[] };

/** 五处宿主句（content/creatures/creatures.json）：尾巴形状一致，前半的承伤上限各不相同。 */
const HOSTS: readonly { pet: string; cap: number; count: number; pct: number; text: string }[] = [
  {
    pet: "pet-4781 锐寇特/回想重叠", cap: 600, count: 2, pct: 60,
    text: "必中；4回合内免疫所有受到的异常状态；复制对手能力提升状态，复制成功则自身免疫下1次受到的异常状态；自身下2次受到的攻击伤害不超过600，并反弹给对手原本超出部分60%的百分比伤害",
  },
  {
    pet: "pet-4803 猩猩怪/划裂围牢", cap: 300, count: 1, pct: 100,
    text: "必中；4回合内免疫并反弹所有受到的控制类异常状态；4回合内使用技能附加200点固定伤害，若自身体力高于对手则效果翻倍；自身下1次受到的攻击伤害不超过300，并反弹给对手原本超出部分100%的百分比伤害；3回合内对手使用攻击技能后100%令对手疲惫，未触发则令对手全属性-1",
  },
  {
    pet: "pet-4899 荣光之薇/夜话", cap: 0, count: 1, pct: 100,
    text: "先制+3；复制对手能力提升状态，复制成功则自身免疫下1次受到的异常状态；自身下1次受到的攻击伤害不超过0，并反弹给对手原本超出部分100%的百分比伤害",
  },
  {
    pet: "pet-4397 沐怜/沐花释离愁", cap: 300, count: 1, pct: 100,
    text: "必中；自身下1次受到的攻击伤害不超过300，并反弹给对手原本超出部分100%的百分比伤害；造成伤害不足300则恢复自身全部体力；使自身下2回合攻击必定致命、必定命中",
  },
  {
    pet: "pet-4494 嫉妒·哲利斯/灼魂炼骸", cap: 280, count: 1, pct: 100,
    text: "必中；4回合内免疫并反弹所有受到的异常状态；4回合内每回合使用技能恢复自身最大体力的1/3，恢复体力时若自身体力低于最大体力的1/2则恢复效果转变为吸取对手最大体力的1/3；自身下1次受到的攻击伤害不超过280，并反弹给对手原本超出部分100%的百分比伤害；下2回合自身所有技能先制+2",
  },
];

describe("add one effect (r5a · 反弹原本超出部分N%)", () => {
  it("规则在 heal-232 之前，且只接这一种词形", () => {
    const ids = healRules.map((r: { id: string }) => r.id);
    const mine = ids.indexOf("r5a-excess-reflect-tail");
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(mine).toBeLessThan(ids.indexOf("heal-232")); // 更具体的那条必须排在宽规则之前
    const rule = healRules[mine] as { re: RegExp; go: (m: RegExpMatchArray) => unknown };
    const m = "反弹给对手原本超出部分60%的百分比伤害".match(rule.re)!;
    expect(m).not.toBeNull();
    expect(rule.go(m)).toEqual({ excessReflectPct: 60 });
    // 宽规则 heal-232 仍原样接住别的形状
    const catcher = healRules.find((r: { id: string }) => r.id === "heal-232") as { go: () => unknown };
    expect(catcher.go()).toEqual({ unparsedReason: "excess/reflect tail — deferred" });
  });

  it("五处宿主：P 记在承伤上限窗上（excessPct），尾巴不再留 unparsed", () => {
    for (const host of HOSTS) {
      const r = parseEffectText(host.text) as Parsed;
      expect(r.effects, host.pet).toContainEqual({
        op: "apply_status", name: "dmg_cap", target: "self",
        params: { cap: host.cap, count: host.count, excessPct: host.pct },
      });
      // 尾句没有回落到 reflect_dmg（那是「反弹被钳之后伤害的 P%」，cap=0 的宿主会恒为 0）
      expect(r.effects.some((e) => e.name === "reflect_dmg"), host.pet).toBe(false);
      expect(r.unparsed.filter((u) => /原本超出部分/.test(u.clause ?? "")), host.pet).toEqual([]);
    }
  });

  it("裸句（无承伤上限宿主）：留 unparsed，不许落成 reflect_dmg", () => {
    const bare = parseEffectText("反弹给对手原本超出部分100%的百分比伤害") as Parsed;
    expect(bare.effects).toEqual([]);
    expect(bare.unparsed).toEqual([
      { clause: "反弹给对手原本超出部分100%的百分比伤害", reason: "excess/reflect tail without dmg_cap host" },
    ]);
  });

  it("别的承伤上限句不带 excessPct（窗口照旧，只多一个可选键的缺省）", () => {
    const r = parseEffectText("自身下2次受到的攻击伤害不超过300") as Parsed;
    expect(r.effects).toEqual([{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: 300, count: 2 } }]);
    const cap = parseEffectText("受到的伤害不超过250") as Parsed;
    expect(cap.effects).toEqual([{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: 250 } }]);
  });

  it("旧句结果不变：其它反弹句各有自己的形状", () => {
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
    // 裸"并反弹给对手"仍走 heal-231 的 downPush 通道（无清除宿主 → unparsed），没被这条截走
    expect((parseEffectText("反弹给对手") as Parsed).unparsed).toEqual([
      { clause: "反弹给对手", reason: "down-push tail without cleanse" },
    ]);
    expect((parseEffectText("获得等同于溢出量的护罩") as Parsed).effects).toEqual([
      { op: "apply_status", name: "ward", target: "self", params: { fromOverflow: 1, kindMask: 3 } },
    ]);
  });
});
