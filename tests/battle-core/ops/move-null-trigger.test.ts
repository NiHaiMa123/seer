/**
 * 「下N次技能无效时令对手X」——新增 trigger 19（招式被失效）。
 *
 * 语料 2 处：
 *   决囚钢骨/十里枯监：下1次技能无效时令对手瘫痪，若为攻击技能则造成的伤害不少于200
 *   炎龙铠甲/降魔印：  下2次技能无效时令对手烧伤，若为攻击技能则造成的伤害不少于400
 *
 * 现有 trigger 编码（1受击/2对手MISS/3对手行动/4破盾/5倒下/6自身MISS/7强化被消/
 * 8回合未受击/9对手换入/10造成伤害/11每回合用招/12造成伤害(类别)/13弱化被消/
 * 14治疗/16异常被解/17强化被消(自身)/18未知）都没有"招式被失效"，所以新增 15。
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir, initBattle, applyTurn } from "@seer/battle-core";
import { join } from "node:path";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");
const SEED = "11".repeat(16);
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const evs = (r: any, type: string) => (r.ok ? (r.events ?? []).filter((e: any) => e.type === type) : []);

/** move_null 是 modifier/nullifies（见 effects.ts 的 axes 表），不是独立 kind。 */
const moveNull = (count: number) => ({
  kind: "modifier", at: "nullifies", effectInstanceId: "efx_p1_null", params: { count }, appliedTurn: 1,
});

const react15 = (count: number) => ({
  kind: "react", effectInstanceId: "efx_p1_react15",
  params: { trigger: 19, count },
  payload: [{ op: "apply_status", name: "paralysis", target: "opponent", turns: 2 }],
  appliedTurn: 1,
});

describe("trigger 19：招式被失效时派发", () => {
  it("持有者招式被 move_null 拦下 → 派发 payload", () => {
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    s.sides.p1.unit.effects.push(moveNull(1) as never);
    s.sides.p1.unit.effects.push(react15(1) as never);

    const r1 = applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") });
    expect(r1.ok).toBe(true);
    expect(evs(r1, "action-failed").some((e: any) => e.detail.reason === "move-nullified")).toBe(true);
    expect(evs(r1, "effect-applied").some((e: any) => e.detail.side === "p2" && /paralysis/.test(String(e.detail.name)))).toBe(true);
  });

  it("次数为 1：派发一次后不再派发", () => {
    const s = initBattle(PACK, { battleId: "b2", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    s.sides.p1.unit.effects.push(moveNull(2) as never);
    s.sides.p1.unit.effects.push(react15(1) as never);
    const r1 = applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyTurn(PACK, r1.state, { p1: act("act_syn-jab"), p2: act("act_syn-jab") });
    if (r2.ok) {
      const applied = evs(r2, "effect-applied").filter((e: any) => /paralysis/.test(String(e.detail.name)));
      expect(applied).toEqual([]);
    }
  });
});

describe("解析：下N次技能无效时令对手X", () => {
  it("产出 trigger 19 的 reaction 窗", () => {
    const r = parseEffectText("下1次技能无效时令对手瘫痪");
    expect(r.unparsed).toEqual([]);
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/"trigger":19/);
    // 瘫痪的正确 registry 名是 shock（paralysis 是麻痹，两者不同）
    expect(s).toMatch(/shock/);
    expect(s).toMatch(/"count":1/);
  });

  it("下2次 + 烧伤", () => {
    const r = parseEffectText("下2次技能无效时令对手烧伤");
    expect(r.unparsed).toEqual([]);
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/"trigger":19/);
    expect(s).toMatch(/burn/);
    expect(s).toMatch(/"count":2/);
  });

  it("真实整句：决囚钢骨 十里枯监", () => {
    const full =
      "必中；4回合内免疫并反弹所有受到的异常状态；下1次技能无效时令对手瘫痪，若为攻击技能则造成的伤害不少于200；免疫下1次对手的攻击";
    const r = parseEffectText(full, { hasDamage: true });
    expect(r.unparsed.map((u) => String(u.clause))).not.toContain("下1次技能无效时令对手瘫痪");
  });
});