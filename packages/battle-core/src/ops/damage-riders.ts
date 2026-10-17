/**
 * 命中之后的附加段。一段一个函数，就地改 unit/hit/events，不调用 checkpoint。
 * 顺序由 damage.ts 的调用点决定，不在这里重排。反伤不是这个家族。
 * 入参是命中程序切出来的片段，不再接收 DamageFx。
 */
import type { UnitState } from "../mechanics/types.ts";
import { OTHER, type SideId } from "../types.ts";
import { applyStatusOp } from "./apply-effect.ts";
import { condEval } from "./cond.ts";
import type { DrainSlice, OnHitSlice } from "./damage-program.ts";
import { counterFlatOf, counterMulOf, critReflectOn, dmgReflectOf, drainAtkFracs, effectDefOf, flatImmuneOn, hpCapOf, RF } from "./effects.ts";
import { statStageOp } from "./stat-stage.ts";
import type { OpCtx } from "./types.ts";

/** 吸血、定额吸血、drain_atk、按吸血量追加的固伤。drained 不出这个函数。 */
export function applyDrainRider(
  ctx: OpCtx,
  fx: DrainSlice,
  hit: UnitState,
  hitSide: SideId,
  selfHit: boolean,
  dmg: number,
  kindEff: string,
): void {
  const { events, side, unit } = ctx;
  // 吸血：按该次实际伤害分数回复自身——KO/挂起也照常结算（自愈不受目标倒下影响）
  // drainIf：条件吸血加倍（满足时多结算一份同分数吸血）
  const drains = [fx.drain, fx.drainIf !== undefined && condEval(ctx, fx.drainIf.when) ? fx.drainIf : undefined]
    .map((dr) => dr !== undefined && fx.drainMul !== undefined ? { numerator: dr.numerator * fx.drainMul.numerator, denominator: dr.denominator * fx.drainMul.denominator } : dr);
  let drained = 0;
  // drainTo:"foe"——吸血方向反转（"在场精灵吸取对手下只出场精灵"：登场结算中 unit=登场者、foe=留守施放侧 → 回血归 foe）
  const drainUnit = fx.drainTo === "foe" ? ctx.foe : unit;
  const drainSide = fx.drainTo === "foe" ? OTHER[side] : side;
  for (const dr of drains) {
    if (dr === undefined || dmg <= 0 || drainUnit.currentHp <= 0) continue;
    const amount = Math.floor((dmg * dr.numerator) / dr.denominator);
    if (amount > 0) {
      const before = drainUnit.currentHp;
      drainUnit.currentHp = Math.min(hpCapOf(drainUnit), drainUnit.currentHp + amount);
      drained += drainUnit.currentHp - before;
      events.push({ type: "heal", detail: { side: drainSide, amount: drainUnit.currentHp - before, hpAfter: { current: drainUnit.currentHp, max: drainUnit.base.hp }, source: "drain" } });
    }
  }
  // drainFlat：定额吸血（"吸取效果提升至400点"——每击固定回血，需实际造成伤害）
  if (fx.drainFlat !== undefined && dmg > 0 && !selfHit) {
    const before = unit.currentHp;
    unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + fx.drainFlat);
    if (unit.currentHp > before) {
      const healed = unit.currentHp - before;
      unit.lastHeal = healed;
      unit.prevHeal = healed;
      events.push({ type: "heal", detail: { side, amount: healed, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "drain" } });
    }
  }
  // drain_atk 窗口：每次攻击伤害按分数回血（"每回合造成伤害的1/3恢复自身体力"——自残/无效伤害不吸）
  if (!selfHit && dmg > 0) {
    for (const [dn, dd, e] of drainAtkFracs(unit, hit, kindEff)) {
      const amount = Math.min(Math.floor((dmg * dn) / dd), e.params?.cap ?? Number.MAX_SAFE_INTEGER); // params.cap：吸取量上限（"最多吸取300点HP"）
      if (amount <= 0) continue;
      const before = unit.currentHp;
      unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + amount);
      if (unit.currentHp > before) {
        const healed = unit.currentHp - before;
        unit.lastHeal = healed;
        unit.prevHeal = healed;
        events.push({ type: "heal", detail: { side, amount: healed, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "drain_atk" } });
      }
      // drain_atk echo：按吸血量对受击方追加固伤（"若对手处于异常状态则附加等量固定伤害"挂 drain_atk 的等价语义；params{echoN,echoD}+echo 前缀门控）
      if (e.params?.echoN !== undefined && hit.currentHp > 0
        && (e.params.echoFoeStatused !== 1 || hit.effects.some((x) => effectDefOf(x.kind)?.ailment === true))
        && (e.params.echoSelfHpFull !== 1 || unit.currentHp >= hpCapOf(unit))
        && (e.params.echoLN === undefined || unit.currentHp * (e.params.echoLD ?? 1) < e.params.echoLN * unit.base.hp)
        && (e.params.echoHN === undefined || unit.currentHp * (e.params.echoHD ?? 1) > e.params.echoHN * unit.base.hp)
        && (e.params.echoPrevCrit !== 1 || ctx.lastCrit === true)) {
        const echoDmg = Math.max(1, Math.floor((amount * e.params.echoN) / (e.params.echoD ?? 1)));
        hit.currentHp = Math.max(0, hit.currentHp - echoDmg);
        events.push({ type: "damage", detail: { side: hitSide, amount: echoDmg, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "fixed", cause: "echo" } });
      }
      // params.count 次数消耗（"下N次攻击造成伤害的P%恢复自身体力"——次数窗逐击递减）
      if (e.params?.count !== undefined) {
        e.params.count -= 1;
        if (e.params.count <= 0) { unit.effects = unit.effects.filter((x) => x !== e); events.push({ type: "effect-faded", detail: { side, name: e.label ?? e.kind } }); }
      }
    }
  }
  // drainEcho：按吸血量对受击方追加固伤（"恢复体力值等量的固定伤害"挂 drain 时的等价语义）；drainEchoIf 门控
  if (fx.drainEcho !== undefined && drained > 0 && !selfHit && hit.currentHp > 0
    && (fx.drainEchoIf === undefined || condEval(ctx, fx.drainEchoIf.when))) {
    const ef = fx.drainEcho === true ? 1 : fx.drainEcho.numerator / fx.drainEcho.denominator;
    const echoDmg = Math.max(1, Math.floor(drained * ef));
    hit.currentHp = Math.max(0, hit.currentHp - echoDmg);
    events.push({ type: "damage", detail: { side: hitSide, amount: echoDmg, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "fixed", cause: "echo" } });
  }
}

