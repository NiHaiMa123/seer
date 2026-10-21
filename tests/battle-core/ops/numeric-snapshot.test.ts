import { describe, expect, it } from "vitest";
import { canonicalJson } from "@seer/contracts";
import { internalValidators } from "@seer/contracts/internal";
import { applyTurn, compilePack, initBattle, type CompiledEffect, type CoreState, type NumericValue } from "@seer/battle-core";
import { DeterministicRng } from "@seer/battle-core";
import { applyStatusOp } from "../../../packages/battle-core/src/ops/apply-effect.ts";
import { dmgFlatOf, dmgOutPctOf, dmgReduceFlatOf } from "../../../packages/battle-core/src/ops/effects.ts";
import { validateEffects } from "../../../packages/battle-core/src/ops/validate.ts";
import type { OpCtx } from "../../../packages/battle-core/src/ops/types.ts";
import packJson from "../../../content/synthetic-v1/pack.json" with { type: "json" };
import rulesetJson from "../../../content/rulesets/synthetic-v1.json" with { type: "json" };
import unitsJson from "../../../content/synthetic-v1/units.json" with { type: "json" };
import movesJson from "../../../content/synthetic-v1/moves.json" with { type: "json" };

const hpTenth: NumericValue = { divide: { value: { stat: "hp" }, by: 10 } };
const valueRules = {
  ...rulesetJson,
  features: ["control"],
  operatorAllowlist: [...rulesetJson.operatorAllowlist, "apply_status", "hp_delta"],
};

function packFor(effects: Record<string, CompiledEffect[]>) {
  const moves = structuredClone(movesJson) as { moves: { id: string; effects: CompiledEffect[] }[] };
  for (const m of moves.moves) if (effects[m.id] !== undefined) m.effects = effects[m.id]!;
  return compilePack({ pack: packJson, units: unitsJson, moves, ruleset: valueRules });
}

const action = (id: string) => ({
  actionId: `act_${id}`,
  origin: "player" as const,
  idempotencyKey: "snapshot-test",
});

const initial = (pack: ReturnType<typeof packFor>) => initBattle(pack, {
  battleId: "btl_numeric-snapshot",
  seedHex: "01".repeat(16),
  p1: "syn-alpha",
  p2: "syn-beta",
});

function turn(pack: ReturnType<typeof packFor>, state: CoreState, p1: string, p2: string) {
  const result = applyTurn(pack, state, { p1: action(p1), p2: action(p2) });
  if (!result.ok) throw result.fault;
  return result;
}

const modifiers = (name: string, amountTiming?: "apply", amountExpr: NumericValue = hpTenth): Record<string, CompiledEffect[]> => ({
  "syn-bolster": [{ op: "apply_status", name, target: "self", turns: 4, amountExpr, ...(amountTiming !== undefined ? { amountTiming } : {}) }],
  "syn-recover": [],
});

const effectAt = (state: CoreState, side: "p1" | "p2", at: string) =>
  state.sides[side].unit.effects.find((effect) => effect.at === at);

