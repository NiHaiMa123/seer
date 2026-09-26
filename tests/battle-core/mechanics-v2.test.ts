/**
 * M2-02 golden：v2 引擎机制——stat_ops / damage_kinds / control / overlay。
 * 每个机制 pos/neg/boundary 三类；v1 回归靠既有 goldens 保证（字节不变）。
 * 配对注意：syn-epsilon 是 boss（overlay 免疫控制/消强），
 * 机制正例在非 boss 配对（gamma/delta）上跑，免疫断言用 boss 作目标。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, loadPackFromDir, type CoreState } from "@seer/battle-core";
import { readFileSync } from "node:fs";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000001";

// p1=delta(drain/slam/purge-mind) p2=gamma(hex/blast) —— 双侧均非 boss
const dg = (): CoreState => initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-delta", p2: "syn-gamma" });
// p1=gamma p2=delta —— hex 打在非 boss 上
const gd = (): CoreState => initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
// p2=epsilon boss —— overlay 免疫目标
const ge = (): CoreState => initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });

const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string) => ({ actionId: id });
const evs = (r: ReturnType<typeof applyTurn>, type: string) => (r.ok ? r.events.filter((e) => e.type === type) : []);

describe("transfer_stages（吸强）", () => {
  it("正：对手 stage 全部转移到己方并清零（负 stage 取绝对值）", () => {
    const s = dg();
    s.sides.p2.unit.stages = { atk: 2, def: -1, spd: 0 }; // 不动 spd —— 避免打乱 ORDER
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-drain"), p2: act("act_syn-strike") }));
    expect(r.state.sides.p1.unit.stages).toEqual({ atk: 2, def: 1, spd: 0 }); // def -1 → 取绝对值 +1
    expect(r.state.sides.p2.unit.stages).toEqual({ atk: 0, def: 0, spd: 0 });
    expect(evs(r, "stages-transferred")).toHaveLength(1);
  });
  it("边界：转移后 clamp 到 +6", () => {
    const s = dg();
    s.sides.p1.unit.stages = { atk: 5, def: 0, spd: 0 };
    s.sides.p2.unit.stages = { atk: 4, def: 2, spd: 0 };
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-drain"), p2: act("act_syn-strike") }));
    expect(r.state.sides.p1.unit.stages.atk).toBe(6);
    expect(r.state.sides.p2.unit.stages.atk).toBe(0);
  });
  it("负：对手全零 → no-stages 失败（PP 照扣）", () => {
    const r = ok(applyTurn(PACK, dg(), { p1: act("act_syn-drain"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.reason === "no-stages")).toBe(true);
    expect(r.state.sides.p1.unit.moves.find((m) => m.moveId === "syn-drain")!.pp).toBe(14);
  });
  it("负：boss overlay 免疫 → overlay_immune（craft 注入 drain 到 gamma）", () => {
    const s = ge();
    s.sides.p1.unit.moves.push({ moveId: "syn-drain", pp: 15, ppMax: 15 });
    s.sides.p2.unit.stages = { atk: 3, def: 0, spd: 0 };
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-drain"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.reason === "overlay_immune")).toBe(true);
    expect(r.state.sides.p2.unit.stages.atk).toBe(3);
  });
});

describe("clear_stages（消强）", () => {
  it("正：目标 stage 全清零（epsilon purge 非 boss 目标）", () => {
    const s = initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-epsilon", p2: "syn-delta" });
    s.sides.p2.unit.stages = { atk: 2, def: -1, spd: 0 };
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-purge"), p2: act("act_syn-strike") }));
    expect(r.state.sides.p2.unit.stages).toEqual({ atk: 0, def: 0, spd: 0 });
    expect(evs(r, "stages-cleared")).toHaveLength(1);
  });
  it("负：全零 → no-stages", () => {
    const s = initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-epsilon", p2: "syn-delta" });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-purge"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.reason === "no-stages")).toBe(true);
  });
  it("负：clear_stages 打在 boss 上 → overlay_immune（craft 注入 purge）", () => {
    const s = ge();
    s.sides.p1.unit.moves.push({ moveId: "syn-purge", pp: 15, ppMax: 15 });
    s.sides.p2.unit.stages = { atk: 2, def: 0, spd: 0 };
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-purge"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.reason === "overlay_immune")).toBe(true);
    expect(r.state.sides.p2.unit.stages.atk).toBe(2);
  });
});

describe("damage kinds", () => {
  it("percent：按目标最大 HP 25%，无视 stage", () => {
    const s = ge(); // gamma blast vs epsilon(110hp)
    s.sides.p2.unit.stages.def = 6;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-blast"), p2: act("act_syn-strike") }));
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.amount).toBe(27); // floor(25×110/100)=27
    expect(dmg.detail.damageKind).toBe("percent");
  });
  it("true：def stage 不参与", () => {
    const s = dg(); // delta slam vs gamma(28def)
    s.sides.p2.unit.stages.def = 3;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-slam"), p2: act("act_syn-strike") }));
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    // floor(30×55/(2×28)) = floor(1650/56) = 29 —— def 按 stage 0
    expect(dmg.detail.amount).toBe(29);
    expect(dmg.detail.damageKind).toBe("true");
  });
  it("fixed：固定伤害无视 stage（内存包夹具）", () => {
    const pack = compilePack({
      ruleset: JSON.parse(readFileSync(join(CONTENT, "rulesets", "synthetic-v2.json"), "utf8")),
      pack: JSON.parse(readFileSync(join(CONTENT, "synthetic-v2", "pack.json"), "utf8")),
      units: {
        units: [
          { id: "u1", name: "U1", base: { hp: 100, atk: 10, def: 10, spd: 50 }, moveIds: ["mf"] },
          { id: "u2", name: "U2", base: { hp: 100, atk: 10, def: 10, spd: 40 }, moveIds: ["ms"] },
        ],
      },
      moves: {
        moves: [
          { id: "mf", name: "F", pp: 5, priority: 0, effects: [{ op: "damage", kind: "fixed", power: 33 }] },
          { id: "ms", name: "S", pp: 5, priority: 0, effects: [{ op: "damage", power: 10 }] },
        ],
      },
    });
    const s = initBattle(pack, { battleId: "btl_f", seedHex: SEED, p1: "u1", p2: "u2" });
    s.sides.p2.unit.stages.def = 6;
    const r = ok(applyTurn(pack, s, { p1: act("act_mf"), p2: act("act_ms") }));
    const dmg = evs(r, "damage").find((e) => e.detail.side === "p2")!;
    expect(dmg.detail.amount).toBe(33);
    expect(dmg.detail.damageKind).toBe("fixed");
  });
  it("standard 事件不带 damageKind（v1 兼容）", () => {
    const r = ok(applyTurn(PACK, dg(), { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r, "damage")[0]!.detail.damageKind).toBeUndefined();
  });
});

describe("control 三件套", () => {
  it("stun turns=1：阻断恰好一次行动（含施加当回合后到的），PP 照扣后 fade", () => {
    // gamma(60) 快于 delta(70)？不——delta spd70 更快 → delta 先动
    // p1=gamma hex 施加给 p2=delta：delta 本回合已先行动过 → 阻断下一回合
    let s = gd();
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(r1.state.sides.p2.unit.effects.some((e) => e.kind === "control:stun")).toBe(true);
    expect(evs(r1, "effect-applied")[0]!.detail.name).toBe("control:stun");
    // 下一回合 p2 被阻断（PP 已扣），control 计数归零 → fade
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "action-failed").some((e) => e.detail.side === "p2" && e.detail.reason === "controlled")).toBe(true);
    expect(r2.state.sides.p2.unit.moves.find((m) => m.moveId === "syn-strike")!.pp).toBe(33); // turn1 执行 + turn2 被控各扣 1
    expect(evs(r2, "effect-faded").some((e) => e.detail.name === "control:stun")).toBe(true);
    // 第三回合恢复
    const r3 = ok(applyTurn(PACK, r2.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r3, "action-failed").some((e) => e.detail.reason === "controlled")).toBe(false);
  });
  it("stun turns=2：阻断两次行动", () => {
    // 控制放在 gamma(150hp) 上——delta 两回合打不死它，控制不会提前被 KO 吃掉
    const s = gd();
    s.sides.p1.unit.effects.push({ kind: "control:stun", effectInstanceId: "efx_p1_x", remainingTurns: 2 });
    let st = s;
    for (let i = 0; i < 2; i++) {
      const r = ok(applyTurn(PACK, st, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
      expect(evs(r, "action-failed").some((e) => e.detail.side === "p1" && e.detail.reason === "controlled")).toBe(true);
      st = r.state;
    }
    const r4 = ok(applyTurn(PACK, st, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r4, "action-failed").some((e) => e.detail.reason === "controlled")).toBe(false);
  });
  it("cleanse：清除控制；无控制 → no-control 失败", () => {
    let s = dg();
    s.sides.p1.unit.effects.push({ kind: "control:stun", effectInstanceId: "efx_p1_t", remainingTurns: 2 });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-purge-mind"), p2: act("act_syn-strike") }));
    expect(r.state.sides.p1.unit.effects.length).toBe(0);
    expect(evs(r, "effect-faded").some((e) => e.detail.name === "control:stun")).toBe(true);
    const r2 = ok(applyTurn(PACK, r.state, { p1: act("act_syn-purge-mind"), p2: act("act_syn-strike") }));
    expect(evs(r2, "action-failed").some((e) => e.detail.reason === "no-control")).toBe(true);
  });
  it("immune_control：ward 后 hex 被挡 → control-immune", () => {
    const s = gd();
    // craft：给 p2 delta 注入 ward
    s.sides.p2.unit.moves.push({ moveId: "syn-ward", pp: 10, ppMax: 10 });
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-ward") }));
    expect(r1.state.sides.p2.unit.effects.some((e) => e.kind === "immune_control")).toBe(true);
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(evs(r2, "control-immune").some((e) => e.detail.side === "p2" && e.detail.name === "stun")).toBe(true);
    expect(r2.state.sides.p2.unit.effects.some((e) => e.kind === "control:stun")).toBe(false);
  });
  it("overlay：boss 免疫控制 → overlay_immune", () => {
    const r = ok(applyTurn(PACK, ge(), { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.reason === "overlay_immune")).toBe(true);
    expect(r.state.sides.p2.unit.effects.length).toBe(0);
  });
  it("apply_effect：marked tag 挂 3 回合", () => {
    const r = ok(applyTurn(PACK, ge(), { p1: act("act_syn-strike"), p2: act("act_syn-brand") }));
    expect(r.state.sides.p1.unit.effects.some((e) => e.kind === "tag:marked" && e.remainingTurns === 3)).toBe(true);
    expect(evs(r, "effect-applied").some((e) => e.detail.name === "tag:marked")).toBe(true);
  });
});
