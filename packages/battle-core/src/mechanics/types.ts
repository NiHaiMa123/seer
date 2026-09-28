/**
 * mechanics/types.ts —— 机制模块契约（battle-core 层）。
 *
 * 设计意图：机制 = 目录即边界。流水线各层（loader/engine/host/server/client）
 * 只调用这里注册的钩子，不再内联机制代码。新增机制 = mechanics/<id>/ + 注册一行；
 * 删除 = 删目录 + 删注册行。
 *
 * 约定：
 * - pack.files.<packFileKey> 声明机制文档；raw[packFileKey] 注入文档。
 * - initBattle opts.mechanics[id][side] = 每槽位数组（[0]=首发，[1+i]=bench[i]），
 *   元素 undefined = 该槽位回落 species 预设。
 * - pack.mechanics[id] = 该机制编译期贡献的数据（本包未启用则键不存在）。
 * - 契约层 schema（state/observation/units/ruleset 的字段声明）保持单文件维护——
 *   线协议是一处合同，机制模块只拥有"逻辑与校验"，不拥有线格式。
 */
import type { CoreState, SideId } from "../types.ts";
import type { StatSpread } from "../loader.ts";

/** 机制钩子见到的单位形状（raw/compiled 同形：loader 用 CompiledUnit 跑校验）。 */
export interface MechanicUnit {
  id: string;
  name: string;
  seals?: string[];
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

export interface Mechanic {
  id: string;
  /** pack.files.* 中该机制的文档键（doc 键 == packFileKey == id，约定）。 */
  packFileKey?: string;
  /** 编译期：校验文档并返回贡献；undefined = 本 pack 不启用。自行读取 raw/声明位。 */
  compile?(ctx: MechanicCompileCtx): MechanicContribution | undefined;
  /** 单位声明校验（loader 期 unit 循环）：返回错误描述或 null。 */
  checkUnit?(unit: MechanicUnit, pack: PackMechView): string | null;
  /** 单位编译附加字段（如 {seals: [...]} 并入 CompiledUnit）。 */
  unitFields?(unit: MechanicUnit): Record<string, unknown> | undefined;
  /** initBattle：opts.mechanics[id][side] 槽位数组校验（抛 EngineFault）。 */
  checkInitSlots?(arr: unknown[], side: SideId, unitCount: number): void;
  /**
   * mkUnit 加工：对本单位应用机制效果（面板/附加状态字段）。
   * slotInit = 该单位槽位的初始化数据（机制自定义形状，seals=string[]），undefined=回落预设。
   * 返回并入 unit 状态的字段；undefined = 无附加字段。
   */
  applyUnit?(pack: PackMechView, unit: MechanicUnit, slotInit: unknown, base: StatSpread): Record<string, unknown> | undefined;
  /** 投影字段贡献（挂在单位对象上）。 */
  projections?: UnitFieldProjection[];
  /** content 端点片段：机制贡献的公开内容知识（如刻印目录+佩戴规则）。 */
  meta?(pack: PackMechView): Record<string, unknown> | undefined;
}

/** 机制钩子能见到的最小 pack 视图（loader 编译期 pack 尚未冻结完成）。 */
export interface PackMechView {
  rules: { rulesetId: string };
  mechanics?: Record<string, unknown>;
}
