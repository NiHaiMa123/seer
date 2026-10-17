// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e42：残留长尾批——flat 减伤窗、类别承伤分数、翻转/强化翻倍变体、 ailments 列表解除、
// 几率句家族、回合类净化锁、下只出场精灵百分比削血、护盾差值、先制类别窗。
import { NUM, num, frac, STATS, STAT_RE, AILMENTS, AIL_RE } from "./lex.mjs";

const STAT = (w) => STATS[w] ?? w;
const AIL = (w) => AILMENTS[w] ?? w;
const stageFx = (stat, delta, target, extra = {}) => ({ op: "apply_stat_stage", stat, delta, target, ...extra });

export const rules = [
  // ── 下只出场精灵最大体力分数削血（"减少对方下回合精灵最大体力的1/4"→nextFoe 百分比） ──
  { id: "e42-01",
    re: new RegExp(`^减少(?:对方|对手|敌方)下回合精灵最大体力的(${NUM})\\s*/\\s*(${NUM})$|^减少(?:对方|对手|敌方)下(?:一?次|只|回合)(?:出场|上场|出战)?的?精灵(?:最大)?体力的(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => { const n = num(m[1] ?? m[5]); const d = num(m[3] ?? m[7]); return { effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(n, d), target: "nextFoe" }] }; } },
  // ── 能力提升翻倍裸句（"自身能力提升状态翻倍"→multiplySelf op；带宿主时 attach-damage-08 已收） ──
  { id: "e42-02",
    re: /^(?:自身|自己)的?能力(?:提升|强化)(?:的)?状态翻倍$/,
    go: () => ({ attachAll: { stageDouble: true } }) },
  // ── 等同双方最大体力差值的护盾（params.flatMaxHpDiff 既有键） ──
  { id: "e42-03",
    re: /^(?:为|给)(?:自身|自己)附加等同于双方最大体力差(?:值)?的护盾$|^获得(?:点数)?等同于双方最大体力差(?:值)?的护盾$/,
    go: () => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flatMaxHpDiff: 1 } }] }) },
  // ── 能力提升效果变能力下降（"对手的能力提升效果变能力下降"→invert_stages foe） ──
  { id: "e42-04",
    re: /^(?:对手|对方|敌方)的?能力(?:提升|强化|增强)(?:的)?效果?变(?:成|为)?能力(?:下降|弱化)(?:的)?(?:效果|状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // ── ailments 列表解除（"解除自身烧伤、冻伤、中毒状态"→cleanse scope ailment + effect 名单） ──
  { id: "e42-05",
    re: new RegExp(`^解除(?:自身|自己)?((?:${AIL_RE})(?:[、，,和及与](?:${AIL_RE}))+)(?:的)?状态$|^解除(?:自身|自己)(${AIL_RE})状态$`),
    go: (m) => { const list = (m[1] ?? m[2]).match(new RegExp(AIL_RE, "g")).map(AIL); return { effects: [{ op: "cleanse", scope: "ailment", target: "self", effect: list }] }; } },
  // ── 每回合承伤定额减免（"每回合受到伤害减100"/"每回合所受到伤害少100"→dmg_reduce flat） ──
  { id: "e42-06",
    re: new RegExp(`^每回合(?:自身|自己)?所?受到的?(?:攻击)?伤害(?:减|少|降低|减少)(${NUM})(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // ── 自身受到特攻/物攻伤害减半（"自身受到特攻攻击伤害减半"→spec_half/phys_half 自身受到变体） ──
  { id: "e42-07",
    re: /^自身受到(?:特攻|特殊)(?:攻击)?的?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  { id: "e42-08",
    re: /^自身受到(?:物攻|物理)(?:攻击)?的?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "phys_half", target: "self" }] }) },
  // ── "对方攻击伤害是正常的1/2" → atk_taken_frac cat4 1/2 ──
  { id: "p2-weak-02",
    re: /^(?:自身|自己)?受(?:到)?物理(?:属性)?伤害(?:减少|降低|下降|减免)([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 2, n: 100 - num(m[1]), d: 100 } }] }),
  },
  { id: "e42-09",
    re: new RegExp(`^(?:对方|对手|敌方)(?:的)?攻击?(?:造成的)?伤害是(?:正常的|原来的|原先的)(${NUM})\\s*/\\s*(${NUM})$|^(?:对方|对手|敌方)(?:的)?攻击?(?:造成的)?伤害(?:减半|减半)$`),
    go: (m) => { const n = num(m[1] ?? "1"); const d = num(m[3] ?? "2"); return { effects: [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n, d } }] }; } },
  // ── "攻击要害几率增加1/16" → crit_up{n,d} ──
  { id: "p2-critup-01",
    re: new RegExp(`^(?:命中要害增加|增加(?:要害命中率|暴击率|致命))(${NUM})\s*/\s*(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: num(m[3]) } }] }),
  },
  { id: "e42-10",
    re: new RegExp(`^(?:攻击)?要害(?:的)?(?:几率|概率)(?:增加|提升|提高)(${NUM})\\s*/\\s*(${NUM})$|^(?:致命一击|暴击)(?:的)?(?:几率|概率)(?:增加|提升|提高)(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1] ?? m[5]), d: num(m[3] ?? m[7]) } }] }) },
  // ── "闪避率↑55%" / "闪避率提升55%" → dodge{pct} ──
  { id: "e42-11",
    re: new RegExp(`^闪避率(?:提升|提高|增加|上升)?[↑＋+]?\\s*(\\d+|${NUM.slice(1, -1)})%?$`),
    go: (m) => { const g = m[0].match(/([0-9]+|一|二|两|三|四|五|六|七|八|九|十)/); return { effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(g[1]) } }] }; } },
  // ── "对方所有能力增强消失" / "能力提升效果消失" → clear_stages foe up（attach-damage-42 的"消失"裸形） ──
  { id: "e42-12",
    re: /^(?:对方|对手|敌方)(?:的|所有)?能力(?:增强|提升|强化)(?:的)?(?:效果)?消失$/,
    go: () => ({ effects: [{ op: "clear_stages", sign: "up", target: "opponent" }] }) },
  // ── "清除/消除对手回合类效果" → cleanse timed foe ──
  { id: "e42-13",
    re: /^(?:清除|消除|驱散)(?:对手|对方|敌方)(?:的|所有)?回合类(?:的)?效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }] }) },
  // ── "N%几率烧伤对手"（几率中嵌动词变体） → chance + ailment ──
  { id: "e42-14",
    re: new RegExp(`^(${NUM})%(?:的)?(?:几率|概率|机率)(?:使|令|让)?(${AIL_RE})(?:对手|对方|敌方)$|^(${NUM})%(?:的)?(?:几率|概率|机率)(?:使|令|让)?对?(?:对手|对方|敌方)(${AIL_RE})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AIL(m[3] ?? m[6]), target: "opponent", chance: num(m[1] ?? m[4]) }] }) },
  // ── "对方减血N/M"（bcm 已剥 N%几率→dynChance 自动注入） → percent damage ──
  { id: "e42-15",
    re: new RegExp(`^(对手|对方|敌方|自己|自身)减血(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => { const self = /自己|自身/.test(m[1]); return { effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(num(m[2]), num(m[4])), target: self ? "self" : "opponent" }] }; } },
  // ── "N%几率对手害怕1到3回合" → chance + ailment turnsRange ──
  { id: "e42-16",
    re: new RegExp(`^(?:对手|对方|敌方)(${AIL_RE})(${NUM})到(${NUM})回合$|^(?:对手|对方|敌方)(${AIL_RE})(${NUM})[-~～](${NUM})回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AIL(m[1] ?? m[6]), target: "opponent", turnsRange: { min: num(m[2] ?? m[7]), max: num(m[4] ?? m[9]) } }] }) },
  // ── "N%几率强化翻倍" → attachAll stageDoubleChance（正级 delta ×2 概率） ──
  { id: "e42-17",
    re: new RegExp(`^(${NUM})%(?:的)?(?:几率|概率|机率)(?:使|令)?(?:强化|提升|增强)(?:的)?(?:效果|状态)?翻倍$`),
    go: (m) => ({ attachAll: { stageChanceMul: num(m[1]) } }) },
  // ── "体力低于1/2强化翻倍"（缺主语变体——attach-all-03 的自身体力低于补主语缺省） ──
  { id: "e42-18",
    re: new RegExp(`^体力(?:值)?低于(${NUM})\\s*/\\s*(${NUM})(?:时|的时候)?(?:强化|提升|增强)(?:的)?(?:效果|状态)?翻倍$|^体力(?:值)?低于(${NUM})\\s*/\\s*(${NUM})(?:时|的时候)?(?:强化|增强)(?:的)?翻倍$`),
    go: (m) => ({ attachAll: { stageIf: { selfHpBelow: frac(num(m[1] ?? m[5]), num(m[3] ?? m[7])) } } }) },
  // ── "自身在A、B、C状态下造成伤害加倍" → scaleIf or-selfHas 多异常 ──
  { id: "e42-19",
    re: new RegExp(`^(?:自身|自己)在((?:${AIL_RE})(?:[、，,和及与](?:${AIL_RE}))+)状态下(?:造成|给予)的?(?:伤害|攻击)?(?:加倍|翻倍)$`),
    go: (m) => { const list = m[1].match(new RegExp(AIL_RE, "g")).map(AIL); return { attachDamage: { scaleIf: { when: list.length === 1 ? { selfHas: list[0] } : { or: list.map((a) => ({ selfHas: a })) }, numerator: 2, denominator: 1 } } }; } },
  // ── "自己所有直接攻击先制+1" → prio_up cat4 窗 ──
  { id: "e42-20",
    re: new RegExp(`^(?:自身|自己)所有直接攻击(?:技能)?先制[+\\+＋](${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: num(m[1]), cat: 4 } }] }) },
  // ── "对方M回合内每回合受到K点伤害"（bcm 剥 N%→dynChance 注入） → foe_dot flat 窗 ──
  { id: "e42-21",
    re: new RegExp(`^(?:对方|对手|敌方)(${NUM})回合内?每回合受到(${NUM})点(?:固定)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", turns: num(m[1]), params: { flat: num(m[3]) } }] }) },
  // ── "翻转成功"/"消强成功" 孤儿谓词别名（若消强成功则X/翻转成功则X → prevApplied） ──
  { id: "e42-22",
    re: /^若?(?:消强|消除强化|消除|清除|解除|吸取|反转|翻转)(?:成功|失败)$/,
    go: (m) => ({ orphanCond: /失败$/.test(m[0]) ? { not: { prevApplied: true } } : { prevApplied: true } }) },
  // ── "自己不会受到对手攻击性技能伤害" → dmg_immune kindMask=4（标准攻击伤害） ──
  { id: "e42-23",
    re: /^(?:自身|自己)(?:将)?不(?:会|再)受到(?:对手|对方|敌方)?攻击(?:性)?技能(?:的)?伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { kindMask: 4 } }] }) },
  // ── "N回内自身不受能力下降技能影响" → immune_degrade 回合窗（"回内"变体=TURNS_PRE 补） ──
  { id: "e42-24",
    re: /^(?:自身|自己)(?:将)?不(?:会|再)?受(?:到)?(?:对手|对方|敌方)?能力(?:下降|弱化)(?:技能)?(?:的)?(?:影响|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // ── "翻转成功恢复所有体力"（翻转=反转别名；cond 已挂，此句只管 full heal） ──
  { id: "e42-25",
    re: /^(?:恢复|回复)(?:自身|自己)?所有(?:体力|HP)$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // ── "当回合结束时恢复自身最大体力N/M" → hot{n,d} turns1 ──
  { id: "e42-26",
    re: new RegExp(`^(?:当|本)回合结束时恢复(?:自身|自己)最大体力的(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", turns: 1, params: { n: num(m[1]), d: num(m[3]) } }] }) },
  // ── "使自身体力降为1" → 自伤 leaveHp=1 ──
  { id: "e42-27",
    re: /^(?:使|令)(?:自身|自己)(?:的)?体力降为(?:1|一)(?:点)?$/,
    go: () => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: { numerator: 1, denominator: 1 }, percentBase: "selfCur", target: "self", leaveHp: 1 }] }) },
  // ── "自身的回合类效果无法被消除" → timed_lock（timed 域净化锁，引擎新增 flag） ──
  { id: "e42-28",
    re: /^(?:自身|自己)(?:的|身上)?回合类(?:的)?效果(?:无法|不能)被(?:消除|清除|驱散|解除)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "timed_lock", target: "self" }] }) },
  // ── "使自身恢复等量体力"（使令前缀变体——bare 形已由 drain 规则覆盖） ──
  { id: "e42-29",
    re: /^(?:使|令)(?:自身|自己)(?:恢复|回复)等量(?:的)?体力$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // ── "反弹受到伤害的N/M给对手"（分数变体——attach-damage-109 收"所受伤害"语序） ──
  { id: "e42-30",
    re: new RegExp(`^反弹(?:受到|受到?的|所受)(?:的)?伤害(?:的)?(${NUM})\\s*/\\s*(${NUM})(?:给|对)(?:对手|对方|敌方)$|^反弹受到伤害的(${NUM})%(?:给|对)(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: m[1] !== undefined ? { n: num(m[1]), d: num(m[3]) } : { n: num(m[4]), d: 100 } }] }) },
  // ── "加80点固定伤害"（加=附加变体） → flatBonus ──
  { id: "e42-31",
    re: new RegExp(`^加(${NUM})点(?:固定)?伤害$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // ── "无视对方速度先手攻击" → ignoreFoeSpeed 旗标 ──
  { id: "e42-32",
    re: /^无视(?:对手|对方|敌方)(?:的)?速度(?:先手|优先)?(?:攻击|出手)?$/,
    go: () => ({ flags: { ignoreFoeSpeed: true } }) },
  // ── "对方造成伤害的N/M恢复自身体力" → dmg_to_heal{n,d} 承伤吸血窗 ──
  { id: "e42-33",
    re: new RegExp(`^(?:(?:对方|对手|敌方)造成|受到)(?:的)?伤害(?:的)?(${NUM})\\s*/\\s*(${NUM})(?:会|将|并)?(?:恢复|回复|治疗)(?:自身|自己)(?:的)?(?:体力|HP)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: num(m[1]), d: num(m[3]) } }] }) },
  // ── "恢复造成伤害的N/M" / "造成伤害的N/M" 裸分数尾（吸血残句） → drain{n,d} ──
  { id: "e42-34",
    re: new RegExp(`^(?:对|给)?(?:对手|对方|敌方)?造成(?:的)?伤害(?:的)?(${NUM})\\s*/\\s*(${NUM})(?:会|将)?(?:恢复|回复)(?:自身|自己)?(?:的)?体力$|^(?:对|给)?(?:对手|对方|敌方)?造成伤害的(${NUM})\\s*/\\s*(${NUM})$|^(?:恢复|回复)(?:自身|自己)?造成(?:的)?伤害(?:的)?(${NUM})\\s*/\\s*(${NUM})(?:的)?(?:体力)?$`),
    go: (m) => ({ attachDamage: { drain: frac(num(m[1] ?? m[5] ?? m[9]), num(m[3] ?? m[7] ?? m[11])) } }) },
  // ── "速度20%+1"（几率中嵌 stat 与 delta 之间） → stage + chance ──
  { id: "e42-35",
    re: new RegExp(`^(${STAT_RE})(${NUM})%([+\\-＋－])(${NUM})$|^(${STAT_RE})(${NUM})%([+\\-＋－])(${NUM})(?:个)?等级$`),
    go: (m) => { const b = m[1] === undefined; const st = b ? m[5] : m[1]; const ch = num(b ? m[6] : m[2]); const sg = b ? m[8] : m[4]; const dl = num(b ? m[9] : m[5]); return { effects: [stageFx(STAT(st), (sg === "-" || sg === "－" ? -1 : 1) * dl, "self", { chance: ch })] }; } },
];
