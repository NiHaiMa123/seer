/**
 * bench:m1 —— Host 层 resolve 吞吐基准（诚实口径：含持久化事务）。
 * 报告 turns/sec、mean/p95 turn commit 延迟；落盘 artifacts/m1/m1-06-bench.json。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost } from "@seer/host";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "artifacts", "m1", "m1-06-bench.json");
const PACK = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const BATTLES = 40;
const MAX_TURNS = 220;

const SCRIPT = ["act_syn-strike", "act_syn-jab", "act_syn-bolster", "act_syn-strike"];
const pick = (legal: { actionId: string }[], i: number) => {
  const set = new Set(legal.map((l) => l.actionId));
  for (let k = 0; k < SCRIPT.length; k++) {
    const a = SCRIPT[(i + k) % SCRIPT.length]!;
    if (set.has(a)) return a;
  }
  return legal[0]!.actionId;
};

const tmp = mkdtempSync(join(tmpdir(), "seer-bench-"));
const store = new BattleStore(join(tmp, "bench.db"));
const latencies: number[] = [];
let totalTurns = 0;

const t0 = performance.now();
for (let i = 0; i < BATTLES; i++) {
  const h = PersistedBattleHost.create(store, {
    pack: PACK,
    battleId: `btl_b${i}`,
    seedHex: (0xbee0 + i).toString(16).padStart(32, "0"),
    species: { p1: "syn-alpha", p2: "syn-beta" },
    players: { p1: "alice", p2: "bob" },
    deadlineMs: 5000,
  });
  let t = 0;
  while (h.host.state.battle.terminal === null && t++ < MAX_TURNS) {
    const d = h.host.state.battle.decision!;
    const a1 = pick(h.observe("alice").legalActions, t);
    const a2 = pick(h.observe("bob").legalActions, t + 1);
    const s = performance.now();
    h.submit("alice", { battleId: `btl_b${i}`, decisionId: d.decisionId, actionId: a1, baseRevision: d.baseRevision, idempotencyKey: `ba${i}-${t}-aaaaaaaa` });
    h.submit("bob", { battleId: `btl_b${i}`, decisionId: d.decisionId, actionId: a2, baseRevision: d.baseRevision, idempotencyKey: `bb${i}-${t}-bbbbbbbb` });
    latencies.push(performance.now() - s);
    totalTurns++;
  }
}
const elapsedMs = performance.now() - t0;
latencies.sort((a, b) => a - b);
const pct = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!;
const report = {
  env: { node: process.version, platform: process.platform, cpu: `${cpus()[0]?.model ?? "?"}` },
  battles: BATTLES,
  totalTurns,
  elapsedMs: Math.round(elapsedMs),
  turnsPerSec: Math.round((totalTurns / elapsedMs) * 1000),
  turnCommitLatencyMs: {
    mean: Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100,
    p50: Math.round(pct(0.5) * 100) / 100,
    p95: Math.round(pct(0.95) * 100) / 100,
    p99: Math.round(pct(0.99) * 100) / 100,
  },
  note: "Host 层 resolve + SQLite 提交延迟；非网络、非浏览器、不代表低端机。",
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
store.close();
try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* windows */ }
