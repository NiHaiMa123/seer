import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

type SourceCreature = { id: string; name: string; soulMark?: { text?: string | null } };
type SourceCatalog = { creatures: Record<string, SourceCreature> };
type ParsedOp = { op: string; name?: string; params?: Record<string, unknown>; stack?: boolean; payload?: ParsedOp[]; [key: string]: unknown };
type ParsedEntry = { hook: string; ops?: ParsedOp[]; guard?: Record<string, unknown>; bossGate?: boolean };
type ParsedMark = { entries: ParsedEntry[]; unparsed: { clause?: string; reason?: string }[] };
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")) as SourceCatalog;

function parse(id: string) {
  const creature = catalog.creatures[id];
  if (creature === undefined || creature.id !== id || creature.soulMark?.text == null) throw new Error(`missing exact source row ${id}`);
  return parseSoulmarkText(creature.soulMark.text, creature.name) as unknown as ParsedMark;
}

function reactEntries(id: string) {
  return parse(id).entries.flatMap((entry) => entry.hook === "onBattleStart"
    ? (entry.ops ?? []).filter((op) => op.op === "apply_status" && op.name === "react")
    : []);
}

function mustReact(id: string, index = 0): ParsedOp {
  const op = reactEntries(id)[index];
  if (op === undefined) throw new Error(`missing react entry ${index} for ${id}`);
  return op;
}

