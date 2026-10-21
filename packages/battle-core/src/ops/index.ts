/**
 * ops/index.ts —— 效果 op 注册表与分派。
 *
 * 新增 op = ① handlers 表加一行 + ops/<name>.ts ② moves.schema.json 声明字段
 * ③ CompiledEffect 联合加分支 ④ ruleset operatorAllowlist 开启 ⑤ 测试。
 * 删除 op = 反序；loader 会把含该 op 的招式拒载，不静默吞。
 */
import type { CompiledEffect } from "../loader.ts";
import type { UnitState } from "../mechanics/types.ts";
import { EngineFault, OTHER } from "../types.ts";
import { damageOp } from "./damage.ts";
import { statStageOp } from "./stat-stage.ts";
import { healOp } from "./heal.ts";
import { transferStagesOp } from "./transfer-stages.ts";
import { clearStagesOp } from "./clear-stages.ts";
import { controlOp } from "./control.ts";
import { cleanseOp } from "./cleanse.ts";
import { applyStatusOp } from "./apply-effect.ts";
import { targetSideOf } from "./shared.ts";
import { condEval } from "./cond.ts";
import { protectAllOn } from "./effects.ts";
import { ppDeltaOp } from "./pp-delta.ts";
import { forceSwitchOp } from "./force-switch.ts";
import { copyStagesOp, invertStagesOp } from "./copy-stages.ts";
import { swapHpOp } from "./swap-hp.ts";
import { transferAilmentsOp } from "./transfer-ailments.ts";
import { applyMarkOp, consumeMarkOp, markCount } from "./mark.ts";
import { statBoostOp } from "./stat-boost.ts";
import { banishDeadOp } from "./banish-dead.ts";
import { setModeFlagOp } from "./mode-flag.ts";
import { stagesRewindOp } from "./slots/w10.ts";
import { effMaxOp } from "./slots/w09.ts";
import { hpDeltaOp } from "./hp-delta.ts";
import { growOp, magnitudeAcc, magnitudeTracks } from "./grow.ts";
import { priorityOp } from "./priority.ts";
import { carryDrainSlice, RIDER_OP_NAMES, ungroupedDrainOp, ungroupedRiderOp } from "./hit-rider.ts";
import { fireTriggers, type TriggerAdapter } from "./trigger.ts";
import { periodicMech, reactGrowthMode, reactMech } from "./mechanism.ts";
import type { CpResult, OpCtx, OpHandler } from "./types.ts";

/**
 * 单 transition 预算：applyTurn/applyReplacement 进入时安装。嵌套派发
 * （soulmark 钩子 / react payload / 机制回调产生的 op）与主循环共用同一
 * 计数与因果深度上限——互弹链在 maxCauseDepth 处被 EFFECT_LIMIT 截断，
 * 不会先吃掉 JS 调用栈。引擎同步执行，模块级持有即每调用一份。
 */
interface OpBudget { applications: number; depth: number }
let currentBudget: OpBudget | undefined;
export function withOpBudget<T>(fn: () => T): T {
  const prev = currentBudget;
  currentBudget = { applications: 0, depth: 0 };
  try {
    return fn();
  } finally {
    currentBudget = prev;
  }
}

export const OPS: Record<string, OpHandler> = {
  damage: damageOp,
  // 留在时间线上就抛。分组器应收进前一条 damage，由 damageOp 里的同名函数结算。
  applyDrainRider: ungroupedDrainOp,
  ...Object.fromEntries(RIDER_OP_NAMES.filter((op) => op !== "applyDrainRider").map((op) => [op, ungroupedRiderOp(op)])),
  apply_stat_stage: statStageOp,
  heal: healOp,
  transfer_stages: transferStagesOp,
  clear_stages: clearStagesOp,
  control: controlOp,
  cleanse: cleanseOp,
  apply_status: applyStatusOp,
  apply_effect: applyStatusOp,
  pp_delta: ppDeltaOp,
  force_switch: forceSwitchOp,
  copy_stages: copyStagesOp,
  invert_stages: invertStagesOp,
  swap_hp: swapHpOp,
  transfer_ailments: transferAilmentsOp,
  apply_mark: applyMarkOp,
  consume_mark: consumeMarkOp,
  stat_boost: statBoostOp,
  banish_dead: banishDeadOp,
  set_mode_flag: setModeFlagOp,
  stages_rewind: stagesRewindOp,
  eff_max: effMaxOp,
  hp_delta: hpDeltaOp,
  grow: growOp,
  priority: priorityOp,
};

