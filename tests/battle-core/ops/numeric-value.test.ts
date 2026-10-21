import { describe, expect, it } from "vitest";
import { canonicalJson } from "@seer/contracts";
import { internalValidators } from "@seer/contracts/internal";
import { applyTurn, compilePack, initBattle, type CompiledEffect, type CoreState, type NumericValue } from "@seer/battle-core";
import { dmgOutPctOf, dmgFlatOf, dmgReduceFlatOf, numericValueOf } from "../../../packages/battle-core/src/ops/effects.ts";
import packJson from "../../../content/synthetic-v1/pack.json" with { type: "json" };
import rulesetJson from "../../../content/rulesets/synthetic-v1.json" with { type: "json" };
import unitsJson from "../../../content/synthetic-v1/units.json" with { type: "json" };
import movesJson from "../../../content/synthetic-v1/moves.json" with { type: "json" };

function packFor(effects: Record<string, CompiledEffect[]>) {
  const moves = structuredClone(movesJson) as { moves: { id: string; effects: CompiledEffect[] }[] };
  for (const m of moves.moves) if (effects[m.id] !== undefined) m.effects = effects[m.id]!;
  return compilePack({
    pack: packJson, units: unitsJson, moves,
    ruleset: { ...rulesetJson, features: ["control"], operatorAllowlist: [...rulesetJson.operatorAllowlist, "apply_status", "hp_delta"] },
  });
}
const action = (id: string) => ({ actionId: `act_${id}`, origin: "player" as const, idempotencyKey: "value-test" });
const initial = (pack: ReturnType<typeof packFor>) => initBattle(pack, { battleId: "btl_values", seedHex: "01".repeat(16), p1: "syn-alpha", p2: "syn-beta" });
function turn(pack: ReturnType<typeof packFor>, state: CoreState, p1: string, p2: string) {
  const result = applyTurn(pack, state, { p1: action(p1), p2: action(p2) });
  if (!result.ok) throw result.fault;
  return result;
}
const percentOfSum: NumericValue = { divide: { value: { product: [{ sum: [{ stat: "atk" }, { stat: "def" }] }, 40] }, by: 100 } };
const countBonus: NumericValue = { product: [{ count: "ailments", of: "foe" }, 10] };

