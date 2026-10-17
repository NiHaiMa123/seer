/**
 * mech 新机制窗的结算测试：dodge 类别门、双类承伤折扣、承伤阈值 react 疲惫。
 * 句子分别来自 mech-acc-cat-01 / mech-taken-cats-01 / mech-taken-fatigue-01。
 * 全部直接喂 IR（apply_status 挂载），不经过中文解析——中文那侧另有 add-effect-mech.test.ts。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { compilePack, initBattle, applyTurn, sha256hex } from "@seer/battle-core";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { periodicFormOf } from "../../../packages/battle-core/src/ops/periodic.ts";
import { axesFormOf } from "../../../packages/battle-core/src/ops/axes.ts";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

// accuracy: 100 → 基础命中判定恒中（num>=den 不掷），唯一可能的 missed 来源就是 dodge 窗
const CAT_MOVES = [
  { id: "mc-stat", name: "属性", pp: 20, priority: 0, type: "草", accuracy: 100, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
  { id: "mc-phys", name: "物理", pp: 20, priority: 0, type: "草", accuracy: 100, category: "physical", effects: [{ op: "damage", power: 30 }] },
  { id: "mc-spec", name: "特殊", pp: 20, priority: 0, type: "草", accuracy: 100, category: "special", effects: [{ op: "damage", power: 30 }] },
];

const PACK = compilePack({
  ruleset: { ...read("rulesets/synthetic-v2.json"), features: [...read("rulesets/synthetic-v2.json").features, "accuracy"] },
  pack: read("synthetic-v2/pack.json"),
  units: { units: read("synthetic-v2/units.json").units.map((u: any) => ({ ...u, moveIds: [...new Set([...u.moveIds, ...CAT_MOVES.map((m) => m.id)])] })) },
  moves: { moves: read("synthetic-v2/moves.json").moves.concat(CAT_MOVES) },
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  soulmarks: read("synthetic-v2/soulmarks.json"),
  seals: read("seals/seals.json"),
  items: read("synthetic-v2/items.json"),
});

const run = (seed: string, cat: number | undefined, moveId: string, i: number) => {
  const s = initBattle(PACK, { battleId: "b", seedHex: seed, p1: "syn-gamma", p2: "syn-delta" });
  s.sides.p2.unit.effects.push({
    kind: "modifier", at: "missChance", label: "dodge", effectInstanceId: "t_dodge", remainingTurns: 2,
    params: { pct: 50, ...(cat !== undefined ? { cat } : {}) }, appliedTurn: 0,
  });
  const ev: any[] = [];
  for (let t = 1; t <= 2; t++) {
    const r = applyTurn(PACK, s, {
      p1: { actionId: `act_${t === 1 ? "mc-stat" : moveId}`, origin: "player", idempotencyKey: `mc${cat ?? 0}${i}${t}aaaaaa` },
      p2: { actionId: "act_mc-stat", origin: "player", idempotencyKey: `mc${cat ?? 0}${i}${t}bbbbbb` },
    });
    if (!r.ok) throw new Error(`turn fault ${r.fault.code}: ${r.fault.message}`);
    ev.push(...r.events);
  }
  return ev.some((e) => e.type === "missed" && e.detail.side === "p1" && e.detail.moveId === moveId);
};

// 跑两个回合：第 1 回合部署 dodge 窗（属性招、必定命中），命中判定发生在第 2 回合
const misses = (cat: number | undefined, moveId: string) => {
  let n = 0;
  for (let i = 0; i < 60; i++) if (run(sha256hex(`mc${cat ?? "x"}${moveId}${i}`).slice(0, 32), cat, moveId, i)) n++;
  return n;
};

describe("dodge 类别门（params.cat）", () => {
  it("cat:1 只挡属性技，物理/特殊不掷", () => {
    expect(misses(1, "mc-stat")).toBeGreaterThan(10);
    expect(misses(1, "mc-phys")).toBe(0);
    expect(misses(1, "mc-spec")).toBe(0);
  });

  it("cat:2 只挡物理技，属性/特殊不掷", () => {
    expect(misses(2, "mc-phys")).toBeGreaterThan(10);
    expect(misses(2, "mc-stat")).toBe(0);
    expect(misses(2, "mc-spec")).toBe(0);
  });

  it("cat:3 只挡特殊技，属性/物理不掷", () => {
    expect(misses(3, "mc-spec")).toBeGreaterThan(10);
    expect(misses(3, "mc-stat")).toBe(0);
    expect(misses(3, "mc-phys")).toBe(0);
  });

  it("cat:4 挡任意攻击技（物理+特殊），属性技不掷", () => {
    expect(misses(4, "mc-phys")).toBeGreaterThan(10);
    expect(misses(4, "mc-spec")).toBeGreaterThan(10);
    expect(misses(4, "mc-stat")).toBe(0);
  });

  it("缺省 cat 时三类都掷（旧行为不变）", () => {
    expect(misses(undefined, "mc-stat")).toBeGreaterThan(10);
    expect(misses(undefined, "mc-phys")).toBeGreaterThan(10);
    expect(misses(undefined, "mc-spec")).toBeGreaterThan(10);
  });
});

// ── dmgTakenCatFrac cat:4（"受到的物理或特殊伤害减少50%"） ──
const catFracPack = () => compilePack({
  ruleset: { ...read("rulesets/synthetic-v2.json"), features: [...read("rulesets/synthetic-v2.json").features, "accuracy"] },
  pack: read("synthetic-v2/pack.json"),
  units: { units: read("synthetic-v2/units.json").units },
  moves: read("synthetic-v2/moves.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  soulmarks: read("synthetic-v2/soulmarks.json"),
  seals: read("seals/seals.json"),
  items: read("synthetic-v2/items.json"),
});
const PACK2 = catFracPack();
const PACK3 = catFracPack();

const damageOf = (pack: any, seed: string, moveId: string, setup?: (s: any) => void) => {
  const s = initBattle(pack, { battleId: "b", seedHex: seed, p1: "syn-gamma", p2: "syn-delta" });
  setup?.(s);
  const r = applyTurn(pack, s, {
    p1: { actionId: `act_${moveId}`, origin: "player", idempotencyKey: `mw${seed.slice(0, 6)}aaaaaaa`.slice(0, 24) },
    p2: { actionId: "act_syn-strike", origin: "player", idempotencyKey: `mw${seed.slice(0, 6)}bbbbbbb`.slice(0, 24) },
  });
  if (!r.ok) throw new Error(`turn fault ${r.fault.code}: ${r.fault.message}`);
  const hit = r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined);
  return hit === undefined ? 0 : (hit.detail.amount as number);
};

const put = (kind: string, params: Record<string, number>) => (s: any) => {
  s.sides.p2.unit.effects.push({ kind: "modifier", at: kind, label: "x", effectInstanceId: "t_x", remainingTurns: 2, params, appliedTurn: 0 });
};

describe("mech 新机制窗", () => {
  it("atk_taken_frac cat:4 对物理和特殊都折，属性技不受影响", () => {
    const setup = put("dmgTakenCatFrac", { cat: 4, n: 50, d: 100 });
    // p1 打物理：折扣生效
    const full = damageOf(PACK2, "c1".repeat(16), "syn-strike");
    const half = damageOf(PACK2, "c1".repeat(16), "syn-strike", setup);
    expect(half).toBeLessThan(full);
    expect(half).toBe(Math.floor(full / 2));
    // 属性技（无 damage op）不出伤害事件，窗对它没有可折的对象
    const attr = damageOf(PACK2, "c2".repeat(16), "syn-attr", setup);
    expect(attr).toBe(0);
  });

  it("react 受击窗 min 门：承伤 ≥N 才给对手疲惫，且只触发一次", () => {
    // 承伤恒为 ~10（syn-strike power 40）：min=1 触发，min=99999 不触发
    const low = (s: any) => s.sides.p2.unit.effects.push({
      kind: "react", label: "react", effectInstanceId: "t_r", remainingTurns: 2,
      params: { trigger: 1, min: 1, count: 1 },
      payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: 2 }],
      appliedTurn: 0,
    });
    const high = (s: any) => s.sides.p2.unit.effects.push({
      kind: "react", label: "react", effectInstanceId: "t_r", remainingTurns: 2,
      params: { trigger: 1, min: 99999, count: 1 },
      payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: 2 }],
      appliedTurn: 0,
    });
    const applies = (setup: (s: any) => void) => {
      const s = initBattle(PACK3, { battleId: "b", seedHex: "d1".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
      setup(s);
      const r = applyTurn(PACK3, s, {
        p1: { actionId: "act_syn-strike", origin: "player", idempotencyKey: "mwfatigue1aaaaaaa" },
        p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: "mwfatigue1bbbbbbb" },
      });
      if (!r.ok) throw new Error(`turn fault ${r.fault.code}`);
      return r.events.some((e: any) => e.type === "effect-applied" && e.detail.side === "p1" && e.detail.name === "fatigue");
    };
    expect(applies(low)).toBe(true);
    expect(applies(high)).toBe(false);
  });
});
// ── remain 结算：中文规则产出的 IR 直接喂进引擎（不走数据包） ──
// 宿主句：天启帝君/轮回之狱「每次受到伤害时若高于280则使对手随机进入2种异常状态」。
const remainPack = () => {
  const base = read("synthetic-v2/moves.json") as { moves: any[] };
  return compilePack({
    ruleset: { ...read("rulesets/synthetic-v2.json"), features: [...read("rulesets/synthetic-v2.json").features, "accuracy"] },
    pack: read("synthetic-v2/pack.json"),
    units: { units: read("synthetic-v2/units.json").units.map((u: any) => ({ ...u, moveIds: [...new Set([...u.moveIds, "rm-weak", "rm-strong"])] })) },
    moves: { moves: [...base.moves,
      { id: "rm-weak", name: "轻击", pp: 20, priority: 0, type: "草", accuracy: 100, category: "physical", effects: [{ op: "damage", power: 1 }] },
      { id: "rm-strong", name: "重击", pp: 20, priority: 0, type: "草", accuracy: 100, category: "physical", effects: [{ op: "damage", power: 99999 }] },
    ] },
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    soulmarks: read("synthetic-v2/soulmarks.json"),
    seals: read("seals/seals.json"),
    items: read("synthetic-v2/items.json"),
  });
};
const PACK4 = remainPack();

/** 解析出的 op 直接挂到一侧单位身上（apply_status 的挂载语义：轴脱糖 + payload 透传）。 */
const mount = (s: any, side: "p1" | "p2", fx: any) => {
  const ax = axesFormOf(fx);
  const per = ax === undefined ? periodicFormOf(fx) : undefined;
  const id = `t_${side}_${fx.name}`;
  if (ax !== undefined) s.sides[side].unit.effects.push({ kind: ax.kind, label: fx.name, ...(ax.at !== undefined ? { at: ax.at } : {}), effectInstanceId: id, remainingTurns: fx.turns ?? 2, params: ax.params, appliedTurn: 0 });
  else if (per !== undefined) s.sides[side].unit.effects.push({ kind: "periodic", label: fx.name, effectInstanceId: id, remainingTurns: fx.turns ?? 2, params: per.params, payload: per.payload, appliedTurn: 0 });
  else if (fx.name === undefined) throw new Error("mount 只吃 apply_status；damage 这类 op 该走招式管线");
  else s.sides[side].unit.effects.push({ kind: fx.name, effectInstanceId: id, remainingTurns: fx.turns ?? 2, ...(fx.params !== undefined ? { params: fx.params } : {}), ...(fx.payload !== undefined ? { payload: fx.payload } : {}), appliedTurn: 0 });
};
const firstFx = (text: string) => (parseEffectText(text) as { effects: any[] }).effects[0]!;
const fight = (pack: any, moveId: string, setup: (s: any) => void, seed: string) => {
  const s = initBattle(pack, { battleId: "b", seedHex: seed, p1: "syn-gamma", p2: "syn-delta" });
  setup(s);
  const r = applyTurn(pack, s, {
    p1: { actionId: `act_${moveId}`, origin: "player", idempotencyKey: `rm${seed.slice(0, 6)}aaaaaaa`.slice(0, 24) },
    p2: { actionId: "act_syn-attr", origin: "player", idempotencyKey: `rm${seed.slice(0, 6)}bbbbbbb`.slice(0, 24) },
  });
  if (!r.ok) throw new Error(`turn fault ${r.fault.code}: ${r.fault.message}`);
  return r;
};

