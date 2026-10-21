/**
 * R4（docs/remaining-replication-plan.md）：差一句就整印失败、补上那一句后整印无残留的真实魂印。
 * 每只用自己的编译结果（parseSoulmarkText 原文 → soulmarks 文档）打一局固定种子，事件里要出现 soulmark，
 * 并且补上的那一句在事件流里能看到它的效果。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReplacement, applyTurn, compilePack, initBattle, legalActions, type CoreState } from "@seer/battle-core";
import { mergeAttachDamage } from "../../../tools/attach-damage.ts";
import { isHitRider, parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import rulesetJson from "../../../content/rulesets/real-v1.json" with { type: "json" };
import typechartJson from "../../../content/rulesets/typechart.json" with { type: "json" };
import naturesJson from "../../../content/rulesets/natures.json" with { type: "json" };

const CREATURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content", "creatures", "creatures.json");
const cat = JSON.parse(readFileSync(CREATURES, "utf8"));
const ATTACK_ROWS = new Set(Object.keys((typechartJson as { attack: Record<string, unknown> }).attack));
const SEED = "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";
const FOE = "1845"; // 战神盖亚：固定对手

type Ev = { type: string; detail: Record<string, unknown> };

function kindOf(kind: string | null, ownType: string): { type: string; category?: "physical" | "special" } {
  const m = kind === null || kind === undefined ? null : /^(.+?)(?:系)?(物攻|特攻)$/.exec(kind);
  if (m === null || !ATTACK_ROWS.has(m[1]!)) return { type: ownType };
  return { type: m[1]!, category: m[2] === "物攻" ? "physical" : "special" };
}

/** 真实技能：攻击招取前 2 个可编译的，属性招取前 2 个，保证两类连用和类别触发都能出现。 */
function buildUnit(petNo: string) {
  const c = cat.creatures[`pet-${petNo}`];
  // 六维规则包要求：有伤害的招必须能落到物/特类别；属性招不带类别
  const attack = (s: any) => (s.power ?? 0) > 0 && kindOf(s.kind, c.type).category !== undefined;
  const status = (s: any) => (s.power ?? 0) === 0 && kindOf(s.kind, c.type).category === undefined;
  const skills = [...(c.skills as any[]).filter(attack).slice(0, 2), ...(c.skills as any[]).filter(status).slice(0, 2)];
  const moves = skills.map((s, i) => {
    const { flags, effects } = parseEffectText((s.effect ?? "").trim(), { hasDamage: (s.power ?? 0) > 0 }) as any;
    const effs: Record<string, unknown>[] = structuredClone(effects);
    const ad = flags.attachDamage;
    // 袋子上的家族键已经收成 rider。以前有袋子就会合成宿主，现在没宿主的 rider 同样要有这一击。
    if (ad !== undefined || (s.power ?? 0) > 0 || effs.some((e) => isHitRider(e.op))) {
      let dmg = effs.find((e) => e.op === "damage");
      if (dmg === undefined) { dmg = { op: "damage", power: Math.max(1, s.power ?? 0) }; effs.unshift(dmg); }
      if (ad !== undefined) mergeAttachDamage(dmg, ad);
    }
    return { id: `mv-${petNo}-${i}`, name: s.name, pp: s.pp ?? 20, priority: flags.priority ?? 0, effects: effs, ...kindOf(s.kind, c.type) };
  });
  const sm = parseSoulmarkText((c.soulMark?.text ?? "").trim());
  const unit = {
    id: `pet-${petNo}`, name: c.name, types: [c.type], moveIds: moves.map((m) => m.id),
    base: { hp: c.baseStats.hp, atk: c.baseStats.atk, def: c.baseStats.def, spa: c.baseStats.spa, sdf: c.baseStats.sdf, spd: c.baseStats.spd },
    ...(sm.entries.length > 0 ? { soulMark: `sm-${petNo}` } : {}),
  };
  const soulmark = sm.entries.length > 0 ? { id: `sm-${petNo}`, name: `${c.name}魂印`, desc: c.soulMark.text.slice(0, 2000), effects: sm.entries } : undefined;
  return { unit, moves, soulmark, sm };
}

