/**
 * 无视对手速度：先制打平后不比速度。
 * 断言行动顺序（pp-spent / 平速抽签），不看终态体力。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTurn, compilePack, initBattle, sha256hex } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

const NOSPEED = {
  id: "syn-nospeed",
  name: "抢拍",
  pp: 20,
  priority: 0,
  type: "草",
  category: "physical" as const,
  ignoreFoeSpeed: true,
  effects: [{ op: "damage", power: 20 }],
};

const PACK = compilePack({
  ruleset: read("rulesets/synthetic-v2.json"),
  pack: read("synthetic-v2/pack.json"),
  units: { units: read("synthetic-v2/units.json").units.map((u: { moveIds: string[] }) => ({ ...u, moveIds: [...new Set([...u.moveIds, NOSPEED.id, "syn-jab"])] })) },
  moves: { moves: [...read("synthetic-v2/moves.json").moves, NOSPEED] },
  typeChart: read("rulesets/typechart.json"),
  natures: read("rulesets/natures.json"),
  soulmarks: read("synthetic-v2/soulmarks.json"),
  seals: read("seals/seals.json"),
  items: read("synthetic-v2/items.json"),
});

const start = (seed: string) => initBattle(PACK, { battleId: "b", seedHex: seed, p1: "syn-gamma", p2: "syn-delta" });
const turn = (seed: string, a: string, b: string, i: number) => {
  const r = applyTurn(PACK, start(seed), {
    p1: { actionId: `act_${a}`, origin: "player", idempotencyKey: `spd${i}aaaaaaa` },
    p2: { actionId: `act_${b}`, origin: "player", idempotencyKey: `spd${i}bbbbbbb` },
  });
  if (!r.ok) throw new Error(`turn fault ${r.fault.code}: ${r.fault.message}`);
  return r;
};
const firstSide = (events: { type: string; detail?: { side?: string } }[]) =>
  events.find((e) => e.type === "pp-spent")?.detail?.side;
const tiebreak = (events: { type: string; detail?: { purpose?: string } }[]) =>
  events.some((e) => e.type === "rng-draw" && e.detail?.purpose === "order_tiebreak");

describe("无视对手速度", () => {
  it("双方都不带旗标时，较快的一方先手，不抽平速", () => {
    const r = turn("aa".repeat(16), "syn-strike", "syn-strike", 1);
    expect(tiebreak(r.events)).toBe(false);
    expect(firstSide(r.events)).toBe("p2");
  });

  it("只有较慢的一方无视速度时，该方先手", () => {
    const r = turn("aa".repeat(16), "syn-nospeed", "syn-strike", 2);
    expect(tiebreak(r.events)).toBe(false);
    expect(firstSide(r.events)).toBe("p1");
  });

  it("先制仍高于无视速度", () => {
    const r = turn("aa".repeat(16), "syn-nospeed", "syn-jab", 3);
    expect(tiebreak(r.events)).toBe(false);
    expect(firstSide(r.events)).toBe("p2");
  });

  it("双方都无视速度时走平速抽签，较慢的一方也能先手", () => {
    let slowerFirst = 0;
    for (let i = 0; i < 8; i++) {
      const r = turn(sha256hex(`nospeed${i}`).slice(0, 32), "syn-nospeed", "syn-nospeed", 10 + i);
      expect(tiebreak(r.events)).toBe(true);
      const draw = r.events.find((e) => e.type === "rng-draw" && e.detail?.purpose === "order_tiebreak") as { rngDraw?: { value: number } } | undefined;
      const winner = (draw?.rngDraw?.value ?? 0) < 0x80000000 ? "p1" : "p2";
      expect(firstSide(r.events)).toBe(winner);
      if (winner === "p1") slowerFirst++;
    }
    expect(slowerFirst).toBeGreaterThan(0);
  });
});
