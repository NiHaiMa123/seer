/** ops/clear-stages.ts —— clear_stages：目标能力等级全清零。 */
import { stageKeysFor } from "../mechanics/index.ts";
import { EngineFault, OTHER } from "../types.ts";
import { checkpoint, overlayOf } from "./shared.ts";
import { downLockOn, upLockOn } from "./effects.ts";
import { fireReactive } from "./index.ts";
import type { OpHandler } from "./types.ts";

// live binding 调用（同 transfer-stages）：顶层固化会在 mechanics→ops 循环边下捕获 undefined。
const stageKeys = (pack: Parameters<typeof stageKeysFor>[0]) => stageKeysFor(pack);

export const clearStagesOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, target, targetSide } = ctx;
  if (fx.op !== "clear_stages") throw new EngineFault("OP_DISPATCH", `clear_stages handler got ${fx.op}`);
  // plain（tick 语义）：不吃 overlay/downLock/upLock，清除后不发 action-failed
  if (fx.plain !== true && overlayOf(pack, target)?.immuneClearStages) {
    events.push({ type: "action-failed", detail: { side, reason: "overlay_immune" } });
    return "continue";
  }
  // 弱化锁（"能力下降状态无法被解除或反转"）：持有者负级禁止被清除/反转
  if (fx.plain !== true && downLockOn(target) && fx.sign !== "up") {
    events.push({ type: "action-failed", detail: { side, reason: "down_lock" } });
    return "continue";
  }
  // 强化锁（"能力提升状态无法被消除或吸取"）：持有者正级禁止被清除（sign=down 解弱化不受阻）
  if (fx.plain !== true && upLockOn(target) && fx.sign !== "down") {
    events.push({ type: "action-failed", detail: { side, reason: "up_lock" } });
    return "continue";
  }
  // sign: "up" 只清正面（消除强化），"down" 只清负面（解除自身下降）；缺省全清（兼容旧语义）
  // stats: 限定维度子集（"消除对手防御能力提升"→stats:["def","sdf"]）
  const allowed = fx.stats !== undefined ? new Set<string>(fx.stats) : undefined;
  const keys = stageKeys(pack).filter((s) => {
    if (allowed !== undefined && !allowed.has(s)) return false;
    const v = target.stages[s] ?? 0;
    return fx.sign === "up" ? v > 0 : fx.sign === "down" ? v < 0 : true;
  });
  if (keys.every((s) => (target.stages[s] ?? 0) === 0)) {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
    return "continue";
  }
  // 记录被清掉的正面等级（"若自身能力提升状态被消除则X" 反应式 trigger=7 的成立条件）
  const lostPositive = keys.some((s) => (target.stages[s] ?? 0) > 0);
  // flatPerRemoved：按被移除等级段数附加固伤（"消除成功则附加消除总段数乘以35的固定伤害"——受击方=被清侧）
  const removedTotal = keys.reduce((sum, s) => sum + Math.abs(target.stages[s] ?? 0), 0);
  for (const s of keys) target.stages[s] = 0;
  events.push({ type: "stages-cleared", detail: { side: targetSide } });
  if (fx.flatPerRemoved !== undefined && removedTotal > 0 && target.currentHp > 0) {
    const echoDmg = removedTotal * fx.flatPerRemoved;
    target.currentHp = Math.max(0, target.currentHp - echoDmg);
    events.push({ type: "damage", detail: { side: targetSide, amount: echoDmg, hpAfter: { current: target.currentHp, max: target.base.hp }, damageKind: "fixed", cause: "stages-cleared-echo" } });
    // 附加伤害可致死——中断语义必须传播（尸体不得留场）
    const cp = checkpoint(pack, ctx.next, events, ctx.rng);
    if (cp !== "continue") return cp;
  }
  if (lostPositive && fx.noHooks !== true) {
    const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
    // trigger7 携带被清段数（"每消除1项则附加N点固伤"——payload damage.flatPerRemoved 的计费基数）
    const cp = fireReactive({ ...rest, side: targetSide, unit: target }, target, 7, { removed: removedTotal });
    if (cp !== "continue") return cp;
    // 对手侧强化消失 → trigger17（"对方强化效果消失时X" 反应式，挂在施清方一侧）
    const cp17 = fireReactive({ ...rest }, ctx.unit, 17, {});
    if (cp17 !== "continue") return cp17;
  }
  // onClear rider：清除成功触发（"消除任意一项成功则附加300固伤且令对手随机1技能PP归零"——对手=施清方的对方）
  if (fx.onClear !== undefined) {
    const foeSide = OTHER[side];
    const foe = ctx.next.sides[foeSide].unit;
    if (fx.onClear.flat !== undefined && foe.currentHp > 0) {
      foe.currentHp = Math.max(0, foe.currentHp - fx.onClear.flat);
      events.push({ type: "damage", detail: { side: foeSide, amount: fx.onClear.flat, hpAfter: { current: foe.currentHp, max: foe.base.hp }, damageKind: "fixed", cause: "clear-echo" } });
      const cp = checkpoint(pack, ctx.next, events, ctx.rng);
      if (cp !== "continue") return cp;
    }
    if (fx.onClear.ppZeroFoe !== undefined && foe.currentHp > 0) {
      const live = foe.moves.filter((m) => m.pp > 0);
      for (let i = 0; i < fx.onClear.ppZeroFoe && live.length > 0; i++) {
        const slot = live.splice(ctx.rng.drawBelow(live.length, "pp_pick"), 1)[0]!;
        events.push({ type: "pp-delta", detail: { side: foeSide, moveId: slot.moveId, delta: -slot.pp, ppAfter: 0 } });
        slot.pp = 0;
      }
    }
  }
  return "continue";
};
