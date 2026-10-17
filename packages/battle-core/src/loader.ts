/**
 * synthetic pack loader：把 content JSON 编译成冻结的运行时规则对象。
 * schema 校验复用 content/schemas/*.schema.json（Ajv strict）；
 * 语义校验：operator ⊆ allowlist、单位引用动作存在、rulesetId/packId 匹配。
 * computeHashes: rulesetHash/contentHash/executableHash 用 canonicalJson+sha256。
 */
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import type { BattleState } from "@seer/contracts/internal";
import { sha256hex } from "./sha256.ts";
import rulesetSchemaJson from "../../../content/schemas/ruleset.schema.json" with { type: "json" };
import packSchemaJson from "../../../content/schemas/pack.schema.json" with { type: "json" };
import unitsSchemaJson from "../../../content/schemas/units.schema.json" with { type: "json" };
import movesSchemaJson from "../../../content/schemas/moves.schema.json" with { type: "json" };
import typechartSchemaJson from "../../../content/schemas/typechart.schema.json" with { type: "json" };
import { MECHANICS } from "./mechanics/index.ts";
import { damageKeyHits } from "./ops/damage-keys.ts";
import { groupHitRiders } from "./ops/hit-rider.ts";

export const ENGINE_VERSION = "0.1.0";
export const IR_VERSION = 1;
export const ENGINE_EXECUTABLE_HASH = `sha256:${sha256hex(canonicalJson({ engine: "@seer/battle-core", engineVersion: ENGINE_VERSION, irVersion: IR_VERSION }))}`;

export class PackLoadError extends Error {
  readonly code = "PACK_LOAD_ERROR";
}

export interface CompiledMove {
  id: string;
  pp: number;
  priority: number;
  /** 先制下限（"先制等级提升为+2"——p=max(p,min)） */
  priorityMin?: number;
  effects: CompiledEffect[];
  type?: string;
  /** six-stat 规则下伤害招式必填：physical 用 攻→防，special 用 特攻→特防。 */
  category?: "physical" | "special";
  /** fifth 机制：第五技能标记（独立于 moveIds 的第五槽引用）。 */
  fifth?: boolean;
  /** 内容包招式名。客户端对自建包仍优先用固定中文表，不拿这里的英文名覆盖。 */
  name?: string;
  /** accuracy 特性：逐招基础命中率 0–100；"always"=必中跳过判定；undefined=不判定（旧包恒中）。 */
  accuracy?: number | "always";
  /** 条件先制（"遇到天敌时先制+N"/"自身强化时先制+N"）：排序时谓词满足→priority+=add */
  priorityIf?: { when: Condition; add?: number; min?: number };
  /** 条件命中门控（"对方体力高于自己时才能命中"——不满足按 MISS） */
  hitIf?: { when: Condition };
  prioPerUse?: number;
  /** 无视对手速度：先制打平后不比速度。只有一方带此旗标时该方先手；双方都带则走平速。 */
  ignoreFoeSpeed?: true;
  /** 无视对手正先制等级（"无视对手正先制等级"）：排序时对手侧的正先制加成不生效（负加成保留） */
  ignoreFoePrioPos?: true;
  /** 对手低PP招式计数先制（"对手每有1个技能PP值小于3先制+1"）：floor(低于below的槽数/per)×add */
  prioPerFoeLowPp?: { below: number; per: number; add: number };
  /** 条件零耗（"若自身体力小于1/2每次攻击不消耗PP"——BEFORE_ACTION 扣 PP 前谓词判定） */
  ppFreeIf?: Condition;
}

export type DamageKind = "standard" | "fixed" | "percent" | "true";
export type StatKey = "hp" | "atk" | "def" | "spa" | "sdf" | "spd";
/** stage 维度：五维面板 + acc（命中——无 base 值、独立倍率表、accuracy 特性下由 sixstat 贡献）。 */
/** crt=致命一击等级（虚拟段位轴——记录段位值；每段→暴击率换算比例未文档化，暂不参与 crit roll） */
export type StageStatKey = Exclude<StatKey, "hp"> | "acc" | "crt";
export type StatSpread = Record<StatKey, number>;

/** 分数参数（n/d 整数对——状态/回复/判定全整数，不用浮点）。 */
export interface Frac { numerator: number; denominator: number }

/** op 条件谓词：可组合（and/or/not），HP 比较走整数乘法。foe*=战斗对手（与 op target 无关），self*=行动方。 */
/** op 目标：self/opponent 场上单位；nextFoe/nextAlly=该侧下只出场精灵（挂入 side.nextInFx，登场时结算）；bench=己方全体后备（仅 heal）。 */
export type OpTarget = "self" | "opponent" | "nextFoe" | "nextAlly" | "bench";

export type Condition =
  | { selfHpBelow: Frac } | { selfHpAbove: Frac }
  | { selfHpBelowAbs: number } | { selfHpAboveAbs: number }
  | { foeHpBelow: Frac } | { foeHpAbove: Frac }
  | { foeHpBelowAbs: number } | { foeHpAboveAbs: number }
  | { foeBelowSelfHpFrac: Frac }
  | { order: "first" | "last" }
  | { foeHas: string } | { selfHas: string }
  | { foeStatused: true } | { selfStatused: true } | { foeNoTimedFx: true } | { foeHasTimed: true }
  | { selfNoTimedFx: true } | { selfHasTimed: true }
  | { foeStageUp: true } | { foeStageDown: true }
  | { selfStageUp: true } | { selfStageDown: true }
  | { foeStageAboveSelf: true }
  | { selfStageAboveFoe: true }
  | { statAtLeast: { stat: StageStatKey; stage: number } }
  /** 自身指定能力等级 ≥ stage（"速度处于提升状态时"→spd≥1） */
  | { selfStatAtLeast: { stat: StageStatKey; stage: number } }
  | { prevApplied: true }
  | { foeFainted: true }
  | { selfHpFull: true }
  | { prevDamageBelowAbs: number }
  /** 面板体力上限 >N（"体力上限大于2000"——读 base.hp 最大体力） */
  | { selfMaxHpAbove: number }
  | { selfMaxHpBelow: number }
  /** 本招基础先制级>N（"自身先制等级大于0时提升为+2"）——priority 排序语境 */
  | { selfPrioAbove: number }
  | { prevDamageAboveAbs: number }
  /** 本回合已造成伤害量 ≥N（dealt_tick 周期结算门——读 unit.dealtThisTurn） */
  | { selfDealtAboveAbs: number }
  /** 双方任一在场单位处于异常或能力下降（foe_dot 双侧门"任一方处于异常或能力下降状态时"） */
  | { eitherAilOrDown: true }
  | { prevDamageBelowFoeFrac: { numerator: number; denominator: number } }
  | { prevDamageAboveFoeFrac: { numerator: number; denominator: number } }
  | { prevHealBelow: number }
  | { prevHealAbove: number }
  | { prevCrit: true }
  | { prevDamageKind: string } | { prevDamageNotKind: string } | { prevDamageAboveFoeHp: true }
  | { takenKind: string }
  | { prevDamageOdd: true } | { prevDamageEven: true } | { prevTakenZero: true } | { foeTakenZero: true }
  | { takenBelowHpFrac: { numerator: number; denominator: number } }
  | { takenBelowAbs: number }
  /** 本回合最近一次受击伤害 > 绝对值（"每次受到的攻击伤害高于300则X"——lastTaken 记账） */
  | { takenAboveAbs: number }
  /** 本回合受击伤害 > 自身最大体力分数（"受到的攻击伤害高于自身最大体力的1/2则X"） */
  | { takenAboveHpFrac: { numerator: number; denominator: number } }
  | { takenAboveCurFrac: { numerator: number; denominator: number } }
  | { turnEq: number }
  | { turnParity: "odd" | "even" }
  | { foeAboveSelfHpFrac: { numerator: number; denominator: number } }
  /** 当前体力等于/低于本回合开始快照（turnStartHp 记账） */
  | { hpEqTurnStart: true } | { hpBelowTurnStart: true } | { hpAboveTurnStart: true }
  /** 当前体力 < 回合开始快照×n/d（"体力低于当回合开始时的50%则X"） */
  | { hpBelowTurnStartFrac: { numerator: number; denominator: number } }
  | { foeHpBelowTurnStart: true } | { turnHpLossAbove: number }
  /** 对手体力高于其回合开始快照 / 本回合体力绝对差值 > N */
  | { foeHpAboveTurnStart: true } | { turnHpDiffAbove: number }
  /** 指定维提升等级总和 ≥ n（"双防提升等级总和大于等于6"） */
  | { selfStageSumAtLeast: { stats: StageStatKey[]; n: number } }
  /** 对手基础能力值 低于/高于 自身（"对手的基础速度值低于自身"——base 面板比较） */
  | { foeBaseStatBelow: StageStatKey } | { foeBaseStatAbove: StageStatKey }
  /** 对手基础能力值 vs 绝对阈值（"对手基础速度值高于400"） */
  | { foeBaseStatAboveAbs: { stat: StageStatKey; n: number } } | { foeBaseStatBelowAbs: { stat: StageStatKey; n: number } }
  /** 自身双防基础值总和 > 对手（"若自身双防总和高于对手"） / 对手声明招式类别·必中（priority 语境） */
  | { selfDefSumAboveFoe: true } | { foeMoveCat: "attack" | "attr" } | { foeMoveAlwaysHit: true }
  /** 全维能力均处于提升（"不处于全能力提升状态"→not 包裹）——stageKeysFor 全键 ≥1 */
  | { selfAllStagesUp: true } | { foeAllStagesUp: true }
  /** 指定维能力等级之和 vs 对手同维之和（"双防能力等级之和高于对手"——代数和，负级计入） */
  | { selfStageSumAboveFoe: { stats: StageStatKey[] } } | { selfStageSumBelowFoe: { stats: StageStatKey[] } }
  /** 存在 PP 为满的技能槽（"若自身存在技能PP值为满则"） */
  | { ppFullAny: { on: "self" | "foe" } }
  /** 本回合招式被无效化的类别位掩码（bit1=属性 bit2=物理 bit4=特殊——"若自身的属性技能失效则"） */
  | { nullifiedCatMask: number } | { foeNullifiedCatMask: number }
  /** 对手声明招式先制 >N（"对手使用带有先手效果的技能"→prio>0——priority 排序语境） */
  | { foeMovePrioAbove: number }
  /** 双方 n 维能力等级全等（"双方6项能力等级状态全部相同"）/ 对手背包每阵亡 n 只（计费谓词） */
  | { stagesAllEqual: number } | { foeBenchDeadPer: number }
  /** 对手异常状态种数 ≥ n / 对手本回合成功免疫过 */
  | { foeAilCountAtLeast: number } | { foeImmunedThisTurn: true }
  /** 双方当前体力差 ≥ N / 连续 n 回合先或后出手 / 对手连续命中 n 次 / 本次登场为主动切换 */
  | { hpDiffAboveAbs: number } | { orderStreakAtLeast: { order: "first" | "last"; n: number } }
  | { foeHitStreakAtLeast: number } | { selfHitStreakAtLeast: number } | { entryWasSwitch: true }
  | { moveCatSameAsPrev: true } | { moveCatDiffPrev: true }
  /** 本招与上动同/异招（"使用技能与上次不相同"——prevMoveId 快照；无上动时 same=false/diff=true） */
  | { moveSameAsPrev: true } | { moveDiffPrev: true }
  /** 指定能力等级等于回合开始快照 */
  | { stageEqTurnStart: { stat: StageStatKey } }
  /** 回合数整除门（"每N回合"）：turn % n === 0 */
  | { everyNTurns: number }
  /** 回合开始快照中自身处于能力下降（"回合开始时若自身处于能力下降状态"——turnStartStages 读取） */
  | { selfStageDownStart: true } | { foeStageDownStart: true }
  /** 对手处于固伤/百分比免疫（"若对手免疫百分比伤害则…"——flat_immune 谓词） */
  | { foeFlatImmune: true }
  /** 本招此前所有 op 均未生效（"均未触发则令自身攻击-2"） */
  | { noneApplied: true }
  /** 自身护盾/护罩总值低于绝对值 / 最近一次消耗量低于绝对值（"若当前护罩值低于N则固伤翻倍"） */
  | { selfShieldBelow: number } | { shieldConsumedBelow: number } | { shieldConsumedAbove: number }
  /** 连续闪避对手攻击次数 ≥N（missStreak 记账） */
  | { missStreakAtLeast: number }
  /** 本回合提升键与上回合提升日志相同/不同（stageUpLog vs prevStageUpLog） */
  | { stageUpSamePrev: true } | { stageUpDiffPrev: true }
  /** 对手性别（pack 单位 gender；无数据按 none） */
  | { foeGender: "male" | "female" | "none" }
  /** 己方背包存活数 === N / 全部阵亡 */
  | { benchAliveEq: number } | { benchAllDead: true }
  /** 造成伤害/承受伤害个位数 === N */
  | { damageDigitEq: number } | { takenDigitEq: number }
  /** 自身指定能力等级已达 +6（defSum=双防同满；all=全部） */
  | { selfStageMax: string }
  /** 本回合已造成伤害 < N */
  | { dealtBelowAbs: number }
  | { dmgGtFoeHp: true }
  /** 本回合成功触发过免疫（immuneThisTurn 记账） */
  | { immunedThisTurn: true }
  /** 本回合成功免疫某类（immunedMask 位掩码：1攻击伤害/2固伤/4百分比/8异常控制/16能力下降） */
  | { immunedKind: number }
  /** 对手侧免疫种类位掩码（"己方附加的固定伤害被免疫时"——immunedMask 记在被免疫方） */
  | { foeImmunedKind: number }
  | { movePowerAtLeast: number } | { movePowerBelow: number }
  /** 同类技能连胜计数 ≥N（catStreak；cat=attack|status 限定连胜类别） */
  | { catStreakAtLeast: { n: number; cat?: "attack" | "status" } }
  | { foeMaxHpAboveSelf: true }
  | { prevEffWeak: true }
  | { effWeakVsFoe: true }
  | { foeCountersUs: true }
  | { foeHpMaxAbove: number }
  | { selfHpBelowFoe: true }
  | { selfHpAboveFoe: true }
  | { foeHpAboveSelf: true }
  | { weCounterFoe: true }
  | { sameAttr: true }
  | { foeTypeIs: string }
  | { foeTypeNot: string }
  /** 对手任意 count 个招式槽 PP < lt（"对手任意N项技能PP值小于M点"） */
  | { foePpLt: { count: number; lt: number } }
  | { selfPpSumAboveFoe: true }
  /** 指定槽位 PP 等于 value（"对手第五技能PP值为0时"）；slot=N 序号|"fifth"=第五标记槽；on=self(默认 foe 语义见调用) */
  | { ppAt: { slot: number | "fifth" | "any"; value: number; on?: "self" | "foe" } }
  /** 印记层数门槛（"对手每存在1层致命裂痕"/"若对手致命裂痕≥2层"）：at=unit(默认)|slot(招式槽合计)|field(场地)；on=self(默认)|foe */
  | { markCountAtLeast: { mark: string; n: number; on?: "self" | "foe"; at?: "unit" | "slot" | "field" } }
  /** 场地印记种类数门槛（"场上每有1种五行印记"）：on=self(默认)|foe|both=双方场地合计 */
  | { fieldMarkKindsAtLeast: { n: number; on?: "self" | "foe" | "both" } }
  /** 背包（bench）内名称含 substr 的单位种类数 ≥ count（"背包内每存在3种X精灵"） */
  | { benchNameCount: { substr: string; count: number } }
  /** 背包内精灵全部满体力（"己方不在场精灵皆为满体力"） */
  | { benchAllFull: true }
  | { and: Condition[] } | { or: Condition[] } | { not: Condition };

