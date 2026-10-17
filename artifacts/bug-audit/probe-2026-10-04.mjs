// Read-only probes for the 2026-10-04 full-project audit. Does not change production code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyTurn, compilePack, initBattle } from "../../packages/battle-core/src/index.ts";
import { projectEvent } from "../../packages/host/src/events.ts";

const read = (p) => JSON.parse(readFileSync(new URL(`../../content/${p}`, import.meta.url), "utf8"));
const raw = () => {
  const r = {
    ruleset: read("rulesets/synthetic-v2.json"),
    pack: read("synthetic-v2/pack.json"),
    units: read("synthetic-v2/units.json"),
    moves: read("synthetic-v2/moves.json"),
    typeChart: read("rulesets/typechart.json"),
    natures: read("rulesets/natures.json"),
    seals: read("seals/seals.json"),
    soulmarks: read("synthetic-v2/soulmarks.json"),
  };
  for (const u of r.units.units) { delete u.soulMark; delete u.revives; }
  return r;
};
const act = (id) => ({ actionId: `act_${id}`, origin: "player", idempotencyKey: "probe-action" });
const results = [];
function probe(id, run) {
  try {
    run();
    results.push({ id, status: "NO-BUG" });
    console.log("NO-BUG", id);
  } catch (e) {
    if (e && e.code === "BUG") {
      results.push({ id, status: "BUG", evidence: e.message });
      console.log("BUG", id, e.message);
    } else {
      results.push({ id, status: "ERROR", error: e.message });
      console.log("ERROR", id, e.message);
    }
  }
}
const bug = (message) => {
  const e = new Error(message);
  e.code = "BUG";
  throw e;
};

