/**
 * perf-baseline —— T11 性能基线（记录不门禁）。
 *
 * 测量：
 *   1. compilePack 冷编译耗时（synthetic-v2 全量 pack）
 *   2. 纯引擎 turn 吞吐：固定 seed 对局 applyTurn 延迟 mean/p95/max
 *   3. 全语料 parseEffectText 吞吐（真实 53798 招文本）
 *   4. 全语料编译门禁耗时（schema+ops+status 三层）
 *
 * 结果落 artifacts/perf-baseline.json；非门禁——仅作回归参照。
 * 用法：node tools/perf-baseline.ts
 */
import { performance } from "node:perf_hooks";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { applyTurn, initBattle, legalActions, loadPackFromDir, sha256hex, type CoreState } from "@seer/battle-core";
import { parseEffectText } from "./effects-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifacts", "perf-baseline.json");
const CONTENT = join(ROOT, "content");

const pct = (xs: number[], q: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

// 1. compilePack 冷编译 ×20
let compileStats = { mean: 0, p95: 0 };
{
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    loadPackFromDir(CONTENT, "synthetic-v2");
    xs.push(performance.now() - t0);
  }
  compileStats = { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p95: pct(xs, 0.95) };
  console.log(`compilePack: mean=${compileStats.mean.toFixed(1)}ms p95=${compileStats.p95.toFixed(1)}ms`);
}

// 2. turn 吞吐：synthetic-v2，轮转招位，200 局采样
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const turnLat: number[] = [];
let totalTurns = 0;
{
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) {
    let state: CoreState = initBattle(PACK, {
      battleId: `perf-${i}`, seedHex: sha256hex(`perf${i}`).slice(0, 32),
      p1: "syn-gamma", p2: "syn-delta", bench: { p1: ["syn-epsilon"] },
    });
    for (let t = 1; t <= 60 && (state.terminal ?? null) === null; t++) {
      const pick = (side: "p1" | "p2") => {
        const legal = legalActions(state, side).filter((a) => /^act_(?!concede|switch)/.test(a));
        return { actionId: legal[t % Math.max(1, legal.length)] ?? "act_concede", origin: "player" as const, idempotencyKey: `k${t}${side}` };
      };
      const s0 = performance.now();
      const r = applyTurn(PACK, state, { p1: pick("p1"), p2: pick("p2") });
      turnLat.push(performance.now() - s0);
      if (r.ok) state = r.state; else break;
      totalTurns++;
    }
  }
  const wall = performance.now() - t0;
  console.log(`turns=${totalTurns} wall=${wall.toFixed(0)}ms | turn mean=${(turnLat.reduce((a, b) => a + b, 0) / turnLat.length).toFixed(3)}ms p50=${pct(turnLat, 0.5).toFixed(3)}ms p95=${pct(turnLat, 0.95).toFixed(3)}ms max=${Math.max(...turnLat).toFixed(3)}ms`);
}

// 3. 全语料 parseEffectText 吞吐
let parsed = 0;
{
  const cat = JSON.parse(readFileSync(join(CONTENT, "creatures/creatures.json"), "utf8"));
  const texts: string[] = [];
  for (const c of Object.values(cat.creatures) as { skills?: { effect?: string }[] }[]) {
    for (const s of c.skills ?? []) {
      const t = (s.effect ?? "").trim();
      if (t) texts.push(t);
    }
  }
  const t0 = performance.now();
  for (const t of texts) {
    parseEffectText(t, { hasDamage: true });
    parsed++;
  }
  const wall = performance.now() - t0;
  console.log(`parse corpus=${parsed} skills wall=${wall.toFixed(0)}ms → ${(parsed / (wall / 1000)).toFixed(0)} skills/s (${(wall / parsed).toFixed(3)}ms/skill)`);
}

// 4. 编译门禁整体耗时（子进程口径）
let compileCheckMs = 0;
{
  const t0 = performance.now();
  execSync("node tools/effects-compile-check.ts", { cwd: ROOT, stdio: "pipe" });
  compileCheckMs = performance.now() - t0;
  console.log(`compile-gate wall=${compileCheckMs.toFixed(0)}ms`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  node: process.version,
  metrics: {
    compilePackMeanMs: Number(compileStats.mean.toFixed(1)),
    compilePackP95Ms: Number(compileStats.p95.toFixed(1)),
    turnCount: totalTurns,
    turnMeanMs: Number((turnLat.reduce((a, b) => a + b, 0) / turnLat.length).toFixed(3)),
    turnP50Ms: Number(pct(turnLat, 0.5).toFixed(3)),
    turnP95Ms: Number(pct(turnLat, 0.95).toFixed(3)),
    turnMaxMs: Number(Math.max(...turnLat).toFixed(3)),
    corpusSkills: parsed,
    compileGateMs: Math.round(compileCheckMs),
  },
}, null, 2));
console.log(`→ ${OUT}`);
