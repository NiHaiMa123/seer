// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STAT_RE, frac } from "./lex.mjs";
import { condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // "对手当回合使用的技能PP值额外-N" → trigger3 一次
  // ── E5f 批 ──
  { id: "batch-e5f-01", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)下回合所有技能先制([+\\-＋－])${NUM}$|^(?:对手|对方|敌方)下回合所有技能先制([+\\-＋－])${NUM}$`), go: (m) => { const s = m[1] ?? m[3]; const v = num(m[2] ?? m[4]); return { effects: [{ op: "apply_status", name: "prio_up", target: "opponent", turns: 1, params: { add: /[-－]/.test(s) ? -v : v } }] }; } },
  // "对手N回合内先制-K"——敌方先制降幅窗（turns:N）
  { id: "batch-e5f-02", re: new RegExp(`^(?:令|使|让)?(?:对手|对方|敌方)${NUM}回合内(?:所有)?(?:技能)?先制([+\\-＋－]?)${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const turns = num(ns[0]); const v = num(ns[ns.length - 1]); const neg = /[-－]/.test(ns[1] ?? "") || /先制-/.test(m[0]); return { effects: [{ op: "apply_status", name: "prio_up", target: "opponent", turns, params: { add: neg ? -v : v } }] }; } },
  { id: "batch-e5f-03", re: new RegExp(`^先制加${NUM}$|^先制\\+${NUM}$|^先制-${NUM}$`), go: (m) => { const v = num(m[1] ?? m[2] ?? m[3]); return { flags: { priority: /-/.test(m[0]) ? -v : v } }; } },
  // "攻击先制加1"（「加」= +）。放在 batch-e5f-04 前面，那条符号位只收 +/-。
  { id: "batch-e5f-04a", re: new RegExp(`^(?:所有|自身)?(?:攻击|攻击技能|技能|所有技能)先制(?:加|提升|提高|增加)([+-]?)${NUM}$`), go: (m) => { const v = num(m[2]); return { flags: { priority: m[1] === "-" ? -v : v } }; } },
  { id: "batch-e5f-04", re: new RegExp(`^(?:所有|自身)?(?:攻击|攻击技能|技能|所有技能)先制([+-]?)${NUM}$`), go: (m) => { const v = num(m[2]); return { flags: { priority: m[1] === "-" ? -v : v } }; } },
  { id: "batch-e5f-05", re: new RegExp(`^对方下${NUM}次攻击技能将${NUM}%被己方闪避$|^(?:对手|对方|敌方)下${NUM}次攻击${NUM}%被闪避$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "must_miss", target: "self", chance: ns[1] }] }; } },
  { id: "batch-e5f-06", re: /^使用技能不受PP值限制$|^不受PP值限制$|^技能不消耗PP$/, go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }) },
  { id: "batch-e5f-07", re: /^无视伤害限制效果$|^无视对手防御提升效果$/, go: (m) => /防御/.test(m[0]) ? ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) : ({ effects: [{ op: "apply_status", name: "pierce_limit", target: "self", turns: 1 }] }) },
  // "下N回合必定暴击"（TURNS_PRE 之后剩"必定暴击"已覆盖；此处防 `从下回合开始` 变体）
  { id: "batch-e5f-08", re: new RegExp(`^从下回合开始必定致命(\\d+|二|两|三|四|五|六|七|八|九|十)?击$|^从下回合开始必定暴击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", ...(m[1] !== undefined ? { params: { count: num(m[1]) } } : {}) }] }) },
  { id: "batch-e5f-09", re: new RegExp(`^回合(?:结束|开始)后?解除自身所有异常状态$|^回合结束时解除自身(?:的)?所有异常状态$`), go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 15 }, payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }] }] }) },
  // 自身消耗体力（"消耗自身当前最大体力的1/4"/"损失1/4的体力"→percent 自伤）
  { id: "batch-e5f-10", re: new RegExp(`^消耗自身当前最大体力的${NUM}\\s*/\\s*${NUM}$|^消耗自身${NUM}\\s*/\\s*${NUM}最大体力$|^损失${NUM}\\s*/\\s*${NUM}的?体力$|^损失${NUM}\\s*/\\s*${NUM}的?(?:HP|hp|Hp)$|^(?:自身|自己)?损失最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", power: 0, kind: "percent", frac: frac(ns[ns.length - 2], ns[ns.length - 1]), target: "self" }] }; } },
  // "对手使用攻击技能时受到自身防御、特防总和N%的固定伤害" → trigger3 cat4 + flatSelfDefSumPct payload
  { id: "batch-e5f-11", re: new RegExp(`^(?:对手|对方|敌方)使用攻击技能时受到自身防御、特防总和${NUM}%的固定伤害$|^(?:对手|对方|敌方)使用攻击技能时受到自身(?:防御|特防)(?:和|与)(?:特防|防御)总和${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 3, cat: 4 }, payload: [{ op: "damage", kind: "fixed", power: 0, flatSelfDefSumPct: ns[0], target: "opponent" }] }] }; } },
  // "自身被击败后下N只出场的精灵攻击+M" → trigger 5 + nextAlly stage（N>1 仅首只——多槽队列 UNVERIFIED 近似）
  { id: "batch-e5f-12", re: new RegExp(`^自身被击败后下${NUM}只出场的精灵(${STAT_RE})\\+${NUM}$|^自身被击败后下${NUM}只出场精灵(${STAT_RE})\\+${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const stat = ["atk", "def", "spa", "sdf", "spd", "acc"].includes(ns[1]) ? ns[1] : "atk"; return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 5 }, payload: [{ op: "apply_stat_stage", stat, delta: num(ns[2] ?? "1"), target: "nextAlly" }] }] }; } },
  // "若对手未受到固定伤害则额外附加N点真实伤害" → prevDamageNotKind cond + true damage
  { id: "batch-e5f-13", re: new RegExp(`^若(?:对手|对方|敌方)未受到固定伤害则(?:额外)?附加(\\d+)点真实伤害$|^若对手未受到固定伤害则?额外附加(\\d+)点(?:固定|真实)?伤害$`), go: (m) => ({ effects: [{ op: "damage", power: num(m[1] ?? m[2]), kind: "true", target: "opponent", if: { prevDamageNotKind: "fixed" } }] }) },
  // "威力低于N的攻击技能无效" → move_null powerBelow（"令对手使用的威力低于100的攻击技能无效"——前置条件在 condOf 处理）
  { id: "batch-e5f-14", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)使用的威力低于(\\d+)的攻击技能无效$|^威力低于(\\d+)的攻击技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 4, powerBelow: num(m[1] ?? m[2]) } }] }) },
  // "每次命中对手后此技能威力下降N点" → powerDropPerHit
  { id: "batch-e5f-15", re: new RegExp(`^每次命中(?:对手|对方|敌方)后此技能威力下降(\\d+)点$|^每次攻击后威力下降(\\d+)点$`), go: (m) => ({ attachDamage: { powerDropPerHit: num(m[1] ?? m[2]) } }) },
  // 孤儿条件/触发器/吞没残片
  { id: "batch-e5f-16", re: /^伤害大于(?:对方|对手|敌方)体力(?:时|则)?$/, go: () => ({ orphanCond: { prevDamageAboveFoeHp: true } }) },
  { id: "batch-e5f-17", re: /^(?:后)?若(?:对方|对手|敌方)没有将自己击败$/, go: () => ({ orphanCond: { not: { foeFainted: true } } }) },
  { id: "batch-e5f-18", re: /^(?:对方|对手|敌方)死亡$/, go: () => ({ orphanCond: { foeFainted: true } }) },
  { id: "batch-e5f-19", re: /^受到任何伤害(?:时|则)?$/, go: () => ({ dynTriggerPart: { trigger: 1 } }) },
  { id: "batch-e5f-20", re: /^(?:能力|技能)(?:提升|强化)效果$|^(?:攻击无效)?(?:效果)?延续至下回合$/, go: (m) => /延续/.test(m[0]) ? ({ attachAll: { extendTurns: 1 } }) : ({ ignored: true }) },
  // "攻击无效" 裸片段（"…攻击无效效果延续至下回合" 切分残留——主体 move_null 由前句携带）
  { id: "batch-e5f-21", re: /^攻击无效$|^攻击无效效果$/, go: () => ({ unparsedReason: "nullify tail fragment — host clause carries move_null" }) },
  // 天敌免疫（"若对手为自身天敌则免疫"——foeCountersUs 条件免疫窗）
  { id: "batch-e5f-22", re: /^若(?:对手|对方|敌方)为自身天敌则免疫$|^若自身为(?:对手|对方|敌方)天敌则免疫$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", if: { foeCountersUs: true } }] }) },
  // "附加恢复体力值等量的百分比伤害"（healEcho 百分比变体）
  { id: "batch-e5f-23", re: /^附加恢复(?:体力值|量)(?:等量)?的百分比伤害$/, go: () => ({ attachAll: { healEcho: true } }) },
  { id: "batch-e5f-24", re: /^若消除状态成功(?:则)?$|^若消除成功(?:则)?$/, go: () => ({ orphanCond: { prevApplied: true } }) },
  // "回合类效果被消除则X" → trigger 13
  { id: "batch-e5f-25", re: new RegExp(`^若自身回合类效果被消除则?(.+)$|^自身回合类效果被消除则(.+)$`), go: (m) => reactWrap(13, {}, m[1] ?? m[2]) },
  { id: "batch-e5f-26", re: /^若自身回合类效果被消除$/, go: () => ({ dynTriggerPart: { trigger: 13 } }) },
  // "对手下N回合造成的攻击伤害额外减少M%" → dmg_weaken 门控对手
  { id: "batch-e5f-27", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}回合造成的攻击伤害(?:额外)?(?:减少|降低)${NUM}%$|^(?:对手|对方|敌方)造成的攻击伤害(?:额外)?(?:减少|降低)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = ns[ns.length - 1]; return { effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", ...(ns.length > 1 ? { turns: ns[0] } : {}), params: { n: 100 - pct, d: 100 } }] }; } },
  // "使对手随机N项技能PP值归零" 概率前缀变体（"50%令对手随机2项技能PP值归零"）
  // "45%会令对手随机1项技能PP值归零"（batch-e5f-28 的动词表不含「会令」）。放在 batch-e5f-28 前面。
  { id: "p1-e5f-01", re: new RegExp(`^(\\d+)%(?:的?(?:概|几)?率)?会?(?:令|使|让)(?:对手|对方|敌方)随机${NUM}(?:项|个)?技能PP值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[2]), target: "opponent", chance: num(m[1]) }] }) },
  { id: "batch-e5f-28", re: new RegExp(`^(\\d+)%(?:的?(?:概|几)?率)?(?:令|使|让)?(?:对手|对方|敌方)?随机${NUM}(?:项|个)?技能PP值?归零$|^(\\d+)%(?:的?(?:概|几)?率)?(?:对手|对方|敌方)随机${NUM}项技能PP值?归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", zeroRandom: ns[1], target: "opponent", chance: ns[0] }] }; } },
  // "若使用属性技能则全属性-N" —— 主体缺失（多为对手使用属性技能的反弹），显式留档
  { id: "batch-e5f-29", re: /^若使用属性技能则全属性-\d+$/, go: () => ({ unparsedReason: "attr-move reflect-down — subject ambiguous (UNVERIFIED)" }) },
  { id: "batch-e5f-30", re: /^攻击无效$/, go: () => ({ unparsedReason: "bare 'attack nullified' — target/scope unclear (UNVERIFIED)" }) },
  // "若本回合攻击次数达到最大则必定秒杀" → koIfHitsMax（连击数达 hits.max 时末击置 KO）
  { id: "batch-e5f-31", re: new RegExp(`^若本回合攻击次数达到最大则必定秒杀(?:对手|对方|敌方)$`), go: () => ({ attachDamage: { koIfHitsMax: true } }) },
  { id: "batch-e5f-32", re: /^每日上限\d+$/, go: () => ({ ignored: true }) }, // 元数据限制，非战斗效果
  { id: "batch-e5f-33", re: new RegExp(`^若自身攻击(?:对手|对方|敌方)时克制关系为微弱则先制\\+${NUM}$`), go: () => ({ unparsedReason: "hit-effectiveness conditional prio — eff16 at declaration not resolvable (UNVERIFIED)" }) },
  { id: "batch-e5f-34", re: /^(?:对手|对方|敌方)免疫百分比伤害时额外附加\d+点真实伤害$/, go: () => ({ unparsedReason: "foe-immunity-conditional true damage — immunity query cond not modeled (UNVERIFIED)" }) },
];