/**
 * op 分派：解析 fx.target → 建 ctx → 调处理器。
 * 返回 CpResult；中断（suspend/terminal）语义由调用方（applyTurnInner/applyReplacement）处理。
 */
export function applyOp(
  ctx0: Omit<OpCtx, "foe" | "target" | "targetSide">,
  fx: CompiledEffect,
): CpResult {
  // 下只出场精灵目标（"对手下只出场精灵X"）：不立即结算，挂到对应侧的 nextInFx，登场时按 self 解析
  const rt = (fx as { target?: string }).target;
  if (rt === "nextFoe" || rt === "nextAlly") {
    const st = rt === "nextFoe" ? OTHER[ctx0.side] : ctx0.side;
    const side0 = ctx0.next.sides[st];
    // onEnterTarget：登场结算时生效目标改写（缺省 self=登场者；"opponent"=登场者的对手侧，用于"己方下只精灵令对手…"）
    const { onEnterTarget, ...restFx } = fx as CompiledEffect & { onEnterTarget?: "self" | "opponent" };
    const deferred = { ...restFx, target: onEnterTarget ?? "self" } as CompiledEffect;
    carryDrainSlice(fx, deferred);
    (side0.nextInFx ??= []).push({ moveId: ctx0.move.id, fx: deferred as unknown as { [k: string]: unknown } });
    ctx0.events.push({ type: "effect-applied", detail: { side: ctx0.side, name: "next_in", turns: 0 } });
    return "continue";
  }
  const foe = ctx0.next.sides[OTHER[ctx0.side]].unit;
  const targetSide = targetSideOf(ctx0.side, fx);
  const ctx: OpCtx = { ...ctx0, foe, targetSide, target: ctx0.next.sides[targetSide].unit };
  // transition 预算：每次 op 派发计入应用数（含被信封跳过的——它们同样构成递归步进）
  const budget = currentBudget;
  if (budget !== undefined) {
    budget.applications += 1;
    if (budget.applications > ctx0.pack.limits.maxEffectApplications) {
      throw new EngineFault("EFFECT_LIMIT", `maxEffectApplications ${ctx0.pack.limits.maxEffectApplications} exceeded`);
    }
  }
  // 信封：if 条件不满足 → 静默跳过；chance 门控——未过则整 op 跳过（draw 记进 rng.draws 供回放审计）
  if (fx.if !== undefined && !condEval(ctx, fx.if)) return "continue";
  const useStacks = Math.max(0, (ctx0.unit.moveStacks?.[ctx0.move.id] ?? 0) - 1); // moveStacks 含本次，叠用按此前次数
  const chance0 = fx.chance !== undefined && fx.chanceMulIf !== undefined && condEval(ctx, fx.chanceMulIf.when)
    ? Math.min(100, Math.floor((fx.chance * fx.chanceMulIf.numerator) / fx.chanceMulIf.denominator))
    : fx.chance;
  // chanceSetIf：条件直接改写触发率（"几率提升至N%"带条件形态）
  const chance1 = fx.chance !== undefined && fx.chanceSetIf !== undefined && condEval(ctx, fx.chanceSetIf.when) ? fx.chanceSetIf.value : chance0;
  // chancePerUse：每次使用触发率+N%（"每次使用几率增加10%"——叠用次数×步长）
  let chance = chance1 !== undefined && fx.chancePerUse !== undefined ? Math.min(fx.chancePerUseCap ?? 100, chance1 + fx.chancePerUse * useStacks) : chance1;
  // chancePerStage：每级正强化触发率+N%（"自身每处于1种能力强化状态则概率提高10%"——正级维数×步长）
  if (chance !== undefined && fx.chancePerStage !== undefined) {
    const ups = Object.values(ctx0.unit.stages).filter((v) => v > 0).length;
    chance = Math.min(100, chance + fx.chancePerStage * ups);
  }
  // chancePerMissing：每损失 per% 体力触发率+step%（"自身每损失N%的体力则进入异常几率提升M%"）
  if (chance !== undefined && fx.chancePerMissing !== undefined) {
    const missingPct = Math.floor(((ctx0.unit.base.hp - ctx0.unit.currentHp) * 100) / Math.max(1, ctx0.unit.base.hp));
    chance = Math.min(100, chance + fx.chancePerMissing.step * Math.floor(missingPct / Math.max(1, fx.chancePerMissing.per)));
  }
  // chancePerMark：每层印记触发率+add%（"对手每存在1层致命裂痕则几率提升10%"）
  if (chance !== undefined && fx.chancePerMark !== undefined) {
    chance = Math.min(100, chance + fx.chancePerMark.add * markCount(ctx, fx.chancePerMark));
  }
  // chanceSelfCurPct：触发率动态=自身当前体力百分比（"几率等同于出手时自身当前体力百分比"——覆写静态 chance）
  if (fx.chanceSelfCurPct === true) chance = Math.max(0, Math.min(100, Math.floor((ctx0.unit.currentHp * 100) / Math.max(1, ctx0.unit.base.hp))));
  if (chance !== undefined && ctx.rng.drawBelow(100, `chance:${fx.op}`) >= chance) return "continue";
  // protect 窗口：持有 protectAll 的目标单位免疫一切指向它的 op（plain=periodic tick 裸结算不穿过该窗）
  if (targetSide !== ctx.side && fx.plain !== true && protectAllOn(ctx.target)) {
    ctx.events.push({ type: "protected", detail: { side: targetSide } });
    return "continue";
  }
  // 因果深度：处理器内部可再派发（魂印钩子→ops→伤害→onDamaged→…）——深度记到处理器返回为止
  if (budget !== undefined) {
    budget.depth += 1;
    if (budget.depth > ctx0.pack.limits.maxCauseDepth) {
      budget.depth -= 1;
      throw new EngineFault("EFFECT_LIMIT", `maxCauseDepth ${ctx0.pack.limits.maxCauseDepth} exceeded`);
    }
    try {
      return (OPS[fx.op] ?? missing(fx.op))(ctx, fx);
    } finally {
      budget.depth -= 1;
    }
  }
  return (OPS[fx.op] ?? missing(fx.op))(ctx, fx);
}

