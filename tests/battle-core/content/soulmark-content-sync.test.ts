import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@seer/contracts";
import { applyTurn, initBattle, legalActions, loadPackFromDir } from "@seer/battle-core";
import { dmgOutPctOf, dmgReduceFlatOf, missChanceEntries } from "../../../packages/battle-core/src/ops/effects.ts";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "peak");
const SEED = "91".repeat(16);
const MARKS = JSON.parse(readFileSync(join(CONTENT, "peak", "soulmarks.json"), "utf8")).soulmarks as Record<string, {
  id: string; effects: { hook: string; guard?: unknown; bossGate?: boolean; ops: Record<string, unknown>[] }[];
}>;

function withoutUnitMark(unitId: string) {
  const unitsById = new Map(PACK.unitsById);
  const unit = unitsById.get(unitId);
  if (unit === undefined) throw new Error(`missing unit ${unitId}`);
  const { soulMark: _soulMark, ...unitWithoutMark } = unit;
  unitsById.set(unitId, unitWithoutMark);
  return { ...PACK, unitsById } as typeof PACK;
}

function resultOf(pack: typeof PACK, state: ReturnType<typeof initBattle>, p1: string, p2: string) {
  const result = applyTurn(pack, state, {
    p1: { actionId: p1, origin: "player", idempotencyKey: "sync-p1" },
    p2: { actionId: p2, origin: "player", idempotencyKey: "sync-p2" },
  });
  if (!result.ok) throw new Error(`${result.fault.reason}: ${result.fault.message}`);
  return result;
}

function packWithMoveEffect(moveId: string, effect: Record<string, unknown>) {
  const movesById = new Map(PACK.movesById);
  const move = movesById.get(moveId);
  if (move === undefined) throw new Error(`missing move ${moveId}`);
  movesById.set(moveId, { ...move, effects: [...move.effects, effect] } as typeof move);
  return { ...PACK, movesById } as typeof PACK;
}

function packWithMoveAccuracy(pack: typeof PACK, moveId: string, accuracy: number) {
  const movesById = new Map(pack.movesById);
  const move = movesById.get(moveId);
  if (move === undefined) throw new Error(`missing move ${moveId}`);
  movesById.set(moveId, { ...move, accuracy });
  return { ...pack, movesById } as typeof PACK;
}

function disableMoves(unit: ReturnType<typeof initBattle>["sides"]["p1"]["unit"]): string {
  for (const move of unit.moves) move.pp = 0;
  return `act_${unit.moves[0]!.moveId}`;
}