describe("apply_status amountTiming snapshot contract", () => {
  it.each([
    { name: "dmg_boost", at: "dmgOutPct", read: dmgOutPctOf },
    { name: "dmg_reduce", at: "dmgReduceFlat", read: dmgReduceFlatOf },
    { name: "dmg_flat", at: "dmgFlat", read: (u: Parameters<typeof dmgFlatOf>[0], foe: Parameters<typeof dmgFlatOf>[1]) => dmgFlatOf(u, foe) },
  ])("$name defaults to dynamic reads and freezes at application", ({ name, at, read }) => {
    const dynamicPack = packFor(modifiers(name));
    const frozenPack = packFor(modifiers(name, "apply"));
    const dynamic = turn(dynamicPack, initial(dynamicPack), "syn-bolster", "syn-recover").state;
    const frozen = turn(frozenPack, initial(frozenPack), "syn-bolster", "syn-recover").state;

    expect(effectAt(dynamic, "p1", at)?.amountExpr).toEqual(hpTenth);
    expect(effectAt(frozen, "p1", at)?.amountExpr).toBe(12);
    expect(effectAt(frozen, "p1", at)).not.toHaveProperty("amountTiming");

    dynamic.sides.p1.unit.base.hp = 200;
    frozen.sides.p1.unit.base.hp = 200;
    expect(read(dynamic.sides.p1.unit, dynamic.sides.p2.unit)).toBe(20);
    expect(read(frozen.sides.p1.unit, frozen.sides.p2.unit)).toBe(12);
  });

  it.each([
    { name: "dmg_boost", targetAction: "syn-strike", receivingSide: "p2" as const, frozenMore: false },
    { name: "dmg_flat", targetAction: "syn-strike", receivingSide: "p2" as const, frozenMore: false },
    { name: "dmg_reduce", targetAction: "syn-recover", receivingSide: "p1" as const, frozenMore: true },
  ])("$name snapshot changes real damage in the correct direction", ({ name, targetAction, receivingSide, frozenMore }) => {
    const run = (timing?: "apply") => {
      const pack = packFor(modifiers(name, timing));
      const applied = turn(pack, initial(pack), "syn-bolster", "syn-recover").state;
      applied.sides.p1.unit.base.hp = 200;
      const result = turn(pack, applied, targetAction, name === "dmg_reduce" ? "syn-strike" : "syn-recover");
      const event = result.events.find((e) => e.type === "damage" && e.detail.side === receivingSide);
      expect(event).toBeDefined();
      const amount = event!.detail.amount;
      if (typeof amount !== "number") throw new Error("damage event amount is not numeric");
      return amount;
    };
    const dynamicDamage = run();
    const frozenDamage = run("apply");
    if (frozenMore) expect(frozenDamage).toBeGreaterThan(dynamicDamage);
    else expect(frozenDamage).toBeLessThan(dynamicDamage);
  });

  it("evaluates self and foe from the final holder when target is opponent", () => {
    const expr: NumericValue = { sum: [{ stat: "atk" }, { product: [{ stat: "atk", of: "foe" }, 2] }] };
    const pack = packFor({
      "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "opponent", turns: 3, amountTiming: "apply", amountExpr: expr }],
      "syn-recover": [],
    });
    const state = turn(pack, initial(pack), "syn-bolster", "syn-recover").state;
    expect(effectAt(state, "p2", "dmgOutPct")?.amountExpr).toBe(115); // holder atk 35 + actor atk 40 × 2
    expect(effectAt(state, "p1", "dmgOutPct")).toBeUndefined();
  });

  it("freezes legacy statDiff, accepts zero, refreshes on reapplication, and survives JSON reload", () => {
    const legacy = packFor({
      "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 4, amountTiming: "apply", statDiff: "def" }],
      "syn-recover": [],
    });
    let state = turn(legacy, initial(legacy), "syn-bolster", "syn-recover").state;
    const frozen = effectAt(state, "p1", "dmgOutPct")!;
    expect(frozen.amountExpr).toBe(5);
    state.sides.p2.unit.base.def = 75;
    expect(dmgOutPctOf(state.sides.p1.unit, state.sides.p2.unit)).toBe(5);

    const zeroPack = packFor({
      "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 4, amountTiming: "apply", amountExpr: 0 }],
      "syn-recover": [],
    });
    const zeroState = turn(zeroPack, initial(zeroPack), "syn-bolster", "syn-recover").state;
    expect(effectAt(zeroState, "p1", "dmgOutPct")?.amountExpr).toBe(0);

    const refreshPack = packFor(modifiers("dmg_boost", "apply"));
    state = turn(refreshPack, initial(refreshPack), "syn-bolster", "syn-recover").state;
    expect(effectAt(state, "p1", "dmgOutPct")?.amountExpr).toBe(12);
    state.sides.p1.unit.base.hp = 200;
    state = turn(refreshPack, state, "syn-bolster", "syn-recover").state;
    expect(effectAt(state, "p1", "dmgOutPct")?.amountExpr).toBe(20);

    const restored = JSON.parse(canonicalJson(state)) as CoreState;
    expect(effectAt(restored, "p1", "dmgOutPct")?.amountExpr).toBe(20);
    expect(effectAt(restored, "p1", "dmgOutPct")).not.toHaveProperty("amountTiming");
    const fullState = {
      ...restored,
      decision: null,
      inbox: { p1: null, p2: null },
      eventSeq: 0,
      publicCursors: { p1: 0, p2: 0 },
    };
    const valid = internalValidators.state(fullState);
    expect(valid, JSON.stringify(internalValidators.state.errors)).toBe(true);
  });

  it("rejects unsupported timing, axes, and missing values even without rules allowlists", () => {
    const reject = (effect: unknown) => validateEffects([effect as CompiledEffect], {}, (message) => { throw new Error(message); });
    expect(() => reject({ op: "damage", power: 10, amountTiming: "apply" })).toThrow(/cannot use amountTiming/);
    expect(() => reject({ op: "apply_status", name: "burn", target: "self", amountTiming: "apply", amountExpr: 10 })).toThrow(/numeric modifier reader/);
    expect(() => reject({ op: "apply_status", name: "dmg_boost", target: "self", amountTiming: "apply" })).toThrow(/requires amountExpr or a legacy value source/);
    expect(() => reject({ op: "apply_status", name: "dmg_boost", target: "self", amountTiming: "turns", amountExpr: 10 })).toThrow(/unsupported amountTiming/);

    expect(() => packFor({ "syn-recover": [{ op: "heal", target: "self", flat: 1, amountTiming: "apply" } as never] })).toThrow();
    expect(() => packFor({ "syn-bolster": [{ op: "apply_status", name: "shield", target: "self", turns: 2, amountTiming: "apply", amountExpr: 1 }] })).toThrow();
    expect(() => packFor({ "syn-bolster": [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 2, amountTiming: "apply", params: { pct: 10 } }] })).toThrow();

    const pack = packFor({ "syn-bolster": [], "syn-recover": [] });
    const state = initial(pack);
    const unit = state.sides.p1.unit;
    const ctx: OpCtx = {
      pack,
      next: state,
      events: [],
      side: "p1",
      unit,
      move: pack.movesById.get("syn-bolster")!,
      foe: state.sides.p2.unit,
      targetSide: "p1",
      target: unit,
      rng: new DeterministicRng("02".repeat(16)),
      order: "first",
    };
    expect(() => applyStatusOp(ctx, { op: "apply_status", name: "burn", target: "self", amountTiming: "apply", amountExpr: 10 } as never)).toThrow(/numeric modifier value/);
    expect(() => applyStatusOp(ctx, { op: "apply_status", name: "dmg_boost", target: "self", amountTiming: "apply" } as never)).toThrow(/numeric modifier value/);
  });
});
