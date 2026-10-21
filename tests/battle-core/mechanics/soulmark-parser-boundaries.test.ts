/**
 * Parse-time guard and trigger boundaries through the real battle engine.
 * All soulmarks in this test are compiled in memory from parser output; no content files are rewritten.
 */
import { describe, expect, it } from "vitest";
import {
  applyTurn, compilePack, initBattle,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import rulesetJson from "../../../content/rulesets/real-v1.json" with { type: "json" };
import typechartJson from "../../../content/rulesets/typechart.json" with { type: "json" };
import naturesJson from "../../../content/rulesets/natures.json" with { type: "json" };

const SEED = "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
const UNKNOWN_GUARD = "回合开始时恢复自身10点体力；若未知条件则回合结束时恢复自身100点体力，附加对手150点固定伤害，未触发则恢复自身50点体力；回合结束时恢复自身20点体力";
const BARE_AFTER_GUARD = "若未知条件则回合结束时造成150点固定伤害；恢复自身100点体力；回合开始时自身攻击+1";
const CATEGORY_MARK = "自身使用物理技能附加10点固定伤害；自身使用特殊技能附加20点固定伤害；自身属性技能命中后100%令对手麻痹";
const DEFERRED_HIT = "属性技能命中则在回合结束后恢复自身100点体力；战斗开始时自身攻击+1";

function parsedMark(id: string, text: string) {
  const parsed = parseSoulmarkText(text, "解析边界夹具");
  if (parsed.entries.length === 0) throw new Error(`${id} has no active parser entries`);
  return { id, name: id, desc: text, effects: parsed.entries };
}

const marks = [
  parsedMark("sm-unknown-guard", UNKNOWN_GUARD),
  parsedMark("sm-bare-after-guard", BARE_AFTER_GUARD),
  parsedMark("sm-category-boundary", CATEGORY_MARK),
  parsedMark("sm-deferred-hit", DEFERRED_HIT),
];

const PACK: FrozenPack = compilePack({
  ruleset: rulesetJson,
  pack: {
    packId: "soulmark-parser-boundaries",
    version: "0.1.0",
    schemaVersion: 1,
    rulesetId: "real-v1",
    verification: "SYNTHETIC",
    license: { identifier: "CC0-1.0", public: true },
    files: { units: "units.json", moves: "moves.json", soulmarks: "soulmarks.json" },
    assets: [],
  },
  units: {
    units: [
      {
        id: "unit-parser-p1", name: "Parser P1",
        base: { hp: 500, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
        types: ["草"], moveIds: ["mv-physical", "mv-special", "mv-status", "mv-status-miss"], soulMark: "sm-unknown-guard",
      },
      {
        id: "unit-parser-p2", name: "Parser P2",
        base: { hp: 500, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
        types: ["草"], moveIds: ["mv-status", "mv-nullify"],
      },
    ],
  },
  moves: {
    moves: [
      { id: "mv-physical", name: "Physical", type: "草", category: "physical", pp: 20, priority: 0, accuracy: "always", effects: [{ op: "damage", power: 20 }] },
      { id: "mv-special", name: "Special", type: "草", category: "special", pp: 20, priority: 0, accuracy: "always", effects: [{ op: "damage", power: 20 }] },
      { id: "mv-status", name: "Status", type: "草", pp: 20, priority: 0, accuracy: "always", effects: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" }] },
      { id: "mv-status-miss", name: "Status Miss", type: "草", pp: 20, priority: 0, accuracy: 0, effects: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" }] },
      { id: "mv-nullify", name: "Nullify Status", type: "草", pp: 20, priority: 5, accuracy: "always", effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1, cat: 1 } }] },
    ],
  },
  soulmarks: { soulmarks: Object.fromEntries(marks.map((mark) => [mark.id, mark])) },
  typeChart: typechartJson,
  natures: naturesJson,
});

type BattleResult = Extract<ReturnType<typeof applyTurn>, { ok: true }>;
type Event = BattleResult["events"][number];

function ok(result: ReturnType<typeof applyTurn>): BattleResult {
  if (!result.ok) throw new Error(`applyTurn failed: ${result.fault.message}`);
  return result;
}

function stateFor(mark: string): CoreState {
  return initBattle(PACK, {
    battleId: "btl_soulmark-parser-boundaries",
    seedHex: SEED,
    p1: "unit-parser-p1",
    p2: "unit-parser-p2",
    mechanics: { soulmark: { p1: [mark] } },
  });
}

function action(move: string, key: string) {
  return { actionId: `act_${move}`, origin: "player" as const, idempotencyKey: `boundary-${key}` };
}

function eventsOf(events: readonly Event[], type: string) {
  return events.filter((event) => event.type === type);
}

function fixedDamage(events: readonly Event[]) {
  return events.filter((event) => event.type === "damage" && event.detail.damageKind === "fixed");
}

function turnWith(state: CoreState, p1Move = "mv-status", key = "turn-1") {
  return ok(applyTurn(PACK, state, {
    p1: action(p1Move, `${key}-p1`),
    p2: action("mv-status", `${key}-p2`),
  }));
}

describe("魂印 parser 边界的真实战斗验收", () => {
  it("未知 guard 与 else 被隔离，独立的回合开始/结束回血仍在正确时机生效并可序列化续跑", () => {
    const parsed = parseSoulmarkText(UNKNOWN_GUARD, "解析边界夹具");
    expect(parsed.entries).toEqual([
      { hook: "onTurnStart", ops: [{ op: "heal", flat: 10, target: "self" }] },
      { hook: "onTurnEnd", ops: [{ op: "heal", flat: 20, target: "self" }] },
    ]);
    expect(parsed.unparsed.map((item) => item.clause)).toEqual(expect.arrayContaining([
      expect.stringContaining("若未知条件则回合结束时恢复自身100点体力"),
      expect.stringContaining("附加对手150点固定伤害"),
      expect.stringContaining("未触发则恢复自身50点体力"),
    ]));

    const state = stateFor("sm-unknown-guard");
    state.sides.p1.unit.currentHp = 50;
    const first = turnWith(state);
    const p1Heals = eventsOf(first.events, "heal")
      .filter((event) => event.detail.side === "p1")
      .map((event) => event.detail.amount);
    expect(p1Heals).toEqual([10, 20]);
    expect(fixedDamage(first.events)).toHaveLength(0);

    const firstAction = first.events.findIndex((event) => event.type === "action-declared");
    const startHeal = first.events.findIndex((event) => event.type === "heal" && event.detail.side === "p1" && event.detail.amount === 10);
    const endHeal = first.events.findIndex((event) => event.type === "heal" && event.detail.side === "p1" && event.detail.amount === 20);
    const lastAction = first.events.reduce((last, event, index) => event.type === "action-declared" ? index : last, -1);
    expect(startHeal).toBeGreaterThanOrEqual(0);
    expect(startHeal).toBeLessThan(firstAction);
    expect(endHeal).toBeGreaterThan(lastAction);

    const direct = turnWith(JSON.parse(JSON.stringify(first.state)) as CoreState, "mv-status", "turn-2");
    const resumedState = JSON.parse(JSON.stringify(first.state)) as CoreState;
    const resumed = turnWith(resumedState, "mv-status", "turn-2");
    expect(JSON.stringify({ state: resumed.state, events: resumed.events }))
      .toBe(JSON.stringify({ state: direct.state, events: direct.events }));
    expect(eventsOf(resumed.events, "heal").filter((event) => event.detail.side === "p1").map((event) => event.detail.amount))
      .toEqual([10, 20]);
  });

  it("未知 guard 后分号裸回血不逃逸为无条件效果", () => {
    const parsed = parseSoulmarkText(BARE_AFTER_GUARD, "解析边界夹具");
    expect(parsed.entries).toEqual([
      { hook: "onTurnStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
    ]);
    expect(parsed.unparsed.map((item) => item.clause)).toEqual(expect.arrayContaining([
      expect.stringContaining("若未知条件则回合结束时造成150点固定伤害"),
      expect.stringContaining("恢复自身100点体力"),
    ]));

    const state = stateFor("sm-bare-after-guard");
    state.sides.p1.unit.currentHp = 50;
    const result = turnWith(state);
    expect(eventsOf(result.events, "heal").some((event) => event.detail.side === "p1" && event.detail.amount === 100)).toBe(false);
    expect(fixedDamage(result.events)).toHaveLength(0);
  });

  it("物理/特殊用技类别不串门，已支持的属性技能命中只在属性技后触发", () => {
    const parsed = parseSoulmarkText(CATEGORY_MARK, "解析边界夹具");
    expect(parsed.entries).toEqual([
      {
        hook: "onBattleStart",
        ops: [{
          op: "apply_status", name: "react", target: "self",
          params: { trigger: 11, cat: 2 }, stack: true,
          payload: [{ op: "damage", kind: "fixed", power: 10, target: "opponent" }],
        }],
      },
      {
        hook: "onBattleStart",
        ops: [{
          op: "apply_status", name: "react", target: "self",
          params: { trigger: 11, cat: 3 }, stack: true,
          payload: [{ op: "damage", kind: "fixed", power: 20, target: "opponent" }],
        }],
      },
      {
        hook: "onMoveUsed",
        guard: { actor: "self", cat: 1 },
        ops: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 100 }],
      },
    ]);
    expect(parsed.unparsed).toEqual([]);

    const physical = turnWith(stateFor("sm-category-boundary"), "mv-physical", "physical");
    const physicalFixed = fixedDamage(physical.events).filter((event) => event.detail.side === "p2").map((event) => event.detail.amount);
    expect(physicalFixed).toEqual([10]);
    expect(physical.state.sides.p2.unit.effects.some((effect) => effect.kind === "paralysis")).toBe(false);

    const special = turnWith(stateFor("sm-category-boundary"), "mv-special", "special");
    const specialFixed = fixedDamage(special.events).filter((event) => event.detail.side === "p2").map((event) => event.detail.amount);
    expect(specialFixed).toEqual([20]);
    expect(special.state.sides.p2.unit.effects.some((effect) => effect.kind === "paralysis")).toBe(false);

    const attribute = turnWith(stateFor("sm-category-boundary"), "mv-status", "attribute");
    expect(fixedDamage(attribute.events)).toHaveLength(0);
    expect(attribute.state.sides.p2.unit.effects.some((effect) => effect.kind === "paralysis")).toBe(true);
  });

  it("属性技能MISS或被招式失效拦截时，不触发‘命中后’魂印", () => {
    const missed = turnWith(stateFor("sm-category-boundary"), "mv-status-miss", "attribute-miss");
    expect(eventsOf(missed.events, "missed").some((event) => event.detail.side === "p1")).toBe(true);
    expect(missed.state.sides.p2.unit.effects.some((effect) => effect.kind === "paralysis")).toBe(false);
    expect(missed.events.some((event) => event.type === "soulmark" && event.detail.effect === "hook:onMoveUsed" && event.detail.side === "p1")).toBe(false);

    const blocked = ok(applyTurn(PACK, stateFor("sm-category-boundary"), {
      p1: action("mv-status", "attribute-nullified-p1"),
      p2: action("mv-nullify", "attribute-nullified-p2"),
    }));
    expect(blocked.events.some((event) => event.type === "action-failed" && event.detail.side === "p1" && event.detail.reason === "move-nullified")).toBe(true);
    expect(blocked.state.sides.p2.unit.effects.some((effect) => effect.kind === "paralysis")).toBe(false);
    expect(blocked.events.some((event) => event.type === "soulmark" && event.detail.effect === "hook:onMoveUsed" && event.detail.side === "p1")).toBe(false);
  });

  it("明确 deferred 的属性技能命中句不会在开场、用技或后续伤害时执行", () => {
    const parsed = parseSoulmarkText(DEFERRED_HIT, "解析边界夹具");
    expect(parsed.entries).toEqual([
      { hook: "onBattleStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
    ]);
    expect(parsed.unparsed).toEqual([
      expect.objectContaining({
        clause: expect.stringContaining("属性技能命中则在回合结束后恢复自身100点体力"),
        reason: "hit-window — move-landed second-phase trigger unmodeled (deferred)",
      }),
    ]);

    const state = stateFor("sm-deferred-hit");
    expect(state.sides.p1.unit.stages.atk).toBe(0);
    state.sides.p1.unit.currentHp = 50;
    const attribute = turnWith(state, "mv-status", "deferred-attribute");
    expect(eventsOf(attribute.events, "heal").some((event) => event.detail.side === "p1" && event.detail.amount === 100)).toBe(false);
    expect(attribute.state.sides.p1.unit.stages.atk).toBe(1); // 独立开场条目确实通过真实 hook 派发
    const physical = turnWith(attribute.state, "mv-physical", "deferred-physical");
    expect(eventsOf(physical.events, "heal").some((event) => event.detail.side === "p1" && event.detail.amount === 100)).toBe(false);
    expect(physical.state.sides.p1.unit.currentHp).toBe(50);
  });
});
