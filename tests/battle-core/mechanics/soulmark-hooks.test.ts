/**
 * soulmark hook×ops 通用派发（S1 批）：hook 生命周期钩子 + guard/chance/elseOps/bossGate + 原子 op 复用。
 * fixture 均为 synthetic-v2 注入魂印（sm-hook-*），语义 SYNTHETIC——只验证派发骨架正确性。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  applyTurn, compilePack, initBattle, loadPackFromDir,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";

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
const withMark = (p1mark: string, opts: { p2mark?: string; p1bench?: string[]; p2bench?: string[] } = {}): CoreState =>
  initBattle(PACK, {
    battleId: "btl_smk", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
    ...((opts.p1bench !== undefined || opts.p2bench !== undefined) ? { bench: { ...(opts.p1bench !== undefined ? { p1: opts.p1bench } : {}), ...(opts.p2bench !== undefined ? { p2: opts.p2bench } : {}) } } : {}),
    mechanics: { soulmark: { p1: [p1mark], ...(opts.p2mark !== undefined ? { p2: [opts.p2mark] } : {}) } },
  });
const smEvents = (r: ReturnType<typeof ok>, effect: string) =>
  evs(r, "soulmark").filter((e) => e.detail.effect === effect);

describe("soulmark hook：onTurnStart", () => {
  it("每回合开始时令对手防御-1（在行动前结算）", () => {
    const s = withMark("sm-hook-start");
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "hook:onTurnStart")).toHaveLength(1);
    const st = evs(r, "stat-stage").find((e) => e.detail.side === "p2" && e.detail.stat === "def");
    expect(st).toBeDefined();
    expect(st!.detail.deltaApplied).toBe(-1);
    // 事件序：hook 的 stat-stage 先于任何 action-declared（回合开始先于行动）
    const idx = r.events!.findIndex((e) => e.type === "stat-stage");
    const firstAct = r.events!.findIndex((e) => e.type === "action-declared");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(firstAct).toBeGreaterThan(idx);
    expect(r.state.sides.p2.unit.stages.def).toBe(-1);
  });

  it("chance + elseOps：chance 未过 → elseOps 结算（确定性单分支）", () => {
    const s = withMark("sm-hook-gamble");
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "hook:onTurnStart")).toHaveLength(1);
    const healSelf = evs(r, "heal").some((e) => e.detail.side === "p1");
    const flatFoe = evs(r, "damage").some(
      (e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 10,
    );
    // 固定 seed 下恰好一条路径生效（heal:30 self 或 fixed:10 foe）
    expect(healSelf !== flatFoe).toBe(true);
  });
});

describe("soulmark hook：beforeOrder（随机先制）", () => {
  it("orderRoll 钩子：消耗 rng + soulmark 事件 + 双跑一致", () => {
    const run = () => {
      const s = withMark("sm-hook-order");
      const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
      return { ev: r.events, order: evs(r, "action-declared").map((e) => e.detail.side), draws: r.state.rng.drawCounter };
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // 确定性
    expect(a.ev.some((e) => e.type === "soulmark" && e.detail.effect === "hook:beforeOrder")).toBe(true);
    // orderRoll draw 记录在 rng.draws 审计流（drawCounter 增加）
    expect(a.draws).toBeGreaterThan(0);
  });
});

describe("soulmark hook：onMoveUsed", () => {
  it("actor:self + cat:2——自身物理技结算后对对手固伤30", () => {
    const s = withMark("sm-hook-use");
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    // p2 用属性技不触发 p1 的 actor:self 条目；p1 strike(物理) 触发
    const smEv = smEvents(r, "hook:onMoveUsed").filter((e) => e.detail.side === "p1");
    expect(smEv.length).toBeGreaterThanOrEqual(1);
    const flat = evs(r, "damage").some((e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 30);
    expect(flat).toBe(true);
  });

  it("cat 门控：属性技（cat:1）不触发 cat:2 条目", () => {
    const s = withMark("sm-hook-use");
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-purge-mind") }));
    // p1 用属性技 → actor:self 条目不触发
    const flat = evs(r, "damage").some((e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 30);
    expect(flat).toBe(false);
  });

  it("actor:foe——对手使用技能时自身恢复15", () => {
    const s = withMark("sm-hook-use");
    s.sides.p1.unit.currentHp = 100;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    // p2 strike（actor:foe 视角=p2 行动方）→ p1 回血15
    const heal = evs(r, "heal").find((e) => e.detail.side === "p1" && e.detail.amount === 15);
    expect(heal).toBeDefined();
  });
});

describe("soulmark hook：onKO", () => {
  it("victim:foe——击败对手时恢复自身1/4", () => {
    const s = withMark("sm-hook-ko");
    s.sides.p1.unit.currentHp = 100; // 残血验证回血量
    s.sides.p2.unit.currentHp = 1;
    s.sides.p2.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-strike") }));
    expect(r.state.terminal?.result).toBe("p1");
    expect(smEvents(r, "hook:onKO")).toHaveLength(1);
    // KO 发生于 p1 行动段；回血在 ko 之后（事件序）
    const koIdx = r.events!.findIndex((e) => e.type === "ko" && e.detail.side === "p2");
    const healIdx = r.events!.findIndex((e) => e.type === "heal" && e.detail.side === "p1");
    expect(koIdx).toBeGreaterThanOrEqual(0);
    expect(healIdx).toBeGreaterThan(koIdx);
    expect(r.state.sides.p1.unit.currentHp).toBe(100 + Math.floor(444 / 4)); // 444/4=111
  });

  it("victim:self——自身倒下时令对手攻击-1（倒下者魂印照常发）", () => {
    const s = withMark("sm-hook-start", { p2mark: "sm-hook-down" });
    s.sides.p2.unit.currentHp = 1;
    s.sides.p2.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-strike") }));
    expect(r.state.terminal?.result).toBe("p1");
    const down = smEvents(r, "hook:onKO").filter((e) => e.detail.side === "p2");
    expect(down).toHaveLength(1);
    expect(r.state.sides.p1.unit.stages.atk).toBe(-1);
  });

  it("victim 极性不误触：自身倒下时 victim:foe 条目不发", () => {
    const s = withMark("sm-hook-ko");
    s.sides.p1.unit.currentHp = 1;
    s.sides.p1.unit.revives = 0;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-slam") }));
    expect(r.state.terminal?.result).toBe("p2");
    // p1 倒下 → p1 的 victim:foe 不触发（对手没死）
    expect(smEvents(r, "hook:onKO")).toHaveLength(0);
    expect(evs(r, "heal").some((e) => e.detail.side === "p1")).toBe(false);
  });
});

describe("soulmark hook：onSwitchOut", () => {
  it("换下时恢复自身1/10（换离前结算，回血落在下场单位上）", () => {
    const s = withMark("sm-hook-exit", { p1bench: ["syn-epsilon"] });
    s.sides.p1.unit.currentHp = 100;
    const r = ok(applyTurn(PACK, s, { p1: act("act_switch-0"), p2: act("act_syn-strike") }));
    expect(evs(r, "switch").some((e) => e.detail.side === "p1")).toBe(true);
    expect(smEvents(r, "hook:onSwitchOut")).toHaveLength(1);
    // 换下的是 gamma：回血落在 bench 里的 gamma 上
    const benched = r.state.sides.p1.bench!.find((b) => b.unitId !== r.state.sides.p1.unit.unitId)!;
    expect(benched.currentHp).toBe(100 + Math.floor(444 / 10)); // +44
  });
});

describe("soulmark hook：S2 扩展语义", () => {
  it("onBattleStart：仅首回合（turn===1）触发一次，之后不再结算", () => {
    const s = withMark("sm-hook-battle");
    s.sides.p1.unit.currentHp = 100;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r1, "hook:onBattleStart")).toHaveLength(1);
    expect(r1.state.sides.p1.unit.currentHp).toBeGreaterThan(100);
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r2, "hook:onBattleStart")).toHaveLength(0);
  });

  it("switcher:foe——对手换下时回血；自身换下不触发", () => {
    const s = withMark("sm-hook-foeswitch", { p2bench: ["syn-epsilon"] });
    s.sides.p1.unit.currentHp = 100;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_switch-0") }));
    expect(evs(r, "switch").some((e) => e.detail.side === "p2")).toBe(true);
    expect(smEvents(r, "hook:onSwitchOut")).toHaveLength(1);
    expect(evs(r, "heal").some((e) => e.detail.side === "p1" && e.detail.amount === 30)).toBe(true);

    // 自身换下：switcher:foe 条目不触发（观察侧=换下方时被过滤）
    const s2 = withMark("sm-hook-foeswitch", { p1bench: ["syn-epsilon"] });
    const r2 = ok(applyTurn(PACK, s2, { p1: act("act_switch-0"), p2: act("act_syn-strike") }));
    expect(smEvents(r2, "hook:onSwitchOut")).toHaveLength(0);
  });

  it("chanceGrow：每次判定后概率累积，cap 封顶（soul.chanceAcc 内部记账）", () => {
    const s = withMark("sm-hook-grow");
    const acc = (st: CoreState) => (st.sides.p1.unit as unknown as { soul?: { chanceAcc?: Record<number, number> } }).soul?.chanceAcc?.[0] ?? 0;
    expect(acc(s)).toBe(0);
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(acc(r1.state)).toBe(50); // 30 → 80 有效；记账 +50
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(acc(r2.state)).toBe(50); // cap 80 - base 30 = 封顶 50
  });

  it("growStep：每次结算幅度累积注入 op 分数字段，growCap 封顶（soul.magAcc 内部记账）", () => {
    const s = withMark("sm-hook-maggrow");
    s.sides.p1.unit.currentHp = 45; // 伤害浮动上限内存活；missing 足够观察 4 轮回血
    const healAmt = (r: ReturnType<typeof ok>) => evs(r, "heal").find((e) => e.detail.side === "p1")?.detail.amount;
    const acc = (st: CoreState) => (st.sides.p1.unit as unknown as { soul?: { magAcc?: Record<number, number> } }).soul?.magAcc?.[0] ?? 0;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(healAmt(r1)).toBe(88); // 20%×444
    expect(acc(r1.state)).toBe(10);
    r1.state.sides.p1.unit.currentHp = 45;
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(healAmt(r2)).toBe(133); // 30%×444
    r2.state.sides.p1.unit.currentHp = 45;
    const r3 = ok(applyTurn(PACK, r2.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(healAmt(r3)).toBe(177); // 40%×444（cap 40 封顶，不再增长）
    r3.state.sides.p1.unit.currentHp = 45;
    const r4 = ok(applyTurn(PACK, r3.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(healAmt(r4)).toBe(177); // 封顶后仍 40%
    expect(acc(r4.state)).toBe(40);
  });

  it("达顶负载在主 op 之后派发，未达顶不派发", () => {
    const s = withMark("sm-hook-atcap");
    s.sides.p1.unit.currentHp = 50;
    const fixed7 = (r: ReturnType<typeof ok>) =>
      evs(r, "damage").filter((e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 7);
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(evs(r1, "heal").some((e) => e.detail.side === "p1" && e.detail.amount === 10)).toBe(true);
    expect(fixed7(r1)).toHaveLength(0);
    r1.state.sides.p1.unit.currentHp = 50;
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const events = r2.events ?? [];
    const healAt = events.findIndex((e) => e.type === "heal" && e.detail.side === "p1" && e.detail.amount === 20);
    const dmgAt = events.findIndex((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 7);
    expect(healAt).toBeGreaterThanOrEqual(0);
    expect(dmgAt).toBeGreaterThan(healAt);
  });

  it("limitBattle：每场战斗限一次——第二回合不再触发", () => {
    const s = withMark("sm-hook-limit");
    s.sides.p1.unit.currentHp = 50;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r1, "hook:onTurnEnd")).toHaveLength(1);
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r2, "hook:onTurnEnd")).toHaveLength(0);
  });

  it("常驻被动：onBattleStart + apply_status 永久 dmg_taken_down（承伤减半且不重复叠加）", () => {
    const s = withMark("sm-passive-ward");
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-slam") }));
    const effs = (r1.state.sides.p1.unit.effects as { kind: string; label?: string; params?: { pct?: number } }[]).filter((e) => e.label === "dmg_taken_down");
    expect(effs).toHaveLength(1);
    expect(effs[0]!.params?.pct).toBe(50);
    const r2 = ok(applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect((r2.state.sides.p1.unit.effects as { kind: string; label?: string }[]).filter((e) => e.label === "dmg_taken_down")).toHaveLength(1);
    // 承伤确有减免：对比无印同 seed 同动作下 p2 伤害减半
    const s0 = initBattle(PACK, { battleId: "btl_smk", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    const r0 = ok(applyTurn(PACK, s0, { p1: act("act_syn-strike"), p2: act("act_syn-slam") }));
    const dmg = (r: typeof r1) => evs(r, "damage").filter((e) => e.detail.side === "p1" && (e.detail.amount as number) > 0).map((e) => e.detail.amount as number);
    const marked = dmg(r1);
    const unmarked = dmg(r0);
    expect(marked.length).toBe(unmarked.length);
    for (const [i, a] of marked.entries()) expect(a).toBe(Math.floor(unmarked[i]! / 2));
  });
});

describe("soulmark hook：bossGate", () => {
  it("bossGate:true——对手为普通单位时触发，对手带 mode=boss 时抑制", () => {
    const s = withMark("sm-hook-boss");
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r, "hook:onTurnEnd")).toHaveLength(1);
    expect(evs(r, "damage").some((e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 10)).toBe(true);

    const s2 = withMark("sm-hook-boss");
    s2.sides.p2.unit.mode = "boss"; // PVE boss 标记
    const r2 = ok(applyTurn(PACK, s2, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(smEvents(r2, "hook:onTurnEnd")).toHaveLength(0);
    expect(evs(r2, "damage").some((e) => e.detail.side === "p2" && e.detail.damageKind === "fixed" && e.detail.amount === 10)).toBe(false);
  });
});

describe("soulmark hook：loader 校验", () => {
  const rawV2 = () => ({
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

  it("priority 缺 max 时 schema 拒载", () => {
    const r = rawV2();
    r.soulmarks.soulmarks["sm-bad-prio"] = {
      id: "sm-bad-prio", name: "BadPrio",
      effects: [{ hook: "beforeOrder", ops: [{ op: "priority", min: 1 }] }],
    };
    expect(() => compilePack(r)).toThrow();
  });

  it("grow 的 of 不是 magnitude 时 schema 拒载", () => {
    const r = rawV2();
    r.soulmarks.soulmarks["sm-bad-grow"] = {
      id: "sm-bad-grow", name: "BadGrow",
      effects: [{ hook: "onTurnEnd", ops: [{ op: "grow", of: "other", step: 1 }, { op: "heal", flat: 1, target: "self" }] }],
    };
    expect(() => compilePack(r)).toThrow();
  });

  it("hook 条目 ops 走 moves.schema effect 校验：非法字段拒载", () => {
    const r = rawV2();
    r.soulmarks.soulmarks["sm-bad"] = {
      id: "sm-bad", name: "Bad",
      effects: [{ hook: "onTurnStart", ops: [{ op: "heal", target: "self", bogusField: 1 }] }],
    };
    expect(() => compilePack(r)).toThrow();
  });

  it("onKO 缺 victim / onMoveUsed 缺 actor → schema 拒载", () => {
    const r = rawV2();
    r.soulmarks.soulmarks["sm-bad-ko"] = {
      id: "sm-bad-ko", name: "BadKO",
      effects: [{ hook: "onKO", ops: [{ op: "heal", flat: 1, target: "self" }] }],
    };
    expect(() => compilePack(r)).toThrow();
    const r2 = rawV2();
    r2.soulmarks.soulmarks["sm-bad-mu"] = {
      id: "sm-bad-mu", name: "BadMU",
      effects: [{ hook: "onMoveUsed", ops: [{ op: "heal", flat: 1, target: "self" }] }],
    };
    expect(() => compilePack(r2)).toThrow();
  });

  it("hook ops 引用未注册 op → compile 拒载", () => {
    const r = rawV2();
    r.soulmarks.soulmarks["sm-bad-op"] = {
      id: "sm-bad-op", name: "BadOp",
      effects: [{ hook: "onTurnStart", ops: [{ op: "not_a_real_op", target: "self" }] }],
    };
    // schema 放行形状（op:minLength1），OPS 注册表校验拦截语义存在性
    expect(() => compilePack(r)).toThrow(/not in ops registry|schema/);
  });
});

describe("soulmark hook：onTurnEnd order 序位", () => {
  // syn-gamma spd70 < syn-delta spd95 → p1 后行动（order:last），p2 先行动
  it("guard:{order:last}——后行动方触发，先行动方不触发", () => {
    const s = withMark("sm-hook-orderlast", { p2mark: "sm-hook-orderlast" });
    s.sides.p1.unit.currentHp = 60;
    s.sides.p2.unit.currentHp = 40;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    const heals = evs(r, "heal").filter((e) => e.detail.amount === 25);
    // p1（慢）后出手 → 回血；p2（快）先出手 → guard 不满足不回血
    expect(heals.some((e) => e.detail.side === "p1")).toBe(true);
    expect(heals.some((e) => e.detail.side === "p2")).toBe(false);
  });
});

describe("soulmark hook：确定性", () => {
  it("同 seed 双跑字节一致（orderRoll 消耗 rng 不回放漂移）", () => {
    const run = () => {
      const s = withMark("sm-hook-order", { p2mark: "sm-hook-gamble" });
      const a = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-strike") }));
      const b = ok(applyTurn(PACK, a.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
      return JSON.stringify({ ev1: a.events, ev2: b.events, st: b.state });
    };
    expect(run()).toBe(run());
  });
});

describe("soulmark streak：类别连用", () => {
  // p2 用 sm-vitality：默认 sm-tide-vein 在体力更高时 +2 先制，会盖住连用先制断言。
  // syn-gamma spd70 < syn-delta spd95，无先制时 delta 先动。
  const declared = (r: ReturnType<typeof ok>) => evs(r, "action-declared").map((e) => e.detail.side);
  const fixed = (r: ReturnType<typeof ok>, amount: number) =>
    evs(r, "damage").filter((e) => e.detail.damageKind === "fixed" && e.detail.amount === amount);

  it("先制+1：首动不成立，第二动攻击才提前，换到属性再换回都打断", () => {
    const s = withMark("sm-streak-prio", { p2mark: "sm-vitality" });
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(declared(t1)).toEqual(["p2", "p1"]);
    expect(smEvents(t1, "hook:beforeOrder")).toHaveLength(0);
    // 声明点写 lastMoveCat；prevMoveCat 只在回合初拷贝，本回合内不刷新。
    expect(t1.state.sides.p1.unit.lastMoveCat).toBe(2);
    expect(t1.state.sides.p1.unit.prevMoveCat).toBeUndefined();

    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(t2.state.sides.p1.unit.prevMoveCat).toBe(2);
    expect(declared(t2)).toEqual(["p1", "p2"]);
    const boost = smEvents(t2, "hook:beforeOrder");
    expect(boost).toHaveLength(1);
    expect(boost[0]!.detail).toMatchObject({ side: "p1", boost: 1 });

    const t3 = ok(applyTurn(PACK, t2.state, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(declared(t3)).toEqual(["p2", "p1"]);
    expect(smEvents(t3, "hook:beforeOrder")).toHaveLength(0);
    expect(t3.state.sides.p1.unit.prevMoveCat).toBe(2);
    expect(t3.state.sides.p1.unit.lastMoveCat).toBe(1);

    const t4 = ok(applyTurn(PACK, t3.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(declared(t4)).toEqual(["p2", "p1"]);
    expect(smEvents(t4, "hook:beforeOrder")).toHaveLength(0);
  });

  it("不同招式仍算攻击连用：固伤 40 只出现在第二动", () => {
    const s = withMark("sm-streak-flat", { p2mark: "sm-vitality" });
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(fixed(t1, 40)).toHaveLength(0);
    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-blast"), p2: act("act_syn-purge-mind") }));
    const hit = fixed(t2, 40);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.detail.side).toBe("p2");
  });

  it("出伤窗赶在本击之前挂上，本击消耗，换类别后不再挂", () => {
    const s = withMark("sm-streak-boost", { p2mark: "sm-vitality" });
    const std = (r: ReturnType<typeof ok>) =>
      evs(r, "damage").find((e) => e.detail.side === "p2" && e.detail.damageKind === undefined);
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(evs(t1, "effect-applied").some((e) => e.detail.name === "dmg_boost")).toBe(false);
    const base = std(t1);
    expect(base).toBeDefined();

    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    const ev = t2.events!;
    const applied = ev.findIndex((e) => e.type === "effect-applied" && e.detail.name === "dmg_boost");
    const faded = ev.findIndex((e) => e.type === "effect-faded" && e.detail.name === "dmg_boost");
    const dmgAt = ev.findIndex((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.damageKind === undefined);
    // count 在伤害公式里读完 pct 后、damage 事件发出前消耗。
    expect(applied).toBeGreaterThanOrEqual(0);
    expect(applied).toBeLessThan(faded);
    expect(faded).toBeLessThan(dmgAt);
    expect(t2.state.sides.p1.unit.effects.some((e) => e.label === "dmg_boost")).toBe(false);
    // 伤害有 217–255 的随机系数，跨回合不能拿上一击直接 ×2。同一 seed、同样出招的对照局里系数对齐，翻倍落在本击。
    const ctrl = withMark("sm-vitality", { p2mark: "sm-vitality" });
    const c1 = ok(applyTurn(PACK, ctrl, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    const c2 = ok(applyTurn(PACK, c1.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    const plain = std(c2)!.detail.amount as number;
    expect(std(c1)!.detail.amount).toBe(base!.detail.amount);
    expect(std(t2)!.detail.amount).toBe(Math.floor(plain * 2));

    const t3 = ok(applyTurn(PACK, t2.state, { p1: act("act_syn-hex"), p2: act("act_syn-purge-mind") }));
    expect(evs(t3, "effect-applied").some((e) => e.detail.name === "dmg_boost")).toBe(false);
    const t4 = ok(applyTurn(PACK, t3.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(evs(t4, "effect-applied").some((e) => e.detail.name === "dmg_boost")).toBe(false);
  });

  it("属性连用第二动才防御-1；对手被控也不打断持有者的连用", () => {
    const s = withMark("sm-streak-status", { p2mark: "sm-vitality" });
    const drop = (r: ReturnType<typeof ok>) =>
      evs(r, "stat-stage").filter((e) => e.detail.side === "p2" && e.detail.stat === "def" && e.detail.deltaApplied === -1);
    // p2 用攻击而不是净化：净化会穿透控制，眩晕就拦不住。
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    expect(drop(t1)).toHaveLength(0);
    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-hex"), p2: act("act_syn-strike") }));
    // delta 更快，T1 的眩晕落在 p2 已经动完之后；T2 p2 被控失败，p1 的属性连用照常结算。
    expect(evs(t2, "action-failed").some((e) => e.detail.side === "p2" && e.detail.reason === "controlled")).toBe(true);
    expect(drop(t2)).toHaveLength(1);
    expect(t2.state.sides.p2.unit.stages.def).toBe(-1);
  });

  it("同一技能：首动没有固伤，第二动同一招才有，换招再换回都打断", () => {
    const s = withMark("sm-samemove-flat", { p2mark: "sm-vitality" });
    const hit40 = (r: ReturnType<typeof ok>) => fixed(r, 40);
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    expect(hit40(t1)).toHaveLength(0);
    expect(t1.state.sides.p1.unit.lastMoveId).toBe("syn-strike");
    expect(t1.state.sides.p1.unit.prevMoveId).toBeUndefined();

    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(t2.state.sides.p1.unit.prevMoveId).toBe("syn-strike");
    const hit = hit40(t2);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.detail.side).toBe("p2");

    const t3 = ok(applyTurn(PACK, t2.state, { p1: act("act_syn-blast"), p2: act("act_syn-purge-mind") }));
    expect(t3.state.sides.p1.unit.prevMoveId).toBe("syn-strike");
    expect(hit40(t3)).toHaveLength(0);
    expect(t3.state.sides.p1.unit.lastMoveId).toBe("syn-blast");

    const t4 = ok(applyTurn(PACK, t3.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(t4.state.sides.p1.unit.prevMoveId).toBe("syn-blast");
    expect(hit40(t4)).toHaveLength(0);
  });

  it("对手连用读行动方上一动：观察者自己在用攻击也不算属性连用", () => {
    const s = withMark("sm-streak-foe", { p2mark: "sm-vitality" });
    const t1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    expect(fixed(t1, 25)).toHaveLength(0);
    expect(t1.state.sides.p1.unit.lastMoveCat).toBe(2);
    expect(t1.state.sides.p2.unit.lastMoveCat).toBe(1);
    const t2 = ok(applyTurn(PACK, t1.state, { p1: act("act_syn-strike"), p2: act("act_syn-purge-mind") }));
    const hit = fixed(t2, 25);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.detail.side).toBe("p2");
  });
});
