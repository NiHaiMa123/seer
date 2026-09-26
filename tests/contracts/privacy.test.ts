/**
 * test:privacy — M0-02 非干扰验证（独立投影 fixture，M1-03 接真实 core）。
 * 两份只在秘密字段不同的内部状态，其 observe/legal/history/trace 的
 * canonical 输出必须完全一致；公开字段不同则必须可区分（防假阳性）。
 */
import { describe, expect, it } from "vitest";
import { canonicalJson, validators } from "@seer/contracts";
import { internalValidators } from "@seer/contracts/internal";
import type { BattleState, InternalEvent } from "@seer/contracts/internal";
import { legalActions, observe, publicEvents } from "./projection-fixture.ts";

const H = `sha256:${"b".repeat(64)}`;

const RULES = {
  rulesetId: "synthetic-v1",
  rulesetVersion: "1.0.0",
  rulesetHash: H,
  contentHash: H,
  executableHash: H,
  irVersion: 1 as const,
};

type Secrets = {
  p1MoveIds: string[];
  p2MoveIds: string[];
  p1Pp: number[];
  p2Pp: number[];
  seedHex: string;
  drawCounter: number;
  eventSeq: number;
  p1Inbox: BattleState["inbox"]["p1"];
  p2Inbox: BattleState["inbox"]["p2"];
  p1HiddenKind: string | null;
  p2HiddenKind: string | null;
};

function unit(
  side: "p1" | "p2",
  speciesId: string,
  base: { hp: number; atk: number; def: number; spd: number },
  currentHp: number,
  moveIds: string[],
  pps: number[],
  revealed: string[],
  hiddenEffectKind: string | null,
): BattleState["sides"]["p1"]["unit"] {
  return {
    unitId: `unit_${side}`,
    speciesId,
    base,
    currentHp,
    stages: { atk: 0, def: 0, spd: 0 },
    moves: moveIds.map((moveId, i) => ({ moveId, pp: pps[i] ?? 1, ppMax: pps[i] ?? 1 })),
    revealedMoveIds: revealed,
    effects:
      hiddenEffectKind === null
        ? []
        : [{ kind: hiddenEffectKind, effectInstanceId: `eff_${side}_secret`, hidden: true, remainingTurns: 2 }],
  };
}

function makeState(s: Secrets): BattleState {
  return {
    schemaVersion: 1,
    battleId: "btl_priv-1",
    rules: RULES,
    revision: 4,
    turn: 1,
    phase: "collect",
    rng: { algorithmId: "xoshiro128**", seedHex: s.seedHex, drawCounter: s.drawCounter },
    sides: {
      p1: {
        unit: unit("p1", "syn-alpha", { hp: 120, atk: 40, def: 30, spd: 50 }, 97, s.p1MoveIds, s.p1Pp, ["syn-strike"], s.p1HiddenKind),
      },
      p2: {
        unit: unit("p2", "syn-beta", { hp: 140, atk: 35, def: 35, spd: 40 }, 118, s.p2MoveIds, s.p2Pp, ["syn-strike"], s.p2HiddenKind),
      },
    },
    decision: {
      decisionId: "dec_2",
      kind: "turn",
      baseRevision: 4,
      actors: ["p1", "p2"],
      deadlineMs: 10000,
    },
    inbox: { p1: s.p1Inbox, p2: s.p2Inbox },
    eventSeq: s.eventSeq,
    publicCursors: { p1: 7, p2: 7 },
    terminal: null,
  };
}

const INBOX_A = {
  actionId: "act_syn-strike",
  idempotencyKey: "key-aaaaaaaa",
  canonicalDigest: H,
  receiptId: "rcpt_a",
  receivedSeq: 5,
};
const INBOX_B = {
  actionId: "act_syn-jab",
  idempotencyKey: "key-bbbbbbbb",
  canonicalDigest: `sha256:${ "c".repeat(64)}`,
  receiptId: "rcpt_b",
  receivedSeq: 6,
};

// State B differs from A only in fields invisible to p1 (p2 secrets + shared secrets);
// state C differs only in fields invisible to p2. Own-side fields stay identical.
const stateA = makeState({
  p1MoveIds: ["syn-strike", "syn-jab", "syn-bolster", "syn-recover"],
  p2MoveIds: ["syn-strike", "syn-jab", "syn-bolster", "syn-recover"],
  p1Pp: [35, 30, 20, 10],
  p2Pp: [35, 30, 20, 10],
  seedHex: "00".repeat(16),
  drawCounter: 0,
  eventSeq: 12,
  p1Inbox: null,
  p2Inbox: null,
  p1HiddenKind: null,
  p2HiddenKind: null,
});
const stateB = makeState({
  p1MoveIds: ["syn-strike", "syn-jab", "syn-bolster", "syn-recover"],
  p2MoveIds: ["alt-move-1", "alt-move-2", "alt-move-3", "alt-move-4"],
  p1Pp: [35, 30, 20, 10],
  p2Pp: [1, 2, 3, 4],
  seedHex: "ff".repeat(16),
  drawCounter: 9,
  eventSeq: 77,
  p1Inbox: INBOX_A,
  p2Inbox: INBOX_B,
  p1HiddenKind: null,
  p2HiddenKind: "hidden-aura",
});
const stateC = makeState({
  p1MoveIds: ["x-move-1", "x-move-2", "x-move-3", "x-move-4"],
  p2MoveIds: ["syn-strike", "syn-jab", "syn-bolster", "syn-recover"],
  p1Pp: [9, 8, 7, 6],
  p2Pp: [35, 30, 20, 10],
  seedHex: "ab".repeat(16),
  drawCounter: 3,
  eventSeq: 55,
  p1Inbox: INBOX_B,
  p2Inbox: INBOX_A,
  p1HiddenKind: "hidden-mark",
  p2HiddenKind: null,
});

