/**
 * 玩家背包包：巅峰常见 12 只为手工条目（装备技 mv-<no>-<0..3>），
 * 其馀为 ≥2500 号图鉴生成单位（pet-<no>[-suffix]，全技能库 mv-...-s<i>）。
 * 自建 syn 包仍留给规则测试，不进这个包。
 * 学习力原文没有拆成六项数字，所以源文件不写 evs；编译默认是 0。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTurn, initBattle, legalActions, loadPackFromDir } from "@seer/battle-core";
import { hitFieldsOf } from "../../../packages/battle-core/src/ops/hit-rider.ts";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "peak");
const SOURCE = JSON.parse(readFileSync(join(CONTENT, "peak", "units.json"), "utf8")).units as {
  id: string; name: string; nature?: string; evs?: unknown; ivs?: unknown; level?: unknown;
  soulMark?: unknown; fifthMoveId?: string; moveIds: string[]; types: string[];
}[];
const MOVES_SRC = JSON.parse(readFileSync(join(CONTENT, "peak", "moves.json"), "utf8")).moves as { id: string }[];
const SEED = "11".repeat(16);
const PEAK12 = [
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
];
const NAMES = [
  "圣灵谱尼", "天启帝君", "光之惩戒·英卡洛斯", "瀚宇星皇", "艾夏拉", "弑序神罗",
  "重生之翼", "启灵元神", "命运之轮·莫伊莱", "帝天战佛", "混元天尊（荒神赋形）", "至序圣华",
];

describe("peak roster", () => {
  it("12 只巅峰常见手工条目不变，生成单位全部可编译", () => {
    expect([...PACK.unitsById.keys()].sort()).toEqual(SOURCE.map((u) => u.id).sort());
    expect(PACK.unitsById.size).toBe(SOURCE.length);
    expect([...PACK.unitsById.keys()].some((id) => id.startsWith("syn-"))).toBe(false);
    const peakSrc = SOURCE.filter((u) => PEAK12.includes(u.id));
    expect(peakSrc.map((u) => u.name).sort()).toEqual([...NAMES].sort());
    for (const u of peakSrc) {
      expect(u.evs).toBeUndefined();
      expect(u.ivs).toBeUndefined();
      expect(u.level).toBeUndefined();
      expect(u.soulMark).toBeUndefined();
      expect(u.nature === "保守" || u.nature === "固执").toBe(true);
      expect(u.types).toHaveLength(1);
      expect(u.moveIds).toHaveLength(4);
      expect(u.moveIds).not.toContain(u.fifthMoveId!);
      const compiled = PACK.unitsById.get(u.id)!;
      expect(compiled.name).toBe(u.name);
      expect(compiled.nature).toBe(u.nature);
      expect(compiled.types).toEqual(u.types);
      expect(compiled.level).toBe(100);
      expect(compiled.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, sdf: 0, spd: 0 });
      expect(compiled.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, sdf: 31, spd: 31 });
      expect(compiled.soulMark).toBeUndefined();
      const fifth = PACK.movesById.get(u.fifthMoveId!)!;
      expect(fifth.fifth).toBe(true);
      expect(fifth.name).not.toBeUndefined();
    }
    // 生成单位：moveIds 全部可解析、fifth 只挂 fifthMoveId、魂印引用有效
    for (const u of SOURCE) {
      for (const mid of u.moveIds) {
        const mv = PACK.movesById.get(mid);
        expect(mv, `${u.id} moveId ${mid}`).toBeDefined();
        expect(mv!.fifth).not.toBe(true);
      }
      if (u.fifthMoveId) expect(PACK.movesById.get(u.fifthMoveId)!.fifth).toBe(true);
    }
    expect(PACK.movesById.get("mv-5000-0")?.name).toBe("光荣之梦");
    expect(PACK.movesById.size).toBe(MOVES_SRC.length);
  });

  it("R5：璨星断刃「出手时若自身满体力则技能威力提升100%」收成 power rider，分组后仍在这一击上", () => {
    const dmg = PACK.movesById.get("mv-3577-3")!.effects.find((e) => e.op === "damage")!;
    expect(hitFieldsOf(dmg).scaleIf).toEqual({ when: { selfHpFull: true }, numerator: 200, denominator: 100 });
  });

  it("沿用药剂规则：开局按上限填满，用一次少一个", () => {
    const s = initBattle(PACK, { battleId: "btl_peak", seedHex: SEED, p1: "pet-5000", p2: "pet-3550" });
    expect(s.sides.p1.stocks).toEqual({ "pp-20": 5, "pp-5": 5, "hp-200": 5, "hp-250": 5, cure: 5 });
    expect(legalActions(s, "p1", PACK)).toContain("act_item-hp-200");
    const r = applyTurn(PACK, s, {
      p1: { actionId: "act_item-hp-200", origin: "player", idempotencyKey: "k-hp" },
      p2: { actionId: "act_mv-3550-0", origin: "player", idempotencyKey: "k-mv" },
    });
    if (!r.ok) throw new Error(`${r.fault.reason} ${r.fault.message}`);
    expect(r.state.sides.p1.stocks?.["hp-200"]).toBe(4);
  });
});
