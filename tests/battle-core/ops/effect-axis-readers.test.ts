/**
 * 轴上没有读取的状态名必须失败。负例用假名字，不写进 EFFECT_DEFS。
 */
import { describe, expect, it } from "vitest";
import { battleTypesOf } from "../../../packages/battle-core/src/ops/effects.ts";
import { unreadEffectAxes, unreadEffectAxesFromRepo, type AxisScanInput } from "../../../tools/effect-axis-readers.ts";

const READ = [
  'effectDefOf(e.kind)?.ailment',
  'effectDefOf(e.kind)?.dmgShield',
  'e.kind === "react"',
  'e.kind === "periodic"',
  "export const immuneOn",
  "immuneOn(",
  "export const reflectOn",
  "reflectOn(",
  'isMod(e, "counter")',
].join("\n");

function scan(over: Partial<AxisScanInput> & Pick<AxisScanInput, "defs">): string[] {
  return unreadEffectAxes({
    src: READ,
    applySrc: "fx.random",
    periodicForm: () => ({ ok: true }),
    axesForm: (name) => {
      const def = over.defs[name];
      if (def?.immune === "params") return { kind: "immune" };
      if (def?.reflect === "params") return { kind: "reflect" };
      if (def?.modifier === "params") return { kind: "modifier", at: "counter" };
      return undefined;
    },
    ...over,
  }).map((m) => m.name);
}

describe("effect axis readers", () => {
  it("仓库里的每个状态名都落在已有读取的一根轴上", () => {
    expect(unreadEffectAxesFromRepo()).toEqual([]);
  });

  it("负例：只有中文名、第二根 reactive、脱糖失败、槽位没人读，都点名", () => {
    expect(scan({ defs: { random: {}, orphan: {} } })).toEqual(["orphan"]);
    expect(scan({ defs: { random: {} }, applySrc: "" })).toEqual(["random"]);
    expect(scan({ defs: { react: { reactive: "params" }, echo: { reactive: "params" } } })).toEqual(["echo"]);
    expect(scan({
      defs: { ghost_tick: { periodic: "params" } },
      periodicForm: () => undefined,
    })).toEqual(["ghost_tick"]);
    expect(scan({
      defs: { hole: { modifier: "params" } },
      axesForm: () => undefined,
    })).toEqual(["hole"]);
    expect(scan({
      defs: { hole: { modifier: "params" } },
      axesForm: () => ({ kind: "modifier", at: "noSuchSlot" }),
    })).toEqual(["hole"]);
    expect(scan({ defs: { both: { ailment: true, modifier: "params" } } })).toEqual(["both"]);
  });
});

describe("type_swap / type_copy 槽位", () => {
  const pack = {
    unitsById: new Map<string, { types?: string[] }>([
      ["a", { types: ["火"] }],
      ["b", { types: ["水"] }],
    ]),
  };
  const foe = { speciesId: "b", effects: [] as { kind: string; at?: string }[] };

  it("typeSwap 对调，typeCopy 只改持有者，裸 kind 不再改系别", () => {
    const swap = { speciesId: "a", effects: [{ kind: "modifier", at: "typeSwap" }] };
    expect(battleTypesOf(pack, swap, foe)).toEqual(["水"]);
    expect(battleTypesOf(pack, foe, swap)).toEqual(["火"]);
    const copy = { speciesId: "a", effects: [{ kind: "modifier", at: "typeCopy" }] };
    expect(battleTypesOf(pack, copy, foe)).toEqual(["水"]);
    expect(battleTypesOf(pack, foe, copy)).toEqual(["水"]);
    expect(battleTypesOf(pack, { speciesId: "a", effects: [{ kind: "type_swap" }] }, foe)).toEqual(["火"]);
  });
});
