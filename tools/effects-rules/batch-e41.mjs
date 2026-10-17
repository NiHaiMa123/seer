// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e41：残留长尾批——出场精灵弱化、出伤上限窗、威力门控反应、随机连击、敌我双方异常、
// 裸谓词（受击无伤/免疫成功/转移计数）暂不落地的除外。
import { NUM, num, frac, STATS, STAT_RE, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap } from "../effects-parse.mjs";

const STAT = (w) => STATS[w] ?? w;
const AIL = (w) => AILMENTS[w] ?? w;
const stageFx = (stat, delta, target, extra = {}) => ({ op: "apply_stat_stage", stat, delta, target, ...extra });

export const rules = [
  // ── 出场精灵弱化（"若本回合击败对手，下回合对方出场精灵速度-1"→nextFoe 登场弱化） ──
  { id: "e41-01",
    re: new RegExp(`^(?:(?:对方|对手|敌方)的?)?(?:下只|新上场|出场|登场|出战)(?:的)?精灵(${STAT_RE})([+\\-＋－]?)${NUM}(?:个)?(?:等级)?$|^(?:对方|对手|敌方)出场精灵(${STAT_RE})([+\\-＋－]?)${NUM}$`),
    go: (m) => { const st = m[1] ?? m[5]; const d = ((m[2] ?? m[6]) === "-" || (m[2] ?? m[6]) === "－" ? -1 : 1) * num(m[3] ?? m[7]); return { effects: [stageFx(STAT(st), d, "nextFoe")] }; } },
  // ── 对手出伤上限窗（"对手3回合内造成的伤害不超过200"→dmg_out_cap holder=对手） ──
  { id: "e41-02",
    re: new RegExp(`^(?:对手|对方|敌方)(${NUM})回合内造成的伤害不超过(${NUM})(?:点)?$|^(?:令|使)(?:对手|对方|敌方)(${NUM})回合内(?:攻击)?伤害不超过(${NUM})(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_cap", target: "opponent", turns: num(m[1] ?? m[5]), params: { cap: num(m[3] ?? m[7]) } }] }) },
  // ── 威力门控反应（"若下次对手使用的攻击技能威力大于120，则免疫此次攻击"→react trigger3 + powerMin） ──
  { id: "e41-03",
    re: new RegExp(`^若下(?:次|一?次)(?:对手|对方|敌方)使用的?(攻击|属性)?技能威力大于(${NUM})(?![0-9])[,，]?(?:则|时)?(.+)$|^若(?:对手|对方|敌方)下(?:次|一?次)使用的?(攻击|属性)?技能威力大于(${NUM})(?![0-9])[,，]?(?:则|时)?(.+)$`),
    go: (m) => { const pw = num(m[2] ?? m[6]); const rest = m[4] ?? m[8]; return reactWrap(3, { powerMin: pw + 1 }, rest); } },
  // ── 随机连击区间（"随机做10-13次攻击"→hits{min,max}） ──
  { id: "e41-04",
    re: new RegExp(`^随机做(${NUM})[-~～](${NUM})次攻击$|^随机进行(${NUM})[-~～](${NUM})次攻击$|^随机攻击(${NUM})[-~～](${NUM})次$`),
    go: (m) => ({ attachDamage: { hits: { min: num(m[1] ?? m[5] ?? m[9]), max: num(m[3] ?? m[7] ?? m[11]) } } }) },
  // ── 敌我双方同时异常（"使敌我双方同时冻伤3回合"→双条 apply_status） ──
  { id: "e41-05",
    re: new RegExp(`^(?:使|令)(?:敌我双方|双方|敌我)(?:精灵)?同时(${AIL_RE})(${NUM})回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AIL(m[1]), target: "self", turns: num(m[2]) }, { op: "apply_status", name: AIL(m[1]), target: "opponent", turns: num(m[2]) }] }) },
  // "恢复自身最大体力的1/3"。放在 e41-06 前面，那条句尾还要一个「体力」。
  { id: "e41-06a",
    re: new RegExp(`^恢复(?:自身|自己)最大体力的${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  // ── 最大体力分数回复变体（"恢复自身最大体力的1/2体力"→heal frac） ──
  { id: "e41-06",
    re: new RegExp(`^恢复(?:自身|自己)最大体力的(${NUM})\\s*/\\s*(${NUM})(?:的)?体力$|^回复(?:自身|自己)最大体力(?:的)?(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => { const n = num(m[1] ?? m[5]); const d = num(m[3] ?? m[7]); return { effects: [{ op: "heal", numerator: n, denominator: d, target: "self" }] }; } },
  // ── 每回合分数回复（"每回合回复自身1/3的最大体力"→hot{n,d}） ──
  { id: "e41-07",
    re: new RegExp(`^每回合(?:回复|恢复|治疗)(?:自身|自己)?(${NUM})\\s*/\\s*(${NUM})的?最大体力$|^每回合(?:回复|恢复)(?:自身|自己)(${NUM})\\s*/\\s*(${NUM})体力值?$`),
    go: (m) => { const n = num(m[1] ?? m[5]); const d = num(m[3] ?? m[7]); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n, d } }] }; } },
  // ── 每回合分数吸取（"每回合吸收对手1/5HP"→drain_dot{n,d}） ──
  { id: "e41-08",
    re: new RegExp(`^每回合(?:吸取|吸收|抽取)(?:对手|对方|敌方)(${NUM})\\s*/\\s*(${NUM})(?:的)?(?:HP|体力|最大体力|生命值?)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: num(m[1]), d: num(m[3]) } }] }) },
  // ── 裸异常免疫（"2回合不受异常状态"→immune_status；无回合数=持续窗） ──
  { id: "e41-09",
    re: /^(?:(?:自身|自己)(?:将)?)?不(?:会|再)?受(?:到)?(?:任何|所有)?(?:异常|异常状态|控制类异常)(?:的?影响)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // ── 无法行动（"对手无法行动"→control stun） ──
  { id: "e41-10",
    re: new RegExp(`^(?:(?:使|令|让)(?:对手|对方|敌方)(?:精灵)?|(?:对手|对方|敌方))无法行动(?:(${NUM})回合)?$`),
    go: (m) => ({ effects: [{ op: "control", name: "stun", target: "opponent", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }) },
  // ── 自损+对敌固伤对（"损失自身200体力，给对手造成300伤害"） ──
  { id: "e41-11",
    re: new RegExp(`^损失(?:自身|自己)(${NUM})(?:点)?体力$|^(?:消耗|扣除|损失)(?:自身|自己)(${NUM})(?:点)?(?:HP|体力)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[3]), target: "self" }] }) },
  { id: "e41-12",
    re: new RegExp(`^(?:给|对)(?:对手|对方|敌方)造成(${NUM})[-~～](${NUM})(?:点)?伤害$|^(?:给|对)(?:对手|对方|敌方)造成(${NUM})(?:点)?伤害$`),
    go: (m) => m[1] !== undefined ? { effects: [{ op: "damage", kind: "fixed", power: num(m[1]), flatRange: { min: num(m[1]), max: num(m[3]) }, target: "opponent" }] } : { effects: [{ op: "damage", kind: "fixed", power: num(m[5]), target: "opponent" }] } },
  // ── 能力下降反馈（"将能力下降反馈给对手"→transfer_stages push） ──
  { id: "e41-13",
    re: /^(?:将|把)(?:自身|自己)?的?能力(?:下降|降低)(?:状态)?(?:反馈|反弹|转移|转移反馈)给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // ── 能力下降解除错字容忍（"解除自身能力下下降/下降状"→clear_stages down） ──
  { id: "e41-14",
    re: /^解除(?:自身|自己)能力下+降(?:状态|状|态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", sign: "down", target: "self" }] }) },
  // ── 裸百分号弱化（"100改变对方命中等级-2"=100%） ──
  { id: "e41-15",
    re: new RegExp(`^(${NUM})(?:%|％)?改变(?:对方|对手|敌方)(${STAT_RE})等级([+\\-＋－]?)${NUM}$`),
    go: (m) => { const ch = num(m[1]); const d = ((m[4] === "-" || m[4] === "－") ? -1 : 1) * num(m[5]); return { effects: [stageFx(STAT(m[3]), d, "opponent", { chance: ch })] }; } },
  // ── 体力低于对手则强化翻倍（part 级 cond 已由 condPrefix 下沉 effCond——此处补"低于"裸谓词挂钩 stageDouble） ──
  { id: "e41-16",
    re: /^(?:强化|提升|强化提升|增强)(?:的)?效果翻倍$/,
    go: () => ({ attachAll: { stageDouble: true } }) },
  // ── 概率免疫攻击伤害窗（"每回合有60%的几率免疫当回合受到的攻击伤害"→dmg_immune{chance}） ──
  { id: "e41-17",
    re: new RegExp(`^(?:每回合|当回合|本回合)?(?:都|还|亦|也)?(?:会)?(?:有)?(${NUM})%(?:的)?(?:概率|几率)?免疫(?:当回合|本回合)?(?:受到的|受到的)?(?:攻击|攻击技能)(?:造成|造成)?的?(?:攻击)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { chance: num(m[1]) } }] }) },
  // "给敌方伤害的一半回复为己方体力"。放在 e41-19 前面，那条要「给予」和「会恢复」。
  { id: "e41-19a",
    re: /^给(?:对方|对手|敌方)伤害的一半(?:回复|恢复)为(?:己方|自身|自己)体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } }] }) },
  // ── 伤害对半吸血（"给予对方伤害的一半会恢复自身体力"→drain_atk 1/2） ──
  { id: "e41-19",
    re: /^给予(?:对方|对手|敌方)(?:的)?伤害的一半会?(?:恢复|回复|治疗)(?:自身|自己)(?:体力|HP|生命值)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } }] }) },
  // ── 连用几率步进+上限（"连续攻击每次提高10%几率最高提高30%"→chancePerUse+cap） ──
  { id: "e41-20",
    re: new RegExp(`^连续(?:攻击|使用)(?:每次)?(?:提高|提升|增加)(${NUM})%(?:的)?(?:概率|几率)(?:最高|最多)(?:提高|提升|增加|为|至|到)?(${NUM})%$`),
    go: (m) => ({ attachAll: { chancePerUse: num(m[1]), chancePerUseCap: num(m[3]) } }) },
  // ── 恢复效果翻倍+先制合句（"恢复效果翻倍下2回合自身所有技能先制+1"——跨子句粘连：heal_boost 本体 + prio_up 窗） ──
  { id: "e41-21",
    re: new RegExp(`^恢复(?:效果|效果)?翻倍下(${NUM})回合(?:自身|自己)?(?:所有)?技能先制[+\\+]${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_boost", target: "self", params: { pct: 100 } }, { op: "apply_status", name: "prio_up", target: "self", turns: num(m[1]), params: { add: num(m[3]) } }] }) },
  // ── "有一方处于X则威力翻倍"（"使用时若有一方处于烧伤状态，则必定威力翻倍"——condPrefix 已把 若…则 下沉，此处收"必定威力翻倍"体） ──
  { id: "e41-22",
    re: /^则?(?:必定|必然)(?:攻击)?威力翻倍$/,
    go: () => ({ attachDamage: { powerMul: { numerator: 2, denominator: 1 } } }) },
  // ── "变为N/M" 分数换档孤儿尾（"吸取1/4，自身体力低于对手时变为1/3"→fracIfTail 回挂分数宿主） ──
  { id: "e41-23",
    re: new RegExp(`^(?:则|时|，|,)?变(?:为|成)(${NUM})\\s*/\\s*(${NUM})$`),
    go: (m) => ({ attachAll: { fracIfTail: { numerator: num(m[1]), denominator: num(m[3]) } } }) },
  // ── "消耗自身所有体力给对手造成N(-M)点伤害"（自损当前体力+敌 flatRange——"消耗自身所有体力"按自当前体力全额） ──
  { id: "e41-24",
    re: new RegExp(`^消耗(?:自身|自己)(?:所有|全部)体力(?:给|对)(?:对手|对方|敌方)造成(${NUM})(?:[-~～](${NUM}))?(?:点)?伤害$`),
    go: (m) => { const lo = num(m[1]); const hi = m[3] !== undefined ? num(m[3]) : undefined; return { effects: [{ op: "damage", kind: "percent", power: 1, frac: { numerator: 1, denominator: 1 }, percentBase: "selfCur", target: "self" }, hi !== undefined ? { op: "damage", kind: "fixed", power: lo, flatRange: { min: lo, max: hi }, target: "opponent" } : { op: "damage", kind: "fixed", power: lo, target: "opponent" }] }; } },
  // ── "伤害大于对手体力则对手必定留1点血"（致命溢出→留血地板） ──
  { id: "e41-25",
    re: /^若(?:造成|造成?的)?伤害大于(?:对手|对方|敌方)(?:的)?体力(?:值)?，?则(?:对手|对方|敌方)必定留(?:下|1|一)(?:点)?(?:体力|血)$|^(?:则)?(?:对手|对方|敌方)必定留(?:下)?(?:1|一)点?(?:体力|血)(?:值)?$/,
    go: () => ({ attachDamage: { leaveHp: 1 } }) },
  // ── "将伤害转变为吸取对手体力"（"恢复效果转变为吸取对手体力"已由 deferred-30 覆盖伤害侧——此处收 drain 等量谓词尾） ──
];
