/**
 * 承伤上限的溢出段反弹。「自身下N次受到的攻击伤害不超过M，并反弹给对手原本超出部分P%的百分比伤害」。
 *
 * 语义：先把这次伤害钳到 M，再把钳掉的那一段（原始伤害 − M，小于 0 则 0）的 P% 打回对手。
 * 基数必须是**钳前**的伤害（结算点 `ops/damage.ts` 的承伤上限那一处，读 `dmg_cap.params.excessPct`）。
 * 不能拿 `reflect_dmg` 去反弹钳完之后的 `dmg`——cap 0 / 伤害≤cap 时那个基数恒为 0，是静默错。
 * 也不能用回血溢出（`flatSelfOverflowPct` 读的是回复封顶外溢，与承伤上限无关）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { compilePack, initBattle, applyTurn, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));
const SEED = "abababababababababababababababab";

/** 精确固伤招（按数值命名）——固定伤害不吃属性/克制，钳制前后的数字都是整数。 */
const MOVES = [
  { id: "r5a-fixed60", name: "微击", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 60, target: "opponent" }] },
  { id: "r5a-fixed100", name: "重击", pp: 20, priority: 0, type: "草", effects: [{ op: "damage", kind: "fixed", power: 100, target: "opponent" }] },
];

function buildPack(): FrozenPack {
  return compilePack({
    ruleset: read("rulesets/synthetic-v2.json"),
    pack: read("synthetic-v2/pack.json"),
    units: { units: read("synthetic-v2/units.json").units.map((u: { moveIds: string[] }) => ({ ...u, moveIds: [...new Set([...u.moveIds, ...MOVES.map((m) => m.id)])] })) },
    moves: { moves: [...read("synthetic-v2/moves.json").moves, ...MOVES] },
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    soulmarks: read("synthetic-v2/soulmarks.json"),
    seals: read("seals/seals.json"),
    items: read("synthetic-v2/items.json"),
  });
}
const PACK = buildPack();

const act = (id: string, key: string) => ({ actionId: `act_${id}`, origin: "player" as const, idempotencyKey: key });

