/**
 * battle-core 引擎：synthetic-v1 的纯确定性 transition。
 * `applyTurn(state, actions, rng)` 覆盖 ORDER→…→NEXT；Host 负责 COLLECT/decision。
 * 纪律：不写 state/input（先 clone 后改副本）、fault 时整体不落盘、
 * 无 wall-clock/环境读取、全部整数运算、draw 只发生在 §6 平速组。
 */
import { DeterministicRng } from "./rng.ts";
import type { CompiledEffect, CompiledMove, FrozenPack } from "./loader.ts";
import { EngineFault, OTHER, type CoreAction, type CoreEvent, type CoreResult, type CoreState, type SideId } from "./types.ts";

type SideUnit = CoreState["sides"]["p1"]["unit"];
type MoveAction = { kind: "move"; moveId: string } | { kind: "struggle" } | { kind: "concede" };

function fault(reason: string, msg: string): CoreResult {
  return { ok: false, fault: new EngineFault(reason, msg) };
}

/** eff = floor(base × num / den)，§4 stage 系数表 */
function effStat(base: number, stage: number): number {
  const [num, den] = stage >= 0 ? [2 + stage, 2] : [2, 2 - stage];
  return Math.floor((base * num) / den);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** §9：合法 actionId 集 = pp>0 动作 ∪ {concede}；全 0 → {struggle, concede}。 */
export function legalActions(state: CoreState, side: SideId): string[] {
  const unit = state.sides[side].unit;
  const acts = unit.moves.filter((m) => m.pp > 0).map((m) => `act_${m.moveId}`);
  if (acts.length === 0) acts.push("act_struggle");
  acts.push("act_concede");
  return acts;
}

/**
 * §9：缺省/超时的确定默认 = 字典序最小的可行动作。
 * 注意：concede 不参与默认选择（超时认输不是默认策略的本意；
 * 规范括注明确 "v1 即还剩 PP 的第一个动作，否则 struggle"）。
 */
export function defaultAction(state: CoreState, side: SideId): string {
  const unit = state.sides[side].unit;
  const moves = unit.moves.filter((m) => m.pp > 0).map((m) => `act_${m.moveId}`).sort();
  return moves[0] ?? "act_struggle";
}

/** resolved/null → 内部动作项；非法 actionId 返回 invalid 标记。 */
function resolveAction(state: CoreState, side: SideId, action: CoreAction): MoveAction | { kind: "invalid"; actionId: string } {
  const actionId = action?.actionId ?? defaultAction(state, side);
  if (actionId === "act_struggle") return { kind: "struggle" };
  if (actionId === "act_concede") return { kind: "concede" };
  if (actionId.startsWith("act_")) return { kind: "move", moveId: actionId.slice(4) };
  return { kind: "invalid", actionId };
}

export function initBattle(
  pack: FrozenPack,
  opts: { battleId: string; seedHex: string; p1: string; p2: string },
): CoreState {
  const side = (s: SideId, speciesId: string): CoreState["sides"]["p1"] => {
    const u = pack.unitsById.get(speciesId);
    if (!u) throw new EngineFault("UNKNOWN_SPECIES", `species ${speciesId} not in pack`);
    return {
      unit: {
        unitId: `unit_${s}`,
        speciesId,
        base: { ...u.base },
        currentHp: u.base.hp,
        stages: { atk: 0, def: 0, spd: 0 },
        moves: u.moveIds.map((moveId) => {
          const m = pack.movesById.get(moveId)!;
          return { moveId, pp: m.pp, ppMax: m.pp };
        }),
        revealedMoveIds: [],
        effects: [],
      },
    };
  };
  return {
    schemaVersion: 1,
    battleId: opts.battleId,
    rules: pack.rules,
    revision: 0,
    turn: 1,
    phase: "collect",
    rng: { algorithmId: "xoshiro128**", seedHex: opts.seedHex, drawCounter: 0 },
    sides: { p1: side("p1", opts.p1), p2: side("p2", opts.p2) },
    speedTiebreak: null,
    terminal: null,
  };
}

/**
 * 单回合 transition：inputs 为双方已 resolved 的 actionId（null→§9 默认）。
 * rng 实例以 state.rng(seedHex,drawCounter) 重建推进，写回 drawCounter。
 */
export function applyTurn(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction; p2: CoreAction },
): CoreResult {
  if (state.terminal !== null) return fault("TERMINAL_STATE", "transition on terminal battle");
  if (state.phase !== "collect") return fault("BAD_PHASE", `applyTurn requires collect, got ${state.phase}`);

  const rng = new DeterministicRng(state.rng.seedHex);
  for (let i = 0; i < state.rng.drawCounter; i++) rng.next("replay");
  try {
    return applyTurnInner(pack, state, actions, rng);
  } catch (e) {
    // EngineFault → Result；非 EngineFault 是引擎 bug，继续抛
    if (e instanceof EngineFault) return { ok: false, fault: e };
    throw e;
  }
}

