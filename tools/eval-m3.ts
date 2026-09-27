/**
 * eval:m3 — M3-05 评测 runner。
 * 输出 artifacts/m3/eval-m3.json：
 *  - 机制门：holdout fixture 解集命中（planner 判定）；
 *  - 消融胜局：paired seeds × 换边 × repeat，Wilson CI + paired bootstrap；
 *  - 预算：每 arm 决策延迟 p95 + transitions；
 * 用法：node tools/eval-m3.ts [--quick] [--games N]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir, sha256hex } from "@seer/battle-core";
import {
  EchoProvider, Belief, plan, DEFAULT_PLANNER, oraclePickSet,
  mkPolicy, playGame, wilson, pairedBootstrap,
  type ArmSpec, type Policy,
} from "@seer/agent";
import { FIXTURES, type M3Fixture } from "./m3-fixtures.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACK = loadPackFromDir(join(ROOT, "content"), "synthetic-v2");
const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const gamesArg = args.find((a) => a.startsWith("--games="));
const GAMES_PER_ARM = QUICK ? 20 : gamesArg !== undefined ? Number(gamesArg.slice(8)) : 200;
const REPEATS = QUICK ? 1 : 3;

const ARMS: ArmSpec[] = [
  { id: "random" },
  { id: "rule" },
  { id: "llm", provider: new EchoProvider() },
  { id: "llm_retrieval", provider: new EchoProvider() },
  // 评测口径：≤512 transition/决策（spec 上限 2048）、depth2 与 DEFAULT_PLANNER 一致
  { id: "search", planner: { depth: 2, maxTransitions: 512, ownCap: 6, oppCap: 5 } },
  { id: "full", provider: new EchoProvider(), planner: { depth: 2, maxTransitions: 512, ownCap: 6, oppCap: 5 } },
];

// ── 机制门：holdout 上 planner/标注一致性 ─────────────────────
interface MechResult { id: string; category: string; hit: boolean; picked: string; expected: string[]; exists: boolean; thematic: string[]; themeMatch: boolean }

async function mechanismEval(): Promise<{ results: MechResult[]; holdoutScore: number; holdoutTotal: number }> {
  const { BattleHost, createReadOnlyView } = await import("@seer/host");
  const results: MechResult[] = [];
  for (const f of FIXTURES) {
    const host = new BattleHost({
      pack: PACK, battleId: f.battleId, seedHex: f.seedHex, species: f.species,
      ...(f.bench !== undefined ? { bench: f.bench } : {}),
      players: { p1: "A", p2: "B" }, deadlineMs: 60_000,
    });
    f.patch?.(host);
    const obs = host.observe("A");
    const samples = new Belief(PACK).update(obs).samples;
    // oracle：更宽更深的搜索给出"可证最优集"；planner(d1) 的判定 = 是否落在 oracle 集
    const oracle = oraclePickSet(PACK, obs, samples);
    const r = plan(PACK, obs, samples, 3, { ...DEFAULT_PLANNER }); // 机制门按生产口径 depth2/2048 判
    const solved = f.counterplay.exists
      ? oracle.set.includes(r.actionId)
      : oracle.set.includes(r.actionId); // 无解局面同样按 oracle 判定（诱饵动作不进 oracle 集）
    results.push({
      id: f.id, category: f.category, hit: solved, picked: r.actionId,
      expected: oracle.set, exists: f.counterplay.exists,
      thematic: f.counterplay.solutionActions, themeMatch: f.counterplay.solutionActions.includes(r.actionId),
    });
  }
  const holdout = results.filter((r) => r.id.includes("holdout"));
  return { results, holdoutScore: holdout.filter((r) => r.hit).length, holdoutTotal: holdout.length };
}

// ── 消融对局 ─────────────────────────────────────────────────
interface ArmStats {
  arm: string;
  games: number; wins: number; draws: number; losses: number; timeouts: number;
  winrateCI: { lo: number; hi: number; p: number };
  pairedVsRule: { lo: number; hi: number; estimate: number };
  decisionMsP95: number;
  decisionsTotal: number;
}

const pct95 = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
};

async function ablationEval(): Promise<{ stats: ArmStats[]; repeats: number; gamesPerArm: number }> {
  const stats: ArmStats[] = [];
  const ruleResults: boolean[] = []; // rule 组自身结果（配对基线参照）
  const seedList = Array.from({ length: GAMES_PER_ARM / 2 }, (_, i) => sha256hex(`m3-paired-${i}`).slice(0, 32));
  const allLat: Record<string, number[]> = {};

  for (const arm of ARMS) {
    const wins: boolean[] = [];
    let draws = 0, losses = 0, timeouts = 0, decisionsTotal = 0;
    const lat: number[] = [];
    for (let rep = 0; rep < REPEATS; rep++) {
      for (const [i, seedHex] of seedList.entries()) {
        for (const armSide of ["p1", "p2"] as const) {
          const belief = new Belief(PACK);
          const policy = mkPolicy(arm, PACK, belief, i + rep * 1000);
          if ((i + (armSide === "p1" ? 0 : 1)) % 20 === 0) process.stderr.write(`  ${arm.id} rep${rep} ${i}/${seedList.length}\n`);
          // 换边 + 换精灵双配对：arm 一半坐 gamma 一半坐 delta——消不对称物种优势
          const armGamma = i % 2 === 0;
          const species = armGamma === (armSide === "p1")
            ? { p1: "syn-gamma", p2: "syn-delta" } : { p1: "syn-delta", p2: "syn-gamma" };
          const t0 = Date.now();
          const r = await playGame(PACK, {
            battleId: `btl_ev-${i}-${armSide}`, seedHex, species, bench: { p1: ["syn-epsilon"], p2: ["syn-epsilon"] },
          }, policy, armSide, "rule", 40); // 评测局 ≤40 回合
          const armWon = r.winner === armSide;
          wins.push(armWon);
          if (r.winner === "draw") draws++;
          else if (r.winner === "timeout") timeouts++;
          else if (!armWon) losses++;
          decisionsTotal += r.armDecisions;
          if (r.armDecisions > 0) lat.push(r.armMsTotal / r.armDecisions);
        }
      }
    }
    const ruleRef = ruleResults.length === wins.length ? ruleResults : wins.map(() => false);
    stats.push({
      arm: arm.id,
      games: wins.length, wins: wins.filter(Boolean).length,
      draws, losses, timeouts,
      winrateCI: wilson(wins.filter(Boolean).length, wins.length),
      pairedVsRule: arm.id === "rule" ? { lo: 0, hi: 0, estimate: 0 } : pairedBootstrap(wins, ruleRef),
      decisionMsP95: pct95(lat),
      decisionsTotal,
    });
    if (arm.id === "rule") ruleResults.push(...wins);
    allLat[arm.id] = lat;
  }
  return { stats, repeats: REPEATS, gamesPerArm: GAMES_PER_ARM * REPEATS };
}

// ── 输出 ─────────────────────────────────────────────────────
const mech = await mechanismEval();
console.log(`mechanism holdout: ${mech.holdoutScore}/${mech.holdoutTotal}`);
const abl = await ablationEval();
for (const s of abl.stats) {
  console.log(`${s.arm.padEnd(14)} win ${s.wins}/${s.games} CI[${s.winrateCI.lo.toFixed(3)},${s.winrateCI.hi.toFixed(3)}] vsRule[${s.pairedVsRule.lo.toFixed(3)},${s.pairedVsRule.hi.toFixed(3)}] p95=${s.decisionMsP95.toFixed(1)}ms`);
}

const out = {
  date: new Date().toISOString().slice(0, 10),
  config: { gamesPerArm: abl.gamesPerArm, repeats: REPEATS, quick: QUICK, provider: "echo-mock (无真实 LLM endpoint)" },
  mechanism: mech,
  ablation: abl.stats,
};
mkdirSync(join(ROOT, "artifacts", "m3"), { recursive: true });
writeFileSync(join(ROOT, "artifacts", "m3", "eval-m3.json"), JSON.stringify(out, null, 2));
console.log(`\n→ artifacts/m3/eval-m3.json`);
