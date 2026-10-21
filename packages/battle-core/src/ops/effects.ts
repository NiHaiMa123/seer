/**
 * ops/effects.ts —— 单位效果定义表。
 * 新状态名必须落在已有读取的一根轴上（ailment / periodic / immune / reflect / modifier / dmgShield / reactive）。
 * 多一根轴，或这根轴没有读取，编译检查失败。不要为了过检查去补结算。
 *
 * unit.effects 的 kind 即效果 id（apply_status 的 name 直写、apply_effect 为 tag:<name>）。
 * 两类效果共用同一张表：
 *   - 异常状态（burn/poison/…）：ailment:true + dot/blockChance/accMul/atkMul flag
 *   - 回合类窗口（hot/prio_up/…）：timed 语义 flag，params 携带幅值
 *
 * 引擎解释点：
 *   1) TURN_END：dot/hot 结算（hurt 通道 + checkpoint；heal 不过 checkpoint）
 *   2) 行动前：blockChance% 行动失败
 *   3) RESOLVE_HIT：accMul ×命中；mustMiss → 直接判定 miss
 *   4) damage：atkMul ×物攻伤害
 *   5) ORDER：prioAdd 加进行动优先级
 *   6) apply_status/apply_effect：目标带 immuneStatus → 免疫施加
 *
 * 数值为惯例默认（4399/wiki 口径），全部 UNVERIFIED——精确原作值待取证后只改表。
 */
import type { UnitState } from "../mechanics/types.ts";
import { evaluateValue, type NumericValue } from "./value.ts";

export interface EffectDef {
  zh?: string;
  /** 是"异常状态"（对手处于异常状态时… 类条件用） */
  ailment?: boolean;
  /** 回合末扣 max×n/d；"params" = 从条目 params.{n,d} 读幅值 */
  dot?: { n: number; d: number } | "params";
  /** 行动失败概率 %（每回合判定一次；异常类硬控语义） */
  blockChance?: number;
  /** 命中倍率（RESOLVE_HIT 乘算） */
  accMul?: { n: number; d: number };
  /** 物攻倍率（物理伤害乘算） */
  atkMul?: { n: number; d: number };
  /** 挂载时脱糖为 immune{of:<位>}（免疫域轴——params.of 位掩码，子类域用 ailment scope，概率窗用 params.chance） */
  immune?: "params";
  /** 挂载时脱糖为 reflect{of:<位>}（反弹域轴——同上） */
  reflect?: "params";
  /** 挂载时脱糖为 modifier{at:<槽位>}（修饰窗轴——params 透传幅值/门控/count，槽位=原 flag 名） */
  modifier?: "params";
  /** 束缚：持有者不能主动换人（action/forced 均阻，KO 替补不阻） */
  noSwitch?: boolean;
  /** 一次性伤害护盾：params.flat 为剩余吸收量，受击时扣减直至耗尽（"可以抵挡N点伤害"） */
  dmgShield?: "params";
  /** 反应式触发器（react）：params.trigger 触发点编码 + payload op 列表；fireReactive 在事件点派发 */
  reactive?: "params";
  /** 周期效果。name 为 periodic 时 payload 是原子 op；六个具名周期仍由 periodic.ts 脱糖，不要再加名字 */
  periodic?: "params";
}

/**
 * 接口上有、结算代码没有 `effectDefOf(...)?.旗标` 读取的字段。
 * 新旗标要么沿用已有读取，要么进这个集合并让解析器返回 unparsedReason。
 * 不要为了过检查去补结算。
 */
export const DEFERRED_FLAGS = new Set<keyof EffectDef>([
  // 尚无结算读取。fireReactive 按 kind==="react" 派发，不读这个字段。
  "reactive",
]);

/** stageTick 的 stat 编码表（1-6，与 stageKeysFor 同序——六维固定序）。 */
export const STAGE_TICK_CODES = ["atk", "def", "spa", "sdf", "spd", "acc"] as const;

