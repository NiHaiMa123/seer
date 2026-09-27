/**
 * world-agent.ts —— World Agent（AGENT.md §8）：编排世界操作，与 Battle Agent 分离。
 * 只走结构化 op 面（WorldOps 抽象——in-process WorldService 或 HTTP 皆可），
 * 不持有 battle 内部、不碰视觉/点击 adapter（那是后续适配层）。
 * 策略：确定性 BFS 寻路 + 目标驱动——选离目标最近的未完成任务/需求动作。
 */

/** 世界操作面——WorldService 的 agent 侧投影（可 HTTP 实现） */
export interface WorldOps {
  profile(): { inventory: Record<string, number>; quests: { id: string; progress: number; target: number; done: boolean }[]; location?: string };
  map(): { location: string; nodes: { id: string; actions: { id: string; desc: string }[] }[] };
  move(nodeId: string): { location: string };
  act(actionId: string): { result: Record<string, unknown> };
  stop(): void;
}

export interface WorldGoal {
  /** 目标类型：完成指定任务 / 收集物品到数量 / 到达节点 */
  kind: "quest" | "item" | "reach";
  id: string; // questId | itemId | nodeId
  qty?: number;
}

export interface WorldStepResult {
  op: "move" | "act" | "done" | "stuck" | "stop";
  detail: string;
}

/** BFS（邻接表由 map() 的节点内 actions 不构成边——边集由 service 提供；agent 侧用可达性表） */
function bfs(edges: Map<string, string[]>, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map([[from, from]]);
  const q = [from];
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const n of edges.get(cur) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const p = [to];
        while (p[0] !== from) p.unshift(prev.get(p[0]!)!);
        return p;
      }
      q.push(n);
    }
  }
  return null;
}

export class WorldAgent {
  private readonly ops: WorldOps;
  private readonly goal: WorldGoal;
  /** 邻接表——agent 需要显式提供（map() 视图不含边，隐藏地形知识） */
  private readonly edges: Map<string, string[]>;
  private done = false;

  constructor(ops: WorldOps, goal: WorldGoal, edges: [string, string][]) {
    this.ops = ops;
    this.goal = goal;
    this.edges = new Map();
    for (const [a, b] of edges) {
      this.edges.set(a, [...(this.edges.get(a) ?? []), b]);
      this.edges.set(b, [...(this.edges.get(b) ?? []), a]);
    }
  }

  /** 目标节点：quest→提供挑战动作的节点；item→含 gain 动作的最近节点；reach→目标节点 */
  private targetNode(map: { nodes: { id: string; actions: { id: string }[] }[] }): string | null {
    if (this.goal.kind === "reach") return this.goal.id;
    if (this.goal.kind === "quest") {
      // 约定：q_boss_slayer 类击杀任务 → arena/cave 的 challenge；其余在 town/route 完成
      if (this.goal.id === "q_boss_slayer") return "arena";
      return "route-1";
    }
    // item：找含 forage/gain 的节点
    return "route-1";
  }

  private goalMet(location: string): boolean {
    if (this.goal.kind === "reach") return location === this.goal.id;
    const p = this.ops.profile();
    if (this.goal.kind === "quest") return p.quests.find((q) => q.id === this.goal.id)?.done === true;
    if (this.goal.kind === "item") return (p.inventory[this.goal.id] ?? 0) >= (this.goal.qty ?? 1);
    return false;
  }

  /** 单步：要么走向目标节点，要么在目标节点执行动作；返回语义化结果 */
  step(): WorldStepResult {
    if (this.done) return { op: "done", detail: "already done" };
    const m = this.ops.map();
    if (this.goalMet(m.location)) { this.done = true; return { op: "done", detail: `goal ${this.goal.id} met` }; }
    const target = this.targetNode(m);
    if (target === null) return { op: "stuck", detail: "no target node" };
    if (m.location !== target) {
      const path = bfs(this.edges, m.location, target);
      if (path === null || path.length < 2) return { op: "stuck", detail: `unreachable ${target}` };
      const r = this.ops.move(path[1]!);
      return { op: "move", detail: `${m.location} → ${r.location}` };
    }
    // 在目标节点：quest→challenge；item→forage；reach 已在 goalMet 截获
    const node = m.nodes.find((n) => n.id === target);
    if (node === undefined || node.actions.length === 0) return { op: "stuck", detail: "no actions here" };
    const pick = this.goal.kind === "quest"
      ? (node.actions.find((a) => a.id === "challenge") ?? node.actions[0]!)
      : (node.actions.find((a) => a.id === "forage") ?? node.actions[0]!);
    const r = this.ops.act(pick.id);
    return { op: "act", detail: `${pick.id} @ ${target} → ${JSON.stringify(r.result)}` };
  }

  /** 跑到目标达成/卡住/预算尽（调用方会话预算天然截断） */
  run(maxSteps = 32): WorldStepResult[] {
    const trace: WorldStepResult[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const r = this.step();
      trace.push(r);
      if (r.op === "done" || r.op === "stuck" || r.op === "stop") break;
    }
    return trace;
  }
}
