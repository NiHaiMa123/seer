// batch-e37：能力值列表鲁棒性（和/及/与/拼接/混值）、命中即态、下只削减、免疫谓词、延迟同归于尽。
import { NUM, num, STAT_RE, STATS, AIL_RE, AILMENTS } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

const ALL_STATS = ["atk", "def", "spa", "sdf", "spd", "acc"];
const stageFx = (stat, delta, target) => ({ op: "apply_stat_stage", stat, delta, target });
// stage_tick stat=10 + statMask 位掩码（STAGE_TICK_CODES 序 atk|def|spa|sdf|spd|acc）——多维共享 delta 的逐回合 tick
const TICK_IDX = { atk: 0, def: 1, spa: 2, sdf: 3, spd: 4, acc: 5 };
const tickFx = (statNames, delta, target, extra = {}) => liftTick({
  op: "apply_status", name: "stage_tick", target,
  params: { stat: 10, statMask: statNames.reduce((mm, s) => mm | (1 << TICK_IDX[s]), 0), delta },
  ...extra });
// 对词（双攻/双防）展开——对齐 ailment.mjs statOf 先例
const PAIR = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"] };
const STOK = `${STAT_RE}|双攻|双防`;
const expandStat = (zh) => PAIR[zh] ?? (STATS[zh] !== undefined ? [STATS[zh]] : []);

