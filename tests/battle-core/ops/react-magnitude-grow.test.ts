import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, compilePack, initBattle, type CoreState, type FrozenPack } from "@seer/battle-core";
import type { CompiledEffect } from "../../../packages/battle-core/src/loader.ts";
import { validateEffects } from "../../../packages/battle-core/src/ops/validate.ts";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (path: string) => JSON.parse(readFileSync(join(CONTENT, path), "utf8"));
const reactId = "sm-react-magnitude-grow-test";
const cause = "test:react-magnitude-grow";

const magnitudeOps = [
  { op: "grow", of: "magnitude", step: 5, magCap: 30 },
  {
    op: "hp_delta",
    target: "opponent",
    frac: { numerator: 20, denominator: 100, of: "max" },
    kind: "percent",
    cause,
    healSelf: { numerator: 1, denominator: 1, of: "dealt" },
  },
] as const;

function makePack(markId: string, effects: unknown[]): FrozenPack {
  const ruleset = read("rulesets/synthetic-v2.json");
  const soulmarkSource = read("synthetic-v2/soulmarks.json").soulmarks;
  const moveSource = read("synthetic-v2/moves.json").moves;
  const unitSource = read("synthetic-v2/units.json").units;
  const testMoves = [
    { id: "react-grow-hit", name: "React Grow Hit", pp: 20, priority: 0, type: "草", accuracy: 100, category: "physical", effects: [{ op: "damage", power: 1 }] },
    { id: "react-grow-miss", name: "React Grow Miss", pp: 20, priority: 0, type: "草", accuracy: 0, category: "physical", effects: [{ op: "damage", power: 1 }] },
  ];
  const units = unitSource.map((unit: any) => {
    if (unit.id === "syn-gamma") return { ...unit, soulMark: markId, moveIds: [...unit.moveIds, ...testMoves.map((move) => move.id)] };
    const { soulMark: _soulMark, ...withoutSoulmark } = unit;
    return withoutSoulmark;
  });
  const features = [...new Set([...ruleset.features, "accuracy", "control"])];
  const operatorAllowlist = [...new Set([...ruleset.operatorAllowlist, "hp_delta"])];
  return compilePack({
    ruleset: { ...ruleset, features, operatorAllowlist },
    pack: read("synthetic-v2/pack.json"),
    units: { units },
    moves: { moves: [...moveSource, ...testMoves] },
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    soulmarks: { soulmarks: { ...soulmarkSource, [markId]: { id: markId, name: markId, desc: "runtime test", effects } } },
    seals: read("seals/seals.json"),
    items: read("synthetic-v2/items.json"),
  });
}

const reactMark = makePack(reactId, [{
  hook: "onBattleStart",
  ops: [{
    op: "apply_status",
    name: "react",
    target: "self",
    stack: true,
    params: { trigger: 11, cat: 4 },
    payload: magnitudeOps,
  }],
}]);

const legacyMarkId = "sm-react-legacy-grow-test";
const legacyMark = makePack(legacyMarkId, [{
  hook: "onBattleStart",
  ops: [{
    op: "apply_status",
    name: "react",
    target: "self",
    stack: true,
    params: { trigger: 11, cat: 4, growStep: 50, growCap: 100 },
    payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50, turns: 1 }],
  }],
}]);

const action = (actionId: string, id: number) => ({
  actionId: `act_${actionId}`,
  origin: "player" as const,
  idempotencyKey: `rmgrow${id.toString().padStart(4, "0")}abcdefgh`,
});
let nextAction = 1;
const play = (pack: FrozenPack, state: CoreState, move = "react-grow-hit", foeMove = "syn-bolster") => {
  const result = applyTurn(pack, state, { p1: action(move, nextAction++), p2: action(foeMove, nextAction++) });
  if (!result.ok) throw new Error(`applyTurn failed: ${result.fault.reason} ${result.fault.message}`);
  return result;
};
const reactEffect = (state: CoreState) => state.sides.p1.unit.effects.find((effect) => effect.kind === "react" && effect.params?.trigger === 11);
const sourceReactApply = () => {
  const marks = reactMark.mechanics?.["soulmark"] as { soulmarks: ReadonlyMap<string, { effects: readonly { hook?: string; ops?: readonly CompiledEffect[] }[] }> };
  const apply = marks.soulmarks.get(reactId)?.effects.find((effect) => effect.hook === "onBattleStart")?.ops?.[0];
  return apply?.op === "apply_status" ? apply : undefined;
};
const damageOf = (result: { events: readonly any[] }) => result.events.find((event) => event.type === "damage" && event.detail.cause === cause)?.detail.amount as number | undefined;
const healOf = (result: { events: readonly any[] }) => result.events.find((event) => event.type === "heal" && event.detail.source === cause)?.detail.amount as number | undefined;
const okReplacement = (result: ReturnType<typeof applyReplacement>) => {
  if (!result.ok) throw new Error(`applyReplacement failed: ${result.fault.reason} ${result.fault.message}`);
  return result;
};

