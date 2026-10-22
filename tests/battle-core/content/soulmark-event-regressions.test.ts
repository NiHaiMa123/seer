import { describe, expect, it } from "vitest";
import { applyTurn, initBattle, loadPackFromDir, type CoreState, type FrozenPack } from "@seer/battle-core";

const PACK = loadPackFromDir("content", "peak");
const action = (id: string, key = id) => ({ actionId: `act_${id}`, origin: "player" as const, idempotencyKey: `regression-${key}` });
const ok = (result: ReturnType<typeof applyTurn>) => {
  if (!result.ok) throw new Error(result.fault.message);
  return result;
};
function battle(p1: string, pack = PACK): CoreState {
  const state = initBattle(pack, { battleId: `regression-${p1}`, seedHex: "01".repeat(16), p1, p2: "pet-5000" });
  const unit = state.sides.p1.unit, foe = state.sides.p2.unit;
  unit.base.hp = 900; unit.currentHp = 900; unit.base.spd = 2000;
  foe.base.hp = 5000; foe.currentHp = 5000; foe.base.spd = 1;
  for (const move of foe.moves) move.pp = 0;
  return state;
}
function turn(state: CoreState, move: string, pack = PACK) {
  return ok(applyTurn(pack, state, { p1: action(move), p2: action(state.sides.p2.unit.moves[0]!.moveId) }));
}

