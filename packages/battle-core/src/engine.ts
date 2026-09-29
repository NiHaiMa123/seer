/**
 * battle-core 引擎：synthetic-v1 的纯确定性 transition。
 * `applyTurn(state, actions, rng)` 覆盖 ORDER→…→NEXT；Host 负责 COLLECT/decision。
 * 纪律：不写 state/input（先 clone 后改副本）、fault 时整体不落盘、
 * 无 wall-clock/环境读取、全部整数运算、draw 只发生在 §6 平速组。
 */
import { DeterministicRng } from "./rng.ts";
import { type CompiledEffect, type CompiledMove, type CompiledUnit, type FrozenPack, type StatSpread, type StageStatKey } from "./loader.ts";
import { MECHANICS, deriveBaseFor, stageKeysFor } from "./mechanics/index.ts";
import { EngineFault, OTHER, type CoreAction, type CoreEvent, type CoreResult, type CoreState, type SideId } from "./types.ts";

type SideUnit = CoreState["sides"]["p1"]["unit"];
type MoveAction =
  | { kind: "move"; moveId: string }
  | { kind: "struggle" }
  | { kind: "concede" }
  | { kind: "switch"; benchIndex: number };

function fault(reason: string, msg: string): CoreResult {
  return { ok: false, fault: new EngineFault(reason, msg) };
}

/** eff = floor(base × num / den)，§4 stage 系数表 */
/**
 * 属性克制查找：chart[招式属性][守方属性键] → 倍率 ×16 定点（1.0 → 16）。
 * 守方双属性按声明序 join("") 为键（"机械地面"），查不到再试逆序（"地面机械"）；
 * 单属性/未命中 → 8（即 1.0）。双属性倍率是表中手工标定的条目，不是单属性乘积
 * （验证过：如 (0.5,1.0) 组合在不同双属性上给出 0.75/0.875/1.5 不同结果）。
 */
export function effectivenessOf(
  chart: ReadonlyMap<string, ReadonlyMap<string, number>>,
  moveType: string,
  defenderTypes: readonly string[],
): number {
  const row = chart.get(moveType);
  if (row === undefined || defenderTypes.length === 0) return 16;
  const direct = row.get(defenderTypes.join(""));
  if (direct !== undefined) return direct;
  if (defenderTypes.length === 2) return row.get(`${defenderTypes[1]}${defenderTypes[0]}`) ?? 16;
  return 16;
}

