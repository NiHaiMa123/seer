/**
 * mechanics/types.ts —— 机制模块契约（battle-core 层）。
 *
 * 设计意图：机制 = 目录即边界。流水线各层（loader/engine/host/server/client）
 * 只调用这里注册的钩子，不再内联机制代码。新增机制 = mechanics/<id>/ + 注册一行；
 * 删除 = 删目录 + 删注册行。
 *
 * 约定：
 * - doc 声明机制文档：packFile = pack.files.* 指向 pack 目录文件；
 *   rulesetFile = ruleset.* 指向 rulesets/ 目录文件。rawKey = 注入 raw 的键。
 * - initBattle opts.mechanics[id][side] = 每槽位数组（[0]=首发，[1+i]=bench[i]），
 *   元素 undefined = 该槽位回落 species 预设。
 * - pack.mechanics[id] = 该机制编译期贡献的数据；键存在 = 本包启用该机制。
 * - unitFieldClaims/moveFieldClaims 声明机制拥有的字段——模块被删除时，
 *   loader 对未认领字段直接拒载（防"机制没了但字段被静默忽略"）。
 * - 契约层 schema（state/observation/units/ruleset 的字段声明）保持单文件维护——
 *   线协议是一处合同，机制模块只拥有"逻辑与校验"，不拥有线格式。
 */
import type { CoreState, SideId } from "../types.ts";
import type { FeatureFlag, StageStatKey, StatSpread } from "../loader.ts";
import type { DeterministicRng } from "../rng.ts";

/** 机制钩子见到的单位形状（raw/compiled 同形：loader 用 CompiledUnit 跑校验）。 */
export interface MechanicUnit {
  id: string;
  name: string;
  moveIds: string[];
  base: { hp: number; atk: number; def: number; spd: number; spa?: number; sdf?: number };
  types?: string[];
  seals?: string[];
  soulMark?: string;
  fifthMoveId?: string;
  level?: number;
  ivs?: StatSpread;
  evs?: StatSpread;
  nature?: string;
}

/** 机制钩子见到的招式形状。 */
export interface MechanicMove {
  id: string;
  effects: readonly { op: string; kind?: string }[];
  type?: string;
  category?: "physical" | "special";
  fifth?: boolean;
  accuracy?: number | "always";
}

/** 内部运行时单位对象（state.sides.*.unit / bench[i] 同形）。 */
export type UnitState = CoreState["sides"]["p1"]["unit"];

/** 编译期钩子上下文：raw=注入的全部文档包。 */
export interface MechanicCompileCtx {
  raw: Record<string, unknown>;
  ruleset: Record<string, unknown>;
  fail(message: string): never;
}

export interface MechanicContribution {
  /** 存入 pack.mechanics[id] 的数据（校验后编进 FrozenPack）。 */
  data: unknown;
  /** contentHash 附加字段（如 { sealsSha256 }）；未声明文档则不给。 */
  hashExtra?: Record<string, string>;
  /** rulesetHash 附加字段（ruleset 级文档，如 { naturesSha256 }）。 */
  rulesetHashExtra?: Record<string, string>;
}

/**
 * 单位投影字段拷贝器：get 返回 undefined → 键省略（保持 exactOptional 语义）。
 * into "own" = 己方单位+己方 bench 公开；"both" = 对手单位也公开（慎用——隐私边界）。
 */
export interface UnitFieldProjection {
  key: string;
  into: "own" | "both";
  get(u: UnitState): unknown;
}

/** 机制免疫/触发反馈的引用形状（事件类型归机制所有——引擎不品牌写死）。 */
export interface MarkRef {
  /** 公开事件类型（须已在契约事件白名单/schema 中声明——见 Mechanic.eventFields）。 */
  type: string;
  mark: string;
  name: string;
}

/** TURN_END 钩子上下文。 */
export interface TurnEndCtx {
  pack: PackMechView;
  next: CoreState;
  events: { type: string; detail: Record<string, unknown>; rngDraw?: { purpose: string; value: number } }[];
  side: SideId;
  /** 完整确定性 RNG（applyOp 需要 rng.next 供 turnsRange 等区间判定）；回合外钩子点务必穿线。 */
  rng: DeterministicRng;
  /**
   * 回合末伤害通道：扣血 + damage 事件 + checkpoint。
   * 结果写回 ctx.outcome：引擎在全部钩子结束后据此写 suspension / 终结。
   */
  hurt(target: SideId, amount: number, cause: string): void;
  /** 钩子产出：首个非 continue 结果（"terminal" 或 suspend 的 SideId）；调用方先置 undefined。 */
  outcome: "terminal" | SideId | undefined;
  /** 本回合先行动方——onTurnEnd 语境下 {order:"first"|"last"} 守卫的真实序位判据（未传时退化 "first"）。 */
  firstSide?: SideId;
}