/** 印记计数引用：mark=印记名（存为 kind "mark:<名>"）；on=读取侧（self默认/foe/both=双侧合计）；at=挂载位置（unit默认/slot招式槽/field场地）；kinds=数种类而非层数（仅 field）；per=每N层/种记一份（floor） */
export interface MarkRef {
  mark?: string;
  on?: "self" | "foe" | "both";
  at?: "unit" | "slot" | "field";
  kinds?: true;
  per?: number;
}
// prevDamageBelowAbs=上一 damage op 总伤害<N（"若造成的伤害不足300"）；prevCrit=上一 damage op 出过致命；
// foeCountersUs=对手属性克制我方（"遇到天敌时"，chart 缺失→false）；foeHpMaxAbove=对手体力上限>N；selfHpBelowFoe=自身当前体力<对手。

/** 所有 op 共享的信封字段：chance=触发概率%（未过→整 op 跳过，静默）；if=条件谓词（不满足→跳过）。 */
interface EffectEnvelope {
  chance?: number;
  if?: Condition;
  /** 条件概率翻倍（"自身处于能力提升状态时几率翻倍"）：满足→chance×n/d（截到100） */
  chanceMulIf?: { when: Condition; numerator: number; denominator: number };
  chanceSetIf?: { when: Condition; value: number };
  /** 叠用加概率（"每次使用几率增加10%"）：chance += 此前连用次数×本值（截到100） */
  chancePerUse?: number;
  /** 叠用加概率封顶（"最高概率60%"——chancePerUse 累加上限） */
  chancePerUseCap?: number;
  /** 正级加概率（"自身每处于1种能力强化状态则概率提高10%"）：chance += 正级维数×本值（截到100） */
  chancePerStage?: number;
  /** 每损失 per% 体力触发率 +step%（"自身每损失N%的体力则进入异常几率提升M%"） */
  chancePerMissing?: { per: number; step: number };
  /** 每层印记触发率 +add%（"对手每存在1层致命裂痕则几率提升10%"）：chance += add×层数（截到100） */
  chancePerMark?: { mark?: string; add: number; on?: "self" | "foe" | "both"; at?: "unit" | "slot" | "field"; kinds?: true };
  /** 触发率动态=自身当前体力百分比（"几率等同于出手时自身当前体力百分比"——覆写静态 chance 读数） */
  chanceSelfCurPct?: true;
  /** 技能无效时才结算（"技能无效时，消除对手回合类效果"）——主循环跳过，nullify/status-lock 分支单独执行 */
  nullifyOnly?: true;
  /** next-unit 登场结算时的生效目标（"己方下只精灵令对手下1次攻击无效"——存疑目标=登场者的对手）；缺省 "self" */
  onEnterTarget?: "self" | "opponent";
  /** 裸结算（periodic payload 用）：跳过免疫/锁/反弹/镜像/减疗等目标侧门——tick 语义不经过对招交互。 */
  plain?: true;
  /** 裸结算（periodic payload 用）：op 内部不再派发反应式触发器（clear 的 7/17、transfer 的 7、cleanse 的 13/16）。 */
  noHooks?: true;
}

