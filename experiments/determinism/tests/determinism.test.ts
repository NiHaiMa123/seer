/**
 * test:determinism — M0-04 门禁（≥20 边界向量）。
 * 覆盖：RNG 算法向量/种子边界/拒绝采样边界、canonical 键序/NFC/拒绝非法值、
 * SHA-256 与独立实现交叉验证、transition 原子性/输入冻结/排序确定性、safe integer。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@seer/contracts";
import { DeterministicRng } from "../src/rng.ts";
import { sha256hex } from "../src/sha256.ts";
import { damageOf, EngineFault, transition, type FxInput, type FxState } from "../src/transition-fixture.ts";
import vectors from "../vectors.json" with { type: "json" };

const SEED_A = "0123456789abcdef0123456789abcdef";

/** Independent BigInt reference implementation of xoshiro128** (different arithmetic path). */
function refXoshiro(seedHex: string, count: number): number[] {
  const w = [0, 1, 2, 3].map((i) => BigInt("0x" + seedHex.slice(i * 8, i * 8 + 8)));
  const M = 0xffffffffn;
  const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & M;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = Number((rotl((w[1] * 5n) & M, 7n) * 9n) & M);
    const t = (w[1] << 17n) & M;
    w[2] ^= w[0];
    w[3] ^= w[1];
    w[1] ^= w[2];
    w[0] ^= w[3];
    w[2] ^= t;
    w[3] = rotl(w[3], 11n);
    out.push(res);
  }
  return out;
}

const baseState = (): FxState => ({
  turn: 0,
  units: {
    a: { id: "a", hp: 100, maxHp: 100, atk: 40, def: 30, spd: 50 },
    b: { id: "b", hp: 100, maxHp: 100, atk: 35, def: 30, spd: 50 },
  },
  ko: null,
});
const baseInput = (): FxInput => ({
  actions: { a: { kind: "attack", power: 40 }, b: { kind: "attack", power: 55 } },
});

describe("sha256 (pure impl) — independent vectors + node:crypto cross-check", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "The quick brown fox jumps over the lazy dog",
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    ],
  ])("known vector %j", (input, expected) => {
    expect(sha256hex(input)).toBe(expected);
  });
  it("matches node:crypto on arbitrary utf8 incl. NFC-normalized string", () => {
    const s = "Cafe\u0301 battle 状态 #42 — دeter𝕞inistic".normalize("NFC");
    expect(sha256hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
  });
});

describe("xoshiro128** rng", () => {
  it("matches independent BigInt reference for seed A, first 16 draws", () => {
    const rng = new DeterministicRng(SEED_A);
    const mine = Array.from({ length: 16 }, () => rng.next("t"));
    expect(mine).toEqual(refXoshiro(SEED_A, 16));
  });
  it("matches BigInt reference for all-ff seed", () => {
    const seed = "ff".repeat(16);
    const rng = new DeterministicRng(seed);
    expect(Array.from({ length: 8 }, () => rng.next("t"))).toEqual(refXoshiro(seed, 8));
  });
  it("frozen vectors from vectors.json", () => {
    for (const v of vectors.rng) {
      const rng = new DeterministicRng(v.seed);
      const got = Array.from({ length: v.draws.length }, () => rng.next("v"));
      expect(got.map((x) => x.toString(16).padStart(8, "0"))).toEqual(v.draws);
    }
  });
  it("rejects all-zero seed state", () => {
    expect(() => new DeterministicRng("00".repeat(16))).toThrow(RangeError);
  });
  it.each(["", "xyz", SEED_A.toUpperCase(), SEED_A.slice(2), SEED_A + "00"])(
    "rejects malformed seedHex %j",
    (s) => expect(() => new DeterministicRng(s)).toThrow(RangeError),
  );
  it("same seed → identical draw stream and counter", () => {
    const a = new DeterministicRng(SEED_A);
    const b = new DeterministicRng(SEED_A);
    for (let i = 0; i < 32; i++) {
      expect(a.next("seq")).toBe(b.next("seq"));
    }
    expect(a.drawCounter).toBe(32);
    expect(a.draws.map((d) => d.seq)).toEqual([...Array(32).keys()]);
    expect(a.draws.every((d) => d.purpose === "seq")).toBe(true);
  });
  it("different seeds → different streams", () => {
    const a = new DeterministicRng(SEED_A).next("t");
    const b = new DeterministicRng("f".repeat(32)).next("t");
    expect(a).not.toBe(b);
  });
});

describe("drawBelow rejection sampling", () => {
  const rng = () => new DeterministicRng(SEED_A);
  it("n=1 consumes a draw and returns 0", () => {
    const r = rng();
    expect(r.drawBelow(1, "p")).toBe(0);
    expect(r.drawCounter).toBe(1);
  });
  it("n=2^32 uses full uint32 range", () => {
    const r = rng();
    const v = r.drawBelow(0x100000000, "p");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0x100000000);
  });
  it("always < n over many samples (incl. non-power-of-two)", () => {
    const r = rng();
    for (let i = 0; i < 256; i++) {
      expect(r.drawBelow(3, "mod3")).toBeLessThan(3);
      expect(r.drawBelow(100, "mod100")).toBeLessThan(100);
    }
  });
  it.each([0, -1, 1.5, 0x100000001, Number.MAX_SAFE_INTEGER + 1])(
    "rejects bad bound %j",
    (n) => expect(() => rng().drawBelow(n, "p")).toThrow(RangeError),
  );
});

