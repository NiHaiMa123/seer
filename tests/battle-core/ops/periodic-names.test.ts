/**
 * 触点预算：periodic 轴不再加具名周期。
 * 新回合窗发 name:"periodic"。要放行第七个名字，先改这份名单。
 */
import { describe, expect, it } from "vitest";
import { EFFECT_DEFS } from "../../../packages/battle-core/src/ops/effects.ts";
import { periodicFormOf } from "../../../packages/battle-core/src/ops/periodic.ts";

const NAMED = ["doom", "dot_field", "drain_dot", "foe_dot", "hot", "pp_drain"];

describe("periodic names stay closed", () => {
  it("轴上只有六个具名周期，外加名字 periodic", () => {
    const names = Object.entries(EFFECT_DEFS)
      .filter(([, def]) => def.periodic === "params")
      .map(([name]) => name)
      .sort();
    expect(names).toEqual([...NAMED, "periodic"].sort());
  });

  it("只有这六个名字在挂载时脱糖", () => {
    for (const name of NAMED) {
      expect(periodicFormOf({ op: "apply_status", name, target: "self" }), name).toBeDefined();
    }
    expect(periodicFormOf({ op: "apply_status", name: "periodic", target: "self", params: { win: 0 } })).toBeUndefined();
    expect(periodicFormOf({ op: "apply_status", name: "stage_tick", target: "self" })).toBeUndefined();
  });
});