/** 这些键不在 damage 上。分组器收进片段后，命中程序仍按原名读。 */
export interface HitFields {
  /** 穿透攻击方免疫窗口（"无视对手免疫伤害效果"） */
  pierce?: true;
  /** 穿透伤害护盾（"无视对手护盾效果"——跳过 dmgShield 吸收，不穿透 cap/减免） */
  pierceShield?: true;
  /** 额外固定伤害（并入同一伤害实例） */
  flatBonus?: number;
  /** 按自身最大体力百分比附加固伤（"附加自身最大体力30%的固定伤害"） */
  flatSelfPct?: number;
  /** 按自身当前体力百分比附加固伤（"附加自身当前体力30%的固定伤害"） */
  flatSelfCurPct?: number;
  /** 按当次回复溢出量百分比附加固伤（"附加溢出量26%的真实伤害"——heal 封顶外溢×pct%） */
  flatSelfOverflowPct?: number;
  /** 按自身体力分数附加固伤（"附加自身当前体力1/3的固定伤害"）；base=cur(默认)|max|missing */
  flatSelfFrac?: { numerator: number; denominator: number; base?: "max" | "current" | "missing" };
  /** 按对手体力分数附加固伤（"附加对手已损失生命值1/3的固定伤害"）；base=missing|cur|max(默认) */
  flatFoeFrac?: { numerator: number; denominator: number; base?: "max" | "current" | "missing" };
  flatFoeFracIf?: { when: Condition; numerator: number; denominator: number; base?: "max" | "current" | "missing" };
  /** 条件版自身分数固伤（"若消耗的护盾值大于300则附加自身最大体力1/3"） */
  flatSelfFracIf?: { when: Condition; numerator: number; denominator: number; base?: "max" | "current" | "missing" };
  /** 对手当前体力%固伤逐用累加（"加对手当前体力5%伤害，连续用每次5%，最高30%"）：flat=foeCur×min(cap,base+step×stacks)/100 */
  flatFoeCurPctPerUse?: { base: number; step?: number; cap?: number };
  /** 无条件/条件获得本系加成（"获得本系属性加成"） */
  forceStab?: true; forceStabIf?: { when: Condition };
  /** 自身异常状态每剩余1回合伤害提升pct%，cap封顶（"自身每有1回合异常状态造成伤害提升10%，最高70%"） */
  dmgPctPerSelfAilTurn?: { pct: number; cap?: number };
  /** 命中后对手下只出战精灵最大体力削减累积（"每次命中降低对手下只出战精灵最大体力10%，最多40%"） */
  foeNextMaxHpAcc?: { pct: number; cap?: number };
  /** 压血线（"对手剩余1点体力"/"若自身体力不足300则剩下100点"）：伤害=目标当前-保留值，cur≤保留值则不结算 */
  leaveHp?: number;
  /** 本招伤害上限（"…，最多300点"）：钳制本击总伤害 */
  cap?: number;
  /** 按自身已损失体力阶梯附加固伤（"每损失100点体力则额外附加50点固定伤害"→{step:100,add:50}） */
  flatPerMissing?: { step: number; add: number; /** step 按最大体力百分比解释（"每损失N%体力附加M点"） */ pct?: true };
  /** 命中后 pct% 概率使目标陷入异常（"每次攻击都有30%几率令对手害怕"）——逐击 draw */
  ailmentOnHit?: { name: string; pct: number };
  /** 随机固伤区间 [min,max]（rng 抽取，purpose:flat_range） */
  flatRange?: { min: number; max: number };
  /** 随机出伤%区间 [min,max]（"造成的伤害随机提升N%-M%"——rng 抽取，purpose:mul_range） */
  mulRange?: { min: number; max: number };
  /** 以自身当前体力值作伤害（"自杀/自己牺牲"——对自身 KO） */
  selfHp?: true;
  /** 随机分数区间（"随机降低对手N/M至M/K当前体力"——percent kind，pct 空间抽取） */
  fracRange?: { min: { numerator: number; denominator: number }; max: { numerator: number; denominator: number } };
  /** 对手护盾值 N% 固伤（"附加对手护盾值60%的真实伤害"） */
  flatFoeShieldPct?: number;
  flatFoeDefSumPct?: number;
  flatSelfShieldPct?: number;
  flatHpDiffPct?: number;
  flatFoeLastDmg?: boolean;
  /** 自身最近一次实际回复量固伤（"下次使用技能给对手造成等同于恢复量的固定伤害"——prevHeal 持久快照） */
  flatSelfLastHeal?: boolean;
  /** 自身属性值 N% 固伤（"附加自身速度值30%的固定伤害"——stat:"spd"|"hp"等 base 字段） */
  flatSelfStatPct?: { stat?: string; stats?: string[]; pct?: number; numerator?: number; denominator?: number };
  /** 攻方面板总和 N% 的百分比伤害（"附加自身防御、特防和速度总和30%的百分比伤害"——百分比类型、绝对幅值） */
  percentSelfStatPct?: { stat?: string; stats?: string[]; pct: number };
  flatFoeStatPct?: { stat?: string; stats?: string[]; pct: number };
  /** 连击逐击威力衰减（"每次命中对手后此技能威力下降N点"） */
  powerDropPerHit?: number;
  /** 固伤触发概率%（仅门控 flatBonus/flatRange，不门控基础伤害） */
  flatChance?: number;
  /** 条件威力放大（先出手×2 等）：满足→power×numerator/denominator */
  scaleIf?: { when: Condition; numerator: number; denominator: number };
  /** 无条件威力倍率（裸"威力翻倍"）：power×numerator/denominator */
  powerMul?: Frac;
  /** 无条件最终伤害倍率（"伤害提高50%"→{3,2}） */
  mul?: Frac;
  /** 条件最终伤害倍率（"对方异常状态时伤害提高100%"） */
  mulIf?: { when: Condition; numerator: number; denominator: number };
  /** 概率最终伤害倍率（"N%几率伤害为M倍"→ rng 门控） */
  mulChance?: { chance: number; numerator: number; denominator: number; chanceMulIf?: { when: Condition; numerator: number; denominator: number } };
  /** mulChance 的印记层数加成（"对手每存在1层裂痕则几率提升10%"）：有效概率 += add×层数 */
  mulChancePerMark?: { mark?: string; add: number; on?: "self" | "foe" | "both"; at?: "unit" | "slot" | "field"; kinds?: true };
  /** mulChance 叠用概率成长（"每次使用几率增加10%"）：有效概率 += useStacks×步长 */
  mulChancePerUse?: number;
  /** mulChance 叠用概率封顶（"最高几率30%"） */
  mulChanceUseCap?: number;
  /** 条件固伤（"若X则附加N点固定伤害"）：满足→并入 flat 段 */
  flatIf?: { when: Condition; flat?: number; range?: { min: number; max: number } };
  /** 伤害下限（"造成的伤害不少于N"；0 伤不破免疫语义，仍豁免） */
  minDamage?: number;
  /** 连击：伤害实例重复 hits 次（N~M 区间 rng 抽取；目标倒下即停） */
  hits?: { min: number; max: number; /** 叠用连击（'每次使用攻击次数+N'）：perUse×stacks 追加，cap 封顶 */ perUse?: number; cap?: number; /** 概率连击（"50%几率做1~4次攻击"——判定失败退回单击） */ chance?: number; /** 条件连击上限（"护盾状态下连击上限为9"） */ capIf?: { when: Condition; cap: number }; /** 本招 PP 低于阈值时上限改值（"当前技能PP值小于5时连击上限为40"） */ capIfPpBelow?: { pp: number; cap: number }; /** 命中成长连击（"每次命中后连击数+1，最高连击10次"）：每击落地后总数 +step，cap 封顶 */ growPerHit?: number };
  /** 招式固有致命一击（"本技能必定致命一击"——区别于 timed 窗口 crit_always） */
  crit?: boolean;
  /** 招式固有概率致命（"N%几率打出致命一击"——逐击 rng 判定） */
  critChance?: number;
  /** 分数致命率（"致命一击几率上升1/4"——drawBelow(d)<n；区别 critChance 百分制） */
  critChanceFrac?: { numerator: number; denominator: number };
  /** 条件必定致命（"若对手不处于能力下降状态则必定致命一击"） */
  critIf?: { when: Condition };
  /** 条件致命率（"先出手时50%的概率打出致命一击"） */
  critChanceIf?: { when: Condition; chance: number };
  /** 打出伤害反噬（"对方所受伤害的1/4反弹给自己"——自身承受 dmg×n/d） */
  recoilFrac?: { n: number; d: number };
  /** 当回合已承受技能伤害×pct% 固伤（"附加自身当回合所受技能伤害120%的百分比伤害"） */
  flatPrevTakenPct?: number;
  /** 对手当前体力×pct% 固伤（"攻击附加对手当前生命值30%的固定伤害"） */
  flatFoeCurPct?: number;
  /** 上回合已承受伤害×pct% 固伤（"附加自身上回合受到伤害数值50%的固定伤害"——prevTaken 快照） */
  flatPrevTurnTakenPct?: number;
  /** 自身上次造成伤害×pct% 固伤（"受到相当于本次伤害1/2的固定伤害"——lastDealt 记账） */
  flatSelfLastDmgPct?: number;
  /** 当次技能威力×N 固伤（"附加等同于当次技能威力值2倍的固定伤害"） */
  flatPowerMul?: number;
  /** 自身防御+特防提升段数合计×N 固伤（"防御和特防提升总段数乘以50"） */
  flatDefStageMul?: number;
  /** 自身能力提升状态种数×N 固伤（"每处于一种能力提升状态附加60"） */
  flatStageUpCountMul?: number;
  /** 双方能力提升状态种数合计×N 固伤（"双方每处于一种能力提升状态则附加60"） */
  flatBothStageUpCountMul?: number;
  /** 对手能力提升状态种数×N 固伤（"对手每处于一种能力提升状态则附加60"） */
  flatFoeStageUpCountMul?: number;
  /** 目标体力减至与自身相同（"将对方体力减到和自己相同"——整击重置） */
  matchSelfHp?: true;
  /** 固定伤害被目标免疫时转为真实伤害穿透（"若对手免疫固定伤害则转变为真实伤害"） */
  kindIfImmune?: "true" | { from: "fixed" | "percent"; flat?: number };
  /** 每 N 个非满 PP 槽位 +add 连击（"自身每有1项技能PP值不为满则连击次数+1"） */
  hitsPerPpGap?: { per: number; add: number };
  /** 连用致命率累积（"每次攻击提升N%的致命几率"——useStacks×per，cap 封顶）；critInitPct 初始率（"初始致命一击率为20%"） */
  critPerUsePct?: number; critPerUseCap?: number; critInitPct?: number;
  /** 连击威力不衰减（"触发连击效果时威力不再下降"——当前无衰减机制，记录语义） */
  hitsNoDecay?: boolean;
  /** 威力固定加成（"威力提升20点"——加算在 scaleIf/powerMul 之前） */
  powerAdd?: number;
  /** 条件固伤倍率（"对手异常状态时固定伤害翻倍"——作用于 flat 合计） */
  flatMulIf?: { when: Condition; numerator: number; denominator: number };
  /** 无条件固伤倍率（"固定伤害翻倍"——作用于 flat 合计） */
  flatMul?: Frac;
  /** 威力随机区间（"威力随机，范围50~150"——覆盖 power，rng 抽取 purpose:power_range） */
  powerRange?: { min: number; max: number };
  /** percent 精确分数基线（"吸取最大体力1/3"→{1,3}；缺省走 power% 整数百分） */
  frac?: Frac;
  /** percent 条件换分数（"吸取1/4，自身体力低于对手时变为1/3"——满足时按新分数结算） */
  fracIf?: { when: Condition; numerator: number; denominator: number };
  /** percent 基准（"附加对手当前体力20%的伤害"→current；"已损失体力值N%的百分比伤害"→foeMissing；缺省 max） */
  percentBase?: "current" | "selfCur" | "selfMax" | "foeMissing";
  /** 微弱无效化（"伤害不会出现微弱"）——克制倍率下限抬到 1.0 */
  noResist?: true;
  /** 等量固伤（"造成等量固定伤害"）：本击实际伤害额追加一笔 fixed 伤害 */
  flatEcho?: { when?: Condition; pct?: number };
  shieldEcho?: boolean;
  /** 受击方等量护盾（"吸取对手250点体力且为对手附加等量护盾"）：本击实伤→受击方 shield.flat */
  foeShieldEcho?: boolean;
  /** 等量真实伤害回响（"额外附加等量的真实伤害"）：本击实伤等额 true 追加，不走克制/免疫 */
  trueEcho?: boolean;
  /** 条件等量真实伤害（"若对手未受到固定伤害则额外附加等量真实伤害"） */
  trueEchoIf?: { when: Condition };
  healOnHit?: { numerator: number; denominator: number };
  flatOnHit?: { chance: number; flat: number };
  /** 按上次伤害分数附加固伤（"附加自身造成的攻击伤害N%的固伤"——ctx.lastDamage 缩放，魂印 onDamageDealt 语境） */
  lastDmgFrac?: { numerator: number; denominator: number };
  /** 双方最大体力差值 N% 固伤（"附加对手与自身最大体力差值的固定伤害"） */
  flatMaxHpDiffPct?: number;
  /** 命中降级（"每次直接攻击都会使对手防御和特防-1"）：逐击对受击方 apply_stat_stage */
  stageOnHit?: { stat: StageStatKey; delta: number }[];
  /** 受击方防御值百分固伤（"附加对手防御值30%的固定伤害"——base.def，UNVERIFIED 基线） */
  flatFoeDefPct?: number;
  /** 自身防御+特防总和百分固伤（"附加自身防御、特防总和30%的固定伤害"） */
  flatSelfDefSumPct?: number;
  flatRangeIf?: { when: Condition; min: number; max: number };
  flatPerStage?: { who: "self" | "foe" | "both"; sign: "up" | "down"; per: number; flat: number; mode?: "count" | "levels"; drain?: boolean; /** 单维过滤（"自身速度每提升1段附加50点"→spd） */ stat?: StageStatKey };
  flatPerHpPct?: { who: "self" | "foe"; per: number; flat: number };
  /** 按目标异常种数附加固伤（"对手每处于1种异常状态则附加60点固定伤害"） */
  flatPerAilment?: number;
  /** 按自身攻击值百分比附加固伤（"附加自身攻击值30%的固定伤害"——base.atk，UNVERIFIED 基线） */
  flatSelfAtkPct?: number;
  /** 速度值分数固伤（"附加速度的1/3伤害"） */
  flatSelfSpdFrac?: { numerator: number; denominator: number };
  powerPerUse?: number;
  /** 叠用威力增量封顶（"连续使用威力增加30，最多增加90"——add 量上限，区别于 useCap 总威力上限） */
  powerPerUseCap?: number;
  /** 对方存活数净差增威（"对方每比己方多存活1只精灵威力提升100点"）：floor((foeAlive-selfAlive)/per)*add，负差按0 */
  powerPerAliveDiff?: { per: number; add: number };
  /** 按能力等级数加连击（"每处于N种强化状态则连击数+M"）：floor(维度数/per)*add */
  hitsPerStage?: { who: "self" | "opponent"; sign?: "up" | "down"; per: number; add: number };
  /** 每 N 级先制连击+add（"自身每有1级先制则连击次数+1"——先制等级=基础 priority+prio_up 合计） */
  hitsPerPrio?: { per: number; add: number };
  /** 连用固伤自体叠乘封顶（"附加20点固定伤害，连续使用叠加最高100"——flat×(stacks+1)，cap 封总值） */
  flatStackCap?: number;
  /** 按已损体力百分比加威力（"每损失N%体力威力提升M点"）：floor(损失%/per)*pow */
  powerPerMissing?: { per: number; pow: number };
  powerMulPerUse?: { numerator: number; denominator: number };
  /** 叠用威力倍率封顶（"每次使用威力增加25%，最高增加100%"——总倍率上限，{200,100}=+100%） */
  powerMulPerUseCap?: { numerator: number; denominator: number };
  flatPerUse?: number;
  /** 叠用固伤封顶（"最高附加N点固定伤害"——flatPerUse×stacks 上限） */
  flatPerUseCap?: number;
  /** 取双攻最高值攻击（"将自身攻击和特攻中最高的能力值作为自己的能力值进行攻击"） */
  useBestOffense?: true;
  /** 取对手双攻最高值攻击（"将对手攻击和特攻中最高的能力值作为自己的能力值进行攻击"） */
  useFoeBestOffense?: true;
  /** 自损换伤（"损失自身1/2体力给予对手造成同等的伤害"）：自身先失去 currentHp×n/d，对手等额 fixed */
  selfTradeFrac?: { n: number; d: number };
  /** 自耗等量反伤（"消耗自身1/2体力使对手受到等量百分比伤害"）：self 自伤后按 n/d 反打对手 */
  selfCostEcho?: true | { numerator: number; denominator: number };
  dmgPerUsePct?: number;
  /** 叠用伤害%封顶（"连续使用每次增加10%，最高45%"——dmgPerUsePct×stacks 上限） */
  dmgPerUsePctCap?: number;
  useCap?: number;
  /** 每种自身正面能力等级威力+N（"自身每处于1种能力提升状态威力提升20"） */
  powerPerSelfStage?: number;
  /** 每种对手正面能力等级威力+N（惩罚族；"对方能力等级越高威力越大"系数 UNVERIFIED 时由数据显式给） */
  powerPerFoeStage?: number;
  /** 每种自身正面能力等级伤害+N%（"每处于1种能力提升状态伤害提升20%"——线性叠加 100+pct·n） */
  pctPerSelfStage?: number;
  /** 阈值固伤（"造成的伤害低于300则附加300点固定伤害"）：本击伤害<min→并入 flat */
  flatIfBelow?: { min: number; flat?: number; selfPct?: number };
  /** 耗盾转伤（"消耗自身所有护盾值并造成等量固定伤害"）：移除自身护盾条目，吸收量合计并入 flat */
  consumeShield?: true;
  /** 每层印记附加固伤（"对手每存在1层致命裂痕则附加100点真实伤害"）：flat += add×层数 */
  flatPerMark?: { mark?: string; add: number; on?: "self" | "foe" | "both"; at?: "unit" | "slot" | "field"; kinds?: true };
  /** 按刚被清除的能力等级段数附加固伤（"若自身能力提升状态被消除，每消除1项附加N点"——仅 react trigger7 派发语境有值） */
  flatPerRemoved?: number;
  /** 每层印记终伤 +add%（"场上每有1种五行印记伤害提升25%"→kinds:true,at:"field",on:"both"）：dmg×(100+add×层数)/100 */
  mulPerMark?: { mark?: string; add: number; on?: "self" | "foe" | "both"; at?: "unit" | "slot" | "field"; kinds?: true };
  /** 对手已损失体力阶梯固伤（"对手每损失2点体力则额外附加1点固定伤害"） */
  flatPerFoeMissing?: { step: number; add: number };
  /** 同维能力等级相同计数固伤（"对手每有1项能力等级与自身相同则附加70点固定伤害"——0 级不计） */
  flatPerMatchedStage?: { per: number; add: number };
  /** 对手已损失 PP 总和×mul 固伤（"附加对手已损失PP值总和×20的固定伤害"）；who:"both"=双方合计 */
  flatFoePpMissing?: { mul: number; who?: "foe" | "both" };
  /** 战斗回合数×mul 固伤（"附加当前战斗回合数×20的固定伤害"） */
  flatPerTurn?: { mul: number };
  /** 对方场下每阵亡 per 只附加 add 固伤（"对方场下每死亡1只精灵则附加100点固定伤害"） */
  flatPerFoeDead?: { per: number; add: number };
  /** 重置本招连用计数（"重置该技能使用次数"） */
  resetStacks?: true;
  /** 条件改写固伤为区间随机（"若伤害高于400则效果转变为300-350点"——替代已累计 flat 总额；when 缺省=恒转） */
  flatRepIf?: { when?: Condition; range: { min: number; max: number } };
  /** 对手每处于一种异常状态伤害提升 pct%（cap 封总，"对手每处于一种异常状态造成的伤害提升50%"） */
  dmgPctPerFoeAil?: { pct: number; cap?: number };
  /** 对手能力下降总段数×pct% 伤害提升（"伤害提升对手能力下降总段数乘以10%"——Σ|负级|×pct） */
  dmgPctPerFoeDownStage?: { pct: number };
  /** 带方向/层数的能力等级威力缩放（"对手每处于1种能力下降状态威力提升20%"/"威力提升值为对手能力下降状态总和×30%"）：kind:"flat" 加算 points，"pct" 乘算百分比；mode:"levels" 按总段数缺省按种数 */
  powerPerStageScale?: { who: "self" | "foe"; sign?: "up" | "down"; per: number; add: number; mode?: "count" | "levels"; kind: "flat" | "pct" };
  /** 每 N 只死亡精灵附加 add 固伤（"每有1只精灵死亡则附加100点固定伤害"——who:self/foe/all 计场下阵亡数） */
  flatPerDead?: { who: "self" | "foe" | "all"; per: number; add: number };
  /** 每 N 个 PP 归零槽位附加 add 固伤（"双方每有1项技能PP值为0吸取对手70点体力"——drain=等额回血） */
  flatPerPpZero?: { who: "self" | "foe" | "both"; per: number; add: number; drain?: boolean };
  /** 固伤/百分比被免疫时追加 N 点真实伤害（"对手免疫百分比伤害时额外附加250点真实伤害"） */
  flatIfFoeImmune?: number;
  /** 连击次数达到区间上限时最后一击必杀（"若本回合攻击次数达到最大则必定秒杀对手"——hits.max 命中即 KO） */
  koIfHitsMax?: boolean;
  /** 自身最近一次受击伤害等量并入固伤（"做出绝对反击"——react payload 读 unit.lastTaken） */
  flatSelfLastTaken?: boolean;
  /** 本回合护盾/护罩吸收量×pct% 并入固伤（"护盾所吸收的伤害值N%反弹"——shieldAbsorbed 记账） */
  shieldAbsorbPct?: number;
}

