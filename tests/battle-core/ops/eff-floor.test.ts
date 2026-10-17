/**
 * 克制下限的行为测试：直接喂 IR，不经过中文规则。
 * 数字写法是 ×16 定点（1.25→20、2→32）。true 仍是抬到 1.0（16）。
 * 结算在 ops/damage-family.ts 的 formula.resist 分支：只抬不压，抬完不留痕
 * （不写单位字段、不跨击、不跨回合）。
 * 中文阶梯（1 / 1.25 / 1.5 / 2 按未来奇点层数）还不能发这条 IR：noResist 是单值，
 * 条件挂不上去。解析器仍把那三个带层数的子句留档，见 add-effect-r5f.test.ts。
 *
 * 夹具是单系别（见 typechart）：
 *   自身 光，招式 光  ：光→自然 = 0.5（8）——1.25 抬到 20、2 抬到 32
 *   自身 光，招式 超能：超能→自然 = 2.0（32）——1.25（20）压不下来，仍是 32
 *   自身 光，招式 光  ，对手 光：光→光 = 0.5（8）——同 0.5，抬到句里写的数
 *   自身 光，招式 光  ：写 0.5（8）与不写等价：写的比当前不小就原样
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, type CoreEvent, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "66666666666666666666666666666666";
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

/** 下限 rider 必须排在这一击的 damage 之后（分组器把它收进前一条 damage）。 */
const floored = (id: string, name: string, type: string, floor: unknown) =>
  ({ id, name, type, category: "special" as const, pp: 20, priority: 0, effects: [{ op: "damage", power: 40 }, { op: "formula", of: "noResist", value: floor }] });
const plain = (id: string, name: string, type: string) =>
  ({ id, name, type, category: "special" as const, pp: 20, priority: 0, effects: [{ op: "damage", power: 40 }] });

/** 最小内存夹具：p1 光系；对手系别由参数定。 */
const makePack = (foeTypes: string[]): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "eff-floor", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["光"], moveIds: ["mf125", "mf2", "mf35", "mftrue", "mfhalf", "mpsy", "mplain", "mnone"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: foeTypes, moveIds: ["mnone"] },
    ],
  },
  moves: {
    moves: [
      floored("mf125", "下限1.25", "光", 20),   // 1.25 ×16
      floored("mf2", "下限2", "光", 32),        // 2 ×16
      floored("mf35", "下限3.5", "光", 56),     // 3.5 ×16——倍数不止 1.25/1.5/2
      floored("mftrue", "下限1.0", "光", true), // 同键的 true 写法：抬到 1.0（16）
      floored("mfhalf", "下限0.5", "光", 8),    // 写的比当前不小 → 原样
      plain("mpsy", "对照超能", "超能"),         // 本就 2.0，用来看「只抬不压」
      plain("mplain", "对照光", "光"),           // 本就 0.5
      { id: "mnone", name: "空招", type: "普通", pp: 20, priority: 0, effects: [] },
    ],
  },
} as never);

const NATURAL = makePack(["自然"]);
const MIRROR = makePack(["光"]);

const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const turn = (p: FrozenPack, s: CoreState, a: string, b = "act_mnone") => ok(applyTurn(p, s, { p1: act(a), p2: act(b) }));
const mk = (p: FrozenPack): CoreState => initBattle(p, { battleId: "btl_eff_floor", seedHex: SEED, p1: "u1", p2: "u2" });
const eff16 = (events: CoreEvent[]) => events.filter((e) => e.type === "damage").map((e) => (e.detail as { eff16?: number }).eff16);
const dmg = (events: CoreEvent[]) => events.filter((e) => e.type === "damage").map((e) => (e.detail as { amount: number }).amount);
const hpFoe = (s: CoreState) => s.sides.p2.unit.currentHp;

describe("克制下限（写明的倍数）", () => {
  it("写 1.25：光打自然（0.5）这一击按 1.25（20/16）", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_mf125");
    expect(eff16(r.events)).toEqual([20]);
  });

  it("写 2：同一句写的 2 这一击按 2.0（32/16）", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_mf2");
    expect(eff16(r.events)).toEqual([32]);
  });

  it("倍数不止 1.25/1.5/2：写 3.5 就按 3.5（56/16）", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_mf35");
    expect(eff16(r.events)).toEqual([56]);
    const full = turn(NATURAL, mk(NATURAL), "act_mf2");
    expect(hpFoe(r.state!)).toBeLessThan(hpFoe(full.state!));
  });

  it("读走的倍数真进伤害：1.25 那击高于 0.5，低于 2.0", () => {
    const lifted = turn(NATURAL, mk(NATURAL), "act_mf125");
    const weak = turn(NATURAL, mk(NATURAL), "act_mplain");
    const full = turn(NATURAL, mk(NATURAL), "act_mf2");
    expect(eff16(weak.events)).toEqual([8]);
    expect(hpFoe(lifted.state!)).toBeLessThan(hpFoe(weak.state!));
    expect(hpFoe(full.state!)).toBeLessThan(hpFoe(lifted.state!));
  });

  it("只抬不压：本就 2.0 的一击不被 1.25 压低", () => {
    const flooredHit = turn(NATURAL, mk(NATURAL), "act_mf125");   // 光招，0.5 抬到 1.25
    const strong = turn(NATURAL, mk(NATURAL), "act_mpsy");        // 超能→自然 = 2.0，无下限 rider
    expect(eff16(strong.events)).toEqual([32]);
    // 下限只把 0.5 抬到 1.25，越不过本就 2.0 的一击
    expect(hpFoe(strong.state!)).toBeLessThan(hpFoe(flooredHit.state!));
  });

  it("写 2.0 的下限打在本就 2.0 的一击上是原样：抬不动也不重复乘", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_mf2");
    const psy = turn(NATURAL, mk(NATURAL), "act_mpsy");
    expect(eff16(r.events)).toEqual(eff16(psy.events));
  });

  it("写的倍数不比当前克制大就原样：写 0.5 打 0.5 仍是微弱，不凭空造克制", () => {
    // 对手 光：光→光 = 0.5
    const r = turn(MIRROR, mk(MIRROR), "act_mfhalf");
    expect(eff16(r.events)).toEqual([8]);
    const weak = turn(MIRROR, mk(MIRROR), "act_mplain");
    expect(hpFoe(r.state!)).toBe(hpFoe(weak.state!));
  });

  it("同键的 true 写法仍在：至少为 1.0 抬到 1.0，不抬到写明的倍数以外", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_mftrue");
    expect(eff16(r.events)).toEqual([16]);
  });

  it("下限是这一击的读法，不留痕：下一击回到本来的倍率", () => {
    const t1 = turn(NATURAL, mk(NATURAL), "act_mf125");
    expect(eff16(t1.events)).toEqual([20]);
    const t2 = turn(NATURAL, t1.state!, "act_mplain");
    expect(eff16(t2.events)).toEqual([8]);
  });

  it("对手同系别时同样抬：光打光（0.5）写 2 就按 2.0", () => {
    const r = turn(MIRROR, mk(MIRROR), "act_mf2");
    expect(eff16(r.events)).toEqual([32]);
    expect(dmg(r.events)[0]!).toBeGreaterThan(0);
  });
});
