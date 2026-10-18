// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, STAT_CODES, AILMENTS, AIL_RE, frac, stageFx, tgt } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── 推迟/留档（原因化）─────────────────────────────────────
  // 叠用族（moveStacks 计数驱动：powerPerUse/powerMulPerUse/flatPerUse/prioPerUse + useCap 封顶）
  { id: "deferred-01", re: new RegExp(`^连续使用每次威力(?:增加|提升|提高|加)(\\d+)(?:点)?[,，]?(?:最高(?:威力)?(?:增加|提升|为|至|到)?(\\d+))?$|^续使用每次威力(?:增加|提升|加)(\\d+)(?:点)?$|^连续使用威力(?:增加|提升|提高)(\\d+)(?:点)?[,，]?(?:最高(?:威力)?(?:为|至|到)?(\\d+))?$|^每次使用威力增加(\\d+)(?:点)?$|^每次使用(?:基础)?威力(?:提升|提高|增加|加)\\+?(\\d+)(?:点)?$|^连续使用(?:每次)?(?:基础)?威力(?:(?:提升|提高|增加|加)\\+?|\\+)(\\d+)(?:点)?$|^连续使用(?:每次)?增加(\\d+)威力$|^连续使用增加威力(\\d+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const step = ns[0]; const cap = ns.length > 1 ? ns[1] : undefined; return { attachDamage: { powerPerUse: step, ...(cap !== undefined ? { useCap: cap } : {}) } }; } },
  { id: "deferred-02", re: new RegExp(`^最高(?:威力)?(?:增加|提升)?(\\d+)$|^最高增加(\\d+)$|^最高威力(\\d+)$`), go: (m) => ({ attachDamage: { useCap: num(m[1] ?? m[2] ?? m[3]) } }) },
  { id: "deferred-03", re: new RegExp(`^连续使用每次(?:增加|加)(\\d+)%$|^每次使用(?:技能)?(?:威力)?(?:增加|提高|提升)(\\d+)%$|^每次使用(?:增加|提升|提高)(\\d+)%威力$|^连续使用时威力(?:增加|提升|提高)(\\d+)%$|^连续使用威力(?:增加|提升|提高)(\\d+)%$`), go: (m) => { const pct = num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]); return { attachDamage: { powerMulPerUse: { numerator: 100 + pct, denominator: 100 } } }; } },
  { id: "deferred-04", re: new RegExp(`^每次使用(?:额外|为)?附加(\\d+)点?(?:固定|固伤)?(?:伤害)?$|^每次使用额外提升(\\d+)点$|^每次使用增加(\\d+)点(?:固定|固伤)?(?:伤害)?$|^每次使用额外[加+](\\d+)(?:点)?(?:，|,)?最高(\\d+)$|^每次使用攻击技能额外(?:增加|提升|附加)(\\d+)点(?:固定|固伤)?(?:伤害)?$|^每次使用攻击技能(?:都)?(?:使|令)?(?:造成的)?伤害(?:提升|提高|增加)(\\d+)(?:点|%)$`), go: (m) => { const t = m[8]; return t !== undefined && /%$/.test(m[0]) ? { attachDamage: { dmgPerUsePct: +t } } : { attachDamage: { flatPerUse: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[7] ?? m[8]), ...(m[5] !== undefined ? { flatPerUseCap: num(m[5]) } : {}) } }; } },
  { id: "deferred-05", re: new RegExp(`^连续使用时先制\\+?(\\d+)$|^连续使用先制\\+(\\d+)$`), go: (m) => ({ flags: { prioPerUse: num(m[1] ?? m[2]) } }) },
  { id: "deferred-06", re: new RegExp(`^每次使用则当回合造成的攻击伤害(?:额外)?(?:提升|增加)(\\d+)%$|^每次使用后(?:此技能|本技能)?造成的攻击伤害(?:额外)?(?:提升|增加)(\\d+)%$`), go: (m) => ({ attachDamage: { dmgPerUsePct: num(m[1] ?? m[2]) } }) },
  // 概率免伤（"50%的几率免疫对手攻击伤害"）
  { id: "deferred-07", re: new RegExp(`^(\\d+)%的?(?:几率|概率)?免疫(?:对手|对方|敌方)?(?:的)?攻击(?:伤害|技能)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]) } }] }) },
  // 完全闪避窗口（"N回合内躲避所有攻击"/"未来N回合内躲避所有攻击"→ctxTurns 注入/自带 turns）
  { id: "deferred-08", re: new RegExp(`^(?:未来)?${NUM}回合内?躲避(?:所有|一切|对手所有|对方所有)?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: 100 }, turns: num(m[1]) }] }) },
  { id: "deferred-09", re: /^躲避(?:所有|一切|对手所有|对方所有)?攻击$|^完全躲避(?:对手)?攻击$|^躲避对手(?:的)?所有攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: 100 } }] }) },
  // 体力互换（"与对手互换体力"→swap_hp）
  { id: "deferred-10", re: /^与(?:对手|对方|敌方)互换(?:体力|HP|血量)$|^(?:自身|自己)?(?:体力|HP)与(?:对手|对方|敌方)互换$/, go: () => ({ effects: [{ op: "swap_hp", target: "opponent" }] }) },
  // 回合末对手PP削减（"每回合结束后降低对手所有技能N点PP值"→pp_drain 持有窗）
  { id: "deferred-11", re: new RegExp(`^每回合(?:结束后|结束时|末)?(?:降低|减少)(?:对手|对方|敌方)(?:的)?(?:所有|全部)技能${NUM}点PP值?$|^每回合(?:对手|对方)(?:所有|全部)技能PP值?-${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 每回合概率封印（"每回合N%对手属性技能无效"→move_null chance 门控）
  { id: "deferred-12", re: new RegExp(`^每回合${NUM}%对手属性技能无效$|^每回合${NUM}%(?:的?(?:几|概)?率)?(?:使|令)?对手属性技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1, chance: num(m[1] ?? m[2]) } }] }) },
  // 已损体力百分比加威力（"自身每损失N%的体力值则此技能威力提升M点"）
  { id: "deferred-13", re: new RegExp(`^(?:释放技能时)?自身每损失${NUM}%(?:的)?体力值?则?此技能威力提升(\\d+)点$|^每损失${NUM}%体力威力提升(\\d+)点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { powerPerMissing: { per: ns[0], pow: ns[1] } } }; } },
  // 区间连击（"做2~5次攻击"→hits range；"~"为原文全角波浪）
  { id: "deferred-14", re: new RegExp(`^做?${NUM}\\s*[~～]\\s*${NUM}次(?:连续)?攻击$|^(?:进行|造成)${NUM}\\s*[~～]\\s*${NUM}次攻击$`), go: (m) => ({ attachDamage: { hits: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }) },
  // 无动词百分异常（"对手50%害怕"→ailment chance）
  { id: "deferred-15", re: new RegExp(`^(?:对手|对方|敌方)${NUM}%(?:的?(?:几|概)?率)?(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  // 分数回满变体（"回复1/3的最大体力值"——"的"在分数后）
  { id: "deferred-16", re: new RegExp(`^(?:恢复|回复)${NUM}\\s*/\\s*${NUM}的(?:最大)?体力(?:值)?$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  // 全额攻击吸血（"每次攻击造成的伤害都将恢复自身体力"→drain_atk 1/1）
  { id: "deferred-17", re: /^每次攻击(?:造成的)?伤害都?(?:将|会)?(?:恢复|回复|转化为)(?:自己的|自身)?(?:HP|体力)$/, go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 } }] }) },
  // "每次造成的伤害1/2会恢复自己的HP"（deferred-18 要求「每次造成伤害的N/M」，这条多一个「的」在 N/M 之后）。放在 deferred-18 前面。
  { id: "p1-def-02", re: new RegExp(`^每次造成的伤害${NUM}\s*/\s*${NUM}(?:都|也)?会?(?:恢复|回复)(?:自己的|自身)?(?:HP|hp|体力)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "deferred-18", re: new RegExp(`^每次(?:攻击)?造成伤害的?${NUM}\\s*/\\s*${NUM}(?:都|也)?会?(?:恢复|回复)(?:自己的|自身)?(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // 强化消失触发（"能力强化状态消失则X"→react trigger 7 强化被消除/吸取）
  { id: "deferred-19", re: /^(?:若)?(?:自身)?能力(?:强化|提升)状态?(?:消失|被消除|被消除或吸取|被吸取)(?:时|则)(.+)$|^(?:若)?对手能力(?:强化|提升)状态?(?:消失|被消除)(?:时|则)(.+)$/, go: (m) => m[2] !== undefined ? reactWrap(6, {}, m[2]) : reactWrap(7, {}, m[1]) },
  // 随机技能 PP 清零（"令对手随机2个技能PP值归零"→zeroRandom）
  { id: "deferred-20", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)随机${NUM}个(?:技能)?PP(?:值)?归零$|^${NUM}%(?:的?(?:几|概)?率)?令对手随机${NUM}个技能PP值归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) ? ns[0] : undefined; const cnt = pct !== undefined ? ns[1] : ns[0]; return { effects: [{ op: "pp_delta", zeroRandom: cnt, target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // 当回合免伤/封印（"免疫当回合受到的攻击伤害"）
  { id: "deferred-21", re: /^免疫当回合(?:受到的)?(?:攻击)?伤害$|^当回合免疫(?:对手)?攻击$|^免疫本回合(?:受到的)?伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1 }] }) },
  { id: "deferred-22", re: new RegExp(`^使(?:对手|对方|敌方)本回合攻击技能MISS$|^使(?:对手|对方|敌方)下?${NUM}回合攻击技能MISS$|^使(?:对手|对方|敌方)本回合攻击技能无效$`, "i"), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1] ?? "1"), params: { cat: 4 } }] }) },
  // 次数制先制窗口（"自身下3次攻击先制+1"——行动声明消耗次数）
  { id: "deferred-23", re: new RegExp(`^(?:使|令)?(?:自身|自己)?下?${NUM}次攻击?先制\\+${NUM}$|^(?:自身|自己)下${NUM}次(?:使用)?技能先制\\+${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: ns[0], add: ns[ns.length - 1] } }] }; } },
  // 次数制出伤窗口（"自身下1次攻击技能造成的伤害额外提升100%"）
  { id: "deferred-24", re: new RegExp(`^(?:自身|自己)?下?${NUM}次(?:攻击|攻击技能|技能)(?:造成的)?伤害(?:额外)?(?:提升|提高)${NUM}%$|^下${NUM}次攻击(?:技能)?造成的伤害额外提升${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: ns[0], pct: ns[ns.length - 1] } }] }; } },
  // dmgToHeal 次数制（"令自身下1次受到的攻击伤害转化为体力"）
  { id: "deferred-25", re: new RegExp(`^(?:使|令)?(?:自身|自己)?下?${NUM}次受到的攻击伤害转化为体力$|^下${NUM}次受到的伤害转化为自身体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { count: ns[0] } }] }; } },
  // 护盾条件先制（"自身处于护盾状态下先制+N"/"自身存在护盾则先制+N"）
  { id: "deferred-26", re: new RegExp(`^(?:若)?自身(?:处于|存在)护盾状态?(?:下|时|则)?先制\\+${NUM}$|^自身有护盾(?:时|则)?先制\\+${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { flags: { priorityIf: { when: { selfHas: "shield" }, add: ns[0] } } }; } },
  // 条件先制（体力阈值/自身处于能力强化状态——省略"时/则"的裸条件前缀）。放在 deferred-26 后面，那条吃护盾态。
  { id: "deferred-26b", re: new RegExp(`^(?:自身|自己)?(?:当前)?(?:HP|体力|血量)(?:少于|低于|小于|不足)${NUM}\\s*/\\s*${NUM}(?:时|则)?先制\\+(${NUM})$`), go: (m) => ({ flags: { priorityIf: { when: { selfHpBelow: frac(num(m[1]), num(m[2])) }, add: num(m[3]) } } }) },
  { id: "deferred-26c", re: new RegExp(`^(?:自身|自己)?(?:处于|存在)能力(?:强化|提升)状态(?:时|下|则)?先制\\+(${NUM})$`), go: (m) => ({ flags: { priorityIf: { when: { selfStageUp: true }, add: num(m[1]) } } }) },
  // 消除护盾（"消除对手所有护盾效果"→cleanse scope:shield）
  { id: "deferred-27", re: /^消除(?:对手|对方|敌方)(?:的|所有)?护盾(?:效果|状态)?$|^消除对方护盾$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield" }] }) },
  // 无视护盾穿透（"并无视对手护盾效果"→attachDamage pierceShield）
  { id: "deferred-28", re: /^无视对手护盾(?:效果)?$|^无视对方护盾$|^穿透(?:对手)?护盾$/, go: () => ({ attachDamage: { pierceShield: true } }) },
  // 对手出伤削弱（"对手造成的伤害降低30%"）
  { id: "deferred-29", re: new RegExp(`^(?:对手|对方|敌方)造成的伤害(?:降低|减少|下降)${NUM}%$|^使(?:对手|对方|敌方)造成的伤害(?:降低|减少)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: 100 - ns[0], d: 100 } }] }; } },
  // 转变吸取（"恢复效果转变为吸取对手最大体力的1/3"——吸取等同伤害+回血对）
  { id: "deferred-30", re: new RegExp(`^(?:恢复)?效果?转变为吸取(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$|^转变为吸取(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(ns[0], ns[1]) }, { op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] }; } },
  { id: "deferred-31", re: new RegExp(`^(?:恢复)?效果?转变为吸取(?:对手|对方|敌方)(\\d+)[-~—至到](\\d+)点体力$|^转变为吸取(?:对手|对方|敌方)(\\d+)[-~—至到](\\d+)点体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: 1, flatRange: { min: ns[0], max: ns[1] }, drain: { numerator: 1, denominator: 1 } }] }; } },
  // 控制裸尾/阻断（"无法攻击"——逗号拆分后主语丢失 → opponent 默认）
  { id: "deferred-32", re: /^(对手|对方|敌方|自身|自己|本方|己方|我方)?(?:无法攻击|不能攻击|无法行动|不能行动)$|^(?:使|令)(对手|对方|敌方)(?:无法攻击|不能攻击|无法行动|不能行动)$/, go: (m) => ({ effects: [{ op: "control", name: "stun", target: /自身|自己|本方|己方|我方/.test(m[1] ?? "") ? "self" : "opponent", turns: 1 }] }) },
  // 承伤增减裸句（"受到的伤害减半"/"对手受到的伤害提升30%"）
  { id: "deferred-33", re: /^(?:使|令)?(?:自身|自己)?受到(?:的)?(?:攻击|攻击技能)?伤害减半$|^(?:自身|自己)?受到(?:的)?攻击伤害减半$|^伤害减半$|^伤害减少一半$|^伤害降低一半$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] }) },
  { id: "deferred-34", re: new RegExp(`^(?:对手|对方|敌方)受到的伤害(?:提升|提高|增加)${NUM}%$|^(?:使|令)(?:对手|对方|敌方)受到的伤害(?:提升|增加)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", params: { pct: ns[0] } }] }; } },
  // 直接攻击固伤（"自身直接攻击技能附加N点固定伤害"→attachDamage）
  { id: "deferred-35", re: new RegExp(`^自身直接攻击技能附加(\\d+)点(?:固定)?伤害$|^直接攻击附加(\\d+)点固定伤害$|^攻击技能附加(\\d+)点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatBonus: ns[0] } }; } },
  // 语境尾巴（逗号拆出的无主语句——忽略/留档）
  { id: "deferred-36", re: /^使用成功时$|^作用\d+回合$|^攻击\d+个目标$|^技能有效$|^受到物理攻击时$|^双防$|^(?:攻击|防御|特攻|特防|速度|命中|双防|双攻|全属性)(?:、(?:攻击|防御|特攻|特防|速度|命中|双防|双攻))*$/, go: (m) => /^受到物理攻击时$/.test(m[0]) ? ({ unparsedReason: "reactive trigger — E4" }) : ({ ignored: true }) },
  // 每回合固伤压对手（"对手每回合受到300点固定伤害"→dot_field flat）
  { id: "deferred-37", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)每回合受[到收](\\d+)点(?:固定)?伤害$|^每回合(?:使|令)(?:对手|对方)受[到收](\\d+)点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: ns[0] } }] }; } },
  // 连击上限尾巴（"连击上限为5"→hits cap）
  { id: "deferred-38", re: /^连击上限为(\d+)$|^连击次数上限(?:为)?(\d+)$/, go: (m) => ({ attachDamage: { hitsCap: num(m[1] ?? m[2]) } }) },
  // 伤害转回复变体（"恢复造成伤害的100%的体力"）
  { id: "deferred-39", re: new RegExp(`^恢复造成伤害的(\\d+)%的体力$|^(?:恢复|回复)造成伤害${NUM}%的?体力$|^恢复造成伤害值(\\d+)%的?体力$|^恢复(?:自身)?造成伤害值?${NUM}%的?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: { numerator: ns[0], denominator: 100 } } }; } },
  // PP 消耗倍率压对手（"对手使用技能消耗的PP值变为3倍"）
  { id: "deferred-40", re: new RegExp(`^(?:对手|对方|敌方)(?:使用)?技能消耗的PP值变为?(\\d+)倍$|^(?:使|令)(?:对手|对方|敌方)技能PP消耗变为?(\\d+)倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "pp_double", target: "opponent", params: { mul: ns[0] } }] }; } },
  // "使对手其N%概率被X"/"被X"被动语态异常（其=语气填充）
  { id: "deferred-41", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)其?${NUM}%(?:的?(?:概率|几率))?(?:被|进入|陷入)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  { id: "deferred-42", re: new RegExp(`^(?:对手|对方|敌方)有${NUM}%(?:的?(?:概率|几率))?(?:被|进入|陷入)?(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  // "使自身下N次技能先制+K"（使/令前缀 + 次数窗）
  { id: "deferred-43", re: new RegExp(`^(?:使|令)(?:自身|自己)下${NUM}次(?:攻击)?技能先制([+-]?)(\\d+)$`), go: (m) => { const v = num(m[3]); return { effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: num(m[1]), add: m[2] === "-" ? -v : v } }] }; } },
  // "自身攻击附加对手最大体力N/M固伤"（攻击前缀变体——flatFoeFrac）
  { id: "deferred-44", re: new RegExp(`^(?:自身|自己)?攻击(?:技能)?附加(?:对手|对方|敌方)最大体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定伤害|固伤)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[0], denominator: ns[1], base: "max" } } }; } },
  // "若P则效果翻倍"（条件倍增——attachAll.mulIf 由宿主 op 挂载：damage/heal 有 mulIf 槽位）
  { id: "deferred-45", re: /^若(.{2,20}?)则(?:效果|伤害|恢复|回复)翻倍$/, go: (m) => { const cond = condOf(m[1]); return cond !== undefined ? { attachAll: { mulIf: { when: cond, numerator: 2, denominator: 1 } } } : { unparsedReason: `mulIf cond unparsed: ${m[1]}` }; } },
  // "未受到攻击则效果翻倍"（否定条件倍增——prevTakenZero 近似"未受击"UNVERIFIED）
  { id: "deferred-46", re: /^未(?:受到|遭受)(?:攻击|攻击伤害|伤害)(?:则|，|,)?(?:提升|提高|增加)?(?:效果|伤害|恢复|回复)翻倍$/, go: () => ({ attachAll: { effectDouble: true, effCond: { prevTakenZero: true } } }) },
  // "自身攻击命中后吸取对手最大体力N/M"（命中骑带：flatFoeFrac 固伤 + drain 1/1 等额回吸）
  { id: "deferred-47", re: new RegExp(`^(?:自身|自己)?的?攻击命中后吸取(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$|^命中后吸取(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$|^(?:自身|自己)?攻击技能吸取(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[ns.length - 2], denominator: ns[ns.length - 1], base: "max" }, drain: { numerator: 1, denominator: 1 } } }; } },
  // "附加对手当前体力N/M的固伤"（flatFoeFrac base:current 变体）
  { id: "deferred-48", re: new RegExp(`^附加(?:对手|对方|敌方)当前体力(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:固伤|固定伤害)$`), go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "current" } } }) },
  // "附加N固伤"/"附加N点固定伤害"（flatBonus 短形）
  { id: "deferred-49", re: new RegExp(`^附加${NUM}(?:点)?固伤$|^附加${NUM}点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2]) } }) },
  // "造成的攻击伤害提升N%"/"攻击伤害提升N%"（dmg_boost 变体）
  { id: "deferred-50", re: new RegExp(`^(?:自身|自己)?(?:造成的|打出)?攻击伤害(?:提升|提高|增加)${NUM}%$|^攻击造成的伤害提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "N%令自身攻击技能先制+K"（chance + cat:4 先制窗）
  { id: "deferred-51", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(?:令|使)自身(?:攻击技能|技能)?先制(?:额外)?([+-]?)${NUM}$`), go: (m) => { const v = num(m[3]); const cat = /攻击/.test(m[0]) ? { cat: 4 } : {}; return { effects: [{ op: "apply_status", name: "prio_up", target: "self", chance: num(m[1]), params: { add: m[2] === "-" ? -v : v, ...cat } }] }; } },
  // "令/使自身先制(额外)+N"——dynChance 前缀语境下的先制窗（"50%的几率使自身先制额外+2"——chance 由 dynChance 注入）
  { id: "deferred-52", re: new RegExp(`^(?:令|使|让)自身(?:攻击技能|技能)?先制(?:额外)?([+-]?)${NUM}$|^自身先制(?:额外)?([+-]?)${NUM}$`), go: (m) => { const s = m[1] ?? m[3]; const v = num(m[2] ?? m[4]); return { effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: s === "-" ? -v : v } }] }; } },
  // "攻击N%几率打出致命一击"（on-hit crit 窗——rider 语境由外层 hook 承载）
  { id: "deferred-53", re: new RegExp(`^(?:自身|自己)?攻击${NUM}%的?(?:概率|几率)?打出致命[一1]?击$|^攻击${NUM}%致命[一1]?击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", turns: 1, params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // "自身攻击和特攻等于其中最高的一项" → unify_offense
  { id: "deferred-54", re: /^(?:自身|自己)?攻击(?:和|与|特攻和)?特攻(?:值)?等于(?:其中)?最高(?:的)?一项$|^攻击和特攻取(?:其中)?最高值$/, go: () => ({ effects: [{ op: "apply_status", name: "unify_offense", target: "self" }] }) },
  // "使用技能无视对手能力提升状态"（内层变体——soulmark 体级复用 pierce_stages）
  { id: "deferred-55", re: /^使用技能无视(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)状态$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "攻击技能造成的攻击伤害提升N%"/"技能伤害提升N%"（dmg_boost 动词链变体）
  { id: "deferred-56", re: new RegExp(`^(?:攻击技能|技能|攻击)?造成的?攻击伤害(?:提升|提高|增加)${NUM}%$|^(?:攻击技能|技能)伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "使敌我双方受到的攻击伤害提升N%"（双侧承伤加深——dmg_taken_up flag）
  { id: "deferred-57", re: new RegExp(`^(?:使|令)?敌我双方受到的?(?:攻击)?伤害(?:提升|提高|增加)${NUM}%$|^双方受到的攻击伤害提升${NUM}%$`), go: (m) => { const p = num(m[1] ?? m[2]); return { effects: [{ op: "apply_status", name: "dmg_taken_up", target: "self", params: { pct: p } }, { op: "apply_status", name: "dmg_taken_up", target: "opponent", params: { pct: p } }] }; } },
  // "恢复比例提升至N%" → heal_boost
  { id: "deferred-58", re: new RegExp(`^(?:自身)?恢复(?:比例|效果|量)(?:提升|提高|增加)(?:至|到|为)?${NUM}%$|^回复效果提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_boost", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "自身恢复最大体力的N/M"/"自身恢复N点体力" → heal
  { id: "deferred-59", re: new RegExp(`^自身恢复(?:自身)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$|^自身恢复${NUM}点(?:体力|HP)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return ns.length === 2 ? { effects: [{ op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] } : { effects: [{ op: "heal", flat: ns[0], target: "self" }] }; } },
  // "自身恢复全部PP值" → pp_delta full
  { id: "deferred-60", re: /^(?:自身|自己)?恢复全部PP值?$|^自身恢复所有PP值?$/, go: () => ({ effects: [{ op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "百分比伤害额外减少N%" → pct_taken_pct
  { id: "deferred-61", re: new RegExp(`^百分比伤害(?:额外)?(?:减少|降低|下降)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pct_taken_pct", target: "self", params: { pct: num(m[1]) } }] }) },
  // "自身处于X状态时改为抵挡本次攻击"（条件免伤——dmg_immune + selfHas 守卫）
  { id: "deferred-62", re: new RegExp(`^(?:自身|自己)?处于(${AIL_RE})(?:状态)?时?改为抵挡本次攻击$|^改为抵挡本次攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1, params: { count: 1 }, ...(m[1] !== undefined ? { if: { selfHas: AILMENTS[m[1]] } } : {}) }] }) },
  // "造成的伤害随机提升N%-M%"（mulRange——本击 roll 的出伤区间）
  { id: "deferred-63", re: new RegExp(`^造成的(?:攻击)?伤害随机提升${NUM}%[-~—至到]${NUM}%$|^伤害随机提升${NUM}%[-~—至到]${NUM}%$|^随机提升${NUM}%[-~—至到]${NUM}%(?:的)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mulRange: { min: ns[0], max: ns[1] } } }; } },
  // "随机令对手N个技能PP值归零"（pp_delta zeroRandom）
  { id: "deferred-64", re: new RegExp(`^随机令(?:对手|对方|敌方)${NUM}个技能PP值?归零$|^随机使(?:对手|对方|敌方)${NUM}个技能PP值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "自身攻击额外忽略对手N%的双防值"（持久窗——魂印语境无 count）
  { id: "deferred-65", re: new RegExp(`^(?:自身|自己)攻击额外忽略(?:对手|对方|敌方)${NUM}%的?(?:双防|防御)(?:值)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: num(m[1]) } }] }) },
  // "令对手当回合使用的攻击技能威力下降N%" → power_mul 对手衰减
  { id: "deferred-66", re: new RegExp(`^令对手当回合(?:内)?使用的攻击技能威力下降${NUM}%$|^令对手当回合(?:内)?使用的技能威力下降${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "power_mul", target: "opponent", turns: 1, params: { n: 100 - num(m[1] ?? m[2]), d: 100 } }] }) },
  // "自身攻击N%秒杀对手"（命中骑带 OHKO——percent KO + chance）
  { id: "deferred-67", re: new RegExp(`^(?:自身|自己)的?攻击(?:技能)?(?:有|附?有|附带)?${NUM}%的?(?:概率|几率|机会)?秒杀(?:对手|对方|敌方)$|^攻击${NUM}%秒杀(?:对手|对方|敌方)$`), go: (m) => ({ effects: [{ op: "damage", power: 100, kind: "percent", chance: num(m[1] ?? m[2]) }] }) },
  // "第一回合所有攻击先制+N" → prio_up 窗（首回合语素由触发层接管）
  { id: "deferred-68", re: new RegExp(`^所有攻击先制([+-])${NUM}$|^全部攻击先制([+-])${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }) },
  // "附加的固定伤害效果翻倍" → flatMul 2/1
  { id: "deferred-69", re: new RegExp(`^附加的?固定伤害效果翻倍$|^固伤效果翻倍$|^附加的?固伤效果翻倍$`), go: () => ({ attachDamage: { flatMul: { numerator: 2, denominator: 1 } } }) },
  // "使用攻击技能N%令对手X"（技能骑带异常——reactWrap(12) 每击门控）
  { id: "deferred-70", re: new RegExp(`^使用攻击技能${NUM}%(?:的?(?:概率|几率))?令对手(${AIL_RE})(?:状态)?$`), go: (m) => { const r = reactWrap(12, {}, `令对手${m[2]}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1]); return r; } },
  // 数字编码维无符号尾数（"100%改变自身1等级1"→code+值，UNVERIFIED 六维序）
  { id: "deferred-71", re: new RegExp(`^(?:技能使用成功时[，,]?)?${NUM}%(?:的?(?:几|概)?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)([1-6])(?:等级)?(\\d+)$`), go: (m) => { const STAT_CODES = ["atk", "def", "spa", "sdf", "spd", "acc"]; return { effects: [stageFx(STAT_CODES[num(m[3]) - 1], num(m[4]), tgt(m[2]), pct(m[1]))] }; } },
  // 和字枚举多维（"自身防御和特防等级+1"/"防御、特防等级+1"）
  { id: "deferred-72", re: new RegExp(`^(自身|自己|对手|对方|敌方)?(${STAT_RE})(?:和|、)(${STAT_RE})(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[4] === "-" ? -1 : 1) * num(m[5]); const t = m[1] ? tgt(m[1]) : "self"; return { effects: [stageFx(STATS[m[2]], d, t), stageFx(STATS[m[3]], d, t)] }; } },
  // 伤害转区间固伤（"变为300-500点固定伤害"——裸尾巴）
  { id: "deferred-73", re: new RegExp(`^(?:伤害)?变为(\\d+)[-~—至到](\\d+)点(?:固定|固伤)?伤害$|^伤害变为(\\d+)[-~—至到](\\d+)点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatRange: { min: ns[0], max: ns[1] } } }; } },
  // 禁疗窗口（"使对手当回合内无法通过技能恢复自身体力"）
  { id: "deferred-74", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:当|本)?回合(?:内)?无法(?:通过技能)?恢复(?:自身)?体力$|^使对手无法通过技能恢复体力$`), go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent" }] }) },
  // 攻击技能失效次数制（"令对手下2次使用的攻击技能无效"）
  { id: "deferred-75", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)下?${NUM}次使用的?攻击技能无效$|^使对手下${NUM}次攻击技能无效$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: ns[0], cat: 4 } }] }; } },
  // "N%令对手攻击技能失效"（概率招式无效——move_null chance + cat:4）
  { id: "deferred-76", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(?:令|使)(?:对手|对方|敌方)(?:的)?攻击技能(?:无效|失效)$|^${NUM}%(?:的?(?:概率|几率))?(?:使|令)对手技能失效$`), go: (m) => { const cat = /攻击/.test(m[0]) ? { cat: 4 } : {}; return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", chance: num(m[1] ?? m[2]), params: { count: 1, ...cat } }] }; } },
  // "令对手当回合无法通过自身技能恢复体力" → heal_block turns:1
  { id: "deferred-77", re: /^(?:令|使)(?:对手|对方|敌方)当回合(?:内)?无法通过(?:自身)?技能恢复(?:自身)?体力$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: 1 }] }) },
  { id: "deferred-78", re: /^(?:当|本)回合(?:对手|对方|敌方)无法(?:通过(?:自身)?技能)?恢复(?:自身)?体力$|^当回合无法通过技能恢复体力$|^(?:对手|对方|敌方)(?:当|本)回合无法恢复(?:自身)?(?:体力|HP)$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: 1 }] }) },
  // 自身/对手 体力分数固伤（"附加自身当前体力1/2的固定伤害"/"附加对手已损失生命值30%的固定伤害"）
  { id: "deferred-79", re: new RegExp(`^附加自身当前体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定|固伤)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatSelfFrac: { numerator: ns[0], denominator: ns[1], base: "current" } } }; } },
  { id: "deferred-80", re: new RegExp(`^附加(?:对手|对方|敌方)已损失生命(?:值|力)?的?${NUM}%(?:的)?(?:固定|固伤)?伤害$|^附加对手已损失体力${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[0], denominator: 100, base: "missing" } } }; } },
  { id: "deferred-81", re: new RegExp(`^附加(?:对手|对方|敌方)已损失生命(?:值|力)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定|固伤)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[0], denominator: ns[1], base: "missing" } } }; } },
  // 全额扣血分数（"所有直接攻击都将降低对手1/3的HP"→flatFoeFrac max，UNVERIFIED 基线）
  { id: "deferred-82", re: new RegExp(`^(?:所有|每次)?直接攻击(?:都)?将?降低(?:对手|对方|敌方)的?${NUM}\\s*/\\s*${NUM}的?(?:HP|体力)$|^直接攻击降低对手${NUM}\\s*/\\s*${NUM}的?HP$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[0], denominator: ns[1], base: "max" } } }; } },
  // 受损基线回复（"恢复当前受损体力值1/3的体力"）
  { id: "deferred-83", re: new RegExp(`^恢复(?:自身)?(?:当前)?(?:受损|已损失)(?:体力|血量|生命值?)(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:体力|血量)?$|^恢复已损失(?:体力|血量)的${NUM}\\s*/\\s*${NUM}$|^恢复(?:自身)?(?:当前)?(?:受损|已损失)(?:体力|血量|生命值?)(?:值)?的?${NUM}%(?:的)?(?:体力|血量)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[ns.length - 2] ?? ns[0], denominator: ns[ns.length - 2] !== undefined ? ns[ns.length - 1] : 100, target: "self", missing: true }] }; } },
  // 概率先制（"30%几率先制+2"→1回合 prio_up + chance）
  { id: "deferred-84", re: new RegExp(`^${NUM}%的?(?:几率|概率)?先制\\+${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, chance: ns[0], params: { add: ns[ns.length - 1] } }] }; } },
  // 概率免伤被动（"受到攻击时有30%概率免疫"）
  { id: "deferred-85", re: new RegExp(`^受到攻击时有?${NUM}%(?:的?概率)?免疫$|^受击时${NUM}%免疫$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: ns[0] } }] }; } },
  // 回合类效果失效（"令对手当前拥有的回合类效果失效"）
  { id: "deferred-86", re: /^(?:令|使|让)(?:对手|对方|敌方)当前拥有的?回合类效果失效$|^消除(?:对手|对方)回合类效果$|^使对手回合类效果失效$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // 多目标定向解除（"解除自身的烧伤、冻伤、中毒效果"）
  { id: "deferred-87", re: new RegExp(`^解除(自身|自己)的?((?:${AIL_RE})(?:、|或|，|,)?)+(?:效果|状态)?$`), go: (m) => { const list = [...m[2].matchAll(new RegExp(AIL_RE, "g"))].map((x) => AILMENTS[x[0]]); if (list.length < 2) return null; return { effects: list.map((effect) => ({ op: "cleanse", target: tgt(m[1]), scope: "ailment", effect })) }; } },
  // 定额护盾创造（"为自身创造1个生命值为350的护盾"）
  { id: "deferred-88", re: new RegExp(`^为自身创造${NUM}个生命值为(\\d+)的护盾$|^(?:使|令)?自身获得(\\d+)点护盾$|^获得(\\d+)点护盾$|^为自身创造(\\d+)点护盾$|^(?:使|令)?(?:自身|自己)?获得${NUM}个${NUM}点的?护盾$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const cnt = m[6] !== undefined ? ns[0] : undefined; return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[ns.length - 1], ...(cnt !== undefined ? { count: cnt, each: ns[ns.length - 1] } : {}) } }] }; } },
  // 条件免伤（"若受到的伤害低于N则免疫伤害"→dmg_floor 谓词不可靠作反应式，记低伤免疫窗口）
  { id: "deferred-89", re: new RegExp(`^若受到的伤害低于(\\d+)则免疫$|^受到的伤害低于(\\d+)(?:点)?则免疫$|^免疫低于(\\d+)的伤害$|^若?对手造成的伤害低于(\\d+)(?:点)?则免疫(?:该)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_floor", target: "self", params: { min: ns[0] } }] }; } },
  // 元标记/留档
  { id: "deferred-90", re: /^组队可用$|^组队模式可用$|^仅组队可用$|^组队$|^组队可$/, go: () => ({ unparsedReason: "meta flag — non-battle" }) },
  { id: "deferred-91", re: /^反弹(?:对手|对方|敌方)的?致命[一1]?击$|^反弹致命[一1]?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_reflect", target: "self" }] }) },
  // 致命率分数提升（"致命一击几率上升1/4"→招式级 critChanceFrac）
  { id: "deferred-92", re: new RegExp(`^致命[一1]?击?(?:几率|概率|率)?(?:上升|提升|提高|增加|\\+)${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  { id: "deferred-93", re: new RegExp(`^致命[一1]?击?(?:几率|概率|率)(?:上升|提升|提高|增加)${NUM}%$`), go: (m) => ({ attachDamage: { critChance: num(m[1]) } }) },
  // "容易打出致命一击"（官方易致命≈要害率翻倍 1/16→1/8，UNVERIFIED 系数）
  { id: "deferred-94", re: /^(?:很|非常|十分)?(?:较|极|更|容)?易打出致命[一1]?击$|^(?:很|非常|十分)?(?:较|极|更|容)?易造成致命[一1]?击$/, go: () => ({ attachDamage: { critChanceFrac: { numerator: 1, denominator: 8 } } }) },
  // "若体力不足300则剩1点"（省「自身」+「剩」省字）。放在 deferred-95 前面，那条要求「若自身体力不足」。
  { id: "deferred-95a", re: new RegExp(`^若(?:自身|自己)?体力不足(\\d+)则剩(?:下)?(\\d+)点(?:体力|HP|血)?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: num(m[2]), if: { selfHpBelowAbs: num(m[1]) } }] }) },
  { id: "deferred-95", re: new RegExp(`^若自身体力不足(\\d+)则剩下(\\d+)点体力$|^若自身体力不足(\\d+)则损失全部体力$`), go: (m) => m[3] !== undefined
    ? { effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: 0, if: { selfHpBelowAbs: num(m[3]) } }] }
    : { effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: num(m[2]), if: { selfHpBelowAbs: num(m[1]) } }] } },
  { id: "deferred-96", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)剩余(\\d+)点体力$|^(?:使|令)?(?:对手|对方|敌方)(?:体力)?(?:剩下|剩余|留下)(\\d+)点(?:体力)?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, target: "opponent", leaveHp: num(m[1] ?? m[2]) }] }) },
  { id: "deferred-97", re: new RegExp(`^(?:自身|自己)?(?:剩下|剩余|留下)(\\d+)点体力$|^自身(?:体力)?(?:剩下|剩余)(\\d+)点$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: num(m[1] ?? m[2]) }] }) },
  { id: "deferred-98", re: /^损失全部体力$|^损失自身全部体力$|^自身损失全部体力$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: 0 }] }) },
  { id: "deferred-99", re: /^致命[+-]\d+$|^致命(?:等级)?[+-]\d+$/, go: () => ({ unparsedReason: "crit stage — sixstat 无致命维度" }) },
  { id: "deferred-100", re: new RegExp(`^解除(?:自身|自己)的((?:${AIL_RE})(?:[、,，](?:${AIL_RE}))+)(?:状态|效果)?$|^解除(?:自身|自己)的(${AIL_RE})(?:状态|效果)?$`), go: (m) => { const list = (m[1] ?? m[2]).split(/[、,，]/).map((x) => AILMENTS[x]).filter(Boolean); return { effects: [{ op: "cleanse", target: "self", ...(list.length > 1 ? { effect: list } : { effect: list[0] }) }] }; } },
  { id: "deferred-101", re: new RegExp(`^(?:攻击技能)?吸取(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}最大体力值?$|^攻击技能吸取(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "fixed", power: 1, flatFoeFrac: { numerator: ns[0], denominator: ns[1], base: "max" }, drain: { numerator: 1, denominator: 1 } }] }; } },
  { id: "deferred-102", re: /^若自身体力不足/, go: () => ({ unparsedReason: "conditional endure — unverified semantics" }) },
  // 回合制免伤（"免疫下N回合受到的攻击伤害"）
  { id: "deferred-103", re: new RegExp(`^免疫下${NUM}回合受到的?(?:攻击|攻击伤害|伤害)$|^免疫${NUM}回合内?受到的?(?:攻击)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: ns[0] }] }; } },
  // 战斗最大HP削减（"降低对方N点战斗时的最高HP"）
  { id: "deferred-104", re: new RegExp(`^降低(?:对方|对手|敌方)(${NUM})点?(?:精灵)?战斗时的最高HP$|^降低(?:对方|对手)(?:的)?最高HP${NUM}点$|^使(?:对方|对手)战斗时的最高HP降低${NUM}点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: ns[0] } }] }; } },
  // 能力下降裸尾（"下降状态" 孤立片段——无法确定主体，留档）
  { id: "deferred-105", re: /^下降状态$|^能力下降状态$|^的能力下降状态$/, go: () => ({ unparsedReason: "stage-down tail (context lost)" }) },
  // 护盾消耗（"消耗自身所有护盾值"——转换语义随语境变化，留档）
  { id: "deferred-106", re: /(?:减少|附加|恢复|造成|扣除)[a-z]点|护盾值总和/, go: () => ({ unparsedReason: "variable-n reference (paren-defined quantity) — E4" }) },
  { id: "deferred-107", re: /^(?:若)?对手使用的?(?:属性|攻击)技能/, go: () => ({ unparsedReason: "reactive on foe action choice — E4" }) },
  // 惩罚族/逆血量缩放："对方能力等级越高威力越大"、"自身体力越少威力越大"——方向明确但系数未公示
  { id: "deferred-108", re: /惩罚|能力等级越高.{0,6}威力(?:越大|越高)|(?:体力|HP|生命值)(?:越少|越低)(?:则|,|，)?威力(?:越大|越高|翻倍|提升)/, go: () => ({ unparsedReason: "stage-scaled power (coefficient undocumented) — UNVERIFIED" }) },
  { id: "deferred-109", re: /^消耗自身(?:所有|全部)护盾值?$|^消耗(?:所有|全部)护盾$/, go: () => ({ unparsedReason: "shield consume — E4" }) },
  // 护盾消失/击穿触发（"护罩消失时X"/"护盾消失时100%使对手诅咒"→react trigger4）
  { id: "deferred-110", re: /^(?:护盾|护罩)消失时(.+)$|^(?:护盾|护罩)被击破时(.+)$|^(?:护盾|护罩)消失后(.+)$/, go: (m) => reactWrap(4, {}, m[1] ?? m[2] ?? m[3]) },
  // 护盾值反噬（"附加对手护盾值N%的固定伤害"→flatFoeShieldPct）
  { id: "deferred-111", re: new RegExp(`^附加(?:对手|对方|敌方)护盾值(?:的)?${NUM}%(?:的)?(?:固定|真实|百分比)?伤害$|^附加等同于对手护盾值${NUM}%的固定伤害$`), go: (m) => ({ attachDamage: { flatFoeShieldPct: num(m[1]) } }) },
  // 消盾反噬（"消除对手所有护盾、护罩效果，并附加等同于消除护盾护罩值总和N%的百分比伤害"→cleanse shield + echoPct）
  { id: "deferred-112", re: new RegExp(`^消除(?:对手|对方|敌方)(?:的|所有)?(?:护盾|护罩|屏障)(?:[、，,](?:护盾|护罩|屏障))*效果?[，,]?并?附加等同于消除(?:护盾|护罩|屏障)?[、，,]?(?:护盾|护罩|屏障)?值?总和(?:的)?${NUM}%(?:的)?(?:百分比|固定)?伤害$`), go: (m) => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield", echoPct: num(m[1]) }] }) },
  { id: "deferred-113", re: /^消除(?:对手|对方|敌方)(?:的|所有)?(?:护盾|护罩|屏障)(?:[、，,](?:护盾|护罩|屏障))*(?:效果|状态)?$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield" }] }) },
  // "对手每存在N点护盾则伤害提升M倍"——护盾量线性倍率，系数语义歧义（累乘/累加）→UNVERIFIED
  { id: "deferred-114", re: new RegExp(`^对手每存在${NUM}点护盾则(?:造成的)?(?:攻击)?伤害提升${NUM}倍$`), go: () => ({ unparsedReason: "per-shield-flat mul — stacking semantics undocumented (UNVERIFIED)" }) },
  // "随机降低对手N/M至M/K当前体力"→fracRange（percent 区间随机）
  { id: "deferred-115", re: new RegExp(`^随机降低(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}至${NUM}\\s*/\\s*${NUM}(?:当前)?体力$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", fracRange: { min: frac(m[1], m[2]), max: frac(m[3], m[4]) }, percentBase: "current", target: "opponent", power: 0 }] }) },
  // 自身当前体力%固伤（"附加自身当前体力30%的固定伤害"）
  { id: "deferred-116", re: new RegExp(`^附加自身当前体力(?:值)?的?(\\d+)%(?:的)?(?:固定|固伤)?伤害$|^附加(\\d+)%(?:自身)?当前体力(?:值)?的伤害$|^造成自身当前体力(\\d+)%的(?:固定)?伤害$`), go: (m) => ({ attachDamage: { flatSelfCurPct: num(m[1] ?? m[2] ?? m[3]) } }) },
  // 裸多维同值升段（"防御、特防+1"——顿号枚举共享值）
  { id: "deferred-117", re: new RegExp(`^(${STAT_RE})(?:、(${STAT_RE}))*(\\+|-)(${NUM})$`), go: (m) => { const stats = []; const re = new RegExp(STAT_RE, "g"); let sm; const head = m[0].replace(/[+\-].*$/, ""); while ((sm = re.exec(head)) !== null) stats.push(STATS[sm[0]]); if (stats.length < 1) return null; const d = num(m[m.length - 1]) * (m[m.length - 2] === "-" ? -1 : 1); return { effects: stats.map((stat) => ({ op: "apply_stat_stage", stat, delta: d, target: "self" })) }; } },
  { id: "deferred-118", re: new RegExp(`^每次使用额外提升(\\d+)%$|^每次使用[\\u4e00-\\u9fff]{0,4}(?:概率|几率)(?:增加|提升|提高)(\\d+)%$|^每次使用(?:威力)?(?:提升|增加)(\\d+)%$|^每次增加(\\d+)%$`), go: (m) => { if (m[2] !== undefined) return { attachAll: { chancePerUse: num(m[2]) } }; const pct = num(m[1] ?? m[3] ?? m[4]); return { attachDamage: { powerMulPerUse: { numerator: 100 + pct, denominator: 100 } } }; } },
  // 叠用连击（"每次使用攻击次数+1"→hits.perUse；"最大攻击次数N次"→hits.cap 尾巴）
  { id: "deferred-119", re: new RegExp(`^(?:每次使用|连续使用每次|连续使用|每次)(?:攻击次数|攻击数)\\+?(\\d+)$|^攻击次数\\+(\\d+)$`), go: (m) => ({ attachDamage: { hits: { perUse: num(m[1] ?? m[2]) } } }) },
  { id: "deferred-120", re: new RegExp(`^最大攻击次数(\\d+)次$|^至多攻击(\\d+)次$|^最高(\\d+)次$`), go: (m) => ({ attachDamage: { hitsCap: num(m[1] ?? m[2] ?? m[3]) } }) },
  // 免疫异常裸句（"不会出现异常"）
  { id: "deferred-121", re: /^(?:自身|自己)?(?:不会|无法)(?:出现|陷入|受到)?异常(?:状态)?$|^(?:自身|自己)不会出现异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // 次数制承伤减免（"下N次受到的攻击伤害减少N%"）
  { id: "deferred-122", re: new RegExp(`^(?:使|令)?(?:自身|自己)?下?${NUM}次受到的?(?:攻击)?伤害(?:减少|降低)${NUM}%$|^下${NUM}次(?:被|受到)攻击伤害减少${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { count: ns[0], pct: ns[ns.length - 1] } }] }; } },
  // 条件回满（"体力低于1/3则回满"）
  { id: "deferred-123", re: new RegExp(`^体力低于${NUM}\\s*/\\s*${NUM}则?(?:回满|恢复满|回满体力|恢复所有体力)$|^自身体力低于${NUM}\\s*/\\s*${NUM}则回满$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", if: { selfHpBelow: { numerator: ns[0], denominator: ns[1] } } }] }; } },
  // 低伤追加自HP%固伤（"造成的伤害低于300则附加自身最大体力30%的固定伤害"）
  { id: "deferred-124", re: new RegExp(`^造成的伤害低于(\\d+)(?:点)?则?(?:额外)?附加自身最大体力${NUM}%的?(?:固定|固伤)?伤害$|^造成的伤害低于(\\d+)则附加自身最大体力${NUM}%的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatIfBelow: { min: ns[0], selfPct: ns[1] } } }; } },
  // 秒杀（"N%概率秒杀对方"=percent KO；kind:percent power100 + chance 门控）
  { id: "deferred-125", re: new RegExp(`^有?${NUM}%的?(?:概率|几率)?秒杀(?:对方|对手|敌方)?$|^有?${NUM}%几率秒杀|^秒杀(?:对方|对手|敌方)$|^(?:自身|自己)(?:的)?(?:所有)?攻击技能?都?附?有?${NUM}%的?秒杀概率$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = ns.length > 0 ? ns[0] : 100; return { effects: [{ op: "damage", power: 100, kind: "percent", ...(pct < 100 ? { chance: pct } : {}) }] }; } },
  // 承伤减免%（"减少受到伤害的30%"/"受到的伤害减少30%"）
  { id: "deferred-126", re: new RegExp(`^(?:减少|降低)(?:自身|自己)?受到(?:的)?伤害的?${NUM}%$|^受到的伤害(?:减少|降低)${NUM}%$|^减少受到伤害${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // 减少下回合所受伤害定值（"减少300点下回合所受的伤害"）
  { id: "deferred-127", re: new RegExp(`^(?:减少|降低)(\\d+)点下回合(?:自身|自己)?所受?的?伤害$|^下回合受到的伤害(?:减少|降低)(\\d+)点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: 1, params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 每回合伤害反弹分数（"每回合反弹对手1/3的伤害"）
  { id: "deferred-128", re: new RegExp(`^每回合反弹(?:对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}的?伤害$|^反弹${NUM}\\s*/\\s*${NUM}的?伤害$|^反弹受到的?伤害的?${NUM}%$|^反弹${NUM}%的?伤害$|^反弹受到伤害的${NUM}\\s*/\\s*${NUM}$|^反弹(?:对手|对方|敌方)?受到伤害的${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const f = ns.length === 1 ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] }; return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: f }] }; } },
  // 命中概率固伤（"每次攻击有35%的概率附加35点固定伤害"）
  // "每回合增加30点固定伤害"（deferred-129 的动词只收「附加」）。放在 deferred-129 前面。
  { id: "p1-def-01", re: new RegExp(`^每回合(?:内)?增加([0-9]+)点(?:固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: num(m[1]) } }] }) },
  { id: "deferred-129", re: new RegExp(`^每次攻击有${NUM}%的?(?:概率|几率)?附加(\\d+)点(?:固定|固伤)?伤害$|^攻击附加(\\d+)点固定伤害$|^附加(\\d+)点固定伤害$|^每回合(?:使用技能)?附加(\\d+)点(?:固定|固伤)?伤害$|^使用技能附加(\\d+)点(?:固定|固伤)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); if (/^每回合使用技能|^使用技能/.test(m[0])) return { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: ns[0] } }] };
    if (/^每回合/.test(m[0])) return { effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: ns[0] } }] }; return /%/.test(m[0]) ? { attachDamage: { flatOnHit: { chance: ns[0], flat: ns[1] } } } : { attachDamage: { flatBonus: ns[0] } }; } },
  // 阶梯固伤（"每处于N种能力强化状态附加M点固伤"/"对手每残留N%体力附加M点固伤"）
  { id: "deferred-130", re: new RegExp(`^(?:自身|自己)每处于${NUM}种能力(?:强化|提升)状态(?:则|,|，)?附加(\\d+)点(?:固定|固伤)?伤害$|^每处于${NUM}种能力(?:强化|提升)状态附加(\\d+)点(?:固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerStage: { who: "self", sign: "up", per: ns[0], flat: ns[1] } } }; } },
  { id: "deferred-131", re: new RegExp(`^(?:对手|对方|敌方)每处于(?:1|一|${NUM})(?:种|项|个)能力下降状态(?:时)?(?:则|,|，)?(?:当回合|本回合)?(?:(?:攻击|攻击技能)?命中后?)?附加(\\d+)点(?:固定|固伤)?伤害$|^对手每处于一种能力下降状态时附加(\\d+)点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerStage: { who: "foe", sign: "down", per: ns.length > 1 ? ns[0] : 1, flat: ns[ns.length - 1] } } }; } },
  { id: "deferred-131b", re: new RegExp(`^(?:自身|自己)每处于(?:1|一|${NUM})(?:种|项|个)?异常状态(?:时)?(?:则|,|，)?(?:攻击技能)?(?:攻击|攻击技能)?附加(\\d+)点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatPerAilment: num(m[2]) } }) },
  // "对手每处于N种能力提升状态则附加K点固伤" → flatPerStage foe+up
  { id: "deferred-132", re: new RegExp(`^(?:对手|对方|敌方)每处于(?:1|一|${NUM})(?:种|项|个)能力(?:提升|强化)状态(?:时)?(?:则|,|，)?附加(\\d+)点(?:固定|固伤)?伤害$|^对手每处于一种能力(?:提升|强化)状态(?:则)?附加(\\d+)点(?:固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerStage: { who: "foe", sign: "up", per: ns.length > 1 ? ns[0] : 1, flat: ns[ns.length - 1] } } }; } },
  { id: "deferred-133", re: new RegExp(`^(?:对手|对方|敌方)每残留${NUM}%的?体力(?:值)?(?:则|,|，)?(?:此技能)?附加(\\d+)点(?:固定|固伤)?伤害$|^释放技能时对手每残留${NUM}%的?体力值?则?此技能附加(\\d+)点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerHpPct: { who: "foe", per: ns[0], flat: ns[1] } } }; } },
  { id: "deferred-134", re: new RegExp(`^(?:自身|自己)每减少了?${NUM}项能力(?:的)?等级(?:则|,|，)?附加(\\d+)点(?:真实|固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerStage: { who: "self", sign: "down", per: ns[0], flat: ns[1] } } }; } },
  // 阶梯吸血（"自身每有1级能力下降状态吸取对手60点体力"——级数总和计；drain=等额回血）
  { id: "deferred-135", re: new RegExp(`^(?:自身|自己)每有?${NUM}级能力(?:下降|弱化)状态(?:时)?(?:则|,|，)?(?:吸取|吸收)(?:对手|对方|敌方)(\\d+)点(?:体力|HP)$`), go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "down", per: num(m[1]), flat: num(m[2]), mode: "levels", drain: true } } }) },
  { id: "deferred-136", re: new RegExp(`^(?:对手|对方|敌方)每有?${NUM}级能力(?:强化|提升)(?:状态)?(?:时)?(?:则|,|，)?(?:吸取|吸收)(?:对手|对方|敌方)?(\\d+)点(?:体力|HP)$|^(?:自身|自己)每有?${NUM}级能力(?:强化|提升)(?:状态)?(?:时)?(?:则|,|，)?(?:吸取|吸收)(?:对手|对方|敌方)(\\d+)点(?:体力|HP)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const foe = m[3] === undefined && /^对手/.test(m[0]); return { attachDamage: { flatPerStage: { who: foe ? "foe" : "self", sign: "up", per: ns[0], flat: ns[1], mode: "levels", drain: true } } }; } },
  // 叠用概率（"每次使用几率增加10%"→chancePerUse 作用于本句所有带 chance 的 op）——须在 542 通用留档前
  { id: "deferred-137", re: /^每次使用几率(?:增加|提升|提高)(\d+)%$|^每使用一次(?:几率|概率)(?:增加|提升)(\d+)%$/, go: (m) => ({ attachAll: { chancePerUse: num(m[1] ?? m[2]) } }) },
  // 叠用固伤先于截胡兜底（"连续使用每次增加30点固定伤害"）
  { id: "deferred-138", re: new RegExp(`^连续使用每次增加(${NUM})点(?:固定|固伤)?(?:伤害)?$|^连续使用每次附加(${NUM})点(?:固定|固伤)?伤害$|^连续使用每次增加(${NUM})固伤$`), go: (m) => ({ attachDamage: { flatPerUse: num(m[1] ?? m[3] ?? m[5]) } }) },
  // "每次使用攻击技能都有N%概率使对手进入任意M种异常状态" → trigger11 cat4 + chance + random payload（须在下方"每次使用"宽泛留档之前）
  { id: "deferred-139", re: new RegExp(`^每次使用攻击技能都有?${NUM}%?(?:的?(?:几|概)?率)?(?:使|令)?对手进入任意${NUM}种异常状态$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; const cnt = ns[ns.length - 1]; return reactWrap(11, { cat: 4, ...(pct !== undefined ? { chance: pct } : {}) }, `使对手随机进入${cnt}种异常状态`); } },
  { id: "deferred-140", re: new RegExp(`^(?:连续使用)?每次使用(?!(?:此技能|该技能|本技能)?(?:则)?(?:自身|自己)?(?:${STAT_RE}|全属性|所有属性|全部能力|全项能力))(?!.*最[高多])(?!.*击败对手)|连续使用每次(?!.*最[高多])|连续使用时(?!.*最[高多])`), go: () => ({ unparsedReason: "per-use stacking — unquantified" }) },
  { id: "deferred-141", re: /^惩罚|能力等级越高.*威力|此技能威力越大|威力随.*能力|越高$|越大$|越低$|越少$|越小$|会比/, go: () => ({ unparsedReason: "punish scaling — coefficient undocumented" }) },
  // "免疫X系的攻击/技能/伤害"——元素系别免疫过滤（dmg_immune 无 element 参数字段）
  { id: "deferred-155", re: /^免疫[^，,、；;]{1,5}系(?:的)?(?:攻击|技能|伤害|招式|绝技)$/, go: () => ({ unparsedReason: "element-scoped immunity — source filter unmodeled (deferred)" }) },
  // "自身每损失N%体力则X几率提升"——失血比例触发的概率增益（条件概率无字段）
  { id: "deferred-156", re: new RegExp(`^自身每损失${NUM}%(?:的)?体力则`), go: () => ({ unparsedReason: "lost-hp-scaled proc chance — conditional proc unmodeled (deferred)" }) },
  // "集结/凝聚X神力"——蓄力集结类机制（印记系未建模）
  { id: "deferred-157", re: /^(?:集结|凝聚|汇聚)[一-龥]{2,12}(?:神力|之力|元气|能量|力量)/, go: () => ({ unparsedReason: "assemble/condense mechanic — undocumented (deferred)" }) },
  // "解放自身当前持有的回能Ⅰ"——具名印记释放（解放成功则 X——mark 释放谓词未建模）
  { id: "deferred-158", re: /^解放(?:自身|自己|对手|对方|敌方)?(?:当前)?(?:持有|拥有)?(?:的)?[一-龥Ⅰ-Ⅻ]{1,8}(?:，|,)?(?:解放成功则)?/, go: () => ({ unparsedReason: "named-mark release predicate unmodeled (deferred)" }) },
  // "战斗结束后获得N泰坦之灵/道具"——战后结算（非战斗域）
  { id: "deferred-159", re: /^战斗结束后(?:随机)?(?:获得|掉落)/, go: () => ({ unparsedReason: "post-battle reward — non-battle (deferred)" }) },
  // "己方场下每存活/阵亡N只精灵"——板凳计数缩放（bench-count 条件无字段）
  { id: "deferred-160", re: /^(?:己方|我方|本方)?场下每(?:存活|阵亡|存活有|拥有)[一-龥\d]{1,3}(?:只|个)精灵/, go: () => ({ unparsedReason: "bench-count-scaled modifier unmodeled (deferred)" }) },
  // "受到X系攻击(威力)?减半"——系别承伤减免（kindMask 无元素维度）
  { id: "deferred-161", re: /^受到[^，,、；;]{1,5}系(?:的)?攻击(?:技能)?(?:威力|伤害)?(?:减半|减少|降低)/, go: () => ({ unparsedReason: "element-scoped dmg-taken unmodeled (deferred)" }) },
  // "对X系精灵无效/伤害翻倍"——目标系别域
  { id: "deferred-162", re: /对[^，,、；;]{1,5}系精灵(?:造成)?(?:的)?(?:伤害|攻击)?(?:无效|翻倍|提升|减半|为\d)/, go: () => ({ unparsedReason: "element-targeted modifier unmodeled (deferred)" }) },
  // "平均(自身|对手)?能力等级"——段位平均化（set-op 未建模）
  { id: "deferred-163", re: /^平均(?:自身|自己|对手|对方|敌方|双方)?(?:的)?能力(?:等级|值)$/, go: () => ({ unparsedReason: "stage-average op unmodeled (deferred)" }) },
  // "(双方|该精灵|自身)每损失N点PP"——按点缩放的 PP 谓词
  { id: "deferred-164", re: /^(?:双方|该精灵|自身|自己|对手|对方|敌方)?(?:当前)?每损失\d+点(?:技能)?PP(?:值)?/, go: () => ({ unparsedReason: "per-pp-point scaling unmodeled (deferred)" }) },
  // "令对方场下阵亡的首位精灵消逝" → banish_dead（ops/banish-dead.ts 只处理「该侧场下首个未消逝且 currentHp<=0」的槽位，
  // 与句子里的「场下／阵亡／首位」逐字相符；target:"opponent" 由 targetSideOf 解析为对手侧）。
  // 须在 deferred-165 的板凳侧宽留档之前。只认这一种字面：全部阵亡/存活/己方侧仍走下面的留档。
  { id: "r5e-banish-dead-first-01", re: /^令?(?:对手|对方|敌方)场下阵亡的?(?:首位|第一只|首个)精灵消逝$/, go: () => ({ effects: [{ op: "banish_dead", target: "opponent" }] }) },
  // "(对方|己方)场下…精灵"——板凳侧目标
  { id: "deferred-165", re: /^(?:令|使|吸取|对)?(?:对方|对手|敌方|己方|我方|本方)?场下/, go: () => ({ unparsedReason: "bench-side target unmodeled (deferred)" }) },
  // "自身每点亮/每有N点X"——具名资源计数缩放
  { id: "deferred-166", re: /^(?:自身|自己|己方|我方)每(?:点亮|有|获得|积攒|拥有)[一-龥\d]{1,3}(?:颗|点|层|个|枚|条)/, go: () => ({ unparsedReason: "named-resource count scaling unmodeled (deferred)" }) },
  // "致命一击伤害提升N%"——暴击伤害放大（crit_dmg 无字段，crit_up=概率）
  { id: "deferred-167", re: /^(?:令|使|让)?(?:自身|自己|对手|对方|敌方)?造成的?致命[一1]?击(?:的)?伤害(?:额外)?(?:提升|提高|增加)/, go: () => ({ unparsedReason: "crit-damage amplifier unmodeled (deferred)" }) },
  { id: "deferred-142", re: /^(?:较|极|更|容)?易(?:打出|造成|触发)致命/, go: () => ({ unparsedReason: "crit likelihood — undocumented pct" }) },
  // 「增加/提升/减少/降低 ... 体力上限」已由 batch-e20 的 e20-hpmax-* 落地到
  // stat_boost{stats:["hp"]}；这里只兜底其余 HP 上限形态（如"最高HP"、单说"N点"）。
  { id: "deferred-143", re: /最高HP|HP上限|^(?:(?!增加|提升|提高|减少|降低).)*体力上限(?:的)?\d+点$/, go: () => ({ unparsedReason: "max-HP manipulation — E4" }) },
  // 回合末能力升降（"每回合攻击+1"——stat 编码 1-6 与 STAGE_TICK_CODES 同序）
  { id: "deferred-144",
    re: new RegExp(`^每回合(${STAT_RE})([+-])${NUM}$|^每回合(?:自身|自己)?(${STAT_RE})等级([+-])${NUM}$`),
    go: (m) => {
      const stat = STATS[m[1] ?? m[4]]; const d = (m[2] ?? m[5]) === "-" ? -1 : 1; const v = num(m[3] ?? m[6]);
      const code = { atk: 1, def: 2, spa: 3, sdf: 4, spd: 5, acc: 6 }[stat];
      return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: code, delta: d * v } })] };
    },
  },
  { id: "deferred-145", re: new RegExp(`^造成伤害的${NUM}%?(?:恢复|回复|转化为|转换成)(?:自身|自己)体力$|^造成伤害的${NUM}\\s*/\\s*${NUM}(?:恢复|回复|转化为|转换成)(?:自身|自己)体力$|^造成伤害的(?:全部|所有)(?:恢复|回复|转化为|转换成)(?:自身|自己)体力$|^给予对方(?:体力)?损伤?的?${NUM}\\s*/\\s*${NUM}(?:都)?会?(?:恢复|回复)(?:自身|自己)(?:的)?(?:体力)?$|^给予对方伤害的?${NUM}\\s*/\\s*${NUM}(?:都)?会?(?:恢复|回复)(?:自身|自己)(?:的)?(?:体力)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: /全部|所有/.test(m[0]) ? { numerator: 1, denominator: 1 } : ns.length > 1 ? frac(ns[0], ns[1]) : frac(ns[0], 100) } }; } },
  // 截断留档：动词后补语缺失/裸片段——非语义不明，是原文截断，显式标记便于审计
  { id: "deferred-146", re: /^改变(?:自身|对手|对方|敌方|自己|其|该|双方)?$|^(?:令|使|让)(?:对手|对方|敌方|自身|自己|双方)\d*$|^若(?:成功)?$|^若(?:自身|对手|对方|敌方|自己)$|^附加(?:的|伤害|伤害也?)?$|层数$|^(?:解除|消除|清除)(?:自身|对手|对方|敌方|自己|双方)$|^(?:其他|其余|另)?(?:攻击|属性|普通)?技$|^(?:受到|受|被)?攻击(?:必定|中|时)?$|^(?:对手|对方|敌方|自身|自己)攻击$|^无异常(?:状态)?$|^精灵时$|^(?:双倍|两倍)?转移到自己身上$|伤害\d+\/(?!\d)|^\d+%$|受到$|^[+-]\d+$|^有$|^命$|^为(?:对手|对方|敌方|自身|自己|己方)附加[一-龥]{0,3}$|^改变(?:对手|对方|敌方|自身|自己|双方)(?:的)?(?:[一-龥]{1,6})$|致命一击的$|^弱音$|^[一-龥]{1,3}音$/, go: () => ({ unparsedReason: "truncated clause — complement missing" }) },
  // 取对手最高攻击/特攻值当攻击属性——属性替换机制未建模
  { id: "deferred-148", re: /中的最高值计入|最高值计入/, go: () => ({ unparsedReason: "stat-swap: foe max stat as damage attribute (unmodeled)" }) },
  // "若对手本回合恢复体力"——对手回复触发/条件未建模
  { id: "deferred-149", re: /^若?(?:对手|对方|敌方)本回合恢复(?:了)?(?:体力|HP|生命)(?:则)?$/, go: () => ({ unparsedReason: "foe-heal condition unmodeled" }) },
  // stat 枚举裸片段（"对手攻击、特攻"——父句被切/截断）
  { id: "deferred-150", re: new RegExp(`^(?:对手|对方|敌方|自身|自己)?(?:(?:${STAT_RE})[、和])+(?:${STAT_RE})?$|^(?:对手|对方|敌方|自身|自己)(?:的)?(?:${STAT_RE})$`), go: () => ({ unparsedReason: "stat-enum fragment — parent clause truncated" }) },
  // "免疫除X外所有异常"——except 域免疫未建模（全免疫会过度授予）
  { id: "deferred-151", re: new RegExp(`^免疫除(?:${AIL_RE})(?:以|之)?外(?:的|所有|全部|任意)?(?:所?受到的?)?异常(?:状态)?$`), go: () => ({ unparsedReason: "except-scoped immunity unmodeled (deferred)" }) },
];
