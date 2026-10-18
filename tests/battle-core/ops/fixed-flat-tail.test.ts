/**
 * fixed 类伤害也要累加 flat.tail 段的固伤。
 *
 * damage.ts 的 `kind === "fixed"` 分支只查了 `hidesPower`（"威力被固伤取代"），
 * 完全跳过 flat.tail。于是「下次使用技能给对手造成等同于恢复量的固定伤害」这类
 * damage{kind:fixed,power:0} + flat{of:flatSelfLastHeal} 恒为 0：
 *   soulmark-fifth-v2 › react{trigger:11,count:1} + flatSelfLastHeal 失败。
 *
 * 语义：fixed 的 power 是基数，flat.tail 是在它之上追加的固伤。
 */
import { describe, it, expect } from "vitest";
import { initBattle, applyTurn, loadPackFromDir } from "@seer/battle-core";
import { join } from "node:path";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");
const SEED = "11".repeat(16);
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const evs = (r: any, type: string) => (r.ok ? (r.events ?? []).filter((e: any) => e.type === type) : []);
/** 收窄 applyTurn 的 union 结果：失败即抛，成功返回带 state 的分支。 */
const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};

describe("fixed + flatSelfLastHeal", () => {
  it("react 载荷的固伤等于上次恢复量", () => {
    const s = initBattle(PACK, {
      battleId: "b1", seedHex: SEED, p1: "syn-gamma", p2: "syn-delta",
      mechanics: { soulmark: { p1: ["sm-reactwin"] } },
    });
    s.sides.p1.unit.currentHp = 200;
    s.sides.p2.unit.currentHp = 5000;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-jab"), p2: act("act_syn-jab") }));
    const healAmt = evs(r1, "heal").find((e: any) => e.detail.side === "p1")?.detail.amount as number;
    expect(healAmt).toBe(60);

    const r2 = applyTurn(PACK, r1.state, { p1: act("act_syn-strike"), p2: act("act_syn-strike") });
    const fixed = evs(r2, "damage").filter((e: any) => e.detail.damageKind === "fixed");
    expect(fixed.length).toBeGreaterThan(0);
    // 基数是恢复量；同回合的 dmg_boost 会再放大，故断言不小于恢复量。
    expect(fixed.some((e: any) => e.detail.side === "p2" && (e.detail.amount as number) >= healAmt)).toBe(true);
  });
});
