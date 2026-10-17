// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, AILMENTS, frac } from "./lex.mjs";

export const rules = [
  // ── E5g 批 ──
  // payload/直连："受到自身防御、特防总和N%的固定伤害" → flatSelfDefSumPct
  { id: "batch-e5g-01", re: new RegExp(`^(?:受到)?(?:的)?自身防御、特防总和${NUM}%的?(?:固定)?伤害$|^(?:受到)?自身防御和特防总和${NUM}%的固定伤害$|^受到自身(?:防御|特防)总和${NUM}%的伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfDefSumPct: ns[0], target: "opponent" }] }; } },
  { id: "batch-e5g-02", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}次技能无效$|^(?:对手|对方|敌方)下${NUM}次(?:使用的)?技能无效果?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1] ?? m[2]) } }] }) },
  // "处在烧伤、中毒、冻伤状态时威力翻倍" → scaleIf foeStatused（对手处于异常——威力翻倍惯用宾语）
  // "对手处于烧伤状态下威力翻倍"（batch-e5g-03 的「处于」组没带词尾「下」）。放在 batch-e5g-03 前面。
  { id: "p1-e5g-01", re: new RegExp(`^(?:对手|对方|敌方)(?:处在|处于)(?:.+?)状态下(?:威力|伤害)?(?:翻倍|加倍|提升${NUM}倍|变为${NUM}倍)$`), go: (m) => ({ attachDamage: { scaleIf: { when: { foeStatused: true }, numerator: m[1] !== undefined ? num(m[1]) : 2, denominator: 1 } } }) },
  { id: "batch-e5g-03", re: new RegExp(`^(?:对手)?(?:处在|处于)(.+?)种?(?:异常)?状态时?(?:威力|伤害)?(?:翻倍|提升${NUM}倍|变为${NUM}倍)$`), go: (m) => { const list = m[1].split(/[、,，和或与]+/).filter(Boolean); const known = list.filter((x) => AILMENTS[x] !== undefined || x === "异常状态" || x === "异常"); if (known.length === 0 || !/异常|烧伤|冻伤|中毒/.test(m[1])) return { unparsedReason: `ailment-list cond unparsed: ${m[1]}` }; const mult = m[2] !== undefined ? num(m[2]) : 2; return { attachDamage: { scaleIf: { when: { foeStatused: true }, numerator: mult, denominator: 1 } } }; } },
  // "己方每有N只精灵存活则恢复M点体力" → heal flatPerAlive{per,add}
  { id: "batch-e5g-04", re: new RegExp(`^己方每有${NUM}只精灵存活则(?:恢复|回复)${NUM}点体力$|^每有${NUM}只精灵存活则恢复${NUM}点体力$|^己方每有${NUM}只存活精灵恢复${NUM}点体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", flatPerAlive: { per: ns[0], add: ns[1] }, target: "self" }] }; } },
  // "自身HP小于N/M威力翻倍" → scaleIf selfHpBelow
  { id: "batch-e5g-05", re: new RegExp(`^自身(?:HP|体力)(?:小于|低于|不足)${NUM}\\s*/\\s*${NUM}威力(?:翻倍|提升${NUM}倍|变为${NUM}倍)$|^自身体力小于${NUM}\\s*/\\s*${NUM}时威力翻倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const mult = ns.length >= 3 ? ns[2] : 2; return { attachDamage: { scaleIf: { when: { selfHpBelow: frac(ns[0], ns[1]) }, numerator: mult, denominator: 1 } } }; } },
  // "50%使自身速度提升2个等级" → 概率 stage（提升N个等级 变体）
  { id: "batch-e5g-06", re: new RegExp(`^(\\d+)%(?:的?(?:概|几)?率)?(?:使|令)?自身(${STAT_RE})提升${NUM}个等级$|^(\\d+)%(?:的?(?:概|几)?率)?自身(${STAT_RE})(?:等级)?提升${NUM}级$`), go: (m) => { const pct = num(m[1] ?? m[4]); const st = STATS[m[2] ?? m[5]] ?? "spd"; const v = num(m[3] ?? m[6]); return { effects: [{ op: "apply_stat_stage", stat: st, delta: v, target: "self", chance: pct }] }; } },
  // "使对手下回合受到伤害翻倍" → dmg_taken_up pct:200
  { id: "batch-e5g-07", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下回合受到(?:的)?伤害翻倍$|^(?:对手|对方|敌方)下回合受到(?:的)?伤害翻倍$|^(?:使|令)(?:对手|对方|敌方)受到(?:的)?伤害(?:翻倍|提升(\\d+)%|提高(\\d+)%)$`), go: (m) => { const pct = m[1] ?? m[2]; return { effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: 1, params: { pct: pct !== undefined ? num(pct) : 100 } }] }; } },
  // "持续N回合" 尾部时长 → attachAll turnsTail
  { id: "batch-e5g-08", re: new RegExp(`^持续${NUM}回合$|^效果持续${NUM}回合$|^(?:该|此)(?:护盾|护罩|效果|状态)(?:持续|可?持续?存?在?)${NUM}回合$`), go: (m) => ({ attachAll: { turnsTail: num(m[1] ?? m[2] ?? m[3]) } }) },
  // 裸 "作用N-M回合"/"作用N回合" 尾句（非首 part 的时长片段）→ attachAll turnsRangeTail/turnsTail
  { id: "batch-e5g-09", re: new RegExp(`^作用${NUM}\\s*[-~～—]\\s*${NUM}回合$|^作用${NUM}回合$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: ns.length === 2 ? { turnsRangeTail: { min: ns[0], max: ns[1] } } : { turnsTail: ns[0] } }; } },
  { id: "batch-e5g-10", re: /^致命$|^致命一击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  // "每次直接攻击必致命一击"——招式固有 crit（本招全击）
  { id: "batch-e5g-11", re: /^每次(?:直接攻击|直攻|直接攻|攻击)?必(?:定)?致命(?:一)?击$/, go: () => ({ attachDamage: { crit: true } }) },
  // "使自身接下来两次直接攻击必定致命一击" → crit_always count 窗口
  { id: "batch-e5g-12", re: new RegExp(`^(?:使)?自身(?:在)?接(?:下|下来|下来?的)(${NUM})(?:次|回合)?(?:内)?(?:每次)?(?:直接攻击|直攻|攻击)?必定致命(?:一)?击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: num(m[1]) } }] }) },
  // "致命几率提升"/"增加致命一击的概率"——未量化 → UNVERIFIED
  { id: "batch-e5g-13", re: /^(?:增加|提升)(?:致命|致命一击)的?(?:概率|几率)$|^致命(?:一击)?(?:概率|几率|率)提升$|^致命一击率提升$/, go: () => ({ unparsedReason: "crit-rate unquantified" }) },
  { id: "batch-e5g-14", re: new RegExp(`^每损失${NUM}%体力$`), go: () => ({ unparsedReason: "per-missing modifier without step tail (UNVERIFIED)" }) },
  // "每有N只精灵死亡则附加M点固定伤害" → flatPerDead（无主语=双方场下阵亡合计，who:"all"）
  { id: "batch-e5g-15", re: new RegExp(`^每有${NUM}只精灵死亡则附加${NUM}点固定伤害$`), go: (m) => ({ attachDamage: { flatPerDead: { who: "all", per: num(m[1]), add: num(m[2]) } } }) },
  { id: "batch-e5g-16", re: /^威力根据自身体力变化$|^威力随自身体力变化$/, go: () => ({ unparsedReason: "hp-scaled power — coefficient undocumented (UNVERIFIED)" }) },
];