/** 反击倍率、伤害反弹、致命反弹、定额反击。自残不进这里。 */
export function applyReflectRider(
  ctx: OpCtx,
  hit: UnitState,
  hitSide: SideId,
  selfHit: boolean,
  dmg: number,
  crit: boolean,
  kindEff?: string,
  catCode?: number,
): void {
  const { events, side, unit } = ctx;
  // 反击/反伤窗口：受击方存活且带 counter/dmgReflect flag → 回击攻击方（自残不触发）
  if (!selfHit && hit.currentHp > 0 && dmg > 0 && unit.currentHp > 0) {
    const cMul = counterMulOf(hit, catCode);
    if (cMul > 0) {
      const back = Math.floor(dmg * cMul);
      if (back > 0) {
        unit.currentHp = Math.max(0, unit.currentHp - back);
        events.push({
          type: "damage",
          detail: { side, amount: back, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "counter" },
        });
      }
    }
    const rfl = dmgReflectOf(hit, kindEff);
    if (rfl !== undefined) {
      const back = Math.floor((dmg * rfl[0]) / rfl[1]);
      if (back > 0) {
        unit.currentHp = Math.max(0, unit.currentHp - back);
        events.push({
          type: "damage",
          detail: { side, amount: back, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "reflect" },
        });
      }
      // params.count 次数消耗（"将下次受到的伤害N%反馈给对手"）
      for (const e of hit.effects) {
        if (e.kind !== "reflect" || (((e.params?.of as number | undefined) ?? 0) & RF.dmg) === 0 || e.params?.count === undefined) continue;
        e.params.count -= 1;
        if (e.params.count <= 0) { hit.effects = hit.effects.filter((x) => x !== e); events.push({ type: "effect-faded", detail: { side: hitSide, name: e.label ?? e.kind } }); }
      }
    }
    // critReflect flag（"反弹对手的致命一击"）：本次为致命一击 → 全额反伤给攻击方
    if (crit && critReflectOn(hit)) {
      unit.currentHp = Math.max(0, unit.currentHp - dmg);
      events.push({
        type: "damage",
        detail: { side, amount: dmg, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "crit_reflect" },
      });
    }
    const cFlat = counterFlatOf(hit, unit);
    if (cFlat > 0) {
      unit.currentHp = Math.max(0, unit.currentHp - cFlat);
      events.push({
        type: "damage",
        detail: { side, amount: cFlat, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "fixed", cause: "counter" },
      });
    }
  }
}