export type CompiledEffect = (
  | {
      op: "damage"; power: number; kind?: DamageKind;
      /** 命中侧：默认对手；"self"=自残/自耗（"消耗自身全部体力"），不吃克制/免疫/反击。 */
      target?: OpTarget;
    }
  | { op: "apply_stat_stage"; stat: StageStatKey | "random" | "all"; randomCount?: number; /** 全正级翻倍（'自身强化状态翻倍'） */ multiplySelf?: boolean; delta: number; target: OpTarget; /** 条件增幅（"体力低于1/2强化翻倍"）：满足→delta×n/d */ deltaMulIf?: { when: Condition; numerator: number; denominator: number }; /** 概率增幅（"30%概率强化效果翻倍"）：rng 命中→delta×n/d；perBench=判定概率随己方背包计数放大（"背包内每存活N只精灵则X%强化翻倍"） */ deltaMulChance?: { chance: number; numerator: number; denominator: number; perBench?: { of: "alive" | "dead"; per: number } } }
  | { op: "heal"; numerator?: number; denominator?: number; flat?: number; flatRange?: { min: number; max: number }; target: OpTarget | "bench"; /** 条件回复翻倍（"体力低于1/2时恢复效果翻倍"） */ mulIf?: { when: Condition; numerator: number; denominator: number }; /** 条件换分数（"体力低于1/2时变为吸取1/2"——仅分数型回复） */ fracIf?: { when: Condition; numerator: number; denominator: number }; /** 以已损失体力为基线（"恢复当前受损体力值1/3的体力"） */ missing?: true; /** 等量反噬（"恢复…同时给对手造成等量固定伤害"）：按实际回复量对对手追加 fixed 伤害；带分数 = 回复量的 n/d */ foeEcho?: true | { numerator: number; denominator: number }; /** 回响条件门（"恢复体力时若自身体力低于1/2则附加等量百分比伤害"） */ foeEchoIf?: { when: Condition }; /** 自伤回响条件门 */ selfEchoIf?: { when: Condition }; /** 自伤反噬（"恢复体力，受到恢复体力值1/3的固定伤害"）：回复后自身承受回复量 n/d 的 fixed 伤害 */ selfEcho?: true | { numerator: number; denominator: number }; /** 回复量上限（"最多获得N点"） */ cap?: number; /** 体力置为定值（"将对手体力变为N"——非加算，置位语义） */ set?: number; /** 体力置为最大体力百分比（"令自身体力等于最大体力的50%"） */ setPct?: number; /** 镜像对手上次回复量（"若对手恢复体力则自身恢复等量体力的100%"）：amount=foe.lastHeal×pct/100 */ foeLastHealPct?: number; /** 体力置为区间随机值（"变为N-M点体力"） */ setRange?: { min: number; max: number }; /** 每 N 只己方存活精灵恢复 add 点（"己方每有1只精灵存活则恢复50点体力"） */ flatPerAlive?: { per: number; add: number }; /** 低于阈值每 per 点体力恢复 add（"体力低于500点则每低1点恢复1点"——amount=floor((threshold−hp)/per)×add；阈值由守卫烘入） */ perBelowAbs?: { threshold: number; per: number; add: number }; /** 对手每有 N 只不在场精灵恢复 add 点（bench 槽位计数） */ flatPerFoeBench?: { per: number; add: number; aliveOnly?: boolean }; /** 对手每有 N 只不在场精灵恢复 maxHp×n/d */ fracPerFoeBench?: { per: number; n: number; d: number; aliveOnly?: boolean }; /** 每 N 种正/负 stage 恢复 flat 点（"每处于1种能力提升状态则恢复30点体力"——count 模式，stage 种类数） */ flatPerStage?: { who?: "self" | "foe"; sign?: "up" | "down"; per: number; flat: number }; /** 双防和百分比回复（"恢复相当于自身防御与特防之和N%的体力"） */ defSumPct?: number; /** 耗盾转奶（"消耗自身护盾并恢复等量体力"）：移除自身护盾/护罩条目，吸收量合计并入回复额 */ consumeShield?: true; /** 读盾转奶（"恢复等同于护盾、护罩值之和的体力"）：回复量=当前护盾+护罩 flat 合计，不消耗盾值 */ shieldSum?: true; /** 恢复至最大体力 n/d（"最多恢复至自身最大体力的1/2"） */ capFracN?: number; capFracD?: number; /** 条件转变为吸取对手 flat 点体力（"恢复效果转变为吸取对手N点体力"——回复空转，改走 drain 通道；when 缺省=恒转） */ drainFlatIf?: { when?: Condition; flat: number }; /** 条件转变为对对手附加自身最大体力 n/d 百分比伤害（"转变为附加自身最大体力1/3的百分比伤害"；when 缺省=恒转） */ pctSwapIf?: { when?: Condition; n: number; d: number } }
  | { op: "transfer_stages"; direction?: "steal" | "push" | "upToDown"; /** push/steal 倍率（'双倍反馈'/'双倍吸取'） */ mul?: Frac | number; /** 随机吸取 N 项（"随机吸取对手N项属性-1"）：对手该维-=randomDelta 自身+=randomDelta */ randomCount?: number; randomDelta?: number; /** 次数区间（"随机吸取对手1-6项"） */ randomCountRange?: { min: number; max: number }; /** 单维过滤（"吸取对手速度"） */ stat?: StageStatKey; /** 只吸正级/负级 */ sign?: "up" | "down" }
  | { op: "clear_stages"; target: OpTarget; sign?: "up" | "down"; /** 限定维度（缺省全维；"消除防御能力提升"→["def","sdf"]） */ stats?: readonly string[]; /** 被移除等级段数×N 固伤给被清侧（"消除总段数乘以35的固定伤害"） */ flatPerRemoved?: number; /** 清除成功 rider（"消除任意一项成功则附加N固伤且令对手随机M技能PP归零"——对手=施清方的对方） */ onClear?: { flat?: number; ppZeroFoe?: number } }
  | { op: "control"; name: string; turns: number; target: OpTarget }
  | { op: "cleanse"; target: OpTarget; scope?: "control" | "timed" | "ailment" | "shield"; /** 只移除指定 kind 的条目（"解除自身的烧伤"→effect:"burn"；"解除烧伤、冻伤、中毒"→列表） */ effect?: string | string[]; /** 被移除护盾值总和的 % 反噬伤害（"附加等同于消除护盾值总和N%的百分比伤害"，仅 scope:"shield" 有意义） */ echoPct?: number; /** 偷盾（"消除并获得对手的护盾、护罩"）：被移除的盾罩按种类与剩余 flat 转移给行动方，仅 scope:"shield" 有意义 */ stealShield?: true; /** 清除成功 rider（"消除任意一项成功则附加N固伤且令对手随机M技能PP归零"） */ onClear?: { flat?: number; ppZeroFoe?: number } }
  | { op: "apply_status"; name: string; turns?: number; /** 随机持续区间（"作用N~M回合"——落地抽一次） */ turnsRange?: { min: number; max: number }; target: OpTarget; params?: Record<string, number>; /** 系别门控（"受到的火系攻击伤害减半"——来招 type 不符则窗关，随条目持久化） */ moveType?: string; /** 审计标签（periodic 条目的原语义名——事件 cause/合并键） */ label?: string; /** 禁止合并（'每回合叠加新实例'类——prio_push_tick 逐回合叠加） */ stack?: true; /** 子类限定（"免疫受到的麻痹状态"→ailment:"paralysis"——落地时 kind 合成为 name:ailment，仅匹配该异常） */ ailment?: string; /** 随机择一/多施加（"随机进入麻痹或睡眠中的1种"）：list 抽 count 个，逐抽 rng 记账 */ random?: { list: string[]; count: number; /** 抽数区间（"随机进入1-2种异常状态"——先抽数量再逐项抽取） */ countRange?: { min: number; max: number } }; /** react 触发器负载（kind=react 时由引擎在触发点派发）：params.trigger=1受击受伤 2对手MISS 3对手行动 4破盾 5倒下 6自身MISS 7强化消失 8回合未受击 9对手换入 */ payload?: CompiledEffect[]; /** 次数值=印记层数（"对手每存在1层处决印记自身免疫1次异常"）：params.count=floor(层数/per) */ countPerMark?: { mark: string; per?: number; on?: "self" | "foe"; at?: "unit" | "slot" | "field" }; /** 落地时按目标指定异常剩余回合数×pct 烘焙 params.pct（"自身每有1回合流血伤害提升15%最高90%"） */ pctPerAilTurn?: { ail?: string; per?: number; pct: number; cap?: number }; /** 条件延长持续回合（"若伤害高于400则效果延长1回合"——落地后按谓词补 remainingTurns；when 缺省=恒延） */ extendIf?: { when?: Condition; turns: number }; /** flat 累加合并（maxhp_tick 周期累加——合并时 flat+= 而非覆盖） */ accFlat?: true; /** flat ×=⌊持有者指定维正级/per⌋（maxhp perStage 变体——落地时烘焙） */ mulSelfStageLvl?: { stat: StageStatKey; per: number } }
  | { op: "apply_mark"; /** 印记名（存为 kind "mark:<名>"；"*"=consume 全部） */ mark: string; target: OpTarget; /** 挂载位置：unit(默认)=单位效果表 slot=招式槽 field=己方/对方场地 */ at?: "unit" | "slot" | "field" | "all"; /** 本次附加层数（默认1） */ count?: number; /** 单层上限（"每个技能最多3枚"→slot 每槽 cap；"最多3层"→unit cap） */ cap?: number; /** 单位总层数上限（仅 slot 散布有意义："每个精灵最多5枚"） */ unitCap?: number; /** 计时印记（场地印记"附加5回合金之肃革"） */ turns?: number; /** slot 散布时逐层随机槽位（"随机为对手任意技能散布N枚"） */ pick?: "randomMove" }
  | { op: "consume_mark"; /** 印记名或 "*"（"解放全部龙鳞"） */ mark: string; target: OpTarget; /** 消耗位置（默认 unit；"all"=单位+槽位+场地全清） */ at?: "unit" | "slot" | "field" | "all"; /** 消耗层数（缺省=该印记全部层数） */ count?: number; /** slot 消耗随机已占槽（缺省=当前招式槽——"使用后移除当前技能印记"） */ pick?: "randomMove" }
  | { op: "apply_effect"; name: string; turns?: number; target: OpTarget; params?: Record<string, number> }
  | { op: "pp_delta"; amount?: number; /** 槽位/全槽 PP 置为定值（"第N技能PP值变为K"/"归0"=set:0——与 amount 增量语义区分） */ set?: number; full?: boolean; /** 全槽 PP 归零（"对手所有技能PP值归零"） */ zero?: boolean; /** 威力最高槽 PP 归零（"令对手威力最高的技能PP归零"） */ zeroMaxPower?: boolean; zeroRandom?: number; /** 抽槽数区间上限（"随机N-M项技能PP值归零"——落地抽 count∈[zeroRandom,zeroRandomMax]） */ zeroRandomMax?: number; /** 随机抽 N 个槽位 PP 置为 value（"使对手随机M项技能PP值变K"） */ setRandom?: { count: number; value: number }; /** 指定槽位：N=1-based 序号（"第N技能"）|"fifth"=第五标记槽（"第五技能PP值归0"） */ slot?: number | "fifth"; target: OpTarget; scope?: "all" | "current" | "others"; /** cat 过滤（"令对手攻击技能PP值归0"→cat:4=非属性招；1=属性招） */ cat?: number; /** 各槽增量=行动方本招式剩余PP×pct%（"恢复自身其他技能此技能剩余PP值的50%"） */ amountFromThisPct?: number; /** 随机抽 count 槽各 ±delta（"随机2个技能PP+1"） */ amountRandom?: { count: number; delta: number }; /** 全槽各抽区间幅度（"所有技能PP随机减少1-2点"） */ amountRange?: { min: number; max: number }; /** bench 目标时只算存活后备（"不在场且存活精灵"） */ aliveOnly?: boolean; /** 目标全槽 PP 置为行动方本招式剩余 PP（"令双方所有技能PP值等于此技能剩余PP值"） */ setFromThis?: true; /** 每恢复 per 点 PP 吸取对手 flat 点体力（"每恢复1点PP吸取对手30点体力"——按实际恢复量计费） */ drainPerPpPoint?: { per: number; flat: number } }
  | { op: "force_switch"; target: OpTarget }
  | { op: "copy_stages"; sign?: "up" | "down"; /** 只复制某一维（"自身的防御力和对手相同"） */ stat?: "atk" | "def" | "spa" | "sdf" | "spd" | "acc"; /** 反向同步：target 侧等级改写为另一侧同维（"使对手该能力等级变为与自身相同"） */ match?: true; target?: OpTarget }
  | { op: "invert_stages"; sign?: "up" | "down"; mul?: { numerator: number; denominator: number }; target?: OpTarget }
  | { op: "swap_hp"; target: OpTarget; /** 体力百分比对调（"自身体力百分比与对手体力百分比对调"）——缺省为 currentHp 绝对值互换 */ swapPercent?: true }
  | { op: "banish_dead"; target: OpTarget }
  /** 能力等级回溯（"将自身能力等级返回至上一回合结束时"）：逐维写回目标本回合开始的能力等级快照
   *  （== 上一回合结束时的等级，回合内改的是本回合 stages，快照不动）。turns>1 要历史缓冲，按无快照处理。 */
  | { op: "stages_rewind"; target: OpTarget; turns?: number }
  /** 本击克制倍率取「自身→对手」与「对手→自身」的最大值（"克制倍数取自身对对手、对手对自身克制倍数中的最大值"）：
   *  处理器把 ×16 定点的最大值记在行动方单位上（ops/slots/w09.ts），供同一次命中的克制读法使用。 */
  | { op: "eff_max"; target: OpTarget }
  /** 具名开关位（"衍化/复原/改为逆转"）：单位效果表里 tag:<name>:forward|revert 的置位与清除，无计时。
   *  to 缺省=正转位；clear:true=只清不置；remove/removeState=顺带复位的别的开关。 */
  | { op: "set_mode_flag"; name: string; target: OpTarget; to?: "forward" | "revert"; clear?: true; remove?: readonly string[]; removeState?: "forward" | "revert" }
  | { op: "hp_delta"; target?: OpTarget; /** 定额直损 */ flat?: number; /** 定额区间直损（落地抽一次） */ flatRange?: { min: number; max: number }; /** 持有者正/负级维数 ÷per ×flat 直损 */ selfStageFlat?: { flat: number; per: number; sign?: "up" | "down" }; /** 目标体力分数直损；of=max(默认)|cur */ frac?: { numerator: number; denominator: number; of?: "max" | "cur" }; /** 持有者体力分数直损（pctConv 转变——'转变为附加自身最大体力1/3'） */ fracSelf?: { numerator: number; denominator: number; of?: "max" | "cur" }; /** 持有者本回合伤害量×n/d 附加（dealt_tick） */ ofSelfDealt?: { numerator: number; denominator: number }; /** 持有者本回合免疫次数×flat 附加 */ perImmuneFlat?: number; /** 伤害类型（缺省 fixed） */ kind?: "fixed" | "percent" | "true"; /** 事件 cause 覆写（缺省 status:<label>） */ cause?: string; /** 点直损=目标当前全部体力（doom） */ kill?: true; /** 持有者回血：of=dealt(实际扣量)|amount(全额)，×n/d */ healSelf?: { numerator: number; denominator: number; of?: "dealt" | "amount" }; /** flatImmune 尊重（缺省）/ignore；免疫时转 N 点真伤 */ flatImmune?: "respect" | "ignore"; flatImmuneConvert?: { flat: number }; /** 结算后为己方不在场存活精灵定额回血 */ benchHeal?: { flat: number; requireSelfFull?: boolean } }
  | { op: "transfer_ailments"; /** pull=对手异常→自身 push=自身异常→对手 */ direction?: "pull" | "push"; target: OpTarget; /** 每迁移一条异常吸取对手 flat 点体力（"每转移一项吸取对手404点体力"） */ drainPer?: number; /** 每迁移一项令对手随机 N 项技能 PP 归零（"每转移一项令对手随机1项技能PP值归零"） */ ppZeroPer?: number }
  | { op: "stat_boost"; /** 面板维集合（"双攻"→[atk,spa] 由解析侧展开） */ stats: ("hp" | "atk" | "def" | "spa" | "sdf" | "spd")[]; /** 定额加成 */ add?: number; /** 百分比加成（对当前 base） */ pct?: number; target: OpTarget }
  | {
      op: "grow";
      /** 闭变体。再加一种成长只改这里，不加条目字段。 */
      of: "magnitude";
      /** 每次结算累加。缺省不记账。 */
      step?: number;
      /** 封顶。负值是地板。 */
      magCap?: number;
      /** 裸值域（power/flat）也吃封顶。 */
      point?: true;
      /** 达顶的这次结算后清零。 */
      resetOnCap?: true;
      /** 达顶时裸值域乘这倍率。 */
      atCapMul?: number;
      /** 达顶看结算前的累积，不看加上这次。 */
      atCapNext?: true;
      /** 达顶后追加派发。 */
      payload?: readonly CompiledEffect[];
    }
  /** beforeOrder 的先制区间。orderRoll 读，不在 applyOp 里掷点。 */
  | { op: "priority"; min: number; max: number }
  /** 吸血骑乘。只许紧跟 damage，分组后由 damageOp 里的 applyDrainRider 读，不单独结算。 */
  | { op: "applyDrainRider"; drain?: Frac; drainIf?: { when: Condition; numerator: number; denominator: number }; drainMul?: Frac; drainTo?: "foe"; drainFlat?: number; drainEcho?: true | { numerator: number; denominator: number }; drainEchoIf?: { when: Condition } }
  | { op: "applyFlatIfFoeImmune"; flatIfFoeImmune?: HitFields["flatIfFoeImmune"] }
  | { op: "applySelfCostEcho"; selfCostEcho?: HitFields["selfCostEcho"] }
  | { op: "applyRecoilFrac"; recoilFrac?: HitFields["recoilFrac"] }
  | { op: "applyFlatEcho"; flatEcho?: HitFields["flatEcho"] }
  | { op: "applyFoeNextMaxHpAcc"; foeNextMaxHpAcc?: HitFields["foeNextMaxHpAcc"] }
  | { op: "applyShieldEcho"; shieldEcho?: HitFields["shieldEcho"] }
  | { op: "applyFoeShieldEcho"; foeShieldEcho?: HitFields["foeShieldEcho"] }
  | { op: "applyTrueEcho"; trueEcho?: HitFields["trueEcho"]; trueEchoIf?: HitFields["trueEchoIf"] }
  | { op: "applyHealOnHit"; healOnHit?: HitFields["healOnHit"] }
  | { op: "applyFlatOnHit"; flatOnHit?: HitFields["flatOnHit"] }
  | { op: "applyAilmentOnHit"; ailmentOnHit?: HitFields["ailmentOnHit"] }
  | { op: "applyStageOnHit"; stageOnHit?: HitFields["stageOnHit"] }
  | { op: "power"; of: "powerAdd" | "powerDropPerHit" | "powerMul" | "powerMulPerUse" | "powerMulPerUseCap" | "powerPerAliveDiff" | "powerPerFoeStage" | "powerPerMissing" | "powerPerSelfStage" | "powerPerStageScale" | "powerPerUse" | "powerPerUseCap" | "powerRange" | "resetStacks" | "scaleIf" | "useCap"; value: NonNullable<HitFields["powerAdd" | "powerDropPerHit" | "powerMul" | "powerMulPerUse" | "powerMulPerUseCap" | "powerPerAliveDiff" | "powerPerFoeStage" | "powerPerMissing" | "powerPerSelfStage" | "powerPerStageScale" | "powerPerUse" | "powerPerUseCap" | "powerRange" | "resetStacks" | "scaleIf" | "useCap"]> }
  | { op: "formula"; of: "forceStab" | "forceStabIf" | "frac" | "fracIf" | "fracRange" | "kindIfImmune" | "noResist" | "percentBase" | "percentSelfStatPct" | "selfHp" | "selfTradeFrac" | "useBestOffense" | "useFoeBestOffense"; value: NonNullable<HitFields["forceStab" | "forceStabIf" | "frac" | "fracIf" | "fracRange" | "kindIfImmune" | "noResist" | "percentBase" | "percentSelfStatPct" | "selfHp" | "selfTradeFrac" | "useBestOffense" | "useFoeBestOffense"]> }
  | { op: "crit"; of: "crit" | "critChance" | "critChanceFrac" | "critChanceIf" | "critIf" | "critInitPct" | "critPerUseCap" | "critPerUsePct"; value: NonNullable<HitFields["crit" | "critChance" | "critChanceFrac" | "critChanceIf" | "critIf" | "critInitPct" | "critPerUseCap" | "critPerUsePct"]> }
  | { op: "scale"; of: "dmgPctPerFoeAil" | "dmgPctPerFoeDownStage" | "dmgPctPerSelfAilTurn" | "dmgPerUsePct" | "dmgPerUsePctCap" | "mul" | "mulChance" | "mulChancePerMark" | "mulChancePerUse" | "mulChanceUseCap" | "mulIf" | "mulPerMark" | "mulRange" | "pctPerSelfStage"; value: NonNullable<HitFields["dmgPctPerFoeAil" | "dmgPctPerFoeDownStage" | "dmgPctPerSelfAilTurn" | "dmgPerUsePct" | "dmgPerUsePctCap" | "mul" | "mulChance" | "mulChancePerMark" | "mulChancePerUse" | "mulChanceUseCap" | "mulIf" | "mulPerMark" | "mulRange" | "pctPerSelfStage"]> }
  | { op: "flat"; of: "flatBonus" | "flatBothStageUpCountMul" | "flatChance" | "flatDefStageMul" | "flatFoeCurPct" | "flatFoeCurPctPerUse" | "flatFoeDefPct" | "flatFoeDefSumPct" | "flatFoeFrac" | "flatFoeFracIf" | "flatFoeLastDmg" | "flatFoePpMissing" | "flatFoeShieldPct" | "flatFoeStageUpCountMul" | "flatFoeStatPct" | "flatHpDiffPct" | "flatIf" | "flatMaxHpDiffPct" | "flatMul" | "flatMulIf" | "flatPerAilment" | "flatPerDead" | "flatPerFoeDead" | "flatPerFoeMissing" | "flatPerHpPct" | "flatPerMark" | "flatPerMatchedStage" | "flatPerMissing" | "flatPerPpZero" | "flatPerRemoved" | "flatPerStage" | "flatPerTurn" | "flatPerUse" | "flatPerUseCap" | "flatPowerMul" | "flatPrevTakenPct" | "flatPrevTurnTakenPct" | "flatRange" | "flatRangeIf" | "flatRepIf" | "flatSelfAtkPct" | "flatSelfCurPct" | "flatSelfDefSumPct" | "flatSelfFrac" | "flatSelfFracIf" | "flatSelfLastDmgPct" | "flatSelfLastHeal" | "flatSelfLastTaken" | "flatSelfOverflowPct" | "flatSelfPct" | "flatSelfShieldPct" | "flatSelfSpdFrac" | "flatSelfStatPct" | "flatStackCap" | "flatStageUpCountMul" | "lastDmgFrac" | "shieldAbsorbPct"; value: NonNullable<HitFields["flatBonus" | "flatBothStageUpCountMul" | "flatChance" | "flatDefStageMul" | "flatFoeCurPct" | "flatFoeCurPctPerUse" | "flatFoeDefPct" | "flatFoeDefSumPct" | "flatFoeFrac" | "flatFoeFracIf" | "flatFoeLastDmg" | "flatFoePpMissing" | "flatFoeShieldPct" | "flatFoeStageUpCountMul" | "flatFoeStatPct" | "flatHpDiffPct" | "flatIf" | "flatMaxHpDiffPct" | "flatMul" | "flatMulIf" | "flatPerAilment" | "flatPerDead" | "flatPerFoeDead" | "flatPerFoeMissing" | "flatPerHpPct" | "flatPerMark" | "flatPerMatchedStage" | "flatPerMissing" | "flatPerPpZero" | "flatPerRemoved" | "flatPerStage" | "flatPerTurn" | "flatPerUse" | "flatPerUseCap" | "flatPowerMul" | "flatPrevTakenPct" | "flatPrevTurnTakenPct" | "flatRange" | "flatRangeIf" | "flatRepIf" | "flatSelfAtkPct" | "flatSelfCurPct" | "flatSelfDefSumPct" | "flatSelfFrac" | "flatSelfFracIf" | "flatSelfLastDmgPct" | "flatSelfLastHeal" | "flatSelfLastTaken" | "flatSelfOverflowPct" | "flatSelfPct" | "flatSelfShieldPct" | "flatSelfSpdFrac" | "flatSelfStatPct" | "flatStackCap" | "flatStageUpCountMul" | "lastDmgFrac" | "shieldAbsorbPct"]> }
  | { op: "cap"; of: "cap" | "flatIfBelow" | "leaveHp" | "matchSelfHp" | "minDamage"; value: NonNullable<HitFields["cap" | "flatIfBelow" | "leaveHp" | "matchSelfHp" | "minDamage"]> }
  | { op: "strike"; of: "consumeShield" | "hits" | "hitsNoDecay" | "hitsPerPpGap" | "hitsPerPrio" | "hitsPerStage" | "koIfHitsMax" | "pierce" | "pierceShield"; value: NonNullable<HitFields["consumeShield" | "hits" | "hitsNoDecay" | "hitsPerPpGap" | "hitsPerPrio" | "hitsPerStage" | "koIfHitsMax" | "pierce" | "pierceShield"]> }
) & EffectEnvelope;

