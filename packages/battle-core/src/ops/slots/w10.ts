/**
 * ops/slots/w10.ts —— stages_rewind：把目标能力等级回退到 N 回合前的快照。
 *
 * 语料只有一句「(先|后)出手时将自身能力等级返回至上一回合结束时」。
 * 引擎每回合开始已经记 turnStartStages（engine.ts applyTurnInner），
 * 本回合开始的快照 == 上一回合结束时的等级（回合内只改本回合的 stages），
 * 所以 turns=1 直读该快照即可：不新开状态名、不加 params 键、不加别的结算分支。
 * turns>1 需要回合级历史环形缓冲，引擎没有——按无快照处理（action-failed），不臆造。
 *
 * 本文件按 w10 的边界单独持有：不注册进 ops/index.ts、不改 schema、
 * 不改 loader 的 CompiledEffect 联合、不改 ruleset allowlist。
 * 因此现在装载期派发不到它——补齐注册的四处契约见 scratch/parallel/w10-need-op.md。
 * 处理器按最终契约写全，注册补齐即可直接跑，不用回来重写。
 */
import { EngineFault } from "../../types.ts";
import { stageKeysFor } from "../../mechanics/index.ts";
import type { OpHandler } from "../types.ts";

export const stagesRewindOp: OpHandler = (ctx, fx) => {
  const { pack, events, side, unit, foe, targetSide } = ctx;
  // CompiledEffect 联合里还没有 stages_rewind 分支（注册四处见 w10-need-op.md），
  // 所以这里从 fx 上读出载荷，不做可辨识联合收窄。
  const fxr = fx as { op: string; turns?: number };
  if (fxr.op !== "stages_rewind") throw new EngineFault("OP_DISPATCH", `stages_rewind handler got ${fxr.op}`);
  const t = targetSide === side ? unit : foe;
  const turns = fxr.turns ?? 1;
  const snap = turns === 1 ? t.turnStartStages : undefined;
  if (snap === undefined || t.currentHp <= 0) {
    events.push({ type: "action-failed", detail: { side: targetSide, reason: "no-snapshot" } });
    return "continue";
  }
  let any = false;
  for (const k of stageKeysFor(pack)) {
    const want = snap[k] ?? 0;
    const before = t.stages[k] ?? 0;
    if (want === before) continue;
    t.stages[k] = want;
    events.push({ type: "stat-stage", detail: { side: targetSide, stat: k, deltaApplied: want - before, stageAfter: want } });
    any = true;
  }
  if (!any) events.push({ type: "action-failed", detail: { side: targetSide, reason: "no-stages" } });
  return "continue";
};
