/**
 * damage 上的旧键 frac 已不在 DAMAGE_KEYS（target-route 步骤 6）。
 * 现在分数走独立的 formula op：{ op:"formula", of:"frac", value:{n,m} }。
 *
 * 顶层规则（heal-06 / heal-09）已改发 formula，但被 reactWrap 包进 payload 的那些
 * 仍留着旧键 —— 全语料 53798 句里有 24 句因此产出越界键，装载期 damageKeyHits 报错，
 * peak 包 build 失败（mv-3577-2 光之惩戒）。
 *
 * 这里锁住：无论 frac 出现在顶层还是嵌套 payload 里，出口都不再留旧键。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { damageKeyHits } from "../../../packages/battle-core/src/ops/damage-keys.ts";

/** 递归收集所有 damage op 的位置。 */
function damageOps(list: any[], path = "effects", out: any[] = []): any[] {
  for (const [i, e] of (list ?? []).entries()) {
    if (e === null || typeof e !== "object") continue;
    if (e.op === "damage") out.push(e);
    for (const nest of ["payload", "ops", "elseOps"]) if (Array.isArray(e[nest])) damageOps(e[nest], `${path}[${i}].${nest}`, out);
  }
  return out;
}

describe("frac 不再出现在任何 damage op 上（含嵌套 payload）", () => {
  it("payload 里的「附加对手最大体力N/M的百分比伤害」不再带 frac", () => {
    const r = parseEffectText("3回合内每回合使用技能则80%令对手中毒，未触发则附加对手最大体力1/4的百分比伤害");
    expect(damageKeyHits(r.effects)).toEqual([]);
    for (const d of damageOps(r.effects)) expect(d.frac, JSON.stringify(d)).toBeUndefined();
  });

  it("payload 里转出的 formula 仍在同一 payload 内，且紧跟 damage", () => {
    const r = parseEffectText("3回合内自身受到攻击则使对手害怕，未触发则吸取对手1/3最大体力");
    expect(damageKeyHits(r.effects)).toEqual([]);
    const json = JSON.stringify(r.effects);
    expect(json).toContain('"of":"frac"');
    // formula 必须紧跟在同为 payload 的 damage 之后（分组器要求）
    const payloads = JSON.stringify(r.effects).match(/"payload":\[[^\]]*\]/g) ?? [];
    for (const p of payloads) {
      if (!p.includes('"op":"damage"')) continue;
      const idx = p.indexOf('"op":"damage"');
      expect(p.indexOf('"of":"frac"'), p).toBeGreaterThan(idx);
    }
  });

  it("reduce 类 payload 同样干净", () => {
    const r = parseEffectText("2回合内，若对手使用属性技能，则减少1/4最大HP");
    expect(damageKeyHits(r.effects)).toEqual([]);
  });

  it("吸取对手下只出场精灵最大体力的1/3 不再带 frac", () => {
    const r = parseEffectText("对手下2次主动切换或死亡切换精灵时，在场精灵吸取对手下只出场精灵最大体力的1/3");
    expect(damageKeyHits(r.effects)).toEqual([]);
  });
});
