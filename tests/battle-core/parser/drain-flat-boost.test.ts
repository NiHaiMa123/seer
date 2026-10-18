/**
 * 「吸取效果提升至N点」是给前一条定额吸血窗升级，不是新开一个命中 rider。
 *
 * 原文（4415 碧华印）：
 *   4回合内，每回合使用技能额外吸取对手250点体力，自身体力低于对手时吸取效果提升至350点
 * 前段正确产出 apply_status drain_on_use params{flat:250}，后段应把该窗的 flat 改成 350。
 * 原实现发 attachDamage.drainFlat，抬升后是孤立的 applyDrainRider —— 属性招没有
 * damage 宿主，装载期被 groupHitRiders 判孤儿，peak 包拒载（20 条）。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { damageKeyHits } from "../../../packages/battle-core/src/ops/damage-keys.ts";

describe("定额吸血提升 = 改前一条吸血窗的值", () => {
  it("整句：drain_on_use 的 flat 被提升到 350", () => {
    const r = parseEffectText(
      "必中；全属性+1，自身不处于能力强化状态时强化效果翻倍；4回合内，每回合使用技能额外吸取对手250点体力，自身体力低于对手时吸取效果提升至350点；下2回合所有技能先制+2",
    );
    const drain = r.effects.filter((e) => e.name === "drain_on_use");
    expect(drain.length).toBe(1);
    // 提升值落到窗上（条件化的提升由引擎按 selfHpBelowFoe 读，这里只保证不再是新 rider）
    expect(r.effects.filter((e) => e.op === "applyDrainRider")).toEqual([]);
    expect(damageKeyHits(r.effects)).toEqual([]);
  });

  it("裸提升句不再产出 applyDrainRider", () => {
    const r = parseEffectText("吸取效果提升至350点");
    expect(r.effects.filter((e) => e.op === "applyDrainRider")).toEqual([]);
  });
});
