/**
 * mechanics/index.ts —— 机制注册表（编译期静态组合，非运行时热插拔）。
 * 新机制：建 mechanics/<id>/ 目录实现 Mechanic 接口 + 在此追加一行。
 * 删除机制：删目录 + 删对应行。流水线各层（loader/engine/host/server）只认此表。
 */
import type { Mechanic } from "./types.ts";
import { sealsMechanic } from "./seals/index.ts";

export const MECHANICS: readonly Mechanic[] = [sealsMechanic];

export type { Mechanic, MechanicCompileCtx, MechanicContribution, PackMechView, UnitFieldProjection, UnitState } from "./types.ts";
export { sealsMechanic, sealsOf, checkSealLoadout } from "./seals/index.ts";
export type { CompiledSeal, SealPackData, SealRules } from "./seals/index.ts";