export interface CompiledUnit {
  id: string;
  /** 中文物种名（专属刻印匹配用）。 */
  name: string;
  /** 种族值（six-stat 模式）或面板值（legacy 四维）。 */
  base: { hp: number; atk: number; def: number; spd: number; spa?: number; sdf?: number };
  moveIds: string[];
  types?: string[];
  /** 性别（"若对手为雄性/雌性则"谓词）；"male"|"female"|"none"|缺省=无数据按 none 判定。 */
  gender?: "male" | "female" | "none";
  revives?: number;
  mode?: string;
  /** six-stat：个体实例参数（loader 补默认 level=100/ivs=31/evs=0/nature=无修正）。 */
  level?: number;
  ivs?: StatSpread;
  evs?: StatSpread;
  nature?: string;
  /** 预设刻印 loadout（可被对局创建时 loadout 覆盖）。 */
  seals?: string[];
  /** soulmark 机制：预设魂印 id（可被 initBattle mechanics.soulmark 槽位覆盖）。 */
  soulMark?: string;
  /** fifth 机制：第五技能招式 id（独立第五槽，不走 moveIds）。 */
  fifthMoveId?: string;
}

export type FeatureFlag =
  | "bench"
  | "damage_kinds"
  | "control"
  | "revive"
  | "stat_ops"
  | "mode_overlay"
  | "fifth"
  | "accuracy"
  | "resource_ops"
  | "items";

