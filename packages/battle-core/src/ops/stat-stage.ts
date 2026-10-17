/** ops/stat-stage.ts —— apply_stat_stage：单属性 ±delta（clamp ±6）+ 能力下降免疫钩子。 */
import { MECHANICS, stageKeysFor } from "../mechanics/index.ts";
import { EngineFault, OTHER, type CoreEvent } from "../types.ts";
import { clamp } from "./shared.ts";
import { immuneDegradeOn, noStageUpOn, reflectOn, mirrorStagesOn, STAGE_TICK_CODES, RF } from "./effects.ts";
import { condEval } from "./cond.ts";
import type { OpHandler } from "./types.ts";
import type { Condition } from "../loader.ts";

type DeltaMul = { delta: number; deltaMulIf?: { when: Condition; numerator: number; denominator: number }; deltaMulChance?: { chance: number; numerator: number; denominator: number; perBench?: { of: "alive" | "dead"; per: number } } };

/** 背包存活/阵亡计数（banished 的槽位两边都不计）——与 ops/damage.ts 的 dmgOutPctOf 同一份读法。 */
const benchCounts = (ctx: Parameters<OpHandler>[0]): { alive: number; dead: number } => {
  const b = ctx.next.sides[ctx.side].bench ?? [];
  return { alive: b.filter((x) => x.currentHp > 0 && x.banished !== true).length, dead: b.filter((x) => x.currentHp <= 0).length };
};

// "自身背包内每存活/阵亡N只精灵则X%的几率强化效果翻倍"：判定概率 = min(100, X × max(1, ⌊背包计数/per⌋))
const benchMulChanceOf = (ctx: Parameters<OpHandler>[0], mc: NonNullable<DeltaMul["deltaMulChance"]>): number => {
  const pb = mc.perBench!;
  const c = benchCounts(ctx);
  const cnt = Math.floor((pb.of === "dead" ? c.dead : c.alive) / Math.max(1, pb.per));
  return Math.min(100, mc.chance * Math.max(1, cnt));
};

// 增幅结算：deltaMulIf（条件）与 deltaMulChance（概率）叠乘（"30%概率强化效果翻倍"）
const effDelta = (ctx: Parameters<OpHandler>[0], fx: DeltaMul): number => {
  let d = fx.delta;
  if (fx.deltaMulIf !== undefined && condEval(ctx, fx.deltaMulIf.when)) d = Math.floor((d * fx.deltaMulIf.numerator) / fx.deltaMulIf.denominator);
  if (fx.deltaMulChance !== undefined) {
    const chance = fx.deltaMulChance.perBench !== undefined ? benchMulChanceOf(ctx, fx.deltaMulChance) : fx.deltaMulChance.chance;
    if (ctx.rng.drawBelow(100, "stage_mul_chance") < chance) d = Math.floor((d * fx.deltaMulChance.numerator) / fx.deltaMulChance.denominator);
  }
  return d;
};

