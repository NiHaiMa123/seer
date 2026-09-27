/**
 * map.ts —— 合成世界地图（自制——非原作地图）。
 * 节点 + 邻接边 + 每节点可用的结构化动作。
 * act 动作分两类：free（浏览/休息/forage）与 irreversible（buy/consume——进预算+策略门）。
 */
export interface WorldNode {
  id: string;
  label: string;
  actions: WorldAction[];
}

export interface WorldAction {
  id: string;
  desc: string;
  /** irreversible：消耗/购买类——受会话策略门控 */
  irreversible?: boolean;
  /** 执行效果规格（service 解释） */
  effect:
    | { kind: "gain"; item: string; qty: number }
    | { kind: "spend"; item: string; qty: number; gain: string; gainQty: number }
    | { kind: "challenge"; pack: string; bossTeam: string[] }
    | { kind: "rest" };
}

export const WORLD_MAP: WorldNode[] = [
  {
    id: "town", label: "始源镇",
    actions: [
      { id: "rest", desc: "休整（免费）", effect: { kind: "rest" } },
      { id: "buy-potion", desc: "1×item-shard 换 1×item-potion", irreversible: true, effect: { kind: "spend", item: "item-shard", qty: 1, gain: "item-potion", gainQty: 1 } },
      { id: "sell-orb", desc: "1×item-orb 换 3×item-shard", irreversible: true, effect: { kind: "spend", item: "item-orb", qty: 1, gain: "item-shard", gainQty: 3 } },
    ],
  },
  {
    id: "route-1", label: "一号路",
    actions: [{ id: "forage", desc: "采集（+1 item-shard）", effect: { kind: "gain", item: "item-shard", qty: 1 } }],
  },
  {
    id: "route-2", label: "二号路",
    actions: [{ id: "forage", desc: "采集（+1 item-shard）", effect: { kind: "gain", item: "item-shard", qty: 1 } }],
  },
  {
    id: "arena", label: "斗技场",
    actions: [{ id: "challenge", desc: "挑战守擂队", effect: { kind: "challenge", pack: "synthetic-v2", bossTeam: ["syn-epsilon", "syn-delta"] } }],
  },
  {
    id: "cave", label: "幽暗洞窟",
    actions: [{ id: "challenge", desc: "挑战洞窟 boss", effect: { kind: "challenge", pack: "synthetic-v2", bossTeam: ["syn-epsilon", "syn-gamma"] } }],
  },
];

export const WORLD_EDGES: [string, string][] = [
  ["town", "route-1"],
  ["route-1", "route-2"],
  ["route-2", "arena"],
  ["route-1", "cave"],
];

const nodeById = new Map(WORLD_MAP.map((n) => [n.id, n]));
const adjacency = new Map<string, string[]>();
for (const [a, b] of WORLD_EDGES) {
  adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
}

export function worldNode(id: string): WorldNode | undefined {
  return nodeById.get(id);
}

/** BFS 最短路径（含两端）；不可达返回 null。 */
export function pathTo(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
