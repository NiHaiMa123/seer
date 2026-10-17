/**
 * ops/shared.ts —— op 处理器共享的判定工具。
 * checkpoint/overlay/倍率/目标解析/engine 复用段（runTurnEnd hurt、struggle 路径同样引用）。
 */
import type { CompiledEffect, CompiledMove, FrozenPack } from "../loader.ts";
import type { DeterministicRng } from "../rng.ts";
import { effectMul, effectDefOf, mustMissOn, missChanceEntries, mustHitOn, endureOn, prioImmuneOn, hpCapOf, isMod } from "./effects.ts";
import { MECHANICS } from "../mechanics/index.ts";
import type { TurnEndCtx, UnitState } from "../mechanics/types.ts";
import { OTHER, type CoreEvent, type CoreState, type SideId } from "../types.ts";
import type { CpResult } from "./types.ts";
// applyOp/fireReactive 仅在函数体内调用——shared↔index 构成循环时依赖 ESM 函数声明提升
import { applyOp, fireReactive } from "./index.ts";

/** eff = floor(base × num / den)，§4 stage 系数表（五维通用；命中维度用独立表，见 accuracy）。 */
export function effStat(base: number, stage: number): number {
  const [num, den] = stage >= 0 ? [2 + stage, 2] : [2, 2 - stage];
  return Math.floor((base * num) / den);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** §5/overlay：按 unit.mode 查 ruleset overlay；v1 pack 恒为 undefined。 */
export function overlayOf(pack: FrozenPack, unit: UnitState): { immuneControl?: boolean; immuneClearStages?: boolean } | undefined {
  return unit.mode === undefined ? undefined : pack.modeOverlays.get(unit.mode);
}

/**
 * 命中等级倍率（分子/分母整数对，拒绝浮点）：
 * 正级 ×(1+0.5n)；负级为官方削弱后的固定表 -1..-6 = 17/14/11/9/7/5 ÷20。
 * （4399 命中调整公告 + biligame 对战机制 + PVE 百科三源一致。）
 */
const ACC_NEG_NUM = [17, 14, 11, 9, 7, 5] as const;
export const accMulNumDen = (stage: number): readonly [number, number] =>
  stage >= 0 ? [2 + stage, 2] : [ACC_NEG_NUM[Math.min(6, -stage) - 1] ?? 5, 20];

/**
 * RESOLVE_HIT：move.accuracy 缺失或 "always" → 不判定（旧包恒中、零 draw）。
 * 数值命中：drawBelow(100·den) < base·num 精确整数比较；base·num ≥ 100·den 时必然命中不耗 draw。
 * MISS → 公开 missed 事件，整招效果跳过（PP 已扣）。
 */
export function resolveHit(
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
  unit: UnitState,
  foe: UnitState,
  move: CompiledMove,
): boolean {
  const acc = move.accuracy;
  if (acc === undefined || acc === "always") return true;
  // 攻击方必定命中窗口（must_hit timed 效果 / sure_hit 类别必中 flag）：穿透一切闪避判定
  const hitCat = move.category === "special" ? 3 : move.category === "physical" ? 2 : 1;
  if (mustHitOn(unit, hitCat)) return true;
  // 防守方必定闪避窗口（must_miss/must_miss_phys/must_miss_spec timed 效果）
  if (mustMissOn(foe, move.category)) {
    events.push({ type: "missed", detail: { side, moveId: move.id } });
    return false;
  }
  // 先制免疫窗口（prio_immune flag："免疫对手的先手攻击技能"——priority>0 的攻击招式 MISS）
  if (prioImmuneOn(foe) && (move.priority ?? 0) > 0) {
    events.push({ type: "missed", detail: { side, moveId: move.id } });
    return false;
  }
  // 概率闪避窗口（"每回合N%闪避对手攻击"——逐条判定，一条过即 miss；params.count=次数窗逐次消耗）
  for (const e of missChanceEntries(foe, unit, hitCat)) {
    const hitRes = rng.drawBelow(100, "dodge_chance") < (e.params?.pct ?? 0);
    if (e.params?.count !== undefined) {
      e.params.count -= 1;
      if (e.params.count <= 0) {
        foe.effects = foe.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side: OTHER[side], name: e.label ?? e.kind } });
      }
    }
    if (hitRes) {
      events.push({ type: "missed", detail: { side, moveId: move.id } });
      return false;
    }
  }
  const stage = Math.max(-6, Math.min(6, unit.stages.acc ?? 0));
  let [n, d] = accMulNumDen(stage);
  // 失明类 accMul：状态 flag 表乘进命中修正
  const [sn, sd] = effectMul(unit, "accMul");
  n *= sn; d *= sd;
  const num = acc * n;
  const den = 100 * d;
  if (num >= den) return true;
  if (num <= 0 || rng.drawBelow(den, "hit_check") >= num) {
    events.push({ type: "missed", detail: { side, moveId: move.id } });
    return false;
  }
  return true;
}