const missing = (op: string): never => {
  throw new EngineFault("UNSUPPORTED_OPERATOR", `op ${op} not registered in ops/`);
};

/**
 * 反应式触发派发：扫描 holder 效果表中 kind="react" 且 params.trigger 命中的条目，
 * 校验守卫（params.cat 按 nullify 编码 / params.min 承伤阈值 / params.count 次数消耗），
 * 逐个以 applyOp 执行其 payload（payload 的 target 相对持有者解析——"opponent"=触发方）。
 *
 * trigger 编码：1=持有者受到攻击伤害 2=对手MISS 3=对手声明行动(cat门控)
 *               4=持有者护盾被击穿 5=持有者倒下 6=自身MISS 14=对侧精灵恢复体力（heal wrapper 派发）
 */
export function fireReactive(
  ctx0: Omit<OpCtx, "foe" | "target" | "targetSide">,
  holder: UnitState,
  trigger: number,
  guard: { cat?: number; dmg?: number; prio?: number; ailment?: string; power?: number; removed?: number } = {},
): CpResult {
  type Entry = UnitState["effects"][number];
  const out = fireTriggers<Entry>(ctx0, {
    // 快照语义：count 消耗中移除条目不影响本轮迭代序
    list: () => [...holder.effects],
    match: (e) => e.kind === "react" && e.params?.trigger === trigger && e.payload !== undefined,
    mech: (e) => {
      const growth = reactGrowthMode(e);
      if (growth.mode === "invalid") throw new EngineFault("REACT_GROW_MODE", growth.reason);
      const mech = reactMech(e);
      if (growth.mode === "magnitude") {
        const payload = e.payload as unknown as readonly CompiledEffect[];
        const acc = magnitudeAcc(payload);
        if (acc === undefined || !magnitudeTracks(payload)) {
          throw new EngineFault("REACT_GROW_MODE", "react magnitude grow has no persistent step accumulator");
        }
        mech.acc = acc; // magnitudeAcc uses commit:"pre" so KO/suspend cannot lose or replay growth.
      }
      return mech;
    },
    store: (e) => {
      const p = e.params!;
      return {
        ...(p.growStep !== undefined || magnitudeTracks(e.payload as unknown as readonly CompiledEffect[])
          ? { magAcc: { get: () => (p.growAcc ?? 0) as number, set: (v: number) => { p.growAcc = v; } } }
          : {}),
        ...(p.count !== undefined ? {
          count: {
            get: () => p.count as number,
            set: (v: number) => { p.count = v; },
            deplete: () => {
              holder.effects = holder.effects.filter((x) => x !== e);
              ctx0.events.push({ type: "effect-faded", detail: { side: ctx0.side, name: "react" } });
            },
          },
        } : {}),
      };
    },
    bag: guard,
    chanceDraw: "react_chance",
    // payload 链逐 op 跟踪 prevApplied——"未触发则X"/"若未恢复体力则X" 子句在 react 负载内必须读链上真实结算，
    // 否则 ctx0.prevApplied 是外层（宿主招式）的陈旧值，未触发兜底被错误抑制/放行。
    trackPrevApplied: true,
    // 触发袋透传：trigger 7 的 guard.removed（被清段数）→ payload damage.flatPerRemoved 的计费基数
    opCtx: (_e, bag) => (bag.removed !== undefined ? { stagesRemoved: bag.removed } : {}),
    announce: (c, e) => {
      c.events.push({ type: "effect-applied", detail: { side: c.side, name: "react", turns: e.remainingTurns ?? 0 } });
    },
  });
  if (out.kind === "continue") return "continue";
  if (out.kind === "terminal") return "terminal";
  return { suspend: out.suspend };
}

