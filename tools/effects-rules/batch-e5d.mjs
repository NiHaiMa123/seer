// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, AILMENTS, AIL_RE, frac } from "./lex.mjs";
import { parseEffectText, parseBranchText, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5d 批：承伤上限变体/要害率/自身回血 frac/对手MISS触发/护盾双方消/双方全属性/首招封属性 ──
  { id: "batch-e5d-01", re: new RegExp(`^(?:被攻击所)?(?:受到|收到)的伤害不超过(\\d+)(?:点)?$|^每回合被攻击(?:所)?(?:受到|收到)的伤害不超过(\\d+)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // "攻击对象要害慨率增加1/16"/"攻击中对方要害几率增加1/16"（"对象/中"领起 + OCR"慨率"）。放在 batch-e5d-02 前面，那条要求「击中」。
  { id: "batch-e5d-02a", re: new RegExp(`^攻击(?:对象|中(?:对方|对手|敌方)?)(?:的)?要害(?:慨|概|几)?率(?:增加|提升|提高|上升)${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "攻击击中目标要害概率增加1/16"（batch-e5d-02 的对象词表不含「目标」）。放在 batch-e5d-02 前面。
  { id: "p1-e5d-01", re: new RegExp(`^攻击(?:击中|集中|命中)目标(?:的)?(?:要害|致命一击)(?:慨|概|几)?率(?:增加|提升|提高|上升)${NUM}\s*/\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "batch-e5d-02", re: new RegExp(`^攻击击中(?:对方|对象|对手)?要害的?(?:概率|机率)(?:增加|加)${NUM}\\s*/\\s*${NUM}$|^攻击击中(?:对方|对手)(?:要害)?(?:概率|机率)(?:增加|加)${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "batch-e5d-03", re: new RegExp(`^(?:自身|自己)?恢复(?:自身)?${NUM}\\s*/\\s*${NUM}的?最大(?:体力值?|HP|生命值)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] }; } },
  // "P前N回合失效"（时限词后置——"对手属性技能前3回合失效"）→ status_lock turns
  { id: "batch-e5d-04", re: new RegExp(`^(?:使|令)?(对手|对方|敌方)?(属性|攻击)?技能?前${NUM}回合(?:内|中)?(?:失效|无效)$`), go: (m) => { const cat = m[2] === "属性" ? 1 : m[2] === "攻击" ? 4 : undefined; return { effects: [{ op: "apply_status", name: "status_lock", target: m[1] !== undefined ? "opponent" : "self", turns: num(m[3]), params: cat !== undefined ? { cat } : {} }] }; } },
  { id: "batch-e5d-05", re: new RegExp(`^每回合(?:自身|自己)?恢复(?:自身)?${NUM}\\s*/\\s*${NUM}的?最大体力值?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "batch-e5d-06", re: /^若(?:对手|对方|敌方)(?:MISS|Miss|miss|未命中)(?:则|,|，)?(.+)$/, go: (m) => reactWrap(2, {}, m[1].trim()) },
  { id: "batch-e5d-07", re: new RegExp(`^反弹(?:对手|对方|敌方)下(?:一|${NUM}|次)?(?:次|回合)?(?:造成|所造成)的?伤害$|^反弹对手下次造成的伤害$`), go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, count: 1 } }] }) },
  // "对手下N回合无法使用属性(技能)" / "下N回合对手无法使用属性技能"
  { id: "batch-e5d-08", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}回合内?无法使用属性(?:技能)?$|^对手${NUM}回合内?无法使用属性(?:技能)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: ns[0], params: { cat: 1 } }] }; } },
  { id: "batch-e5d-09", re: /^(?:吸收|清除|解除|消除|反馈)成功则(.+)$/, go: (m) => { const sub = parseBranchText(m[1]); if (sub.effects.length === 0) return { unparsedReason: `prevApplied payload unparsed: ${m[1]}` }; return { effects: sub.effects.map((e) => ({ ...e, if: { prevApplied: true } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  // 宿主句 雷暴火环「清除对手强化，若清除成功则自身命中+1」、穿刺射击「…若消除状态成功则自身特攻等级+1」、
  // 灭魂疾风刺「…若消除状态成功则恢复200体力」——e5d-09 的动词表收「清除/消除」但不收「消除状态」，且这两形带「若」。
  // 负载与门与 e5d-09 逐字同构：parseBranchText 转发，全部负载挂 prevApplied。
  { id: "d3-clear-alias-01", re: /^若(?:清除|消除状态)成功则(.+)$/, go: (m) => { const sub = parseBranchText(m[1]); if (sub.effects.length === 0) return { unparsedReason: `prevApplied payload unparsed: ${m[1]}` }; return { effects: sub.effects.map((e) => ({ ...e, if: { prevApplied: true } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  { id: "batch-e5d-10", re: /^(?:吸收|清除|解除|消除|反馈)失败则(.+)$/, go: (m) => { const sub = parseBranchText(m[1]); if (sub.effects.length === 0) return { unparsedReason: `prevFailed payload unparsed: ${m[1]}` }; return { effects: sub.effects.map((e) => ({ ...e, if: { not: { prevApplied: true } } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  // 令下只出场精灵 N 回合无法使用属性 → nextFoe status_lock
  { id: "batch-e5d-11", re: new RegExp(`^(?:令|使|让)(?:对手)?下(?:一|${NUM})?只(?:出场|出战)(?:的)?精灵${NUM}回合内?无法使用属性(?:技能)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "status_lock", target: "nextFoe", turns: ns[ns.length - 1], params: { cat: 1 } }] }; } },
  // 己方下次必定先手 → self + nextAlly prio 窗口（count:1 行动消耗）
  { id: "batch-e5d-12", re: /^令己方下(?:一|1)?次(?:使用|使用技能)?(?:的)?技能?必定先手$|^(?:己方|自身)下次(?:攻击|使用技能)?必定先手$/, go: () => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: 8, count: 1 } }, { op: "apply_status", name: "prio_count", target: "nextAlly", params: { add: 8, count: 1 } }] }) },
  { id: "batch-e5d-13", re: /^(?:使|令)(?:对手|对方|敌方)本回合攻击技能失效$|^(?:使|令)(?:对手|对方|敌方)本回合(?:攻击|技能)无效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { cat: 4, count: 1 } }] }) },
  // 消除双方能力提升+下降 → 两侧无方向 clear
  { id: "batch-e5d-14", re: /^消除双方能力(?:提升|强化)状态(?:和|及|与)?能力?下降状态$|^消除(?:双方)?能力(?:提升|强化)状态和能力下降状态$|^消除双方的能力(?:提升|强化)和能力下降状态$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent" }, { op: "clear_stages", target: "self" }] }) },
  { id: "batch-e5d-15", re: new RegExp(`^(?:使|令)?双方全属性([+\\-＋－])${NUM}$`), go: (m) => { const d = (m[1] === "-" || m[1] === "－" ? -1 : 1) * num(m[2]); return { effects: ["self", "opponent"].flatMap((t) => ["atk", "def", "spa", "sdf", "spd"].map((s) => ({ op: "apply_stat_stage", stat: s, delta: d, target: t }))) }; } },
  { id: "batch-e5d-16", re: new RegExp(`^每回合附加(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}的固定伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "batch-e5d-17", re: new RegExp(`^(\\d+)%的?(?:概|几)?率?威力${NUM}倍$|^有?(\\d+)%(?:的?(?:概|几)?率)?威力为?${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mulChance: { chance: ns[0], numerator: ns[1], denominator: 1 } } }; } },
  { id: "batch-e5d-18", re: new RegExp(`^有?(\\d+)%的?(?:概|几)?率?将(?:对手|对方|敌方)(${AIL_RE})$|^(?:令|使|让)(?:对手|对方|敌方)进入(${AIL_RE})(?:状态)?$`), go: (m) => { const a = m[2] ?? m[3]; const name = m[3] !== undefined ? AILMENTS[m[3]] : AILMENTS[m[2]]; return { effects: [{ op: "apply_status", name: name ?? a.trim(), target: "opponent", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }; } },
  // 属性招吸取窗（"对手使用属性技能则减少N/M最大体力"→trigger3 cat1 + percent payload）
  { id: "batch-e5d-19", re: new RegExp(`^(?:对手|对方|敌方)使用属性技能则减少(?:对手)?${NUM}\\s*/\\s*${NUM}最大体力$`), go: (m) => reactWrap(3, { cat: 1 }, `减少对手${m[1]}/${m[2]}最大体力`) },
  // 对手 PP 消耗倍率（"对手释放技能所消耗的PP值为2倍"→pp_double 对侧窗口）
  { id: "batch-e5d-20", re: new RegExp(`^(?:对手|对方|敌方)(?:释放|使用)技能所消耗的PP值为${NUM}倍$|^(?:对手|对方|敌方)技能PP消耗(?:为|变为|提升)${NUM}倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_double", target: "opponent", params: { mul: num(m[1] ?? m[2]) } }] }) },
  // 双方体力值之差 N% 固伤
  { id: "batch-e5d-21", re: new RegExp(`^附加双方体力值之差${NUM}%的\\S{0,3}系伤害$|^附加双方体力值之差${NUM}%的?伤害$`), go: (m) => ({ attachDamage: { flatHpDiffPct: num(m[1] ?? m[2]) } }) },
  // 消除双方护盾 + 护盾值反噬（"消除双方护盾并附加护盾值70%的百分比伤害"）
  { id: "batch-e5d-22", re: new RegExp(`^消除双方(?:护盾|护罩)并附加护盾值(\\d+)%的(?:百分比|固定)?伤害$`), go: (m) => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield", echoPct: num(m[1]) }, { op: "cleanse", target: "self", scope: "shield" }] }) },
  // 消除总段数 ×N 固伤（"附加消除总段数乘以35的固定伤害"——按被移除的正面等级段数计）
  { id: "batch-e5d-23", re: new RegExp(`^附加消除总段数乘以?(\\d+)的固定伤害$|^附加消除(?:的)?能力等级数乘以?(\\d+)的固定伤害$`), go: (m) => ({ attachAll: { flatPerRemoved: num(m[1] ?? m[2]) } }) },

  { id: "batch-e5d-24", re: /^将对手标记为\S{2,4}(?:的|)?$/, go: () => ({ unparsedReason: "mark mechanic — mark system deferred (UNVERIFIED)" }) },
];
