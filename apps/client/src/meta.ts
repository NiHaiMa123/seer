/**
 * meta.ts —— 内容元数据客户端缓存：/api/content/:packId。
 * 规则知识属公开信息（lookup_rule 同口径）——只取 badge 需要的最小字段。
 */

export interface MoveMeta { label: string; power: number; damageKind: string; ops: string[] }
export interface PackMeta { packId: string; moves: Record<string, MoveMeta>; units: Record<string, { speciesId: string; hp: number }> }

let cache: Promise<PackMeta> | null = null;

export function packIdOf(obs: any): string {
  return obs?.rules?.rulesetId ?? "synthetic-v1";
}

export function loadMeta(packId: string): Promise<PackMeta> {
  cache ??= fetch(`/api/content/${packId}`).then((r) => r.json() as Promise<PackMeta>);
  return cache;
}

const KIND_BADGE: Record<string, { tag: string; color: string }> = {
  standard: { tag: "STD", color: "#666" },
  fixed: { tag: "FIX", color: "#b080ff" },
  percent: { tag: "PCT", color: "#ffaa33" },
  true: { tag: "TRU", color: "#ff5555" },
};

export function moveBadge(meta: PackMeta | null, moveId: string): { tag: string; color: string; power: number } | null {
  const m = meta?.moves[moveId];
  if (!m || !m.ops.includes("damage")) return null;
  const b = KIND_BADGE[m.damageKind] ?? KIND_BADGE["standard"]!;
  return { ...b, power: m.power };
}