export const statStageOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, unit, foe, targetSide, rng } = ctx;
  if (fx.op !== "apply_stat_stage") throw new EngineFault("OP_DISPATCH", `apply_stat_stage handler got ${fx.op}`);
  // 全维翻倍（"自身强化状态翻倍"）：target 侧全部正级 ×2（clamp ±6）
  if (fx.multiplySelf === true) {
    const t = fx.target === "opponent" ? foe : unit;
    let applied = 0;
    for (const k of stageKeysFor(pack)) {
      const before = t.stages[k] ?? 0;
      if (before <= 0) continue;
      const after = clamp(before * 2, -6, 6);
      if (after === before) continue;
      applied++;
      t.stages[k] = after;
      (t.stageUpLog ??= []).push(k); // 提升日志（"与上回合增加的属性不同"谓词）
      events.push({ type: "stat-stage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, stat: k, deltaApplied: after - before, stageAfter: after } });
    }
    if (applied === 0) events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
    return "continue";
  }
  // 随机多维：stat:"random" + randomCount → 从 pack stage 键中不重复抽 N 项（"随机使对手N种能力等级-1"）
  // plain（tick 语义）：抽满 randomCount 次不重试、不吃免疫/锁/反弹、无 action-failed
  if (fx.stat === "random") {
    const t = fx.target === "opponent" ? foe : unit;
    const keys = [...(fx.plain === true ? STAGE_TICK_CODES : stageKeysFor(pack))];
    let applied = 0;
    const count = fx.randomCount ?? 1;
    while (keys.length > 0 && applied < count) {
      const i = rng.drawBelow(keys.length, fx.plain === true ? "stage_tick_pick" : "stat_pick");
      const k = keys.splice(i, 1)[0]!;
      const before = t.stages[k] ?? 0;
      const delta = effDelta(ctx, fx);
      const after = clamp(before + delta, -6, 6);
      if (after === before) {
        if (fx.plain === true) applied++;
        continue;
      }
      applied++;
      t.stages[k] = after;
      if (delta > 0) (t.stageUpLog ??= []).push(k);
      events.push({ type: "stat-stage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, stat: k, deltaApplied: after - before, stageAfter: after, ...(ctx.statusLabel !== undefined ? { source: `status:${ctx.statusLabel}` } : {}) } });
    }
    if (applied === 0 && fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
    return "continue";
  }
  if (fx.stat === "all") throw new EngineFault("OP_SCHEMA", "stat:all requires multiplySelf");
  const statKey = fx.stat;
  const t = fx.target === "opponent" ? foe : unit;
  const before = t.stages[statKey] ?? 0;
  // 条件/概率增幅（"自身体力低于1/2时强化效果翻倍"、"30%概率强化翻倍"）：delta ×n/d
  const delta = effDelta(ctx, fx);
  if (delta === 0) {
    events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
    return "continue";
  }
  // 能力下降免疫（魂印等）：负 delta 打在有免疫的目标上 → 机制反馈事件，跳过该 op。plain（tick）不吃免疫/反弹
  if (delta < 0 && fx.plain !== true) {
    // 能力下降反弹（"反弹对手给予的能力下降状态"）：目标持 reflect_degrade → 负级改落施加方。
    // 仅当目标是对方单位时反弹（target=opponent 且对手持旗→弹回 unit）；自压级不弹。
    if (fx.target === "opponent" && t === foe && reflectOn(t, RF.degrade)) {
      events.push({ type: "control-immune", detail: { side: targetSide, name: "reflect_degrade" } });
      const uBefore = unit.stages[statKey] ?? 0;
      const uAfter = clamp(uBefore + delta, -6, 6);
      if (uAfter !== uBefore) {
        unit.stages[statKey] = uAfter;
        events.push({ type: "stat-stage", detail: { side, stat: statKey, deltaApplied: uAfter - uBefore, stageAfter: uAfter } });
      }
      return "continue";
    }
    // 计时窗口（"免疫能力下降N回合"）先于机制免疫判定。
    if (immuneDegradeOn(t)) {
      t.immuneThisTurn = (t.immuneThisTurn ?? 0) + 1;
      t.immunedMask = (t.immunedMask ?? 0) | 16; // bit16=能力下降
      events.push({ type: "control-immune", detail: { side: targetSide, name: "immune_degrade" } });
      return "continue";
    }
    for (const m of MECHANICS) {
      const ref = m.stageDropImmune?.({ pack, unit: t });
      if (ref !== undefined) {
        events.push({ type: ref.type as CoreEvent["type"], detail: { side: targetSide, mark: ref.mark, name: ref.name, effect: "immune_stage_down" } });
        return "continue";
      }
    }
  }
  // 锁强化窗口（noStageUp flag："对手无法使自身能力出现提升状态"）——正 delta 打在持有者上被拦（tick 不吃）
  if (delta > 0 && fx.plain !== true && noStageUpOn(t)) {
    events.push({ type: "control-immune", detail: { side: targetSide, name: "no_stage_up" } });
    return "continue";
  }
  const after = clamp(before + delta, -6, 6);
  if (after === before) {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "stage-at-cap" } });
    return "continue";
  }
  t.stages[statKey] = after;
  if (delta > 0) (t.stageUpLog ??= []).push(statKey);
  events.push({ type: "stat-stage", detail: { side: fx.target === "opponent" ? OTHER[side] : side, stat: statKey, deltaApplied: after - before, stageAfter: after, ...(ctx.statusLabel !== undefined ? { source: `status:${ctx.statusLabel}` } : {}) } });
  // mirror_stages：对手能力变化同步落到持有者（"对手的状态变化会同时作用在自己的身上"——变化目标的对方单位持旗时镜像同 delta；tick 不镜像）
  const mirror = t === unit ? foe : unit;
  if (fx.plain !== true && mirror !== undefined && mirror !== t && mirror.currentHp > 0 && mirrorStagesOn(mirror)) {
    const mb = mirror.stages[statKey] ?? 0;
    const ma = clamp(mb + delta, -6, 6);
    if (ma !== mb) {
      mirror.stages[statKey] = ma;
      events.push({ type: "stat-stage", detail: { side: t === unit ? OTHER[side] : side, stat: statKey, deltaApplied: ma - mb, stageAfter: ma } });
    }
  }
  return "continue";
};
