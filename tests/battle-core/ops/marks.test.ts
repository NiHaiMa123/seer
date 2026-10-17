/**
 * S4 印记栈行为测试：apply_mark/consume_mark + markCount 谓词 + 印记缩放 + 固伤免疫/kindIfImmune。
 * fixture 均 synthetic-v2 注入测试招（syn-mark*），语义 SYNTHETIC——只验证机制骨架。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  applyTurn, compilePack, initBattle, loadPackFromDir,
  type CoreState, type FrozenPack,
} from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const SEED = "22222222222222222222222222222222";
const PACK: FrozenPack = loadPackFromDir(CONTENT, "synthetic-v2");

const ok = (r: ReturnType<typeof applyTurn>) => {
  if (!r.ok) throw new Error(`fault: ${r.fault.reason} ${r.fault.message}`);
  return r;
};
const act = (id: string) => ({ actionId: id, origin: "player" as const, idempotencyKey: `k-${id}-xxxxxxx` });
const mk = (): CoreState => initBattle(PACK, { battleId: "btl_mark", seedHex: SEED, p1: "syn-markcaster", p2: "syn-marktank" });
const unitMark = (s: CoreState, side: "p1" | "p2", mark: string) =>
  s.sides[side].unit.effects.find((e) => e.kind === `mark:${mark}`)?.params?.count ?? 0;
const slotMarks = (s: CoreState, side: "p1" | "p2", mark: string) => {
  const mm = s.sides[side].unit.moveMarks ?? {};
  return Object.values(mm).reduce((a, rec) => a + (rec[`mark:${mark}`] ?? 0), 0);
};
const fieldCount = (s: CoreState, side: "p1" | "p2", mark: string) =>
  (s.sides[side].fieldMarks ?? []).find((e) => e.kind === `mark:${mark}`)?.count ?? 0;
const fieldKinds = (s: CoreState, side: "p1" | "p2") => new Set((s.sides[side].fieldMarks ?? []).map((e) => e.kind)).size;
const dmgEv = (r: { ok: boolean; events?: { type: string; detail: Record<string, unknown> }[] }, side: string) =>
  (r.ok ? (r.events ?? []).filter((e) => e.type === "damage" && e.detail.side === side) : []);

describe("S4 印记：unit 叠层与 cap", () => {
  it("裂痕逐层叠加至 cap=3 封顶", () => {
    let s = mk();
    for (let i = 0; i < 4; i++) {
      const r = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
      s = r.state!;
    }
    expect(unitMark(s, "p2", "裂痕")).toBe(3); // 4 次施加被 cap=3 封顶
  });
  it("consume_mark count=1 每层递减", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
    s = r0.state!;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
    s = r1.state!;
    expect(unitMark(s, "p2", "裂痕")).toBe(2);
    const r2 = ok(applyTurn(PACK, s, { p1: act("act_syn-markconsume"), p2: act("act_syn-strike") }));
    expect(unitMark(r2.state!, "p2", "裂痕")).toBe(1);
  });
});

describe("S4 印记：slot 槽位散布", () => {
  it("pick:randomMove 逐层落到对手招式槽", () => {
    const s = mk();
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-markslot"), p2: act("act_syn-strike") }));
    expect(slotMarks(r.state!, "p2", "致命印记")).toBe(2); // count:2 → 两层各落一槽
    const mm = r.state!.sides.p2.unit.moveMarks ?? {};
    const occupied = Object.values(mm).filter((rec) => (rec["mark:致命印记"] ?? 0) > 0).length;
    expect(occupied).toBeGreaterThanOrEqual(1);
    expect(occupied).toBeLessThanOrEqual(2); // 可能同槽叠层
  });
  it("KO 时槽位印记随单位消亡清理", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-markslot"), p2: act("act_syn-strike") }));
    s = r0.state!;
    expect(slotMarks(s, "p2", "致命印记")).toBe(2);
    s.sides.p2.unit.currentHp = 1;
    s.sides.p2.unit.revives = 0;
    const r1 = applyTurn(PACK, s, { p1: act("act_syn-markflat"), p2: act("act_syn-strike") });
    const st = (r1.ok ? r1.state : s)!;
    const corpse = (st.sides.p2.bench ?? []).find((u) => u.currentHp <= 0) ?? st.sides.p2.unit;
    expect(corpse.currentHp).toBe(0);
    expect(corpse.moveMarks).toBeUndefined(); // KO 清理槽位印记
  });
});

describe("S4 印记：field 场地印记", () => {
  it("fieldMarks 叠 count + turns 到期消散", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-markfield"), p2: act("act_syn-strike") }));
    s = r0.state!;
    expect(fieldCount(s, "p1", "金之肃革")).toBe(1);
    expect(fieldKinds(s, "p1")).toBe(2); // 两种场地印记
    // turns:2：施加回合不减，第 2 回合末到期（remainingTurns 归零→消散）
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    s = r1.state!;
    const r2 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-strike") }));
    s = r2.state!;
    expect(fieldKinds(s, "p1")).toBe(0);
  });
});

describe("S4 印记：count 谓词与缩放", () => {
  it("markCountAtLeast n:2 门控 stage 增幅", () => {
    let s = mk();
    // 0 层 → if 不满足
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-markcond"), p2: act("act_syn-strike") }));
    expect(r0.state!.sides.p1.unit.stages.atk).toBe(0);
    s = r0.state!;
    // 叠 2 层裂痕
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
    s = r1.state!;
    const r2 = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
    s = r2.state!;
    expect(unitMark(s, "p2", "裂痕")).toBe(2);
    const r3 = ok(applyTurn(PACK, s, { p1: act("act_syn-markcond"), p2: act("act_syn-strike") }));
    expect(r3.state!.sides.p1.unit.stages.atk).toBe(2);
  });
  it("flatPerMark 每层+50 固伤", () => {
    let s = mk();
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") }));
    s = r1.state!;
    const r2 = ok(applyTurn(PACK, s, { p1: act("act_syn-markflat"), p2: act("act_syn-strike") }));
    const d1 = dmgEv(r2, "p2").reduce((a, e) => a + (e.detail.amount as number), 0);
    s = r2.state!;
    const r2b = ok(applyTurn(PACK, s, { p1: act("act_syn-markunit"), p2: act("act_syn-strike") })); // 叠到 2 层
    s = r2b.state!;
    const r3 = ok(applyTurn(PACK, s, { p1: act("act_syn-markflat"), p2: act("act_syn-strike") }));
    const d2 = dmgEv(r3, "p2").reduce((a, e) => a + (e.detail.amount as number), 0);
    // 第 2 发时对手 2 层 → 固伤部分 +100；差值应恰为 50
    expect(d2 - d1).toBe(50);
  });
  it("mulPerMark kinds 按双方场地种类数乘算", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-markfield"), p2: act("act_syn-strike") }));
    s = r0.state!;
    expect(fieldKinds(s, "p1")).toBe(2);
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-markscalemul"), p2: act("act_syn-strike") }));
    const d = dmgEv(r1, "p2")[0];
    expect(d).toBeDefined();
    // 2 种场地印记 → ×(100+25×2)/100 = ×1.5
    const dNoMark = dmgEv(ok(applyTurn(PACK, mk(), { p1: act("act_syn-markscalemul"), p2: act("act_syn-strike") })), "p2")[0]!;
    expect(d!.detail.amount).toBeGreaterThan((dNoMark.detail.amount as number));
  });
});

describe("S4 固伤免疫 + kindIfImmune", () => {
  it("flat_immune 免疫 fixed/percent 伤害（推 protected）", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-flatim") }));
    s = r0.state!;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-flatdmg"), p2: act("act_syn-strike") }));
    expect(dmgEv(r1, "p2")).toHaveLength(0); // 固伤被免疫——无伤害事件
  });
  it("kindIfImmune percent→250点真实伤害", () => {
    let s = mk();
    const r0 = ok(applyTurn(PACK, s, { p1: act("act_syn-strike"), p2: act("act_syn-flatim") }));
    s = r0.state!;
    const r1 = ok(applyTurn(PACK, s, { p1: act("act_syn-pctkii"), p2: act("act_syn-strike") }));
    const d = dmgEv(r1, "p2")[0];
    expect(d).toBeDefined();
    expect(d!.detail.amount).toBe(250); // 免疫百分比 → 转为 250 点真实伤害
    expect(d!.detail.damageKind).toBe("true");
  });
  it("无免疫时 kindIfImmune 不触发（百分比照常）", () => {
    const s = mk();
    const maxHp = s.sides.p2.unit.base.hp;
    const r = ok(applyTurn(PACK, s, { p1: act("act_syn-pctkii"), p2: act("act_syn-strike") }));
    const d = dmgEv(r, "p2")[0];
    expect(d).toBeDefined();
    expect(d!.detail.amount).toBe(Math.floor(maxHp / 4)); // percent=对手最大体力1/4
    expect(d!.detail.damageKind).toBe("percent");
  });
});
