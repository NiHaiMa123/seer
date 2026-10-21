/**
 * mechanics/index.ts —— 机制注册表（编译期静态组合，非运行时热插拔）。
 * 新机制：建 mechanics/<id>/ 目录实现 Mechanic 接口 + 在此追加一行。
 * 删除机制：删目录 + 删对应行。流水线各层（loader/engine/host/server）只认此表。
 *
 * 顺序语义：deriveBase 先取（定义面板基值），applyUnit 后跑（叠加/附加字段）——
 * sixstat 必须在 seals 之前注册（刻印叠加在六维推导面板之上）。
 */
import type { Mechanic, MechanicUnit, PackMechView } from "./types.ts";
import type { StageStatKey, StatSpread } from "../loader.ts";
import { sixstatMechanic } from "./sixstat/index.ts";
import { sealsMechanic } from "./seals/index.ts";
import { fifthMechanic } from "./fifth/index.ts";
import { soulmarkMechanic } from "./soulmark/index.ts";
import { itemsMechanic } from "./items/index.ts";
import { targetMechanic } from "./target/index.ts";

export const MECHANICS: readonly Mechanic[] = [sixstatMechanic, sealsMechanic, fifthMechanic, soulmarkMechanic, itemsMechanic, targetMechanic];

/** 面板推导：首个接管的机制胜出；无接管 → undefined（调用方回落原始 base）。 */
export const deriveBaseFor = (pack: PackMechView, unit: MechanicUnit): StatSpread | undefined => {
  for (const m of MECHANICS) {
    const b = m.deriveBase?.(pack, unit);
    if (b !== undefined) return b;
  }
  return undefined;
};

/** 参与 stage 增减的完整键集：核心三维 + 各机制贡献（如 six-stat 的 spa/sdf）。 */
export const stageKeysFor = (pack: PackMechView): StageStatKey[] => [
  "atk",
  "def",
  "spd",
  ...MECHANICS.flatMap((m) => m.stageKeys?.(pack) ?? []),
];

/** 招式槽列表：首个接管机制的返回值胜出（fifth：moveIds+fifthMoveId）；无接管 → moveIds。 */
export const moveSlotsFor = (pack: PackMechView, unit: MechanicUnit): readonly string[] => {
  for (const m of MECHANICS) {
    const r = m.moveSlots?.(pack, unit);
    if (r !== undefined) return r;
  }
  return unit.moveIds;
};

export type { Mechanic, MechanicCompileCtx, MechanicContribution, MechanicMove, MechanicUnit, PackMechView, ScaledDamageCtx, TurnEndCtx, UnitFieldProjection, UnitState } from "./types.ts";