export const EFFECT_DEFS: Record<string, EffectDef> = {
  // ── 异常状态 ──────────────────────────────────────────────
  burn:      { zh: "烧伤", ailment: true, dot: { n: 1, d: 8 }, atkMul: { n: 1, d: 2 } },
  frostbite: { zh: "冻伤", ailment: true, dot: { n: 1, d: 8 } },
  poison:    { zh: "中毒", ailment: true, dot: { n: 1, d: 8 } },
  paralysis: { zh: "麻痹", ailment: true, blockChance: 25 },
  fear:      { zh: "害怕", ailment: true, blockChance: 100 },
  sleep:     { zh: "睡眠", ailment: true, blockChance: 100 },
  submit:    { zh: "臣服", ailment: true, blockChance: 100 },
  blind:     { zh: "失明", ailment: true, accMul: { n: 1, d: 2 } },
  daze:      { zh: "失神", ailment: true, accMul: { n: 1, d: 2 } },
  // 标记型异常（语料存在、机制数值 UNVERIFIED——先 ailment:true 保证"对手处于异常状态"谓词正确）
  confuse:   { zh: "混乱", ailment: true },
  parasite:  { zh: "寄生", ailment: true },
  curse:     { zh: "诅咒", ailment: true },
  bleed:     { zh: "流血", ailment: true },
  silence:   { zh: "沉默", ailment: true },
  freeze:    { zh: "冰封", ailment: true },
  flammable: { zh: "易燃", ailment: true },
  rage:        { zh: "狂暴", ailment: true },
  // ── 回合类窗口（timed；kind 直用 name）────────────────────
  hot:           { zh: "持续恢复", periodic: "params" },                    // params{n,d}
  dot_field:     { zh: "持续固伤", periodic: "params" },                    // params{n,d}
  prio_up: { zh: "先制提升", modifier: "params" },
  prio_count: { zh: "次数先制", modifier: "params" }, // params{add,count} 行动消耗
  immune_status: { zh: "免疫异常", immune: "params" },
  must_miss: { zh: "必定闪避", modifier: "params" },
  must_miss_phys: { zh: "物理闪避", modifier: "params" },
  must_miss_spec: { zh: "特殊闪避", modifier: "params" },
  /** 攻击技闪避（"攻击技能MISS"——覆盖 physical+special，不含属性技） */
  must_miss_atk: { zh: "攻击闪避", modifier: "params" },
  /** 属性技闪避（"属性攻击对自己miss"——只挡 category 未定义的属性技） */
  must_miss_stat: { zh: "属性闪避", modifier: "params" },
  // ── E3 窗口 ───────────────────────────────────────────────
  protect: { zh: "完全抵挡", modifier: "params" },
  dmg_immune:     { zh: "免疫攻击伤害", immune: "params" },
  flat_immune:    { zh: "固伤免疫", immune: "params" },               // 免疫固定/百分比伤害（"免疫固定伤害、百分比伤害"）
  counter: { zh: "反击", modifier: "params" }, // params.mul
  reflect_status: { zh: "反弹异常", reflect: "params" },
  reflect_degrade: { zh: "反弹能力下降", reflect: "params" },          // 持有期间：负向 stage 弹回施加方（"反弹对手给予的能力下降状态"）
  bind:           { zh: "束缚", ailment: true, noSwitch: true, dot: "params" },
  pp_double: { zh: "PP消耗加倍", modifier: "params" },
  pp_mul: { zh: "PP消耗倍率", modifier: "params" }, // params.mul（"使用技能消耗PP值为5倍"）
  pp_free: { zh: "PP免费", modifier: "params" }, // 技能不受PP值限制（"使用技能不受PP值限制"）
  immune_degrade: { zh: "免疫弱化", immune: "params" },
  dmg_mul: { zh: "威力提升", modifier: "params" }, // params.mul
  dmg_flat: { zh: "附加固伤", modifier: "params" }, // params.flat
  dmg_taken_up: { zh: "承伤提升", modifier: "params" }, // params.pct
  dmg_taken_down: { zh: "承伤减免%", modifier: "params" }, // params.pct 全类型承伤 -pct%
  dodge: { zh: "概率闪避", modifier: "params" }, // params{pct,cat?,count?}：cat=招式类别门（缺省任意）
  heal_block:     { zh: "禁疗", immune: "params" },
  // 「使用体力药剂变成降低相应的体力」——hp 类道具的回复翻转为等量固定伤害。
  // 与 heal_block 不同：禁疗是"不回复"，这条是"变成伤害"。
  item_heal_reverse: { zh: "药剂反噬", modifier: "params" },
  pierce_stages: { zh: "穿透强化", modifier: "params" },
  dmg_reduce: { zh: "承伤减免", modifier: "params" }, // params.flat
  hit_fx_null: { zh: "命中效果失效", modifier: "params" }, // params.cat 门控（4=攻击技/1=属性技；缺省=全部）
  dmg_cap: { zh: "伤害上限", modifier: "params" }, // params.cap
  even_dmg: { zh: "偶数出伤", modifier: "params" }, // params.count：次数窗（"下N次攻击必定打出偶数伤害"）
  reflect_dmg:    { zh: "伤害反弹", reflect: "params" },  // params{n,d}
  crit_always: { zh: "必定致命", modifier: "params" },
  crit_reflect:   { zh: "致命反弹", reflect: "params" },              // 持有期间：对手致命一击全额反伤给攻击方
  crit_immune:    { zh: "致命免疫", immune: "params" },               // 免疫致命一击伤害（"致命一击对自身MISS"）
  crit_dodge:     { zh: "暴伤概率免疫", immune: "params" },          // params.chance：受暴击时概率将伤害归零
  unify_offense: { zh: "攻特取高", modifier: "params" }, // 攻击/特攻按生效值取高（"攻击和特攻等于其中最高的一项"）
  stage_alias: { zh: "防转攻视", modifier: "params" }, // 防御/特防 stage 视为攻击/特攻 stage（"防御、特防能力提升分别视为攻击、特攻能力提升"）
  cleanse_lock: { zh: "解除封锁", modifier: "params" }, // 身上效果不可被净化解除（"下N回合无法解除"）
  timed_lock: { zh: "回合类封锁", modifier: "params" }, // 身上回合类效果不可被消除（"自身的回合类效果无法被消除"——仅挡 scope:timed 净化）
  random:         { zh: "随机异常" },                                  // 不是轴：apply_status 先按 fx.random 改写成具体异常。再加一个只有 zh 的名字，轴检查失败
  no_switch: { zh: "禁换", modifier: "params" }, // 持有者不能主动换人（"令对手无法主动切换精灵"）
  prio_immune:    { zh: "先制免疫", immune: "params" },               // 免疫对手的先手攻击技能（priority>0 的攻击 MISS）
  crit_up: { zh: "要害概率提升", modifier: "params" },
  crit_taken_up: { zh: "致命易伤", modifier: "params" }, // params{n,d}（n/d>1→承伤放大；承伤者持有）
  must_hit: { zh: "必定命中", modifier: "params" },
  shield:         { zh: "伤害护盾", dmgShield: "params" },      // params.flat 剩余吸收量
  ward:           { zh: "固伤护罩", dmgShield: "params" },      // 护罩：params.flat + kindMask=3（只吸固定/百分比——与护盾分立池）
  dmg_boost: { zh: "伤害提升", modifier: "params" }, // params.pct（+foeStageDown/foeStageUp/foeStatused/selfStatused 门控）
  drain_atk: { zh: "攻击吸血窗", modifier: "params" }, // params{n,d}：每次攻击伤害按分数回血
  drain_on_use: { zh: "用招吸血", modifier: "params" }, // params{flat}：持有者每回合使用技能则吸取对手 flat 体力
  dmg_to_heal: { zh: "伤害转化回复", modifier: "params" },
  dmg_to_shield: { zh: "伤害转化护盾", modifier: "params" }, // params{count}：受到的攻击伤害转等量护盾（"下N次受到的攻击伤害转化为护盾"）
  dmg_floor: { zh: "低伤免疫", modifier: "params" }, // params.min
  status_lock: { zh: "封印属性", modifier: "params" }, // params.cat 枚举编码(1=status)
  dmg_weaken: { zh: "伤害削弱", modifier: "params" },
  endure: { zh: "致命保留", modifier: "params" },
  down_lock: { zh: "弱化锁定", modifier: "params" },
  up_lock: { zh: "强化锁定", modifier: "params" }, // 正面等级不可被消除/吸取（"能力提升状态无法被消除或吸取"）
  ignore_self_down: { zh: "无视自弱化", modifier: "params" },
  pp_drain:       { zh: "回合末PP削减", periodic: "params" },  // params.flat 每回合末对手所有招式 -flat PP
  fatigue:        { zh: "疲惫", ailment: true },                // 机制数值 UNVERIFIED——先作为标记型异常
  phys_half: { zh: "物理伤害减半", modifier: "params" },
  spec_half: { zh: "特殊伤害减半", modifier: "params" },
  atk_taken_frac: { zh: "承伤折扣", modifier: "params" }, // params{cat:4,n,d,count?} 任意攻击招承伤 ×n/d（"下N次受到的攻击伤害减少M%"）
  move_null: { zh: "招式失效", modifier: "params" }, // params{count,cat?} cat省略=任意招式
  fumble: { zh: "技能概率失效", modifier: "params" }, // params.pct% 行动失败（"所有技能有N%概率失效"）
  drain_dot:      { zh: "回合吸取", periodic: "params" },             // params{n,d}|{flat} 对手max体力分数/定值
  foe_dot:        { zh: "回合敌伤", periodic: "params" },               // params{n,d} 回合末对手扣 max×n/d（无回血）
  dmg_out_floor: { zh: "出伤下限", modifier: "params" }, // params.min
  dmg_out_cap: { zh: "出伤上限", modifier: "params" }, // params.cap
  heal_cut:       { zh: "减疗", modifier: "params" },                  // params.pct 持有者回复量 -pct%
  heal_boost:     { zh: "回复提升", modifier: "params" },            // params.pct 持有者回复量 +pct%
  dmg_immune_above: { zh: "高伤免疫", modifier: "params" }, // params.max 伤害>max 归零
  flat_taken_pct: { zh: "固伤减免", modifier: "params" }, // params.pct 固定/百分比承伤 -pct%
  pri_taken_pct: { zh: "先制承伤减免", modifier: "params" }, // params.pct 受到先制技(priority>0)伤害 -pct%
  pct_taken_pct: { zh: "百分比承伤减免", modifier: "params" }, // params.pct 仅百分比伤害 -pct%
  power_mul: { zh: "威力倍率", modifier: "params" }, // params{n,d,chance?} 威力×n/d；chance=逐击概率
  crit_dealt: { zh: "致命增伤", modifier: "params" }, // params.pct 打出致命一击时伤害 +pct%
  sure_hit: { zh: "类别必中", modifier: "params" }, // params.cat 该类别招式必定命中（3=特殊）
  immune_chance:  { zh: "概率免疫异常", immune: "params" },// params.chance 每次异常施加单独判定
  max_hp_down: { zh: "限疗上限", modifier: "params" }, // params.flat 战斗中最大HP -flat
  react:          { zh: "反应式", reactive: "params" },               // params{trigger,cat?,min?,count?}+payload op 列表
  next_chance:    { zh: "下次触发几率", modifier: "params" },          // 槽位 nextChance。params{add?/mul?/set?,count,ei?} 由 chanceFails 按 isMod 消费
  ignore_def: { zh: "无视防御", modifier: "params" }, // params{pct,count?} 守方防御值 -(pct)%
  pierce_limit: { zh: "无视限伤", modifier: "params" }, // 攻击方无视守方减伤/上下限/阈值免疫（不穿透护盾）
  pierce: { zh: "穿透护盾", modifier: "params" }, // 攻击方穿透守方护盾/伤转/免疫（等价 fx.pierce）
  no_stage_up: { zh: "锁强化", modifier: "params" },
  ember:          { zh: "焚烬", ailment: true },                    // 焚烬（烧伤衍生种）机制数值 UNVERIFIED——标记型异常
  infect:         { zh: "感染", ailment: true },                    // 感染机制数值 UNVERIFIED——标记型异常
  petrify:        { zh: "石化", ailment: true, blockChance: 100 },  // 石化=不能行动（UNVERIFIED：按硬控处理）
  shock:          { zh: "瘫痪", ailment: true },                    // 瘫痪机制数值 UNVERIFIED——标记型异常
  feeble:         { zh: "衰弱", ailment: true },                    // 衰弱机制数值 UNVERIFIED——标记型异常；params.layers 再施加时累加
  pp_consume_hit: { zh: "命中耗PP", modifier: "params" },
  pct_rider: { zh: "百分比附加", modifier: "params" }, // params{count,n,d,statMax?}——statMax=1 基数取自身 max(atk,spa)
  doom:           { zh: "延迟同归于尽", periodic: "params" },                             // 到期时持有者存活→对手倒下（engine TURN_END 递减前窗口）
  periodic:       { zh: "周期效果", periodic: "params" },             // params.win=窗口序；payload 即每窗派发 op 列表（各 *_tick 的原子形态）；label 记原语义名
  prio_negate: { zh: "先制失效", modifier: "params" }, // 先制加成全部失效
  fixed_taken_pct: { zh: "固伤减免", modifier: "params" }, // params.pct 仅固定伤害 -pct%（flat_taken_pct 的固伤单列版）
  reflect_ctl:    { zh: "控制反弹", reflect: "params" },               // 受到的控制类异常反弹给施加方
  mirror_stages: { zh: "状态镜像", modifier: "params" }, // 对手能力等级变化同步落到持有者
  revive_fx: { zh: "回合复活", modifier: "params" }, // params.pct 复活血量%（缺省50）
  type_swap: { zh: "属性反转", modifier: "params" }, // 槽位 typeSwap。持有者系别与对手对调（battleTypesOf，到期还原）
  type_copy: { zh: "属性复制", modifier: "params" }, // 槽位 typeCopy。持有者系别变为对手系别
};

export const effectDefOf = (kind: string): EffectDef | undefined => EFFECT_DEFS[kind];

/** modifier 轴位测试：条目是 modifier 且 at 命中槽位（取代旧 `effectDefOf(kind)?.flag === "params"` 逐旗扫描）。 */
export const isMod = (e: { kind: string; at?: string }, at: string): boolean =>
  e.kind === "modifier" && e.at === at;

/** modifier 轴槽位条目枚举（消费点需要迭代时用——count 消耗/逐条 draw）。 */
export const modsAt = (u: UnitState, at: string): UnitState["effects"] =>
  u.effects.filter((e) => isMod(e, at));

