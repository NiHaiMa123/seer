/**
 * damage / attachDamage 键清单。清单外的键必须装载失败。
 * 负例用别的 op 的键（numerator）和没人读的 params，不给 damage 加字段。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { compilePack, PackLoadError } from "@seer/battle-core";
import {
  ATTACH_DAMAGE_KEYS,
  DAMAGE_FAMILIES,
  DAMAGE_FAMILY_NAMES,
  DAMAGE_KEYS,
  damageFamilyDrift,
  damageKeyHits,
  damageManifestDrift,
  type DamageFamilyName,
  unknownAttachDamageKeys,
} from "../../../packages/battle-core/src/ops/damage-keys.ts";
import { OF_RIDER_FIELDS } from "../../../packages/battle-core/src/ops/hit-rider.ts";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

/** 与 schema-sync 同一段 EffectEnvelope，不手抄一份放行名单。 */
const effectEnvelopeKeys = (): Set<string> => {
  const src = readFileSync(fileURLToPath(new URL("../../../packages/battle-core/src/loader.ts", import.meta.url)), "utf8");
  const start = src.indexOf("interface EffectEnvelope");
  const rest = src.slice(start + 1);
  const end = /\nexport |\ninterface [A-Z]/.exec(rest);
  let s = src.slice(start, end === null ? undefined : start + 1 + end.index);
  s = s.replace(/\/\*\*[\s\S]*?\*\//g, "");
  s = s.slice(s.indexOf("{") + 1);
  for (let i = 0; i < 20 && /{[^{}]*}/.test(s); i++) s = s.replace(/{[^{}]*}/g, "");
  const out = new Set<string>();
  for (const m of s.matchAll(/([a-zA-Z_]\w*)\s*\?*:/g)) out.add(m[1]!);
  return out;
};

const cloneFamilies = (): { [K in DamageFamilyName]: string[] } => {
  const out = {} as { [K in DamageFamilyName]: string[] };
  for (const name of DAMAGE_FAMILY_NAMES) out[name] = [...DAMAGE_FAMILIES[name]];
  return out;
};

const base = () => {
  const ruleset = read("rulesets/synthetic-v1.json");
  return {
    ruleset,
    pack: {
      packId: "x", version: "0.0.0", schemaVersion: 1, rulesetId: "synthetic-v1",
      verification: "SYNTHETIC",
      license: { identifier: "CC0-1.0", public: true },
      files: { units: "units.json", moves: "moves.json" } as Record<string, string>,
      assets: [],
    },
    units: {
      units: [{
        id: "u", name: "U",
        base: { hp: 10, atk: 1, def: 1, spd: 1 },
        moveIds: ["m"],
      }],
    },
    moves: { moves: [] as unknown[] },
    soulmarks: undefined as unknown,
  };
};
const mkMove = (effects: unknown[]) => ({ id: "m", name: "M", pp: 5, priority: 0, effects });

describe("damage key list", () => {
  it("清单外的键点名，清单内的键（含信封和 rider）放过", () => {
    expect(unknownAttachDamageKeys({ attachChance: 10, kind: "fixed", power: 1 })).toEqual([]);
    expect(unknownAttachDamageKeys({ foeMaxN: 1, flatBonus: 1 }).sort()).toEqual(["flatBonus", "foeMaxN"]);
    expect(ATTACH_DAMAGE_KEYS).toContain("attachChance");
    expect(DAMAGE_KEYS).not.toContain("attachChance");
    expect(DAMAGE_KEYS).not.toContain("params");
    expect(damageKeyHits([{ op: "damage", power: 1, chance: 10, drain: { numerator: 1, denominator: 2 } }])).toEqual([
      { path: "effects[0]", key: "drain" },
    ]);
    expect(damageKeyHits([
      { op: "damage", power: 1 },
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ])).toEqual([]);
    expect(DAMAGE_KEYS).not.toContain("drain");
    expect(ATTACH_DAMAGE_KEYS).not.toContain("drain");
    expect(damageKeyHits([{ op: "damage", power: 1, numerator: 1 }])).toEqual([
      { path: "effects[0]", key: "numerator" },
    ]);
    expect(damageKeyHits([{
      op: "apply_status",
      payload: [{ op: "damage", power: 1, params: { growPer: 1 } }],
    }])).toEqual([{ path: "effects[0].payload[0]", key: "params" }]);
  });

  it("去掉信封和本体后，清单和九个家族相等", () => {
    expect(damageFamilyDrift({
      memberKeys: new Set(DAMAGE_KEYS),
      envelopeKeys: effectEnvelopeKeys(),
    })).toEqual([]);
  });

  it("类型上多一个 damage 字段但不进恰好一个家族，检查失败", () => {
    const member = new Set(DAMAGE_KEYS);
    member.add("numerator");
    const drift = damageFamilyDrift({ memberKeys: member, envelopeKeys: effectEnvelopeKeys() });
    expect(drift.some((s) => s.includes("numerator") && s.includes("恰好一个家族"))).toBe(true);
  });

  it("一个键进了两个家族就失败", () => {
    const families = cloneFamilies();
    families.power.push("powerAdd");
    families.scale.push("powerAdd");
    const member = new Set(DAMAGE_KEYS);
    member.add("powerAdd");
    const drift = damageFamilyDrift({
      memberKeys: member,
      envelopeKeys: effectEnvelopeKeys(),
      families,
    });
    expect(drift.some((s) => s.includes("powerAdd") && s.includes("power") && s.includes("scale"))).toBe(true);
  });

  it("没人读的 hitsNoDecay 在 strike rider 的 of 上，不在 DAMAGE_KEYS", () => {
    expect(DAMAGE_KEYS).not.toContain("hitsNoDecay");
    expect([...OF_RIDER_FIELDS.strike]).toContain("hitsNoDecay");
    const member = new Set(DAMAGE_KEYS);
    member.add("hitsNoDecay");
    const drift = damageFamilyDrift({
      memberKeys: member,
      envelopeKeys: effectEnvelopeKeys(),
    });
    expect(drift.some((s) => s.includes("hitsNoDecay") && s.includes("恰好一个家族"))).toBe(true);
  });

  it("类型或多放的 schema 键和清单对不上时点名", () => {
    const member = new Set(DAMAGE_KEYS);
    const drift = damageManifestDrift({
      memberKeys: new Set([...member, "numerator"]),
      envelopeKeys: new Set(),
      schemaThen: member,
    });
    expect(drift.some((s) => s.includes("numerator"))).toBe(true);
    const extraThen = damageManifestDrift({
      memberKeys: member,
      envelopeKeys: new Set(),
      schemaThen: new Set([...member, "foeMaxN"]),
    });
    expect(extraThen.some((s) => s.includes("foeMaxN"))).toBe(true);
  });

  it("招式上的 damage 带 numerator，装载失败", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "damage", power: 1, numerator: 1 }])];
    expect(() => compilePack(c)).toThrow(PackLoadError);
    expect(() => compilePack(c)).toThrow(/effects\[0\] damage key "numerator"/);
  });

  it("payload 里的 damage 带 numerator，装载失败", () => {
    const c = base();
    c.moves.moves = [mkMove([{
      op: "apply_status", name: "react", target: "self", turns: 1,
      payload: [{ op: "damage", power: 1, numerator: 1 }],
    }])];
    expect(() => compilePack(c)).toThrow(/effects\[0\]\.payload\[0\] damage key "numerator"/);
  });

  it("魂印 damage 带 numerator，装载失败", () => {
    const c = base();
    c.pack.files.soulmarks = "soulmarks.json";
    c.soulmarks = {
      soulmarks: {
        "sm-a": {
          id: "sm-a", name: "A",
          effects: [{
            hook: "onTurnEnd",
            ops: [{ op: "damage", power: 1, numerator: 1, target: "opponent" }],
          }],
        },
      },
    };
    c.moves.moves = [mkMove([{ op: "damage", power: 1 }])];
    expect(() => compilePack(c)).toThrow(/soulmark sm-a hook onTurnEnd ops\[0\] damage key "numerator"/);
  });

  it("清单内的 damage 仍能装载", () => {
    const c = base();
    c.moves.moves = [mkMove([{ op: "damage", power: 1, chance: 50 }])];
    expect(compilePack(c).movesById.get("m")!.effects[0]).toMatchObject({ op: "damage", power: 1, chance: 50 });
  });

  it("growPer 只进状态 op，不打到 damage 上", () => {
    const { entries } = parseSoulmarkText("每使用2次攻击技能则附加自身最大体力1/4的固定伤害");
    const ops = entries.flatMap((e: { ops?: { op?: string; params?: unknown }[] }) => e.ops ?? []);
    const dmg = ops.filter((o) => o.op === "damage");
    expect(dmg.length).toBeGreaterThan(0);
    for (const op of dmg) expect(op.params).toBeUndefined();
  });
});
