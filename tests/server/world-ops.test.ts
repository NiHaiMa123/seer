/**
 * M4-04：世界探索——会话预算、邻接寻路、不可逆策略门控、challenge→pve 建局。
 */
import { describe, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/index.ts";

const post = async (url: string, body: unknown, raw = false) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return raw ? { status: r.status, body: await r.json() } : r.json();
};

describe("世界探索 op", () => {
  it("move 邻接校验 + act forage + 预算扣减", async () => {
    const server = await startServer(0);
    try {
      await post(`${server.url}/api/world/player`, { playerId: "wpl_alice", name: "A" });
      const ses = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 8 }) as { sessionId: string; opsLeft: number };
      expect(ses.opsLeft).toBe(8);

      const m0 = await (await fetch(`${server.url}/api/world/player/wpl_alice/map`)).json();
      expect(m0.location).toBe("town");
      expect(m0.nodes.length).toBe(5);

      // 非邻接：town → arena 拒绝且不耗预算
      const bad = await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: "arena" }, true);
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("NOT_ADJACENT");
      expect((await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: "route-1" })).opsLeft).toBe(7);

      // forage 入账
      const f = await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "act", actionId: "forage" });
      expect(f.result.gained["item-shard"]).toBe(1);
      expect(f.opsLeft).toBe(6);
    } finally {
      await server.close();
    }
  });

  it("不可逆动作受会话策略门控", async () => {
    const server = await startServer(0);
    try {
      await post(`${server.url}/api/world/player`, { playerId: "wpl_alice", name: "A" });
      // 不开 irreversible：buy-potion 被拒
      const ses = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 8 }) as { sessionId: string };
      const denied = await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "act", actionId: "buy-potion" }, true);
      expect(denied.body.code).toBe("POLICY_DENIED");
      // 开了但余额不足：INSUFFICIENT 且不耗预算
      const ses2 = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 4, irreversible: true }) as { sessionId: string };
      const poor = await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "act", actionId: "buy-potion" }, true);
      expect(poor.body.code).toBe("INSUFFICIENT");
      // 入账 shard 后购买成功
      await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "move", nodeId: "route-1" });
      await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "act", actionId: "forage" });
      await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "move", nodeId: "town" });
      const bought = await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "act", actionId: "buy-potion" });
      expect(bought.result.gained["item-potion"]).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("预算耗尽 + stop 拒绝一切 op", async () => {
    const server = await startServer(0);
    try {
      await post(`${server.url}/api/world/player`, { playerId: "wpl_alice", name: "A" });
      const ses = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 1 }) as { sessionId: string };
      await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: "route-1" });
      const out = await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: "town" }, true);
      expect(out.body.code).toBe("BUDGET_EXHAUSTED");

      const ses2 = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 9 }) as { sessionId: string };
      await post(`${server.url}/api/world/session/${ses2.sessionId}/stop`, {});
      // 移动到不同节点——stopped 会话任何 op 都拒
      const stopped = await post(`${server.url}/api/world/op`, { sessionId: ses2.sessionId, op: "move", nodeId: "town" }, true);
      expect(stopped.body.code).toBe("SESSION_STOPPED");
    } finally {
      await server.close();
    }
  });

  it("act challenge → 自动建 pve 局 + owner 登记（领奖链路通）", async () => {
    const server = await startServer(0);
    try {
      await post(`${server.url}/api/world/player`, { playerId: "wpl_alice", name: "A" });
      const ses = await post(`${server.url}/api/world/session`, { playerId: "wpl_alice", ops: 16 }) as { sessionId: string };
      for (const n of ["route-1", "route-2", "arena"]) {
        await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: n });
      }
      const r = await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "act", actionId: "challenge" });
      expect(r.battle.battleId).toMatch(/^btl_/);
      expect(r.battle.token).toMatch(/^tok_/);
      // 开打后认输 → 领奖链路完整
      const obs = await (await fetch(`${server.url}/api/battle/${r.battle.battleId}/observe?player=${r.battle.token}`)).json();
      await post(`${server.url}/api/battle/${r.battle.battleId}/submit`, {
        player: r.battle.token, decisionId: obs.decision.decisionId, actionId: "act_concede",
        baseRevision: obs.decision.baseRevision, idempotencyKey: "wops_concede_x",
      });
      // bot 立即回应 → 终局
      const claim = await post(`${server.url}/api/world/reward`, { playerId: "wpl_alice", battleId: r.battle.battleId });
      expect(claim.fresh).toBe(true);
      expect(claim.receipt.items["item-shard"]).toBe(1); // 败方参与奖
    } finally {
      await server.close();
    }
  }, 15_000);
});
