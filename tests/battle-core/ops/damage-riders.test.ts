/**
 * 命中后五段附加的顺序和数值。剪切到 damage-riders.ts 之前就要绿，剪切之后仍要绿。
 * 不改 content/，不改解析器。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, initBattle, loadPackFromDir, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "abababababababababababababababab";

const act = (id: string, key: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: key });

function fresh(): FrozenPack {
  return loadPackFromDir(CONTENT, "synthetic-v2");
}

function quiet(s: CoreState, side: "p1" | "p2"): void {
  delete s.sides[side].unit.soul;
  s.sides[side].unit.revives = 0;
}

function battle(pack: FrozenPack): CoreState {
  const s = initBattle(pack, { battleId: "btl_riders", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
  quiet(s, "p1");
  quiet(s, "p2");
  s.sides.p1.unit.base.spd = 400;
  s.sides.p2.unit.base.spd = 1;
  return s;
}

function strike(pack: FrozenPack, effects: unknown): void {
  pack.movesById.get("syn-strike")!.effects = effects as never;
}

function play(pack: FrozenPack, s: CoreState) {
  const r = applyTurn(pack, s, {
    p1: act("act_syn-strike", "rider-p1"),
    p2: act("act_syn-purge-mind", "rider-p2"),
  });
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
}

type Ev = { type: string; detail: Record<string, unknown> };

function tags(events: Ev[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const d = e.detail;
    if (e.type === "damage" && d.side === "p2" && d.cause === undefined) out.push("hit");
    else if (e.type === "heal" && d.source === "drain") out.push("drain");
    else if (e.type === "damage" && d.cause === "echo") out.push("echo");
    else if (e.type === "damage" && d.cause === "reflect") out.push("reflect");
    else if (e.type === "heal" && d.source === "heal_on_hit") out.push("heal");
    else if (e.type === "stat-stage" && d.stat === "def" && d.side === "p2") out.push("stage");
  }
  return out;
}

describe("命中后附加段", () => {
  it("顺序是命中、吸血、吸血等量固伤、反伤、等量固伤、命中回复、降防御", () => {
    const pack = fresh();
    strike(pack, [
      { op: "damage", kind: "fixed", power: 40, target: "opponent" },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 }, drainEcho: true },
      { op: "applyFlatEcho", flatEcho: {} },
      { op: "applyHealOnHit", healOnHit: { numerator: 1, denominator: 10 } },
      { op: "applyStageOnHit", stageOnHit: [{ stat: "def", delta: -1 }] },
    ]);
    const s = battle(pack);
    s.sides.p1.unit.currentHp = 20;
    s.sides.p2.unit.effects.push({
      kind: "reflect", label: "reflect_dmg", effectInstanceId: "efx_reflect", params: { of: 8, n: 1, d: 1 }, appliedTurn: 0,
    });
    const r = play(pack, s);
    expect(tags(r.events as Ev[])).toEqual(["hit", "drain", "echo", "reflect", "echo", "heal", "stage"]);
    const hit = (r.events as Ev[]).find((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined)!;
    expect(hit.detail.amount).toBe(40);
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
  });

  it("flatEcho 50% 的第二笔等于本击伤害的一半", () => {
    const pack = fresh();
    strike(pack, [
      { op: "damage", kind: "fixed", power: 80, target: "opponent" },
      { op: "applyFlatEcho", flatEcho: { pct: 50 } },
    ]);
    const r = play(pack, battle(pack));
    const blows = (r.events as Ev[]).filter((e) => e.type === "damage" && e.detail.side === "p2");
    expect(blows[0]?.detail.amount).toBe(80);
    expect(blows[1]?.detail.cause).toBe("echo");
    expect(blows[1]?.detail.amount).toBe(40);
  });

  it("healOnHit 被 hpCapOf 卡住，不按最大体力分数多回", () => {
    const pack = fresh();
    strike(pack, [
      { op: "damage", kind: "fixed", power: 10, target: "opponent" },
      { op: "applyHealOnHit", healOnHit: { numerator: 1, denominator: 2 } },
    ]);
    const s = battle(pack);
    const cap = s.sides.p1.unit.base.hp;
    s.sides.p1.unit.currentHp = cap - 3;
    const r = play(pack, s);
    const heal = (r.events as Ev[]).find((e) => e.type === "heal" && e.detail.source === "heal_on_hit")!;
    expect(heal.detail.amount).toBe(3);
    expect(r.state.sides.p1.unit.currentHp).toBe(cap);
  });

  it("stageOnHit 同时把防御和特防打到 -1", () => {
    const pack = fresh();
    strike(pack, [
      { op: "damage", kind: "fixed", power: 10, target: "opponent" },
      { op: "applyStageOnHit", stageOnHit: [{ stat: "def", delta: -1 }, { stat: "sdf", delta: -1 }] },
    ]);
    const r = play(pack, battle(pack));
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
    expect(r.state.sides.p2.unit.stages.sdf).toBe(-1);
  });
});
