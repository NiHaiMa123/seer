/**
 * 逐只处理：pet-3686 妖族元皇·兰蒂斯（魂印「自身特攻必定命中且造成伤害50%恢复自身体力」）。
 *
 * 缺口有两层：
 *  1. 族规则 e19-mh-01 的类别词表只有（特殊|物理|属性|攻击），没有「特攻/物攻」，
 *     所以「自身特攻必定命中」整句 no-rule。
 *  2. 「同组里既有常驻状态又有吸血」这种组合，魂印层的裸 drain 折算门槛
 *     （probe.effects.length === 0）挡住了 drain_atk 的落地 —— 判据应是
 *     「本组没有伤害宿主」（吸血 rider 挂的是伤害），不是「本组只剩它一条」。
 *
 * 改法：
 *  - tools/effects-rules/batch-e19.mjs e19-mh-01：类别词表补 特攻(→cat 3) / 物攻(→cat 2)。
 *  - tools/soulmark-parse.mjs：裸 drain 折算的判据从「本组只剩它一条」改成「本组没有伤害宿主」，
 *    折算时保留同组的其他常驻效果（不再整组替换）。
 * 没有新 op、没有新状态名、没有新 params 键、没有新的结算分支。
 *
 * 本文件同时锁住相邻旧句子，证明新规则没有把它们截走。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const effectsOf = (s: string) => (parseEffectText(s) as { effects: unknown[]; unparsed: unknown[] });

describe("逐只处理 pet-3686 兰蒂斯：「自身特攻必定命中」+ 吸血组合", () => {
  it("新句：特攻必定命中 → sure_hit cat 3（特殊招式必中）", () => {
    const r = effectsOf("自身特攻必定命中");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "sure_hit", target: "self", params: { cat: 3 } },
    ]);
  });

  it("新句：物攻必定命中 → sure_hit cat 2（物理招式必中）", () => {
    const r = effectsOf("物攻必定命中");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "sure_hit", target: "self", params: { cat: 2 } },
    ]);
  });

  it("旧句不回归：特殊/物理/属性三种旧写法的 cat 编码不变", () => {
    const cases: [string, number][] = [
      ["自身特殊攻击必定命中", 3],
      ["自身物理攻击必定命中", 2],
      ["自身属性技能必定命中", 1],
    ];
    for (const [s, cat] of cases) {
      const r = effectsOf(s);
      expect(r.unparsed).toEqual([]);
      expect(r.effects).toEqual([
        { op: "apply_status", name: "sure_hit", target: "self", params: { cat } },
      ]);
    }
  });

  it("旧句不回归：「自身攻击技能必定命中」仍走既有的 accuracy 旗标路径", () => {
    // 这句本来就由 timed-bare-28 认领成命中旗标（accuracy:"always"），
    // 不由 sure_hit 认领——本轮不动它，只锁住现状。
    const r = parseEffectText("自身攻击技能必定命中") as {
      effects: unknown[];
      flags: Record<string, unknown>;
      unparsed: unknown[];
    };
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([]);
    expect(r.flags.accuracy).toBe("always");
  });

  it("魂印层：常驻必中与吸血两条都要留下，不互相挤掉", () => {
    const r = parseSoulmarkText("自身特攻必定命中且造成伤害50%恢复自身体力", "兰蒂斯");
    expect(r.unparsed).toEqual([]);
    const flat = r.entries.map((e) => e.ops);
    expect(flat).toContainEqual([
      { op: "apply_status", name: "sure_hit", target: "self", params: { cat: 3 } },
    ]);
    expect(flat).toContainEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 50, d: 100 } },
    ]);
  });

  it("旧句不回归：裸吸血句仍只落一条 drain_atk", () => {
    const r = parseSoulmarkText("造成伤害50%恢复自身体力", "兰蒂斯");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      {
        hook: "onBattleStart",
        ops: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 50, d: 100 } }],
      },
    ]);
  });
});
