/**
 * S5 真实精灵魂印 golden —— 真实精灵（4399 抓取）的 soulMark.text
 * 经 parseSoulmarkText 编成 soulmarks 文档打进 pack，固定 seed 对局，
 * 快照完整事件流（含 soulmark 事件）。
 *
 * fixture 溯源：每只精灵记录 petNo/name/魂印原文/解析条目；技能解析残留
 * 与魂印残留子句记录为 unparsed（=UNVERIFIED，不臆造语义）。
 *
 * 重新生成：UPDATE_SOUL_GOLDEN=1 pnpm exec vitest run tests/battle-core/mechanics/real-soulmark-golden.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@seer/contracts";
import { applyReplacement, applyTurn, compilePack, initBattle, legalActions, type CoreState, type FrozenPack } from "@seer/battle-core";
import { mergeAttachDamage } from "../../../tools/attach-damage.ts";
import { isHitRider, parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import rulesetJson from "../../../content/rulesets/real-v1.json" with { type: "json" };
import typechartJson from "../../../content/rulesets/typechart.json" with { type: "json" };
import naturesJson from "../../../content/rulesets/natures.json" with { type: "json" };

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "real-soulmark-golden.json");
const CREATURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content", "creatures", "creatures.json");

const SEED = "cc33cc33cc33cc33cc33cc33cc33cc33";
/** 固定选取：onTurnEnd(缪斯) / onKO(黄忠) / onDamaged(加洛斯格) / onEntry(卧龙诸葛)。
 *  （幽美 3471 的复合属性"暗影神秘"不在 typechart 攻方行，另行记录——4399 表非对称。） */
const PETS = { p1: ["2852", "3055"], p2: ["3126", "2522"] } as const; // 首发 + bench

const cat = JSON.parse(readFileSync(CREATURES, "utf8"));

const ATTACK_ROWS = new Set(Object.keys((typechartJson as { attack: Record<string, unknown> }).attack));

function kindOf(kind: string | null, ownType: string): { type: string; category?: "physical" | "special" } {
  const m = kind === null || kind === undefined ? null : /^(.+?)(?:系)?(物攻|特攻)$/.exec(kind);
  if (m === null || !ATTACK_ROWS.has(m[1]!)) return { type: ownType };
  return { type: m[1]!, category: m[2] === "物攻" ? "physical" : "special" };
}

function assembleMove(petNo: string, idx: number, ownType: string, s: { name: string; kind: string | null; power: number | null; pp: number | null; effect: string | null }) {
  const { flags, effects, unparsed } = parseEffectText((s.effect ?? "").trim(), { hasDamage: (s.power ?? 0) > 0 });
  const effs: Record<string, unknown>[] = structuredClone(effects) as Record<string, unknown>[];
  const ad = (flags as Record<string, unknown>).attachDamage;
  // 袋子上的家族键已经收成 rider。以前有袋子就会合成宿主，现在没宿主的 rider 同样要有这一击。
  if (ad !== undefined || (s.power ?? 0) > 0 || effs.some((e) => isHitRider(e.op))) {
    let dmg = effs.find((e) => e.op === "damage");
    if (dmg === undefined) {
      dmg = { op: "damage", power: Math.max(1, s.power ?? 0) };
      effs.unshift(dmg);
    }
    if (ad !== undefined) mergeAttachDamage(dmg, ad as Record<string, unknown>);
  }
  const move: Record<string, unknown> = {
    id: `mv-${petNo}-${idx}`, name: s.name, pp: s.pp ?? 20,
    priority: (flags as { priority?: number }).priority ?? 0, effects: effs,
    ...kindOf(s.kind, ownType),
  };
  for (const k of ["accuracy", "priorityIf", "hitIf", "prioPerUse"] as const) {
    const v = (flags as Record<string, unknown>)[k];
    if (v !== undefined) move[k] = v;
  }
  return { move, unparsed };
}

/** 每只精灵取前 4 个可编译技能 + 魂印解析条目；全量 unparsed 留档。 */
function buildUnit(petNo: string) {
  const c = cat.creatures[`pet-${petNo}`];
  if (c === undefined) throw new Error(`creature pet-${petNo} missing`);
  const moves: Record<string, unknown>[] = [];
  const unparsedAll: string[] = [];
  const pickedNames: string[] = [];
  for (const s of c.skills ?? []) {
    if (moves.length >= 4) break;
    const { move, unparsed } = assembleMove(petNo, moves.length, c.type, s);
    if ((move.effects as unknown[]).length === 0 && (s.power ?? 0) === 0) continue;
    moves.push(move);
    pickedNames.push(s.name);
    for (const u of unparsed) unparsedAll.push(`${s.name}:${typeof u === "string" ? u : (u as { clause?: string }).clause}`);
  }
  if (moves.length === 0) throw new Error(`pet-${petNo} has no compilable skill`);
  const smText = (c.soulMark?.text ?? "").trim();
  const sm = parseSoulmarkText(smText);
  for (const u of sm.unparsed) unparsedAll.push(`魂印:${typeof u === "string" ? u : (u as { clause?: string }).clause}`);
  const unit: Record<string, unknown> = {
    id: `pet-${petNo}`, name: c.name,
    base: { hp: c.baseStats.hp, atk: c.baseStats.atk, def: c.baseStats.def, spa: c.baseStats.spa, sdf: c.baseStats.sdf, spd: c.baseStats.spd },
    types: [c.type],
    moveIds: moves.map((m) => m.id),
  };
  let soulmark: Record<string, unknown> | undefined;
  if (sm.entries.length > 0) {
    unit.soulMark = `sm-${petNo}`;
    soulmark = { id: `sm-${petNo}`, name: c.soulMark?.name ?? `${c.name}魂印`, desc: smText.slice(0, 2000), effects: sm.entries };
  }
  return {
    unit,
    moves,
    soulmark,
    meta: { petNo, name: c.name, type: c.type, skills: pickedNames, soulmarkText: smText || null, soulmarkEntries: sm.entries, unparsed: unparsedAll },
  };
}