function effStat(base: number, stage: number): number {
  const [num, den] = stage >= 0 ? [2 + stage, 2] : [2, 2 - stage];
  return Math.floor((base * num) / den);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** §5/overlay：按 unit.mode 查 ruleset overlay；v1 pack 恒为 undefined。 */
function overlayOf(pack: FrozenPack, unit: SideUnit): { immuneControl?: boolean; immuneClearStages?: boolean } | undefined {
  return unit.mode === undefined ? undefined : pack.modeOverlays.get(unit.mode);
}

/** §9：合法 actionId 集 = pp>0 动作 ∪ {bench 存活者 switch} ∪ {concede}；全 0 → {struggle, concede}。 */
export function legalActions(state: CoreState, side: SideId): string[] {
  const s = state.sides[side];
  // v2 suspension：仅阵亡方可动，且只能选存活替补或认输
  if (state.suspension !== undefined && state.suspension !== null) {
    if (state.suspension.koSide !== side) return [];
    const repl = (s.bench ?? []).map((b, i) => (b.currentHp > 0 ? `act_switch-${i}` : null)).filter((x): x is string => x !== null);
    repl.push("act_concede");
    return repl;
  }
  const unit = s.unit;
  const acts = unit.moves.filter((m) => m.pp > 0).map((m) => `act_${m.moveId}`);
  const switches = (s.bench ?? []).map((b, i) => (b.currentHp > 0 ? `act_switch-${i}` : null)).filter((x): x is string => x !== null);
  acts.push(...switches);
  if (!unit.moves.some((m) => m.pp > 0)) acts.push("act_struggle");
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

/** replacement 决策的默认：bench 下标最小的存活者。 */
export function defaultReplacement(state: CoreState, side: SideId): string {
  const bench = state.sides[side].bench ?? [];
  const i = bench.findIndex((b) => b.currentHp > 0);
  return i >= 0 ? `act_switch-${i}` : "act_concede";
}

/** resolved/null → 内部动作项；非法 actionId 返回 invalid 标记。 */
function resolveAction(state: CoreState, side: SideId, action: CoreAction): MoveAction | { kind: "invalid"; actionId: string } {
  const actionId = action?.actionId ?? defaultAction(state, side);
  if (actionId === "act_struggle") return { kind: "struggle" };
  if (actionId === "act_concede") return { kind: "concede" };
  const sw = /^act_switch-(\d+)$/.exec(actionId);
  if (sw) return { kind: "switch", benchIndex: parseInt(sw[1]!, 10) };
  if (actionId.startsWith("act_")) return { kind: "move", moveId: actionId.slice(4) };
  return { kind: "invalid", actionId };
}

const mkUnit = (pack: FrozenPack, u: CompiledUnit, unitId: string, mechInit?: Record<string, unknown>): CoreState["sides"]["p1"]["unit"] => {
  // 面板推导：机制钩子接管（six-stat：种族/等级/个体/努力/性格 → 六维）；
  // 无接管 → base 即面板值（legacy v1 行为字节级不变）。
  const base = deriveBaseFor(pack, u) ?? ({ ...u.base } as StatSpread);
  // 机制加工链：各注册模块对推导面板做修饰并贡献附加状态字段（如 seals → 平面叠加+字段）。
  const mechState: Record<string, unknown> = {};
  for (const m of MECHANICS) {
    const extra = m.applyUnit?.(pack, u, mechInit?.[m.id], base);
    if (extra !== undefined) Object.assign(mechState, extra);
  }
  return {
    unitId,
    speciesId: u.id,
    base,
    currentHp: base.hp,
    stages: { atk: 0, def: 0, spd: 0, ...Object.fromEntries(stageKeysFor(pack).slice(3).map((k) => [k, 0])) },
    moves: u.moveIds.map((moveId) => {
      const m = pack.movesById.get(moveId)!;
      return { moveId, pp: m.pp, ppMax: m.pp };
    }),
    revealedMoveIds: [],
    effects: [],
    // v2 additive 字段：仅当 pack 声明时才写入（v1 hash 不变靠"不写"）
    ...(u.mode !== undefined ? { mode: u.mode } : {}),
    ...(u.revives !== undefined ? { revives: u.revives } : {}),
    ...mechState,
  };
};

export function initBattle(
  pack: FrozenPack,
  opts: {
    battleId: string;
    seedHex: string;
    p1: string;
    p2: string;
    bench?: { p1?: string[]; p2?: string[] };
    /** 机制初始化袋：mechanics.<id>.<side> = 每槽位数组（[0]=首发，[1+i]=bench[i]；
     *  元素 undefined=该槽回落 species 预设）。各 Mechanic 自校验语义。 */
    mechanics?: Record<string, { p1?: unknown[]; p2?: unknown[] }>;
  },
): CoreState {
  const side = (s: SideId, speciesId: string, benchIds: string[] | undefined): CoreState["sides"]["p1"] => {
    const requestedBench = benchIds ?? [];
    if (requestedBench.length > 0 && !pack.features.has("bench")) {
      throw new EngineFault("FEATURE_DISABLED", `bench is not enabled for ${pack.rules.rulesetId}`);
    }
    if (requestedBench.length > (pack.limits.maxBenchSize ?? 0)) {
      throw new EngineFault("BENCH_LIMIT", `bench size ${requestedBench.length} exceeds ${pack.limits.maxBenchSize ?? 0}`);
    }
    const unitCount = 1 + requestedBench.length;
    // 机制 init 切片校验：mechanics.<id>.<side> = 每槽位数组
    for (const m of MECHANICS) {
      const arr = opts.mechanics?.[m.id]?.[s];
      if (arr !== undefined) {
        if (!Array.isArray(arr)) throw new EngineFault("MECH_INIT", `mechanics.${m.id}.${s} must be a per-slot array`);
        m.checkInitSlots?.(arr, s, unitCount);
      }
    }
    /** 该方第 idx 槽位的机制初始化数据袋（mechanics.<id>[idx]；整体 undefined=全回落预设）。 */
    const slotInit = (idx: number): Record<string, unknown> | undefined => {
      const bag = opts.mechanics;
      if (bag === undefined) return undefined;
      let any = false;
      const out: Record<string, unknown> = {};
      for (const m of MECHANICS) {
        const arr = bag[m.id]?.[s];
        if (arr !== undefined) { out[m.id] = arr[idx]; any = true; }
      }
      return any ? out : undefined;
    };
    const u = pack.unitsById.get(speciesId);
    if (!u) throw new EngineFault("UNKNOWN_SPECIES", `species ${speciesId} not in pack`);
    const benchUnits = requestedBench.map((bid, i) => {
      const bu = pack.unitsById.get(bid);
      if (!bu) throw new EngineFault("UNKNOWN_SPECIES", `bench species ${bid} not in pack`);
      return mkUnit(pack, bu, `unit_${s}-b${i}`, slotInit(i + 1));
    });
    return {
      unit: mkUnit(pack, u, `unit_${s}`, slotInit(0)),
      ...(benchUnits.length > 0 ? { bench: benchUnits } : {}),
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
    sides: { p1: side("p1", opts.p1, opts.bench?.p1), p2: side("p2", opts.p2, opts.bench?.p2) },
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

  // ORDER：switch 组先于一切 move；组内 priority desc → effSpd desc → §6 平速 draw
  const isSwitch = (s: SideId) => resolved[s].kind === "switch";
  const prio = (s: SideId): number =>
    resolved[s].kind === "move"
      ? (pack.movesById.get((resolved[s] as { moveId: string }).moveId)?.priority ?? -Infinity)
      : -Infinity;
  const spdOf = (s: SideId): number => effStat(next.sides[s].unit.base.spd, next.sides[s].unit.stages.spd);
  let order: [SideId, SideId];
  if (isSwitch("p1") !== isSwitch("p2")) order = isSwitch("p1") ? ["p1", "p2"] : ["p2", "p1"];
  else if (prio("p1") !== prio("p2")) order = prio("p1") > prio("p2") ? ["p1", "p2"] : ["p2", "p1"];
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

  // 已行动集合 → suspend 时写 remaining（阵亡者行动作废，未行动者保留）
  const acted = new Set<SideId>();
  const actionIdOf = (a: MoveAction | { kind: "invalid"; actionId: string }): string =>
    a.kind === "move" ? `act_${a.moveId}`
    : a.kind === "switch" ? `act_switch-${a.benchIndex}`
    : a.kind === "struggle" ? "act_struggle"
    : a.kind === "concede" ? "act_concede"
    : a.actionId;
  const writeSuspension = (koSide: SideId) => {
    next.suspension = {
      koSide,
      remaining: {
        p1: acted.has("p1") || koSide === "p1" ? null : actionIdOf(resolved.p1),
        p2: acted.has("p2") || koSide === "p2" ? null : actionIdOf(resolved.p2),
      },
    };
    next.phase = "checkpoint";
  };

  outer: for (const side of order) {
    const unit = next.sides[side].unit;
    const act = resolved[side];
    if (unit.currentHp <= 0) { acted.add(side); continue; } // BEFORE_ACTION: KO 跳过，不耗 PP
    if (act.kind === "invalid") {
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: act.actionId } });
      acted.add(side);
      continue;
    }
    if (act.kind === "switch") {
      acted.add(side);
      if (doSwitch(next, events, side, act.benchIndex, "action")) continue;
      events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: `act_switch-${act.benchIndex}` } });
      continue;
    }
    if (act.kind === "struggle") {
      acted.add(side);
      const anyPp = unit.moves.some((m) => m.pp > 0);
      if (anyPp) {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: "act_struggle" } });
        continue;
      }
      events.push({ type: "struggle-used", detail: { side } });
      const cp1 = applyDamage(pack, next, events, side, Math.floor(unit.base.hp / 4), "struggle");
      if (cp1 === "terminal") break outer;
      if (cp1 !== "continue") { writeSuspension(cp1.suspend); break outer; }
      if (++applications > pack.limits.maxEffectApplications) {
        return fault("EFFECT_LIMIT", "maxEffectApplications exceeded");
      }
      const foe = next.sides[OTHER[side]].unit;
      if (foe.currentHp > 0) {
        // recoil 独立 HP 变更：目标存活才结算
        const recoil = Math.floor(unit.base.hp / 8);
        unit.currentHp = Math.max(0, unit.currentHp - recoil);
        events.push({ type: "damage", detail: { side, amount: recoil, hpAfter: { current: unit.currentHp, max: unit.base.hp }, recoil: true } });
        const cp2 = checkpoint(next, events);
        if (cp2 === "terminal") break outer;
        if (cp2 !== "continue") { writeSuspension(cp2.suspend); break outer; }
      }
      continue;
    }

    if (act.kind === "concede") { acted.add(side); continue; } // concede 已在排序前处理
    acted.add(side);
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

    // v2 §4.4：受控方 BEFORE_ACTION 判定失败；控制按"阻断次数"消耗（turns=n 阻断 n 次行动）
    // 例外：含 cleanse 的动作穿透控制——净化是被控方的反制手段
    const ctl = unit.effects.find((e) => e.kind.startsWith("control:"));
    const bypasses = ctl !== undefined && move.effects.some((f) => f.op === "cleanse");
    if (ctl && !bypasses) {
      events.push({ type: "action-failed", detail: { side, reason: "controlled" } });
      if (ctl.remainingTurns !== undefined) {
        ctl.remainingTurns -= 1;
        if (ctl.remainingTurns <= 0) {
          unit.effects = unit.effects.filter((e) => e !== ctl);
          events.push({ type: "effect-faded", detail: { side, name: ctl.kind } });
        }
      }
      continue;
    }

    for (const fx of move.effects) {
      if (++applications > pack.limits.maxEffectApplications) {
        return fault("EFFECT_LIMIT", `maxEffectApplications ${pack.limits.maxEffectApplications} exceeded`);
      }
      const cp = applyEffect(pack, next, events, side, unit, move, fx, rng);
      if (cp === "terminal") break outer;
      if (cp !== "continue") { writeSuspension(cp.suspend); break outer; }
    }
  }

  // TURN_END（v2 §4.4/§4.6）：剩余回合递减，归零移除并发 effect-faded。
  // v1 pack 无任何 remainingTurns 效果 → 本段对该包是字节级 no-op。
  // 挂起（replacement 待决策）时不递减、不推进 turn——由 applyReplacement 收尾。
  if (!next.terminal && next.suspension === undefined) {
    for (const s of ["p1", "p2"] as const) {
      const u = next.sides[s].unit;
      u.effects = u.effects.filter((e) => {
        if (e.remainingTurns === undefined) return true;
        if (e.kind.startsWith("control:")) return true; // 控制按阻断次数消耗，不走 TURN_END
        if (e.appliedTurn === next.turn) return true; // 本回合新施加的效果不递减
        e.remainingTurns -= 1;
        if (e.remainingTurns > 0) return true;
        events.push({ type: "effect-faded", detail: { side: s, name: e.kind } });
        return false;
      });
    }
  }

  if (!next.terminal && next.suspension === undefined) {
    if (next.turn >= pack.limits.maxTurns) {
      next.terminal = { result: "draw", reason: "turn-limit" };
      events.push({ type: "battle-end", detail: { result: "draw", reason: "turn-limit" } });
      next.phase = "end";
    } else {
      next.turn += 1;
      next.phase = "collect";
    }
  } else if (next.terminal) {
    next.phase = "end";
  }
  // 挂起态：phase 保持 writeSuspension 写入的 "checkpoint"
  return { ok: true, state: finish(next, rng), events };
}