probe("cleanse-echo-skips-ko", () => {
  const r = raw();
  r.moves.moves.find((m) => m.id === "syn-hex").effects = [{ op: "cleanse", scope: "shield", echoPct: 100, target: "opponent" }];
  const p = compilePack(r);
  const s = initBattle(p, { battleId: "btl_probe", seedHex: "11".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
  s.sides.p1.unit.base.spd = 200;
  s.sides.p2.unit.base.spd = 50;
  s.sides.p2.unit.currentHp = 30;
  s.sides.p2.unit.effects.push({ kind: "shield", effectInstanceId: "efx_sh", params: { flat: 80 }, appliedTurn: 1 });
  const out = applyTurn(p, s, { p1: act("syn-hex"), p2: act("syn-hex") });
  if (!out.ok) throw new Error(out.fault.message);
  const hp = out.state.sides.p2.unit.currentHp;
  const types = out.events.map((e) => e.type);
  if (!(hp > 0 || types.includes("ko") || out.state.terminal !== null)) {
    bug(`hp=${hp} phase=${out.state.phase} types=${types.join(",")} terminal=${JSON.stringify(out.state.terminal)}`);
  }
});

probe("clear-stages-echo-skips-ko", () => {
  const r = raw();
  r.moves.moves.find((m) => m.id === "syn-hex").effects = [{ op: "clear_stages", sign: "up", flatPerRemoved: 40, target: "opponent" }];
  const p = compilePack(r);
  const s = initBattle(p, { battleId: "btl_probe", seedHex: "22".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
  s.sides.p1.unit.base.spd = 200;
  s.sides.p2.unit.base.spd = 50;
  s.sides.p2.unit.currentHp = 20;
  s.sides.p2.unit.stages.atk = 6;
  const out = applyTurn(p, s, { p1: act("syn-hex"), p2: act("syn-hex") });
  if (!out.ok) throw new Error(out.fault.message);
  const hp = out.state.sides.p2.unit.currentHp;
  const types = out.events.map((e) => e.type);
  if (!(hp > 0 || types.includes("ko") || out.state.terminal !== null)) {
    bug(`hp=${hp} phase=${out.state.phase} types=${types.join(",")}`);
  }
});

probe("post-ko-tail-discards-checkpoint", () => {
  const r = raw();
  r.moves.moves.find((m) => m.id === "syn-strike").effects = [
    { op: "damage", kind: "fixed", power: 9999, target: "opponent" },
    { op: "damage", kind: "fixed", power: 9999, target: "self" },
  ];
  delete r.moves.moves.find((m) => m.id === "syn-strike").category;
  const p = compilePack(r);
  const s = initBattle(p, {
    battleId: "btl_probe", seedHex: "33".repeat(16), p1: "syn-gamma", p2: "syn-delta",
    bench: { p1: ["syn-epsilon"], p2: ["syn-epsilon"] },
  });
  s.sides.p1.unit.base.spd = 200;
  s.sides.p2.unit.base.spd = 50;
  const out = applyTurn(p, s, { p1: act("syn-strike"), p2: act("syn-hex") });
  if (!out.ok) throw new Error(out.fault.message);
  const st = out.state;
  const evidence = {
    p1hp: st.sides.p1.unit.currentHp,
    p2hp: st.sides.p2.unit.currentHp,
    phase: st.phase,
    terminal: st.terminal,
    suspension: st.suspension ?? null,
    types: out.events.map((e) => e.type),
  };
  const coherent = (st.terminal !== null && st.suspension === undefined && st.phase === "end")
    || (st.terminal === null && st.suspension !== undefined && st.phase === "checkpoint");
  if (!coherent) bug(JSON.stringify(evidence));
});

probe("nullify-payload-discards-ko", () => {
  const r = raw();
  r.moves.moves.find((m) => m.id === "syn-hex").effects = [
    { op: "heal", flat: 1, target: "self" },
    { op: "damage", kind: "fixed", power: 9999, target: "opponent", nullifyOnly: true },
  ];
  const p = compilePack(r);
  const s = initBattle(p, { battleId: "btl_probe", seedHex: "44".repeat(16), p1: "syn-gamma", p2: "syn-delta", bench: { p2: ["syn-epsilon"] } });
  s.sides.p1.unit.base.spd = 200;
  s.sides.p2.unit.base.spd = 50;
  s.sides.p1.unit.effects.push({ kind: "move_null", effectInstanceId: "efx_null", params: { count: 1 }, appliedTurn: 1 });
  const out = applyTurn(p, s, { p1: act("syn-hex"), p2: act("syn-hex") });
  if (!out.ok) throw new Error(out.fault.message);
  const hp = out.state.sides.p2.unit.currentHp;
  const types = out.events.map((e) => e.type);
  if (!(hp > 0 || types.includes("ko") || out.state.suspension !== undefined || out.state.terminal !== null)) {
    bug(`hp=${hp} phase=${out.state.phase} types=${types.join(",")}`);
  }
});

probe("drain-ignores-hp-cap", () => {
  const r = raw();
  r.moves.moves.find((m) => m.id === "syn-strike").effects = [{ op: "damage", kind: "fixed", power: 80, drain: { numerator: 1, denominator: 1 } }];
  delete r.moves.moves.find((m) => m.id === "syn-strike").category;
  const p = compilePack(r);
  const s = initBattle(p, { battleId: "btl_probe", seedHex: "55".repeat(16), p1: "syn-gamma", p2: "syn-delta" });
  s.sides.p1.unit.base.spd = 200;
  s.sides.p2.unit.base.spd = 50;
  const capCut = s.sides.p1.unit.base.hp - 50;
  s.sides.p1.unit.currentHp = 40;
  s.sides.p1.unit.effects.push({ kind: "max_hp_down", effectInstanceId: "efx_cap", params: { flat: capCut }, appliedTurn: 1 });
  const out = applyTurn(p, s, { p1: act("syn-strike"), p2: act("syn-hex") });
  if (!out.ok) throw new Error(out.fault.message);
  const hp = out.state.sides.p1.unit.currentHp;
  if (hp > 50) bug(`hp=${hp} cap=50 base=${out.state.sides.p1.unit.base.hp}`);
});

probe("public-projection-drops-protected", () => {
  const projected = projectEvent({
    seq: 1, type: "protected", causeId: null, revisionBefore: 0, revisionAfter: 1,
    detail: { side: "p2" },
  });
  if (projected === null) bug("projectEvent(protected) returned null");
});

probe("static-join-escapes-root", () => {
  const root = "E:\\project\\seer\\apps\\client";
  const file = "C:/Windows/win.ini";
  const full = join(root, file);
  if (!full.toLowerCase().startsWith(root.toLowerCase())) bug(`join escaped to ${full}`);
});

console.log("---");
console.log(JSON.stringify(results, null, 2));
