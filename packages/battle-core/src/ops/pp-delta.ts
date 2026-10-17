/**
 * ops/pp-delta.ts —— pp_delta：调整目标技能 PP（"恢复自身所有技能PP+2"/"对手PP-1"）。
 * scope: "all"=全部招式槽 | "current"=本招自身（自我回PP/烧PP 用）。
 * PP clamp [0, ppMax]；每槽一条 pp-delta 事件。
 */
import { EngineFault, OTHER } from "../types.ts";
import type { CpResult, OpHandler } from "./types.ts";

export const ppDeltaOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, unit, target, targetSide, move } = ctx;
  // tick 语义（periodic payload 传 plain）：无变更时静默——不产 action-failed；事件挂 status:<label> 源
  const failed = (reason: string): CpResult => {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason } });
    return "continue";
  };
  const src = ctx.statusLabel !== undefined ? { source: `status:${ctx.statusLabel}` } : {};
  if (fx.op !== "pp_delta") throw new EngineFault("OP_DISPATCH", `pp_delta handler got ${fx.op}`);
  // bench：己方后备全体 PP 调整（"恢复己方所有不在场且存活精灵N点技能PP值"；aliveOnly=只算存活后备）
  if (fx.target === "bench") {
    const bench = ctx.next.sides[side].bench ?? [];
    let any = false;
    for (const b of bench) {
      if (fx.aliveOnly === true && !(b.currentHp > 0 && b.banished !== true)) continue;
      for (const slot of b.moves) {
        const before = slot.pp;
        slot.pp = fx.full === true ? slot.ppMax : fx.zero === true ? 0 : Math.max(0, Math.min(slot.ppMax, slot.pp + (fx.amount ?? 0)));
        const delta = slot.pp - before;
        if (delta === 0) continue;
        any = true;
        events.push({ type: "pp-delta", detail: { side, moveId: slot.moveId, delta, ppAfter: slot.pp, ...src } });
      }
    }
    if (!any) return failed("pp-delta-noop");
    return "continue";
  }
  // slot：指定槽位（"令对手第N技能PP值归0"→1-based 序号；"第五技能"→fifth:true 标记槽）
  if (fx.slot !== undefined) {
    const slot = fx.slot === "fifth"
      ? target.moves.find((m) => pack.movesById.get(m.moveId)?.fifth === true)
      : target.moves[fx.slot - 1];
    if (slot === undefined) return failed("pp-slot-missing");
    const before = slot.pp;
    slot.pp = fx.zero === true ? 0 : Math.max(0, Math.min(slot.ppMax, fx.set ?? slot.pp + (fx.amount ?? 0)));
    events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: slot.pp, ...src } });
    return "continue";
  }
  // setRandom：随机抽 N 个槽位 PP 置为固定值（"使对手随机M项技能PP值变K"）
  if (fx.setRandom !== undefined) {
    const live = target.moves.filter((m) => m.pp !== fx.setRandom!.value);
    let picked = 0;
    while (live.length > 0 && picked < fx.setRandom.count) {
      const i = ctx.rng.drawBelow(live.length, "pp_pick");
      const slot = live.splice(i, 1)[0]!;
      const before = slot.pp;
      slot.pp = Math.max(0, Math.min(slot.ppMax, fx.setRandom.value));
      picked++;
      events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: slot.pp, ...src } });
    }
    if (picked === 0) return failed("pp-delta-noop");
    return "continue";
  }
  // setFromThis：目标全槽 PP 置为行动方本招式剩余 PP（"令双方所有技能PP值等于此技能剩余PP值"）
  if (fx.setFromThis === true) {
    const cur = unit.moves.find((m) => m.moveId === move.id)?.pp ?? 0;
    let any = false;
    for (const slot of target.moves) {
      const before = slot.pp;
      slot.pp = Math.max(0, Math.min(slot.ppMax, cur));
      if (slot.pp === before) continue;
      any = true;
      events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: slot.pp, ...src } });
    }
    if (!any) return failed("pp-delta-noop");
    return "continue";
  }
  const scope = fx.scope ?? "all";
  // amountRandom：随机抽 count 个槽位各 ±delta（"自身随机2个技能PP值+1"）
  if (fx.amountRandom !== undefined) {
    const live = [...target.moves];
    let picked = 0;
    while (live.length > 0 && picked < fx.amountRandom.count) {
      const i = ctx.rng.drawBelow(live.length, "pp_pick");
      const slot = live.splice(i, 1)[0]!;
      const before = slot.pp;
      slot.pp = Math.max(0, Math.min(slot.ppMax, slot.pp + fx.amountRandom.delta));
      picked++;
      events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: slot.pp, ...src } });
    }
    if (picked === 0) return failed("pp-delta-noop");
    return "continue";
  }
  // amountRange：全部槽位各自抽 [min,max] 幅度（"使对手所有技能PP随机减少1-2点"——负值即扣）
  if (fx.amountRange !== undefined) {
    let any = false;
    for (const slot of target.moves) {
      const span = fx.amountRange.max - fx.amountRange.min;
      const delta = fx.amountRange.min + (span > 0 ? ctx.rng.drawBelow(span + 1, "pp_pick") : 0);
      if (delta === 0) continue;
      const before = slot.pp;
      slot.pp = Math.max(0, Math.min(slot.ppMax, slot.pp + delta));
      events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: slot.pp - before, ppAfter: slot.pp, ...src } });
      any = true;
    }
    if (!any) return failed("pp-delta-noop");
    return "continue";
  }
  // zeroRandom：随机抽 N 个目标技能槽清零 PP（"使对手随机N项技能PP值归零"；zeroRandomMax → count∈[N,M] 先抽数量）
  if (fx.zeroRandom !== undefined) {
    const want = fx.zeroRandomMax !== undefined && fx.zeroRandomMax > fx.zeroRandom
      ? fx.zeroRandom + ctx.rng.drawBelow(fx.zeroRandomMax - fx.zeroRandom + 1, "pp_pick")
      : fx.zeroRandom;
    const live = target.moves.filter((m) => m.pp > 0);
    let picked = 0;
    while (live.length > 0 && picked < want) {
      const i = ctx.rng.drawBelow(live.length, "pp_pick");
      const slot = live.splice(i, 1)[0]!;
      const before = slot.pp;
      slot.pp = 0;
      picked++;
      events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta: -before, ppAfter: 0, ...src } });
    }
    if (picked === 0) return failed("pp-delta-noop");
    return "continue";
  }
  // zeroMaxPower：威力最高槽 PP 归零（"令对手威力最高的技能PP归零"）——同威力取列表序首个（确定性）
  if (fx.zeroMaxPower === true) {
    let best: typeof target.moves[number] | undefined;
    let bestPow = -1;
    for (const slot of target.moves) {
      const pow = pack.movesById.get(slot.moveId)?.effects.find((e) => e.op === "damage")?.power ?? 0;
      if (pow > bestPow) { bestPow = pow; best = slot; }
    }
    if (best === undefined) return failed("pp-no-move");
    const before = best.pp;
    best.pp = 0;
    if (before !== 0) events.push({ type: "pp-delta", detail: { side: targetSide, moveId: best.moveId, delta: -before, ppAfter: 0, ...src } });
    else return failed("pp-delta-noop");
    return "continue";
  }
  const slots = (scope === "current"
    ? target.moves.filter((m) => m.moveId === move.id)
    : scope === "others"
      ? target.moves.filter((m) => m.moveId !== move.id)
      : target.moves).filter((m) => {
        // cat 过滤（"令对手攻击技能PP值归0"——cat:4=攻击招=非属性招）
        if (fx.cat === undefined) return true;
        const c = pack.movesById.get(m.moveId)?.category;
        const cc = c === "physical" ? 2 : c === "special" ? 3 : 1;
        return fx.cat === 4 ? cc !== 1 : cc === fx.cat;
      });
  let any = false;
  let restored = 0;
  // amountFromThisPct：各槽增量=行动方本招式剩余PP×pct%（"恢复自身其他技能此技能剩余PP值的50%"）
  const fromThis = fx.amountFromThisPct !== undefined ? Math.floor(((unit.moves.find((m) => m.moveId === move.id)?.pp ?? 0) * fx.amountFromThisPct) / 100) : undefined;
  for (const slot of slots) {
    const before = slot.pp;
    // zero：全部槽 PP 归零（"对手所有技能PP值归零"）
    slot.pp = fx.zero === true ? 0 : fx.full === true ? slot.ppMax : Math.max(0, Math.min(slot.ppMax, slot.pp + (fromThis ?? fx.amount ?? 0)));
    // plain(tick)：事件记名义请求量（旧 ppTick/ppDrain 钉 delta=请求值 非实际差值）
    const actual = slot.pp - before;
    if (actual === 0) continue;
    const delta = fx.plain === true && fx.amount !== undefined && fromThis === undefined ? fx.amount : actual;
    any = true;
    if (actual > 0) restored += actual;
    events.push({ type: "pp-delta", detail: { side: targetSide, moveId: slot.moveId, delta, ppAfter: slot.pp, ...src } });
  }
  if (!any) return failed("pp-delta-noop");
  // drainPerPpPoint：每恢复 per 点 PP 吸取对手 flat 点体力（"每恢复1点PP吸取对手30点体力"——按实际恢复量计费）
  if (fx.drainPerPpPoint !== undefined && restored > 0 && ctx.foe !== undefined && ctx.foe.currentHp > 0) {
    const amt = Math.floor(restored / Math.max(1, fx.drainPerPpPoint.per)) * fx.drainPerPpPoint.flat;
    if (amt > 0) {
      ctx.foe.currentHp = Math.max(0, ctx.foe.currentHp - amt);
      events.push({ type: "damage", detail: { side: OTHER[side], amount: amt, hpAfter: { current: ctx.foe.currentHp, max: ctx.foe.base.hp }, damageKind: "fixed", cause: "pp_drain" } });
    }
  }
  return "continue";
};
