// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, ALL_STATS, AILMENTS, AIL_RE, frac, stageFx } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText, condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [

  // ── 回复/吸取 ───────────────────────────────────────────────
  { id: "heal-01",
    re: new RegExp(`^(?:恢复|回复)(自身|自己)?(?:最大体力值?|最大HP|体力值?|HP上限)的?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[2]), denominator: num(m[3]), target: "self" }] }),
  },
  { id: "heal-02", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?最大(?:体力|HP)(?:值)?的?(\\d+)%(?:的)?(?:体力|HP)?$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: 100, target: "self" }] }) },
  // "恢复100固定体力值"（heal-03 的尾词只收「点体力/HP/血」，timed-bare-08 的「固定体力值」只出现在每回合形态）。放在 heal-03 前面。
  { id: "p1-heal-05", re: /^(?:恢复|回复)(?:自身|自己)?([0-9]+)(?:点)?(?:固定体力值|固定HP值)$/, go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }) },
  // "恢复(自身)最大生命的1/2"（heal-01 只认「最大体力/HP」，「生命」是空档）。放在 heal-03 前面。
  { id: "p1-heal-06", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:最大)?生命(?:值)?的?${NUM}\s*/\s*${NUM}$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  { id: "heal-03",
    re: new RegExp(`^(?:恢复|回复)(自身|自己)?(\\d+)点(?:体力|HP|血)?$|^(?:恢复|回复)(自身|自己)?(\\d+)(?:HP|血)(?:体力)?$|^(?:自身|自己)(?:恢复|回复)(\\d+)点(?:体力|HP|血)?$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[2] ?? m[4] ?? m[5]), target: "self" }] }),
  },
  { id: "heal-04",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己|己方)?(?:全部|所有)(?:体力|HP)值?$|^并?恢复(?:自身|自己)?满(?:体力|HP)$`),
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }),
  },
  { id: "heal-05",
    re: new RegExp(`^吸取(对手|对方|敌方)${NUM}点(?:固定)?体力(?:恢复自身)?$`),
    go: (m) => ({ effects: [{ op: "damage", power: num(m[2]), kind: "fixed" }, { op: "heal", flat: num(m[2]), target: "self" }] }),
  },
  { id: "heal-06",
    re: new RegExp(`^(?:使用技能|攻击)?吸取(对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}(?:恢复自身)?$|^(?:使用技能|攻击)?吸取(对手|对方|敌方)最大体力的(\\d+)%(?:恢复自身)?$|^吸取对手最大体力${NUM}\\s*/\\s*${NUM}$|^攻击?吸取对手最大体力${NUM}\\s*/\\s*${NUM}$`),
    // frac 精确分数：percent.power 是百分数，1/3 不能写成 power:1（会被算成 1%）
    go: (m) => {
      const ns = m.slice(1).filter((x) => x !== undefined).map(num).filter((x) => x !== null && !Number.isNaN(x));
      // 分支2=%数；分支1/3=分数
      if (/%/.test(m[0])) return { effects: [{ op: "damage", power: ns[0], kind: "percent" }, { op: "heal", numerator: ns[0], denominator: 100, target: "self" }] };
      return { effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(ns[0], ns[1]) }, { op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] };
    },
  },
  // "恢复自身HP1/4"/"回复1/3Hp"（HP 记法后置分数）。放在 heal-07 前面，那条尾词只收「体力」。
  { id: "heal-07a", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:的)?(?:HP|Hp|hp)${NUM}\\s*/\\s*${NUM}$|^(?:恢复|回复)(?:自身|自己)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:HP|Hp|hp)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] }; } },
  { id: "heal-07", re: new RegExp(`^(?:直接)?(?:恢复|回复)(?:自身|自己)${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  // 当前体力百分比/分数固伤（"附加对手当前体力值20%的固定伤害"）
  { id: "heal-08", re: /^附加(?:对手|对方|敌方)当前体力(?:值)?的?(\d+)%(?:的)?(?:固定|百分比)?伤害$/, go: (m) => ({ effects: [{ op: "damage", power: num(m[1]), kind: "percent", percentBase: "current" }] }) },
  { id: "heal-09", re: new RegExp(`^附加(?:对手|对方|敌方)当前体力(?:值)?的${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定|百分比)?伤害$`), go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", percentBase: "current", frac: frac(m[1], m[2]) }] }) },
  // 伤害数值的N%回复自身（"给对手造成伤害时，伤害数值的30%恢复自身体力"）→ drain
  // "攻击伤害的20%恢复体力"（heal-10 的「造成」前缀可省但主语词表不含「攻击」）。放在 heal-10 前面。
  { id: "p1-heal-07", re: new RegExp(`^(?:攻击)?伤害(?:值)?的?${NUM}%(?:会)?(?:恢复|回复)(?:自身|自己)?体力$`), go: (m) => ({ attachDamage: { drain: { numerator: num(m[1]), denominator: 100 } } }) },
  { id: "heal-10", re: /^(?:给(?:对手|对方|敌方)造成伤害时[，,]?)?(?:将)?(?:其|该次|所)?(?:造成的)?伤害(?:数值|值)?的?(\d+)%(?:恢复|回复|转化为|转为)自身(?:的)?体力$|^造成伤害值的(\d+)%(?:恢复|回复)自身体力$|^造成伤害的(\d+)%(?:恢复|回复)体力$|^给(?:对方|对手|敌方)造成伤害的(\d+)%(?:恢复|回复)(?:自身|自己)体力$|^攻击?造成伤害(\d+)%(?:将|会|则)?恢复(?:自身|自己)?体力$/, go: (m) => ({ attachDamage: { drain: { numerator: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]), denominator: 100 } } }) },
  // 微弱无效化（"伤害不会出现微弱"——括号注释放任尾缀）
  { id: "heal-11", re: /^(?:攻击时)?(?:造成的)?伤害(?:将)?不会出现微弱/, go: () => ({ attachDamage: { noResist: true } }) },
  // 威力随机 + 范围
  { id: "heal-12", re: /^威力随机$/, go: () => ({ flags: { powerRandom: true } }) },
  { id: "heal-13",
    re: /^(?:威力随机[，,]?)?(?:随机)?范围(\d+)\s*[~～\-—]\s*(\d+)$|^威力随机范围(\d+)\s*[~～\-—]\s*(\d+)$/,
    go: (m) => ({ attachDamage: { powerRange: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }),
  },
  // 本招伤害下限（"造成的伤害不少于350"）
  { id: "heal-14", re: /^造成的伤害(?:不少于|不会低于)(\d+)(?:点)?$|^造成伤害不少于(\d+)(?:点)?$|^伤害不少于(\d+)点$/, go: (m) => ({ attachDamage: { minDamage: num(m[1] ?? m[2] ?? m[3]) } }) },
  // 招式失效（nullifies flag）：属性技能失效 → cat:1；攻击失效 → cat:4(任意伤害招)；裸"技能失效" → 任意
  { id: "heal-15", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下?(${NUM})?次?(?:使用的)?属性技能失效$|^(?:对手|对方|敌方)使用(?:的)?属性技能失效$|^(?:对手|对方|敌方)(?:使用的)?属性技能失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1] ?? "1"), cat: 1 } }] }) },
  { id: "heal-16", re: /^(?:对手|对方|敌方)使用(?:的)?攻击技能?失效$|^(?:对手|对方|敌方)(?:使用的)?攻击技能?失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1, cat: 4 } }] }) },
  { id: "heal-17", re: /^(?:对手|对方|敌方)所有技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  { id: "heal-18", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下?(${NUM})?次?(?:使用的)?攻击(?:技能)?失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1] ?? "1"), cat: 4 } }] }) },
  { id: "heal-19", re: /^(?:使|令)(?:对手|对方|敌方)(?:下1次)?(?:使用的)?技能失效$|^使得?对方的技能失效$|^使对手的技能失效$|^对方技能失效$|^使对手技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  { id: "heal-20", re: /^(?:使|令)?(?:对手|对方|敌方)(?:的)?属性技能无效$|^(?:使|令)?属性攻击无效$/, go: () => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: 1, params: { cat: 1 } }] }) },
  // "对手当回合技能无效"（当回合 窗变体）
  { id: "heal-21", re: /^(?:对手|对方|敌方)(?:当|本)回合(?:所有)?技能无效$|^(?:使|令)(?:对手|对方|敌方)当回合(?:所有)?技能无效$/, go: () => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: 1 }] }) },
  // "增加N点护盾"（增加/附加 平铺值变体）
  { id: "heal-22", re: new RegExp(`^(?:增加|附加|获得|创造|生成)(${NUM})点护(盾|罩)$|^(?:使|令)?自身增加(${NUM})点护(盾|罩)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && x !== "盾" && x !== "罩").map(num); const isWard = m[3] === "罩" || m[6] === "罩"; return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: "self", params: { flat: ns[0], ...(isWard ? { kindMask: 3 } : {}) } }] }; } },
  // "抵挡N点伤害的护盾"（量词+抵挡变体——"增加一个抵挡300点伤害的护盾"；"50%概率增加…"→chance）
  { id: "heal-23", re: new RegExp(`^(?:${NUM}%(?:的?(?:概率|几率))?)?(?:增加|获得|生成|创造|附加|展开|张开|拥有)(?:一|1)个?(?:能|可)?抵挡${NUM}点(?:攻击)?伤害?的?护(盾|罩)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && x !== "盾" && x !== "罩").map(num); const isWard = m[m.length - 1] === "罩"; return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: "self", ...(ns.length > 1 ? { chance: ns[0] } : {}), params: { flat: ns[ns.length - 1], ...(isWard ? { kindMask: 3 } : {}) } }] }; } },
  // "附加的固伤提高N点"/"固伤提高N点" → dmg_flat 常驻窗（出招附加固伤增量）
  { id: "heal-24", re: new RegExp(`^(?:攻击)?(?:附加|附带)?的?(?:固定|固伤)(?:伤害)?(?:提高|提升|增加)${NUM}点?$|^固伤提高${NUM}点$`), go: (m) => { const n = num(m.slice(1).find((x) => x !== undefined)); return { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: n } }] }; } },
  // "为双方附加N点护盾"——双侧盾（拆 self+opponent 两条，UNVERIFIED 近似）
  { id: "heal-25", re: new RegExp(`^(?:为|给|使|令)?双方(?:附加|获得|生成|创造)?(${NUM})点护(盾|罩)$|^(?:为|给|使|令)?双方附加${NUM}点护(盾|罩)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && x !== "盾" && x !== "罩").map(num); const isWard = m[3] === "罩" || m[5] === "罩"; return { effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: isWard ? "ward" : "shield", target: t, params: { flat: ns[ns.length - 1], ...(isWard ? { kindMask: 3 } : {}) } })) }; } },
  // 出伤窗口：下限/上限（timed 由 ctxTurns 注入；"对手造成伤害不超过N" 压给对手）
  { id: "heal-26", re: new RegExp(`^每回合(?:使用)?攻击技能造成的伤害不少于(\\d+)(?:点)?$|^(?:自身)?攻击技能造成的伤害不少于(\\d+)(?:点)?$|^使用(?:攻击)?技能造成的伤害不少于(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", params: { min: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // "造成的攻击伤害不低于对手最大体力的N%" → dmg_out_floor foeMaxPct/selfMaxPct
  { id: "heal-27", re: new RegExp(`^(?:自身|自己)?(?:每次)?造成(?:的)?(?:攻击)?伤害(?:将)?不低于(?:对手|对方|敌方)(?:的)?最大体力(?:的)?${NUM}%$|^(?:自身|自己)?(?:每次)?造成(?:的)?(?:攻击)?伤害(?:将)?不低于(?:自身|自己)(?:的)?最大体力(?:的)?${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", params: m[1] !== undefined ? { foeMaxPct: num(m[1]) } : { selfMaxPct: num(m[2]) } }] }) },
  { id: "heal-28", re: new RegExp(`^(?:对手|对方|敌方)(?:每回合)?造成的(?:攻击)?伤害不超过(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_cap", target: "opponent", params: { cap: num(m[1]) } }] }) },
  // 等量固伤：跟在 heal 后 → heal.foeEcho（"恢复体力同时造成等量固伤"）；跟在 damage 后 → flatEcho（"附加等量固定伤害"）
  { id: "heal-29", re: /^(?:同时|并)?给对手造成等量(?:固定|百分比)?伤害$|^(?:同时|并)?使对方受到等量(?:固定)?伤害$|^附加恢复体力值等量的?(?:固定)?伤害$|^附加(?:等量|恢复量)(?:的)?固定伤害$/, go: () => ({ attachAll: { healEcho: true } }) },
  { id: "heal-30", re: new RegExp(`^受到恢复体力值${NUM}\\s*/\\s*${NUM}的固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { healSelfEcho: { numerator: ns[0], denominator: ns[1] } } }; } },
  { id: "heal-31", re: new RegExp(`^附加恢复体力值${NUM}\\s*/\\s*${NUM}的(?:固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { healEchoFrac: { numerator: ns[0], denominator: ns[1] } } }; } },
  { id: "heal-32", re: /^附加等量(?:固定)?伤害$|^造成等量的?固定伤害$|^造成等量伤害$|^造成等量的固定伤害$|^(?:则)?附加等量固定伤害$/, go: () => ({ attachDamage: { flatEcho: {} } }) },
  // 附加对手最大体力分数/百分固伤（max 基线）
  { id: "heal-33", re: new RegExp(`^附加(?:对手|对方|敌方)最大体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定|百分比)?伤害$|^附加(?:对手|对方|敌方)最大体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?固伤$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(ns[ns.length - 2], ns[ns.length - 1]) }] }; } },
  { id: "heal-34", re: /^附加(?:对手|对方|敌方)最大体力(?:值)?的?(\d+)%(?:的)?(?:固定|百分比)?伤害$|^附加(?:对手|对方|敌方)最大体力(?:值)?的?(\d+)%(?:的)?固伤$/, go: (m) => ({ effects: [{ op: "damage", power: num(m[1] ?? m[2]), kind: "percent" }] }) },
  { id: "heal-35", re: new RegExp(`^${NUM}%(?:的?(?:几|概)?率)?附加(?:对手|对方|敌方)最大体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定伤害|固伤|百分比伤害|伤害)$|^${NUM}%(?:的?(?:几|概)?率)?附加对手最大体力${NUM}%的?(?:固定伤害|固伤|百分比伤害)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const base = { op: "damage", kind: "percent", chance: ns[0], target: "opponent" }; return { effects: [ns.length > 2 ? { ...base, power: 1, frac: frac(ns[ns.length - 2], ns[ns.length - 1]) } : { ...base, power: ns[ns.length - 1] }] }; } },
  // 随机区间恢复/固伤
  { id: "heal-36", re: /^随机恢复(?:自身|自己)(\d+)\s*[~～\-—]\s*(\d+)点?(?:HP|体力)?$|^随机恢复(\d+)\s*[~～\-—]\s*(\d+)点?(?:HP|体力)$/, go: (m) => ({ effects: [{ op: "heal", flatRange: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) }, target: "self" }] }) },
  // 阈值固伤（"造成的伤害低于300则附加300点固定伤害"——本击伤害阈值判定）
  { id: "heal-37", re: /^造成的伤害低于(\d+)(?:点)?(?:则|,|，)?附加(\d+)点(?:固定)?伤害$|^造成的伤害低于(\d+)(?:点)?(?:则|,|，)?附加等量固定伤害$/, go: (m) => ({ attachDamage: { flatIfBelow: { min: num(m[1] ?? m[3]), flat: m[2] !== undefined ? num(m[2]) : num(m[1] ?? m[3]) } } }) },
  // 几率翻倍（"自身处于能力提升状态时几率翻倍"）→ 所有 chance op 加 chanceMulIf
  { id: "heal-38", re: /^几率翻倍$|^概率翻倍$|^(?:触发|命中)?几率翻倍$|^致命(?:一击)?(?:的)?(?:几率|概率)翻倍$/, go: () => ({ attachAll: { chanceDouble: true } }) },
  // 概率上浮（"概率提升60%"→chance×1.6；带 ctxCond → chanceMulIf 条件上浮）
  { id: "heal-39", re: new RegExp(`^(?:${AIL_RE})?(?:的)?(?:概率|几率)(?:提升|提高|增加|上升)(\\d+)%$`), go: (m) => ({ attachAll: { chanceBoostPct: num(m[1]) } }) },
  // 固伤/百分比附加补充变体
  // "加40固定伤害"/"+60固定伤害"（省字/加号领起——同 flatBonus 族）。放在 heal-40 前面，那条动词只收「增加/附加」。
  { id: "heal-40a", re: new RegExp(`^(?:加|\\+)(\\d+)(?:点)?(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  { id: "heal-40", re: new RegExp(`^增加(\\d+)点(?:固定|固伤)?伤害$|^增加(\\d+)点固定伤害$|^增加(\\d+)点固伤$|^附加(?:给)?(?:对手|对方|敌方)?(\\d+)点固伤$|^附加(?:给)?(?:对手|对方|敌方)?(\\d+)点固定伤害$|^附加(?:给)?(?:对手|对方|敌方)?(\\d+)(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]) } }) },
  { id: "heal-41", re: /^造成等量固伤$|^造成等量的?固伤$/, go: () => ({ attachDamage: { flatEcho: {} } }) },
  { id: "heal-42", re: /^造成等量百分比伤害$|^造成等量的?百分比伤害$/, go: () => ({ attachAll: { echoEqPct: 100 } }) },
  { id: "heal-43", re: /^反弹受到的异常状态$|^反弹(?:所有)?受到的?异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  { id: "heal-44", re: /^附加到(?:自己|自身)身上$|^附加给(?:自己|自身)$/, go: () => ({ attachAll: { mirrorStages: true } }) },
  { id: "heal-45", re: new RegExp(`^${NUM}回合内?免疫(?:异常)?(?:状态)?$|^${NUM}回合内?免疫所有异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }] }) },
  { id: "heal-46", re: /^恢复等量体力$|^回复等量体力$|^恢复等量体力值$|^回复等量体力值$/, go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // "自身所有能力值+N点"（面板值加点——"点"后缀区别于 stage；stat_boost 五维加点）
  { id: "heal-47", re: new RegExp(`^(?:自身|自己)?(?:所有|全部|全项|各项)能力值([+-])${NUM}点?$`), go: (m) => { const v = (m[1] === "-" ? -1 : 1) * num(m[2]); return { effects: [{ op: "stat_boost", stats: [...ALL_STATS], add: v, target: "self" }] }; } },
  { id: "heal-48", re: new RegExp(`^每回合开始时使(?:对手|对方|敌方)${NUM}项能力值?-${NUM}$|^每回合(?:对手|对方|敌方)(?:随机)?${NUM}项能力(?:值)?-${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "opponent", params: { stat: 7, delta: -Math.abs(ns[ns.length - 1]), count: ns[0] } })] }; } },
  // 定向消除（"消除对手相应的防御能力提升效果"→stats 限定；"消除敌我双方回合类效果"→双侧 cleanse）
  // "消除对手相应的防御提升效果"（heal-49 的签名要求「防御能力提升效果」）。放在 heal-49 前面。
  { id: "p1-heal-04", re: /^(?:消除|清除|驱散)(?:对手|对方|敌方)相应的?(?:防御|双防)(?:能力)?提升(?:状态)?效果$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up", stats: ["def", "sdf"] }] }) },
  { id: "heal-49", re: /^消除对手相应的防御能力提升效果$|^消除对手防御能力提升$|^消除对手防御(?:能力)?提升效果$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up", stats: ["def", "sdf"] }] }) },
  // "令自身X"——自我施加异常（无概率裸令式；对手侧由 AIL 规则系覆盖）
  { id: "heal-50", re: new RegExp(`^(?:令|使|让)(自身|自己|本方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "self" }] }) },
  { id: "heal-51", re: /^反弹攻击伤害$|^反弹(?:受到|受到的|所受)?(?:的)?攻击伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: 1 } }] }) },
  // "反弹当回合受到的攻击伤害"——限时反击窗
  { id: "heal-52", re: /^反弹(?:当|本)回合受到的攻击伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "counter", target: "self", turns: 1, params: { mul: 1 } }] }) },
  { id: "heal-53", re: new RegExp(`^损失自身(\\d+)点体力$|^损失自身(\\d+)点HP$|^自身损失(\\d+)点体力$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2] ?? m[3]), target: "self" }] }) },
  // 独立固定伤害实例（"对对手造成100点固定伤害"/"对手损失200点体力"——非修饰子句，是整笔 fixed 伤害）
  { id: "heal-54", re: new RegExp(`^(?:对|向|令|使)(?:对手|对方|敌方)造成(\\d+)点(?:固定|固伤|真实)?伤害$|^(?:使|令)?(?:对手|对方|敌方)损失(\\d+)点(?:体力|HP|生命)$|^受到(\\d+)点(?:固定|固伤)?伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2] ?? m[3]), target: m[3] !== undefined ? "self" : "opponent" }] }) },
  // 分数损失（"使对手损失1/3的最大体力"→percent damage；self 目标对称）
  { id: "heal-55", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)损失${NUM}\\s*/\\s*${NUM}(?:点)?的?(?:最大体力|体力上限|体力|生命)$|^(?:使|令)自身损失${NUM}\\s*/\\s*${NUM}(?:点)?的?(?:最大体力|体力|生命)$`), go: (m) => { const f = m[1] !== undefined ? frac(m[1], m[2]) : frac(m[3], m[4]); return { effects: [{ op: "damage", kind: "percent", power: 1, frac: f, target: m[1] !== undefined ? "opponent" : "self" }] }; } },
  { id: "heal-56", re: new RegExp(`^暴击率提升${NUM}%$|^暴击率(?:提升|提高)${NUM}%$|^致命一击率提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1] ?? m[2] ?? m[3]), d: 100 } }] }) },
  { id: "heal-57", re: new RegExp(`^组队(?:时)?可以影响(${NUM})个目标$|^组队时(?!.*(?:任意|影响|作用|目标|队员|精灵))`), go: (m) => (m[1] !== undefined ? { flags: { targets: num(m[1]) } } : { ignored: true }) },
  { id: "heal-58", re: new RegExp(`^(${STAT_RE})等级(\\d+)$`), go: (m) => ({ effects: [stageFx(STATS[m[1]], num(m[2]), "self")] }) },
  { id: "heal-59", re: new RegExp(`^${NUM}%概率(?:攻击)?${NUM}次$|^${NUM}%的(?:几率)?攻击${NUM}次$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { hits: { min: ns[1], max: ns[1] }, attachChance: ns[0] } }; } },
  { id: "heal-60", re: new RegExp(`^${NUM}%概率使(?:对手|对方|敌方)的?属性技能失效$|^${NUM}%使(?:对手|对方|敌方)属性技能失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", chance: num(m[1] ?? m[2]), params: { cat: 1 } }] }) },
  // "附加相当于自身最大体力30%的固定伤害"（heal-61 的签名无「相当于」）。放在 heal-61 前面。
  { id: "p1-heal-02", re: new RegExp(`^附加相当于(?:自身|自己)最大体力(?:值)?${NUM}%的?(?:固定|百分比)?伤害$`), go: (m) => ({ attachDamage: { flatSelfPct: num(m[1]) } }) },
  { id: "heal-61", re: new RegExp(`^附加自身最大体力${NUM}%的?(?:固定|百分比)?伤害$|^附加自身最大体力值?的?${NUM}%(?:的)?(?:固定|百分比)?伤害$|^附加自身最大体力值?的?${NUM}\\s*/\\s*${NUM}的?(?:固定|百分比)?伤害$`), go: (m) => { if (m[3] !== undefined) return { attachDamage: { flatSelfFrac: { numerator: num(m[3]), denominator: num(m[4]) } } }; return { attachDamage: { flatSelfPct: num(m[1] ?? m[2]) } }; } },
  { id: "heal-62", re: /^造成的固定伤害翻倍$|^造成的固伤翻倍$/, go: () => ({ attachAll: { flatDouble: true } }) },
  { id: "heal-63", re: /^对手不处于能力(?:提升|强化)状态时强化效果翻倍$|^对手无能力提升状态时强化效果翻倍$/, go: () => ({ attachAll: { stageIf: { not: { foeStageUp: true } } } }) },
  // 反应式触发器（react）：则-部递归解析成 payload，挂 kind=react 条目由引擎在触发点派发
  { id: "heal-64", re: new RegExp(`^受到攻击时有?${NUM}%(?:的?(?:概率|几率))?(?:免疫|回避)(?:攻击|此次伤害|这次伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]) } }] }) },
  { id: "heal-65", re: /^受到攻击则(.+)$|^受到攻击时(.+)$|^若受到攻击则(.+)$/, go: (m) => reactWrap(1, {}, m[1] ?? m[2] ?? m[3]) },
  // "若对手攻击技能命中则X"（对手命中=我方受击）→ trigger 1 cat4
  { id: "heal-66", re: /^若?(?:对手|对方|敌方)攻击技能命中则(.+)$|^(?:对手|对方|敌方)攻击命中时(.+)$/, go: (m) => reactWrap(1, { cat: 4 }, m[1] ?? m[2]) },
  { id: "heal-67", re: /^受到物理攻击时(.+)$|^受到物理攻击则(.+)$|^受到物理伤害时(.+)$/, go: (m) => reactWrap(1, { cat: 2 }, m[1] ?? m[2] ?? m[3]) },
  { id: "heal-68", re: /^受到特殊攻击时(.+)$|^受到特殊攻击则(.+)$/, go: (m) => reactWrap(1, { cat: 3 }, m[1] ?? m[2]) },
  { id: "heal-69", re: new RegExp(`^若受到(?:的)?伤害大于(\\d+)(?:点)?则(.+)$|^受到的伤害大于(\\d+)(?:点)?则(.+)$`), go: (m) => reactWrap(1, { min: num(m[1] ?? m[3]) }, m[2] ?? m[4]) },
  // "受到攻击后X"——受击反应窗（trigger=1；TURNS_PRE"当回合"剥出的 timed 变体经 turns 注入）
  { id: "heal-70", re: /^受到攻击后(.+)$|^受到(?:对手|对方|敌方)的?攻击后(.+)$/, go: (m) => reactWrap(1, {}, m[1] ?? m[2]) },
  // "受到攻击伤害则X"/"受到伤害则X"——受击反应窗变体
  { id: "heal-71", re: /^受到(?:对手|对方|敌方)?的?(?:攻击)?伤害(?:后|则|时)(.+)$/, go: (m) => reactWrap(1, {}, m[1]) },
  { id: "heal-72", re: /^受到攻击伤害则(.+)$/, go: (m) => reactWrap(1, {}, m[1]) }, // "受到攻击伤害则反弹…"——"攻击伤害"合词变体（上行"的?攻击?伤害"不覆盖无"的"形）
  // "受到攻击(伤害)有N%几率X"——受击反应 + payload chance 注入
  { id: "heal-73", re: new RegExp(`^受到(?:对手|对方|敌方)?的?攻击?(?:伤害)?有(${NUM})%(?:的?(?:概率|几率))?(.+)$`), go: (m) => { const r = reactWrap(1, {}, m[m.length - 1]); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1]); return r; } },
  // "每回合令自身全属性+1" → stage_tick 全五维集合（stat:9）
  { id: "heal-74", re: /^每回合(?:使|令|让)(?:自身|自己)?全属性([+-])(\d+)$|^每回合(?:使|令|让)自身全(?:部)?属性([+-])(\d+)$/, go: (m) => { const s = m[1] ?? m[3]; const v = num(m[2] ?? m[4]); return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: 9, delta: s === "-" ? -v : v } })] }; } },
  // "每回合随机使对手N项属性-K"/"对手每回合随机两项属性-1" → stage_tick 随机维度（stat:7）
  { id: "heal-75", re: new RegExp(`^每回合随机(?:使|令)?(?:对手|对方|敌方)${NUM}(?:项|个)?(?:属性|能力值?|能力)?([+-])${NUM}$|^(?:对手|对方|敌方)每回合(?:随机)?${NUM}(?:项|个)?(?:属性|能力值?)?([+-])${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const cnt = num(ns[0]); const s = ns.find((x) => x === "+" || x === "-"); const v = num(ns[ns.length - 1]); return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "opponent", params: { stat: 7, delta: s === "-" ? -v : v, count: cnt } })] }; } },
  // "N%的概率麻痹"/"N%概率是对手AIL"（的/是 变体——"是"为"使"错字近似 UNVERIFIED）
  { id: "heal-76", re: new RegExp(`^${NUM}%的(?:概率|几率)(${AIL_RE})(?:状态)?$|^${NUM}%(?:概率|几率)是(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => { const pct = num(m[1] ?? m[3]); const ail = AILMENTS[m[2] ?? m[4]]; return { effects: [{ op: "apply_status", name: ail, target: "opponent", chance: pct }] }; } },
  // "反弹对手N点固定伤害"/"反弹N点固定伤害给对手" → counter flat
  { id: "heal-77", re: new RegExp(`^反弹(?:对手|对方|敌方)?${NUM}点(?:固定|固定伤害|伤害)$|^反弹${NUM}点(?:固定)?伤害给(?:对手|对方|敌方)$`), go: (m) => { const n = num(m.slice(1).find((x) => x !== undefined)); return { effects: [{ op: "apply_status", name: "counter", target: "self", params: { flat: n } }] }; } },
  // "反弹对手最大体力N/M" → counter foeMaxN/foeMaxD（受击按攻击方最大体力分数反伤——与 flat 合计同轨）
  { id: "heal-77b", re: new RegExp(`^反弹(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*\\/\\s*${NUM}(?:的(?:固定)?伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { foeMaxN: num(m[1]), foeMaxD: num(m[2]) } }] }) },
  // "N%概率减少对手N/M当前体力" → percent 伤害（current 基线）+ chance
  { id: "heal-78", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(?:减少|降低)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}当前体力$|^(?:减少|降低)(?:对手|对方|敌方)${NUM}%当前体力$|^(?:减少|降低)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}当前体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [ns.length > 1 ? { op: "damage", kind: "percent", power: 1, frac: frac(ns[ns.length - 2], ns[ns.length - 1]), percentBase: "current", ...(ns.length > 2 ? { chance: ns[0] } : {}), target: "opponent" } : { op: "damage", kind: "percent", power: ns[0], percentBase: "current", target: "opponent" }] }; } },
  // "自身本回合受到的伤害减少N点" → dmg_reduce 1t
  { id: "heal-79", re: new RegExp(`^(?:自身|自己)?本回合受到的伤害减少${NUM}点$|^当回合受到的伤害减少${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: 1, params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "残留N点体力"/"残留一点HP" → endure（裸变体——"受到致死"语境由外层条件补）
  { id: "heal-80", re: /^残留[一1]点(?:体力|HP)$|^残留(\d+)点(?:体力|HP)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: m[1] !== undefined ? num(m[1]) : 1 } }] }) },
  // "N%的几率免疫异常状态"——概率免疫窗
  { id: "heal-81", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?免疫(?:所有|任何)?异常状态$|^${NUM}%的?(?:概率|几率)免疫(?:异常|弱化)$|^有?${NUM}%(?:的?(?:概率|几率))?免疫$|^(?:自身|自己)?受到(?:的)?异常状态?(?:时|候)?有?${NUM}%(?:的?(?:概率|几率))?免疫(?:异常状态?)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_chance", target: "self", params: { pct: num(m[1] ?? m[2] ?? m[3] ?? m[4]) } }] }) },
  // "攻击技能N%的几率先制+K"/"N%几率技能先制+K"——chance 先制窗
  { id: "heal-82", re: new RegExp(`^(?:攻击|所有|自身)?技能?${NUM}%(?:的?(?:概率|几率))?先制([+-]?)(\\d+)$|^${NUM}%的?(?:概率|几率)(?:使)?(?:自身)?(?:技能|攻击)?先制([+-]?)(\\d+)$`), go: (m) => { const pct = num(m[1] ?? m[4]); const s = m[2] ?? m[5]; const v = num(m[3] ?? m[6]); return { effects: [{ op: "apply_status", name: "prio_up", target: "self", chance: pct, params: { add: s === "-" ? -v : v } }] }; } },
  // "每次受到攻击对手命中-2"（heal-83 的签名以「受到攻击」开头，不带「每次」）。放在 heal-83 前面。
  { id: "p1-heal-01", re: /^每次受到攻击(?!则|时|后|伤害|\d|有?\d|吸取)(.+)$/, go: (m) => reactWrap(1, {}, m[1]) },
  { id: "heal-83", re: /^受到攻击(?!则|时|后|伤害|\d|有?\d|吸取)(.+)$/, go: (m) => reactWrap(1, {}, m[1]) },
  // 自死/复活族——检查点钩子未建模（"若自身死亡则复活"/"N%重生一次"）
  { id: "heal-84", re: /^若?自身(?:被击败|倒下|被击倒|战败)(?:时|后|则)?$|^若自身死亡(?:时|后|则)?$|^自身死亡(?:时|后)$|^(?:\d+)%的?(?:概率|几率)?重生(?:一|两|\d+)?次?$/, go: () => ({ unparsedReason: "self-KO revive — checkpoint hook not modeled (deferred)" }) },
  // 裸威力翻倍（"威力翻倍"/"自身攻击威力翻倍"——move 语境 powerMul；魂印语境转 dmg_boost）
  { id: "heal-85", re: /^威力翻倍$|^自身攻击威力翻倍$|^自身攻击(?:技能)?威力翻倍$|^(?:所有)?(?:攻击)?技能威力翻倍$|^使(?:自身|自己)?技能威力翻倍$/, go: () => ({ attachDamage: { powerMul: { numerator: 2, denominator: 1 } } }) },
  // "对手技能威力下降N%"/"令对手攻击技能威力下降N%" → power_mul 对手侧衰减窗
  { id: "heal-86", re: new RegExp(`^(?:对手|对方|敌方|本回合对手|当回合对手)(?:的)?(?:所有)?(?:攻击)?技能威力(?:下降|降低|减少)${NUM}%$|^令对手技能威力下降${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "power_mul", target: "opponent", params: { n: 100 - num(m[1] ?? m[2]), d: 100 } }] }) },
  // "自身技能威力提升N%" → power_mul 自身侧增益窗
  { id: "heal-87", re: new RegExp(`^(?:自身|自己)(?:的)?(?:所有)?(?:攻击)?技能威力(?:提升|提高|增加)${NUM}%$|^技能威力提升${NUM}%$`), go: (m) => (m[1] === undefined ? null : { effects: [{ op: "apply_status", name: "power_mul", target: "self", params: { n: 100 + num(m[1]), d: 100 } }] }) },
  // 攻击威力定额/百分比提升（"攻击技能提升N点威力"→dmg_flat；"攻击技能造成的伤害提升N%"→dmg_boost）
  { id: "heal-88", re: new RegExp(`^攻击(?:技能)?提升${NUM}点威力$|^攻击(?:技能)?威力提升${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "heal-89", re: new RegExp(`^攻击(?:技能)?造成的伤害提升${NUM}%$|^攻击技能伤害提升${NUM}%$|^(?:自身|自己)(?:造成的)?伤害(?:提高|提升|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m.slice(1).find((x) => x !== undefined)) } }] }) },
  // 条件追加增伤（"自身体力低于对手时额外提高N%"——"额外"语义为加算；门控经 pendingCond→passCondGate 通道）
  { id: "heal-90", re: new RegExp(`^额外(?:提高|提升|增加)${NUM}%$|^(?:提高|提升|增加)${NUM}%$|^伤害(?:额外)?(?:提高|提升)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m.slice(1).find((x) => x !== undefined)) } }] }) },
  // set-override 尾（"伤害减免提高到N%"/"几率变为N%"——改写前句数值而非增量，跨子句数值覆盖未建模 → deferred）
  { id: "heal-91", re: new RegExp(`^(?:受到?的)?伤害减免(?:提高|提升|变为|变成)到?(${NUM})%$|^减免(?:提高|变为|提升)(${NUM})%$`), go: (m) => ({ attachAll: { chanceSet: num(m[1] ?? m[2]) } }) },
  // 非 pct 窗语境的裸"提高到/变为"仍显式延后（目标窗不明——防误挂）
  { id: "heal-92", re: /^(?:受到?的)?伤害减免(?:提高|提升|变为|变成)|^减免(?:提高|变为)/, go: () => ({ unparsedReason: "conditional set-override — '提高到/变为' replaces prior clause value (deferred)" }) },
  // 次数暴击窗（"下N次攻击N%打出致命一击"→crit_up count；运行时逐击递减）
  { id: "heal-93", re: new RegExp(`^下${NUM}次攻击${NUM}%打出致命[一1]?击$|^下${NUM}次(?:攻击|技能)${NUM}%的?(?:概率|几率)?打出致命[一1]?击$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { count: ns[0], n: ns[1], d: 100 } }] }; } },
  // "下次使用技能先制+K"/"下次攻击先制+K"/"下次出手先制+K" → prio_count 单次窗
  { id: "heal-94", re: /^(?:自身|自己)?下次(?:(?:使用|所有|全部|攻击|出手)?技能?)?先制([+-])(\d+)$/, go: (m) => { const v = num(m[2]); return { effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: 1, add: m[1] === "-" ? -v : v } }] }; } },
  // "首次攻击先制+K"——首战先制窗（count:1 近似首战）
  { id: "heal-95", re: /^首次(?:攻击|出手|使用技能)?先制([+-])(\d+)$/, go: (m) => { const v = num(m[2]); return { effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: 1, add: m[1] === "-" ? -v : v } }] }; } },
  // "使对手损失最大体力的N/M"——最大体力百分比伤害（区别于"减少最大体力"=max_hp_down 面板削减）
  { id: "heal-96", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)损失(?:的)?(?:自身)?最大体力的?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: { numerator: num(m[1]), denominator: num(m[2]) }, target: "opponent" }] }) },
  // —— "下次…" 单次窗（count:1 挂载；触发型走 react 载荷，ei 由 soulmark-parse 盖戳） ——
  // "下次使用技能给对手造成等同于恢复量的固定伤害" → react:11 payload damage flatSelfLastHeal
  { id: "heal-97", re: /^下次使用技能给对手造成等同于恢复量(?:数值的|的)?(?:固定伤害|固伤)$/, go: () => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 11, count: 1 }, payload: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatSelfLastHeal: true }] }] }) },
  // "下次攻击命中后有自身已损失体力百分比的几率造成伤害提升N%" → dmg_boost count:1 + 动态已损率门
  { id: "heal-98", re: new RegExp(`^下次攻击命中后有自身已损失体力百分比的几率造成伤害提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: 1, pct: num(m[1]), chanceSelfMissingPct: 1 } }] }) },
  // 持久版（无"下次"）："有自身已损失体力百分比的几率造成伤害提升N%" → dmg_boost 常驻动态概率窗
  { id: "heal-99", re: new RegExp(`^有自身已损失体力百分比的几率(?:使|令)?(?:自身)?(?:攻击)?造成(?:的)?伤害(?:提升|提高)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]), chanceSelfMissingPct: 1 } }] }) },
  // "使当回合造成的伤害提升N%" → dmg_boost turns:1 当回合窗
  { id: "heal-100", re: new RegExp(`^(?:使|令)?当回合造成的伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 1, params: { pct: num(m[1]) } }] }) },
  // "下次攻击技能令对手随机N个技能PP归零" → react:11 cat:4 声明攻击窗
  { id: "heal-101", re: new RegExp(`^下次(?:使用)?攻击技能令(?:对手|对方|敌方)随机${NUM}(?:个|项|条)技能?PP(?:值)?归零$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: 4, count: 1 }, payload: [{ op: "pp_delta", target: "opponent", zeroRandom: num(m[1]) }] }] }) },
  // "下次使用(属性|攻击)技能时附加N点(真实|固定)伤害" → react:11 cat 窗 载荷 damage
  { id: "heal-102", re: new RegExp(`^下次使用(属性|攻击)技能(?:时|后)?附加${NUM}点(真实|固定|百分比)?(?:的)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: m[1] === "属性" ? 1 : 4, count: 1 }, payload: [{ op: "damage", kind: m[3] === "真实" ? "true" : m[3] === "百分比" ? "percent" : "fixed", ...(m[3] === "百分比" ? { power: 1, frac: { numerator: num(m[2]), denominator: 100 } } : { power: 0, flatBonus: num(m[2]) }), target: "opponent" }] }] }) },
  // "下次攻击附加自身N/M最大体力固伤" → dmg_flat count:1 分数键（params 整数平铺）
  { id: "heal-103", re: new RegExp(`^下次攻击附加自身${NUM}\\s*/\\s*${NUM}最大体力(?:的)?(?:固伤|固定伤害)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { count: 1, selfMaxFracNum: num(m[1]), selfMaxFracDen: num(m[2]) } }] }) },
  { id: "heal-104", re: new RegExp(`^下次攻击附加${NUM}点(?:固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { count: 1, flat: num(m[1]) } }] }) },
  // "下次攻击(技能)?(造成的)?伤害提升N%" → dmg_boost count:1
  { id: "heal-105", re: new RegExp(`^下次攻击(?:技能)?(?:造成的)?伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: 1, pct: num(m[1]) } }] }) },
  // "下次使用攻击技能时使本次攻击必定打出致命一击" → crit_always count:1
  { id: "heal-106", re: /^下次(?:使用)?攻击技能(?:时|后)?(?:使|令)?(?:本次攻击|本技能|自身)?必定打出?致命(?:一|1)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: 1 } }] }) },
  // "下次X几率翻倍" → next_chance mul:2（魂印自身触发几率单次翻倍）
  { id: "heal-107", re: /^下次.{0,7}?几率翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "next_chance", target: "self", params: { mul: 2, count: 1 } }] }) },
  // "下次X几率提升至N%" → next_chance set（"提升至/到"=变为定值）
  { id: "heal-108", re: new RegExp(`^下次.{0,7}?几率(?:提升|提高|变|升)(?:至|到|为)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "next_chance", target: "self", params: { set: num(m[1]), count: 1 } }] }) },
  // "下次X几率(额外)?提升N%" → next_chance add（"下次触发几率提升15%"/"下次害怕几率提升10%"）
  { id: "heal-109", re: new RegExp(`^下次.{0,7}?几率(?:额外)?提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "next_chance", target: "self", params: { add: num(m[1]), count: 1 } }] }) },
  { id: "heal-110", re: /^若?(?:自身|自己)的?(?:属性|攻击|所有)?技能失效(?:时|则)?$/, go: () => ({ unparsedReason: "nullification-cond — own-move-voided predicate not modeled (deferred)" }) },
  // 对手命中降幅（"对手所有攻击技能命中率降低N%"≈自身 dodge pct——UNVERIFIED 等价近似）
  { id: "heal-111", re: new RegExp(`^(?:对手|对方|敌方)(?:所有)?攻击技能?命中率(?:降低|下降|减少)${NUM}%$|^(?:对手|对方|敌方)?(?:所有)?攻击命中率(?:降低|下降|减少)${NUM}%$|^攻击命中率(?:降低|下降|减少)${NUM}%$`), go: (m) => { const n = num(m.slice(1).find((x) => x !== undefined)); return { effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: n } }] }; } },
  // 伤害回血变体（"恢复造成伤害值N%的体力"/"造成伤害的N%恢复自身体力值"→drain_atk）
  { id: "heal-112", re: new RegExp(`^恢复(?:自身)?(?:造成的)?伤害(?:值)?${NUM}%(?:的)?体力$|^(?:自身|自己)?(?:攻击)?造成伤害的${NUM}%恢复自身体力值?$|^恢复自身等量体力值?$`), go: (m) => { const pct = m.slice(1).find((x) => x !== undefined); return { effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: pct !== undefined ? num(pct) : 1, d: pct !== undefined ? 100 : 1 } }] }; } },
  // PP 免费（"使用技能不消耗PP值"→pp_free）
  { id: "heal-113", re: /^使用技能不消耗PP值?$|^(?:所有)?技能不消耗PP$|^技能使用时?不消耗PP值?$/, go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }) },
  // 双免疫（"免疫异常状态和能力下降状态"→immune_status + immune_degrade）
  { id: "heal-114", re: /^(?:自身|自己)?免疫(?:所有|任何)?异常状态(?:和|与|及|以及)(?:所有)?能力(?:下降|弱化)状态$|^(?:自身|自己)?免疫异常(?:和|与|以及)弱化$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "免疫A、B"枚举（"免疫中毒、烧伤"——顿号/逗号分隔的异常池，逐项 scoped immune）
  { id: "heal-115", re: new RegExp(`^(?:自身|自己)?免疫((?:${AIL_RE})(?:[、,，以及](?:${AIL_RE}))+)(?:状态)?$`), go: (m) => { const list = m[1].split(/[、,，]+|以及/).map((x) => AILMENTS[x]).filter(Boolean); return { effects: list.map((a) => ({ op: "apply_status", name: "immune_status", target: "self", ailment: a })) }; } },
  // 最大体力差值固伤（"附加对手与自身最大体力差值的固定伤害"→flatMaxHpDiffPct:100）
  { id: "heal-116", re: new RegExp(`^附加(?:对手|对方|敌方)与自身最大体力差值的?(?:固定|固伤)?伤害$|^自身技能附加(?:对手|对方|敌方)与自身最大体力差值的?固定伤害$`), go: () => ({ attachDamage: { flatMaxHpDiffPct: 100 } }) },
  { id: "heal-117", re: /^(?:伤害|攻击|攻击伤害)?(?:提升|提高|增加)?效果翻倍$|^伤害提升效果翻倍$/, go: () => ({ attachAll: { effectDouble: true } }) },
  { id: "heal-118", re: /^护[罩盾]$/, go: () => ({ unparsedReason: "shield lifecycle fragment (UNVERIFIED)" }) },
  { id: "heal-119", re: /^(?:有)?一定(?:的)?几率/, go: () => ({ unparsedReason: "unquantified chance — percentage unknown (UNVERIFIED)" }) },
  // 瞬杀（"所有技能必定瞬杀对手"——必定 KO，等价秒杀全额）
  { id: "heal-120", re: /^所有技能必定瞬杀(?:对手|对方|敌方)?$|^必定瞬杀(?:对手|对方|敌方)?$|^瞬杀(?:对手|对方|敌方)?$|^所有技能秒杀(?:对手|对方|敌方)$|^秒杀(?:对手|对方|敌方)$/, go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent" }] }) },
  { id: "heal-121", re: /^(?:使|令)?(?:对手|对方|敌方)?.{0,6}能力等级(?:变为|保持)?与自身相同$|^(?:使|令)自身能力等级变为与对手相同$/, go: () => ({ unparsedReason: "stage-sync residual — direction/scope variant UNVERIFIED" }) },
  // 属性技能失效 → move_null cat:1
  { id: "heal-122", re: /^(?:使|令)?(?:对手|对方|敌方)?(?:释放的|使用的)?(?:所有)?属性技能失效$|^对手属性技能无法?使用$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 } }] }) },
  // "闪避则X"/"闪避成功则X"——闪避成功触发（react trigger2=对手 MISS 对侧即自身闪避）
  { id: "heal-123", re: /^闪避(?:成功)?(?:则|时|后)(.+)$|^若闪避(?:成功)?则(.+)$/, go: (m) => reactWrap(2, {}, m[1] ?? m[2]) },
  { id: "heal-124", re: /^为自身体力$|^若对手$|^增加\d+点$/, go: () => ({ unparsedReason: "truncated fragment — referent lost (UNVERIFIED)" }) },
  { id: "heal-125", re: /^(?:对手|对方|敌方)每处于\d*种?能力(?:下降|弱化)状态$/, go: () => ({ orphanCond: { foeStageDown: true } }) },
  // "受伤减少100"（"受伤"句首归一未及的中段残文——"2回合内受伤减少100"）。放在 heal-126 前面，那条要求句首「受到伤害」。
  { id: "heal-126a", re: new RegExp(`^受伤(?:减少|降低)(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // 被动承伤定额减免（"受到的伤害减少50点"——非反应式，须先于受击拦截）
  { id: "heal-126", re: new RegExp(`^受到(?:的)?伤害(?:减少|降低)(\\d+)(?:点)?$|^受到(?:的)?攻击伤害(?:减少|降低)(\\d+)(?:点)?$|^受到伤害(?:减少|降低)(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "heal-127", re: new RegExp(`^(?:自身|自己)?受到的伤害不超过(\\d+)(?:点)?$|^(?:自身|自己)?受到的伤害(?:不高于|不大于)(\\d+)$|^自身受到的伤害低于(\\d+)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "heal-128", re: new RegExp(`^(?:自身|自己)?下?${NUM}回合受到(?:的)?伤害减少${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", turns: ns.length > 1 ? ns[0] : undefined, params: { pct: ns[ns.length - 1] } }] }; } },
  { id: "heal-129", re: /^若?对手使用属性技能则(.+)$|^对手使用属性技能时(.+)$|^对手使用属性技能后(.+)$|^若?对手使用属性技能(?=降低|令|使|吸取|恢复|回复|消除|清除|附加|造成|无法)(.+)$/, go: (m) => reactWrap(3, { cat: 1 }, m[1] ?? m[2] ?? m[3] ?? m[4]) },
  // 回合未受击触发（"回合结束时若当回合未受到攻击伤害则X"——turn-end trigger 8）
  { id: "heal-130", re: /^回合结束时若(?:当回合)?未受到(?:攻击)?伤害则(.+)$|^若当回合未受到攻击伤害则(.+)$|^若(?:本|当)回合未受到攻击则(.+)$|^本回合若未受到伤害则(.+)$|^若?(?:本|当)?回合?未受到(?:攻击)?伤害则(.+)$/, go: (m) => reactWrap(8, {}, m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) },
  { id: "heal-131", re: /^若?对手使用攻击技能则(.+)$|^对手使用攻击技能时(.+)$|^对手使用攻击技能后(.+)$|^若?对手使用攻击技能(?=降低|令|使|吸取|恢复|回复|消除|清除|附加|造成|无法)(.+)$/, go: (m) => reactWrap(3, { cat: 4 }, m[1] ?? m[2] ?? m[3] ?? m[4]) },
  // 强化被消除触发（"若自身能力强化被消除则X"→trigger7 变体）
  { id: "heal-132", re: /^若?自身能力(?:强化|提升)被(?:消除|吸取|偷取)则?(.+)$/, go: (m) => reactWrap(7, {}, m[1]) },
  // 概率招式失效窗口（"对手N回合内所有技能有M%概率失效"→move_null chance 门控）
  { id: "heal-133", re: new RegExp(`^(?:对手|对方|敌方)${NUM}回合内?所有技能有${NUM}%概率失[效败]$|^(?:令|使|让)(?:对手|对方|敌方)${NUM}回合内?(?:所有)?技能${NUM}%概率失[效败]$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const hasVerb = /^(?:令|使|让)/.test(m[0]); const t = hasVerb ? ns[0] : ns[0]; const c = hasVerb ? ns[1] : ns[1]; return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: t, params: { chance: c } }] }; } },
  // 次数制固伤减免（"下N次受到的固定伤害和百分比伤害减少M%"→flat_taken_pct count）
  { id: "heal-134", re: new RegExp(`^下${NUM}次受到的固定伤害和百分比伤害减少${NUM}%$|^${NUM}次内?受到的固定伤害减少${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "flat_taken_pct", target: "self", params: { count: ns[0], pct: ns[1] } }] }; } },
  // 裸概率闪避（"30%的几率闪避对手攻击"→dodge pct）
  { id: "heal-135", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?闪避(?:对手|对方|敌方)?攻击$|^${NUM}%闪避攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  { id: "heal-136", re: /^若?对手MISS则(.+)$|^对手MISS时(.+)$|^若对手MISS(.+)$|^(?:若)?对手(?:的)?攻击MISS(?:则|时)(.+)$|^若对手攻击MISS(.+)$/i, go: (m) => reactWrap(2, {}, m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) },
  { id: "heal-137", re: /^若?自身MISS则(.+)$|^自身MISS时(.+)$/i, go: (m) => reactWrap(6, {}, m[1] ?? m[2]) },
  { id: "heal-138", re: /^(?:若)?对手使用属性技能(?:时|则)?$|^对手使用属性技能$/, go: () => ({ dynTriggerPart: { trigger: 3, cat: 1 } }) },
  { id: "heal-139", re: /^(?:若)?(?:对手|对方|敌方)使用攻击技能(?:时|则)?$|^对手使用攻击技能$/, go: () => ({ dynTriggerPart: { trigger: 3, cat: 4 } }) },
  { id: "heal-140", re: /^(?:若)?使用属性技能(?:时|则)?$/, go: () => ({ dynTriggerPart: { trigger: 11, cat: 1 } }) },
  { id: "heal-141", re: /^(?:若)?使用攻击技能(?:时|则)?$/, go: () => ({ dynTriggerPart: { trigger: 11, cat: 4 } }) },
  // 内联 "X则Y"（则臂未被逗号切开）：对手/自身使用技能 → trigger 3/11 payload
  { id: "heal-142", re: new RegExp(`^(?:若|本回合若)?(?:对手|对方|敌方)使用属性技能则(.+)$|^对手使用属性技能则(.+)$`), go: (m) => reactWrap(3, { cat: 1 }, m[1] ?? m[2]) },
  { id: "heal-143", re: new RegExp(`^(?:若|本回合若|本回合)?(?:对手|对方|敌方)使用攻击技能则(.+)$|^对手使用攻击技能则(.+)$`), go: (m) => reactWrap(3, { cat: 4 }, m[1] ?? m[2]) },
  { id: "heal-144", re: new RegExp(`^(?:若)?使用属性技能则(.+)$`), go: (m) => reactWrap(11, { cat: 1 }, m[1]) },
  { id: "heal-145", re: new RegExp(`^(?:若)?使用攻击技能则(.+)$`), go: (m) => reactWrap(11, { cat: 4 }, m[1]) },
  { id: "heal-146", re: /^(?:若)?(?:对方|对手|敌方)下?回合使用(?:属性|攻击)技能$/, go: (m) => ({ dynTriggerPart: { trigger: 3, cat: /属性/.test(m[0]) ? 1 : 4 } }) },
  { id: "heal-147", re: /^若受到攻击$|^受到攻击$/, go: () => ({ dynTriggerPart: { trigger: 1 } }) },
  // 对手使用属性技能反应式（trigger 3 cat:1——与 143 的攻击版对称；尾句为空→dynTriggerPart 孤儿触发器）
  { id: "heal-148a", re: /^若?(?:对手|对方|敌方)使用属性技能(?:，|,|则|时|后)?(.*)$/, go: (m) => { const tail = m[1] ?? ""; const cm = tail.match(/^(\d+)%(?:的)?(?:概率|几率)?$/); if (cm !== null) return { dynTriggerPart: { trigger: 3, cat: 1, chance: num(cm[1]) } }; return tail === "" ? ({ dynTriggerPart: { trigger: 3, cat: 1 } }) : reactWrap(3, { cat: 1 }, tail); } },
  { id: "heal-148b", re: /^若?(?:对手|对方|敌方)使用攻击技能(?:，|,|则|时|后)?(.*)$/, go: (m) => { const tail = m[1] ?? ""; const cm = tail.match(/^(\d+)%(?:的)?(?:概率|几率)?$/); if (cm !== null) return { dynTriggerPart: { trigger: 3, cat: 4, chance: num(cm[1]) } }; return tail === "" ? ({ dynTriggerPart: { trigger: 3, cat: 4 } }) : reactWrap(3, { cat: 4 }, tail); } },
  { id: "heal-148", re: /^若?(?:对手|对方|敌方)使用(?:属性|攻击)技能|^若?受到(?:的)?攻击(?!技能|时|\d|吸取|伤害|减少|降低|减|提升|增加)/, go: () => ({ unparsedReason: "reactive trigger — E4" }) },
  { id: "heal-149", re: /^受到攻击时(.+)$/, go: (m) => reactWrap(1, {}, m[1]) },
  { id: "heal-150", re: /^若?受到的伤害(?!减少|降低|减半|减\d|提升|提高|增加|翻倍|加倍|不超过|大于|低于|转化)/, go: () => ({ unparsedReason: "reactive trigger — E4" }) },
  { id: "heal-151", re: new RegExp(`^随机附加给(?:对手|对方|敌方)(\\d+)[-~—至到](\\d+)点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } }) },
  // 一次性定额吸取（"额外吸取对手70点体力"=fixed 伤害 + 等量回血）
  { id: "heal-152", re: new RegExp(`^(?:额外)?吸取(?:对手|对方|敌方)(\\d+)点?(?:体力|HP|生命)$|^吸取对手(\\d+)点?HP$|^吸取(?:对手|对方|敌方)(\\d+)(?:HP|点)$`), go: (m) => { const n = num(m[1] ?? m[2] ?? m[3]); return { effects: [{ op: "damage", kind: "fixed", power: n }, { op: "heal", flat: n, target: "self" }] }; } },
  // 百分比伤害单类型减伤（"百分比伤害减少30%"——flatTakenPct 的 percent 单类型版）
  { id: "heal-153", re: /^(?:受到的?)?百分比伤害(?:减少|降低|下降)(\d+)%$/, go: (m) => ({ effects: [{ op: "apply_status", name: "pct_taken_pct", target: "self", params: { pct: num(m[1]) } }] }) },
  // 攻击伤害提升（"自身攻击造成的伤害提升50%"→attachDamage.mul——魂印语境转 dmg_boost）
  { id: "heal-154", re: /^(?:自身|自己)?攻击造成的?伤害(?:提升|提高|增加)(\d+)%$|^造成(?:的)?攻击伤害(?:提升|提高)(\d+)%$|^(?:自身|自己)造成的?攻击伤害(?:提升|提高|增加)(\d+)%$/, go: (m) => ({ attachDamage: { mul: { numerator: 100 + num(m[1] ?? m[2] ?? m[3]), denominator: 100 } } }) },
  // "自身攻击50%打出致命一击"→attachDamage.critChance
  { id: "heal-155", re: /^(?:自身|自己)?攻击(\d+)%(?:的?(?:几|概)?率)?打出致命[一1]?击$|^攻击技能(\d+)%(?:的?(?:几|概)?率)?打出致命[一1]?击$/, go: (m) => ({ attachDamage: { critChance: num(m[1] ?? m[2]) } }) },
  // "所有技能额外先制+N"/"自身下N次属性技能先制+K" → prio_up 次数/常驻窗
  { id: "heal-156", re: /^(?:自身|自己)?(?:的)?(?:所有|全部)(?:攻击|攻击技能|技能)?(?:额外)?先制\+(\d+)$|^所有攻击先制\+(\d+)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: num(m[1] ?? m[2]) } }] }) },
  // "攻击技能先制+N"（cat=4 门控先制——只作用攻击技）
  { id: "heal-157", re: new RegExp(`^(?:自身|自己)?(?:的)?攻击技能(?:额外)?先制([+-]?)${NUM}$|^属性技能(?:额外)?先制([+-]?)${NUM}$`), go: (m) => { const s = m[1] ?? m[2]; const v = num(m[0].match(/\d+/)?.[0] ?? "1"); return { effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: s === "-" ? -v : v, cat: /属性/.test(m[0]) ? 1 : 4 } }] }; } },
  { id: "heal-158", re: new RegExp(`^(?:自身|自己)?下${NUM}次属性技能先制\\+(\\d+)$|^(?:自身|自己)?下${NUM}次(?:攻击)?技能先制\\+(\\d+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: ns[0], add: ns[ns.length - 1] } }] }; } },
  // "N%的几率将本回合受到的伤害转化为自身体力" → dmg_to_heal + chance
  { id: "heal-159", re: /^(\d+)%(?:的?(?:几|概)?率)?将(?:本回合)?受到(?:的)?伤害转化为自身体力$|^将(?:本回合|当回合)?受到?的?(?:攻击)?伤害转化为自身体力$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  // 承伤上限按最大体力分数（"受到的技能伤害不超过自身最大体力的25%"→dmg_cap.capPct）
  { id: "heal-160", re: /^(?:自身|自己)?(?:每次)?受到?的?(?:技能|攻击)?伤害(?:不|不会|不得)超过(?:自身)?(?:最大)?(?:体力|HP|生命)的?(\d+)%(?:点)?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { capPct: num(m[1]) } }] }) },
  // "免疫暴击"（暴击=致命一击俗名）。放在 heal-161 前面，那条词表只收「致命一击」。
  { id: "heal-161a", re: /^(?:自身|自己)?免疫(?:受到的)?暴击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] }) },
  // 抵挡致命一击（"自身抵挡受到的致命一击"→crit_immune 常驻窗）
  { id: "heal-161", re: /^(?:自身|自己)?抵挡(?:受到的)?致命一击$|^免疫(?:受到的)?致命一击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] }) },
  // "令对手当回合体力恢复效果减少99%"。放在 heal-162 前面，那条没有「当回合」。
  { id: "heal-162a", re: /^(?:令|使)(?:对手|对方|敌方)当回合(?:的)?体力恢复效果减少(\d+)%$/, go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", turns: 1, params: { pct: num(m[1]) } }] }) },
  // 对手侧减疗（"令对手体力恢复效果减少50%"→heal_cut foe）
  { id: "heal-162", re: /^(?:令|使)(?:对手|对方|敌方)(?:的)?(?:体力)?恢复(?:效果|能力)?减少(\d+)%$/, go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: num(m[1]) } }] }) },
  // "恢复自身所有技能N点PP" → pp_delta +N all self
  { id: "heal-163", re: new RegExp(`^(?:自身|自己)?恢复(?:自身|自己)?所有(?:技能)?(${NUM})点(?:的)?(?:PP|pp)值?$|^恢复(?:自身|自己)?所有技能(?:PP|pp)值?\\+(${NUM})$|^所有技能恢复(${NUM})点(?:PP|pp)值?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", amount: ns[ns.length - 1], target: "self", scope: "all" }] }; } },
  // "附加固定伤害"裸量缺失（无量词——不可静默折算）
  { id: "heal-164", re: /^(?:同时|并且?|额外)?附加(?:的)?固定伤害$/, go: () => ({ unparsedReason: "unquantified flat — no amount (UNVERIFIED)" }) },
  // "此效果的倍数+N/最高增加至N"——倍率计数器域未建模
  { id: "heal-165", re: /^(?:使|令)?此效果的?倍(?:数|率)[+＋](\d+)$|^最高(?:可)?(?:增加|提升)(?:至|到)?(\d+)$/, go: () => ({ unparsedReason: "multiplier counter — per-effect stack unmodeled (deferred)" }) },
  // "若当次技能无效/若此技能无效"——本技能被无效谓词（nullification-cond 族）
  { id: "heal-166", re: /^若?(?:(?:当次|该次|此|本)技能无效|技能无效(?:则|,|，).+)(?:则|,|，)?(.+)?$/, go: (m) => ({ unparsedReason: "nullification-cond — own-move-voided predicate not modeled (deferred)" }) },
  // "获得N个X"→apply_mark（个 量词变体；"获得1个风龙结"）/"X数量+N"→印记层数加项
  { id: "heal-167", re: new RegExp(`^(?:自身|自己)?(?:获得|得到|生成|持有)${NUM}个([\\p{Script=Han}·]{2,8})$`, "u"), go: (m) => { const mk = m[2]; if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|免疫|精灵|技能|道具/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: num(m[1]), target: "self" }] }; } },
  // "拥有X" → apply_mark 单层（"boss对战中自身拥有神话"——具名印记，无量词按 1 层）
  { id: "heal-168", re: /^(?:自身|自己)?拥有([\p{Script=Han}·]{2,8})$/u, go: (m) => { const mk = m[1]; if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|免疫|精灵|技能|道具|能力|属性|特点|特性|攻击|先制|命中/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: 1, target: "self" }] }; } },
  { id: "heal-169", re: new RegExp(`^([\\p{Script=Han}]{2,8})(?:的)?数量[+＋](${NUM})$`, "u"), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[1], count: num(m[2]), target: "self" }] }) },
  // "除以附加的概率"等概率除数公式 → 公式链 deferred
  { id: "heal-170", re: /^除以(?:附加的|所附|其)?概率$/, go: () => ({ unparsedReason: "formula cross-ref — arithmetic chain unmodeled (deferred)" }) },
  // "吸取对手自身X值N%的体力"（虚骸龙灵/诺尔玛罗——对手面板数额 + 等额吸血）
  { id: "heal-171", re: new RegExp(`^(?:自身|自己)(?:所有|全部)(?:攻击|攻击技能)?吸取(?:对手|对方|敌方)(?:自身)?(速度|攻击|防御|特攻|特防|体力|最大体力)值?${NUM}%的体力$|^吸取(?:对手|对方|敌方)(?:自身)?(速度|攻击|防御|特攻|特防|体力|最大体力)值?${NUM}%的体力$`), go: (m) => { const st = { 速度: "spd", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 体力: "hp", 最大体力: "hp" }[m[1] ?? m[3]] ?? "spd"; return { attachDamage: { flatFoeStatPct: { stat: st, pct: num(m[2] ?? m[4]) }, drain: frac(1, 1) } }; } },
  // "吸取自身X值N%的体力"（自身面板数额——罕见变体）
  { id: "heal-172", re: new RegExp(`^吸取(?:对手|对方|敌方)(?:的)?体力[^%]{0,4}自身(速度|攻击|防御|特攻|特防|体力|最大体力)值?${NUM}%$|^吸取(?:对手|对方|敌方)?自身(速度|攻击|防御|特攻|特防|体力|最大体力)值?${NUM}%的体力$`), go: (m) => { const st = { 速度: "spd", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 体力: "hp", 最大体力: "hp" }[m[1] ?? m[3]] ?? "spd"; return { attachDamage: { flatSelfStatPct: { stat: st, pct: num(m[2] ?? m[4]) }, drain: frac(1, 1) } }; } },
  // "X值提升N点"（面板修正——"速度值提升50点"→stat_boost add）
  { id: "heal-173", re: new RegExp(`^(?:自身|自己)?的?(速度|攻击|防御|特攻|特防|体力|最大体力)值?(?:提升|增加|提高)${NUM}点$`), go: (m) => { const st = { 速度: "spd", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 体力: "hp", 最大体力: "hp" }[m[1]]; return { effects: [{ op: "stat_boost", stats: [st], add: num(m[2]), target: "self" }] }; } },
  // "附加自身攻击值N%的固伤"→flatAtkPct 同族（攻击值分数固伤）
  { id: "heal-174", re: /^附加(?:自身|自己)?攻击(?:值|力)?的?(\d+)%(?:的)?(?:固定伤害|固伤)$|^附加(?:自身|自己)?攻击(?:值|力)的?(\d+)%(?:的)?(?:固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatSelfPct: num(m[1] ?? m[2]) } }) },
  // "附加自身造成的攻击伤害N%的固定伤害"→flatEcho（已造成伤害的N%追加固伤）
  { id: "heal-175", re: /^附加(?:自身|自己)?造成的?(?:攻击)?伤害的?(\d+)%(?:的)?(?:固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatEcho: { pct: num(m[1]) } } }) },
  // "都有N%的几率使自身先制额外+K"/"N%几率无视对手能力提升状态"
  { id: "heal-176", re: /^都有(\d+)%(?:的?(?:几|概)?率)?使(?:自身|自己)?先制(?:额外)?\+(\d+)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", chance: num(m[1]), params: { add: num(m[2]) } }] }) },
  { id: "heal-177", re: /^(\d+)%(?:的?(?:几|概)?率)?无视(?:对手|对方|敌方)能力(?:提升|强化)状态$/, go: (m) => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self", chance: num(m[1]) }] }) },
  // "自身造成的伤害翻倍" → attachDamage.mul 2x
  { id: "heal-178", re: /^(?:自身|自己)?造成的?伤害翻倍$|^造成(?:的)?伤害(?:效果)?翻倍$|^(?:自身|自己)?攻击(?:技能)?造成的?伤害翻倍$|^(?:自身|自己)?(?:攻击(?:技能)?)?造成的?伤害(?:提升|提高)(\d+)%$/, go: (m) => ({ attachDamage: { mul: m[1] !== undefined ? { numerator: 100 + num(m[1]), denominator: 100 } : { numerator: 2, denominator: 1 } } }) },
  // "自身有N%的几率闪避对手攻击"/"自身闪避率提升N%" → dodge
  { id: "heal-179", re: /^(?:自身|自己)?有?(\d+)%(?:的?(?:几|概)?率)?闪避(?:对手|对方|敌方)?的?(?:所有)?(?:攻击|技能)$|^闪避率(?:提升|提高|增加)(\d+)%$|^自身闪避率(?:提升|提高|增加)(\d+)%$|^(?:增加|提升|提高)(\d+)%的?闪避率$|^增加(\d+)%的?闪避(?:率)?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) } }] }) },
  // "N%闪避当回合受到的攻击" → dodge 1t 窗
  { id: "heal-180", re: new RegExp(`^${NUM}%闪避(?:当|本)回合受到的(?:攻击|攻击伤害)$|^${NUM}%的?(?:概率|几率)?闪避(?:当|本)回合受到的?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: num(m[1]) } }] }) },
  // kind 限定承伤减免（"受到的固定伤害、百分比伤害减少50%"→kindMask 位图：固定=1 百分比=2 标准/攻击=4 真实=8）
  { id: "heal-181", re: new RegExp(`^受到(?:的)?(固定|百分比|真实|攻击|技能|普通)?伤害(?:和|与|、|或)(固定|百分比|真实|攻击|技能|普通)?伤害(?:的)?(?:减少|减|降低|下降|减免)${NUM}%$|^受到(?:的)?(固定|百分比|真实)伤害(?:的)?(?:减少|减|降低|下降|减免)${NUM}%$|^受到(?:的)?(固定|百分比|真实)(?:和|与|、|或)(固定|百分比|真实)伤害(?:的)?(?:减少|减|降低|下降|减免)${NUM}%$`), go: (m) => { const K = { 固定: 1, 百分比: 2, 攻击: 4, 技能: 4, 普通: 4, 真实: 8 }; const caps = m.slice(1).filter((x) => x !== undefined); const mask = caps.filter((x) => K[x] !== undefined).reduce((a, k) => a | K[k], 0); const p = num(caps[caps.length - 1]); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: p, ...(mask !== 0 ? { kindMask: mask } : {}) } }] }; } },
  // kind 限定出伤提升（"造成的固定伤害和百分比伤害提高25%"→dmg_boost kindMask）
  { id: "heal-182", re: new RegExp(`^(?:自身|自己)?造成(?:的)?(固定|百分比|真实|攻击|技能|普通)?伤害(?:和|与|、|或)(固定|百分比|真实|攻击|技能|普通)?伤害(?:的)?(?:提高|提升|增加)${NUM}%$|^(?:自身|自己)?造成(?:的)?(固定|百分比|真实)伤害(?:的)?(?:提高|提升|增加)${NUM}%$|^(?:自身|自己)?造成(?:的)?(固定|百分比|真实)(?:和|与|、|或)(固定|百分比|真实)伤害(?:的)?(?:提高|提升|增加)${NUM}%$`), go: (m) => { const K = { 固定: 1, 百分比: 2, 攻击: 4, 技能: 4, 普通: 4, 真实: 8 }; const caps = m.slice(1).filter((x) => x !== undefined); const mask = caps.filter((x) => K[x] !== undefined).reduce((a, k) => a | K[k], 0); const p = num(caps[caps.length - 1]); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: p, ...(mask !== 0 ? { kindMask: mask } : {}) } }] }; } },
  // "获得N%的A伤害、B伤害…减免"（获得语态多 kind 承伤减免——kindMask 位图；词序 kind 在前减免在后）
  { id: "heal-183", re: new RegExp(`^获得${NUM}%的(?:(?:固定|百分比|真实|攻击)伤害[、和与])+?(?:固定|百分比|真实|攻击)伤害减免$|^获得${NUM}%的(固定|百分比|真实|攻击)伤害减免$`), go: (m) => { const K = { 固定: 1, 百分比: 2, 攻击: 4, 真实: 8 }; const mask = (m[0].match(/固定|百分比|真实|攻击/g) ?? []).reduce((a, k) => a | (K[k] ?? 0), 0); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1] ?? m[3]), ...(mask !== 0 ? { kindMask: mask } : {}) } }] }; } },
  // "受到的伤害减N%"（减字尾变体——被动承伤降幅）
  { id: "heal-184", re: new RegExp(`^受到(?:的)?(?:攻击)?伤害(?:减少|减|降低|下降)${NUM}%$|^受到(?:的)?攻击(?:伤害)?(?:减少|减|降低|下降)${NUM}%$|^受到(?:的)?攻击(?:减少|降低)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // "对手造成的A伤害、B伤害减少N%直到下场"（foe 出伤削弱多 kind——dmg_boost 负 pct + kindMask；直到下场=常驻窗）
  { id: "heal-185", re: new RegExp(`^(?:对手|对方|敌方)造成的?(?:(?:攻击|固定|百分比|真实|技能|普通)伤害[、和与])+?(?:攻击|固定|百分比|真实|技能|普通)伤害的?(?:减少|降低|下降|减免)${NUM}%(?:直到下场)?$`), go: (m) => { const K = { 固定: 1, 百分比: 2, 攻击: 4, 技能: 4, 普通: 4, 真实: 8 }; const mask = (m[0].match(/固定|百分比|真实|攻击|技能|普通/g) ?? []).reduce((a, k) => a | (K[k] ?? 0), 0); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "opponent", params: { pct: -num(m[1]), ...(mask !== 0 ? { kindMask: mask } : {}) } }] }; } },
  // "使对手下一次攻击伤害降低N%" → dmg_weaken count:1（下次出伤后窗尽）
  { id: "heal-186", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下(?:一|1)次(?:攻击|造成的?攻击)?伤害(?:的)?(?:降低|减少|下降)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: 100 - num(m[1]), d: 100, count: 1 } }] }) },
  // "下N次攻击造成伤害的P%恢复自身体力" → drain_atk count:N（次数窗逐击递减）
  { id: "heal-187", re: new RegExp(`^下${NUM}次(?:攻击)?造成(?:的)?伤害的?${NUM}%(?:恢复|回复|转化为|转为)自身体力`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[2]), d: 100, count: num(m[1]) } }] }) },
  // "攻击有自身当前体力百分比的概率使对手AIL" → apply_status + flags.dynChance（魂印条级 chanceDyn 动态概率）
  { id: "heal-188", re: new RegExp(`^(?:自身|自己)?攻击(?:技能)?有(自身|自己|对手|对方|敌方)?((?:当前|现有|剩余)?已损失|损失|当前|现有|剩余)?的?体力(?:值)?的?百分比(?:的)?(?:几|概)?率(?:使|令|让)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => { const missing = /损失/.test(m[2] ?? ""); const foeSide = /对手|对方|敌方/.test(m[1] ?? ""); const dyn = foeSide ? (missing ? "foeMissingHpPct" : "foeHpPct") : (missing ? "selfMissingHpPct" : "selfHpPct"); return { effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent" }], flags: { dynChance: dyn } }; } },
  // "自身每处于N种能力提升则造成伤害提高M%" → dmg_boost params.perStage（dmgOutPctOf 原生；M=每段提升幅度）
  { id: "heal-189", re: new RegExp(`^(?:自身|自己)每处于${NUM}种能力提升(?:状态)?则造成(?:的)?(攻击)?伤害(?:提高|提升|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perStage: num(m[3]), ...(m[2] !== undefined ? { kindMask: 4 } : {}) } }] }) },
  // "对手每处于N种能力提升则自身受到伤害降低M%" → dmg_taken_down params.perFoeStage（M=每段减免幅度）
  { id: "heal-190", re: new RegExp(`^(?:对手|对方|敌方)每处于${NUM}种能力提升(?:状态)?则(?:自身|自己)?受到(?:的)?(攻击)?伤害(?:降低|减少|下降|减免)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { perFoeStage: num(m[3]), ...(m[2] !== undefined ? { kindMask: 4 } : {}) } }] }) },
  // "受到的伤害增加N%"（自身承伤加深——dmg_taken_up 自我侧）
  { id: "heal-191", re: new RegExp(`^(?:自身|自己)?受到(?:的)?(?:攻击)?伤害(?:增加|提升|提高)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "self", params: { pct: num(m[1]) } }] }) },
  // "令己方X异常"（己方=自身——魂印/招式自损族）
  { id: "heal-192", re: new RegExp(`^([0-9]+)?%?(?:的?(?:几|概)?率)?(?:令|使|让)己方(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "self", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  // 抵挡N次攻击 → dmg_immune 次数窗
  { id: "heal-193", re: /^(?:可以)?抵挡(两|\d+)次(?:攻击|攻击伤害|伤害)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: m[1] === "两" ? 2 : num(m[1]) } }] }) },
  // "抵挡受到的攻击"——常驻免攻窗（无次数/回合限定的抵挡≈全免 UNVERIFIED）
  { id: "heal-194", re: /^抵挡(?:受到|所受)?(?:的)?(?:所有|一切)?(?:攻击|攻击伤害|伤害)$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  // dmg_taken_down 不读 pctMin/pctMax（区间只在 dmg_boost 上 roll）。写成 pct 会开始减免，所以只挂空窗。
  { id: "heal-195", re: new RegExp(`^受到的攻击伤害随机减少${NUM}%[-~—至到]${NUM}%$|^受到的攻击伤害减少${NUM}%[-~—至到]${NUM}%$`), go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self" }] }) },
  // 时序标记碎片（"战斗阶段结束时"——合组残留，忽略）
  { id: "heal-196", re: /^战斗阶段结束时$|^每个月的\d+日(?:-\d+日)?$|^所有特效?boss无效$/i, go: () => ({ ignored: true }) },
  // "自身免疫受到的异常状态"（受到-异常——免疫施加侧）
  { id: "heal-197", re: /^自身免疫受到(?:的)?(?:所有)?异常状态$|^免疫(?:自身)?受到的?异常状态$|^免疫所?有?异常状态$|^自身免疫所?有?异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // 定向异常免疫（"免疫受到的麻痹状态"→ailment 字段限定；apply 时 kind 合成 name:ailment）
  { id: "heal-198", re: new RegExp(`^(?:自身|自己)?免疫(?:受到|所受)?的?(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", ailment: AILMENTS[m[1]] }] }) },
  // "自身攻击技能附加N点固定伤害" → flatBonus
  // "攻击附带100点固定伤害"（heal-199 的动词只收「附加」，「附带」是空档）。放在 heal-199 前面。
  { id: "p1-heal-03", re: /^(?:自身|自己)?(?:所有|全部)?攻击(?:技能)?附带([0-9]+)点(?:固定伤害|固伤|固定)?$/, go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  { id: "heal-199", re: /^(?:自身|自己)?(?:所有|全部)?攻击(?:技能)?附加(\d+)点(?:固定伤害|固伤|固定)?$|^攻击技能附加(\d+)点(?:固定伤害|固伤)$|^攻击附加(\d+)(?:固定|固定伤害|固伤)$|^附加(\d+)(?:固定|固定伤害|固伤)$/, go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2] ?? m[3] ?? m[4]) } }) },
  // "回合结束后使对手X异常N回合"（回合末施加带回合数）
  { id: "heal-200", re: new RegExp(`^回合结束(?:时|后)?使(?:对手|对方|敌方)(${AIL_RE})(\\d+)回合$|^回合结束(?:时|后)(?:使|令)(?:对手|对方|敌方)(${AIL_RE})$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1] ?? m[3]], target: "opponent", ...(m[2] !== undefined ? { turns: num(m[2]) } : {}) }] }) },
  // "自身攻击消除对手能力提升状态" → clear_stages up foe（魂印 onDamageDealt 语境）
  { id: "heal-201", re: /^(?:自身|自己)?攻击消除(?:对手|对方|敌方)能力(?:提升|强化)状态$|^攻击消除对手强化状态$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "自身下次技能先制+N" → prio_count 次数窗
  { id: "heal-202", re: new RegExp(`^(?:使|令)?(?:自身|自己)?下次(?:攻击|属性)?技能先制\\+(\\d+)$|^(?:使|令)?(?:自身|自己)?下次(?:攻击|出手)?先制\\+(\\d+)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { count: 1, add: num(m[1] ?? m[2]) } }] }) },
  // "自身造成攻击伤害的N%恢复自身体力" → drain（攻击伤害的 变体）
  { id: "heal-203", re: /^造成(?:攻击)?伤害的(\d+)%(?:恢复|回复)至?(?:自身|自己)?体力值?$|^自身造成(?:的)?攻击伤害的?(\d+)%(?:恢复|回复)至?(?:自身|自己)?体力值?$/, go: (m) => ({ attachDamage: { drain: { numerator: num(m[1] ?? m[2]), denominator: 100 } } }) },
  // "第N柄：先制+K"（七剑族代号碎片——逗号合组残留）→ prio flags
  { id: "heal-204", re: /^第[一二三四五六七八九十0-9]+柄[:：]?先制\+(\d+)$/, go: (m) => ({ flags: { priority: num(m[1]) } }) },
  // "免疫异常状态和能力下降状态" → immune_status + immune_degrade 双 op
  { id: "heal-205", re: /^免疫(?:所有)?异常状态(?:和|与|、)(?:所有)?能力下降状态$|^免疫(?:所有)?异常(?:状态)?及?能力下降(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "不会陷入能力下降状态"/"不会陷入异常状态" → 免疫族
  { id: "heal-206", re: /^不?会?陷入(?:所有)?能力下降状态$|^不会?陷入(?:任何|所有)?异常状态$|^不会?陷入(?:任何|所有)?异常$/, go: (m) => ({ effects: [{ op: "apply_status", name: /能力/.test(m[0]) ? "immune_degrade" : "immune_status", target: "self" }] }) },
  // "对手每回合所有技能PP-N" → pp_drain（持有者回合末对手PP扣减）
  { id: "heal-207", re: /^(?:对手|对方|敌方)每回合(?:所有)?技能PP(?:-|减)(\d+)$|^每回合使对手所有技能PP(?:-|减)(\d+)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "自身受到的伤害不会超过N" → dmg_cap
  { id: "heal-208", re: /^(?:自身|自己)?受到(?:的)?(?:攻击)?伤害不会?超过(\d+)$|^(?:自身|自己)?所受伤害不会?超过(\d+)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // "受到致死攻击残留一点体力"/"受到致死伤害余下1点体力" → endure
  { id: "heal-209", re: /^(?:受到|当受到)(?:的)?致死(?:攻击|伤害|一击)(?:时|后)?残留一?1?点?(?:体力|HP)$|^(?:受到|当受到)(?:的)?致死(?:攻击|伤害)(?:时|后)?(?:余下|保留|剩下)1?一?点?(?:体力|HP)$/, go: () => ({ effects: [{ op: "apply_status", name: "endure", target: "self" }] }) },
  // "无视对手的防御和特防能力强化状态" → pierce_stages（全维近似——def/sdf 限定无 flag 粒度 UNVERIFIED）
  { id: "heal-210", re: /^无视(?:对手|对方|敌方)的?防御和特防(?:的)?能力(?:提升|强化)状态$|^无视对手双防(?:提升|强化)状态$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "附加自身最大体力N/N的固定伤害" → flatSelfFrac（自身上限分数固伤）
  { id: "heal-211", re: new RegExp(`^(?:附加|附带)自身最大体力(?:值)?的?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定伤害|固伤)$|^(?:附加|附带)自身最大体力${NUM}%(?:的)?(?:固定伤害|固伤)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatSelfFrac: ns.length > 1 ? { numerator: ns[0], denominator: ns[1], base: "max" } : { numerator: ns[0], denominator: 100, base: "max" } } }; } },
  // 随机吸取体力（"随机吸取对手200-300点体力"=fixed 随机伤害 + 等量回血 → drain 1/1）
  { id: "heal-212", re: new RegExp(`^随机吸取(?:对手|对方|敌方)?(\\d+)[-~—至到](\\d+)点(?:体力|HP|体力值)?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, flatRange: { min: num(m[1]), max: num(m[2]) }, drain: { numerator: 1, denominator: 1 } }] }) },
  // 条件区间固伤（"对手处于能力下降状态时固伤变为250-350点"→partCond 由外层注入为 flatRangeIf）
  { id: "heal-213", re: new RegExp(`^(?:固定伤害|固伤)变为(\\d+)[-~—至到](\\d+)点$|^(?:固定伤害|固伤)改为(\\d+)[-~—至到](\\d+)点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatRange: { min: ns[0], max: ns[1] } } }; } },
  { id: "heal-214", re: /^若受到的伤害大于/, go: () => ({ unparsedReason: "reactive damage-taken trigger orphan" }) },
  { id: "heal-215", re: /^(?:若)?护盾消失时(.+)$|^(?:若)?护罩消失时(.+)$|^(?:若)?(?:自身|此)?护盾或护罩消失时(.+)$|^(?:若)?此(?:护盾|护罩)消失时(.+)$|^(?:若)?自身(?:护盾|护罩)消失时(.+)$/, go: (m) => reactWrap(4, {}, m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) },
  { id: "heal-216", re: /^若?被(?:对手|对方|敌方)击败则(.+)$|^被(?:对手|对方|敌方)击败时(.+)$|^自身被击败时(.+)$|^若被击败则(.+)$/, go: (m) => reactWrap(5, {}, m[1] ?? m[2] ?? m[3] ?? m[4]) },
  // 耗盾转伤（"消耗自身所有护盾值并造成等量固定伤害"——护盾吸收量并入固伤；power:0 纯修饰位）
  { id: "heal-217", re: /^消耗(?:自身|自己)所有护盾值(?:并(?:造成|附加)(?:对手|对方|敌方)?等量(?:固定|固伤)?伤害)?$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", consumeShield: true }] }) },
  // 耗盾转奶（"消耗自身护盾并恢复等量体力"——heal.consumeShield：吸收量并入回复额）
  { id: "heal-284", re: /^消耗(?:自身|自己)(?:所有|全部)?护[盾罩](?:值|之和)?(?:，|,|、)*(?:并|且)?(?:恢复|回复|治疗)(?:自身|自己)?(?:等量|等同|相同)(?:的)?体力(?:值)?$/, go: () => ({ effects: [{ op: "heal", target: "self", consumeShield: true }] }) },
  // 削上限（"减少对手最大体力的1/3"→对手侧永久 max_hp_down；"回合结束时减少"→maxhp_tick）
  { id: "heal-218", re: new RegExp(`^(?:回合结束时|每回合结束时|每回合)减少(?:对手|对方|敌方)(?:(?:的)?最大(?:体力|HP)(?:值)?的?${NUM}\\s*/\\s*${NUM}|${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:体力|HP)(?:值)?)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [liftTick({ op: "apply_status", name: "maxhp_tick", target: "opponent", params: { n: ns[0], d: ns[1] } })] }; } },
  { id: "heal-219", re: new RegExp(`^(?:减少|降低)(?:对手|对方|敌方)(?:(?:的)?最大(?:体力|HP)(?:值)?的?${NUM}\\s*/\\s*${NUM}|${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:体力|HP)(?:值)?)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: ns[0], d: ns[1] } }] }; } },
  // "对手减少N点HP"——口语扣血 → flat 伤害（无"伤害"字样变体）
  { id: "heal-220", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)减少${NUM}点?(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "damage", power: num(m[1]), kind: "fixed", target: "opponent" }] }) },
  // 后备回复（"恢复己方所有不在场精灵N点体力"/"恢复己方下只出战精灵全部体力"→bench 或 nextAlly 由前缀处理）
  { id: "heal-221", re: new RegExp(`^恢复己方所有不在场精灵(\\d+)点体力$|^恢复(?:己方|本方)所有不在场精灵(\\d+)点(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "bench" }] }) },
  // 低伤免疫+等量反伤（"若受到的伤害低于N则免疫伤害并造成等同于伤害量的固定伤害"→dmg_floor params.echo）
  { id: "heal-222", re: new RegExp(`^若?受到的伤害低于(\\d+)(?:点)?则免疫(?:攻击)?伤害(?:并造成等同于伤害量的固定伤害)?$|^(?:自身|自己)?免疫(?:低于|小于)(\\d+)(?:点)?(?:的)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_floor", target: "self", params: { min: num(m[1] ?? m[2]), echo: /并造成等同于伤害量的固定伤害$/.test(m[0]) ? 1 : 0 } }] }) },
  // "免疫对手的攻击技能"/"免疫攻击" → dmg_immune 常驻窗
  { id: "heal-223", re: /^免疫(?:对手|对方|敌方)?(?:的)?(?:所有)?攻击(?:技能|伤害)?$|^(?:自身|自己)免疫(?:对手|对方|敌方)?(?:的)?(?:所有)?攻击(?:技能|伤害)?$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  // 强化被消反应（"若自身能力提升状态被消除或吸取则X"→react trigger 7）
  { id: "heal-224", re: /^若?自身能力提升状态被(?:消除|吸取|偷取)(?:或吸取)?则(?!$)(.+)$|^若?自身强化状态被消除则(.+)$/, go: (m) => reactWrap(7, {}, m[1] ?? m[2]) },
  // 无视防御（"忽略对手N%的双防值"/"下次攻击忽略对手双防值的N%"）
  { id: "heal-225", re: new RegExp(`^(?:攻击|所有攻击|下次攻击)?忽略(?:对手|对方|敌方)(\\d+)%(?:的)?(?:双防|防御|防御能力)(?:值)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: num(m[1]), ...(m[0].startsWith("下次攻击") ? { count: 1 } : {}) } }] }) },
  { id: "heal-226", re: new RegExp(`^下?次?攻击忽略(?:对手|对方|敌方)(?:双防|防御)(?:值)?的?(\\d+)%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: num(m[1]), count: 1 } }] }) },
  // 回合吸强（"每回合吸收对手的能力强化状态"）
  { id: "heal-227", re: /^每回合吸收(?:对手|对方|敌方)(?:的)?能力(?:强化|提升)状态$|^每回合吸取对手能力强化状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "steal_stages_tick", target: "self" })] }) },
  // 无视伤害限制（"自身所有攻击无视对手伤害限制效果"）
  { id: "heal-228", re: /^(?:自身|自己)?(?:所有)?攻击?无视(?:对手|对方|敌方)(?:的)?伤害限制(?:效果)?$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_limit", target: "self" }] }) },
  // 组队标注（非战斗语义——"组队可用"/"组队影响N个目标"仅 PVE 标识）
  { id: "heal-229", re: /^组队可用$|^组队影响\d+个目标$|^组队时?可使用$/, go: () => ({ ignored: true }) },
  // dmg_floor 等量反伤尾句（"免疫伤害并造成等同于伤害量的固定伤害"被"并"切出——回挂最近 dmg_floor）
  { id: "heal-230", re: /^(?:并)?造成等同于(?:伤害量|所受伤害|其伤害)(?:值)?的固定伤害$/, go: () => ({ dmgFloorEcho: true }) },
  // "并反弹给对手" 尾句（"解除自身能力下降状态并反弹给对手"）——回挂 cleanse_down_tick→down_push_tick
  { id: "heal-231", re: /^(?:并)?反弹给(?:对手|对方|敌方)$/, go: () => ({ downPush: true }) },
  // 承伤上限溢出段反弹尾句（"自身下N次受到的攻击伤害不超过M，并反弹给对手原本超出部分P%的百分比伤害"）。
  // 只认这一种词形，且只标个记号——P 由解析器回挂到宿主 dmg_cap 窗的 params.excessPct（钳前伤害−cap 的 P%）。
  // 基数不是钳后的 dmg：落成 reflect_dmg 在 cap=0 的宿主上会恒反 0，是静默错。
  { id: "r5a-excess-reflect-tail", re: new RegExp(`^反弹给(?:对手|对方|敌方)原本超出部分${NUM}%的百分比伤害$`), go: (m) => ({ excessReflectPct: num(m[1]) }) },
  { id: "heal-232", re: /^反弹给(?:对手|对方|敌方)(?!造成伤害值?\d|的?伤害值?\d).+$/, go: () => ({ unparsedReason: "excess/reflect tail — deferred" }) },
  // 暴击率/致命维度留档（sixstat 无致命等级维；"致命+N"/"致命率提升"未量化）
  { id: "heal-233", re: /^(?:自身)?致命[一1]?击率提升$/, go: () => ({ unparsedReason: "crit-rate unquantified" }) },
  { id: "heal-234", re: new RegExp(`^致命\\+${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "crt", delta: num(m[1]), target: "self" }] }) },
  // 回合末消除对手回合类效果（"回合结束后消除对手回合类效果"→一次性 flag）
  { id: "heal-235", re: /^(?:回合结束后|回合结束时|回合末)(?:消除|清除)(?:对手|对方|敌方)回合(?:类)?效果$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "cleanse_foe_tick", target: "self", params: { count: 1 } })] }) },
  // "下回合自身(攻击)?必定致命(一)?击"（react payload 与直连形态）
  { id: "heal-236", re: /^下回合自身(?:攻击|攻击技能)?必定致命(?:一)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 } }] }) },
  // "必定会心一击"（会心一击=致命一击）。放在 heal-237 前面，那条词表只收「致命」。
  { id: "heal-237a", re: /^(?:自身|自己)?(?:的)?(?:攻击|攻击技能)?必定(?:打出)?会心一击$/, go: () => ({ attachDamage: { crit: true } }) },
  { id: "heal-237", re: /^(?:自身|自己)?(?:的)?(?:攻击|攻击技能)?必定(?:打出)?致命(?:一)?击$/, go: () => ({ attachDamage: { crit: true } }) },
  // "攻击必定致命一击并附加X"（并附保护不切分——crit flag + 尾部子解析递归合并）
  { id: "heal-238", re: /^(?:自身|自己)?攻击(?:技能)?必定(?:打出)?致命[一1]?击并(附加.+)$/, go: (m) => { const sub = parseEffectText(m[1]); if ((sub.unparsed ?? []).length > 0) return { unparsedReason: `crit-combo tail unparsed: ${m[1]}` }; return { attachDamage: { crit: true, ...(sub.flags?.attachDamage ?? {}) }, effects: sub.effects ?? [] }; } },
  // "N%的概率打出致命一击"→本招致命率 critChance（条件形态经 partCond → critChanceIf）
  { id: "heal-239", re: new RegExp(`^${NUM}%(?:的?(?:概|几)?率)?打出致命[一1]?击$|^${NUM}%(?:的?(?:概|几)?率)?造成致命[一1]?击$`), go: (m) => ({ attachDamage: { critChance: num(m[1] ?? m[2]) } }) },
  // "对手必定打出致命一击"→对方侧 crit_always 窗口（副作用类）
  { id: "heal-240", re: /^(?:对手|对方|敌方)(?:攻击|攻击技能)?必定(?:打出)?致命(?:一)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "opponent", turns: 1 }] }) },
  // "若X则必定(打出)?致命(一)击"→crit_always + cond（自身窗口1回合）
  { id: "heal-241", re: /^若(.+?)则(?:必定|一定)?打出?致命(?:一)?击$/, go: (m) => { const c = condOf(m[1]); if (!c) return { unparsedReason: `critAlways cond unparsed: ${m[1]}` }; return { effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 1, if: c }] }; } },
  // "每回合提升防御双防等级+1"（防御双防=def+sdf 固定对，stat:8 哨兵）
  { id: "heal-242", re: new RegExp(`^每回合(?:提升|提高)?(?:防御双防|双防)(?:等级)?([+-])${NUM}$|^每回合(?:提升|提高)(自身|自己)?防御和特防(?:等级)?([+-])${NUM}$`), go: (m) => { const s = m[1] ?? m[4]; const v = num(m[2] ?? m[5]); return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: 8, delta: s === "-" ? -v : v } })] }; } },
  // "额外伤害40点"（额外 剥离后剩 "伤害40点"）→flatBonus
  { id: "heal-243", re: new RegExp(`^(?:额外)?伤害${NUM}点$|^附加额外伤害${NUM}点$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2]) } }) },
  // 双类承伤减幅（"受到物理攻击和特殊攻击伤害减少50%"——物理+特殊=全部攻击）
  { id: "heal-244", re: new RegExp(`^受到物理攻击和特殊攻击(?:的)?伤害减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1]) } }] }) },
  // 承伤低阈值触发（"若对手造成的伤害低于N则X"→react trigger1 max 门控）
  { id: "heal-245", re: new RegExp(`^若?(?:对手|对方|敌方)造成的伤害(?:若)?低于${NUM}(?:点)?(?:则|，|,)(?!免疫|该伤害)(.+)$`), go: (m) => reactWrap(1, { max: num(m[1]) }, m[2]) },
  // "恢复N/M最大HP"——分数前置变体（与"恢复最大体力的N/M"同义）
  { id: "heal-246", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:最大)?(?:体力|HP|生命值)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[ns.length - 2], denominator: ns[ns.length - 1], target: "self" }] }; } },
  // "所有攻击造成伤害N%将恢复体力"——吸血窗（drain_atk 等值 attachDamage.drain）
  { id: "heal-247", re: /^所有攻击造成伤害(\d+)%(?:将)?恢复(?:自身|自己)?体力|^造成(?:的)?伤害(\d+)%(?:将)?恢复(?:自身)?体力/, go: (m) => ({ attachDamage: { drain: { numerator: num(m[1] ?? m[2]), denominator: 100 } } }) },
  // "所有攻击附带N%的吸血效果" → drain_atk
  { id: "heal-248", re: /^所有攻击附带(\d+)%(?:的)?吸血(?:效果)?$|^攻击附带(\d+)%(?:的)?吸血/, go: (m) => ({ attachDamage: { drain: { numerator: num(m[1] ?? m[2]), denominator: 100 } } }) },
  // "使用回血技能使自身防御+1特防+1" → stat_stage 自增益
  { id: "heal-249", re: new RegExp(`^(?:每次)?(?:自身)?使用回血技能(?:都会)?(?:使|令)自身(${STAT_RE})([+-]?)${NUM}(?:、(${STAT_RE})([+-]?)${NUM})?$`), go: (m) => { const fx = [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: (m[2] === "-" ? -1 : 1) * num(m[3]), target: "self" }]; if (m[4] !== undefined) fx.push({ op: "apply_stat_stage", stat: STATS[m[4]], delta: (m[5] === "-" ? -1 : 1) * num(m[6]), target: "self" }); return { effects: fx }; } },
  // "消耗N点PP值"（自耗——pp_delta self current）
  { id: "heal-250", re: new RegExp(`^消耗${NUM}点[pP][pP]值?$|^消耗${NUM}点PP$`), go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[1] ?? m[2]), target: "self" }] }) },
  // "N点固定伤害" 裸片 → flatBonus
  { id: "heal-251", re: new RegExp(`^${NUM}点固定伤害$|^${NUM}点固伤$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2]) } }) },
  // "反弹对手给予的能力下降状态" → reflect_degrade 状态（stat-stage 负向变更弹回施加方）
  { id: "heal-252", re: /^反弹对手给予的能力下降状态$|^反弹能力下降状态$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_degrade", target: "self" }] }) },
  // "对手使用先制时X" → beforeOrder 守卫窗（order 先制谓词近似——UNVERIFIED）
  { id: "heal-253", re: /^对手使用先制(?:技能)?时(?:，|,)?/, go: () => ({ unparsedReason: "foe-priority-move trigger — unmodeled (deferred)" }) },
  // "若被对手击败则X" → onKO 已由 soulmark 触发表处理；此处裸句留档
  { id: "heal-254", re: /^若被对手击败则/, go: () => ({ unparsedReason: "ko-trigger-in-inner — boundary lost (deferred)" }) },
  // "反弹N/N对手造成的伤害"——反弹分数窗
  { id: "heal-255", re: /^反弹(\d+)\s*\/\s*(\d+)(?:对手|对方|敌方)?造成的伤害|^反弹(\d+)\s*\/\s*(\d+)(?:对手|对方|敌方)(?:的)?伤害/, go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // 已损失体力分数回复（"恢复自身已损失体力值的1/2"→missing 基线）
  { id: "heal-256", re: /^(?:恢复|回复)(?:造成|所造成)(?:的)?伤害的([0-9]+)%$|^(?:恢复|回复)自身造成的伤害值的([0-9]+)%$|^造成伤害值的([0-9]+)%恢复自身体力$/, go: (m) => ({ attachDamage: { drain: { numerator: +(m[1] ?? m[2] ?? m[3]), denominator: 100 } } }) },
  { id: "heal-257", re: new RegExp(`^恢复(?:自身|自己)?已损失(?:的)?体力(?:值)?的?${NUM}\\s*/\\s*${NUM}$|^恢复(?:自身|自己)?已损失(?:的)?体力(?:值)?的?${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const fr = ns.length > 1 ? { numerator: ns[0], denominator: ns[1] } : { numerator: ns[0], denominator: 100 }; return { effects: [{ op: "heal", ...fr, missing: true, target: "self" }] }; } },
  // 免疫下次攻击（"免疫下次对手的攻击"→dmg_immune count:1）
  { id: "heal-258", re: /^免疫(?:下[一1]次|下次)(?:对手|对方|敌方)?(?:的)?攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }] }) },
  // 承伤概率回血（"受到攻击时50%几率回复100点体力"→react trigger1 + params.chance 每次触发判定）
  { id: "heal-259", re: new RegExp(`^(?:若)?受到攻击(?:时|则)?(?:有)?(${NUM})%(?:的?(?:几|概)?率)?(?:回复|恢复)(?:自身|自己)?(${NUM})点(?:体力|HP)$`), go: (m) => reactWrap(1, { chance: num(m[1]) }, `恢复自身${num(m[2])}点体力`) },
  // 双方同步下场禁止（"双方下N回合无法主动切换精灵"→bind 双侧）
  { id: "heal-260", re: new RegExp(`^双方下${NUM}回合无法主动切换精灵$|^双方${NUM}回合内?无法(?:主动)?切换(?:精灵)?$`), go: (m) => { const t = num(m[1] ?? m[2]); return { effects: [{ op: "apply_status", name: "bind", target: "self", turns: t }, { op: "apply_status", name: "bind", target: "opponent", turns: t }] }; } },
  // "伤害再提升N%"（mul 变体）
  { id: "heal-261", re: new RegExp(`^(?:攻击|造成的)?伤害再提升${NUM}%$`), go: (m) => ({ attachDamage: { mul: { numerator: 100 + num(m[1]), denominator: 100 } } }) },
  // "若对手成功使用属性技能则X"（react trigger3 cat1）
  { id: "heal-262", re: /^若?对手成功使用属性技能[则，,]?(.+)$/, go: (m) => reactWrap(3, { cat: 1 }, m[1]) },
  // 异常状态整体迁移（"将对手所处的异常状态转移给自身"→pull；"解除并附加给对手自身所处的异常状态"→push）
  { id: "heal-263", re: /^(?:将|把|令|使|让)?(?:对手|对方|敌方)(?:所处)?的?异常状态转移给自身$/, go: () => ({ effects: [{ op: "transfer_ailments", direction: "pull", target: "opponent" }] }) },
  { id: "heal-264", re: /^解除并附加给(?:对手|对方|敌方)自身所处的异常状态$/, go: () => ({ effects: [{ op: "transfer_ailments", direction: "push", target: "opponent" }] }) },
  // 伤害转恢复窗口（"造成伤害N%恢复体力"→drain_atk 分数窗，永续）
  { id: "heal-265", re: new RegExp(`^造成(?:的)?伤害${NUM}%恢复(?:自身|自己)?体力$|^造成(?:的)?伤害${NUM}%(?:的)?恢复自身体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // "消除对手回合内效果" 变体
  { id: "heal-266", re: /^消除(?:对手|对方|敌方)回合内效果$|^消除(?:对手|对方|敌方)的回合效果$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // 每损失N%体力几率+M%（attachAll→chance op 挂 chancePerMissing 步长）
  { id: "heal-267", re: new RegExp(`^自身每损失${NUM}%的体力则(?:进入)?异常(?:状态)?几率(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ attachAll: { chancePerMissing: { per: num(m[1]), step: num(m[2]) } } }) },
  // 单维对齐（"自身的防御力和对手相同"→copy_stages stat 限定）
  { id: "heal-268", re: new RegExp(`^(?:自身|自己)?(?:的)?(${STAT_RE})(?:力|等级)?和对手相同$|^(?:自身|自己)?(?:的)?(${STAT_RE})(?:力|等级)?与对手相同$`), go: (m) => ({ effects: [{ op: "copy_stages", stat: STATS[m[1] ?? m[2]], target: "self" }] }) },
  // 换入触发（"对手主动切换精灵则登场精灵N%随机进入M种异常状态"→react trigger9）
  { id: "heal-269", re: new RegExp(`^触发后${NUM}回合内对手主动切换精灵(?:出战)?时?则?(.+)$|^${NUM}回合内对手主动切换精灵(?:出战)?时?则?(.+)$|^对手主动切换精灵(?:出战)?时?则?(.+)$`), go: (m) => { const t = (m[1] ?? m[3]) !== undefined ? num(m[1] ?? m[3]) : undefined; const sub = (m[2] ?? m[4] ?? m[5]).replace(/^登场精灵[，,]?/, "对手"); return reactWrap(9, {}, sub, t !== undefined ? { turns: t } : undefined); } },
  { id: "heal-270", re: new RegExp(`^对手主动切换精灵则(?:登场)?精灵${NUM}%随机进入${NUM}种(?:异常)?状态$`), go: (m) => reactWrap(9, {}, `${num(m[1])}%随机进入${num(m[2])}种异常状态`) },
  { id: "heal-271", re: new RegExp(`^对手下${NUM}次主动切换或死亡切换精灵时(?:，|,)?(.+)$`), go: (m) => reactWrap(9, { count: num(m[1]) }, m[2].replace(/^登场精灵/, "对手")) },
  // 低伤触反（"受到的伤害低于N则附加M点固定伤害"→react trigger1 max；免疫形态走 dmg_floor 规则）
  { id: "heal-272", re: new RegExp(`^若?受到的伤害低于${NUM}(?:点)?(?:则|，|,)(?!免疫)(.+)$`), go: (m) => reactWrap(1, { max: num(m[1]) }, m[2]) },
  // "立刻恢复自身N点体力"/"后恢复自身全部体力"/"恢复至满"
  { id: "heal-273", re: new RegExp(`^立刻恢复(?:自身|自己)${NUM}点体力$|^立即恢复自身${NUM}点体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "self" }] }) },
  { id: "heal-274", re: /^(?:回合结束)?后恢复(?:自身|自己)全部体力值?$|^恢复至满$|^恢复(?:自身|自己)?全部体力值?$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // "解除这些异常状态"（自身异常全解）
  { id: "heal-275", re: /^解除这些异常状态$|^解除所有异常状态$|^将其解除$|^将之解除$|^解除之$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  // "对手下N回合技能无效"（move_null 全类别窗口）
  { id: "heal-276", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}回合技能无效$|^令对手下${NUM}回合技能无效$|^(?:对手|对方|敌方)下?${NUM}回合内?技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: num(m[1] ?? m[2] ?? m[3]) }] }) },
  // 定额承伤减免窗口（"使自身下N回合受到的伤害减少M点"→dmg_reduce flat）
  { id: "heal-277", re: new RegExp(`^(?:使|令)?自身下?${NUM}回合(?:内)?受到的伤害减少${NUM}点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: num(m[1]), params: { flat: num(m[2]) } }] }) },
  // "减少150点下回合所受的伤害" → dmg_reduce flat（次回合窗口 turns:2）
  { id: "heal-278", re: new RegExp(`^减少${NUM}点(?:下回合|下${NUM}回合)所?受?(?:到)?的?(?:攻击)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: 2, params: { flat: num(m[1]) } }] }) },
  // "所受物理/特殊伤害减半" → cat 承伤减半 flag
  { id: "heal-279", re: /^所?受?(?:到)?的?物理(?:攻击)?伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "phys_half", target: "self" }] }) },
  { id: "heal-280", re: /^所?受?(?:到)?的?特殊(?:攻击)?伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  // "将所受伤害N倍反击给对手" → counter mul
  { id: "heal-281", re: new RegExp(`^(?:将)?所?受?(?:到)?的?(?:攻击)?伤害${NUM}倍反击(?:给)?(?:对手|对方|敌方)?$|^所受伤害的${NUM}倍反击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: num(m[1] ?? m[2]) } }] }) },
  // "对方所受伤害的1/4会反弹给自己"→攻击方反噬 recoilFrac（自身承伤=打出伤害×n/d）
  { id: "heal-282", re: new RegExp(`^(?:对手|对方|敌方)?所?[受收]?(?:到)?的?伤害的?${NUM}\\s*/\\s*${NUM}(?:会)?反弹(?:回|给)?自己$|^将所[受收]伤害的${NUM}\\s*/\\s*${NUM}反弹给自己$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { recoilFrac: { n: ns[0], d: ns[1] } } }; } },
  // "附加自身当回合所受技能伤害N%的百分比伤害" → flatPrevTakenPct（lastTaken 记账）
  { id: "heal-283", re: new RegExp(`^附加(?:自身|自己)?(?:当|本)回合所?受?(?:到)?的?(?:技能|攻击)?伤害的?${NUM}%的?(?:百分比|固定)?伤害$`), go: (m) => ({ attachDamage: { flatPrevTakenPct: num(m[1]) } }) },
];