const built = [buildUnit(PETS.p1[0]), buildUnit(PETS.p1[1]), buildUnit(PETS.p2[0]), buildUnit(PETS.p2[1])];
const soulmarksDoc = { soulmarks: Object.fromEntries(built.flatMap((b) => (b.soulmark === undefined ? [] : [[(b.soulmark as { id: string }).id, b.soulmark]]))) };
const PACK: FrozenPack = compilePack({
  ruleset: rulesetJson,
  pack: {
    packId: "real-soul-v1", version: "0.1.0", schemaVersion: 1, rulesetId: "real-v1",
    verification: "SYNTHETIC", license: { identifier: "CC0-1.0", public: true },
    files: { units: "units.json", moves: "moves.json", soulmarks: "soulmarks.json" }, assets: [],
  },
  units: { units: built.map((b) => b.unit) },
  moves: { moves: built.flatMap((b) => b.moves) },
  soulmarks: soulmarksDoc,
  typeChart: typechartJson,
  natures: naturesJson,
});

/** 确定性驱动：轮转招位覆盖不同效果；KO 挂起时选首个存活替补。 */
function drive(maxTurns = 40) {
  let state: CoreState = initBattle(PACK, {
    battleId: "real-soulmark-golden", seedHex: SEED,
    p1: `pet-${PETS.p1[0]}`, p2: `pet-${PETS.p2[0]}`,
    bench: { p1: [`pet-${PETS.p1[1]}`], p2: [`pet-${PETS.p2[1]}`] },
  });
  const events: unknown[] = [];
  for (let t = 1; t <= maxTurns && (state.terminal ?? null) === null; t++) {
    const pick = (side: "p1" | "p2") => {
      const legal = legalActions(state, side).filter((a) => /^act_(?!concede|switch)/.test(a));
      const idx = (t + (side === "p2" ? 1 : 0)) % Math.max(1, legal.length);
      return { actionId: legal[idx] ?? "act_concede", origin: "player" as const, idempotencyKey: `t${t}${side}` };
    };
    const r = applyTurn(PACK, state, { p1: pick("p1"), p2: pick("p2") });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`applyTurn failed: ${r.fault.message}`);
    events.push(...r.events);
    state = r.state;
    while (state.suspension !== undefined && state.suspension !== null && (state.terminal ?? null) === null) {
      const koSide = state.suspension.koSide;
      const other = koSide === "p1" ? "p2" : "p1";
      const opts = legalActions(state, koSide).filter((a) => a.startsWith("act_switch"));
      const rr = applyReplacement(PACK, state, {
        [koSide]: { actionId: opts[0] ?? "act_concede", origin: "player" as const, idempotencyKey: `rep${t}${koSide}` },
        [other]: null,
      } as { p1: never; p2: never });
      expect(rr.ok).toBe(true);
      if (!rr.ok) throw new Error(`applyReplacement failed: ${rr.fault.message}`);
      events.push(...rr.events);
      state = rr.state;
    }
  }
  return {
    state,
    events,
    summary: {
      turns: state.turn,
      terminal: state.terminal ?? null,
      hp: { p1: state.sides.p1.unit.currentHp, p2: state.sides.p2.unit.currentHp },
    },
  };
}

describe("S5 真实精灵魂印 golden", () => {
  const run = drive();
  const fixture = { seed: SEED, pets: built.map((b) => b.meta), summary: run.summary, events: run.events };

  it("确定性：同 seed 两次驱动事件流字节一致", () => {
    const again = drive();
    expect(canonicalJson(again.events)).toBe(canonicalJson(run.events));
    expect(again.summary).toEqual(run.summary);
  });

  it("事件流快照 == tests/fixtures/real-soulmark-golden.json", () => {
    if (process.env.UPDATE_SOUL_GOLDEN !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2));
      return;
    }
    const golden = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(canonicalJson(fixture)).toBe(canonicalJson(golden));
  });

  it("魂印事件真实派发（soulmark 事件在场）", () => {
    const soul = run.events.filter((e) => (e as { type: string }).type === "soulmark");
    expect(soul.length).toBeGreaterThan(0);
    const types = new Set(run.events.map((e) => (e as { type: string }).type));
    expect(types.has("damage")).toBe(true);
    console.log(`[S5] events=${run.events.length} soulmark=${soul.length} types=${[...types].sort().join(",")} terminal=${JSON.stringify(run.summary.terminal)}`);
  });
});