describe("真实内容的魂印与属性技能时序", () => {
  it("亚尔娜的附加伤害不会再触发自身魂印，900体力的1/3恰为300", () => {
    const moves = new Map(PACK.movesById);
    const state = battle("pet-3457");
    const mid = state.sides.p1.unit.moves[0]!.moveId;
    moves.set(mid, { ...moves.get(mid)!, effects: [{ op: "damage", kind: "fixed", power: 10 }] });
    const pack: FrozenPack = { ...PACK, movesById: moves };
    const first = turn(state, mid, pack);
    expect(first.events.filter((e) => e.type === "damage").map((e) => e.detail.amount)).toEqual([10, 300]);
    expect(first.events.filter((e) => e.type === "soulmark" && e.detail.mark === "sm-3457")).toHaveLength(1);
    expect(first.state.rng.drawCounter).toBe(1);
    const second = turn(JSON.parse(JSON.stringify(first.state)) as CoreState, mid, pack);
    expect(second.events.filter((e) => e.type === "soulmark" && e.detail.mark === "sm-3457")).toHaveLength(1);
    expect(second.state.rng.drawCounter).toBe(2);
  });

  it("连击的每个独立主伤害仍各触发一次魂印", () => {
    const moves = new Map(PACK.movesById);
    const state = battle("pet-3457");
    const mid = state.sides.p1.unit.moves[0]!.moveId;
    moves.set(mid, { ...moves.get(mid)!, effects: [
      { op: "damage", kind: "fixed", power: 10 },
      { op: "strike", of: "hits", value: { min: 3, max: 3 } },
    ] });
    const result = turn(state, mid, { ...PACK, movesById: moves });
    expect(result.events.filter((e) => e.type === "damage" && e.detail.amount === 10)).toHaveLength(3);
    expect(result.events.filter((e) => e.type === "soulmark" && e.detail.mark === "sm-3457")).toHaveLength(3);
  });

  it("混沌界王在技能强化完成后转移能力，不执行失败分支", () => {
    const result = turn(battle("pet-3006"), "mv-3006-s14");
    for (const stat of ["atk", "def", "spa", "sdf", "spd"] as const) {
      expect(result.state.sides.p1.unit.stages[stat]).toBe(0);
      expect(result.state.sides.p2.unit.stages[stat]).toBe(-1);
    }
    const transfer = result.events.findIndex((e) => e.type === "stages-transferred");
    const lastStage = result.events.reduce((n, e, i) => e.type === "stat-stage" && e.detail.side === "p1" ? i : n, -1);
    expect(transfer).toBeGreaterThan(lastStage);
    expect(result.state.sides.p2.unit.currentHp).toBe(5000);
    expect(result.state.sides.p2.unit.effects.some((e) => e.label === "max_hp_down")).toBe(false);
  });

  it("混沌界王转移已有强化成功时也不会追加失败扣血", () => {
    const state = battle("pet-3006");
    state.sides.p1.unit.stages.atk = 1;
    const result = turn(state, "mv-3006-s12");
    expect(result.state.sides.p2.unit.stages.atk).toBe(-1);
    expect(result.state.sides.p2.unit.currentHp).toBe(5000);
    expect(result.state.sides.p2.unit.effects.some((e) => e.label === "max_hp_down")).toBe(false);
  });

  it("混沌界王仅在同次技能转移失败时扣除对手最大体力的1/4", () => {
    const result = turn(battle("pet-3006"), "mv-3006-s12");
    expect(result.state.sides.p2.unit.currentHp).toBe(3750);
    expect(result.events.filter((e) => e.type === "damage" && e.detail.side === "p2").map((e) => e.detail.amount)).toEqual([1250]);
    expect(result.state.sides.p2.unit.effects.some((e) => e.label === "max_hp_down")).toBe(false);
  });

  it("混沌界王无法使用技能时，不产生失败扣血或体力上限削减", () => {
    const state = battle("pet-3006");
    for (const move of state.sides.p1.unit.moves) move.pp = 0;
    const result = turn(state, "mv-3006-s12");
    expect(result.state.sides.p2.unit.currentHp).toBe(5000);
    expect(result.state.sides.p2.unit.effects.some((e) => e.label === "max_hp_down")).toBe(false);
  });

  it("十里枯监保持属性技能，使用时不额外扣除对手200体力", () => {
    const state = battle("pet-4939");
    const result = turn(state, "mv-4939-s12");
    expect(PACK.movesById.get("mv-4939-s12")?.category).toBeUndefined();
    expect(result.events.some((e) => e.type === "action-declared" && e.detail.moveId === "mv-4939-s12")).toBe(true);
    expect(result.events.filter((e) => e.type === "damage" && e.detail.side === "p2")).toEqual([]);
    expect(result.state.sides.p2.unit.currentHp).toBe(5000);
  });

  it.each([{ hp: 1, healed: 300 }, { hp: 890, healed: 10 }, { hp: 900, healed: 0 }])(
    "馨幻hp=$hp时，固伤等于本次实际回复$healed，不复用历史回复", ({ hp, healed }) => {
      const state = battle("pet-3398");
      const unit = state.sides.p1.unit, foe = state.sides.p2.unit;
      unit.currentHp = hp; unit.prevHeal = 123; unit.base.atk = 1;
      foe.base.def = 10000; foe.mode = "boss"; // 隔离独立的非boss回合末吸取。
      const result = turn(state, "mv-3398-s5");
      const heals = result.events.filter((e) => e.type === "heal" && e.detail.side === "p1");
      const echoes = result.events.filter((e) => e.type === "damage" && e.detail.cause === "echo");
      expect(heals.map((e) => e.detail.amount)).toEqual(healed > 0 ? [healed] : []);
      expect(echoes.map((e) => e.detail.amount)).toEqual(healed > 0 ? [healed] : []);
    },
  );

  it.each(["pet-3260", "pet-3465"])("%s的回合末回响同样使用本次回复量", (id) => {
    const state = battle(id);
    state.sides.p1.unit.currentHp = 1;
    for (const move of state.sides.p1.unit.moves) move.pp = 0;
    const result = turn(state, state.sides.p1.unit.moves[0]!.moveId);
    const healed = result.events.filter((e) => e.type === "heal" && e.detail.side === "p1").map((e) => e.detail.amount);
    const echoed = result.events.filter((e) => e.type === "damage" && e.detail.cause === "echo").map((e) => e.detail.amount);
    expect(healed.length).toBeGreaterThan(0);
    expect(echoed).toEqual(healed);
  });

  it("弑焱天魂不在开战施加烧伤，且每次有效攻击都重新触发", () => {
    const idle = battle("pet-3225");
    for (const move of idle.sides.p1.unit.moves) move.pp = 0;
    const empty = turn(idle, "mv-3225-s15");
    expect(empty.events.some((e) => e.type === "effect-applied" && e.detail.name === "burn")).toBe(false);

    const first = turn(battle("pet-3225"), "mv-3225-s15");
    const burn = first.events.findIndex((e) => e.type === "effect-applied" && e.detail.name === "burn");
    expect(burn).toBeGreaterThan(first.events.findIndex((e) => e.type === "action-declared"));
    expect(burn).toBeGreaterThanOrEqual(0);
    const resumed = JSON.parse(JSON.stringify(first.state)) as CoreState;
    resumed.sides.p1.unit.currentHp = 900;
    resumed.sides.p2.unit.effects = resumed.sides.p2.unit.effects.filter((e) => e.kind !== "burn");
    const second = turn(resumed, "mv-3225-s15");
    expect(second.events.some((e) => e.type === "effect-applied" && e.detail.name === "burn")).toBe(true);
  });

  it("邪影梦魇未支持的状态分支不会赋予额外100%增伤", () => {
    const result = turn(battle("pet-4035"), "mv-4035-s15");
    expect(result.events.some((e) => e.type === "effect-applied" && e.detail.name === "dmg_boost")).toBe(false);
    expect(result.state.sides.p1.unit.effects.some((e) => e.kind === "dmg_boost")).toBe(false);
  });

  it("霍夫曼受击触发害怕后，不执行未建模的跨事件吸取", () => {
    const moves = new Map(PACK.movesById);
    const hostId = PACK.unitsById.get("pet-5000")!.moveIds[0]!;
    moves.set(hostId, { ...moves.get(hostId)!, effects: [{ op: "damage", kind: "fixed", power: 10 }] });
    const pack: FrozenPack = { ...PACK, movesById: moves };
    const state = battle("pet-3517", pack);
    state.sides.p1.unit.currentHp = 300;
    for (const move of state.sides.p1.unit.moves) move.pp = 0;
    state.sides.p2.unit.moves[0]!.pp = 5;
    const result = turn(state, state.sides.p1.unit.moves[0]!.moveId, pack);
    expect(result.events.some((e) => e.type === "effect-applied" && e.detail.name === "fear")).toBe(true);
    expect(result.events.some((e) => e.type === "damage" && e.detail.side === "p1")).toBe(true);
    expect(result.events.filter((e) => e.type === "damage" && e.detail.side === "p2")).toEqual([]);
    expect(result.events.filter((e) => e.type === "heal")).toEqual([]);
  });

  it.each(["pet-4821", "pet-4820"])("%s不再在回合末施加丢失攻击条件的减伤", (id) => {
    const state = battle(id);
    for (const move of state.sides.p1.unit.moves) move.pp = 0;
    const result = turn(state, state.sides.p1.unit.moves[0]!.moveId);
    expect(result.events.some((e) => e.type === "effect-applied" && e.detail.name === "dmg_taken_down")).toBe(false);
  });
});
