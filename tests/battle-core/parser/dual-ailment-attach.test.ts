/**
 * 「为双方附加 N 回合 AIL」——双侧异常窗的第三种写法。
 *
 * 已有 p2-al-03 / p2-al-04 认「(令|使)双方<异常>」和「双方<异常>」；实测语料里
 * 还有一种「为双方附加N回合混乱」（克律莎/远古雷律，且常带前导「并」——
 * "消除双方回合类效果并为双方附加2回合混乱"），落不到现有规则上。
 *
 * 顺带锁一个纯机械问题：从句首带「并」时不应整句失配。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const DUAL = [
  { op: "apply_status", name: "confuse", target: "self", turns: 2 },
  { op: "apply_status", name: "confuse", target: "opponent", turns: 2 },
];

describe("为双方附加 N 回合异常", () => {
  it("裸句产出双侧异常", () => {
    const r = parseEffectText("为双方附加2回合混乱");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(DUAL);
  });

  it("带前导「并」同样识别", () => {
    const r = parseEffectText("并为双方附加2回合混乱");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual(DUAL);
  });

  it("真实整句：克律莎 远古雷律", () => {
    const text =
      "先制+3；消除双方回合类效果并为双方附加2回合混乱，自身混乱状态解除后则恢复自身全部体力；未击败对手则70%令对手麻痹";
    const r = parseEffectText(text, { hasDamage: true });
    expect(r.unparsed).toEqual([]);
    // 双侧混乱都在
    expect(r.effects.filter((e) => e.op === "apply_status" && e.name === "confuse")).toHaveLength(2);
    // 其它子句不受影响
    expect(r.effects.some((e) => e.op === "cleanse")).toBe(true);
    expect(r.effects.some((e) => e.op === "apply_status" && e.name === "paralysis")).toBe(true);
  });

  it("现有写法不回归", () => {
    expect(parseEffectText("令双方混乱2回合").effects).toEqual(DUAL);
    expect(parseEffectText("双方混乱").effects).toEqual([
      { op: "apply_status", name: "confuse", target: "self" },
      { op: "apply_status", name: "confuse", target: "opponent" },
    ]);
  });
});