/** p1 出招、p2 不出伤害招。魂印/复活清掉，只留承伤上限这一条变量。 */
function battle(capParams: Record<string, number>): CoreState {
  const s = initBattle(PACK, { battleId: "btl_r5a", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
  for (const side of ["p1", "p2"] as const) {
    delete s.sides[side].unit.soul;
    s.sides[side].unit.revives = 0;
  }
  s.sides.p2.unit.effects.push({
    kind: "modifier", label: "dmg_cap", at: "dmgCap", effectInstanceId: "efx_r5a_cap",
    params: capParams, appliedTurn: 0,
  });
  return s;
}

function play(pack: FrozenPack, s: CoreState, move: string, key: string): CoreState {
  const r = applyTurn(pack, s, { p1: act(move, key), p2: act("syn-attr", `${key}b`) });
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r.state;
}

type Ev = { type: string; detail: Record<string, unknown> };
const hitOnP2 = (evs: Ev[]): number[] =>
  evs.filter((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined).map((e) => e.detail.amount as number);
const reflectOnP1 = (evs: Ev[]): number[] =>
  evs.filter((e) => e.type === "damage" && e.detail.side === "p1" && e.detail.cause === "reflect").map((e) => e.detail.amount as number);

describe("承伤上限溢出段反弹", () => {
  it("cap 0：整击都是溢出段，按 P% 全数反弹给对手", () => {
    const s0 = battle({ cap: 0, count: 1, excessPct: 100 });
    const hpBefore = s0.sides.p1.unit.currentHp;
    const r = applyTurn(PACK, s0, { p1: act("r5a-fixed60", "r5a0a0000"), p2: act("syn-attr", "r5a0b0000") });
    if (!r.ok) throw new Error(r.fault.message);
    expect(hitOnP2(r.events as Ev[])).toEqual([0]); // 伤害全被钳掉
    expect(reflectOnP1(r.events as Ev[])).toEqual([60]); // 溢出段 60-0，P=100 → 60 打回攻击方
    expect(r.state.sides.p2.unit.currentHp).toBe(s0.sides.p2.unit.currentHp);
    expect(r.state.sides.p1.unit.currentHp).toBe(hpBefore - 60);
  });

  it("cap 等于伤害：溢出段为 0，不产生反弹事件", () => {
    const s0 = battle({ cap: 60, count: 1, excessPct: 100 });
    const hpBefore = s0.sides.p1.unit.currentHp;
    const r = applyTurn(PACK, s0, { p1: act("r5a-fixed60", "r5a1a0000"), p2: act("syn-attr", "r5a1b0000") });
    if (!r.ok) throw new Error(r.fault.message);
    expect(hitOnP2(r.events as Ev[])).toEqual([60]); // 没有超出的那一段
    expect(reflectOnP1(r.events as Ev[])).toEqual([]);
    expect(r.state.sides.p1.unit.currentHp).toBe(hpBefore);
  });

  it("伤害大于 cap：钳到 cap，超出部分按 P% 反弹", () => {
    // P=100：100-60=40 全额打回
    const s0 = battle({ cap: 60, count: 1, excessPct: 100 });
    const hpBefore = s0.sides.p1.unit.currentHp;
    const r0 = applyTurn(PACK, s0, { p1: act("r5a-fixed100", "r5a2a0000"), p2: act("syn-attr", "r5a2b0000") });
    if (!r0.ok) throw new Error(r0.fault.message);
    expect(hitOnP2(r0.events as Ev[])).toEqual([60]);
    expect(reflectOnP1(r0.events as Ev[])).toEqual([40]);
    expect(r0.state.sides.p1.unit.currentHp).toBe(hpBefore - 40);

    // P=60：40×60% = 24
    const s1 = battle({ cap: 60, count: 1, excessPct: 60 });
    const hp1 = s1.sides.p1.unit.currentHp;
    const r1 = applyTurn(PACK, s1, { p1: act("r5a-fixed100", "r5a3a0000"), p2: act("syn-attr", "r5a3b0000") });
    if (!r1.ok) throw new Error(r1.fault.message);
    expect(hitOnP2(r1.events as Ev[])).toEqual([60]);
    expect(reflectOnP1(r1.events as Ev[])).toEqual([24]);
    expect(r1.state.sides.p1.unit.currentHp).toBe(hp1 - 24);
  });

  it("没声明溢出比例的承伤上限窗照旧：钳到 cap，不反弹（旧句回归）", () => {
    const s0 = battle({ cap: 60, count: 1 });
    const hpBefore = s0.sides.p1.unit.currentHp;
    const r = applyTurn(PACK, s0, { p1: act("r5a-fixed100", "r5a4a0000"), p2: act("syn-attr", "r5a4b0000") });
    if (!r.ok) throw new Error(r.fault.message);
    expect(hitOnP2(r.events as Ev[])).toEqual([60]);
    expect(reflectOnP1(r.events as Ev[])).toEqual([]);
    expect(r.state.sides.p1.unit.currentHp).toBe(hpBefore);
  });

  it("反弹打回的是百分比伤害（damageKind=percent），来源记 reflect", () => {
    const s0 = battle({ cap: 30, count: 1, excessPct: 100 });
    const r = applyTurn(PACK, s0, { p1: act("r5a-fixed100", "r5a5a0000"), p2: act("syn-attr", "r5a5b0000") });
    if (!r.ok) throw new Error(r.fault.message);
    const ev = (r.events as Ev[]).find((e) => e.type === "damage" && e.detail.cause === "reflect")!;
    expect(ev.detail.amount).toBe(70);
    expect(ev.detail.damageKind).toBe("percent");
    expect(ev.detail.side).toBe("p1");
  });
});
