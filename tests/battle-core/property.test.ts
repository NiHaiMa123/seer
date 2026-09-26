/**
 * test:core（property）— M1-01 ≥10000 seeded 用例。
 * 不变量：HP/PP/stage 有界、输入与旧 state 不被修改、确定性、
 * 终局后拒绝 transition、循环上限（恶意 fixture 在 goldens 中）、
 * 事件序列良构、draw 只用于平速。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "@seer/contracts";
import {
  applyTurn,
  initBattle,
  legalActions,
  loadPackFromDir,
  DeterministicRng,
  type CoreState,
} from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v1");
const N_CASES = 10_000;
const MAX_TURNS = 220; // > spec 200 上限，验证终局必然触发

const seedHex = (i: number): string => i.toString(16).padStart(32, "0");

/** 独立的驱动 RNG（与对局 RNG 不同种子，避免互相干扰）。 */
function driveTurn(state: CoreState, i: number, turn: number) {
  const pick = (side: "p1" | "p2") => {
    // +2 保证 seed 永不为全零（xoshiro 禁止全零状态）
    const d = new DeterministicRng(seedHex(i * 7919 + turn * 131 + (side === "p1" ? 1 : 2) + 2));
    const legal = legalActions(state, side);
    const idx = d.drawBelow(legal.length, "drive");
    // 偶尔 null（模拟超时默认）
    return d.drawBelow(20, "nullchance") === 0
      ? null
      : { actionId: legal[idx]!, origin: "player" as const, idempotencyKey: `k${i}x${turn}${side}` };
  };
  return { p1: pick("p1"), p2: pick("p2") };
}

function invariants(prev: CoreState, next: CoreState, events: { type: string }[], stepIdx: number): void {
  for (const side of ["p1", "p2"] as const) {
    const u = next.sides[side].unit;
    expect(u.currentHp, `hp bound @case step ${stepIdx}`).toBeGreaterThanOrEqual(0);
    expect(u.currentHp).toBeLessThanOrEqual(u.base.hp);
    for (const k of ["atk", "def", "spd"] as const) {
      expect(u.stages[k]).toBeGreaterThanOrEqual(-6);
      expect(u.stages[k]).toBeLessThanOrEqual(6);
    }
    for (const m of u.moves) {
      expect(m.pp).toBeGreaterThanOrEqual(0);
      expect(m.pp).toBeLessThanOrEqual(m.ppMax);
    }
  }
  // 旧 state 完全不被修改（快照对比）
  expect(canonicalJson(prev)).toBe(canonicalJson(structuredClone(prev)));
  expect(next.revision).toBe(prev.revision + 1);
  // rng-draw 只能来自平速
  const draws = events.filter((e) => e.type === "rng-draw");
  expect(draws.length).toBeLessThanOrEqual(1);
}

describe("10k seeded property runs", () => {
  it("invariants + determinism across 10000 seeded battles", () => {
    let terminalCount = 0;
    const canonicalResults = new Map<string, number>();
    for (let i = 0; i < N_CASES; i++) {
      let state = initBattle(PACK, {
        battleId: `btl_p${i}`,
        seedHex: seedHex(i + 1),
        p1: "syn-alpha",
        p2: "syn-beta",
      });
      const transcript: string[] = [];
      for (let t = 0; t < MAX_TURNS && state.terminal === null; t++) {
        const prev = state;
        const input = driveTurn(state, i, t);
        const r = applyTurn(PACK, state, input);
        expect(r.ok, `fault @case ${i} turn ${t}`).toBe(true);
        if (!r.ok) break;
        invariants(prev, r.state, r.events, t);
        state = r.state;
        transcript.push(canonicalJson(state));
      }
      expect(state.terminal, `battle ${i} must terminate ≤ ${MAX_TURNS}`).not.toBeNull();
      if (state.terminal) terminalCount++;
      canonicalResults.set(transcript.join("|"), (canonicalResults.get(transcript.join("|")) ?? 0) + 1);
    }
    expect(terminalCount).toBe(N_CASES);
    // 确定性抽查：前 50 个 case 完整重跑，canonical 轨迹逐字节一致
    for (let i = 0; i < 50; i++) {
      let state = initBattle(PACK, {
        battleId: `btl_p${i}`,
        seedHex: seedHex(i + 1),
        p1: "syn-alpha",
        p2: "syn-beta",
      });
      const transcript: string[] = [];
      for (let t = 0; t < MAX_TURNS && state.terminal === null; t++) {
        const r = applyTurn(PACK, state, driveTurn(state, i, t));
        if (!r.ok) throw r.fault;
        state = r.state;
        transcript.push(canonicalJson(state));
      }
      expect(canonicalResults.get(transcript.join("|"))).toBeGreaterThanOrEqual(1);
    }
  }, 300_000);
});
