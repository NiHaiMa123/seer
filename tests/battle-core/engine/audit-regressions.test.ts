/**
 * bug-audit B 批修复回归：B2 钩子链预算 / B3 声明反应KO中断动作 / B4 登场生命周期+force_switch换入结算 /
 * B5 续跑动作走完整派发链 / B6 teCursor 可恢复游标 / B7 endure 全维回卷。
 * fixture 均为 synthetic-v2（sm-hook-entry/sm-hook-hit/syn-forceswitch 为本批新增）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  applyReplacement, applyTurn, initBattle, loadPackFromDir,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "33333333333333333333333333333333";
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v2");

const ok = (r: ReturnType<typeof applyTurn> | ReturnType<typeof applyReplacement>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-audit` });
const evs = (r: { ok: boolean; events?: { type: string; detail: Record<string, unknown> }[] }, type: string) =>
  (r.ok ? (r.events ?? []).filter((e) => e.type === type) : []);
const smEvents = (r: { ok: boolean; events?: { type: string; detail: Record<string, unknown> }[] }, effect: string) =>
  evs(r, "soulmark").filter((e) => e.detail.effect === effect);
const withMark = (p1mark: string | undefined, opts: { p2mark?: string | (string | undefined)[]; p1bench?: string[]; p2bench?: string[]; p1?: string; p2?: string } = {}): CoreState =>
  initBattle(PACK, {
    battleId: "btl_audit", seedHex: SEED, p1: opts.p1 ?? "syn-gamma", p2: opts.p2 ?? "syn-delta",
    ...((opts.p1bench !== undefined || opts.p2bench !== undefined)
      ? { bench: { ...(opts.p1bench !== undefined ? { p1: opts.p1bench } : {}), ...(opts.p2bench !== undefined ? { p2: opts.p2bench } : {}) } }
      : {}),
    mechanics: {
      soulmark: {
        ...(p1mark !== undefined ? { p1: [p1mark] } : {}),
        ...(opts.p2mark !== undefined ? { p2: Array.isArray(opts.p2mark) ? opts.p2mark : [opts.p2mark] } : {}),
      },
    },
  });

describe("B2 魂印互弹链预算", () => {
  it("双方 onDamaged 互伤 → 预算截断（EngineFault），不产生无界事件流", () => {
    const s = initBattle(PACK, {
      battleId: "btl_audit", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-hook-hit"], p2: ["sm-hook-hit"] } },
    });
    // delta 先动打 gamma → gamma onDamaged 反5 → delta onDamaged 反5 → … 深度撞 maxCauseDepth
    const r = applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(String(r.fault.message)).toMatch(/maxCauseDepth|maxEffectApplications|EFFECT_LIMIT/);
  });
});

describe("B3 声明反应 KO 行动方 → 动作中断", () => {
  it("trigger:3 payload 击杀行动方后其招式不结算", () => {
    const s = withMark(undefined, { p1bench: ["syn-epsilon"] }); // KO 方是 p1——挂起需要 p1 有替补
    s.sides.p2.unit.effects.push({
      kind: "react", effectInstanceId: "r3", params: { trigger: 3 },
      payload: [{ op: "damage", kind: "fixed", power: 9999, target: "opponent" }],
    });
    s.sides.p1.unit.currentHp = 10;
    delete s.sides.p1.unit.soul; // 摘掉 endure——致命保留会拦截本测试要的 KO
    s.sides.p1.unit.revives = 0; // 关复活——否则 KO 被 revive 拦截不产生 suspension
    // delta 先动（drain 非伤害），随后 p1 动作开始 → p2 的 react3 触发 KO p1
    const r = applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-drain") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.suspension?.koSide).toBe("p1");
    // 全部伤害事件均落在 p1（react 固伤）——syn-strike 命中 p2 的伤害从未发生（B3 修复前照常出招）
    expect(evs(r, "damage").every((e) => e.detail.side === "p1")).toBe(true);
    const r2 = applyReplacement(PACK, r.state, { p1: act("act_switch-0"), p2: null });
    expect(r2.ok).toBe(true);
  });
});

describe("B4 登场生命周期补齐", () => {
  it("首发单位的 onEntry 在首个 TURN_START 补结算（engine 不为其派发换入）", () => {
    const s = withMark("sm-hook-entry"); // p1 持"登场令对手防御-1"
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "hook:onEntry")).toHaveLength(1);
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
  });

  it("换入路径 onEntry 只结算一次（entryInit 置位，下个 TURN_START 不重发）", () => {
    // loadout 槽位序 = 队伍序：slot0 现役 delta 无指定印（回退预设 tide-vein），slot1 epsilon 持 onEntry 印
    const s = withMark(undefined, { p2bench: ["syn-epsilon"], p2mark: [undefined, "sm-hook-entry"] });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_switch-0") }));
    expect(r.state.sides.p2.unit.speciesId).toBe("syn-epsilon");
    expect(smEvents(r, "hook:onEntry")).toHaveLength(1); // 换入时一次（首发双方均无 onEntry 印）
    const r2 = ok(applyTurn(PACK, r.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r2, "hook:onEntry")).toHaveLength(0); // 次回合不重复
  });

  it("force_switch 换入走 entrySettle：被换入单位的 onEntry 派发", () => {
    // markcaster 无预设魂印/无等级免疫——断言其 def 被入场威慑降至 -1
    const s = withMark(undefined, { p1: "syn-markcaster", p2bench: ["syn-epsilon"], p2mark: [undefined, "sm-hook-entry"] });
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-forceswitch"), p2: act("act_syn-strike") }));
    expect(evs(r, "switch").some((e) => e.detail.side === "p2" && e.detail.via === "forced")).toBe(true);
    expect(smEvents(r, "hook:onEntry")).toHaveLength(1);
    expect(r.state.sides.p2.unit.speciesId).toBe("syn-epsilon");
    expect(r.state.sides.p1.unit.stages.def).toBe(-1);
  });
});

describe("B5 续跑动作走完整派发链", () => {
  it("replacement 续跑的招式派发 onMoveUsed（修复前续跑路径漏钩子）", () => {
    const s = withMark("sm-hook-use", { p2bench: ["syn-epsilon"] });
    // p1 持 react3：p2 声明动作时被 9999 固伤击杀 → suspension 保留 p1 未执行的 strike
    s.sides.p1.unit.effects.push({
      kind: "react", effectInstanceId: "r3b", params: { trigger: 3 },
      payload: [{ op: "damage", kind: "fixed", power: 9999, target: "opponent" }],
    });
    s.sides.p2.unit.currentHp = 10;
    s.sides.p2.unit.revives = 0;
    const r = applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-drain") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.suspension?.koSide).toBe("p2");
    expect(r.state.suspension?.remaining.p1).toBe("act_syn-strike");
    const r2 = applyReplacement(PACK, r.state, { p1: null, p2: act("act_switch-0") });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // 续跑 p1 的 syn-strike（cat:2 物理）→ p1 侧 sm-hook-use onMoveUsed 派发（旧重放块漏此钩子——B5）
    expect(smEvents(r2, "hook:onMoveUsed").length).toBeGreaterThanOrEqual(1);
  });
});

describe("B6 teCursor 可恢复游标", () => {
  it("回合末 dot KO → 挂起带 teDone+teCursor；换入后剩余窗口不重算、旧单位窗口不落到新单位", () => {
    const s = withMark(undefined, { p2bench: ["syn-epsilon"] });
    // delta 注 burn（max/8=41/tick）且压血到 tick 以下 → W1 窗口内 KO
    s.sides.p2.unit.effects.push({ kind: "burn", effectInstanceId: "b1", appliedTurn: 0, remainingTurns: 5 });
    const tick = Math.floor(s.sides.p2.unit.base.hp / 8);
    s.sides.p2.unit.currentHp = Math.max(1, tick - 1);
    s.sides.p2.unit.revives = 0;
    // p1 用非伤害招——避免草克水 2 倍伤害在动作段直接击杀 delta（必须活到 TURN_END 才有 teCursor）
    const r = applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const susp = r.state.suspension;
    expect(susp?.koSide).toBe("p2");
    expect(susp?.teDone).toBe(true);
    expect(susp?.teCursor).toBeDefined();
    const r2 = applyReplacement(PACK, r.state, { p1: null, p2: act("act_switch-0") });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.sides.p2.unit.speciesId).toBe("syn-epsilon");
    expect(r2.state.sides.p2.unit.currentHp).toBe(r2.state.sides.p2.unit.base.hp); // 旧单位剩余窗口不落到新单位
    expect(evs(r2, "damage")).toHaveLength(0); // 无重复/错位的回合末伤害
    expect(r2.state.turn).toBe(2);
    expect(r2.state.phase).toBe("collect");
  });
});

describe("B7 endure 全维回卷", () => {
  it("快照期间新增的能力等级在回卷时归零（修复前残留）", () => {
    const s = withMark(undefined); // p1=syn-gamma 预设 sm-holy-guard（endure）
    expect(s.sides.p1.unit.soul).toBeDefined();
    s.sides.p1.unit.currentHp = 5; // delta 的 syn-strike 足以触发致命保留
    // 快照（init 时 prev.stages={}）之后新增的能力等级——回卷应全维归零
    s.sides.p1.unit.stages.atk = 3;
    s.sides.p1.unit.stages.spd = 2;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "endure_rewind")).toHaveLength(1);
    expect(r.state.sides.p1.unit.currentHp).toBe(r.state.sides.p1.unit.base.hp);
    expect(r.state.sides.p1.unit.stages.atk ?? 0).toBe(0);
    expect(r.state.sides.p1.unit.stages.spd ?? 0).toBe(0);
  });
});

describe("2026-10-04 批修复回归", () => {
  // 直接改 movesById 的用例各自取独立 pack（loadPackFromDir 每次全量加载，互不影响）
  const freshPack = () => loadPackFromDir(CONTENT, "synthetic-v2");
  const noSoul = (s: CoreState, side: "p1" | "p2") => {
    delete s.sides[side].unit.soul; // 摘魂印——endure 会拦致命
    s.sides[side].unit.revives = 0; // 关复活——否则 KO 被 revive 拦截不产生挂起
  };
  const coherent = (s: CoreState) =>
    (s.terminal !== null && s.suspension === undefined && s.phase === "end")
    || (s.terminal === null && s.suspension !== undefined && s.phase === "checkpoint")
    || (s.terminal === null && s.suspension === undefined && s.phase === "collect");

  it("cleanse 护盾反伤致死 → 走 checkpoint（ko + 挂起，不留尸体）", () => {
    const pack = freshPack();
    pack.movesById.get("syn-hex")!.effects = [{ op: "cleanse", scope: "shield", echoPct: 100, target: "opponent" }] as never;
    const s = initBattle(pack, {
      battleId: "btl_c", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      bench: { p1: ["syn-epsilon"], p2: ["syn-epsilon"] },
    });
    noSoul(s, "p1"); noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 200;
    s.sides.p2.unit.base.spd = 50;
    s.sides.p2.unit.currentHp = 30;
    s.sides.p2.unit.effects.push({ kind: "shield", effectInstanceId: "efx_sh", params: { flat: 80 }, appliedTurn: 1 });
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-hex"), p2: act("act_syn-hex") }));
    expect(evs(r, "ko").some((e) => e.detail.side === "p2")).toBe(true);
    expect(coherent(r.state)).toBe(true);
    expect(r.state.suspension?.koSide).toBe("p2"); // 双方有替补 → 挂起 p2 换人
    const r2 = ok(applyReplacement(pack, r.state, { p1: null, p2: act("act_switch-0") }));
    expect(r2.state.phase).toBe("collect");
  });

  it("clear_stages flatPerRemoved 致死 → 走 checkpoint", () => {
    const pack = freshPack();
    pack.movesById.get("syn-hex")!.effects = [{ op: "clear_stages", sign: "up", flatPerRemoved: 40, target: "opponent" }] as never;
    const s = initBattle(pack, {
      battleId: "btl_cs", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      bench: { p1: ["syn-epsilon"], p2: ["syn-epsilon"] },
    });
    noSoul(s, "p1"); noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 200;
    s.sides.p2.unit.base.spd = 50;
    s.sides.p2.unit.currentHp = 20;
    s.sides.p2.unit.stages.atk = 6;
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-hex"), p2: act("act_syn-hex") }));
    expect(evs(r, "ko").some((e) => e.detail.side === "p2")).toBe(true);
    expect(coherent(r.state)).toBe(true);
  });

  it("尾效果 KO 行动方：双死看替补——不判平局，逐侧接续换人", () => {
    const pack = freshPack();
    pack.movesById.get("syn-strike")!.effects = [
      { op: "damage", kind: "fixed", power: 9999, target: "opponent" },
      { op: "damage", kind: "fixed", power: 9999, target: "self" },
    ] as never;
    const s = initBattle(pack, {
      battleId: "btl_tail", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      bench: { p1: ["syn-epsilon"], p2: ["syn-epsilon"] },
    });
    noSoul(s, "p1"); noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 200;
    s.sides.p2.unit.base.spd = 50;
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-strike"), p2: act("act_syn-hex") }));
    // 修复前：terminal=draw 且 suspension 并存。修复后：双死但有替补 → 挂起接续
    expect(r.state.terminal).toBeNull();
    expect(r.state.suspension).toBeDefined();
    const first = r.state.suspension!.koSide;
    const r2 = ok(applyReplacement(pack, r.state, { p1: first === "p1" ? act("act_switch-0") : null, p2: first === "p2" ? act("act_switch-0") : null }));
    // 换入后另一侧尸体仍在 → 接续挂起该侧
    const other = first === "p1" ? "p2" : "p1";
    expect(r2.state.suspension?.koSide).toBe(other);
    const r3 = ok(applyReplacement(pack, r2.state, { p1: other === "p1" ? act("act_switch-0") : null, p2: other === "p2" ? act("act_switch-0") : null }));
    expect(r3.state.phase).toBe("collect");
    expect(r3.state.sides.p1.unit.currentHp).toBeGreaterThan(0);
    expect(r3.state.sides.p2.unit.currentHp).toBeGreaterThan(0);
    expect(r3.state.terminal).toBeNull();
  });

  it("双死且仅一方有替补 → 有替补方胜（非平局）", () => {
    const pack = freshPack();
    pack.movesById.get("syn-strike")!.effects = [
      { op: "damage", kind: "fixed", power: 9999, target: "opponent" },
      { op: "damage", kind: "fixed", power: 9999, target: "self" },
    ] as never;
    const s = initBattle(pack, {
      battleId: "btl_tail2", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      bench: { p1: ["syn-epsilon"] }, // 仅 p1 有替补
    });
    noSoul(s, "p1"); noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 200;
    s.sides.p2.unit.base.spd = 50;
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-strike"), p2: act("act_syn-hex") }));
    expect(r.state.terminal?.result).toBe("p1"); // p2 无人可上 → p1 胜
    expect(r.state.suspension).toBeUndefined();
    expect(evs(r, "ko")).toHaveLength(2); // 双方 KO 仪式各自播报一次
  });

  it("引擎 revives 复活封到 hpCapOf（上限被压时不得回到 base/2）", () => {
    const s = withMark(undefined);
    delete s.sides.p1.unit.soul; // 摘掉 endure 预设——否则致命保留先于 revive 拦截
    s.sides.p1.unit.revives = 1;
    const capCut = s.sides.p1.unit.base.hp - 50;
    s.sides.p1.unit.currentHp = 1;
    s.sides.p1.unit.effects.push({ kind: "modifier", at: "maxHpDown", label: "max_hp_down", effectInstanceId: "efx_cap", params: { flat: capCut }, appliedTurn: 1 });
    s.sides.p2.unit.base.spd = 200; // p2 先手补刀
    s.sides.p1.unit.base.spd = 50;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(evs(r, "revive").some((e) => e.detail.side === "p1")).toBe(true);
    expect(r.state.sides.p1.unit.currentHp).toBe(50); // 修复前 = floor(444/2)=222
  });

  it("魂印重生同样封到 hpCapOf", () => {
    const s = withMark("sm-revive"); // p1 持"死亡时 100% 重生一次"
    s.sides.p1.unit.revives = 0; // 走魂印路径而非引擎 revives
    const capCut = s.sides.p1.unit.base.hp - 50;
    s.sides.p1.unit.currentHp = 1;
    s.sides.p1.unit.effects.push({ kind: "modifier", at: "maxHpDown", label: "max_hp_down", effectInstanceId: "efx_cap", params: { flat: capCut }, appliedTurn: 1 });
    s.sides.p2.unit.base.spd = 200;
    s.sides.p1.unit.base.spd = 50;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "revive").length).toBeGreaterThanOrEqual(1);
    expect(r.state.sides.p1.unit.currentHp).toBe(50);
  });

  it("吸血封顶到 hpCapOf（max_hp_down 生效上限）", () => {
    const pack = freshPack();
    pack.movesById.get("syn-strike")!.effects = [
      { op: "damage", kind: "fixed", power: 80 },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 } },
    ] as never;
    const s = initBattle(pack, { battleId: "btl_dr", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    noSoul(s, "p1"); noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 200;
    s.sides.p2.unit.base.spd = 50;
    const capCut = s.sides.p1.unit.base.hp - 50;
    s.sides.p1.unit.currentHp = 40;
    s.sides.p1.unit.effects.push({ kind: "modifier", at: "maxHpDown", label: "max_hp_down", effectInstanceId: "efx_cap", params: { flat: capCut }, appliedTurn: 1 });
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-strike"), p2: act("act_syn-hex") }));
    expect(r.state.sides.p1.unit.currentHp).toBeLessThanOrEqual(50);
  });

  it("登场速度提升在首发第一回合即影响排序（preOrder 登场结算）", () => {
    // sm-hook-entry 变体：登场令自身速度+1级——preOrder 结算后 gamma(1.5×120=180) 快过 delta(150)。
    // 同优先级的 syn-strike 对撞：先动方由速度决定 → 首个 damage 受害者可观测。
    const pack = freshPack();
    const marks = (pack.mechanics as { soulmark: { soulmarks: Map<string, Record<string, unknown>> } }).soulmark.soulmarks;
    const base = marks.get("sm-hook-entry")!;
    marks.set("sm-entry-spd", {
      ...base,
      id: "sm-entry-spd",
      effects: [{ hook: "onEntry", ops: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" }] }],
    });
    const s = initBattle(pack, {
      battleId: "btl_po", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-entry-spd"] } },
    });
    noSoul(s, "p2");
    s.sides.p1.unit.base.spd = 120;
    s.sides.p2.unit.base.spd = 150;
    const r = ok(applyTurn(pack, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    // 登场提速生效 → p1 先动：首条 damage 落在 p2；旧行为（TURN_START 才补登场）delta 先动
    const dmg = evs(r, "damage");
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg[0]!.detail.side).toBe("p2");
    expect(r.state.sides.p1.unit.stages.spd).toBe(1);
  });
});
