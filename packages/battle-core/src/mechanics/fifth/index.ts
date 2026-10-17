/**
 * fifth 机制：赛尔号"第五技能"。
 * - 单位字段 fifthMoveId：独立于 moveIds 的第 5 招式槽，仍走普通出招/PP 管线；
 * - 招式字段 fifth:true：编译进 CompiledMove，UI 用专属视觉标识；
 * - 规则：fifthMoveId 必须指向 fifth:true 招式；fifth:true 招式不允许混入 moveIds；
 *   单位最多一个第五技能。启用门 = ruleset.features 含 "fifth"。
 */
import { EngineFault, type SideId } from "../../types.ts";
import type { Mechanic, MechanicMove, MechanicUnit, PackMechView } from "../types.ts";

const enabled = (p: PackMechView): boolean => (p.mechanics?.fifth as { enabled?: boolean } | undefined)?.enabled === true;

export const fifthMechanic: Mechanic = {
  id: "fifth",
  unitFieldClaims: ["fifthMoveId"],
  moveFieldClaims: ["fifth"],
  moveRefFields: ["fifthMoveId"],

  compile({ ruleset }) {
    const feats = (ruleset.features as readonly string[] | undefined) ?? [];
    return feats.includes("fifth") ? { data: { enabled: true } } : undefined;
  },

  checkMove(m, pack) {
    if (m.fifth === true) {
      if (!enabled(pack)) return 'move.fifth requires ruleset feature "fifth"';
      if (!m.effects.some((e) => e.op === "damage")) return "fifth move must contain a damage effect (第五技能须为攻击技能)";
    }
    return null;
  },

  checkUnit(u, pack) {
    if (u.fifthMoveId !== undefined && !enabled(pack))
      return 'unit.fifthMoveId requires ruleset feature "fifth"';
    if (u.fifthMoveId !== undefined && u.moveIds !== undefined && (u.moveIds as string[]).includes(u.fifthMoveId))
      return "fifthMoveId must not duplicate a moveIds entry";
    return null;
  },

  checkUnitMoveRef(_u, field, move) {
    if (field === "fifthMoveId" && move.fifth !== true) return `fifthMoveId "${move.id}" must reference a fifth:true move`;
    return null;
  },

  checkUnitMove(_u, _mid, move) {
    if (move.fifth === true) return `fifth move "${move.id}" must be assigned via fifthMoveId, not moveIds`;
    return null;
  },

  moveFields(m) {
    return m.fifth === true ? { fifth: true } : undefined;
  },

  unitFields(u) {
    return u.fifthMoveId !== undefined ? { fifthMoveId: u.fifthMoveId } : undefined;
  },

  moveSlots(pack, unit) {
    if (!enabled(pack) || unit.fifthMoveId === undefined) return undefined;
    return [...(unit.moveIds as string[]), unit.fifthMoveId];
  },

  /** 槽位数据 = 带进战斗的普通技能 id（最多 4，且必须是物种 moveIds 里的非第五技能）。 */
  checkInitSlots(arr, side: SideId, unitCount) {
    if (arr.length > unitCount) {
      throw new EngineFault("FIFTH_RULE", `fifth loadout ${arr.length} slots > unit count ${unitCount} on ${side}`);
    }
    for (const slot of arr) {
      if (slot === undefined || slot === null) continue;
      if (!Array.isArray(slot) || slot.length > 4 || slot.some((id) => typeof id !== "string" || id.length === 0)) {
        throw new EngineFault("FIFTH_RULE", `fifth loadout slot must be <=4 move ids on ${side}`);
      }
    }
  },

  carriedMoveIds(pack, unit, slotInit) {
    if (slotInit === undefined || slotInit === null) return undefined;
    if (!enabled(pack)) throw new EngineFault("FIFTH_RULE", `carried moves require ruleset feature "fifth" (unit ${unit.id})`);
    if (!Array.isArray(slotInit) || slotInit.length > 4) {
      throw new EngineFault("FIFTH_RULE", `unit ${unit.id} carried moves must be <=4`);
    }
    const learned = new Set(unit.moveIds);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of slotInit) {
      if (typeof id !== "string" || !learned.has(id)) {
        throw new EngineFault("FIFTH_RULE", `unit ${unit.id} move "${String(id)}" is not a normal move`);
      }
      if (seen.has(id)) throw new EngineFault("FIFTH_RULE", `unit ${unit.id} carried move "${id}" duplicated`);
      seen.add(id);
      out.push(id);
    }
    return out;
  },
};
