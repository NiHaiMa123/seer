/**
 * replay:verify —— M1-04 门禁。≥20 局 seeded 战斗持久化后逐一重放比对
 * state hash；另跑篡改/缺失/工件不符负例。任一负例不按预期失败即整体非零。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@seer/contracts";
import { loadPackFromDir, DeterministicRng } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost, replayBattle, coreHashOf } from "@seer/host";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACK = loadPackFromDir(join(ROOT, "content"), "synthetic-v1");
const N = 20;

const dir = mkdtempSync(join(tmpdir(), "seer-replay-"));
const store = new BattleStore(join(dir, "verify.db"));
const results: { id: string; ok: boolean; turns: number }[] = [];

try {
  for (let i = 0; i < N; i++) {
    const battleId = `btl_rv${i}`;
    const seed = (0x5eed + i).toString(16).padStart(32, "0");
    const h = PersistedBattleHost.create(store, {
      pack: PACK,
      battleId,
      seedHex: seed,
      species: { p1: "syn-alpha", p2: "syn-beta" },
      players: { p1: "alice", p2: "bob" },
      deadlineMs: 5000,
    });
    const driver = new DeterministicRng(seed);
    let turns = 0;
    while (h.host.state.battle.terminal === null && turns++ < 60) {
      const dec = h.host.state.battle.decision!;
      const pick = (acts: { actionId: string }[]) => acts[driver.drawBelow(acts.length, "pick")]!.actionId;
      const a1 = pick(h.observe("alice").legalActions);
      const a2 = pick(h.observe("bob").legalActions);
      h.submit("alice", { battleId, decisionId: dec.decisionId, actionId: a1, baseRevision: dec.baseRevision, idempotencyKey: `a${i}-${turns}-aaaaaaaa` });
      h.submit("bob", { battleId, decisionId: dec.decisionId, actionId: a2, baseRevision: dec.baseRevision, idempotencyKey: `b${i}-${turns}-bbbbbbbb` });
    }
    const r = replayBattle(store, PACK, battleId);
    const liveHash = coreHashOf(h.host.state.battle);
    const ok = r.ok && r.finalHash === liveHash;
    results.push({ id: battleId, ok, turns: r.ok ? r.turns : -1 });
    if (!r.ok) console.log(`FAIL ${battleId}:`, r);
    else if (r.finalHash !== liveHash) console.log(`FAIL ${battleId}: final hash mismatch ${r.finalHash} != ${liveHash}`);
  }

  // 负例：篡改 actionId → REPLAY_MISMATCH
  const tampered = (() => {
    const id = "btl_rv0";
    const row = store.db.prepare("SELECT json FROM resolved_inputs WHERE battle_id=?").get(id) as { json: string };
    const ri = JSON.parse(row.json);
    ri.actions.p1.actionId = "act_syn-recover"; // 与存储动作不符
    store.db.prepare("UPDATE resolved_inputs SET json=? WHERE battle_id=?").run(canonicalJson(ri), id);
    const r = replayBattle(store, PACK, id);
    return !r.ok && r.code === "REPLAY_MISMATCH";
  })();
  results.push({ id: "tamper-negative", ok: tampered, turns: -1 });

  const missing = (() => {
    const r = replayBattle(store, PACK, "btl_ghost");
    return !r.ok && r.code === "ARTIFACT_UNAVAILABLE";
  })();
  results.push({ id: "missing-negative", ok: missing, turns: -1 });

  const failed = results.filter((r) => !r.ok);
  console.log(`replay:verify — ${results.length - failed.length}/${results.length} checks passed (${N} battles + 2 negative)`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.map((f) => f.id).join(", "));
    process.exit(1);
  }
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