/** op 的实际作用侧：transfer_stages 恒为对手；damage 默认对手（target:"self"=自残）；其余看 fx.target（缺省 self）。 */
export const targetSideOf = (side: SideId, fx: CompiledEffect): SideId => {
  if (fx.op === "transfer_stages") return OTHER[side];
  const t = (fx as { target?: "self" | "opponent" }).target;
  if (t === "self") return side;
  if (t === "opponent") return OTHER[side];
  return fx.op === "damage" ? OTHER[side] : side;
};

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

/**
 * 机制生命周期钩子共享上下文工厂（onTurnStart/onKO/onSwitchOut/onMoveUsed/onEntry/onDamaged/onTurnEnd）。
 * hurt 通道：扣血 + damage 事件 + checkpoint，结果写回 ctx.outcome（terminal 或 suspend 侧）。
 */
export function mkHookCtx(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
): TurnEndCtx {
  const ctx: TurnEndCtx = {
    pack,
    next,
    events,
    side,
    rng,
    outcome: undefined,
    hurt: (target: SideId, amount: number, cause: string): void => {
      const t = next.sides[target].unit;
      t.currentHp = Math.max(0, t.currentHp - amount);
      events.push({
        type: "damage",
        detail: {
          side: target,
          amount,
          hpAfter: { current: t.currentHp, max: t.base.hp },
          damageKind: "fixed",
          cause,
        },
      });
      const cp = checkpoint(pack, next, events, rng);
      if (cp === "terminal") ctx.outcome = "terminal";
      else if (cp !== "continue") ctx.outcome = cp.suspend;
    },
  };
  return ctx;
}

/** react payload 在无招式上下文（换入/回合末触发）时占位的最小 move 信封。 */
const REACT_STUB_MOVE = { id: "__react__" } as unknown as CompiledMove;

/**
 * 换入结算共享段：新上场单位的完整登场生命周期——
 * onEntry 钩子 → nextInFx 待决效果 → 留守方 react9（"对手换上精灵则X"）。
 * doSwitch / force_switch / 续跑换入全部走此路径，中断语义（CpResult）向上传播。
 */
export function entrySettle(
  pack: FrozenPack,
  next: CoreState,
  events: CoreEvent[],
  rng: DeterministicRng,
  side: SideId,
): CpResult {
  const s = next.sides[side];
  const entryCtx = mkHookCtx(pack, next, events, rng, side);
  for (const m of MECHANICS) m.onEntry?.(entryCtx);
  if (entryCtx.outcome === "terminal") return "terminal";
  if (entryCtx.outcome !== undefined) return { suspend: entryCtx.outcome };
  // 下只出场精灵效果（"对手下只出场精灵N回合无法使用属性技能"）：登场即结算，target 已改写为 self
  const pending = s.nextInFx;
  if (pending !== undefined && pending.length > 0) {
    s.nextInFx = [];
    for (const q of pending) {
      const mv = pack.movesById.get(q.moveId);
      if (mv === undefined) continue;
      const cp = applyOp({ pack, next, events, side, unit: s.unit, move: mv, rng, order: "first" }, q.fx as unknown as CompiledEffect);
      if (cp !== "continue") return cp;
    }
  }
  // 对手换入触发（react trigger 9："对手主动切换精灵则登场精灵X"——留守方持有窗口，payload 的 opponent=新登场）
  const stayer = next.sides[OTHER[side]].unit;
  if (stayer.currentHp > 0) {
    const cp = fireReactive({ pack, next, events, side: OTHER[side], unit: stayer, move: REACT_STUB_MOVE, rng, order: "first" }, stayer, 9, {});
    if (cp !== "continue") return cp;
  }
  return "continue";
}

