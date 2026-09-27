/**
 * M4-04：WorldAgent——目标驱动编排 + BFS 寻路 + 会话预算自然截断。
 * WorldOps 用 in-process WorldService 实现（证明抽象面可换 HTTP）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldService, WorldStore, WORLD_EDGES } from "@seer/world";
import { WorldAgent, type WorldOps } from "@seer/agent";

const mkOps = (svc: WorldService, sessionId: string): WorldOps => ({
  profile: () => svc.profile(svc.session(sessionId).playerId),
  map: () => svc.map(svc.session(sessionId).playerId),
  move: (nodeId) => svc.move(sessionId, nodeId),
  act: (actionId) => svc.act(sessionId, actionId),
  stop: () => svc.stopSession(sessionId),
});

describe("WorldAgent", () => {
  const fresh = () => {
    const db = join(mkdtempSync(join(tmpdir(), "seer-wa-")), "world.db");
    const svc = new WorldService(new WorldStore(db));
    svc.registerPlayer("wpl_alice", "A");
    return svc;
  };

  it("reach 目标：BFS 走到 arena（town→route-1→route-2→arena）", () => {
    const svc = fresh();
    const ses = svc.openSession("wpl_alice", { ops: 8 });
    const agent = new WorldAgent(mkOps(svc, ses.sessionId), { kind: "reach", id: "arena" }, WORLD_EDGES);
    const trace = agent.run();
    expect(trace.map((t) => t.op)).toEqual(["move", "move", "move", "done"]);
    expect(svc.session(ses.sessionId)?.opsLeft).toBe(8 - 3); // 3 move
    expect(svc.map("wpl_alice").location).toBe("arena");
  });

  it("item 目标：forage 采集到数量即 done", () => {
    const svc = fresh();
    const ses = svc.openSession("wpl_alice", { ops: 8 });
    const agent = new WorldAgent(mkOps(svc, ses.sessionId), { kind: "item", id: "item-shard", qty: 2 }, WORLD_EDGES);
    const trace = agent.run();
    // town→route-1(move) + forage×2（第二次动作后 profile 满足）
    expect(trace.map((t) => t.op)).toEqual(["move", "act", "act", "done"]);
    expect(svc.inventory("wpl_alice")["item-shard"]).toBe(2);
  });

  it("预算尽：op 抛 BUDGET_EXHAUSTED，agent run 收敛不无限循环", () => {
    const svc = fresh();
    const ses = svc.openSession("wpl_alice", { ops: 2 });
    const agent = new WorldAgent(mkOps(svc, ses.sessionId), { kind: "reach", id: "arena" }, WORLD_EDGES);
    let code = "";
    try { agent.run(); } catch (e) { code = (e as { code?: string }).code ?? ""; }
    expect(code).toBe("BUDGET_EXHAUSTED");
    // 只走了 2 步（town→route-1→route-2），到不了 arena
    expect(svc.map("wpl_alice").location).toBe("route-2");
  });

  it("reach 已在目标点：即刻 done，不误触不可逆动作", () => {
    const svc = fresh();
    const ses = svc.openSession("wpl_alice", { ops: 8 }); // irreversible=false
    const agent = new WorldAgent(mkOps(svc, ses.sessionId), { kind: "reach", id: "town" }, WORLD_EDGES);
    expect(agent.step().op).toBe("done");
    expect(svc.session(ses.sessionId)?.opsLeft).toBe(8); // 没花预算
  });
});