/** 命中后累加对手下只出战精灵最大体力削减（"每次命中对手会降低对手下只出战精灵最大体力的10%，最多降低40%"——pct 累积挂入 nextInFx，登场时以 max_hp_down 结算）。 */
export function applyFoeNextMaxHpAcc(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId, dmg: number): void {
  if (fx.foeNextMaxHpAcc === undefined || hitSide === ctx.side || dmg <= 0 || hit.currentHp <= 0) return;
  const { next, move } = ctx;
  const pend = (next.sides[hitSide].nextInFx ??= []);
  type PendFx = { op?: string; name?: string; target?: string; params?: { pct?: number } };
  const cur = pend.find((p) => { const f = p.fx as PendFx; return f.op === "apply_status" && f.name === "max_hp_down" && f.params?.pct !== undefined; });
  if (cur !== undefined) { const f = cur.fx as PendFx; f.params!.pct = Math.min(fx.foeNextMaxHpAcc.cap ?? 100, (f.params!.pct ?? 0) + fx.foeNextMaxHpAcc.pct); }
  else pend.push({ moveId: move.id, fx: { op: "apply_status", name: "max_hp_down", target: "self", params: { pct: fx.foeNextMaxHpAcc.pct } } });
}

/** 等量固伤：按本击实际伤害再追加一笔 fixed。不含护盾回响。 */
export function applyFlatEcho(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId, dmg: number): void {
  const { events } = ctx;
  // 等量固伤（"造成等量固定伤害"/"附加所造成伤害值N%的固定伤害"）：按本击实际伤害（×pct）追加一笔 fixed
  if (fx.flatEcho !== undefined && dmg > 0 && (fx.flatEcho.when === undefined || condEval(ctx, fx.flatEcho.when)) && hit.currentHp > 0) {
    const echoDmg = fx.flatEcho.pct !== undefined ? Math.floor((dmg * fx.flatEcho.pct) / 100) : dmg;
    hit.currentHp = Math.max(0, hit.currentHp - echoDmg);
    events.push({
      type: "damage",
      detail: { side: hitSide, amount: echoDmg, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "fixed", cause: "echo" },
    });
  }
}

/** 命中后按自身最大体力分数回血。 */
export function applyHealOnHit(ctx: OpCtx, fx: OnHitSlice, selfHit: boolean, dmg: number): void {
  const { events, side, unit } = ctx;
  // healOnHit：命中后按自身最大体力分数回血（"每次攻击恢复自身体力的1/3"）
  if (fx.healOnHit !== undefined && !selfHit && dmg > 0 && unit.currentHp > 0) {
    const amount = Math.floor((unit.base.hp * fx.healOnHit.numerator) / fx.healOnHit.denominator);
    const before = unit.currentHp;
    unit.currentHp = Math.min(hpCapOf(unit), unit.currentHp + amount);
    if (unit.currentHp > before) {
      events.push({ type: "heal", detail: { side, amount: unit.currentHp - before, hpAfter: { current: unit.currentHp, max: unit.base.hp }, source: "heal_on_hit" } });
    }
  }
}