/** KO 观察去重：同一 transition 的同一倒下侧只向机制派发一次（onKO 钩子产伤再致死 → 内层 checkpoint 不重复通知）。 */
const koNotified = new WeakMap<CoreState, Set<SideId>>();

/**
 * CHECKPOINT：HP≤0 → revive → KO。
 * v2：先消耗 revive（floor(max/2) 原地复活）；仍死且有存活 bench → suspend（replacement decision）；
 * 双死 → draw；单死无 bench → KO 终局。ko 事件后派发机制 onKO 钩子（魂印"击败对手/自身倒下"族）。
 */
export function checkpoint(pack: FrozenPack, next: CoreState, events: CoreEvent[], rng: DeterministicRng): CpResult {
  // 终局已写 → 不再重判（同 transition 内后续死亡不得翻转已定结果）；
  // 但迟到死亡仍补 ko 播报——否则尸体在终局态里没有任何 KO 见证事件
  if (next.terminal !== null) {
    for (const s of ["p1", "p2"] as const) {
      if (next.sides[s].unit.currentHp <= 0
        && !events.some((e) => e.type === "ko" && e.detail.side === s)) {
        events.push({ type: "ko", detail: { side: s } });
      }
    }
    return "terminal";
  }
  const dead: SideId[] = [];
  for (const s of ["p1", "p2"] as const) {
    const u = next.sides[s].unit;
    if (u.currentHp > 0) continue;
    // 致命判定钩子（魂印 endure 等）：先于 revive——保留1血且回卷优先于复活消耗。
    let endured = false;
    for (const m of MECHANICS) {
      const r = m.onFatalDamage?.({ pack, unit: u, rng, foe: next.sides[OTHER[s]].unit });
      if (r !== undefined) {
        u.currentHp = r.hp;
        events.push({ type: r.event.type as CoreEvent["type"], detail: { side: s, ...r.event.detail } });
        endured = true;
        break;
      }
    }
    if (endured) continue;
    // endure flag（"受到致死攻击时余下N点体力"）：保留 params.hp（缺省1）并消耗全部 endure 效果
    if (endureOn(u)) {
      const hp = u.effects.find((e) => isMod(e, "endure"))?.params?.hp ?? 1;
      u.effects = u.effects.filter((e) => !isMod(e, "endure"));
      u.currentHp = Math.max(1, Math.min(hp, hpCapOf(u)));
      events.push({ type: "effect-faded", detail: { side: s, name: "endure" } });
      continue;
    }
    // revive_fx 计时窗（"若本回合自身死亡则立刻恢复自身所有体力"）：倒下即消耗，params.pct 复活血量%
    const rv = u.effects.find((e) => isMod(e, "reviveFx"));
    if (rv !== undefined) {
      u.effects = u.effects.filter((e) => e !== rv);
      const pct = rv.params?.pct ?? 50;
      u.currentHp = Math.max(1, Math.min(hpCapOf(u), Math.floor((u.base.hp * pct) / 100)));
      events.push({ type: "revive", detail: { side: s, hpAfter: { current: u.currentHp, max: u.base.hp } } });
      events.push({ type: "effect-faded", detail: { side: s, name: "revive_fx" } });
      continue;
    }
    if ((u.revives ?? 0) > 0) {
      u.revives = (u.revives ?? 0) - 1;
      // 复活血量同样封顶到当前生效上限（max_hp_down 压低后不得复活到 cap 以上）
      u.currentHp = Math.max(1, Math.min(hpCapOf(u), Math.floor(u.base.hp / 2)));
      events.push({ type: "revive", detail: { side: s, hpAfter: { current: u.currentHp, max: u.base.hp } } });
      continue;
    }
    dead.push(s);
  }
  if (dead.length === 0) return "continue";
  if (dead.length === 2) {
    const [a, b] = dead as [SideId, SideId];
    const benchAlive = (s: SideId): boolean => (next.sides[s].bench ?? []).some((x) => x.currentHp > 0 && x.banished !== true);
    if (!benchAlive(a) && !benchAlive(b)) {
      for (const s of dead) events.push({ type: "ko", detail: { side: s } });
      next.terminal = { result: "draw", reason: "ko" };
      events.push({ type: "battle-end", detail: { result: "draw", reason: "ko" } });
      next.phase = "end";
      return "terminal";
    }
    // 有替补的双死不是平局：逐侧完成 KO 仪式（ko 事件按"已播报"去重、onKO 按
    // koNotified 去重、倒下印记清空——与单侧 KO 同口径），随后按替补定挂起/胜负。
    // 挂起只能挂一侧；另一侧尸体留场，由 applyReplacement 换入后的接续判定处理。
    const notified = koNotified.get(next) ?? new Set<SideId>();
    koNotified.set(next, notified);
    for (const s of dead) {
      if (!events.some((e) => e.type === "ko" && e.detail.side === s)) {
        events.push({ type: "ko", detail: { side: s } });
      }
      if (!notified.has(s)) {
        notified.add(s);
        for (const obs of [s, OTHER[s]] as const) {
          const u = next.sides[obs].unit;
          if (u.currentHp <= 0 && obs !== s) continue;
          const ctx: TurnEndCtx & { deadSide: SideId } = {
            ...mkHookCtx(pack, next, events, rng, obs),
            deadSide: s,
          };
          for (const m of MECHANICS) m.onKO?.(ctx);
          if (ctx.outcome === "terminal" || next.terminal !== null) return "terminal";
        }
      }
      const corpse = next.sides[s].unit;
      corpse.effects = corpse.effects.filter((e) => !e.kind.startsWith("mark:"));
      delete corpse.moveMarks;
    }
    if (benchAlive(a) && benchAlive(b)) return { suspend: a };
    // 仅一方有替补：另一方已无人可上 → 有替补方胜
    const winner = benchAlive(a) ? a : b;
    next.terminal = { result: winner, reason: "ko" };
    events.push({ type: "battle-end", detail: { result: winner, reason: "ko" } });
    next.phase = "end";
    return "terminal";
  }
  const s = dead[0]!;
  events.push({ type: "ko", detail: { side: s } });
  // 机制 KO 观察钩子：死方与对手方各派发一次。钩子可产伤再致死（嵌套 checkpoint），
  // koNotified 保证同侧不重复通知；内层 terminal 直接传染返回。
  {
    const notified = koNotified.get(next) ?? new Set<SideId>();
    koNotified.set(next, notified);
    if (!notified.has(s)) {
      notified.add(s);
      for (const obs of [s, OTHER[s]] as const) {
        const u = next.sides[obs].unit;
        if (u.currentHp <= 0 && obs !== s) continue;
        const ctx: TurnEndCtx & { deadSide: SideId } = {
          ...mkHookCtx(pack, next, events, rng, obs),
          deadSide: s,
        };
        for (const m of MECHANICS) m.onKO?.(ctx);
        if (ctx.outcome === "terminal" || next.terminal !== null) return "terminal";
        if (ctx.outcome !== undefined) {
          // 内层 suspend（钩子 KO 了另一侧且其有替补）：外层侧仍优先——返回外层 suspend，
          // 内层倒侧保持 HP≤0，由 applyReplacement 之后的 checkpoint 接续处理。
          if ((next.sides[s].bench ?? []).some((b) => b.currentHp > 0 && b.banished !== true)) return { suspend: s };
          return { suspend: ctx.outcome };
        }
      }
    }
    // 印记随倒下清空（"持续到对手死亡"/"死亡后移除"）：放在 onKO 派发后——观察钩子仍能读到死前层数。
    const corpse = next.sides[s].unit;
    corpse.effects = corpse.effects.filter((e) => !e.kind.startsWith("mark:"));
    delete corpse.moveMarks;
  }
  if ((next.sides[s].bench ?? []).some((b) => b.currentHp > 0 && b.banished !== true)) {
    return { suspend: s }; // bench 有存活者 → replacement decision
  }
  const result = OTHER[s];
  next.terminal = { result, reason: "ko" };
  events.push({ type: "battle-end", detail: { result, reason: "ko" } });
  next.phase = "end";
  return "terminal";
}
