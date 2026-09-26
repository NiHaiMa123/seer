/**
 * demo:m1 —— M1-06 零人工干预 demo：完整序列
 * create → connect(双端观察) → submit(逐回合) → resolve → events(公开历史)
 * → replay → verify → 证据落盘 artifacts/m1/m1-06-demo.json
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost, replayBattle, coreHashOf } from "@seer/host";
import { startServer } from "../apps/server/src/index.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "artifacts", "m1", "m1-06-demo.json");
const SEED = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";

interface Evidence {
  sequence: string[];
  battleId: string;
  turns: { turn: number; p1Action: string; p2Action: string }[];
  terminal: unknown;
  publicEvents: { seq: number; type: string }[];
  internalEventCount: number;
  replay: { ok: boolean; turns?: number; code?: string; finalHash?: string };
  liveHash: string;
  replayHashMatchesLive: boolean;
}

// 确定性脚本动作序列（无随机）：strike ×2 → bolster → jab → recover → strike…
const SCRIPT = ["act_syn-strike", "act_syn-strike", "act_syn-bolster", "act_syn-jab", "act_syn-recover"];
const pick = (obs: any, i: number) => {
  const legal = new Set(obs.legalActions.map((l: any) => l.actionId));
  for (let k = 0; k < SCRIPT.length; k++) {
    const a = SCRIPT[(i + k) % SCRIPT.length]!;
    if (legal.has(a)) return a;
  }
  return obs.legalActions[0].actionId;
};

async function main(): Promise<void> {
  const evidence: Evidence = {
    sequence: [],
    battleId: "",
    turns: [],
    terminal: null,
    publicEvents: [],
    internalEventCount: 0,
    replay: { ok: false },
    liveHash: "",
    replayHashMatchesLive: false,
  };
  const tmp = mkdtempSync(join(tmpdir(), "seer-demo-"));
  const server = await startServer(0, join(tmp, "demo.db"));
  try {
    evidence.sequence.push("server-start");

    // create
    const created = await fetch(`${server.url}/api/battle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seedHex: SEED }),
    }).then((r) => r.json());
    evidence.battleId = created.battleId;
    evidence.sequence.push("create");

    // connect（两侧 resync 视图）
    const o1 = await fetch(`${server.url}/api/battle/${created.battleId}/resync?player=${created.tokens.p1}`).then((r) => r.json());
    const o2 = await fetch(`${server.url}/api/battle/${created.battleId}/resync?player=${created.tokens.p2}`).then((r) => r.json());
    if (o1.observation.side !== "p1" || o2.observation.side !== "p2") throw new Error("side binding broken");
    evidence.sequence.push("connect");

    // submit → resolve 循环（脚本化，无人工干预）
    const host = server.battles.get(created.battleId)!;
    let steps = 0;
    while (true) {
      const obs = await fetch(`${server.url}/api/battle/${created.battleId}/observe?player=${created.tokens.p1}`).then((r) => r.json());
      if (obs.terminal) break;
      const d = obs.decision;
      const a1 = pick(obs, steps);
      const obs2 = await fetch(`${server.url}/api/battle/${created.battleId}/observe?player=${created.tokens.p2}`).then((r) => r.json());
      const a2 = pick(obs2, steps + 1);
      const r1 = await fetch(`${server.url}/api/battle/${created.battleId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: created.tokens.p1, decisionId: d.decisionId, actionId: a1, baseRevision: d.baseRevision, idempotencyKey: `demo-p1-${d.decisionId}` }),
      }).then((r) => r.json());
      const r2 = await fetch(`${server.url}/api/battle/${created.battleId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: created.tokens.p2, decisionId: d.decisionId, actionId: a2, baseRevision: d.baseRevision, idempotencyKey: `demo-p2-${d.decisionId}` }),
      }).then((r) => r.json());
      if (!r1.ok || !r2.ok) throw new Error(`submit failed: ${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);
      evidence.turns.push({ turn: obs.turn, p1Action: a1, p2Action: a2 });
      steps++;
      if (steps > 210) throw new Error("demo overrun");
    }
    evidence.sequence.push("resolve");

    // events（公开历史 + 内部计数对比）
    const hist = await fetch(`${server.url}/api/battle/${created.battleId}/history?player=${created.tokens.p1}&since=0`).then((r) => r.json());
    evidence.publicEvents = host.host.state.publicStream.map((p) => ({ seq: p.seq, type: p.event.type }));
    evidence.internalEventCount = host.host.state.internalEvents.length;
    if (hist.events.length !== evidence.publicEvents.length) throw new Error("history/publicStream divergence");
    evidence.sequence.push("events");

    // replay + verify
    const liveHash = coreHashOf(host.host.state.battle);
    const replay = replayBattle(host.store, loadPackFromDir(join(ROOT, "content"), "synthetic-v1"), created.battleId);
    evidence.replay = replay.ok
      ? { ok: true, turns: replay.turns, finalHash: replay.finalHash }
      : { ok: false, code: replay.code };
    evidence.liveHash = liveHash;
    evidence.replayHashMatchesLive = replay.ok && replay.finalHash === liveHash;
    if (!evidence.replayHashMatchesLive) throw new Error(`replay mismatch: ${JSON.stringify(evidence.replay)} vs ${liveHash}`);
    evidence.sequence.push("replay", "verify");

    evidence.terminal = (await fetch(`${server.url}/api/battle/${created.battleId}/observe?player=${created.tokens.p1}`).then((r) => r.json())).terminal;

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, canonicalJson(evidence) + "\n");
    console.log(`demo:m1 OK — ${evidence.turns.length} turns, terminal=${JSON.stringify(evidence.terminal)}, ${evidence.publicEvents.length} public events (${evidence.internalEventCount} internal), replay hash match`);
    console.log(`evidence → ${OUT}`);
  } finally {
    await server.close();
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* windows handle lag */ }
  }
}

main().catch((e) => {
  console.error("demo:m1 FAILED:", e);
  process.exit(1);
});
