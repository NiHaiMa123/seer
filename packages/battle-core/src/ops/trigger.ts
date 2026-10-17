/**
 * ops/trigger.ts —— 触发条目统一派发核：react 效果条目 / periodic 周期条目 / 魂印 hook 条目
 * 全部归一化为 mechanism.ts 的 MechEnv 信封，共用同一条
 * "枚举→匹配→中止门→信封求值(gate/guard/chance/acc/count/once)→事件→负载 dispatch→记账→续跑"骨架。
 *
 * adapter 只剩声明式回调：
 * - list/match：条目来源与触发谓词（react trigger 数 / periodic win / 魂印 hook + scope filter）；
 * - mech(e)：编译产物 → MechEnv 信封归一化（gate/chance/acc/count/once/ops/elseOps 语义通用）；
 * - store(e,i)：累积/计数存储句柄（react=params、periodic=params、魂印=soul.*Acc/firedOnce）；
 * - bag/condCtx/chanceDraw：dispatch 现场袋 / guard 求值 OpCtx / 概率 draw 记账名；
 * - announce/opCtx/buffer/trackPrevApplied：事件身份与 op 上下文覆写；
 * - transform：accTransform 之外的逐 op 变换逃生口（魂印 stampStreakHit），默认 accTransform；
 * - extraGate：信封之外源特定的静态门（逃生口，正常应为空）。
 *
 * 续跑游标统一为 {item, opItem, branch}：item=声明序条目下标；opItem>0=条目内断点
 * （信封求值/记账全部跳过，直接续跑已选分支）；opItem=0=从该条目正常起算
 * （periodic 挂起后由调用方传 item+1，放弃未完条目）。
 * 游标由调用方各自持久化（TeCursor / soul.teResume / 丢弃）。
 */
import type { CompiledEffect } from "../loader.ts";
import { EngineFault, type CoreEvent, type SideId } from "../types.ts";
import { applyOp, OPS } from "./index.ts";
import { groupHitRiders } from "./hit-rider.ts";
import { condEval } from "./cond.ts";
import { accCommit, accPeek, accTransform, chanceFails, gateOk, type GateBag, type MechEnv, type MechStore } from "./mechanism.ts";
import type { MagTail, OpCtx } from "./types.ts";

export type TrigCtx = Omit<OpCtx, "foe" | "target" | "targetSide">;
export type TriggerBranch = "main" | "else";

/** 触发派发断点：item=条目下标；opItem>0 = 条目内第 opItem 个 op 起续跑；branch=续跑分支。 */
export interface TriggerResume {
  item: number;
  opItem: number;
  branch?: TriggerBranch;
}

export type TriggerOutcome =
  | { kind: "continue" }
  | { kind: "terminal" }
  | { kind: "suspend"; suspend: SideId; resume?: TriggerResume };

export interface TriggerAdapter<E> {
  /** 候选条目（声明序——需要快照语义时由实现方自行拷贝）。 */
  list(ctx: TrigCtx): readonly E[];
  /** 触发匹配（react trigger 数 / periodic win / 魂印 hook + scope filter——续跑条目同样要过）。 */
  match(e: E, i: number): boolean;
  /** 外部中止门：每轮迭代前检查（魂印 ctx.outcome 已由前段置位时整体退出）。 */
  stop?(ctx: TrigCtx): boolean;
  /** 编译产物 → 信封归一化。 */
  mech(e: E): MechEnv;
  /** 累积/计数/一次性 存储句柄。 */
  store?(e: E, i: number): MechStore;
  /** 事件分发现场袋（gate 求值输入）。 */
  bag?: GateBag;
  /** guard 谓词求值用的完整 OpCtx（含 foe/target——魂印）。缺省时带 guard 的条目不通过。 */
  condCtx?(ctx: TrigCtx, e: E): OpCtx;
  /** 概率 draw 记账名（react_chance / periodic_chance / soulmark:<hook>）。 */
  chanceDraw?: string;
  /** 信封之外源特定的静态门（逃生口）。 */
  extraGate?(ctx: TrigCtx, e: E, i: number): boolean;
  /** 触发事件推送（非续跑）：effect-applied / soulmark 事件。 */
  announce?(ctx: TrigCtx, e: E, i: number): void;
  /** 逐 op 变换逃生口：默认 accTransform(acc)；覆写时自行组合 accGrow/accMul/accChance（魂印 stampStreakHit 前置）。 */
  transform?(ctx: TrigCtx, e: E, i: number, fx: CompiledEffect, mag: number, atCap: boolean): CompiledEffect;
  /** applyOp 上下文覆写（statusLabel / move stub / 触发袋透传——react 的 bag.removed→stagesRemoved）。 */
  opCtx?(e: E, bag: GateBag): Partial<TrigCtx>;
  /** 负载事件缓冲过滤：返回 true 的事件才并入主流（periodic 滤 action-failed/protected）。 */
  buffer?(ev: CoreEvent): boolean;
  /** 跟踪并注入 prevApplied（魂印负载谓词需要；react/periodic 不开启以保持旧语义）。 */
  trackPrevApplied?: boolean;
}

/**
 * 统一派发：枚举 adapter.list 中 match 的条目，逐条走信封求值→ops。
 * resume 给定且 opItem>0 时跳过该条目的门控/抉择/记账，从 opItem 续跑已选分支。
 */
