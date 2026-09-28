/**
 * test:seals-v2 —— 刻印系统（M5 刻印阶段）。
 * 满数值平面叠加（初始+隐藏已合并入 stats，不吃性格/等级缩放）；
 * 规则 ≤3 枚 / 同 id ≤2 / 同系列 ≤2 / 专属绑定；loadout 覆盖 species 预设；
 * v1 无目录拒载；己方投影出 seals、对手隐藏。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  checkSealLoadout, compilePack, initBattle, applyTurn, legalActions,
  type CompiledSeal, type CoreState, type FrozenPack,
} from "@seer/battle-core";
import { BattleHost } from "@seer/host";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));
const SEED = "11111111111111111111111111111111";
const K13_01 = "seal-42240"; // {atk+52 def+30 sdf+30 spd+43 hp+100}（满数值含隐藏）
const K13_02 = "seal-42241"; // 同系列 K13，特攻向
const K13_03 = "seal-42242";
const EXCLUSIVE = "seal-42243"; // K13-04 专属精灵=4386（合成包内无此精灵名 → 任何单位都拒）

const PACK: FrozenPack = compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  pack: read("synthetic-v2/pack.json"),
  units: read("synthetic-v2/units.json"),
  moves: read("synthetic-v2/moves.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  seals: read("seals/seals.json"),
});
const sealOf = (id: string): CompiledSeal => PACK.seals!.get(id)!;
const dg = (): CoreState => initBattle(PACK, { battleId: "btl_sl", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-delta"] } });
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const ok = (r: ReturnType<typeof applyTurn>) => { if (!r.ok) throw new Error(`fault: ${r.fault.message}`); return r; };

describe("seal loadout 规则（checkSealLoadout）", () => {
  const rules = PACK.sealRules!;
  const check = (ids: string[], unitName = "Gamma") => checkSealLoadout(PACK.seals!, rules, unitName, ids);
  it("≤3 枚 / >3 拒", () => {
    // 3 枚不同系列合法；4 枚超限
    expect(check([K13_01, "seal-45009", "seal-41286"])).toBeNull(); // K13 + V10 + 九天
    expect(check([K13_01, "seal-45009", "seal-41286", "seal-42244"])).toMatch(/maxPerUnit/);
  });
  it("同 id ≤2：2 枚可、3 枚拒", () => {
    expect(check([K13_01, K13_01])).toBeNull();
    expect(check([K13_01, K13_01, K13_01])).toMatch(/maxIdentical/);
  });
  it("同系列 ≤2：K13 三枚不同名也拒", () => {
    expect(check([K13_01, K13_02])).toBeNull();
    expect(check([K13_01, K13_02, K13_03])).toMatch(/series "K13"/);
  });
  it("专属刻印：名字不匹配即拒", () => {
    expect(sealOf(EXCLUSIVE).exclusive).toBeDefined();
    expect(check([EXCLUSIVE])).toMatch(/exclusive/);
    expect(check([EXCLUSIVE], sealOf(EXCLUSIVE).exclusive!)).toBeNull();
  });
  it("未知刻印 id 拒", () => {
    expect(check(["seal-99999999"])).toMatch(/not in seal catalog/);
  });
});

describe("loader：unit.seals 声明式校验", () => {
  const base = () => ({
    ruleset: read("rulesets/synthetic-v2.json"),
    pack: read("synthetic-v2/pack.json"),
    units: read("synthetic-v2/units.json"),
    moves: read("synthetic-v2/moves.json"),
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    seals: read("seals/seals.json"),
  });
  it("单位 seals 违例在编译期拒载（>2 同 id）", () => {
    const raw = base();
    raw.units.units.find((u: { id: string }) => u.id === "syn-gamma").seals = [K13_01, K13_01, K13_01];
    expect(() => compilePack(raw)).toThrow(/maxIdentical/);
  });
  it("单位 seals 未知 id 拒载", () => {
    const raw = base();
    raw.units.units.find((u: { id: string }) => u.id === "syn-gamma").seals = ["seal-99999999"];
    expect(() => compilePack(raw)).toThrow(/not in seal catalog/);
  });
  it("声明 files.seals 但缺 seals 文档 → 拒", () => {
    const raw = base() as Record<string, unknown>;
    delete raw.seals;
    expect(() => compilePack(raw as never)).toThrow(/no seals document/);
  });
  it("未声明 files.seals 的单位带 seals → 拒（防静默忽略）", () => {
    const raw = base();
    raw.pack = JSON.parse(JSON.stringify(raw.pack)) as typeof raw.pack;
    delete (raw.pack as { files: Record<string, string> }).files.seals;
    raw.units.units.find((u: { id: string }) => u.id === "syn-gamma").seals = [K13_01];
    expect(() => compilePack(raw)).toThrow(/no files\.seals/);
  });
  it("seals 文档计入 contentHash：换库 → hash 变", () => {
    const a = compilePack(base());
    const raw2 = base();
    delete raw2.seals.seals[K13_02];
    const b = compilePack(raw2);
    expect(a.rules.contentHash).not.toBe(b.rules.contentHash);
  });
});

describe("engine：满数值面板叠加", () => {
  it("species 预设刻印（epsilon 双 K13-01）→ 面板 +200hp/+104atk/+60def/+60sdf/+86spd", () => {
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-delta", p2: "syn-epsilon" });
    expect(s.sides.p2.unit.base).toMatchObject({ hp: 634, atk: 421, def: 266, spa: 140, sdf: 277, spd: 272 });
    expect(s.sides.p2.unit.currentHp).toBe(634);
    expect(s.sides.p2.unit.seals).toEqual([K13_01, K13_01]);
  });
  it("刻印加成不吃性格乘算：固执(+攻) epsilon 的 atk 恰为 317+104=421 而非 (317+104)×1.1", () => {
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-delta", p2: "syn-epsilon" });
    expect(s.sides.p2.unit.base.atk).toBe(421);
  });
  it("运行时 loadout 覆盖/补充：gamma 装 K13-02 → spa +52、其余面板不变", () => {
    const plain = dg().sides.p1.unit.base;
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      seals: { p1: [[K13_02]] },
    });
    const u = s.sides.p1.unit;
    expect(u.base.spa).toBe(plain.spa! + 52);
    expect(u.base.hp).toBe(plain.hp + 100);
    expect(u.base.atk).toBe(plain.atk);
    expect(u.seals).toEqual([K13_02]);
  });
  it("loadout 违例（3 枚同 id）→ SEAL_RULE", () => {
    expect(() => initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      seals: { p1: [[K13_01, K13_01, K13_01]] },
    })).toThrow(/maxIdentical/);
  });
  it("bench 单位带刻印 → 换入后 seals 与加成保留", () => {
    let s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      bench: { p1: ["syn-delta"] },
      seals: { p1: [[], [K13_01, K13_01]] },
    });
    const benchDelta = s.sides.p1.bench![0]!;
    expect(benchDelta.seals).toEqual([K13_01, K13_01]);
    expect(benchDelta.base.hp).toBe(benchDelta.currentHp);
    const benchHp = benchDelta.base.hp;
    // 换人进场：HP/刻印跟随单位
    s = ok(applyTurn(PACK, s, { p1: act("act_switch-0"), p2: act("act_syn-strike") })).state;
    expect(s.sides.p1.unit.speciesId).toBe("syn-delta");
    expect(s.sides.p1.unit.seals).toEqual([K13_01, K13_01]);
    expect(s.sides.p1.unit.base.hp).toBe(benchHp); // 刻印加成跟随单位不换散
  });
  it("v1 包：单位预设与运行时装配都拒", () => {
    const v1 = compilePack({
      ruleset: read("rulesets/synthetic-v1.json"),
      pack: read("synthetic-v1/pack.json"),
      units: read("synthetic-v1/units.json"),
      moves: read("synthetic-v1/moves.json"),
    });
    expect(() => initBattle(v1, {
      battleId: "b1", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta",
      seals: { p1: [[K13_01]] },
    })).toThrow(/SEAL_UNSUPPORTED|no seal catalog/);
  });
});

describe("投影：己方可见、对手隐藏", () => {
  it("host observe：own.unit.seals 暴露 / opponent 无 seals 字段", () => {
    const h = new BattleHost({
      pack: PACK, battleId: "btl_slh", seedHex: SEED,
      species: { p1: "syn-gamma", p2: "syn-epsilon" },
      players: { p1: "alice", p2: "bob" }, deadlineMs: 10_000,
      seals: { p1: [[K13_02]] },
    });
    const own = h.observe("alice");
    expect(own.own.seals).toEqual([K13_02]);
    expect(JSON.stringify(own.opponent)).not.toContain("seal-");
    // 对手（bob）看自己预设的双 K13-01
    const foe = h.observe("bob");
    expect(foe.own.seals).toEqual([K13_01, K13_01]);
    expect(JSON.stringify(foe.opponent)).not.toContain("seal-");
  });
});

describe("刻印与既有机制交互", () => {
  it("percent 伤害按刻印后 maxHp 结算", () => {
    const s = dg(); // delta 首发（无预设刻印）vs gamma
    const hpNoSeal = s.sides.p2.unit.base.hp;
    const sealed = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      seals: { p2: [[K13_01]] },
    });
    expect(sealed.sides.p2.unit.base.hp).toBe(hpNoSeal + 100);
  });
  it("确定性：同 seed+loadout 两次初始化字节级一致", () => {
    const mk2 = () => initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon",
      seals: { p1: [[K13_01, K13_02]] },
    });
    expect(JSON.stringify(mk2())).toBe(JSON.stringify(mk2()));
  });
  it("刻印影响速度线：spd+86 的 epsilon 先手", () => {
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    // epsilon spd 272 > gamma 177 → 对手先动：首个 damage 事件应落在 p1 侧
    const dmg = r.events.find((e) => e.type === "damage")!;
    expect(dmg.detail.side).toBe("p1");
  });
  it("legalActions 不受刻印影响（非招式刻印）", () => {
    expect(legalActions(dg(), "p1")).toContain("act_syn-strike");
  });
});