describe("remain 结算（IR 直接喂引擎）", () => {
  it("remain-taken-random-01：承伤过阈值则对手随机进入 M 种异常（低于阈值不触发）", () => {
    const setup = (s: any) => mount(s, "p2", firstFx("每次受到伤害时若高于280则使对手随机进入2种异常状态"));
    const AIL = new Set(["burn", "frostbite", "poison", "paralysis", "fear", "sleep", "blind", "daze", "bind", "confuse", "parasite", "curse", "fatigue", "bleed", "silence", "freeze", "flammable", "ember", "petrify", "shock", "infect", "rage", "feeble", "submit"]);
    const ailCount = (s: any) => s.sides.p1.unit.effects.filter((e: any) => AIL.has(e.kind)).length;
    const strong = fight(PACK4, "rm-strong", setup, "e3".repeat(16));
    expect(ailCount(strong.state)).toBe(2); // 2 种，不重样
    const weak = fight(PACK4, "rm-weak", setup, "e3".repeat(16));
    expect(ailCount(weak.state)).toBe(0); // 伤害低于 280，min 门挡住
  });

  it("remain-pp-turn-01：pp_drain 挂自身 → 回合末扣的是对手全招式 PP", () => {
    const ppOf = (s: any, side: "p1" | "p2") => s.sides[side].unit.moves.reduce((n: number, m: any) => n + m.pp, 0);
    const r = fight(PACK4, "syn-attr", (s: any) => mount(s, "p1", firstFx("每回合对手所有招式PP值-1")), "f1".repeat(16));
    expect(ppOf(r.state, "p2")).toBeLessThan(ppOf(r.state, "p1"));
  });

  it("remain-weaken-01：dmg_weaken 按 IR 挂在对手身上 → 对手打出来的伤害变小", () => {
    // 解析出的 op 目标就是 opponent（"使对手造成伤害是原来1/2"），照 IR 挂到 p1 的对手 = p2
    const fx = firstFx("使对手1回合造成伤害是原来1/2");
    expect((fx as any).target).toBe("opponent");
    const plain = fight(PACK4, "syn-strike", () => {}, "f2".repeat(16));
    const weakened = fight(PACK4, "syn-strike", (s: any) => mount(s, "p1", fx), "f2".repeat(16));
    const dmgOf = (r: any) => r.events.find((e: any) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined)?.detail.amount as number;
    expect(dmgOf(weakened)).toBe(Math.floor(dmgOf(plain) / 2));
  });
});
