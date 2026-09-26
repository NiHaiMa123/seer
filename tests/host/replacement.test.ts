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
    species: { p1: "syn-gamma", p2: "syn-delta" },
    bench: { p2: ["syn-epsilon"] },
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
    // 打到 p2 delta 濒死：delta 90hp，gamma strike ~floor(40×45/40)=45 → 2 回合 KO
    const o1 = h.observe("A");
    const dec1 = o1.decision!;
    h.submit("A", cmd(dec1.decisionId, dec1.baseRevision, "act_syn-strike", "k-aaaa0000"));
    h.submit("B", cmd(dec1.decisionId, dec1.baseRevision, "act_syn-strike", "k-bbbb0000"));
    const o2 = h.observe("A");
    const dec2 = o2.decision!;
    expect(dec2.kind).toBe("turn");
    h.submit("A", cmd(dec2.decisionId, dec2.baseRevision, "act_syn-strike", "k-aaaa0001"));
    h.submit("B", cmd(dec2.decisionId, dec2.baseRevision, "act_syn-strike", "k-bbbb0001"));

    // 第 3 回合 KO delta → replacement 决策只开给 B
    const o3 = h.observe("A");
    const dec3 = o3.decision!;
    h.submit("A", cmd(dec3.decisionId, dec3.baseRevision, "act_syn-strike", "k-aaaa0002"));
    h.submit("B", cmd(dec3.decisionId, dec3.baseRevision, "act_syn-strike", "k-bbbb0002"));

    const oR = h.observe("B");
    const decR = oR.decision!;
    expect(decR.kind).toBe("replacement");
    expect(decR.actors).toEqual(["p2"]);
    // 己方 bench 可见 + 合法集是 act_switch-0 + concede
    expect(oR.own.bench).toHaveLength(1);
    expect(oR.own.bench![0]!.speciesId).toBe("syn-epsilon");
    expect(oR.legalActions.some((a) => a.actionId === "act_switch-0")).toBe(true);
    // A 不是 actor
    const oA = h.observe("A");
    expect(oA.decision).toBeNull();
    const rBad = h.submit("A", cmd(decR.decisionId, decR.baseRevision, "act_switch-0", "k-aaaa9999"));
    expect(rBad.ok).toBe(false);

    // B 提交换入 epsilon
    const rOK = h.submit("B", cmd(decR.decisionId, decR.baseRevision, "act_switch-0", "k-bbbb9000"));
    expect(rOK.ok).toBe(true);
    // 幂等重放
    const rDup = h.submit("B", cmd(decR.decisionId, decR.baseRevision, "act_switch-0", "k-bbbb9000"));
    expect(rDup.ok).toBe(true);
    expect(rDup.receipt.status).toBe("duplicate-replay");
    // 换入完成，回到 collect
    const oAfter = h.observe("B");
    expect(oAfter.own.speciesId).toBe("syn-epsilon");
    expect(oAfter.decision?.kind).toBe("turn");
  });

  it("replacement 决策超时 → 默认最低下标存活 bench", () => {
    const h = mkHost();
    // 快进到挂起
    for (let i = 0; i < 3; i++) {
      const o = h.observe("A");
      const d = o.decision!;
      h.submit("A", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-a${i}xxxx`));
      h.submit("B", cmd(d.decisionId, d.baseRevision, "act_syn-strike", `k-b${i}xxxx`));
    }
    const oR = h.observe("B");
    expect(oR.decision?.kind).toBe("replacement");
    h.expireDecision(); // B 不提交 → timeout → 默认 act_switch-0
    const oAfter = h.observe("B");
    expect(oAfter.own.speciesId).toBe("syn-epsilon");
  });
});