function applyTurnInner(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction; p2: CoreAction },
  rng: DeterministicRng,
): CoreResult {
  const events: CoreEvent[] = [];
  const next = structuredClone(state) as CoreState;
  next.revision += 1;
  let applications = 0;

  const resolved: Record<SideId, MoveAction | { kind: "invalid"; actionId: string }> = {
    p1: resolveAction(next, "p1", actions.p1),
    p2: resolveAction(next, "p2", actions.p2),
  };

  // concede 立即判负：在排序前处理，不消耗回合动作
  const conceders = (["p1", "p2"] as const).filter((s) => resolved[s].kind === "concede");
  if (conceders.length > 0) {
    const result = conceders.length === 2 ? "draw" : OTHER[conceders[0]!];
    events.push({ type: "battle-end", detail: { result, reason: "concede" } });
    next.terminal = { result, reason: "concede" };
    next.phase = "end";
    return { ok: true, state: finish(next, rng), events };
  }

  // ORDER：priority desc → effSpd desc → §6 平速 draw
  const prio = (s: SideId): number =>
    resolved[s].kind === "move"
      ? (pack.movesById.get((resolved[s] as { moveId: string }).moveId)?.priority ?? -Infinity)
      : -Infinity;
  const spdOf = (s: SideId): number => effStat(next.sides[s].unit.base.spd, next.sides[s].unit.stages.spd);
  let order: [SideId, SideId];
  if (prio("p1") !== prio("p2")) order = prio("p1") > prio("p2") ? ["p1", "p2"] : ["p2", "p1"];
  else if (spdOf("p1") !== spdOf("p2")) order = spdOf("p1") > spdOf("p2") ? ["p1", "p2"] : ["p2", "p1"];
  else if (next.speedTiebreak !== null) {
    // §6：每局至多一次平速判定，memoize 后复用
    order = [next.speedTiebreak, OTHER[next.speedTiebreak]];
  } else {
    const u = rng.next("order_tiebreak");
    events.push({ type: "rng-draw", detail: { purpose: "order_tiebreak" }, rngDraw: { purpose: "order_tiebreak", value: u } });
    const winner: SideId = u < 0x80000000 ? "p1" : "p2";
    next.speedTiebreak = winner;
    order = [winner, OTHER[winner]];
  }

  outer: for (const side of order) {
    const unit = next.sides[side].unit;
    const act = resolved[side];
    if (unit.currentHp <= 0) continue; // BEFORE_ACTION: KO 跳过，不耗 PP
    if (act.kind === "invalid") {
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: act.actionId } });
      continue;
    }
    if (act.kind === "struggle") {
      const anyPp = unit.moves.some((m) => m.pp > 0);
      if (anyPp) {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: "act_struggle" } });
        continue;
      }
      events.push({ type: "struggle-used", detail: { side } });
      if (applyDamage(pack, next, events, side, Math.floor(unit.base.hp / 4), "struggle")) break outer;
      if (++applications > pack.limits.maxEffectApplications) {
        return fault("EFFECT_LIMIT", "maxEffectApplications exceeded");
      }
      const foe = next.sides[OTHER[side]].unit;
      if (foe.currentHp > 0) {
        // recoil 独立 HP 变更：目标存活才结算
        const recoil = Math.floor(unit.base.hp / 8);
        unit.currentHp = Math.max(0, unit.currentHp - recoil);
        events.push({ type: "damage", detail: { side, amount: recoil, hpAfter: { current: unit.currentHp, max: unit.base.hp }, recoil: true } });
        if (checkpoint(next, events)) break outer;
      }
      continue;
    }

    if (act.kind === "concede") continue; // concede 已在排序前处理
    const moveId = act.moveId;
    const move: CompiledMove | undefined = pack.movesById.get(moveId);
    const slot = unit.moves.find((m) => m.moveId === moveId);
    if (!move || !slot || slot.pp <= 0) {
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: `act_${moveId}` } });
      continue;
    }
    events.push({ type: "action-declared", detail: { side, actionId: `act_${moveId}`, moveId } });
    // 公开揭示：该 moveId 对对手可见（revealedMoveIds 是 transition 的确定性产物）
    if (!unit.revealedMoveIds.includes(moveId)) unit.revealedMoveIds.push(moveId);
    slot.pp -= 1; // BEFORE_ACTION: 合法动作扣 PP，失败不退还
    events.push({ type: "pp-spent", detail: { side, moveId, ppAfter: slot.pp } });

    for (const fx of move.effects) {
      if (++applications > pack.limits.maxEffectApplications) {
        return fault("EFFECT_LIMIT", `maxEffectApplications ${pack.limits.maxEffectApplications} exceeded`);
      }
      if (applyEffect(next, events, side, unit, fx)) break outer; // CHECKPOINT 触发终局
    }
  }

  if (!next.terminal) {
    if (next.turn >= pack.limits.maxTurns) {
      next.terminal = { result: "draw", reason: "turn-limit" };
      events.push({ type: "battle-end", detail: { result: "draw", reason: "turn-limit" } });
      next.phase = "end";
    } else {
      next.turn += 1;
      next.phase = "collect";
    }
  } else {
    next.phase = "end";
  }
  return { ok: true, state: finish(next, rng), events };
}