/** KO 观察钩子上下文：deadSide=倒下侧；side=观察者侧（死方与对手方各派发一次）。 */
export interface KoCtx extends TurnEndCtx {
  deadSide: SideId;
}

/** 换下观察钩子上下文：switchSide=换下方；side=观察者侧（"对手换下时"需双侧派发）。 */
export interface SwitchOutCtx extends TurnEndCtx {
  switchSide: SideId;
}

/** 招式结算后钩子上下文：actorSide=行动方；cat=招式类别编码（1=属性 2=物理 3=特殊，同 nullify 编码）；order=行动方本回合先后手。 */
export interface MoveUsedCtx extends TurnEndCtx {
  actorSide: SideId;
  move: MechanicMove;
  cat: number;
  order: "first" | "last";
}

/** ORDER 随机先制钩子上下文（排序求值时调用；每侧至多一次——引擎 memoize 防重复消耗 rng）。 */
export interface OrderRollCtx {
  pack: PackMechView;
  next: CoreState;
  events: { type: string; detail: Record<string, unknown> }[];
  side: SideId;
  unit: UnitState;
  move: MechanicMove;
  foe: UnitState;
  rng: DeterministicRng;
}

/** standard/true 缩放伤害的钩子上下文（eff16/stab 由引擎统一预算，公式只管变体）。 */
export interface ScaledDamageCtx {
  pack: PackMechView;
  unit: UnitState;
  foe: UnitState;
  move: MechanicMove;
  power: number;
  kind: "standard" | "true";
  /** 克制倍率 ×16 定点（招式有属性且包有克制表时给出）；undefined = 不吃克制。 */
  eff16: number | undefined;
  stab: boolean;
  /** 致命一击（由 damage op 判定后传入）：×2 伤害且无视攻方负级/守方正级（UNVERIFIED 待取证细节）。 */
  crit?: boolean;
  rng: { drawBelow(n: number, purpose: string): number };
}

