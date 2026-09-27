/**
 * M4-02：PVE 模式——bot 席位自动提交、无 p2 token、单人到终局。
 */
import { describe, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/index.ts";

const mkPve = async (server: Awaited<ReturnType<typeof startServer>>) => {
  const r = await fetch(`${server.url}/api/battle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seedHex: "aa".repeat(16), pack: "synthetic-v2", mode: "pve",
      team: { p1: ["syn-gamma", "syn-delta"], p2: ["syn-epsilon", "syn-delta"] },
    }),
  });
  return (await r.json()) as { battleId: string; mode: string; tokens: { p1: string; p2?: string } };
};

describe("PVE 模式", () => {
  it("建局后 bot 已提交（observe 直接可行动）且 p2 无 token", async () => {
    const server = await startServer(0);
    try {
      const { battleId, mode, tokens } = await mkPve(server);
      expect(mode).toBe("pve");
      expect(tokens.p2).toBeUndefined(); // bot 席位不发 token——外部无法扮演
      const obs = await fetch(`${server.url}/api/battle/${battleId}/observe?player=${tokens.p1}`).then((r) => r.json());
      expect(obs.decision).not.toBeNull();
      expect(obs.opponent.speciesId).toBe("syn-epsilon"); // boss 首发
      expect(obs.opponent.mode).toBe("boss"); // overlay 公开字段
    } finally {
      await server.close();
    }
  });
  it("单人链路：只提交自己侧 → bot 回应 → 打到终局", async () => {
    const server = await startServer(0);
    try {
      const { battleId, tokens } = await mkPve(server);
      let terminal = null;
      for (let i = 0; i < 250 && terminal === null; i++) {
        const obs = await fetch(`${server.url}/api/battle/${battleId}/observe?player=${tokens.p1}`).then((r) => r.json());
        terminal = obs.terminal;
        if (terminal !== null) break;
        const d = obs.decision;
        if (d === null || !d.actors.includes("p1")) continue;
        const pick = obs.legalActions.find((a: { actionId: string }) => a.actionId === "act_syn-strike")
          ?? obs.legalActions[0];
        await fetch(`${server.url}/api/battle/${battleId}/submit`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            player: tokens.p1, decisionId: d.decisionId, actionId: pick.actionId,
            baseRevision: d.baseRevision, idempotencyKey: `pv_${i}_xxxxxxxx`,
          }),
        });
      }
      expect(terminal).not.toBeNull();
    } finally {
      await server.close();
    }
  }, 30_000);
});
