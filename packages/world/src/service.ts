/**
 * WorldService —— 世界域业务面：profile / team / inventory / quest / reward。
 * 奖励 entitlement 由战局终局确定（battleId+resultRevision+recipient 唯一键）：
 *   - claimReward 在单事务里写 outbox + 入账——崩溃安全、重复幂等；
 *   - 败方也得参与奖（合成奖励表），奖励内容由 battle 终局决定，不由调用方指定。
 */
import type { WorldStore, RewardRow } from "./store.ts";

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
