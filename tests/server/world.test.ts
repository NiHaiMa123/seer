/**
 * M4-03：world service——存档/背包/任务持久化 + reward outbox exactly-once。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore, WorldService } from "@seer/world";
import { startServer } from "../../apps/server/src/index.ts";

const post = async (url: string, body: unknown) =>
  (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

const put = async (url: string, body: unknown) =>
  (await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

const get = async (url: string) => (await fetch(url)).json();

describe("world service（HTTP 全链）", () => {
  it("注册/存档队伍/背包/任务 → 终局领奖 exactly-once", async () => {
    const server = await startServer(0);
    try {
      const A = "wpl_alice", B = "wpl_bob";
      await post(`${server.url}/api/world/player`, { playerId: A, name: "Alice" });
      await post(`${server.url}/api/world/player`, { playerId: B, name: "Bob" });

      // 存档队伍
      expect(await put(`${server.url}/api/world/player/${A}/team`, { name: "main", pack: "synthetic-v2", species: ["syn-gamma", "syn-delta"] }))
        .toEqual({ ok: true });
      const teams = (await get(`${server.url}/api/world/player/${A}/teams`)) as { teams: { species: string[] }[] };
      expect(teams.teams[0]?.species).toEqual(["syn-gamma", "syn-delta"]);

      // 建局（登记 owners）→ p1 直接认输 → bob 赢
      const created = await post(`${server.url}/api/battle`, {
        seedHex: "aa".repeat(16), pack: "synthetic-v2",
        team: { p1: ["syn-gamma"], p2: ["syn-delta"] },
        owners: { p1: A, p2: B },
      }) as { battleId: string; tokens: { p1: string; p2: string } };
      const obs0 = await get(`${server.url}/api/battle/${created.battleId}/observe?player=${created.tokens.p1}`);
      // 同时判定：p1 认输 + p2 任意招 → 收齐才 resolve
      await post(`${server.url}/api/battle/${created.battleId}/submit`, {
        player: created.tokens.p1, decisionId: obs0.decision.decisionId,
        actionId: "act_concede", baseRevision: obs0.decision.baseRevision,
        idempotencyKey: "wd_concede_xx",
      });
      const obsP2 = await get(`${server.url}/api/battle/${created.battleId}/observe?player=${created.tokens.p2}`);
      await post(`${server.url}/api/battle/${created.battleId}/submit`, {
        player: created.tokens.p2, decisionId: obs0.decision.decisionId,
        actionId: obsP2.legalActions[0].actionId, baseRevision: obs0.decision.baseRevision,
        idempotencyKey: "wd_p2_xxxxxxx",
      });

      // 终局前 claim 之外：非 owner 拒绝
      const bad = await post(`${server.url}/api/world/reward`, { playerId: "wpl_eve", battleId: created.battleId });
      expect(bad.code ?? bad.error?.code).toBe("UNAUTHORIZED");

      // bob 领奖：orb + 胜场 + q_first_win 完成
      const c1 = await post(`${server.url}/api/world/reward`, { playerId: B, battleId: created.battleId });
      expect(c1.fresh).toBe(true);
      expect(c1.receipt.items["item-orb"]).toBe(1);

      // 幂等：重复 claim 同键 → 相同回执、库存不翻倍
      const c2 = await post(`${server.url}/api/world/reward`, { playerId: B, battleId: created.battleId });
      expect(c2.fresh).toBe(false);
      expect(c2.receipt.items).toEqual(c1.receipt.items);
      const prof = await get(`${server.url}/api/world/player/${B}`) as { wins: number; inventory: Record<string, number>; quests: { id: string; done: boolean }[] };
      expect(prof.wins).toBe(1);
      expect(prof.inventory["item-orb"]).toBe(2); // 胜局 1 + 首胜任务 1
      expect(prof.inventory["item-orb"]).toBe(2); // 重复 claim 没再入账
      expect(prof.quests.find((q) => q.id === "q_first_win")?.done).toBe(true);

      // alice 败方：shard 参与奖、败场+1
      const c3 = await post(`${server.url}/api/world/reward`, { playerId: A, battleId: created.battleId });
      expect(c3.fresh).toBe(true);
      expect(c3.receipt.items["item-shard"]).toBe(1);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("未终局的局 claim → 409", async () => {
    const server = await startServer(0);
    try {
      const created = await post(`${server.url}/api/battle`, {
        seedHex: "bb".repeat(16), pack: "synthetic-v2",
        owners: { p1: "wpl_alice", p2: "wpl_bob" },
      }) as { battleId: string };
      const r = await fetch(`${server.url}/api/world/reward`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: "wpl_alice", battleId: created.battleId }),
      });
      expect(r.status).toBe(409);
    } finally {
      await server.close();
    }
  });
});

describe("WorldStore 崩溃安全", () => {
  it("重开同 db：队伍/背包/任务/回执全部存活", () => {
    const db = join(mkdtempSync(join(tmpdir(), "seer-wtest-")), "world.db");
    let s = new WorldStore(db);
    s.ensurePlayer("wpl_carol", "Carol");
    s.saveTeam({ playerId: "wpl_carol", name: "main", pack: "synthetic-v2", species: ["syn-gamma"], updatedAt: 1 });
    s.claimRewardTx("btl_a", "wpl_carol", 42, { "item-orb": 1 });
    s.close();
    s = new WorldStore(db); // 崩溃恢复：同文件重开
    expect(s.listTeams("wpl_carol")[0]?.species).toEqual(["syn-gamma"]);
    expect(s.getInventory("wpl_carol")["item-orb"]).toBe(1);
    expect(s.getReward("btl_a", "wpl_carol", 42)?.items).toEqual({ "item-orb": 1 });
    s.close();
  });

  it("outbox 键 (battleId,recipient,revision)：不同 revision/recipient 各自入账", () => {
    const db = join(mkdtempSync(join(tmpdir(), "seer-wtest-")), "world.db");
    const s = new WorldStore(db);
    s.claimRewardTx("btl_a", "wpl_carol", 42, { "item-orb": 1 });
    s.claimRewardTx("btl_a", "wpl_carol", 42, { "item-orb": 1 }); // 重试——幂等
    s.claimRewardTx("btl_a", "wpl_carol", 43, { "item-orb": 1 }); // 不同 revision = 不同事件
    s.claimRewardTx("btl_a", "wpl_dave", 42, { "item-orb": 1 }); // 不同 recipient
    expect(s.getInventory("wpl_carol")["item-orb"]).toBe(2); // 42 和 43 各一次
    expect(s.getInventory("wpl_dave")["item-orb"]).toBe(1);
    s.close();
  });

  it("任务前置：q_winner_3 需 3 胜才完成", () => {
    const db = join(mkdtempSync(join(tmpdir(), "seer-wtest-")), "world.db");
    const svc = new WorldService(new WorldStore(db));
    const win = (n: number) => svc.claimReward({
      battleId: `btl_q${n}`, terminal: { result: "p1", reason: "ko" },
      revision: 1, owners: { p1: "wpl_carol" }, opponentSpecies: { p1: "syn-gamma", p2: "syn-delta" },
    }, "wpl_carol");
    win(1); win(2); win(3);
    const qs = svc.quests("wpl_carol");
    expect(qs.find((q) => q.id === "q_winner_3")?.done).toBe(true);
    expect(qs.find((q) => q.id === "q_first_win")?.done).toBe(true);
    expect(svc.profile("wpl_carol").inventory["item-orb"]).toBe(3 + 1 + 3); // 3 胜 ×1 + 首胜奖 1 + 3胜奖 3
  });
});
