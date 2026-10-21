import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, loadPackFromDir, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "d1d2d3d4d5d6d7d8d9dadbdcdddedfe0";

const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `hpdelta-${id}-12345` });
const ok = (r: ReturnType<typeof applyTurn> | ReturnType<typeof applyReplacement>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};

function fresh(): FrozenPack {
  return loadPackFromDir(CONTENT, "synthetic-v2");
}

function setHpDelta(pack: FrozenPack, fx: Record<string, unknown>): void {
  // Exercise the real move executor with a focused synthetic IR node.
  pack.movesById.get("syn-strike")!.effects = [fx as never];
}

function battle(pack: FrozenPack, p2Bench: string[] = []): CoreState {
  const s = initBattle(pack, {
    battleId: "btl_hp_delta_checkpoint",
    seedHex: SEED,
    p1: "syn-gamma",
    p2: "syn-delta",
    ...(p2Bench.length > 0 ? { bench: { p2: p2Bench } } : {}),
  });
  for (const side of ["p1", "p2"] as const) {
    delete s.sides[side].unit.soul;
    s.sides[side].unit.revives = 0;
  }
  s.sides.p1.unit.base.spd = 400;
  s.sides.p2.unit.base.spd = 1;
  return s;
}

function play(pack: FrozenPack, state: CoreState) {
  return ok(applyTurn(pack, state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
}

type Ev = { type: string; detail: Record<string, unknown> };
const events = (r: { events: readonly unknown[] }) => r.events as Ev[];
const damage = (evs: Ev[], side: "p1" | "p2") => evs.find((e) => e.type === "damage" && e.detail.side === side && e.detail.cause === "status:hp_delta");
const heals = (evs: Ev[]) => evs.filter((e) => e.type === "heal" && String(e.detail.source).startsWith("status:hp_delta"));

describe("hp_delta 吸取与 KO checkpoint 的原子顺序", () => {
  it("致死扣除剩余27点只回27，heal 先于 ko/battle-end", () => {
    const pack = fresh();
    setHpDelta(pack, { op: "hp_delta", target: "opponent", flat: 100, healSelf: { numerator: 1, denominator: 1, of: "dealt" } });
    const s = battle(pack);
    s.sides.p1.unit.currentHp -= 50;
    s.sides.p2.unit.currentHp = 27;
    const before = s.sides.p1.unit.currentHp;

    const r = play(pack, s);
    const evs = events(r);
    expect(damage(evs, "p2")?.detail.amount).toBe(27);
    expect(heals(evs).map((e) => e.detail.amount)).toEqual([27]);
    expect(r.state.sides.p1.unit.currentHp).toBe(before + 27);
    const hitAt = evs.findIndex((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === "status:hp_delta");
    const healAt = evs.findIndex((e) => e.type === "heal" && e.detail.source === "status:hp_delta");
    const koAt = evs.findIndex((e) => e.type === "ko" && e.detail.side === "p2");
    const endAt = evs.findIndex((e) => e.type === "battle-end");
    expect(hitAt).toBeLessThan(healAt);
    expect(healAt).toBeLessThan(koAt);
    expect(koAt).toBeLessThan(endAt);
    expect(r.state.terminal).toEqual({ result: "p1", reason: "ko" });
  });

  it("非致死扣血仍只触发一次实际扣量回血", () => {
    const pack = fresh();
    setHpDelta(pack, { op: "hp_delta", target: "opponent", flat: 100, healSelf: { numerator: 1, denominator: 1, of: "dealt" } });
    const s = battle(pack);
    s.sides.p1.unit.currentHp -= 150;
    s.sides.p2.unit.currentHp = 200;
    const before = s.sides.p1.unit.currentHp;

    const r = play(pack, s);
    expect(damage(events(r), "p2")?.detail.amount).toBe(100);
    expect(heals(events(r)).map((e) => e.detail.amount)).toEqual([100]);
    expect(r.state.sides.p1.unit.currentHp).toBe(before + 100);
    expect(r.state.sides.p2.unit.currentHp).toBe(100);
    expect(r.state.terminal).toBeNull();
    expect(r.state.suspension).toBeUndefined();
  });

  it("替补挂起前完成吸取；JSON续跑不重复回血", () => {
    const pack = fresh();
    setHpDelta(pack, { op: "hp_delta", target: "opponent", flat: 100, healSelf: { numerator: 1, denominator: 1, of: "dealt" } });
    const s = battle(pack, ["syn-gamma"]);
    s.sides.p1.unit.currentHp -= 50;
    s.sides.p2.unit.currentHp = 27;
    const before = s.sides.p1.unit.currentHp;

    const r1 = play(pack, s);
    expect(r1.state.suspension?.koSide).toBe("p2");
    expect(r1.state.terminal).toBeNull();
    expect(heals(events(r1)).map((e) => e.detail.amount)).toEqual([27]);
    expect(r1.state.sides.p1.unit.currentHp).toBe(before + 27);

    const resumedState = JSON.parse(JSON.stringify(r1.state)) as CoreState;
    const r2 = ok(applyReplacement(pack, resumedState, { p1: null, p2: act("act_switch-0") }));
    expect(heals(events(r2))).toHaveLength(0);
    expect(r2.state.sides.p1.unit.currentHp).toBe(before + 27);
    expect(r2.state.suspension).toBeUndefined();
    expect(r2.state.sides.p2.unit.speciesId).toBe("syn-gamma");
  });

  it("同原子 benchHeal 在致死 checkpoint 前完成，并按自身回血后的满血门判定", () => {
    const pack = fresh();
    setHpDelta(pack, {
      op: "hp_delta", target: "opponent", flat: 100,
      healSelf: { numerator: 1, denominator: 1, of: "dealt" },
      benchHeal: { flat: 10, requireSelfFull: true },
    });
    const s = initBattle(pack, {
      battleId: "btl_hp_delta_bench",
      seedHex: SEED,
      p1: "syn-gamma",
      p2: "syn-delta",
      bench: { p1: ["syn-epsilon"] },
    });
    for (const side of ["p1", "p2"] as const) {
      delete s.sides[side].unit.soul;
      s.sides[side].unit.revives = 0;
    }
    s.sides.p1.unit.base.spd = 400;
    s.sides.p2.unit.base.spd = 1;
    s.sides.p1.unit.currentHp -= 27;
    s.sides.p1.bench![0]!.currentHp -= 15;
    s.sides.p2.unit.currentHp = 27;

    const r = play(pack, s);
    const evs = events(r);
    expect(heals(evs).map((e) => [e.detail.source, e.detail.amount])).toEqual([
      ["status:hp_delta", 27],
      ["status:hp_delta:bench", 10],
    ]);
    const healEvents = heals(evs);
    const lastHealAt = evs.indexOf(healEvents[healEvents.length - 1]!);
    const koAt = evs.findIndex((e) => e.type === "ko" && e.detail.side === "p2");
    expect(lastHealAt).toBeLessThan(koAt);
    expect(r.state.sides.p1.bench![0]!.currentHp).toBe(r.state.sides.p1.bench![0]!.base.hp - 5);
  });

  it("自伤致死时同原子 healSelf 不复活持有者", () => {
    const pack = fresh();
    setHpDelta(pack, { op: "hp_delta", target: "self", flat: 100, healSelf: { numerator: 1, denominator: 1, of: "dealt" } });
    const s = battle(pack);
    s.sides.p1.unit.currentHp = 27;

    const r = play(pack, s);
    expect(damage(events(r), "p1")?.detail.amount).toBe(27);
    expect(heals(events(r))).toHaveLength(0);
    expect(r.state.sides.p1.unit.currentHp).toBe(0);
    expect(r.state.terminal).toEqual({ result: "p2", reason: "ko" });
  });
});
