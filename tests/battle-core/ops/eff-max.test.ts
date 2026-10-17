/**
 * eff_max（新 op）的行为测试：直接喂 IR，不经过中文规则。
 * 语料只有一句（4 个招式，同一字符串）：娜诺/撬动世界
 *   「自身处于异常状态时，克制倍数取自身对对手、对手对自身克制倍数中的最大值」
 * 句子自带的条件由解析器挂 if:{selfStatused:true}，这里只锁 op 语义：
 * 把「自身→对手」与「对手→自身」两侧克制倍率的最大值（×16 定点）记在行动方单位上。
 * 这一击的克制读法（formula.resist）消费这个字段：抬到较大值后即清（不跨击、不跨回合留存）。
 *
 * 夹具是单系别（见 typechart）：
 *   自身 光，招式 超能：超能→自然 = 2.0，自然→光 = 2.0（对手自然，两侧同倍率）
 *   自身 光，招式 光  ：光→自然  = 0.5，自然→光 = 2.0（对手自然；这一击按 2.0 算）
 *   自身 光，招式 光  ：光→光    = 0.5，光→光   = 0.5（对手光，op 不造克制）
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, type CoreEvent, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "55555555555555555555555555555555";
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

/** eff_max 必须排在这一击的 damage 之前：op 只写值，值在伤害的克制读法里被读走。 */
const scaled = (id: string, name: string, type: string, extra: unknown[]) =>
  ({ id, name, type, category: "special" as const, pp: 20, priority: 0, effects: [...extra, { op: "damage", power: 40 }] });

/** 最小内存夹具：p1 光系；对手系别由参数定（自然 = 互相克制，光 = 两侧都微弱）。 */
const makePack = (foeTypes: string[]): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "eff-max", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["光"], moveIds: ["meff", "mweak", "mweakplain", "mplain", "mnone"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: foeTypes, moveIds: ["mnone"] },
    ],
  },
  moves: {
    moves: [
      scaled("meff", "取最大值", "超能", [{ op: "eff_max", target: "self" }]),
      scaled("mweak", "微弱取最大值", "光", [{ op: "eff_max", target: "self" }]),
      scaled("mweakplain", "微弱对照", "光", []),
      scaled("mplain", "对照", "超能", []),
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
const mk = (p: FrozenPack): CoreState => initBattle(p, { battleId: "btl_eff_max", seedHex: SEED, p1: "u1", p2: "u2" });
const eff16 = (events: CoreEvent[]) => events.filter((e) => e.type === "damage").map((e) => (e.detail as { eff16?: number }).eff16);
const dmg = (events: CoreEvent[]) => events.filter((e) => e.type === "damage").map((e) => (e.detail as { amount: number }).amount);
const hpFoe = (s: CoreState) => s.sides.p2.unit.currentHp;
const floor = (s: CoreState) => (s.sides.p1.unit as { effFloor?: number }).effFloor;

describe("eff_max", () => {
  it("两侧取较大值：光打自然、招式为光时这一击按 2.0，不再是 0.5", () => {
    // 招式 光 → 对手 自然 = 0.5（微弱）；对手 自然 → 自身 光 = 2.0。这一击读 2.0，字段随即清掉。
    const r = turn(NATURAL, mk(NATURAL), "act_mweak");
    expect(eff16(r.events)).toEqual([32]);
    expect(floor(r.state!)).toBeUndefined();
  });

  it("读走的值真的进了伤害：与本就 2.0 的一击同威力同伤害", () => {
    // mweak（光，微弱→抬到 2.0，本系加成成立）对 mweakplain（光，仍 0.5，本系加成成立）只差克制倍率
    const lifted = turn(NATURAL, mk(NATURAL), "act_mweak");
    const weak = turn(NATURAL, mk(NATURAL), "act_mweakplain");
    expect(eff16(weak.events)).toEqual([8]);
    expect(hpFoe(lifted.state!)).toBeLessThan(hpFoe(weak.state!));
    // 32/16 对 8/16：除两次 floor 取整外没有别的差，伤害约 4 倍
    expect(Math.abs(dmg(lifted.events)[0]! - 4 * dmg(weak.events)[0]!)).toBeLessThanOrEqual(4);
  });

  it("两侧同倍率时不多不少：本就 2.0 的一侧保持 2.0", () => {
    const withMax = turn(NATURAL, mk(NATURAL), "act_meff");   // 超能→自然 2.0，自然→光 2.0
    const plain = turn(NATURAL, mk(NATURAL), "act_mplain");   // 只有 超能→自然 2.0
    expect(eff16(withMax.events)).toEqual([32]);
    expect(eff16(plain.events)).toEqual([32]);
    expect(hpFoe(withMax.state!)).toBe(hpFoe(plain.state!));
  });

  it("不凭空造克制：两侧都微弱时仍是微弱（0.5）", () => {
    // 对手 光：光→光 = 0.5，光→光 = 0.5
    const r = turn(MIRROR, mk(MIRROR), "act_mweak");
    expect(eff16(r.events)).toEqual([8]);
    expect(floor(r.state!)).toBeUndefined();
  });

  it("op 写值、克制读法消费：同一击里配对，打完字段清掉", () => {
    const r = turn(NATURAL, mk(NATURAL), "act_meff");
    expect(r.events.some((e) => e.type === "effect-applied" && (e.detail as { name?: string }).name === "eff_max")).toBe(true);
    expect(floor(r.state!)).toBeUndefined();
  });

  it("字段不跨击继承：取过最大值的一击之后，下一击按自己的倍率算", () => {
    const t1 = turn(NATURAL, mk(NATURAL), "act_mweak");
    expect(eff16(t1.events)).toEqual([32]);
    const t2 = turn(NATURAL, t1.state!, "act_mweakplain"); // 没有 eff_max：应回到本就的 0.5
    expect(eff16(t2.events)).toEqual([8]);
    expect(floor(t2.state!)).toBeUndefined();
  });

  it("没打出去的残留值按回合清零，不继承到下一回合", () => {
    const t1 = turn(NATURAL, mk(NATURAL), "act_mplain").state!;
    const dirty = { ...t1, sides: { ...t1.sides, p1: { ...t1.sides.p1, unit: { ...t1.sides.p1.unit, effFloor: 64 } } } } as CoreState;
    expect(floor(dirty)).toBe(64);
    const t2 = turn(NATURAL, dirty, "act_mplain");
    expect(floor(t2.state!)).toBeUndefined();
    expect(eff16(t2.events)).toEqual([32]); // 本就 2.0（超能→自然），没被残留值改写成 4.0
  });
});
