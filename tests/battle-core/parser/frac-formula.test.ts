/**
 * damage 上的旧键 `frac` 已从 DAMAGE_KEYS 移除（target-route 步骤 6：家族收成 rider/op）。
 * 现在分数走独立的 formula op：`{ op:"formula", of:"frac", value:{numerator,denominator} }`。
 *
 * 但 heal-06 / heal-09 仍在发 `frac`，装载时 damageKeyHits 报 “damage key outside the list”，
 * peak 包因此跑不通 build-peak-roster（mv-3577-2 光之惩戒）。
 *
 * 全语料 53798 句里越界的 damage 键只有 frac 一种，因此这是最后一处。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { damageKeyHits } from "../../../packages/battle-core/src/ops/damage-keys.ts";

describe("分数伤害走 formula op，而不是 damage.frac", () => {
  it("吸取对手最大体力的1/3：damage 不带 frac，另出 formula", () => {
    const r = parseEffectText("吸取对手最大体力的1/3");
    expect(r.effects).toEqual([
      { op: "damage", power: 1, kind: "percent" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
      { op: "heal", numerator: 1, denominator: 3, target: "self" },
    ]);
    expect(damageKeyHits(r.effects)).toEqual([]);
  });

  it("附加对手当前体力的1/4的百分比伤害：同样不带 frac", () => {
    const r = parseEffectText("附加对手当前体力的1/4的百分比伤害");
    expect(damageKeyHits(r.effects)).toEqual([]);
    const frac = r.effects.find((e) => e.op === "formula" && e.of === "frac");
    expect(frac).toMatchObject({ value: { numerator: 1, denominator: 4 } });
  });

  it("整句（光之惩戒 的尾段）不再产出越界键", () => {
    const r = parseEffectText(
      "必中；4回合内免疫并反弹异常状态；3回合内每回合100%几率使对手失明，未触发则回合结束时减少对手最大体力的1/3；3回合内自身受到攻击则使对手疲惫，未触发则吸取对手最大体力的1/3",
    );
    expect(damageKeyHits(r.effects)).toEqual([]);
  });
});
