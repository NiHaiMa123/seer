/**
 * 编译器发出的键必须落在已经封住的 IR 上。
 * 清单外的键和插错规则顺序一样算失败，不扫全量语料。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import {
  MOVE_FLAG_KEYS,
  effectKeyHits,
  flagKeyHits,
  loadIrAllow,
  soulEntryKeyHits,
  type IrAllow,
} from "../../../tools/ir-keys.ts";

describe("compiler IR keys", () => {
  const allow = loadIrAllow();

  it("heal 的 numerator 在清单内，damage 上的 numerator 不在", () => {
    expect(effectKeyHits([{ op: "heal", numerator: 1, denominator: 2, target: "self" }], allow)).toEqual([]);
    expect(effectKeyHits([{ op: "damage", power: 1, numerator: 1 }], allow)).toEqual([
      { path: "effects[0]", key: "numerator" },
    ]);
  });

  it("powerRandom 不是招式旗标", () => {
    expect(MOVE_FLAG_KEYS).not.toContain("powerRandom");
    expect(MOVE_FLAG_KEYS).toContain("priorityMin");
    expect(flagKeyHits({ powerRandom: true, priority: 1 })).toEqual(["powerRandom"]);
    expect(flagKeyHits({ priority: 1, attachDamage: { powerRange: { min: 1, max: 2 } } })).toEqual([]);
  });

  it("cleanse 认 effect，不认 ailment", () => {
    expect(allow.ops.get("cleanse")?.has("effect")).toBe(true);
    expect(allow.ops.get("cleanse")?.has("ailment")).toBe(false);
    expect(effectKeyHits([{ op: "cleanse", effect: "burn", scope: "ailment", target: "opponent" }], allow)).toEqual([]);
    expect(effectKeyHits([{ op: "cleanse", ailment: "burn", target: "opponent" }], allow)).toEqual([
      { path: "effects[0]", key: "ailment" },
    ]);
  });

  it("damage 的 power、kind 和信封 if 在清单内", () => {
    expect(effectKeyHits([{ op: "damage", power: 40, kind: "fixed", target: "opponent", if: { selfHpBelowPct: 50 } }], allow)).toEqual([]);
  });

  it("注入的清单缺 power 时点名", () => {
    const narrow: IrAllow = {
      ops: new Map([["damage", new Set(["op", "kind"])]]),
      envelope: new Set(["if"]),
      hookKeys: new Set(),
      flagOpKeys: new Set(),
    };
    expect(effectKeyHits([{ op: "damage", power: 1, kind: "fixed", if: { selfHpBelowPct: 50 } }], narrow)).toEqual([
      { path: "effects[0]", key: "power" },
    ]);
  });

  it("嵌套 payload 上的越界键也点名，未知 op 留给 UNKNOWN_OP", () => {
    expect(effectKeyHits([{
      op: "apply_status",
      name: "react",
      payload: [{ op: "heal", power: 1, target: "self" }],
    }], allow)).toEqual([{ path: "effects[0].payload[0]", key: "power" }]);
    expect(effectKeyHits([{ op: "not_an_op", numerator: 1 }], allow)).toEqual([]);
  });

  it("魂印 hook 认 chance，flag 认 endure，两边都不认清单外的键", () => {
    expect(soulEntryKeyHits([{ hook: "onTurnEnd", chance: 50, ops: [] }], allow)).toEqual([]);
    expect(soulEntryKeyHits([{ hook: "onTurnEnd", foeMaxN: 1 }], allow)).toEqual([
      { path: "effects[0]", key: "foeMaxN" },
    ]);
    expect(soulEntryKeyHits([{ op: "endure" }], allow)).toEqual([]);
    expect(soulEntryKeyHits([{ neither: true }], allow)).toEqual([
      { path: "effects[0]", key: "shape" },
    ]);
    expect(effectKeyHits(
      [{ op: "damage", power: 1, params: { growPer: 1 } }],
      allow,
      "effects[0].ops",
    )).toEqual([{ path: "effects[0].ops[0]", key: "params" }]);
  });

  it("改过的三句不再发出清单外的键", () => {
    const power = parseEffectText("威力随机，随机范围140~220");
    expect(power.effects).toEqual([{ op: "power", of: "powerRange", value: { min: 140, max: 220 } }]);
    expect((power.flags as { attachDamage?: unknown }).attachDamage).toBeUndefined();
    expect(flagKeyHits(power.flags as object)).toEqual([]);
    expect(effectKeyHits(power.effects, allow)).toEqual([]);

    const bare = parseEffectText("威力随机");
    expect((bare.flags as { powerRandom?: boolean }).powerRandom).toBeUndefined();
    expect(bare.unparsed).toEqual([{ clause: "<powerRandom>", reason: "random power without range" }]);

    const miss = parseEffectText("对手下1次攻击技能必定MISS");
    expect(miss.effects).toEqual([{ op: "apply_status", name: "must_miss_atk", target: "self" }]);
    expect(effectKeyHits(miss.effects, allow)).toEqual([]);

    const cvt = parseEffectText("令对手所处的烧伤转化为焚烬");
    expect(cvt.effects).toEqual([
      { op: "cleanse", scope: "ailment", effect: "burn", target: "opponent" },
      { op: "apply_status", name: "ember", target: "opponent" },
    ]);
    expect(effectKeyHits(cvt.effects, allow)).toEqual([]);
  });
});
