/** 公开面板上的基础伤害估计。公式交给现有 scaledDamage 钩子，不识别机制 id。
 * 不运行魂印、道具或命中 rider；不读取对局隐藏态，也不消耗对局 RNG。
 */
import type { FrozenPack, StageStatKey, StatSpread } from "./loader.ts";
import { deriveBaseFor, MECHANICS } from "./mechanics/index.ts";
import type { UnitState } from "./mechanics/types.ts";
import { effectivenessOf } from "./ops/shared.ts";

interface EstimateUnit {
  speciesId: string;
  stats?: Partial<StatSpread>;
  stages?: Partial<Record<StageStatKey, number>>;
  level?: number;
  hpMax?: number;
}
export interface DamageEstimateInput {
  moveId: string;
  attacker: EstimateUnit;
  defender: EstimateUnit;
  defStage?: number;
  defOverride?: number;
}
export interface DamageEstimate {
  moveId: string;
  error?: string;
  assumedDef?: number;
  attackerAtk?: number;
  damages?: { kind: string; power: number; amount: number; amountMin?: number; amountMax?: number; eff16?: number; stab?: boolean }[];
}

const stage = (value: number, level: number): number =>
  Math.floor(value * (level >= 0 ? 2 + level : 2) / (level >= 0 ? 2 : 2 - level));

function panelUnit(pack: FrozenPack, input: EstimateUnit): UnitState {
  const species = pack.unitsById.get(input.speciesId);
  const derived = species === undefined ? undefined : deriveBaseFor(pack, { ...species, ...(input.level !== undefined ? { level: input.level } : {}) });
  const base = { hp: input.hpMax ?? 1, atk: 1, def: 1, spd: 1, ...(derived ?? species?.base), ...input.stats };
  return {
    unitId: input.speciesId, speciesId: input.speciesId, base, currentHp: base.hp,
    stages: { atk: 0, def: 0, spd: 0, ...input.stages },
    level: input.level ?? species?.level ?? 100,
    moves: [], revealedMoveIds: [], effects: [],
  };
}

export function estimateDamage(pack: FrozenPack, input: DamageEstimateInput): DamageEstimate {
  const move = pack.movesById.get(input.moveId);
  if (move === undefined) return { moveId: input.moveId, error: "unknown move" };
  const unit = panelUnit(pack, input.attacker);
  const foe = panelUnit(pack, input.defender);
  const atkKey = move.category === "special" ? "spa" : "atk";
  const defKey = move.category === "special" ? "sdf" : "def";
  if (input.defStage !== undefined) foe.stages[defKey] = input.defStage;
  if (input.defOverride !== undefined) {
    foe.base[defKey] = input.defOverride;
    foe.stages[defKey] = 0;
  }
  const assumedDef = stage(foe.base[defKey] ?? foe.base.def, foe.stages[defKey] ?? 0);
  const attackerAtk = stage(unit.base[atkKey] ?? unit.base.atk, unit.stages[atkKey] ?? 0);
  const ownSpecies = pack.unitsById.get(unit.speciesId);
  const foeSpecies = pack.unitsById.get(foe.speciesId);
  const eff16 = move.type !== undefined && pack.typeChart !== undefined && foeSpecies !== undefined
    ? effectivenessOf(pack.typeChart, move.type, foeSpecies.types ?? []) : undefined;
  const stab = move.type !== undefined && (ownSpecies?.types ?? []).includes(move.type);
  const damages = move.effects.filter((e) => e.op === "damage").map((fx) => {
    const kind = fx.kind ?? "standard";
    const power = fx.power ?? 0;
    if (kind === "fixed") return { kind, power, amount: power };
    if (kind === "percent") return { kind, power, amount: Math.floor(power * (input.defender.hpMax ?? foe.base.hp) / 100) };
    const evaluate = (max: boolean) => {
      for (const m of MECHANICS) {
        const out = m.scaledDamage?.({
          pack, unit, foe, move, power, kind, eff16, stab,
          rng: { drawBelow: (n) => max ? n - 1 : 0 },
        });
        if (out !== undefined) return out.dmg;
      }
      const base = Math.floor(power * attackerAtk / (2 * (kind === "true" ? foe.base[defKey] ?? foe.base.def : assumedDef)));
      return eff16 === undefined ? Math.max(1, base)
        : eff16 === 0 ? 0 : Math.max(1, Math.floor(base * eff16 / 16 * (stab ? pack.stabMultiplier : 1)));
    };
    const amountMin = evaluate(false), amountMax = evaluate(true);
    return { kind, power, amount: amountMax, amountMin, amountMax, ...(eff16 !== undefined ? { eff16, stab } : {}) };
  });
  return { moveId: input.moveId, assumedDef, attackerAtk, damages };
}
