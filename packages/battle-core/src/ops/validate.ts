/** 内容加载时统一验证原子语义，嵌套 payload 与顶层使用相同的规则。 */
import type { CompiledEffect, FeatureFlag } from "../loader.ts";
import { OPS } from "./index.ts";
import { axesFormOf } from "./axes.ts";
import { valueExpressionOf } from "./effects.ts";
import { reactGrowthMode } from "./mechanism.ts";

const SNAPSHOT_MODIFIER_AXES = new Set(["dmgOutPct", "dmgReduceFlat", "dmgFlat"]);

const OP_FEATURE: Partial<Record<CompiledEffect["op"], FeatureFlag>> = {
  transfer_stages: "stat_ops", clear_stages: "stat_ops", control: "control",
  cleanse: "control", apply_status: "control", apply_effect: "mode_overlay",
  copy_stages: "stat_ops", invert_stages: "stat_ops", stat_boost: "stat_ops",
  pp_delta: "resource_ops", force_switch: "bench",
};

export function validateEffects(
  effects: readonly CompiledEffect[] | undefined,
  rules: { operatorAllowlist?: readonly string[]; features?: readonly string[]; damageKinds?: readonly string[] },
  fail: (message: string) => never,
): void {
  const allow = rules.operatorAllowlist === undefined ? undefined : new Set(rules.operatorAllowlist);
  const features = new Set(rules.features ?? []);
  const kinds = new Set(rules.damageKinds ?? ["standard"]);
  const visit = (list: readonly CompiledEffect[] | undefined) => {
    for (const fx of list ?? []) {
      if (!(fx.op in OPS)) fail(`op "${fx.op}" not in ops registry`);
      // react 的概率增长与幅度增长共用 params.growAcc，必须在共享装载边界拒绝歧义组合。
      // 普通魂印 hook 的 grow 帧不走此规则。
      if (fx.op === "apply_status" && fx.name === "react") {
        const growth = reactGrowthMode(fx);
        if (growth.mode === "invalid") fail(`apply_status react ${growth.reason}`);
      }
      const amountTiming = (fx as CompiledEffect & { amountTiming?: unknown }).amountTiming;
      if (amountTiming !== undefined) {
        if (amountTiming !== "apply") fail(`op "${fx.op}" has unsupported amountTiming`);
        if (fx.op !== "apply_status") fail(`op "${fx.op}" cannot use amountTiming`);
        else {
          const snapshotNames = [fx.name, ...(fx.random?.list ?? [])];
          if (snapshotNames.some((name) => !SNAPSHOT_MODIFIER_AXES.has(axesFormOf({ ...fx, name })?.at ?? ""))) {
            fail(`apply_status ${fx.name} amountTiming requires a numeric modifier reader`);
          }
          if (valueExpressionOf(fx) === undefined) {
            fail(`apply_status ${fx.name} amountTiming requires amountExpr or a legacy value source`);
          }
        }
      }
      if (allow !== undefined) {
        if (!allow.has(fx.op)) fail(`uses op "${fx.op}" not in allowlist`);
        const feature = OP_FEATURE[fx.op];
        if (feature !== undefined && !features.has(feature)) fail(`op "${fx.op}" requires feature "${feature}"`);
        if (fx.op === "damage") {
          if (fx.kind !== undefined && fx.kind !== "standard" && !features.has("damage_kinds")) fail(`damage kind "${fx.kind}" requires feature "damage_kinds"`);
          if (fx.kind !== undefined && !kinds.has(fx.kind)) fail(`damage kind "${fx.kind}" not in ruleset damageKinds`);
        }
        if (fx.op === "apply_stat_stage" && fx.stat === "acc" && !features.has("accuracy")) fail('stat "acc" requires feature "accuracy"');
      }
      visit((fx as { payload?: readonly CompiledEffect[] }).payload);
    }
  };
  visit(effects);
}
