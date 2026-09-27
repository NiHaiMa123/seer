/**
 * test:core（goldens）— M1-01 独立 golden ≥24 个。
 * 数值对照 synthetic-v1 §4 手算参考：strike 22、反击 23、jab 11、heal 60/70、struggle 30/35、recoil 15/17。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import {
  applyTurn,
  compilePack,
  defaultAction,
  initBattle,
  legalActions,
  loadPackFromDir,
  PackLoadError,
  sha256hex,
  type CompiledMove,
  type CoreState,
  type FrozenPack,
} from "@seer/battle-core";
import unitsJson from "../../content/synthetic-v1/units.json" with { type: "json" };
import movesJson from "../../content/synthetic-v1/moves.json" with { type: "json" };
import packJson from "../../content/synthetic-v1/pack.json" with { type: "json" };
import rulesetJson from "../../content/rulesets/synthetic-v1.json" with { type: "json" };

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v1");
const SEED = "0123456789abcdef0123456789abcdef";

const st = (power: { p1?: string; p2?: string } = {}) =>
  initBattle(PACK, { battleId: "btl_g", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta" });

type Act = { actionId: string; origin: "player" | "timeout_default"; idempotencyKey: string };
const act = (actionId: string): Act => ({ actionId, origin: "player", idempotencyKey: "testkey1" });
const T = (p1: Act | null, p2: Act | null) => ({ p1, p2 });

const unit = (s: CoreState, side: "p1" | "p2") => s.sides[side].unit;
const types = (evs: { type: string }[]) => evs.map((e) => e.type);

/** 自定义 pack（等速单位等测试用 fixture），不走 content 目录。 */
const customPack = (mut: (u: Record<string, unknown>, m: Record<string, unknown>) => void): FrozenPack => {
  const units = JSON.parse(JSON.stringify(unitsJson));
  const moves = JSON.parse(JSON.stringify(movesJson));
  mut(units, moves);
  return compilePack({ ruleset: rulesetJson, pack: packJson, units, moves });
};

