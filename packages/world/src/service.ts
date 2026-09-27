/**
 * WorldService —— 世界域业务面：profile / team / inventory / quest / reward。
 * 奖励 entitlement 由战局终局确定（battleId+resultRevision+recipient 唯一键）：
 *   - claimReward 在单事务里写 outbox + 入账——崩溃安全、重复幂等；
 *   - 败方也得参与奖（合成奖励表），奖励内容由 battle 终局决定，不由调用方指定。
 */
import { randomBytes } from "node:crypto";
import type { WorldStore, RewardRow, SessionRow } from "./store.ts";
import { WORLD_MAP, worldNode, pathTo, type WorldNode } from "./map.ts";

export interface BattleOutcomeLike {
  battleId: string;
  terminal: { result: "p1" | "p2" | "draw"; reason: string };
  revision: number;
  /** side → 世界 playerId（建局时登记） */
  owners: { p1?: string; p2?: string };
  /** boss 战标记（opponent mode=boss → 杀 boss 任务进度） */
  opponentSpecies?: { p1?: string; p2?: string };
}

/** 合成奖励表（自制——非原作数值） */
const WIN_ITEMS: Record<string, number> = { "item-orb": 1 };
const LOSE_ITEMS: Record<string, number> = { "item-shard": 1 };
const DRAW_ITEMS: Record<string, number> = { "item-shard": 1 };

export interface QuestDef {
  id: string;
  desc: string;
  target: number;
  reward: Record<string, number>;
  /** 由战果推进进度的条件 */
  progressOn(outcome: BattleOutcomeLike, side: "p1" | "p2", won: boolean): number;
}

export const QUESTS: QuestDef[] = [
  {
    id: "q_first_win", desc: "赢得 1 场对战", target: 1, reward: { "item-orb": 1 },
    progressOn: (_o, _s, won) => (won ? 1 : 0),
  },
  {
    id: "q_winner_3", desc: "赢得 3 场对战", target: 3, reward: { "item-orb": 3 },
    progressOn: (_o, _s, won) => (won ? 1 : 0),
  },
  {
    id: "q_boss_slayer", desc: "击败 syn-epsilon boss", target: 1, reward: { "item-badge": 1 },
    progressOn: (o, s, won) => (won && o.opponentSpecies?.[s === "p1" ? "p2" : "p1"] === "syn-epsilon" ? 1 : 0),
  },
];

export class WorldError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export class WorldService {
  private readonly store: WorldStore;
  constructor(store: WorldStore) { this.store = store; }

  // ---- 世界探索：会话预算 + 结构化 op（AGENT.md §8） ----

  /** 开会话：ops=操作预算上限，allowIrreversible=不可逆道具策略开关 */
  openSession(playerId: string, opts: { ops: number; allowIrreversible?: boolean }): SessionRow {
    this.store.ensurePlayer(playerId, playerId);
    const s = { sessionId: `ses_${randomBytes(8).toString("hex")}`, playerId, opsLeft: Math.max(1, Math.min(500, opts.ops)), irreversible: opts.allowIrreversible === true };
    this.store.createSession(s);
    return { ...s, stopped: false };
  }

  session(sessionId: string): SessionRow {
    const s = this.store.getSession(sessionId);
    if (s === null) throw new WorldError("NOT_FOUND", "session");
    return s;
  }

  stopSession(sessionId: string): void {
    this.session(sessionId);
    this.store.stopSession(sessionId);
  }

  /** 地图视图：当前位置 + 每节点动作（读操作不计预算） */
  map(playerId: string): { location: string; nodes: WorldNode[] } {
    return { location: this.store.getLocation(playerId), nodes: WORLD_MAP };
  }

  private spendGuard(sessionId: string, op: string): SessionRow {
    const s = this.session(sessionId);
    if (s.stopped) throw new WorldError("SESSION_STOPPED", "session stopped");
    if (this.store.spendOp(sessionId) < 0) throw new WorldError("BUDGET_EXHAUSTED", `op ${op} over budget`);
    return s;
  }

  /** move：邻接边校验（1 op）；不可达/未知节点拒绝且不计预算 */
  move(sessionId: string, nodeId: string): { location: string; opsLeft: number } {
    if (worldNode(nodeId) === undefined) throw new WorldError("INVALID_SCHEMA", `unknown node ${nodeId}`);
    const s = this.session(sessionId);
    if (s.stopped) throw new WorldError("SESSION_STOPPED", "session stopped");
    const cur = this.store.getLocation(s.playerId);
    if (cur === nodeId) return { location: cur, opsLeft: s.opsLeft }; // 原地不动不耗预算
    const path = pathTo(cur, nodeId);
    if (path === null || path.length !== 2) throw new WorldError("NOT_ADJACENT", `${cur} → ${nodeId} 非邻接`);
    this.store.tx(() => {
      this.spendGuard(sessionId, "move");
      this.store.setLocation(s.playerId, nodeId);
    });
    return { location: nodeId, opsLeft: this.session(sessionId).opsLeft };
  }