export interface FrozenPack {
  rules: BattleState["rules"];
  unitsById: ReadonlyMap<string, CompiledUnit>;
  movesById: ReadonlyMap<string, CompiledMove>;
  /** 属性克制表（attack[攻方][守方]=倍率）；ruleset 未声明则 undefined → 无属性系统。 */
  typeChart?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** 属性一致加成（STAB）：招式属性 ∈ 自身属性时的倍率。 */
  stabMultiplier: number;
  /** 机制编译贡献（mechanics[id]=各机制数据；六维→sixstatOf()、刻印→sealsOf() 取）。未启用机制的键不存在。 */
  mechanics?: Record<string, unknown>;
  limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number; maxBenchSize?: number };
  stageRange: { min: number; max: number };
  operatorAllowlist: readonly string[];
  features: ReadonlySet<FeatureFlag>;
  modeOverlays: ReadonlyMap<string, { immuneControl?: boolean; immuneClearStages?: boolean }>;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vRuleset = ajv.compile(rulesetSchemaJson);
const vPack = ajv.compile(packSchemaJson);
const vUnits = ajv.compile(unitsSchemaJson);
const vMoves = ajv.compile(movesSchemaJson);
const vTypeChart = ajv.compile(typechartSchemaJson);

function fail(msg: string): never {
  throw new PackLoadError(msg);
}

