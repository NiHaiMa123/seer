// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e7：魂印长尾族（图鉴魂印 prose 的高频说法；与技能侧同一注册表，技能文本同型句一并受益）。
import { NUM, num, frac, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [

  // ── PP 族 ────────────────────────────────────────────────
  // "恢复(自身)所有技能N点PP值" → pp_delta self all +N
  { id: "p2-pp-13",
    re: /^(?:回满|补满|恢复满)(?:自身|自己)?(?:的)?(?:所有|全部)?(?:技能)?(?:的)?(?:PP|pp)(?:值)?$/,
    go: () => ({ effects: [{ op: "pp_delta", full: true, target: "self" }] }),
  },
  { id: "p2-pp-14",
    re: /^(?:自身|自己)?(?:所有|全部)技能(?:的)?(?:PP|pp)(?:值)?[+](([0-9]+|一|二|两|三|四|五|六|七|八|九|十))$/,
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self", scope: "all" }] }),
  },
  { id: "e7-pp-01",
    re: new RegExp(`^(?:恢复|回复|补充)(?:自身|自己)?(?:所有|全部)技能(?:的)?PP值?\\+?(${NUM})点?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self" }] }),
  },
  // "N%令自身所有技能PP值+K"（带概率变体）
  { id: "e7-pp-02",
    re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?令(?:自身|自己)(?:所有|全部)技能PP值?([+-])(${NUM})$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: (m[3] === "-" ? -1 : 1) * num(m[4]), chance: num(m[1]), target: "self" }] }),
  },
  // "(令|使)自身所有技能PP值±K"（"20%令自身所有技能PP值+1"经概率剥离后的裸体）
  { id: "e7-pp-02b",
    re: new RegExp(`^(?:令|使|让)(?:自身|自己)(?:所有|全部)技能PP值?([+-])(${NUM})$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: (m[1] === "-" ? -1 : 1) * num(m[2]), target: "self" }] }),
  },
  // "令/使对手所有技能PP值-N" / "对手所有pp-N" / "所有pp-2"
  { id: "e7-pp-03",
    re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)(?:所有|全部)?(?:技能的?)?PP值?-(${NUM})$|^(?:对手|对方|敌方)(?:所有|全部)?(?:技能的?)?PP值?-(${NUM})$|^(?:对手|对方|敌方)?所有[ppPP]{2}-(${NUM})$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", amount: -ns[ns.length - 1], target: "opponent" }] }; },
  },
  // "(N%概率)?令/使对手随机M个技能PP值归(零|0)"
  { id: "e7-pp-04",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:概率|几率))?)?(?:令|使|让)?(?:对手|对方|敌方)?随机(${NUM})个?(?:属性)?技能(?:的)?[pP]{2}值?归(?:零|0)$`),
    go: (m) => {
      const pct = m[0].match(/^(\d+)%/)?.[1];
      return { effects: [{ op: "pp_delta", zeroRandom: num(m[m.length - 1]), target: "opponent", ...(pct !== undefined ? { chance: +pct } : {}) }] };
    },
  },
  // "(令|使)对手所有技能PP值归(零|0)" / "清空自身全部pp"
  { id: "e7-pp-05",
    re: /^(?:令|使|让)(?:对手|对方|敌方)(?:所有|全部)(?:技能的?)?PP值?归(?:零|0)$|^(?:清空|清除)(?:自身|自己)(?:全部|所有)[pP]{2}(?:值)?$/,
    go: (m) => ({ effects: [{ op: "pp_delta", zero: true, target: /自身|自己/.test(m[0]) ? "self" : "opponent" }] }),
  },
  // "恢复自身最大体力X/Y和所有技能K点PP值"——复合（heal 分数 + pp_delta）
  { id: "e7-pp-06",
    re: new RegExp(`^恢复(?:自身|自己)?最大体力的?${NUM}\\s*/\\s*${NUM}(?:和|与|及)(?:所有|全部)技能(${NUM})点PP值?$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }, { op: "pp_delta", amount: num(m[3]), target: "self" }] }),
  },
  // "恢复自身全部体力与PP值"——复合（heal 1/1 + pp_delta full）
  { id: "p2-pp-15",
    re: /^(?:自身|自己)?恢复(?:自身|自己)?(?:所有|全部)体力(?:与|和|及)(?:所有|全部)技能(?:的)?(?:PP|pp)(?:值)?$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", full: true, target: "self" }] }),
  },
  { id: "e7-pp-07",
    re: /^恢复(?:自身|自己)?(?:全部|所有)体力(?:与|和|及)(?:所有|全部)?PP(?:值)?$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", full: true, target: "self" }] }),
  },
  // "所有技能恢复N点PP"（body 变体——主语后置）
  { id: "e7-pp-08",
    re: new RegExp(`^(?:所有|全部)技能(?:的)?(?:PP值?)?恢复(${NUM})点?PP值?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self" }] }),
  },
  // "不消耗PP值" → pp_free 窗；"N%不消耗PP值"→chance
  { id: "e7-pp-09",
    re: /^(\d+)%(?:的?(?:概率|几率))?[^，,]{0,6}不(?:再)?消耗(?:技能)?PP值$|^(?:使用技能)?不(?:再)?消耗(?:技能)?PP值$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}) }] }),
  },
  // "对手(释放|使用)技能PP消耗翻倍/为2倍" → pp_double 压对手
  { id: "p2-pp-11",
    re: /^(?:令|使|让)?(?:对手|对方|敌方)(?:所有|全部)?(?:所用|使用|释放|施放|消耗|用)?(?:的)?(?:技能|招式)?(?:的)?(?:PP|pp)(?:值)?(?:的)?(?:消耗)?(?:翻倍|为?(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))倍)$/,
    go: (m) => { const n = m[1] !== undefined ? num(m[1]) : 2; return { effects: [{ op: "apply_status", name: n === 2 ? "pp_double" : "pp_mul", target: "opponent", ...(n === 2 ? {} : { params: { mul: n } }) }] }; },
  },
  { id: "e7-pp-10",
    re: /^(?:令|使)?(?:对手|对方|敌方)(?:释放|使用)?技能(?:的)?PP值?(?:消耗)?翻倍$|^(?:对手|对方|敌方)(?:释放|使用)技能消耗PP(?:值)?为?2倍$|^(?:对手|对方|敌方)(?:释放|使用)技能消耗PP(?:值)?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_double", target: "opponent" }] }),
  },

  // ── 护盾/护罩 ─────────────────────────────────────────────
  // "为自身附加N点护盾和M点护罩"——双盾拆两条（护盾/护罩同 dmgShield 语义）
  { id: "e7-sh-01",
    re: new RegExp(`^(?:为|给|令|使)?(?:自身|自己)?(?:附加|获得|生成|创造|展开|张开|拥有)(${NUM})点(?:护盾|护罩)和(${NUM})点(?:护盾|护罩)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[0] } }, { op: "apply_status", name: "shield", target: "self", params: { flat: ns[ns.length - 1] } }] }; },
  },
  // "(为|给)对手附加N点护盾"——对手侧盾
  { id: "e7-sh-02",
    re: new RegExp(`^(?:为|给|令|使)(?:对手|对方|敌方)(?:附加|获得|生成|创造|展开)(${NUM})点(?:护盾|护罩)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "opponent", params: { flat: num(m[1]) } }] }),
  },
  // "(自身)获得/附加N点护盾"主语前缀变体（heal-22 只吃裸动词起首）
  { id: "e7-sh-03",
    re: new RegExp(`^(?:自身|自己)(?:获得|附加|生成|展开|拥有)(${NUM})点(?:护盾|护罩)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[0] } }] }; },
  },
  // "消除对手护盾类效果" / "消除自身护盾" → cleanse scope:shield
  { id: "e7-sh-04",
    re: /^消(?:除|去|散)(?:对手|对方|敌方)(?:的)?护盾(?:类效果|效果)?$|^消(?:除|去|散)(?:自身|自己)(?:的)?护盾(?:类效果)?$/,
    go: (m) => ({ effects: [{ op: "cleanse", scope: "shield", target: /对手|对方|敌方/.test(m[0]) ? "opponent" : "self" }] }),
  },

  // ── 承伤 ────────────────────────────────────────────────
  // "受到的攻击伤害和固定伤害和百分比伤害(额外)减少N%"——复合类型拆双窗
  { id: "e7-tk-01",
    re: /^(?:自身|自己|己方|我方)?(?:精灵)?受到(?:的)?攻击伤害和(?:固定伤害和百分比伤害|百分比伤害和固定伤害)(?:额外)?(?:减少|降低|下降|减免)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }, { op: "apply_status", name: "flat_taken_pct", target: "self", params: { pct: +m[1] } }] }),
  },
  // "受到的攻击伤害降低N%"（PASSIVES 需整句独占才命中；body 内/移动侧交这条）
  { id: "e7-tk-02",
    re: /^(?:自身|自己)?受到(?:的)?(?:攻击|技能)?伤害(?:减少|降低|下降|减免)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "受到的伤害减少N点"平铺值变体 → dmg_reduce flat
  { id: "e7-tk-03",
    re: /^(?:自身|自己)?受到(?:的)?(?:攻击|技能)?伤害(?:减少|降低|下降)(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: +m[1] } }] }),
  },
  // "己方受到的攻击伤害和固定伤害和百分比伤害额外减少N%"（己方=自身出战位近似）
  { id: "e7-tk-04",
    re: /^(?:己方|我方)(?:精灵)?受到(?:的)?(?:固定伤害和百分比伤害|百分比伤害和固定伤害)(?:额外)?(?:减少|降低|下降|减免)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "flat_taken_pct", target: "self", params: { pct: +m[1] } }] }),
  },
  // "免疫受到的攻击"（完全抵挡）→ protect
  { id: "e7-tk-05",
    re: /^(?:自身|自己)?免疫(?:受到|所受)?的?(?:所有|全部)?(?:攻击|攻击伤害|技能伤害)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "protect", target: "self" }] }),
  },

  // ── 恢复/吸取 ────────────────────────────────────────────
  // "恢复自身N%的最大体力"（%前置变体——heal-02 只吃 N% 在最大体力后）
  { id: "e7-heal-01",
    re: /^(?:恢复|回复)(?:自身|自己)(\d+)%(?:的)?最大体力(?:值)?$/,
    go: (m) => ({ effects: [{ op: "heal", numerator: +m[1], denominator: 100, target: "self" }] }),
  },
  // "附加造成伤害N%的百分比伤害"→ percent-kind damage + lastDmgFrac（dealt 基线附伤）
  { id: "e7-heal-02",
    re: /^附加(?:造成|该次|当次)?伤害(?:值)?的?(\d+)%(?:的)?百分比伤害$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", lastDmgFrac: frac(+m[1], 100) }] }),
  },
  // "恢复自身最大体力1/N"（无"的"变体）
  { id: "e7-heal-03",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己)最大体力${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },
  // "为(自己|自身)恢复等量体力"——dealt 等量回血
  { id: "e7-heal-04",
    re: /^为(?:自己|自身)恢复等量体力(?:值)?$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }),
  },

  // ── 必中/必暴/致命 ───────────────────────────────────────
  // "(自身)(所有)?(攻击|技能)必定命中" → must_hit 窗
  { id: "p2-hit-09",
    re: /^(?:自身|自己)?(?:所有|全部)?(?:攻击|攻击技能|技能)?必定命中(?:目标)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "must_hit", target: "self" }] }),
  },
  { id: "e7-hit-01",
    re: /^(?:自身|自己)?(?:所有|全部)?(?:攻击|攻击技能|技能)?必定命中$/,
    go: () => ({ effects: [{ op: "apply_status", name: "must_hit", target: "self" }] }),
  },
  // "N%(概率)?(令|使)?(自身)?(攻击|技能)必定命中" → must_hit + chance
  { id: "e7-hit-02",
    re: /^(\d+)%(?:的?(?:概率|几率))?(?:令|使)?(?:自身|自己)?(?:所有|全部)?(?:攻击|攻击技能|技能)?必定命中$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "must_hit", target: "self", chance: +m[1] }] }),
  },
  // "(所有|自身)攻击必定打出致命一击" → crit_always 窗
  { id: "p2-hit-08",
    re: /^(?:攻击)?(?:必定出现|必)(?:打出|造成)?(?:致命[一1]?击|暴击)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }),
  },
  { id: "e7-hit-03",
    re: /^(?:自身|自己|所有|全部)?(?:攻击|攻击技能|技能)?必定(?:打出|造成)?致命[一1]?击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }),
  },
  // "(令|使)自身(下回合|下次)攻击必定致命" → crit_always 1 回合窗（魂印体由触发层注入更长窗）
  { id: "e7-hit-04",
    re: /^(?:令|使)(?:自身|自己)(?:下回合|下次|下1次|下回合内)?(?:的)?(?:攻击|攻击技能)?必定(?:打出|造成)?致命[一1]?击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 1 }] }),
  },
  // "致命(一击)?伤害提升N%" → crit_dealt 窗
  { id: "e7-hit-05",
    re: /^致命[一1]?击?(?:的)?伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_dealt", target: "self", params: { pct: +m[1] } }] }),
  },
  // "对手先制效果失效" → 清除对手先制窗（prio_up/prio_count 具名 cleanse）
  { id: "e7-hit-06",
    re: /^(?:对手|对方|敌方)(?:的)?先制效果失效$/,
    go: () => ({ effects: [{ op: "cleanse", effect: ["prio_up", "prio_count"], target: "opponent" }] }),
  },
  // "令对手下回合无法主动切换精灵" → no_switch 1 回合压对手
  { id: "e7-hit-07",
    re: /^(?:令|使)(?:对手|对方|敌方)(?:下回合|下1回合|1回合内)?无法主动切换(?:精灵|宠物)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_switch", target: "opponent", turns: 1 }] }),
  },

  // ── 阶段/强化 ────────────────────────────────────────────
  // "(令|使)对手随机N项(能力等级|属性|能力值)-K"
  { id: "e7-st-01",
    re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)随机(${NUM})项(?:能力等级|属性|能力值?|能力)-(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[1]), delta: -num(m[3]), target: "opponent" }] }),
  },
  // "(令|使)自身随机N项(能力等级|属性)+K"
  { id: "e7-st-02",
    re: new RegExp(`^(?:令|使|让)?(?:自身|自己)随机(${NUM})项(?:能力等级|属性|能力值?|能力)([+-])(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[1]), delta: (m[3] === "-" ? -1 : 1) * num(m[4]), target: "self" }] }),
  },
  // "免疫异常且不会能力下降"（「且不会」并合形）。放在 e7-st-03 前面，那条连接词只收「和」。
  { id: "e7-st-03a",
    re: /^(?:自身|自己)?免疫(?:所有|全部)?异常(?:状态)?且不会(?:出现)?能力下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "免疫异常状态和能力下降(状态)"——复合免疫拆两条
  { id: "e7-st-03",
    re: /^免疫(?:所有|全部)?异常(?:状态)?和(?:免疫)?能力下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "(自身)免疫(受到的)?(所有)?异常状态" → immune_status（无"天生/所有"前缀变体）
  { id: "e7-st-04",
    re: /^(?:自身|自己|本方)?免疫(?:受到|所受)?的?(?:所有|全部)?异常状态$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }),
  },
  // "免疫能力下降(状态)" → immune_degrade
  { id: "p2-imm-02",
    re: /^(?:自身|自己)?(?:不受|不会受|不(?:会)?受到)(?:到)?(?:能力下降|弱化|属性下降)(?:状态)?(?:影响|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  { id: "p2-imm-03",
    re: /^(?:自身|自己)?免疫能力下降(?:异常)?(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  { id: "e7-st-05",
    re: /^(?:自身|自己|本方)?免疫(?:所有|全部)?能力下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "解除(自身)?所处的异常状态" / "解除双方的异常状态" → cleanse ailment
  { id: "e7-st-06",
    re: /^(?:解除|消除|清除|驱散)(?:自身|自己)?所处的?(?:所有|全部)?异常状态$|^(?:解除|消除)(?:双方|敌我双方)(?:的)?(?:所有|全部)?异常状态$/,
    go: (m) => ({ effects: /双方/.test(m[0]) ? ["self", "opponent"].map((t) => ({ op: "cleanse", scope: "ailment", target: t })) : [{ op: "cleanse", scope: "ailment", target: "self" }] }),
  },
  // "解除(自身)?所处的异常状态与能力下降状态"——异常+负级双清
  { id: "e7-st-07",
    re: /^(?:解除|消除|清除)(?:自身|自己)?所处的?异常状态(?:与|和|、)能力下降状态$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "ailment", target: "self" }, { op: "clear_stages", target: "self", sign: "down" }] }),
  },
  // "解除所处的异常状态"无自身前缀
  { id: "e7-st-08",
    re: /^解除所处的?(?:所有|全部)?异常状态$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "ailment", target: "self" }] }),
  },

  // ── 伤害提升/翻倍 ────────────────────────────────────────
  // "造成的伤害随机提升N%-M%" → dmg_boost pctMin/pctMax（运行时逐击 roll）
  { id: "e7-db-01",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|技能)?造成(?:的)?伤害随机(?:提升|提高|增加)(\d+)%\s*[~～\-—]\s*(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: num(m[1]), pctMax: num(m[2]) } }] }),
  },
  // "(N%)使自身(造成的)?伤害翻倍" → dmg_boost +100%
  { id: "e7-db-02",
    re: /^(\d+)%(?:的?(?:概率|几率))?(?:使|令)(?:自身|自己)?(?:造成)?(?:的)?伤害翻倍$|^(?:使|令)(?:自身|自己)(?:造成)?(?:的)?伤害翻倍$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { pct: 100 } }] }),
  },
  // "(攻击)?伤害(额外)?提升N%" → dmg_boost 窗
  { id: "e7-db-03",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|技能)?(?:造成的)?(?:攻击)?伤害(?:额外)?(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "闪避几率(额外)?提升N%" → dodge 窗
  { id: "e7-db-04",
    re: /^(?:自身|自己)?闪避(?:几率|概率)(?:额外)?(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: +m[1] } }] }),
  },

  // ── 清除/回合类 ──────────────────────────────────────────
  // "消除对手回合类效果" → cleanse timed foe
  { id: "e7-cl-01",
    re: /^消(?:除|去|散)(?:对手|对方|敌方)(?:的)?回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }] }),
  },
  // "消除自身回合类效果"
  { id: "e7-cl-02",
    re: /^(?:自身|自己)?消(?:除|去|散)(?:自身|自己)(?:的)?回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "self" }] }),
  },
  // "清除对手能力(提升|强化)(状态)?" 清除动词变体（clear.mjs 主吃"消除"）
  { id: "e7-cl-03",
    re: /^(?:清除|驱散)(?:对手|对方|敌方)(?:的)?(?:所有|全部)?能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }),
  },
  // "清除双方所有能力提升状态" / "清除敌我双方能力提升"
  { id: "e7-cl-04",
    re: /^(?:清除|消除|驱散)(?:双方|敌我双方)(?:的)?(?:所有|全部)?能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: ["self", "opponent"].map((t) => ({ op: "clear_stages", target: t, sign: "up" })) }),
  },

  // ── 反应/反击 ────────────────────────────────────────────
  // "反馈/反弹(给对手)?受到攻击伤害的N%" → reflect_dmg 分数窗（counter.mul 只收整数倍率）
  { id: "p2-rf-03",
    re: /^(?:反弹|反射|反馈)(?:给)?(?:对手|对方|敌方)(?:造成的|的)?伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }),
  },
  { id: "e7-rf-01",
    re: /^(?:反馈|反射|反弹)(?:给(?:对手|对方|敌方))?(?:受到|所受)?的?(?:攻击)?伤害(?:的)?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }),
  },
  // "反馈受到攻击伤害的N/N" 分数变体 / "反弹对手造成的伤害的N/N"
  { id: "e7-rf-02",
    re: /^(?:反馈|反射|反弹)(?:给(?:对手|对方|敌方))?(?:受到|所受)?的?(?:攻击)?伤害(?:的)?(\d+)\s*\/\s*(\d+)$|^反弹(?:对手|对方|敌方)造成(?:的)?伤害(?:的)?(\d+)\s*\/\s*(\d+)$/,
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[0], d: ns[1] } }] }; },
  },
  // "受到攻击(有)?N%(概率)?令对手AIL"——无"有"变体（heal-73 需"有"字）；受击语义走 reactWrap
  { id: "p2-hit-10",
    re: /^受攻([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%(?:的)?(?:概率|几率)?(?:令|使)(?:对手|对方|敌方)(烧伤|冻伤|中毒|麻痹|害怕|睡眠|失明|失神|束缚|混乱|寄生|诅咒|疲惫|流血|沉默|冰封|易燃|焚烬|石化|瘫痪|感染|狂暴|衰弱|臣服|冷冻)(?:状态)?$/,
    go: (m) => { const il = AILMENTS[m[2]]; if (il === undefined) return null; return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1 }, payload: [{ op: "apply_status", name: il, target: "opponent", chance: num(m[1]) }] }] }; },
  },
  { id: "e7-rf-03",
    re: new RegExp(`^受到攻击有?(${NUM})%(?:的?(?:概率|几率))?(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const r = reactWrap(1, {}, `令对手${m[3]}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = num(m[1]); return r; },
  },

  // ── 先制 ────────────────────────────────────────────────
  // 裸"先制+N"（触发/回合前缀剥出后的 body——自身侧）；"对手先制-N"→对手侧
  { id: "p2-pr-03",
    re: /^攻击必定先出$/,
    go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 9 } }] }),
  },
  { id: "e7-pr-01",
    re: new RegExp(`^先制([+-])(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }),
  },
  { id: "e7-pr-02",
    re: new RegExp(`^(?:对手|对方|敌方)先制([+-])(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "opponent", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }),
  },

  // ── 技能无效 ─────────────────────────────────────────────
  // "(对手下回合)使用属性技能无效"——foe 回合前缀剥出后的 body → status_lock cat（与 heal-20/timed-bare-32 既定通道一致）
  { id: "e7-nl-01",
    re: /^(?:使用)?属性技能无效$/,
    go: () => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: 1 } }] }),
  },
  { id: "e7-nl-02",
    re: /^(?:使用)?攻击技能无效$/,
    go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 4 } }] }),
  },
  // "使对手下回合属性技能有N%几率失效"——几率失效变体（move_null + chance；含"下回合"时序内嵌整句匹配）
  { id: "e7-nl-03",
    re: /^(?:使|令)(?:对手|对方|敌方)属性技能有?(\d+)%(?:的)?(?:几率|概率)?失效$|^(?:使|令)(?:对手|对方|敌方)下?(\d+)?回合属性技能有?(\d+)%(?:的)?(?:几率|概率)?失效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, chance: +(m[1] ?? m[3]), ...(m[2] !== undefined ? { turns: +m[2] } : m[0].includes("下") ? { turns: 1 } : {}) }] }),
  },
  // "(令|使)对手下N回合必定(打出)?致命一击"——对手侧暴击窗（foe-strip 不进 TURNS_PRE，整句显式匹配防误挂自身）
  { id: "e7-nl-04",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)下(${NUM})?回合必定(?:打出)?致命[一1]?击$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "opponent", turns: m[1] !== undefined ? num(m[1]) : 1 }] }),
  },

  // ── 其他 body ───────────────────────────────────────────
  // "造成伤害提升N%"/"造成攻击伤害提升N%"（无"的"动词前置变体——e7-db-03 只吃"造成的"）
  { id: "e7-mx-01",
    re: /^造成(?:的)?(?:攻击)?伤害(?:额外)?(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "所有技能有N%附加M点固伤"——句中几率嵌套（bcm 只吃句首 N%）
  { id: "e7-mx-02",
    re: /^(?:所有|全部)技能有?(\d+)%(?:的)?(?:几率|概率)?附加(\d+)点(?:固定伤害|固伤)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", chance: +m[1], params: { flat: +m[2] } }] }),
  },
  // "(必定)?打出致命一击概率提高N%" → crit_up（"所有攻击打出致命一击概率提高50%"）
  { id: "e7-mx-03",
    re: new RegExp(`^(?:所有攻击|攻击|技能)?(?:必定)?打出致命[一1]?击(?:的)?(?:概率|几率)?(?:提高|提升|增加)(${NUM})%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: 100 } }] }),
  },
  // "(自身)无法主动切换精灵" —— 自身侧锁换（no_switch）
  { id: "e7-mx-04",
    re: /^(?:自身|自己)?无法主动切换(?:精灵|宠物)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_switch", target: "self" }] }),
  },
];
