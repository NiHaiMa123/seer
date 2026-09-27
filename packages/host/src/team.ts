/**
 * team.ts —— 队伍编辑语义：有序 species 列表 → {species, bench}。
 * 规则：[0] 首发；其余进 bench（≤limits.maxBenchSize）；species 必须在 pack；
 * pack 未开 bench feature 时 team 长必须为 1。
 * 不引入"队伍存档"——持久化属 world service（M4-03）。
 */
import type { FrozenPack } from "@seer/battle-core";

export class TeamError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function teamToConfig(
  pack: FrozenPack,
  team: readonly string[],
): { species: string; bench?: string[] } {
  if (team.length === 0) throw new TeamError("INVALID_SCHEMA", "team must have >=1 member");
  for (const id of team) {
    if (!pack.unitsById.has(id)) throw new TeamError("INVALID_SCHEMA", `unknown species ${id}`);
  }
  const bench = team.slice(1);
  if (bench.length > 0 && pack.limits.maxBenchSize === undefined) {
    throw new TeamError("INVALID_SCHEMA", "pack does not support bench (v1 ruleset)");
  }
  if (pack.limits.maxBenchSize !== undefined && bench.length > pack.limits.maxBenchSize) {
    throw new TeamError("INVALID_SCHEMA", `bench ${bench.length} exceeds maxBenchSize ${pack.limits.maxBenchSize}`);
  }
  return {
    species: team[0]!,
    ...(bench.length > 0 ? { bench } : {}),
  };
}
