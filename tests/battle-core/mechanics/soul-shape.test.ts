/**
 * 触点预算：魂印旗标不再加成员，被动条目不再加字段。
 * 新被动用 hook + ops。要放行第 11 个旗标或第 7 个字段，先改这份名单。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = readFileSync(join(ROOT, "packages/battle-core/src/mechanics/soulmark/index.ts"), "utf8");

const FLAGS = [
  "endure",
  "entry_dispel",
  "hit_shield",
  "immune_control",
  "immune_stage_down",
  "priority_high_hp",
  "revive",
  "turn_flat",
  "turn_heal",
  "turn_pp_restore",
];

const HOOK_KEYS = ["bossGate", "chance", "elseOps", "guard", "hook", "ops"];

function quotedNames(block: string): string[] {
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((hit) => hit[1]).sort();
}

function interfaceBlock(name: string): string {
  const start = SRC.indexOf(`export interface ${name}`);
  const end = SRC.indexOf("\nexport ", start + 1);
  if (start < 0 || end < 0) throw new Error(`missing ${name}`);
  return SRC.slice(start, end);
}

describe("soulmark shape stays closed", () => {
  it("SoulFlagOp 与 schema 枚举都是这十个旗标", () => {
    const opStart = interfaceBlock("SoulFlagOp").indexOf("op:");
    const opEnd = interfaceBlock("SoulFlagOp").indexOf(";", opStart);
    const fromType = quotedNames(interfaceBlock("SoulFlagOp").slice(opStart, opEnd));
    const schema = JSON.parse(readFileSync(join(ROOT, "content/schemas/soulmarks.schema.json"), "utf8")) as {
      definitions: { soulOp: { properties: { op: { enum: string[] } } } };
    };
    const fromSchema = [...schema.definitions.soulOp.properties.op.enum].sort();
    expect(fromType).toEqual(FLAGS);
    expect(fromSchema).toEqual(FLAGS);
  });

  it("SoulHookOp 只剩目标那六个字段", () => {
    const keys = [...interfaceBlock("SoulHookOp").matchAll(/^\s+([A-Za-z]+)\??:/gm)]
      .map((hit) => hit[1])
      .sort();
    expect(keys).toEqual(HOOK_KEYS);
  });
});
