/**
 * M0 独立投影 fixture —— contracts.md §3 的白名单重建法。
 * 只从显式列出的公开字段构造输出，绝不 spread 内部对象后删字段。
 * M1-03 由真实 core 投影替换；本文件不属于生产代码路径。
 */
import type { BattleState, InternalEvent } from "@seer/contracts/internal";
import type { BattleEvent, LegalAction, Observation } from "@seer/contracts";

type Side = "p1" | "p2";
const OTHER: Record<Side, Side> = { p1: "p2", p2: "p1" };

// M0 fixture move table (subset of content/synthetic-v1 semantics needed for targets).
const MOVE_TARGET: Record<string, "self" | "opponent"> = {
  "syn-strike": "opponent",
  "syn-jab": "opponent",
  "syn-bolster": "self",
  "syn-recover": "self",
};

export function legalActions(state: BattleState, side: Side): LegalAction[] {
  const unit = state.sides[side].unit;
  const actions: LegalAction[] = unit.moves.flatMap((m, moveSlot): LegalAction[] =>
    m.pp > 0
      ? [
          {
            actionId: `act_${m.moveId}`,
            action: { kind: "move", moveSlot, target: MOVE_TARGET[m.moveId] ?? "opponent" },
            label: m.moveId,
          },
        ]
      : [],
  );
  if (actions.length === 0) {
    actions.push({ actionId: "act_struggle", action: { kind: "struggle" }, label: "struggle" });
  }
  actions.push({ actionId: "act_concede", action: { kind: "concede" }, label: "concede" });
  return actions;
}

export function observe(state: BattleState, side: Side): Observation {
  const own = state.sides[side].unit;
  const opp = state.sides[OTHER[side]].unit;
  const publicEffects = (list: typeof own.effects, hideHidden: boolean) =>
    list
      .filter((e) => !(hideHidden && e.hidden === true))
      .map((e) => {
        const out: { kind: string; remainingTurns?: number; stack?: number } = { kind: e.kind };
        if (e.remainingTurns !== undefined) out.remainingTurns = e.remainingTurns;
        if (e.stack !== undefined) out.stack = e.stack;
        return out;
      });

  const ppByMoveId: Record<string, number> = {};
  for (const m of own.moves) ppByMoveId[m.moveId] = m.pp;

  const dec = state.decision;
  return {
    schemaVersion: 1,
    battleId: state.battleId,
    side,
    viewCursor: state.publicCursors[side],
    revision: state.revision,
    turn: state.turn,
    rules: {
      rulesetId: state.rules.rulesetId,
      rulesetHash: state.rules.rulesetHash,
      contentHash: state.rules.contentHash,
      executableHash: state.rules.executableHash,
      irVersion: state.rules.irVersion,
    },
    own: {
      unitId: own.unitId,
      speciesId: own.speciesId,
      hp: { current: own.currentHp, max: own.base.hp },
      ppByMoveId,
      stages: { atk: own.stages.atk, def: own.stages.def, spd: own.stages.spd },
      effects: publicEffects(own.effects, false),
    },
    opponent: {
      unitId: opp.unitId,
      speciesId: opp.speciesId,
      hp: { current: opp.currentHp, max: opp.base.hp },
      revealedMoveIds: [...opp.revealedMoveIds],
      ppEstimate: { kind: "unknown" },
      stages: { atk: opp.stages.atk, def: opp.stages.def, spd: opp.stages.spd },
      effects: publicEffects(opp.effects, true),
    },
    decision: dec
      ? {
          decisionId: dec.decisionId,
          kind: dec.kind,
          baseRevision: dec.baseRevision,
          actors: [...dec.actors],
          deadlineMs: dec.deadlineMs,
        }
      : null,
    terminal: state.terminal,
    legalActions: legalActions(state, side),
  };
}

/** Project internal event log to the public event union; hidden/internal-only types are dropped. */
export function publicEvents(events: InternalEvent[], _side: Side): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (const e of events) {
    const d = e.detail as Record<string, unknown>;
    if (d["hidden"] === true) continue;
    switch (e.type) {
      case "turn-begin":
        out.push({ type: "turn-begin", turn: d["turn"] as number, decisionId: d["decisionId"] as string });
        break;
      case "action-declared": {
        const ev: BattleEvent = {
          type: "action-declared",
          side: d["side"] as Side,
          actionId: d["actionId"] as string,
          ...(d["moveId"] !== undefined ? { moveId: d["moveId"] as string } : {}),
        };
        out.push(ev);
        break;
      }
      case "damage":
      case "heal": {
        const hp = d["hpAfter"] as { current: number; max: number };
        out.push({
          type: e.type,
          side: d["side"] as Side,
          amount: d["amount"] as number,
          hpAfter: { current: hp.current, max: hp.max },
        });
        break;
      }
      case "stat-stage":
        out.push({
          type: "stat-stage",
          side: d["side"] as Side,
          stat: d["stat"] as "atk" | "def" | "spd",
          deltaApplied: d["deltaApplied"] as number,
          stageAfter: d["stageAfter"] as number,
        });
        break;
      case "action-failed":
        out.push({
          type: "action-failed",
          side: d["side"] as Side,
          reason: d["reason"] as "stage-at-cap" | "hp-full" | "invalid-action",
        });
        break;
      case "struggle-used":
        out.push({ type: "struggle-used", side: d["side"] as Side });
        break;
      case "ko":
        out.push({ type: "ko", side: d["side"] as Side });
        break;
      case "battle-end":
        out.push({
          type: "battle-end",
          result: d["result"] as "p1" | "p2" | "draw",
          reason: d["reason"] as "ko" | "concede" | "turn-limit" | "timeout",
        });
        break;
      default:
        // decision-opened / input-received / pp-spent / effect-applied / rng-draw: internal only
        break;
    }
  }
  return out;
}
