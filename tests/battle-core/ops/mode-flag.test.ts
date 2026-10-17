/**
 * set_mode_flag（新 op）的行为测试：直接喂 IR，不经过中文规则。
 * 语料来源是灭战神决·盖亚的「衍化/复原/改为逆转」，但这里只锁 op 语义：
 * 置位、清除、逆转（含互斥复位）、无计时、以及 selfHas 谓词认这个编码。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "33333333333333333333333333333333";
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

/** 最小内存夹具：p1 有三个开关招 + 两个探针招，p2 只有一个空招。 */
const pack = (): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "mode-flag", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mfwd", "mrev", "mclr", "mprobe", "mprobe-rev"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 50 }, types: ["普通"], moveIds: ["mnone"] },
    ],
  },
  moves: {
    moves: [
      { id: "mfwd", name: "置位", type: "普通", pp: 20, priority: 0, effects: [{ op: "set_mode_flag", name: "wudao", target: "self" }] },
      { id: "mrev", name: "逆转", type: "普通", pp: 20, priority: 0, effects: [{ op: "set_mode_flag", name: "wudao", target: "self", to: "revert" }] },
      { id: "mclr", name: "复原", type: "普通", pp: 20, priority: 0, effects: [{ op: "set_mode_flag", name: "wudao", target: "self", clear: true, remove: ["别的开关"] }] },
      { id: "mprobe", name: "探针正转", type: "普通", pp: 20, priority: 0, effects: [{ op: "damage", kind: "fixed", power: 50, if: { selfHas: "tag:wudao:forward" } }] },
      { id: "mprobe-rev", name: "探针逆转", type: "普通", pp: 20, priority: 0, effects: [{ op: "damage", kind: "fixed", power: 70, if: { selfHas: "tag:wudao:revert" } }] },
      { id: "mnone", name: "空招", type: "普通", pp: 20, priority: 0, effects: [] },
    ],
  },
} as never);

const PACK = pack();
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const turn = (s: CoreState, a: string, b = "act_mnone") => ok(applyTurn(PACK, s, { p1: act(a), p2: act(b) })).state!;
const kinds = (s: CoreState) => s.sides.p1.unit.effects.map((e) => e.kind).sort();
const hp = (s: CoreState) => s.sides.p2.unit.currentHp;
const mk = (): CoreState => initBattle(PACK, { battleId: "btl_mode_flag", seedHex: SEED, p1: "u1", p2: "u2" });
/** p2 的实际体力上限（六维养成派生后不等于 base.hp）。 */
const MAX = mk().sides.p2.unit.currentHp;

describe("set_mode_flag", () => {
  it("置位：tag:<name> 条目落下，且不带计时", () => {
    const s = turn(mk(), "act_mfwd");
    const e = s.sides.p1.unit.effects.find((x) => x.kind === "tag:wudao:forward")!;
    expect(e).toBeDefined();
    expect(e.remainingTurns).toBeUndefined(); // 开关不是回合窗——selfNoTimedFx 一类谓词不受影响
    expect(kinds(s)).toEqual(["tag:wudao:forward"]);
  });

  it("selfHas 谓词认这个编码：置位后探针伤害生效，未置位不生效", () => {
    const base = mk();
    const off = turn(base, "act_mprobe"); // 未置位 → if 不满足，静默跳过
    expect(hp(off)).toBe(MAX);
    const on = turn(turn(base, "act_mfwd"), "act_mprobe");
    expect(hp(on)).toBe(MAX - 50);
  });

  it("逆转：清掉正转位、挂 tag:wudao:revert；两个探针随之互换", () => {
    const s = turn(turn(mk(), "act_mfwd"), "act_mrev");
    expect(kinds(s)).toEqual(["tag:wudao:revert"]);
    const rev = turn(s, "act_mprobe-rev");
    expect(hp(rev)).toBe(MAX - 70);
    const fwd = turn(s, "act_mprobe");
    expect(hp(fwd)).toBe(MAX);
  });

  it("复原（clear）：只清不置，两个探针都不生效", () => {
    const s = turn(turn(mk(), "act_mfwd"), "act_mclr");
    expect(kinds(s)).toEqual([]);
    expect(hp(turn(s, "act_mprobe"))).toBe(MAX);
  });

  it("remove 顺带复位别的开关：指定的 name 组一并清掉", () => {
    const s0 = turn(mk(), "act_mfwd");
    const stray = { ...s0, sides: { ...s0.sides, p1: { ...s0.sides.p1, unit: { ...s0.sides.p1.unit, effects: [...s0.sides.p1.unit.effects, { kind: "tag:别的开关:forward", effectInstanceId: "efx_p1_tag:别的开关:forward" }] } } } };
    const s = turn(stray as CoreState, "act_mclr");
    expect(kinds(s)).toEqual([]);
  });
});
