import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT, stable, buildPpFill, compilePetSkills, buildablePets, assemble, classifyEffects, classifyMoves, isKeptMoveId } from "../../../tools/pet-roster-shared.ts";
import type { CreatureRow, CompiledMove } from "../../../tools/pet-roster-shared.ts";

/**
 * 技能侧定点同步工具（tools/sync-moves.mjs）的口径测试。
 *
 * 三件事必须锁住：
 * 1. **moveId 映射**：非第五 → `mv-<suffix>-s<i>`；第五技能若是攻击技 → `mv-<suffix>-f`
 *    （此时该技能不再单独产出 s<i>）；巅峰装备技不重编译。
 * 2. **定点同步 ≡ 整库重建**：sync-moves 编译的条目必须与 build-pet-roster 产出的逐字相同——
 *    口径来自 pet-roster-shared 的同一份实现，测试用「定点编译 == 包内现有条目」来验证。
 * 3. **stable() 的 undefined 语义**：「键存在但值为 undefined」与「键不存在」必须判为相同
 *    （JSON.stringify 省略 undefined；渲染成 null 会造成误判，实测误判过 7 条技能条目）。
 */
const cat = JSON.parse(readFileSync(join(ROOT, "content/creatures/creatures.json"), "utf8")) as { creatures: Record<string, CreatureRow> };
const packMoves = JSON.parse(readFileSync(join(OUT, "moves.json"), "utf8")).moves as CompiledMove[];
const packById = new Map<string, CompiledMove>(packMoves.map((m) => [m.id, m]));

