// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, AILMENTS, AIL_RE, frac, tgt } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText, parseBranchText, condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5b 批：随机吸强尾句/反馈孤儿/双防护盾固伤/致命率分数/抵挡N次 ──
  { id: "batch-e5b-01", re: new RegExp(`^每回合(?:开始时)?(?:使|令)?(?:对手|对方|敌方)${NUM}项能力(?:值|加强|等级)?-${NUM}并附加到自己身上$|^每回合(?:开始时)?使(?:对手|对方|敌方)${NUM}项能力值-${NUM}并附加到自身$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [liftTick({ op: "apply_status", name: "steal_rand_tick", target: "self", params: { count: ns[0], delta: Math.abs(ns[1]) } })] }; } },
  { id: "batch-e5b-02", re: /^反馈成功则(.+)$|^反馈成功[，,](.+)$/, go: (m) => { const sub = parseBranchText(m[1] ?? m[2]); if (sub.effects.length === 0) return { unparsedReason: `prevApplied payload unparsed: ${m[1] ?? m[2]}` }; return { effects: sub.effects.map((e) => ({ ...e, if: { prevApplied: true } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  // "N%令对手AIL则Y"——施加异常成功则续发（"50%令对手瘫痪则消除对手回合类效果"；prevApplied=前 op 成功守卫）
  { id: "batch-e5b-03", re: new RegExp(`^(?:${NUM}%(?:的?(?:概率|几率))?)?(?:使|令)(对手|对方|敌方|自身|自己)(${AIL_RE})(?:状态)?则(.+)$`), go: (m) => { const pct = m[1] !== undefined ? num(m[1]) : undefined; const tgt = /自身|自己/.test(m[2]) ? "self" : "opponent"; const ail = AILMENTS[m[3]]; const sub = parseEffectText(m[4]); if (sub.effects.length === 0 || ail === undefined) return { unparsedReason: `prevApplied payload unparsed: ${m[4]}` }; return { effects: [{ op: "apply_status", name: ail, target: tgt, ...(pct !== undefined ? { chance: pct } : {}) }, ...sub.effects.map((e) => ({ ...e, if: { prevApplied: true } }))], ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  { id: "batch-e5b-04", re: /^反馈失败则(.+)$/, go: (m) => { const sub = parseBranchText(m[1]); if (sub.effects.length === 0) return { unparsedReason: `prevFailed payload unparsed: ${m[1]}` }; return { effects: sub.effects.map((e) => ({ ...e, if: { not: { prevApplied: true } } })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  // 护罩值总和 N% 百分比伤害 → 被消护盾总值 ×pct 反噬（"消除护盾、护罩值总和80%的百分比伤害"——回挂本句 cleanse shield）
  { id: "batch-e5b-05", re: new RegExp(`^(?:护罩|护盾)值总和${NUM}%的(?:百分比|固定)?伤害$|^附加等同于?(?:护罩|护盾)值${NUM}%的伤害$|^附加等同于消除(?:护盾|护罩)[、,]?(?:护盾|护罩)?值总和${NUM}%的(?:百分比|固定)?伤害$`), go: (m) => ({ attachAll: { cleanseEchoPct: num(m.slice(1).find((x) => x !== undefined)) } }) },
  // 要害率分数变体（"击中对方要害几率增加1/2"/"致命几率加1/4"→crit_up frac）
  { id: "batch-e5b-06", re: new RegExp(`^(?:击中对方要害|致命一击|致命)?(?:一击)?(?:几率|概率|率)(?:增加|提升|加)${NUM}\\s*/\\s*${NUM}$|^(?:击中对方要害|打出致命一击)概率(?:增加|提升)${NUM}%$|^${NUM}\\s*/\\s*${NUM}致命$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return ns.length >= 2 && ns[1] !== 100 ? { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] } : { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: 100 } }] }; } },
  // 对对方造成伤害的 N/M 恢复自身体力 → drain_atk frac 窗口
  { id: "batch-e5b-07", re: new RegExp(`^(?:对(?:对方|对手|敌方)|对对手)造成伤害的${NUM}\\s*/\\s*${NUM}(?:都会)?恢复自身体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "batch-e5b-08", re: new RegExp(`^${NUM}回合内?每次攻击造成(?:的)?伤害的${NUM}%(?:都)?会?恢复自身体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", turns: num(m[1]), params: { n: num(m[2]), d: 100 } }] }) },
  { id: "batch-e5b-09", re: new RegExp(`^(?:自身|自己)恢复(\\d+)点体力值$|^恢复自身(\\d+)点体力值$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "self" }] }) },
  // 使用时自身体力低于阈值 → 回满（"使用时若自身体力低于1/2则恢复所有体力值"）
  { id: "batch-e5b-10", re: new RegExp(`^使用时?若自身(?:体力|HP)低于${NUM}\\s*/\\s*${NUM}则恢复(?:所有|全部|自身全部)体力值?$`), go: (m) => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", if: { selfHpBelow: frac(m[1], m[2]) } }] }) },
  { id: "batch-e5b-11", re: /^反弹所有异常$|^反弹全部异常$|^反弹一切异常$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  { id: "batch-e5b-12", re: new RegExp(`^完全抵挡${NUM}次攻击$|^抵挡${NUM}次(?:攻击)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  // "解除弱化状态"（batch-e5b-13 的签名只收裸「解除弱化」）。放在 batch-e5b-13 前面。
  { id: "p1-e5b-01", re: /^解除(?:自身|自己)?(?:的)?弱化(?:状态|效果)$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  { id: "batch-e5b-13", re: /^解除弱化$|^解除自身弱化$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // 每回合用招概率异常——无"时有"变体（"每回合使用技能60%令对手害怕"/"每回合使用技能则70%令对手害怕"）
  { id: "batch-e5b-14", re: new RegExp(`^每回合使用技能(?:则|时|后)?有?(\\d+)%(?:的?(?:概|几)?率)?令(?:对手|对方|敌方)(.+)$`), go: (m) => { const r = reactWrap(11, {}, `对手${m[2].trim()}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1]); return r; } },
  { id: "batch-e5b-15", re: new RegExp(`^下${NUM}次使用技能后令(?:对手|对方|敌方)(\\d+)%(?:的?(?:概|几)?率)?(.+)$`), go: (m) => { const r = reactWrap(11, {}, `对手${m[3].trim()}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[2]); if (r.effects?.[0]) r.effects[0].params = { ...r.effects[0].params, count: num(m[1]) }; return r; } },
  // "对手不为X系时强化效果翻倍"/条件翻倍 → cond mulIf（仅"伤害/威力翻倍"走伤害倍；"强化效果翻倍" 归 stageIf 系规则）
  { id: "batch-e5b-16", re: new RegExp(`^(?:若|当)?(.+?)时(?:造成的)?(?:攻击)?伤害翻倍$|^若(.+?)则(?:造成的)?伤害翻倍$|^若(.+?)时威力翻倍$`), go: (m) => { const cond = condOf(m[1] ?? m[2] ?? m[3]); return cond !== undefined ? { attachDamage: { mulIf: { when: cond, numerator: 2, denominator: 1 } } } : { unparsedReason: `mulIf cond unparsed: ${m[1] ?? m[2] ?? m[3]}` }; } },
  // 条件强化翻倍——通用 condOf 分派（覆盖"体力值低于N/M时强化效果翻倍"等长尾）→ stageIf
  // "对手烧伤强化效果翻倍"（batch-e5b-17 要求「…时强化效果翻倍」，这条省了「时」）。放在 batch-e5b-17 前面。
  { id: "p1-e5b-02", re: new RegExp(`^(?:若|当)?(?:对手|对方|敌方)(${AIL_RE})时?强化效果翻倍$`), go: (m) => ({ attachAll: { stageIf: { foeHas: AILMENTS[m[1]] } } }) },
  { id: "batch-e5b-17", re: /^(?:若|当)?(.+?)时强化效果翻倍$/, go: (m) => { const cond = condOf(m[1]); return cond !== undefined ? { attachAll: { stageIf: cond } } : { unparsedReason: `stageIf cond unparsed: ${m[1]}` }; } },
  { id: "batch-e5b-18", re: /^(?:附加时)?若自身不处于能力提升状态则固定伤害翻倍$/, go: () => ({ attachDamage: { mulIf: { when: { not: { selfStageUp: true } }, numerator: 2, denominator: 1 } } }) },
  { id: "batch-e5b-19", re: /^(?:若|当)?对手为自身天敌时?造成的伤害翻倍$/, go: () => ({ attachDamage: { mulIf: { when: { foeCountersUs: true }, numerator: 2, denominator: 1 } } }) },
  { id: "batch-e5b-20", re: /^(?:对手|对方|敌方)(?:为|不为).+系时.*$/, go: () => ({ unparsedReason: "type-membership cond — type predicate on move/units deferred (UNVERIFIED)" }) },
  { id: "batch-e5b-21", re: new RegExp(`^若当回合(?:对手|对方|敌方)不处于能力提升状态则自身造成的攻击伤害翻倍$|^若对手不处于能力提升状态则造成的伤害翻倍$|^对手不处于能力提升状态则伤害翻倍$`), go: () => ({ attachDamage: { mulIf: { when: { not: { foeStageUp: true } }, numerator: 2, denominator: 1 } } }) },
  { id: "batch-e5b-22", re: /^(?:对手|对方|敌方)所有能力(?:加强|强化|提升)状态消失$|^(?:使|令|将)(?:对手|对方|敌方)(?:所有)?能力(?:加强|强化|提升)状态消失$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "batch-e5b-23", re: new RegExp(`^自身${NUM}回合内?造成的伤害(?:提高|提升)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", turns: num(m[1]), params: { pct: num(m[2]) } }] }) },
  { id: "batch-e5b-24", re: /^(?:使|令)(?:对手|对方|敌方)下回合受到其他技能的伤害翻倍$/, go: () => ({ unparsedReason: "next-turn taken-damage ×2 window — dmgTakenMul timed deferred (UNVERIFIED)" }) },
  { id: "batch-e5b-25", re: /^\d+$/, go: () => ({ unparsedReason: "bare number fragment" }) },
];