/** 在场有效系别。type_swap / type_copy 挂载后是 modifier 槽位 typeSwap / typeCopy。
 *  typeSwap：持有者与对手对调。typeCopy：只有持有者变成对手的系别。
 *  不写 unit 可变字段，计时条目到期即还原。 */
export function battleTypesOf(pack: { unitsById: ReadonlyMap<string, { types?: string[] }> }, u: { speciesId: string; effects: { kind: string; at?: string }[] }, partner?: { speciesId: string; effects: { kind: string; at?: string }[] }): string[] {
  const mine = pack.unitsById.get(u.speciesId)?.types ?? [];
  const theirs = partner !== undefined ? pack.unitsById.get(partner.speciesId)?.types ?? [] : mine;
  const mineMarked = u.effects.some((e) => isMod(e, "typeSwap") || isMod(e, "typeCopy"));
  const partnerSwap = partner?.effects.some((e) => isMod(e, "typeSwap")) ?? false;
  return (mineMarked || partnerSwap) ? theirs : mine;
}

/** "params" 或字面值 → 分数对。 */
const fracOf = (spec: { n: number; d: number } | "params" | undefined, params: Record<string, number> | undefined):
  readonly [number, number] | undefined =>
  spec === undefined ? undefined
    : spec === "params" ? (params !== undefined && params.n !== undefined && params.d !== undefined ? [params.n, params.d] : undefined)
    : [spec.n, spec.d];

/** 单条效果的 dot 结算量；无定义 → undefined。W1 合并循环按 effects 序逐条调用（ailment dot flag 枚举路径）。 */
export function tickAmountOfEntry(u: UnitState, e: UnitState["effects"][number], kind: "dot", drawBelow?: (n: number, purpose: string) => number): { amount: number; kind: string; echo?: readonly [number, number]; entry?: UnitState["effects"][number] } | undefined {
  const spec = effectDefOf(e.kind)?.[kind];
  if (spec === undefined) return undefined;
  const p = e.params;
  // params.mulLN/mulLD（低于 n/d）、mulHN/mulHD（高于 n/d）、mulFull（满体力）：计时量条件翻倍
  // （"恢复体力时若自身体力低于1/2则恢复效果和百分比伤害翻倍"——echo 按 healed 结算随量自动翻倍）
  const mulOn = p !== undefined && (p.mulLN !== undefined || p.mulHN !== undefined || p.mulFull === 1)
    && (p.mulLN !== undefined ? u.currentHp * (p.mulLD ?? 1) < p.mulLN * u.base.hp
      : p.mulHN !== undefined ? u.currentHp * (p.mulHD ?? 1) > p.mulHN * u.base.hp
      : u.currentHp >= u.base.hp);
  // params.echoN/echoD：tick 量的 n/d 等额反噬给对手（"恢复1/3并附加等量固定伤害"挂在 hot 上）；
  // echoLN/echoLD（持有者 HP 低于 n/d）、echoHN/echoHD（高于）、echoFull（满体力）为回响门
  const echo = p?.echoN !== undefined
    && (p.echoLN === undefined || u.currentHp * (p.echoLD ?? 1) < p.echoLN * u.base.hp)
    && (p.echoHN === undefined || u.currentHp * (p.echoHD ?? 1) > p.echoHN * u.base.hp)
    && (p.echoSelfHpFull !== 1 || u.currentHp >= u.base.hp)
    ? ([p.echoN, p.echoD ?? 1] as const) : undefined;
  const emit = (amount: number) => ({ amount: mulOn ? amount * 2 : amount, kind: e.kind, ...(echo !== undefined ? { echo } : {}), entry: e });
  if (p?.flatMin !== undefined && p?.flatMax !== undefined) {
    const span = p.flatMax - p.flatMin + 1;
    return emit(p.flatMin + (drawBelow?.(span, `tick_range:${e.kind}`) ?? 0));
  }
  if (p?.flat !== undefined) return emit(p.flat);
  // flatPerStageFlat/Per/Down：每 N 种正/负 stage 结算 flat 点（"(对手)每处于1种能力下降状态则回合结束时损失N点"——持有者自身 stage 计数，tick 通道无 foe 上下文故只编码持有者侧）
  if (p?.flatPerStageFlat !== undefined) {
    const cnt = Object.values(u.stages).filter((v) => (p.flatPerStageDown === 1 ? v < 0 : v > 0)).length;
    return emit(Math.floor(cnt / Math.max(1, p.flatPerStagePer ?? 1)) * p.flatPerStageFlat);
  }
  const f = fracOf(spec, p);
  if (f === undefined) return undefined;
  return emit(Math.floor((u.base.hp * f[0]) / f[1]));
}

/** 身上效果 flag 的乘积（acc/atk 修正，分数连乘保持整数）。 */
export function effectMul(u: UnitState, key: "accMul" | "atkMul"): readonly [number, number] {
  let n = 1, d = 1;
  for (const e of u.effects) {
    const m = effectDefOf(e.kind)?.[key];
    if (m !== undefined) { n *= m.n; d *= m.d; }
  }
  return [n, d];
}

/** 行动阻断：返回首个阻断成功的效果 kind（按 effects 顺序逐个掷）。 */
export function effectBlock(u: UnitState, drawBelow: (n: number, purpose: string) => number): string | undefined {
  for (const e of u.effects) {
    const def = effectDefOf(e.kind);
    const bc = def?.blockChance ?? (isMod(e, "fumble") ? e.params?.pct : undefined);
    if (bc !== undefined && drawBelow(100, `status_block:${e.kind}`) < bc) return e.kind;
  }
  return undefined;
}

/** 行动先制加成合计（prioAdd flag；params.add 或字面值；params.cat 招式类别门控）。 */
export function prioAddOf(u: UnitState, moveCat?: number): number {
  let p = 0;
  for (const e of u.effects) {
    if (!isMod(e, "prioAdd")) continue;
    const cat = e.params?.cat;
    if (cat !== undefined && moveCat !== undefined && !(cat === 4 ? moveCat !== 1 : moveCat === cat)) continue;
    p += e.params?.add ?? 0;
  }
  return p;
}

/** 先制失效（prio_negate flag："对方下只出战精灵首回合先制效果失效"——prioAddOf/priorityIf/机制加成全部不生效）。 */
export const prioNegateOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "prioNegate"));

/** 是否免疫新异常施加（用于 apply_status 落点）。
 *  定向免疫用条目 ailment 子类字段（immune{of:status}+ailment:"burn"——仅挡该异常；缺省=广谱）。 */

/** immune{of} 位掩码（挂载点脱糖产物——immune_* 名轴化后统一位测试）：
 *  1=异常状态 2=能力下降 4=攻击伤害 8=固定/百分比伤害 16=致命一击 32=先制攻击技 64=体力回复。 */
export const IM = { status: 1, degrade: 2, dmg: 4, flat: 8, crit: 16, prio: 32, heal: 64 } as const;
/** reflect{of} 位掩码：1=异常 2=能力下降 4=控制类异常 8=伤害 16=致命一击。 */
export const RF = { status: 1, degrade: 2, ctl: 4, dmg: 8, crit: 16 } as const;

/** 常驻免疫窗：kind==="immune" 且 of 位命中、无 params.chance 门（概率窗由消费点扫 chance!==undefined 逐击判定）。
 *  ailment=incoming 异常名——条目 ailment 缺省（广谱）或同名才命中。
 *  params.ctl/nonCtl=异常类别门（"免疫控制类/非限制类异常"——按来异常 EFFECT_DEFS.blockChance 分类）。 */
export const immuneOn = (u: UnitState, of: number, ailment?: string): boolean =>
  u.effects.some((e) =>
    e.kind === "immune"
    && (((e.params?.of as number | undefined) ?? 0) & of) !== 0
    && e.params?.chance === undefined
    && (ailment === undefined || (e.ailment === undefined || e.ailment === ailment))
    && (e.params?.ctl === undefined || (ailment !== undefined && (effectDefOf(ailment)?.blockChance ?? 0) > 0))
    && (e.params?.nonCtl === undefined || (ailment !== undefined && (effectDefOf(ailment)?.blockChance ?? 0) === 0)),
  );

/** 反弹窗：kind==="reflect" 且 of 位命中。 */
export const reflectOn = (u: UnitState, of: number): boolean =>
  u.effects.some((e) => e.kind === "reflect" && (((e.params?.of as number | undefined) ?? 0) & of) !== 0);

/** 被攻击方持有的 mustMiss 窗口是否覆盖该攻击类别。 */
export function mustMissOn(defender: UnitState, category: string | undefined): boolean {
  const bit = category === "physical" ? 1 : category === "special" ? 2 : 4;
  return defender.effects.some((e) => isMod(e, "mustMiss") && (((e.params?.scope as number | undefined) ?? 7) & bit) !== 0);
}

export const protectAllOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "protectAll"));

export const dmgImmuneOn = (u: UnitState, kind?: string): boolean =>
  u.effects.some((e) => {
    if (e.kind !== "immune" || (((e.params?.of as number | undefined) ?? 0) & IM.dmg) === 0 || e.params?.chance !== undefined) return false;
    const km = e.params?.kindMask;
    return km === undefined || kind === undefined || ((km as number) & (DMG_KIND_BIT[kind] ?? 0)) !== 0;
  });