export interface Mechanic {
  id: string;
  /** 机制文档声明：rawKey=注入键；packFile=pack.files.* 键；rulesetFile=ruleset.* 键（文件在 rulesets/）。 */
  doc?: { rawKey: string; packFile?: string; rulesetFile?: string };
  /** 机制拥有的 unit 顶层字段（"base.spa" 形式可认领 base 子键）。 */
  unitFieldClaims?: readonly string[];
  /** 机制拥有的 move 顶层字段。 */
  moveFieldClaims?: readonly string[];
  /** 编译期：校验文档并返回贡献；undefined = 本 pack 不启用。自行读取 raw/声明位。 */
  compile?(ctx: MechanicCompileCtx): MechanicContribution | undefined;
  /** 单位声明校验（loader 期 unit 循环）：返回错误描述或 null。 */
  checkUnit?(unit: MechanicUnit, pack: PackMechView): string | null;
  /** 单位编译附加字段（如 {level,ivs,evs} 默认值注入 / {seals:[...]} 并入 CompiledUnit）。 */
  unitFields?(unit: MechanicUnit, pack: PackMechView): Record<string, unknown> | undefined;
  /** 招式声明校验（loader 期 move 循环）：返回错误描述或 null。 */
  checkMove?(move: MechanicMove, pack: PackMechView): string | null;
  /** move 编译附加字段（如 {fifth:true} 并入 CompiledMove）。 */
  moveFields?(move: MechanicMove, pack: PackMechView): Record<string, unknown> | undefined;
  /** 声明"unit 字段=moveId 引用"：loader 代为做存在性检查，随后调 checkUnitMoveRef。 */
  moveRefFields?: readonly string[];
  /** moveRefFields 引用的语义校验（如 fifthMoveId 必须指向 fifth:true 招式）。 */
  checkUnitMoveRef?(unit: MechanicUnit, field: string, move: MechanicMove): string | null;
  /** unit.moveIds 成员的机制校验（如禁止 fifth:true 招式混入普通槽）。 */
  checkUnitMove?(unit: MechanicUnit, moveId: string, move: MechanicMove): string | null;
  /** initBattle：opts.mechanics[id][side] 槽位数组校验（抛 EngineFault）。 */
  checkInitSlots?(arr: unknown[], side: SideId, unitCount: number): void;
  /** 面板推导：返回推导后的 StatSpread；undefined = 不接管（回落原始 base）。 */
  deriveBase?(pack: PackMechView, unit: MechanicUnit): StatSpread | undefined;
  /** 参与 stage 增减的附加 stat 键（如 six-stat 贡献 spa/sdf）；按包启用与否返回。 */
  stageKeys?(pack: PackMechView): readonly StageStatKey[];
  /**
   * mkUnit 加工：对本单位应用机制效果（面板叠加/附加状态字段）。
   * slotInit = 该单位槽位的初始化数据（机制自定义形状，seals=string[]），undefined=回落预设。
   * 返回并入 unit 状态的字段；undefined = 无附加字段。
   */
  applyUnit?(pack: PackMechView, unit: MechanicUnit, slotInit: unknown, base: StatSpread): Record<string, unknown> | undefined;
  /**
   * standard/true 缩放伤害公式接管：返回 {dmg, roll?}（roll → 引擎发 rng-draw 事件）；
   * 全部钩子返回 undefined → legacy v1 公式（字节级不变）。
   */
  scaledDamage?(ctx: ScaledDamageCtx): { dmg: number; roll?: number } | undefined;
  /** 招式槽列表接管：返回该单位完整 moveId 列表（fifth：moveIds+fifthMoveId）。首个非 undefined 生效。 */
  moveSlots?(pack: PackMechView, unit: MechanicUnit): string[] | undefined;
  /**
   * mkUnit 前改写普通技能槽。slotInit 为该槽位的机制初始化数据；
   * undefined = 不改（沿用物种 moveIds）。返回值不含第五技能。非法携带抛 EngineFault。
   */
  carriedMoveIds?(pack: PackMechView, unit: MechanicUnit, slotInit: unknown): readonly string[] | undefined;
  /** ORDER：行动优先值加算（魂印必先手等）。仅当动作为 move 时调用；返回增量。 */
  priorityBoost?(ctx: { pack: PackMechView; unit: UnitState; foe: UnitState }): number;
  /** 控制免疫判定（control 施加时）：返回魂印引用=免疫。 */
  controlImmune?(ctx: { pack: PackMechView; unit: UnitState }): MarkRef | undefined;
  /** 能力下降免疫（apply_stat_stage 负 delta 作用于该单位时）。 */
  stageDropImmune?(ctx: { pack: PackMechView; unit: UnitState }): MarkRef | undefined;
  /** TURN_START（排序后、首个行动执行前）：回合开始结算（魂印"每回合开始时"族）。 */
  onTurnStart?(ctx: TurnEndCtx): void;
  /**
   * ORDER 之前（applyTurn 排序求值前）：首发单位的登场补偿——"登场速度+1级"/
   * "登场先制"类必须赶上本回合先后手排序。实现必须按"单位首次在场"幂等
   * （换入单位已走 entrySettle/onEntry，重复调用是 no-op）。每回合每侧各调一次。
   */
  preOrder?(ctx: TurnEndCtx): void;
  /**
   * KO 观察（checkpoint 内 ko 事件后、终局/挂起判定前）：deadSide=倒下侧。
   * 死方与对手方各派发一次——"自身倒下时" vs "击败对手时"语义由机制按 side/deadSide 判定。
   * 嵌套 KO（钩子产伤再致死）经内部去重，同一 (state,side) 只观察一次。
   */
  onKO?(ctx: KoCtx): void;
  /** 换下（doSwitch 内、swap 前）：outcome 非空=换下被致命结算中断（不换）。 */
  onSwitchOut?(ctx: SwitchOutCtx): void;
  /** 招式完整结算后（行动方 op 全部跑完且未中断）：魂印"使用技能时"族。 */
  onMoveUsed?(ctx: MoveUsedCtx): void;
  /**
   * 命中已确认、招式 op 开跑前：类别连用的出伤窗（伤害提升/必暴）必须赶在本击之前挂上。
   * 只派给行动方。未命中不调用。
   */
  beforeHit?(ctx: MoveUsedCtx): void;
  /** ORDER 随机先制（排序求值、消耗 rng）：返回先制增量；与 priorityBoost 加算。 */
  orderRoll?(ctx: OrderRollCtx): number;
  /** 成功换入后（doSwitch）：登场效果（消除对手回合类效果等；generic op 可产伤 → outcome）。 */
  onEntry?(ctx: TurnEndCtx): void;
  /** TURN_END（效果递减后）：回血/固伤/PP回复/回卷等。 */
  onTurnEnd?(ctx: TurnEndCtx): void;
  /**
   * 致命判定（checkpoint 内，revive 判定之前）：返回 {hp, event} → 单位以该 HP 存活；
   * 引擎注入 side 字段后推入事件流。全部钩子 undefined → 正常 KO 流程。
   */
  onFatalDamage?(ctx: { pack: PackMechView; unit: UnitState; rng?: DeterministicRng; foe?: UnitState }): { hp: number; event: { type: string; detail: Record<string, unknown> } } | undefined;
  /** 伤害护盾（扣血前）：返回事件=本实例伤害免疫且护盾被消耗；引擎注入 side 并跳过伤害。 */
  absorbDamage?(ctx: { pack: PackMechView; unit: UnitState }): { type: string; detail: Record<string, unknown> } | undefined;
  /** 受击后（伤害已结算且存活）：获得护盾等后结算效果；generic op 可产伤 → outcome。 */
  onDamaged?(ctx: TurnEndCtx & { amount: number }): void;
  /**
   * 造成伤害后（攻击方视角，逐击派发）：amount=该击实际伤害，crit/cat/move 为该击属性。
   * 魂印"攻击命中后X"/"造成伤害大于N则X"/"打出致命一击时X"族；generic op 可产伤 → outcome。
   */
  onDamageDealt?(ctx: TurnEndCtx & { amount: number; crit?: boolean; cat?: number; move?: MechanicMove }): void;
  /** 招式 MISS：missSide=落空方；双侧各派发一次，条目 who 守卫（self=自身落空/foe=对手落空，缺省 foe）。 */
  onMiss?(ctx: TurnEndCtx & { missSide: SideId; move?: MechanicMove }): void;
  /** 投影字段贡献（挂在单位对象上）。 */
  projections?: UnitFieldProjection[];
  /**
   * 机制自有公开事件类型的字段白名单：event type → detail 允许公开的字段。
   * host 的事件投影把它并入公开白名单——机制删了，事件类型即离线（仍须在事件 schema 声明）。
   */
  eventFields?: Record<string, readonly string[]>;
  /** content 端点片段：机制贡献的公开内容知识（如刻印目录+佩戴规则）。 */
  meta?(pack: PackMechView): Record<string, unknown> | undefined;
  /** 开局：给双方写机制自己的状态（如消耗品持有次数）。不写 = 无附加字段。 */
  onBattleStart?(pack: PackMechView, state: CoreState): void;
  /** 认领 actionId。返回 {kind:"mech"} 后引擎不再把它当招式。 */
  parseAction?(actionId: string): { kind: "mech"; actionId: string } | undefined;
  /** 非招式动作的排序优先。未认领返回 undefined。道具用 0，和普通招式按速度比。 */
  actionPriority?(actionId: string): number | undefined;
  /** 额外合法 actionId。替换决策（阵亡替补）期间引擎不调用。 */
  extraLegal?(pack: PackMechView, state: CoreState, side: SideId): string[];
  /**
   * 执行已认领的动作：扣自己的状态，返回要由引擎 applyOp 的效果列表。
   * undefined = 不认领（或次数已空）。空数组 = 认领但没有效果。
   */
  planAction?(ctx: {
    pack: PackMechView & { modeOverlays?: ReadonlyMap<string, { immuneClearStages?: boolean }> };
    state: CoreState;
    side: SideId;
    actionId: string;
  }): readonly Record<string, unknown>[] | undefined;
  /** 合法动作的公开投影。undefined = 不认领。机制卸掉后这条 actionId 不再被投影。 */
  projectLegal?(actionId: string): { action: { kind: string; [k: string]: unknown }; label: string } | undefined;
}

/** 机制钩子能见到的最小 pack 视图（loader 编译期 pack 尚未冻结完成）。 */
export interface PackMechView {
  rules: { rulesetId: string };
  mechanics?: Record<string, unknown>;
  /** scaledDamage 钩子需要（STAB 倍率）；运行时由 FrozenPack 提供。 */
  stabMultiplier?: number;
  /** 运行时可用（engine/applyUnit 传 FrozenPack）；loader 编译期不存在。 */
  movesById?: ReadonlyMap<string, { pp: number; fifth?: boolean }>;
  /** ruleset 特性集（loader 编译期即存在；accuracy 等特性门控的 stage 维度据此展开）。 */
  features?: ReadonlySet<FeatureFlag>;
}