describe("明确纯使用技能魂印的源到IR边界", () => {
  it("技能生效后转移强化与失败扣血属于同一个onMoveUsed条目", () => {
    const r = parse("pet-3006");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{
      hook: "onMoveUsed", guard: { actor: "self" }, ops: [
        { op: "transfer_stages", direction: "upToDown" },
        { op: "hp_delta", target: "opponent", frac: { numerator: 1, denominator: 4, of: "max" }, kind: "percent", if: { not: { prevApplied: true } } },
      ],
    }]);
  });

  it("生效后转移家族按原文分数编译，不绑定精灵ID或固定数值", () => {
    const r = parseSoulmarkText("使用技能时将自身相应的能力提升赋予给对手相应的能力下降（技能生效后触发），若未触发效果则减少对手2/5最大HP");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.hook).toBe("onMoveUsed");
    expect(r.entries[0]?.ops?.[1]).toMatchObject({ op: "hp_delta", frac: { numerator: 2, denominator: 5, of: "max" }, if: { not: { prevApplied: true } } });
  });

  it("把本轮10个获批ID的即时使用语句转为独立react窗口", () => {
    const expectedReactCounts: Record<string, number> = {
      "pet-2708": 1,
      "pet-2831": 1,
      "pet-2837": 1,
      "pet-2923": 2,
      "pet-3060": 1,
      "pet-3144": 1,
      "pet-3271": 2,
      "pet-3647": 1,
      "pet-3791": 1,
      "pet-3802": 1,
    };
    for (const [id, count] of Object.entries(expectedReactCounts)) {
      expect(reactEntries(id), id).toHaveLength(count);
      expect(reactEntries(id).every((react) => react.params?.["trigger"] === 11 && react.stack === true), id).toBe(true);
    }
    expect(mustReact("pet-2708")).toMatchObject({
      params: { trigger: 11 },
      payload: [{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self", chance: 10 }],
    });
    expect(mustReact("pet-2831")).toMatchObject({ params: { trigger: 11, cat: 4 }, payload: [{ op: "cleanse", scope: "timed", chance: 50 }] });
    expect(mustReact("pet-2837")).toMatchObject({ params: { trigger: 11, cat: 4 }, payload: [{ op: "damage", kind: "fixed", power: 200, chance: 50 }] });
    const percentCurrentHp = mustReact("pet-2923");
    expect(percentCurrentHp.params?.["cat"]).toBe(4);
    expect(percentCurrentHp.payload).toEqual([
      { op: "damage", kind: "percent", power: 1, target: "opponent" },
      { op: "formula", of: "percentBase", value: "current" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
    ]);
    expect(reactEntries("pet-2923").map((react) => react.params?.["cat"])).toEqual([4, 1]);
    expect(mustReact("pet-3060")).toMatchObject({ params: { trigger: 11, cat: 4 }, payload: [{ op: "apply_status", name: "burn" }] });
    expect(mustReact("pet-3144")).toMatchObject({ params: { trigger: 11, cat: 4 }, payload: [{ op: "heal", flat: 150 }] });
    expect(reactEntries("pet-3271").map((react) => react.params?.["cat"])).toEqual([4, 1]);
  });

  it.each([
    { id: "pet-3647", pct: 20, cap: 30 },
    { id: "pet-3791", pct: 20, cap: 30 },
    { id: "pet-3802", pct: 25, cap: 35 },
  ] as const)("$id 最终IR把成长帧置于吸取原子前，参数不误走概率成长", ({ id, pct, cap }) => {
    const parsed = parse(id);
    const react = mustReact(id);
    expect(react.params).toEqual({ trigger: 11, cat: 4 });
    expect(react.payload).toEqual([
      { op: "grow", of: "magnitude", step: 5, magCap: cap },
      {
        op: "hp_delta",
        target: "opponent",
        frac: { numerator: pct, denominator: 100, of: "max" },
        kind: "percent",
        cause: "soulmark:absorb",
        healSelf: { numerator: 1, denominator: 1, of: "dealt" },
      },
    ]);
    expect(react.params).not.toHaveProperty("growStep");
    expect(react.params).not.toHaveProperty("growCap");
    if (id === "pet-3791") {
      expect(parsed.entries.some((entry) => entry.hook === "onMoveUsed" && entry.guard?.cat === 1)).toBe(true);
      expect(parsed.unparsed.some((u) => u.reason?.includes("delayed or later-action effect"))).toBe(true);
    }
  });

  it("保留缺少动态boss门控通道的两枚魂印原条目", () => {
    for (const id of ["pet-2770", "pet-2862"]) {
      const parsed = parse(id);
      expect(reactEntries(id), id).toHaveLength(0);
      expect(parsed.entries.length, id).toBe(id === "pet-2770" ? 1 : 2);
      expect(parsed.entries.every((entry) => entry.hook === "onMoveUsed" && entry.bossGate === true), id).toBe(true);
      expect(parsed.unparsed.every((u) => u.reason?.includes("boss gate cannot persist")), id).toBe(true);
    }
  });

  it("‘自身每次使用技能’与裸形同样在出招前评估概率", () => {
    const own = parseSoulmarkText("自身每次使用技能有30%令对手害怕");
    const bare = parseSoulmarkText("每次使用技能有30%令对手害怕");
    expect(own.entries).toEqual(bare.entries);
    expect(own.entries).toMatchObject([{
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "react", params: { trigger: 11 }, stack: true,
        payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 30 }] }],
    }]);
    expect(own.unparsed).toHaveLength(0);
  });

  it("damage+heal不是同一次原子负载：预防KO后跳过回血", () => {
    const parsed = parseSoulmarkText("自身使用技能时吸取对手200点体力");
    expect(parsed.entries.some((entry) => (entry.ops ?? []).some((op) => op.op === "apply_status" && op.name === "react"))).toBe(false);
    expect(parsed.entries).toMatchObject([{
      hook: "onMoveUsed",
      guard: { actor: "self" },
      ops: [{ op: "damage", kind: "fixed", power: 200 }, { op: "heal", flat: 200, target: "self" }],
    }]);
    expect(parsed.unparsed.some((fragment) => fragment.reason?.includes("additional guard, limit, linked trigger, or payload"))).toBe(true);
  });

  it.each([
    { source: "每次使用攻击技能后附加200点固定伤害" },
    { source: "攻击技能命中后附加200点固定伤害" },
    { source: "首次使用攻击技能时附加200点固定伤害" },
    { source: "使用攻击技能时下次攻击造成的伤害提升50%", deferred: true },
    { source: "使用攻击技能时使自身下2回合造成的伤害提升50%", deferred: true, retainedMoveHook: true },
    { source: "每次使用技能时令自身下次攻击必定打出致命一击", deferred: true },
    { source: "每次使用技能后接下来2回合造成的伤害提升30%" },
    { source: "接下来2回合每次使用攻击技能时恢复100点体力", residual: true },
    { source: "所有攻击技能附加200点固定伤害" },
    { source: "每次使用攻击技能时，若自身满血则恢复100点体力" },
  ])("复杂或不同语义仍不进入普通使用窗口：$source", ({ source, deferred, residual, retainedMoveHook }) => {
    const parsed = parseSoulmarkText(source);
    expect(parsed.entries.flatMap((entry) => entry.ops ?? []).some((op) => op?.op === "apply_status" && op.name === "react")).toBe(false);
    if (deferred) {
      expect(parsed.unparsed.some((fragment) => fragment.reason?.includes("delayed or later-action effect"))).toBe(true);
    }
    if (retainedMoveHook) {
      const moveEntry = parsed.entries.find((entry) => entry.hook === "onMoveUsed");
      expect(moveEntry?.ops).toMatchObject([{ op: "apply_status", name: "dmg_boost", params: { pct: 50 } }]);
    }
    if (residual) expect(parsed.unparsed).toHaveLength(1);
  });
});
