// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, ALL_STATS, AILMENTS, AIL_RE, frac, stageFx, tgt } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText, condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E6 批 ──
  // "给予对方损伤的N/M"——损伤分数残句（去向子句被切走/缺失），显式留档
  { id: "batch-e6-01", re: /^给予(?:对手|对方|敌方)损伤的?\d(?![\s\S]*[回恢][复血])/, go: () => ({ unparsedReason: "damage-share fragment — destination clause missing (UNVERIFIED)" }) },
  // "自身HP小于N/M时威力为K倍" → scaleIf
  { id: "batch-e6-02", re: new RegExp(`^自身(?:Hp|HP|体力|血量|生命值?)(?:小于|低于)${NUM}\\s*/\\s*${NUM}时?威力为${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { scaleIf: { when: { selfHpBelow: frac(ns[0], ns[1]) }, numerator: ns[2], denominator: 1 } } }; } },
  // "将下N次受到的伤害的M%反馈给对手" → reflect_dmg pct+count
  { id: "batch-e6-03", re: new RegExp(`^将下${NUM}次受到的伤害的${NUM}%反馈给(?:对手|对方|敌方)$|^下${NUM}次受到的伤害的${NUM}%反馈给(?:对手|对方|敌方)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[1], d: 100, count: ns[0] } }] }; } },
  // "自身所有攻击威力为两倍"/"使自身下N回合威力翻倍" → dmg_mul 窗口
  { id: "batch-e6-04", re: /^自身所有攻击威力为两倍$|^自身所有攻击伤害翻倍$|^自身所有攻击威力翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: 2 } }] }) },
  { id: "batch-e6-05", re: new RegExp(`^(?:使|令)?自身下?${NUM}回合(?:威力|伤害)翻倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", turns: num(m[1]), params: { mul: 2 } }] }) },
  // "有N%几率降低对方所有技能M点PP" → pp_delta all + chance
  { id: "batch-e6-06", re: new RegExp(`^(?:有)?${NUM}%(?:的?(?:几|概)?率)?(?:降低|减少)(?:对方|对手|敌方)所有技能${NUM}点PP(?:值)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", amount: -ns[1], target: "opponent", scope: "all", chance: ns[0] }] }; } },
  // "（使|令）对手所有PP降低N点"/"对手PP降低N点"——全技能扣 PP（无"所有"时按全体近似 UNVERIFIED）
  { id: "batch-e6-07", re: new RegExp(`^(${NUM})%的?(?:几率|概率)?(?:使|令)?(?:对手|对方|敌方)(?:所有|全部|所有技能|全部技能)?的?[pP][pP](?:值)?(?:降低|减少|扣除|损失)${NUM}点?$|^(?:使|令)(?:对手|对方|敌方)(?:所有|全部)?的?[pP][pP](?:值)?(?:降低|减少|扣除)${NUM}点?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const amt = ns[ns.length - 1]; return { effects: [{ op: "pp_delta", amount: -amt, target: "opponent", scope: "all", ...(ns.length > 1 ? { chance: ns[0] } : {}) }] }; } },
  // "对手每回合受到相当于本次伤害的N/M的固定伤害" → foe_dot + dynDealt 快照缩放
  { id: "batch-e6-08", re: new RegExp(`^(?:对手|对方|敌方)每回合受到相当于(?:本|此)次伤害的${NUM}\\s*/\\s*${NUM}的?固定伤害$|^每回合附加相当于本次伤害${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: ns.length > 1 ? { dynDealt: 1, dynMulN: ns[0], dynMulD: ns[1] } : { dynDealt: 1, dynMulN: ns[0], dynMulD: 100 } }] }; } },
  // "附加自身体力与速度总和N%的固定伤害" → flatSelfStatPct 多属性合计
  { id: "batch-e6-09", re: new RegExp(`^附加自身体力与速度总和${NUM}%的(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatSelfStatPct: { stats: ["hp", "spd"], pct: num(m[1]) } } }) },
  // "反转自身能力下降效果"（效果 变体）
  { id: "batch-e6-10", re: /^(?:反转|翻转)(?:自身|自己)(?:的)?能力下降(?:状态|效果)$/, go: () => ({ effects: [{ op: "invert_stages", target: "self" }] }) },
  // "使对手随机N个技能pp归零"（pp 小写/个 变体）
  { id: "batch-e6-11", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机${NUM}(?:个|项)技能的?[pP][pP](?:值)?归[零0]$|^(?:使|令)?(?:对手|对方|敌方)随机${NUM}个技能的?[pP][pP](?:值)?归[零0]$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "使对手的随机N项技能PP值变0"（变0=归零；概率前缀由外层吃掉）
  { id: "batch-e6-11b", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)的?随机${NUM}(?:项|个)技能PP值?变0$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // "回合结束后解除异常状态" → 自解异常 tick
  { id: "batch-e6-12", re: /^回合结束后解除(?:自身)?异常状态$|^回合结束时解除(?:自身)?异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 15 }, payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }] }] }) },
  // "血量低于N/M效果翻倍" → cond 效果翻倍（attachAll effectDouble + dynCond 由 part 通道注入）
  { id: "batch-e6-13", re: new RegExp(`^(?:血量|体力|HP|生命值?)低于${NUM}\\s*/\\s*${NUM}(?:时)?效果翻倍$`), go: (m) => ({ attachAll: { effectDouble: true, ...(m[1] !== undefined ? { effCond: { selfHpBelow: frac(num(m[1]), num(m[2])) } } : {}) } }) },
  // "P时[提升]效果翻倍"——通用条件倍增（"体力低于对手时提升效果翻倍"→effectDouble+effCond）
  { id: "batch-e6-14", re: /^(.{2,20}?)时(?:提升|提高|增加)?效果翻倍$/, go: (m) => { const cond = condOf(m[1].replace(/^(?:当|若)/, "").replace(/^处于/, "自身处于")); return cond !== undefined ? { attachAll: { effectDouble: true, effCond: cond } } : { unparsedReason: `effectDouble cond unparsed: ${m[1]}` }; } },
  // "反弹受到的所有异常状态"（受到的所有 变体）
  { id: "batch-e6-15", re: /^反弹所?受?到的?所有异常状态$|^反弹所有所?受?异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  // "N%令对方疲惫N回合无法攻击" → fatigue ailment
  { id: "batch-e6-16", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?令?(?:对手|对方|敌方)疲惫${NUM}回合无法攻击$|^令?(?:对手|对方|敌方)疲惫${NUM}回合$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: ns[ns.length - 1], ...(ns.length > 1 ? { chance: ns[0] } : {}) }] }; } },
  // "自身每处于N种能力提升状态则造成的伤害提升M%" → dmg_boost perStage
  { id: "batch-e6-17", re: new RegExp(`^自身每处于${NUM}种能力(?:提升|强化)状态则(?:造成的)?伤害提升${NUM}%$|^自身每处于${NUM}种能力提升状态附加${NUM}%的伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perStage: Math.floor(ns[ns.length - 1] / Math.max(1, ns[0])) } }] }; } },
  // "每消除N项则附加M点固定伤害" → flatPerRemoved（消除对象：对手强化）
  { id: "batch-e6-18", re: new RegExp(`^每消除${NUM}项(?:则|,|，)?附加${NUM}点(?:固定|固伤)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { flatPerRemoved: Math.floor(ns[ns.length - 1] / Math.max(1, ns[0])) } }; } },
  // "对手下N回合无法解除" → cleanse_lock 净化封锁窗口（挂在被锁方：其身上效果不可被解除）
  { id: "batch-e6-19", re: new RegExp(`^(?:对手|对方|敌方)下?${NUM}回合(?:内)?无法解除$|^无法解除$`), go: (m) => ({ effects: [{ op: "apply_status", name: "cleanse_lock", target: "opponent", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }) },
  // "自身受到的伤害减少N点"（自身 前缀变体）
  { id: "batch-e6-20", re: new RegExp(`^自身受到的伤害减少${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // "N%的几率造成的攻击伤害提升M%" → dmg_boost pct+chance
  { id: "batch-e6-21", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?(?:使)?(?:自身)?造成的?(?:攻击)?伤害提升${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: ns[ns.length - 1] }, ...(ns.length > 1 ? { chance: ns[0] } : {}) }] }; } },
  // "下N次受到的攻击伤害额外减少M%" → dmg_taken_down count+pct（"收到的"为语料错字变体）
  { id: "batch-e6-22", re: new RegExp(`^(?:自身|自己)?下${NUM}次[受收]到的(?:攻击)?伤害(?:额外)?减少${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: ns[ns.length - 1], count: ns[0] } }] }; } },
  // "下N次受到的攻击伤害减少M点" → dmg_reduce count+flat（次数制定额承伤减免）
  { id: "batch-e6-23", re: new RegExp(`^(?:自身|自己)?下${NUM}次[受收]到的(?:攻击)?伤害减少${NUM}点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { count: ns[0], flat: ns[ns.length - 1] } }] }; } },
  // "减少N点攻击伤害"（承伤定额减免，省受事主语）/"有N%几率减少M点攻击伤害"（+chance）
  { id: "batch-e6-24", re: new RegExp(`^(?:有)?${NUM}%(?:的?(?:几|概)?率)?减少${NUM}点(?:攻击)?伤害$|^减少${NUM}点(?:攻击)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) ? ns[0] : undefined; return { effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", ...(pct !== undefined ? { chance: pct } : {}), params: { flat: ns[ns.length - 1] } }] }; } },
  // "对手N回合内受到的攻击伤害提升M%" → dmg_taken_up 对手定向计时窗
  { id: "batch-e6-25", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)${NUM}回合内?受到的(?:攻击)?伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: ns[0], params: { pct: ns[ns.length - 1] } }] }; } },
  // "造成的攻击伤害减少N%" → dmg_weaken（出伤削弱；裸句省主语按语料语境=对手出伤被削，自身定向显式标注）
  { id: "batch-e6-26", re: new RegExp(`^(?:使|令|让)?(对手|对方|敌方|自身|自己|双方)?造成的(?:攻击)?伤害(?:减少|降低|削减)${NUM}%$`), go: (m) => { const who = /自身|自己/.test(m[1] ?? "") ? "self" : "opponent"; const mk = (t) => ({ op: "apply_status", name: "dmg_weaken", target: t, params: { n: 100 - num(m[2]), d: 100 } }); return { effects: m[1] === "双方" ? [mk("self"), mk("opponent")] : [mk(who)] }; } },
  // "无视对手的攻击伤害减少类效果" → pierce_limit（无视守方减伤）
  { id: "batch-e6-27", re: /^(?:自身|自己)?无视(?:对手|对方|敌方)(?:的)?(?:攻击)?伤害减少(?:类)?效果$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_limit", target: "self" }] }) },
  // "将对方体力减到和自己相同" → matchSelfHp
  { id: "batch-e6-28", re: /^(?:将|使|令)(?:对手|对方|敌方)(?:的)?体力减到和(?:自己|自身)相同$|^把对方体力减到与自身相同$|^(?:将|使|令)(?:对手|对方|敌方)(?:的)?体力变(?:成|为)和(?:自己|自身)(?:的体力)?(?:相同|一致)(?:的体力)?$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, matchSelfHp: true, target: "opponent" }] }) },
  // "N回合内免疫能力下降状态" → immune_degrade（turns 由 TURNS_PRE 注入）
  { id: "batch-e6-29", re: /^(?:自身|自己)?免疫能力下降(?:状态)?$|^免疫能力下降$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "附加自身防御和特防能力提升总段数xN的固定伤害" → flatPerStage levels 限 def+sdf
  { id: "batch-e6-30", re: new RegExp(`^附加自身防御和特防能力(?:提升|强化)?总段数[×xX]?${NUM}的(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", mode: "levels", stats: ["def", "sdf"], flat: num(m[1]), per: 1 } } }) },
  // "附加自身防御和特防能力总和N%的固定伤害" → flatSelfDefSumPct
  { id: "batch-e6-31", re: new RegExp(`^附加自身防御和特防能力(?:值)?总和${NUM}%的?(?:固定|固伤)?伤害$|^附加自身双防(?:能力)?总和${NUM}%的?(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatSelfDefSumPct: num(m[1] ?? m[2]) } }) },
  // "之后每次叠加N%（，最高M%）" → dmg_boost 逐击累加窗（growStep/growCap——growAcc 运行时累积）
  { id: "batch-e6-32", re: new RegExp(`^(?:之后|此后|以后)?每次叠加${NUM}%(?:[，,]?最高(?:为|至|到)?${NUM}%)?$|^叠加${NUM}%(?:[，,]?最高${NUM}%)?$|^伤害每次叠加${NUM}%`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { growStep: ns[0], ...(ns[1] !== undefined ? { growCap: ns[1] } : {}) } }] }; } },
  // "每使用N次攻击技能则本次战斗中造成的伤害提升M%（，最高K%）" → dmg_boost growPer 步进窗
  { id: "batch-e6-33", re: new RegExp(`^(?:自身)?每使用${NUM}次攻击技能则本次战斗中造成的?(?:攻击)?伤害(?:提升|提高)${NUM}%(?:[，,]?最高(?:提升|提高|为|至|到)?${NUM}%)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { growStep: ns[1], growPer: ns[0], ...(ns[2] !== undefined ? { growCap: ns[2] } : {}) } }] }; } },
  // "本次战斗中造成的伤害提升N%（，最高K%）" → dmg_boost 逐击成长（触发层带 growPer）
  { id: "batch-e6-34", re: new RegExp(`^本次战斗中造成的?(?:攻击)?伤害(?:提升|提高|增加)${NUM}%(?:[，,]?最高(?:提升|提高|为|至|到|可达)?${NUM}%)?$|^造成的?(?:攻击)?伤害每次(?:使用|攻击)(?:提升|提高|增加)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { growStep: ns[0], ...(ns[1] !== undefined ? { growCap: ns[1] } : {}) } }] }; } },
  // "给予对方损伤的N/M(会回复自己体力)" → drain n/d（裸句同义——打出即吸血）
  { id: "batch-e6-35", re: new RegExp(`^给予(?:对方|对手|敌方|对象)损伤的${NUM}\\s*/\\s*${NUM}(?:会)?(?:回复|恢复)?(?:自己|自身)?(?:的)?(?:体力|HP)?$|^给予(?:对方|对手|对象)损伤一半$|^给[予与]损伤的一半恢复(?:自己|自身)?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: ns.length >= 2 ? { numerator: ns[0], denominator: ns[1] } : { numerator: 1, denominator: 2 } } }; } },
  // "附加已损伤体力的N%固定伤害" → 对手已损失体力×pct（"损伤体力"惯例指目标损失量）
  { id: "batch-e6-36", re: new RegExp(`^附加(?:已|对手已)(?:损伤|损失)体力的${NUM}%(?:的)?固定伤害$|^附加对手已损失体力${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && num(x) === num(x)).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[ns.length - 1], denominator: 100, base: "missing" } } }; } },
  // "下N回合使对手随机进入A、B、C中的M种异常状态" → ailment_tick 载体 + payload random 池（turns 由 TURNS 前缀注入）
  // "使对手随机进入[A或B、C中的]N种异常状态"（带显式列表；裸"随机进入N种"由既有规则覆盖）→ 即时 random；下N回合形态由 ctxTurns 重写为 ailment_tick
  // "每处于N种能力提升状态则恢复M点体力"——stage 种类计数回复（heal flatPerStage）
  { id: "batch-e6-37", re: new RegExp(`^(?:自身|自己)?每处于${NUM}种(?:能力)?(?:提升|增强|上升|强化)状态则?恢复${NUM}点(?:体力|HP|生命值?)?$|^每有${NUM}种(?:能力)?提升状态恢复${NUM}点(?:体力)?$`), go: (m) => ({ effects: [{ op: "heal", flatPerStage: { who: "self", sign: "up", per: num(m[1] ?? m[3]), flat: num(m[2] ?? m[4]) }, target: "self" }] }) },
  // "打出致命一击的几率提升N%"——暴击率常驻提升（crit_up 面板窗）
  { id: "batch-e6-38", re: new RegExp(`^(?:(?:攻击|攻击技能)?(?:打出|造成|产生)?)?致命[一1]?击的?(?:概率|几率|率)(?:提升|提高|增加)${NUM}%$|^暴击率(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // "首次攻击必定打出致命一击" → crit 窗（soulmark 侧折算 crit_always count:1 单次）
  { id: "batch-e6-39", re: /^(?:自身|自己)?的?首次(?:攻击|出手|使用技能)(?:时|后)?(?:必定)?打出?致命[一1]?击$|^首次(?:攻击|出手)(?:必定)?致命[一1]?击$/, go: () => ({ attachDamage: { crit: true } }) },
  { id: "batch-e6-40", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)?随机(?:进入|陷入)((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))*)中的${NUM}种异常(?:状态)?$|^(?:使|令)(?:对手|对方|敌方)随机(?:进入|陷入)((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))*)异常状态$`), go: (m) => { const listRaw = m[1] ?? m[3]; const list = listRaw.split(/[、,，或和]/).map((x) => AILMENTS[x]).filter(Boolean); if (list.length === 0) return { unparsedReason: `ailment pool unparsed: ${listRaw}` }; const count = m[2] !== undefined ? num(m[2]) : 1; return { effects: [{ op: "apply_status", name: "random", random: { list: [...new Set(list)], count }, target: "opponent" }] }; } },
  // "随机进入N种控制类/弱化类异常状态"——子集分类未文档化 → UNVERIFIED
  { id: "batch-e6-41", re: /随机(?:进入|附加)(\d*|一|两|二|三|四|五|六|七|八|九|十)种?(控制|弱化)类异常/, go: (m) => ({ unparsedReason: m[2] === "控制" ? "control/weaken-class ailment subset undocumented (UNVERIFIED)" : "weaken-class ailment subset undocumented (UNVERIFIED)" }) },
  // "使对手随即进入1种异常状态"（OCR"随即"=随机）。放在 batch-e6-42 前面，那条动词只收「随机」。
  { id: "batch-e6-42a", re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:使|令)?(?:对手|对方|敌方)?随即进入${NUM}种(?:异常|异常状态)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; const cnt = pct !== undefined ? ns[1] : ns[0]; return { effects: [{ op: "apply_status", name: "random", random: { list: Object.values(AILMENTS), count: cnt }, target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // "N%对手随机进入一种异常"（裸概率 + 一种/无"状态"尾）；无概率形态同收（count 前置 NUM 即种数）
  { id: "batch-e6-42", re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:使|令)?(?:对手|对方|敌方)?随机进入${NUM}种(?:异常|异常状态)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; const cnt = pct !== undefined ? ns[1] : ns[0]; return { effects: [{ op: "apply_status", name: "random", random: { list: Object.values(AILMENTS), count: cnt }, target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // "随机附加N种异常状态"（附加动词变体，同 random 池）
  { id: "batch-e6-43", re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:使|令|为|给)?(?:对手|对方|敌方)?随机附加${NUM}种(?:异常|异常状态)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; const cnt = pct !== undefined ? ns[1] : ns[0]; return { effects: [{ op: "apply_status", name: "random", random: { list: Object.values(AILMENTS), count: cnt }, target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // "随机附加A、B、C中的N种异常状态"（枚举池 + 附加动词）
  { id: "batch-e6-44", re: new RegExp(`^(?:使|令|为|给)?(?:对手|对方|敌方)?随机附加((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))*)中的${NUM}?种(?:异常|异常状态)$`), go: (m) => { const list = m[1].split(/[、,，或和]/).map((x) => AILMENTS[x]).filter(Boolean); if (list.length === 0) return { unparsedReason: `ailment pool unparsed: ${m[1]}` }; return { effects: [{ op: "apply_status", name: "random", random: { list: [...new Set(list)], count: num(m[2] ?? "1") }, target: "opponent" }] }; } },
  // "进入A、B、C之N种异常中的M种"（枚举池后置计数变体——"令对手进入害怕、麻痹、疲惫3种异常中的1种"）
  { id: "batch-e6-45", re: new RegExp(`^(?:使|令|为|给)?(?:对手|对方|敌方)?(?:随机)?进入((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))+)(?:${NUM}种)?异常(?:状态)?中的${NUM}种(?:异常)?(?:状态)?$`), go: (m) => { const list = m[1].split(/[、,，或和]/).map((x) => AILMENTS[x]).filter(Boolean); if (list.length === 0) return { unparsedReason: `ailment pool unparsed: ${m[1]}` }; const ns = m.slice(2).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "random", random: { list: [...new Set(list)], count: ns[ns.length - 1] ?? 1 }, target: "opponent" }] }; } },
  // "随机附加N种能力下降状态M级"（随机弱化段数）
  { id: "batch-e6-46", re: new RegExp(`^(?:使|令|为|给)?(?:对手|对方|敌方)?随机附加${NUM}种能力(?:下降|弱化)(?:状态)?(${NUM})级$|^随机${NUM}项能力(?:下降|弱化)${NUM}级?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: ns[0], delta: -Math.abs(ns[1] ?? 1), target: "opponent" }] }; } },
  // "随机附加N种异常状态与N种能力下降状态M级"（与连复合：异常池 + 随机弱化）
  { id: "batch-e6-47", re: new RegExp(`^(?:使|令|为|给)?(?:对手|对方|敌方)?随机附加${NUM}种(?:异常|异常状态)(?:和|与|、)${NUM}种能力(?:下降|弱化)(?:状态)?(${NUM})级?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "random", random: { list: Object.values(AILMENTS), count: ns[0] }, target: "opponent" }, { op: "apply_stat_stage", stat: "random", randomCount: ns[1], delta: -Math.abs(ns[2] ?? 1), target: "opponent" }] }; } },
  // "随机进入N-M种异常状态"——抽数区间（countRange 先抽数量）
  { id: "batch-e6-48", re: new RegExp(`^${NUM}%?(?:的?(?:几|概)?率)?(?:使|令)?(?:对手|对方|敌方)?随机进入${NUM}[-~—至到]${NUM}种(?:异常|异常状态)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 2 ? ns[0] : undefined; const [lo, hi] = pct !== undefined ? [ns[1], ns[2]] : [ns[0], ns[1]]; return { effects: [{ op: "apply_status", name: "random", random: { list: Object.values(AILMENTS), count: lo, countRange: { min: lo, max: hi } }, target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // "每损失N点/每损失N%体力则额外附加M点固定伤害" → flatPerMissing step/add
  { id: "batch-e6-49", re: new RegExp(`^每损失${NUM}点体力则?额外附加${NUM}点固定伤害$|^每损失${NUM}%体力(?:则)?附加${NUM}点固定伤害$|^自身每损失${NUM}%体力附加${NUM}点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const isPct = /%/.test(m[0]); return { attachDamage: isPct ? { flatPerMissing: { step: ns[0], add: ns[1], pct: true } } : { flatPerMissing: { step: ns[0], add: ns[1] } } }; } },
  // "秒杀则令对手全属性-N" → 当次 KO 条件（foeFainted）下对手全属性 -N
  { id: "batch-e6-50", re: new RegExp(`^(?:秒杀|击败对手|击杀对手)(?:则)?(?:令|使|让)对手全属性([+-])${NUM}$`), go: (m) => { const d = (m[1] === "-" ? -1 : 1) * num(m[2]); return { effects: ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: d, target: "opponent", if: { foeFainted: true } })) }; } },
  // "使对手受到等量百分比伤害" → healEcho 百分比（额值=回复量，kind=percent）
  { id: "batch-e6-51", re: /^使(?:对手|对方|敌方)受到等量(?:的)?百分比伤害$|^受到等量百分比伤害$/, go: () => ({ attachAll: { healEcho: true } }) },
  // "自身每有N项技能PP值不为满则连击次数+M" → hitsPerPpGap
  { id: "batch-e6-52", re: new RegExp(`^自身每有${NUM}项技能PP值?不为?满则连击次数\\+${NUM}$|^自身每有${NUM}项技能PP不为满连击\\+${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { hitsPerPpGap: { per: ns[0], add: ns[1] } } }; } },
  // "吸取效果转变为附加翻倍吸取量的百分比伤害"——drain→echo 形态转换，语义不唯一 → UNVERIFIED
  { id: "batch-e6-53", re: /吸取效果转变为|吸取量.*百分比伤害/, go: () => ({ unparsedReason: "drain→echo conversion — transformation semantics undocumented (UNVERIFIED)" }) },
  // "牺牲自身全部体力" → selfHp 自杀
  { id: "batch-e6-54", re: /^牺牲自身全部体力$|^牺牲(?:自身|自己)(?:所有|全部)(?:体力|HP|生命)$|^消耗(?:自身|自己)(?:所有|全部)(?:体力|HP|生命)$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "self", selfHp: true }] }) },
  // "附加自身最大体力的真实伤害"（kind:true + flatSelfPct:100）
  { id: "batch-e6-55", re: /^附加自身(?:当前)?最大体力的(?:真实|固定|百分比)?伤害$|^附加自身最大体力(?:等值)?的?伤害$/, go: () => ({ effects: [{ op: "damage", power: 0, kind: "true", flatSelfPct: 100, target: "opponent" }] }) },
  // "消耗自身全部体力并附加自身最大体力的真实伤害"（自杀+真伤组合——并附 不切分保护位）
  { id: "batch-e6-56", re: /^消耗(?:自身|自己)(?:所有|全部)(?:体力|HP|生命)并附加自身(?:当前)?最大体力的(?:真实|固定|百分比)?伤害$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "self", selfHp: true }, { op: "damage", power: 0, kind: "true", flatSelfPct: 100, target: "opponent" }] }) },
  // "恢复自身全部体力并附加恢复量的百分比伤害"（heal 1/1 + healEcho 组合）
  { id: "batch-e6-57", re: /^恢复(?:自身|自己)?(?:所有|全部)(?:体力|HP|生命)并附加恢复量(?:等量)?的(?:百分比|固定)?伤害$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }], attachAll: { healEcho: true } }) },
  // "恢复自身最大体力的N/M并附加恢复量的百分比伤害"（heal frac + healEcho 组合）
  { id: "batch-e6-58", re: new RegExp(`^恢复(?:自身|自己)?最大(?:体力|HP)(?:的)?${NUM}\\s*/\\s*${NUM}并附加(?:等同于)?恢复量(?:等量)?的(?:百分比|固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }], attachAll: { healEcho: true } }; } },
  // "种下X"（"种下希望之花"——具名印记，回合成长属印记自身语义）
  { id: "batch-e6-59", re: /^(?:自身|自己)?种下([\p{Script=Han}]{2,8})$/u, go: (m) => { const mk = m[1]; if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|免疫|种子/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, target: "self" }] }; } },
  // "被附加N回合X"（被动语态 apply_mark turns——宿主目标按 self 处理，上场者语境由外层守卫决定）
  { id: "batch-e6-60", re: new RegExp(`^(?:被|受)?附加${NUM}回合([\\p{Script=Han}]{2,8})(?:状态)?$`, "u"), go: (m) => { const mk = m[2]; if (/护盾|护罩|异常|伤害|体力|回合|效果|固定|真实|百分比|免疫/.test(mk)) return undefined; if (/异常|状态/.test(mk)) return { effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }; return { effects: [{ op: "apply_mark", mark: mk, turns: num(m[1]), target: "self" }] }; } },
  // "为对手附加A、B"（动词+AIL 枚举→逐项 apply_status）
  { id: "batch-e6-61", re: new RegExp(`^(?:为|令|使|给)(?:对手|对方|敌方)(?:附加|施加)((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))+)(?:状态)?$`), go: (m) => { const list = m[1].split(/[、,，或和]/).map((x) => AILMENTS[x]).filter(Boolean); return { effects: list.map((a) => ({ op: "apply_status", name: a, target: "opponent" })) }; } },
  // "令对手进入A、B"（进入/陷入+AIL 枚举，并列施加——同 stat 枚举语义）
  { id: "batch-e6-62", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:进入|陷入)((?:${AIL_RE})(?:[、,，或和](?:${AIL_RE}))+)(?:状态)?$`), go: (m) => { const list = m[1].split(/[、,，或和]/).map((x) => AILMENTS[x]).filter(Boolean); if (list.length < 2) return undefined; return { effects: list.map((a) => ({ op: "apply_status", name: a, target: "opponent" })) }; } },
  // "对手下N回合技能失效"（失效 变体——全类别）
  { id: "batch-e6-63", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}回合技能失效$|^令对手下${NUM}回合技能失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: num(m[1] ?? m[2]) }] }) },
  // "解除双方所处的异常状态" → 双侧 ailment 净化
  { id: "batch-e6-64", re: /^解除双方所处的异常状态$|^解除(?:敌我)?双方异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }, { op: "cleanse", target: "opponent", scope: "ailment" }] }) },
  // "对方体力高于自己时才能命中" → hitIf 门控
  { id: "batch-e6-65", re: /^(?:对手|对方|敌方)体力高于(?:自己|自身)时?才能命中$/, go: () => ({ flags: { hitIf: { when: { foeHpAboveSelf: true } } } }) },
  // "的攻击必定致命一击"（跨切残留——turns 由 TURNS 前缀注入）
  { id: "batch-e6-66", re: /^(?:的)?攻击?必?定?(?:打出)?致命[一#]?击$/u, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  // "致命+N"：致命等级（虚拟 stage 轴——记录段位；每段→命中率换算未文档化，暂不消费）
  { id: "batch-e6-67", re: new RegExp(`^致命\\+${NUM}$|^致命(?:一击)?等级\\+${NUM}$|^致命等级提升${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "crt", delta: num(m[1] ?? m[2] ?? m[3]), target: "self" }] }) },
  // "额外附加N点真实伤害"/"则转变为真实伤害"
  { id: "batch-e6-68", re: new RegExp(`^(?:额外)?附加${NUM}点真实伤害$`), go: (m) => ({ effects: [{ op: "damage", power: num(m[1]), kind: "true", target: "opponent" }] }) },
  { id: "batch-e6-69", re: /^(?:若对手免疫固定伤害|对手免疫固定伤害)(?:则)?转变为真实伤害$/, go: () => ({ attachDamage: { kindIfImmune: "true" } }) },
  // 通用攻击免疫窗："N%的几率免疫（本回合）受到的攻击伤害"——dmg_immune（本回合→turns:1）
  { id: "batch-e6-70", re: new RegExp(`^(${NUM})%的?(?:几率|概率)?免疫(本回合|当回合)?(?:受到的?|所受的?)?(?:攻击|攻击伤害|伤害)$|^免疫(本回合|当回合)(?:受到的?|所受的?)?(?:攻击|攻击伤害|伤害)$`), go: (m) => { const turn = m[2] ?? m[3]; return { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", ...(turn !== undefined ? { turns: 1 } : {}), ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }; } },
  { id: "batch-e6-71", re: /^免疫(?:受到的?|所受的?)(?:攻击|攻击伤害|伤害)$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  { id: "batch-e6-72", re: /^免疫(?:受到的?|所受的?)(?:异常|异常状态)$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // 固伤免疫窗口："己方1回合内免疫固定伤害、百分比伤害"（、拆分后逐段命中同一 flag；支持 主语+N回合内 内嵌）
  { id: "batch-e6-73", re: new RegExp(`^(?:使|令)?(自身|自己|己方|本方|对手|对方|敌方)(?:精灵)?(${NUM})?回合内?免疫(?:固定|固伤)(?:伤害|和|、|与)?(?:百分比伤害)?$|^免疫(?:固定|固伤|百分比)(?:伤害|和|、|与)?(?:固定|固伤|百分比)?伤害$|^免疫(?:固伤|固定伤害|百分比伤害)$|^(?:开始)?免疫(?:百分比|固定|固伤)伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "flat_immune", target: /对手|对方|敌方/.test(m[1] ?? "") ? "opponent" : "self", ...(m[2] !== undefined ? { turns: num(m[2]) } : {}) }] }) },
  // "附加给对手300点固定伤害"（给-infix 固伤）/"附加给对手自身最大体力30%的百分比伤害"
  { id: "batch-e6-74", re: new RegExp(`^附加给(?:对手|对方|敌方)(?:自身)?最大体力${NUM}%的?(?:百分比)?伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), "100"), target: "opponent" }] }) },
  { id: "batch-e6-75", re: new RegExp(`^附加给(?:对手|对方|敌方)${NUM}点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // 免疫固伤转定量真伤："对手免疫百分比伤害时转变为250点真实伤害" → kindConv 回挂同型 damage op
  { id: "batch-e6-76", re: new RegExp(`^(?:若)?(?:对手|对方|敌方)?免疫(固定|百分比)伤害(?:时|则)?转变为${NUM}点真实伤害$`), go: (m) => ({ attachAll: { kindConv: { from: m[1] === "百分比" ? "percent" : "fixed", flat: num(m[2]) } } }) },
  // 伤害类型枚举碎片（"免疫固定伤害、百分比伤害" 顿号拆分残段——免疫语义已由首段 flat_immune 覆盖）
  { id: "batch-e6-77", re: /^(?:固定|固伤|百分比|真实)伤害$/, go: () => ({ ignored: true }) },
  // 控制类异常反弹 → reflect_ctl（控制类子集=blockChance>0 硬控，apply-effect 按该谓词过滤）
  { id: "batch-e6-78", re: /^反弹.*控制类异常/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_ctl", target: "self" }] }) },
  // "先制攻击" 裸句（无数字——先制+1 惯例默认）
  { id: "batch-e6-79", re: /^先制攻击$|^先制(?:攻击)?出手$/, go: () => ({ flags: { priority: 1 } }) },
  // "附加额外伤害，自身等级越高附加伤害越高"——等级缩放固伤公式未文档化 → UNVERIFIED
  { id: "batch-e6-80", re: /等级越高.*伤害越高|附加额外伤害/, go: () => ({ unparsedReason: "level-scaled flat damage formula undocumented (UNVERIFIED)" }) },
  // "翻倍几率额外提升N%且伤害提升变为M倍"——失败升级状态机 → UNVERIFIED
  { id: "batch-e6-81", re: /翻倍几率额外提升|伤害提升变为/, go: () => ({ unparsedReason: "escalating multiplier-on-miss state machine (UNVERIFIED)" }) },
  // "对手的状态变化会同时作用在自己身上"→mirror_stages（e35-07 发射——本条仅作回归守卫注释）
  // 残缺片段显式留档
  { id: "batch-e6-83", re: /^(?:对手|对方|敌方)的状态变化会$|^造成的伤害提升$|^几率提升至$|^属性攻击$/, go: () => ({ unparsedReason: "truncated source fragment (UNVERIFIED)" }) },
  { id: "batch-e6-84", re: /^作用在(?:自己|自身)身上$/, go: () => ({ unparsedReason: "foe stage-mirror mechanic not modeled (UNVERIFIED)" }) },
  { id: "batch-e6-85", re: /重复使用无法叠加|无法叠加$/, go: () => ({ ignored: true }) },
  // 回合制固伤窗（"下N回合每回合造成M点固定伤害"→dot_field flat 对手侧）
  { id: "batch-e6-86", re: new RegExp(`^下${NUM}回合每回合造成${NUM}点(?:固定)?伤害$|^${NUM}回合内?每回合造成${NUM}点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dot_field", target: "opponent", turns: ns[0], params: { flat: ns[1] } }] }; } },
  // "附加自身当前护盾值等量的固定伤害"（consumeShield——护盾吸收量转固伤）
  { id: "batch-e6-87", re: /^附加自身当前护盾值等量的固定伤害$|^附加自身护盾值等量的伤害$/, go: () => ({ attachDamage: { consumeShield: true } }) },
  // 回合制免伤（"可以抵挡N回合内对手的攻击伤害"→dmg_immune turns）
  { id: "batch-e6-88", re: new RegExp(`^可以抵挡${NUM}回合内?(?:对手|对方|敌方)的攻击伤害$|^抵挡${NUM}回合内?对手的攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: num(m[1] ?? m[2]) }] }) },
  // 冰系威力（"冰系技能威力为N倍"——本招即冰系，无条件倍率）
  { id: "batch-e6-89", re: new RegExp(`^(?:${STAT_RE}|冰|火|水|草|电|机械|地面|飞行|超能|普通|战斗|暗影|光|次元|邪灵|自然|王|神灵|混沌|圣灵|远古|虫|龙)系(?:技能)?威力(?:为)?${NUM}倍$`), go: (m) => ({ attachDamage: { mul: { numerator: num(m[1]), denominator: 1 } } }) },
  // 速度分数固伤（"N%几率附加速度的M/K伤害"→flatSelfSpdFrac + flatChance）
  { id: "batch-e6-90", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?(?:附加|额外附加)速度的${NUM}\\s*/\\s*${NUM}(?:的)?伤害$|^附加速度的${NUM}\\s*/\\s*${NUM}(?:的)?伤害$|^${NUM}%(?:的?(?:几|概)?率)?附加速度的${NUM}%的?伤害$`), go: (m) => {
    // a：几率+分数 b：纯分数 c：几率+百分数
    const chance = num(m[1] ?? m[6]);
    const fr = m[6] !== undefined ? { numerator: num(m[7]), denominator: 100 } : m[4] !== undefined ? { numerator: num(m[4]), denominator: num(m[5]) } : { numerator: num(m[2]), denominator: num(m[3]) };
    return { attachDamage: { flatSelfSpdFrac: fr, ...(m[1] !== undefined || m[6] !== undefined ? { flatChance: chance } : {}) } };
  } },
  // 削上限定额（"降低对方N点战斗时最高HP"→max_hp_down flat）
  { id: "batch-e6-91", re: new RegExp(`^降低(?:对方|对手|敌方)${NUM}点战斗时最高HP$|^(?:降低|减少)(?:对手|对方|敌方)最高HP${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 次数免伤（"可以完全抵挡N次攻击"→dmg_immune count）
  { id: "batch-e6-92", re: new RegExp(`^可以完全抵挡${NUM}次攻击$|^抵挡${NUM}次攻击$|^(?:自身|自己)?免疫下${NUM}次(?:受到?的)?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // 无动词 stage（"改变自身攻击等级2"→+2；"攻击防御特防速度+2"列表）
  { id: "batch-e6-93", re: new RegExp(`^(?:改变)(自身|对手|对方|敌方)(${STAT_RE})(?:的)?等级${NUM}$`), go: (m) => ({ effects: [stageFx(STATS[m[2]], num(m[3]), tgt(m[1]))] }) },
  { id: "batch-e6-94", re: new RegExp(`^((?:${STAT_RE}|双攻|双防|攻速|双刀)(?:、(?:${STAT_RE}|双攻|双防|攻速|双刀))+)([+\\-＋－])${NUM}$`), go: (m) => { const ALIAS = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"], 攻速: ["atk", "spd"], 双刀: ["atk", "spa"] }; const names = m[1].split("、").flatMap((n) => ALIAS[n] ?? [STATS[n]]).filter(Boolean); return { effects: names.map((n) => stageFx(n, (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]), "self")) }; } },
  // "N%几率额外增加M点固定伤害"→flatChance+flatBonus
  { id: "batch-e6-95", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?(?:额外)?(?:增加|附加)${NUM}点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[2]), flatChance: num(m[1]) } }) },
  // 置位区间回血（"变为N-M点体力"→setRange）
  { id: "batch-e6-96", re: new RegExp(`^变为${NUM}\\s*[-~—]\\s*${NUM}点体力$`), go: (m) => ({ effects: [{ op: "heal", setRange: { min: num(m[1]), max: num(m[2]) }, target: "self" }] }) },
  // 裸"恢复N点体力"（nextAlly/自身语境）
  { id: "batch-e6-97", re: new RegExp(`^恢复${NUM}点体力$|^回复${NUM}点体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }) },
  // 孤儿顺序条件（"如果先出手"——cond 注入后续 part）
  { id: "batch-e6-98", re: /^(?:如果|若)先出手(?:的话)?$/, go: () => ({ orphanCond: { order: "first" } }) },
  { id: "batch-e6-99", re: /^(?:如果|若)后出手(?:的话)?$/, go: () => ({ orphanCond: { order: "last" } }) },
  // 裸"先/后出手时"——lookahead 触发表的整组体：谓词回挂 pendingCond（"后出手时"独占一组时 order 守卫不丢）
  { id: "batch-e6-100", re: /^(?:自身|自己)?先出手时$/, go: () => ({ orphanCond: { order: "first" } }) },
  { id: "batch-e6-101", re: /^(?:自身|自己)?后出手时$/, go: () => ({ orphanCond: { order: "last" } }) },
  // 异常列表无"中的N种"（"30%几率令对手中毒、烧伤或冻伤"→random pick1）
  { id: "batch-e6-102", re: new RegExp(`^(?:有?${NUM}%)?(?:的?(?:几|概)?率)?(?:令|使|让)(?:对手|对方|敌方)((?:${AIL_RE})(?:[、，,或](?:${AIL_RE}))+)(?:状态)?$`), go: (m) => { const names = m[2].match(new RegExp(AIL_RE, "g")) ?? []; const list = names.map((n) => AILMENTS[n]).filter(Boolean); const pct = m[1] !== undefined ? num(m[1]) : undefined; return list.length > 0 ? { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: 1 }, ...(pct !== undefined ? { chance: pct } : {}) }] } : null; } },
  // "恢复全部体力"/"恢复所有技能PP值" 裸句
  { id: "batch-e6-103", re: /^恢复全部体力$|^恢复所有体力$|^恢复(?:自身|自己)全部HP$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  { id: "batch-e6-104", re: /^恢复所有技能PP值$|^恢复(?:自身|自己)所有技能PP值$/, go: () => ({ effects: [{ op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "下N回合攻击技能无法造成伤害"（react payload 与直连——对手侧输出压制）
  { id: "batch-e6-105", re: new RegExp(`^(?:下${NUM}回合)?(?:攻击技能|攻击)?无法造成伤害$|^${NUM}回合内?攻击技能无法造成伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", turns: m[1] !== undefined || m[2] !== undefined ? num(m[1] ?? m[2]) : 1, params: { n: 0, d: 1 } }] }) },
  // "当回合闪避对手的攻击技能"/"N%回避攻击"
  { id: "batch-e6-106", re: /^(?:当回合)?闪避(?:对手|对方|敌方)?的?(?:攻击技能|攻击)$/, go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: 100 } }] }) },
  { id: "batch-e6-107", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?回避(?:对手|对方|敌方)?的?(?:攻击技能|攻击)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]) } }] }) },
  // "不受能力下降状态影响"→immune_degrade
  { id: "batch-e6-108", re: /^(?:使)?(?:自身|自己)?不受能力下降(?:状态)?(?:技能)?影响$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "使得对方技能失效"（move_null 无回合窗）
  { id: "batch-e6-109", re: /^使得?(?:对方|对手|敌方)技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent" }] }) },
  // "连续攻击每次提高N%几率"→chancePerUse
  { id: "batch-e6-110", re: new RegExp(`^连续攻击每次(?:提高|提升|增加)${NUM}%(?:几率|概率)?$|^每次攻击(?:提高|提升)${NUM}%(?:几率|概率)$`), go: (m) => ({ attachAll: { chancePerUse: num(m[1] ?? m[2]) } }) },
  // "每次攻击提升N%的致命几率，最多提高M%"→critPerUsePct（连用致命率累积）
  { id: "batch-e6-111", re: new RegExp(`^每次攻击(?:提升|提高|增加)${NUM}%的?致命(?:一击)?(?:几率|概率|率)(?:[，,]?最多(?:提高|提升|增加)${NUM}%)?$|^连续攻击每次(?:提高|提升|增加)${NUM}%致命(?:一击)?几率$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { critPerUsePct: ns[0], ...(ns[1] !== undefined ? { critPerUseCap: ns[1] } : {}) } }; } },
  // "致命+N"（致命一击等级）→ crt 虚拟段位（每段→暴击率换算未文档化，仅记录段位）
  { id: "batch-e6-112", re: new RegExp(`^致命(?:一击)?(?:等级)?\\+${NUM}$|^致命${NUM}级$|^提升致命(?:一击)?${NUM}级$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "crt", delta: num(m[1] ?? m[2] ?? m[3]), target: "self" }] }) },
  // "将对手<异常>"（将-动词）
  { id: "batch-e6-113", re: new RegExp(`^将(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }) },
  // 裸异常子句（"害怕则吸取…"切分残段）→ 对手侧异常谓词
  { id: "batch-e6-114", re: new RegExp(`^(${AIL_RE})(?:状态)?$`), go: (m) => ({ orphanCond: { foeHas: AILMENTS[m[1]] } }) },
  // drain_dot 变体群（"每回合吸取对手N点体力"/"每回合吸取对手最大体力的N/M"/"每回合吸取对方1/8的体力"/"每回合吸取对手当前HP的1/4"）
  { id: "batch-e6-115", re: new RegExp(`^每回合吸取(?:对手|对方|敌方)(?:最大体力|最大HP|体力|HP)?(?:的)?${NUM}\\s*/\\s*${NUM}$|^每回合吸取(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}$|^每回合吸取${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: ns[ns.length - 2], d: ns[ns.length - 1] } }] }; } },
  { id: "batch-e6-116", re: new RegExp(`^每回合吸取(?:对手|对方|敌方)(\\d+)点体力$|^每回合吸取对手(\\d+)点HP$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  { id: "batch-e6-117", re: new RegExp(`^每回合(?:结束(?:后|时)?)?若(?:对手|对方|敌方)处于能力(?:提升|强化)状态则吸取(?:对手|对方|敌方)(\\d+)点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { flat: num(m[1]) }, if: { foeStageUp: true } }] }) },
  { id: "batch-e6-118", re: new RegExp(`^每回合若先出手则吸取(?:对手|对方|敌方)(\\d+)点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { flat: num(m[1]) }, if: { order: "first" } }] }) },
  { id: "batch-e6-119", re: new RegExp(`^每回合(?:结束(?:后|时)?)?若未击败对手则吸取(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$|^当回合(?:结束(?:后|时)?)?若未击败对手则吸取(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_dot", target: "self", turns: 1, params: { n: ns[0], d: ns[1] }, if: { not: { foeFainted: true } } }] }; } },
  { id: "batch-e6-120", re: new RegExp(`^每回合吸取对手当前HP的${NUM}\\s*/\\s*${NUM}$|^每回合吸取(?:对手|对方|敌方)当前体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: ns[ns.length - 2], d: ns[ns.length - 1], cur: 1 } }] }; } },
  // 即时吸取变体（"吸取对手N点体力"/"吸取对手最大体力的N/M"/"吸取对手N%最大体力"/"吸取对手N-M点体力值"）
  { id: "batch-e6-121", re: new RegExp(`^吸取(?:对手|对方|敌方)(?:当前HP的|当前体力的)?${NUM}\\s*/\\s*${NUM}(?:最大体力|最大HP|体力|HP)?(?:补充到自己身上)?$|^吸取(?:对手|对方|敌方)(?:最大体力|最大HP|体力|HP)?(?:的)?${NUM}\\s*/\\s*${NUM}(?:补充到自己身上)?$|^吸取(?:对手|对方|敌方)体力${NUM}\\s*/\\s*${NUM}$|^吸取(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:最大体力|最大HP|体力|HP)$|^吸取对方对大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const cur = /当前/.test(m[0]); return { effects: [{ op: "damage", kind: "percent", frac: frac(ns[ns.length - 2], ns[ns.length - 1]), ...(cur ? { percentBase: "current" } : {}), target: "opponent" }, { op: "heal", numerator: ns[ns.length - 2], denominator: ns[ns.length - 1], missing: true, target: "self" }] }; } },
  { id: "batch-e6-122", re: new RegExp(`^吸取(?:对手|对方|敌方)${NUM}%最大体力$|^吸取(?:对手|对方|敌方)最大体力值?${NUM}%$|^吸取(?:对手|对方|敌方)最大体力值?的?${NUM}%$`), go: (m) => { const n = num(m[1] ?? m[2] ?? m[3]); return { effects: [{ op: "damage", kind: "percent", frac: { numerator: n, denominator: 100 }, target: "opponent" }, { op: "heal", numerator: n, denominator: 100, missing: true, target: "self" }] }; } },
  { id: "batch-e6-123", re: new RegExp(`^吸取(?:对手|对方|敌方)(\\d+)\\s*[-~—]\\s*(\\d+)点体力值?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", flatRange: { min: num(m[1]), max: num(m[2]) }, power: 0, target: "opponent" }, { op: "heal", flatRange: { min: num(m[1]), max: num(m[2]) }, target: "self" }] }) },
  { id: "batch-e6-124", re: new RegExp(`^吸取(?:对手|对方|敌方)(\\d+)点体力$|^吸取对手(\\d+)点HP$|^吸取对手(\\d+)点体$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2] ?? m[3]), target: "opponent" }, { op: "heal", flat: num(m[1] ?? m[2] ?? m[3]), target: "self" }] }) },
  // "给予/予对方损伤的一半/损伤的N/M 会回复/恢复自己体力"→drain
  { id: "batch-e6-125", re: new RegExp(`^给予?对?方损[伤失](?:的)?一半[，,]?(?:会)?(?:回复|恢复)(?:自己|自身)的?(?:体力|HP)$|^给予?对方损伤(?:的)?${NUM}\\s*/\\s*${NUM}(?:会)?(?:回复|恢复)(?:自己|自身)的?(?:体力|HP)$|^给予对方损伤的${NUM}\\s*/\\s*${NUM}(?:会)?恢复(?:自己|自身)的?(?:体力|HP)$|^每次造成伤害的${NUM}\\s*/\\s*${NUM}会回复自己的(?:体力|hp|HP)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const fr = ns.length >= 2 ? (ns[0] > ns[1] ? frac(ns[1], ns[0]) : frac(ns[0], ns[1])) : frac(1, 2); return { attachDamage: { drain: fr } }; } },
  { id: "batch-e6-126", re: /^会?回复自己?身?的?(?:体力|HP|IP)$|^会回复自身体力$|^会回复自己的体力$/, go: () => ({ effects: [] }) },
  // "附加对手最大体力N/M的百分比伤害"（react payload 与直连——percent 固定伤害）
  { id: "batch-e6-127", re: new RegExp(`^附加(?:对手|对方|敌方)?最大体力${NUM}\\s*/\\s*${NUM}的百分比伤害$|^附加对手最大体力的${NUM}\\s*/\\s*${NUM}的?(?:百分比)?伤害$|^附加对手最大体力${NUM}%的?(?:百分比)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "percent", frac: ns.length > 1 ? frac(ns[ns.length - 2], ns[ns.length - 1]) : frac(ns[0], "100"), target: "opponent" }] }; } },
  // "受到攻击吸取对手最大体力的1/3"（无"则"反应式）
  { id: "batch-e6-128", re: new RegExp(`^受到攻击吸取(?:对手|对方|敌方)(.+)$`), go: (m) => reactWrap(1, {}, `吸取对手${m[1]}`) },
  // "若当回合打出致命一击则转变为吸取N-M点体力值"→prevCrit 条件 drain
  { id: "batch-e6-129", re: new RegExp(`^若当回合打出致命[一1]?击则转变为吸取(?:对手|对方|敌方)?(\\d+)\\s*[-~—]\\s*(\\d+)点体力值?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", flatRange: { min: num(m[1]), max: num(m[2]) }, power: 0, drain: frac(1, 1), target: "opponent", if: { prevCrit: true } }] }) },
  // "能力提升状态被消除或吸取时[X]"——时+payload 直接包 / 时$ 孤儿触发
  { id: "batch-e6-130", re: /^(?:若)?(?:自身|自己)?能力(?:提升|强化)状态被消除(?:或吸取|和吸取)?时(.+)$|^(?:若)?(?:自身|自己)?能力(?:提升|强化)状态被吸取时(.+)$/, go: (m) => reactWrap(7, {}, m[1] ?? m[2]) },
  { id: "batch-e6-131", re: /^若?(?:自身|自己)?能力(?:提升|强化)状态被消除(?:或吸取|和吸取)?时?$|^若?(?:自身|自己)?能力(?:提升|强化)状态被吸取时?$|^若自身能力(?:提升|强化)状态?消失$/, go: () => ({ dynTriggerPart: { trigger: 7 } }) },
  // "令自身N回合内的能力提升状态无法被消除或吸取"→up_lock timed
  { id: "batch-e6-132", re: new RegExp(`^(?:令|使|让)?(?:自身|自己)?${NUM}回合内?的能力(?:提升|强化)状态无法被消除(?:或吸取|和吸取)?$|^令自身的能力提升状态无法被消除或吸取$`), go: (m) => ({ effects: [{ op: "apply_status", name: "up_lock", target: "self", turns: num(m[1]) }] }) },
  // "对手选择非必中技能时吸取对手所选技能N点PP"→trigger3 + pp payload
  { id: "batch-e6-133", re: new RegExp(`^对手选择非必中技能时吸取(?:对手|对方|敌方)?所选技能(\\d+)点PP值?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 3 }, payload: [{ op: "pp_delta", amount: -num(m[1]), target: "opponent" }] }] }) },
  // "N点护罩/生命值为N的护罩" 裸变体 + 对手侧护罩（"为对手附加300点护罩"）
  { id: "batch-e6-134", re: new RegExp(`^(?:为|给)(对手|对方|敌方|自身|自己)(?:附加|创造)(?:一个|${NUM}个)?(?:生命值为)?(\\d+)点的?(护罩|护盾)$|^(\\d+)点护罩$|^生命值为(\\d+)的护罩$|^(?:使|令)?自身获得${NUM}个生命值为(\\d+)的护罩$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && /^\d+$/.test(x)).map(num); const isWard = /护罩$/.test(m[0]); return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: /^(对手|对方|敌方)$/.test(m[1]) ? "opponent" : "self", params: { flat: ns[ns.length - 1], ...(isWard ? { kindMask: 3 } : {}) } }] }; } },
  // 分数护盾（"为自身附加最大体力1/4的护盾"——fracMaxHp 落地时按持有者最大体力折算 flat）
  { id: "batch-e6-135", re: new RegExp(`^(?:为|给)(对手|对方|敌方|自身|自己)(?:附加|创造)(?:一个)?(?:能抵挡)?(?:等同于|相当于)?(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:护罩|护盾)$|^(?:自身|自己)?(?:额外)?(?:获得|附加|创造)(?:等同于|相当于)?(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:护罩|护盾)$|^附加(?:等同于|相当于)?(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:护罩|护盾)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const w = /^对手|对方|敌方$/.test(m[1]) ? "opponent" : "self"; const isWard = /护罩$/.test(m[0]); return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: w, params: { fracMaxHpN: num(ns[ns.length - 2]), fracMaxHpD: num(ns[ns.length - 1]), ...(isWard ? { kindMask: 3 } : {}) } }] }; } },
  // 抵挡定量护盾（"带有能抵挡150点伤害的护盾"/"可抵御100点伤害的护盾"）
  { id: "batch-e6-136", re: new RegExp(`^(?:带有|获得|得到|附加|创造)?(?:一个|一|${NUM}块|${NUM}个)?(?:能|可)(?:抵挡|抵御|抵抗)(${NUM})点(?:的)?(?:攻击)?伤害(?:的)?(?:护罩|护盾)$|^得到(?:一|${NUM})块?(?:护盾|护罩)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const isWard = /护罩$/.test(m[0]); return ns.length > 0 ? { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: "self", params: { flat: ns[ns.length - 1], ...(isWard ? { kindMask: 3 } : {}) } }] } : { ignored: true }; } },
  // 裸"护盾/护罩"枚举片（"护盾、护罩"顿号拆分残段——克隆前一条护盾 op；护罩片产 ward kindMask=3 分立池）
  { id: "batch-e6-137", re: /^(护盾|护罩)$/, go: (m) => ({ attachAll: { cloneShield: true, ward: m[1] === "护罩" } }) },
  // 附加/获得 N 护盾（无"点"后缀）
  { id: "batch-e6-138", re: new RegExp(`^(?:为|给|使|令)?(?:自身|自己)?(?:附加|获得|生成|创造)(${NUM})(?:层|个)?护盾$|^附加(${NUM})护盾$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[ns.length - 1] } }] }; } },
  // 附加自身受到攻击伤害N%的固定伤害（unit=伤害源→flatPrevTakenPct）
  { id: "batch-e6-139", re: new RegExp(`^(?:给|为|对)(?:对手|对方|敌方)(?:附加|造成)自身受到?(?:的)?攻击伤害${NUM}%的固定伤害$|^附加自身受到?(?:的)?攻击伤害${NUM}%的固定伤害$|^给对手附加自身受到攻击伤害${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatPrevTakenPct: ns[ns.length - 1] }] }; } },
  // 免疫对手造成的（攻击）伤害 → dmg_immune
  { id: "batch-e6-140", re: /^免疫对手造成的?(?:攻击)?(?:技能)?伤害$|^免疫对手的攻击伤害$|^免疫对手造成的攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  // "容让对手受到50点固定伤害"（OCR"容让"=令；句首"3回合内"被 TURNS_PRE 剥后残文）。放在 batch-e6-141 前面，那条要求句首「令/使」。
  { id: "batch-e6-141a", re: new RegExp(`^容让(?:对手|对方|敌方)受到(${NUM})点(?:固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1]), target: "opponent" }] }) },
  // 令对手立刻受到N点固伤
  { id: "batch-e6-141", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:立刻|立即)受到(${NUM})点(?:固定伤害|固伤)$|^令(?:对手|对方|敌方)受到(${NUM})点(?:固定伤害|固伤)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: ns[ns.length - 1], target: "opponent" }] }; } },
  // "对方所有强化消失"（"强化"俗写=能力强化效果）。放在 batch-e6-142 前面，那条只收「能力增强效果」。
  { id: "batch-e6-142a", re: /^(?:令|使)?(?:对手|对方|敌方)(?:所有|全部)?强化(?:效果)?(?:全部)?消失$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // （令）对手能力增强效果消失 → clear_stages sign:up
  { id: "batch-e6-142", re: /^(?:令|使)?(?:对手|对方|敌方)(?:的)?能力增强效果消失$|^消除(?:对手|对方|敌方)(?:的)?能力增强效果$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // 将/使对手体力降为N点 → leaveHp 压血线
  { id: "batch-e6-143", re: new RegExp(`^(?:将|使|令)(?:对手|对方|敌方)(?:的)?体力降为(${NUM})点(?:体力)?$|^把(?:对手|对方|敌方)(?:的)?体力降为(${NUM})点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", leaveHp: ns[ns.length - 1] }] }; } },
  // 使对手攻击miss / 对手攻击N%miss → dodge
  { id: "batch-e6-144", re: new RegExp(`^使(?:对手|对方|敌方)(?:的)?攻击(?:${NUM}%)?miss$|^(?:对手|对方|敌方)(?:的)?攻击(${NUM}%)miss$`, "i"), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: m[1] !== undefined ? num(m[1].replace("%", "")) : 100 } }] }) },
  // 裸 "N%miss"/"miss"（受击语境下的闪避窗缩写）
  { id: "batch-e6-145", re: new RegExp(`^(${NUM})%miss$|^miss$`, "i"), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: m[1] !== undefined ? num(m[1]) : 100 } }] }) },
  // 最多可叠加N次 → mark cap 挂载
  { id: "batch-e6-146", re: new RegExp(`^(?:最多)?(?:可)?叠加(${NUM})次$`), go: (m) => ({ attachAll: { markCap: num(m[1]) } }) },
  // 随机减少对手所有技能N-M点pp —— 逐槽随机区间未建模
  { id: "batch-e6-147", re: new RegExp(`^随机减少(?:对手|对方|敌方)所有技能${NUM}-${NUM}点pp$`, "i"), go: () => ({ unparsedReason: "pp-range — per-slot random amount unmodeled (deferred)" }) },
  // 吸取/减少对手所有（技能）N点PP
  { id: "batch-e6-148", re: new RegExp(`^(?:吸取|减少)(?:对手|对方|敌方)所有(?:技能)?(${NUM})点(?:的)?(?:PP|pp)值?$`), go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[1]), target: "opponent", scope: "all" }] }) },
  // "使对手所有技能PP值减少N点" → pp_delta -N all
  { id: "batch-e6-149", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)所有技能?(?:PP|pp)值?减少(${NUM})点$|^(?:使|令)(?:对手|对方|敌方)(?:的)?所有技能?(?:PP|pp)值?-(${NUM})$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", amount: -ns[ns.length - 1], target: "opponent", scope: "all" }] }; } },
  // "为对手附加N点固定伤害"（独立固伤——无攻击上下文按即时 fixed damage）
  { id: "batch-e6-150", re: new RegExp(`^(?:直接)?(?:为|给|令|使)(?:对手|对方|敌方)(?:附加|造成)(${NUM})点(?:固定|固伤)?伤害$|^直接给(?:对手|对方|敌方)造成(${NUM})点(?:固定|固伤)?伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // 附加固伤动态变体族（"攻击附加对手当前生命值N%"/"对手双防值之和N%"/"防御和特防提升总段数乘N"/"上回合承伤N%"/"当次威力N倍"——attachDamage → damage op flat 字段）
  { id: "batch-e6-151", re: /^(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)对手当前(?:生命|体力)值?(\d+)%(?:的)?固定伤害$/, go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }) },
  { id: "batch-e6-152", re: /^(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)对手(?:的)?双防值?之?和?的?(\d+)%(?:的)?固定伤害$/, go: (m) => ({ attachDamage: { flatFoeDefSumPct: num(m[1]) } }) },
  { id: "batch-e6-153", re: /^(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)自身(?:防御和特防|双防)(?:的)?能力提升总段数(?:乘以|乘|×)(\d+)(?:的)?固定伤害$/, go: (m) => ({ attachDamage: { flatDefStageMul: num(m[1]) } }) },
  { id: "batch-e6-154", re: /^(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)自身上回合受(?:到|的)?伤害(?:数值)?的?(\d+)%(?:的)?固定伤害$/, go: (m) => ({ attachDamage: { flatPrevTurnTakenPct: num(m[1]) } }) },
  { id: "batch-e6-155", re: /^(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)等同于?(?:当次|该次|本?次)?技能?威力值?的?(\d+)倍(?:的)?固定伤害$/, go: (m) => ({ attachDamage: { flatPowerMul: num(m[1]) } }) },
  { id: "batch-e6-156", re: /^(?:双方|自身|对手)(?:精灵)?每处于一种能力提升状态(?:则|，|,)?附(?:带|加)(\d+)点(?:固定)?伤害$/, go: (m) => ({ attachDamage: { [/双方/.test(m[0]) ? "flatBothStageUpCountMul" : /对手/.test(m[0]) ? "flatFoeStageUpCountMul" : "flatStageUpCountMul"]: num(m[1]) } }) },
  // "使对手受到等同于伤害值的固定伤害"（当回合已承伤等额反伤——flatPrevTakenPct:100 近似，"本回合受到的伤害"语境）
  { id: "batch-e6-157", re: /^(?:使|令)(?:对手|对方|敌方)受到等同于(?:本?次|该次|所受|受到的)?伤害值?的?固定伤害$/, go: () => ({ attachDamage: { flatPrevTakenPct: 100 } }) },
  // "对手在回合结束时受到相当于本次伤害N/M的固定伤害" → flatSelfLastDmgPct（"本次伤害"=自身刚出伤数值——回合结束时点近似 UNVERIFIED）
  { id: "batch-e6-158", re: new RegExp(`^(?:对手|对方|敌方)?(?:在|于)?回合结束时?受到相当于本?次?伤害${NUM}\\s*/\\s*${NUM}的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatSelfLastDmgPct: Math.floor((ns[0] * 100) / ns[1]) } }; } },
  // "附加所造成伤害值N%的固伤"——当次出伤百分比固伤（lastDealt 记账）
  // 「伤害值 / 伤害量」是同一说法的两种写法（pet-4248「附加造成伤害量50%的固定伤害」），
  // 字符类一并收，语义不变（仍走 flatSelfLastDmgPct）。
  { id: "batch-e6-159", re: new RegExp(`^附加(?:所)?造成(?:的)?伤害(?:[值量])?${NUM}%的?(?:固定|固伤)?伤害$|^附加所造成伤害[值量]${NUM}%的?固伤$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatSelfLastDmgPct: ns[ns.length - 1] } }; } },
  // "额外附加100%等量固伤"（pet-3882）——「N%等量固伤」= 当次出伤的 N% 作为固定伤害，
  // 与 batch-e6-159 同读法（flatSelfLastDmgPct），只是幅值写成百分比而非"伤害值的N%"。
  // 内容库里「%等量」仅此一处，故无歧义。
  { id: "batch-e6-159b", re: new RegExp(`^${NUM}%等量(?:的)?(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatSelfLastDmgPct: num(m[1]) } }) },
  // 承伤转移（"自身受到的固定伤害转移到对手身上"——redirect 域未建模）
  { id: "batch-e6-160", re: /^(?:自身|自己)?受到的(?:固定|百分比)?伤害转移(?:到|给)(?:对手|对方|敌方)/, go: () => ({ unparsedReason: "damage redirect — taken-damage reroute unmodeled (deferred)" }) },
  // 跨引用公式（"500*该比例"/"pp值总和*10点护罩"/"每因此损失5点PP值"/"每有1点PP获得1种"——算术链引用未建模）
  { id: "batch-e6-161", re: /\*(?:该|其)比例|\*\(|恢复\d+\*|总和\s*\*\s*\d+|每因此|每有\d+点PP|每有\d+级(?!先制)|乘以.*比例|每剩余\d+点/, go: () => ({ unparsedReason: "formula cross-ref — arithmetic chain unmodeled (deferred)" }) },
  // 变比例固伤公式（"附加造成伤害一定比例的固定伤害，对手体力越高比例越高，满体力100%最低50%"——动态标度域未建模）
  { id: "batch-e6-162", re: /^(?:附加|造成)?(?:造成|攻击)?伤害(?:的)?一定比例(?:的)?固定伤害$|^附加造成伤害一定比例的固定伤害$/, go: () => ({ unparsedReason: "proportional flatEcho — dynamic scale unmodeled (deferred)" }) },
  // "（对手体力越高比例越高）"等变比例碎片 → 归入上条 deferred 语境
  { id: "batch-e6-163", re: /^(?:对手|对方|敌方)?体力越高[，,]?(?:附加的)?比例越高$|^(?:对手|对方|敌方)?体力越高$|^附加的?比例越高$|^(?:满体力时)?比例为?\d+%$|^最低\d+%$/, go: () => ({ ignored: true }) },
  // 无视对手（双防）能力提升状态 → pierce_stages
  { id: "batch-e6-164", re: /^(?:自身)?(?:攻击)?无视对手(?:的)?(?:双防|防御)?能力(?:提升|增强)(?:状态|效果)?$|^下回合自身攻击无视对手.*能力提升(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self", turns: 1 }] }) },
  // "无视…护盾承伤/攻击免疫效果"——pierce-shield/pierce-immune 域未建模（pierce_limit 明确不穿透护盾）
  { id: "batch-e6-165", re: /^(?:无视(?:对手|对方|敌方)?的?)?(?:护盾|护罩)承伤(?:类)?效果$/, go: () => ({ unparsedReason: "pierce-shield — shield-bypass unmodeled (deferred)" }) },
  // "无法触发被击败效果"——对手倒下时效果抑制（onKO 侧门控未建模）
  { id: "batch-e6-166", re: /^(?:使|令|对手|对方|敌方|其)?(?:对手|对方|敌方)?(?:的)?无法触发被击败(?:时)?(?:的)?效果$|^无法触发被击败效果$/, go: () => ({ unparsedReason: "onKO-suppression — defeat-effect suppression unmodeled (deferred)" }) },
  // "获得等同于对手的护盾/护罩"——守方护盾值快照复制（foe-shield 镜像未建模）
  { id: "batch-e6-167", re: /^获得等同于(?:对手|对方|敌方)的?(?:护盾|护罩)$|^等同于(?:对手|对方|敌方)(?:的)?护盾$/, go: () => ({ unparsedReason: "shield-copy — foe-shield snapshot unmodeled (deferred)" }) },
  // "改为使回合数+N"/"回合数+2"——印记/状态时长改写（mark-duration 域未建模）
  { id: "batch-e6-168", re: /^(?:改为)?(?:使|令)?(?:对手|对方|敌方|自身|自己)?(?:其)?回合数[+±-]?\d+$|^(?:使|令)回合数(?:增加|延长)\d+$/, go: () => ({ unparsedReason: "mark-duration — turns-mutation unmodeled (deferred)" }) },
  // 阈值域（"阈值降低N点"——印记阈值生命周期未建模）
  { id: "batch-e6-169", re: /阈值(?:降低|提高|减少|变化)/, go: () => ({ unparsedReason: "threshold-delta — mark threshold lifecycle unmodeled (deferred)" }) },
  // 施放计数（"进入烧伤状态每累计3次"——per-apply 计数器未建模）
  { id: "batch-e6-170", re: /每累计\d+次|累计(?:触发|进入|使用)\d+次/, go: () => ({ unparsedReason: "apply-counter — per-apply counting unmodeled (deferred)" }) },
  // 已损失体力百分比概率（"自身已损失体力百分比的几率"——动态概率域未建模）
  { id: "batch-e6-171", re: /已损失体力(?:的)?百分比(?:的)?(?:几|概)?率/, go: () => ({ unparsedReason: "missing-pct-chance — dynamic probability unmodeled (deferred)" }) },
  // "可叠加至N次"——叠加上限（stack-cap 字段未建模）
  { id: "batch-e6-172", re: /^可(?:以)?叠加(?:至|到)?\d+次$|^最多叠加\d+次?$/, go: () => ({ unparsedReason: "stack-cap — accumulate ceiling unmodeled (deferred)" }) },
  // "对手下1次受到的X"——受方下次窗（next-taken 未建模）
  { id: "batch-e6-173", re: /^对手下\d+次受到的/, go: () => ({ unparsedReason: "next-taken — incoming next-hit window unmodeled (deferred)" }) },
  // "每造成N点伤害"——伤害步进计数（damage-step 未建模）
  { id: "batch-e6-174", re: /^每造成\d+点伤害/, go: () => ({ unparsedReason: "damage-step — per-damage-unit counter unmodeled (deferred)" }) },
  // "技能类型相同/不同"——招式类型快照比较（skill-type-usage 未建模）
  { id: "batch-e6-175", re: /技能类型相同|技能类型不同|类型相同|类型不同/, go: () => ({ unparsedReason: "skill-type-usage — per-entry move-type tracking unmodeled (deferred)" }) },
  // "缔结契约/辛存活期间"——伴生实体（companion lifecycle 未建模）
  { id: "batch-e6-176", re: /缔结契约|契约.{0,4}守护|存活期间|帮助.{0,4}抵挡/, go: () => ({ unparsedReason: "companion — ally-entity lifecycle unmodeled (deferred)" }) },
  // "免疫并反弹对手下次/下N次/下N回合造成的(攻击)伤害"——承伤免疫 + 等额反弹两窗同挂（次数用 dmg_immune 的 count，回合窗用 turns；
  // "下N次"已由否定前瞻豁免，旧句是 no-rule 留档）。具名来源（B-ROBO、某只精灵名、系别）没有来源过滤谓词，仍留给 batch-e6-177。
  { id: "r4c-immune-reflect-next-01",
    re: new RegExp(`^免疫并反弹(?:对手|对方|敌方)?下(?:${NUM}次|次|${NUM}回合)造成的(?:攻击)?伤害$`),
    go: (m) => {
      const n = num(m[1] ?? m[2] ?? "1");
      if (m[2] !== undefined) {
        return { effects: [
          { op: "apply_status", name: "dmg_immune", target: "self", turns: n },
          { op: "apply_status", name: "reflect_dmg", target: "self", turns: n, params: { n: 1, d: 1 } },
        ] };
      }
      return { effects: [
        { op: "apply_status", name: "dmg_immune", target: "self", params: { count: n } },
        { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, count: n } },
      ] };
    } },
  { id: "batch-e6-177", re: /^免疫(?!下?\d+次|下[一二两三四五六七八九十]+次|下?次|对手下?|对方下?|敌方下?)[\p{Script=Han}A-Za-z0-9-]{2,}造成的(?:攻击)?伤害$/u, go: () => ({ unparsedReason: "source-filter — named-origin immunity unmodeled (deferred)" }) },
  // 免疫此次受到的攻击伤害（单次窗；可带几率前缀）
  { id: "batch-e6-178", re: new RegExp(`^(${NUM})%?(?:的)?(?:几率|概率)?免疫此次受到?(?:的)?攻击伤害$|^(${NUM})%?(?:几率|概率)?免疫这次受到?(?:的)?攻击伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1, ...(m[1] ?? m[2] !== undefined ? { chance: pct(m[1] ?? m[2]) } : {}) }] }) },
  // 受到的攻击伤害超过N点则
  { id: "batch-e6-179", re: new RegExp(`^受到?(?:的)?(?:攻击)?伤害超过${NUM}点?则(.+)$|^受到?(?:的)?攻击伤害不低于${NUM}(?:点)?则(.+)$|^受到?(?:的)?攻击伤害大于${NUM}(?:点)?则(.+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); return reactWrap(1, { min: num(ns[0]) }, ns[1]); } },
  // 自身受到的伤害减少N%（无"攻击"限定）
  { id: "batch-e6-180", re: new RegExp(`^(?:自身)?受到?(?:的)?伤害减少(${NUM})%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1]) } }] }) },
  // 反转对手能力提升 → invert_stages
  { id: "batch-e6-181", re: /^(?:并|且)?反转(?:对手|对方|敌方)(?:的)?能力提升(?:状态)?$|^将对手能力提升反转$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // 触发闪避则
  { id: "batch-e6-182", re: /^触发闪避(?:则|时)(.+)$/, go: (m) => reactWrap(2, {}, m[1]) },
  // 体力未满则 → not selfHpFull（condOf 变体经 orphanCond/pendingCond 通道——此处裸句直挂 if）
  { id: "batch-e6-183", re: /^(?:若)?(?:自身)?体力未满则(.+)$/, go: (m) => { const r = parseEffectText(m[1]); for (const e of r.effects ?? []) e.if = { not: { selfHpFull: true } }; return r; } },
  // 自身攻击N%令对手AIL（"自身攻击50%令对手诅咒"）
  { id: "batch-e6-184", re: new RegExp(`^(?:自身)?攻击(?:技能)?有?(${NUM})%(?:的)?(?:几率|概率)?令(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent", chance: num(m[1]) }] }) },
  // 激活/增加/消耗/获得 N层<名> → mark ops
  { id: "batch-e6-185", re: new RegExp(`^(?:立刻|立即)?(?:激活|增加|叠加|获得)${NUM}层([\\p{Script=Han}]{2,10})$`, "u"), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2], count: num(m[1]), target: "self" }] }) },
  // "获得N回合X" → apply_mark turns 窗（"触发成功则获得3回合亮节"）
  { id: "batch-e6-186", re: new RegExp(`^(?:获得|得到|生成|开启)${NUM}回合([\\p{Script=Han}]{2,8})$`, "u"), go: (m) => { const mk = m[2]; if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|免疫|先机|必中|暴击/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, turns: num(m[1]), target: "self" }] }; } },
  { id: "batch-e6-187", re: new RegExp(`^消耗${NUM}层([\\p{Script=Han}]{2,10})$`, "u"), go: (m) => ({ effects: [{ op: "consume_mark", mark: m[2], count: num(m[1]), target: "self" }] }) },
  // <名>达到N层时 → markCountAtLeast（condOf 变体——裸句直挂 if）
  { id: "batch-e6-188", re: new RegExp(`^([\\p{Script=Han}]{2,10})达到${NUM}层时(.+)$`, "u"), go: (m) => { const r = parseEffectText(m[3]); for (const e of r.effects ?? []) e.if = { markCountAtLeast: { mark: m[1], n: num(m[2]) } }; return r; } },
  // 先出手…翻倍（"先出手几率翻倍"）
  // "后出手弱化效果翻倍"/"后出手弱化翻倍"（batch-e6-189 的门只收「先出手/先手」）。放在 batch-e6-189 前面。
  { id: "p1-e6-02", re: /^(?:后出手|后手)(?:时)?(?:的)?弱化(?:效果)?翻倍$/, go: () => ({ attachAll: { stageDownDouble: true, effCond: { order: "last" } } }) },
  { id: "batch-e6-189", re: /^(?:先出手|先手)(?:时)?(?:的)?(几率|概率|效果|伤害|威力|强化|弱化|固伤|固定伤害)(?:效果)?翻倍$/, go: (m) => ({ attachAll: { ...(m[1] === "几率" || m[1] === "概率" ? { chanceDouble: true } : m[1] === "强化" ? { stageDouble: true } : m[1] === "弱化" ? { stageDownDouble: true } : m[1] === "固伤" || m[1] === "固定伤害" ? { flatDouble: true } : { effectDouble: true }), effCond: { order: "first" } } }) },
  // 当回（"当回合"省写）+ 下回合起
  { id: "batch-e6-190", re: /^当回([^合].*)$/, go: (m) => parseEffectText(`当回合${m[1]}`) },
  // 每回合使对手随机N个（攻击/属性）技能pp归零
  { id: "batch-e6-191", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机(${NUM})个(?:攻击|属性)?技能(?:PP|pp)值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // 免疫异常状态几率提升N% → immune_status params.chance
  { id: "batch-e6-192", re: new RegExp(`^免疫(?:所有)?异常状态?(?:的)?几率提升(${NUM})%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { chance: num(m[1]) } }] }) },
  // "使对手随机N个技能PP归零"（PP归零 无值字）
  { id: "batch-e6-193", re: new RegExp(`^(?:(?:额外)?[使令])?(?:对手|对方|敌方)随机的?${NUM}(?:个|项)技能PP(?:值)?[归清][零0]$|^额外使(?:对手|对方|敌方)随机的?${NUM}(?:个|项)技能PP值?[归清]零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "随机N-M项技能PP值归零"（抽槽数区间——zeroRandomMax 落地抽一次）
  { id: "batch-e6-194", re: new RegExp(`^(?:(?:额外)?[使令])?(?:对手|对方|敌方)随机的?${NUM}[-~—至到]${NUM}(?:个|项)技能PP(?:值)?[归清][零0]$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", zeroRandom: ns[0], zeroRandomMax: ns[1], target: "opponent" }] }; } },
  // "每次(直接)攻击必定致命(一)击"→crit（ctxTurns 注入转 crit_always 窗口）
  { id: "batch-e6-195", re: /^每次(?:直接)?攻击必定致命(?:一)?击$/, go: () => ({ attachDamage: { crit: true } }) },
  // "连续攻击N-M次"/"1回合做N-M次攻击"→hits 区间
  { id: "batch-e6-196", re: new RegExp(`^连续攻击(?:目标)?${NUM}\\s*[-~—]\\s*${NUM}次$|^${NUM}回合(?:内)?做${NUM}\\s*[-~—]\\s*${NUM}次攻击$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const lo = ns[ns.length - 2]; const hi = ns[ns.length - 1]; return { attachDamage: { hits: { min: lo, max: hi } } }; } },
  // 孤儿顺序条件变体（"若本方先手攻击"/"先出手攻击时"——则臂被切散）
  { id: "batch-e6-197", re: /^若?(?:本方|自身|自己)?先手攻击(?:时|则)?$|^若?(?:本方|自身|自己)?先出手攻击时$/, go: () => ({ orphanCond: { order: "first" } }) },
  // "反馈成功则"/"转移成功则" 孤儿成功谓词
  { id: "batch-e6-198", re: /^(?:反馈|转移|切换|附身)成功[则，,]?$/, go: () => ({ orphanCond: { prevApplied: true } }) },
  // 打出致命触发（"打出致命一击后X"/"若打出致命一击则X"→react trigger10）
  { id: "batch-e6-199", re: /^(?:若)?(?:攻击技能)?打出致命一击后(.+)$|^若打出致命一击[则，,]?(.+)$/, go: (m) => reactWrap(10, {}, m[1] ?? m[2]) },
  // 消除失败谓词（"若对手回合类效果无法被消除则X"——前接 cleanse timed 失败分支）
  { id: "batch-e6-200", re: /^(?:若)?(?:对手|对方|敌方)回合类效果无法被消除$/, go: () => ({ orphanCond: { not: { prevApplied: true } } }) },
  // "触发后" 孤儿连接（异常触发后的延续臂——无条件继续）
  { id: "batch-e6-201", re: /^触发后$/, go: () => ({ effects: [] }) },
  // 自杀/牺牲（"自杀，使下一个出战精灵X"/"自己牺牲"→对自身造成当前体力值伤害）
  { id: "batch-e6-202", re: /^自杀$|^(?:自己|自身)牺牲(?:[（(]体力降[到至]0[）)])?$|^牺牲(?:自己|自身|自我)$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", target: "self", selfHp: true, power: 0 }] }) },
  // 命中效果失效（"对手属性技能命中效果失效"→hit_fx_null，cat 门控）
  { id: "batch-e6-203", re: new RegExp(`^(?:${NUM}回合内?)?(?:对手|对方|敌方)(?:${NUM}回合内?)?(?:攻击技能|属性技能|技能)?命中效果失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hit_fx_null", target: "opponent", ...((m[1] ?? m[2]) !== undefined ? { turns: num(m[1] ?? m[2]) } : {}), ...(m[0].includes("属性技能") ? { params: { cat: 1 } } : m[0].includes("攻击技能") ? { params: { cat: 4 } } : {}) }] }) },
  // "使用攻击技能后的下N回合攻击技能无法造成伤害"/"对手攻击技能无法造成伤害"（react payload 与直连）
  { id: "batch-e6-204", re: new RegExp(`^使用(?:攻击|属性)技能后的下?${NUM}回合(?:攻击|属性)?技能?无法造成伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", turns: m[1] !== undefined ? num(m[1]) : 1, params: { n: 0, d: 1 } }] }) },
  { id: "batch-e6-205", re: new RegExp(`^(?:对手|对方|敌方)(?:${NUM}回合内?)?(?:攻击技能|攻击|技能)?无法造成(?:攻击)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", turns: m[1] !== undefined ? num(m[1]) : 1, params: { n: 0, d: 1 } }] }) },
  // "解除并附加给对手自身所处的异常状态"→cleanse 自身异常 + transfer_ailments push
  { id: "batch-e6-206", re: /^解除并附加给对手自身所处的异常状态$|^解除并附加给(?:对手|对方)(?:的)?自身(?:所处)?的?异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }, { op: "transfer_ailments", direction: "push", target: "opponent" }] }) },
  // "附加给对手自身所处的所有异常状态"（pet-4668）——只「附加」不「解除」：
  // transfer_ailments push 本身就是整体迁移（自身异常移到对手），无需再叠 cleanse。
  { id: "batch-e6-206b", re: /^附加给(?:对手|对方|敌方)(?:的)?自身(?:所处)?的?(?:所有|全部)?(?:异常状态)$/, go: () => ({ effects: [{ op: "transfer_ailments", direction: "push", target: "opponent" }] }) },
  { id: "batch-e6-207", re: /^解除$/, go: () => ({ effects: [] }) }, // "解除"裸残片（"解除成功则"切分后剥离）
  { id: "batch-e6-208", re: /^(?:吸收|无视|触发|解除|反转|翻转)成功[则，,]?$/, go: () => ({ orphanCond: { prevApplied: true } }) },
  // "反转/翻转自身能力下降状态"→invert_stages；"吸取并反转对手能力提升状态"→steal + invert 双侧
  { id: "batch-e6-209", re: /^(?:反转|翻转)(?:自身|自己)(?:的)?能力下降状态$/, go: () => ({ effects: [{ op: "invert_stages", target: "self" }] }) },
  { id: "batch-e6-210", re: /^(?:吸取|吸收)并(?:反转|翻转)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化|上升)状态$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal" }, { op: "invert_stages", target: "opponent" }] }) },
  { id: "batch-e6-211", re: /^(?:反转|翻转)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化|上升)状态$/, go: () => ({ effects: [{ op: "invert_stages", target: "opponent" }] }) },
  // "威力随机，随机范围N~M"→powerRange
  { id: "batch-e6-212", re: new RegExp(`^威力随机[，,]?随机范围${NUM}\\s*[~～—-]\\s*${NUM}$|^威力随机范围${NUM}\\s*[~～—-]\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { flags: { powerRange: { min: ns[0], max: ns[1] } } }; } },
  // "自身受到的攻击伤害额外减少N%"（额外 插入变体）
  { id: "batch-e6-213", re: new RegExp(`^(?:自身|自己)?受到的(?:攻击)?伤害(?:额外)?减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1]) } }] }) },
  // "给予对象损伤的N/M，会回复自己的HP"（老版吸取=drain）
  { id: "batch-e6-214", re: new RegExp(`^给予对象损[伤失](?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { let n = num(m[1]); let d = num(m[2]); if (n > d) [n, d] = [d, n]; return { attachDamage: { drain: frac(n, d) } }; } },
  { id: "batch-e6-215", re: /^会?回复自己的HP$|^会?回复自己的体力$/, go: () => ({ effects: [] }) },
  // "每回合吸取对手当前体力的N/M"→drain_dot cur 基线
  { id: "batch-e6-216", re: new RegExp(`^每回合吸取(?:对手|对方|敌方)当前体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: num(m[1]), d: num(m[2]), cur: 1 } }] }) },
  // "使对手在回合结束时减少N/M最大HP"（中缀时序的对手侧周期性扣血）→foe_dot
  { id: "batch-e6-217", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)在回合结束[时后](?:使|令)?(?:对手|对方|敌方|其)?(?:减少|损失|扣除)(?:其|对手|对方|敌方)?(?:最大)?(?:体力|HP)(?:的)?${NUM}\\s*/\\s*${NUM}$|^(?:使|令|让)?(?:对手|对方|敌方)在回合结束[时后](?:减少|损失|扣除)(?:其|对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:体力|HP)$|^每回合(?:使|令|让)(?:对手|对方|敌方)(?:减少|损失|扣除)(?:其|对手|对方|敌方)?(?:最大)?(?:体力|HP)(?:的)?${NUM}\\s*/\\s*${NUM}$|^每回合(?:使|令|让)?(?:对手|对方|敌方)(?:减少|损失|扣除)(?:其|对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:体力|HP)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { n: ns[ns.length - 2], d: ns[ns.length - 1] } }] }; } },
  // "随机自身3项属性+1"：随机在主语前。$ 停在数字，不吞"并附加/并反转"。
  { id: "batch-e6-218b", re: new RegExp(`^随机(自身|自己|对手|对方|敌方)${NUM}(?:项|个|种)(?:能力值?|属性)(?:等级)?([+\\-＋－])${NUM}$`), go: (m) => { const who = /对手|对方|敌方/.test(m[1]) ? "opponent" : "self"; const sgn = m[3] === "-" || m[3] === "－" ? -1 : 1; return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[2]), delta: sgn * num(m[4]), target: who }] }; } },
  // "对手随机N项属性-K"/"随机使对手N项属性-K" → apply_stat_stage 随机维度
  { id: "batch-e6-218", re: new RegExp(`^(?:对手|对方|敌方)随机${NUM}(?:项|个)?(?:属性|能力值?|能力)?([+-])${NUM}$|^随机(?:使|令|让)(?:对手|对方|敌方)${NUM}(?:项|个)?(?:属性|能力值?|能力)?([+-])${NUM}$|^(?:使|令|让)(?:对手|对方|敌方)随机${NUM}(?:项|个)?(?:属性|能力值?)?([+-])${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const cnt = num(ns[0]); const s = ns.find((x) => x === "+" || x === "-"); const v = num(ns[ns.length - 1]); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: cnt, delta: s === "-" ? -v : v, target: "opponent" }] }; } },
  // "任何攻击技能都将附带N点固定伤害"（都将/任何 变体）
  { id: "batch-e6-219", re: new RegExp(`^(?:任何|所有)?(?:攻击|普通攻击)?技能?都?将?附带${NUM}点?(?:固定|固定伤害|固伤)(?:伤害)?$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // "增加N%致命一击概率"/"致命一击几率上升N/M" → crit_up
  { id: "batch-e6-220", re: new RegExp(`^(?:增加|提升|提高)${NUM}%(?:的)?致命[一1]?击(?:的)?(?:概率|几率)$|^(?:使)?致命[一1]?击(?:的)?(?:概率|几率)?(?:上升|提升|提高|增加)${NUM}\\s*/\\s*${NUM}$|^(?:使)?致命[一1]?击(?:的)?概率(?:上升|提升|提高|增加)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns.length > 1 ? ns[1] : 100 } }] }; } },
  // "对手所有技能命中下降N%" → 自身闪避窗（foe 侧命中压制→dodge 等价映射）
  { id: "batch-e6-221", re: new RegExp(`^(?:对手|对方|敌方)(?:所有|全部)?(?:攻击)?技能?命中(?:率)?(?:下降|降低|减少)${NUM}%$|^对手命中下降${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "附带N%吸血" → drain_atk 吸血窗
  { id: "batch-e6-222", re: new RegExp(`^(?:所有)?攻击(?:技能)?(?:都)?附带${NUM}%的?吸血(?:效果)?$|^附带${NUM}%的?吸血(?:效果)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // "致命一击几率上升N/M"（分数变体——"上升1/16"）
  // "攻击致命一击率增加1/16"（batch-e6-223 的签名以「致命一击/暴击」开头，不带「攻击」）。放在 batch-e6-223 前面。
  { id: "p1-e6-01", re: new RegExp(`^攻击(?:时)?(?:致命[一1]?击|暴击|要害)(?:的?几率|的?概率|率)?(?:上升|提升|提高|增加)${NUM}\s*/\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "batch-e6-223", re: new RegExp(`^(?:致命[一1]?击|暴击)(?:的?几率|的?概率|率)?(?:上升|提升|提高|增加)${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // "提升X等级N"（等级 显式变体——"提升速度等级1"）
  { id: "batch-e6-224", re: new RegExp(`^(?:提升|提高|增加|上升)(?:自身|自己)?(${STAT_RE})(?:的)?等级(?:提升|提高|上升|增加)?${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: num(m[2]), target: "self" }] }) },
  // "速度加1"/"攻击加N"——口语"加"等价 +N
  { id: "batch-e6-225", re: new RegExp(`^(?:自身|自己)?(${STAT_RE})(?:等级)?加${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: num(m[2]), target: "self" }] }) },
  // "使自身随机属性+1"——随机单维升降（stat:"random" 哨兵——randomCount:1）
  { id: "batch-e6-226", re: new RegExp(`^(?:使|令)?(?:自身|自己)?随机属性([+\\-－＋]?)${NUM}$|^(?:使|令)(?:对手|对方|敌方)随机属性([+\\-－＋]?)${NUM}$`), go: (m) => { const neg = m[1] === "-" || m[1] === "－" || m[3] === "-" || m[3] === "－"; return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: 1, delta: (neg ? -1 : 1) * num(m[2] ?? m[4]), target: m[3] !== undefined ? "opponent" : "self" }] }; } },
  // "自身攻击N%致命"（无"打出"尾变体）→crit_up
  { id: "batch-e6-227", re: new RegExp(`^(?:自身|自己)?攻击(?:技能)?(?:有)?${NUM}%(?:的?(?:概率|几率))?(?:打出)?致命[一1]?击?$|^攻击有${NUM}%的?(?:概率|几率)?致命$|^${NUM}%(?:的?(?:概率|几率))?(?:打出)?致命[一1]?击$|^${NUM}%(?:的?(?:概率|几率))?(?:打出)?致命$/`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1] ?? m[2] ?? m[3] ?? m[4]), d: 100 } }] }) },
  // "对手回合结束后其恢复最大体力的N/M"（其=对手——对手侧 hot）
  { id: "batch-e6-228", re: new RegExp(`^(?:对手|对方|敌方)回合结束(?:时|后)其?恢复(?:最大体力|全部体力)的?${NUM}\\s*/\\s*${NUM}$|^对手回合结束(?:时|后)恢复最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "opponent", turns: 1, params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // "下次攻击技能必定致命一击"（下次 裸变体）
  { id: "batch-e6-229", re: /^(?:自身|自己)?下(?:一|1)?次(?:攻击|攻击技能|使用的技能|命中的攻击技能|命中)?必定(?:打出)?致命(?:一)?击$|^下(?:一|1)?次攻击?必定致命$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 2, params: { count: 1 } }] }) },
  // "使自身下次受到的伤害减少N点"（数值版——n 变量版仍走 UNVERIFIED）
  { id: "batch-e6-230", re: new RegExp(`^使自身下(?:一|1)?次受到的伤害减少${NUM}点$|^自身下次受到的伤害减少${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]), count: 1 } }] }) },
  // "若打出的伤害在N至M之间则X"→prevDamage 区间条件
  { id: "batch-e6-231", re: new RegExp(`^若打出的伤害在${NUM}至${NUM}之间[则，,]?(.+)$`), go: (m) => { const lo = num(m[1]); const hi = num(m[2]); const sub = parseEffectText(m[3]); for (const e of sub.effects) if (e.if === undefined) e.if = { and: [{ prevDamageAboveAbs: lo - 1 }, { prevDamageBelowAbs: hi + 1 }] }; return { effects: sub.effects, ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  // "对手每有N个技能PP值小于M先制+K"→UNVERIFIED（按技能计数缩放——无对应机制）
  { id: "batch-e6-232", re: new RegExp(`^对手每有${NUM}个技能PP值?小于${NUM}先制([+-]?)${NUM}$`), go: (m) => ({ flags: { prioPerFoeLowPp: { below: num(m[2]), per: num(m[1]), add: (m[3] === "-" ? -1 : 1) * num(m[4]) } } }) },
  // "威力随使用递增"（"连续使用可以增加威力"——系数未写→UNVERIFIED）
  { id: "batch-e6-233", re: /^连续使用(?:可以|能)?增加威力$|^重复使用威力增加$/, go: () => ({ unparsedReason: "use-scaling power — coefficient undocumented (UNVERIFIED)" }) },
  { id: "batch-e6-234", re: /^重复使用无法叠加$|^无法叠加$/, go: () => ({ ignored: true }) }, // 语义注记（不叠乘）——无机制含义
  // "100%闪避对手的攻击"（pct 前缀 + 攻击 裸词）
  { id: "batch-e6-235", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?闪避(?:对手|对方|敌方)?的?(?:攻击技能|攻击|所有攻击)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]), cat: 4 } }] }) },
  // "对手回合结束后其恢复..." 之外——"对手回合结束后其恢复最大体力的1/2"更宽变体
  // 强化→弱化镜像传导（"将自身能力提升状态附加给对手相应的能力下降效果"→upToDown）
  { id: "batch-e6-236", re: /^将自身能力(?:提升|强化)状态附加给(?:对手|对方|敌方)相应的能力下降(?:效果|状态)$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "upToDown" }] }) },
  // 回合末随机吸强（"每回合使用技能则造成伤害前随机吸取对手N项能力值-M"→steal_rand_tick flag）
  { id: "batch-e6-237", re: new RegExp(`^每回合(?:使用技能则)?(?:造成伤害前)?随机吸取对手${NUM}项能力值-${NUM}$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "steal_rand_tick", target: "self", params: { count: num(m[1]), delta: num(m[2]) } })] }) },
  // "最多获得N点" 治疗上限尾句 → healCap attachAll
  { id: "batch-e6-238", re: new RegExp(`^最多(?:获得|恢复)${NUM}点$`), go: (m) => ({ attachAll: { healCap: num(m[1]) } }) },
  // "最多300点"裸伤害上限尾（"造成伤害，最多300点"）→ 回挂最近 damage op 的 cap
  { id: "batch-e6-239", re: new RegExp(`^最多${NUM}点(?:伤害)?$`), go: (m) => ({ attachAll: { dmgCap: num(m[1]) } }) },
];
