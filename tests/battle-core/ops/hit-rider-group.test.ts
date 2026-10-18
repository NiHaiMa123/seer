/**
 * 连续命中 rider 的分组回归锁。
 *
 * 一次命中可以带多个 rider（固伤 + 吸血 + 倍率…）。groupHitRiders 的循环只看
 * `rec.op === "damage"` 来认宿主，其它 rider op 都落到 `host = undefined`，
 * 于是「damage → flat → applyDrainRider」的第二个 rider 被判成孤儿：
 *   move mv-2521-s10 applyDrainRider 没有紧跟在 damage 后面
 * 整个 peak 包因此拒载（369 条招式的 rider 前一个是 flat/scale/strike/power）。
 *
 * 正确语义：宿主是最近的那条 damage，中间夹着别的 rider 不影响归属。
 */
import { describe, it, expect } from "vitest";
import { groupHitRiders } from "../../../packages/battle-core/src/ops/hit-rider.ts";

describe("连续 rider 分组", () => {
  it("damage → flat → applyDrainRider：两个 rider 都归同一条 damage", () => {
    const list: unknown[] = [
      { op: "damage", power: 150 },
      { op: "flat", of: "flatSelfPct", value: 25 },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 } },
    ];
    expect(groupHitRiders(list)).toBeUndefined();
    // rider 被收走，只剩宿主 damage
    expect(list).toEqual([{ op: "damage", power: 150 }]);
  });

  it("damage → scale → applyDrainRider", () => {
    const list: unknown[] = [
      { op: "damage", power: 150 },
      { op: "scale", of: "mulIf", value: { numerator: 2, denominator: 1 } },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 } },
    ];
    expect(groupHitRiders(list)).toBeUndefined();
    expect(list).toEqual([{ op: "damage", power: 150 }]);
  });

  it("三个 rider 连排", () => {
    const list: unknown[] = [
      { op: "damage", power: 160 },
      { op: "flat", of: "flatSelfFrac", value: { numerator: 1, denominator: 3 } },
      { op: "strike", of: "hits", value: { min: 2, max: 3 } },
      { op: "applyDrainRider", drainMul: { numerator: 2, denominator: 1 } },
    ];
    expect(groupHitRiders(list)).toBeUndefined();
    expect(list).toEqual([{ op: "damage", power: 160 }]);
  });

  it("真正的孤儿 rider（前面没有 damage）仍报错", () => {
    const list: unknown[] = [{ op: "applyDrainRider", drain: { numerator: 1, denominator: 3 } }];
    expect(groupHitRiders(list)).toMatch(/没有紧跟/);
  });

  it("非 rider 的 op 会切断归属", () => {
    const list: unknown[] = [
      { op: "damage", power: 100 },
      { op: "heal", flat: 50, target: "self" },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 } },
    ];
    expect(groupHitRiders(list)).toMatch(/没有紧跟/);
  });
});
