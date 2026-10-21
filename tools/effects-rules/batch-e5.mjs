// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, AILMENTS, frac } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5 批：倍伤裸句/触发11-12/nextFoe吸取/双防固伤/留档 ──
  { id: "batch-e5-01", re: /^造成的伤害翻倍$|^伤害翻倍$/, go: () => ({ attachDamage: { mul: { numerator: 2, denominator: 1 } } }) },
  { id: "batch-e5-02", re: new RegExp(`^伤害(?:提升)?变为${NUM}倍$|^(?:使|令)?造成的伤害变为${NUM}倍$|^伤害提升${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mul: { numerator: ns[0], denominator: 1 } } }; } },
  { id: "batch-e5-03", re: new RegExp(`^${NUM}%的概率造成伤害翻倍$|^${NUM}%伤害翻倍$`), go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1] ?? m[2]), numerator: 2, denominator: 1 } } }) },
  { id: "batch-e5-04", re: /^(?:自身|自己)下(?:一|1)?次(?:攻击|攻击技能)必定致命(?:一)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 2, params: { count: 1 } }] }) },
  { id: "batch-e5-05", re: /^命中效果失效$|^属性技能命中效果失效$|^攻击技能命中效果失效$|^效果失效$/, go: (m) => ({ effects: [{ op: "apply_status", name: "hit_fx_null", target: "opponent", ...(m[0].includes("属性") ? { params: { cat: 1 } } : m[0].includes("攻击") ? { params: { cat: 4 } } : {}) }] }) },
  // 己方下只出战精灵回血（nextAlly——登场按 self 结算）
  { id: "batch-e5-06", re: new RegExp(`^令己方下(?:一|${NUM})?(?:只|个)(?:出战|出场)(?:的)?精灵(?:出战时)?恢复(\\d+)点(?:体力|HP)$|^己方下(?:一|${NUM})?(?:只|个)(?:出战|出场)(?:的)?精灵恢复(\\d+)点(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "heal", target: "nextAlly", flat: num(m[1] ?? m[3]) }] }) },
  // 裸多 stat 列表 ±N（"攻击防御特防速度+1"——无"等级"词）
  { id: "batch-e5-07", re: new RegExp(`^((?:${STAT_RE}){2,5})([+\\-＋－])${NUM}$`), go: (m) => { const sgn = m[2] === "-" || m[2] === "－" ? -1 : 1; const names = m[1].match(/攻击|防御|特攻|特功|特防|速度|命中/g) ?? []; return { effects: names.map((n) => ({ op: "apply_stat_stage", stat: STATS[n], delta: sgn * num(m[3]), target: "self" })) }; } },
  // 分数区间压血变体（"降低对手1/8至1/2体力"——无"随机"/"当前"字样）
  { id: "batch-e5-08", re: new RegExp(`^降低(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}至${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", fracRange: { min: frac(m[1], m[2]), max: frac(m[3], m[4]) }, percentBase: "max", target: "opponent", power: 0 }] }) },
  { id: "batch-e5-09", re: new RegExp(`^吸取(?:对手|对方|敌方)(\\d+)(?:点)?体力$|^吸取(?:对手|对方|敌方)(\\d+)点$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2]), drain: { numerator: 1, denominator: 1 }, target: "opponent" }] }) },
  // 每回合用招概率异常（"每回合使用技能时有N%的几率令对手害怕"→react trigger11，chance 注入 payload 每次判定）
  { id: "batch-e5-10", re: new RegExp(`^每回合使用技能时有?(\\d+)%(?:的?(?:概|几)?率)?令(?:对手|对方|敌方)(.+)$|^使用技能时有?(\\d+)%(?:的?(?:概|几)?率)?令(?:对手|对方|敌方)(.+)$`), go: (m) => { const r = reactWrap(11, {}, `对手${(m[2] ?? m[4]).trim()}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1] ?? m[3]); return r; } },
  { id: "batch-e5-11", re: new RegExp(`^附加(?:对手|对方|敌方)(?:双防之和|防御和特防能力(?:值)?总和|防御、特防能力(?:值)?总和)${NUM}%的?(?:固定|固定伤害|固伤|伤害)?$`), go: (m) => ({ attachDamage: { flatFoeDefSumPct: num(m[1]) } }) },
  // 每次攻击概率自强（"每次攻击都有N%的几率令自身攻击+1"→react trigger12，chance 注入 payload）
  { id: "batch-e5-12", re: new RegExp(`^每次攻击都有?(\\d+)%(?:的?(?:概|几)?率)?(?:令|使|让)自身(.+)$|^每次攻击有?(\\d+)%(?:的?(?:概|几)?率)?(?:令|使|让)自身(.+)$`), go: (m) => { const r = reactWrap(12, {}, `自身${(m[2] ?? m[4]).trim().replace(/^自身/, "")}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1] ?? m[3]); return r; } },
  { id: "batch-e5-13", re: new RegExp(`^(\\d+)%(?:的?(?:概|几)?率)?另(?:对手|对方|敌方)(.+)$`), go: (m) => { const a = AILMENTS[m[2].replace(/状态$/, "")]; return a === undefined ? { unparsedReason: `ailment unparsed: ${m[2]}` } : { effects: [{ op: "apply_status", name: a, target: "opponent", chance: num(m[1]) }] }; } },
  // "附带N%几率令对手<异常>"（"造成伤害的20%恢复自身体力并附带15%几率令对手睡眠"——同句里的附加效果）
  // 只多一个「附带」前缀，语义与 batch-e5-13 的「N%令对手<异常>」相同：N% 概率施加该异常。
  { id: "batch-e5-13b", re: new RegExp(`^附带(\\d+)%(?:的?(?:概|几)?率)?(?:另|令|使|让)(?:对手|对方|敌方)(.+)$`), go: (m) => { const a = AILMENTS[m[2].replace(/状态$/, "")]; return a === undefined ? { unparsedReason: `ailment unparsed: ${m[2]}` } : { effects: [{ op: "apply_status", name: a, target: "opponent", chance: num(m[1]) }] }; } },
  // 每回合攻击附加自身双防总和 N% 固伤 → dmg_flat 窗口 defSumPct
  { id: "batch-e5-14", re: new RegExp(`^每回合(?:攻击|攻击技能)?附加(?:自身|自己)双防(?:值)?总和?${NUM}%的(?:固定|固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { defSumPct: num(m[1]) } }] }) },
  // 若Miss则回血（self-miss trigger6）
  { id: "batch-e5-15", re: new RegExp(`^若(?:Miss|MISS|未命中)(?:则|,|，)?(?:自己|自身)恢复${NUM}\\s*/\\s*${NUM}体力$|^若(?:Miss|MISS|未命中)则恢复${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => reactWrap(6, {}, `恢复${num(m[1] ?? m[3])}/${num(m[2] ?? m[4])}体力`) },
  // 在场精灵吸取对手下只出场精灵（nextFoe 承伤 + 施放侧回血 → drainTo:"foe"）
  { id: "batch-e5-16", re: new RegExp(`^(?:在场精灵)?吸取(?:对手|对方|敌方)下(?:一|${NUM})?(?:只|个)出场(?:的)?精灵最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const [n, d] = ns.slice(-2); return { effects: [{ op: "damage", kind: "percent", frac: frac(n, d), percentBase: "max", target: "nextFoe", drain: frac(1, 1), drainTo: "foe", power: 0 }] }; } },
  // 当回合对手无法造成攻击伤害 → dmg_weaken {n:0} 一回合窗口
  { id: "batch-e5-17", re: /^当回合(?:对手|对方|敌方)无法造成(?:攻击)?伤害$|^(?:使|令)(?:对手|对方|敌方)当回合无法造成(?:攻击)?伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", turns: 1, params: { n: 0, d: 1 } }] }) },
  // "使自身下回合受到的伤害降低N%"（主语+回合内嵌变体）→ dmg_taken_down self
  { id: "batch-e5-18", re: new RegExp(`^(?:使|令)自身下回合受到(?:的)?伤害(?:降低|减少)${NUM}%$|^使自身受到(?:的)?伤害(?:降低|减少)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", ...(m[0].includes("下回合") ? { turns: 1 } : {}), params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "使自身下N回合受到的伤害不超过M" → dmg_cap turns
  { id: "batch-e5-19", re: new RegExp(`^(?:使|令)?自身下${NUM}回合受到(?:的)?伤害不超过(\\d+)(?:点)?$|^使自身受到的伤害不超过(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", turns: num(m[1] ?? "1"), params: { cap: num(m[2] ?? m[3]) } }] }) },
  // "每回合受到伤害减少N" → dmg_reduce flat（回合级定额承伤减免窗口）
  // "每回合减伤害110"（"减伤害"省字+省「受到」）。放在 batch-e5-20 前面，那条要求「每回合受到…伤害减少」。
  { id: "batch-e5-20a", re: new RegExp(`^每回合减伤害(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "batch-e5-20", re: new RegExp(`^每回合受到(?:的)?伤害减少(\\d+)(?:点)?$|^受到的伤害减少(\\d+)点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "免疫反弹异常状态" → immune_status + reflect_status 双 flag
  { id: "batch-e5-21", re: /^免疫反弹异常状态$|^免疫并反弹异常状态$|^免疫反弹所有异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "reflect_status", target: "self" }] }) },
  // "使下只出战精灵第一回合必定暴击" → nextAlly crit_always
  { id: "batch-e5-22", re: /^(?:使|令)下(?:一|1)?只出战精灵第[一1]回合必定暴击$|^(?:使|令)下(?:一|1)?只(?:出战)?精灵必定暴击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "nextAlly", turns: 1, params: { count: 1 } }] }) },
  // "双防额外+2"（组合 stat 别名 + 「额外」赘词）。放在 batch-e5-23 前面，那条签名不含「额外」。
  { id: "batch-e5-23a", re: new RegExp(`^((?:(?:${STAT_RE})|攻速|双攻|双防|双刀|全属性|所有属性)+)(?:等级)?额外([+\\-＋－])${NUM}$`), go: (m) => { const segRe = new RegExp(`${STAT_RE}|攻速|双攻|双防|双刀|全属性|所有属性`, "g"); const expand = { 攻速: ["atk", "spd"], 双刀: ["atk", "spa"], 双攻: ["atk", "spa"], 双防: ["def", "sdf"], 全属性: ["atk", "def", "spa", "sdf", "spd"], 所有属性: ["atk", "def", "spa", "sdf", "spd"] }; const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); const out = []; for (const h of m[1].matchAll(segRe)) { const names = expand[h[0]] ?? [STATS[h[0]]].filter(Boolean); for (const st of names) out.push({ op: "apply_stat_stage", stat: st, delta: d, target: "self" }); } return out.length > 0 ? { effects: out } : null; } },
  // 组合 stat 别名（"攻速+2"=atk+spd；"攻击双防速度+1"混合串）
  { id: "batch-e5-23", re: new RegExp(`^((?:(?:${STAT_RE})|攻速|双攻|双防|双刀|全属性|所有属性)+)(?:等级)?([+\\-＋－])${NUM}$`), go: (m) => { const segRe = new RegExp(`${STAT_RE}|攻速|双攻|双防|双刀|全属性|所有属性`, "g"); const expand = { 攻速: ["atk", "spd"], 双刀: ["atk", "spa"], 双攻: ["atk", "spa"], 双防: ["def", "sdf"], 全属性: ["atk", "def", "spa", "sdf", "spd"], 所有属性: ["atk", "def", "spa", "sdf", "spd"] }; const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); const out = []; for (const h of m[1].matchAll(segRe)) { const names = expand[h[0]] ?? [STATS[h[0]]].filter(Boolean); for (const st of names) out.push({ op: "apply_stat_stage", stat: st, delta: d, target: "self" }); } return out.length > 0 ? { effects: out } : null; } },
  { id: "batch-e5-24", re: /^攻速$|^双攻$|^双防$|^攻击速度$/, go: () => ({ unparsedReason: "bare stat-alias fragment (delta in separate clause)" }) },
  // 对手能力下降等级总和×N 固伤（"附加对手能力下降等级总和X100的固定伤害"）
  { id: "batch-e5-25", re: new RegExp(`^附加(?:对手|对方|敌方)能力下降等级总和[Xx×](\\d+)的(?:固定|固定伤害|固伤)$|^附加(?:对手|对方|敌方)能力下降(?:状态)?等级总和乘(?:以)?(\\d+)的?固定伤害$`), go: (m) => ({ attachDamage: { flatPerStage: { who: "foe", sign: "down", per: 1, flat: num(m[1] ?? m[2]), mode: "levels" } } }) },
  // 留档：语义不充分/变量未定义/系数未文档化
  // ── 惩罚族：对方能力等级越高 → 威力 + 20×对方强化总级数 ──
  // 原文不给系数，但赛尔号实测三源一致：实际威力 = 面板威力 + 20 × 对方能力强化总级数
  //   https://news.7k7k.com/content/20110504/85587.html         （135 + 总级数*20）
  //   https://www.bilibili.com/read/cv13459300/                  （面板+20*对手攻防等级）
  //   https://wiki.biligame.com/seer/赛尔号PVE概论               （面板+20*对方攻击和防御等级）
  // 落点用已有的 powerPerStageScale，不新增字段。必须排在 batch-e5-26 之前。
  // 整句形态（未被逗号切开）
  { id: "batch-e5-25a", re: /^(?:惩罚[，,]?)?(?:对方|对手|对面|敌方)(?:的)?能力(?:等级|等)(?:越高|等越高)[，,]?.*(?:此)?(?:招|技能)?威力(?:越大|越高)$/, go: () => ({ attachDamage: { powerPerStageScale: { who: "foe", sign: "up", per: 1, add: 20, mode: "levels", kind: "flat" } } }) },
  // 被逗号切开的半句："对方能力等级越高，此技能威力越大" → 两个独立 part。
  // 头半句承载缩放语义，尾半句只是修辞重复；尾半句忽略即可（不新增条目）。
  { id: "batch-e5-25b", re: /^(?:惩罚[，,]?)?(?:对方|对手|对面|敌方)(?:的)?能力(?:等级|等)(?:越高|等越高)$/, go: () => ({ attachDamage: { powerPerStageScale: { who: "foe", sign: "up", per: 1, add: 20, mode: "levels", kind: "flat" } } }) },
  // 「威力越大」/「惩罚」这类残段在**同句已出现能力等级缩放**时只是修辞重复；
  // 但规则看不到前文，所以不能无条件 ignored（否则会吞掉 849 冰之潜能这种
  // "个体越高，威力越大"——个体值缩放，无系数，必须继续留档）。
  // 折中：把被逗号切开的整句在解析层拼回去（见 effects-parse 的 punish 合句），
  // 这里只留"惩罚"这个修饰词的无害忽略。
  { id: "batch-e5-25d", re: /^惩罚$/, go: () => ({ ignored: true }) },
  { id: "batch-e5-26", re: /^(?:对方|对手|敌方)能力等级越高$|^此技能威力越大$|^技能威力越大$|^自身体力越少则威力越大$|^体力越少威力越大$/, go: () => ({ unparsedReason: "stage/hp-scaled power — coefficient undocumented (UNVERIFIED)" }) },
  { id: "batch-e5-27", re: /^连续使用可以增加威力$|^连续使用威力(?:增加|提升)$/, go: () => ({ unparsedReason: "per-use power — coefficient undocumented (UNVERIFIED)" }) },
  { id: "batch-e5-28", re: /^使自身下次受到的伤害减少[nN]点$/, go: () => ({ unparsedReason: "flat_taken variable 'n' — referent undefined (UNVERIFIED)" }) },
  { id: "batch-e5-29", re: /^使?自身下(?:一|1|次)次?受到的伤害减少本回合伤害点$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { dynDealt: 1, count: 1 } }] }) },
  { id: "batch-e5-30", re: /^[（(]?n[=＝]|n等于本回合自身造成的伤害[)）]?$/i, go: () => ({ ignored: true }) },
  { id: "batch-e5-31", re: /^护罩效果$|^护盾效果$/, go: () => ({ unparsedReason: "shield lifecycle fragment (UNVERIFIED)" }) },
  { id: "batch-e5-32", re: /^附加额外伤害$|^附加等同于消除护盾(?:值)?(?:的伤害)?$/, go: () => ({ unparsedReason: "echo amount referent undefined (UNVERIFIED)" }) },

  { id: "batch-e5-33", re: /^惩罚$/, go: () => ({ unparsedReason: "punish — standalone keyword, mechanic undocumented (UNVERIFIED)" }) },
  { id: "batch-e5-34", re: new RegExp(`^将自身能力等级返回至上${NUM}回合结束时$`), go: () => ({ unparsedReason: "stage rewind — stage history not tracked (deferred)" }) },
  { id: "batch-e5-35", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)当回合使用的技能的PP值额外-${NUM}$`), go: (m) => reactWrap(3, { count: 1 }, `对手PP-${num(m[1])}`) },
  { id: "batch-e5-36", re: /^若(?:对手|对方|敌方)免疫固定伤害则转变为真实伤害$/, go: () => ({ attachDamage: { kindIfImmune: "true" } }) },
  { id: "batch-e5-37", re: /^先制攻击$/, go: () => ({ unparsedReason: "bare 先制攻击 — priority value unspecified (UNVERIFIED)" }) },
];
