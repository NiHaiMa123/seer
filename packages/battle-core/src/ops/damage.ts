/** ops/damage.ts —— damage op：standard/fixed/percent/true + flatBonus/flatRange/drain + 条件放大 + 连击 + 自残 target。 */
import { MECHANICS, stageKeysFor } from "../mechanics/index.ts";
import { EngineFault, OTHER, type CoreEvent } from "../types.ts";
import type { UnitState } from "../mechanics/types.ts";
import { checkpoint, effectivenessOf, effStat, mkHookCtx } from "./shared.ts";
import { effectMul, effectDefOf, flatImmuneOn, dmgMulOf, dmgFlatOf, dmgTakenPctOf, dmgTakenDownPctOf, dmgReduceFlatOf, pierceStagesOn, pierceAtkOn, critChanceFracs, dmgOutPctOf, dmgToHealOn, dmgToHealPctOf, dmgToShieldOn, dmgFloorOf, dmgOutFracOf, dmgTakenCatFracOf, dmgOutFloorOf, dmgOutCapOf, dmgImmuneAboveOf, flatTakenPctOf, pctTakenPctOf, priTakenPctOf, critDealtPctOf, critTakenPctOf, ignoreSelfDownOn, hpCapOf, ignoreDefOf, pierceLimitOn, critImmuneOn, critDodgeChanceOf, unifyOffenseOn, stageAliasOn, powerMulFracsOf, fixedTakenPctOf, evenOutcomeOn, DMG_KIND_BIT, IM, isMod, battleTypesOf } from "./effects.ts";
import type { OpCtx, OpHandler, CpResult } from "./types.ts";
import { fireReactive } from "./index.ts";
import { applyCap, applyCrit, applyFlat, applyFormula, applyPower, applyScale, applyStrike } from "./damage-family.ts";
import { compileHit } from "./damage-program.ts";
import { applyAilmentOnHit, applyDrainRider, applyFlatEcho, applyFlatIfFoeImmune, applyFlatOnHit, applyFoeNextMaxHpAcc, applyFoeShieldEcho, applyHealOnHit, applyRecoilFrac, applyReflectRider, applySelfCostEcho, applyShieldEcho, applyStageOnHit, applyTrueEcho } from "./damage-riders.ts";

/** 指定侧背包存活/阵亡计数（perBenchAlive/perBenchDead 缩放读数）。 */
const benchCountsOf = (state: { sides: Record<string, { bench?: { currentHp: number; banished?: boolean }[] }> }, s: string): { alive: number; dead: number } => {
  const b = state.sides[s]?.bench ?? [];
  return { alive: b.filter((x) => x.currentHp > 0 && x.banished !== true).length, dead: b.filter((x) => x.currentHp <= 0).length };
};

