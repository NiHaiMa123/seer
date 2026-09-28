/**
 * 属性克制系统（v2 typechart）：
 * - effectivenessOf：单属性/双属性（声明序+逆序回退）/免疫 0
 * - 引擎结算：standard/true 吃 eff×STAB；fixed/percent/struggle 不受影响
 * - 事件：damage detail 带 moveType/eff/stab（无表包不带——v1 字节不变回归）
 * - loader：有表缺 types/type、未知属性、无表带 types 全部拒绝
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, effectivenessOf, initBattle, loadPackFromDir, PackLoadError, type CoreState, type CoreEvent } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "a".repeat(32);
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-t` });
const ok = (r: ReturnType<typeof applyTurn>): CoreState => {
  if (!r.ok) throw new Error(`fault ${r.fault.reason}`);
  return r.state;
};
const evs = (r: ReturnType<typeof applyTurn>, t: string): CoreEvent[] =>
  r.ok ? r.events.filter((e) => e.type === t) : [];
const dg = () => initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });

describe("effectivenessOf 查表", () => {
  const chart = PACK.typeChart!;
  it("单属性：火→草=2、草→水=2、火→水=0.5", () => {
    expect(effectivenessOf(chart, "火", ["草"])).toBe(32);
    expect(effectivenessOf(chart, "草", ["水"])).toBe(32);
    expect(effectivenessOf(chart, "火", ["水"])).toBe(8);
  });
  it("双属性按声明序键查：战斗→暗影龙=1.25、圣灵→暗影龙=0.75", () => {
    expect(effectivenessOf(chart, "战斗", ["暗影", "龙"])).toBe(20);
    expect(effectivenessOf(chart, "圣灵", ["暗影", "龙"])).toBe(12);
  });
  it("免疫：电→地面=0、次元→暗影=0", () => {
    expect(effectivenessOf(chart, "电", ["地面"])).toBe(0);
    expect(effectivenessOf(chart, "次元", ["暗影"])).toBe(0);
  });
  it("未列出的组合 → 16（1.0 中性）", () => {
    expect(effectivenessOf(chart, "火", ["电"])).toBe(16);
  });
  it("逆序回退：声明序查不到时试反序双属性键", () => {
    // 若 "AB" 不在行内而 "BA" 在 → 命中反序；构造极小 chart 验证回退路径
    const mini = new Map([["火", new Map([["BA", 32]])]]);
    expect(effectivenessOf(mini, "火", ["A", "B"])).toBe(32);
    expect(effectivenessOf(mini, "火", ["B", "A"])).toBe(32);
  });
});

describe("伤害结算 × 属性", () => {
  it("克制招式伤害放大：飞行 syn-jab 打草（eff=2）", () => {
    // gamma(45atk) jab(20power) → 镜像 gamma(28def)：base=floor(20*45/56)=16，eff16=32 → 32
    const s = initBattle(PACK, { battleId: "btl_x", seedHex: SEED, p1: "syn-gamma", p2: "syn-gamma" });
    const r = applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.eff16).toBe(32);
    expect(dmg.detail.moveType).toBe("飞行");
    expect(dmg.detail.amount).toBe(32);
  });
  it("双属性守方：syn-strike（战斗）→ 暗影龙 eff=1.25", () => {
    // gamma strike(40) vs epsilon(40def)：base=floor(40*45/80)=22，×1.25=27
    const r = applyTurn(PACK, dg(), { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.eff16).toBe(20);
    expect(dmg.detail.amount).toBe(27);
  });
  it("STAB：水系 delta 打水系 syn-slam ×1.5", () => {
    // delta(55atk) slam(30,true) vs epsilon(40def, stage0)：base=floor(30*55/80)=20，eff16=16，stab → ×1.5=30
    const s = initBattle(PACK, { battleId: "btl_s", seedHex: SEED, p1: "syn-delta", p2: "syn-epsilon" });
    const r = applyTurn(PACK, s, { p1: act("act_syn-slam"), p2: act("act_syn-strike") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.eff16).toBe(16);
    expect(dmg.detail.stab).toBe(true);
    expect(dmg.detail.amount).toBe(30);
  });
  it("无 STAB 时 stab=false", () => {
    const r = applyTurn(PACK, dg(), { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.stab).toBe(false);
  });
  it("免疫 eff=0 → 伤害 0 且不致死", () => {
    // 内存夹具：电系招式打地面守方
    const pack = typedFixture({
      atkType: "电",
      defTypes: ["地面"],
      effects: [{ op: "damage", power: 40 }],
    });
    const s = initBattle(pack, { battleId: "btl_i", seedHex: SEED, p1: "u1", p2: "u2" });
    const r = applyTurn(pack, s, { p1: act("act_m"), p2: act("act_m") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.eff16).toBe(0);
    expect(dmg.detail.amount).toBe(0);
    expect(r.ok && r.state.sides.p2.unit.currentHp).toBe(100);
  });
  it("percent/fixed 不吃属性：syn-blast（火,percent）打草还是 25%", () => {
    // gamma blast percent25 vs gamma(150hp)：floor(25*150/100)=37——草弱火也不放大
    const s = initBattle(PACK, { battleId: "btl_p", seedHex: SEED, p1: "syn-gamma", p2: "syn-gamma" });
    const r = applyTurn(PACK, s, { p1: act("act_syn-blast"), p2: act("act_syn-blast") });
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.amount).toBe(37);
    expect(dmg.detail.eff16).toBeUndefined();
  });
  it("v1 包（无表）事件不带 eff/moveType —— 字节级兼容", () => {
    const v1 = loadPackFromDir(CONTENT, "synthetic-v1");
    const s = initBattle(v1, { battleId: "btl_v1", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta" });
    const r = applyTurn(v1, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    const dmg = evs(r, "damage")[0]!;
    expect(dmg.detail.eff16).toBeUndefined();
    expect(dmg.detail.moveType).toBeUndefined();
  });
});

describe("loader 属性校验", () => {
  const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));
  const base = () => ({
    ruleset: read("rulesets/synthetic-v2.json"),
    typeChart: read("rulesets/typechart.json"),
    pack: { packId: "x", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
    units: { units: [{ id: "u", name: "U", base: { hp: 10, atk: 1, def: 1, spd: 1 }, types: ["火"], moveIds: ["m"] }] },
    moves: { moves: [{ id: "m", name: "M", type: "火", pp: 5, priority: 0, effects: [{ op: "damage", power: 1 }] }] },
  });
  it("有表缺 unit.types → 拒", () => {
    const c = base();
    delete (c.units.units[0] as Record<string, unknown>)["types"];
    expect(() => compilePack(c)).toThrow(/lacks types/);
  });
  it("有表缺 move.type → 拒", () => {
    const c = base();
    delete (c.moves.moves[0] as Record<string, unknown>)["type"];
    expect(() => compilePack(c)).toThrow(/lacks type/);
  });
  it("招式属性不是表中行 → 拒", () => {
    const c = base();
    (c.moves.moves[0] as Record<string, unknown>)["type"] = "不存在属性";
    expect(() => compilePack(c)).toThrow(/not an attack row/);
  });
  it("单位属性组合不在表内 → 拒", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["types"] = ["火", "不存在的"];
    expect(() => compilePack(c)).toThrow(/unknown in type chart/);
  });
  it("无表 ruleset 带 types/type → 拒（防静默忽略）", () => {
    const c = base();
    delete (c.ruleset as Record<string, unknown>)["typeChartFile"];
    delete (c.ruleset as Record<string, unknown>)["stabMultiplier"];
    delete (c as Record<string, unknown>)["typeChart"];
    (c.ruleset as Record<string, unknown>)["rulesetId"] = "synthetic-v1";
    (c.pack as Record<string, unknown>)["rulesetId"] = "synthetic-v1";
    expect(() => compilePack(c)).toThrow(/no type chart/);
  });
  it("换表 → rulesetHash 变（钉版语义）", () => {
    const a = compilePack(base());
    const c2 = base();
    (c2.typeChart.attack["火"] as Record<string, number>)["草"] = 0.5;
    const b = compilePack(c2);
    expect(b.rules.rulesetHash).not.toBe(a.rules.rulesetHash);
  });
});

/** 最小内存夹具：双单位互殴，攻方招式属性/守方属性可参数化。 */
function typedFixture(opts: { atkType: string; defTypes: string[]; effects: unknown[] }) {
  return compilePack({
    ruleset: JSON.parse(readFileSync(join(CONTENT, "rulesets", "synthetic-v2.json"), "utf8")),
    typeChart: JSON.parse(readFileSync(join(CONTENT, "rulesets", "typechart.json"), "utf8")),
    pack: { packId: "fx", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
    units: {
      units: [
        { id: "u1", name: "U1", base: { hp: 100, atk: 50, def: 20, spd: 50 }, types: ["电"], moveIds: ["m"] },
        { id: "u2", name: "U2", base: { hp: 100, atk: 50, def: 20, spd: 40 }, types: opts.defTypes, moveIds: ["m"] },
      ],
    },
    moves: { moves: [{ id: "m", name: "M", type: opts.atkType, pp: 5, priority: 0, effects: opts.effects }] },
  });
}