/** p1 = 被测精灵，p2 = 固定对手（不带魂印，免得混进 soulmark 事件）。招位轮转，KO 后选首个替补。 */
function play(petNo: string, turns = 12) {
  const me = buildUnit(petNo);
  const foe = buildUnit(FOE);
  const pack = compilePack({
    ruleset: rulesetJson,
    pack: {
      packId: `r4-${petNo}`, version: "0.1.0", schemaVersion: 1, rulesetId: "real-v1",
      verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true },
      files: { units: "units.json", moves: "moves.json", soulmarks: "soulmarks.json" }, assets: [],
    },
    units: { units: [me.unit, (({ soulMark: _s, ...u }) => u)(foe.unit as typeof foe.unit & { soulMark?: string })] },
    moves: { moves: [...me.moves, ...foe.moves] },
    soulmarks: { soulmarks: me.soulmark === undefined ? {} : { [me.soulmark.id]: me.soulmark } },
    typeChart: typechartJson,
    natures: naturesJson,
  });
  let state: CoreState = initBattle(pack, { battleId: `r4-${petNo}`, seedHex: SEED, p1: `pet-${petNo}`, p2: `pet-${FOE}`, bench: { p1: [], p2: [] } });
  const events: Ev[] = [];
  for (let t = 1; t <= turns && (state.terminal ?? null) === null; t++) {
    const pick = (side: "p1" | "p2") => {
      const legal = legalActions(state, side).filter((a) => /^act_(?!concede|switch)/.test(a));
      return { actionId: legal[(t - 1) % Math.max(1, legal.length)] ?? "act_concede", origin: "player" as const, idempotencyKey: `t${t}${side}` };
    };
    const r = applyTurn(pack, state, { p1: pick("p1"), p2: pick("p2") });
    if (!r.ok) throw new Error(`applyTurn failed: ${r.fault.message}`);
    events.push(...(r.events as Ev[]));
    state = r.state;
    while (state.suspension !== undefined && state.suspension !== null && (state.terminal ?? null) === null) {
      const koSide = state.suspension.koSide;
      const rr = applyReplacement(pack, state, { [koSide]: { actionId: "act_concede", origin: "player" as const, idempotencyKey: `rep${t}` }, [koSide === "p1" ? "p2" : "p1"]: null } as any);
      if (!rr.ok) throw new Error(`applyReplacement failed: ${rr.fault.message}`);
      events.push(...(rr.events as Ev[]));
      state = rr.state;
    }
  }
  return { me, events, again: () => play(petNo, turns).events };
}

const soulHooks = (evs: Ev[]) => evs.filter((e) => e.type === "soulmark" && e.detail.side === "p1").map((e) => e.detail.effect);
/** p1 用 moveIdx 号招后，紧跟的魂印 onMoveUsed 之后是回复（满血时是 hp-full 失败——回复上限截断，不是没触发）。 */
const healsAfterMove = (evs: Ev[], moveId: string) => evs.some((e, i) => {
  if (e.type !== "action-declared" || e.detail.side !== "p1" || e.detail.moveId !== moveId) return false;
  const end = evs.findIndex((x, j) => j > i && x.type === "action-declared");
  const win = evs.slice(i + 1, end < 0 ? undefined : end).filter((x) => x.type !== "rng-draw");
  const s = win.findIndex((x) => x.type === "soulmark" && x.detail.side === "p1" && x.detail.effect === "hook:onMoveUsed");
  const next = s < 0 ? undefined : win[s + 1];
  return (next?.type === "heal" && next.detail.side === "p1") || (next?.type === "action-failed" && next.detail.side === "p1" && next.detail.reason === "hp-full");
});
const reactHealAfterMove = (evs: Ev[], moveId: string) => evs.some((e, i) => {
  if (e.type !== "action-declared" || e.detail.side !== "p1" || e.detail.moveId !== moveId) return false;
  const end = evs.findIndex((x, j) => j > i && x.type === "action-declared");
  const win = evs.slice(i + 1, end < 0 ? undefined : end).filter((x) => x.type !== "rng-draw");
  const r = win.findIndex((x) => x.type === "effect-applied" && x.detail.side === "p1" && x.detail.name === "react");
  return r >= 0 && win.slice(r + 1).some((x) =>
    (x.type === "heal" && x.detail.side === "p1")
    || (x.type === "action-failed" && x.detail.side === "p1" && x.detail.reason === "hp-full"),
  );
});

