/**
 * 巅峰药剂：开局按持有上限 5 填满，用掉一次少一个。
 * 不进控制门。PP 只加到选定的一个技能。先制 1 的招式仍比药剂先动。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, legalActions, loadPackFromDir, type CoreState } from "@seer/battle-core";
import { BattleHost } from "@seer/host";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const PACK_V1 = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED = "00000000000000000000000000000001";

const mk = (p1 = "syn-gamma", p2 = "syn-epsilon"): CoreState =>
  initBattle(PACK, { battleId: "btl_item", seedHex: SEED, p1, p2 });
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string, n = 0) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${n}-${id}`.slice(0, 40) });
const turn = (s: CoreState, p1: string, p2: string, n = 0) => ok(applyTurn(PACK, s, { p1: act(p1, n), p2: act(p2, n) }));

describe("items", () => {
  it("开局双方都按上限填满；不传 pack 时合法集不含药剂；v1 不写 stocks", () => {
    const s = mk();
    expect(s.sides.p1.stocks).toEqual({ "pp-20": 5, "pp-5": 5, "hp-200": 5, "hp-250": 5, cure: 5 });
    expect(s.sides.p2.stocks).toEqual(s.sides.p1.stocks);
    expect(legalActions(s, "p1")).not.toContain("act_item-hp-200");
    expect(legalActions(s, "p1", PACK)).toContain("act_item-hp-200");
    expect(legalActions(s, "p1", PACK)).toContain("act_item-pp-20--syn-strike");
    const v1 = initBattle(PACK_V1, { battleId: "btl_item", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta" });
    expect(v1.sides.p1.stocks).toBeUndefined();
  });

  it("满血用药仍扣次数，并报体力已满", () => {
    const s = mk();
    const r = turn(s, "act_item-hp-200", "act_syn-bolster");
    expect(r.state.sides.p1.stocks?.["hp-200"]).toBe(4);
    expect(r.state.sides.p2.stocks?.["hp-200"]).toBe(5);
    expect(r.events.some((e) => e.type === "action-declared" && e.detail.actionId === "act_item-hp-200" && e.detail.moveId === undefined)).toBe(true);
    expect(r.events.some((e) => e.type === "action-failed" && e.detail.side === "p1" && e.detail.reason === "hp-full")).toBe(true);
  });

  it("体力药剂加固定值，不超过上限", () => {
    const s = mk();
    s.sides.p1.unit.currentHp = 50;
    const cap = s.sides.p1.unit.base.hp;
    const r = turn(s, "act_item-hp-200", "act_syn-bolster");
    expect(r.state.sides.p1.unit.currentHp).toBe(Math.min(cap, 250));
  });

  it("PP 只加到选定技能，封顶 ppMax", () => {
    const s = mk();
    const strike = s.sides.p1.unit.moves.find((m) => m.moveId === "syn-strike")!;
    const jab = s.sides.p1.unit.moves.find((m) => m.moveId === "syn-jab")!;
    const jabBefore = jab.pp;
    strike.pp = strike.ppMax - 10;
    const r = turn(s, "act_item-pp-20--syn-strike", "act_syn-bolster");
    expect(r.state.sides.p1.unit.moves.find((m) => m.moveId === "syn-strike")!.pp).toBe(strike.ppMax);
    expect(r.state.sides.p1.unit.moves.find((m) => m.moveId === "syn-jab")!.pp).toBe(jabBefore);
  });

  it("龙的振奋药水解除能力下降，并给选定技能加 5 PP", () => {
    const s = mk();
    s.sides.p1.unit.stages.atk = -2;
    s.sides.p1.unit.stages.def = 1;
    const strike = s.sides.p1.unit.moves.find((m) => m.moveId === "syn-strike")!;
    strike.pp = strike.ppMax - 10;
    const r = turn(s, "act_item-pp-5--syn-strike", "act_syn-bolster");
    const u = r.state.sides.p1.unit;
    expect(u.stages.atk).toBe(0);
    expect(u.stages.def).toBe(1);
    expect(u.moves.find((m) => m.moveId === "syn-strike")!.pp).toBe(strike.ppMax - 5);
  });

  it("修的神奇药水解除异常和控制，并回 170", () => {
    const s = mk();
    s.sides.p1.unit.currentHp = 40;
    s.sides.p1.unit.effects.push(
      { kind: "burn", effectInstanceId: "b1", remainingTurns: 3 },
      { kind: "control:stun", effectInstanceId: "c1", remainingTurns: 1 },
    );
    const r = turn(s, "act_item-cure", "act_syn-bolster");
    const u = r.state.sides.p1.unit;
    expect(u.effects.some((e) => e.kind === "burn" || e.kind === "control:stun")).toBe(false);
    expect(u.currentHp).toBe(Math.min(u.base.hp, 210));
  });

  it("害怕不挡住药剂；第 6 次不再合法", () => {
    const s = mk();
    s.sides.p1.unit.currentHp = 40;
    s.sides.p1.unit.effects.push({ kind: "fear", effectInstanceId: "f1", remainingTurns: 1 });
    const r = turn(s, "act_item-hp-250", "act_syn-bolster");
    expect(r.events.some((e) => e.type === "action-failed" && e.detail.side === "p1" && String(e.detail.reason).startsWith("status:"))).toBe(false);
    expect(r.state.sides.p1.unit.currentHp).toBeGreaterThan(40);
    let state = r.state;
    for (let i = 0; i < 4; i++) state = turn(state, "act_item-hp-250", "act_syn-bolster", i + 1).state;
    expect(state.sides.p1.stocks?.["hp-250"]).toBe(0);
    expect(legalActions(state, "p1", PACK)).not.toContain("act_item-hp-250");
  });

  it("先制 1 的招式比药剂先动；换人比药剂先", () => {
    const s = mk("syn-epsilon", "syn-gamma");
    const fast = turn(s, "act_item-hp-200", "act_syn-jab");
    const declared = fast.events.filter((e) => e.type === "action-declared").map((e) => e.detail.side);
    expect(declared[0]).toBe("p2");
    const sw = mk();
    sw.sides.p2.bench = [structuredClone(sw.sides.p2.unit)];
    sw.sides.p2.bench[0]!.unitId = "unit_p2-b0";
    sw.sides.p2.bench[0]!.currentHp = sw.sides.p2.unit.base.hp;
    const switched = turn(sw, "act_item-hp-200", "act_switch-0");
    const order = switched.events.filter((e) => e.type === "switch" || (e.type === "action-declared" && e.detail.actionId === "act_item-hp-200")).map((e) => e.type);
    expect(order[0]).toBe("switch");
  });

  it("阵亡挂起后，未行动方的药剂在换人后续上", () => {
    // 药剂先制 0，挣扎垫底，自然回合里药剂会先结算。这里直接放下引擎记下的 remaining。
    const s = initBattle(PACK, {
      battleId: "btl_item",
      seedHex: SEED,
      p1: "syn-gamma",
      p2: "syn-epsilon",
      bench: { p1: ["syn-delta"] },
    });
    s.sides.p1.unit.currentHp = 0;
    s.phase = "checkpoint";
    s.suspension = { koSide: "p1", remaining: { p1: null, p2: "act_item-hp-200" }, firstSide: "p1" };
    const resumed = applyReplacement(PACK, s, { p1: act("act_switch-0", 1), p2: null });
    if (!resumed.ok) throw new Error(`${resumed.fault.reason} ${resumed.fault.message}`);
    expect(resumed.state.sides.p1.unit.speciesId).toBe("syn-delta");
    expect(resumed.state.sides.p2.stocks?.["hp-200"]).toBe(4);
    expect(resumed.events.some((e) => e.type === "action-declared" && e.detail.actionId === "act_item-hp-200")).toBe(true);
    expect(resumed.events.some((e) => e.type === "action-failed" && e.detail.side === "p2" && e.detail.reason === "hp-full")).toBe(true);
    expect(resumed.state.phase).toBe("collect");
  });

  it("慢的药剂排在同先制招式后面", () => {
    const s = mk();
    s.sides.p1.unit.base.spd = 1;
    s.sides.p2.unit.base.spd = 999;
    const r = turn(s, "act_item-hp-200", "act_syn-strike");
    const declared = r.events.filter((e) => e.type === "action-declared").map((e) => e.detail.side);
    expect(declared[0]).toBe("p2");
    expect(declared).toContain("p1");
  });

  it("观察只把剩余次数给己方", () => {
    const h = new BattleHost({
      pack: PACK,
      battleId: "btl_items",
      seedHex: SEED,
      species: { p1: "syn-gamma", p2: "syn-epsilon" },
      players: { p1: "alice", p2: "bob" },
      deadlineMs: 10_000,
    });
    const alice = h.observe("alice");
    const bob = h.observe("bob");
    expect(alice.own.stocks?.["hp-200"]).toBe(5);
    expect(bob.own.stocks?.["cure"]).toBe(5);
    expect("stocks" in alice.opponent).toBe(false);
    expect("stocks" in bob.opponent).toBe(false);
    expect(alice.legalActions.some((a) => a.action.kind === "item" && a.action.itemId === "hp-200")).toBe(true);
    const dec = alice.decision!;
    const cmd = (who: "alice" | "bob", actionId: string) => ({
      battleId: "btl_items",
      decisionId: dec.decisionId,
      actionId,
      baseRevision: dec.baseRevision,
      idempotencyKey: `item-${who}`.padEnd(8, "x"),
    });
    expect(h.submit("alice", cmd("alice", "act_item-hp-200")).ok).toBe(true);
    expect(h.submit("bob", cmd("bob", "act_syn-bolster")).ok).toBe(true);
    expect(h.observe("alice").own.stocks?.["hp-200"]).toBe(4);
    expect(h.observe("bob").own.stocks?.["hp-200"]).toBe(5);
    expect(h.history("alice", 0).events.some((e) => e.type === "action-declared" && "actionId" in e && e.actionId === "act_item-hp-200")).toBe(true);
  });
});