// Same public history, differing internal seq/causeId/rng/statePatch → same projection.
const internalEventsA: InternalEvent[] = [
  { seq: 0, type: "decision-opened", causeId: null, revisionBefore: 3, revisionAfter: 3, detail: { decisionId: "dec_2" } },
  { seq: 1, type: "turn-begin", causeId: null, revisionBefore: 3, revisionAfter: 3, detail: { turn: 1, decisionId: "dec_2" } },
  { seq: 2, type: "input-received", causeId: null, revisionBefore: 4, revisionAfter: 4, detail: { side: "p1", receiptId: "rcpt_a" } },
  { seq: 3, type: "action-declared", causeId: "cmd_1", revisionBefore: 4, revisionAfter: 5, detail: { side: "p1", actionId: "act_syn-strike", moveId: "syn-strike" } },
  { seq: 4, type: "rng-draw", causeId: "ev_3", revisionBefore: 5, revisionAfter: 5, detail: { purpose: "order_tiebreak" }, rngDraw: { purpose: "order_tiebreak", value: 12345 } },
  { seq: 5, type: "damage", causeId: "ev_3", revisionBefore: 5, revisionAfter: 6, detail: { side: "p2", amount: 22, hpAfter: { current: 118, max: 140 } }, statePatch: { "sides.p2.unit.currentHp": 118 } },
  { seq: 6, type: "effect-applied", causeId: "ev_5", revisionBefore: 6, revisionAfter: 6, detail: { hidden: true, effectInstanceId: "eff_p2_secret", kind: "hidden-aura" } },
  { seq: 7, type: "battle-end", causeId: "ev_5", revisionBefore: 6, revisionAfter: 7, detail: { result: "p1", reason: "ko" } },
];
const internalEventsB: InternalEvent[] = internalEventsA.map((e, i) => ({
  seq: 100 + i,
  type: e.type,
  causeId: e.causeId === null ? null : `${e.causeId}_different`,
  revisionBefore: e.revisionBefore,
  revisionAfter: e.revisionAfter,
  detail: e.detail,
  ...(e.rngDraw ? { rngDraw: { purpose: e.rngDraw.purpose, value: 987654 } } : {}),
  ...(e.statePatch ? { statePatch: e.statePatch } : {}),
}));

describe("privacy: non-interference of public projection", () => {
  it("internal states validate against the internal schema", () => {
    for (const s of [stateA, stateB, stateC]) {
      expect(internalValidators.state(s), JSON.stringify(internalValidators.state.errors)).toBe(true);
    }
    for (const e of [...internalEventsA, ...internalEventsB]) {
      expect(internalValidators.internalEvent(e), JSON.stringify(internalValidators.internalEvent.errors)).toBe(true);
    }
  });

  it("observe(): two secret-different states produce identical output for p1", () => {
    const a = observe(stateA, "p1");
    const b = observe(stateB, "p1");
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("observe(): symmetric for the other side (p1 secrets varied)", () => {
    const a = observe(stateA, "p2");
    const c = observe(stateC, "p2");
    expect(canonicalJson(a)).toBe(canonicalJson(c));
  });

  it("legalActions(): identical across secret variants", () => {
    expect(canonicalJson(legalActions(stateA, "p1"))).toBe(canonicalJson(legalActions(stateB, "p1")));
    expect(canonicalJson(legalActions(stateA, "p2"))).toBe(canonicalJson(legalActions(stateC, "p2")));
  });

  it("history/trace: internal-only events dropped, remaining projection identical", () => {
    const pubA = publicEvents(internalEventsA, "p1");
    const pubB = publicEvents(internalEventsB, "p1");
    expect(
      pubA.every((e) =>
        ["turn-begin", "action-declared", "damage", "heal", "stat-stage", "action-failed", "struggle-used", "ko", "battle-end"].includes(e.type),
      ),
    ).toBe(true);
    expect(canonicalJson(pubA)).toBe(canonicalJson(pubB));
    expect(pubA).toHaveLength(4); // turn-begin, action-declared, damage, battle-end
  });

  it("projected outputs pass the public wire schemas", () => {
    const obs = observe(stateA, "p1");
    expect(validators.observation(obs), JSON.stringify(validators.observation.errors)).toBe(true);
    for (const e of publicEvents(internalEventsA, "p1")) {
      expect(validators.event(e), JSON.stringify(validators.event.errors)).toBe(true);
    }
  });

  it("sanity: a PUBLIC field difference is still visible (fixture is not blind)", () => {
    const changed: BattleState = {
      ...stateA,
      sides: {
        ...stateA.sides,
        p2: { unit: { ...stateA.sides.p2.unit, currentHp: 1 } },
      },
    };
    expect(canonicalJson(observe(stateA, "p1"))).not.toBe(canonicalJson(observe(changed, "p1")));
  });
});
