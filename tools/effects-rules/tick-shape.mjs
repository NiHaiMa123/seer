/**
 * 十二个 *_tick 收成已经在结算的 periodic。
 * 家族规则在 go() 里调用 liftTick，发出的就是脱糖形状。
 * 出口仍再收一次：带回合窗的 random 施加会先写成 ailment_tick。
 * 免疫门和弱化反推同时认旧名和已经脱糖的 periodic。
 * 形状与删掉前的 periodicFormOf 分支一致。transfer_stages 不带 target：类型和 schema 都没有这个字段，处理函数也不读它。
 * cleanse_foe 的 params 会被整表换成 { win }，原来的 count 不留——留着会开始按次消耗。
 */

const TICK_CODES = ["atk", "def", "spa", "sdf", "spd", "acc"];

export const TICK_NAMES = new Set([
  "stage_tick",
  "pp_tick",
  "prio_push_tick",
  "steal_stages_tick",
  "steal_rand_tick",
  "cleanse_down_tick",
  "down_push_tick",
  "cleanse_foe_tick",
  "ailment_tick",
  "pp_zero_tick",
  "dealt_tick",
  "maxhp_tick",
]);

const stagePayload = (p) => {
  const mk = (stat) => ({ op: "apply_stat_stage", stat, delta: p.delta ?? 1, target: "self", plain: true });
  if (p.stat === 7) return [{ op: "apply_stat_stage", stat: "random", randomCount: p.count ?? 1, delta: p.delta ?? 1, target: "self", plain: true }];
  if (p.stat === 8) return [mk("def"), mk("sdf")];
  if (p.stat === 9) return TICK_CODES.map(mk);
  if (p.stat === 10) return TICK_CODES.filter((_, i) => ((p.statMask ?? 0) & (1 << i)) !== 0).map(mk);
  const code = TICK_CODES[(p.stat ?? 1) - 1];
  return code !== undefined ? [mk(code)] : [];
};

/** 返回 { params, payload }；无法脱糖时返回 undefined（名字留着，让未知状态门挡住）。 */
export function tickForm(fx) {
  const p = fx.params ?? {};
  switch (fx.name) {
    case "stage_tick":
      return { params: { win: 6 }, payload: stagePayload(p) };
    case "pp_tick":
      return { params: { win: 7 }, payload: [{ op: "pp_delta", target: "self", scope: "all", amount: p.flat ?? 0, plain: true }] };
    case "prio_push_tick":
      return { params: { win: 8 }, payload: [{ op: "apply_status", name: "prio_up", target: "opponent", stack: true, params: { add: p.add ?? 0 } }] };
    case "steal_stages_tick":
      return { params: { win: 10 }, payload: [{ op: "transfer_stages", sign: "up", plain: true, noHooks: true }] };
    case "steal_rand_tick":
      return { params: { win: 11 }, payload: [{ op: "transfer_stages", randomCount: p.count ?? 1, randomDelta: p.delta ?? 1, plain: true, noHooks: true }] };
    case "cleanse_down_tick":
      return { params: { win: 12 }, payload: [{ op: "clear_stages", target: "self", sign: "down", plain: true, noHooks: true }] };
    case "down_push_tick":
      return { params: { win: 12 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }] };
    case "cleanse_foe_tick":
      return { params: { win: 13 }, payload: [{ op: "cleanse", target: "opponent", scope: "timed", plain: true, noHooks: true }] };
    case "ailment_tick":
    case "pp_zero_tick":
      return { params: { win: 16, foeAlive: 1 }, payload: fx.payload ?? [] };
    case "dealt_tick": {
      const dmg = { op: "hp_delta", target: fx.target === "opponent" ? "self" : "opponent", kind: p.trueDmg === 1 ? "true" : "fixed" };
      if (p.pct !== undefined) {
        dmg.ofSelfDealt = { numerator: p.pct, denominator: 100 };
        dmg.if = { selfDealtAboveAbs: Math.ceil(100 / p.pct) };
      }
      if (p.flat !== undefined) {
        if (p.perImmune !== undefined) {
          dmg.perImmuneFlat = p.flat;
          dmg.if = { immunedThisTurn: true };
        } else dmg.flat = p.flat;
      }
      return { params: { win: 17, ...(fx.target === "opponent" ? {} : { foeAlive: 1 }) }, payload: [dmg] };
    }
    case "maxhp_tick": {
      const acc = { op: "apply_status", name: "max_hp_down", target: "opponent", accFlat: true, params: { fracFoeMaxHpN: p.n ?? 0, fracFoeMaxHpD: p.d ?? 1 } };
      const params = { win: 20 };
      if (p.chance !== undefined) params.chance = p.chance;
      if (p.perStageStat !== undefined) {
        const stat = TICK_CODES[p.perStageStat - 1];
        if (stat === undefined) return undefined;
        acc.mulSelfStageLvl = { stat, per: p.perStagePer ?? 1 };
        acc.if = { selfStatAtLeast: { stat, stage: p.perStagePer ?? 1 } };
      }
      return { params, payload: [acc] };
    }
    default:
      return undefined;
  }
}

/** 这十二个窗口。主语翻转和回合戳发生在脱糖之后，出口把 params/payload 挪回最后，键序与先戳后脱糖一致。 */
const TICK_WINS = new Set([6, 7, 8, 10, 11, 12, 13, 16, 17, 20]);

const orderTick = (e) => {
  if (!TICK_WINS.has(e.params?.win)) return e;
  const { params, payload, ...rest } = e;
  return { ...rest, params, payload };
};

/** 把一条 op 收成 periodic。不是这十二个名字就原样返回（payload 里的继续收）。 */
export function liftTick(e) {
  if (e === null || typeof e !== "object") return e;
  if (Array.isArray(e)) return e.map(liftTick);
  if (e.op !== "apply_status" || !TICK_NAMES.has(e.name)) {
    if (Array.isArray(e.payload)) e.payload = e.payload.map(liftTick);
    return e;
  }
  const built = tickForm(e);
  if (built === undefined) return e;
  const { params: _p, payload: _l, ...rest } = e;
  return { ...rest, name: "periodic", params: built.params, payload: built.payload.map(liftTick) };
}

/** 顶层，以及被 react 包进去的那一层。不进别的 payload：那里的 chance 是包进来之后补的。 */
const settleTick = (e) => {
  if (e === null || typeof e !== "object") return e;
  if (e.op === "apply_status" && e.name === "react" && Array.isArray(e.payload)) e.payload = e.payload.map(settleTick);
  return e.op === "apply_status" && e.name === "periodic" ? orderTick(e) : e;
};

export function liftTickEffects(effects) {
  if (!Array.isArray(effects)) return;
  for (let i = 0; i < effects.length; i++) effects[i] = settleTick(liftTick(effects[i]));
}

/**
 * dealt 的承伤端和 foeAlive 按宿主 target 算。规则先脱糖时用的是翻转前的 target，
 * 主语翻转之后按最终 target 再对齐一次（对手宿主：承伤端改自身，且不带 foeAlive）。
 */
export function syncDealtHost(e) {
  if (e === null || typeof e !== "object" || e.op !== "apply_status" || e.name !== "periodic" || e.params?.win !== 17) return;
  const foe = e.target === "opponent";
  if (foe) delete e.params.foeAlive;
  else e.params.foeAlive = 1;
  if (!Array.isArray(e.payload)) return;
  const dmgT = foe ? "self" : "opponent";
  for (const d of e.payload) if (d !== null && typeof d === "object" && d.op === "hp_delta") d.target = dmgT;
}
