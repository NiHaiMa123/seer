/**
 * ops/mark.ts —— apply_mark / consume_mark：可数层数印记（S4 印记栈）。
 *
 * 三种挂载位置：
 *   unit：target.effects 里 kind="mark:<名>" 的条目，params.count=层数（随单位迁移，换下保留，
 *         死亡由 checkpoint 清空；不走 cleanse 作用域——未计时 mark:* 不被 control:/timed 命中）；
 *   slot：target.moveMarks[moveId]["mark:<名>"]（招式槽印记——"散布N枚到任意技能"；随单位迁移）；
 *   field：next.sides[side].fieldMarks[]（场地印记——五行印记/圣剑；remainingTurns 随回合末递减）。
 *
 * 读取谓词/缩放（cond.ts / damage.ts / 信封管线）经 markCount() 统一取数：
 *   markCountAtLeast 条件 / flatPerMark / mulPerMark / chancePerMark / countPerMark。
 */
import type { MarkRef } from "../loader.ts";
import { OTHER, type CoreState, type SideId, EngineFault } from "../types.ts";
import type { OpCtx, OpHandler } from "./types.ts";
import type { UnitState } from "../mechanics/types.ts";

const mkey = (mark: string) => (mark.startsWith("mark:") ? mark : `mark:${mark}`);

/** 单位印记层数：effects 中 kind="mark:<名>" 条目的 params.count 合计。 */
export function unitMarkCount(u: UnitState, mark: string): number {
  const k = mkey(mark);
  let n = 0;
  for (const e of u.effects) if (e.kind === k) n += e.params?.count ?? 1;
  return n;
}

/** 招式槽印记层数：unit.moveMarks 全部槽位的该印记合计。 */
export function slotMarkCount(u: UnitState, mark: string): number {
  const k = mkey(mark);
  let n = 0;
  for (const rec of Object.values(u.moveMarks ?? {})) n += rec[k] ?? 0;
  return n;
}

/** 场地印记层数：side.fieldMarks 中该印记 count 合计。 */
export function fieldMarkCount(next: CoreState, side: SideId, mark: string): number {
  const k = mkey(mark);
  let n = 0;
  for (const e of next.sides[side].fieldMarks ?? []) if (e.kind === k) n += e.count;
  return n;
}

/** 场地印记种类数（"场上每有1种五行印记"）：on=both → 双方 fieldMarks kind 去重合计。 */
export function fieldMarkKinds(next: CoreState, on: "self" | "foe" | "both", side: SideId): number {
  const kinds = new Set<string>();
  const sides: SideId[] = on === "both" ? ["p1", "p2"] : [on === "foe" ? OTHER[side] : side];
  for (const s of sides) for (const e of next.sides[s].fieldMarks ?? []) kinds.add(e.kind);
  return kinds.size;
}

/**
 * 印记计数统一入口（cond/damage/信封共用）。
 * kinds:true → 场地种类数（at 强制 field）；否则按 at 取层数，on 选定读取侧（both=两侧合计）。
 */
export function markCount(ctx: Pick<OpCtx, "next" | "side" | "unit" | "foe">, ref: MarkRef): number {
  const on = ref.on ?? "self";
  let raw: number;
  if (ref.kinds === true) raw = fieldMarkKinds(ctx.next, on, ctx.side);
  else {
    const at = ref.at ?? "unit";
    const mark = ref.mark ?? "";
    const sides: SideId[] = on === "both" ? ["p1", "p2"] : [on === "foe" ? OTHER[ctx.side] : ctx.side];
    let n = 0;
    for (const s of sides) {
      if (at === "field") n += fieldMarkCount(ctx.next, s, mark);
      else {
        const u = s === ctx.side ? ctx.unit : ctx.foe;
        n += at === "slot" ? slotMarkCount(u, mark) : unitMarkCount(u, mark);
      }
    }
    raw = n;
  }
  // per：每N层/种记一份（"每有2层处决印记"→floor(层数/2)）
  return Math.floor(raw / Math.max(1, ref.per ?? 1));
}

