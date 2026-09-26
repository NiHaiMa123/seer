/**
 * 侧锁定公开投影：内部权威态 → 单方 Observation。
 * 全部按 whitelist 重建；对手 PP 永远 ppEstimate=unknown、
 * RNG/seed/inbox/internal seq 不进入输出。
 */
import type { Observation, BattleEvent, LegalAction } from "@seer/contracts";
import type { BattleState, InternalEvent } from "@seer/contracts/internal";
import { OTHER, type SideId } from "@seer/battle-core";
import { projectEvent } from "./events.ts";

const MOVE_LABEL: Record<string, string> = {
  "syn-strike": "Strike",
  "syn-jab": "Jab",
  "syn-bolster": "Bolster",
  "syn-recover": "Recover",
};

type InternalEffects = BattleState["sides"]["p1"]["unit"]["effects"];
/** effectInstanceId/hidden 不公开；对手侧 hidden 效果完全不发。 */
function publicEffects(effects: InternalEffects, self: boolean) {
  return effects
    .filter((e) => self || e.hidden !== true)
    .map((e) => ({
      kind: e.kind,
      ...(e.remainingTurns !== undefined ? { remainingTurns: e.remainingTurns } : {}),
      ...(e.stack !== undefined ? { stack: e.stack } : {}),
    }));
}

function legalActionFor(state: BattleState, side: SideId): LegalAction[] {
  const s = state.sides[side];
  const unit = s.unit;
  const out: LegalAction[] = [];
  // replacement 决策：仅 act_switch + concede
  const isRepl = state.suspension !== undefined && state.suspension !== null && state.suspension.koSide === side;
  if (!isRepl || true) {
    (s.bench ?? []).forEach((b, i) => {
      if (b.currentHp > 0) {
        out.push({
          actionId: `act_switch-${i}`,
          action: { kind: "switch", unitId: b.unitId },
          label: `Switch → ${b.speciesId}`,
        });
      }
    });
  }
  if (!isRepl) {
    unit.moves.forEach((m, idx) => {
      if (m.pp > 0) {
        out.push({
          actionId: `act_${m.moveId}`,
          action: { kind: "move", moveSlot: idx, target: "opponent" },
          label: MOVE_LABEL[m.moveId] ?? m.moveId,
        });
      }
    });
    const anyPp = unit.moves.some((m) => m.pp > 0);
    if (!anyPp) out.push({ actionId: "act_struggle", action: { kind: "struggle" }, label: "Struggle" });
  }
  out.push({ actionId: "act_concede", action: { kind: "concede" }, label: "Concede" });
  return out;
}

export function projectObservation(state: BattleState, side: SideId): Observation {
  const sMe = state.sides[side];
  const sFoe = state.sides[OTHER[side]];
  const me = sMe.unit;
  const foe = sFoe.unit;
  const decision = state.decision;
  const isActor = decision !== null && decision.actors.includes(side);
  const obs: Observation = {
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
      irVersion: 1,
    },
    own: {
      unitId: me.unitId,
      speciesId: me.speciesId,
      hp: { current: me.currentHp, max: me.base.hp },
      ppByMoveId: Object.fromEntries(me.moves.map((m) => [m.moveId, m.pp])),
      stages: { ...me.stages },
      effects: publicEffects(me.effects, /* self: show all */ true),
      ...(me.mode !== undefined ? { mode: me.mode } : {}),
      ...(me.revives !== undefined ? { revives: me.revives } : {}),
      ...(sMe.bench !== undefined
        ? {
            bench: sMe.bench.map((b) => ({
              unitId: b.unitId,
              speciesId: b.speciesId,
              hp: { current: b.currentHp, max: b.base.hp },
              alive: b.currentHp > 0,
            })),
          }
        : {}),
    },
    opponent: {
      unitId: foe.unitId,
      speciesId: foe.speciesId,
      hp: { current: foe.currentHp, max: foe.base.hp },
      revealedMoveIds: [...foe.revealedMoveIds],
      ppEstimate: { kind: "unknown" }, // PP 永不公开
      stages: { ...foe.stages },
      effects: publicEffects(foe.effects, /* opponent: hidden effects never leave */ false),
      ...(foe.mode !== undefined ? { mode: foe.mode } : {}),
      ...(sFoe.bench !== undefined ? { benchAlive: sFoe.bench.filter((b) => b.currentHp > 0).length } : {}),
    },
    decision: isActor
      ? {
          decisionId: decision.decisionId,
          kind: decision.kind,
          baseRevision: decision.baseRevision,
          actors: decision.actors,
          deadlineMs: decision.deadlineMs,
        }
      : null,
    terminal: state.terminal,
    legalActions: legalActionFor(state, side),
  };
  return obs;
}

/** 公开历史：对已投影的公开流按 seq>since 过滤；seq 连续无缺口。 */
export function projectHistory(
  publicStream: readonly { seq: number; event: BattleEvent }[],
  since: number,
): { cursor: number; events: BattleEvent[] } {
  return {
    cursor: publicStream.length === 0 ? since : publicStream[publicStream.length - 1]!.seq,
    events: publicStream.filter((e) => e.seq > since).map((e) => e.event),
  };
}
