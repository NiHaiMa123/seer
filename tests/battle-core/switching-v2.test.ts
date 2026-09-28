/**
 * M2-03 golden：bench/switch/replacement/revive + mid-turn 挂起续跑。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, legalActions, loadPackFromDir, type CoreState } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const PACK_V1 = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED = "00000000000000000000000000000001";

// p1=gamma(150hp 首发)+bench delta；p2=epsilon(boss 110hp)+bench gamma
const mk = (): CoreState =>
  initBattle(PACK, {
    battleId: "btl_t",
    seedHex: SEED,
    p1: "syn-gamma",
    p2: "syn-epsilon",
    bench: { p1: ["syn-delta"], p2: ["syn-gamma"] },
  });
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const evs = (r: ReturnType<typeof applyTurn>, type: string) => (r.ok ? r.events.filter((e) => e.type === type) : []);

describe("bench + switch", () => {
  it("init：bench 字段只在显式给出时存在（v1 无 bench 字段不进 hash）", () => {
    const withBench = mk();
    expect(withBench.sides.p1.bench).toHaveLength(1);
    expect(withBench.sides.p1.bench![0]!.unitId).toBe("unit_p1-b0");
    expect(withBench.sides.p1.bench![0]!.speciesId).toBe("syn-delta");
    const noBench = initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });
    expect("bench" in noBench.sides.p1).toBe(false); // 字段不存在 → v1 hash 不变
  });
  it("bench feature/size boundary：v1 拒绝 bench，v2 接受 2 个并拒绝第 3 个", () => {
    expect(() => initBattle(PACK_V1, {
      battleId: "btl_t", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta", bench: { p1: ["syn-beta"] },
    })).toThrow(/bench is not enabled/);
    expect(initBattle(PACK, {
      battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon", bench: { p1: ["syn-delta", "syn-epsilon"] },
    }).sides.p1.bench).toHaveLength(2);
    expect(() => initBattle(PACK, {
      battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon", bench: { p1: ["syn-delta", "syn-epsilon", "syn-gamma"] },
    })).toThrow(/exceeds 2/);
  });
  it("legal：switch 进入合法集；suspend 时非阵亡方合法集为空", () => {
    const s = mk();
    expect(legalActions(s, "p1")).toContain("act_switch-0");
    // 击杀首发 → 挂起
    s.sides.p2.unit.currentHp = 1;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(r.state.suspension?.koSide).toBe("p2");
    expect(legalActions(r.state, "p2")).toContain("act_switch-0");
    expect(legalActions(r.state, "p1")).toEqual([]); // 存活方无决策权
  });
  it("switch action：先于一切 move，换下保留自身 stages，换入用自己的状态", () => {
    const s = mk();
    s.sides.p1.unit.stages = { atk: 3, def: 0, spd: 0 };
    s.sides.p1.bench![0]!.stages = { atk: 0, def: 2, spd: 0 }; // bench 单位自己的 stage（模拟曾换出）
    const r = ok(applyTurn(PACK, s, { p1: act("act_switch-0"), p2: act("act_syn-strike") }));
    expect(evs(r, "switch")).toHaveLength(1);
    const sw = evs(r, "switch")[0]!.detail;
    expect(sw.via).toBe("action");
    expect(sw.outUnitId).toBe("unit_p1");
    expect(sw.inUnitId).toBe("unit_p1-b0");
    // 新 active 是 delta，带它自己的 stage；换下的 gamma 保留 {3,0,0}
    expect(r.state.sides.p1.unit.speciesId).toBe("syn-delta");
    expect(r.state.sides.p1.unit.stages.def).toBe(2);
    expect(r.state.sides.p1.bench![0]!.stages.atk).toBe(3);
  });
  it("负：换死 bench → invalid-action", () => {
    const s = mk();
    s.sides.p1.bench![0]!.currentHp = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_switch-0"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-failed").some((e) => e.detail.side === "p1")).toBe(true);
    expect(r.state.sides.p1.unit.speciesId).toBe("syn-gamma");
  });
});

describe("KO → replacement 挂起/续跑", () => {
  it("KO 挂起：发 ko + 挂 suspension，无 battle-end；替补方 action-declared 作废", () => {
    const s = mk();
    s.sides.p2.unit.currentHp = 5; // 一击必杀
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-blast") }));
    expect(r.state.suspension?.koSide).toBe("p2");
    expect(evs(r, "ko")).toHaveLength(1);
    expect(evs(r, "battle-end")).toHaveLength(0); // 未终局
    expect(evs(r, "battle-end").length).toBe(0);
    expect(r.state.phase).toBe("checkpoint");
  });
  it("applyReplacement：换入存活替补，完成 TURN_END，进入下一 collect", () => {
    const s = mk();
    s.sides.p2.unit.currentHp = 5;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const r2 = ok(applyReplacement(PACK, r1.state, { p1: null, p2: act("act_switch-0") }));
    expect(r2.state.suspension).toBeUndefined();
    expect(r2.state.sides.p2.unit.speciesId).toBe("syn-gamma"); // 换入 bench gamma
    expect(r2.state.sides.p2.unit.currentHp).toBe(444); // six-stat 面板：gamma hp=444
    expect(r2.state.sides.p2.bench![0]!.speciesId).toBe("syn-epsilon"); // 阵亡者进 bench
    expect(r2.state.sides.p2.bench![0]!.currentHp).toBe(0);
    expect(evs(r2, "switch")).toHaveLength(1);
    expect(evs(r2, "switch")[0]!.detail.via).toBe("replacement");
    expect(r2.state.phase).toBe("collect");
    expect(r2.state.turn).toBe(2);
  });
  it("未行动方：其 suspended remaining 在 replacement 后执行（未行动方剩余伤害结算）", () => {
    // 双方 PP 耗尽且 gamma 更快：p1 struggle 后被反伤 KO，p2 的 struggle 尚未行动。
    // replacement 换入 delta 后必须继续 p2 的 remaining action，而不是静默丢弃。
    // six-stat：epsilon 速度面板(187)反超 gamma(177) → 给 p1 +1 速度 stage 保持"先行被反伤 KO"的语义。
    const s = mk();
    for (const move of s.sides.p1.unit.moves) move.pp = 0;
    for (const move of s.sides.p2.unit.moves) move.pp = 0;
    s.sides.p1.unit.stages.spd = 1;
    s.sides.p1.unit.currentHp = 1;
    const r = ok(applyTurn(PACK, s, { p1: act("act_struggle"), p2: act("act_struggle") }));
    expect(r.state.suspension?.koSide).toBe("p1");
    expect(r.state.suspension!.remaining.p1).toBeNull();
    expect(r.state.suspension!.remaining.p2).toBe("act_struggle");
    // p1 struggle 打 epsilon：floor(444/4)=111 → eps 434-111=323；recoil floor(444/8)=55 → p1 KO
    expect(r.state.sides.p2.unit.currentHp).toBe(323);
    const r2 = ok(applyReplacement(PACK, r.state, { p1: act("act_switch-0"), p2: null }));
    expect(r2.state.sides.p1.unit.speciesId).toBe("syn-delta");
    // 换入的 delta(hp332) 吃 epsilon struggle floor(434/4)=108 → 224；eps 反伤 floor(434/8)=54 → 269
    expect(r2.state.sides.p1.unit.currentHp).toBe(224);
    expect(r2.state.sides.p2.unit.currentHp).toBe(269);
    expect(evs(r2, "struggle-used")).toHaveLength(1);
    expect(r2.state.phase).toBe("collect");
    expect(r2.state.turn).toBe(2);
  });
  it("concede 于 replacement → 判负", () => {
    const s = mk();
    s.sides.p2.unit.currentHp = 5;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const r2 = ok(applyReplacement(PACK, r1.state, { p1: null, p2: act("act_concede") }));
    expect(r2.state.terminal).toEqual({ result: "p1", reason: "concede" });
  });
  it("无 bench 的 KO 直接终局（v1 行为不变）", () => {
    const s = initBattle(PACK, { battleId: "btl_t", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });
    s.sides.p2.unit.currentHp = 5;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(r.state.terminal).toEqual({ result: "p1", reason: "ko" });
    expect(r.state.suspension).toBeUndefined();
  });
});

describe("revive", () => {
  it("revives>0：消耗次数原地复活 hp=floor(max/2)，战斗继续", () => {
    // delta revives=1：用 delta 作 p2，bench 给 gamma
    const s = initBattle(PACK, {
      battleId: "btl_t", seedHex: SEED, p1: "syn-epsilon", p2: "syn-delta",
      bench: { p2: ["syn-gamma"] },
    });
    s.sides.p2.unit.currentHp = 5;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r, "revive")).toHaveLength(1);
    expect(r.state.sides.p2.unit.revives).toBe(0);
    expect(r.state.sides.p2.unit.currentHp).toBe(166); // floor(332/2)：six-stat delta 面板 hp=332
    expect(r.state.suspension).toBeUndefined();
    expect(evs(r, "ko")).toHaveLength(0);
  });
  it("revives 耗尽后再 KO → 有 bench 挂起", () => {
    const s = initBattle(PACK, {
      battleId: "btl_t", seedHex: SEED, p1: "syn-epsilon", p2: "syn-delta",
      bench: { p2: ["syn-gamma"] },
    });
    s.sides.p2.unit.revives = 0;
    s.sides.p2.unit.currentHp = 5;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(r.state.suspension?.koSide).toBe("p2"); // bench gamma 存活 → 挂起
  });
});