type CpResult = "continue" | "terminal" | { suspend: SideId };

/** damage op + CHECKPOINT */
function applyDamage(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  attackerSide: SideId,
  amount: number,
  kind: "move" | "struggle",
): CpResult {
  const foe = next.sides[OTHER[attackerSide]].unit;
  foe.currentHp = Math.max(0, foe.currentHp - amount);
  events.push({ type: "damage", detail: { side: OTHER[attackerSide], amount, hpAfter: { current: foe.currentHp, max: foe.base.hp }, ...(kind === "struggle" ? { cause: "struggle" } : {}) } });
  return checkpoint(next, events);
}

/** v2 §2：active↔bench[i] 交换；合法返回 true（emit switch），非法返回 false。 */
function doSwitch(next: CoreState, events: CoreEvent[], side: SideId, benchIndex: number, via: "action" | "replacement"): boolean {
  const s = next.sides[side];
  const bench = s.bench;
  const b = bench?.[benchIndex];
  if (!b || b.currentHp <= 0) return false;
  const out = s.unit;
  bench[benchIndex] = out;
  s.unit = b;
  events.push({ type: "switch", detail: { side, outUnitId: out.unitId, inUnitId: b.unitId, via } });
  return true;
}

/** 参与 stage 增减的 stat 键集合：核心三维 + 机制贡献（six-stat 时含 spa/sdf）。 */
const stageKeys = stageKeysFor;