describe("init", () => {
  it("initial state shape: collect/turn1/full hp+pp/zero stages", () => {
    const s = st();
    expect(s.phase).toBe("collect");
    expect(s.turn).toBe(1);
    expect(s.revision).toBe(0);
    expect(s.terminal).toBeNull();
    expect(unit(s, "p1").currentHp).toBe(120);
    expect(unit(s, "p2").currentHp).toBe(140);
    expect(unit(s, "p1").moves[0]).toEqual({ moveId: "syn-strike", pp: 35, ppMax: 35 });
    expect(s.speedTiebreak).toBeNull();
  });
  it("same params → byte-identical init", () => {
    expect(canonicalJson(st())).toBe(canonicalJson(st()));
  });
  it("legalActions default set", () => {
    expect(legalActions(st(), "p1").sort()).toEqual(
      ["act_concede", "act_syn-bolster", "act_syn-jab", "act_syn-recover", "act_syn-strike"].sort(),
    );
  });
  it("loader: frozen hashes + semantic checks", () => {
    expect(PACK.rules.rulesetHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(PACK.rules.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() =>
      compilePack({
        ruleset: rulesetJson,
        pack: packJson,
        units: { units: [{ id: "x", name: "X", base: { hp: 1, atk: 1, def: 1, spd: 1 }, moveIds: ["nope"] }] },
        moves: movesJson,
      }),
    ).toThrow(PackLoadError);
  });
});

describe("damage / ordering", () => {
  it("strike golden: p1→p2 = 22 (hand-computed §4)", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-strike"), act("act_syn-jab")));
    if (!r.ok) throw r.fault;
    const dmg = r.events.find((e) => e.type === "damage" && e.detail["side"] === "p2")!;
    expect(dmg.detail).toMatchObject({ side: "p2", amount: 22 });
    // p2 的 jab 先动打 p1（11），p1 strike 打 p2（22）
    expect(unit(r.state, "p2").currentHp).toBe(140 - 22);
    expect(unit(r.state, "p1").currentHp).toBe(120 - 11);
  });
  it("counter strike: p2→p1 = 23", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-jab"), act("act_syn-strike")));
    if (!r.ok) throw r.fault;
    expect(unit(r.state, "p1").currentHp).toBe(120 - 23);
  });
  it("priority beats speed: p2 jab(+1) declares before p1 strike", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-strike"), act("act_syn-jab")));
    if (!r.ok) throw r.fault;
    const declared = r.events.filter((e) => e.type === "action-declared").map((e) => e.detail["side"]);
    expect(declared).toEqual(["p2", "p1"]);
  });
  it("speed order: p1(50) before p2(40) at equal priority", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-strike"), act("act_syn-strike")));
    if (!r.ok) throw r.fault;
    const declared = r.events.filter((e) => e.type === "action-declared").map((e) => e.detail["side"]);
    expect(declared).toEqual(["p1", "p2"]);
  });
  it("speed tie → exactly one rng-draw event and memoized winner", () => {
    const tied = customPack((u) => {
      (u.units as { base: { spd: number } }[])[1]!.base.spd = 50;
    });
    const s = initBattle(tied, { battleId: "btl_t", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta" });
    const r1 = applyTurn(tied, s, T(act("act_syn-strike"), act("act_syn-strike")));
    if (!r1.ok) throw r1.fault;
    const draws = r1.events.filter((e) => e.type === "rng-draw");
    expect(draws).toHaveLength(1);
    const u = draws[0]!.rngDraw!.value;
    const winner = u < 0x80000000 ? "p1" : "p2";
    expect(r1.state.speedTiebreak).toBe(winner);
    const declared = r1.events.filter((e) => e.type === "action-declared").map((e) => e.detail["side"]);
    expect(declared[0]).toBe(winner);
    // 第二回合同 tie → 复用，不再 draw
    const r2 = applyTurn(tied, r1.state, T(act("act_syn-strike"), act("act_syn-strike")));
    if (!r2.ok) throw r2.fault;
    expect(r2.events.filter((e) => e.type === "rng-draw")).toHaveLength(0);
    expect(r2.state.speedTiebreak).toBe(winner);
  });
});