export const rules = [
  // ── 能力值列表鲁棒性 ────────────────────────────────────────────────────
  // "自身攻击和速度提升2个等级" / "攻击、防御、特防和速度等级+1" → 多维共享 +N
  { id: "e37-01",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:改变|使|令|提高|提升|增强|增加)?(?:(每回合)(?:使|令)?)?(?:(自身|自己|对方|对手|敌方)的?)?((?:${STOK})(?:(?:和|与|及|、|，|,)(?:${STOK}))+)(?:的)?(?:能力)?(?:等级)?(?:提升|提高|增加|增强)?([+\\-＋－]?)(${NUM})个?(?:等级|级)?$`),
    go: (m) => {
      const names = [...m[4].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
      if (names.length < 2) return null;
      const sign = m[5] === "-" || m[5] === "－" ? -1 : 1;
      const pctM = m[0].match(/(\d+)%/);
      const t = /对手|对方|敌方/.test(m[3] ?? "") ? "opponent" : "self";
      const d = sign * num(m[6]);
      const ch = pctM !== null ? { chance: num(pctM[1]) } : {};
      if (m[2] !== undefined) return { effects: [tickFx(names, d, t, ch)] };
      return { effects: names.map((stat) => ({ ...stageFx(stat, d, t), ...ch })) };
    } },
  // 拼接无分隔："自身攻击防御特防和速度等级+1" / "攻击和速度提升2个"
  { id: "e37-02",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:改变|使|令|提高|提升|增强|增加)?(?:(每回合)(?:使|令)?)?(?:(自身|自己|对方|对手|敌方)的?)?((?:${STOK})(?:(?:${STOK}|和|与|及)+(?:${STOK}))+)(?:的)?(?:能力)?(?:等级)?(?:提升|提高|增加|增强)?([+\\-＋－]?)(${NUM})个?(?:等级|级)?$`),
    go: (m) => {
      const names = [...m[4].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
      if (names.length < 2) return null;
      const sign = m[5] === "-" || m[5] === "－" ? -1 : 1;
      const pctM = m[0].match(/(\d+)%/);
      const t = /对手|对方|敌方/.test(m[3] ?? "") ? "opponent" : "self";
      const d = sign * num(m[6]);
      const ch = pctM !== null ? { chance: num(pctM[1]) } : {};
      if (m[2] !== undefined) return { effects: [tickFx(names, d, t, ch)] };
      return { effects: names.map((stat) => ({ ...stageFx(stat, d, t), ...ch })) };
    } },
  // 单维动词形："改变自身攻击等级1"/"增强自身攻击等级2"（无号按提升计）
  { id: "e37-02b",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:改变|提高|提升|增强|增加)(?:(自身|自己|对方|对手|敌方)的?)?(${STAT_RE})(?:的)?(?:能力)?(?:等级)?([+\\-＋－]?)(${NUM})个?(?:等级|级)?$`),
    go: (m) => {
      const st = STATS[m[3]]; if (st === undefined) return null;
      const d = (m[4] === "-" || m[4] === "－" ? -1 : 1) * num(m[5]);
      const pctM = m[0].match(/(\d+)%/);
      const t = /对手|对方|敌方/.test(m[2] ?? "") ? "opponent" : "self";
      return { effects: [{ ...stageFx(st, d, t), ...(pctM !== null ? { chance: num(pctM[1]) } : {}) }] };
    } },
  // 混值列表："自身攻击、防御+2速度+1"（无号段归属其后的带号组）
  { id: "e37-03",
    re: new RegExp(`^(?:使|令|改变)?(?:(自身|自己|对方|对手|敌方)的?)?(?:(?:${STAT_RE})(?:[、,，和与及](?:${STAT_RE}))*(?:等级)?[+\\-＋－]${NUM}[、,，]?){2,}$`),
    go: (m) => {
      const groups = [...m[0].matchAll(new RegExp(`((?:${STAT_RE})(?:(?:[、,，和与及])(?:${STAT_RE}))*)(?:等级)?([+\\-＋－])(${NUM})`, "g"))];
      if (groups.length < 2) return null;
      const t = /对手|对方|敌方/.test(m[1] ?? "") ? "opponent" : "self";
      const out = [];
      for (const g of groups) {
        const d = (g[2] === "-" || g[2] === "－" ? -1 : 1) * num(g[3]);
        for (const sm of g[1].matchAll(new RegExp(STAT_RE, "g"))) { const st = STATS[sm[0]]; if (st !== undefined) out.push(stageFx(st, d, t)); }
      }
      return { effects: out };
    } },
  // 每回合混合列表："每回合自身攻击、速度提升1等级，防御、特防、命中+1" → stage_tick 逐维
  { id: "e37-03b",
    re: new RegExp(`^(每回合)?(?:使|令|改变)?(?:(自身|自己|对方|对手|敌方)的?)?(?:(?:${STOK})(?:[、,，和与及](?:${STOK}))*(?:的)?(?:能力)?(?:等级)?(?:(?:提升|提高|增加|增强)${NUM}个?(?:等级|级)?|(?:降低|下降|减少)${NUM}个?(?:等级|级)?|[+\\-＋－]${NUM}(?:个)?(?:等级|级)?)[、,，]?){2,}$`),
    go: (m) => {
      const groups = [...m[0].matchAll(new RegExp(`((?:${STOK})(?:(?:[、,，和与及])(?:${STOK}))*)(?:的)?(?:能力)?(?:等级)?(?:(提升|提高|增加|增强|降低|下降|减少)(${NUM})个?(?:等级|级)?|([+\\-＋－])(${NUM})(?:个)?(?:等级|级)?)`, "g"))];
      if (groups.length < 2) return null;
      const t = /对手|对方|敌方/.test(m[2] ?? "") ? "opponent" : "self";
      const tick = m[1] !== undefined;
      const out = [];
      for (const g of groups) {
        const d = g[3] !== undefined ? (/降低|下降|减少/.test(g[3]) ? -1 : 1) * num(g[4]) : (g[5] === "-" || g[5] === "－" ? -1 : 1) * num(g[6]);
        const stNames = [...g[1].matchAll(new RegExp(STOK, "g"))].flatMap((x) => expandStat(x[0]));
        if (tick) { if (stNames.length > 0) out.push(tickFx(stNames, d, t)); }
        else for (const st of stNames) out.push(stageFx(st, d, t));
      }
      return { effects: out };
    } },
  // "自身攻击先制"（裸）→ 攻击招式先制+1；"下N回合自身攻击先制+K" 已由 prio_up 覆盖
  { id: "e37-04", re: /^(?:自身|自己)?(?:的)?攻击(?:技能)?先制(?:\+1)?$/, go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 1 } }] }) },
  // "自身攻击无视对手(能力强化状?态?)" → pierce_stages（攻击无视对手强化）
  { id: "e37-05", re: /^(?:自身|自己)?(?:的)?攻击(?:技能)?无视(?:对手|对方|敌方)(?:的)?(?:能力)?(?:强化|提升)(?:状|状态)?(?:态)?$|^(?:自身|自己)?(?:的)?攻击(?:技能)?无视(?:对手|对方|敌方)$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "每次自身攻击+N" → 逐击 stageOnHit（命中即+）
  { id: "e37-06", re: new RegExp(`^每次(?:自身|自己)攻击([+\\-＋－])${NUM}$|^每次攻击命中?(?:后|时)?(?:使|令)?(?:自身|自己)?(${STAT_RE})([+\\-＋－])${NUM}$`),
    go: (m) => {
      const alt1 = m[1] !== undefined;
      const sign = alt1 ? m[1] : m[4];
      const nv = alt1 ? m[2] : m[5];
      const st = alt1 ? "atk" : STATS[m[3]];
      if (nv === undefined || st === undefined) return null;
      const d = (sign === "-" || sign === "－" ? -1 : 1) * num(nv);
      return { attachDamage: { stageOnHit: [{ stat: st, delta: d }] } };
    } },
  // "每次使用(此技能)?自身攻击+N" → 每次施放 +N（条件包裹可上挂 if）
  { id: "e37-07", re: new RegExp(`^每次(?:使用|施放)(?:此技能|该技能|本技能)?(?:则)?(?:自身|自己)?(${STAT_RE}|全属性|所有属性)([+\\-＋－]?)${NUM}(?:个)?(?:等级)?$`),
    go: (m) => { const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); const list = /全属性|所有属性/.test(m[1]) ? ALL_STATS : [STATS[m[1]]]; return { effects: list.map((s) => stageFx(s, d, "self")) }; } },
  // "每次命中对手还会降低对手下只出战精灵最大HP的N%" → foeNextMaxHpAcc（capTail 接"最多降低M%"）
  { id: "e37-08", re: new RegExp(`^每次(?:攻击)?命中(?:对手|对方|敌方)?(?:后|时)?(?:还|都|亦)?(?:会)?(?:使|令)?(?:对手|对方|敌方)下(?:一|${NUM})?只(?:出场|出战)?(?:的)?精灵(?:的)?最[大高](?:体力|HP)(?:值)?(?:的)?${NUM}%$|^每次命中(?:对手|对方|敌方)?(?:还|都)?(?:会)?降低(?:对手|对方|敌方)下只出战精灵最大(?:体力|HP)的${NUM}%$`),
    go: (m) => { const pct = num(m[m.length - 1]); return { attachDamage: { foeNextMaxHpAcc: { pct } } }; } },
  // "每回合使用技能附加对手最大体力N/M的百分比伤害" → pct_rider 回合窗（n/d）
  { id: "e37-09", re: new RegExp(`^(?:每回合)?(?:使用技能|攻击)(?:后|时)?(?:附加|附带)(?:对手|对方|敌方)(?:的)?最[大高](?:体力|HP)(?:值)?的?${NUM}\\s*/\\s*${NUM}的百分比伤害$|^每回合使用技能附加对手最大体力${NUM}%的百分比伤害$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const [n, d] = ns.length === 1 ? [ns[0], 100] : [ns[0], ns[1]]; return { effects: [{ op: "apply_status", name: "pct_rider", target: "self", params: { n, d } }] }; } },
  // "每回合攻击附加自身攻击和特攻中最高一项N%的百分比伤害" → pct_rider{statMax}
  { id: "e37-10", re: new RegExp(`^(?:每回合)?(?:攻击|使用攻击技能)?(?:附加|附带)(?:自身|自己)(?:的)?攻击和特攻中(?:的)?最高(?:的)?一?项(?:的)?${NUM}%的(?:百分比|固定)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pct_rider", target: "self", params: { n: num(m[1]), d: 100, statMax: 1 } }] }) },
  // "对手免疫百分比伤害时额外附加N点真实伤害" → flatIfFoeImmune
  { id: "e37-11", re: new RegExp(`^(?:对手|对方|敌方)免疫(?:百分比|固定)伤害时?(?:则)?额外附加${NUM}点(?:真实伤害|伤害)$`),
    go: (m) => ({ attachDamage: { flatIfFoeImmune: num(m[1]) } }) },
  // "对手使用技能后每处于N种异常状态受到M点固定伤害" → react trigger3 + flatPerAilment
  { id: "e37-12", re: new RegExp(`^(?:对手|对方|敌方)(?:使用|释放)技能后(?:每处于|若处于)${NUM}种异常状态?(?:则|，|,)?受到${NUM}点(?:固定)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 3 }, payload: [{ op: "damage", kind: "fixed", power: 0, flatPerAilment: num(m[2]), target: "opponent" }] }] }) },
  // "每处于N种异常状态受到M点固定伤害" — 负载位裸句
  { id: "e37-13", re: new RegExp(`^每处于${NUM}种异常状态?(?:则|，|,)?受到${NUM}点(?:固定)?伤害$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatPerAilment: num(m[2]), target: "opponent" }] }) },
  // "N回合后若对方没有将自己击败，则对方死亡" → doom 延迟终结（到期时持有者存活则对手倒下）
  { id: "e37-14", re: new RegExp(`^${NUM}回合后若(?:对方|对手|敌方)没有将(?:自己|自身)击败(?:，|,)?则(?:对方|对手|敌方)死亡$|^若(?:对方|对手|敌方)没有将(?:自己|自身)击败(?:，|,)?则(?:对方|对手|敌方)死亡$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "doom", target: "self", turns: m[1] !== undefined ? num(m[1]) : 3 }] }) },
  // "改为全属性+N" → 前置条件改写为全属性（条件由 cond/partCond 上挂）
  { id: "e37-15", re: new RegExp(`^改为(全属性|所有属性|全部能力|全项能力)([+\\-＋－])${NUM}$`),
    go: (m) => { const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); return { effects: ALL_STATS.map((s) => stageFx(s, d, "self")) }; } },
  // "自身攻击技能造成伤害的N%会恢复自身体力" → drain_atk 窗
  { id: "e37-16", re: new RegExp(`^(?:自身|自己)?(?:的)?(?:攻击|攻击技能|所有攻击)(?:技能)?造成(?:的)?伤害(?:的)?${NUM}%(?:都|也)?会?(?:恢复|回复|转化为)(?:自己|自身)?的?(?:体力|HP)$|^造成伤害的${NUM}%(?:恢复|回复)(?:自己|自身)体力$`),
    go: (m) => { const nv = m.slice(1).find((x) => x !== undefined); if (nv === undefined) return null; return { effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(nv), d: 100 } }] }; } },
  // "自身攻击造成的所有伤害都将恢复自身体力" → drain_atk 100%（无百分比按全额）
  { id: "e37-16b", re: /^(?:自身|自己)?(?:的)?(?:攻击|攻击技能|所有攻击)(?:技能)?造成(?:的)?所有伤害(?:的)?都(?:将|会|可)?(?:恢复|回复|转化为)(?:自己|自身)?的?(?:体力|HP)$/, go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 100, d: 100 } }] }) },
  // "令对手麻痹和烧伤" / "使自身睡眠及混乱" → 异常枚举逐个落
  { id: "e37-17",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:使|令|让|令使)(对手|对方|敌方|自身|自己)(?:的)?(?:进入|陷入)?((?:${AIL_RE})(?:(?:和|与|及|、|，|,|或)(?:${AIL_RE}))+)(?:的)?(?:异常)?(?:状态)?$`),
    go: (m) => {
      const names = [...m[3].matchAll(new RegExp(AIL_RE, "g"))].map((x) => AILMENTS[x[0]]).filter(Boolean);
      if (names.length < 2) return null;
      const pctM = m[0].match(/(\d+)%/);
      const t = /对手|对方|敌方/.test(m[2]) ? "opponent" : "self";
      return { effects: names.map((name) => ({ op: "apply_status", name, target: t, ...(pctM !== null ? { chance: num(pctM[1]) } : {}) })) };
    } },
];
