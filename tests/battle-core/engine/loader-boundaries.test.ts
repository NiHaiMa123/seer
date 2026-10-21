import { describe, expect, it } from "vitest";
import { compilePack } from "@seer/battle-core";
import { soulmarkMechanic } from "../../../packages/battle-core/src/mechanics/soulmark/index.ts";
import pack from "../../../content/synthetic-v1/pack.json" with { type: "json" };
import ruleset from "../../../content/rulesets/synthetic-v1.json" with { type: "json" };
import units from "../../../content/synthetic-v1/units.json" with { type: "json" };
import moves from "../../../content/synthetic-v1/moves.json" with { type: "json" };

const raw = (effects: unknown[]) => ({
  pack: structuredClone(pack), units: structuredClone(units),
  ruleset: { ...structuredClone(ruleset), features: ["control"], operatorAllowlist: [...ruleset.operatorAllowlist, "apply_status", "applyDrainRider"] },
  moves: { moves: structuredClone(moves.moves).map((m) => m.id === "syn-strike" ? { ...m, effects } : m) },
});

describe("内容编译边界", () => {
  it("反应 payload 中的 op 同样受 allowlist 限制", () => {
    const input = raw([{ op: "apply_status", name: "react", target: "self", turns: 2, params: { trigger: 1 }, payload: [{ op: "hp_delta", target: "opponent", flat: 1 }] }]);
    expect(() => compilePack(input)).toThrow(/allowlist/);
  });
  it("嵌套 op 即使在 allowlist 中，也不能绕过 feature", () => {
    const input = raw([{ op: "apply_status", name: "react", target: "self", turns: 2, params: { trigger: 1 }, payload: [{ op: "pp_delta", target: "self", amount: 1 }] }]);
    input.ruleset.operatorAllowlist.push("pp_delta");
    expect(() => compilePack(input)).toThrow(/resource_ops/);
  });
  it("编译不改写原始 rider 文档，也不冻结调用方的对象", () => {
    const input = raw([{ op: "damage", power: 40 }, { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } }]);
    const before = JSON.stringify(input);
    const one = compilePack(input), two = compilePack(input);
    expect(one.rules).toEqual(two.rules);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input.ruleset.limits)).toBe(false);
  });
  it("魂印字典键与 id 不一致不能被 Map 重建掩盖", () => {
    expect(() => soulmarkMechanic.compile!({
      raw: { pack: { files: { soulmarks: "soulmarks.json" } }, soulmarks: { soulmarks: { "sm-key": { id: "sm-different", name: "test", effects: [{ op: "immune_control" }] } } } },
      ruleset: {}, fail: (message): never => { throw new Error(message); },
    })).toThrow(/key.*!=.*id/);
  });
});