interface RawContent {
  ruleset: unknown;
  pack: unknown;
  units: unknown;
  moves: unknown;
  /** ruleset.typeChartFile 指向的克制表文档（loadPackFromDir 负责读取注入）。 */
  typeChart?: unknown;
  /** 机制文档（键=机制 doc.rawKey，如 seals/natures）——由对应 Mechanic.compile 自取校验。 */
  [mechDoc: string]: unknown;
}

/** 核心所有字段：其余字段必须由某个注册机制认领（unitFieldClaims/moveFieldClaims），
 *  否则视为"机制缺席但字段还在"——拒载而非静默忽略。 */
const CORE_UNIT_FIELDS = new Set(["id", "name", "base", "moveIds", "types", "revives", "mode"]);
const CORE_BASE_KEYS = new Set(["hp", "atk", "def", "spd"]);
const CORE_MOVE_FIELDS = new Set(["id", "name", "pp", "priority", "priorityMin", "effects", "type", "accuracy", "priorityIf", "hitIf", "prioPerUse", "ignoreFoeSpeed", "prioPerFoeLowPp", "ignoreFoePrioPos"]);

/** Pure: compile from already-parsed JSON documents (usable in Worker/browser). */
export function compilePack(raw: RawContent): FrozenPack {
  if (!vRuleset(raw.ruleset)) fail(`ruleset schema: ${ajv.errorsText(vRuleset.errors)}`);
  if (!vPack(raw.pack)) fail(`pack schema: ${ajv.errorsText(vPack.errors)}`);
  if (!vUnits(raw.units)) fail(`units schema: ${ajv.errorsText(vUnits.errors)}`);
  if (!vMoves(raw.moves)) fail(`moves schema: ${ajv.errorsText(vMoves.errors)}`);

  const ruleset = raw.ruleset as {
    rulesetId: string;
    rulesetVersion: string;
    operatorAllowlist: string[];
    features?: string[];
    damageKinds?: string[];
    typeChartFile?: string;
    stabMultiplier?: number;
    modeOverlays?: Record<string, { immuneControl?: boolean; immuneClearStages?: boolean }>;
    statStageRange: [number, number];
    limits: { maxEffectApplications: number; maxCauseDepth: number; maxTurns: number; maxBenchSize?: number };
  };
  const pack = raw.pack as { packId: string; rulesetId: string };
  const units = (raw.units as { units: CompiledUnit[] }).units;
  const moves = (raw.moves as { moves: { id: string; name?: string; pp: number; priority: number; priorityMin?: number; effects: CompiledEffect[]; type?: string; category?: "physical" | "special"; accuracy?: number | "always"; priorityIf?: { when: Condition; add?: number; min?: number }; hitIf?: { when: Condition }; ppFreeIf?: Condition; prioPerUse?: number; ignoreFoeSpeed?: boolean; ignoreFoePrioPos?: boolean; prioPerFoeLowPp?: { below: number; per: number; add: number } }[] }).moves;

  // 属性克制表：ruleset 声明 typeChartFile → 必须随包注入且通过 schema；
  // 未声明 → 任何 types/type 字段都视为误配置拒绝（静默忽略会埋坑）。
  // canonicalJson 只收安全整数 → 倍率一律存 ×16 定点（赛尔号倍率全是 1/16 的倍数：
  // 4/2.75/2.6875/2.5/1.5/1.375/0.875/0.8125/0.75/0.5/0.25/0.125/0 …），运行时 /16 还原。
  let typeChart: Map<string, Map<string, number>> | undefined;
  const knownTypeKeys = new Set<string>();
  let typeChartInt: Record<string, Record<string, number>> | undefined;
  if (ruleset.typeChartFile !== undefined) {
    if (raw.typeChart === undefined) fail(`ruleset declares typeChartFile "${ruleset.typeChartFile}" but no typeChart document was provided`);
    if (!vTypeChart(raw.typeChart)) fail(`typeChart schema: ${ajv.errorsText(vTypeChart.errors)}`);
    const attack = (raw.typeChart as { attack: Record<string, Record<string, number>> }).attack;
    typeChart = new Map();
    typeChartInt = {};
    for (const [att, row] of Object.entries(attack)) {
      const intRow: Record<string, number> = {};
      const mapRow = new Map<string, number>();
      for (const [def, mult] of Object.entries(row)) {
        const eff16 = mult * 16;
        if (!Number.isSafeInteger(eff16)) fail(`typeChart ${att}→${def} multiplier ${mult} is not a multiple of 1/16`);
        intRow[def] = eff16;
        mapRow.set(def, eff16);
      }
      typeChart.set(att, mapRow);
      typeChartInt[att] = intRow;
      knownTypeKeys.add(att);
      for (const def of Object.keys(row)) knownTypeKeys.add(def);
    }
  } else if (raw.typeChart !== undefined) {
    fail("typeChart document provided but ruleset declares no typeChartFile");
  }

  // 机制编译：各注册模块自校验文档与规则 → pack.mechanics[id] + 哈希附加。
  // 模块内部自判声明位（pack.files/ruleset 字段）；未声明而注入文档 → 模块自己拒。
  const mechData: Record<string, unknown> = {};
  const mechHashExtra: Record<string, string> = {};
  const mechRulesetHash: Record<string, string> = {};
  const mechView = { rules: { rulesetId: (ruleset as { rulesetId: string }).rulesetId }, mechanics: mechData, features: new Set((ruleset.features ?? []) as FeatureFlag[]) };
  for (const m of MECHANICS) {
    const c = m.compile?.({ raw: raw as Record<string, unknown>, ruleset: ruleset as Record<string, unknown>, fail });
    if (c !== undefined) {
      mechData[m.id] = c.data;
      if (c.hashExtra !== undefined) Object.assign(mechHashExtra, c.hashExtra);
      if (c.rulesetHashExtra !== undefined) Object.assign(mechRulesetHash, c.rulesetHashExtra);
    }
  }
  // 字段认领表：schema 已知但非核心的字段必须由注册机制认领，否则拒载。
  const unitFieldOwners = new Map(MECHANICS.flatMap((m) => (m.unitFieldClaims ?? []).map((f) => [f, m.id])));
  const moveFieldOwners = new Map(MECHANICS.flatMap((m) => (m.moveFieldClaims ?? []).map((f) => [f, m.id])));

  if (pack.rulesetId !== ruleset.rulesetId) {
    fail(`pack rulesetId "${pack.rulesetId}" != ruleset "${ruleset.rulesetId}"`);
  }

  const features = new Set((ruleset.features ?? []) as FeatureFlag[]);
  if (features.has("bench") && ruleset.limits.maxBenchSize === undefined) fail('feature "bench" requires limits.maxBenchSize');
  if (!features.has("bench") && ruleset.limits.maxBenchSize !== undefined) fail('limits.maxBenchSize requires feature "bench"');
  // op → 所需 feature（v1 ruleset 无 features → 新 op 语义级拒绝）
  const OP_FEATURE: Partial<Record<CompiledEffect["op"], FeatureFlag>> = {
    transfer_stages: "stat_ops",
    clear_stages: "stat_ops",
    control: "control",
    cleanse: "control",
    apply_status: "control",
    apply_effect: "mode_overlay",
    copy_stages: "stat_ops",
    invert_stages: "stat_ops",
    stat_boost: "stat_ops",
    pp_delta: "resource_ops",
    force_switch: "bench",
  };
  const allow = new Set(ruleset.operatorAllowlist);
  const damageKinds = new Set(ruleset.damageKinds ?? ["standard"]);
  const movesById = new Map<string, CompiledMove>();
  for (const m of moves) {
    if (movesById.has(m.id)) fail(`duplicate move id ${m.id}`);
    for (const hit of damageKeyHits(m.effects, "effects")) {
      fail(`move ${m.id} ${hit.path} damage key "${hit.key}" is outside the damage key list`);
    }
    for (const fx of m.effects) {
      if (!allow.has(fx.op)) fail(`move ${m.id} uses op "${fx.op}" not in allowlist`);
      const need = OP_FEATURE[fx.op];
      if (need && !features.has(need)) fail(`move ${m.id} op "${fx.op}" requires feature "${need}"`);
      if (fx.op === "damage" && fx.kind !== undefined && fx.kind !== "standard" && !features.has("damage_kinds")) {
        fail(`move ${m.id} damage kind "${fx.kind}" requires feature "damage_kinds"`);
      }
      if (fx.op === "damage" && fx.kind !== undefined && !damageKinds.has(fx.kind)) {
        fail(`move ${m.id} damage kind "${fx.kind}" not in ruleset damageKinds`);
      }
      if (fx.op === "apply_stat_stage" && fx.stat === "acc" && !features.has("accuracy")) {
        fail(`move ${m.id} stat "acc" requires feature "accuracy"`);
      }
    }
    // 白名单先看见 rider，再收进前一条 damage。单独一条拒载。
    const riderErr = groupHitRiders(m.effects);
    if (riderErr !== undefined) fail(`move ${m.id} ${riderErr}`);
    if (m.accuracy !== undefined && !features.has("accuracy")) {
      fail(`move ${m.id} sets accuracy but ruleset lacks feature "accuracy"`);
    }
    if (typeChart === undefined) {
      if (m.type !== undefined) fail(`move ${m.id} sets type but ruleset has no type chart`);
    } else {
      if (m.type === undefined) fail(`move ${m.id} lacks type (ruleset has type chart)`);
      else if (!typeChart.has(m.type)) fail(`move ${m.id} type "${m.type}" is not an attack row of the type chart`);
    }
    // 机制字段认领：非核心字段须由注册机制认领（如 category → sixstat）。
    for (const k of Object.keys(m)) {
      if (!CORE_MOVE_FIELDS.has(k) && !moveFieldOwners.has(k)) {
        fail(`move ${m.id} field "${k}" not claimed by any registered mechanic`);
      }
    }
    const mechMoveFields: Record<string, unknown> = {};
    for (const mech of MECHANICS) {
      const err = mech.checkMove?.(m, mechView);
      if (err !== null && err !== undefined) fail(err);
      const extra = mech.moveFields?.(m, mechView);
      if (extra !== undefined) Object.assign(mechMoveFields, extra);
    }
    movesById.set(m.id, { id: m.id, pp: m.pp, priority: m.priority, ...(m.priorityMin !== undefined ? { priorityMin: m.priorityMin } : {}), effects: m.effects, ...(m.name !== undefined ? { name: m.name } : {}), ...(m.type !== undefined ? { type: m.type } : {}), ...(m.category !== undefined ? { category: m.category } : {}), ...(m.accuracy !== undefined ? { accuracy: m.accuracy } : {}), ...(m.priorityIf !== undefined ? { priorityIf: m.priorityIf } : {}), ...(m.hitIf !== undefined ? { hitIf: m.hitIf } : {}), ...(m.prioPerUse !== undefined ? { prioPerUse: m.prioPerUse } : {}), ...(m.ignoreFoeSpeed === true ? { ignoreFoeSpeed: true as const } : {}), ...(m.ignoreFoePrioPos === true ? { ignoreFoePrioPos: true as const } : {}), ...(m.prioPerFoeLowPp !== undefined ? { prioPerFoeLowPp: m.prioPerFoeLowPp } : {}), ...mechMoveFields });
  }

  const unitsById = new Map<string, CompiledUnit>();
  for (const u of units) {
    if (unitsById.has(u.id)) fail(`duplicate unit id ${u.id}`);
    for (const mid of u.moveIds) {
      const mv = movesById.get(mid);
      if (mv === undefined) fail(`unit ${u.id} references unknown move ${mid}`);
      for (const m of MECHANICS) {
        const err = m.checkUnitMove?.(u, mid, mv);
        if (err !== null && err !== undefined) fail(err);
      }
    }
    // 机制声明的 moveId 引用字段（fifthMoveId 等）：存在性 + 语义校验。
    for (const m of MECHANICS) {
      for (const f of m.moveRefFields ?? []) {
        const ref = (u as unknown as Record<string, unknown>)[f];
        if (ref === undefined) continue;
        const mv = movesById.get(ref as string);
        if (mv === undefined) fail(`unit ${u.id} field "${f}" references unknown move ${ref}`);
        const err = m.checkUnitMoveRef?.(u, f, mv);
        if (err !== null && err !== undefined) fail(err);
      }
    }
    if (u.revives !== undefined && u.revives > 0 && !features.has("revive")) {
      fail(`unit ${u.id} sets revives but feature "revive" not enabled`);
    }
    if (u.mode !== undefined && !features.has("mode_overlay")) {
      fail(`unit ${u.id} sets mode but feature "mode_overlay" not enabled`);
    }
    if (u.mode !== undefined && ruleset.modeOverlays !== undefined && !(u.mode in ruleset.modeOverlays)) {
      fail(`unit ${u.id} mode "${u.mode}" has no ruleset overlay entry`);
    }
    if (typeChart === undefined) {
      if (u.types !== undefined) fail(`unit ${u.id} sets types but ruleset has no type chart`);
    } else {
      if (u.types === undefined) fail(`unit ${u.id} lacks types (ruleset has type chart)`);
      else {
        const key = u.types.join("");
        const rkey = [...u.types].reverse().join("");
        if (!knownTypeKeys.has(key) && !knownTypeKeys.has(rkey)) {
          fail(`unit ${u.id} types "${key}" unknown in type chart`);
        }
      }
    }
    // 机制字段认领：非核心字段须由注册机制认领（level/ivs/evs/nature/base.spa/sdf → sixstat，seals → seals）。
    for (const k of Object.keys(u)) {
      if (!CORE_UNIT_FIELDS.has(k) && !unitFieldOwners.has(k)) {
        fail(`unit ${u.id} field "${k}" not claimed by any registered mechanic`);
      }
    }
    for (const k of Object.keys(u.base)) {
      if (!CORE_BASE_KEYS.has(k) && !unitFieldOwners.has(`base.${k}`)) {
        fail(`unit ${u.id} base.${k} not claimed by any registered mechanic`);
      }
    }
    // 机制单位钩子：声明校验 + 编译附加字段（默认注入/预设）。
    const mechFields: Record<string, unknown> = {};
    for (const m of MECHANICS) {
      const err = m.checkUnit?.(u, mechView);
      if (err !== null && err !== undefined) fail(err);
      const extra = m.unitFields?.(u, mechView);
      if (extra !== undefined) Object.assign(mechFields, extra);
    }
    unitsById.set(u.id, {
      id: u.id, name: u.name, base: u.base, moveIds: u.moveIds,
      ...(u.types !== undefined ? { types: u.types } : {}),
      ...(u.revives !== undefined ? { revives: u.revives } : {}),
      ...(u.mode !== undefined ? { mode: u.mode } : {}),
      ...mechFields,
    });
  }

  // 克制表是规则数据 → 计入 rulesetHash（换表=换规则版本，钉版对局不受影响）。
  // canonicalJson 不收浮点/非 ASCII 键 → 表体走 sha256(原始 JSON 文本)（文件本身即规范序），
  // ruleset 本体剥掉浮点 stabMultiplier 后走 canonicalJson，stab 以 ×16 定点入 hash。
  const stab = ruleset.stabMultiplier ?? 1.5;
  if (ruleset.typeChartFile !== undefined && !Number.isSafeInteger(stab * 16)) {
    fail(`stabMultiplier ${stab} is not a multiple of 1/16`);
  }
  if (ruleset.typeChartFile === undefined && ruleset.stabMultiplier !== undefined) {
    fail("stabMultiplier declared without typeChartFile");
  }
  const rulesetHash = `sha256:${sha256hex(canonicalJson(typeChartInt === undefined && Object.keys(mechRulesetHash).length === 0
    ? raw.ruleset
    : (() => {
        const rest = { ...(raw.ruleset as Record<string, unknown>) };
        delete rest["stabMultiplier"];
        return {
          ruleset: rest,
          ...(ruleset.stabMultiplier !== undefined ? { stabMultiplier16: Math.round(stab * 16) } : {}),
          ...(raw.typeChart !== undefined ? { typeChartSha256: sha256hex(JSON.stringify(raw.typeChart)) } : {}),
          ...mechRulesetHash,
        };
      })()))}`;
  const contentHash = `sha256:${sha256hex(canonicalJson(
    Object.keys(mechHashExtra).length === 0
      ? { pack: raw.pack, units: raw.units, moves: raw.moves }
      : { pack: raw.pack, units: raw.units, moves: raw.moves, ...mechHashExtra },
  ))}`;
  const executableHash = ENGINE_EXECUTABLE_HASH;

  const frozen: FrozenPack = {
    rules: {
      rulesetId: ruleset.rulesetId,
      rulesetVersion: ruleset.rulesetVersion,
      rulesetHash,
      contentHash,
      executableHash,
      irVersion: IR_VERSION,
    },
    unitsById,
    movesById,
    ...(typeChart !== undefined ? { typeChart } : {}),
    stabMultiplier: ruleset.stabMultiplier ?? 1.5,
    ...(Object.keys(mechData).length > 0 ? { mechanics: mechData } : {}),
    limits: ruleset.limits,
    stageRange: { min: ruleset.statStageRange[0], max: ruleset.statStageRange[1] },
    operatorAllowlist: ruleset.operatorAllowlist,
    features,
    modeOverlays: new Map(Object.entries(ruleset.modeOverlays ?? {})),
  };
  Object.freeze(frozen.rules);
  Object.freeze(frozen.limits);
  Object.freeze(frozen.stageRange);
  Object.freeze(frozen.operatorAllowlist);
  return Object.freeze(frozen);
}

