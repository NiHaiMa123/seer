export { DeterministicRng } from "./rng.ts";
export type { RngDraw } from "./rng.ts";
export { sha256hex } from "./sha256.ts";
export {
  compilePack,
  loadPackFromDir,
  PackLoadError,
  ENGINE_VERSION,
  ENGINE_EXECUTABLE_HASH,
  IR_VERSION,
} from "./loader.ts";
export type { CompiledEffect, CompiledMove, CompiledUnit, FrozenPack, StatKey, StageStatKey, StatSpread } from "./loader.ts";
export { MECHANICS, deriveBaseFor, stageKeysFor } from "./mechanics/index.ts";
export type { Mechanic, MechanicCompileCtx, MechanicContribution, MechanicMove, MechanicUnit, PackMechView, ScaledDamageCtx, UnitFieldProjection, UnitState } from "./mechanics/index.ts";
export { estimateDamage } from "./estimate.ts";
export type { DamageEstimateInput, DamageEstimate } from "./estimate.ts";
export type { NumericValue } from "./ops/value.ts";
export { applyReplacement, applyTurn, defaultAction, defaultReplacement, effectivenessOf, initBattle, legalActions } from "./engine.ts";
export {
  EngineFault,
  OTHER,
  CORE_EVENT_TYPES,
} from "./types.ts";
export type { CoreAction, CoreEvent, CoreEventType, CoreResult, CoreState, SideId } from "./types.ts";
