/**
 * Browser payload for the Node↔Chromium byte-equality gate.
 * Bundled by tools/build-det-bundle.ts (esbuild iife); exposes window.__det.
 */
import { canonicalJson } from "../../../packages/contracts/src/canonical.ts";
import { DeterministicRng } from "@seer/battle-core/rng";
import { sha256hex } from "@seer/battle-core/sha256";
import { transition, type FxInput, type FxState } from "./transition-fixture.ts";

export interface DetRun {
  seedHex: string;
  draws: { purpose: string; seq: number; value: number }[];
  canonical: string;
  hash: string;
}

export function runDeterministicPayload(seedHex: string, turns: number): DetRun {
  const rng = new DeterministicRng(seedHex);
  const rawDraws = [0, 1, 2, 3, 4, 5, 6, 7].map(() => rng.next("probe"));
  const bounded = rng.drawBelow(6, "bounded");
  let state: FxState = {
    turn: 0,
    units: {
      a: { id: "a", hp: 100, maxHp: 100, atk: 40, def: 30, spd: 50 },
      b: { id: "b", hp: 100, maxHp: 100, atk: 35, def: 30, spd: 50 },
    },
    ko: null,
  };
  const input: FxInput = { actions: { a: { kind: "attack", power: 40 }, b: { kind: "attack", power: 55 } } };
  const states: unknown[] = [];
  for (let i = 0; i < turns && state.ko === null; i++) {
    const r = transition(state, input, rng);
    state = r.state;
    states.push(r.state, r.events);
  }
  const canonical = canonicalJson({ seedHex, rawDraws, bounded, states, rngDraws: rng.draws });
  return { seedHex, draws: rng.draws, canonical, hash: sha256hex(canonical) };
}

(globalThis as Record<string, unknown>)["__det"] = { runDeterministicPayload };