function applyEffect(pack: FrozenPack, next: CoreState, events: CoreEvent[], side: SideId, unit: SideUnit, move: CompiledMove, fx: CompiledEffect, rng: DeterministicRng): CpResult {
  const foe = next.sides[OTHER[side]].unit;
  const targetSide = (fx as { target?: "self" | "opponent" }).target === "opponent" ? OTHER[side] : side;
  const target = next.sides[targetSide].unit;
  switch (fx.op) {
    case "damage": {
      const kind = fx.kind ?? "standard";
      // 属性系统：standard/true（攻防公式招式）吃克制倍率 + STAB；
      // fixed/percent 是固定值语义，不受属性影响；struggle 无类型。
      const typed = kind !== "fixed" && kind !== "percent" && pack.typeChart !== undefined && move.type !== undefined;
      let dmg: number;
      let eff16: number | undefined; // ×16 定点（事件流必须全整数——canonicalJson 拒浮点）
      let stab = false;
      if (kind === "fixed") {
        dmg = fx.power;
      } else if (kind === "percent") {
        dmg = Math.floor((fx.power * foe.base.hp) / 100);
      } else {
        if (typed) {
          const foeTypes = pack.unitsById.get(foe.speciesId)?.types ?? [];
          eff16 = effectivenessOf(pack.typeChart!, move.type!, foeTypes);
          stab = (pack.unitsById.get(unit.speciesId)?.types ?? []).includes(move.type!);
        }
        // 缩放公式分派：机制钩子接管（如 six-stat 赛尔号公式）；全未接管 → legacy v1 公式。
        let out: { dmg: number; roll?: number } | undefined;
        for (const m of MECHANICS) {
          out = m.scaledDamage?.({ pack, unit, foe, move, power: fx.power, kind, eff16, stab, rng });
          if (out !== undefined) break;
        }
        if (out !== undefined) {
          dmg = out.dmg;
          if (out.roll !== undefined) {
            events.push({ type: "rng-draw", detail: { purpose: "damage_roll" }, rngDraw: { purpose: "damage_roll", value: out.roll } });
          }
        } else {
          const base = Math.floor((fx.power * effStat(unit.base.atk, unit.stages.atk)) / (2 * effStat(foe.base.def, kind === "true" ? 0 : foe.stages.def)));
          dmg = typed
            ? (eff16 === 0 ? 0 : Math.max(1, Math.floor((base * eff16!) / 16 * (stab ? pack.stabMultiplier : 1))))
            : Math.max(1, base);
        }
      }
      foe.currentHp = Math.max(0, foe.currentHp - dmg);
      events.push({
        type: "damage",
        detail: {
          side: OTHER[side],
          amount: dmg,
          hpAfter: { current: foe.currentHp, max: foe.base.hp },
          ...(kind !== "standard" ? { damageKind: kind } : {}),
          ...(eff16 !== undefined ? { eff16, stab, moveType: move.type } : {}),
          ...(move.category !== undefined ? { category: move.category } : {}),
        },
      });
      return checkpoint(next, events);
    }
    case "apply_stat_stage": {
      const t = fx.target === "opponent" ? foe : unit;
      const before = t.stages[fx.stat] ?? 0;
      const after = clamp(before + fx.delta, -6, 6);
      if (after === before) {
        events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
        return "continue";
      }
      t.stages[fx.stat] = after;
      events.push({ type: "stat-stage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, stat: fx.stat, deltaApplied: after - before, stageAfter: after } });
      return "continue";
    }
    case "heal": {
      const t = fx.target === "opponent" ? foe : unit;
      if (t.currentHp >= t.base.hp) {
        events.push({ type: "action-failed", detail: { side, reason: "hp-full" } });
        return "continue";
      }
      const amount = Math.floor((t.base.hp * fx.numerator) / fx.denominator);
      t.currentHp = Math.min(t.base.hp, t.currentHp + amount);
      events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount, hpAfter: { current: t.currentHp, max: t.base.hp } } });
      return "continue";
    }
    case "transfer_stages": {
      // §4.1 吸强：原子转移（源清零→目标加绝对值），overlay 免疫时整个 op 无效
      if (overlayOf(pack, foe)?.immuneClearStages) {
        events.push({ type: "action-failed", detail: { side, reason: "overlay_immune" } });
        return "continue";
      }
      const moved: Record<string, number> = {};
      let any = false;
      for (const stat of stageKeys(pack)) {
        if ((foe.stages[stat] ?? 0) === 0) continue;
        any = true;
        moved[stat] = Math.abs(foe.stages[stat]!);
        unit.stages[stat] = clamp((unit.stages[stat] ?? 0) + Math.abs(foe.stages[stat]!), -6, 6);
        foe.stages[stat] = 0;
      }
      if (!any) {
        events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
        return "continue";
      }
      events.push({ type: "stages-transferred", detail: { side, stages: moved } });
      return "continue";
    }
    case "clear_stages": {
      if (overlayOf(pack, target)?.immuneClearStages) {
        events.push({ type: "action-failed", detail: { side, reason: "overlay_immune" } });
        return "continue";
      }
      if (stageKeys(pack).every((s) => (target.stages[s] ?? 0) === 0)) {
        events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
        return "continue";
      }
      target.stages = Object.fromEntries(stageKeys(pack).map((s) => [s, 0])) as typeof target.stages;
      events.push({ type: "stages-cleared", detail: { side: targetSide } });
      return "continue";
    }
    case "control": {
      if (overlayOf(pack, target)?.immuneControl) {
        events.push({ type: "action-failed", detail: { side, reason: "overlay_immune" } });
        return "continue";
      }
      if (target.effects.some((e) => e.kind === "immune_control")) {
        events.push({ type: "control-immune", detail: { side: targetSide, name: fx.name } });
        return "continue";
      }
      const kind = `control:${fx.name}`;
      const existing = target.effects.find((e) => e.kind === kind);
      if (existing) {
        existing.remainingTurns = Math.max(existing.remainingTurns ?? 0, fx.turns);
        existing.appliedTurn = next.turn; // 刷新计为本回合新施加 → 本回合不减
      } else {
        target.effects.push({ kind, effectInstanceId: `efx_${targetSide}_${kind}`, remainingTurns: fx.turns, appliedTurn: next.turn });
      }
      events.push({ type: "effect-applied", detail: { side: targetSide, name: kind, turns: fx.turns } });
      return "continue";
    }
    case "cleanse": {
      const removed = target.effects.filter((e) => e.kind.startsWith("control:"));
      if (removed.length === 0) {
        events.push({ type: "action-failed", detail: { side, reason: "no-control" } });
        return "continue";
      }
      target.effects = target.effects.filter((e) => !e.kind.startsWith("control:"));
      for (const e of removed) {
        events.push({ type: "effect-faded", detail: { side: targetSide, name: e.kind } });
      }
      return "continue";
    }
    case "apply_status":
    case "apply_effect": {
      const kind = fx.op === "apply_status" ? fx.name : `tag:${fx.name}`;
      const existing = target.effects.find((e) => e.kind === kind);
      if (existing) {
        existing.remainingTurns = Math.max(existing.remainingTurns ?? 0, fx.turns);
        existing.appliedTurn = next.turn;
      } else {
        target.effects.push({ kind, effectInstanceId: `efx_${targetSide}_${kind}`, remainingTurns: fx.turns, appliedTurn: next.turn });
      }
      events.push({ type: "effect-applied", detail: { side: targetSide, name: kind, turns: fx.turns } });
      return "continue";
    }
    default:
      throw new EngineFault("UNSUPPORTED_OPERATOR", `op ${(fx as { op: string }).op} not in synthetic-v1/v2`);
  }
}

