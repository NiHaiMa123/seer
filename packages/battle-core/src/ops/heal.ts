/** ops/heal.ts —— heal：按最大体力分数回复（numerator/denominator）或固定值（flat）。 */
import { EngineFault, OTHER } from "../types.ts";
import type { SideId } from "../types.ts";
import { noHealOn, healCutPctOf, healBoostPctOf, hpCapOf, effectDefOf, flatImmuneOn, statDiffOf, statSumPctOf } from "./effects.ts";
import { condEval } from "./cond.ts";
import { checkpoint } from "./shared.ts";
import { fireReactive } from "./index.ts";
import type { OpHandler } from "./types.ts";

/** heal 主体实现（原 healOp）——外层 healOp 包 trigger-14 治疗反应窗派发。 */
const healCore: OpHandler = (ctx, fx) => {
  const { pack, next, events, side, unit, foe, rng } = ctx;
  if (fx.op !== "heal") throw new EngineFault("OP_DISPATCH", `heal handler got ${fx.op}`);
  // bench 目标（"恢复己方所有不在场精灵N点体力"）：逐只后备回复，各自 hp 封顶
  if (fx.target === "bench") {
    const bench = next.sides[side].bench ?? [];
    for (const b of bench) {
      if (b.currentHp <= 0) continue;
      const amt = fx.flat ?? Math.floor((b.base.hp * (fx.numerator ?? 1)) / (fx.denominator ?? 1));
      const before = b.currentHp;
      b.currentHp = Math.min(hpCapOf(b), b.currentHp + amt);
      if (b.currentHp > before) events.push({ type: "heal", detail: { side, amount: b.currentHp - before, hpAfter: { current: b.currentHp, max: b.base.hp }, source: "bench" } });
    }
    return "continue";
  }
  const t = fx.target === "opponent" ? foe : unit;
  // drainFlatIf：条件转变为吸取（"若P则恢复效果转变为吸取对手N点体力"——对手扣 flat，自身回实扣量；不走回复通道）
  if (fx.drainFlatIf !== undefined && (fx.drainFlatIf.when === undefined || condEval(ctx, fx.drainFlatIf.when))) {
    if (foe.currentHp > 0) {
      const drained = Math.min(foe.currentHp, fx.drainFlatIf.flat);
      foe.currentHp -= drained;
      events.push({ type: "damage", detail: { side: OTHER[side], amount: drained, hpAfter: { current: foe.currentHp, max: foe.base.hp }, damageKind: "fixed", cause: "drain" } });
      if (drained > 0 && unit.currentHp > 0) {
        const before = unit.currentHp;
        unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + drained);
        if (unit.currentHp > before) events.push({ type: "heal", detail: { side, amount: unit.currentHp - before, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "drain" } });
      }
      return checkpoint(pack, next, events, ctx.rng);
    }
    return "continue";
  }
  // pctSwapIf：条件转变为百分比伤害（"若P则恢复效果转变为附加自身最大体力n/d的百分比伤害"——flat_immune 挡百分比类）
  if (fx.pctSwapIf !== undefined && (fx.pctSwapIf.when === undefined || condEval(ctx, fx.pctSwapIf.when))) {
    if (foe.currentHp > 0 && (fx.plain === true || !flatImmuneOn(foe))) {
      const amt = Math.floor((unit.base.hp * fx.pctSwapIf.n) / Math.max(1, fx.pctSwapIf.d));
      if (amt > 0) {
        foe.currentHp = Math.max(0, foe.currentHp - amt);
        events.push({ type: "damage", detail: { side: OTHER[side], amount: amt, hpAfter: { current: foe.currentHp, max: foe.base.hp }, damageKind: "percent", cause: "heal_swap" } });
        return checkpoint(pack, next, events, ctx.rng);
      }
    }
    return "continue";
  }
  // flatPerAlive：每 N 只己方存活精灵恢复 add 点（"己方每有1只精灵存活则恢复50点体力"）
  if (fx.flatPerAlive !== undefined) {
    const sd = next.sides[side];
    const alive = (sd.unit !== undefined && sd.unit.currentHp > 0 ? 1 : 0) + (sd.bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true).length;
    const amt = Math.floor(alive / Math.max(1, fx.flatPerAlive.per)) * fx.flatPerAlive.add;
    const before = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), t.currentHp + amt);
    if (t.currentHp > before) events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "per_alive" } });
    return "continue";
  }
  // flatPerFoeBench：对手每有 N 只不在场精灵恢复 add 点（"对手每有一只不在场精灵则恢复N点"——bench 槽位计数，含阵亡）
  if (fx.flatPerFoeBench !== undefined) {
    const sd = next.sides[OTHER[side]];
    const cnt = (fx.flatPerFoeBench.aliveOnly === true ? (sd.bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true) : (sd.bench ?? [])).length;
    const amt = Math.floor(cnt / Math.max(1, fx.flatPerFoeBench.per)) * fx.flatPerFoeBench.add;
    const before = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), t.currentHp + amt);
    if (t.currentHp > before) events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "per_foe_bench" } });
    return "continue";
  }
  // fracPerFoeBench：对手每有 N 只不在场精灵恢复 maxHp×n/d（"对手每有一只不在场精灵则恢复1/10"——分数×bench 数）
  if (fx.fracPerFoeBench !== undefined) {
    const sd = next.sides[OTHER[side]];
    const cnt = (fx.fracPerFoeBench.aliveOnly === true ? (sd.bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true) : (sd.bench ?? [])).length;
    const amt = Math.floor((t.base.hp * fx.fracPerFoeBench.n) / fx.fracPerFoeBench.d) * Math.floor(cnt / Math.max(1, fx.fracPerFoeBench.per));
    const before = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), t.currentHp + amt);
    if (t.currentHp > before) events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "per_foe_bench" } });
    return "continue";
  }
  // flatPerStage：每 N 种正/负 stage 恢复 add 点（"每处于1种能力提升状态则恢复30点体力"——stage 种类计数，非等级和）
  if (fx.flatPerStage !== undefined) {
    const src = fx.flatPerStage.who === "foe" ? foe : unit;
    const sign = fx.flatPerStage.sign ?? "up";
    const cnt = Object.values(src.stages).filter((v) => (sign === "up" ? v > 0 : v < 0)).length;
    const amt = Math.floor(cnt / Math.max(1, fx.flatPerStage.per)) * fx.flatPerStage.flat;
    if (amt > 0) {
      const before = t.currentHp;
      t.currentHp = Math.min(hpCapOf(t), t.currentHp + amt);
      if (t.currentHp > before) events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "per_stage" } });
    }
    return "continue";
  }
  // setPct：体力置为最大体力百分比（"令自身体力等于最大体力的50%"——非加算，置位语义）
  if (fx.setPct !== undefined) {
    const before0 = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), Math.max(0, Math.floor((t.base.hp * fx.setPct) / 100)));
    events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before0, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "hp_set" } });
    return "continue";
  }
  // set：体力置为定值（"将对手体力变为350"——非加算，置位语义；早于 noHealOn/hp-full 门——置位不是回复）
  if (fx.set !== undefined) {
    const before0 = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), Math.max(0, fx.set));
    events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before0, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "hp_set" } });
    return "continue";
  }
  // setRange：体力置为区间随机值（"变为N-M点体力"——非加算，置位语义）
  if (fx.setRange !== undefined) {
    const v = fx.setRange.min + rng.drawBelow(fx.setRange.max - fx.setRange.min + 1, "hp_set");
    const before0 = t.currentHp;
    t.currentHp = Math.min(hpCapOf(t), Math.max(0, v));
    events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: t.currentHp - before0, hpAfter: { current: t.currentHp, max: t.base.hp }, source: "hp_set" } });
    return "continue";
  }
  if (fx.plain !== true && noHealOn(t)) {
    events.push({ type: "action-failed", detail: { side, reason: "heal-blocked" } });
    // 禁疗反噬（"对手无法通过自身技能恢复体力且受到原本恢复量N/M的百分比伤害"）——heal_block params.echoN/echoD
    const blk = t.effects.find((e) => e.kind === "heal_block" && e.params?.echoN !== undefined);
    if (blk !== undefined) {
      const base = fx.flat ?? Math.floor((t.base.hp * (fx.numerator ?? 1)) / (fx.denominator ?? 1));
      const ed = Math.max(1, Math.floor((base * blk.params!.echoN!) / (blk.params!.echoD ?? 1)));
      t.currentHp = Math.max(0, t.currentHp - ed);
      events.push({ type: "damage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: ed, hpAfter: { current: t.currentHp, max: t.base.hp }, damageKind: "percent", cause: "heal_echo" } });
      return checkpoint(pack, next, events, ctx.rng);
    }
    return "continue";
  }
  // consumeShield：耗盾转奶（"消耗自身护盾并恢复等量体力"——吸收量并入回复额，盾尽即消）
  let shieldAmt = 0;
  if (fx.consumeShield === true && t === unit) {
    for (const e of [...unit.effects]) {
      if (effectDefOf(e.kind)?.dmgShield !== "params" || e.params?.flat === undefined) continue;
      shieldAmt += e.params.flat;
      unit.effects = unit.effects.filter((x) => x !== e);
      events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
    }
    if (shieldAmt === 0) return "continue"; // 无盾可耗——整 op 空转
  }
  // shieldSum：回复量=当前护盾+护罩总值（"恢复等同于护盾、护罩值之和的体力"——读值不消耗）
  if (fx.shieldSum === true && t === unit) {
    for (const e of unit.effects) {
      if (e.kind === "shield" || e.kind === "ward") shieldAmt += typeof e.params?.flat === "number" ? e.params.flat : typeof e.params?.each === "number" ? e.params.each * (e.params.count ?? 1) : 0;
    }
    if (shieldAmt === 0) return "continue"; // 无盾罩可读——整 op 空转
  }
  if (t.currentHp >= t.base.hp && shieldAmt === 0) {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "hp-full" } });
    return "continue";
  }
  let base = shieldAmt > 0 ? shieldAmt
    // statDiff：恢复量 = |自身该维 - 对手该维|（"根据双方防御值之差n…②恢复n点体力"）
    : fx.statDiff !== undefined
    ? statDiffOf(unit, ctx.foe, fx.statDiff, fx.statDiffDenom)
    : fx.statSumPct !== undefined
    ? statSumPctOf(t, fx.statSumPct)
    : fx.perBelowAbs !== undefined
    ? Math.floor(Math.max(0, fx.perBelowAbs.threshold - t.currentHp) / Math.max(1, fx.perBelowAbs.per)) * fx.perBelowAbs.add
    : fx.foeLastHealPct !== undefined
    ? Math.floor(((ctx.foe?.lastHeal ?? 0) * fx.foeLastHealPct) / 100)
    : fx.flat !== undefined
    ? fx.flat
    : fx.flatRange !== undefined
      ? fx.flatRange.min + rng.drawBelow(fx.flatRange.max - fx.flatRange.min + 1, "heal_range")
      : fx.defSumPct !== undefined
        ? Math.floor(((t.base.def + (t.base.sdf ?? 0)) * fx.defSumPct) / 100)
        : Math.floor(((fx.missing === true ? t.base.hp - t.currentHp : t.base.hp) * fx.numerator!) / fx.denominator!);
  // fracIf：条件换分数（"自身体力低于1/2变为吸取1/2"——满足时按新分数而非基础分数）
  if (fx.fracIf !== undefined && fx.flat === undefined && fx.flatRange === undefined && condEval(ctx, fx.fracIf.when)) {
    base = Math.floor((t.base.hp * fx.fracIf.numerator) / fx.fracIf.denominator);
  }
  // mulIf：条件回复翻倍（"体力低于1/2时恢复效果翻倍"）
  let amount = fx.mulIf !== undefined && condEval(ctx, fx.mulIf.when)
    ? Math.floor((base * fx.mulIf.numerator) / fx.mulIf.denominator)
    : base;
  // 减疗/回复提升窗口（healCut/healBoost flag）——plain（tick 语义）不吃外部增减
  const cutPct = fx.plain === true ? 0 : healCutPctOf(t);
  if (cutPct > 0) amount = Math.floor((amount * (100 - cutPct)) / 100);
  const boostPct = fx.plain === true ? 0 : healBoostPctOf(t, ctx.foe);
  if (boostPct > 0) amount = Math.floor((amount * (100 + boostPct)) / 100);
  // 回复上限（"最多获得N点"尾句——healCap attachAll 回挂）
  if (fx.cap !== undefined) amount = Math.min(amount, fx.cap);
  // capFrac：恢复至最大体力 n/d（"最多恢复至自身最大体力的1/2"——回复后 HP 不得越顶，封顶差值为上限）
  if (fx.capFracN !== undefined) amount = Math.min(amount, Math.max(0, Math.floor((t.base.hp * fx.capFracN) / (fx.capFracD ?? 1)) - t.currentHp));
  const before = t.currentHp;
  t.currentHp = Math.min(hpCapOf(t), t.currentHp + amount);
  const healed = t.currentHp - before;
  t.lastHeal = healed; // 回复记账（"恢复的体力值低于N则X"谓词——当次 heal 实际回复量）
  t.lastHealOverflow = Math.max(0, amount - healed); // 溢出量记账（"获得等同于溢出量的护罩"——封顶外溢转盾值）
  if (healed > 0) t.prevHeal = healed; // 持久回复快照（跨回合"下次…等同于恢复量"——不随回合清除）
  events.push({ type: "heal", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: healed, hpAfter: { current: t.currentHp, max: t.base.hp }, ...(ctx.statusLabel !== undefined ? { source: `status:${ctx.statusLabel}` } : {}) } });
  // 等量反噬（"恢复自身体力，同时给对手造成等量固定伤害"）——按实际回复量对对手追加 fixed
  const echoFrac = fx.foeEcho === true ? 1 : typeof fx.foeEcho === "object" ? fx.foeEcho.numerator / fx.foeEcho.denominator : 0;
  // foeEchoIf：回响条件门（"恢复体力时若自身体力低于1/2则附加给对手等量百分比伤害"）
  if (echoFrac > 0 && healed > 0 && foe.currentHp > 0 && (fx.foeEchoIf === undefined || condEval(ctx, fx.foeEchoIf.when))) {
    const echoDmg = Math.max(1, Math.floor(healed * echoFrac));
    foe.currentHp = Math.max(0, foe.currentHp - echoDmg);
    events.push({
      type: "damage",
      detail: { side: OTHER[side], amount: echoDmg, hpAfter: { current: foe.currentHp, max: foe.base.hp }, damageKind: "fixed", cause: "echo" },
    });
    return checkpoint(pack, next, events, ctx.rng);
  }
  const selfFrac = fx.selfEcho === true ? 1 : typeof fx.selfEcho === "object" ? fx.selfEcho.numerator / fx.selfEcho.denominator : 0;
  if (selfFrac > 0 && healed > 0 && t.currentHp > 0 && (fx.selfEchoIf === undefined || condEval(ctx, fx.selfEchoIf.when))) {
    const sd = Math.max(1, Math.floor(healed * selfFrac));
    t.currentHp = Math.max(0, t.currentHp - sd);
    events.push({ type: "damage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, amount: sd, hpAfter: { current: t.currentHp, max: t.base.hp }, damageKind: "fixed", cause: "echo" } });
    return checkpoint(pack, next, events, ctx.rng);
  }
  return "continue";
};

/**
 * heal 外包装：trigger 14/15 治疗反应窗（"若对手恢复体力则X"/"若对手当回合恢复体力则X"——同点派发，15 为当回合恢复别名）。
 * 扫描本 op 新增的 heal 事件，向受疗方的对侧持有者派发一次（r14 标记防嵌套治疗重复派发——payload 内 heal 经由自身 wrapper 已派发过）。
 */
export const healOp: OpHandler = (ctx, fx) => {
  const mark = ctx.events.length;
  const cp = healCore(ctx, fx);
  // plain（periodic tick 结算）：tick 回血不触发 trigger14/15 反应窗
  if (fx.plain === true) return cp;
  if (cp === "terminal") return cp;
  for (let i = mark; i < ctx.events.length; i++) {
    const ev = ctx.events[i];
    if (ev === undefined || ev.type !== "heal") continue;
    const detail = ev.detail as { side: SideId; amount?: number; r14?: boolean };
    if (detail.r14 === true) continue;
    detail.r14 = true;
    const healedSide = detail.side;
    const watchSide = OTHER[healedSide];
    const watcher = ctx.next.sides[watchSide].unit;
    if (watcher.currentHp <= 0) continue;
    const subCtx = { pack: ctx.pack, next: ctx.next, events: ctx.events, side: watchSide, unit: watcher, move: ctx.move, rng: ctx.rng, order: "first" as const };
    for (const trig of [14, 15] as const) {
      const cpR = fireReactive(subCtx, watcher, trig, { dmg: detail.amount ?? 0 });
      if (cpR === "terminal") return "terminal";
      if (cpR !== "continue") return { suspend: cpR.suspend };
    }
  }
  return cp;
};
