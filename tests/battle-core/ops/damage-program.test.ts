/**
 * 命中程序：旧键只在 compileHit 里按源码顺序收成 riders。
 * damage.ts 执行程序，不再读家族键。结算顺序另见 damage-riders.test.ts。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DAMAGE_FAMILIES, DAMAGE_FAMILY_NAMES } from "../../../packages/battle-core/src/ops/damage-keys.ts";
import { compileHit, HIT_READ_ORDER, type DamageFx } from "../../../packages/battle-core/src/ops/damage-program.ts";
import { DRAIN_RIDER_KEYS, groupHitRiders } from "../../../packages/battle-core/src/ops/hit-rider.ts";

const damageSrc = readFileSync(fileURLToPath(new URL("../../../packages/battle-core/src/ops/damage.ts", import.meta.url)), "utf8");

describe("命中程序", () => {
  it("家族键除了没人读的 hitsNoDecay 都进读取表，且每个 (at,键) 只出现一次", () => {
    const seen = new Map<string, number>();
    const pairs = new Set<string>();
    for (const entry of HIT_READ_ORDER) {
      const pair = `${entry.at}:${entry.key}`;
      expect(pairs.has(pair)).toBe(false);
      pairs.add(pair);
      seen.set(entry.key, (seen.get(entry.key) ?? 0) + 1);
    }
    for (const name of DAMAGE_FAMILY_NAMES) {
      for (const key of DAMAGE_FAMILIES[name]) {
        if (key === "hitsNoDecay") {
          expect(seen.has(key)).toBe(false);
          continue;
        }
        expect(seen.has(key), key).toBe(true);
      }
    }
    expect(seen.get("flatRange")).toBe(2);
    expect(seen.get("hits")).toBe(3);
    const keys = HIT_READ_ORDER.map((entry) => entry.key);
    expect(keys.indexOf("selfHp")).toBeLessThan(keys.indexOf("kindIfImmune"));
    expect(keys.indexOf("powerDropPerHit")).toBeGreaterThan(keys.indexOf("useFoeBestOffense"));
    expect(keys.indexOf("powerDropPerHit")).toBeLessThan(keys.indexOf("mulIf"));
    for (const key of DRAIN_RIDER_KEYS) expect(keys, key).not.toContain(key);
    expect(keys.indexOf("flatEcho")).toBeLessThan(keys.indexOf("healOnHit"));
    expect(keys.indexOf("healOnHit")).toBeLessThan(keys.indexOf("stageOnHit"));
    expect(keys.indexOf("stageOnHit")).toBeLessThan(keys.lastIndexOf("hits"));
    expect(keys.indexOf("flatRange")).toBeLessThan(keys.lastIndexOf("flatRange"));
  });

  it("damage.ts 只把效果交给程序，不再读家族键", () => {
    expect(damageSrc.includes("compileHit(")).toBe(true);
    for (const name of DAMAGE_FAMILY_NAMES) {
      for (const key of DAMAGE_FAMILIES[name]) {
        expect(damageSrc.includes(`fx.${key}`), key).toBe(false);
      }
    }
    expect(/(?<![\w.])fx\.power\b/.test(damageSrc)).toBe(false);
    expect(/(?<![\w.])fx\.kind\b/.test(damageSrc)).toBe(false);
    expect(/(?<![\w.])fx\.target\b/.test(damageSrc)).toBe(false);
    for (const key of DRAIN_RIDER_KEYS) expect(damageSrc.includes(`fx.${key}`), key).toBe(false);
  });

  it("多个命中后键收成的顺序是吸血、等量固伤、命中回复、降级", () => {
    const fx: DamageFx = {
      op: "damage",
      kind: "fixed",
      power: 40,
      target: "opponent",
    };
    const list: unknown[] = [
      fx,
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 }, drainEcho: true },
      { op: "applyFlatEcho", flatEcho: {} },
      { op: "applyHealOnHit", healOnHit: { numerator: 1, denominator: 10 } },
      { op: "applyStageOnHit", stageOnHit: [{ stat: "def", delta: -1 }] },
    ];
    expect(groupHitRiders(list)).toBeUndefined();
    expect(list).toEqual([fx]);
    const prog = compileHit(fx);
    expect(prog.power).toBe(40);
    expect(prog.kind).toBe("fixed");
    expect(prog.target).toBe("opponent");
    expect(prog.riders.map((rider) => rider.key)).toEqual(["drain", "drainEcho", "flatEcho", "healOnHit", "stageOnHit"]);
    expect(prog.by.drain.drain).toEqual({ numerator: 1, denominator: 1 });
    expect(prog.by.onHit.stageOnHit).toEqual([{ stat: "def", delta: -1 }]);
  });

  it("单独一条吸血 rider 不能装", () => {
    expect(groupHitRiders([{ op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } }])).toMatch(/没有紧跟/);
  });
});
