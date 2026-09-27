/**
 * WorldStore —— 世界域 SQLite 持久化（world.db，与 battle.db 分离）。
 * 表：players / teams / inventory / quests / rewards（outbox）。
 * 所有写都走单事务；rewards 用 (battleId,recipient,resultRevision) 唯一键
 * 实现 exactly-once（ARCHITECTURE.md §奖励）。
 */
import { DatabaseSync } from "node:sqlite";

export interface TeamRow { playerId: string; name: string; pack: string; species: string[]; updatedAt: number }
export interface RewardRow {
  battleId: string; recipient: string; resultRevision: number;
  items: Record<string, number>; claimedAt: number;
}

export class WorldStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS players (
        playerId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        playerId TEXT NOT NULL,
        name TEXT NOT NULL,
        pack TEXT NOT NULL,
        speciesJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (playerId, name)
      );
      CREATE TABLE IF NOT EXISTS inventory (
        playerId TEXT NOT NULL,
        itemId TEXT NOT NULL,
        qty INTEGER NOT NULL,
        PRIMARY KEY (playerId, itemId)
      );
      CREATE TABLE IF NOT EXISTS quests (
        playerId TEXT NOT NULL,
        questId TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (playerId, questId)
      );
      CREATE TABLE IF NOT EXISTS rewards (
        battleId TEXT NOT NULL,
        recipient TEXT NOT NULL,
        resultRevision INTEGER NOT NULL,
        itemsJson TEXT NOT NULL,
        claimedAt INTEGER NOT NULL,
        PRIMARY KEY (battleId, recipient, resultRevision)
      );
    `);
  }

  close(): void { this.db.close(); }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  ensurePlayer(playerId: string, name: string): void {
    this.db.prepare("INSERT OR IGNORE INTO players(playerId,name,createdAt) VALUES (?,?,?)")
      .run(playerId, name, Date.now());
  }

  getPlayer(playerId: string): { playerId: string; name: string; wins: number; losses: number } | null {
    return (this.db.prepare("SELECT playerId,name,wins,losses FROM players WHERE playerId=?")
      .get(playerId) as never) ?? null;
  }

  bumpResult(playerId: string, won: boolean): void {
    this.db.prepare(`UPDATE players SET ${won ? "wins" : "losses"} = ${won ? "wins" : "losses"} + 1 WHERE playerId=?`).run(playerId);
  }

  saveTeam(t: TeamRow): void {
    this.db.prepare("INSERT OR REPLACE INTO teams(playerId,name,pack,speciesJson,updatedAt) VALUES (?,?,?,?,?)")
      .run(t.playerId, t.name, t.pack, JSON.stringify(t.species), t.updatedAt);
  }

  listTeams(playerId: string): TeamRow[] {
    return (this.db.prepare("SELECT playerId,name,pack,speciesJson,updatedAt FROM teams WHERE playerId=?")
      .all(playerId) as Array<Record<string, unknown>>)
      .map((r) => ({ playerId: r["playerId"] as string, name: r["name"] as string, pack: r["pack"] as string, species: JSON.parse(r["speciesJson"] as string) as string[], updatedAt: r["updatedAt"] as number }));
  }

  grantItem(playerId: string, itemId: string, qty: number): void {
    this.db.prepare("INSERT INTO inventory(playerId,itemId,qty) VALUES (?,?,?) ON CONFLICT(playerId,itemId) DO UPDATE SET qty=qty+excluded.qty")
      .run(playerId, itemId, qty);
  }

  getInventory(playerId: string): Record<string, number> {
    const rows = this.db.prepare("SELECT itemId,qty FROM inventory WHERE playerId=?").all(playerId) as Array<{ itemId: string; qty: number }>;
    return Object.fromEntries(rows.map((r) => [r.itemId, r.qty]));
  }

  /** outbox 查已有奖励（幂等读） */
  getReward(battleId: string, recipient: string, resultRevision: number): RewardRow | null {
    const r = this.db.prepare("SELECT battleId,recipient,resultRevision,itemsJson,claimedAt FROM rewards WHERE battleId=? AND recipient=? AND resultRevision=?")
      .get(battleId, recipient, resultRevision) as Record<string, unknown> | undefined;
    if (r === undefined) return null;
    return { battleId: r["battleId"] as string, recipient: r["recipient"] as string, resultRevision: r["resultRevision"] as number, items: JSON.parse(r["itemsJson"] as string) as Record<string, number>, claimedAt: r["claimedAt"] as number };
  }

  /** outbox 写奖励 + 入账——非事务版（调用方包 tx）；重复键返回已有记录 */
  insertRewardOnce(battleId: string, recipient: string, resultRevision: number, items: Record<string, number>): { row: RewardRow; fresh: boolean } {
    const existing = this.getReward(battleId, recipient, resultRevision);
    if (existing !== null) return { row: existing, fresh: false };
    this.db.prepare("INSERT INTO rewards(battleId,recipient,resultRevision,itemsJson,claimedAt) VALUES (?,?,?,?,?)")
      .run(battleId, recipient, resultRevision, JSON.stringify(items), Date.now());
    for (const [itemId, qty] of Object.entries(items)) this.grantItem(recipient, itemId, qty);
    return { row: { battleId, recipient, resultRevision, items, claimedAt: Date.now() }, fresh: true };
  }

  /** outbox 写奖励 + 入账——单事务；重复调用幂等回执 */
  claimRewardTx(battleId: string, recipient: string, resultRevision: number, items: Record<string, number>): { row: RewardRow; fresh: boolean } {
    return this.tx(() => this.insertRewardOnce(battleId, recipient, resultRevision, items));
  }

  bumpQuest(playerId: string, questId: string, amount: number): void {
    this.db.prepare("INSERT INTO quests(playerId,questId,progress,done) VALUES (?,?,?,0) ON CONFLICT(playerId,questId) DO UPDATE SET progress=progress+excluded.progress")
      .run(playerId, questId, amount);
  }

  markQuestDone(playerId: string, questId: string): void {
    this.db.prepare("UPDATE quests SET done=1 WHERE playerId=? AND questId=?").run(playerId, questId);
  }

  getQuests(playerId: string): Array<{ questId: string; progress: number; done: boolean }> {
    return (this.db.prepare("SELECT questId,progress,done FROM quests WHERE playerId=?")
      .all(playerId) as Array<{ questId: string; progress: number; done: number }>)
      .map((r) => ({ questId: r.questId, progress: r.progress, done: r.done === 1 }));
  }
}