describe("stat stage / heal / pp", () => {
  it("bolster: atk +1 → strike dmg rises to 34 next turn", () => {
    const r1 = applyTurn(PACK, st(), T(act("act_syn-bolster"), act("act_syn-bolster")));
    if (!r1.ok) throw r1.fault;
    expect(unit(r1.state, "p1").stages.atk).toBe(1);
    const r2 = applyTurn(PACK, r1.state, T(act("act_syn-strike"), act("act_syn-recover")));
    if (!r2.ok) throw r2.fault;
    // p1 atk eff = floor(40*3/2)=60 → dmg floor(40*60/70)=34
    const dmg = r2.events.find((e) => e.type === "damage" && e.detail["side"] === "p2")!;
    expect(dmg.detail["amount"]).toBe(34);
  });
  it("stage cap: 7th bolster fails stage-at-cap, PP already spent", () => {
    let s = st();
    for (let i = 0; i < 6; i++) {
      const r = applyTurn(PACK, s, T(act("act_syn-bolster"), act("act_syn-bolster")));
      if (!r.ok) throw r.fault;
      s = r.state;
    }
    expect(unit(s, "p1").stages.atk).toBe(6);
    const r7 = applyTurn(PACK, s, T(act("act_syn-bolster"), act("act_syn-recover")));
    if (!r7.ok) throw r7.fault;
    expect(r7.events).toContainEqual(
      expect.objectContaining({ type: "action-failed", detail: expect.objectContaining({ side: "p1", reason: "stage-at-cap" }) }),
    );
    expect(unit(r7.state, "p1").moves.find((m) => m.moveId === "syn-bolster")!.pp).toBe(13); // 20 - 6 成功 - 1 失败仍消耗
  });
  it("heal at full HP fails hp-full, PP spent", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-recover"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "action-failed", detail: expect.objectContaining({ side: "p1", reason: "hp-full" }) }),
    );
    expect(unit(r.state, "p1").moves.find((m) => m.moveId === "syn-recover")!.pp).toBe(9);
  });
  it("heal amount = floor(max/2) capped", () => {
    let s = st();
    unit(s, "p1").currentHp = 40;
    const r = applyTurn(PACK, s, T(act("act_syn-recover"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(unit(r.state, "p1").currentHp).toBe(100); // 40 + 60
  });
  it("pp-spent event carries ppAfter", () => {
    const r = applyTurn(PACK, st(), T(act("act_syn-strike"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "pp-spent", detail: { side: "p1", moveId: "syn-strike", ppAfter: 34 } }),
    );
  });
});

describe("invalid / timeout / concede / struggle", () => {
  it("unknown actionId → action-failed invalid-action, no PP spent", () => {
    const r = applyTurn(PACK, st(), T(act("act_nope"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "action-failed", detail: expect.objectContaining({ side: "p1", reason: "invalid-action" }) }),
    );
    expect(unit(r.state, "p1").moves.every((m) => m.pp === m.ppMax)).toBe(true);
  });
  it("null action → §9 deterministic default (lexicographic min move = bolster)", () => {
    const r = applyTurn(PACK, st(), T(null, act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(unit(r.state, "p1").stages.atk).toBe(1); // p1 defaulted to act_syn-bolster
    expect(defaultAction(st(), "p1")).toBe("act_syn-bolster");
  });
  it("concede → immediate loss, opponent wins", () => {
    const r = applyTurn(PACK, st(), T(act("act_concede"), act("act_syn-strike")));
    if (!r.ok) throw r.fault;
    expect(r.state.terminal).toEqual({ result: "p2", reason: "concede" });
    expect(unit(r.state, "p1").currentHp).toBe(120); // no combat ran
  });
  it("double concede → draw", () => {
    const r = applyTurn(PACK, st(), T(act("act_concede"), act("act_concede")));
    if (!r.ok) throw r.fault;
    expect(r.state.terminal).toEqual({ result: "draw", reason: "concede" });
  });
  it("struggle only legal when all PP=0; deals max/4 with max/8 recoil", () => {
    const s = st();
    for (const u of [unit(s, "p1"), unit(s, "p2")]) for (const m of u.moves) m.pp = 0;
    expect(legalActions(s, "p1").sort()).toEqual(["act_concede", "act_struggle"]);
    const r = applyTurn(PACK, s, T(act("act_struggle"), act("act_struggle")));
    if (!r.ok) throw r.fault;
    // p1 先（spd50）: dmg floor(120/4)=30 → p2 140→110；recoil floor(120/8)=15 → p1 120→105
    // p2: dmg floor(140/4)=35 → p1 105→70；recoil floor(140/8)=17 → p2 110→93
    expect(unit(r.state, "p2").currentHp).toBe(93);
    expect(unit(r.state, "p1").currentHp).toBe(70);
    expect(r.events.filter((e) => e.type === "struggle-used")).toHaveLength(2);
  });
  it("struggle while PP remains → invalid-action", () => {
    const r = applyTurn(PACK, st(), T(act("act_struggle"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "action-failed", detail: expect.objectContaining({ side: "p1", reason: "invalid-action" }) }),
    );
  });
  it("recoil KO: user dies → opponent wins", () => {
    const s = st();
    unit(s, "p1").currentHp = 10; // struggle recoil 15 > 10
    for (const u of [unit(s, "p1"), unit(s, "p2")]) for (const m of u.moves) m.pp = 0;
    const r = applyTurn(PACK, s, T(act("act_struggle"), act("act_struggle")));
    if (!r.ok) throw r.fault;
    // p1 先 struggle: p2 -30 → 110 存活 → recoil -15 → p1 KO；p2 行动被跳过
    expect(unit(r.state, "p1").currentHp).toBe(0);
    expect(r.state.terminal).toEqual({ result: "p2", reason: "ko" });
  });
});

describe("terminal / atomicity / determinism", () => {
  it("KO interrupts remaining action item (no declare for dead side)", () => {
    const s = st();
    unit(s, "p2").currentHp = 10;
    const r = applyTurn(PACK, s, T(act("act_syn-strike"), act("act_syn-strike")));
    if (!r.ok) throw r.fault;
    expect(r.state.terminal).toEqual({ result: "p1", reason: "ko" });
    expect(r.events.filter((e) => e.type === "action-declared")).toHaveLength(1);
  });
  it("turn-limit draw at turn >= 200", () => {
    const s = st();
    s.turn = 200;
    const r = applyTurn(PACK, s, T(act("act_syn-bolster"), act("act_syn-bolster")));
    if (!r.ok) throw r.fault;
    expect(r.state.terminal).toEqual({ result: "draw", reason: "turn-limit" });
  });
  it("transition on terminal state → EngineFault, state untouched", () => {
    const s = st();
    s.terminal = { result: "p1", reason: "ko" };
    const before = canonicalJson(s);
    const r = applyTurn(PACK, s, T(act("act_syn-strike"), act("act_syn-strike")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault.reason).toBe("TERMINAL_STATE");
    expect(canonicalJson(s)).toBe(before);
  });
  it("malicious fixture: move with >4096 effect applications → fault, original state unchanged", () => {
    // 4100 个非致命 heal（目标满血 → 全部 failed，但 application 计数照走）；
    // damage 版会在 ~140 次时先 KO 打死人，撞不到上限——这正是"上界要防的是
    // 无限循环而非致死输出"的情形。
    const evil = customPack((_u, m) => {
      (m.moves as { effects: { op: string }[] }[])[0]!.effects = Array.from(
        { length: 4100 },
        () => ({ op: "heal", numerator: 1, denominator: 2, target: "self" }),
      );
    });
    const s = initBattle(evil, { battleId: "btl_evil", seedHex: SEED, p1: "syn-alpha", p2: "syn-beta" });
    const before = canonicalJson(s);
    const r = applyTurn(evil, s, T(act("act_syn-strike"), act("act_syn-strike")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault.reason).toBe("EFFECT_LIMIT");
    expect(canonicalJson(s)).toBe(before); // 原子性：原 state 未变
  });
  it("loader rejects unknown operator at compile time", () => {
    expect(() =>
      customPack((_u, m) => {
        (m.moves as { effects: { op: string }[] }[])[0]!.effects = [{ op: "drain_soul" }];
      }),
    ).toThrow(PackLoadError);
  });
  it("frozen input + state untouched across a scripted sequence", () => {
    const input = T(act("act_syn-strike"), act("act_syn-jab"));
    Object.freeze(input.p1);
    Object.freeze(input.p2);
    Object.freeze(input);
    const s = st();
    const snap = canonicalJson(s);
    const r = applyTurn(PACK, s, input);
    if (!r.ok) throw r.fault;
    expect(canonicalJson(s)).toBe(snap);
    expect(r.state).not.toBe(s);
  });
  it("same seed + same script → byte-identical canonical (determinism)", () => {
    const script = [
      T(act("act_syn-bolster"), act("act_syn-strike")),
      T(act("act_syn-strike"), act("act_syn-jab")),
      T(act("act_syn-recover"), act("act_syn-strike")),
    ];
    const run = () => {
      let s = st();
      for (const a of script) {
        const r = applyTurn(PACK, s, a);
        if (!r.ok) throw r.fault;
        s = r.state;
      }
      return canonicalJson(s);
    };
    expect(run()).toBe(run());
  });
  it("state hash golden (freeze content+engine identity)", () => {
    const s = st();
    const h = sha256hex(canonicalJson(s));
    expect(h).toBe("80663066c492c40bbf164726a36bcf84c62d6ebbe2ded80bbe66d62e5d677c26");
    expect(s.rules.rulesetId).toBe("synthetic-v1");
  });
});
