/**
 * six-stat 系统（statModel: "six-stat"）：
 * - deriveStats：HP/五维公式、等级缩放、性格 ±10%、IV/EV 边界与地板
 * - loader：ivs≤31、evs 单项≤255 总≤510、nature 必须在表内、伤害招必带 category
 * - 引擎：physical 走 atk/def、special 走 spa/sdf、随机系数 217..255 确定性回放
 * - 投影：己方 stats+level 可见，对手只出 level
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, deriveStats, initBattle, loadPackFromDir, type CoreEvent, type CoreState } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "a".repeat(32);
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, sdf: 31, spd: 31 };
const EV0 = { hp: 0, atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 };
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-s` });
const ok = (r: ReturnType<typeof applyTurn>): CoreState => {
  if (!r.ok) throw new Error(`fault ${r.fault.reason}`);
  return r.state;
};
const evsOf = (r: ReturnType<typeof applyTurn>, t: string): CoreEvent[] =>
  r.ok ? r.events.filter((e) => e.type === t) : [];

describe("deriveStats 面板推导", () => {
  const g = { hp: 120, atk: 60, def: 80, spa: 95, sdf: 85, spd: 70 };
  it("Lv100 无性格：HP=2B+IV+EV/4+110，其余=(2B+IV+EV/4)+5", () => {
    // gamma EV 252hp/252spa/6spd：hp=(240+31+63)+110=444；spa=(190+31+63)+5=289
    const s = deriveStats(g, { level: 100, ivs: IV31, evs: { hp: 252, atk: 0, def: 0, spa: 252, sdf: 0, spd: 6 } });
    expect(s).toEqual({ hp: 444, atk: 156, def: 196, spa: 289, sdf: 206, spd: 177 });
  });
  it("性格 ±10%：保守(+特攻-攻) → spa317/atk140", () => {
    const s = deriveStats(g, { level: 100, ivs: IV31, evs: { ...EV0, hp: 252, spa: 252, spd: 6 }, nature: { up: "spa", down: "atk" } });
    expect(s.spa).toBe(317); // floor(289×1.1)
    expect(s.atk).toBe(140); // floor(156×0.9)
    expect(s.hp).toBe(444); // 体力不受性格影响
  });
  it("等级缩放：Lv50 ≈ 半值 + 线性项", () => {
    const s = deriveStats(g, { level: 50, ivs: IV31, evs: EV0 });
    expect(s.hp).toBe(195); // floor(271×0.5)+50+10=195
    expect(s.atk).toBe(80); // floor(151×0.5)+5=80
  });
  it("IV 0 vs 31 差 31 点缩放值", () => {
    const hi = deriveStats(g, { level: 100, ivs: IV31, evs: EV0 });
    const lo = deriveStats(g, { level: 100, ivs: EV0, evs: EV0 });
    expect(hi.atk - lo.atk).toBe(31);
    expect(hi.hp - lo.hp).toBe(31);
  });
});

describe("性格×努力值「省点」阈值（EV/4 小数穿过 ×1.1 单次取整）", () => {
  // 4399 解析结论：y=(种族个位×2+个体个位) mod 10 ∈{4,5,6} 时极限需 255；否则 254/253 即封顶
  const up = (b: number, ev: number) =>
    deriveStats(
      { hp: 1, atk: b, def: 1, spa: 1, sdf: 1, spd: 1 },
      { level: 100, ivs: IV31, evs: { ...EV0, atk: ev }, nature: { up: "atk", down: "def" } },
    ).atk;
  it("种族个位=2（y=5）：255 才到顶，254 差 1", () => {
    expect(up(92, 254)).toBe(311);
    expect(up(92, 255)).toBe(312);
  });
  it("种族个位=0（y=1）：253 即封顶（≡254≡255），省下点数", () => {
    expect(up(90, 252)).toBe(306);
    expect(up(90, 253)).toBe(307);
    expect(up(90, 254)).toBe(307);
    expect(up(90, 255)).toBe(307);
  });
  it("中性项：252≡255（小数进不了面板），体力同理", () => {
    const flat = (ev: number) =>
      deriveStats(
        { hp: 80, atk: 90, def: 1, spa: 1, sdf: 1, spd: 1 },
        { level: 100, ivs: IV31, evs: { ...EV0, hp: ev, atk: ev } },
      );
    expect(flat(252).atk).toBe(flat(255).atk);
    expect(flat(252).hp).toBe(flat(255).hp);
  });
  it("单项非整数阈值外无回退：EV 不可为负/超 255 由 loader 拦截", () => {
    expect(up(90, 0)).toBeLessThan(up(90, 4));
  });
});

describe("loader six-stat 校验", () => {
  const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));
  const base = (): any => ({
    ruleset: read("rulesets/synthetic-v2.json"),
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    pack: { packId: "x", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
    units: { units: [{ id: "u", name: "U", base: { hp: 10, atk: 1, def: 1, spa: 1, sdf: 1, spd: 1 }, types: ["火"], moveIds: ["m"] }] },
    moves: { moves: [{ id: "m", name: "M", type: "火", category: "physical", pp: 5, priority: 0, effects: [{ op: "damage", power: 1 }] }] },
  });
  it("IV>31 → 拒", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["ivs"] = { hp: 32, atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 };
    expect(() => compilePack(c)).toThrow(/ivs\.hp=32 exceeds 31/);
  });
  it("EV 总和 >510 → 拒", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["evs"] = { hp: 255, atk: 255, def: 1, spa: 0, sdf: 0, spd: 0 };
    expect(() => compilePack(c)).toThrow(/evs total 511 exceeds 510/);
  });
  it("EV 单项 255 合法", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["evs"] = { hp: 255, atk: 255, def: 0, spa: 0, sdf: 0, spd: 0 };
    expect(() => compilePack(c)).not.toThrow();
  });
  it("未知性格 → 拒", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["nature"] = "不存在的性格";
    expect(() => compilePack(c)).toThrow(/not in natures table/);
  });
  it("缺 spa/sdf → 拒", () => {
    const c = base();
    (c.units.units[0].base as Record<string, unknown>)["spa"] = undefined;
    expect(() => compilePack(c)).toThrow(/lacks spa\/sdf/);
  });
  it("伤害招缺 category → 拒；非伤害招带 category → 拒", () => {
    const c = base();
    delete (c.moves.moves[0] as Record<string, unknown>)["category"];
    expect(() => compilePack(c)).toThrow(/no category/);
    const c2 = base();
    c2.moves.moves[0].effects = [{ op: "heal", numerator: 1, denominator: 2, target: "self" }];
    expect(() => compilePack(c2)).toThrow(/sets category but deals no scaled damage/);
  });
  it("非 six-stat 规则下携带六维字段 → 拒", () => {
    const c = base();
    delete (c.ruleset as Record<string, unknown>)["statModel"];
    delete (c.ruleset as Record<string, unknown>)["naturesFile"];
    delete (c as Record<string, unknown>)["natures"];
    delete (c.moves.moves[0] as Record<string, unknown>)["category"]; // 先排除 category 拒因，聚焦 unit 字段
    expect(() => compilePack(c)).toThrow(/six-stat fields/);
  });
  it("six-stat 缺 typeChartFile/naturesFile → 拒", () => {
    const c = base();
    delete (c.ruleset as Record<string, unknown>)["naturesFile"];
    delete (c as Record<string, unknown>)["natures"];
    expect(() => compilePack(c)).toThrow(/requires naturesFile/);
  });
});

describe("six-stat 战斗结算", () => {
  it("initBattle 推导面板值进运行时 unit.base + level", () => {
    const s = initBattle(PACK, { battleId: "btl_6", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });
    expect(s.sides.p1.unit.base).toEqual({ hp: 444, atk: 140, def: 196, spa: 317, sdf: 206, spd: 177 });
    expect(s.sides.p1.unit.level).toBe(100);
    expect(s.sides.p1.unit.stages).toEqual({ atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 });
    expect(s.sides.p2.unit.base.hp).toBe(634); // epsilon 固执 hp 434 + 双 K13-01 刻印 +200
  });
  it("physical 用 atk/def、special 用 spa/sdf（同威力对高攻低特攻精灵差异显著）", () => {
    // 内存夹具：u1 spa 极高 atk 极低；物理招几乎不破防，特攻招重创
    const fx = (cat: "physical" | "special") => compilePack({
      ruleset: JSON.parse(readFileSync(join(CONTENT, "rulesets", "synthetic-v2.json"), "utf8")),
      typeChart: JSON.parse(readFileSync(join(CONTENT, "rulesets", "typechart.json"), "utf8")),
      natures: JSON.parse(readFileSync(join(CONTENT, "rulesets", "natures.json"), "utf8")),
      pack: { packId: "fx", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
      units: {
        units: [
          // 攻方：atk=1/spa=200；守方：def/sdf 都 60 → 物理刮痧、特殊重创
          { id: "u1", name: "U1", base: { hp: 100, atk: 1, def: 60, spa: 200, sdf: 60, spd: 80 }, types: ["火"], moveIds: ["m"] },
          { id: "u2", name: "U2", base: { hp: 200, atk: 50, def: 60, spa: 50, sdf: 60, spd: 40 }, types: ["草"], moveIds: ["m"] },
        ],
      },
      moves: { moves: [{ id: "m", name: "M", type: "火", category: cat, pp: 5, priority: 0, effects: [{ op: "damage", power: 40 }] }] },
    });
    const dmgWith = (cat: "physical" | "special") => {
      const pack = fx(cat);
      const s = initBattle(pack, { battleId: "btl_c", seedHex: SEED, p1: "u1", p2: "u2" });
      const r = applyTurn(pack, s, { p1: act("act_m"), p2: act("act_struggle") });
      return evsOf(r, "damage").find((e) => e.detail.side === "p2")!.detail.amount as number;
    };
    const phys = dmgWith("physical");
    const spec = dmgWith("special");
    // 物理：atk≈37 vs def126；特殊：spa≈436 vs sdf126，克×2+STAB —— 特殊应远大于物理
    expect(spec).toBeGreaterThan(phys * 5);
    expect(phys).toBeGreaterThanOrEqual(1);
  });
  it("随机系数确定性：同 seed 两次跑伤害一致", () => {
    const run = () => {
      const s = initBattle(PACK, { battleId: "btl_r", seedHex: SEED, p1: "syn-delta", p2: "syn-epsilon" });
      const r = applyTurn(PACK, s, { p1: act("act_syn-slam"), p2: act("act_syn-strike") });
      return evsOf(r, "damage").map((e) => e.detail.amount);
    };
    expect(run()).toEqual(run());
  });
});