  /** act：执行当前节点动作（1 op）；irreversible 动作受会话策略门控 */
  act(sessionId: string, actionId: string): { result: Record<string, unknown>; opsLeft: number } {
    const s = this.session(sessionId);
    const node = worldNode(this.store.getLocation(s.playerId));
    const action = node?.actions.find((a) => a.id === actionId);
    if (node === undefined || action === undefined) {
      throw new WorldError("ILLEGAL_ACTION", `${actionId} 在当前位置不可用`);
    }
    if (action.irreversible === true && !s.irreversible) {
      throw new WorldError("POLICY_DENIED", `irreversible op ${actionId} 未被会话授权`);
    }
    let result: Record<string, unknown> = {};
    this.store.tx(() => {
      this.spendGuard(sessionId, actionId);
      const e = action.effect;
      if (e.kind === "gain") {
        this.store.grantItem(s.playerId, e.item, e.qty);
        result = { gained: { [e.item]: e.qty } };
      } else if (e.kind === "spend") {
        if (!this.store.takeItem(s.playerId, e.item, e.qty)) {
          throw new WorldError("INSUFFICIENT", `${e.item} 不足`);
        }
        this.store.grantItem(s.playerId, e.gain, e.gainQty);
        result = { spent: { [e.item]: e.qty }, gained: { [e.gain]: e.gainQty } };
      } else if (e.kind === "challenge") {
        // 返回挑战规格——由 transport 翻译成真实建局（world 层不持有 battle 句柄）
        result = { challenge: { pack: e.pack, bossTeam: e.bossTeam } };
      } else {
        result = { rested: true };
      }
    });
    return { result, opsLeft: this.session(sessionId).opsLeft };
  }

  registerPlayer(playerId: string, name: string): void {
    this.store.ensurePlayer(playerId, name);
  }

  profile(playerId: string) {
    const p = this.store.getPlayer(playerId);
    if (p === null) throw new WorldError("NOT_FOUND", "player");
    return { ...p, inventory: this.store.getInventory(playerId), quests: this.quests(playerId), teams: this.store.listTeams(playerId) };
  }

  saveTeam(playerId: string, name: string, pack: string, species: string[]): void {
    this.store.saveTeam({ playerId, name, pack, species, updatedAt: Date.now() });
  }

  teams(playerId: string) { return this.store.listTeams(playerId); }

  inventory(playerId: string): Record<string, number> {
    return this.store.getInventory(playerId);
  }

  quests(playerId: string) {
    const rows = new Map(this.store.getQuests(playerId).map((q) => [q.questId, q]));
    return QUESTS.map((q) => ({
      ...q, progressOn: undefined,
      progress: rows.get(q.id)?.progress ?? 0,
      done: rows.get(q.id)?.done ?? false,
    }));
  }

  /**
   * 领取战局奖励（exactly-once）：
   * - terminal 必须存在；recipient 必须是该局 owner；
   * - outbox 键 (battleId,recipient,resultRevision) 保证重复调用读回执；
   * - 同一事务里推进胜/负战绩 + 任务进度 + 任务完成奖励。
   */
  claimReward(outcome: BattleOutcomeLike, playerId: string): { receipt: RewardRow; fresh: boolean } {
    const side = outcome.owners.p1 === playerId ? "p1" : outcome.owners.p2 === playerId ? "p2" : null;
    if (side === null) throw new WorldError("UNAUTHORIZED", "not an owner of this battle");
    this.store.ensurePlayer(playerId, playerId); // owner 登记即存在（未显式注册也记账）
    const won = outcome.terminal.result === side;
    const draw = outcome.terminal.result === "draw";
    const items = draw ? DRAW_ITEMS : won ? WIN_ITEMS : LOSE_ITEMS;
    return this.store.tx(() => {
      const { row, fresh } = this.store.insertRewardOnce(outcome.battleId, playerId, outcome.revision, items);
      if (fresh) {
        this.store.bumpResult(playerId, won);
        for (const q of QUESTS) {
          const cur = this.store.getQuests(playerId).find((x) => x.questId === q.id);
          if (cur !== undefined && cur.done) continue;
          const inc = q.progressOn(outcome, side, won);
          if (inc > 0) {
            this.store.bumpQuest(playerId, q.id, inc);
            const after = (cur?.progress ?? 0) + inc;
            if (after >= q.target) {
              this.store.markQuestDone(playerId, q.id);
              for (const [itemId, qty] of Object.entries(q.reward)) this.store.grantItem(playerId, itemId, qty);
            }
          }
        }
      }
      return { receipt: row, fresh };
    });
  }
}