/** 免疫固定/百分比伤害窗口开启中（immune{of:flat}；"免疫固定伤害、百分比伤害"）。 */
export const flatImmuneOn = (u: UnitState): boolean => immuneOn(u, IM.flat);

/** 对手状态变化镜像窗开启中（mirrorStages flag——"对手的状态变化会同时作用在自己的身上"）。 */
export const mirrorStagesOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "mirrorStages"));

/** 仅固定伤害承伤减免合计 pct（fixedTakenPct flag——"受到的固定伤害降低N%"）。 */
export const fixedTakenPctOf = (u: UnitState): number =>
  u.effects.reduce((acc, e) => acc + (isMod(e, "fixedTakenPct") ? (e.params?.pct ?? 0) : 0), 0);

export const noSwitchOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "noSwitch") || effectDefOf(e.kind)?.noSwitch === true);

/** 反击倍率合计（counter flag；params.mul 或字面值）。params.cat=招式类别门控（物理2/特殊3，4=攻击招式）——无门控条目恒计入。 */
export function counterMulOf(u: UnitState, catCode?: number): number {
  let mul = 0;
  for (const e of u.effects) {
    if (!isMod(e, "counter")) continue;
    const c = e.params?.cat as number | undefined;
    if (c !== undefined && catCode !== undefined && !(c === 4 ? catCode !== 1 : c === catCode)) continue;
    mul += e.params?.mul ?? 0;
  }
  return mul;
}

/** 定额反弹合计（counter flag；params.flat——"受攻击时反弹N点固定伤害"，与受到的实际伤害无关；
 *  params.foeMaxN/foeMaxD=攻击方最大体力分数——"受到攻击时反弹对手最大体力1/3"）。 */
export function counterFlatOf(u: UnitState, foe?: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (!isMod(e, "counter")) continue;
    if (e.params?.flat !== undefined) v += e.params.flat;
    const fn = e.params?.foeMaxN as number | undefined;
    const fd = e.params?.foeMaxD as number | undefined;
    if (foe !== undefined && fn !== undefined && fd !== undefined) v += Math.floor((foe.base.hp * fn) / fd);
  }
  return v;
}

/** PP 花费倍率（ppCostMul flag，params.mul 或字面值；缺省 1）。 */
export function ppCostMulOf(u: UnitState): number {
  let mul = 1;
  for (const e of u.effects) {
    if (!isMod(e, "ppCostMul")) continue;
    mul *= e.params?.mul ?? 1;
  }
  return mul;
}

/** 免疫能力下降窗口开启中（immune{of:degrade}）。 */
export const immuneDegradeOn = (u: UnitState): boolean => immuneOn(u, IM.degrade);

/** 持有者出招伤害倍率（dmgMul flag，params.mul 整数连乘；缺省 1）。 */
export function dmgMulOf(u: UnitState): number {
  let mul = 1;
  for (const e of u.effects) {
    if (isMod(e, "dmgMul")) mul *= e.params?.mul ?? 1;
  }
  return mul;
}

/** 持有者负级锁（downLock flag）开启中。 */
export const downLockOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "downLock"));

/** 持有者正级锁（upLock flag）开启中：正面能力等级禁止被清除/吸取（"能力提升无法被消除或吸取"）。 */
export const upLockOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "upLock"));

/** 持有者无视自身负级窗口（ignoreSelfDown flag）开启中。 */
export const ignoreSelfDownOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "ignoreSelfDown"));

/** 持有者出招附加固伤合计（dmgFlat flag，params.flat 加算；params.defSumPct=自身双防总和的百分比动态值；params.selfMaxPct=自身最大体力百分比；params.foeCurPct=对手当前体力百分比；params.foeDefSumPct=对手双防总和百分比；params.prevTakenPct=上回合承伤数值百分比；params.flatPowerMul=当次技能威力整数倍；params.flatDefStageMul=自身双防提升总段数×N；params.flatStageUpCountMul=自身能力提升状态种数×N；params.flatBothStageUpCountMul=双方能力提升状态种数×N；params.cap=本条贡献上限；缺省 0）。 */
export function dmgFlatOf(u: UnitState, foe?: UnitState, movePower?: number, healOut?: { v: number }): number {
  const stageUps = (x: UnitState): number => Object.values(x.stages).filter((v) => v > 0).length;
  let flat = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgFlat")) continue;
    if (e.amountExpr !== undefined) {
      if (statusGateOk(e, u, foe)) flat += numericValueOf(e.amountExpr, u, foe);
      continue;
    }
    let add = e.params?.flat ?? 0;
    if (e.params?.defSumPct !== undefined) add += Math.floor(((u.base.def + (u.base.sdf ?? 0)) * e.params.defSumPct) / 100);
    // statSumPct+statMask：限时窗属性缩放固伤（"下N回合附加自身防御、特防总和N%固伤"折算 dmg_flat；bitmask 编码 atk1 def2 spa4 sdf8 spd16 hp32）
    if (e.params?.statSumPct !== undefined) {
      const mask = e.params.statMask ?? 0;
      const bases: Record<string, number> = { atk: u.base.atk, def: u.base.def, spa: u.base.spa ?? 0, sdf: u.base.sdf ?? 0, spd: u.base.spd, hp: u.base.hp };
      const order = ["atk", "def", "spa", "sdf", "spd", "hp"];
      let base = 0;
      for (const [i, s] of order.entries()) if ((mask & (1 << i)) !== 0) base += bases[s] ?? 0;
      add += Math.floor((base * e.params.statSumPct) / 100);
    }
    if (e.params?.atkPct !== undefined) add += Math.floor((u.base.atk * e.params.atkPct) / 100);
    if (e.params?.selfMaxPct !== undefined) add += Math.floor((u.base.hp * e.params.selfMaxPct) / 100);
    if (e.params?.foeCurPct !== undefined && foe !== undefined) add += Math.floor((foe.currentHp * e.params.foeCurPct) / 100);
    if (e.params?.foeMaxPct !== undefined && foe !== undefined) add += Math.floor((foe.base.hp * e.params.foeMaxPct) / 100); // "附加对手最大体力N%固伤"/"吸取对手最大体力1/6"
    if (e.params?.selfCurPct !== undefined) add += Math.floor((u.currentHp * e.params.selfCurPct) / 100);
    if (e.params?.foeDefSumPct !== undefined && foe !== undefined) add += Math.floor(((foe.base.def + (foe.base.sdf ?? 0)) * e.params.foeDefSumPct) / 100);
    if (e.params?.prevTakenPct !== undefined) add += Math.floor(((u.prevTaken ?? 0) * e.params.prevTakenPct) / 100);
    if (e.params?.flatPrevTurnTakenPct !== undefined) add += Math.floor(((u.prevTaken ?? 0) * e.params.flatPrevTurnTakenPct) / 100);
    if (e.params?.flatPrevTakenPct !== undefined) add += Math.floor(((u.lastTaken ?? 0) * e.params.flatPrevTakenPct) / 100);
    if (e.params?.flatSelfLastDmgPct !== undefined) add += Math.floor(((u.lastDealt ?? 0) * e.params.flatSelfLastDmgPct) / 100);
    if (e.params?.flatPowerMul !== undefined && movePower !== undefined) add += movePower * e.params.flatPowerMul;
    if (e.params?.flatDefStageMul !== undefined) add += (Math.max(0, u.stages.def ?? 0) + Math.max(0, u.stages.sdf ?? 0)) * e.params.flatDefStageMul;
    if (e.params?.flatStageUpCountMul !== undefined) add += stageUps(u) * e.params.flatStageUpCountMul;
    if (e.params?.flatFoeStageUpCountMul !== undefined && foe !== undefined) add += stageUps(foe) * e.params.flatFoeStageUpCountMul;
    if (e.params?.flatBothStageUpCountMul !== undefined) add += (stageUps(u) + (foe !== undefined ? stageUps(foe) : 0)) * e.params.flatBothStageUpCountMul;
    // selfMaxFracNum/Den：自身最大体力 n/d 固伤（"下次攻击附加自身1/3最大体力固伤"——params 整数平铺拆分数）
    if (e.params?.selfMaxFracNum !== undefined) add += Math.floor((u.base.hp * e.params.selfMaxFracNum) / (e.params.selfMaxFracDen ?? 1));
    if (e.params?.cap !== undefined) add = Math.min(add, e.params.cap);
    // healEcho：该条固伤贡献等额回血（"吸取对手最大体力1/6"——固伤窗兼吸血语义）
    if (healOut !== undefined && e.params?.healEcho === 1) healOut.v += add;
    flat += add;
  }
  return flat;
}

/** 招式 id → 整数哈希（excludeMoveId 承载——params 仅收 integer，故存哈希而非字符串 id）。 */
export function moveIdHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h < 0 ? -h : h;
}

/** 持有者承伤提升合计 %（dmgTakenPct flag，params.pct 加算；缺省 0）。
 *  params.excludeMoveId=来源招式哈希（"受到其他技能的伤害翻倍"——施法招式自身不计入）。 */
export function dmgTakenPctOf(u: UnitState, kind?: string, moveId?: string, moveType?: string): number {
  let pct = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgTakenPct")) continue;
    if (e.moveType !== undefined && e.moveType !== moveType) continue;
    const km = e.params?.kindMask;
    if (km !== undefined && (kind === undefined || ((km as number) & (DMG_KIND_BIT[kind] ?? 0)) === 0)) continue;
    if (moveId !== undefined && e.params?.excludeMoveId === moveIdHash(moveId)) continue;
    pct += e.params?.pct ?? 0;
  }
  return pct;
}

