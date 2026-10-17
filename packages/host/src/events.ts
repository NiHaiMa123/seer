/**
 * 事件包装与投影：CoreEvent → InternalEvent（加 seq/causeId/revision），
 * InternalEvent → BattleEvent（白名单类型 + 白名单字段）。
 * 公开投影刻意只走 whitelist：pp-spent/rngDraw/内部 detail 字段不外发。
 */
import type { InternalEvent } from "@seer/contracts/internal";
import type { BattleEvent } from "@seer/contracts";
import { MECHANICS, type CoreEvent } from "@seer/battle-core";

/** CoreEvent → InternalEvent 外壳；statePatch 由 Host 按 delta 决定（v1 记录关键字段变化点）。 */
export function wrapEvent(
  core: { type: InternalEvent["type"]; detail: Record<string, unknown>; rngDraw?: { purpose: string; value: number } },
  seq: number,
  revisionBefore: number,
  revisionAfter: number,
  causeId: string | null = null,
): InternalEvent {
  const ev: InternalEvent = {
    seq,
    type: core.type as InternalEvent["type"],
    causeId,
    revisionBefore,
    revisionAfter,
    detail: core.detail,
  };
  if (core.rngDraw) ev.rngDraw = core.rngDraw;
  return ev;
}

/** 公开允许的事件类型白名单。 */
const PUBLIC_TYPES = new Set([
  "turn-begin",
  "action-declared",
  "damage",
  "heal",
  "stat-stage",
  "stages-transferred",
  "stages-cleared",
  "effect-applied",
  "effect-faded",
  "control-immune",
  "switch",
  "revive",
  "action-failed",
  "missed",
  "protected",
  "pp-delta",
  "struggle-used",
  "ko",
  "battle-end",
]);

/** detail 里允许公开字段的白名单（per type）。 */
const PUBLIC_FIELDS: Record<string, Set<string>> = {
  "turn-begin": new Set(["turn", "decisionId"]),
  "action-declared": new Set(["side", "actionId", "moveId"]),
  damage: new Set(["side", "amount", "damageKind", "hpAfter", "eff16", "stab", "moveType", "category", "cause", "recoil", "crit", "hit", "hits"]),
  heal: new Set(["side", "amount", "hpAfter", "source"]),
  "stat-stage": new Set(["side", "stat", "deltaApplied", "stageAfter"]),
  "stages-transferred": new Set(["side", "stages"]),
  "stages-cleared": new Set(["side"]),
  "effect-applied": new Set(["side", "name", "turns"]),
  "effect-faded": new Set(["side", "name"]),
  "control-immune": new Set(["side", "name"]),
  switch: new Set(["side", "outUnitId", "inUnitId", "via"]),
  revive: new Set(["side", "hpAfter"]),
  "action-failed": new Set(["side", "reason"]),
  missed: new Set(["side", "moveId"]),
  protected: new Set(["side"]),
  // pp-delta 脱敏：moveId（对手技能 id）与 ppAfter（剩余 PP）不外发——只透出侧别与增减量
  "pp-delta": new Set(["side", "delta"]),
  "struggle-used": new Set(["side"]),
  ko: new Set(["side"]),
  "battle-end": new Set(["result", "reason"]),
};

// 机制自有事件类型并入公开白名单（Mechanic.eventFields）——机制卸载则类型离线
for (const m of MECHANICS) {
  for (const [type, fields] of Object.entries(m.eventFields ?? {})) {
    PUBLIC_TYPES.add(type);
    PUBLIC_FIELDS[type] = new Set(fields);
  }
}

/** internal → 公开事件：类型/字段双重白名单；不在白名单 → null（不外发）。 */
export function projectEvent(ev: InternalEvent): BattleEvent | null {
  if (!PUBLIC_TYPES.has(ev.type)) return null;
  const allow = PUBLIC_FIELDS[ev.type]!;
  const projected: Record<string, unknown> = { type: ev.type };
  for (const [k, v] of Object.entries(ev.detail)) {
    if (allow.has(k)) projected[k] = v;
  }
  return projected as unknown as BattleEvent;
}

// 机制 eventFields 并入之后再导出——检查工具看到的是完整公开白名单，不另抄一份
export { PUBLIC_FIELDS, PUBLIC_TYPES };