export const damageOp: OpHandler = (ctx, fx) => {
  const { pack, next, events, side, unit, move, rng, target } = ctx;
  if (fx.op !== "damage") throw new EngineFault("OP_DISPATCH", `damage handler got ${fx.op}`);
  const prog = compileHit(fx);
  const kind = prog.kind;
  // 命中侧：target:"self" → 自残/自耗（对自身结算，不走克制/免疫/护盾/反击）。
  const hit = prog.target === "self" ? unit : target;
  const hitSide = prog.target === "self" ? side : OTHER[side];
  const selfHit = hit === unit;
  // applyFormula trade：自身先损失，再以等量伤敌，然后整段返回
  if (applyFormula(ctx, prog.by.formula, "trade", hit, hitSide, selfHit)) return "continue";
  // 属性系统：standard/true（攻防公式招式）吃克制倍率 + STAB；
  // fixed/percent 是固定值语义，不受属性影响；struggle 无类型。
  const typed = kind !== "fixed" && kind !== "percent" && !selfHit && pack.typeChart !== undefined && move.type !== undefined;
  // applyPower base：状态威力窗之前
  let power = applyPower(ctx, prog.by.power, "base", hit, prog.power);
  // 状态威力倍率（power_mul flag："威力翻倍"/"N%概率威力翻倍"魂印窗——chance 逐击判定）
  if (!selfHit) for (const [pn, pd, pch] of powerMulFracsOf(unit)) {
    if (pch !== undefined && rng.drawBelow(100, "power_mul_chance") >= pch) continue;
    power = Math.floor((power * pn) / pd);
  }
  // applyPower rest：状态威力窗之后。useStacks 在 resetStacks 清计数之前取好
  const powered = applyPower(ctx, prog.by.power, "rest", hit, power);
  power = powered.power;
  const useStacks = powered.useStacks;
  let eff16: number | undefined; // ×16 定点（事件流必须全整数——canonicalJson 拒浮点）
  let stab = false;
  if (typed) {
    const foeTypes = battleTypesOf(pack, hit, unit);
    eff16 = effectivenessOf(pack.typeChart!, move.type!, foeTypes);
    // applyFormula resist：微弱抬到 1.0，以及本系加成
    const resist = applyFormula(ctx, prog.by.formula, "resist", eff16, battleTypesOf(pack, unit, hit).includes(move.type!));
    eff16 = resist.eff16;
    stab = resist.stab;
  }
  // applyStrike count：进循环之前的连击次数
  let hits = applyStrike(ctx, prog.by.strike, "count", useStacks);

  // 穿透守方能力强化（"无视对手能力强化状态"）：守方 view 的 stage 清零后参与公式。
  const defView0 = pierceStagesOn(unit)
    ? { ...hit, stages: Object.fromEntries(stageKeysFor(pack).map((k) => [k, 0])) as typeof hit.stages }
    : hit;
  // 无视防御窗口（ignoreDef flag："忽略对手N%的双防值"）——守方 view 的 def/sdf 基础值 -pct%（两公式路径共用）
  const igDef = ignoreDefOf(unit);
  const defView = igDef === undefined ? defView0 : {
    ...defView0,
    base: Object.fromEntries(Object.entries(defView0.base).map(([k, v]) => [k, (k === "def" || k === "sdf") ? Math.floor((v * (100 - igDef.pct)) / 100) : v])) as typeof defView0.base,
  };
  // 无视自身能力下降（ignoreSelfDown flag）：攻方 view 负级清零（"无视自身能力下降状态"）
  const atkUnit = ignoreSelfDownOn(unit)
    ? { ...unit, stages: Object.fromEntries(Object.entries(unit.stages).map(([k, v]) => [k, Math.max(0, v)])) as typeof unit.stages }
    : unit;

  // powerDropPerHit：连击逐击威力衰减（"每次命中对手后此技能威力下降N点"——第 i 击 power-drop×i，经 calc pow 参数注入）
  const calc = (crit: boolean, pow = power): number => {
    // applyFormula fixed：selfHp 取当前体力，否则取威力。致命翻倍和 flatRange 占位留在这一行
    if (kind === "fixed") { const p = applyFormula(ctx, prog.by.formula, "fixed", atkUnit.currentHp, prog.power); return crit ? p * 2 : applyFlat(ctx, prog.by.flat, "hidesPower") ? 0 : p; }
    // applyFormula percent：百分比这一击的数字
    if (kind === "percent") return applyFormula(ctx, prog.by.formula, "percent", hit, pow);
    // 缩放公式分派：机制钩子接管（如 six-stat 赛尔号公式）；全未接管 → legacy v1 公式。
    let out: { dmg: number; roll?: number } | undefined;
    for (const m of MECHANICS) {
      out = m.scaledDamage?.({ pack, unit: atkUnit, foe: defView, move, power: pow, kind, eff16, stab, crit, rng });
      if (out !== undefined) break;
    }
    if (out !== undefined) {
      if (out.roll !== undefined) {
        events.push({ type: "rng-draw", detail: { purpose: "damage_roll" }, rngDraw: { purpose: "damage_roll", value: out.roll } });
      }
      return out.dmg;
    }
    // stage_alias（"防御、特防能力提升分别视为攻击、特攻能力提升"）：攻侧 stage 读守侧映射键
    const aliasOn = stageAliasOn(atkUnit);
    const atkStage = crit ? Math.max(0, (aliasOn ? atkUnit.stages.def : atkUnit.stages.atk) ?? 0) : (aliasOn ? atkUnit.stages.def : atkUnit.stages.atk);
    const defStage = crit ? Math.min(0, defView.stages.def) : defView.stages.def;
    // applyFormula offense：攻基取自身或对手的最高攻
    const atkBase = applyFormula(ctx, prog.by.formula, "offense", atkUnit.base.atk, atkUnit.base.spa, defView.base.atk, defView.base.spa);
    // unify_offense（"攻击和特攻等于其中最高的一项"——魂印常驻）：攻/特攻生效值取高（stage 各自计）
    const atkEff = unifyOffenseOn(atkUnit)
      ? Math.max(effStat(atkUnit.base.atk, atkStage), effStat(atkUnit.base.spa ?? atkUnit.base.atk, (aliasOn ? atkUnit.stages.sdf : atkUnit.stages.spa) ?? 0))
      : effStat(atkBase, atkStage);
    const base = Math.floor((pow * atkEff) / (2 * effStat(defView.base.def, kind === "true" ? 0 : defStage)));
    const dmg0 = typed
      ? (eff16 === 0 ? 0 : Math.max(1, Math.floor((base * eff16!) / 16 * (stab ? pack.stabMultiplier : 1))))
      : Math.max(1, base);
    return crit ? dmg0 * 2 : dmg0;
  };

  let cp: CpResult = "continue";
  let ppBoostPct = 0; // pp_consume_hit 耗 PP 累积增伤百分比（"每消耗1点威力提升10%"——消耗点在本击 dmg 完成后加算）
  for (let i = 0; i < hits; i++) {
    if (hit.currentHp <= 0) break; // 连击中断于 KO
    let dmgExcess = 0; // 本击承伤上限溢出段（excessPct 反弹的基数——本击内就地传递，逐击重算，不进 unit 状态）
    let dmgExcessPct = 0;
    // pp_consume_hit：命中时消耗所使用招式的全部 PP（"下N次攻击命中时消耗所使用攻击技能的全部PP值"——次数窗逐击消耗）
    if (!selfHit) {
      for (const e of [...unit.effects]) {
        if (!isMod(e, "ppConsumeHit") || e.params === undefined) continue;
        const slot0 = unit.moves.find((mv) => mv.moveId === move.id);
        if (slot0 === undefined || slot0.pp <= 0) continue;
        const used = slot0.pp;
        slot0.pp = 0;
        events.push({ type: "pp-delta", detail: { side, moveId: move.id, delta: -used, ppAfter: 0 } });
        const step = e.params.ppStep ?? 1;
        const units = Math.floor(used / step);
        if (e.params.pctPerPp !== undefined) ppBoostPct += e.params.pctPerPp * (e.params.ppStep !== undefined ? units : used);
        if (e.params.foeAllDown !== undefined) {
          for (const k of stageKeysFor(pack)) hit.stages[k] = Math.max(-6, (hit.stages[k] ?? 0) - e.params.foeAllDown * units);
        }
        if (e.params.count !== undefined) {
          e.params.count -= 1;
          if (e.params.count <= 0) {
            unit.effects = unit.effects.filter((x) => x !== e);
            events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
          }
        }
      }
    }
    // applyFormula immune：固伤被免疫时转真实伤害
    const immune = applyFormula(ctx, prog.by.formula, "immune", kind, selfHit, hit);
    const kindEff = immune.kindEff;
    const flatImmuneOverride = immune.override;
    // 固伤免疫窗口：fixed/percent 落到 flat_immune 持有者时不产伤（真实伤害与 kindIfImmune 转化穿透）
    if (!selfHit && !(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit)) && kindEff !== "true" && (kind === "fixed" || kind === "percent") && flatImmuneOn(hit)) {
      hit.immuneThisTurn = (hit.immuneThisTurn ?? 0) + 1; // "成功触发免疫"谓词记账
      hit.immunedMask = (hit.immunedMask ?? 0) | (kind === "fixed" ? 2 : 4); // bit2=固伤 bit4=百分比
      // applyFlatIfFoeImmune：免疫挡下后仍追加真实伤害
      applyFlatIfFoeImmune(ctx, prog.by.onHit, hit, hitSide);
      events.push({ type: "protected", detail: { side: hitSide } });
      // dmg_flat kii：计时固伤"免疫则转真实"——固伤被免疫时字面 flat 项以真实伤害结算
      if (hit.currentHp > 0) for (const e of unit.effects) {
        if (!isMod(e, "dmgFlat") || e.params?.kii === undefined || e.params.flat === undefined) continue;
        const amt = Math.min(hit.currentHp, e.params.flat);
        hit.currentHp -= amt;
        events.push({ type: "damage", detail: { side: hitSide, amount: amt, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "true", cause: "immune_extra" } });
      }
      continue;
    }
    // dmg_immune 窗口：目标免疫攻击伤害（连击逐击判定；params.count 次数盾递减耗尽；pierce 穿透；真实伤害穿透该免疫）
    let immuneEchoPct: number | undefined; // echoFlatPct：免疫成功仍结算伤害数，随后归零并百分比反伤攻方（"免疫对手下1次攻击伤害，并附加给对手此攻击伤害100%的固定伤害"）
    // params.chance：概率免疫窗（"每回合有60%的几率免疫当回合受到的攻击伤害"——每击单独判定；无条件条目恒免疫）
    const isDmgImmune = (e: (typeof hit.effects)[number]) => e.kind === "immune" && (((e.params?.of as number | undefined) ?? 0) & IM.dmg) !== 0;
    const catDi = move?.category === "special" ? 3 : move?.category === "physical" ? 2 : 1;
    const diEntries = hit.effects.filter((e) => { if (!isDmgImmune(e)) return false; const km = e.params?.kindMask as number | undefined; if (!(km === undefined || kindEff === undefined || (km & (DMG_KIND_BIT[kindEff] ?? 0)) !== 0)) return false; const c = e.params?.cat as number | undefined; return c === undefined || (c === 4 ? catDi !== 1 : c === catDi); });
    let diHit = false;
    for (const e of diEntries) { const ch = e.params?.chance as number | undefined; if (ch === undefined) { diHit = true; break; } if (rng.drawBelow(100, "dmg_immune_chance") < ch) diHit = true; }
    if (!selfHit && !(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit)) && kindEff !== "true" && diHit) {
      const echoSrc = hit.effects.find((e) => isDmgImmune(e) && e.params?.echoFlatPct !== undefined);
      hit.immuneThisTurn = (hit.immuneThisTurn ?? 0) + 1;
      hit.immunedMask = (hit.immunedMask ?? 0) | 1; // bit1=攻击伤害
      events.push({ type: "protected", detail: { side: hitSide } });
      for (const e of hit.effects) {
        if (isDmgImmune(e) && e.params?.count !== undefined) {
          e.params.count -= 1;
          if (e.params.count <= 0) hit.effects = hit.effects.filter((x) => x !== e);
        }
      }
      if (echoSrc === undefined) continue;
      immuneEchoPct = echoSrc.params!.echoFlatPct; // echo 型免疫：不跳结算，伤害算完后归零
    }
    // applyCrit：招式致命段。critAlways 窗夹在中间，要害概率窗口留在这次调用之后
    let crit = applyCrit(ctx, prog.by.crit, useStacks);
    if (!crit && !selfHit) for (const [cn, cd] of critChanceFracs(unit, hit)) {
      if (rng.drawBelow(cd, "crit_chance") < cn) { crit = true; break; }
    }
    // crit_up 次数窗消耗（"下N次攻击N%打出致命一击"——每次出招递减直至耗尽）
    if (!selfHit) for (const e of [...unit.effects]) {
      if (!isMod(e, "critChance") || e.params?.count === undefined) continue;
      e.params.count -= 1;
      if (e.params.count <= 0) unit.effects = unit.effects.filter((x) => x !== e);
    }
    // 致命免疫（crit_immune flag："免疫致命一击伤害"/"致命一击对自身MISS"）——打出致命时整击免疫
    if (crit && !selfHit && critImmuneOn(hit)) {
      hit.immuneThisTurn = (hit.immuneThisTurn ?? 0) + 1;
      hit.immunedMask = (hit.immunedMask ?? 0) | 1;
      events.push({ type: "protected", detail: { side: hitSide } });
      continue;
    }
    // crit_dodge（"N%几率免疫对手致命一击造成的伤害"——受暴击时按概率整击归零）
    if (crit && !selfHit) {
      const cd = critDodgeChanceOf(hit);
      if (cd > 0 && rng.drawBelow(100, "crit_dodge") < cd) {
        hit.immuneThisTurn = (hit.immuneThisTurn ?? 0) + 1;
        hit.immunedMask = (hit.immunedMask ?? 0) | 1;
        events.push({ type: "protected", detail: { side: hitSide } });
        continue;
      }
    }
    // applyPower drop：连击逐击威力衰减
    let dmg = flatImmuneOverride !== undefined ? flatImmuneOverride : calc(crit, applyPower(ctx, prog.by.power, "drop", power, i));
    // 烧伤类 atkMul：物理伤害减半（status flag 表驱动；fixed/percent 固定值不吃）
    if (kind !== "fixed" && kind !== "percent" && move.category !== "special") {
      const [an, ad] = effectMul(unit, "atkMul");
      if (an !== ad) dmg = Math.floor((dmg * an) / ad);
    }
    // applyScale mul：固伤之前的伤害倍率
    dmg = applyScale(ctx, prog.by.scale, "mul", dmg, useStacks, selfHit, hit);
    const tmMul = dmgMulOf(unit);
    if (tmMul !== 1) dmg = Math.floor(dmg * tmMul);
    // 承伤方计时增伤窗口（"N回合内对手受到的伤害提高N%"）+ 攻击方计时增伤（"下N回合伤害提高N%"）
    const takenPct = dmgTakenPctOf(hit, kindEff, move.id, move.type);
    if (takenPct > 0 && dmg > 0) dmg = Math.floor((dmg * (100 + takenPct)) / 100);
    const takenDown = dmgTakenDownPctOf(hit, unit, kindEff, move.type);
    if (takenDown > 0 && dmg > 0) dmg = Math.floor((dmg * (100 - takenDown)) / 100);
    // 先制技承伤减免（pri_taken_pct flag："受到先制技能的伤害减少N%"——来招 priority>0 才折）
    const priDown = (move.priority ?? 0) > 0 ? priTakenPctOf(hit) : 0;
    if (priDown > 0 && dmg > 0) dmg = Math.floor((dmg * (100 - priDown)) / 100);
    // 次数制承伤减免（"下N次受到的攻击伤害减少N%/N点"——dmg_taken_down/dmg_reduce 逐击消耗）
    // + 承伤侧逐击递增（"每次受到攻击减少量增加N%"——growAcc 在每次受击时累加，growCap 封顶）
    for (const e of [...hit.effects]) {
      if (!isMod(e, "dmgTakenDown") && !isMod(e, "dmgReduceFlat")) continue;
      if (e.params?.growStep !== undefined) {
        if (e.params.growPer !== undefined) e.params.growHits = (e.params.growHits ?? 0) + 1;
        else e.params.growAcc = Math.min(e.params.growCap ?? Number.MAX_SAFE_INTEGER, (e.params.growAcc ?? 0) + e.params.growStep);
      }
      if (e.params?.count === undefined) continue;
      e.params.count -= 1;
      if (e.params.count <= 0) {
        hit.effects = hit.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
      }
    }
    const outPct = dmgOutPctOf(unit, hit, rng, kindEff, benchCountsOf(next, side), move.type);
    if (outPct > 0 && dmg > 0) dmg = Math.floor((dmg * (100 + outPct)) / 100);
    // applyScale range：随机出伤区间
    dmg = applyScale(ctx, prog.by.scale, "range", dmg, useStacks, selfHit, hit);
    // 致命一击伤害提升（crit_dealt flag："致命一击造成的伤害提升N%"——本击 crit 才放大）
    const critUp = crit === true ? critDealtPctOf(unit) : 0;
    if (critUp > 0 && dmg > 0) dmg = Math.floor((dmg * (100 + critUp)) / 100);
    // 承伤方致命易伤（crit_taken_up flag："对手受到的致命一击伤害提高N%"——承伤者持有，本击 crit 才放大）
    if (crit === true && !selfHit && dmg > 0) {
      const ctk = critTakenPctOf(hit);
      if (ctk > 0) dmg = Math.floor((dmg * (100 + ctk)) / 100);
    }
    // 逐击累加递增（growStep/growCap/growPer："之后每次叠加N%"/"每使用N次攻击技能则伤害提升M%"——每击记 hits，growPer 步进）
    if (dmg > 0) {
      for (const e of unit.effects) {
        if (!isMod(e, "dmgOutPct") || e.params?.growStep === undefined) continue;
        if (e.params.growPer !== undefined) e.params.growHits = (e.params.growHits ?? 0) + 1;
        else e.params.growAcc = Math.min(e.params.growCap ?? Number.MAX_SAFE_INTEGER, (e.params.growAcc ?? 0) + e.params.growStep);
      }
    }
    // 次数制出伤加成消耗（"自身下1次攻击造成的伤害提升N%"——整 op 消耗一次，不逐击）
    if (i === 0) {
      for (const e of [...unit.effects]) {
        if (!isMod(e, "dmgOutPct") || e.params?.count === undefined) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) {
          unit.effects = unit.effects.filter((x) => x !== e);
          events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
        }
      }
    }
    const outFrac = dmgOutFracOf(unit);
    if (outFrac !== undefined && dmg > 0) {
      dmg = Math.floor((dmg * outFrac[0]) / outFrac[1]);
      // params.count 次数消耗（"使对手下一次攻击伤害降低N%"——下次出伤后窗尽）
      for (const e of unit.effects) {
        if (!isMod(e, "dmgOutFrac") || e.params?.count === undefined) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) { unit.effects = unit.effects.filter((x) => x !== e); events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } }); }
      }
    }
    // applyScale stage：每种自身正面能力等级的伤害加成
    dmg = applyScale(ctx, prog.by.scale, "stage", dmg, useStacks, selfHit, hit);
    // 承伤方按类别承伤分数（"受到物理攻击伤害减半"——move.category 命中才折）
    const catCode = move.category === "special" ? 3 : move.category === "physical" ? 2 : 1;
    const [tn, td] = dmgTakenCatFracOf(hit, catCode);
    if (tn !== td && dmg > 0) dmg = Math.floor((dmg * tn) / td);
    // dmgTakenCatFrac 次数消耗（"下N次受到的攻击伤害额外减少M%"——承伤窗口逐击递减）
    if (tn !== td && dmg > 0) for (const e of [...hit.effects]) {
      if (!isMod(e, "dmgTakenCatFrac") || e.params?.count === undefined) continue;
      if (!(e.params.cat === 4 ? catCode !== 1 : e.params.cat === catCode)) continue;
      e.params.count -= 1;
      if (e.params.count <= 0) {
        hit.effects = hit.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
      }
    }
    // applyFlat head：耗盾之前的固伤累加
    let flat = applyFlat(ctx, prog.by.flat, "head", hit, useStacks);
    // applyStrike consume：耗盾转伤，吸收量并入首击 flat
    flat = applyStrike(ctx, prog.by.strike, "consume", i, flat);
    const flatHeal = { v: 0 };
    flat += dmgFlatOf(unit, ctx.foe, power, flatHeal);
    // healEcho：固伤窗等额吸血（"吸取对手最大体力1/6"——固伤贡献部分回血）
    if (flatHeal.v > 0 && unit.currentHp > 0) {
      const hb = unit.currentHp;
      unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + flatHeal.v);
      if (unit.currentHp > hb) events.push({ type: "heal", detail: { side, amount: unit.currentHp - hb, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "flat_echo" } });
    }
    // 次数制固伤窗口（"下N次攻击附加M点固定伤害"——逐击消耗）
    for (const e of [...unit.effects]) {
      if (!isMod(e, "dmgFlat") || e.params?.count === undefined) continue;
      e.params.count -= 1;
      if (e.params.count <= 0) {
        unit.effects = unit.effects.filter((x) => x !== e);
        events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
      }
    }
    // applyFlat tail：计时固伤窗之后的固伤累加
    flat = applyFlat(ctx, prog.by.flat, "tail", hit, selfHit, useStacks, power, flat);
    // applyScale late：固伤累加之后、并入之前的伤害倍率
    dmg = applyScale(ctx, prog.by.scale, "late", dmg, useStacks, selfHit, hit);
    // fixed_taken_pct：承伤方固伤减免窗（"受到的固定伤害降低30%"——pct 参数，仅削 fixed 通道）
    if (!selfHit && kindEff === "fixed") {
      const fr = fixedTakenPctOf(hit);
      if (fr > 0) dmg = Math.floor((dmg * (100 - fr)) / 100);
    }
    // ppPctPerPp：pp_consume_hit 命中结算的耗 PP 增伤（"每消耗1点威力提升10%"——威力提升近似按伤害百分比加算）
    if (ppBoostPct > 0) dmg = Math.floor((dmg * (100 + ppBoostPct)) / 100);
    dmg += flat;
    // applyCap match：把体力对齐，在穿透钳制之前
    dmg = applyCap(ctx, prog.by.cap, "match", dmg, hit, selfHit);
    // 承伤方计时减伤/伤害上限/伤害护盾（shield=一次性吸收池，扣完即消）；pierce 穿透伤害限制
    // pierceLimit（"无视对手伤害限制效果"）：跳过减伤/上限/阈值免疫，不穿透护盾
    const noLimit = pierceLimitOn(unit);
    if (!(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit))) {
      if (!noLimit) {
        const reduceFlat = dmgReduceFlatOf(hit, unit, kindEff);
        if (reduceFlat > 0) {
          dmg = Math.max(0, dmg - reduceFlat);
          // 次数消耗（"下次受到的伤害减少N点"——params.count 用一次减一）
          for (const e of [...hit.effects]) {
            if (!isMod(e, "dmgReduceFlat") || e.params?.count === undefined) continue;
            e.params.count -= 1;
            if (e.params.count <= 0) {
              hit.effects = hit.effects.filter((x) => x !== e);
              events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
            }
          }
        }
        // 上限取最小、溢出段基数按条目取：dmgCapOf 的 `e.params?.cap ?? …` 在 cap:0 这类合法值上会掉到 capPct
        // 分支（判 undefined 不判 0），整条上限被静默丢弃。溢出段句的宿主只有一条 dmg_cap 窗，那条就是基数条（钳前伤害 − cap）。
        const capEffs = hit.effects.filter((e) => isMod(e, "dmgCap"));
        const capOfEff = (e: (typeof capEffs)[number]) => e.params?.cap ?? (e.params?.capPct !== undefined ? Math.floor((hit.base.hp * e.params.capPct) / 100) : undefined);
        let cap: number | undefined;
        for (const e of capEffs) {
          const v = capOfEff(e);
          // kindMask 门控（"受到的固定伤害和百分比伤害不超过N点"——类别不匹配该上限不参与）
          if (e.params?.kindMask !== undefined && (kindEff === undefined || (e.params.kindMask & (DMG_KIND_BIT[kindEff] ?? 0)) === 0)) continue;
          if (v !== undefined && (cap === undefined || v < cap)) cap = v;
        }
        // P 在这里取走——条目带 params.count 时本击就被消耗掉，反弹点再查就查不到
        const exEff = capEffs.length === 1 ? capEffs[0] : undefined;
        if (exEff?.params?.excessPct !== undefined && !selfHit) { dmgExcess = Math.max(0, dmg - (cap ?? 0)); dmgExcessPct = exEff.params.excessPct; }
        if (cap !== undefined) {
          if (dmg > cap) dmg = cap;
          // 次数消耗（"下N次受到的攻击伤害不超过M点"——承伤窗口逐击递减）
          for (const e of [...hit.effects]) {
            if (!isMod(e, "dmgCap") || e.params?.count === undefined) continue;
            e.params.count -= 1;
            if (e.params.count <= 0) {
              hit.effects = hit.effects.filter((x) => x !== e);
              events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
            }
          }
        }
      }
      if (dmg > 0 && !applyStrike(ctx, prog.by.strike, "shield")) for (const e of [...hit.effects]) {
        if (effectDefOf(e.kind)?.dmgShield !== "params" || e.params?.flat === undefined) continue;
        // kindMask：类别过滤吸收池（护罩 ward=固伤/百分比 1|2——标准攻击伤害不消耗罩池）
        if (e.params.kindMask !== undefined) {
          const KM: Record<string, number> = { fixed: 1, percent: 2, standard: 4, true: 8 };
          if ((e.params.kindMask & (KM[kindEff] ?? 0)) === 0) continue;
        }
        const absorbed = Math.min(e.params.flat, dmg);
        dmg -= absorbed; e.params.flat -= absorbed;
        hit.shieldAbsorbed = (hit.shieldAbsorbed ?? 0) + absorbed; // 护盾吸收量记账（"护盾所吸收的伤害值N%反弹"读取）
        if (e.params.flat <= 0) {
          // 多层护盾（params.count/each："获得N个M点的护盾"）——耗尽一层补下一层，层尽才消散
          if (e.params.count !== undefined && e.params.count > 1 && e.params.each !== undefined) {
            e.params.count -= 1; e.params.flat = e.params.each;
          } else {
            hit.effects = hit.effects.filter((x) => x !== e);
            events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
            // 破盾触发（"护盾消失时对对手造成N点固定伤害"）——多层盾层尽才算消失
            const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
            const cp = fireReactive({ ...rest, side: hitSide, unit: hit }, hit, 4, { dmg });
            if (cp !== "continue") return cp;
          }
        }
        if (dmg <= 0) break;
      }
    }
    // applyCap floor：下限和留血，在出伤窗之前
    dmg = applyCap(ctx, prog.by.cap, "floor", dmg, hit, selfHit);
    // 攻击方计时出伤窗口：下限（"每回合攻击技能造成的伤害不少于N"）/ 上限（"对手造成的伤害不超过N"）
    const outFloor = dmgOutFloorOf(unit, hit);
    if (outFloor > 0 && dmg > 0 && dmg < outFloor) dmg = outFloor;
    const outCap = dmgOutCapOf(unit);
    if (outCap > 0 && dmg > outCap) dmg = outCap;
    // applyCap cap：本招上限和阈值固伤，在出伤窗之后
    dmg = applyCap(ctx, prog.by.cap, "cap", dmg, hit, selfHit);
    // 承伤方低伤免疫（"免疫低于N的攻击伤害"——最终伤害低于阈值归零；pierce/pierceLimit 穿透）
    if (!selfHit && !(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit)) && dmg > 0) {
      const floor = noLimit ? 0 : dmgFloorOf(hit);
      if (floor > 0 && dmg < floor) {
        // echo（"免疫伤害并造成等同于伤害量的固定伤害"）：等量 fixed 反给攻方；echoFlat=定额（"低于N则附加M点固定伤害"）
        const src = hit.effects.find((e) => isMod(e, "dmgFloor") && e.params?.min === floor);
        const echoAmt = src?.params?.echo === 1 ? dmg : src?.params?.echoFlat;
        if (echoAmt !== undefined && echoAmt > 0 && unit.currentHp > 0) {
          unit.currentHp = Math.max(0, unit.currentHp - echoAmt);
          events.push({ type: "damage", detail: { side, amount: echoAmt, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "reflect" } });
        }
        dmg = 0;
      }
      // 高伤免疫（"免疫大于N的攻击伤害"——最终伤害高于阈值归零）
      const ceil = noLimit ? 0 : dmgImmuneAboveOf(hit);
      if (ceil > 0 && dmg > ceil) dmg = 0;
      // 固伤减免（"受到的固定伤害和百分比伤害减少N%"——仅 fixed/percent 伤害类型）
      if (dmg > 0 && (kind === "fixed" || kind === "percent")) {
        const cut = Math.min(100, flatTakenPctOf(hit) + (kind === "percent" ? pctTakenPctOf(hit) : 0));
        if (cut > 0) {
          dmg = Math.floor((dmg * (100 - cut)) / 100);
          // params.count 次数消耗（"下N次受到的固定伤害和百分比伤害减少M%"）
          for (const e of [...hit.effects]) {
            if (!isMod(e, "flatTakenPct") || e.params?.count === undefined) continue;
            e.params.count -= 1;
            if (e.params.count <= 0) {
              hit.effects = hit.effects.filter((x) => x !== e);
              events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
            }
          }
        }
      }
    }
    // 承伤方伤害转回复窗口（"受到的伤害转化为自身体力"——伤害变等量治疗，不产生 damage 事件）
    if (!selfHit && !(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit)) && dmg > 0 && immuneEchoPct === undefined && dmgToHealOn(hit)) {
      const before = hit.currentHp;
      hit.currentHp = Math.min(hpCapOf(hit), hit.currentHp + dmg);
      events.push({ type: "heal", detail: { side: hitSide, amount: hit.currentHp - before, hpAfter: { current: hit.currentHp, max: hit.base.hp }, source: "dmg_to_heal" } });
      // 次数制消耗（"下1次受到的攻击伤害转化为体力"）
      for (const e of [...hit.effects]) {
        if (!isMod(e, "dmgToHeal") || e.params?.count === undefined) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) {
          hit.effects = hit.effects.filter((x) => x !== e);
          events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
        }
      }
      continue;
    }
    // 承伤方伤害转护盾窗口（"下N次受到的攻击伤害转化为等量护盾"——伤害变护盾值，不产生 damage 事件）
    const shieldConvOk = hit.effects.some((e) => isMod(e, "dmgToShield") && (e.params?.kindMask === undefined || ((e.params.kindMask & (DMG_KIND_BIT[kind] ?? 0)) !== 0)));
    if (!selfHit && !(applyStrike(ctx, prog.by.strike, "pierce") || pierceAtkOn(unit)) && dmg > 0 && immuneEchoPct === undefined && shieldConvOk) {
      hit.effects.push({ kind: "shield", params: { flat: dmg }, effectInstanceId: `efx_${hitSide}_shield`, appliedTurn: next.turn });
      events.push({ type: "effect-applied", detail: { side: hitSide, name: "shield", turns: 0 } });
      for (const e of [...hit.effects]) {
        if (!isMod(e, "dmgToShield") || e.params?.count === undefined) continue;
        if (e.params.kindMask !== undefined && (e.params.kindMask & (DMG_KIND_BIT[kind] ?? 0)) === 0) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) {
          hit.effects = hit.effects.filter((x) => x !== e);
          events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } });
        }
      }
      continue;
    }
    // immuneEcho 结算：伤害算完后归零，按百分比以固定伤害反弹给攻方（"附加给对手此攻击伤害100%的固定伤害"）
    if (immuneEchoPct !== undefined) {
      const echo = Math.floor((dmg * immuneEchoPct) / 100);
      dmg = 0;
      if (echo > 0 && unit.currentHp > 0) {
        unit.currentHp = Math.max(0, unit.currentHp - echo);
        events.push({ type: "damage", detail: { side, amount: echo, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "reflect" } });
      }
    }
    // 伤害护盾（魂印等）：消耗护盾 → 该次伤害全免；连击后续照常。0 伤害不消耗。
    let absorbed = false;
    if (dmg > 0 && !selfHit) for (const m of MECHANICS) {
      const ev = m.absorbDamage?.({ pack, unit: hit });
      if (ev !== undefined) {
        events.push({ type: ev.type as CoreEvent["type"], detail: { side: hitSide, ...ev.detail } });
        absorbed = true;
        break;
      }
    }
    if (absorbed) continue;
    // evenOutcome：出伤取偶窗（"必定打出偶数攻击伤害"——奇数 +1 取偶；次数窗逐击消耗）
    if (!selfHit && dmg > 0 && evenOutcomeOn(unit)) {
      if (dmg % 2 === 1) dmg += 1;
      for (const e of [...unit.effects]) {
        if (!isMod(e, "evenOutcome") || e.params?.count === undefined) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) {
          unit.effects = unit.effects.filter((x) => x !== e);
          events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
        }
      }
    }
    hit.currentHp = Math.max(0, hit.currentHp - dmg);
    // applySelfCostEcho：自伤额按 n/d 反打对手
    applySelfCostEcho(ctx, prog.by.onHit, hitSide, selfHit, dmg);
    // applyStrike ko：连击次数达到区间上限时最后一击必杀
    applyStrike(ctx, prog.by.strike, "ko", hit, hits, i);
    // 部分伤转回复（"将30%受到的伤害转化为自身体力"——伤害照常扣，承伤方按 pct 回血；全额转化走 dmgToHealOn 拦截分支不进这里）
    if (!selfHit && dmg > 0) {
      const hpct = dmgToHealPctOf(hit);
      if (hpct > 0 && hit.currentHp > 0) {
        const hh = Math.max(1, Math.floor((dmg * hpct) / 100));
        const hBefore = hit.currentHp;
        hit.currentHp = Math.min(hpCapOf(hit), hit.currentHp + hh);
        events.push({ type: "heal", detail: { side: hitSide, amount: hit.currentHp - hBefore, hpAfter: { current: hit.currentHp, max: hit.base.hp }, source: "dmg_to_heal_pct" } });
      }
    }
    // 伤害记账（"减少n点，n=本回合自身造成的伤害"/"附加对手上次造成伤害"——行动中累计，行动开始清零）
    if (!selfHit) {
      unit.lastDealt = (unit.lastDealt ?? 0) + dmg;
      unit.dealtThisTurn = (unit.dealtThisTurn ?? 0) + dmg; // 本回合伤害累计（dealt_tick"回合结束附加N%伤害量固伤"读取——回合末窗口清零）
    }
    hit.lastTaken = (hit.lastTaken ?? 0) + dmg; // 受击方记账（"附加自身当回合所受技能伤害N%的百分比伤害"）
    hit.lastTakenKind = kindEff; // 受击类型记账（"受到真实伤害后X"谓词）
    // pct_rider：百分比伤害骑乘窗（"自身下N次攻击技能附加对手最大体力1/3的百分比伤害"——逐击消耗，flat_immune 挡百分比类）
    if (!selfHit && dmg > 0) {
      for (const e of [...unit.effects]) {
        if (!isMod(e, "pctRider") || e.params === undefined) continue;
        if (hit.currentHp > 0) {
          // params.statMax：基数取自身 max(atk,spa) 面板（"附加自身攻击和特攻中最高一项N%"）；缺省为对手最大体力
          // params.statMask：基数=自身面板位掩码和（atk1 def2 spa4 sdf8 spd16 hp32——"附加自身防御、特防值总和30%的百分比伤害"）
          const baseAmt = e.params.statMax === 1
            ? Math.max(effStat(unit.base.atk, unit.stages.atk), effStat(unit.base.spa ?? unit.base.atk, unit.stages.spa ?? 0))
            : e.params.statMask !== undefined
              ? (() => { const bases: Record<string, number> = { atk: unit.base.atk, def: unit.base.def, spa: unit.base.spa ?? 0, sdf: unit.base.sdf ?? 0, spd: unit.base.spd, hp: unit.base.hp }; const order = ["atk", "def", "spa", "sdf", "spd", "hp"]; let b = 0; for (const [i, s] of order.entries()) if ((e.params!.statMask! & (1 << i)) !== 0) b += bases[s] ?? 0; return b; })()
              : hit.base.hp;
          const amt = Math.floor((baseAmt * (e.params.n ?? 0)) / Math.max(1, e.params.d ?? 1));
          if (amt > 0 && !flatImmuneOn(hit)) {
            hit.currentHp = Math.max(0, hit.currentHp - amt);
            events.push({ type: "damage", detail: { side: hitSide, amount: amt, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "percent", cause: "rider" } });
          }
        }
        if (e.params.count !== undefined) {
          e.params.count -= 1;
          if (e.params.count <= 0) {
            unit.effects = unit.effects.filter((x) => x !== e);
            events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } });
          }
        }
      }
    }
    // applyRecoilFrac：打出伤害反噬
    applyRecoilFrac(ctx, prog.by.onHit, selfHit, dmg);
    // 承伤上限溢出段反弹（"不超过M，并反弹给对手原本超出部分P%的百分比伤害"）：基数是钳制那一步留下的溢出段
    // （原伤害−上限），不是钳后的 dmg——cap=0 时后者恒为 0。
    if (!selfHit && dmgExcess > 0 && unit.currentHp > 0) {
      const back = Math.floor((dmgExcess * dmgExcessPct) / 100);
      if (back > 0) {
        unit.currentHp = Math.max(0, unit.currentHp - back);
        events.push({
          type: "damage",
          detail: { side, amount: back, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "percent", cause: "reflect" },
        });
      }
    }
    events.push({
      type: "damage",
      detail: {
        side: hitSide,
        amount: dmg,
        hpAfter: { current: hit.currentHp, max: hit.base.hp },
        ...(kindEff !== "standard" ? { damageKind: kindEff } : {}),
        ...(eff16 !== undefined ? { eff16, stab, moveType: move.type } : {}),
        ...(move.category !== undefined ? { category: move.category } : {}),
        ...(crit ? { crit: true } : {}),
        ...(hits > 1 ? { hit: i + 1, hits } : {}),
      },
    });
    // 反应式触发：持有者打出致命（"打出致命一击后X"/"若打出致命一击则X"）——逐击判定
    if (crit && !selfHit && dmg > 0) {
      const cpC = fireReactive(ctx, unit, 10, { dmg });
      if (cpC !== "continue") return cpC;
    }
    // 反应式触发：持有者攻击命中（"每次攻击都有N%的几率令自身攻击+1"——逐击判定，payload 自带 chance）
    if (!selfHit && dmg > 0) {
      const cpT = fireReactive(ctx, unit, 12, { dmg, cat: move.category === "special" ? 3 : move.category === "physical" ? 2 : 1 });
      if (cpT !== "continue") return cpT;
    }
    // 反应式触发：持有者受击（"受到攻击则X"/"受到物理攻击时X"/"若受到的伤害大于N则X"）
    if (!selfHit && dmg > 0) {
      const catCode = move.effects.some((f) => f.op === "damage") ? (move.category === "special" ? 3 : 2) : 1;
      const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
      const hitCtx = { ...rest, side: hitSide, unit: hit };
      const cpR = fireReactive(hitCtx, hit, 1, { cat: catCode, dmg });
      if (cpR !== "continue") return cpR;
      // ignore_def 次数制消耗（"下次攻击忽略对手N%双防"——本击实际造成伤害才扣次数）
      if (igDef !== undefined && igDef.fx.params?.count !== undefined) {
        igDef.fx.params.count -= 1;
        if (igDef.fx.params.count <= 0) {
          unit.effects = unit.effects.filter((x) => x !== igDef.fx);
          events.push({ type: "effect-faded", detail: { side, name: igDef.fx.label ?? igDef.fx.kind } });
        }
      }
      // 持有者倒下（"若被对手击败则X"——倒下即触发，先于 replacement 挂起）
      if (hit.currentHp <= 0) {
        const cpK = fireReactive(hitCtx, hit, 5, { cat: catCode, dmg });
        if (cpK !== "continue") return cpK;
      }
    }
    if (hit.currentHp > 0) {
      for (const m of MECHANICS) {
        const dCtx = { ...mkHookCtx(pack, next, events, ctx.rng, hitSide), amount: dmg };
        m.onDamaged?.(dCtx);
        if (dCtx.outcome === "terminal") return "terminal";
        if (dCtx.outcome !== undefined) return { suspend: dCtx.outcome };
      }
    }
    // 造成伤害钩子（攻击方魂印"攻击命中后X"族——受击方存活与否均派发，攻击方倒下则不结算）
    if (!selfHit && dmg > 0 && unit.currentHp > 0) {
      const catDd = move.category === "special" ? 3 : move.category === "physical" ? 2 : 1;
      for (const m of MECHANICS) {
        const ddCtx = { ...mkHookCtx(pack, next, events, ctx.rng, side), amount: dmg, ...(crit === true ? { crit: true } : {}), cat: catDd, move };
        m.onDamageDealt?.(ddCtx);
        if (ddCtx.outcome === "terminal") return "terminal";
        if (ddCtx.outcome !== undefined) return { suspend: ddCtx.outcome };
      }
    }
    applyDrainRider(ctx, prog.by.drain, hit, hitSide, selfHit, dmg, kindEff);
    applyReflectRider(ctx, hit, hitSide, selfHit, dmg, crit, kindEff, move.category === "special" ? 3 : move.category === "physical" ? 2 : 1);
    applyFlatEcho(ctx, prog.by.onHit, hit, hitSide, dmg);
    applyFoeNextMaxHpAcc(ctx, prog.by.onHit, hit, hitSide, dmg);
    // applyShieldEcho：等量护盾
    applyShieldEcho(ctx, prog.by.onHit, dmg);
    // applyFoeShieldEcho：对侧等量护盾
    applyFoeShieldEcho(ctx, prog.by.onHit, hit, hitSide, selfHit, dmg);
    // applyTrueEcho：等量真实伤害回响
    applyTrueEcho(ctx, prog.by.onHit, hit, hitSide, selfHit, dmg);
    applyHealOnHit(ctx, prog.by.onHit, selfHit, dmg);
    // applyFlatOnHit：命中后概率固伤
    applyFlatOnHit(ctx, prog.by.onHit, hit, hitSide, selfHit);
    // applyAilmentOnHit：命中后概率施加异常
    applyAilmentOnHit(ctx, prog.by.onHit, hit, selfHit);
    applyStageOnHit(ctx, prog.by.onHit, hit, selfHit);
    // applyStrike grow：每击落地后扩张连击总数，仍在 checkpoint 之前
    hits = applyStrike(ctx, prog.by.strike, "grow", hits);
    cp = checkpoint(pack, next, events, ctx.rng);
    if (cp !== "continue") break;
  }
  return cp;
};