/** 伤害类别位图（kindMask params 键——"固定伤害和百分比伤害提高"=1|2=3；"真实伤害"=8）。 */
export const DMG_KIND_BIT: Record<string, number> = { fixed: 1, percent: 2, standard: 4, true: 8 };

/** 状态窗 params 门控统一判定（"满体力时受伤降低"/"对手异常时承伤提升"——与 dmgOutPctOf 门控键同族）：
 * selfHpFull/selfHpAboveFrac/selfHpBelowFrac=持有者体力条件；foeStatused/selfStatused/foeStageUp/foeStageDown/foeHpAboveAbs/foeHpBelowAbs=对手侧条件（foe 缺省时按不满足计）；
 * kindMask=伤害类别位图门控（kind 缺省时视为不通过——按击函数必须传 kind）。 */
function statusGateOk(e: { params?: Record<string, unknown>; moveType?: string }, u: UnitState, foe?: UnitState, kind?: string, moveType?: string): boolean {
  // moveType 系别门控（"受到火系伤害减半"/"电招式伤害提升"——来招 type 与门控名不符则窗关）
  if (e.moveType !== undefined && e.moveType !== moveType) return false;
  const p = e.params;
  if (p === undefined) return true;
  if (p.kindMask !== undefined && (kind === undefined || ((p.kindMask as number) & (DMG_KIND_BIT[kind] ?? 0)) === 0)) return false;
  if (p.selfHpFull === 1 && u.currentHp < u.base.hp) return false;
  if (p.selfHpAboveFrac !== undefined && u.currentHp <= Math.floor((u.base.hp * (p.selfHpAboveFrac as { n: number }).n) / (p.selfHpAboveFrac as { d: number }).d)) return false;
  if (p.selfHpBelowFrac !== undefined && u.currentHp >= Math.floor((u.base.hp * (p.selfHpBelowFrac as { n: number }).n) / (p.selfHpBelowFrac as { d: number }).d)) return false;
  // selfHpAboveFracN/D·selfHpBelowFracN/D——分数门控的整型对编码（params 仅整数；与 {n,d} 对象形态等价并存）
  if (p.selfHpAboveFracN !== undefined && p.selfHpAboveFracD !== undefined && u.currentHp <= Math.floor((u.base.hp * (p.selfHpAboveFracN as number)) / (p.selfHpAboveFracD as number))) return false;
  if (p.selfHpBelowFracN !== undefined && p.selfHpBelowFracD !== undefined && u.currentHp >= Math.floor((u.base.hp * (p.selfHpBelowFracN as number)) / (p.selfHpBelowFracD as number))) return false;
  if (p.foeStatused === 1 && !(foe !== undefined && foe.effects.some((x) => effectDefOf(x.kind)?.ailment === true))) return false;
  if (p.selfStatused === 1 && !u.effects.some((x) => effectDefOf(x.kind)?.ailment === true)) return false;
  if (p.foeStageUp === 1 && !(foe !== undefined && Object.values(foe.stages).some((v) => v > 0))) return false;
  if (p.foeStageDown === 1 && !(foe !== undefined && Object.values(foe.stages).some((v) => v < 0))) return false;
  if (p.selfStageUp === 1 && !Object.values(u.stages).some((v) => v > 0)) return false;
  if (p.selfStageDown === 1 && !Object.values(u.stages).some((v) => v < 0)) return false;
  if (p.notSelfStageUp === 1 && Object.values(u.stages).some((v) => v > 0)) return false;
  if (p.notSelfStageDown === 1 && Object.values(u.stages).some((v) => v < 0)) return false;
  // notSelfHpBelowFracN/D·notSelfHpAboveFracN/D——分数门控反向窗（"P时效果翻倍"克隆窗互斥基窗）
  if (p.notSelfHpBelowFracN !== undefined && p.notSelfHpBelowFracD !== undefined && u.currentHp < Math.floor((u.base.hp * (p.notSelfHpBelowFracN as number)) / (p.notSelfHpBelowFracD as number))) return false;
  if (p.notSelfHpAboveFracN !== undefined && p.notSelfHpAboveFracD !== undefined && u.currentHp > Math.floor((u.base.hp * (p.notSelfHpAboveFracN as number)) / (p.notSelfHpAboveFracD as number))) return false;
  if (p.foeHpAboveAbs !== undefined && !(foe !== undefined && foe.currentHp > (p.foeHpAboveAbs as number))) return false;
  if (p.foeHpBelowAbs !== undefined && !(foe !== undefined && foe.currentHp < (p.foeHpBelowAbs as number))) return false;
  if (p.selfHpBelowFoe === 1 && !(foe !== undefined && u.currentHp < foe.currentHp)) return false;
  if (p.selfHpAboveFoe === 1 && !(foe !== undefined && u.currentHp > foe.currentHp)) return false;
  // not* 反门控（"几率变为"克隆窗互斥——"自身体力低于对手时 60%"成立时基窗关闭）
  if (p.notSelfHpBelowFoe === 1 && foe !== undefined && u.currentHp < foe.currentHp) return false;
  if (p.notSelfHpAboveFoe === 1 && foe !== undefined && u.currentHp > foe.currentHp) return false;
  if (p.notFoeStatused === 1 && foe !== undefined && foe.effects.some((x) => effectDefOf(x.kind)?.ailment === true)) return false;
  if (p.notSelfStatused === 1 && u.effects.some((x) => effectDefOf(x.kind)?.ailment === true)) return false;
  return true;
}

/** 持有者承伤减免合计 %（dmgTakenDown flag，params.pct 加算，上限 99；params 门控与 dmgOutPct 同族——逐击求值）。 */
export function dmgTakenDownPctOf(u: UnitState, foe?: UnitState, kind?: string, moveType?: string): number {
  let pct = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgTakenDown")) continue;
    if (!statusGateOk(e, u, foe, kind, moveType)) continue;
    // 对手每级正面强化 ×pct（"对手每处于1种能力提升则自身受到伤害降低N%"——perFoeStage 线性；perFoeStageEvery=每N种步进；perStageCap 封顶）
    if (e.params?.perFoeStage !== undefined) { const cnt = foe !== undefined ? Object.values(foe.stages).filter((v) => v > 0).length : 0; pct += Math.min(e.params.perFoeStage * (e.params.perFoeStageEvery !== undefined ? Math.floor(cnt / e.params.perFoeStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER); continue; }
    // 对手每级能力下降 ×pct（"对手每处于1种能力下降则受到伤害减少N%"——perFoeStageDown）
    if (e.params?.perFoeStageDown !== undefined) { const cnt = foe !== undefined ? Object.values(foe.stages).filter((v) => v < 0).length : 0; pct += Math.min(e.params.perFoeStageDown * (e.params.perFoeStageEvery !== undefined ? Math.floor(cnt / e.params.perFoeStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER); continue; }
    // 自身每级正面强化 ×pct（"自身每处于1种能力提升状态则受到的伤害减少N%"——perStage；perStageEvery=每N种步进）
    if (e.params?.perStage !== undefined) { const cnt = Object.values(u.stages).filter((v) => v > 0).length; pct += Math.min(e.params.perStage * (e.params.perStageEvery !== undefined ? Math.floor(cnt / e.params.perStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER); continue; }
    // 逐击累加减免（"每次受到攻击减少量增加10%，最多减少60%"——growAcc 由承伤结算递增，growCap 封顶累加部分）
    if (e.params?.growStep !== undefined) {
      const per = e.params.growPer ?? 1;
      const acc = per === 1 ? (e.params.growAcc ?? 0) : Math.floor((e.params.growHits ?? 0) / per) * e.params.growStep;
      pct += (e.params.pct ?? 0) + Math.min(acc, e.params.growCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 已损体力步进减免（"HP每降低10%，受到的伤害减少5%"——perHpLostStep=10 步进 × perHpLostPct=5 每步；pct 共存为基数：减伤效果降低族 perHpLostPct 为负）
    if (e.params?.perHpLostStep !== undefined && e.params?.perHpLostPct !== undefined) {
      const miss = Math.floor((Math.max(0, u.base.hp - u.currentHp) * 100) / Math.max(1, u.base.hp));
      pct += (e.params.pct ?? 0) + Math.floor(miss / e.params.perHpLostStep) * e.params.perHpLostPct;
      continue;
    }
    pct += e.params?.pct ?? 0;
  }
  return Math.max(0, Math.min(99, pct));
}

/** 概率闪避窗口的生效条目（missChance flag，RESOLVE_HIT 逐条 draw；foe 供 params 门控判定；params.count=次数窗逐次消耗）。
 *  params.cat 类别门（缺省=任意招式；1=属性/2=物理/3=特殊，4=任意非属性）——"对手所有属性技能命中减N%"。
 *  cat 在 missChanceEntries 里求值，所以 missChanceEntries/RESOLVE_HIT 的调用方即使拿不到 move 也受限。 */
export function missChanceEntries(u: UnitState, foe?: UnitState, cat?: number): UnitState["effects"] {
  const out: UnitState["effects"] = [];
  for (const e of u.effects) {
    if (!isMod(e, "missChance")) continue;
    const c = e.params?.cat;
    if (c !== undefined && !(cat === undefined ? false : c === 4 ? cat !== 1 : c === cat)) continue;
    if (!statusGateOk(e, u, foe)) continue;
    out.push(e);
  }
  return out;
}

export const noHealOn = (u: UnitState): boolean => immuneOn(u, IM.heal);

export const pierceStagesOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "pierce") && (((e.params?.scope as number | undefined) ?? 0) & 2) !== 0);

/** 持有者出招穿透守方护盾/伤转/免疫（pierce flag，等价 fx.pierce）。 */
export const pierceAtkOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "pierce") && (((e.params?.scope as number | undefined) ?? 0) & 1) !== 0);

/** 战斗中有效最大HP（maxHpDown flag；base.hp − 合计 flat，下限 1）。 */
export function hpCapOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (!isMod(e, "maxHpDown")) continue;
    if (e.params?.flat !== undefined) v += e.params.flat;
    else if (e.params?.pct !== undefined) v += Math.floor((u.base.hp * e.params.pct) / 100);
    else if (e.params?.n !== undefined && e.params.d !== undefined) v += Math.floor((u.base.hp * e.params.n) / e.params.d);
  }
  return Math.max(1, u.base.hp - v);
}

/** 命中效果失效门控（hit_fx_null）：持有者施放的技能其非伤害 op 是否被压制。
 * cat 语义与 reactive 一致：4=攻击技（含 damage op）、1=属性技（无 damage op）、2=物理、3=特殊；缺省=全部。 */
export function hitFxNullOn(u: UnitState, catCode: number): boolean {
  return u.effects.some((e) => {
    if (!isMod(e, "hitFxNull")) return false;
    const cat = e.params?.cat;
    if (cat === undefined) return true;
    if (cat === 4) return catCode !== 1;
    return cat === catCode;
  });
}

/** 护盾剩余吸收量合计（dmgShield flag；params.flat 加算）——护盾值反噬/护盾穿透读数 */
export function shieldFlatOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) if (effectDefOf(e.kind)?.dmgShield === "params") v += e.params?.flat ?? 0;
  return v;
}