describe("组合数值：内容到结算", () => {
  it("只写数据即可用属性和百分比回复，属性差倍数扣血", () => {
    const pack = packFor({
      "syn-recover": [{ op: "heal", target: "self", amountExpr: percentOfSum }],
      "syn-strike": [{ op: "hp_delta", target: "opponent", amountExpr: { product: [{ difference: [{ stat: "def" }, { stat: "def", of: "foe" }] }, 2] } }],
    });
    const state = initial(pack);
    state.sides.p1.unit.currentHp = 80;
    const healed = turn(pack, state, "syn-recover", "syn-bolster");
    expect(healed.state.sides.p1.unit.currentHp).toBe(108);
    const hurt = turn(pack, healed.state, "syn-strike", "syn-bolster");
    expect(hurt.events.find((e) => e.type === "damage")?.detail.amount).toBe(10);
  });

  it.each([
    { amountExpr: countBonus },
    { perAilment: { who: "foe" as const, per: 1, pct: 10 } },
  ])("动态状态经过施加、JSON 恢复和实际出伤仍生效：%j", (value) => {
    const pack = packFor({
      "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 4, ...value }],
      "syn-recover": [
        { op: "apply_status", name: "burn", target: "self", turns: 4 },
        { op: "apply_status", name: "poison", target: "self", turns: 4 },
      ],
      "syn-jab": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 4, params: { pct: 10 } }],
    });
    const mounted = turn(pack, initial(pack), "syn-bolster", "syn-recover");
    const restored = JSON.parse(canonicalJson(mounted.state)) as CoreState;
    expect(internalValidators.state({ ...restored, decision: null, inbox: { p1: null, p2: null }, eventSeq: 0, publicCursors: { p1: 0, p2: 0 } })).toBe(true);
    const unit = restored.sides.p1.unit, foe = restored.sides.p2.unit;
    expect(unit.effects.find((e) => e.at === "dmgOutPct")?.amountExpr).toBeDefined();
    expect(dmgOutPctOf(unit, foe)).toBe(20);
    const hit = turn(pack, restored, "syn-strike", "syn-jab");
    expect(hit.events.find((e) => e.type === "damage" && e.detail.side === "p2")?.detail.amount).toBe(26);
    foe.effects = foe.effects.filter((e) => e.kind !== "burn");
    expect(dmgOutPctOf(unit, foe)).toBe(10);
    const replaced = turn(pack, restored, "syn-jab", "syn-jab");
    expect(replaced.state.sides.p1.unit.effects.find((e) => e.at === "dmgOutPct")?.amountExpr).toBeUndefined();
    expect(dmgOutPctOf(replaced.state.sides.p1.unit, replaced.state.sides.p2.unit)).toBe(10);
  });

  it("旧 statDiff 状态也保存为同一种表达式，后续面板变化重新读取", () => {
    const pack = packFor({ "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 3, statDiff: "def" }] });
    const mounted = turn(pack, initial(pack), "syn-bolster", "syn-recover");
    const restored = JSON.parse(canonicalJson(mounted.state)) as CoreState;
    expect(dmgOutPctOf(restored.sides.p1.unit, restored.sides.p2.unit)).toBe(5);
    restored.sides.p2.unit.base.def = 55;
    expect(dmgOutPctOf(restored.sides.p1.unit, restored.sides.p2.unit)).toBe(25);
  });

  it.each(["dmg_reduce", "dmg_flat"])("同一个数值组合可用于 %s，无需增加字段", (name) => {
    const pack = packFor({ "syn-bolster": [{ op: "apply_status", name, target: "self", turns: 3, amountExpr: percentOfSum }] });
    const state = turn(pack, initial(pack), "syn-bolster", "syn-recover").state;
    const reader = name === "dmg_flat" ? dmgFlatOf : dmgReduceFlatOf;
    expect(reader(state.sides.p1.unit, state.sides.p2.unit)).toBe(28);
  });

  it("负的回复幅值不会把 heal 变成伤害", () => {
    const pack = packFor({ "syn-recover": [{ op: "heal", target: "self", amountExpr: -10 }] });
    const state = initial(pack);
    state.sides.p1.unit.currentHp = 80;
    expect(turn(pack, state, "syn-recover", "syn-bolster").state.sides.p1.unit.currentHp).toBe(80);
  });

  it.each([
    { divide: { value: 20, by: 0 } },
    { stat: "secret" },
    { count: "unknown" },
    { difference: [1] },
    { sum: [1], extra: true },
  ])("schema 拒绝无效表达式 %j", (amountExpr) => {
    expect(() => packFor({ "syn-recover": [{ op: "heal", target: "self", amountExpr } as never] })).toThrow();
  });

  it("没有读取点的状态不得挂表达式", () => {
    expect(() => packFor({ "syn-bolster": [{ op: "apply_status", name: "shield", target: "self", amountExpr: 10 }] })).toThrow();
  });

  it("组合明确取整顺序、上下限，求值不修改单位或消耗 RNG", () => {
    const state = initial(packFor({})), u = state.sides.p1.unit;
    const before = canonicalJson(state);
    expect(numericValueOf({ min: [100, { max: [20, { divide: { value: { product: [31, 3] }, by: 2 } }] }] }, u)).toBe(46);
    expect(numericValueOf({ product: [{ divide: { value: 31, by: 2 } }, 3] }, u)).toBe(45);
    expect(canonicalJson(state)).toBe(before);
  });

  it("深度和整数溢出有明确故障，避免无限嵌套", () => {
    const u = initial(packFor({})).sides.p1.unit;
    let expression: NumericValue = 1;
    for (let i = 0; i < 34; i++) expression = { sum: [expression] };
    expect(() => numericValueOf(expression, u)).toThrow(/depth/);
    expect(() => numericValueOf({ product: [Number.MAX_SAFE_INTEGER, 2] }, u)).toThrow(/safe integer/);
    expect(() => numericValueOf({ product: [Number.MAX_SAFE_INTEGER, 2, 0] }, u)).toThrow(/safe integer/);
  });
});
