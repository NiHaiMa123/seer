/**
 * M0-04 最小 transition fixture（非真实战斗 core）：
 * 证明 — 输入与旧 state 不被修改、fault 时原子性（整次 transition 不落盘）、
 * 排序/平速用命名 RNG draw、输出可 canonical 编码。
 */
import { DeterministicRng } from "@seer/battle-core/rng";

export class EngineFault extends Error {
  readonly code = "ENGINE_FAULT";
}

export interface FxUnit {
  id: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
}

export interface FxState {
  turn: number;
  units: { a: FxUnit; b: FxUnit };
  ko: string | null;
}

export interface FxInput {
  actions: {
    a: { kind: "attack"; power: number } | { kind: "fault" };
    b: { kind: "attack"; power: number } | { kind: "fault" };
  };
}

export interface FxEvent {
  type: "damage" | "ko" | "order";
  [k: string]: unknown;
}

/** dmg = max(1, floor(power * atkEff / (2 * defEff))) — synthetic-v1 §4 */
export function damageOf(power: number, atkEff: number, defEff: number): number {
  for (const v of [power, atkEff, defEff]) {
    if (!Number.isSafeInteger(v) || v <= 0) throw new EngineFault(`non-positive/unsafe term ${v}`);
  }
  const dmg = Math.floor((power * atkEff) / (2 * defEff));
  return Math.max(1, dmg);
}

export function transition(
  state: FxState,
  input: FxInput,
  rng: DeterministicRng,
): { state: FxState; events: FxEvent[] } {
  if (state.ko !== null) throw new EngineFault("transition on terminal state");

  // ORDER: spd desc, tie → one named draw (0 → "a" first)
  let order: ["a" | "b", "a" | "b"];
  if (state.units.a.spd === state.units.b.spd) {
    order = rng.drawBelow(2, "order_tiebreak") === 0 ? ["a", "b"] : ["b", "a"];
  } else {
    order = state.units.a.spd > state.units.b.spd ? ["a", "b"] : ["b", "a"];
  }
  const events: FxEvent[] = [{ type: "order", first: order[0] }];

  // 只写新对象；state/input 不被触碰修改。
  const nextUnits = {
    a: { ...state.units.a },
    b: { ...state.units.b },
  };
  let ko: string | null = null;

  for (const side of order) {
    const action = input.actions[side];
    if (action.kind === "fault") throw new EngineFault(`forced fault at ${side}`);
    const me = nextUnits[side];
    const foe = nextUnits[side === "a" ? "b" : "a"];
    if (me.hp <= 0) continue;
    const dmg = damageOf(action.power, me.atk, foe.def);
    // HP 下限 0（synthetic-v1 §4）；hp/dmg 均 safe → 差值不会低于 -2^53
    foe.hp = Math.max(0, foe.hp - dmg);
    events.push({ type: "damage", by: side, amount: dmg, targetHp: foe.hp });
    if (foe.hp === 0) {
      ko = side;
      events.push({ type: "ko", loser: side === "a" ? "b" : "a" });
      break;
    }
  }

  return {
    state: { turn: state.turn + 1, units: nextUnits, ko },
    events,
  };
}
