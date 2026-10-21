/**
 * trigger 11/3 纯使用技能窗口：真实战斗管线中的时点、阻断、持久化及 KO 恢复。
 * 所有魂印都在本测试的内存 synthetic fixture 编译，不改内容包或哈希版本。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  applyReplacement, applyTurn, compilePack, initBattle,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "5152535455565758595a5b5c5d5e5f60";

type RawUnit = { id: string; [key: string]: unknown };
type RawMove = { id: string; [key: string]: unknown };
type Fixture = {
  ruleset: { features: string[]; [key: string]: unknown };
  pack: Record<string, unknown>;
  units: { units: RawUnit[]; [key: string]: unknown };
  moves: { moves: RawMove[]; [key: string]: unknown };
  typeChart: unknown;
  natures: unknown;
  seals: unknown;
  soulmarks: { soulmarks: Record<string, unknown> };
  items: unknown;
};
type Mark = { id: string; name: string; effects: Record<string, unknown>[] };
type ReactSpec = { trigger: 3 | 11; flat: number; cat?: number; stack?: boolean };
type StateUnit = CoreState["sides"]["p1"]["unit"];
type Event = { type: string; detail: Record<string, unknown> };

const read = <T>(path: string): T => JSON.parse(readFileSync(join(CONTENT, path), "utf8")) as T;
const action = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `move-start-${id}` });

function freshFixture(): Fixture {
  const ruleset = read<Fixture["ruleset"]>("rulesets/synthetic-v2.json");
  // hp_delta 已注册为原子 op，但 synthetic-v2 的生产 allowlist 刻意未启用；
  // 本测试只在内存 fixture 为自定义 react payload 打开它。
  const allowlist = ruleset.operatorAllowlist as string[] | undefined;
  if (allowlist !== undefined && !allowlist.includes("hp_delta")) allowlist.push("hp_delta");
  return {
    ruleset,
    pack: read("synthetic-v2/pack.json"),
    units: read("synthetic-v2/units.json"),
    moves: read("synthetic-v2/moves.json"),
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    seals: read("seals/seals.json"),
    soulmarks: read("synthetic-v2/soulmarks.json"),
    items: read("synthetic-v2/items.json"),
  };
}

function reactInstall({ trigger, flat, cat = 4, stack = true }: ReactSpec): Record<string, unknown> {
  return {
    op: "apply_status",
    name: "react",
    target: "self",
    params: { trigger, cat },
    stack,
    payload: [{
      op: "hp_delta",
      target: "opponent",
      flat,
      healSelf: { numerator: 1, denominator: 1, of: "dealt" },
    }],
  };
}

function startMark(id: string, specs: ReactSpec[], includeLegacyOnMoveUsed = false): Mark {
  const effects: Record<string, unknown>[] = [{
    hook: "onBattleStart",
    ops: specs.map(reactInstall),
  }];
  if (includeLegacyOnMoveUsed) {
    effects.push({
      hook: "onMoveUsed",
      guard: { actor: "self", cat: [2, 3] },
      ops: [{ op: "damage", kind: "fixed", power: 13, target: "opponent" }],
    });
  }
  return { id, name: id, effects };
}

function buildPack(options: { marks?: Mark[]; movePatch?: Record<string, unknown>; markUnits?: string[] } = {}): FrozenPack {
  const raw = freshFixture();
  for (const mark of options.marks ?? []) raw.soulmarks.soulmarks[mark.id] = mark;
  for (const unitId of options.markUnits ?? []) {
    const unit = raw.units.units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) throw new Error(`synthetic fixture is missing ${unitId}`);
    unit.soulMark = options.marks?.[0]?.id;
  }
  if (options.movePatch !== undefined) {
    const strike = raw.moves.moves.find((move) => move.id === "syn-strike");
    if (strike === undefined) throw new Error("synthetic fixture is missing syn-strike");
    Object.assign(strike, options.movePatch);
    if ("accuracy" in options.movePatch) raw.ruleset.features = [...raw.ruleset.features, "accuracy"];
  }
  return compilePack(raw as Parameters<typeof compilePack>[0]);
}

function battle(
  pack: FrozenPack,
  options: {
    p1?: string;
    p2?: string;
    p1Bench?: string[];
    p2Bench?: string[];
    p1Marks?: Array<string | undefined>;
    p2Marks?: Array<string | undefined>;
  } = {},
): CoreState {
  const loadout: { p1?: Array<string | undefined>; p2?: Array<string | undefined> } = {};
  if (options.p1Marks !== undefined) loadout.p1 = options.p1Marks;
  if (options.p2Marks !== undefined) loadout.p2 = options.p2Marks;
  const mechanics = Object.keys(loadout).length > 0 ? { soulmark: loadout } : undefined;
  return initBattle(pack, {
    battleId: "btl_soulmark_move_start",
    seedHex: SEED,
    p1: options.p1 ?? "syn-gamma",
    p2: options.p2 ?? "syn-delta",
    ...(options.p1Bench !== undefined || options.p2Bench !== undefined
      ? { bench: {
          ...(options.p1Bench !== undefined ? { p1: options.p1Bench } : {}),
          ...(options.p2Bench !== undefined ? { p2: options.p2Bench } : {}),
        } }
      : {}),
    ...(mechanics !== undefined ? { mechanics } : {}),
  });
}

function unwrap(result: ReturnType<typeof applyTurn> | ReturnType<typeof applyReplacement>) {
  if (!result.ok) throw new Error(`fault: ${result.fault.reason} ${result.fault.message}`);
  return result;
}

function events(result: { ok: boolean; events?: Event[] }, type: string): Event[] {
  return result.ok ? (result.events ?? []).filter((event) => event.type === type) : [];
}

function statusDamage(result: { ok: boolean; events?: Event[] }): Event[] {
  return events(result, "damage").filter((event) => event.detail.cause === "status:hp_delta");
}

function hookEvents(result: { ok: boolean; events?: Event[] }, hook: string): Event[] {
  return events(result, "soulmark").filter((event) => event.detail.effect === `hook:${hook}`);
}

function pushStoredEffect(unit: StateUnit, effect: Record<string, unknown>): void {
  unit.effects.push(effect as never);
}

const SELF_START = startMark("sm-move-start", [{ trigger: 11, flat: 7 }], true);

describe("魂印 react 11：招式命中判定前的使用窗口", () => {
  it.each([
    { label: "命中率为0的accuracy MISS", movePatch: { accuracy: 0 }, missReason: undefined },
    { label: "hitIf判定失败的MISS", movePatch: { hitIf: { when: { selfHpAbove: { numerator: 1, denominator: 1 } } } }, missReason: "hitIf" },
  ])("$label 仍触发前置吸取，但旧 onMoveUsed 不派发", ({ movePatch, missReason }) => {
    const pack = buildPack({ marks: [SELF_START], movePatch });
    const state = battle(pack, { p1Marks: [SELF_START.id] });
    state.sides.p1.unit.currentHp = 40;

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));

    expect(statusDamage(result).map((event) => [event.detail.side, event.detail.amount])).toEqual([["p2", 7]]);
    expect(events(result, "heal").filter((event) => event.detail.source === "status:hp_delta").map((event) => event.detail.amount)).toEqual([7]);
    expect(result.state.sides.p1.unit.currentHp).toBe(47);
    expect(events(result, "missed").some((event) => event.detail.side === "p1" && event.detail.moveId === "syn-strike"
      && (missReason === undefined || event.detail.reason === missReason))).toBe(true);
    expect(hookEvents(result, "onMoveUsed")).toHaveLength(0);
    expect(events(result, "damage")).toHaveLength(1); // 招式伤害及旧出招后魂印均跳过
  });

  it("命中时先按实际扣量吸取并回血，再结算招式，最后派发 onMoveUsed", () => {
    const pack = buildPack({ marks: [SELF_START] });
    const state = battle(pack, { p1Marks: [SELF_START.id] });
    state.sides.p1.unit.currentHp = 40;

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));
    const evs = result.events;
    const reactAt = evs.findIndex((event) => event.type === "damage" && event.detail.cause === "status:hp_delta");
    const moveHitAt = evs.findIndex((event) => event.type === "damage" && event.detail.side === "p2" && event.detail.cause === undefined);
    const useHookAt = evs.findIndex((event) => event.type === "soulmark" && event.detail.effect === "hook:onMoveUsed");

    expect(statusDamage(result).map((event) => event.detail.amount)).toEqual([7]);
    expect(events(result, "heal").filter((event) => event.detail.source === "status:hp_delta").map((event) => event.detail.amount)).toEqual([7]);
    expect(hookEvents(result, "onMoveUsed")).toHaveLength(1);
    expect(reactAt).toBeGreaterThanOrEqual(0);
    expect(moveHitAt).toBeGreaterThan(reactAt);
    expect(useHookAt).toBeGreaterThan(moveHitAt);
  });

  it.each([
    { actionId: "act_syn-strike", label: "物理技能", expected: 1 },
    { actionId: "act_fifth-verdant-aegis", label: "特殊技能", expected: 1 },
    { actionId: "act_syn-hex", label: "属性技能", expected: 0 },
  ])("cat:4覆盖$label，属性类别不触发", ({ actionId, expected }) => {
    const mark = startMark("sm-cat4", [{ trigger: 11, flat: 5 }]);
    const pack = buildPack({ marks: [mark] });
    const state = battle(pack, { p1Marks: [mark.id] });
    const result = unwrap(applyTurn(pack, state, {
      p1: action(actionId),
      p2: action("act_syn-purge-mind"),
    }));
    expect(statusDamage(result)).toHaveLength(expected);
  });
});

describe("魂印 react 11：失败动作、阻断和无效化", () => {
  const cases = [
    {
      label: "保证阻断的害怕状态",
      reason: "status:fear",
      install: (unit: StateUnit) => pushStoredEffect(unit, { kind: "fear", effectInstanceId: "fear", appliedTurn: 0 }),
    },
    {
      label: "控制状态",
      reason: "controlled",
      install: (unit: StateUnit) => pushStoredEffect(unit, { kind: "control:stun", effectInstanceId: "ctl", remainingTurns: 1, appliedTurn: 0 }),
    },
    {
      label: "攻击技能封印",
      reason: "status-locked",
      install: (unit: StateUnit) => pushStoredEffect(unit, { kind: "modifier", at: "blockCategory", effectInstanceId: "seal", params: { cat: 2 }, appliedTurn: 0 }),
    },
    {
      label: "次数制招式失效",
      reason: "move-nullified",
      install: (unit: StateUnit) => pushStoredEffect(unit, { kind: "modifier", at: "nullifies", effectInstanceId: "null", params: { count: 1, cat: 2 }, appliedTurn: 0 }),
    },
  ] as const;

  it.each(cases)("$label 在 trigger11 前终止动作", ({ reason, install }) => {
    const pack = buildPack({ marks: [SELF_START] });
    const state = battle(pack, { p1Marks: [SELF_START.id] });
    install(state.sides.p1.unit);

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));

    expect(statusDamage(result)).toHaveLength(0);
    expect(hookEvents(result, "onMoveUsed")).toHaveLength(0);
    expect(events(result, "action-failed").some((event) => event.detail.side === "p1" && event.detail.reason === reason)).toBe(true);
    expect(events(result, "pp-spent").some((event) => event.detail.side === "p1" && event.detail.moveId === "syn-strike")).toBe(true);
  });

  it("0 PP的无效动作不派发 trigger11", () => {
    const pack = buildPack({ marks: [SELF_START] });
    const state = battle(pack, { p1Marks: [SELF_START.id] });
    state.sides.p1.unit.moves.find((move) => move.moveId === "syn-strike")!.pp = 0;

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));

    expect(statusDamage(result)).toHaveLength(0);
    expect(hookEvents(result, "onMoveUsed")).toHaveLength(0);
    expect(events(result, "action-failed").some((event) => event.detail.side === "p1")).toBe(true);
  });
});

describe("trigger 3 与 11 的顺序和 KO 截断", () => {
  it("敌方 trigger3 先执行，随后行动方 trigger11", () => {
    const selfMark = startMark("sm-self-use", [{ trigger: 11, flat: 7 }]);
    const foeMark = startMark("sm-foe-use", [{ trigger: 3, flat: 5 }]);
    const pack = buildPack({ marks: [selfMark, foeMark] });
    const state = battle(pack, { p1Marks: [selfMark.id], p2Marks: [foeMark.id] });

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));

    expect(statusDamage(result).map((event) => [event.detail.side, event.detail.amount])).toEqual([["p1", 5], ["p2", 7]]);
  });

  it("trigger3 击倒行动方时不派发其 trigger11 或后续招式", () => {
    const selfMark = startMark("sm-self-use", [{ trigger: 11, flat: 7 }]);
    const foeMark = startMark("sm-foe-kill", [{ trigger: 3, flat: 999 }]);
    const pack = buildPack({ marks: [selfMark, foeMark] });
    const state = battle(pack, {
      p1: "syn-gamma",
      p2: "syn-delta",
      p1Bench: ["syn-epsilon"],
      p1Marks: [selfMark.id],
      p2Marks: [foeMark.id],
    });
    state.sides.p1.unit.currentHp = 5;
    state.sides.p1.unit.revives = 0;

    const first = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));
    expect(first.state.suspension?.koSide).toBe("p1");
    expect(first.state.suspension?.remaining.p1).toBeNull();
    expect(statusDamage(first).map((event) => [event.detail.side, event.detail.amount])).toEqual([["p1", 5]]);
    expect(events(first, "damage").every((event) => event.detail.cause === "status:hp_delta")).toBe(true);

    const restored = JSON.parse(JSON.stringify(first.state)) as CoreState;
    const resumed = unwrap(applyReplacement(pack, restored, {
      p1: action("act_switch-0"),
      p2: null,
    }));
    expect(statusDamage(resumed)).toHaveLength(0);
    expect(resumed.state.sides.p1.unit.speciesId).toBe("syn-epsilon");
  });
});

describe("react持久化、多个规则和替补续跑", () => {
  it("两个同trigger规则用stack:true独立执行，各自只吸取一次", () => {
    const mark = startMark("sm-stacked-reacts", [
      { trigger: 11, flat: 5, stack: true },
      { trigger: 11, flat: 7, stack: true },
    ]);
    const pack = buildPack({ marks: [mark] });
    const state = battle(pack, { p1Marks: [mark.id] });
    state.sides.p1.unit.currentHp -= 20;

    const result = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));

    expect(result.state.sides.p1.unit.effects.filter((effect) => effect.kind === "react" && effect.params?.trigger === 11)).toHaveLength(2);
    expect(statusDamage(result).map((event) => event.detail.amount)).toEqual([5, 7]);
    expect(events(result, "heal").filter((event) => event.detail.source === "status:hp_delta").map((event) => event.detail.amount)).toEqual([5, 7]);
  });

  it("先置吸取只扣剩余27并回27；KO挂起经JSON恢复和换人后不重放动作", () => {
    const mark = startMark("sm-ko-drain", [{ trigger: 11, flat: 100 }]);
    const pack = buildPack({ marks: [mark] });
    const state = battle(pack, {
      p1Marks: [mark.id],
      p2Bench: ["syn-epsilon"],
    });
    state.sides.p1.unit.currentHp -= 50;
    state.sides.p2.unit.currentHp = 27;
    state.sides.p2.unit.revives = 0;
    const beforeP1 = state.sides.p1.unit.currentHp;

    const first = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-purge-mind"),
    }));
    expect(first.state.suspension?.koSide).toBe("p2");
    expect(first.state.suspension?.remaining.p1).toBeNull();
    expect(statusDamage(first).map((event) => [event.detail.side, event.detail.amount])).toEqual([["p2", 27]]);
    expect(events(first, "heal").filter((event) => event.detail.source === "status:hp_delta").map((event) => event.detail.amount)).toEqual([27]);
    expect(first.state.sides.p1.unit.currentHp).toBe(beforeP1 + 27);
    expect(events(first, "damage").every((event) => event.detail.cause === "status:hp_delta")).toBe(true);

    const restored = JSON.parse(JSON.stringify(first.state)) as CoreState;
    const resumed = unwrap(applyReplacement(pack, restored, {
      p1: null,
      p2: action("act_switch-0"),
    }));
    expect(statusDamage(resumed)).toHaveLength(0);
    expect(events(resumed, "heal").filter((event) => event.detail.source === "status:hp_delta")).toHaveLength(0);
    expect(resumed.state.sides.p1.unit.currentHp).toBe(beforeP1 + 27);
    expect(resumed.state.sides.p1.unit.moves.find((move) => move.moveId === "syn-strike")!.pp).toBe(34);
    expect(resumed.state.sides.p2.unit.speciesId).toBe("syn-epsilon");
  });

  it("永久react不被timed cleanse删除，onBattleStart在切换返场时不重复安装", () => {
    const mark = startMark("sm-reentry-react", [{ trigger: 11, flat: 5 }]);
    const pack = buildPack({ marks: [mark] });
    const state = battle(pack, {
      p1Marks: [mark.id],
      p2Bench: ["syn-epsilon"],
    });
    pushStoredEffect(state.sides.p1.unit, {
      kind: "react",
      effectInstanceId: "timed-react",
      params: { trigger: 11, cat: 2 },
      remainingTurns: 2,
      appliedTurn: 0,
      payload: [{ op: "hp_delta", target: "opponent", flat: 99 }],
    });

    const switched = unwrap(applyTurn(pack, state, {
      p1: action("act_syn-strike"),
      p2: action("act_switch-0"), // 新上场 syn-epsilon 的 entry_dispel 清除对手限时效果
    }));
    expect(switched.state.sides.p1.unit.effects.filter((effect) => effect.kind === "react")).toHaveLength(1);
    expect(switched.state.sides.p1.unit.effects.find((effect) => effect.kind === "react")?.remainingTurns).toBeUndefined();
    expect(statusDamage(switched).map((event) => event.detail.amount)).toEqual([5]);

    const cyclePack = buildPack({ marks: [mark], markUnits: ["syn-gamma", "syn-epsilon"] });
    let cycle = battle(cyclePack, {
      p1: "syn-gamma",
      p2: "syn-marktank",
      p1Bench: ["syn-epsilon"],
    });
    for (const actionId of ["act_switch-0", "act_switch-0", "act_switch-0"] as const) {
      cycle = unwrap(applyTurn(cyclePack, cycle, {
        p1: action(actionId),
        p2: action("act_syn-jab"),
      })).state;
      for (const unit of [cycle.sides.p1.unit, ...(cycle.sides.p1.bench ?? [])]) {
        expect(unit.effects.filter((effect) => effect.kind === "react" && effect.params?.trigger === 11)).toHaveLength(1);
      }
    }
    const afterReturn = unwrap(applyTurn(cyclePack, cycle, {
      p1: action("act_syn-strike"),
      p2: action("act_syn-jab"),
    }));
    expect(statusDamage(afterReturn).map((event) => event.detail.amount)).toEqual([5]);
  });
});
