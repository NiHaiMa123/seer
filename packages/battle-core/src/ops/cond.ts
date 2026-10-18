/**
 * ops/cond.ts —— op 信封条件谓词求值（可组合 and/or/not，全整数比较）。
 * HP 比较用 currentHp·den ? numerator·maxHp，无浮点。
 */
import type { Condition } from "../loader.ts";
import { effectDefOf, shieldFlatOf, flatImmuneOn, battleTypesOf, statDiffOf } from "./effects.ts";
import { markCount, fieldMarkKinds } from "./mark.ts";
import { OTHER } from "../types.ts";
import { stageKeysFor } from "../mechanics/index.ts";
import { effectivenessOf } from "./shared.ts";
import type { OpCtx } from "./types.ts";

export function condEval(c: OpCtx, cond: Condition): boolean {
  if ("and" in cond) return cond.and.every((x) => condEval(c, x));
  if ("or" in cond) return cond.or.some((x) => condEval(c, x));
  if ("not" in cond) return !condEval(c, cond.not);
  if ("selfHpBelow" in cond) return c.unit.currentHp * cond.selfHpBelow.denominator < cond.selfHpBelow.numerator * c.unit.base.hp;
  if ("selfHpAbove" in cond) return c.unit.currentHp * cond.selfHpAbove.denominator > cond.selfHpAbove.numerator * c.unit.base.hp;
  if ("selfHpBelowAbs" in cond) return c.unit.currentHp < cond.selfHpBelowAbs;
  if ("selfHpAboveAbs" in cond) return c.unit.currentHp > cond.selfHpAboveAbs;
  if ("selfMaxHpAbove" in cond) return c.unit.base.hp > cond.selfMaxHpAbove; // 面板体力上限阈（"体力上限大于2000"）
  if ("selfMaxHpBelow" in cond) return c.unit.base.hp < cond.selfMaxHpBelow;
  if ("foeHpBelow" in cond) return c.foe.currentHp * cond.foeHpBelow.denominator < cond.foeHpBelow.numerator * c.foe.base.hp;
  // foeBelowSelfHpFrac：对手当前体力 < 观察者自身最大体力×n/d（"对手体力小于自身最大HP的1/2"——跨单位基准）
  if ("foeBelowSelfHpFrac" in cond) return c.foe.currentHp * cond.foeBelowSelfHpFrac.denominator < cond.foeBelowSelfHpFrac.numerator * c.unit.base.hp;
  if ("foeHpBelowAbs" in cond) return c.foe.currentHp < cond.foeHpBelowAbs;
  if ("foeHpAboveAbs" in cond) return c.foe.currentHp > cond.foeHpAboveAbs;
  if ("foeHpAbove" in cond) return c.foe.currentHp * cond.foeHpAbove.denominator > cond.foeHpAbove.numerator * c.foe.base.hp;
  if ("order" in cond) return c.order === cond.order;
  if ("foeHas" in cond) return c.foe.effects.some((e) => e.kind === cond.foeHas || e.kind.startsWith(`${cond.foeHas}:`));
  if ("selfHas" in cond) return c.unit.effects.some((e) => e.kind === cond.selfHas || e.kind.startsWith(`${cond.selfHas}:`));
  if ("foeStatused" in cond) return c.foe.effects.some((e) => effectDefOf(e.kind)?.ailment === true);
  if ("foeNoTimedFx" in cond) return c.foe.effects.length === 0; // 回合类效果=挂在 effects[] 的计时条目
  if ("foeHasTimed" in cond) return c.foe.effects.some((e) => e.remainingTurns !== undefined); // "若对手处于回合类效果则X"
  if ("selfNoTimedFx" in cond) return !c.unit.effects.some((e) => e.remainingTurns !== undefined); // "自身不存在回合类效果则X"
  if ("selfHasTimed" in cond) return c.unit.effects.some((e) => e.remainingTurns !== undefined);
  if ("selfStatused" in cond) return c.unit.effects.some((e) => effectDefOf(e.kind)?.ailment === true);
  if ("foeStageUp" in cond) return Object.values(c.foe.stages).some((v) => v > 0);
  if ("foeStageDown" in cond) return Object.values(c.foe.stages).some((v) => v < 0);
  if ("selfStageUp" in cond) return Object.values(c.unit.stages).some((v) => v > 0);
  if ("selfStageDown" in cond) return Object.values(c.unit.stages).some((v) => v < 0);
  // selfStageDownStart：回合开始快照中自身处于能力下降（"回合开始时若自身处于能力下降状态"——turnStartStages 即回合开始时点）
  if ("selfStageDownStart" in cond) return Object.values(c.unit.turnStartStages ?? c.unit.stages).some((v) => v < 0);
  if ("foeStageDownStart" in cond) return Object.values(c.foe.turnStartStages ?? c.foe.stages).some((v) => v < 0);
  // selfShieldBelow：当前护盾/护罩总值低于绝对值（"若当前护罩值低于200则固伤翻倍"）；shieldConsumedBelow：最近一次消耗量低于（消耗语义下"当前值"=消耗值）
  if ("selfShieldBelow" in cond) return shieldFlatOf(c.unit) < cond.selfShieldBelow;
  if ("shieldConsumedBelow" in cond) return (c.unit.lastShieldConsumed ?? 0) < cond.shieldConsumedBelow;
  if ("shieldConsumedAbove" in cond) return (c.unit.lastShieldConsumed ?? 0) > cond.shieldConsumedAbove;
  // foeStageAboveSelf：对手任一能力等级高于自身同维（"若对手有高于自身的能力等级"）
  if ("foeStageAboveSelf" in cond) return (Object.keys(c.foe.stages) as (keyof typeof c.foe.stages)[]).some((k) => (c.foe.stages[k] ?? 0) > (c.unit.stages[k] ?? 0));
  // selfStageAboveFoe：自身任一能力等级高于对手同维（"自身所有能力等级均不高于对手"→not 包裹）
  if ("selfStageAboveFoe" in cond) return (Object.keys(c.unit.stages) as (keyof typeof c.unit.stages)[]).some((k) => (c.unit.stages[k] ?? 0) > (c.foe.stages[k] ?? 0));
  if ("statAtLeast" in cond) return (c.foe.stages[cond.statAtLeast.stat] ?? 0) >= cond.statAtLeast.stage;
  if ("selfStatAtLeast" in cond) return (c.unit.stages[cond.selfStatAtLeast.stat] ?? 0) >= cond.selfStatAtLeast.stage;
  if ("prevApplied" in cond) return c.prevApplied === true;
  // noneApplied：本招此前所有 op 均未生效（"均未触发则令自身攻击-2"）
  if ("noneApplied" in cond) return (c.noneApplied ?? false) === cond.noneApplied;
  // foeFlatImmune：对手处于固伤/百分比免疫（"若对手免疫百分比伤害则…"）
  if ("foeFlatImmune" in cond) return c.foe !== undefined && flatImmuneOn(c.foe);
  if ("foeFainted" in cond) return c.foe.currentHp <= 0;
  if ("selfHpFull" in cond) return c.unit.currentHp >= c.unit.base.hp;
  if ("prevDamageBelowAbs" in cond) return (c.lastDamage ?? 0) < cond.prevDamageBelowAbs;
  // selfPrioAbove：本招基础先制级>N（"自身先制等级大于0时提升为+2"——priority 排序语境读 move.priority）
  if ("selfPrioAbove" in cond) return (c.move?.priority ?? 0) > cond.selfPrioAbove;
  if ("prevDamageAboveAbs" in cond) return (c.lastDamage ?? 0) > cond.prevDamageAboveAbs;
  // prevDamageBelowFoeFrac：上一 damage 低于对手最大体力分数（"造成的伤害低于对手最大体力的1/3"）
  if ("prevDamageBelowFoeFrac" in cond) return (c.lastDamage ?? 0) * cond.prevDamageBelowFoeFrac.denominator < cond.prevDamageBelowFoeFrac.numerator * c.foe.base.hp;
  // prevDamageAboveFoeFrac：上一 damage 高于对手最大体力分数（"伤害高于对手最大体力的1/3"）
  if ("prevDamageAboveFoeFrac" in cond) return (c.lastDamage ?? 0) * cond.prevDamageAboveFoeFrac.denominator > cond.prevDamageAboveFoeFrac.numerator * c.foe.base.hp;
  if ("prevCrit" in cond) return c.lastCrit === true;
  // prevDamageNotKind：上一 damage 非该类型（"若对手未受到固定伤害则X"→lastDamageKind!=="fixed"，无伤害事件也算未受到）
  if ("prevDamageNotKind" in cond) return c.lastDamageKind !== cond.prevDamageNotKind;
  // prevDamageAboveFoeHp：上一 damage 超过对手当前体力（"伤害大于对方体力时，对方会余下1体力"谓词）
  if ("prevDamageAboveFoeHp" in cond) return (c.lastDamage ?? 0) > c.foe.currentHp;
  if ("prevDamageKind" in cond) return c.lastDamageKind === cond.prevDamageKind;
  // prevDamageOdd/Even：上一伤害奇偶（"若伤害为奇数"/"若为偶数"谓词）
  if ("prevDamageOdd" in cond) return ((c.lastDamage ?? 0) % 2) === 1;
  if ("prevDamageEven" in cond) return c.lastDamage !== undefined && c.lastDamage % 2 === 0;
  // prevTakenZero：上回合自身未承受伤害（行动开始时 prevTaken 快照为 0）
  if ("prevTakenZero" in cond) return (c.unit.prevTaken ?? 0) === 0;
  // takenBelowHpFrac：本回合已承受伤害 < 自身最大体力分数（"受到的攻击伤害低于自身最大体力的1/3则X"——lastTaken 当回合记账）
  if ("takenBelowHpFrac" in cond) return (c.unit.lastTaken ?? 0) < Math.floor((c.unit.base.hp * cond.takenBelowHpFrac.numerator) / cond.takenBelowHpFrac.denominator);
  // takenBelowAbs：本回合已承受伤害 < 绝对值（"受到的攻击伤害低于300则X"）
  if ("takenBelowAbs" in cond) return (c.unit.lastTaken ?? 0) < cond.takenBelowAbs;
  // takenAboveAbs：本回合最近一次受击伤害 > 绝对值（"每次受到的攻击伤害高于300则X"）
  if ("takenAboveAbs" in cond) return (c.unit.lastTaken ?? 0) > cond.takenAboveAbs;
  // takenAboveHpFrac：本回合受击伤害 > 自身最大体力分数（"受到的攻击伤害高于最大体力的1/2则X"）
  if ("takenAboveHpFrac" in cond) return (c.unit.lastTaken ?? 0) > Math.floor((c.unit.base.hp * cond.takenAboveHpFrac.numerator) / cond.takenAboveHpFrac.denominator);
  // takenAboveCurFrac：本回合承伤 > 当前体力 N/M（"受到伤害高于自身当前体力1/2"）
  if ("takenAboveCurFrac" in cond) return (c.unit.lastTaken ?? 0) > Math.floor((c.unit.currentHp * cond.takenAboveCurFrac.numerator) / cond.takenAboveCurFrac.denominator);
  // takenKind：本回合最近一次受击的伤害类型（"受到真实伤害后X"——lastTakenKind 当回合记账，无受击则 undefined 不命中）
  if ("takenKind" in cond) return c.unit.lastTakenKind === cond.takenKind;
  // prevHealBelow/Above：当次回复量阈值谓词（"恢复的体力值低于200则X"——lastHeal 当次 heal 记账）
  if ("prevHealBelow" in cond) return (c.unit.lastHeal ?? 0) < cond.prevHealBelow;
  if ("prevHealAbove" in cond) return (c.unit.lastHeal ?? 0) > cond.prevHealAbove;
  // foeTakenZero：对手未承受伤害（"对手未受到攻击伤害则X"——foe.prevTaken 快照为 0）
  if ("foeTakenZero" in cond) return (c.foe.prevTaken ?? 0) === 0;
  // turnEq：回合序数谓词（"第2回合X"——CoreState.turn 计数）
  if ("turnEq" in cond) return c.next.turn === cond.turnEq;
  // eitherAilOrDown：任一方场上单位处于异常或能力下降（foe_dot anyAilDegrade 门："双方任一方处于异常状态或能力下降状态时"）
  if ("eitherAilOrDown" in cond) {
    const has = (u: { effects: { kind: string }[]; stages: Record<string, number | undefined> }) =>
      u.effects.some((e) => effectDefOf(e.kind)?.ailment === true) || Object.values(u.stages).some((v) => (v ?? 0) < 0);
    return has(c.unit) || has(c.foe);
  }
  // selfDealtAboveAbs：持有者本回合已造成伤害量 ≥N（dealt_tick 附加量门——读 dealtThisTurn 累计）
  if ("selfDealtAboveAbs" in cond) return (c.unit.dealtThisTurn ?? 0) >= cond.selfDealtAboveAbs;
  // turnParity：回合奇偶谓词（"单数回合结束时X"/"偶数回合结束时X"）
  if ("turnParity" in cond) return c.next.turn % 2 === (cond.turnParity === "odd" ? 1 : 0);
  // foeMaxHpAboveSelf：对手最大体力 > 自身最大体力（"对手的最大体力值高于自身则X"）
  if ("foeMaxHpAboveSelf" in cond) return c.foe.base.hp > c.unit.base.hp;
  // prevEffWeak：上一伤害克制倍率微弱（"克制关系为微弱"谓词；无效也算微弱？不——微弱仅指 0<eff<1）
  if ("prevEffWeak" in cond) return c.lastEff16 !== undefined && c.lastEff16 > 0 && c.lastEff16 < 16;
  if ("foeHpMaxAbove" in cond) return c.foe.base.hp > cond.foeHpMaxAbove;
  if ("selfHpBelowFoe" in cond) return c.unit.currentHp < c.foe.currentHp;
  if ("selfHpAboveFoe" in cond) return c.unit.currentHp > c.foe.currentHp;
  if ("foeHpAboveSelf" in cond) return c.foe.currentHp > c.unit.currentHp;
  if ("foeCountersUs" in cond) {
    const chart = c.pack.typeChart;
    if (chart === undefined) return false;
    const foeTypes = battleTypesOf(c.pack, c.foe, c.unit);
    const selfTypes = battleTypesOf(c.pack, c.unit, c.foe);
    return foeTypes.some((t) => effectivenessOf(chart, t, selfTypes) > 16);
  }
  // effWeakVsFoe：本招式属性对对手微弱（"克制关系为微弱则先制+N"——先制判定时读 move.type 而非上次伤害）
  if ("effWeakVsFoe" in cond) {
    const chart = c.pack.typeChart;
    if (chart === undefined || c.move?.type === undefined) return false;
    const foeTypes = battleTypesOf(c.pack, c.foe, c.unit);
    const eff = effectivenessOf(chart, c.move.type, foeTypes);
    return eff > 0 && eff < 16;
  }
  if ("weCounterFoe" in cond) {
    const chart = c.pack.typeChart;
    if (chart === undefined) return false;
    const foeTypes = battleTypesOf(c.pack, c.foe, c.unit);
    const selfTypes = battleTypesOf(c.pack, c.unit, c.foe);
    return selfTypes.some((t) => effectivenessOf(chart, t, foeTypes) > 16);
  }
  if ("foePpLt" in cond) return c.foe.moves.filter((m) => m.pp < cond.foePpLt.lt).length >= cond.foePpLt.count;
  // selfPpSumAboveFoe：自身所有技能 PP 总和 > 对手（"自身的PP值总和高于对手时…"）
  if ("selfPpSumAboveFoe" in cond) {
    const ppSum = (u: { moves: { pp: number }[] }) => u.moves.reduce((a, m) => a + m.pp, 0);
    return c.foe !== undefined && ppSum(c.unit) > ppSum(c.foe);
  }
  // ppAt：指定槽位 PP 等于 value（"对手第五技能PP值为0时"——slot="fifth" 按 fifth:true 标记槽解析，N=1-based 序号）
  if ("ppAt" in cond) {
    const holder = cond.ppAt.on === "self" ? c.unit : c.foe;
    if (cond.ppAt.slot === "any") return holder.moves.some((m) => m.pp === cond.ppAt.value); // "任意1个技能PP值为零时"——存在槽位判定
    const slot = cond.ppAt.slot === "fifth"
      ? holder.moves.find((m) => c.pack.movesById.get(m.moveId)?.fifth === true)
      : holder.moves[cond.ppAt.slot - 1];
    return slot !== undefined && slot.pp === cond.ppAt.value;
  }
  // markCountAtLeast：印记层数门槛（"对手每存在1层致命裂痕则"→{mark:致命裂痕,n:1,on:foe}）
  if ("markCountAtLeast" in cond) return markCount(c, cond.markCountAtLeast) >= cond.markCountAtLeast.n;
  // fieldMarkKindsAtLeast：场地印记种类数门槛（"场上每有1种五行印记"）
  if ("fieldMarkKindsAtLeast" in cond) return fieldMarkKinds(c.next, cond.fieldMarkKindsAtLeast.on ?? "self", c.side === "p1" ? "p1" : "p2") >= cond.fieldMarkKindsAtLeast.n;
  // benchNameCount：背包内物种名含 substr 的单位数 ≥ count（"背包内每存在3种X精灵"）
  if ("benchNameCount" in cond) {
    const bench = c.next.sides[c.side].bench ?? [];
    const n = bench.filter((b) => (c.pack.unitsById.get(b.speciesId)?.name ?? "").includes(cond.benchNameCount.substr)).length;
    return n >= cond.benchNameCount.count;
  }
  if ("sameAttr" in cond) {
    const self = [...battleTypesOf(c.pack, c.unit, c.foe)].sort().join("");
    const foe = [...battleTypesOf(c.pack, c.foe, c.unit)].sort().join("");
    return self !== "" && self === foe;
  }
  // foeTypeIs/foeTypeNot：对手系别判定（"若对手不是龙系精灵则…"——types 裸名与"X系"写法对齐）
  if ("foeTypeIs" in cond) {
    const want = cond.foeTypeIs.replace(/系$/, "");
    return (c.pack.unitsById.get(c.foe.speciesId)?.types ?? []).some((t) => t.replace(/系$/, "") === want);
  }
  if ("foeTypeNot" in cond) {
    const want = cond.foeTypeNot.replace(/系$/, "");
    return !(c.pack.unitsById.get(c.foe.speciesId)?.types ?? []).some((t) => t.replace(/系$/, "") === want);
  }
  // foeAboveSelfHpFrac：对手当前体力 > 观察者自身最大体力×n/d（"对手体力高于自身最大HP的1/2"）
  if ("foeAboveSelfHpFrac" in cond) return c.foe.currentHp * cond.foeAboveSelfHpFrac.denominator > cond.foeAboveSelfHpFrac.numerator * c.unit.base.hp;
  // hpEqTurnStart / hpBelowTurnStart：体力 =/＜ 回合开始快照（"若自身体力等于回合开始时"——turnStartHp 每回合首写入）
  if ("hpEqTurnStart" in cond) return c.unit.turnStartHp !== undefined && c.unit.currentHp === c.unit.turnStartHp;
  if ("hpBelowTurnStart" in cond) return c.unit.turnStartHp !== undefined && c.unit.currentHp < c.unit.turnStartHp;
  if ("hpAboveTurnStart" in cond) return c.unit.turnStartHp !== undefined && c.unit.currentHp > c.unit.turnStartHp;
  // hpBelowTurnStartFrac：当前体力 < 回合开始快照×n/d（"体力低于当回合开始时的50%则X"）
  if ("hpBelowTurnStartFrac" in cond) { const f = cond.hpBelowTurnStartFrac; return c.unit.turnStartHp !== undefined && c.unit.currentHp * f.denominator < c.unit.turnStartHp * f.numerator; }
  // foeHpBelowTurnStart：对手体力 < 其回合开始快照（"对手损失体力则"——快照自同侧记账）
  if ("foeHpBelowTurnStart" in cond) return c.foe !== undefined && c.foe.turnStartHp !== undefined && c.foe.currentHp < c.foe.turnStartHp;
  // turnHpLossAbove：本回合体力净减少量 > N（"当回合自身体力减少量大于400"——turnStartHp-currentHp）
  if ("turnHpLossAbove" in cond) return c.unit.turnStartHp !== undefined && c.unit.turnStartHp - c.unit.currentHp > cond.turnHpLossAbove;
  // stageEqTurnStart：指定能力等级等于回合开始快照（"与回合开始时的强化相同"）
  if ("stageEqTurnStart" in cond) return c.unit.turnStartStages !== undefined && (c.unit.stages[cond.stageEqTurnStart.stat] ?? 0) === (c.unit.turnStartStages[cond.stageEqTurnStart.stat] ?? 0);
  // everyNTurns：回合整除门（"每N回合"/"战斗每开始N回合"）
  if ("everyNTurns" in cond) return c.next.turn % cond.everyNTurns === 0;
  // missStreakAtLeast：连续闪避对手攻击 ≥N 次（防守方 missStreak 计数）
  if ("missStreakAtLeast" in cond) return (c.unit.missStreak ?? 0) >= cond.missStreakAtLeast;
  // stageUpSamePrev/stageUpDiffPrev：本回合提升键与上回合提升日志比较（"与上回合增加的属性相同/不同"）
  if ("stageUpSamePrev" in cond) {
    const cur = c.unit.stageUpLog ?? []; const prev = new Set(c.unit.prevStageUpLog ?? []);
    return cur.length > 0 && cur.every((k) => prev.has(k));
  }
  if ("stageUpDiffPrev" in cond) {
    const cur = c.unit.stageUpLog ?? []; const prev = new Set(c.unit.prevStageUpLog ?? []);
    return cur.some((k) => !prev.has(k));
  }
  // foeGender：对手性别门（pack CompiledUnit.gender——无数据按 "none" 处理）
  if ("foeGender" in cond) return (c.pack.unitsById.get(c.foe.speciesId)?.gender ?? "none") === cond.foeGender;
  // benchAliveEq/benchAllDead：己方背包存活数（"背包内精灵全部阵亡则"→benchAliveEq:0 等价 benchAllDead）
  if ("benchAliveEq" in cond) return (c.next.sides[c.side].bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true).length === cond.benchAliveEq;
  if ("benchAllDead" in cond) return (c.next.sides[c.side].bench ?? []).every((b) => b.currentHp <= 0);
  // benchAllFull：背包内精灵全部满体力（"己方不在场精灵皆为满体力"）
  if ("benchAllFull" in cond) return (c.next.sides[c.side].bench ?? []).length > 0 && (c.next.sides[c.side].bench ?? []).every((b) => b.currentHp >= b.base.hp);
  // foeImmunedThisTurn：对手本回合成功免疫过（immuneThisTurn 记账在对端 unit 上）
  if ("foeImmunedThisTurn" in cond) return c.foe !== undefined && (c.foe.immuneThisTurn ?? 0) > 0;
  // foeHpAboveTurnStart：对手体力 > 其回合开始快照
  if ("foeHpAboveTurnStart" in cond) return c.foe !== undefined && c.foe.turnStartHp !== undefined && c.foe.currentHp > c.foe.turnStartHp;
  // turnHpDiffAbove：本回合体力绝对差值 > N（"自身体力与回合开始时体力差大于200"）
  if ("turnHpDiffAbove" in cond) return c.unit.turnStartHp !== undefined && Math.abs(c.unit.turnStartHp - c.unit.currentHp) > cond.turnHpDiffAbove;
  // selfStageSumAtLeast：指定维提升等级总和 ≥ n（"双防提升等级总和大于等于6"）
  if ("selfStageSumAtLeast" in cond) return cond.selfStageSumAtLeast.stats.reduce((acc, st) => acc + Math.max(0, c.unit.stages[st] ?? 0), 0) >= cond.selfStageSumAtLeast.n;
  // foeBaseStatBelow/Above：对手基础能力值 vs 自身基础能力值（"对手的基础速度值低于自身"——base 面板比较；acc/crt 无 base 面板按 0 计）
  if ("foeBaseStatBelow" in cond) return c.foe !== undefined && ((c.foe.base as Record<string, number | undefined>)[cond.foeBaseStatBelow] ?? 0) < ((c.unit.base as Record<string, number | undefined>)[cond.foeBaseStatBelow] ?? 0);
  if ("foeBaseStatAbove" in cond) return c.foe !== undefined && ((c.foe.base as Record<string, number | undefined>)[cond.foeBaseStatAbove] ?? 0) > ((c.unit.base as Record<string, number | undefined>)[cond.foeBaseStatAbove] ?? 0);
  // foeBaseStatAboveAbs/BelowAbs：对手基础能力值 vs 绝对阈值（"对手基础速度值高于400则…"）
  if ("foeBaseStatAboveAbs" in cond) return c.foe !== undefined && ((c.foe.base as Record<string, number | undefined>)[cond.foeBaseStatAboveAbs.stat] ?? 0) > cond.foeBaseStatAboveAbs.n;
  if ("foeBaseStatBelowAbs" in cond) return c.foe !== undefined && ((c.foe.base as Record<string, number | undefined>)[cond.foeBaseStatBelowAbs.stat] ?? 0) < cond.foeBaseStatBelowAbs.n;
  // selfDefSumAboveFoe：自身双防基础值总和 > 对手（"若自身双防总和高于对手"）
  if ("selfDefSumAboveFoe" in cond) return c.foe !== undefined && (c.unit.base.def + (c.unit.base.sdf ?? 0)) > (c.foe.base.def + (c.foe.base.sdf ?? 0));
  // stagesAllEqual：双方 n 项能力等级全等（"双方6项能力等级状态全部相同"）
  if ("stagesAllEqual" in cond) {
    if (c.foe === undefined) return false;
    const keys = stageKeysFor(c.pack);
    return keys.filter((k) => (c.unit.stages[k] ?? 0) === (c.foe!.stages[k] ?? 0)).length >= cond.stagesAllEqual;
  }
  // foeBenchDeadPer：对手背包每阵亡 n 只（计费谓词——"对方场下每死亡1只精灵则…"；布尔退化读 ≥n）
  if ("foeBenchDeadPer" in cond) return c.foe !== undefined && Math.floor(((c.next.sides[OTHER[c.side]].bench ?? []).filter((b) => b.currentHp <= 0).length) / Math.max(1, cond.foeBenchDeadPer)) >= 1;
  // foeMoveCat/foeMoveAlwaysHit：对手本回合声明招式的类别/必中（priority 排序语境——"对手选择攻击技能时先制+N"）
  if ("foeMoveCat" in cond) return c.foeMove !== undefined && (cond.foeMoveCat === "attack" ? (c.foeMove.category === "physical" || c.foeMove.category === "special") : c.foeMove.category === undefined);
  if ("foeMoveAlwaysHit" in cond) return c.foeMove?.accuracy === "always";
  // foeMovePrioAbove：对手声明招式先制 >N（"对手使用带有先手效果的技能"→prio>0）
  if ("foeMovePrioAbove" in cond) return (c.foeMove?.priority ?? 0) > cond.foeMovePrioAbove;
  // selfAllStagesUp/foeAllStagesUp：全维 stage 键均 ≥1（"不处于全能力提升状态"→not 包裹——机制键集 pack 感知）
  if ("selfAllStagesUp" in cond) return stageKeysFor(c.pack).every((k) => (c.unit.stages[k] ?? 0) >= 1);
  if ("foeAllStagesUp" in cond) return c.foe !== undefined && stageKeysFor(c.pack).every((k) => (c.foe!.stages[k] ?? 0) >= 1);
  // selfStageSumAboveFoe/BelowFoe：指定维等级代数和 vs 对手同维之和（"双防能力等级之和高于对手"——负级计入）
  if ("selfStageSumAboveFoe" in cond || "selfStageSumBelowFoe" in cond) {
    if (c.foe === undefined) return false;
    const g = "selfStageSumAboveFoe" in cond ? cond.selfStageSumAboveFoe : cond.selfStageSumBelowFoe;
    const sum = (u: { stages: Record<string, number | undefined> }) => g.stats.reduce((a, st) => a + (u.stages[st] ?? 0), 0);
    return "selfStageSumAboveFoe" in cond ? sum(c.unit) > sum(c.foe) : sum(c.unit) < sum(c.foe);
  }
  // ppFullAny：存在 PP 为满的技能槽（"若自身存在技能PP值为满则"）
  if ("ppFullAny" in cond) { const h = cond.ppFullAny.on === "self" ? c.unit : c.foe; return h !== undefined && h.moves.some((mv) => mv.pp === mv.ppMax); }
  // nullifiedCatMask：本回合招式被无效化的类别位掩码（bit1=属性 bit2=物理 bit4=特殊——"若自身的属性技能失效则"）
  if ("nullifiedCatMask" in cond) return ((c.unit.nullifiedMask ?? 0) & cond.nullifiedCatMask) !== 0;
  if ("foeNullifiedCatMask" in cond) return c.foe !== undefined && ((c.foe.nullifiedMask ?? 0) & cond.foeNullifiedCatMask) !== 0;
  // foeAilCountAtLeast：对手异常状态种数 ≥ n（ailment flag 逐种计数）
  if ("foeAilCountAtLeast" in cond) return c.foe !== undefined && c.foe.effects.filter((e) => effectDefOf(e.kind)?.ailment === true).length >= cond.foeAilCountAtLeast;
  // hpDiffAboveAbs：双方当前体力差 ≥ N（"自身当前体力与对手当前体力差值≥200"）
  if ("hpDiffAboveAbs" in cond) return c.foe !== undefined && Math.abs(c.unit.currentHp - c.foe.currentHp) >= cond.hpDiffAboveAbs;
  // orderStreakAtLeast：连续 n 回合先/后出手（orderStreak 记账——同序累计）
  if ("orderStreakAtLeast" in cond) return c.unit.orderStreak?.order === cond.orderStreakAtLeast.order && c.unit.orderStreak.n >= cond.orderStreakAtLeast.n;
  // foeHitStreakAtLeast：对手连续命中 n 次（missStreak 反向读——命中连胜=非MISS连续）
  if ("foeHitStreakAtLeast" in cond) return c.foe !== undefined && (c.foe.hitStreak ?? 0) >= cond.foeHitStreakAtLeast;
  // selfHitStreakAtLeast：自身连续命中 n 次（"攻击技能连续命中2次则"——self.hitStreak 记账）
  if ("selfHitStreakAtLeast" in cond) return (c.unit.hitStreak ?? 0) >= cond.selfHitStreakAtLeast;
  // moveCatSameAsPrev/moveCatDiffPrev：本招类别与上动相同/不同（"类型与上次相同则X"——prevMoveCat 回合初快照）
  if ("moveCatSameAsPrev" in cond || "moveCatDiffPrev" in cond) {
    if (c.unit.prevMoveCat === undefined) return "moveCatSameAsPrev" in cond ? false : true; // 无上动：相同为假，不同为真
    const cur = c.move.effects.some((f) => f.op === "damage") ? (c.move.category === "special" ? 3 : 2) : 1;
    return "moveCatSameAsPrev" in cond ? cur === c.unit.prevMoveCat : cur !== c.unit.prevMoveCat;
  }
  // moveSameAsPrev/moveDiffPrev：本招 ID 与上动相同/不同（"使用技能与上次不相同则X"——prevMoveId 回合初快照；无上动时相同为假、不同为真）
  if ("moveSameAsPrev" in cond || "moveDiffPrev" in cond) {
    if (c.unit.prevMoveId === undefined || c.move.id === undefined) return "moveSameAsPrev" in cond ? false : true;
    return "moveSameAsPrev" in cond ? c.move.id === c.unit.prevMoveId : c.move.id !== c.unit.prevMoveId;
  }
  // entryWasSwitch：本次登场为主动切换（"若本次登场为主动切换登场"——entryKind 记账）
  if ("entryWasSwitch" in cond) return c.unit.entryWasSwitch === true;
  // prioZero：本回合**实际**先制为 0（"双方每有1方精灵先制为0"）。
  // 注意读 turnPrio（engine.prio() 落盘）而不是 move.priority —— 后者是面板值，
  // 看不到 prio_up 窗/条件先制/机制钩子带来的加成。无记录时按面板值兜底。
  if ("prioZero" in cond) {
    const v = c.unit.turnPrio ?? c.move?.priority ?? 0;
    return v === 0;
  }
  // statDiffAbove：|自身该维 - 对手该维| ≥ 阈值（"若n≥200则X"——n 是双方某维之差）
  if ("statDiffAbove" in cond) {
    const spec = cond.statDiffAbove as { stat: string; atLeast: number };
    const foe = c.foe ?? c.target;
    return statDiffOf(c.unit, foe, spec.stat as Parameters<typeof statDiffOf>[2]) >= spec.atLeast;
  }
  // foePrioZero/selfPrioZero：分侧版本（读对手/自身的实际先制）
  if ("foePrioZero" in cond) return (c.foe?.turnPrio ?? c.foeMove?.priority ?? 0) === 0;
  if ("selfPrioZero" in cond) return (c.unit.turnPrio ?? c.move?.priority ?? 0) === 0;
  // damageDigitEq/takenDigitEq：伤害个位数谓词（"造成伤害值尾数为N"）
  if ("damageDigitEq" in cond) return c.lastDamage !== undefined && c.lastDamage % 10 === cond.damageDigitEq;
  if ("takenDigitEq" in cond) return c.unit.lastTaken !== undefined && c.unit.lastTaken % 10 === cond.takenDigitEq;
  // selfStageMax：指定能力等级达 +6（"双防已经达到最高等级"→defSum；all=全部 stage 键）
  if ("selfStageMax" in cond) {
    const g = cond.selfStageMax;
    if (g === "defSum") return (c.unit.stages.def ?? 0) >= 6 && (c.unit.stages.sdf ?? 0) >= 6;
    if (g === "all") return Object.values(c.unit.stages).every((v) => v >= 6);
    return (c.unit.stages[g as keyof typeof c.unit.stages] ?? 0) >= 6;
  }
  // dealtBelowAbs：本回合已造成伤害 < N（"对手造成的伤害低于N"从受方视角读 foe.lastTaken；自身造成读 lastDealt）
  if ("dealtBelowAbs" in cond) return (c.unit.lastDealt ?? 0) < cond.dealtBelowAbs;
  // dmgGtFoeHp：本次已造成伤害 > 对手当前体力（"若造成伤害大于对手体力则留1点血"——leaveHp 生效域）
  if ("dmgGtFoeHp" in cond) return (c.unit.lastDealt ?? 0) > (c.foe?.currentHp ?? Infinity);
  // immunedThisTurn：本回合成功触发过免疫（"若成功触发免疫则"/"每次免疫成功后"）
  if ("immunedThisTurn" in cond) return (c.unit.immuneThisTurn ?? 0) > 0;
  // immunedKind：按种类判定本回合免疫（immunedMask 位掩码——bit1攻击伤害/bit2固伤/bit4百分比/bit8异常控制/bit16能力下降）
  if ("immunedKind" in cond) return ((c.unit.immunedMask ?? 0) & cond.immunedKind) !== 0;
  // foeImmunedKind：对手侧免疫记账（"己方附加的固定伤害和百分比伤害被免疫时"——免疫记在被免疫方）
  if ("foeImmunedKind" in cond) return ((c.foe.immunedMask ?? 0) & cond.foeImmunedKind) !== 0;
  // movePowerAtLeast/movePowerBelow：本动招式威力阈值（"若对手当回合使用的攻击技能威力大于等于80则"——reactive ctx 的 move 是声明侧招式）
  if ("movePowerAtLeast" in cond || "movePowerBelow" in cond) {
    const pw = c.move.effects.find((f) => f.op === "damage")?.power ?? 0;
    return "movePowerAtLeast" in cond ? pw >= cond.movePowerAtLeast : pw < cond.movePowerBelow;
  }
  // catStreakAtLeast：同类技能连胜计数 ≥N（"若连续次数大于等于N次"——cat 限定连胜类别，缺省不限）
  if ("catStreakAtLeast" in cond) {
    const want = cond.catStreakAtLeast;
    if ((c.unit.catStreak ?? 0) < want.n) return false;
    if (want.cat === "attack") return c.unit.lastMoveCat === 2 || c.unit.lastMoveCat === 3;
    if (want.cat === "status") return c.unit.lastMoveCat === 1;
    return true;
  }
  return false;
}
