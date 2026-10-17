// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, frac } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";

export const rules = [

  // ── 条件增幅修饰（attachAll：作用于整招所有同型 op）────────
  { id: "attach-all-01", re: new RegExp(`^(?:恢复体力时)?若?自身体力(?:低于|少于)${NUM}\\s*/\\s*${NUM}时?则?恢复效果翻倍$|^自身体力(?:低于|少于)${NUM}\\s*/\\s*${NUM}时?恢复效果加倍$`), go: (m) => ({ attachAll: { healIf: { selfHpBelow: frac(m[1] ?? m[3], m[2] ?? m[4]) } } }) },
  { id: "attach-all-02", re: new RegExp(`^自身体力低于${NUM}\\s*/\\s*${NUM}时?(?:吸取|吸收)效果翻倍$`), go: (m) => ({ attachAll: { drainIf: { selfHpBelow: frac(m[1], m[2]) } } }) },
  { id: "attach-all-03", re: new RegExp(`^自身体力低于${NUM}\\s*/\\s*${NUM}时?强化效果翻倍$|^先出手时自身强化效果翻倍$|^对手处于异常状态时强化状态翻倍$|^自身处于能力(?:强化|提升)状态时强化效果翻倍$|^(?:对手|对方|敌方)处于能力下降状态时强化效果翻倍$|^自身处于护盾状态时强化效果翻倍$`), go: (m) => ({ attachAll: { stageIf: m[1] !== undefined ? { selfHpBelow: frac(m[1], m[2]) } : /先出手/.test(m[0]) ? { order: "first" } : /护盾/.test(m[0]) ? { selfHas: "shield" } : /自身处于/.test(m[0]) ? { selfStageUp: true } : /能力下降/.test(m[0]) ? { foeStageDown: true } : { foeStatused: true } } }) },
  { id: "attach-all-04", re: /^(?:全部|所有)?效果翻倍$|^全部技能效果翻倍$|^附加效果翻倍$|^附加的效果翻倍$/, go: () => ({ attachAll: { effectDouble: true } }) },
  { id: "attach-all-05", re: /^技能无效时$|^若技能无效$/, go: () => ({ unparsedReason: "move-fail trigger — E4" }) },
  { id: "attach-all-06", re: /^恢复背包|^恢复己方(?:其他|别的)(?:存活)?精灵/, go: () => ({ unparsedReason: "bench heal — party-wide referent unmodeled (deferred)" }) },
  { id: "attach-all-07", re: /最后一只存活精灵|仅剩.*存活|己方最后一只/, go: () => ({ unparsedReason: "last-alive cond — E4" }) },
  { id: "attach-all-08", re: /^无视对手伤害限制效果$|^无视对手(?:的)?伤害(?:限制|减免|免疫)效果$/, go: () => ({ attachDamage: { pierce: true } }) },
  // "无视对方伤害限制效果"（对手侧词表只有「对手」）。放在 attach-all-08 后面，那条只收「对手」。
  { id: "p1-ata-01", re: /^无视(?:对方|敌方)伤害(?:限制|减免|免疫)效果$/, go: () => ({ attachDamage: { pierce: true } }) },
  { id: "attach-all-09", re: new RegExp(`^随机吸取对手\\d+项属性(?![+-\\d])`), go: () => ({ unparsedReason: "random stat pick — E4" }) },
  { id: "attach-all-10", re: new RegExp(`^随机附加(\\d+)(?:[-~—至到](\\d+))?点固定伤害$`), go: (m) => (m[2] !== undefined ? { attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } } : { attachDamage: { flatBonus: num(m[1]) } }) },
  // "固定加上20点固定伤害"。放在 attach-all-11a 前面。
  { id: "attach-all-11b", re: /^固定加上(\d+)点(?:固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // "附加额外100点固定伤害"。放在 attach-all-11 前面，那条是「额外附加」。
  { id: "attach-all-11a", re: /^附加额外(\d+)点(?:固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  { id: "attach-all-11", re: new RegExp(`^额外增加(\\d+)点固定伤害$|^额外附加(\\d+)点固定伤害$|^附加(\\d+)点固定伤害$|^额外增加(\\d+)点固伤$|^附加(\\d+)点伤害$|^额外附加(\\d+)点伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]) } }) },
  { id: "attach-all-12", re: new RegExp(`^随机附加(\\d+)(?:[-~—至到](\\d+))?点固定伤害$`), go: (m) => (m[2] !== undefined ? { attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } } : { attachDamage: { flatBonus: num(m[1]) } }) },
  // "10%加150点固定伤害"。放在 attach-all-13 前面，那条要写「附加」。
  { id: "attach-all-13a", re: /^(\d+)%加(\d+)点(?:固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatBonus: num(m[2]), flatChance: num(m[1]) } }) },
  { id: "attach-all-13", re: new RegExp(`^${NUM}%的?(?:几率)?(?:额外)?附加(\\d+)点固定伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[2]), chance: pct(m[1]) } }) },
  // "造成固伤翻倍"（penalty-17 的动词只有「固伤翻倍」/「固定伤害翻倍」）。放在 attach-all-14 前面。
  { id: "p1-ata-02", re: /^造成(?:固伤|固定伤害)翻倍$/, go: () => ({ attachAll: { flatDouble: true } }) },
  // "先出手技能威力2倍"/"先出手的威力2倍"/"先出招威力加倍"/"先手加倍"/"先手2倍"（attach-all-14/15 的签名不含「技能/的/先出招/裸加倍」）。放在 attach-all-14 前面。
  { id: "p1-ata-03", re: new RegExp(`^(?:若)?先出手(?:时|的话)?(?:的)?(?:技能)?威力(?:为|加)?${NUM}倍$|^(?:若)?先出招威力(?:翻倍|加倍|${NUM}倍)$|^先手(?:时)?(?:威力)?(?:翻倍|加倍|${NUM}倍)$|^后出手(?:时|的话)?的?威力(?:翻倍|加倍|${NUM}倍)$`), go: (m) => { const n = m.slice(1).find((x) => x !== undefined); return { attachDamage: { scaleIf: { when: { order: /^后/.test(m[0]) ? "last" : "first" }, numerator: n !== undefined ? num(n) : 2, denominator: 1 } } }; } },
  { id: "attach-all-14", re: new RegExp(`^(?:若)?先出手(?:的话|时)?[，,]?威力(为|加)${NUM}倍$|^先出手(?:的话|时)?威力(为|加)?${NUM}倍$|^先手威力${NUM}倍$|^后出手威力${NUM}倍$|^后手威力${NUM}倍$`), go: (m) => ({ attachDamage: { scaleIf: { when: { order: /^后/.test(m[0]) ? "last" : "first" }, numerator: num(m[2] ?? m[4] ?? m[5] ?? m[6] ?? m[7]), denominator: 1 } } }) },
  { id: "attach-all-15", re: /^先手威力(?:翻倍|加倍)$|^先手时威力(?:翻倍|加倍)$|^先出手威力(?:翻倍|加倍)$|^后出手威力(?:翻倍|加倍)$|^后手威力(?:翻倍|加倍)$|^先手(?:造成的)?伤害翻倍$/, go: (m) => ({ attachDamage: { scaleIf: { when: { order: /^后/.test(m[0]) ? "last" : "first" }, numerator: 2, denominator: 1 } } }) },
  // "体力低于1/4威力翻倍"/"HP低于1/3威力翻倍"（无「自身」前缀、尾词「翻倍」）。放在 attach-all-16 前面。
  { id: "p1-ata-04", re: new RegExp(`^(?:自身|自己)?(?:HP|hp|体力)(?:低于|小于|不足)${NUM}\s*/\s*${NUM}时?威力(?:翻倍|加倍)$|^(?:自身|自己)?(?:HP|hp|体力)(?:低于|小于|不足)${NUM}\s*/\s*${NUM}为${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { scaleIf: { when: { selfHpBelow: frac(ns[0], ns[1]) }, numerator: ns.length > 2 ? ns[2] : 2, denominator: 1 } } }; } },
  // "自身HP在1/2以内的时候威力加2倍"（attach-all-16 只认「小于/低于/不足」，不含「在…以内的时候」）。放在 attach-all-16 前面。
  { id: "p1-ata-06", re: new RegExp(`^(?:若)?(?:自身|自己)?(?:HP|hp|体力)(?:在)?${NUM}\\s*/\\s*${NUM}(?:以内|之内|以下|及以下)(?:的?(?:时候|时))?威力(?:为|加)?${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { scaleIf: { when: { selfHpBelow: frac(ns[0], ns[1]) }, numerator: ns[2], denominator: 1 } } }; } },
  { id: "attach-all-16", re: new RegExp(`^(?:若)?自身(?:HP|hp|体力)(?:小于|低于|不足)${NUM}\\s*/\\s*${NUM}时?威力(?:为|加)?${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { scaleIf: { when: { selfHpBelow: frac(ns[0], ns[1]) }, numerator: ns[2], denominator: 1 } } }; } },
  { id: "attach-all-17", re: new RegExp(`^(?:若)?后出手(?:的话|时)?[，,]?威力(为|加)?${NUM}倍$`), go: (m) => ({ attachDamage: { scaleIf: { when: { order: "last" }, numerator: num(m[2] ?? m[4]), denominator: 1 } } }) },
  { id: "attach-all-18", re: new RegExp(`^(?:若)?自身(?:HP|体力)(?:小于|低于)${NUM}\\s*/\\s*${NUM}时?威力(?:为|加)?${NUM}倍$`), go: (m) => ({ attachDamage: { scaleIf: { when: { selfHpBelow: frac(m[1], m[2]) }, numerator: num(m[4]), denominator: 1 } } }) },
  // "对方体力少于一半时威力加倍"/"对手少于一半血威力加倍"（「一半」写法 + 「血」字）。放在 attach-all-19 前面。
  { id: "p1-ata-05", re: new RegExp(`^(?:若)?(?:对方|对手|敌方)(?:体力|HP|hp|血量?|血)(?:小于|少于|低于|不足)一半(?:的)?(?:血|体力|HP|hp)?时?威力(?:为|加倍|翻倍|${NUM}倍)$|^(?:若)?(?:对方|对手|敌方)(?:小于|少于|低于|不足)一半(?:的)?(?:血|体力|HP|hp)时?威力(?:为|加倍|翻倍|${NUM}倍)$`), go: (m) => ({ attachDamage: { scaleIf: { when: { foeHpBelow: frac(1, 2) }, numerator: m[1] !== undefined ? num(m[1]) : 2, denominator: 1 } } }) },
  { id: "attach-all-19", re: new RegExp(`^(?:若)?(?:对方|对手|敌方)(?:HP|体力)(?:小于|少于|低于)${NUM}\\s*/\\s*${NUM}时?威力(为|加倍|翻倍|${NUM}倍)$`), go: (m) => ({ attachDamage: { scaleIf: { when: { foeHpBelow: frac(m[1], m[2]) }, numerator: /加倍|翻倍/.test(m[3]) ? 2 : num(m[4] ?? m[3]), denominator: 1 } } }) },
  { id: "attach-all-20", re: /^(?:若)?(?:对方|对手|敌方)(处于|存在|带有)异常状态(时|则)?威力加倍$/, go: () => ({ attachDamage: { scaleIf: { when: { foeStatused: true }, numerator: 2, denominator: 1 } } }) },
  { id: "attach-all-21", re: /^(?:若)?(?:对方|对手|敌方)处于异常状态(时|则)?(?:则)?伤害(?:提升|提高)(\d+)%$/, go: (m) => ({ attachDamage: { mulIf: { when: { foeStatused: true }, numerator: 100 + num(m[2]), denominator: 100 } } }) },
  { id: "attach-all-22", re: new RegExp(`^${NUM}回合(?:内)?做${NUM}(?:[-~—至到]${NUM})?次攻击$|^(?:一|每)?回合做${NUM}(?:[-~—至到]${NUM})?次攻击$|^做${NUM}(?:[-~—至到]${NUM})?次攻击$|^连续攻击(?:对手|对方|敌方)?${NUM}次$|^攻击(?:对手|对方|敌方)${NUM}次$`), go: (m) => { const nums = m.slice(1).filter((x) => x !== undefined).map(num); const counts = nums.length >= 3 ? nums.slice(1) : nums; return { attachDamage: { hits: { min: counts[0], max: counts[counts.length - 1] } } }; } },
  { id: "attach-all-23", re: new RegExp(`^(?:自身)?造成的伤害(?:提高|提升)${NUM}%$|^造成伤害(?:提高|提升)${NUM}%$|^(?:使)?(?:对手|对方|敌方)受到的伤害提高${NUM}%$|^伤害(?:额外)?(?:提升|提高|增加)${NUM}%$|^(?:自身)?造成的攻击伤害(?:额外)?(?:提升|提高)${NUM}%$`), go: (m) => ({ attachDamage: { mul: { numerator: 100 + num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]), denominator: 100 } } }) },
  { id: "attach-all-24", re: new RegExp(`^造成的?(?:攻击)?伤害(?:不少于|不低于)(\\d+)(?:点)?$|^伤害(?:不少于|不低于)(\\d+)(?:点)?$`), go: (m) => ({ attachDamage: { minDamage: num(m[1] ?? m[2]) } }) },
  { id: "attach-all-25", re: new RegExp(`^${NUM}%的?(?:几率)?(?:使)?伤害为${NUM}倍$|^${NUM}%几率伤害翻倍$|^${NUM}%(?:的?(?:概率|几率))?(?:造成)?${NUM}倍伤害$|^${NUM}%(?:的?(?:概率|几率))?威力(?:翻倍|加倍|翻${NUM}倍)$|^(?:攻击技能|攻击|技能|所有技能|每次攻击)有?${NUM}%的?(?:概率|几率)?(?:使)?威力(?:翻倍|加倍|翻${NUM}倍|为${NUM}倍)$|^(?:攻击技能|攻击|技能)${NUM}%的?(?:概率|几率)?威力(?:翻倍|加倍|翻${NUM}倍)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mulChance: { chance: ns[0], numerator: ns.length > 1 ? ns[ns.length - 1] : 2, denominator: 1 } } }; } },
  // "N%的几率造成M倍伤害"：外层先吃掉概率，这里只剩"造成M倍伤害"，再折回 mulChance
  { id: "attach-all-25b", re: new RegExp(`^造成${NUM}倍伤害$`), go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1]), denominator: 1 } } }) },
  { id: "attach-all-26", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)受到(?:的)?伤害(?:提升|提高|增加)(\\d+)%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", params: { pct: num(m[1]) } }] }) },
  // 多层护盾（"获得N个M点的护盾"——count 层、每层 each 点吸收，逐层击破）
  { id: "attach-all-27", re: new RegExp(`^(?:使|令)?自身获得${NUM}个${NUM}点的?护(盾|罩)$|^获得${NUM}个${NUM}点的?护(盾|罩)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && x !== "盾" && x !== "罩").map(num); const isWard = m[3] === "罩" || m[6] === "罩"; return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: "self", params: { flat: ns[1], count: ns[0], each: ns[1], ...(isWard ? { kindMask: 3 } : {}) } }] }; } },
  // 回合末解除能力下降（"回合结束时解除自身能力下降状态"；并反弹给对手→down_push_tick）
  { id: "attach-all-28", re: /^(?:回合结束时|每回合结束时)解除(?:自身|自己)能力下降状态并反弹给(?:对手|对方|敌方)$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "down_push_tick", target: "self" })] }) },
  { id: "attach-all-29", re: /^(?:回合结束时|每回合结束时|每回合)解除(?:自身|自己)(?:的|所有)?能力下降状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "cleanse_down_tick", target: "self" })] }) },
  // 变量 n / 护盾吸收量 / 暴击反弹 —— 语义依赖运行时量或未公示机制，显式留档
  { id: "attach-all-30", re: /n点|n=|n等于/, go: () => ({ unparsedReason: "variable-n quantity — deferred" }) },
  // "护盾所吸收的伤害值N%反弹" → attachDamage shieldAbsorbPct（shieldAbsorbed 记账已实现——本回合护盾吸收量×pct% 骑入固伤）
  { id: "attach-all-31", re: new RegExp(`^(?:将|把)?护盾所吸收(?:的|到)?伤害值?(?:的)?${NUM}%(?:反弹|反馈|反弹给对手|转化为伤害)$|^(?:将|把)?护盾吸收(?:的|到)?伤害(?:值)?(?:的)?${NUM}%(?:反弹|反馈)(?:给对手|给对方)?$`), go: (m) => ({ attachDamage: { shieldAbsorbPct: num(m[1] ?? m[2]) } }) },
  { id: "attach-all-32", re: /^反弹(?:对手|对方|敌方)?(?:造成的)?致命[一1]?击(?:的?伤害)?$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_reflect", target: "self" }] }) },
  // "对手打出致命一击的非必中技能无效"——crit∧非必中双条件 nullify（move_null 无此复合门）
  { id: "attach-all-33", re: /致命[一1]?击的?非必中技能无效/, go: () => ({ unparsedReason: "crit+non-must-hit move null — compound gate undocumented" }) },
  // "携带技能中X系不少于Y系时…"——技能组属性构成谓词（无此条件维度）
  { id: "attach-all-34", re: /(?:携带|配置)?技能?(?:中|里)?含有的?.{1,4}系.{0,4}不少于.{0,4}系/, go: () => { return { unparsedReason: "moveset type-composition cond — no such dimension (UNVERIFIED)" }; } },
  { id: "attach-all-35", re: new RegExp(`^(?:若|如果)?(?:对手|对方|敌方)(?:的)?(?:HP|体力)(?:不足|低于|小于)(\\d+)(?:点)?(?:则|,|，)?直接秒杀$|^(?:若|如果)?(?:对手|对方|敌方)(?:的)?HP小于${NUM}\\s*/\\s*${NUM}(?:则|,|，)?直接秒杀$`), go: (m) => (m[1] !== undefined ? { effects: [{ op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: num(m[1]) } }] } : { effects: [{ op: "damage", power: 100, kind: "percent", if: { foeHpBelow: frac(m[2], m[3]) } }] }) },
  { id: "attach-all-36", re: /^直接秒杀(?:对手|对方|敌方)?$|^(?:命中后)?(?:直接)?秒杀对手$/, go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent" }] }) },
  { id: "attach-all-37", re: /^(?:若)?(?:对方|对手|敌方)处于异常状态(时|则)?强化状态翻倍$|^(?:对手|对方)处于异常状态时强化状态翻倍$/, go: () => ({ unparsedReason: "stage multiplier — E4" }) },
];
