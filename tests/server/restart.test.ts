/**
 * 进程重启恢复验收（bug-audit #10）：
 * - 权威态/token/PVE 席位/worldMeta 随 battle_registrations 持久化
 * - 重启后 observe/submit 端点可凭原 token 进入
 * - world 挑战归属恢复：reward 端点返回 409（未终局）而非 404（无登记）
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/index.ts";

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("server 重启恢复", () => {
  it("PVP 对局：重启后原 token 可 observe + submit", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "seer-rst-")), "battle.db");
    const seedHex = "ab".repeat(16);
    let battleId = "";
    let token = "";
    {
      const server = await startServer(0, dbPath);
      try {
        const created = await (await post(`${server.url}/api/battle`, {
          pack: "synthetic-v1", mode: "pvp", seedHex, deadlineMs: 30_000,
        })).json() as { battleId: string; tokens: { p1: string; p2: string } };
        battleId = created.battleId;
        token = created.tokens.p1;
      } finally {
        await server.close();
      }
    }
    {
      const server = await startServer(0, dbPath);
      try {
        const obs = await fetch(`${server.url}/api/battle/${battleId}/observe?player=${token}`);
        expect(obs.status).toBe(200);
        const body = await obs.json() as { decision: { decisionId: string; baseRevision: number } | null; legalActions: { actionId: string }[] };
        const d = body.decision;
        expect(d).not.toBeNull();
        const first = body.legalActions[0]!;
        const sub = await post(`${server.url}/api/battle/${battleId}/submit`, {
          player: token,
          decisionId: d!.decisionId,
          actionId: first.actionId,
          baseRevision: d!.baseRevision,
          idempotencyKey: `rst_${battleId}_${d!.decisionId}`,
        });
        expect(sub.status).toBe(200);
        const subBody = await sub.json() as { ok: boolean };
        expect(subBody.ok).toBe(true);
      } finally {
        await server.close();
      }
    }
  });

  it("世界挑战：重启后归属恢复——reward 返回 409 而非 404", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "seer-rst-")), "battle.db");
    let battleId = "";
    {
      const server = await startServer(0, dbPath);
      try {
        await post(`${server.url}/api/world/player`, { playerId: "wpl_rst", name: "t" });
        const ses = await (await post(`${server.url}/api/world/session`, {
          playerId: "wpl_rst", ops: 10,
        })).json() as { sessionId: string };
        for (const n of ["route-1", "route-2", "arena"]) {
          await post(`${server.url}/api/world/op`, { sessionId: ses.sessionId, op: "move", nodeId: n });
        }
        const op = await (await post(`${server.url}/api/world/op`, {
          sessionId: ses.sessionId, op: "act", actionId: "challenge",
        })).json() as { battle?: { battleId: string } };
        expect(op.battle).toBeDefined();
        battleId = op.battle!.battleId;
      } finally {
        await server.close();
      }
    }
    {
      const server = await startServer(0, dbPath);
      try {
        const r = await post(`${server.url}/api/world/reward`, { battleId, playerId: "wpl_rst" });
        // 归属已恢复 → 未终局判 409；若 worldMeta 丢失则是 404
        expect(r.status).toBe(409);
      } finally {
        await server.close();
      }
    }
  });
});