/** damage op + CHECKPOINT；返回 true = 终局已判。 */
function applyDamage(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  attackerSide: SideId,
  amount: number,
  kind: "move" | "struggle",
): boolean {
  const foe = next.sides[OTHER[attackerSide]].unit;
  foe.currentHp = Math.max(0, foe.currentHp - amount);
  events.push({ type: "damage", detail: { side: OTHER[attackerSide], amount, hpAfter: { current: foe.currentHp, max: foe.base.hp }, ...(kind === "struggle" ? { cause: "struggle" } : {}) } });
  return checkpoint(next, events);
}

function applyEffect(next: CoreState, events: CoreEvent[], side: SideId, unit: SideUnit, fx: CompiledEffect): boolean {
  switch (fx.op) {
    case "damage": {
      const me = unit;
      const foe = next.sides[OTHER[side]].unit;
      const dmg = Math.max(1, Math.floor((fx.power * effStat(me.base.atk, me.stages.atk)) / (2 * effStat(foe.base.def, foe.stages.def))));
      foe.currentHp = Math.max(0, foe.currentHp - dmg);
      events.push({ type: "damage", detail: { side: OTHER[side], amount: dmg, hpAfter: { current: foe.currentHp, max: foe.base.hp } } });
      return checkpoint(next, events);
    }
    case "apply_stat_stage": {
      const before = unit.stages[fx.stat];
      const after = clamp(before + fx.delta, -6, 6);
      if (after === before) {
        events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
        return false;
      }
      unit.stages[fx.stat] = after;
      events.push({ type: "stat-stage", detail: { side, stat: fx.stat, deltaApplied: after - before, stageAfter: after } });
      return false;
    }
    case "heal": {
      if (unit.currentHp >= unit.base.hp) {
        events.push({ type: "action-failed", detail: { side, reason: "hp-full" } });
        return false;
      }
      const amount = Math.floor((unit.base.hp * fx.numerator) / fx.denominator);
      unit.currentHp = Math.min(unit.base.hp, unit.currentHp + amount);
      events.push({ type: "heal", detail: { side, amount, hpAfter: { current: unit.currentHp, max: unit.base.hp } } });
      return false;
    }
    default:
      throw new EngineFault("UNSUPPORTED_OPERATOR", `op ${(fx as { op: string }).op} not in synthetic-v1`);
  }
}

/** CHECKPOINT：HP≤0 → KO → 终局。返回 true 终止本回合后续行动。 */
function checkpoint(next: CoreState, events: CoreEvent[]): boolean {
  for (const s of ["p1", "p2"] as const) {
    if (next.sides[s].unit.currentHp <= 0 && !next.terminal) {
      events.push({ type: "ko", detail: { side: s } });
      const result = OTHER[s];
      next.terminal = { result, reason: "ko" };
      events.push({ type: "battle-end", detail: { result, reason: "ko" } });
      return true;
    }
  }
  return false;
}

function finish(next: CoreState, rng: DeterministicRng): CoreState {
  next.rng = { ...next.rng, drawCounter: rng.drawCounter };
  return next;
}
