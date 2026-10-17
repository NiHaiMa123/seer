/**
 * T8 内部字段不泄公开事件 —— 不变量测试。
 *
 * 引擎内部记账字段（effectInstanceId/appliedTurn/moveStacks/lastTaken/
 * prevTaken/lastDealt/lastMoveId/nextInFx/rng 内部等）只允许出现在
 * CoreState 内部，绝不能混进公开事件流的 detail。
 *
 * 做法：驱动一场尽量多事件类型的对局（含换场/KO 挂起/状态/强化），
 * 递归扫描每个 event.detail 的键名。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyReplacement, applyTurn, initBattle, legalActions, loadPackFromDir, type CoreEvent, type CoreState } from "@seer/battle-core";

const CONTENT = join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content");
const PACK = loadPackFromDir(CONTENT, "synthetic-v2");

/** 引擎内部记账字段（出现在公开事件 detail 即视为泄漏）。 */
const FORBIDDEN = new Set([
  "effectInstanceId", "appliedTurn", "payload",
  "moveStacks", "lastMoveId", "lastMoveCat", "prevMoveCat", "prevMoveId", "lastDealt", "lastTaken", "prevTaken", "lastEff",
  "nextInFx", "suspension", "rng", "seed", "seedHex", "state",
]);

/** CoreEvent.type 白名单（与 types.ts union 同步；漂移 = 新增未审计事件类型）。 */
const EVENT_TYPES = new Set([
  "turn-begin", "action-declared", "pp-spent", "damage", "heal", "stat-stage",
  "effect-applied", "effect-faded", "control-immune", "stages-transferred",
  "stages-cleared", "switch", "revive", "soulmark", "action-failed", "missed",
  "protected", "pp-delta", "struggle-used", "rng-draw", "ko", "battle-end",
]);

function* walkKeys(v: unknown, path: string): Generator<string> {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* walkKeys(v[i], `${path}[${i}]`);
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      yield `${path}.${k}`;
      yield* walkKeys(x, `${path}.${k}`);
    }
  }
}

/** 与 real-golden 同款确定性驱动：轮转招位，挂起自动补替。 */
function drive(state: CoreState, maxTurns = 40): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (let t = 1; t <= maxTurns && (state.terminal ?? null) === null; t++) {
    const pick = (side: "p1" | "p2") => {
      const legal = legalActions(state, side).filter((a) => /^act_(?!concede|switch)/.test(a));
      const idx = (t + (side === "p2" ? 1 : 0)) % Math.max(1, legal.length);
      return { actionId: legal[idx] ?? "act_concede", origin: "player" as const, idempotencyKey: `t${t}${side}` };
    };
    const r = applyTurn(PACK, state, { p1: pick("p1"), p2: pick("p2") });
    expect(r.ok).toBe(true);
    if (!r.ok) return events;
    events.push(...r.events);
    state = r.state;
    while (state.suspension !== undefined && state.suspension !== null && (state.terminal ?? null) === null) {
      const koSide = state.suspension.koSide;
      const other = koSide === "p1" ? "p2" : "p1";
      const opts = legalActions(state, koSide).filter((a) => a.startsWith("act_switch"));
      const rr = applyReplacement(PACK, state, {
        [koSide]: { actionId: opts[0] ?? "act_concede", origin: "player" as const, idempotencyKey: `rep${t}${koSide}` },
        [other]: null,
      } as { p1: never; p2: never });
      expect(rr.ok).toBe(true);
      if (!rr.ok) return events;
      events.push(...rr.events);
      state = rr.state;
    }
  }
  return events;
}

describe("T8 内部字段不泄公开事件", () => {
  const state = initBattle(PACK, {
    battleId: "leak", seedHex: "77aa77aa77aa77aa77aa77aa77aa77aa",
    p1: "syn-gamma", p2: "syn-delta",
    bench: { p1: ["syn-epsilon"] },
  });
  const events = drive(state);
  const eventTypes = new Set(events.map((e) => e.type));

  it("对局产生足够事件量供扫描", () => {
    expect(events.length).toBeGreaterThan(30);
    console.log(`[T8] events=${events.length} types=${[...eventTypes].sort().join(",")}`);
  });

  it("event.detail 递归键名不含内部记账字段", () => {
    const leaks: string[] = [];
    for (const [i, e] of events.entries()) {
      for (const p of walkKeys(e.detail, "detail")) {
        const leaf = p.split(".").pop() ?? "";
        if (FORBIDDEN.has(leaf)) leaks.push(`event[${i}] ${e.type} ${p}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("event.type ∈ 公开事件白名单（无未审计新类型）", () => {
    for (const e of events) expect(EVENT_TYPES.has(e.type), `unknown event type: ${e.type}`).toBe(true);
  });

  it("rngDraw 只含 {purpose,value}（回放元数据边界）", () => {
    for (const e of events) {
      if (e.rngDraw === undefined) continue;
      expect(Object.keys(e.rngDraw).sort()).toEqual(["purpose", "value"]);
      expect(typeof e.rngDraw.purpose).toBe("string");
      expect(typeof e.rngDraw.value).toBe("number");
    }
  });

  it("detail 中不出现 effect 实例原始对象（kind 名而非整条目）", () => {
    // 若实现把整条 ActiveEffect 塞进 detail，会带出 remainingTurns/params/payload 键
    const leaks: string[] = [];
    for (const [i, e] of events.entries()) {
      for (const p of walkKeys(e.detail, "detail")) {
        if (/\.(remainingTurns|params|kind)$/.test(p)) leaks.push(`event[${i}] ${e.type} ${p}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