describe("巅峰魂印定点同步的真实包验收", () => {
  it("加载实际 peak 包并把本轮修复只链接到完整 creature.id", () => {
    expect(PACK.unitsById.size).toBeGreaterThan(2000);
    for (const id of ["pet-2754", "pet-4742", "pet-4540", "pet-4939", "pet-4590", "pet-4666", "pet-4695"]) {
      expect(PACK.unitsById.get(id)?.soulMark, id).toBe(`sm-${id.slice(4)}`);
    }
    for (const id of ["pet-4904", "pet-4943"]) {
      expect(PACK.unitsById.get(id)?.soulMark, id).toBeUndefined();
    }
    expect(PACK.unitsById.get("pet-4814")?.soulMark).toBe("sm-4814");
    expect(MARKS["sm-4814"]?.effects).toMatchObject([{ hook: "onTurnEnd", guard: { weCounterFoe: true }, ops: [{ op: "pp_delta", amount: 2 }, { op: "invert_stages", target: "opponent" }] }]);
    for (const id of ["pet-4759", "pet-4835"]) {
      expect(PACK.unitsById.get(id)?.soulMark, id).toBeUndefined();
      expect(MARKS[`sm-${id.slice(4)}`], id).toBeUndefined();
    }
    // 手工巅峰阵容的默认不挂载策略由 peak-roster.test.ts 锁定；这里防止数据同步误把它们补上。
    for (const id of ["pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169", "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321"]) {
      expect(PACK.unitsById.get(id)?.soulMark, id).toBeUndefined();
    }
  });

  it("pet-3144 在攻击MISS前恢复150，属性技和被封印动作不触发", () => {
    const attackId = "mv-3144-s5";
    const missMarkedPack = packWithMoveAccuracy(PACK, attackId, 0);
    const missBarePack = packWithMoveAccuracy(withoutUnitMark("pet-3144"), attackId, 0);
    const run = (pack: typeof PACK, battleId: string, actionId: string, blockCat?: number) => {
      const state = initBattle(pack, { battleId, seedHex: SEED, p1: "pet-3144", p2: "pet-5000" });
      const self = state.sides.p1.unit;
      const foe = state.sides.p2.unit;
      self.currentHp = Math.floor(self.base.hp / 2);
      self.base.spd = 2000;
      foe.base.spd = 1;
      const before = self.currentHp;
      if (blockCat !== undefined) {
        self.effects.push({ kind: "modifier", at: "blockCategory", effectInstanceId: `sync-3144-block-${battleId}`, params: { cat: blockCat }, appliedTurn: 0 });
      }
      const out = resultOf(pack, state, actionId, disableMoves(foe));
      return { before, out };
    };

    const missed = run(missMarkedPack, "sync-3144-miss-marked", `act_${attackId}`);
    const missedBare = run(missBarePack, "sync-3144-miss-bare", `act_${attackId}`);
    expect(missed.out.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    expect(missed.out.state.sides.p1.unit.currentHp).toBe(missed.before + 150);
    expect(missedBare.out.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    expect(missedBare.out.state.sides.p1.unit.currentHp).toBe(missedBare.before);

    const attributeMoveId = "mv-3144-s14";
    const attribute = PACK.movesById.get(attributeMoveId);
    expect(attribute).toBeDefined();
    expect(attribute?.category).not.toBe("physical");
    expect(attribute?.category).not.toBe("special");
    const attributeMarked = run(PACK, "sync-3144-attribute-marked", `act_${attributeMoveId}`);
    const attributeBare = run(withoutUnitMark("pet-3144"), "sync-3144-attribute-bare", `act_${attributeMoveId}`);
    expect(attributeMarked.out.state.sides.p1.unit.currentHp).toBe(attributeBare.out.state.sides.p1.unit.currentHp);

    const blockedMarked = run(missMarkedPack, "sync-3144-blocked-marked", `act_${attackId}`, 2);
    const blockedBare = run(missBarePack, "sync-3144-blocked-bare", `act_${attackId}`, 2);
    expect(blockedMarked.out.events.some((event) => event.type === "action-failed" && event.detail.side === "p1" && event.detail.reason === "status-locked")).toBe(true);
    expect(blockedMarked.out.state.sides.p1.unit.currentHp).toBe(blockedMarked.before);
    expect(blockedBare.out.state.sides.p1.unit.currentHp).toBe(blockedBare.before);
  });

  it("pet-2837 的真实50%概率在特殊攻击前结算，KO时检查点截断招式", () => {
    const moveId = "mv-2837-s20";
    const pack = packWithMoveAccuracy(PACK, moveId, 0);
    const run = (seedHex: string, battleId: string) => {
      const state = initBattle(pack, { battleId, seedHex, p1: "pet-2837", p2: "pet-5000" });
      const self = state.sides.p1.unit;
      const foe = state.sides.p2.unit;
      self.base.spd = 2000;
      foe.base.spd = 1;
      foe.currentHp = 100;
      const drawStart = state.rng.drawCounter;
      const out = resultOf(pack, state, `act_${moveId}`, disableMoves(foe));
      return { drawStart, out };
    };

    expect(MARKS["sm-2837"]?.effects).toMatchObject([{
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "react", params: { trigger: 11, cat: 4 }, stack: true,
        payload: [{ op: "damage", kind: "fixed", power: 200, chance: 50 }] }],
    }]);

    // xoshiro seed 01… produces first chance draw 18 (<50): the react KOs a 100-HP target before accuracy/MISS resolution.
    const triggered = run("01".repeat(16), "sync-2837-triggered");
    expect(triggered.out.state.rng.drawCounter - triggered.drawStart).toBe(1);
    expect(triggered.out.state.sides.p2.unit.currentHp).toBe(0);
    expect(triggered.out.state.terminal?.result).toBe("p1");
    expect(triggered.out.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(false);
    const damageToFoe = triggered.out.events.filter((event) => event.type === "damage" && event.detail.side === "p2");
    expect(damageToFoe).toEqual([expect.objectContaining({ detail: expect.objectContaining({ amount: 200, damageKind: "fixed", hpAfter: expect.objectContaining({ current: 0 }) }) })]);

    // xoshiro seed 04… produces draw 90 (>=50): the real chance payload does not damage; the forced-MISS move then resolves normally.
    const missedChance = run("04".repeat(16), "sync-2837-missed-chance");
    expect(missedChance.out.state.rng.drawCounter - missedChance.drawStart).toBe(1);
    expect(missedChance.out.state.sides.p2.unit.currentHp).toBe(100);
    expect(missedChance.out.state.terminal).toBeNull();
    expect(missedChance.out.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    expect(missedChance.out.events.some((event) => event.type === "damage" && event.detail.side === "p2" && event.detail.damageKind === "fixed")).toBe(false);
  });

  it("pet-4939 的 kindMask=7 只削减 fixed/percent/standard，真实伤害保持原值", () => {
    const cases = [
      { attacker: "pet-3101", move: "mv-3101-s11", kind: "fixed" },
      { attacker: "pet-3577", move: "mv-3577-0", kind: "percent" },
      { attacker: "pet-5000", move: "mv-5000-1", kind: "standard" },
      { attacker: "pet-4450", move: "mv-4450-s12", kind: "true" },
    ] as const;
    const bare = withoutUnitMark("pet-4939");
    for (const c of cases) {
      const damageAgainst = (pack: typeof PACK) => {
        const state = initBattle(pack, { battleId: `sync-${c.kind}`, seedHex: SEED, p1: c.attacker, p2: "pet-4939" });
        const attacker = state.sides.p1.unit;
        const defender = state.sides.p2.unit;
        attacker.base.atk = 2000;
        attacker.base.def = 100;
        defender.base.def = 5000; // 满足 n≥200；受击方自身持有 pet-4939。
        defender.currentHp = defender.base.hp;
        const blockedAction = disableMoves(defender);
        expect(legalActions(state, "p1")).toContain(`act_${c.move}`);
        const out = resultOf(pack, state, `act_${c.move}`, blockedAction);
        const primary = out.events.filter((e) => e.type === "damage" && e.detail.side === "p2" && e.detail.cause === undefined
          && (c.kind === "standard" ? e.detail.damageKind === undefined : e.detail.damageKind === c.kind));
        return primary.reduce((sum, e) => sum + Number(e.detail.amount ?? 0), 0);
      };
      const plainDamage = damageAgainst(bare);
      const markedDamage = damageAgainst(PACK);
      expect(plainDamage, `${c.kind} baseline`).toBeGreaterThan(0);
      if (c.kind === "true") expect(markedDamage).toBe(plainDamage);
      else expect(markedDamage).toBe(Math.floor((plainDamage * 70) / 100));
    }
  });

  it("pet-3843 按每个回合开始时的当前体力关系选 50%/25% 暴击分支", () => {
    const state = initBattle(PACK, { battleId: "sync-3843", seedHex: SEED, p1: "pet-3843", p2: "pet-5000" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    self.base.hp = 10000;
    foe.base.hp = 10000;
    self.currentHp = 5000;
    foe.currentHp = 4999;
    foe.base.spd = 2000; // 确保对方先行动，并在本回合内把初始的体力优势反转。
    self.base.spd = 100;
    foe.base.atk = 2000;
    self.base.def = 100;
    const selfInvalid = disableMoves(self);
    const foeMove = "act_mv-5000-1";
    expect(legalActions(state, "p2")).toContain(foeMove);
    const first = resultOf(PACK, state, selfInvalid, foeMove);
    expect(first.state.sides.p1.unit.currentHp).toBeLessThan(first.state.sides.p2.unit.currentHp);
    const crit = first.state.sides.p1.unit.effects.find((e) => e.label === "crit_up");
    expect(crit?.params).toMatchObject({ n: 50, d: 100 });

    // 下一回合钩子重读当时关系，改走低于分支。
    first.state.sides.p1.unit.currentHp = 1000;
    first.state.sides.p2.unit.currentHp = 2000;
    const nextSelfInvalid = disableMoves(first.state.sides.p1.unit);
    const nextFoeInvalid = disableMoves(first.state.sides.p2.unit);
    const second = resultOf(PACK, first.state, nextSelfInvalid, nextFoeInvalid);
    const nextCrit = second.state.sides.p1.unit.effects.find((e) => e.label === "crit_up");
    expect(nextCrit?.params).toMatchObject({ n: 25, d: 100 });
    expect(MARKS["sm-3843"]?.effects.map((e) => e.hook)).toEqual(["onBattleStart", "onTurnStart", "onTurnStart"]);
  });

  it("pet-4540 bossGate 让正确的回合开始回血只对非 boss 生效", () => {
    const start = (foeBoss: boolean) => {
      const state = initBattle(PACK, { battleId: `sync-4540-${foeBoss}`, seedHex: SEED, p1: "pet-4540", p2: "pet-5000" });
      const self = state.sides.p1.unit;
      const foe = state.sides.p2.unit;
      self.base.hp = 10000;
      foe.base.hp = 10000;
      self.base.sdf = 700;
      foe.base.sdf = 100;
      self.currentHp = 4000;
      foe.currentHp = 5000;
      if (foeBoss) foe.mode = "boss";
      return { state, selfAction: disableMoves(self), foeAction: disableMoves(foe), before: self.currentHp };
    };
    const normal = start(false);
    const normalOut = resultOf(PACK, normal.state, normal.selfAction, normal.foeAction);
    expect(normalOut.state.sides.p1.unit.currentHp).toBe(normal.before + 600);
    expect(MARKS["sm-4540"]?.effects[0]?.bossGate).toBe(true);

    const boss = start(true);
    const bossOut = resultOf(PACK, boss.state, boss.selfAction, boss.foeAction);
    expect(bossOut.state.sides.p1.unit.currentHp).toBe(boss.before);
  });

  it("pet-3623 两个闪避分支都只读攻击技能，属性技能不受影响", () => {
    const branch = (selfHp: number, foeHp: number, expectedPct: number) => {
      const state = initBattle(PACK, { battleId: `sync-3623-${expectedPct}`, seedHex: SEED, p1: "pet-5000", p2: "pet-3623" });
      const defender = state.sides.p2.unit;
      const attacker = state.sides.p1.unit;
      defender.base.hp = selfHp;
      attacker.base.hp = foeHp;
      defender.currentHp = defender.base.hp;
      attacker.currentHp = attacker.base.hp;
      // This mark installs its battle-start window on the first applied turn, not inside initBattle.
      // Leave foe.mode undefined so the mark's bossGate does not suppress it.
      const initialized = resultOf(PACK, state, disableMoves(attacker), disableMoves(defender));
      const runtimeDefender = initialized.state.sides.p2.unit;
      const runtimeAttacker = initialized.state.sides.p1.unit;
      const dodge = runtimeDefender.effects.filter((effect) => effect.label === "dodge");
      expect(dodge).toHaveLength(2);
      const pctsFor = (cat: number) => missChanceEntries(runtimeDefender, runtimeAttacker, cat)
        .filter((effect) => effect.label === "dodge")
        .map((effect) => effect.params?.pct)
        .sort();
      runtimeDefender.currentHp = selfHp;
      runtimeAttacker.currentHp = foeHp;
      expect(pctsFor(1)).toEqual([]);
      expect(pctsFor(2)).toEqual([expectedPct]);
      expect(pctsFor(3)).toEqual([expectedPct]);

      // Both permanent windows coexist; changing the HP relation switches which one the reader uses.
      if (expectedPct === 50) {
        runtimeDefender.currentHp = 899;
        runtimeAttacker.currentHp = 900;
      } else {
        runtimeDefender.currentHp = 901;
        runtimeAttacker.currentHp = 900;
      }
      const switchedPct = expectedPct === 50 ? 80 : 50;
      expect(pctsFor(2)).toEqual([switchedPct]);
      expect(pctsFor(3)).toEqual([switchedPct]);
      expect(missChanceEntries(runtimeDefender, runtimeAttacker, 1).some((effect) => effect.label === "dodge")).toBe(false);
    };
    branch(1000, 900, 50);
    branch(500, 1000, 80);
    expect(MARKS["sm-3623"]?.effects[0]?.ops.filter((op) => op.op === "apply_status" && op.name === "dodge").map((op) => op.params)).toEqual([
      { pct: 50, notSelfHpBelowFoe: 1, cat: 4 },
      { pct: 80, selfHpBelowFoe: 1, cat: 4 },
    ]);
    expect(MARKS["sm-3623"]?.effects[0]?.ops.filter((op) => op.op === "apply_status" && op.name === "dodge").every((op) => op.stack === true)).toBe(true);
    expect(MARKS["sm-3623"]?.effects[0]?.ops.some((op) => op.name === "dmg_taken_down")).toBe(false);
  });

  it("pet-4540/4590 在回合开始冻结 statDiff 幅值，限制为普通攻击并经 JSON 保存", () => {
    const snapshot = (unitId: "pet-4540" | "pet-4590") => {
      const state = initBattle(PACK, { battleId: `sync-snapshot-${unitId}`, seedHex: SEED, p1: unitId, p2: "pet-5000" });
      const self = state.sides.p1.unit;
      const foe = state.sides.p2.unit;
      let expected: number;
      let at: "dmgOutPct" | "dmgReduceFlat";
      if (unitId === "pet-4540") {
        self.base.sdf = 700;
        foe.base.sdf = 100;
        expected = 600;
        at = "dmgOutPct";
      } else {
        self.base.hp = 1000;
        foe.base.hp = 400;
        expected = 600;
        at = "dmgReduceFlat";
      }
      const out = resultOf(PACK, state, disableMoves(self), disableMoves(foe));
      const frozenSelf = out.state.sides.p1.unit;
      const frozenFoe = out.state.sides.p2.unit;
      const landed = frozenSelf.effects.find((effect) => effect.at === at);
      expect(landed?.amountExpr, `${unitId} frozen value`).toBe(expected);

      if (unitId === "pet-4540") frozenFoe.base.sdf = 900;
      else frozenFoe.base.hp = 1400;
      expect(landed?.amountExpr, `${unitId} does not recalculate after the opponent base changes`).toBe(expected);
      const readAmount = (selfUnit: typeof frozenSelf, foeUnit: typeof frozenFoe, kind: string) =>
        unitId === "pet-4540"
          ? dmgOutPctOf(selfUnit, foeUnit, undefined, kind)
          : dmgReduceFlatOf(selfUnit, foeUnit, kind);
      expect(readAmount(frozenSelf, frozenFoe, "standard")).toBe(expected);
      for (const kind of ["fixed", "percent", "true"]) expect(readAmount(frozenSelf, frozenFoe, kind)).toBe(0);
      const restored = JSON.parse(canonicalJson(out.state)) as typeof out.state;
      const restoredSelf = restored.sides.p1.unit;
      const restoredFoe = restored.sides.p2.unit;
      expect(restoredSelf.effects.find((effect) => effect.at === at)?.amountExpr).toBe(expected);
      expect(readAmount(restoredSelf, restoredFoe, "standard")).toBe(expected);
      for (const kind of ["fixed", "percent", "true"]) expect(readAmount(restoredSelf, restoredFoe, kind)).toBe(0);
      expect(MARKS[`sm-${unitId.slice(4)}`]?.effects[0]?.ops[0]).toMatchObject({ amountTiming: "apply", params: { kindMask: 4 } });
    };
    snapshot("pet-4540");
    snapshot("pet-4590");
  });

  it("pet-4417 每损失1%只加2%普通攻击伤害，且无流血时不施加", () => {
    const state = initBattle(PACK, { battleId: "sync-4417", seedHex: SEED, p1: "pet-4417", p2: "pet-5000" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    const out = resultOf(PACK, state, disableMoves(self), disableMoves(foe));
    const frozenSelf = out.state.sides.p1.unit;
    const frozenFoe = out.state.sides.p2.unit;
    const boost = frozenSelf.effects.find((effect) => effect.label === "dmg_boost");
    expect(boost?.params).toMatchObject({ perHpLostStep: 1, perHpLostPct: 2, kindMask: 4 });
    expect(boost?.params?.pct).toBeUndefined();
    expect(dmgOutPctOf(frozenSelf, frozenFoe, undefined, "standard")).toBe(0);
    frozenSelf.currentHp = Math.floor(frozenSelf.base.hp / 2);
    expect(dmgOutPctOf(frozenSelf, frozenFoe, undefined, "standard")).toBe(100);
    for (const kind of ["fixed", "percent", "true"]) expect(dmgOutPctOf(frozenSelf, frozenFoe, undefined, kind)).toBe(0);

    frozenSelf.currentHp = frozenSelf.base.hp;
    frozenSelf.effects = frozenSelf.effects.filter((effect) => effect.kind !== "bleed" && effect.label !== "dmg_boost");
    const next = resultOf(PACK, out.state, disableMoves(frozenSelf), disableMoves(frozenFoe));
    expect(next.state.sides.p1.unit.effects.some((effect) => effect.label === "dmg_boost")).toBe(false);
  });

  it("pet-4489 固伤周期窗尊重免疫，并冻结回合开始的对手印记资格", () => {
    type Mutation = "none" | "lose" | "gain";
    const round = (opts: { markAtStart: boolean; mutation: Mutation; fixedImmune?: boolean }) => {
      const base = initBattle(PACK, {
        battleId: `sync-4489-${opts.markAtStart}-${opts.mutation}-${opts.fixedImmune ?? false}`,
        seedHex: SEED,
        p1: "pet-4489",
        p2: "pet-5000",
      });
      const holder = base.sides.p1.unit;
      const foe = base.sides.p2.unit;
      holder.base.hp = 5000;
      holder.base.def = 5000;
      foe.base.hp = 1000;
      foe.currentHp = 1000;
      foe.base.atk = 1;
      if (opts.markAtStart) {
        foe.effects.push({
          kind: "mark:失能Ⅰ",
          effectInstanceId: "test_mark_失能Ⅰ",
          appliedTurn: base.turn,
          params: { count: 1, cap: 99 },
        });
      }
      if (opts.fixedImmune) {
        foe.effects.push({ kind: "immune", effectInstanceId: "test_fixed_immune", appliedTurn: base.turn, params: { of: 8 } });
      }

      let pack = PACK;
      let foeAction: string;
      if (opts.mutation === "none") {
        foeAction = disableMoves(foe);
      } else {
        const slot = foe.moves[0];
        if (slot === undefined) throw new Error("pet-5000 needs a move for the qualification mutation fixture");
        for (const move of foe.moves) move.pp = 0;
        slot.pp = 5;
        const mutation = opts.mutation === "lose"
          ? { op: "consume_mark", mark: "失能Ⅰ", target: "self" }
          : { op: "apply_mark", mark: "失能Ⅰ", target: "self", count: 1 };
        pack = packWithMoveEffect(slot.moveId, mutation);
        foeAction = `act_${slot.moveId}`;
      }
      const out = resultOf(pack, base, disableMoves(holder), foeAction);
      return { out, foeBefore: foe.currentHp };
    };

    const qualified = round({ markAtStart: true, mutation: "none" });
    expect(qualified.out.state.sides.p2.unit.currentHp).toBe(qualified.foeBefore - 300);
    expect(qualified.out.events.some((event) => event.type === "damage" && event.detail.cause === "status:periodic" && event.detail.damageKind === "fixed")).toBe(true);

    const immune = round({ markAtStart: true, mutation: "none", fixedImmune: true });
    expect(immune.out.state.sides.p2.unit.currentHp).toBe(immune.foeBefore);
    expect(immune.out.events.some((event) => event.type === "damage" && event.detail.cause === "status:periodic")).toBe(false);

    const lost = round({ markAtStart: true, mutation: "lose" });
    expect(lost.out.state.sides.p2.unit.effects.some((effect) => effect.kind === "mark:失能Ⅰ")).toBe(false);
    expect(lost.out.state.sides.p2.unit.currentHp).toBe(lost.foeBefore - 300);

    const gained = round({ markAtStart: false, mutation: "gain" });
    expect(gained.out.state.sides.p2.unit.effects.some((effect) => effect.kind === "mark:失能Ⅰ")).toBe(true);
    expect(gained.out.state.sides.p2.unit.currentHp).toBe(gained.foeBefore);

    expect(MARKS["sm-4489"]?.effects[4]).toMatchObject({
      hook: "onTurnStart",
      guard: { markCountAtLeast: { mark: "失能Ⅰ", n: 1, on: "foe" } },
      ops: [{ op: "apply_status", name: "periodic", target: "self", turns: 1, params: { win: 5 }, payload: [{ op: "hp_delta", target: "opponent", flat: 300, kind: "fixed" }] }],
    });
  });

  it.each([
    { id: "pet-3647", initialPct: 20, nextPct: 25 },
    { id: "pet-3791", initialPct: 20, nextPct: 25 },
    { id: "pet-3802", initialPct: 25, nextPct: 30 },
  ] as const)("$id 吸血按实际百分比扣血结算，首次为$initialPct%且下一次为$nextPct%", ({ id, initialPct, nextPct }) => {
    const state = initBattle(PACK, { battleId: `sync-drain-${id}`, seedHex: SEED, p1: id, p2: "pet-5000" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    self.base.atk = 1;
    self.base.spa = 1;
    self.currentHp = 100;
    foe.base.hp = 1000;
    foe.base.def = 10000;
    foe.base.sdf = 10000;
    foe.currentHp = 30; // 远低于20%/25%的理论吸取量，测试实际扣血与回血是否一致。
    const attack = self.moves.find((slot) => PACK.movesById.get(slot.moveId)?.effects.some((effect) => effect.op === "damage"));
    if (attack === undefined) throw new Error(`${id} has no attack move`);
    const accuracyZeroMove = PACK.movesById.get(attack.moveId);
    if (accuracyZeroMove === undefined) throw new Error(`missing move ${attack.moveId}`);
    const accuracyZeroMoves = new Map(PACK.movesById);
    accuracyZeroMoves.set(attack.moveId, { ...accuracyZeroMove, accuracy: 0 });
    const useBeforeHitPack = { ...PACK, movesById: accuracyZeroMoves } as typeof PACK;
    const foeAction = disableMoves(foe);
    // The plain-use react fires before hit resolution. Force a MISS so unrelated old hit-result riders stay outside this check.
    const first = resultOf(useBeforeHitPack, state, `act_${attack.moveId}`, foeAction);
    const firstSelf = first.state.sides.p1.unit;
    const firstFoe = first.state.sides.p2.unit;
    const firstAbsorb = first.events.filter((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    const firstHeal = first.events.filter((event) => event.type === "heal" && event.detail.source === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    expect(firstAbsorb).toBeGreaterThan(0);
    expect(firstAbsorb).toBeLessThan(Math.floor((foe.base.hp * initialPct) / 100));
    expect(firstHeal).toBe(firstAbsorb);

    // The overkill check ends the battle, so test accumulation in an independent nonlethal sequence.
    const growthState = initBattle(PACK, { battleId: `sync-drain-growth-${id}`, seedHex: SEED, p1: id, p2: "pet-5000" });
    const growthSelf = growthState.sides.p1.unit;
    const growthFoe = growthState.sides.p2.unit;
    growthSelf.base.atk = 1;
    growthSelf.base.spa = 1;
    growthSelf.currentHp = 100;
    growthFoe.base.hp = 1000;
    growthFoe.base.def = 10000;
    growthFoe.base.sdf = 10000;
    growthFoe.base.spd = 1;
    growthFoe.currentHp = 1000;
    growthSelf.base.spd = 2000;
    const growthFirst = resultOf(useBeforeHitPack, growthState, `act_${attack.moveId}`, "act_mv-5000-2");
    const growthFirstAbsorb = growthFirst.events.filter((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    expect(growthFirstAbsorb).toBe(Math.floor((growthFoe.base.hp * initialPct) / 100));
    const growthSelfNext = growthFirst.state.sides.p1.unit;
    const growthFoeNext = growthFirst.state.sides.p2.unit;
    growthSelfNext.currentHp = 100;
    growthFoeNext.currentHp = growthFoeNext.base.hp;
    growthSelfNext.base.spd = 2000;
    growthFoeNext.base.spd = 1;
    const second = resultOf(useBeforeHitPack, growthFirst.state, `act_${attack.moveId}`, "act_mv-5000-2");
    const secondAbsorb = second.events.filter((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    const secondHeal = second.events.filter((event) => event.type === "heal" && event.detail.source === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    expect(secondAbsorb).toBe(Math.floor((firstFoe.base.hp * nextPct) / 100));
    expect(secondHeal).toBe(secondAbsorb);
    const react = MARKS[`sm-${id.slice(4)}`]?.effects.find((effect) => effect.hook === "onBattleStart"
      && effect.ops.some((op) => op.op === "apply_status" && op.name === "react"
        && Array.isArray(op.payload) && op.payload.some((payload) => payload.op === "hp_delta")));
    const reactOp = react?.ops.find((op) => op.op === "apply_status" && op.name === "react");
    expect(reactOp).toMatchObject({
      params: { trigger: 11, cat: 4 },
      stack: true,
      payload: [
        { op: "grow", of: "magnitude", step: 5, magCap: id === "pet-3802" ? 35 : 30 },
        {
          op: "hp_delta",
          target: "opponent",
          frac: { numerator: initialPct, denominator: 100, of: "max" },
          kind: "percent",
          cause: "soulmark:absorb",
          healSelf: { numerator: 1, denominator: 1, of: "dealt" },
        },
      ],
    });
    const params = reactOp?.params as Record<string, unknown> | undefined;
    expect(params?.growStep).toBeUndefined();
    expect(params?.growCap).toBeUndefined();
  });

  it.each([
    { id: "pet-3647", initialPct: 20 },
    { id: "pet-3791", initialPct: 20 },
    { id: "pet-3802", initialPct: 25 },
  ] as const)("$id 的纯使用吸取在MISS前触发，阻断动作不触发或成长", ({ id, initialPct }) => {
    const state = initBattle(PACK, { battleId: `sync-drain-miss-${id}`, seedHex: SEED, p1: id, p2: "pet-5000" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    self.base.atk = 1;
    self.base.spa = 1;
    self.base.spd = 2000;
    foe.base.hp = 1000;
    foe.base.def = 10000;
    foe.base.sdf = 10000;
    foe.base.spd = 1;
    foe.currentHp = foe.base.hp;
    const attack = self.moves.find((slot) => PACK.movesById.get(slot.moveId)?.effects.some((effect) => effect.op === "damage"));
    if (attack === undefined) throw new Error(`${id} has no attack move`);
    const move = PACK.movesById.get(attack.moveId);
    if (move === undefined) throw new Error(`missing move ${attack.moveId}`);
    const movesById = new Map(PACK.movesById);
    movesById.set(attack.moveId, { ...move, accuracy: 0 });
    const missPack = { ...PACK, movesById } as typeof PACK;
    const missed = resultOf(missPack, state, `act_${attack.moveId}`, "act_mv-5000-2");
    expect(missed.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    const missAbsorb = missed.events.filter((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    expect(missAbsorb).toBe(Math.floor((foe.base.hp * initialPct) / 100));

    const nextSelf = missed.state.sides.p1.unit;
    const nextFoe = missed.state.sides.p2.unit;
    const reactAfterMiss = nextSelf.effects.find((effect) => effect.kind === "react" && effect.params?.trigger === 11);
    expect(reactAfterMiss?.params?.growAcc).toBe(5);

    const blockedState = initBattle(PACK, { battleId: `sync-drain-blocked-${id}`, seedHex: SEED, p1: id, p2: "pet-5000" });
    const blockedSelf = blockedState.sides.p1.unit;
    const blockedFoe = blockedState.sides.p2.unit;
    blockedSelf.base.atk = 1;
    blockedSelf.base.spa = 1;
    const blockedAttack = blockedSelf.moves.find((slot) => PACK.movesById.get(slot.moveId)?.effects.some((effect) => effect.op === "damage"));
    if (blockedAttack === undefined) throw new Error(`${id} has no attack move`);
    const blockedMove = PACK.movesById.get(blockedAttack.moveId);
    if (blockedMove === undefined) throw new Error(`missing move ${blockedAttack.moveId}`);
    const blockedCat = blockedMove.category === "special" ? 3 : 2;
    blockedSelf.effects.push({ kind: "modifier", at: "blockCategory", effectInstanceId: "use-time-block", params: { cat: blockedCat }, appliedTurn: 0 });
    const blocked = resultOf(PACK, blockedState, `act_${blockedAttack.moveId}`, "act_mv-5000-2");
    expect(blocked.events.some((event) => event.type === "action-failed" && event.detail.side === "p1" && event.detail.reason === "status-locked")).toBe(true);
    expect(blocked.events.some((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")).toBe(false);
    const blockedReact = blocked.state.sides.p1.unit.effects.find((effect) => effect.kind === "react" && effect.params?.trigger === 11);
    expect(blockedReact?.params?.growAcc).toBeUndefined();

    nextFoe.currentHp = nextFoe.base.hp;
    const nextUse = resultOf(missPack, missed.state, `act_${attack.moveId}`, disableMoves(nextFoe));
    expect(nextUse.events.some((event) => event.type === "missed" && event.detail.side === "p1")).toBe(true);
    const absorb = nextUse.events.filter((event) => event.type === "damage" && event.detail.cause === "soulmark:absorb")
      .reduce((sum, event) => sum + Number(event.detail.amount ?? 0), 0);
    expect(absorb).toBe(Math.floor((nextFoe.base.hp * (initialPct + 5)) / 100));
    expect(nextUse.state.sides.p1.unit.effects.find((effect) => effect.kind === "react" && effect.params?.trigger === 11)?.params?.growAcc).toBe(10);
  });

  it("局部 Boss 尾注不限制 HP 骨架，‘以上效果’则包含 HP 骨架", () => {
    const battleHpAfterStart = (unitId: string, boss: boolean) => {
      const state = initBattle(PACK, { battleId: `sync-boss-scope-${unitId}-${boss}`, seedHex: SEED, p1: unitId, p2: "pet-5000" });
      const self = state.sides.p1.unit;
      const foe = state.sides.p2.unit;
      self.base.hp = 1000;
      self.currentHp = 1000;
      if (boss) foe.mode = "boss";
      const out = resultOf(PACK, state, disableMoves(self), disableMoves(foe));
      return out.state.sides.p1.unit.base.hp;
    };

    expect(MARKS["sm-4742"]?.effects[0]?.bossGate).toBeUndefined();
    expect(MARKS["sm-3419"]?.effects.find((e) => e.hook === "onBattleStart")?.bossGate).toBeUndefined();
    expect(MARKS["sm-3419"]?.effects.find((e) => e.hook === "beforeOrder")?.bossGate).toBe(true);
    expect(MARKS["sm-3584"]?.effects.find((e) => e.hook === "onBattleStart")?.bossGate).toBe(true);

    expect(battleHpAfterStart("pet-4742", false)).toBe(1100);
    expect(battleHpAfterStart("pet-4742", true)).toBe(1100);
    expect(battleHpAfterStart("pet-3419", true)).toBe(1200);
    expect(battleHpAfterStart("pet-3584", false)).toBe(1200);
    expect(battleHpAfterStart("pet-3584", true)).toBe(1000);
  });

  it("pet-4927 保留独立的上限增加与护盾，不再免费执行有永久上限成本的旧回血", () => {
    const state = initBattle(PACK, { battleId: "sync-4927", seedHex: SEED, p1: "pet-4927", p2: "pet-4939" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    self.base.hp = 300; // 走真实的 <400 分支；成本回血分支应已从保存条目中移除。
    const maxBefore = self.base.hp;
    self.currentHp = 1;
    const selfAction = disableMoves(self);
    const foeAction = disableMoves(foe);
    const out = resultOf(PACK, state, selfAction, foeAction);
    expect(out.state.sides.p1.unit.base.hp).toBe(maxBefore + 100);
    expect(out.state.sides.p1.unit.currentHp).toBe(101); // HP 上限提升按 runtime 规则带来的 +100，不是旧的全满回血。
    expect(out.events.some((e) => e.type === "heal" && e.detail.side === "p1")).toBe(false);
    expect(MARKS["sm-4927"]?.effects.some((e) => e.hook === "onTurnEnd" && e.ops.some((op) => op.op === "heal"))).toBe(false);
  });

  it("pet-4695 只执行战斗开始的+400体力上限；关联的限次成本分支仍未实现", () => {
    const state = initBattle(PACK, { battleId: "sync-4695", seedHex: SEED, p1: "pet-4695", p2: "pet-5000" });
    const self = state.sides.p1.unit;
    const foe = state.sides.p2.unit;
    const hpBefore = self.base.hp;
    const out = resultOf(PACK, state, disableMoves(self), disableMoves(foe));
    const after = out.state.sides.p1.unit;
    expect(after.base.hp).toBe(hpBefore + 400);
    expect(MARKS["sm-4695"]?.effects).toEqual([{
      hook: "onBattleStart",
      ops: [{ op: "stat_boost", stats: ["hp"], add: 400, target: "self" }],
    }]);
    // The source also ties four >300-damage triggers to bilateral fixed damage and a permanent -100 HP-cap cost.
    // That linked branch remains deferred, so this test only certifies the independent opening-cap clause.
  });

  it("错时序或丢失前置条件的魂印效果不保留在当前内容包中", () => {
    expect(PACK.unitsById.get("pet-4854")?.soulMark).toBeUndefined();
    expect(MARKS["sm-4854"]).toBeUndefined();

    expect(MARKS["sm-4132"]?.effects.every((effect) => effect.hook !== "onTurnEnd" && !effect.ops.some((op) => op.op === "applyDrainRider"))).toBe(true);
    expect(MARKS["sm-3870"]?.effects.every((effect) => effect.hook !== "onTurnEnd" && !effect.ops.some((op) => op.op === "damage" || op.op === "apply_status" && op.name === "petrify"))).toBe(true);
    expect(MARKS["sm-4634"]?.effects.every((effect) => effect.hook !== "onTurnEnd" && !effect.ops.some((op) => op.op === "apply_status" && op.name === "fear"))).toBe(true);
    expect(MARKS["sm-3875"]?.effects.flatMap((effect) => effect.ops).some((op) => op.op === "flat" && op.of === "lastDmgFrac")).toBe(false);
    expect(MARKS["sm-3875"]?.effects.flatMap((effect) => effect.ops).some((op) => op.op === "apply_stat_stage" && op.stat === "random")).toBe(false);
    expect(MARKS["sm-3875"]?.effects[0]).toMatchObject({ hook: "onBattleStart", ops: [{ op: "apply_status", name: "drain_atk", params: { n: 50, d: 100 } }] });
    expect(MARKS["sm-3875"]?.effects.some((effect) => effect.hook === "onTurnStart" && effect.ops.some((op) => op.op === "apply_status" && op.name === "crit_up" && JSON.stringify(op.if) === JSON.stringify({ and: [{ not: { selfStageUp: true } }, { not: { foeStageUp: true } }] })))).toBe(true);
  });
});
