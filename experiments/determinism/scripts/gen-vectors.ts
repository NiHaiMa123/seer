/**
 * 生成并冻结 vectors.json。向量=本实现的输出快照，用途是回归稳定性与
 * Node/Chromium 字节一致性；sha256 正确性另有 node:crypto + 公开向量交叉验证。
 * 用法：node experiments/determinism/scripts/gen-vectors.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canonicalJson } from "../../../packages/contracts/src/canonical.ts";
import { DeterministicRng } from "../src/rng.ts";
import { sha256hex } from "../src/sha256.ts";
import { transition, type FxInput, type FxState } from "../src/transition-fixture.ts";

const dir = fileURLToPath(new URL("..", import.meta.url));

const rngVectors = ["00000000000000000000000000000001", "0123456789abcdef0123456789abcdef", "ffffffffffffffffffffffffffffffff"].map(
  (seed) => {
    const r = new DeterministicRng(seed);
    const draws = Array.from({ length: 8 }, () =>
      r.next("vector").toString(16).padStart(8, "0"),
    );
    return { seed, draws };
  },
);

const mkState = (hpB: number): FxState => ({
  turn: 0,
  units: {
    a: { id: "a", hp: 100, maxHp: 100, atk: 40, def: 30, spd: 50 },
    b: { id: "b", hp: hpB, maxHp: 100, atk: 35, def: 30, spd: 50 },
  },
  ko: null,
});
const atk = (p: number) => ({ kind: "attack" as const, power: p });
const transitionVectors = [
  { seed: "0123456789abcdef0123456789abcdef", state: mkState(100), input: { actions: { a: atk(40), b: atk(55) } } },
  { seed: "ffffffffffffffffffffffffffffffff", state: mkState(30), input: { actions: { a: atk(80), b: atk(20) } } },
].map((v) => {
  const out = transition(v.state as FxState, v.input as FxInput, new DeterministicRng(v.seed));
  const canonical = canonicalJson({ state: out.state, events: out.events });
  return { ...v, canonical, sha256: sha256hex(canonical) };
});

writeFileSync(
  join(dir, "vectors.json"),
  JSON.stringify({ rng: rngVectors, transitions: transitionVectors }, null, 2) + "\n",
);
console.log(`vectors.json written: ${rngVectors.length} rng, ${transitionVectors.length} transitions`);