/** 数值只读当前面板；状态持有者是 self，heal 的接收者是 target。 */
export const numericValueOf = (value: NumericValue, u: UnitState, foe?: UnitState, target = u): number =>
  evaluateValue(value, { self: u, foe, target, isAilment: (kind) => effectDefOf(kind)?.ailment === true });

export type StatDiffStat = "atk" | "def" | "spa" | "sdf" | "spd" | "hp";
interface ValueSource {
  amountExpr?: NumericValue;
  statDiff?: StatDiffStat;
  statDiffDenom?: number;
  statSumPct?: { a: StatDiffStat; b: StatDiffStat; pct: number };
  perAilment?: { who?: "self" | "foe"; per?: number; pct: number };
  params?: Record<string, unknown>;
}

/** 唯一旧格式适配层。新组合直接写 amountExpr，不再增加专属字段。 */
export function valueExpressionOf(source: ValueSource): NumericValue | undefined {
  if (source.amountExpr !== undefined) return source.amountExpr;
  if (source.perAilment !== undefined) {
    const p = source.perAilment;
    return { product: [{ divide: { value: { count: "ailments", of: p.who ?? "self" }, by: Math.max(1, p.per ?? 1) } }, p.pct] };
  }
  const stat = source.statDiff ?? source.params?.statDiff;
  if (typeof stat === "string") {
    const denom = source.statDiffDenom ?? (source.params?.statDiffDenom as number | undefined) ?? 1;
    return { divide: { value: { difference: [{ stat: stat as StatDiffStat }, { stat: stat as StatDiffStat, of: "foe" }] }, by: Math.max(1, denom) } };
  }
  if (source.statSumPct !== undefined) {
    const p = source.statSumPct;
    return { divide: { value: { product: [{ sum: [{ stat: p.a, of: "target" }, { stat: p.b, of: "target" }] }, p.pct] }, by: 100 } };
  }
  return undefined;
}

export function valueAmountOf(source: ValueSource, u: UnitState, foe?: UnitState, target = u): number | undefined {
  const value = valueExpressionOf(source);
  // 旧 statDiff 的缺失对手约定保留；新表达式的缺失读数则为 0。
  if (source.amountExpr === undefined && (source.statDiff !== undefined || typeof source.params?.statDiff === "string") && foe === undefined) return 0;
  return value === undefined ? undefined : numericValueOf(value, u, foe, target);
}

export const ailmentCountOf = (u: UnitState | undefined): number =>
  u === undefined ? 0 : numericValueOf({ count: "ailments" }, u);
export const perAilmentOf = (spec: ValueSource["perAilment"], u: UnitState, foe?: UnitState): number =>
  spec === undefined ? 0 : valueAmountOf({ perAilment: spec }, u, foe)!;
export const statSumPctOf = (u: UnitState, spec: ValueSource["statSumPct"]): number =>
  spec === undefined ? 0 : valueAmountOf({ statSumPct: spec }, u)!;
export const statDiffOf = (u: UnitState, foe: UnitState | undefined, stat: StatDiffStat, denom?: number): number =>
  valueAmountOf({ statDiff: stat, ...(denom !== undefined ? { statDiffDenom: denom } : {}) }, u, foe)!;

/** 承伤固定减免合计（dmgReduceFlat flag；params.flat 加算；params.statDiff 读双方该维数值差）。 */
export function dmgReduceFlatOf(u: UnitState, foe?: UnitState, kind?: string): number {
  let v = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgReduceFlat")) continue;
    if (!statusGateOk(e, u, foe, kind)) continue;
    v += valueAmountOf(e, u, foe) ?? e.params?.flat ?? 0;
  }
  return v;
}

/** 承伤上限（dmgCap flag；取最小 cap——params.cap 定额 / params.capPct 自身最大体力百分比换算；无 → 0）。 */
export function dmgCapOf(u: UnitState, kind?: string): number {
  let cap = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgCap")) continue;
    // kindMask 门控（"受到的固定伤害和百分比伤害不超过N点"——类别不匹配该上限不参与）
    if (e.params?.kindMask !== undefined && (kind === undefined || ((e.params.kindMask as number) & (DMG_KIND_BIT[kind] ?? 0)) === 0)) continue;
    const v = e.params?.cap ?? (e.params?.capPct !== undefined ? Math.floor((u.base.hp * e.params.capPct) / 100) : undefined);
    if (v !== undefined) cap = cap === 0 ? v : Math.min(cap, v);
  }
  return cap;
}

/** 反伤分数合计（reflect{of:dmg}；params{n,d} 加成分子；kindMask 限定伤害类型——"反弹受到的固定伤害和百分比伤害"kindMask=1|2；无 → undefined）。 */
export function dmgReflectOf(u: UnitState, kind?: string): readonly [number, number] | undefined {
  let n = 0; let d = 1;
  for (const e of u.effects) {
    if (e.kind === "reflect" && (((e.params?.of as number | undefined) ?? 0) & RF.dmg) !== 0 && e.params?.n !== undefined && e.params.d !== undefined) {
      const km = e.params.kindMask;
      if (km !== undefined && kind !== undefined && (km & (DMG_KIND_BIT[kind] ?? 0)) === 0) continue;
      n += e.params.n; d = e.params.d;
    }
  }
  return n > 0 ? [n, d] : undefined;
}

/** 持有者攻击必定致命窗口开启中（critAlways flag）。 */
export const critAlwaysOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "critAlways"));

/** 持有者出伤取偶窗口（evenOutcome flag；"下N次攻击必定打出偶数伤害"——次数消耗在 damage.ts 结算点）。 */
export const evenOutcomeOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "evenOutcome"));

/** 致命反弹窗口开启中（reflect{of:crit}——"反弹对手的致命一击"）。 */
export const critReflectOn = (u: UnitState): boolean => reflectOn(u, RF.crit);

/** 致命免疫窗口开启中（immune{of:crit}——"免疫致命一击伤害"；crit_dodge 概率窗走 critDodgeChanceOf）。 */
export const critImmuneOn = (u: UnitState): boolean => immuneOn(u, IM.crit);

/** 暴伤概率免疫最大值（immune{of:crit}+params.chance——受暴击时 drawBelow(100)<chance 则整击归零）。 */
export const critDodgeChanceOf = (u: UnitState): number => {
  let v = 0;
  for (const e of u.effects) if (e.kind === "immune" && (((e.params?.of as number | undefined) ?? 0) & IM.crit) !== 0 && e.params?.chance !== undefined) v = Math.max(v, e.params.chance);
  return v;
};

/** 攻特取高窗口开启中（unify_offense flag——"攻击和特攻等于其中最高的一项"）。 */
export const unifyOffenseOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "unifyOffense"));

/** 防转攻视窗口开启中（stageAlias flag——"防御、特防能力提升分别视为攻击、特攻能力提升"）。 */
export const stageAliasOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "stageAlias"));

/** 先制免疫窗口开启中（immune{of:prio}——"免疫对手的先手攻击技能"）。 */
export const prioImmuneOn = (u: UnitState): boolean => immuneOn(u, IM.prio);