const PEAK_ROSTER = new Set([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);
const keptMoveIds = new Set<string>(
  packMoves.filter((m) => isKeptMoveId(m.id, PEAK_ROSTER)).map((m) => m.id),
);
const ppFill = buildPpFill(cat);

function compilePet(petId: string) {
  const hit = buildablePets(cat).find((x) => x.c.id === petId);
  if (hit === undefined) throw new Error(`no buildable pet ${petId}`);
  return compilePetSkills(hit.c, { type: hit.type, keptMoveIds, ppFill, report: {} });
}

describe("stable()：undefined 键与缺失键等价", () => {
  it("值为 undefined 的键不渲染成 null", () => {
    expect(stable({ a: 1, params: undefined })).toBe(stable({ a: 1 }));
    expect(stable({ a: 1, params: undefined })).not.toBe(stable({ a: 1, params: null }));
  });

  it("键序无关", () => {
    expect(stable({ a: 1, b: 2 })).toBe(stable({ b: 2, a: 1 }));
  });
});

describe("技能 moveId 映射", () => {
  it("完整变体不被基形手工装备技规则吞掉", () => {
    expect(isKeptMoveId("mv-3788-f", PEAK_ROSTER)).toBe(true);
    expect(isKeptMoveId("mv-3788-0", PEAK_ROSTER)).toBe(true);
    expect(isKeptMoveId("mv-3788-b-f", PEAK_ROSTER)).toBe(false);
    expect(isKeptMoveId("mv-3788-b-s6", PEAK_ROSTER)).toBe(false);
    const entries = compilePet("pet-3788-b").entries;
    expect(entries).toHaveLength(17);
    const hit = entries.find((e) => e.moveId === "mv-3788-b-s6");
    expect(hit?.move.effects).toContainEqual({ op: "apply_stat_stage", stat: "acc", delta: 2, target: "self" });
    expect(packById.get("mv-3788-b-s6")).toEqual(hit?.move);
  });

  it("非第五技能走 mv-<suffix>-s<下标>", () => {
    const compiled = compilePet("pet-3323");
    const ids = compiled.entries.map((e) => e.moveId);
    expect(ids).toContain("mv-3323-s0");
    expect(ids.some((i) => i.startsWith("mv-3323-s"))).toBe(true);
  });

  it("第五技能（攻击技）改判为 mv-<suffix>-f，且不再单独产出 s<i>", () => {
    const c = Object.values(cat.creatures).find((x) => x.id === "pet-3323");
    const compiled = compilePet("pet-3323");
    const fifthName = compiled.fifthName;
    expect(fifthName).toBeDefined();
    const ids = compiled.entries.map((e) => e.moveId);
    // 第五技能的原始下标不应再出现为 s<i>
    const fifthIdx = (c?.skills ?? []).findIndex((s) => s.name === fifthName);
    expect(fifthIdx).toBeGreaterThanOrEqual(0);
    expect(ids).not.toContain(`mv-3323-s${fifthIdx}`);
    expect(ids).toContain("mv-3323-f");
  });

  it("巅峰装备技不参与重编译", () => {
    // 巅峰 12 只的装备技 id 形如 mv-<petNo>-0..3/-f（不是 s<i>），不在编译产物里
    const compiled = compilePet("pet-5000");
    const ids = compiled.entries.map((e) => e.moveId);
    expect(ids.some((i) => /^mv-5000-[0-3]$/.test(i))).toBe(false);
  });
});

describe("同步分桶保留完整执行语义", () => {
  const heal = { op: "heal", flat: 100, target: "self" };
  const damage = { op: "hp_delta", flat: 100, target: "self" };
  it("回复和损失不能判为等价", () => {
    expect(classifyEffects([heal], [damage])).toBe("differ");
    expect(classifyEffects([{ hook: "onTurnEnd", ops: [heal] }], [{ hook: "onTurnEnd", ops: [damage] }])).toBe("differ");
  });
  it("概率、boss门控、else以及条目边界都参与比较", () => {
    const entry = { hook: "onDamaged", ops: [heal] };
    for (const changed of [{ ...entry, chance: { base: 50 } }, { ...entry, bossGate: true }, { ...entry, elseOps: [damage] }]) {
      expect(classifyEffects([entry], [changed])).toBe("differ");
    }
    expect(classifyEffects([{ ...entry, ops: [heal, damage] }], [entry, { ...entry, ops: [damage] }])).toBe("differ");
  });
  it("操作顺序和重复次数不能被集合去重掩盖", () => {
    expect(classifyEffects([heal, damage], [damage, heal])).toBe("differ");
    expect(classifyEffects([heal, heal], [heal])).toBe("fewer");
    expect(classifyEffects([heal], [heal, heal])).toBe("more");
    expect(classifyEffects([heal], [{ target: "self", flat: 100, op: "heal", chance: undefined }])).toBe("equiv");
  });
  it("技能先制和类别变化也不能被算作仅形状等价", () => {
    const move = { id: "mv-test", name: "测试", pp: 5, priority: 0, type: "普通", effects: [heal] };
    expect(classifyMoves(move, { ...move, priority: 1 })).toBe("differ");
    expect(classifyMoves(move, { ...move, category: "physical" })).toBe("differ");
  });
});

describe("属性技不能合成攻击宿主", () => {
  it("孤儿伤害修饰留在报告，不生成 power:0 的物理攻击", () => {
    const report = { orphanHitRiders: [] as { moveId: string; ops: string[] }[] };
    const move = assemble("mv-status-floor", "普通", { name: "属性地板", kind: "属性", pp: 5, power: null, effect: "造成的伤害不少于200；自身攻击+1" }, false, report);
    expect(move.category).toBeUndefined();
    expect(move.effects.some((e) => e.op === "damage" || e.op === "cap")).toBe(false);
    expect(move.effects).toContainEqual({ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" });
    expect(report.orphanHitRiders).toEqual([{ moveId: "mv-status-floor", ops: ["cap"] }]);
  });
});

describe("定点同步 ≡ 整库重建（口径一致）", () => {
  it("包内条目与定点编译产物逐字相同（内容包已与解析器对齐）", () => {
    const samples = ["pet-3323", "pet-2887", "pet-3423", "pet-3209", "pet-2929", "pet-4719"];
    let checked = 0;
    for (const petId of samples) {
      const compiled = compilePet(petId);
      for (const se of compiled.entries) {
        const stored = packById.get(se.moveId);
        if (stored === undefined) continue;
        expect(stable(stored)).toBe(stable(se.move));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("命中等级（acc）维度在包里不是空缺", () => {
    // 「100%改变自身命中等级+1」这类写法解析器早已支持，但规则包 stats 白名单曾漏掉 acc，
    // 导致包里长期没有这个维度（3203 条技能缺该效果）
    const compiled = compilePet("pet-4715");
    const hit = compiled.entries.find((e) => e.moveId === "mv-4715-s1");
    expect(hit).toBeDefined();
    expect(JSON.stringify(hit?.move.effects)).toContain('"stat":"acc"');
  });
});
