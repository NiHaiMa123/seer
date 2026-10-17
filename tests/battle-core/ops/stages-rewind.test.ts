/**
 * stages_rewind（新 op）的行为测试：直接喂 IR，不经过中文规则。
 * 语料只有一句「(先|后)出手时将自身能力等级返回至上一回合结束时」（15 个招式）。
 * 处理器在 ops/slots/w10.ts：逐维写回目标本回合开始的能力等级快照
 * —— 引擎在每回合开始记 turnStartStages（engine.ts applyTurnInner），
 * 回合内改的是本回合 stages、快照不跟着动，所以「本回合开始」就是「上一回合结束时」。
 * 这里只锁 op 语义：turns=1 读快照；无差异 / 无快照各自 action-failed，不编历史。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle, type CoreEvent, type CoreState, type FrozenPack } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "44444444444444444444444444444444";
const read = (rel: string) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

/** 最小内存夹具：p1 有回溯招/自降后回溯招/探针招，p2 有先制的降段招与空招。 */
const pack = (): FrozenPack => compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  pack: { packId: "stages-rewind", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v2", verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true }, files: { units: "units.json", moves: "moves.json" }, assets: [] },
  units: {
    units: [
      { id: "u1", name: "U1", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mup", "mrew", "mrew-default", "mrew2", "mdownrew", "mnone"] },
      { id: "u2", name: "U2", base: { hp: 400, atk: 100, def: 50, spa: 100, sdf: 50, spd: 100 }, types: ["普通"], moveIds: ["mdownpri", "mnone"] },
    ],
  },
  moves: {
    moves: [
      { id: "mup", name: "强化", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] },
      { id: "mrew", name: "回溯", type: "普通", pp: 20, priority: 0, effects: [{ op: "stages_rewind", target: "self", turns: 1 }] },
      { id: "mrew-default", name: "回溯省写", type: "普通", pp: 20, priority: 0, effects: [{ op: "stages_rewind", target: "self" }] },
      { id: "mrew2", name: "回溯两回合", type: "普通", pp: 20, priority: 0, effects: [{ op: "stages_rewind", target: "self", turns: 2 }] },
      // 先自己降一段再回溯：同一个招式内也要回溯到本回合开始的等级
      { id: "mdownrew", name: "自降后回溯", type: "普通", pp: 20, priority: 0, effects: [{ op: "apply_stat_stage", stat: "atk", delta: -1, target: "self" }, { op: "stages_rewind", target: "self", turns: 1 }] },
      { id: "mdownpri", name: "先制打攻", type: "普通", pp: 20, priority: 1, effects: [{ op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" }] },
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
const turn = (s: CoreState, a: string, b = "act_mnone") => ok(applyTurn(PACK, s, { p1: act(a), p2: act(b) }));
const mk = (): CoreState => initBattle(PACK, { battleId: "btl_stages_rewind", seedHex: SEED, p1: "u1", p2: "u2" });
const stages = (s: CoreState) => s.sides.p1.unit.stages;
const stageEvents = (events: CoreEvent[]) => events.filter((e) => e.type === "stat-stage").map((e) => e.detail);
const failed = (events: CoreEvent[]) => events.filter((e) => e.type === "action-failed").map((e) => e.detail);

describe("stages_rewind", () => {
  it("turns=1：同一招内先降一段再回溯 → 写回本回合开始的等级，发差值事件", () => {
    const r = turn(mk(), "act_mdownrew");
    expect(stages(r.state!)).toMatchObject({ atk: 0 });
    expect(stageEvents(r.events)).toEqual([
      { side: "p1", stat: "atk", deltaApplied: -1, stageAfter: -1 },
      { side: "p1", stat: "atk", deltaApplied: 1, stageAfter: 0 },
    ]);
  });

  it("turns=1：对手先出手降的段同样回溯（读快照，不看是谁改的）", () => {
    // p2 的先制招先手，把 p1 攻击降 1；随后 p1 回溯 → 回到本回合开始（全 0）
    const r = turn(mk(), "act_mrew", "act_mdownpri");
    expect(stages(r.state!)).toMatchObject({ atk: 0 });
    expect(stageEvents(r.events)).toEqual([
      { side: "p1", stat: "atk", deltaApplied: -1, stageAfter: -1 },
      { side: "p1", stat: "atk", deltaApplied: 1, stageAfter: 0 },
    ]);
    // 只动自己这一侧：对手的等级原样
    expect(r.state!.sides.p2.unit.stages).toMatchObject({ atk: 0 });
  });

  it("turns 缺省按 1 处理：省写形态与显式 turns:1 同一结果", () => {
    const r = turn(mk(), "act_mrew-default", "act_mdownpri");
    expect(stages(r.state!)).toMatchObject({ atk: 0 });
    expect(stageEvents(r.events)).toEqual([
      { side: "p1", stat: "atk", deltaApplied: -1, stageAfter: -1 },
      { side: "p1", stat: "atk", deltaApplied: 1, stageAfter: 0 },
    ]);
  });

  it("上一回合的提升不回溯：快照就是上一回合结束时的等级，故此刻无差异", () => {
    const t1 = turn(mk(), "act_mup").state!; // 第1回合 +1（快照仍是 0）
    expect(stages(t1)).toMatchObject({ atk: 1 });
    const r = turn(t1, "act_mrew"); // 第2回合开局快照 = 1 == 当前 → 无差异
    expect(stageEvents(r.events)).toEqual([]);
    expect(failed(r.events)).toEqual([{ side: "p1", reason: "no-stages" }]);
    expect(stages(r.state!)).toMatchObject({ atk: 1 });
  });

  it("与快照无差异 → action-failed no-stages，不动任何维", () => {
    const r = turn(mk(), "act_mrew"); // 第1回合开局：快照与当前都是全 0
    expect(stageEvents(r.events)).toEqual([]);
    expect(failed(r.events)).toEqual([{ side: "p1", reason: "no-stages" }]);
    expect(stages(r.state!)).toMatchObject({ atk: 0, def: 0, spd: 0 });
  });

  it("turns>1 没有回合级历史缓冲 → action-failed no-snapshot，不臆造历史", () => {
    const t1 = turn(mk(), "act_mup").state!;
    const r = turn(t1, "act_mrew2");
    expect(stageEvents(r.events)).toEqual([]);
    expect(failed(r.events)).toEqual([{ side: "p1", reason: "no-snapshot" }]);
    expect(stages(r.state!)).toMatchObject({ atk: 1 }); // 原样保留，没被清
  });
});