/** 要害概率分数列表（critChance flag；params{n,d}——逐条 drawBelow(d)<n 判定）。foe 门控："对手体力>N时暴击率提升"。 */
export function critChanceFracs(u: UnitState, foe?: UnitState): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (const e of u.effects) {
    if (isMod(e, "critChance") && e.params?.n !== undefined && e.params.d !== undefined) {
      // params 门控（"对手体力大于N时所有攻击暴击率提升"）：条件不满足该窗口不计——statusGateOk 全键域
      if (!statusGateOk(e, u, foe)) continue;
      out.push([e.params.n, e.params.d]);
    }
  }
  return out;
}

/** 持有者招式必定命中窗口开启中（mustHit flag；穿透 must_miss/概率闪避）。 */
export const mustHitOn = (u: UnitState, cat?: number): boolean =>
  u.effects.some((e) => {
    if (!isMod(e, "mustHit")) return false;
    // params.cat 类别必中（"所有特殊攻击必定命中"）；省略=全类别
    return e.params?.cat === undefined || (cat !== undefined && e.params.cat === cat);
  });

/** 持有者出招伤害提高合计 %（dmgOutPct flag；params.pct 加算）。 */
export function dmgOutPctOf(u: UnitState, foe?: UnitState, rng?: { drawBelow: (n: number, purpose: string) => number }, kind?: string, bench?: { alive: number; dead: number }, moveType?: string): number {
  let pct = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgOutPct")) continue;
    const value = valueAmountOf(e, u, foe);
    if (value !== undefined) {
      if (statusGateOk(e, u, foe, kind, moveType)) pct += value;
      continue;
    }
    // moveType 系别门控（"电系技能威力翻倍"——本招 type 不符则窗关）
    if (e.moveType !== undefined && e.moveType !== moveType) continue;
    // kindMask 门控（"固定伤害和百分比伤害提高25%"——类别不匹配该窗口不计）
    if (e.params?.kindMask !== undefined && (kind === undefined || ((e.params.kindMask as number) & (DMG_KIND_BIT[kind] ?? 0)) === 0)) continue;
    // pctMin/pctMax 门控（"造成的伤害随机提升N%-M%"——状态窗每击 roll，持久魂印用）
    if (e.params?.pctMin !== undefined && e.params?.pctMax !== undefined) {
      const lo = e.params.pctMin; const hi = e.params.pctMax;
      pct += rng !== undefined ? lo + rng.drawBelow(hi - lo + 1, "dmg_boost_range") : Math.floor((lo + hi) / 2);
      continue;
    }
    // params 门控（"对手处于能力下降状态造成的伤害提升N%"）：条件不满足该窗口不计
    if (e.params?.foeStageDown === 1 && !(foe !== undefined && Object.values(foe.stages).some((v) => v < 0))) continue;
    if (e.params?.foeStageUp === 1 && !(foe !== undefined && Object.values(foe.stages).some((v) => v > 0))) continue;
    if (e.params?.foeStatused === 1 && !(foe !== undefined && foe.effects.some((x) => effectDefOf(x.kind)?.ailment === true))) continue;
    if (e.params?.selfStatused === 1 && !u.effects.some((x) => effectDefOf(x.kind)?.ailment === true)) continue;
    // selfHpFull 门控（"满体力时造成的伤害提升N%"——不满血该窗口不计）
    if (e.params?.selfHpFull === 1 && u.currentHp < u.base.hp) continue;
    if (e.params?.selfHpBelowFoe === 1 && !(foe !== undefined && u.currentHp < foe.currentHp)) continue;
    // chanceSelfMissingPct 动态概率门（"有自身已损失体力百分比的几率造成伤害提升N%"——按判定时刻已损比例逐击 roll）
    if (e.params?.chanceSelfMissingPct === 1 && rng !== undefined) {
      const mp = Math.floor(((u.base.hp - u.currentHp) * 100) / Math.max(1, u.base.hp));
      if (rng.drawBelow(100, "dmg_boost_misspct") >= mp) continue;
    }
    if (e.params?.selfHpAboveFoe === 1 && !(foe !== undefined && u.currentHp > foe.currentHp)) continue;
    // 每级正面强化 ×pct（"自身每处于1种能力提升状态则造成的伤害提升N%"；perStageEvery=每N种步进）
    if (e.params?.perStage !== undefined) {
      const cnt = Object.values(u.stages).filter((v) => v > 0).length;
      pct += Math.min(e.params.perStage * (e.params.perStageEvery !== undefined ? Math.floor(cnt / e.params.perStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 对手每级正面强化 ×pct（"对手每处于1种能力提升状态则造成的伤害提升N%"——perFoeStage 对手侧镜像）
    if (e.params?.perFoeStage !== undefined) {
      const cnt = foe !== undefined ? Object.values(foe.stages).filter((v) => v > 0).length : 0;
      pct += Math.min(e.params.perFoeStage * (e.params.perFoeStageEvery !== undefined ? Math.floor(cnt / e.params.perFoeStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 对手每级能力下降 ×pct（"对手每处于1种能力下降状态则自身伤害提升N%"——perFoeStageDown 读对手负级维数）
    if (e.params?.perFoeStageDown !== undefined) {
      const cnt = foe !== undefined ? Object.values(foe.stages).filter((v) => v < 0).length : 0;
      pct += Math.min(e.params.perFoeStageDown * (e.params.perFoeStageEvery !== undefined ? Math.floor(cnt / e.params.perFoeStageEvery) : cnt), e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 双方当前体力差步进 ×pct（"每与对手相差80点伤害提升40%最高160%"——|self−foe| 当前HP差按 every 步进 ×pct，perStageCap 封顶）
    if (e.params?.perHpDiffEvery !== undefined && e.params?.perHpDiffPct !== undefined) {
      const diff = foe !== undefined ? Math.abs(u.currentHp - foe.currentHp) : 0;
      pct += Math.min(Math.floor(diff / Math.max(1, e.params.perHpDiffEvery)) * e.params.perHpDiffPct, e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 护盾点数步进 ×pct（"双方每有5点护盾伤害提升1%"——perShieldWho: 1=self 2=foe 3=both 缺省 both；perStageCap 封顶）
    if (e.params?.perShieldEvery !== undefined && e.params?.perShieldPct !== undefined) {
      const who = e.params.perShieldWho ?? 3;
      const sum = ((who & 1) !== 0 ? shieldFlatOf(u) : 0) + ((who & 2) !== 0 && foe !== undefined ? shieldFlatOf(foe) : 0);
      pct += Math.min(Math.floor(sum / Math.max(1, e.params.perShieldEvery)) * e.params.perShieldPct, e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 已损体力步进增幅（"体力每减少10%则伤害提升5%"——perHpLostStep 步进 × perHpLostPct 每步；pct 共存为基数：增伤效果降低族 perHpLostPct 为负）
    if (e.params?.perHpLostStep !== undefined && e.params?.perHpLostPct !== undefined) {
      const miss = Math.floor((Math.max(0, u.base.hp - u.currentHp) * 100) / Math.max(1, u.base.hp));
      pct += (e.params.pct ?? 0) + Math.floor(miss / e.params.perHpLostStep) * e.params.perHpLostPct;
      continue;
    }
    // 背包阵亡/存活数 ×pct（"背包内每阵亡一只精灵，造成伤害提升N%"——perBenchDead/perBenchAlive 读己方背包计数；perStageCap 封顶）
    if (e.params?.perBenchDead !== undefined) {
      const cnt = e.params.perBenchEvery !== undefined ? Math.floor((bench?.dead ?? 0) / e.params.perBenchEvery) : (bench?.dead ?? 0);
      pct += Math.min(e.params.perBenchDead * cnt, e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    if (e.params?.perBenchAlive !== undefined) {
      const cnt = e.params.perBenchEvery !== undefined ? Math.floor((bench?.alive ?? 0) / e.params.perBenchEvery) : (bench?.alive ?? 0);
      pct += Math.min(e.params.perBenchAlive * cnt, e.params.perStageCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    // 逐击累加（"之后每次叠加N%，最高M%"——growAcc 由伤害结算递增；growPer=N 每 N 击记一步）
    if (e.params?.growStep !== undefined) {
      const per = e.params.growPer ?? 1;
      const acc = per === 1 ? (e.params.growAcc ?? 0) : Math.floor((e.params.growHits ?? 0) / per) * e.params.growStep;
      pct += Math.min(acc, e.params.growCap ?? Number.MAX_SAFE_INTEGER);
      continue;
    }
    pct += e.params?.pct ?? 0;
  }
  return pct;
}

/** 攻击吸血窗口分数列表（drainAtk flag；params{n,d}——每次攻击伤害按分数回血；statusGateOk 门控；effect 引用供 count/echo 消费）。 */
/** 持有者用招吸血合计（drainOnUse flag；params.flat 累加）——"每回合使用技能则吸取对手N点体力"。 */
export const drainOnUseFlatOf = (u: UnitState): number =>
  u.effects.reduce((acc, e) => acc + (isMod(e, "drainOnUse") ? (e.params?.flat ?? 0) : 0), 0);

export function drainAtkFracs(u: UnitState, foe?: UnitState, kind?: string): readonly (readonly [number, number, UnitState["effects"][number]])[] {
  const out: (readonly [number, number, UnitState["effects"][number]])[] = [];
  for (const e of u.effects) {
    if (isMod(e, "drainAtk") && e.params?.n !== undefined && e.params.d !== undefined && statusGateOk(e, u, foe, kind)) {
      out.push([e.params.n, e.params.d, e]);
    }
  }
  return out;
}

/** 持有者伤害转回复窗口开启中（dmgToHeal flag；pct 参数存在时为部分转化——全额转化判定排除它，由 dmgToHealPctOf 后段结算）。 */
export const dmgToHealOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "dmgToHeal") && e.params?.pct === undefined && e.params?.n === undefined);

/** 部分伤转回复比例合计（"将30%受到的伤害转化为体力"——伤害照常结算，承伤方按 pct 回血；n/d 分数形折算）。 */
export const dmgToHealPctOf = (u: UnitState): number =>
  u.effects.reduce((s, e) => s + (isMod(e, "dmgToHeal") ? (e.params?.pct ?? (e.params?.n !== undefined ? (e.params.n * 100) / (e.params.d ?? 1) : 0)) : 0), 0);

/** 持有者伤害转护盾窗口开启中（dmgToShield flag）。 */
export const dmgToShieldOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "dmgToShield"));

/** 持有者低伤免疫阈值合计（dmgFloor flag；params.min 取最大值；无 → 0）。 */
export function dmgFloorOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "dmgFloor") && e.params?.min !== undefined) v = Math.max(v, e.params.min);
  }
  return v;
}

/** 持有者被封印的招式类别列表（blockCategory flag；params.cat：1=status 属性招）。 */
export function blockedCategories(u: UnitState): number[] {
  const out: number[] = [];
  for (const e of u.effects) {
    if (!isMod(e, "blockCategory") || e.params?.cat === undefined) continue;
    // cat:4=任意攻击招（"无法使用攻击技能"——物理+特殊全封）
    if (e.params.cat === 4) out.push(2, 3); else out.push(e.params.cat);
  }
  return out;
}

/**
 * 招式失效检查（nullifies flag）：命中 cat 的失效条目返回之（调用方负责消耗）。
 * params.cat 省略 = 任意招式；count 省略 = 永续（与 remainingTurns 配合）。
 */
export function nullifyEntryFor(u: UnitState, catCode: number, prio?: number, power?: number): UnitState["effects"][number] | undefined {
  return u.effects.find((e) => {
    if (!isMod(e, "nullifies")) return false;
    const cat = e.params?.cat;
    // cat 编码：省略=任意；4=任意攻击招（catCode 2|3）；否则精确匹配 1=属性/2=物理/3=特殊
    if (!(cat === undefined || (cat === 4 ? catCode !== 1 : cat === catCode))) return false;
    // params.prioMin/prioMax：按出招先制度门控（"对手本回合先制技能无效"→prioMin:1）
    if (e.params?.prioMin !== undefined && (prio ?? 0) < e.params.prioMin) return false;
    if (e.params?.prioMax !== undefined && (prio ?? 0) > e.params.prioMax) return false;
    // params.powerBelow：威力门控（"令对手使用的威力低于N的攻击技能无效"）
    if (e.params?.powerBelow !== undefined && !((power ?? 0) < e.params.powerBelow)) return false;
    return true;
  });
}

/** 持有者出招伤害分数（dmgOutFrac flag；params{n,d} 分子连乘分母取首；无 → undefined）。 */
export function dmgOutFracOf(u: UnitState): readonly [number, number] | undefined {
  let n = 1; let d = 0;
  for (const e of u.effects) {
    if (isMod(e, "dmgOutFrac") && e.params?.n !== undefined && e.params.d !== undefined) {
      n *= e.params.n; d = d === 0 ? e.params.d : d * e.params.d;
    }
  }
  return d > 0 ? [n, d] : undefined;
}

/** 持有者致命保留窗口开启中（endure flag）。 */
export const endureOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "endure"));

/** 持有者按类别的承伤分数（dmgTakenCatFrac flag；cat 编码 1=属性/2=物理/3=特殊；分数连乘）。 */
export function dmgTakenCatFracOf(u: UnitState, cat: number): readonly [number, number] {
  let n = 1; let d = 1;
  for (const e of u.effects) {
    if (isMod(e, "dmgTakenCatFrac") && e.params?.cat !== undefined && (e.params.cat === 4 ? cat !== 1 : e.params.cat === cat) && e.params.n !== undefined && e.params.d !== undefined) {
      n *= e.params.n; d *= e.params.d;
    }
  }
  return [n, d];
}

/** 持有者出招伤害下限（dmgOutFloor flag；params.min 定额 / params.foeMaxPct 对手最大体力×pct% / params.selfMaxPct 自身最大体力×pct%——最大者胜）。 */
export function dmgOutFloorOf(u: UnitState, foe?: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (!isMod(e, "dmgOutFloor")) continue;
    if (e.params?.min !== undefined) v = Math.max(v, e.params.min);
    if (e.params?.foeMaxPct !== undefined && foe !== undefined) v = Math.max(v, Math.floor((foe.base.hp * e.params.foeMaxPct) / 100));
    if (e.params?.selfMaxPct !== undefined) v = Math.max(v, Math.floor((u.base.hp * e.params.selfMaxPct) / 100));
  }
  return v;
}

/** 持有者出招伤害上限（dmgOutCap flag；params.cap 最小者胜）。 */
export function dmgOutCapOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "dmgOutCap") && e.params?.cap !== undefined) v = v === 0 ? e.params.cap : Math.min(v, e.params.cap);
  }
  return v;
}

/** 持有者回复效果削减合计（healCut flag；params.pct 累加，上限 100）——heal/drain/回合末 hot 统一走这里。 */
export function healCutPctOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "healCut") && e.params?.pct !== undefined) v += e.params.pct;
  }
  return Math.min(100, v);
}