/** 命中后降级。仍走 statStageOp，不把能力下降当成终局。 */
export function applyStageOnHit(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, selfHit: boolean): void {
  // stageOnHit：命中后降级（"每次直接攻击都会使对手防御和特防-1"）——走 stat-stage 免疫/下界通路
  if (fx.stageOnHit !== undefined && !selfHit && hit.currentHp > 0) {
    for (const soh of fx.stageOnHit) {
      statStageOp(ctx, { op: "apply_stat_stage", stat: soh.stat, delta: soh.delta, target: "opponent" });
    }
  }
}

/** 免疫挡下固伤/百分比时仍追加的真实伤害。只在免疫分支里调用。 */
export function applyFlatIfFoeImmune(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId): void {
  // flatIfFoeImmune：免疫挡下固伤/百分比时仍追加 N 点真实伤害（"对手免疫百分比伤害时额外附加250点真实伤害"）
  if (fx.flatIfFoeImmune !== undefined && hit.currentHp > 0) {
    const amt = Math.min(hit.currentHp, fx.flatIfFoeImmune);
    hit.currentHp -= amt;
    ctx.events.push({ type: "damage", detail: { side: hitSide, amount: amt, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "true", cause: "immune_extra" } });
  }
}

/** 自伤额按 n/d 反打对手。百分比伤害，受 flat/pct 免疫拦截。 */
export function applySelfCostEcho(ctx: OpCtx, fx: OnHitSlice, hitSide: SideId, selfHit: boolean, dmg: number): void {
  const { events, side, unit, target } = ctx;
  // selfCostEcho（"消耗自身当前最大体力的1/2并使对手受到等量百分比伤害"）：自伤额按 n/d 反打对手（百分比伤害，受 flat/pct 免疫拦截）
  if (selfHit && dmg > 0 && fx.selfCostEcho !== undefined) {
    const foeU = target;
    const fN = fx.selfCostEcho === true ? 1 : fx.selfCostEcho.numerator;
    const fD = fx.selfCostEcho === true ? 1 : fx.selfCostEcho.denominator;
    const amt = Math.floor((dmg * fN) / fD);
    if (amt > 0 && foeU !== unit && foeU.currentHp > 0 && !flatImmuneOn(foeU)) {
      foeU.currentHp = Math.max(0, foeU.currentHp - amt);
      events.push({ type: "damage", detail: { side: hitSide === side ? OTHER[side] : side, amount: amt, hpAfter: { current: foeU.currentHp, max: foeU.base.hp }, damageKind: "percent", cause: "self_cost_echo" } });
    }
  }
}

/** 打出伤害反噬：攻击方承受 dmg×n/d。 */
export function applyRecoilFrac(ctx: OpCtx, fx: OnHitSlice, selfHit: boolean, dmg: number): void {
  const { events, side, unit } = ctx;
  // 打出伤害反噬（"对方所受伤害的1/4会反弹给自己"）——攻击方承受 dmg×n/d
  if (!selfHit && fx.recoilFrac !== undefined && dmg > 0 && unit.currentHp > 0) {
    const rc = Math.floor((dmg * fx.recoilFrac.n) / fx.recoilFrac.d);
    if (rc > 0) {
      unit.currentHp = Math.max(0, unit.currentHp - rc);
      events.push({ type: "damage", detail: { side, amount: rc, hpAfter: { current: unit.currentHp, max: unit.base.hp }, damageKind: "percent", cause: "recoil" } });
    }
  }
}