/**
 * 周期窗口派发（periodic 原子化路径）：扫描 holder 效果表中 kind==="periodic"
 * 且 params.win===win 的条目，按 effects 序逐条以 applyOp 执行 payload
 * （payload target 相对持有者：self=持有者，opponent=当前对手）。
 * params.expiry===1 的条目仅在 remainingTurns===1（本窗口将到期）时结算；
 * params.count 每结算一次递减，耗尽移除条目。
 * resume 语义与 fireReactive 一致：挂起时返回条目下标，续跑从 item+1 起。
 */
/** 单条 periodic 条目结算（W1 dot 合并循环的单条入口）：共用统一触发核，仅派发该条目自身。 */
export function periodicEntryFire(
  ctx0: Omit<OpCtx, "foe" | "target" | "targetSide">,
  holder: UnitState,
  e: UnitState["effects"][number],
): CpResult {
  const out = fireTriggers<UnitState["effects"][number]>(ctx0, periodicAdapter(ctx0, holder, -1, e), undefined);
  if (out.kind === "continue") return "continue";
  if (out.kind === "terminal") return "terminal";
  return { suspend: out.suspend };
}

/** periodic 条目的 adapter：win 匹配 + expiry/foeAlive 门 + params.chance + 缓冲过滤 + live-count 消耗。
 *  only：单条派形态（W1 交错循环已自行匹配 win/expiry——身份匹配，不再复查窗口谓词）。 */
function periodicAdapter(
  ctx0: Omit<OpCtx, "foe" | "target" | "targetSide">,
  holder: UnitState,
  win: number,
  only?: UnitState["effects"][number],
): TriggerAdapter<UnitState["effects"][number]> {
  return {
    list: () => holder.effects,
    match: (e) => only !== undefined
      ? e === only && e.payload !== undefined
      : e.kind === "periodic" && e.params?.win === win && e.payload !== undefined
        && !(e.params.expiry === 1 && e.remainingTurns !== 1),
    // holder KO → 本窗后续条目停派（旧 runPeriodicWin 循环尾 break 同位语义）
    stop: () => holder.currentHp <= 0,
    mech: periodicMech,
    store: (e) => e.params?.count !== undefined ? {
      count: {
        get: () => e.params!.count as number,
        set: (v: number) => { e.params!.count = v; },
        deplete: () => {
          holder.effects = holder.effects.filter((x) => x !== e);
          ctx0.events.push({ type: "effect-faded", detail: { side: ctx0.side, name: e.label ?? e.kind } });
        },
      },
    } : {},
    chanceDraw: "periodic_chance",
    opCtx: (e) => ({ unit: holder, statusLabel: e.label ?? "periodic" }),
    // payload 在事件缓冲结算——tick 路径不产 action-failed/protected 噪声（旧窗从无此事件），
    // 其余事件（含 ko/battle-end）原样并入主流，次序不变。
    buffer: (ev) => ev.type !== "action-failed" && ev.type !== "protected",
  };
}

export function runPeriodicWin(
  ctx0: Omit<OpCtx, "foe" | "target" | "targetSide">,
  holder: UnitState,
  win: number,
  itemFrom: number,
): { cp: CpResult; item: number } {
  const out = fireTriggers(ctx0, periodicAdapter(ctx0, holder, win), { item: itemFrom, opItem: 0 });
  if (out.kind === "suspend") return { cp: { suspend: out.suspend }, item: out.resume?.item ?? itemFrom };
  return { cp: out.kind === "terminal" ? "terminal" : "continue", item: holder.effects.length };
}