describe("canonicalJson", () => {
  it("sorts object keys by ASCII code point regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2, "10": "x", "2": "y" })).toBe(
      '{"10":"x","2":"y","a":2,"b":1}',
    );
  });
  it("nested objects and array order preserved (arrays are NOT sorted)", () => {
    expect(canonicalJson({ z: [3, 1, 2], a: { y: 2, x: 1 } })).toBe(
      '{"a":{"x":1,"y":2},"z":[3,1,2]}',
    );
  });
  it("NFC-normalizes strings", () => {
    expect(canonicalJson({ s: "Cafe\u0301" })).toBe(canonicalJson({ s: "Café" }));
  });
  it.each([undefined, NaN, Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects %j",
    (v) => expect(() => canonicalJson({ v })).toThrow(),
  );
  it("rejects non-ASCII object keys", () => {
    expect(() => canonicalJson({ 中文键: 1 })).toThrow();
  });
  it("stable across key insertion permutations", () => {
    const a = canonicalJson({ p: 1, q: 2, r: 3 });
    const b = canonicalJson({ r: 3, q: 2, p: 1 });
    expect(a).toBe(b);
  });
});

describe("transition fixture", () => {
  it("same seed + same input → byte-identical canonical output", () => {
    const r1 = transition(baseState(), baseInput(), new DeterministicRng(SEED_A));
    const r2 = transition(baseState(), baseInput(), new DeterministicRng(SEED_A));
    expect(canonicalJson(r1.state)).toBe(canonicalJson(r2.state));
    expect(canonicalJson(r1.events)).toBe(canonicalJson(r2.events));
  });
  it("frozen input and state are not mutated", () => {
    const state = baseState();
    const input = baseInput();
    const snapshot = canonicalJson(input);
    const stateSnap = canonicalJson(state);
    Object.freeze(input.actions.a);
    Object.freeze(input.actions.b);
    Object.freeze(input.actions);
    Object.freeze(input);
    Object.freeze(state.units.a);
    Object.freeze(state.units.b);
    Object.freeze(state.units);
    Object.freeze(state);
    const r = transition(state, input, new DeterministicRng(SEED_A));
    expect(canonicalJson(input)).toBe(snapshot);
    expect(canonicalJson(state)).toBe(stateSnap);
    expect(r.state.units.a).not.toBe(state.units.a); // new objects, no alias
  });
  it("fault atomicity: mid-transition fault leaves original state untouched", () => {
    const state = baseState();
    const input: FxInput = { actions: { a: { kind: "fault" }, b: { kind: "attack", power: 55 } } };
    expect(() => transition(state, input, new DeterministicRng(SEED_A))).toThrow(EngineFault);
    expect(canonicalJson(state)).toBe(canonicalJson(baseState()));
  });
  it("speed tie consumed a named tiebreak draw; faster side skips the draw", () => {
    const tied = baseState(); // both spd=50
    const r1 = transition(tied, baseInput(), new DeterministicRng(SEED_A));
    expect(r1.events[0]).toMatchObject({ type: "order" });
    const faster = baseState();
    faster.units.a.spd = 60;
    const rng = new DeterministicRng(SEED_A);
    transition(faster, baseInput(), rng);
    expect(rng.draws.filter((d) => d.purpose === "order_tiebreak")).toHaveLength(0);
    const rng2 = new DeterministicRng(SEED_A);
    transition(baseState(), baseInput(), rng2);
    expect(rng2.draws.filter((d) => d.purpose === "order_tiebreak")).toHaveLength(1);
  });
  it("damage formula exact: floor + min 1", () => {
    expect(damageOf(40, 40, 30)).toBe(26);
    expect(damageOf(1, 1, 100)).toBe(1);
    expect(() => damageOf(0, 10, 10)).toThrow(EngineFault);
    expect(() => damageOf(2, Number.MAX_SAFE_INTEGER + 1, 10)).toThrow(EngineFault);
  });
  it("KO produces terminal state; further transitions rejected", () => {
    let s = baseState();
    s.units.b.hp = 10;
    const r = transition(s, baseInput(), new DeterministicRng(SEED_A));
    expect(r.state.ko).toBe("a");
    expect(() => transition(r.state, baseInput(), new DeterministicRng(SEED_A))).toThrow(
      EngineFault,
    );
  });
  it("frozen end-to-end vectors", () => {
    for (const v of vectors.transitions) {
      const rng = new DeterministicRng(v.seed);
      const out = transition(v.state as FxState, v.input as FxInput, rng);
      expect(canonicalJson({ state: out.state, events: out.events })).toBe(v.canonical);
      expect(sha256hex(v.canonical)).toBe(v.sha256);
    }
  });
});