/** 按本击实际伤害给自身挂伤害护盾。 */
export function applyShieldEcho(ctx: OpCtx, fx: OnHitSlice, dmg: number): void {
  const { events, side, unit, next } = ctx;
  // 等量护盾（"为自身附加等量的护盾值"）：按本击实际伤害给自身挂伤害护盾条目
  if (fx.shieldEcho && dmg > 0 && unit.currentHp > 0) {
    const existing = unit.effects.find((e) => e.kind === "shield");
    if (existing !== undefined) existing.params = { ...(existing.params ?? {}), flat: (existing.params?.flat ?? 0) + dmg };
    else unit.effects.push({ kind: "shield", effectInstanceId: `efx_${side}_shield`, params: { flat: dmg }, appliedTurn: next.turn });
    events.push({ type: "effect-applied", detail: { side, name: "shield", turns: 0 } });
  }
}

/** 按本击实际伤害给受击方挂伤害护盾。 */
export function applyFoeShieldEcho(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId, selfHit: boolean, dmg: number): void {
  const { events, next } = ctx;
  // 对侧等量护盾（"吸取对手250点体力且为对手附加等量护盾"）：按本击实际伤害给受击方挂伤害护盾
  if (fx.foeShieldEcho === true && dmg > 0 && !selfHit && hit.currentHp > 0) {
    const existing = hit.effects.find((e) => e.kind === "shield");
    if (existing !== undefined) existing.params = { ...(existing.params ?? {}), flat: (existing.params?.flat ?? 0) + dmg };
    else hit.effects.push({ kind: "shield", effectInstanceId: `efx_${hitSide}_shield`, params: { flat: dmg }, appliedTurn: next.turn });
    events.push({ type: "effect-applied", detail: { side: hitSide, name: "shield", turns: 0 } });
  }
}

/** 本击实伤等额 true 追加。不走克制/免疫。 */
export function applyTrueEcho(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId, selfHit: boolean, dmg: number): void {
  const { events } = ctx;
  // 等量真实伤害回响（"若对手未受到固定伤害则额外附加等量真实伤害"）：本击实伤等额 true 追加（不走克制/免疫）
  if (!selfHit && dmg > 0 && hit.currentHp > 0 && (fx.trueEcho === true || (fx.trueEchoIf !== undefined && condEval(ctx, fx.trueEchoIf.when)))) {
    hit.currentHp = Math.max(0, hit.currentHp - dmg);
    events.push({ type: "damage", detail: { side: hitSide, amount: dmg, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "true", cause: "true_echo" } });
  }
}

/** 命中后概率固伤。 */
export function applyFlatOnHit(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, hitSide: SideId, selfHit: boolean): void {
  const { events, rng } = ctx;
  // flatOnHit：命中后概率固伤（"每次攻击有35%概率附加35点固定伤害"）
  if (fx.flatOnHit !== undefined && !selfHit && hit.currentHp > 0 && rng.drawBelow(100, "flat_on_hit") < fx.flatOnHit.chance) {
    hit.currentHp = Math.max(0, hit.currentHp - fx.flatOnHit.flat);
    events.push({ type: "damage", detail: { side: hitSide, amount: fx.flatOnHit.flat, hpAfter: { current: hit.currentHp, max: hit.base.hp }, damageKind: "fixed", cause: "flat_on_hit" } });
  }
}

/** 命中后概率施加异常。仍走 apply_status。 */
export function applyAilmentOnHit(ctx: OpCtx, fx: OnHitSlice, hit: UnitState, selfHit: boolean): void {
  const { rng } = ctx;
  // ailmentOnHit：命中后概率施加异常（"每次攻击都有30%几率令对手害怕"）——走 apply_status 免疫/反弹通路
  if (fx.ailmentOnHit !== undefined && !selfHit && hit.currentHp > 0 && rng.drawBelow(100, "ailment_on_hit") < fx.ailmentOnHit.pct) {
    applyStatusOp(ctx, { op: "apply_status", name: fx.ailmentOnHit.name, target: "opponent" });
  }
}