/**
 * CHECKPOINT：HP≤0 → revive → KO。
 * v2：先消耗 revive（floor(max/2) 原地复活）；仍死且有存活 bench → suspend（replacement decision）；
 * 双死 → draw；单死无 bench → KO 终局。
 */
function checkpoint(next: CoreState, events: CoreEvent[]): CpResult {
  const dead: SideId[] = [];
  for (const s of ["p1", "p2"] as const) {
    const u = next.sides[s].unit;
    if (u.currentHp > 0) continue;
    if ((u.revives ?? 0) > 0) {
      u.revives = (u.revives ?? 0) - 1;
      u.currentHp = Math.floor(u.base.hp / 2);
      events.push({ type: "revive", detail: { side: s, hpAfter: { current: u.currentHp, max: u.base.hp } } });
      continue;
    }
    dead.push(s);
  }
  if (dead.length === 0) return "continue";
  if (dead.length === 2) {
    for (const s of dead) events.push({ type: "ko", detail: { side: s } });
    next.terminal = { result: "draw", reason: "ko" };
    events.push({ type: "battle-end", detail: { result: "draw", reason: "ko" } });
    next.phase = "end";
    return "terminal";
  }
  const s = dead[0]!;
  events.push({ type: "ko", detail: { side: s } });
  if ((next.sides[s].bench ?? []).some((b) => b.currentHp > 0)) {
    return { suspend: s }; // bench 有存活者 → replacement decision
  }
  const result = OTHER[s];
  next.terminal = { result, reason: "ko" };
  events.push({ type: "battle-end", detail: { result, reason: "ko" } });
  next.phase = "end";
  return "terminal";
}

