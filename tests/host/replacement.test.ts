/**
 * M2-03 协议层：replacement decision 走完 Host——单 actor、幂等、超时默认、
 * 对方无权提交、终局观察。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleHost } from "../../packages/host/src/host.ts";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00000000000000000000000000000007";

function mkHost(): BattleHost {
  const h = new BattleHost({
    pack: PACK,
    battleId: "btl_repl",
    seedHex: SEED,
    species: { p1: "syn-epsilon", p2: "syn-delta" },
    bench: { p2: ["syn-gamma"] },
    players: { p1: "A", p2: "B" },
    deadlineMs: 30000,
  });
  return h;
}
const cmd = (decisionId: string, baseRevision: number, actionId: string, key: string) =>
  ({ battleId: "btl_repl", decisionId, baseRevision, actionId, idempotencyKey: key });

describe("replacement decision 协议", () => {
  it("KO→replacement→resume 全链路；非 actor 无权提交；幂等重放同 receipt", () => {
    const h = mkHost();
    // six-stat：epsilon 面板 atk317 → strike 对 delta ~52-62/回合；delta hp332+复活166 → ~9 回合 KO。
    // 循环打到 replacement 决策出现（上限防死循环）。
    let decR: { decisionId: string; baseRevision: number; kind: string; actors?: string[] } | undefined;
    let oR!: ReturnType<typeof h.observe>;
    for (let i = 0; i < 40 && decR === undefined; i++) {
      const d = h.observe("A").decision;
      if (!d || d.kind !== "turn") break;
      h.submit("A", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-aaaa${String(i).padStart(4, "0")}`));
      h.submit("B", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-bbbb${String(i).padStart(4, "0")}`));
      oR = h.observe("B");
      if (oR.decision?.kind === "replacement") decR = oR.decision;
    }
    expect(decR).toBeDefined();
    expect(decR!.kind).toBe("replacement");
    expect(decR!.kind).toBe("replacement");
    expect(decR!.actors).toEqual(["p2"]);
    // 己方 bench 可见 + 合法集是 act_switch-0 + concede
    expect(oR.own.bench).toHaveLength(1);
    expect(oR.own.bench![0]!.speciesId).toBe("syn-gamma");
    expect(oR.own.bench![0]!.ppByMoveId).toEqual({ "syn-strike": 35, "syn-jab": 30, "syn-hex": 10, "syn-blast": 20 });
    expect(oR.own.bench![0]!.stages).toEqual({ atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 });
    expect(oR.own.bench![0]!.effects).toEqual([]);
    expect(oR.legalActions.some((a) => a.actionId === "act_switch-0")).toBe(true);
    // A 不是 actor
    const oA = h.observe("A");
    expect(oA.decision).toBeNull();
    expect(oA.legalActions).toEqual([]);
    expect(oA.opponent.benchAlive).toBe(1);
    const rBad = h.submit("A", cmd(decR!.decisionId, decR!.baseRevision, "act_switch-0", "k-aaaa9999"));
    if (rBad.ok) throw new Error("non-actor submission unexpectedly succeeded");
    expect(rBad.error.code).toBe("UNAUTHORIZED");

    // B 提交换入 epsilon
    const rOK = h.submit("B", cmd(decR!.decisionId, decR!.baseRevision, "act_switch-0", "k-bbbb9000"));
    expect(rOK.ok).toBe(true);
    // 幂等重放
    const rDup = h.submit("B", cmd(decR!.decisionId, decR!.baseRevision, "act_switch-0", "k-bbbb9000"));
    if (!rDup.ok) throw rDup.error;
    expect(rDup.receipt.status).toBe("duplicate-replay");
    // 换入完成，回到 collect
    const oAfter = h.observe("B");
    expect(oAfter.own.speciesId).toBe("syn-gamma");
    expect(oAfter.decision?.kind).toBe("turn");
  });

  it("replacement 决策超时 → 默认最低下标存活 bench", () => {
    const h = mkHost();
    // 快进到挂起（six-stat 伤害低，~19 回合 KO+复活消耗）
    let oR!: ReturnType<typeof h.observe>;
    for (let i = 0; i < 40; i++) {
      const d = h.observe("A").decision;
      if (!d || d.kind !== "turn") break;
      h.submit("A", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-a${String(i).padStart(4, "0")}x`));
      h.submit("B", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-b${String(i).padStart(4, "0")}x`));
      oR = h.observe("B");
      if (oR.decision?.kind === "replacement") break;
    }
    expect(oR.decision?.kind).toBe("replacement");
    h.expireDecision(); // B 不提交 → timeout → 默认 act_switch-0
    const oAfter = h.observe("B");
    expect(oAfter.own.speciesId).toBe("syn-gamma");
  });
});
