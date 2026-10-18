/**
 * ops/axes.ts —— immune/reflect/modifier 轴脱糖：具名被动窗状态 →
 * kind:"immune"|"reflect"|"modifier" + params.of 位掩码 / at 管线槽位 + label=原名。
 *
 * 脱糖发生在 apply_status 挂载时（apply-effect.ts）：编译产物保留原语义名，
 * 运行时实例统一为轴 kind。免疫窗消费点经 immuneOn(u, IM.*) 位测试，
 * 反弹窗经 reflectOn(u, RF.*)，修饰窗经 isMod(e, at)/modsAt(u, at)——
 * 新增修饰名 = 一行，且 at 槽位已经有 isMod/modsAt 读取。没有读取的槽位，轴检查失败。
 */
import { effectDefOf, IM, RF } from "./effects.ts";
import type { CompiledEffect } from "../loader.ts";

type P = Record<string, number>;
type Fx = CompiledEffect & { op: "apply_status"; params?: P };

const IMMUNE_OF: Record<string, number> = {
  immune_status: IM.status,
  immune_degrade: IM.degrade,
  dmg_immune: IM.dmg,
  flat_immune: IM.flat,
  crit_immune: IM.crit,
  prio_immune: IM.prio,
  immune_chance: IM.status,
  crit_dodge: IM.crit,
  heal_block: IM.heal,
};
const REFLECT_OF: Record<string, number> = {
  reflect_status: RF.status,
  reflect_degrade: RF.degrade,
  reflect_ctl: RF.ctl,
  reflect_dmg: RF.dmg,
  crit_reflect: RF.crit,
};

/** modifier 轴：name → {at 槽位, inject 脱糖时注入 params 的 def 级字面值}。
 *  at=旧 flag 名（消费槽位一一对应）；inject 承载原 def 字面值（ppCostMul:2/mustMiss:scope 等）。
 *  mustMiss scope 位掩码：1=物理 2=特殊 4=属性（all=7/attack=3/status=4）。
 *  pierce scope 位掩码：1=护盾/免疫/伤转穿透 2=守方强化穿透 4=减伤/上下限穿透。 */