/** 持有者回复效果提升合计（healBoost flag；params.pct 累加）——"恢复比例提升至N%"魂印窗。 */
export function healBoostPctOf(u: UnitState, foe?: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (!isMod(e, "healBoost") || e.params?.pct === undefined) continue;
    if (!statusGateOk(e, u, foe)) continue;
    v += e.params.pct;
  }
  return v;
}

/** 持有者高伤免疫阈值（dmgImmuneAbove flag；params.max 最小者胜；无 → 0 表示未启用）。 */
export function dmgImmuneAboveOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "dmgImmuneAbove") && e.params?.max !== undefined) v = v === 0 ? e.params.max : Math.min(v, e.params.max);
  }
  return v;
}

/** 持有者威力倍率列表（powerMul flag；params{n,d,chance?}——chance 存在时逐击判定）。 */
export function powerMulFracsOf(u: UnitState): readonly (readonly [number, number, number | undefined])[] {
  const out: [number, number, number | undefined][] = [];
  for (const e of u.effects) {
    if (isMod(e, "powerMul") && e.params?.n !== undefined && e.params.d !== undefined) {
      out.push([e.params.n, e.params.d, e.params.chance]);
    }
  }
  return out;
}
/** 持有者固定/百分比承伤减免合计（flatTakenPct flag；params.pct 累加，上限 100）。 */
export function flatTakenPctOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "flatTakenPct") && e.params?.pct !== undefined) v += e.params.pct;
  }
  return Math.min(100, v);
}

/** 持有者先制技承伤减免合计（priTakenPct flag；params.pct 累加，上限 99）。 */
export function priTakenPctOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "priTakenPct") && e.params?.pct !== undefined) v += e.params.pct;
  }
  return Math.min(99, v);
}

/** 持有者百分比伤害承伤减免合计（pctTakenPct flag；params.pct 累加，上限 99——仅 percent 类型）。 */
export function pctTakenPctOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "pctTakenPct") && e.params?.pct !== undefined) v += e.params.pct;
  }
  return Math.min(99, v);
}

/** 持有者致命一击伤害提升合计（critDealtPct flag；params.pct 累加）。 */
export function critDealtPctOf(u: UnitState): number {
  let v = 0;
  for (const e of u.effects) {
    if (isMod(e, "critDealtPct") && e.params?.pct !== undefined) v += e.params.pct;
  }
  return v;
}

/** 承伤方致命易伤合计（critTakenPct flag；params{n,d}——n/d-1 折算 pct，连乘归并为单段）。 */
export function critTakenPctOf(u: UnitState): number {
  let n = 1; let d = 1;
  for (const e of u.effects) {
    if (isMod(e, "critTakenPct") && e.params?.n !== undefined && e.params.d !== undefined) { n *= e.params.n; d *= e.params.d; }
  }
  return d !== 0 && n > d ? Math.floor((n - d) * 100 / d) : 0;
}

/** 持有者锁强化窗口开启中（noStageUp flag——正 delta 无法落入）。 */
export const noStageUpOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "noStageUp"));

/** 持有者无视守方防御百分比（ignoreDef flag；params.pct 取最大 + 其条目引用供 count 消耗）。 */
export function ignoreDefOf(u: UnitState): { pct: number; fx: UnitState["effects"][number] } | undefined {
  let out: { pct: number; fx: UnitState["effects"][number] } | undefined;
  for (const e of u.effects) {
    if (!isMod(e, "ignoreDef") || e.params?.pct === undefined) continue;
    if (out === undefined || e.params.pct > out.pct) out = { pct: e.params.pct, fx: e };
  }
  return out;
}

/** 持有者无视守方伤害限制（pierceLimit flag）。 */
export const pierceLimitOn = (u: UnitState): boolean =>
  u.effects.some((e) => isMod(e, "pierce") && (((e.params?.scope as number | undefined) ?? 0) & 4) !== 0);