describe("react payload 幅度 grow", () => {
  it("复用 grow 帧在真实触发中按 20→25→30 封顶，并按目标实际扣量回血", () => {
    const state = initBattle(reactMark, { battleId: "react-grow-cap", seedHex: "31".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
    // 每次从合法满血目标开始，防止前次命中把目标打低后影响伤害幅度。
    const foeMax = state.sides.p2.unit.base.hp;
    let current = state;
    const dealt: number[] = [];
    const healed: number[] = [];
    const acc: number[] = [];
    for (let i = 0; i < 4; i++) {
      current.sides.p2.unit.currentHp = foeMax;
      current.sides.p1.unit.currentHp = 1;
      const selfMax = current.sides.p1.unit.base.hp;
      const result = play(reactMark, current);
      const actualDamage = damageOf(result)!;
      dealt.push(actualDamage);
      healed.push(healOf(result) ?? 0);
      expect(healOf(result) ?? 0).toBe(Math.min(actualDamage, selfMax - 1));
      acc.push(reactEffect(result.state)?.params?.growAcc as number);
      current = result.state;
    }
    expect(dealt).toEqual([20, 25, 30, 30].map((pct) => Math.floor((foeMax * pct) / 100)));
    expect(healed).toEqual(dealt);
    expect(acc).toEqual([5, 10, 15, 20]);
  });

  it("低血目标只吸实际剩余体力，且上限治疗按可恢复量结算", () => {
    const state = initBattle(reactMark, { battleId: "react-grow-low-hp", seedHex: "32".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
    state.sides.p1.unit.currentHp = state.sides.p1.unit.base.hp - 3;
    state.sides.p2.unit.currentHp = 5;
    const result = play(reactMark, state);
    expect(damageOf(result)).toBe(5);
    expect(healOf(result)).toBe(3);
    expect(result.state.sides.p1.unit.currentHp).toBe(result.state.sides.p1.unit.base.hp);
  });

  it("致死 react 在 checkpoint 前记一次；JSON 替补续跑不重复触发，下一招读到 25%", () => {
    const state = initBattle(reactMark, {
      battleId: "react-grow-checkpoint",
      seedHex: "33".repeat(16),
      p1: "syn-gamma",
      p2: "syn-epsilon",
      bench: { p2: ["syn-delta"] },
    });
    state.sides.p1.unit.base.spd = 400;
    state.sides.p2.unit.base.spd = 1;
    state.sides.p1.unit.currentHp = 1;
    state.sides.p2.unit.currentHp = 1;

    const first = play(reactMark, state);
    expect(first.state.suspension?.koSide).toBe("p2");
    expect(damageOf(first)).toBe(1);
    expect(healOf(first)).toBe(1);
    expect(reactEffect(first.state)?.params?.growAcc).toBe(5);

    const persisted = JSON.parse(JSON.stringify(first.state)) as CoreState;
    const replacement = okReplacement(applyReplacement(reactMark, persisted, { p1: null, p2: action("switch-0", nextAction++) }));
    expect(replacement.events.some((event: any) => event.type === "damage" && event.detail.cause === cause)).toBe(false);
    expect(reactEffect(replacement.state)?.params?.growAcc).toBe(5);

    replacement.state.sides.p2.unit.currentHp = replacement.state.sides.p2.unit.base.hp;
    replacement.state.sides.p1.unit.currentHp = replacement.state.sides.p1.unit.base.hp;
    const second = play(reactMark, replacement.state, "react-grow-hit", "syn-strike");
    const base = second.state.sides.p2.unit.base.hp;
    expect(damageOf(second)).toBe(Math.floor((base * 25) / 100));
    expect(reactEffect(second.state)?.params?.growAcc).toBe(10);
  });

  it("纯使用触发在 MISS 后仍成长；状态阻断不触发也不成长", () => {
    const state = initBattle(reactMark, { battleId: "react-grow-miss-block", seedHex: "35".repeat(16), p1: "syn-gamma", p2: "syn-epsilon" });
    const missed = play(reactMark, state, "react-grow-miss");
    expect(missed.events.some((event: any) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    expect(damageOf(missed)).toBeGreaterThan(0);
    expect(reactEffect(missed.state)?.params?.growAcc).toBe(5);

    missed.state.sides.p1.unit.effects.push({ kind: "control:stun", effectInstanceId: "test-control", remainingTurns: 1 });
    const blocked = play(reactMark, missed.state);
    expect(blocked.events.some((event: any) => event.type === "action-failed" && event.detail.side === "p1" && event.detail.reason === "controlled")).toBe(true);
    expect(damageOf(blocked)).toBeUndefined();
    expect(reactEffect(blocked.state)?.params?.growAcc).toBe(5);

    const resumed = play(reactMark, blocked.state);
    expect(reactEffect(resumed.state)?.params?.growAcc).toBe(10);
  });

  it("复用同一个 FrozenPack 的交错对局各自从 20% 开始，且不污染编译参数", () => {
    const firstState = initBattle(reactMark, { battleId: "react-grow-isolation-a", seedHex: "36".repeat(16), p1: "syn-gamma", p2: "syn-epsilon" });
    const secondState = initBattle(reactMark, { battleId: "react-grow-isolation-b", seedHex: "37".repeat(16), p1: "syn-gamma", p2: "syn-epsilon" });
    const firstMax = firstState.sides.p2.unit.base.hp;
    const secondMax = secondState.sides.p2.unit.base.hp;

    const firstAction = play(reactMark, firstState);
    expect(damageOf(firstAction)).toBe(Math.floor((firstMax * 20) / 100));
    expect(reactEffect(firstAction.state)?.params?.growAcc).toBe(5);
    expect(sourceReactApply()?.params?.growAcc).toBeUndefined();

    const secondAction = play(reactMark, secondState);
    expect(damageOf(secondAction)).toBe(Math.floor((secondMax * 20) / 100));
    expect(reactEffect(secondAction.state)?.params?.growAcc).toBe(5);
    expect(sourceReactApply()?.params?.growAcc).toBeUndefined();

    firstAction.state.sides.p2.unit.currentHp = firstMax;
    const firstNext = play(reactMark, firstAction.state);
    expect(damageOf(firstNext)).toBe(Math.floor((firstMax * 25) / 100));
    expect(reactEffect(firstNext.state)?.params?.growAcc).toBe(10);

    secondAction.state.sides.p2.unit.currentHp = secondMax;
    const secondNext = play(reactMark, secondAction.state);
    expect(damageOf(secondNext)).toBe(Math.floor((secondMax * 25) / 100));
    expect(reactEffect(secondNext.state)?.params?.growAcc).toBe(10);
  });

  it("旧 params.growStep 仍只累加 payload 概率并在完成后提交", () => {
    const state = initBattle(legacyMark, { battleId: "react-grow-legacy", seedHex: "34".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
    const first = play(legacyMark, state);
    expect(reactEffect(first.state)?.params?.growAcc).toBe(50);
    const second = play(legacyMark, JSON.parse(JSON.stringify(first.state)) as CoreState);
    expect(reactEffect(second.state)?.params?.growAcc).toBe(100);
    expect(second.events.some((event: any) => event.type === "effect-applied" && event.detail.side === "p2" && event.detail.name === "paralysis")).toBe(true);
  });
});

describe("react growth 共享装载边界", () => {
  const validate = (effects: readonly unknown[]) => validateEffects(effects as readonly CompiledEffect[], {}, (message) => { throw new Error(message); });
  const validateOne = (fx: unknown) => validate([fx]);
  const grow = { op: "grow", of: "magnitude", step: 5, magCap: 30 };
  const damage = { op: "hp_delta", target: "opponent", flat: 1 };
  const react = (payload: unknown[], params: Record<string, number> = {}) => ({ op: "apply_status", name: "react", target: "self", params: { trigger: 11, ...params }, payload });

  it("无 ruleset 限定时拒绝旧概率字段和幅度帧共用累积槽", () => {
    expect(() => validateOne(react([grow, damage], { growStep: 5, growCap: 80 }))).toThrow(/cannot combine legacy/);
    expect(() => validateOne(react([grow, damage], { growCap: 80 }))).toThrow(/cannot combine legacy/);
  });

  it("拒绝多个或非首位的直接 grow 帧，但不收紧普通魂印 hook", () => {
    expect(() => validateOne(react([grow, grow, damage]))).toThrow(/only one direct grow/);
    expect(() => validateOne(react([damage, grow]))).toThrow(/must be the first direct op/);
    expect(() => validate([grow, damage])).not.toThrow();
  });

  it("拒绝幅度帧自身带静态、动态或 nullify 条件门", () => {
    expect(() => validateOne(react([{ ...grow, chance: 50 }, damage]))).toThrow(/cannot have per-op gates/);
    expect(() => validateOne(react([{ ...grow, if: { selfHpAboveFoe: true } }, damage]))).toThrow(/cannot have per-op gates/);
    expect(() => validateOne(react([{ ...grow, chancePerUse: 5 }, damage]))).toThrow(/cannot have per-op gates/);
    expect(() => validateOne(react([{ ...grow, chanceSelfCurPct: true }, damage]))).toThrow(/cannot have per-op gates/);
    expect(() => validateOne(react([{ ...grow, nullifyOnly: true }, damage]))).toThrow(/cannot have per-op gates/);
  });

  it("拒绝会丢失挂起续跑的达顶尾负载", () => {
    expect(() => validateOne(react([{ ...grow, payload: [damage] }, damage]))).toThrow(/cannot have a deferred at-cap payload/);
  });
});