const MOD_AT: Record<string, { at: string; inject?: P }> = {
  prio_up: { at: "prioAdd" },
  prio_count: { at: "prioAdd", inject: { prioCount: 1 } },
  prio_negate: { at: "prioNegate" },
  pp_double: { at: "ppCostMul", inject: { mul: 2 } },
  pp_mul: { at: "ppCostMul" },
  pp_free: { at: "ppCostMul", inject: { mul: 0 } },
  pp_consume_hit: { at: "ppConsumeHit" },
  dmg_mul: { at: "dmgMul" },
  dmg_flat: { at: "dmgFlat" },
  dmg_boost: { at: "dmgOutPct" },
  dmg_weaken: { at: "dmgOutFrac" },
  dmg_out_floor: { at: "dmgOutFloor" },
  dmg_out_cap: { at: "dmgOutCap" },
  dmg_cap: { at: "dmgCap" },
  dmg_floor: { at: "dmgFloor" },
  dmg_immune_above: { at: "dmgImmuneAbove" },
  dmg_taken_up: { at: "dmgTakenPct" },
  dmg_taken_down: { at: "dmgTakenDown" },
  dmg_reduce: { at: "dmgReduceFlat" },
  // 「使用体力药剂变成降低相应的体力」——hp 药剂回复翻转为等量固伤。
  // 读取点在 mechanics/items 的 planAction（不是 ops 层），槽位名用于登记。
  item_heal_reverse: { at: "itemHealReverse" },
  phys_half: { at: "dmgTakenCatFrac" },
  spec_half: { at: "dmgTakenCatFrac" },
  atk_taken_frac: { at: "dmgTakenCatFrac" },
  flat_taken_pct: { at: "flatTakenPct" },
  pct_taken_pct: { at: "pctTakenPct" },
  pri_taken_pct: { at: "priTakenPct" },
  fixed_taken_pct: { at: "fixedTakenPct" },
  crit_up: { at: "critChance" },
  crit_always: { at: "critAlways" },
  crit_dealt: { at: "critDealtPct" },
  crit_taken_up: { at: "critTakenPct" },
  even_dmg: { at: "evenOutcome" },
  dmg_to_heal: { at: "dmgToHeal" },
  dmg_to_shield: { at: "dmgToShield" },
  heal_cut: { at: "healCut" },
  heal_boost: { at: "healBoost" },
  drain_atk: { at: "drainAtk" },
  drain_on_use: { at: "drainOnUse" },
  power_mul: { at: "powerMul" },
  counter: { at: "counter" },
  pct_rider: { at: "pctRider" },
  ignore_def: { at: "ignoreDef" },
  ignore_self_down: { at: "ignoreSelfDown" },
  unify_offense: { at: "unifyOffense" },
  stage_alias: { at: "stageAlias" },
  must_hit: { at: "mustHit" },
  sure_hit: { at: "mustHit" },
  must_miss: { at: "mustMiss", inject: { scope: 7 } },
  must_miss_phys: { at: "mustMiss", inject: { scope: 1 } },
  must_miss_spec: { at: "mustMiss", inject: { scope: 2 } },
  must_miss_atk: { at: "mustMiss", inject: { scope: 3 } },
  must_miss_stat: { at: "mustMiss", inject: { scope: 4 } },
  dodge: { at: "missChance" },
  fumble: { at: "fumble" },
  move_null: { at: "nullifies" },
  hit_fx_null: { at: "hitFxNull" },
  status_lock: { at: "blockCategory" },
  pierce: { at: "pierce", inject: { scope: 1 } },
  pierce_stages: { at: "pierce", inject: { scope: 2 } },
  pierce_limit: { at: "pierce", inject: { scope: 4 } },
  up_lock: { at: "upLock" },
  down_lock: { at: "downLock" },
  no_stage_up: { at: "noStageUp" },
  timed_lock: { at: "timedLock" },
  cleanse_lock: { at: "cleanseLock" },
  mirror_stages: { at: "mirrorStages" },
  protect: { at: "protectAll" },
  no_switch: { at: "noSwitch" },
  endure: { at: "endure" },
  max_hp_down: { at: "maxHpDown" },
  revive_fx: { at: "reviveFx" },
  next_chance: { at: "nextChance" },
  type_swap: { at: "typeSwap" },
  type_copy: { at: "typeCopy" },
};

export interface AxisForm {
  kind: "immune" | "reflect" | "modifier";
  /** 审计标签=原名；定向免疫（fx.ailment 子类编码）保留 "name:ailment" 复合标签。 */
  label: string;
  /** immune/reflect=位掩码 of + 原 params 透传；modifier=at 注入值 + 原 params 透传。 */
  params: P;
  /** modifier 槽位（旧 flag 名；管线消费点 isMod(e,at) 匹配）。 */
  at?: string;
  /** 定向免疫的异常子类（immune_status:burn → scope=burn；缺省=广谱）。 */
  ailment?: string;
}

/** apply_status{name} → 轴形态（immune{of}/reflect{of}/modifier{at}）；非轴名返回 undefined（原样挂载）。 */
export function axesFormOf(fx: Fx): AxisForm | undefined {
  if (fx.op !== "apply_status") return undefined;
  const d = effectDefOf(fx.name);
  const label = fx.ailment !== undefined ? `${fx.name}:${fx.ailment}` : fx.name;
  if (d?.immune === "params") {
    const of = IMMUNE_OF[fx.name];
    if (of === undefined) return undefined;
    return { kind: "immune", label, params: { of, ...(fx.params ?? {}) }, ...(fx.ailment !== undefined ? { ailment: fx.ailment } : {}) };
  }
  if (d?.reflect === "params") {
    const of = REFLECT_OF[fx.name];
    if (of === undefined) return undefined;
    return { kind: "reflect", label, params: { of, ...(fx.params ?? {}) }, ...(fx.ailment !== undefined ? { ailment: fx.ailment } : {}) };
  }
  if (d?.modifier === "params") {
    const m = MOD_AT[fx.name];
    if (m === undefined) return undefined;
    return { kind: "modifier", label, at: m.at, params: { ...(m.inject ?? {}), ...(fx.params ?? {}) } };
  }
  return undefined;
}
