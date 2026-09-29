/**
 * 侧锁定公开投影：内部权威态 → 单方 Observation。
 * 全部按 whitelist 重建；对手 PP 永远 ppEstimate=unknown、
 * RNG/seed/inbox/internal seq 不进入输出。
 */
import type { Observation, BattleEvent, LegalAction } from "@seer/contracts";
import type { BattleState, InternalEvent } from "@seer/contracts/internal";
import { MECHANICS, OTHER, type SideId, type UnitFieldProjection } from "@seer/battle-core";
import { projectEvent } from "./events.ts";

const MOVE_LABEL: Record<string, string> = {
  "syn-strike": "Strike",
  "syn-jab": "Jab",
  "syn-bolster": "Bolster",
  "syn-recover": "Recover",
};

type InternalEffects = BattleState["sides"]["p1"]["unit"]["effects"];
type UnitState = BattleState["sides"]["p1"]["unit"];

/** 机制投影描述符（模块加载期一次展平——observe 热路径零反射，与手写展开同形态）：
 *  into "own"  → 己方首发+替补；into "both" → 对手单位也公开（默认无，隐私边界）。 */
const OWN_PROJ = MECHANICS.flatMap((m) => m.projections ?? []);
const FOE_PROJ = OWN_PROJ.filter((p) => p.into === "both");
const mechFields = (u: UnitState, projs: readonly UnitFieldProjection[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const p of projs) {
    const v = p.get(u);
    if (v !== undefined) out[p.key] = v;
  }
  return out;
};
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

function legalActionFor(state: BattleState, side: SideId, allowed: readonly string[]): LegalAction[] {
  if (state.decision === null || !state.decision.actors.includes(side) || state.inbox[side] !== null) return [];
  const current = state.sides[side];
  return allowed.map((actionId): LegalAction => {
    if (actionId === "act_concede") return { actionId, action: { kind: "concede" }, label: "Concede" };
    if (actionId === "act_struggle") return { actionId, action: { kind: "struggle" }, label: "Struggle" };
    const switched = /^act_switch-(\d+)$/.exec(actionId);
    if (switched) {
      const unit = current.bench?.[Number(switched[1])];
      if (unit) return { actionId, action: { kind: "switch", unitId: unit.unitId }, label: `Switch → ${unit.speciesId}` };
    }
    const moveId = actionId.slice(4);
    const moveSlot = current.unit.moves.findIndex((move) => move.moveId === moveId);
    if (moveSlot >= 0) {
      return { actionId, action: { kind: "move", moveSlot, target: "opponent" }, label: MOVE_LABEL[moveId] ?? moveId };
    }
    throw new Error(`legal action ${actionId} cannot be projected`);
  });
}

export function projectObservation(state: BattleState, side: SideId, allowedActions: readonly string[]): Observation {
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
      ...(mechFields(me, OWN_PROJ) as Partial<Observation["own"]>),
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
              ...(mechFields(b, OWN_PROJ) as Record<string, unknown>),
              hp: { current: b.currentHp, max: b.base.hp },
              ppByMoveId: Object.fromEntries(b.moves.map((m) => [m.moveId, m.pp])),
              stages: { ...b.stages },
              effects: publicEffects(b.effects, true),
              ...(b.mode !== undefined ? { mode: b.mode } : {}),
              ...(b.revives !== undefined ? { revives: b.revives } : {}),
              alive: b.currentHp > 0,
            })),
          }
        : {}),
    },
    opponent: {
      unitId: foe.unitId,
      speciesId: foe.speciesId,
      ...(mechFields(foe, FOE_PROJ) as Partial<Observation["opponent"]>),
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
    legalActions: legalActionFor(state, side, allowedActions),
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
