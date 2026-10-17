/**
 * 致命判定例外。
 *
 * revive / endure 改的是「不要死」的返回值。普通 op 列表走到致命结算时已经晚了，
 * 所以这两条留在这里，不进 OPS。
 *
 * 这个文件只收致命判定，以及 endure 自带的那一次回合末快照恢复。
 * 不收回合末回血、回 PP、固伤。
 *
 * state_rewind 不在这里，也不再是 flag。语料里唯一一句是
 * 「残留 1 点血，同时回合末回到上回合结束时状态（每场一次）」——
 * 快照恢复就是 restoreSnapshot，由 endurePending 触发。
 */
import type { UnitState } from "../types.ts";

export interface FatalFlag {
  bossGate?: boolean;
  chance?: number;
}

export interface PrevSnapshot {
  hp: number;
  pp: Record<string, number>;
  stages: Record<string, number>;
}

/**
 * 是否留下体力。调用方负责写 endured / revived / endurePending 和事件。
 * 复活骰子仍是 drawBelow(100, "soul_revive")，只在 endure 没有先接住时掷，顺序与原先内联分支一致。
 */
export function decideFatal(args: {
  endured: boolean;
  revived: boolean;
  endure: FatalFlag | undefined;
  revive: FatalFlag | undefined;
  foeIsBoss: boolean;
  rng: { drawBelow(span: number, label: string): number } | undefined;
  maxHp: number;
  hpCap: number;
}): { hp: number; kind: "endure" | "revive" } | undefined {
  const { endure, revive, foeIsBoss } = args;
  if (!args.endured && endure !== undefined && !(endure.bossGate === true && foeIsBoss)) {
    return { hp: 1, kind: "endure" };
  }
  if (revive !== undefined && !args.revived && !(revive.bossGate === true && foeIsBoss)) {
    const chance = revive.chance ?? 100;
    if (chance >= 100 || (args.rng !== undefined && args.rng.drawBelow(100, "soul_revive") < chance)) {
      return { hp: Math.max(1, Math.min(args.hpCap, Math.floor(args.maxHp / 2))), kind: "revive" };
    }
  }
  return undefined;
}

/** 用上回合结束快照覆盖 HP / PP / 能力等级。快照里没有的等级回到 0。 */
export function restoreSnapshot(unit: UnitState, prev: PrevSnapshot): void {
  unit.currentHp = prev.hp;
  for (const mv of unit.moves) {
    if (prev.pp[mv.moveId] !== undefined) mv.pp = prev.pp[mv.moveId]!;
  }
  const stNow = unit.stages as Record<string, number>;
  for (const k of new Set([...Object.keys(stNow), ...Object.keys(prev.stages)])) {
    stNow[k] = prev.stages[k] ?? 0;
  }
}