describe("R4 已支持条款与残留边界：固定种子对局", () => {
  it("2923 佐伊尔：属性技能 → 恢复 200（原「恢复200Hp」）", () => {
    const { me, events } = play("2923");
    expect(me.sm.unparsed).toEqual([]);
    expect(me.sm.entries[1]).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 1 }, stack: true,
        payload: [{ op: "heal", flat: 200, target: "self" }],
      }],
    });
    expect(reactHealAfterMove(events, "mv-2923-2")).toBe(true); // 第 3 招「气力」是属性技能
    expect(reactHealAfterMove(events, "mv-2923-0")).toBe(false); // 攻击技能不触发回复
  });

  it("3316 瓦特艾沃：攻击技能清除可运行；属性用技先制保留Boss范围残留", () => {
    const { me, events } = play("3316");
    expect(me.sm.unparsed).toEqual([{
      clause: "自身使用属性技能则下2回合自身先制+1",
      reason: "move-use scope — boss gate cannot persist across the react window (deferred)",
    }]);
    expect(me.sm.entries[0]).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 4 }, stack: true,
        payload: [{ op: "cleanse", target: "opponent", scope: "timed" }],
      }],
    });
    expect(me.sm.entries[1]).toEqual({
      hook: "onMoveUsed",
      bossGate: true,
      ops: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 1 }, turns: 2 }],
      guard: { actor: "self", cat: 1 },
    });
    expect(events.some((event) => event.type === "effect-applied" && event.detail.side === "p1" && event.detail.name === "react")).toBe(true);
  });

  it("3500 埃摩蒂：攻击技能 → 恢复 200（原「恢复自身200体力」）", () => {
    const { me, events } = play("3500");
    expect(me.sm.unparsed).toEqual([]);
    expect(me.sm.entries[0]).toEqual({ hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3] }, ops: [{ op: "heal", flat: 200, target: "self" }] });
    expect(healsAfterMove(events, "mv-3500-0")).toBe(true);
  });

  it("3775 珀希丝：当回合自身攻击技能 → 命中后结算，不在回合开始结算", () => {
    const { me, events } = play("3775");
    expect(me.sm.unparsed).toEqual([]);
    expect(me.sm.entries.map((e: any) => e.hook)).toEqual(["onDamageDealt", "onDamageDealt"]);
    const hooks = soulHooks(events);
    expect(hooks).toContain("hook:onDamageDealt");
    expect(hooks).not.toContain("hook:onTurnStart");
  });

  it("3891 未来·伊优：保留回合末恢复条目，攻击技能暴击段单独留残", () => {
    const { me, events } = play("3891");
    expect(me.sm.unparsed).toEqual([{
      clause: "自身使用攻击技能30%打出致命一击",
      reason: "move-use scope — additional guard, limit, linked trigger, or payload is not supported by the plain-use react path (deferred)",
    }]);
    expect(me.sm.entries[0]).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "apply_status", name: "crit_up", target: "self", turns: 1 }],
      chance: { base: 30, grow: { add: 10, cap: 100 } },
      guard: { actor: "self", cat: [2, 3] },
    });
    expect((me.sm.entries[1] as any).ops.map((o: any) => o.op)).toEqual(["transfer_stages", "cleanse", "heal", "pp_delta"]);
    expect(soulHooks(events).length).toBeGreaterThan(0);
  });

  it("4793 厄孽提亚：被击败时对手下 1 回合技能无效（原「对手1回合内技能无效」）", () => {
    const { me, events } = play("4793", 30);
    expect(me.sm.unparsed).toEqual([]);
    expect(me.sm.entries.at(-1)).toMatchObject({ hook: "onKO", guard: { victim: "self" }, ops: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1 }] });
    expect(soulHooks(events)).toContain("hook:onMoveUsed");
  });

  it("确定性：同种子两次事件流一致", () => {
    const a = play("2923");
    expect(JSON.stringify(a.again())).toBe(JSON.stringify(a.events));
  });
});