export function fireTriggers<E>(
  ctx: TrigCtx,
  ad: TriggerAdapter<E>,
  resume?: TriggerResume,
): TriggerOutcome {
  const entries = ad.list(ctx);
  const buffered = ad.buffer !== undefined;
  for (const [i, e] of entries.entries()) {
    if (resume !== undefined && i < resume.item) continue;
    if (!ad.match(e, i)) continue;
    if (ad.stop !== undefined && ad.stop(ctx)) return { kind: "continue" };
    const resumed = resume !== undefined && i === resume.item && resume.opItem > 0;
    const mech = ad.mech(e);
    const st = ad.store !== undefined ? ad.store(e, i) : {};
    // acc 快照：mag=结算前累积（注入用），atCap=达顶判定——续跑条目同样取（写回仅非续跑）
    const { mag, atCap } = accPeek(mech.acc, st.magAcc);
    let branch: TriggerBranch = "main";
    let ops: readonly CompiledEffect[];
    if (resumed) {
      branch = resume.branch ?? "main";
      ops = branch === "else" ? (mech.elseOps ?? []) : (mech.ops ?? []);
      if (ops.length === 0) continue; // 续跑空负载：跳过本条目（达顶尾段同样不结算——对齐旧 continue 语义）
    } else {
      if (mech.once === true && st.once?.get() === true) continue;
      if (mech.gate !== undefined && !gateOk(mech.gate, ctx, ad.bag ?? {})) continue;
      if (mech.guard !== undefined && (ad.condCtx === undefined || !condEval(ad.condCtx(ctx, e), mech.guard))) continue;
      if (ad.extraGate !== undefined && !ad.extraGate(ctx, e, i)) continue;
      const failed = mech.chance !== undefined
        ? chanceFails(ctx, mech.chance, st.chanceAcc, i, ad.chanceDraw ?? "trigger_chance")
        : false;
      branch = failed ? "else" : "main";
      ops = failed ? (mech.elseOps ?? []) : (mech.ops ?? []);
      if (ops.length === 0) continue;
      // 记账：acc 增长（commit:"post"=完结后记，react；缺省/pre=派发前记，魂印）与 once/count
      if (mech.acc !== undefined && st.magAcc !== undefined && mech.acc.commit !== "post") accCommit(mech.acc, st.magAcc, mag, atCap);
      if (mech.once === true) st.once?.set();
      if (mech.count === "fire" && st.count !== undefined) {
        st.count.set(st.count.get() - 1);
        if (st.count.get() <= 0) st.count.deplete();
      }
      ad.announce?.(ctx, e, i);
    }
    // 事件缓冲：periodic 滤 tick 噪声；其余源直写主流。produced 供 produced-count 判定实际生效。
    const from = ctx.events.length;
    const buf: CoreEvent[] = [];
    const evSink = buffered ? buf : ctx.events;
    const magTail: MagTail = { atCap };
    const octx = { ...ctx, events: evSink, magTail, ...(ad.opCtx !== undefined ? ad.opCtx(e, ad.bag ?? {}) : {}) };
    let prevApplied = false;
    const riderErr = groupHitRiders(ops);
    if (riderErr !== undefined) throw new EngineFault("RIDER_UNGROUPED", riderErr);
    // else 分支的列表里没有幅度 op，达顶尾段仍要在选中分支之后派发。先按主列表武装。
    for (const fx of mech.ops ?? []) {
      const h = OPS[fx.op];
      if (h !== undefined && h.frame === true) h(octx as OpCtx, fx);
    }
    for (const [fi, fx0] of ops.entries()) {
      if (resumed && fi < resume.opItem) continue;
      const fx = ad.transform !== undefined ? ad.transform(ctx, e, i, fx0, mag, atCap) : accTransform(fx0, mech.acc, mag, atCap);
      const evFrom = evSink.length;
      const cp = applyOp(ad.trackPrevApplied === true ? { ...octx, prevApplied } : octx, fx);
      if (ad.trackPrevApplied === true) {
        prevApplied = evSink
          .slice(evFrom)
          .some((x) => x.type !== "protected" && x.type !== "action-failed" && (x.type as string) !== "immune");
      }
      if (cp === "terminal") {
        if (buffered) ctx.events.push(...buf.filter(ad.buffer!));
        return { kind: "terminal" };
      }
      if (cp !== "continue") {
        if (buffered) ctx.events.push(...buf.filter(ad.buffer!));
        return { kind: "suspend", suspend: cp.suspend, resume: { item: i, opItem: fi + 1, ...(branch === "else" ? { branch } : {}) } };
      }
    }
    const produced = buffered ? buf.filter(ad.buffer!) : ctx.events.slice(from);
    if (buffered) ctx.events.push(...produced);
    if (!resumed) {
      if (mech.acc !== undefined && st.magAcc !== undefined && mech.acc.commit === "post") accCommit(mech.acc, st.magAcc, mag, atCap);
      if (mech.count === "produced" && st.count !== undefined && produced.length > 0) {
        st.count.set(st.count.get() - 1);
        if (st.count.get() <= 0) st.count.deplete();
      }
    }
    // 达顶尾段：幅度 op 武装的 run。续跑条目同样结算；挂起无游标，整段重派。
    if (magTail.run !== undefined) {
      const cp = magTail.run(ad.trackPrevApplied === true ? { ...octx, prevApplied } : octx);
      if (cp === "terminal") return { kind: "terminal" };
      if (cp !== "continue") return { kind: "suspend", suspend: cp.suspend };
    }
  }
  return { kind: "continue" };
}
