/** ops/apply-effect.ts —— apply_status / apply_effect：附加按回合递减的效果条目（params 携带 timed 幅值）。 */
import { EngineFault, OTHER } from "../types.ts";
import { effectDefOf, immuneOn, reflectOn, hpCapOf, moveIdHash, IM, RF } from "./effects.ts";
import { condEval } from "./cond.ts";
import { markCount } from "./mark.ts";
import { periodicFormOf } from "./periodic.ts";
import { axesFormOf } from "./axes.ts";
import type { OpHandler } from "./types.ts";

export const applyStatusOp: OpHandler = (ctx, fx) => {
  const { next, events, side, unit, target, targetSide, rng } = ctx;
  if (fx.op !== "apply_status" && fx.op !== "apply_effect") {
    throw new EngineFault("OP_DISPATCH", `apply_status/apply_effect handler got ${fx.op}`);
  }
  // randomPick：从 list 随机抽 count 种施加（"随机进入麻痹或睡眠中的1种异常状态"）——逐抽 rng 记账；
  // countRange 区间先抽数量（"随机进入1-2种异常状态"）
  if (fx.op === "apply_status" && fx.random !== undefined && fx.random.list.length > 0) {
    const { random, ...rest } = fx;
    const pool = [...random.list];
    const want = random.countRange !== undefined
      ? random.countRange.min + ctx.rng.drawBelow(Math.max(1, random.countRange.max - random.countRange.min + 1), "ailment_count")
      : random.count;
    let picked = 0;
    while (pool.length > 0 && picked < want) {
      const k = pool.splice(ctx.rng.drawBelow(pool.length, "ailment_pick"), 1)[0]!;
      applyStatusOp(ctx, { ...rest, name: k });
      picked++;
    }
    return "continue";
  }
  // 轴脱糖（drain_dot/hot/stage_tick/… → periodic{win,label,payload}；
  // immune_*/reflect_*/heal_block/… → immune{of}|reflect{of} 位掩码条目）：
  // 编译产物保留原名做审计，运行时统一走 runPeriodicWin 窗口派发 / immuneOn·reflectOn 位测试。
  const per = fx.op === "apply_status" ? periodicFormOf(fx) : undefined;
  const ax = per === undefined && fx.op === "apply_status" ? axesFormOf(fx) : undefined;
  // fx.ailment：定向免疫/限定型状态的子类编码——运行时 kind 合成为 "name:ailment"（mark:* 先例；op name 保持 schema 合法字符集）
  const kind = fx.op === "apply_status" ? (per !== undefined ? "periodic" : ax !== undefined ? ax.kind : fx.ailment !== undefined ? `${fx.name}:${fx.ailment}` : fx.name) : `tag:${fx.name}`;
  // 反弹异常：持有 reflect{of:status} 的目标把"异常施加"重定向回行动方（仅 ailment）
  let landTarget = target;
  let landSide = targetSide;
  if (targetSide !== side && reflectOn(target, RF.status) && unit.currentHp > 0 && effectDefOf(kind)?.ailment === true) {
    events.push({ type: "control-immune", detail: { side: targetSide, name: `reflect:${kind}` } });
    landTarget = unit;
    landSide = side;
  } else if (targetSide !== side && reflectOn(target, RF.ctl) && unit.currentHp > 0 && effectDefOf(kind)?.ailment === true && (effectDefOf(kind)?.blockChance ?? 0) > 0) {
    // 控制类异常反弹（reflect{of:ctl}——"反弹所有受到的控制类异常状态"：仅 blockChance>0 的硬控反弹回行动方）
    events.push({ type: "control-immune", detail: { side: targetSide, name: `reflect_ctl:${kind}` } });
    landTarget = unit;
    landSide = side;
  } else if (immuneOn(landTarget, IM.status, kind) && effectDefOf(kind)?.ailment === true) {
    // 免疫异常只拦 ailment 标记的效果（自身 buff/hot 不受影响）；
    // params.count 次数盾逐次递减耗尽移除。
    landTarget.immuneThisTurn = (landTarget.immuneThisTurn ?? 0) + 1; // "成功触发免疫"谓词记账
    landTarget.immunedMask = (landTarget.immunedMask ?? 0) | 8; // bit8=异常状态
    events.push({ type: "control-immune", detail: { side: landSide, name: kind } });
    let immuneDrain = 0;
    let immuneDmg = 0;
    for (const e of landTarget.effects) {
      if (e.kind === "immune" && (((e.params?.of as number | undefined) ?? 0) & IM.status) !== 0) {
        immuneDrain += (e.params?.onImmuneDrain as number | undefined) ?? 0;
        immuneDmg += (e.params?.onImmuneDmg as number | undefined) ?? 0;
        if (e.params?.count !== undefined) {
          e.params.count -= 1;
          if (e.params.count <= 0) landTarget.effects = landTarget.effects.filter((x) => x !== e);
        }
      }
    }
    // "每次免疫成功吸取对手N点体力"——每次成功拦截即从施加方抽 flat（致死保留 checkpoint 归调用方 banish 通道）
    if (immuneDrain > 0 && unit.currentHp > 0) {
      const amt = Math.min(unit.currentHp, immuneDrain);
      unit.currentHp -= amt;
      landTarget.currentHp = Math.min(hpCapOf(landTarget), landTarget.currentHp + amt);
      events.push({ type: "damage", detail: { side, amount: amt, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "drain" } });
      events.push({ type: "heal", detail: { side: landSide, amount: amt, hpAfter: { current: landTarget.currentHp, max: landTarget.base.hp }, source: "drain" } });
    }
    // "每次免疫成功则在回合结束时附加N点真实伤害"（timed-112 同款时点近似：格挡点即结）
    if (immuneDmg > 0 && unit.currentHp > 0) {
      const amt = Math.min(unit.currentHp, immuneDmg);
      unit.currentHp -= amt;
      events.push({ type: "damage", detail: { side, amount: amt, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "true", cause: "immune-echo" } });
    }
    return "continue";
  }
  // 概率免疫异常（immune{of:status}+params.chance："N%概率免疫异常状态"——每次施加单独判定，判定在反射重定向后）
  if (effectDefOf(kind)?.ailment === true) {
    for (const e of landTarget.effects) {
      const ch = e.kind === "immune" && (((e.params?.of as number | undefined) ?? 0) & IM.status) !== 0 ? e.params?.chance : undefined;
      // hpFull 门控（"满体力时N%概率免疫"——不满血该窗口不判定也不消耗 draw）
      if (e.params?.hpFull === 1 && landTarget.currentHp < landTarget.base.hp) continue;
      if (ch !== undefined && ctx.rng.drawBelow(100, "immune_chance") < ch) {
        landTarget.immuneThisTurn = (landTarget.immuneThisTurn ?? 0) + 1;
        landTarget.immunedMask = (landTarget.immunedMask ?? 0) | 8;
        events.push({ type: "control-immune", detail: { side: landSide, name: kind } });
        const immuneDrain = landTarget.effects.reduce((acc, x) => acc + (((x.params?.onImmuneDrain as number | undefined) ?? 0) * (x.kind === "immune" && (((x.params?.of as number | undefined) ?? 0) & IM.status) !== 0 ? 1 : 0)), 0);
        if (immuneDrain > 0 && unit.currentHp > 0) {
          const amt = Math.min(unit.currentHp, immuneDrain);
          unit.currentHp -= amt;
          landTarget.currentHp = Math.min(hpCapOf(landTarget), landTarget.currentHp + amt);
          events.push({ type: "damage", detail: { side, amount: amt, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "drain" } });
          events.push({ type: "heal", detail: { side: landSide, amount: amt, hpAfter: { current: landTarget.currentHp, max: landTarget.base.hp }, source: "drain" } });
        }
        return "continue";
      }
    }
  }
  // params.perStage：幅值按持有者当前正面能力等级数乘算（"自身每处于1种能力提升状态附加N点护盾"→flat=N×段数）
  // params.flatMaxHpDiff：幅值=双方最大体力差值（"获得点数等同于双方最大体力差值的护盾"）
  // params.dynDealt：幅值=本回合行动方已造成的累计伤害（"减少n点，n等于本回合自身造成的伤害"——落地时烘焙 lastDealt）
  // params.dynMulN/dynMulD：dynDealt 的缩放系数（"相当于本次伤害的N/M"——flat=lastDealt×n/d）
  // params.fracMaxHpN/fracMaxHpD：幅值=持有者最大体力分数（"为自身附加最大体力1/4的护盾"→flat=hpMax×n/d）
  // params.fracMissingN/fracMissingD：幅值=持有者已损失体力分数（"附加等同于已损失体力N/M的护盾"→flat=missing×n/d）
  // params.fracFoeMaxHpN/fracFoeMaxHpD：幅值=对手最大体力分数（maxhp_tick 周期累加——每次派发按当刻对手上限重算）
  // fx.mulSelfStageLvl：flat ×= ⌊持有者指定维正级/per⌋（maxhp perStage 变体）
  const fxParams = per !== undefined ? per.params : ax !== undefined ? ax.params : fx.params;
  const lvlMul = fx.op === "apply_status" && fx.mulSelfStageLvl !== undefined
    ? Math.floor(Math.max(0, unit.stages[fx.mulSelfStageLvl.stat] ?? 0) / Math.max(1, fx.mulSelfStageLvl.per))
    : undefined;
  const params = fxParams !== undefined && (fxParams.perStage !== undefined || fxParams.flatMaxHpDiff !== undefined || fxParams.dynDealt !== undefined || fxParams.fracMaxHpN !== undefined || fxParams.fracMissingN !== undefined || fxParams.fracCurHpN !== undefined || fxParams.fracFoeMaxHpN !== undefined || fxParams.fromOverflow === 1 || fxParams.flatPerDeadPer !== undefined || fxParams.excludeSelfMove === 1 || lvlMul !== undefined)
    ? {
        ...fxParams,
        ...(fxParams.perStage !== undefined && fxParams.flat !== undefined
          ? { flat: fxParams.flat * Math.max(1, Object.values(landTarget.stages).filter((v) => v > 0).length) }
          : {}),
        ...(fxParams.flatMaxHpDiff !== undefined ? { flat: Math.abs(unit.base.hp - ctx.foe.base.hp) } : {}),
        ...(fxParams.dynDealt !== undefined
          ? { flat: Math.floor(((unit.lastDealt ?? 0) * (fxParams.dynMulN ?? 1)) / (fxParams.dynMulD ?? 1)) }
          : {}),
        ...(fxParams.fracMaxHpN !== undefined ? { flat: Math.floor((landTarget.base.hp * fxParams.fracMaxHpN) / (fxParams.fracMaxHpD ?? 1)) } : {}),
        ...(fxParams.fracFoeMaxHpN !== undefined ? { flat: Math.floor((ctx.foe.base.hp * fxParams.fracFoeMaxHpN) / (fxParams.fracFoeMaxHpD ?? 1)) } : {}),
        ...(fxParams.fracMissingN !== undefined ? { flat: Math.floor((Math.max(0, landTarget.base.hp - landTarget.currentHp) * fxParams.fracMissingN) / (fxParams.fracMissingD ?? 1)) } : {}),
        ...(fxParams.fracCurHpN !== undefined ? { flat: Math.floor((landTarget.currentHp * fxParams.fracCurHpN) / (fxParams.fracCurHpD ?? 1)) } : {}),
        ...(fxParams.fromOverflow === 1 ? { flat: landTarget.lastHealOverflow ?? 0 } : {}),
        ...(fxParams.flatPerDeadPer !== undefined && fxParams.flatPerDeadAdd !== undefined
          ? { flat: Math.floor((ctx.next.sides[ctx.side].bench ?? []).filter((b) => b.currentHp <= 0).length / Math.max(1, fxParams.flatPerDeadPer)) * fxParams.flatPerDeadAdd }
          : {}),
        ...(fxParams.excludeSelfMove === 1 && ctx.move !== undefined ? { excludeMoveId: moveIdHash(ctx.move.id) } : {}),
        // mulSelfStageLvl × fracFoeMaxHp 组合：n 先乘级数商再取分数（旧 maxhpTickOf：floor(foeMax·n·⌊lvl/per⌋/d)）
        ...(lvlMul !== undefined && fxParams.fracFoeMaxHpN !== undefined
          ? { flat: Math.floor((ctx.foe.base.hp * fxParams.fracFoeMaxHpN * lvlMul) / (fxParams.fracFoeMaxHpD ?? 1)) }
          : lvlMul !== undefined ? { flat: (fxParams.flat ?? 0) * lvlMul } : {}),
      }
    : fxParams;
  // react 条目按 trigger+守卫（cat/min/count）区分——"受击则X"与"受物理攻击时Y"守卫不同不合并
  const reactKey = (p: { [k: string]: unknown } | undefined) => `${p?.trigger ?? ""}:${p?.cat ?? ""}:${p?.min ?? ""}`;
  // periodic 条目按 win+label 区分（不同语义同名 periodic 不互并）；immune/reflect 按 label（原名+子类后缀）区分
  const periodicKey = (e: { label?: string | undefined; params?: { [k: string]: unknown } | undefined }) => `${e.params?.win ?? ""}:${e.label ?? ""}`;
  const axisKey = (e: { label?: string | undefined }) => e.label ?? "";
  // countPerMark：次数值=印记层数（"对手每存在1层处决印记自身免疫1次异常"→params.count=层数；per 除法在 markCount 内）
  const params0 = fx.op === "apply_status" && fx.countPerMark !== undefined
    ? { ...(params ?? {}), count: markCount(ctx, fx.countPerMark) }
    : params;
  // flatPerBench：落地时按背包存活数线性加成 flat（"护盾可抵御100，背包内每存活一只精灵护盾值增加100，最高600"——flatCap 封顶总额）
  const params1 = params0 !== undefined && params0.flat !== undefined && params0.flatPerBench !== undefined
    ? { ...params0, flat: Math.min(params0.flatCap ?? Number.MAX_SAFE_INTEGER, params0.flat + (ctx.next.sides[landSide].bench ?? []).filter((b) => b.currentHp > 0 && b.banished !== true).length * params0.flatPerBench) }
    : params0;
  // pctPerAilTurn：落地时按目标指定异常剩余回合数×pct 烘焙 params.pct（"自身每有1回合流血伤害提升15%最高90%"——逐回合重挂逐次重算）
  const params2 = fx.op === "apply_status" && fx.pctPerAilTurn !== undefined
    ? (() => {
        const spec = fx.pctPerAilTurn;
        const turns = landTarget.effects.reduce((acc, e) => acc + (effectDefOf(e.kind)?.ailment === true && (spec.ail === undefined || e.kind === spec.ail) ? (e.remainingTurns ?? 0) : 0), 0);
        return { ...(params1 ?? {}), pct: Math.min(spec.cap ?? Number.MAX_SAFE_INTEGER, Math.floor(turns / Math.max(1, spec.per ?? 1)) * spec.pct) } as Record<string, number>;
      })()
    : params1;
  // turnsRange：随机持续（"作用N~M回合"——落地时抽一次）
  const effTurns = fx.turns ?? (fx.op === "apply_status" && fx.turnsRange !== undefined ? fx.turnsRange.min + rng.drawBelow(fx.turnsRange.max - fx.turnsRange.min + 1, "turns_range") : undefined);
  const existing = (fx.op === "apply_status" && fx.stack === true) ? undefined : landTarget.effects.find((e) =>
    e.kind === kind
    && e.moveType === (fx.op === "apply_status" ? fx.moveType : undefined)
    && (kind !== "react" || reactKey(e.params) === reactKey(params2))
    && (kind !== "periodic" || periodicKey(e) === periodicKey({ label: per !== undefined ? fx.name : fx.op === "apply_status" ? fx.label : undefined, params: params2 }))
    && (kind !== "immune" && kind !== "reflect" && kind !== "modifier" || axisKey(e) === axisKey({ label: ax?.label })));
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns ?? 0, effTurns ?? 0);
    existing.appliedTurn = next.turn;
    // mark:* 印记条目叠层而非覆盖（params.count+=新count，cap 封顶）——apply_mark 之外的印记来源兼容路径
    if (kind.startsWith("mark:") && params2?.count !== undefined) {
      const cap = params2.cap ?? existing.params?.cap ?? 99;
      existing.params = { ...params2, count: Math.min(cap, (existing.params?.count ?? 0) + params2.count), cap };
    } else if (fx.op === "apply_status" && fx.accFlat === true && params2?.flat !== undefined) {
      // accFlat（maxhp_tick 周期累加）：flat 累加而非覆盖，其余参数随新值
      existing.params = { ...existing.params, ...params2, flat: (existing.params?.flat ?? 0) + params2.flat };
    } else if (kind === "feeble" && fxParams?.layers !== undefined) {
      // 再施加累加层数（"增加一层衰弱"——同名再挂是叠层，不是覆盖）
      existing.params = { ...(params2 ?? {}), layers: (existing.params?.layers ?? 0) + fxParams.layers };
    } else if (params2 !== undefined) existing.params = params2;
    // 同触发器不同负载合并（"受击则A"+"受击则B"→一条 react、两份 payload）；
    // periodic：authored payload（ailment_tick/pp_zero_tick）沿旧 append 语义，
    // 脱糖生成 payload（stage_tick/hot 等）按旧 params 覆盖语义整体替换（后施加为准）
    const fxPayload = fx.op === "apply_status" ? fx.payload : undefined;
    if (fxPayload !== undefined) existing.payload = [...(existing.payload ?? []), ...(fxPayload as unknown as { [k: string]: unknown }[])];
    else if (per !== undefined) existing.payload = [...per.payload] as unknown as { [k: string]: unknown }[];
  } else {
    landTarget.effects.push({
      kind,
      effectInstanceId: `efx_${landSide}_${kind}`,
      ...(effTurns !== undefined ? { remainingTurns: effTurns } : {}),
      ...(params2 !== undefined ? { params: params2 } : {}),
      ...(fx.op === "apply_status" && (per !== undefined || fx.payload !== undefined) ? { payload: [...(per !== undefined ? per.payload : fx.payload!)] as unknown as { [k: string]: unknown }[] } : {}),
      ...(per !== undefined ? { label: fx.name } : ax !== undefined ? { label: ax.label } : fx.op === "apply_status" && fx.label !== undefined ? { label: fx.label } : {}),
      ...(ax?.at !== undefined ? { at: ax.at } : {}),
      ...(ax?.ailment !== undefined ? { ailment: ax.ailment } : {}),
      ...(fx.op === "apply_status" && fx.moveType !== undefined ? { moveType: fx.moveType } : {}),
      appliedTurn: next.turn,
    });
  }
  // 限疗上限（max_hp_down）：挂载/累加后按新上限收拢当前体力
  if (ax?.at === "maxHpDown") landTarget.currentHp = Math.min(landTarget.currentHp, hpCapOf(landTarget));
  // extendIf：条件延长持续回合（"若本次技能造成的伤害高于400则闪避效果延长1回合"——落地后按谓词补 turns）
  if (fx.op === "apply_status" && fx.extendIf !== undefined && (fx.extendIf.when === undefined || condEval(ctx, fx.extendIf.when))) {
    const ent = existing ?? landTarget.effects[landTarget.effects.length - 1];
    if (ent?.remainingTurns !== undefined) ent.remainingTurns += fx.extendIf.turns;
  }
  events.push({ type: "effect-applied", detail: { side: landSide, name: per !== undefined ? fx.name : ax !== undefined ? ax.label : kind, turns: effTurns ?? 0 } });
  return "continue";
};