/** Convenience node loader for Host/tests (fs — not used inside transitions). */
export function loadPackFromDir(contentRoot: string, packId: string): FrozenPack {
  const read = (p: string): unknown => JSON.parse(readFileSync(join(contentRoot, p), "utf8"));
  const pack = read(join(packId, "pack.json")) as {
    rulesetId: string;
    files?: Record<string, string>;
  };
  const ruleset = read(join("rulesets", `${pack.rulesetId}.json`)) as { typeChartFile?: string; [k: string]: unknown };
  // 机制文档：doc.packFile → pack 目录文件；doc.rulesetFile → rulesets/ 目录文件（由注册模块各自校验）
  const mechDocs: Record<string, unknown> = {};
  for (const m of MECHANICS) {
    const d = m.doc;
    if (d === undefined) continue;
    const file = d.packFile !== undefined ? pack.files?.[d.packFile] : undefined;
    const rfile = d.rulesetFile !== undefined ? ruleset[d.rulesetFile] : undefined;
    if (typeof file === "string") mechDocs[d.rawKey] = read(join(packId, file));
    if (typeof rfile === "string") mechDocs[d.rawKey] = read(join("rulesets", rfile));
  }
  return compilePack({
    ruleset,
    pack,
    units: read(join(packId, pack.files?.units ?? "units.json")),
    moves: read(join(packId, pack.files?.moves ?? "moves.json")),
    ...(ruleset.typeChartFile !== undefined ? { typeChart: read(join("rulesets", ruleset.typeChartFile)) } : {}),
    ...mechDocs,
  });
}