/**
 * apply_mark：附加/叠加印记层数。
 * - unit：同 kind 条目叠 count（cap 封顶；缺省 99），turns 给计时印记；
 * - field：side.fieldMarks 叠 count，turns → remainingTurns（回合末递减）；
 * - slot：逐层落到招式槽——pick:"randomMove" 每层独立随机槽；缺省挂 ctx.move 所在槽
 *   （魂印"当前技能"语义；ctx.move 不在目标招式表时退化为随机槽）。cap=每槽上限，unitCap=单位总上限。
 */
export const applyMarkOp: OpHandler = (ctx, fx) => {
  if (fx.op !== "apply_mark") throw new EngineFault("OP_DISPATCH", `apply_mark handler got ${fx.op}`);
  const { next, events, target, targetSide, rng } = ctx;
  const k = mkey(fx.mark);
  const add = fx.count ?? 1;
  const cap = fx.cap ?? 99;
  const at = fx.at ?? "unit";
  if (at === "unit") {
    const existing = target.effects.find((e) => e.kind === k);
    if (existing !== undefined) {
      const cur = Math.min(cap, (existing.params?.count ?? 1) + add);
      existing.params = { ...(existing.params ?? {}), count: cur, cap };
      existing.appliedTurn = next.turn;
      if (fx.turns !== undefined) existing.remainingTurns = Math.max(existing.remainingTurns ?? 0, fx.turns);
      events.push({ type: "effect-applied", detail: { side: targetSide, name: k, count: cur } });
    } else {
      target.effects.push({
        kind: k,
        effectInstanceId: `efx_${targetSide}_${k}`,
        appliedTurn: next.turn,
        params: { count: Math.min(cap, add), cap },
        ...(fx.turns !== undefined ? { remainingTurns: fx.turns } : {}),
      });
      events.push({ type: "effect-applied", detail: { side: targetSide, name: k, count: Math.min(cap, add) } });
    }
    return "continue";
  }
  if (at === "field") {
    const fm = (next.sides[targetSide].fieldMarks ??= []);
    const ex = fm.find((e) => e.kind === k);
    if (ex !== undefined) {
      ex.count = Math.min(cap, ex.count + add);
      if (fx.turns !== undefined) {
        ex.remainingTurns = Math.max(ex.remainingTurns ?? 0, fx.turns);
        ex.appliedTurn = next.turn;
      }
      events.push({ type: "effect-applied", detail: { side: targetSide, name: k, count: ex.count } });
    } else {
      fm.push({ kind: k, count: Math.min(cap, add), ...(fx.turns !== undefined ? { remainingTurns: fx.turns, appliedTurn: next.turn } : {}) });
      events.push({ type: "effect-applied", detail: { side: targetSide, name: k, count: Math.min(cap, add) } });
    }
    return "continue";
  }
  if (at === "slot") {
    const slots = target.moves.map((m) => m.moveId);
    if (slots.length === 0) return "continue";
    const mm = (target.moveMarks ??= {});
    const total = () => Object.values(mm).reduce((a, r) => a + (r[k] ?? 0), 0);
    for (let i = 0; i < add; i++) {
      if (fx.unitCap !== undefined && total() >= fx.unitCap) break;
      const onOwnSlot = fx.pick !== "randomMove" && slots.includes(ctx.move.id);
      const moveId = onOwnSlot ? ctx.move.id : slots[rng.drawBelow(slots.length, "mark_slot")]!;
      const rec = (mm[moveId] ??= {});
      if ((rec[k] ?? 0) >= cap) continue; // 该槽已满——本层丢弃（不另选槽，UNVERIFIED：散布语义按落点饱和丢弃）
      rec[k] = (rec[k] ?? 0) + 1;
      events.push({ type: "effect-applied", detail: { side: targetSide, name: k, moveId, count: rec[k] } });
    }
    return "continue";
  }
  // at === "all" 对 apply 无意义——等价 unit
  return applyMarkOp(ctx, { ...fx, at: "unit" });
};

