/**
 * Knowledge：pack 公开规则的机制分解表——trigger/produces/target 图。
 * 给 search_counterplay 提供真实依据：查询"什么干预能反制机制 X"
 * → 枚举干预类 × 已实现的 op，不是字面正则。
 */
import type { CompiledEffect, FrozenPack } from "@seer/battle-core";

export interface MoveMechanism {
  moveId: string;
  ops: string[];
  /** 效果可干预的维度（五类反制映射） */
  clearsStages: boolean;       // remove_precondition
  transfersStages: boolean;
  hasPriority: boolean;        // alter_timing
  appliesControl: boolean;     // → immune 反制
  penetratesImmunity: boolean; // cleanse
  directDamage: boolean;       // bypass_target
  heals: boolean;              // pay_cost 恢复
  fixedOrPercent: boolean;
}

export function mechanismOf(pack: FrozenPack, moveId: string): MoveMechanism | null {
  const m = pack.movesById.get(moveId);
  if (!m) return null;
  const ops = m.effects.map((e: CompiledEffect) => e.op);
  return {
    moveId,
    ops,
    clearsStages: ops.includes("clear_stages"),
    transfersStages: ops.includes("transfer_stages"),
    hasPriority: m.priority !== 0,
    appliesControl: ops.includes("control"),
    penetratesImmunity: ops.includes("cleanse") || ops.includes("apply_status"),
    directDamage: ops.includes("damage"),
    heals: ops.includes("heal"),
    fixedOrPercent: m.effects.some((e: CompiledEffect) => e.op === "damage" && e.kind !== undefined && e.kind !== "standard"),
  };
}

/** 五类干预 → 满足条件的 legal 候选 */
export function counterplayFor(pack: FrozenPack, legalActionIds: string[], trigger: string): Array<{ intervention: string; candidates: string[] }> {
  const acts = legalActionIds.map((a) => ({ a, m: mechanismOf(pack, a.replace(/^act_/, "")) }));
  const pick = (f: (m: MoveMechanism | null) => boolean) => acts.filter((x) => f(x.m)).map((x) => x.a);
  const out: Array<{ intervention: string; candidates: string[] }> = [
    { intervention: "remove_precondition", candidates: pick((m) => m?.clearsStages === true || m?.transfersStages === true) },
    { intervention: "alter_timing", candidates: pick((m) => m?.hasPriority === true) },
    { intervention: "block_execution", candidates: pick((m) => m?.penetratesImmunity === true) },
    { intervention: "bypass_target", candidates: pick((m) => m?.directDamage === true && m.fixedOrPercent === true) },
    { intervention: "pay_cost", candidates: legalActionIds.filter((a) => a.startsWith("act_switch-")) },
  ];
  return out.filter((i) => i.candidates.length > 0);
}
