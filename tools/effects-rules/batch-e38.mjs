// batch-e38：技能无效化、承伤/致命门控、PP 操纵、先制穿透、双攻取高、简易时窗、裸句式长尾。
import { NUM, num, STAT_RE, STATS, AIL_RE, AILMENTS } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

const TICK_IDX = { atk: 0, def: 1, spa: 2, sdf: 3, spd: 4, acc: 5 };
const tickFx = (statNames, delta, target, extra = {}) => liftTick({
  op: "apply_status", name: "stage_tick", target,
  params: { stat: 10, statMask: statNames.reduce((mm, s) => mm | (1 << TICK_IDX[s]), 0), delta },
  ...extra });
const stageFx = (stat, delta, target, extra = {}) => ({ op: "apply_stat_stage", stat, delta, target, ...extra });
const PAIR = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"] };
const STOK = `${STAT_RE}|双攻|双防`;
const expandStat = (zh) => PAIR[zh] ?? (STATS[zh] !== undefined ? [STATS[zh]] : []);
const TGT = (s) => (/对手|对方|敌方/.test(s ?? "") ? "opponent" : "self");
const CAT = { 属性: 1, 物理: 2, 特殊: 3, 攻击: 4 };

export const rules = [
  // ── 技能无效化 ─────────────────────────────────────────────────────────
  // "令对手下1次使用的属性技能无效" / "令对手下次攻击技能无效"
  { id: "e38-01",
    re: new RegExp(`^(?:使|令)(?:得)?(?:对手|对方|敌方)下?${NUM}次(?:使用|施放)?的?(属性|物理|特殊|攻击)?(?:技能|招式)(?:无效|失效)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1]), ...(CAT[m[2]] !== undefined ? { cat: CAT[m[2]] } : {}) } }] }) },
  // "使得对方的技能失败" / "100%令对手使用的技能无效" / "使得对手的技能失效"
  { id: "e38-02",
    re: new RegExp(`^(?:使|令)(?:得)?(?:对方|对手|敌方)(?:的)?(?:使用的?)?(?:技能|招式)(?:失效|失败|无效)$`),
    go: (m) => {
      const pctM = m[0].match(/(\d+)%/);
      return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 }, ...(pctM !== null ? { chance: num(pctM[1]) } : {}) }] };
    } },
  // "使得对方的先制技能失效" / "对手先制技能无效"
  { id: "e38-03",
    re: /^(?:使|令)(?:得)?(?:对手|对方|敌方)(?:的)?(?:使用)?的?(?:先制|先手)(?:技能|招式)(?:无效|失效)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1, prioMin: 1 } }] }) },
  // ── 简易 stage ─────────────────────────────────────────────────────────
  // "100%攻击加1" / "攻击加2"（无主体默认自身）
  { id: "e38-04",
    re: new RegExp(`^(?:(${NUM})%)?(?:使|令)?(${STAT_RE})(?:的)?(?:能力)?(?:等级)?加([+-]?)(${NUM})(?:个)?(?:等级|级)?$`),
    go: (m) => {
      const st = STATS[m[3]]; if (st === undefined) return null;
      const d = (m[4] === "-" ? -1 : 1) * num(m[5]);
      return { effects: [stageFx(st, d, "self", m[1] !== undefined ? { chance: num(m[1]) } : {})] };
    } },
  // "每回合提升自身速度1" / "每回合使自身攻击和特攻+1"
  { id: "e38-05",
    re: new RegExp(`^每回合(?:使|令)?(?:提升|提高|增加|增强)(?:(${STAT_RE}|双攻|双防))?(?:自身|自己|对方|对手|敌方)?的?((?:${STOK})(?:(?:和|与|及|、|，|,)(?:${STOK}))*)(?:的)?(?:能力)?(?:等级)?([+-]?)(${NUM})(?:个)?(?:等级|级)?$`),
    go: (m) => {
      const names = [...m[2].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
      if (names.length === 0) return null;
      const d = (m[3] === "-" ? -1 : 1) * num(m[4]);
      const t = /对手|对方|敌方/.test(m[0]) ? "opponent" : "self";
      return { effects: [tickFx(names, d, t)] };
    } },
  // "对手每回合攻击、防御、特防、特攻、速度、命中-1" / "自身每回合速度+1"
  { id: "e38-06",
    re: new RegExp(`^(自身|自己|对手|对方|敌方)每回合(?:使|令)?((?:${STOK})(?:(?:和|与|及|、|，|,|、?)(?:${STOK}))*?)(?:的)?(?:能力)?(?:等级)?([+-])(${NUM})(?:个)?(?:等级|级)?$`),
    go: (m) => {
      const names = [...m[2].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
      if (names.length === 0) return null;
      const d = (m[3] === "-" ? -1 : 1) * num(m[4]);
      return { effects: [tickFx(names, d, TGT(m[1]))] };
    } },
  // "每次直接攻击使对手防御特防-1"（拼接双维；timed-138 已收"和/、"分隔形）
  { id: "e38-07",
    re: new RegExp(`^每次(?:直接)?攻击(?:都|就)?(?:会)?使?(?:对手|对方|敌方)((?:${STOK}){2,})(?:等级)?(-)${NUM}$`),
    go: (m) => {
      const names = [...m[1].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
      if (names.length < 2) return null;
      return { attachDamage: { stageOnHit: names.map((stat) => ({ stat, delta: -num(m[3]) })) } };
    } },
  // ── 承伤门控 ───────────────────────────────────────────────────────────
  // "使对方攻击伤害是正常状态的1/2" / "对手攻击伤害减半"
  { id: "e38-08",
    re: new RegExp(`^(?:使|令)(?:对方|对手|敌方)(?:的)?(?:攻击)?(?:造成的?)?伤害(?:是|为)(?:正常(?:状态)?的?)?${NUM}\\s*/\\s*${NUM}(?:倍)?$|^(?:使|令)(?:对方|对手|敌方)(?:的)?(?:攻击)?伤害减半$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: m[1] !== undefined ? { n: num(m[1]), d: num(m[2]) } : { n: 1, d: 2 } }] }) },
  // "对手受到的致命一击伤害提高100%" → crit_taken_up{n,d}（引擎新增 flag）
  { id: "e38-09",
    re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)(?:受到的)?致命[一1]?击(?:的)?伤害(?:提高|增加|提升|为)(?:了)?${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_taken_up", target: "opponent", params: { n: 100 + num(m[1]), d: 100 } }] }) },
  // "免疫此次攻击" / "免疫下1次攻击" / "免疫本回合攻击伤害"
  { id: "e38-10",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?免疫(?:(?:此|该|本回合)次?|下${NUM}次|下${NUM}回合)?的?(?:攻击|攻击伤害|伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: m[1] !== undefined ? num(m[1]) : 1 } }] }) },
  // "无视对手正先制等级" → move flag（引擎新增：对手侧先制加成压非正）
  { id: "e38-11", re: /^无视(?:对手|对方|敌方)(?:的)?正?先制(?:等级|效果)?$/, go: () => ({ flags: { ignoreFoePrioPos: true } }) },
  // ── 简易治疗/自损 ──────────────────────────────────────────────────────
  // "每回合恢复自身已损失HP的50%" / "每回合恢复已损失体力1/3"
  { id: "e38-12",
    re: new RegExp(`^每回合(?:使|令)?恢复(?:自身|自己)?的?已损失(?:HP|hp|体力|生命)(?:的)?${NUM}%$|^每回合(?:使|令)?恢复(?:自身|自己)?的?已损失(?:HP|hp|体力|生命)(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => {
      const fx = m[1] !== undefined ? { n: num(m[1]), d: 100 } : { n: num(m[2]), d: num(m[3]) };
      return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: fx.n, d: fx.d, missing: 1 } }] };
    } },
  // "解除异常" / "解除自身所有异常状态"
  { id: "e38-13", re: /^解除(?:自身|自己|对手|对方|敌方)?的?(?:所有|全部)?异常(?:状态)?$/, go: (m) => ({ effects: [{ op: "cleanse", target: /对手|对方|敌方/.test(m[0]) ? "opponent" : "self", scope: "ailment" }] }) },
  // "消耗全部体力" / "损失全部体力" → 自损 100%
  { id: "e38-14", re: /^(?:消耗|损失|失去)(?:自身|自己)?(?:的)?全部(?:HP|hp|体力|生命|血量)$/, go: () => ({ effects: [{ op: "damage", kind: "percent", power: 100, target: "self" }] }) },
  // "恢复自身最大体力" / "恢复自身HP100%" / "恢复自身体力值上限"
  { id: "e38-15",
    re: new RegExp(`^恢复(?:自身|自己)?(?:的)?最大(?:HP|hp|体力|生命|血量)(?:值|上限)?$|^恢复(?:自身|自己)?(?:的)?(?:HP|hp|体力|生命|血量)?${NUM}%$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", ...(m[1] !== undefined ? { numerator: num(m[1]), denominator: 100 } : {}) }] }) },
  // "回合结束时恢复等量体力值" → drain_atk 100%
  { id: "e38-16", re: /^(?:当|本|每)?回合结束时恢复(?:自身|自己)?等量(?:的)?体力(?:值)?$|^回合结束时恢复(?:自身|自己)?等量体力值$|^每回合恢复(?:自身|自己)?等量(?:的)?体力(?:值)?$/, go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // "自身所有攻击造成的伤害都将恢复体力" / "攻击造成的伤害恢复自身体力"
  { id: "e38-17", re: /^(?:自身|自己)?(?:的)?(?:所有|全部)?攻击(?:技能)?造成的?(?:所有|全部)?伤害都?(?:将|会)?恢复(?:自身|自己)?的?体力$/, go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // ── 先制/命中 ──────────────────────────────────────────────────────────
  // "先手+1" / "先手-1"（无主体=自身招式先制）
  { id: "e38-18", re: new RegExp(`^先手([+-])${NUM}$`), go: (m) => ({ flags: { priority: (m[1] === "-" ? -1 : 1) * num(m[2]) } }) },
  // "攻击击中对方要害几率增加1/16" / "致命几率增加1/16" / "增加1/16的致命几率"
  { id: "e38-19",
    re: new RegExp(`^(?:(?:攻击)?击中(?:对方|对手)?要害|致命[一1]?击)(?:的)?(?:几率|概率|机率|率)(?:增加|提升|提高|增加)(?:了)?${NUM}\\s*/\\s*${NUM}$|^(?:攻击)?(?:击中|打出)(?:对方|对手)?要害(?:的)?(?:几率|概率|机率)(?:增加|提升|提高|增加)(?:了)?${NUM}\\s*/\\s*${NUM}$|^增加${NUM}\\s*/\\s*${NUM}(?:的)?致命(?:一击)?(?:几率|概率)?$`),
    go: (m) => {
      const ns = m.slice(1).filter((x) => x !== undefined).map(num);
      return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] };
    } },
  // "致命3/16" 裸分数 → crit_up{n,d}
  { id: "e38-20", re: new RegExp(`^致命[一1]?击?${NUM}\\s*/\\s*${NUM}$|^要害(?:几率|概率)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // ── PP ──────────────────────────────────────────────────────────────────
  // "恢复自身所有pp1点" / "恢复自身所有技能1点pp值"
  { id: "e38-21",
    re: new RegExp(`^恢复(?:自身|自己)?(?:所有|全部)(?:技能|招式)?的?(?:PP|pp)(?:值)?${NUM}点$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), scope: "all", target: "self" }] }) },
  // "100%降低对方所有技能1点pp值" / "降低对方所有技能N点pp"
  { id: "e38-22",
    re: new RegExp(`^(?:(${NUM})%)?(?:使|令|降低|减少)(?:对手|对方|敌方)(?:所有|全部)技能(?:的)?${NUM}点?(?:PP|pp)(?:值)?$|^(?:(${NUM})%)?(?:使|令|降低|减少)(?:对手|对方|敌方)(?:所有|全部)技能(?:的)?(?:PP|pp)(?:值)?${NUM}点$`),
    go: (m) => { const v = m[3] ?? m[6]; const pc = m[1] ?? m[4]; return { effects: [{ op: "pp_delta", amount: -num(v), scope: "all", target: "opponent", ...(pc !== undefined ? { chance: num(pc) } : {}) }] }; } },
  // "对手PP消耗翻倍" / "使对手技能消耗PP翻倍"
  { id: "e38-23", re: /^(?:使|令)?(?:对手|对方|敌方)(?:的|技能)?(?:PP|pp)消耗翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "pp_double", target: "opponent" }] }) },
  // ── 反射/转移 ─────────────────────────────────────────────────────────
  // "反弹所受到的异常状态" / "反弹对手给予的异常状态"
  { id: "e38-24", re: /^反弹(?:自身|自己)?(?:所)?受到?的?异常(?:状态)?$|^反弹(?:对手|对方|敌方)(?:给予|施加)的?异常(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  // "反弹给对手造成伤害值50%的固定伤害" / "每回合反弹给对手1/3的伤害" / "双倍奉还"
  { id: "e38-25",
    re: new RegExp(`^每回合反弹给(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:的)?伤害$|^反弹给(?:对手|对方|敌方)(?:造成)?的?(?:伤害值|伤害)(?:${NUM}\\s*/\\s*${NUM}|${NUM}%)(?:的)?固定伤害$|^反弹(?:自身|自己)?(?:所)?受到?的?(?:全部|所有)?伤害$|^双倍奉还$`),
    go: (m) => {
      if (/双倍奉还/.test(m[0])) return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 2, d: 1 } }] };
      const ns = m.slice(1).filter((x) => x !== undefined).map(num);
      if (ns.length >= 2) return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: /%/.test(m[0]) ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] } }] };
      return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] };
    } },
  // "对方受到伤害的1/4会反弹到自己" → recoilFrac（造成伤害的 n/d 反弹自身）
  { id: "e38-26",
    re: new RegExp(`^(?:对方|对手|敌方)受到?的?伤害(?:的)?${NUM}\\s*/\\s*${NUM}会?反弹(?:给|到)?自己$`),
    go: (m) => ({ attachDamage: { recoilFrac: { n: num(m[1]), d: num(m[2]) } } }) },
  // "将对手的能力强化转移到自己身上" / "吸取对手的能力提升状态"
  { id: "e38-27", re: /^将(?:对手|对方|敌方)(?:的)?能力(?:强化|提升|上升)(?:状态)?转移到(?:自身|自己)(?:身上)?$|^吸取(?:对手|对方|敌方)(?:的)?能力(?:强化|提升|上升)(?:状态)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  // ── 双攻取高 ───────────────────────────────────────────────────────────
  // "将自身攻击和特攻中最高的能力值作为自己的能力值进行攻击" → useBestOffense
  { id: "e38-28", re: /^将(?:自身|自己)(?:的)?(?:攻击和特攻|双攻)(?:中)?最高(?:的)?能力值作为(?:自己|自身)?的?能力值进行攻击$/, go: () => ({ attachDamage: { useBestOffense: true } }) },
  // "将对手攻击和特攻中最高的能力值作为自己的能力值进行攻击" → useFoeBestOffense（引擎新增）
  { id: "e38-29", re: /^将(?:对手|对方|敌方)(?:的)?(?:攻击和特攻|双攻)(?:中)?最高(?:的)?能力值作为(?:自己|自身)?的?能力值进行攻击$/, go: () => ({ attachDamage: { useFoeBestOffense: true } }) },
  // ── 连击/存活/门控 ─────────────────────────────────────────────────────
  // "做4~8次进攻" / "进行3-6次攻击"
  { id: "p2-hits-01",
    re: /^(?:做|进行|连续攻击)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)s*[-~～—至到]s*([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:次)?(?:个)?攻击$/,
    go: (m) => ({ attachDamage: { hits: { min: num(m[1]), max: num(m[2]) } } }),
  },
  { id: "e38-30", re: new RegExp(`^(?:做|进行|连续攻击)${NUM}[~～\\-至]${NUM}次(?:进攻|攻击|连击)?$`), go: (m) => ({ attachDamage: { hits: { min: num(m[1]), max: num(m[2]) } } }) },
  // "在烧伤、中毒、冻伤状态时技能威力翻倍" → scaleIf{when:or selfHas}
  { id: "e38-31",
    re: new RegExp(`^在((?:${AIL_RE})(?:(?:、|,|，|和|与|及)(?:${AIL_RE}))*?)(?:异常)?(?:状态(?:下|时|中)|时)(?:技能)?威力翻倍$`),
    go: (m) => {
      const kinds = [...m[1].matchAll(new RegExp(AIL_RE, "g"))].map((x) => AILMENTS[x[0]]).filter(Boolean);
      if (kinds.length === 0) return null;
      const when = kinds.length === 1 ? { selfHas: kinds[0] } : { or: kinds.map((k) => ({ selfHas: k })) };
      return { attachDamage: { scaleIf: { when, numerator: 2, denominator: 1 } } };
    } },
  // "受到致死攻击时则余下一点体力" / "致死则保留1点体力"
  { id: "e38-32",
    re: /^(?:受到|承受|遭受)致死(?:的)?(?:攻击|伤害|一击)(?:时|后)(?:则)?(?:余下|剩余|保留|留下|留下剩余)(?:一点|1点)?(?:体力|HP|hp)?$|^致死(?:攻击|伤害)(?:时)?(?:保留|剩余|留下)1?点?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "endure", target: "self" }] }) },
  // "使对手5回合内每回合损失100点体力" → foe_dot{flat}
  { id: "e38-33",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)${NUM}回合内?每回合损失${NUM}点(?:体力|HP|hp|生命)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", turns: num(m[1]), params: { flat: num(m[2]) } }] }) },
  // "对手攻击会冻伤" / "对手攻击时会烧伤"（反应式：对手使用攻击技能→上异常）
  { id: "e38-34",
    re: new RegExp(`^(?:对手|对方|敌方)攻击(?:时|后)?会?(${AIL_RE})$`),
    go: (m) => {
      const k = AILMENTS[m[1]]; if (k === undefined) return null;
      return reactWrap(3, { cat: 4 }, `使对手${m[1]}`);
    } },
  // "扣除对方当前血量的四分之一" / "扣除对方当前体力的一半"
  { id: "e38-35",
    re: new RegExp(`^扣除(?:对方|对手|敌方)当前(?:的)?(?:血量|体力|HP|hp|生命)(?:的)?(${NUM}\\s*/\\s*${NUM}|四分之一|一半|${NUM}%)$`),
    go: (m) => {
      const s = m[1];
      const power = s === "四分之一" ? 25 : s === "一半" ? 50 : /%/.test(s) ? num(s) : (() => { const fm = s.match(/(\d+)\s*\/\s*(\d+)/); return fm !== null ? Math.round(num(fm[1]) * 100 / num(fm[2])) : 25; })();
      return { effects: [{ op: "damage", kind: "percent", power, percentBase: "current", target: "opponent" }] };
    } },
  // "损失1/2体力给予对手造成同等的伤害" → selfTradeFrac（引擎新增）
  { id: "e38-36",
    re: new RegExp(`^损失(?:自身|自己)?${NUM}\\s*/\\s*${NUM}(?:的)?体力(?:给予|给)(?:对手|对方|敌方)(?:造成)?同等(?:的)?伤害$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, selfTradeFrac: { n: num(m[1]), d: num(m[2]) }, target: "opponent" }] }) },
  // "若自身当前处于护盾状态下则几率翻倍" → chanceDouble + shield cond
  { id: "e38-37",
    re: /^(?:若)?自身(?:当前)?处于护盾(?:状态)?(?:下|时|中)(?:则)?(?:几率|概率|机率|触发率)翻倍$/,
    go: () => ({ attachAll: { chanceDouble: true, effCond: { selfHas: "shield" } } }) },
];