/**
 * consume_mark：消耗/移除印记层数（"解放全部龙鳞"/"消耗1柄圣剑"/"使用后移除当前技能印记"）。
 * count 缺省 = 全部层数；mark="*" = 该位置全部 mark:*。slot 缺省取 ctx.move 槽，pick:"randomMove" 随机已占槽。
 */
export const consumeMarkOp: OpHandler = (ctx, fx) => {
  if (fx.op !== "consume_mark") throw new EngineFault("OP_DISPATCH", `consume_mark handler got ${fx.op}`);
  const { next, events, target, targetSide, rng } = ctx;
  const at = fx.at ?? "unit";
  const wantAll = fx.mark === "*";
  // "*后缀" = 印记族匹配（"解放全部龙鳞"→"*龙鳞" 匹配 mark:红色龙鳞 等）
  const suffixGlob = !wantAll && fx.mark.startsWith("*") ? fx.mark.slice(1) : undefined;
  const k = wantAll || suffixGlob !== undefined ? undefined : mkey(fx.mark);
  const match = (kind: string): boolean =>
    kind.startsWith("mark:") && (wantAll || (suffixGlob !== undefined ? kind.endsWith(suffixGlob) : kind === k));
  const fade = (side: SideId, kind: string, count: number, moveId?: string) =>
    events.push({ type: "effect-faded", detail: { side, name: kind, count, ...(moveId !== undefined ? { moveId } : {}) } });
  if (at === "unit" || at === "all") {
    target.effects = target.effects.filter((e) => {
      if (!match(e.kind)) return true;
      const cur = e.params?.count ?? 1;
      if (fx.count !== undefined && cur > fx.count) {
        e.params = { ...(e.params ?? {}), count: cur - fx.count };
        fade(targetSide, e.kind, fx.count);
        return true;
      }
      fade(targetSide, e.kind, cur);
      return false;
    });
  }
  if (at === "slot" || at === "all") {
    const mm = target.moveMarks;
    if (mm !== undefined) {
      const hitSlot = (mid: string, rec: Record<string, number>) => {
        for (const kk of Object.keys(rec)) {
          if (!match(kk)) continue;
          const c = rec[kk]!;
          const rm = Math.min(c, fx.count ?? c);
          rec[kk] = c - rm;
          fade(targetSide, kk, rm, mid);
        }
        for (const kk of Object.keys(rec)) if (rec[kk]! <= 0) delete rec[kk];
        if (Object.keys(rec).length === 0) delete mm[mid];
      };
      if (fx.pick === "randomMove") {
        const occupied = Object.keys(mm).filter((mid) => Object.keys(mm[mid]!).some(match));
        const mid = occupied.length > 0 ? occupied[rng.drawBelow(occupied.length, "mark_slot")]! : undefined;
        if (mid !== undefined) hitSlot(mid, mm[mid]!);
      } else {
        const rec = mm[ctx.move.id];
        if (rec !== undefined) hitSlot(ctx.move.id, rec);
      }
      if (Object.keys(mm).length === 0) delete target.moveMarks;
    }
  }
  if (at === "field" || at === "all") {
    const fm = next.sides[targetSide].fieldMarks;
    if (fm !== undefined) {
      next.sides[targetSide].fieldMarks = fm.filter((e) => {
        if (!match(e.kind)) return true;
        if (fx.count !== undefined && e.count > fx.count) { e.count -= fx.count; fade(targetSide, e.kind, fx.count); return true; }
        fade(targetSide, e.kind, e.count);
        return false;
      });
      if (next.sides[targetSide].fieldMarks!.length === 0) delete next.sides[targetSide].fieldMarks;
    }
  }
  return "continue";
};
