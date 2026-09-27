import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, loadPackFromDir } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");
const SEED = "00112233445566778899aabbccddeeff";
const act = (actionId: string) => ({ actionId, origin: "player" as const, idempotencyKey: `chain-${actionId}` });
const ok = (result: ReturnType<typeof applyTurn>) => {
  if (!result.ok) throw result.fault;
  return result;
};
const events = (result: ReturnType<typeof applyTurn>, type: string) => result.ok ? result.events.filter((event) => event.type === type) : [];

describe("M2 complex interaction chains", () => {
  it("control → cleanse bypass succeeds while an ordinary queued move is blocked", () => {
    const setup = () => initBattle(PACK, {
      battleId: "btl_chain-control",
      seedHex: SEED,
      p1: "syn-delta",
      p2: "syn-gamma",
    });
    const applyStun = () => ok(applyTurn(PACK, setup(), {
      p1: act("act_syn-strike"),
      p2: act("act_syn-hex"),
    })).state;

    const cleansed = ok(applyTurn(PACK, applyStun(), {
      p1: act("act_syn-purge-mind"),
      p2: act("act_syn-strike"),
    }));
    expect(cleansed.state.sides.p1.unit.effects.some((effect) => effect.kind.startsWith("control:"))).toBe(false);
    expect(events(cleansed, "action-failed").some((event) => event.detail.side === "p1" && event.detail.reason === "controlled")).toBe(false);
    expect(events(cleansed, "effect-faded").some((event) => event.detail.name === "control:stun")).toBe(true);

    const blocked = ok(applyTurn(PACK, applyStun(), {
      p1: act("act_syn-strike"),
      p2: act("act_syn-strike"),
    }));
    expect(events(blocked, "action-failed").some((event) => event.detail.side === "p1" && event.detail.reason === "controlled")).toBe(true);
  });

  it("stage transfer survives switching while boss overlay rejects the same chain", () => {
    const state = initBattle(PACK, {
      battleId: "btl_chain-switch",
      seedHex: SEED,
      p1: "syn-delta",
      p2: "syn-gamma",
      bench: { p1: ["syn-epsilon"] },
    });
    state.sides.p2.unit.stages.atk = 2;
    const transferred = ok(applyTurn(PACK, state, {
      p1: act("act_syn-drain"),
      p2: act("act_syn-strike"),
    }));
    expect(transferred.state.sides.p1.unit.stages.atk).toBe(2);
    const switched = ok(applyTurn(PACK, transferred.state, {
      p1: act("act_switch-0"),
      p2: act("act_syn-strike"),
    }));
    expect(switched.state.sides.p1.unit.speciesId).toBe("syn-epsilon");
    expect(switched.state.sides.p1.unit.stages.atk).toBe(0);
    expect(switched.state.sides.p1.bench![0]!.speciesId).toBe("syn-delta");
    expect(switched.state.sides.p1.bench![0]!.stages.atk).toBe(2);

    const boss = initBattle(PACK, {
      battleId: "btl_chain-overlay",
      seedHex: SEED,
      p1: "syn-delta",
      p2: "syn-epsilon",
    });
    boss.sides.p2.unit.stages.atk = 2;
    const rejected = ok(applyTurn(PACK, boss, {
      p1: act("act_syn-drain"),
      p2: act("act_syn-strike"),
    }));
    expect(rejected.state.sides.p1.unit.stages.atk).toBe(0);
    expect(rejected.state.sides.p2.unit.stages.atk).toBe(2);
    expect(events(rejected, "action-failed").some((event) => event.detail.reason === "overlay_immune")).toBe(true);
  });

  it("revive is consumed before KO suspension and exhausted units require replacement", () => {
    const state = initBattle(PACK, {
      battleId: "btl_chain-revive",
      seedHex: SEED,
      p1: "syn-epsilon",
      p2: "syn-delta",
      bench: { p2: ["syn-gamma"] },
    });
    state.sides.p2.unit.currentHp = 1;
    const revived = ok(applyTurn(PACK, state, {
      p1: act("act_syn-strike"),
      p2: act("act_syn-strike"),
    }));
    expect(revived.state.sides.p2.unit.revives).toBe(0);
    expect(revived.state.sides.p2.unit.currentHp).toBe(45);
    expect(revived.state.suspension).toBeUndefined();

    revived.state.sides.p2.unit.currentHp = 1;
    const suspended = ok(applyTurn(PACK, revived.state, {
      p1: act("act_syn-strike"),
      p2: act("act_syn-strike"),
    }));
    expect(suspended.state.suspension?.koSide).toBe("p2");
    const replaced = ok(applyReplacement(PACK, suspended.state, {
      p1: null,
      p2: act("act_switch-0"),
    }));
    expect(replaced.state.sides.p2.unit.speciesId).toBe("syn-gamma");
    expect(replaced.state.phase).toBe("collect");

    const noBench = initBattle(PACK, {
      battleId: "btl_chain-terminal",
      seedHex: SEED,
      p1: "syn-epsilon",
      p2: "syn-delta",
    });
    noBench.sides.p2.unit.revives = 0;
    noBench.sides.p2.unit.currentHp = 1;
    const terminal = ok(applyTurn(PACK, noBench, {
      p1: act("act_syn-strike"),
      p2: act("act_syn-strike"),
    }));
    expect(terminal.state.terminal).toEqual({ result: "p1", reason: "ko" });
    expect(terminal.state.suspension).toBeUndefined();
  });
});
