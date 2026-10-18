// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, frac } from "./lex.mjs";
import { parseEffectText } from "../effects-parse.mjs";

export const rules = [
  // ── 惩罚族/威力随强化级数缩放——系数未定，显式留档 ──
  { id: "penalty-01", re: /^惩罚$|^惩罚，/, go: () => ({ unparsedReason: "punish-scaling formula — coefficient UNVERIFIED (deferred family)" }) },
  { id: "penalty-02", re: /^(?:对方|对手|敌方)能力等级越高$/, go: () => ({ unparsedReason: "punish-scaling: damage grows with foe stage sum — formula UNVERIFIED" }) },
  { id: "penalty-03", re: /^此技能威力越大$|^技能威力越大$|^威力越大$/, go: () => ({ unparsedReason: "scale-by-stages tail fragment — coefficient UNVERIFIED" }) },
  { id: "penalty-04", re: /^自身体力越少则威力越大$|^体力越少威力越大$/, go: () => ({ unparsedReason: "scale-by-missing-hp — coefficient UNVERIFIED" }) },
  { id: "penalty-05", re: /^连续使用可以增加威力$/, go: () => ({ unparsedReason: "repeat-use power growth without coefficient (UNVERIFIED)" }) },
  { id: "penalty-06", re: /^致命[+＋]\d+$|^致命\d+$/, go: () => ({ unparsedReason: "crit-stage +N — crit stage semantics pending (UNVERIFIED)" }) },
  { id: "penalty-07", re: /^先制攻击$/, go: () => ({ flags: { priority: 1 } }) }, // UNVERIFIED：裸"先制攻击"≈先制+1（同"先手技能"约定）


  { id: "penalty-08", re: new RegExp(`^将自身能力等级返回至上${NUM}回合结束时$`), go: () => ({ unparsedReason: "stage rewind to N turns ago — history tracking not modeled (UNVERIFIED)" }) },
  { id: "penalty-09", re: /^若(?:对手|对方|敌方)免疫固定伤害则转变为真实伤害$/, go: () => ({ attachDamage: { kindIfImmune: "true" } }) },
  { id: "penalty-10", re: /^反弹所有受到的控制类异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_ctl", target: "self" }] }) },
  { id: "penalty-11", re: /^组队可向己方任意目标使用$/, go: () => ({ flags: { targetScope: "anyAlly" } }) },
  { id: "penalty-12", re: new RegExp(`^下次翻倍几率额外提升(\\d+)%$`), go: () => ({ unparsedReason: "mul-chance stacking step — per-use mulChance accumulation (UNVERIFIED)" }) },
  // 「恢复效果和固伤翻倍」：恢复走 heal_boost（有 reader）；固伤翻倍仍走 attachAll（需宿主 damage）
  { id: "penalty-13", re: /^恢复效果和固伤翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_boost", target: "self", params: { pct: 100 } }], attachAll: { flatDouble: true } }) },
  // 「恢复效果翻倍」：有宿主时由 attachAll.healDouble 烘焙进宿主分数（hot 的 mulLN/mulLD 等）；
  // 裸句（无宿主）时 healDouble 无处可挂，由 e41-20b-healdouble 兜底成 heal_boost。
  { id: "penalty-14", re: /^恢复效果翻倍$/, go: () => ({ attachAll: { healDouble: true } }) },
  { id: "penalty-15", re: /^(?:减免|承伤减免|伤害减免|减伤)效果?翻倍$/, go: () => ({ attachAll: { takenDownDouble: true } }) },
  { id: "penalty-16", re: /^(?:自身|自己)?恢复能力翻倍$|^(?:自身|自己)?恢复能力(?:效果)?翻倍$/, go: () => ({ attachAll: { healDouble: true } }) },
  { id: "penalty-17", re: /^固伤翻倍$|^固定伤害翻倍$/, go: () => ({ attachAll: { flatDouble: true } }) },
  // n 变量承伤减免经句首重写为"减少本回合伤害点"（见 parseEffectText 预处理）；此处吞 n 定义句
  { id: "penalty-18", re: /^[（(]?n[=＝等]于?本回合自身造成的伤害[)）]?$/i, go: () => ({ ignored: true }) },
  // 对手上次造成伤害值固伤（"附加对手上次造成伤害数值的固定伤害"）
  { id: "penalty-19", re: /^附加(?:对手|对方|敌方)上次造成(?:的)?伤害(?:数值)?的?(?:固定|固定伤害|固伤)$/, go: () => ({ attachDamage: { flatFoeLastDmg: true } }) },
  // "使用后N回合X"——TURNS_PRE 补此前缀
  // 消除双方护盾/护罩 + 总值反噬（"消除对手所有护盾、护罩效果，并附加等同于消除护盾、护罩值总和80%的百分比伤害"）
  { id: "penalty-20", re: new RegExp(`^消除(?:对手|对方|敌方|双方)(?:所有)?护盾、护罩(?:类)?(?:效果)?，?并?附加等同于消除护盾、护罩值总和(\\d+)%的(?:百分比|固定)?伤害$`), go: (m) => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield", echoPct: num(m[1]) }] }) },
  { id: "penalty-21", re: /^消除(?:对手|对方|敌方)(?:所有)?护盾、护罩(?:类)?(?:效果)?$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "shield" }] }) },
  { id: "penalty-22", re: /^护罩类?效果$/, go: () => ({ ignored: true }) }, // "护盾、护罩效果"切散残片——护罩归 shield 语义
  // 附加等级总和×N固伤（"附加自身能力提升等级总和X15的固定伤害"）
  { id: "penalty-23", re: new RegExp(`^附加(自身|对手|对方|敌方)能力(提升|下降)(?:状态)?等级总和[Xx×](\\d+)的(?:固定|固定伤害|固伤)$|^附加(自身|对手|对方|敌方)能力(提升|下降)(?:状态)?等级总和乘(?:以)?(\\d+)的?固定伤害$`), go: (m) => { const who = /对手|对方|敌方/.test(m[1] ?? m[4]) ? "foe" : "self"; const sign = /下降/.test(m[2] ?? m[5]) ? "down" : "up"; return { attachDamage: { flatPerStage: { who, sign, per: 1, flat: num(m[3] ?? m[6]), mode: "levels" } } }; } },
  // 全量恢复（"恢复自身所有体力和PP值"→heal 1/1 + pp full）
  { id: "penalty-24", re: /^恢复(?:自身|自己)?所有体力和PP值$|^恢复(?:自身|自己)?全部体力和PP值$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", target: "self", full: true }] }) },
  { id: "penalty-25", re: /^恢复(?:自身|自己)?所有体力$|^恢复(?:自身|自己)?全部体力$|^恢复所有体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // 全槽 PP 增减（"所有技能PP值-2"/"所有技能PP+1"）
  { id: "penalty-26", re: new RegExp(`^(?:自身|自己)?所有技能PP值?([+\\-＋－])${NUM}$|^(?:使|令)(?:对手|对方|敌方)所有技能PP值?([+\\-＋－])${NUM}$`), go: (m) => { const sgn = /[-－]/.test(m[1] ?? m[3] ?? "+") ? -1 : 1; const who = m[3] !== undefined ? "opponent" : "self"; return { effects: [{ op: "pp_delta", target: who, amount: sgn * num(m[2] ?? m[4]) }] }; } },
  // 自身死亡（自杀招——selfHp 自伤 KO）
  { id: "penalty-27", re: /^(?:则)?(?:自身|自己)死亡$|^(?:使|令)?(?:自身|自己)(?:直接)?(?:死亡|倒下)$/, go: () => ({ effects: [{ op: "damage", power: 0, kind: "fixed", selfHp: true, target: "self" }] }) },
  // 伤害分数回血（"伤害的30%恢复体力"→drain）
  { id: "penalty-28", re: new RegExp(`^(?:造成)?伤害的${NUM}%恢复(?:自身|自己)?体力$|^(?:造成)?伤害的${NUM}\\s*/\\s*${NUM}恢复(?:自身|自己)?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: ns.length > 1 ? frac(ns[0], ns[1]) : frac(ns[0], "100") } }; } },
  // 伤害分数反弹（"反弹对手造成伤害的N/M"/"将伤害反馈给对手"→reflect_dmg）
  { id: "penalty-29", re: new RegExp(`^反弹(?:对手|对方|敌方)造成伤害的?${NUM}\\s*/\\s*${NUM}$|^反弹${NUM}%的?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: ns.length > 1 ? { n: ns[0], d: ns[1] } : { n: ns[0], d: 100 } }] }; } },
  { id: "penalty-30", re: /^将伤害反馈给(?:对手|对方|敌方)$|^将(?:受到|所受)?的?伤害反馈给(?:对手|对方|敌方)$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }) },
  // 禁止主动换切（"令对手无法主动切换精灵"→no_switch 对手侧窗口）
  { id: "penalty-31", re: /^(?:令|使|让)(?:对手|对方|敌方)无法主动切换精灵$|^(?:对手|对方|敌方)无法主动切换精灵$|^(?:令|使|让)(?:对手|对方|敌方)无法切换精灵$/, go: () => ({ effects: [{ op: "apply_status", name: "no_switch", target: "opponent" }] }) },
  // "对手N回合内无法主动切换精灵" → no_switch 计时窗（"反转失败则对手2回合内无法主动切换精灵"）
  { id: "penalty-32", re: new RegExp(`^(?:对手|对方|敌方)${NUM}回合内?无法主动切换(?:精灵)?$|^(?:令|使|让)(?:对手|对方|敌方)${NUM}回合内?无法(?:主动)?切换(?:精灵)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "no_switch", target: "opponent", turns: num(m[1] ?? m[2]) }] }) },
  // 驱逐当前在场精灵（"驱逐对手当前在场精灵"→force_switch；带概率前缀由信封 chance 承载）
  { id: "penalty-33", re: /^有?(\d+)?%?(?:的?(?:几|概)?率)?(?:驱逐|驱离)(?:对手|对方|敌方)(?:当前)?(?:在场|出战)?精灵$/, go: (m) => ({ effects: [{ op: "force_switch", target: "opponent", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  // 能力提升翻倍（"使自身能力提升状态翻倍"→multiplySelf）
  { id: "penalty-34", re: /^(?:使|令)自身能力(?:提升|强化)状态翻倍$/, go: () => ({ effects: [{ op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self" }] }) },
  { id: "penalty-35", re: /^(?:对方|对手|敌方)所有强化效果消失$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // 消强化简称 / 吸取强化 / 抵挡次数 / 强力反击 / 禁疗裸句 / pp-zero payload
  { id: "penalty-36", re: /^消强化$|^消强$|^消除(?:对手|对方|敌方)?强化$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "penalty-37", re: /^(?:吸收|吸取)(?:对手|对方|敌方)能力(?:提升|强化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "transfer_stages" }] }) },
  { id: "penalty-38", re: new RegExp(`^可完全抵挡${NUM}次(?:攻击)?伤害$|^抵挡${NUM}次(?:攻击)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: ns[0] } }] }; } },
  { id: "penalty-39", re: new RegExp(`^(?:受到|受)攻击(?:时)?(\\d+)%概率做出强力反击$|^受到攻击做出强力反击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: 2 }, ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) }, // UNVERIFIED: "强力反击"倍率按 counter 2x 近似
  { id: "penalty-40", re: /^(?:对手|对方|敌方)无法通过(?:自身)?技能恢复(?:自身)?(?:体力|HP)$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent" }] }) },
  { id: "penalty-41", re: /^(?:对手|对方|敌方)技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  // "自身下N次受到的伤害降低M点" → dmg_reduce {flat,count}
  { id: "penalty-42", re: new RegExp(`^(?:自身|自己)?下(?:${NUM})?次受到的伤害(?:降低|减少)(\\d+)点$|^(?:使|令)?自身下次受到的伤害(?:降低|减少)(\\d+)点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: ns.length > 1 ? { flat: ns[1], count: ns[0] } : { flat: ns[0], count: 1 } }] }; } },
  // "受到的攻击伤害减少N%"（攻击限定——与通用承伤减免同机制 dmg_taken_down）
  { id: "penalty-43", re: new RegExp(`^受到的攻击伤害(?:降低|减少)${NUM}%$|^受到攻击伤害(?:降低|减少)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "每次直接攻击必定致命/暴击"（无"一击"尾巴变体）
  { id: "penalty-44", re: /^每次直接攻击必定致命$|^每次直接攻击必定暴击$|^每次攻击必定致命$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  // "护盾状态下连击上限为N" → hits.capIf
  { id: "penalty-45", re: new RegExp(`^自身处于护盾状态?下连击上限为(\\d+)$|^自身(?:处于|存在)护盾(?:状态)?(?:下|时)?连击上限为(\\d+)$`), go: (m) => ({ attachDamage: { hitsCapIf: { when: { selfHas: "shield" }, cap: num(m[1] ?? m[2]) } } }) },
  // "N%几率自身命中+M" → acc stage chance
  { id: "penalty-46", re: new RegExp(`^(\\d+)%(?:的)?几率(?:使)?自身命中([+\\-＋－])${NUM}$`), go: (m) => { const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); return { effects: [{ op: "apply_stat_stage", stat: "acc", delta: d, target: "self", chance: num(m[1]) }] }; } },
  // 自身属性值 N% 固伤（"附加自身速度值30%的固定伤害"/"附加自身最大体力30%的固伤"）
  { id: "penalty-47", re: new RegExp(`^附加自身(速度|攻击|防御|特攻|特防|最大体力|体力值?)(?:值)?${NUM}%的(?:固定|固伤|固定伤害|百分比|百分比伤害)$`), go: (m) => { const st = { 速度: "spd", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 最大体力: "hp", 体力: "hp", 体力值: "hp" }[m[1]] ?? "spd"; return { attachDamage: { flatSelfStatPct: { stat: st, pct: num(m[2]) } } }; } },
  // 回合末对手定额扣血（"回合结束时对手损失50点固定体力"→foe_dot flat；前缀经"每回合"重写）
  { id: "penalty-48", re: new RegExp(`^每回合(?:对手|对方|敌方)损失(\\d+)点(?:固定)?体力$|^(?:对手|对方|敌方)每回合损失(\\d+)点(?:固定)?体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "若伤害为奇数"——奇偶谓词未建模，显式留档
  { id: "penalty-49", re: /^若伤害为奇数(?:则)?$/, go: () => ({ unparsedReason: "odd-damage predicate — parity cond not modeled (UNVERIFIED)" }) },
  // 孤儿触发器（"本回合若受到伤害"/"每次直接攻击"→trigger 1/12 dynTrigger）
  { id: "penalty-50", re: /^本回合若受到伤害(?:时|则)?$|^若受到攻击(?:时|则)?$/, go: () => ({ dynTriggerPart: { trigger: 1 } }) },
  { id: "penalty-51", re: /^每次(?:直接)?攻击(?:时|命中时|命中)?$/, go: () => ({ dynTriggerPart: { trigger: 12 } }) },
  // 若对手处于回合类效果则伤害提升N%（foeTimed 条件）
  { id: "penalty-52", re: new RegExp(`^若(?:对手|对方|敌方)处于回合类效果(?:时)?则?(?:造成)?伤害(?:提升|增加)${NUM}%$`), go: (m) => ({ attachDamage: { mulIf: { when: { foeHasTimed: true }, numerator: 100 + num(m[1]), denominator: 100 } } }) },
  // 下只出场获得护盾（"令己方下只精灵出战时获得N点护盾"→nextAlly shield）
  { id: "penalty-53", re: new RegExp(`^令己方下(?:一|${NUM})?只(?:出场|出战)?精灵(?:出战时)?获得(\\d+)点护盾$`), go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "nextAlly", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 自身承伤 pct（"受到的攻击伤害减少N%"——攻击伤害限定）已并入 dmg_taken_down 通用规则，此处留空。
  { id: "penalty-54", re: new RegExp(`^双方每有${NUM}项技能PP值为0吸取(?:对手|对方|敌方)(\\d+)点体力$`), go: (m) => ({ attachDamage: { flatPerPpZero: { who: "both", per: num(m[1]), add: num(m[2]), drain: true } } }) },
];
