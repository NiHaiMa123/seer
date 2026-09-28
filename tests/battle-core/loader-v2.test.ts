/**
 * M2-01：synthetic-v2 内容编译层。
 * - v2 pack 编译通过（全部新 op + bench/revives/mode 元数据进 FrozenPack）
 * - feature 门禁：v1 ruleset 下新 op/damageKind/revives/mode 全部拒绝
 * - 未知 op 拒绝（既有纪律回归）
 * - "新普通单位只加数据"：同包内新增纯 JSON 单位 → 编译通过零代码改动
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { compilePack, loadPackFromDir, PackLoadError } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK_V2 = loadPackFromDir(CONTENT, "synthetic-v2");
const PACK_V1 = loadPackFromDir(CONTENT, "synthetic-v1");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

const V1_RULESET = () => read("rulesets/synthetic-v1.json");
const V2_RULESET = () => read("rulesets/synthetic-v2.json");
const V2_PACK = () => read("synthetic-v2/pack.json");
const V2_UNITS = () => read("synthetic-v2/units.json");
const V2_MOVES = () => read("synthetic-v2/moves.json");

describe("v2 compile", () => {
  it("synthetic-v2 compiles with all new ops + features", () => {
    expect(PACK_V2.rules.rulesetId).toBe("synthetic-v2");
    expect(PACK_V2.features.has("bench")).toBe(true);
    expect(PACK_V2.features.has("control")).toBe(true);
    expect(PACK_V2.modeOverlays.get("boss")).toEqual({ immuneControl: true, immuneClearStages: true });
    expect(PACK_V2.movesById.get("syn-slam")!.effects[0]).toEqual({ op: "damage", kind: "true", power: 30 });
    expect(PACK_V2.movesById.get("syn-drain")!.effects[0]).toEqual({ op: "transfer_stages" });
    expect(PACK_V2.movesById.get("syn-hex")!.effects[0]).toEqual({ op: "control", name: "stun", turns: 1, target: "opponent" });
    expect(PACK_V2.unitsById.get("syn-delta")!.revives).toBe(1);
    expect(PACK_V2.unitsById.get("syn-epsilon")!.mode).toBe("boss");
    expect(PACK_V2.limits.maxBenchSize).toBe(2);
  });

  it("v1 pack unchanged: no features, no overlays", () => {
    expect(PACK_V1.features.size).toBe(0);
    expect(PACK_V1.modeOverlays.size).toBe(0);
  });
});

describe("feature gating (v1 ruleset rejects v2 semantics)", () => {
  const base = (ruleset = V1_RULESET(), rulesetId = "synthetic-v1") => ({
    ruleset,
    pack: {
      packId: "x", version: "0.0.0", schemaVersion: 1, rulesetId,
      verification: "SYNTHETIC",
      license: { identifier: "CC0-1.0", public: true },
      files: { units: "units.json", moves: "moves.json" }, assets: [],
    },
    units: {
      units: [{
        id: "u", name: "U",
        base: { hp: 10, atk: 1, def: 1, spd: 1, ...(ruleset.statModel === "six-stat" ? { spa: 1, sdf: 1 } : {}) },
        moveIds: ["m"],
        ...(ruleset.typeChartFile !== undefined ? { types: ["火"] } : {}),
      }],
    },
    moves: { moves: [] as unknown[] },
    ...(ruleset.typeChartFile !== undefined ? { typeChart: read(`rulesets/${ruleset.typeChartFile}`) } : {}),
    ...(ruleset.naturesFile !== undefined ? { natures: read(`rulesets/${ruleset.naturesFile}`) } : {}),
  });
  const mkMove = (effects: unknown[], type?: string, ruleset?: { statModel?: string }) => ({
    id: "m", name: "M", pp: 5, priority: 0, effects,
    ...(type !== undefined ? { type } : {}),
    ...(ruleset?.statModel === "six-stat" && effects.some((e) => (e as { op?: string; kind?: string }).op === "damage" && ((e as { kind?: string }).kind ?? "standard") !== "percent" && (e as { kind?: string }).kind !== "fixed") ? { category: "physical" } : {}),
  });

  it("transfer_stages under v1 → fail", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "transfer_stages" }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("control under v1 → fail", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "control", name: "stun", turns: 1, target: "opponent" }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("damage kind:true under v1 → fail", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "damage", kind: "true", power: 30 }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("revives under v1 → fail", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["revives"] = 1;
    c.moves.moves = [mkMove([{ op: "damage", power: 1 }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("mode under v1 → fail", () => {
    const c = base();
    (c.units.units[0] as Record<string, unknown>)["mode"] = "boss";
    c.moves.moves = [mkMove([{ op: "damage", power: 1 }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("unknown op still fails", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "mind_control" }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
  });
  it("unit mode without overlay entry → fail", () => {
    const rs = V2_RULESET();
    const c = base(rs, "synthetic-v2");
    (c.units.units[0] as Record<string, unknown>)["mode"] = "ghost";
    c.moves.moves = [mkMove([{ op: "damage", power: 1 }], "火", rs)];
    expect(() => compilePack(c)).toThrow(/mode "ghost"/);
  });
  it("bench feature without maxBenchSize → fail", () => {
    const ruleset = V2_RULESET();
    delete ruleset.limits.maxBenchSize;
    const c = base(ruleset, "synthetic-v2");
    c.moves.moves = [mkMove([{ op: "damage", power: 1 }], "火", ruleset)];
    expect(() => compilePack(c)).toThrow(/maxBenchSize/);
  });
});

describe("new unit = data only", () => {
  it("dropping a plain JSON unit into v2 pack compiles with zero code change", () => {
    const units = V2_UNITS();
    units.units.push({
      id: "syn-zeta",
      name: "Zeta",
      base: { hp: 100, atk: 30, def: 30, spa: 30, sdf: 30, spd: 30 },
      types: ["草"],
      moveIds: ["syn-strike", "syn-recover"],
    });
    const pack = compilePack({ ruleset: V2_RULESET(), pack: V2_PACK(), units, moves: V2_MOVES(), typeChart: read("rulesets/typechart.json"), natures: read("rulesets/natures.json") });
    expect(pack.unitsById.has("syn-zeta")).toBe(true);
    // contentHash 变化——"数据即内容"，hash 改变证明数据确实进入 artifact
    expect(pack.rules.contentHash).not.toBe(PACK_V2.rules.contentHash);
  });
});
