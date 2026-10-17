// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5h 批 ──
  { id: "batch-e5h-01", re: new RegExp(`^本次攻击威力(?:提升|提高)${NUM}%$|^技能威力(?:减少|降低)${NUM}%$|^威力提升${NUM}%$`), go: (m) => { const v = num(m[1] ?? m[2] ?? m[3]); return { attachDamage: { mul: { numerator: /减少|降低/.test(m[0]) ? 100 - v : 100 + v, denominator: 100 } } }; } },
  { id: "batch-e5h-02", re: new RegExp(`^攻击${NUM}%使(?:对手|对方|敌方)进入(${AIL_RE})(?:状态)?$`), go: (m) => ({ attachDamage: { ailmentOnHit: { name: AILMENTS[m[2]], pct: num(m[1]) } } }) },
  { id: "batch-e5h-03", re: new RegExp(`^(\\d+)%(?:的?(?:概|几)?率)?(?:令|使|让)自身(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "self", chance: num(m[1]) }] }) },
  { id: "batch-e5h-04", re: new RegExp(`^下${NUM}次对手使用的先制等级为${NUM}或${NUM}的技能无效$|^(?:令|使|让)?对手下${NUM}次使用的先制等级为${NUM}或${NUM}的技能无效$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const a = ns[ns.length - 2]; const b = ns[ns.length - 1]; const cnt = ns.length === 3 ? ns[0] : 1; return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: cnt, prioMin: Math.min(a, b), prioMax: Math.max(a, b) } }] }; } },
  { id: "batch-e5h-05", re: new RegExp(`^(?:令|使|让)己方下(?:一|1)?只精灵出战时恢复(?:全部|所有)体力$|^(?:令|使|让)己方下只出战精灵恢复全部体力$`), go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "nextAlly" }] }) },
  { id: "batch-e5h-06", re: /^(?:令|使|让)己方下(?:一|1)?只精灵出战时恢复所有技能PP值$/, go: () => ({ effects: [{ op: "pp_delta", full: true, target: "nextAlly" }] }) },
  { id: "batch-e5h-07", re: new RegExp(`^自身受到攻击则令(?:对手|对方|敌方)随机进入${NUM}种异常状态$`), go: (m) => reactWrap(1, {}, `令对手随机进入${m[1]}种异常状态`) },
  { id: "batch-e5h-08", re: new RegExp(`^每回合使用技能则(?:出手流程结束后)?恢复自身最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "batch-e5h-09", re: new RegExp(`^最高连击(\\d+)次$|^最多连击(\\d+)次$`), go: (m) => ({ attachDamage: { hitsCap: num(m[1] ?? m[2]) } }) },
  { id: "batch-e5h-10", re: /^若护盾未受到损伤则(.+)$/, go: (m) => { const sub = parseEffectText(m[1]); return sub.effects.length > 0 ? { effects: sub.effects.map((e) => ({ ...e, if: { selfHas: "shield" } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) } : { unparsedReason: `shield-intact cond payload unparsed: ${m[1]}` }; } },
  { id: "batch-e5h-11", re: /^改为提升\d+%$|^改为提升\d+点$/, go: () => ({ unparsedReason: "modifier-replace fragment — referent in prior clause" }) },
  { id: "batch-e5h-12", re: /^无视自身负先制等级$/, go: () => ({ unparsedReason: "negative-priority clamp — mechanism UNVERIFIED" }) },
  // "若当回合受到攻击则X" → trigger 1
  { id: "batch-e5h-13", re: new RegExp(`^若当回合受到攻击则(.+)$|^若本回合受到攻击则(.+)$`), go: (m) => reactWrap(1, {}, m[1] ?? m[2]) },
  // react payload："减少N/M最大体力"（削上限——与直连"减少对手最大体力的1/3"同映射）/"对手PP-N"/"对手所有技能PP值归零"
  { id: "batch-e5h-14", re: new RegExp(`^减少(?:对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}最大体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "batch-e5h-15", re: new RegExp(`^(?:对手|对方|敌方)PP([+\\-＋－])(\\d+)$|^对手PP值?([+\\-＋－])(\\d+)$`), go: (m) => { const sgn = /[-－]/.test(m[1] ?? m[3] ?? "-") ? -1 : 1; return { effects: [{ op: "pp_delta", amount: sgn * num(m[2] ?? m[4]), target: "opponent" }] }; } },
  { id: "batch-e5h-16", re: /^(?:对手|对方|敌方)(?:所有|全部)技能PP值归[零0]$|^(?:使|令|清空)(?:对手|对方|敌方)(?:的)?(?:所有|全部)技能PP(?:值)?归[零0]$|^清空(?:对手|对方|敌方)(?:所有|全部)?(?:技能)?[pP][pP](?:值)?$|^清空(?:自身|自己)(?:所有|全部)?(?:技能)?[pP][pP](?:值)?$/, go: (m) => ({ effects: [{ op: "pp_delta", zero: true, target: /自身|自己/.test(m[0].slice(0, 8)) ? "self" : "opponent", scope: "all" }] }) },
  // 回合内全攻击回血（"N回合内自身所有攻击造成的伤害都将为自己恢复体力"→drain_atk 1/1）
  { id: "batch-e5h-17", re: /^自身所有攻击造成的伤害都将为自己恢复体力$|^所有攻击(?:伤害)?都将(?:为|给)自己恢复体力$/, go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 } }] }) },
  // 消对手强化：旧名 cleanse_up_tick。win 14 是原 WIN.cleanseUp。plain 跳过强化锁，且不发 action-failed。不带 noHooks，清除后仍派发 trigger 7/17。
  { id: "batch-e5h-18", re: /^每回合(?:自身)?(?:技能)?消除(?:对手|对方|敌方)能力(?:提升|强化)状态$|^每回合消除(?:对手|对方|敌方)的?能力(?:提升|强化)状态$/, go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 14 }, payload: [{ op: "clear_stages", target: "opponent", sign: "up", plain: true }] }] }) },
  // 强化被消除→对手封属性（trigger 7 payload）
  { id: "batch-e5h-19", re: new RegExp(`^自身能力(?:强化|提升)状态被消除则(?:对手|对方|敌方)${NUM}回合内?无法使用属性(?:技能)?$`), go: (m) => reactWrap(7, {}, `对手${m[1]}回合无法使用属性技能`) },
  // "使用攻击技能的下N回合[对手]无法使用属性技能"——本招是攻击招的直接封窗
  { id: "batch-e5h-20", re: new RegExp(`^使用攻击技能的下${NUM}回合内?无法使用属性技能$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 1 } }] }) },
  // 承伤转回复量分数伤害（"受到原本恢复量N/M的百分比伤害"→healSelfEcho 变体）
  { id: "batch-e5h-21", re: new RegExp(`^受到(?:原本)?恢复量${NUM}\\s*/\\s*${NUM}的(?:百分比|固定)?伤害$`), go: (m) => ({ attachAll: { healSelfEcho: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  { id: "batch-e5h-22", re: /^(?:使|令)?(?:自身|自己)进入睡眠(\d+)回合$/, go: (m) => ({ effects: [{ op: "apply_status", name: "sleep", target: "self", turns: num(m[1]) }] }) },
  { id: "batch-e5h-23", re: /^(?:使|令)?(?:对手|对方|敌方)免疫受到的致命一?击伤害$|^免疫受到的致命一击伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] }) },
  // "N%免疫致命一击伤害" → crit_immune + chance（"60%免疫受到的致命一击伤害"）
  { id: "batch-e5h-24", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?免疫(?:受到的)?致命[一1]?击?(?:的)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self", chance: num(m[1]) }] }) },
  { id: "batch-e5h-25", re: /^(?:对方|对手|敌方)会余下(\d+)(?:点)?体力$/, go: (m) => ({ attachDamage: { leaveHp: num(m[1]) } }) },
  { id: "batch-e5h-26", re: /^造成等同于恢复量的固定伤害$|^附加恢复量的固定伤害$/, go: () => ({ attachAll: { healEcho: true } }) },
  // "附加等量(的)?(百分比|固定)伤害"——等量基线=宿主伤害/恢复量：echoEqPct 有宿主挂 echo、无宿主回退 flatEcho
  { id: "batch-e5h-26a", re: /^附加等量(?:的)?(?:百分比|固定)?伤害$|^附加等量伤害$/, go: () => ({ attachAll: { echoEqPct: 100 } }) },
  // "附加等同于恢复量的固伤/固定伤害"——无宿主可挂 healEcho 时 standalone 语义=上次恢复量固伤（e9-59 通道）
  { id: "batch-e5h-26b", re: /^(?:并)?附加等同于恢复量的(?:固定|百分比|固伤|固)伤?害?$/, go: () => ({ attachDamage: { flatSelfLastHeal: true } }) },
  { id: "batch-e5h-27", re: new RegExp(`^百分比伤害提升(\\d+)%$|^固定伤害提升(\\d+)%$`), go: (m) => ({ attachDamage: { mul: { numerator: 100 + num(m[1] ?? m[2]), denominator: 100 } } }) },
  // "自身造成的固定伤害" 是百分比伤害提升句的主语残片——逗号切散，记 orphan 供合并
  { id: "batch-e5h-28", re: /^自身造成的固定伤害$/, go: () => ({ ignored: true }) },
];
