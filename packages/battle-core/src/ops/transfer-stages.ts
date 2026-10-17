/** ops/transfer-stages.ts —— transfer_stages：吸强（源清零→目标加绝对值，overlay 免疫整 op 无效）。 */
import { stageKeysFor } from "../mechanics/index.ts";
import { EngineFault, OTHER } from "../types.ts";
import { clamp, overlayOf } from "./shared.ts";
import { upLockOn } from "./effects.ts";
import { fireReactive } from "./index.ts";
import type { OpHandler } from "./types.ts";

// 注意：不能顶层固化 `const stageKeys = stageKeysFor`——mechanics/soulmark→ops 的循环边
// 会让本模块在 mechanics/index 完成求值前先跑顶层代码，捕获到 undefined。走 live binding 调用。
const stageKeys = (pack: Parameters<typeof stageKeysFor>[0]) => stageKeysFor(pack);

export const transferStagesOp: OpHandler = (ctx, ctxFx) => {
  const fx = ctxFx;
  const { pack, events, side, unit, foe, rng } = ctx;
  if (fx.op !== "transfer_stages") throw new EngineFault("OP_DISPATCH", `transfer_stages handler got ${fx.op}`);
  // randomCount+randomDelta：随机吸取 N 项能力（对手该维 -=delta，自身 +=delta，同维成对）
  if (fx.randomCount !== undefined) {
    const d = fx.randomDelta ?? 1;
    const keys = [...stageKeys(pack)];
    const moved: Record<string, number> = {};
    // randomCountRange：次数区间先抽（"随机吸取对手1-6项属性"）
    const want = fx.randomCountRange !== undefined
      ? fx.randomCountRange.min + rng.drawBelow(Math.max(1, fx.randomCountRange.max - fx.randomCountRange.min + 1), "stat_pick")
      : fx.randomCount;
    let picked = 0;
    while (keys.length > 0 && picked < want) {
      const i = rng.drawBelow(keys.length, "stat_pick");
      const k = keys.splice(i, 1)[0]!;
      const fBefore = foe.stages[k] ?? 0;
      const sBefore = unit.stages[k] ?? 0;
      foe.stages[k] = clamp(fBefore - d, -6, 6);
      unit.stages[k] = clamp(sBefore + d, -6, 6);
      moved[k] = fx.plain === true ? d : (fBefore - foe.stages[k]) || 0; // tick 记名义量
      picked++;
    }
    if (picked === 0) {
      if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
      return "continue";
    }
    events.push({ type: "stages-transferred", detail: { side, stages: moved } });
    return "continue";
  }
  // direction:"upToDown" —— 自身正级等额转为对手负级（"将自身能力提升状态附加给对手相应的能力下降效果"）。
  if (fx.direction === "upToDown") {
    const pushed: Record<string, number> = {};
    let anyUp = false;
    for (const stat of stageKeys(pack)) {
      const v = unit.stages[stat] ?? 0;
      if (v <= 0) continue;
      anyUp = true;
      pushed[stat] = -v;
      foe.stages[stat] = clamp((foe.stages[stat] ?? 0) - v, -6, 6);
      unit.stages[stat] = 0;
    }
    if (!anyUp) {
      events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
      return "continue";
    }
    events.push({ type: "stages-transferred", detail: { side: OTHER[side], stages: pushed } });
    return "continue";
  }
  // direction:"push" —— 反向：自身负级推给对手（"将自身能力下降状态反馈给对手"）。
  // plain（tick 语义）：事件侧记持有者（bespoke tick 惯例），无 action-failed
  if (fx.direction === "push") {
    const pushed: Record<string, number> = {};
    let anyPush = false;
    for (const stat of stageKeys(pack)) {
      const v = unit.stages[stat] ?? 0;
      if (v >= 0) continue;
      anyPush = true;
      const mul = typeof fx.mul === "object" && fx.mul !== null ? fx.mul.numerator / fx.mul.denominator : fx.mul ?? 1; // "双倍反馈"/"N倍返还"：推给对手的级数 ×mul
      pushed[stat] = v * mul;
      foe.stages[stat] = clamp((foe.stages[stat] ?? 0) + v * mul, -6, 6);
      unit.stages[stat] = 0;
    }
    if (!anyPush) {
      if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
      return "continue";
    }
    events.push({ type: "stages-transferred", detail: { side: fx.plain === true ? side : OTHER[side], stages: pushed } });
    return "continue";
  }
  // §4.1 吸强：原子转移（源清零→目标加绝对值），overlay 免疫时整个 op 无效（plain/tick 不吃免疫/锁）
  if (fx.plain !== true && overlayOf(pack, foe)?.immuneClearStages) {
    events.push({ type: "action-failed", detail: { side, reason: "overlay_immune" } });
    return "continue";
  }
  // 强化锁（"能力提升状态无法被消除或吸取"）：源侧正级存在时禁止吸取（负级照吸）
  const srcPositive = stageKeys(pack).some((k) => (foe.stages[k] ?? 0) > 0);
  if (fx.plain !== true && upLockOn(foe) && srcPositive) {
    events.push({ type: "action-failed", detail: { side, reason: "up_lock" } });
    return "continue";
  }
  const moved: Record<string, number> = {};
  let lostPositive = false;
  const stealMul = typeof fx.mul === "object" && fx.mul !== null ? fx.mul.numerator / fx.mul.denominator : fx.mul ?? 1; // "双倍吸取"：获得级数 ×mul
  for (const stat of stageKeys(pack)) {
    if (fx.stat !== undefined && stat !== fx.stat) continue; // "吸取对手速度能力提升"——单维过滤
    if (fx.sign === "up" && (foe.stages[stat] ?? 0) <= 0) continue;
    if (fx.sign === "down" && (foe.stages[stat] ?? 0) >= 0) continue;
    if ((foe.stages[stat] ?? 0) === 0) continue;
    if ((foe.stages[stat] ?? 0) > 0) lostPositive = true;
    moved[stat] = Math.abs(foe.stages[stat]!);
    unit.stages[stat] = clamp((unit.stages[stat] ?? 0) + Math.abs(foe.stages[stat]!) * stealMul, -6, 6);
    foe.stages[stat] = 0;
  }
  if (Object.keys(moved).length === 0) {
    if (fx.plain !== true) events.push({ type: "action-failed", detail: { side, reason: "no-stages" } });
    return "continue";
  }
  events.push({ type: "stages-transferred", detail: { side, stages: moved } });
  // 吸强同样构成"能力提升状态被消除"（trigger=7，作用于被吸方；noHooks/tick 不派发）
  if (lostPositive && fx.noHooks !== true) {
    const { foe: _f, target: _t, targetSide: _ts, ...rest } = ctx;
    const cp = fireReactive({ ...rest, side: OTHER[side], unit: foe }, foe, 7, {});
    if (cp !== "continue") return cp;
  }
  return "continue";
};
