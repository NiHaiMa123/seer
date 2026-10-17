/**
 * soulmark + fifth 机制专项（mechanics/soulmark、mechanics/fifth）。
 * fifth：第五槽进 moves/legalActions、走正常 PP/结算管线、loader 约束拒载。
 * soulmark：已冻住的 flag、钩子条目、事件审计、隐私投影、确定性。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  applyReplacement, applyTurn, compilePack, initBattle, legalActions, loadPackFromDir,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";
import { BattleHost } from "@seer/host";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));
const SEED = "22222222222222222222222222222222";

const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v2");
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const evs = (r: { ok: boolean; events?: { type: string; detail: Record<string, unknown> }[] }, type: string) =>
  (r.ok ? (r.events ?? []).filter((e) => e.type === type) : []);
const ge = (): CoreState => initBattle(PACK, { battleId: "btl_sm", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon" });
const gd = (): CoreState => initBattle(PACK, { battleId: "btl_sm", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
const raw = () => ({
  ruleset: read("rulesets/synthetic-v2.json"),
  pack: read("synthetic-v2/pack.json"),
  units: read("synthetic-v2/units.json"),
  moves: read("synthetic-v2/moves.json"),
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  seals: read("seals/seals.json"),
  soulmarks: read("synthetic-v2/soulmarks.json"),
  items: read("synthetic-v2/items.json"),
});

describe("fifth：第五技能", () => {
  it("携带列表替换普通槽，第五技能仍在，未点名的普通技能不进对局", () => {
    const s = initBattle(PACK, {
      battleId: "btl_carry", seedHex: SEED, p1: "syn-epsilon", p2: "syn-gamma",
      mechanics: { fifth: { p1: [["syn-strike", "syn-bolster"]] } },
    });
    expect(s.sides.p1.unit.moves.map((m) => m.moveId)).toEqual(["syn-strike", "syn-bolster", "fifth-drake-ruin"]);
    expect(legalActions(s, "p1")).not.toContain("act_syn-brand");
    expect(legalActions(s, "p1")).toContain("act_fifth-drake-ruin");
    // 不提交携带列表时，物种全部普通技能仍在（epsilon 5 普通 + 第五）
    const full = ge();
    expect(full.sides.p2.unit.moves).toHaveLength(6);
  });

  it("携带列表超过 4 个、重复、或不是普通技能 → 拒", () => {
    const boom = (moves: string[]) => initBattle(PACK, {
      battleId: "btl_carry_bad", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { fifth: { p1: [moves] } },
    });
    expect(() => boom(["syn-strike", "syn-jab", "syn-hex", "syn-blast", "syn-strike"])).toThrow(/<=4/);
    expect(() => boom(["syn-strike", "syn-strike"])).toThrow(/duplicated/);
    expect(() => boom(["fifth-verdant-aegis"])).toThrow(/not a normal move/);
  });

  it("fifthMoveId → 第五槽进 moves 且进 legalActions", () => {
    const s = gd();
    const moves = s.sides.p1.unit.moves.map((m) => m.moveId);
    expect(moves).toContain("fifth-verdant-aegis");
    expect(moves).toHaveLength(5); // 4 普通 + 1 第五
    expect(legalActions(s, "p1")).toContain("act_fifth-verdant-aegis");
    expect(PACK.movesById.get("fifth-verdant-aegis")!.fifth).toBe(true);
  });

  it("第五技能走正常出招管线：PP 扣减 + 效果结算（伤害+自回血）", () => {
    const s = gd();
    s.sides.p2.unit.currentHp = 400;
    const r = ok(applyTurn(PACK, s, { p1: act("act_fifth-verdant-aegis"), p2: act("act_syn-strike") }));
    expect(evs(r, "action-declared").some((e) => e.detail.moveId === "fifth-verdant-aegis")).toBe(true);
    expect(r.state.sides.p1.unit.moves.find((m) => m.moveId === "fifth-verdant-aegis")!.pp).toBe(4); // 5-1
    expect(evs(r, "damage").some((e) => e.detail.side === "p2")).toBe(true);
    expect(evs(r, "heal").some((e) => e.detail.side === "p1")).toBe(true); // 附带 heal
  });

  it("loader：fifthMoveId 必须指向 fifth:true 招式", () => {
    const r = raw();
    r.units.units.find((u: { id: string }) => u.id === "syn-gamma").fifthMoveId = "syn-strike";
    expect(() => compilePack(r)).toThrow(/fifth:true/);
  });

  it("loader：fifth:true 招式不允许混入 moveIds", () => {
    const r = raw();
    const u = r.units.units.find((x: { id: string }) => x.id === "syn-gamma");
    u.moveIds = [...u.moveIds, "fifth-verdant-aegis"];
    delete u.fifthMoveId;
    expect(() => compilePack(r)).toThrow(/fifthMoveId, not moveIds|assigned via fifthMoveId/);
  });

  it("loader：fifthMoveId 指向不存在招式 → 拒", () => {
    const r = raw();
    r.units.units.find((u: { id: string }) => u.id === "syn-gamma").fifthMoveId = "nope-move";
    expect(() => compilePack(r)).toThrow(/references unknown move/);
  });

  it("loader：ruleset 无 fifth feature → 字段拒载", () => {
    const r = raw();
    r.ruleset.features = r.ruleset.features.filter((f: string) => f !== "fifth");
    expect(() => compilePack(r)).toThrow(/requires ruleset feature "fifth"/);
  });

  it("loader：fifth 招式必须含伤害算子", () => {
    const r = raw();
    r.moves.moves.push({ id: "fifth-buff", name: "Buff", type: "草", pp: 5, priority: 0, fifth: true, effects: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] });
    r.units.units.find((u: { id: string }) => u.id === "syn-gamma").fifthMoveId = "fifth-buff";
    expect(() => compilePack(r)).toThrow(/must contain a damage/);
  });
});

describe("soulmark：装配与校验", () => {
  it("预设 soulMark → unit.soul 初始化（含 prev 快照，pp 覆盖全部招式槽）", () => {
    const s = gd();
    const soul = s.sides.p1.unit.soul!;
    expect(soul.id).toBe("sm-holy-guard");
    expect(soul.prev!.hp).toBe(s.sides.p1.unit.base.hp);
    expect(soul.prev!.pp["fifth-verdant-aegis"]).toBe(5); // 第五槽也在快照内
  });

  it("loadout 覆盖：mechanics.soulmark 槽位替换预设", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-tide-vein"] } },
    });
    expect(s.sides.p1.unit.soul!.id).toBe("sm-tide-vein");
  });

  it("loader：state_rewind 不再是 flag，schema 拒载", () => {
    const r = raw();
    r.soulmarks.soulmarks["sm-rewind"] = { id: "sm-rewind", name: "回卷", effects: [{ op: "state_rewind" }] };
    expect(() => compilePack(r)).toThrow(/soulmarks schema/);
  });

  it("loader：未知魂印 id 拒载 / 无 files.soulmarks 时 soulMark 拒载", () => {
    const r = raw();
    r.units.units.find((u: { id: string }) => u.id === "syn-gamma").soulMark = "sm-nope";
    expect(() => compilePack(r)).toThrow(/not in soulmarks catalog/);
    const r2 = raw();
    r2.pack = JSON.parse(JSON.stringify(r2.pack));
    delete r2.pack.files.soulmarks;
    delete r2.soulmarks;
    expect(() => compilePack(r2)).toThrow(/no files\.soulmarks/);
  });

  it("initBattle：loadout 未知魂印 → SOULMARK_RULE", () => {
    expect(() => initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-nope"] } },
    })).toThrow(/not in catalog/);
  });
});

describe("soulmark：运行时 op", () => {
  it("immune_control：control 打在有魂印的单位 → soulmark 事件 + 不入控", () => {
    const s = gd(); // p1=gamma(holy-guard) p2=delta
    s.sides.p2.unit.moves.push({ moveId: "syn-hex", pp: 10, ppMax: 10 }); // delta 借用 hex
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-hex") }));
    const sm = evs(r, "soulmark").find((e) => e.detail.effect === "immune_control");
    expect(sm).toBeDefined();
    expect(sm!.detail.mark).toBe("sm-holy-guard");
    expect(r.state.sides.p1.unit.effects.some((e) => e.kind.startsWith("control:"))).toBe(false);
  });

  it("endure：致命伤害 → 1 血存活 + 回合末回卷到上回合快照", () => {
    const s = ge(); // p1=gamma(444hp, holy-guard endure) p2=epsilon
    s.sides.p1.unit.currentHp = 5;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    // epsilon strike（含刻印面板）打 5hp 必死 → endure 保留 1 血
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "endure")).toBe(true);
    expect(r.state.sides.p1.unit.currentHp).toBeGreaterThan(0); // 未 KO
    // TURN_END：endure_rewind 回到回合开始时的 prev 快照（init 态 444 + 满 PP）
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "endure_rewind")).toBe(true);
    expect(r.state.sides.p1.unit.currentHp).toBe(444);
    // endured 标记持久（全局一次）；第二次致命不再 endure → 正常 KO
    expect(r.state.sides.p1.unit.soul!.endured).toBe(true);
    r.state.sides.p1.unit.currentHp = 1;
    const r2 = ok(applyTurn(PACK, r.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "soulmark").some((e) => e.detail.effect === "endure")).toBe(false);
    expect(evs(r2, "ko").some((e) => e.detail.side === "p1")).toBe(true);
  });

  it("revive：致命伤害 → 半血复活一次，二次致命正常 KO", () => {
    const s = initBattle(PACK, {
      battleId: "b_rev", seedHex: SEED, p1: "syn-gamma", p2: "syn-epsilon",
      mechanics: { soulmark: { p1: ["sm-revive"] } },
    });
    s.sides.p1.unit.currentHp = 5;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    // epsilon strike 打 5hp 必死 → revive 以最大体力一半复活
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "revive")).toBe(true);
    expect(r.state.sides.p1.unit.currentHp).toBe(Math.floor(r.state.sides.p1.unit.base.hp / 2));
    expect(r.state.sides.p1.unit.soul!.revived).toBe(true);
    // 二次致命：revived 已消耗 → 正常 KO，不再复活
    r.state.sides.p1.unit.currentHp = 1;
    const r2 = ok(applyTurn(PACK, r.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "soulmark").some((e) => e.detail.effect === "revive")).toBe(false);
    expect(evs(r2, "ko").some((e) => e.detail.side === "p1")).toBe(true);
  });

  it("priority_high_hp：高血时必先手（慢速精灵抢先出招）", () => {
    // gamma(spd70) 注入 tide-vein(boost2) vs delta(spd95)：jab(pri1)+2=3 > slam(pri0) → gamma 先动
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-tide-vein"] } },
    });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-slam") }));
    const first = evs(r, "action-declared")[0]!.detail;
    expect(first.side).toBe("p1"); // 慢速但必先手
    // 低血时 boost 失效 → 回到速度序（delta 先）
    const s2 = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-tide-vein"] } },
    });
    s2.sides.p1.unit.currentHp = 10;
    s2.sides.p2.unit.currentHp = 300;
    const r2 = ok(applyTurn(PACK, s2, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "action-declared")[0]!.detail.side).toBe("p2");
  });

  it("turn_pp_restore：每回合结束招式 PP +1（不超上限）", () => {
    const s = gd(); // p2=delta(tide-vein)
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const strike = r.state.sides.p2.unit.moves.find((m) => m.moveId === "syn-strike")!;
    expect(strike.pp).toBe(35); // 34 用招 +1 回复
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "turn_pp_restore")).toBe(true);
    // 满 PP 的招式不再触发 restored（事件只在实际恢复时发）
    const r2 = ok(applyTurn(PACK, r.state, { p1: act("act_syn-strike"), p2: act("act_syn-drain") }));
    const drain = r2.state.sides.p2.unit.moves.find((m) => m.moveId === "syn-drain")!;
    expect(drain.pp).toBe(15); // 14+1
  });

  it("turn_heal：每回合结束恢复 1/8 最大 HP（loadout 注入 sm-vitality）", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-vitality"] } },
    });
    s.sides.p1.unit.currentHp = 100;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const after = r.state.sides.p1.unit.currentHp;
    // 回合中被 delta strike 打过 + 回合末回 444/8=55
    const heal = evs(r, "heal").filter((e) => e.detail.side === "p1");
    expect(heal.length).toBeGreaterThanOrEqual(1);
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "turn_heal")).toBe(true);
    expect(after).toBeGreaterThan(0);
  });

  it("turn_flat：回合末对对手造成已损失 HP 的 1/8 固伤", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-echo-shell"] } },
    });
    s.sides.p2.unit.currentHp = 200; // 已损失 132 → flat floor(132/8)=16
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    const flat = evs(r, "damage").find((e) => e.detail.cause === "sm-echo-shell");
    expect(flat).toBeDefined();
    expect(flat!.detail.amount).toBe(16);
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "turn_flat")).toBe(true);
  });

  it("hit_shield：受击获得护盾 → 下一次伤害全免（shield_absorb 事件）", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p2: ["sm-echo-shell"] } },
    });
    // 第一次受击：伤害 + 获得护盾
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r1, "soulmark").some((e) => e.detail.effect === "hit_shield")).toBe(true);
    expect(r1.state.sides.p2.unit.soul!.shield).toBe(true);
    // 第二次受击：护盾吸收（无 damage 事件落到 p2）
    const hpBefore = r1.state.sides.p2.unit.currentHp;
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "soulmark").some((e) => e.detail.effect === "shield_absorb")).toBe(true);
    expect(evs(r2, "damage").some((e) => e.detail.side === "p2" && e.detail.cause === undefined)).toBe(false);
    expect(r2.state.sides.p2.unit.currentHp).toBe(hpBefore); // 护盾吃掉整次伤害（turn_flat 恢复可能已变——只断伤害不变）
    expect(r2.state.sides.p2.unit.soul!.shield).toBe(false);
  });

  it("entry_dispel：换入消除对手回合类效果", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] },
    });
    // gamma 挂 tag:marked（回合类）
    s.sides.p1.unit.effects.push({ kind: "tag:marked", effectInstanceId: "efx_p1_tag:marked", remainingTurns: 3, appliedTurn: 1 });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_switch-0") }));
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "entry_dispel")).toBe(true);
    expect(r.state.sides.p1.unit.effects.some((e) => e.kind === "tag:marked")).toBe(false);
  });

  it("immune_stage_down：负向 stage 被挡 → soulmark 事件 + stage 不变", () => {
    const s = ge(); // p2=epsilon(drake-shroud)
    s.sides.p1.unit.moves.push({ moveId: "fifth-tidal-crash", pp: 5, ppMax: 5 }); // gamma 借用（damage + spd-1 on opp）
    const r = ok(applyTurn(PACK, s, { p1: act("act_fifth-tidal-crash"), p2: act("act_syn-strike") }));
    expect(evs(r, "soulmark").some((e) => e.detail.effect === "immune_stage_down")).toBe(true);
    expect(r.state.sides.p2.unit.stages.spd).toBe(0);
  });
});

describe("soulmark：投影与确定性", () => {
  it("host observe：soul 双方可见但只出公开字段（id/endured/shield，无 prev/endurePending）", () => {
    const h = new BattleHost({
      pack: PACK, battleId: "btl_smh", seedHex: SEED,
      species: { p1: "syn-gamma", p2: "syn-epsilon" },
      players: { p1: "alice", p2: "bob" }, deadlineMs: 10_000,
    });
    const own = h.observe("alice");
    expect((own.own as { soul?: { id: string } }).soul?.id).toBe("sm-holy-guard");
    expect(JSON.stringify(own.own)).not.toContain("endurePending");
    expect(JSON.stringify(own.own)).not.toContain("prev");
    // 对手侧也公开（魂印=图鉴知识），同样无内部字段
    const foeSoul = (own.opponent as { soul?: { id: string } }).soul;
    expect(foeSoul?.id).toBe("sm-drake-shroud");
    expect(JSON.stringify(own.opponent)).not.toContain("endurePending");
    expect(JSON.stringify(own.opponent)).not.toContain("prev");
  });

  it("确定性：同 seed 两次同一战斗事件流字节一致（含魂印触发）", () => {
    const run = () => {
      const s = ge();
      s.sides.p1.unit.currentHp = 5; // 触发 endure
      const a = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
      const b = ok(applyTurn(PACK, a.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
      return JSON.stringify({ ev1: a.events, ev2: b.events, st: b.state });
    };
    expect(run()).toBe(run());
  });

  it("turn_flat KO → suspension（替补待决策）", () => {
    // p1=delta(echo-shell) 用非伤害招，固伤单独收掉 4hp 的 gamma（无 revive，bench=epsilon）
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-delta", p2: "syn-gamma", bench: { p2: ["syn-epsilon"] },
      mechanics: { soulmark: { p1: ["sm-echo-shell"] } },
    });
    s.sides.p2.unit.currentHp = 4; // flat lost(440)/8=55 > 4 → KO
    delete s.sides.p2.unit.soul; // 摘掉 gamma 的 endure——本测试要 flat 真实收头
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-drain"), p2: act("act_syn-strike") }));
    expect(r.state.suspension?.koSide).toBe("p2");
    const r2 = applyReplacement(PACK, r.state, { p1: null, p2: act("act_switch-0") });
    expect(r2.ok && r2.state.sides.p2.unit.speciesId).toBe("syn-epsilon");
  });

  it("回合末挂起 → replacement 不得二次跑 TURN_END（teDone 标记）", () => {
    // 固伤在 TURN_END 内 KO → suspension.teDone=true → 换入后不再衰减/再触发钩子
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] },
      mechanics: { soulmark: { p1: ["sm-echo-shell"] } },
    });
    s.sides.p2.unit.currentHp = 30;
    s.sides.p2.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(r.state.suspension?.koSide).toBe("p2");
    expect(r.state.suspension?.teDone).toBe(true);
    expect(evs(r, "soulmark").filter((e) => e.detail["effect"] === "turn_flat")).toHaveLength(1);
    const r2 = applyReplacement(PACK, r.state, { p1: null, p2: act("act_switch-0") });
    expect(r2.ok);
    if (!r2.ok) return;
    // 新换上的 epsilon 满血——turn_flat 没有对刚登场的单位二次触发
    expect(r2.state.sides.p2.unit.currentHp).toBe(r2.state.sides.p2.unit.base.hp);
    expect(r2.state.turn).toBe(2);
    expect(evs(r2, "soulmark").filter((e) => e.detail["effect"] === "turn_flat")).toHaveLength(0);
  });

  it("KO 截断语义：攻击方自愈/强化照常，指向倒下单位的 op 跳过", () => {
    // verdant-aegis = [damage, heal self 1/4]——击杀后回血仍应生效（不再被截断吞掉）
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    s.sides.p1.unit.currentHp = 50;
    s.sides.p2.unit.currentHp = 1;
    s.sides.p2.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_fifth-verdant-aegis"), p2: act("act_syn-strike") }));
    expect(r.state.terminal?.reason).toBe("ko");
    expect(evs(r, "heal")).toHaveLength(1);
    expect(r.state.sides.p1.unit.currentHp).toBeGreaterThan(50); // 受击+回血后仍比残血高
    // 挂起路径同样生效：bench 有替补时 KO→suspension，回血照发
    const s2 = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] } });
    s2.sides.p1.unit.currentHp = 50;
    s2.sides.p2.unit.currentHp = 1;
    s2.sides.p2.unit.revives = 0;
    const r2 = ok(applyTurn(PACK, s2, { p1: act("act_fifth-verdant-aegis"), p2: act("act_syn-strike") }));
    expect(r2.state.suspension?.koSide).toBe("p2");
    expect(evs(r2, "heal")).toHaveLength(1);
    // drake-ruin = [damage, clear_stages opponent]——目标已倒则 clear 跳过（不在尸体上发事件）
    const s3 = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-epsilon", p2: "syn-delta" });
    s3.sides.p2.unit.currentHp = 1;
    s3.sides.p2.unit.revives = 0;
    s3.sides.p2.unit.stages.atk = 2;
    const r3 = ok(applyTurn(PACK, s3, { p1: act("act_fifth-drake-ruin"), p2: act("act_syn-strike") }));
    expect(evs(r3, "ko")).toHaveLength(1);
    expect(evs(r3, "stages-cleared")).toHaveLength(0);
    expect(r3.state.sides.p2.unit.stages.atk).toBe(2); // 尸体 stages 保留（不入公开流）
  });

  it("动作中段挂起 → replacement 仍跑唯一一次 TURN_END（对照组）", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] },
      mechanics: { soulmark: { p1: ["sm-echo-shell"] } },
    });
    s.sides.p2.unit.currentHp = 1;
    s.sides.p2.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-strike") }));
    expect(r.state.suspension?.koSide).toBe("p2");
    expect(r.state.suspension?.teDone).toBeUndefined();
    const r2 = applyReplacement(PACK, r.state, { p1: null, p2: act("act_switch-0") });
    expect(r2.ok);
    if (!r2.ok) return;
    // TURN_END 在此处恰好跑一次：新换入的 epsilon 吃到 turn_flat（of=lost → 0 损失 → min 1）
    expect(evs(r2, "soulmark").filter((e) => e.detail["effect"] === "turn_flat")).toHaveLength(1);
    expect(r2.state.sides.p2.unit.currentHp).toBe(r2.state.sides.p2.unit.base.hp - 1);
  });
});

describe("next-apply 单次窗（下N次族）", () => {
  it("next_chance：下次判定消费一次（add 提升 effChance + faded 事件）", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-nextchance"] } },
    });
    // 挂载（onMoveUsed）与消费（onTurnEnd 判定）同回合序——每回合 挂→消 一个循环
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    // add:100 使 entry2 的 30% 判定必中 → heal 必发；消费一次后窗尽（不留残余到下回合）
    expect(evs(r1, "heal").some((e) => e.detail.side === "p1" && e.detail.amount === 10)).toBe(true);
    expect(evs(r1, "effect-faded").filter((e) => e.detail.name === "next_chance")).toHaveLength(1);
    expect(r1.state.sides.p1.unit.effects.some((e) => e.kind === "next_chance")).toBe(false);
    // 回合2：同节律——每回合恰消费一次（ei 门控只对 entry1 生效：ei=1 匹配第二条目索引）
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "heal").some((e) => e.detail.side === "p1" && e.detail.amount === 10)).toBe(true);
    expect(evs(r2, "effect-faded").filter((e) => e.detail.name === "next_chance")).toHaveLength(1);
  });

  it("react{trigger:11,count:1} + flatSelfLastHeal：恢复量固伤仅一次", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-reactwin"] } },
    });
    s.sides.p1.unit.currentHp = 200; // 制造回复空间
    s.sides.p2.unit.currentHp = 5000; // 防止载荷固伤+加成击倒
    // 回合1：onTurnEnd → heal 60 + 挂载 react/dmg_boost 单次窗
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") }));
    const healAmt = evs(r1, "heal").find((e) => e.detail.side === "p1")?.detail.amount as number;
    expect(healAmt).toBe(60);
    expect(r1.state.sides.p1.unit.effects.some((e) => e.kind === "react")).toBe(true);
    // 回合2：p1 用招 → react 载荷 flatSelfLastHeal 固伤=恢复量（仅一次）+ dmg_boost 加成
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "damage").some((e) => e.detail.side === "p2" && e.detail.amount === healAmt && e.detail.damageKind === "fixed")).toBe(true);
    expect(evs(r2, "effect-faded").some((e) => e.detail.name === "react")).toBe(true);
    // 回合3：窗尽——不再出现恢复量固伤
    const r3 = ok(applyTurn(PACK, r2.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r3, "damage").some((e) => e.detail.side === "p2" && e.detail.amount === healAmt && e.detail.damageKind === "fixed")).toBe(false);
  });

  it("dmg_boost{count:1}：下次攻击伤害提升仅生效一击", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-reactwin"] } },
    });
    s.sides.p1.unit.currentHp = 200;
    s.sides.p2.unit.currentHp = 5000;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") }));
    // 回合2：dmg_boost count:1 在首次出招消耗
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r2, "effect-faded").some((e) => e.detail.name === "dmg_boost")).toBe(true);
    // 回合3：无提升——同招伤害应显著低于回合2（同 seed 确定性对照）
    const r3 = ok(applyTurn(PACK, r2.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const std = (r: { ok: boolean; events?: { type: string; detail: Record<string, unknown> }[] }) =>
      evs(r, "damage").filter((e) => e.detail.side === "p2" && (e.detail.damageKind === undefined || e.detail.damageKind === "standard")).map((e) => e.detail.amount as number);
    expect(Math.max(...std(r2))).toBeGreaterThan(Math.max(...std(r3)));
  });
});
