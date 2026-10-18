/**
 * prioZero 条件谓词：「双方每有1方精灵先制为0」。
 *
 * 语义（用户确认）：读**本回合的实际先制**，不是面板 move.priority。
 * 实际先制 = 基础 priority + prio_up 窗 + priorityIf + priorityMin + 机制钩子 + …
 * （engine.ts 的 prio(s)）。
 *
 * 现有 cond 里只有 selfPrioAbove / foeMovePrioAbove，读的都是**基础** priority，
 * 所以"先制提升"窗让它变成非 0 的情况测不出来。这个谓词必须读实际值。
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir, initBattle, applyTurn } from "@seer/battle-core";
import { join } from "node:path";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");
const SEED = "11".repeat(16);
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });

describe("prioZero 谓词", () => {
  it("引擎在排序后记录双方本回合实际先制", () => {
    const s = initBattle(PACK, { battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    const r = applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") });
    expect(r.ok).toBe(true);
    // 记录在 unit 上，供后续 cond 读取
    const p1 = (r as { state: { sides: { p1: { unit: { turnPrio?: number } } } } }).state.sides.p1.unit;
    const p2 = (r as { state: { sides: { p2: { unit: { turnPrio?: number } } } } }).state.sides.p2.unit;
    expect(typeof p1.turnPrio).toBe("number");
    expect(typeof p2.turnPrio).toBe("number");
  });

  it("普通招式先制为 0 时 turnPrio 记 0", () => {
    const s = initBattle(PACK, { battleId: "b2", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    // syn-strike 无先制词条（syn-jab 实际是 priority:1，不能用来测 0）
    const r = applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    expect(r.ok).toBe(true);
    const st = (r as { state: { sides: Record<string, { unit: { turnPrio?: number } }> } }).state;
    expect(st.sides["p1"]!.unit.turnPrio).toBe(0);
  });

  it("带先制的招式 turnPrio 反映实际值（不是 0）", () => {
    const s = initBattle(PACK, { battleId: "b3", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta" });
    // 找一条带 priority 的招
    const withPrio = [...PACK.movesById.values()].find((m) => (m.priority ?? 0) > 0 && m.category !== undefined);
    expect(withPrio, "样例包应有带先制的招").toBeDefined();
    const r = applyTurn(PACK, s, { p1: act(`act_${withPrio!.id}`), p2: act("act_syn-jab") });
    expect(r.ok).toBe(true);
    const st = (r as { state: { sides: Record<string, { unit: { turnPrio?: number } }> } }).state;
    expect(st.sides["p1"]!.unit.turnPrio).toBeGreaterThan(0);
  });
});