/**
 * v2：replacement decision 结算——KO 方提交 act_switch-<i>（或 concede）；
 * 执行换入后继续悬挂中保留的剩余行动，随后 TURN_END → 下一 collect。
 */
export function applyReplacement(
  pack: FrozenPack,
  state: CoreState,
  actions: { p1: CoreAction | null; p2: CoreAction | null },
): CoreResult {
  if (state.terminal !== null) return fault("TERMINAL_STATE", "replacement on terminal battle");
  const susp = state.suspension;
  if (!susp) return fault("BAD_PHASE", "applyReplacement requires suspended battle");

  const rng = new DeterministicRng(state.rng.seedHex);
  for (let i = 0; i < state.rng.drawCounter; i++) rng.next("replay");
  try {
    const events: CoreEvent[] = [];
    const next = structuredClone(state) as CoreState;
    next.revision += 1;
    let applications = 0;

    const koSide = susp.koSide;
    const sub = actions[koSide];
    const choice = sub?.actionId ?? defaultReplacement(next, koSide);

    if (choice === "act_concede") {
      const result = OTHER[koSide];
      events.push({ type: "battle-end", detail: { result, reason: "concede" } });
      next.terminal = { result, reason: "concede" };
      next.phase = "end";
      delete next.suspension;
      return { ok: true, state: finish(next, rng), events };
    }
    const m = /^act_switch-(\d+)$/.exec(choice);
    const benchIndex = m ? parseInt(m[1]!, 10) : -1;
    if (benchIndex < 0 || !doSwitch(next, events, koSide, benchIndex, "replacement")) {
      return fault("INVALID_ACTION", `replacement action ${choice} is not a live bench switch`);
    }
    delete next.suspension;

    // 继续剩余行动（若存）
    const stopAtCheckpoint = (cp: CpResult): boolean => {
      if (cp === "continue") return false;
      if (cp !== "terminal") {
        // 续跑中再次触发有替补的 KO——重新挂起（continuation 为空）
        next.suspension = { koSide: cp.suspend, remaining: { p1: null, p2: null } };
        next.phase = "checkpoint";
      }
      return true;
    };
    for (const side of ["p1", "p2"] as const) {
      const rem = susp.remaining[side];
      if (rem === null) continue;
      const act = resolveAction(next, side, { actionId: rem, origin: "player", idempotencyKey: "resume" });
      const unit = next.sides[side].unit;
      if (unit.currentHp <= 0) continue;
      if (act.kind === "invalid") {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: act.actionId } });
        continue;
      }
      if (act.kind === "concede") {
        const result = OTHER[side];
        events.push({ type: "battle-end", detail: { result, reason: "concede" } });
        next.terminal = { result, reason: "concede" };
        next.phase = "end";
        break;
      }
      if (act.kind === "switch") {
        if (!doSwitch(next, events, side, act.benchIndex, "action")) {
          events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: rem } });
        }
        continue;
      }
      if (act.kind === "struggle") {
        if (unit.moves.some((mv) => mv.pp > 0)) {
          events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: rem } });
          continue;
        }
        events.push({ type: "struggle-used", detail: { side } });
        if (stopAtCheckpoint(applyDamage(pack, next, events, side, Math.floor(unit.base.hp / 4), "struggle"))) break;
        if (++applications > pack.limits.maxEffectApplications) return fault("EFFECT_LIMIT", "maxEffectApplications exceeded");
        if (next.sides[OTHER[side]].unit.currentHp > 0) {
          const recoil = Math.floor(unit.base.hp / 8);
          unit.currentHp = Math.max(0, unit.currentHp - recoil);
          events.push({ type: "damage", detail: { side, amount: recoil, hpAfter: { current: unit.currentHp, max: unit.base.hp }, recoil: true } });
          if (stopAtCheckpoint(checkpoint(next, events))) break;
        }
        continue;
      }
      const move = pack.movesById.get(act.moveId);
      const slot = unit.moves.find((mv) => mv.moveId === act.moveId);
      if (!move || !slot || slot.pp <= 0) {
        events.push({ type: "action-failed", detail: { side, reason: "invalid-action", actionId: rem } });
        continue;
      }
      events.push({ type: "action-declared", detail: { side, actionId: rem, moveId: act.moveId } });
      if (!unit.revealedMoveIds.includes(act.moveId)) unit.revealedMoveIds.push(act.moveId);
      slot.pp -= 1;
      events.push({ type: "pp-spent", detail: { side, moveId: act.moveId, ppAfter: slot.pp } });
      const ctl = unit.effects.find((e) => e.kind.startsWith("control:"));
      const bypasses = ctl !== undefined && move.effects.some((f) => f.op === "cleanse");
      if (ctl && !bypasses) {
        events.push({ type: "action-failed", detail: { side, reason: "controlled" } });
        if (ctl.remainingTurns !== undefined) {
          ctl.remainingTurns -= 1;
          if (ctl.remainingTurns <= 0) {
            unit.effects = unit.effects.filter((e) => e !== ctl);
            events.push({ type: "effect-faded", detail: { side, name: ctl.kind } });
          }
        }
        continue;
      }
      let halted = false;
      for (const fx of move.effects) {
        if (++applications > pack.limits.maxEffectApplications) {
          return fault("EFFECT_LIMIT", `maxEffectApplications ${pack.limits.maxEffectApplications} exceeded`);
        }
        if (stopAtCheckpoint(applyEffect(pack, next, events, side, unit, move, fx, rng))) {
          halted = true;
          break;
        }
      }
      if (halted || next.terminal) break;
    }

    if (!next.terminal && next.suspension === undefined) {
      // TURN_END
      for (const s of ["p1", "p2"] as const) {
        const u = next.sides[s].unit;
        u.effects = u.effects.filter((e) => {
          if (e.remainingTurns === undefined) return true;
          if (e.kind.startsWith("control:")) return true;
          if (e.appliedTurn === next.turn) return true;
          e.remainingTurns -= 1;
          if (e.remainingTurns > 0) return true;
          events.push({ type: "effect-faded", detail: { side: s, name: e.kind } });
          return false;
        });
      }
      if (next.turn >= pack.limits.maxTurns) {
        next.terminal = { result: "draw", reason: "turn-limit" };
        events.push({ type: "battle-end", detail: { result: "draw", reason: "turn-limit" } });
        next.phase = "end";
      } else {
        next.turn += 1;
        next.phase = "collect";
      }
    }
    return { ok: true, state: finish(next, rng), events };
  } catch (e) {
    if (e instanceof EngineFault) return { ok: false, fault: e };
    throw e;
  }
}

function finish(next: CoreState, rng: DeterministicRng): CoreState {
  next.rng = { ...next.rng, drawCounter: rng.drawCounter };
  return next;
}
