// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e31：no-trigger-prefix 残余词形——部分伤转/暴击免疫反弹/类别免疫/防御穿透变体/按级固伤。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 部分伤转回复 ─────────────────────────────────────────
  // "将N%受到的伤害转化为自身体力" / "每次受到攻击的N%转化为自身HP" → dmg_to_heal pct 窗（伤害照常、按 pct 回血）
  { id: "e31-dh-01",
    re: /^将(\d+)%(?:的)?受到?的?(?:攻击)?伤害转化为(?:自身|自己)体力$|^将受到的?伤害的?(\d+)%转化为(?:自身|自己)体力$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }),
  },
  { id: "e31-dh-02",
    re: /^(?:每次)?受到?(?:的)?(?:攻击|攻击伤害|伤害)的?(\d+)%(?:的)?转化为(?:自身|自己)(?:的)?(?:体力|HP|生命)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: num(m[1]) } }] }),
  },

  // ── 暴击免疫/反弹 ────────────────────────────────────────
  // "免疫并反弹(对手造成的)?致命一击(伤害)?" → crit_immune + crit_reflect
  { id: "e31-cr-01",
    re: /^免疫并反弹(?:对手|对方|敌方)?(?:造成的)?致命[一1]?击(?:的?伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }, { op: "apply_status", name: "crit_reflect", target: "self" }] }),
  },
  // "反弹(受到的)?致命一击(伤害)?" 裸形 → crit_reflect
  { id: "e31-cr-02",
    re: /^反弹(?:受到(?:的)?|对手(?:造成)?的?|对方(?:造成)?的?)?致命[一1]?击(?:的?伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_reflect", target: "self" }] }),
  },

  // ── 类别伤害免疫 ─────────────────────────────────────────
  // "免疫一切攻击技能" / "免疫所有攻击(技能)?" → dmg_immune kindMask=4（standard 攻击伤害）
  { id: "e31-im-01",
    re: /^(?:自身|自己)?免疫(?:一切|所有|任何)(?:对手的?)?攻击(?:技能|类技能)?(?:的?伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { kindMask: 4 } }] }),
  },

  // ── 防御穿透变体 ─────────────────────────────────────────
  // "无视对手N%的防御(属性|能力|值)?" → ignore_def pct（"无视对手20%的防御属性"词序变体）
  { id: "e31-id-01",
    re: /^无视(?:对手|对方|敌方)(?:的)?(\d+)%(?:的)?(?:防御|特防|双防)(?:属性|能力|值|强化)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: num(m[1]) } }] }),
  },
  // "无视对手(特防|防御)(能力)?(提升|强化)状态" → pierce_stages（单维≈全维 UNVERIFIED——pierce_stages 是全强化穿透）
  { id: "e31-id-02",
    re: /^无视(?:对手|对方|敌方)(?:的)?(?:特防|防御)(?:能力|属性)?(?:的)?(?:提升|强化|上升)(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }),
  },
  // "无视(任何|所有|一切)?伤害限制(效果)?" → pierce_limit（"任何"变体补位）
  { id: "e31-id-03",
    re: /^无视(?:任何|所有|一切)?伤害限制(?:类)?(?:效果|能力)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_limit", target: "self" }] }),
  },

  // ── 按能力提升种数固伤 ────────────────────────────────────
  // "自身每处于(1种|一种)能力提升(状态)?则(攻击)?附加N点(固定伤害|固伤)" → damage flatPerStage who:self sign:up
  { id: "e31-fs-01",
    re: new RegExp(`^(?:自身|自己)?每(?:处于|有)${NUM}?种能力(?:提升|强化|上升)(?:状态)?则(?:攻击|攻击技能)?(?:额外)?附加(\\d+)点(?:固定伤害|固伤|伤害)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, flatPerStage: { who: "self", sign: "up", per: num(m[1] ?? "1"), flat: num(m[2]) }, target: "opponent" }] }),
  },

  // ── 阶段等级条件扩展（condOf 收不了的 body 级写法）────────
  // "攻击(附加|附带)等同于自身防御值的N%(的)?(固定)?伤害" → flatSelfDefSumPct 系（防御值映射 def）
  // ——已存在的不用补，本批只收确定缺口。

  // ── 裸百分比伤害提升 ────────────────────────────────────
  // "攻击提升N%"/"攻击提高N%"（无"伤害"字样——stage 是整数位，百分数语境只能是伤害窗）→ dmg_boost pct
  { id: "e31-db-01",
    re: /^(?:自身|自己)?(?:攻击|攻击伤害|攻击威力)(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]) } }] }),
  },
  // "(对手|对方)攻击提升N%"——对手出招伤害提升（dmg_boost 压对手侧）
  { id: "e31-db-02",
    re: /^(?:使|令)?(?:对手|对方|敌方)攻击(?:造成的)?伤害?(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "opponent", params: { pct: num(m[1]) } }] }),
  },

  // ── 面板体力加点 ────────────────────────────────────────
  // "体力+N"/"最大体力+N"（裸形——stage 无 hp 维，面板加点走 stat_boost；与 heal-173 值后缀同族）
  { id: "e31-hp-01",
    re: new RegExp(`^(?:自身|自己)?(?:最大)?体力([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "stat_boost", stats: ["hp"], add: (m[1] === "-" ? -1 : 1) * num(m[2]), target: "self" }] }),
  },
  // "对手体力+N"（对手面板——罕见但存在）
  { id: "e31-hp-02",
    re: new RegExp(`^(?:对手|对方|敌方)(?:最大)?体力([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "stat_boost", stats: ["hp"], add: (m[1] === "-" ? -1 : 1) * num(m[2]), target: "opponent" }] }),
  },

  // ── 面板加点枚举 ────────────────────────────────────────
  // "增加自身N点X值"（"增加自身60点体力值、60点攻击值"——stat_boost 单维加点）
  { id: "e31-sb-01",
    re: new RegExp(`^增加(?:自身|自己)?(\\d+)点(体力|攻击|防御|特攻|特防|速度|命中)(?:值|能力值)?$`),
    go: (m) => { const st = { 体力: "hp", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }[m[2]]; return { effects: [{ op: "stat_boost", stats: [st], add: num(m[1]), target: "self" }] }; },
  },

  // ── 受击转回复分数 ──────────────────────────────────────
  // "受到的所有类型伤害的1/2转化为自身体力"。放在 e31-dh-03 前面，那条是百分比。
  { id: "e31-dh-03a",
    re: new RegExp(`^受到(?:的)?所有类型伤害的${NUM}\\s*/\\s*${NUM}转化为(?:自身|自己)?体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "受到(的)?(攻击)?伤害(的)?N%转化为自身体力" → dmg_to_heal pct（dmgToHealPctOf 读 params.pct）
  { id: "e31-dh-03",
    re: new RegExp(`^受到(?:的)?(?:攻击|攻击技能)?伤害(?:的)?${NUM}%转化为(?:自身|自己)?体力(?:值)?$|^受到(?:的)?攻击伤害(?:的)?${NUM}%恢复(?:为)?(?:自身|自己)?体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }),
  },
  // "免疫并反弹致命一击伤害" 在 e31-cr-01 已收——本行仅防回归注释

  // ── 裸面板加点（枚举续段丢动词——"60点体力值、60点攻击值"中后者）──
  { id: "e31-sb-02",
    re: /^(?:增加|提升|提高)?(\d+)点(体力|攻击|防御|特攻|特防|速度|命中)(?:值|能力值)$/,
    go: (m) => { const st = { 体力: "hp", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }[m[2]]; return { effects: [{ op: "stat_boost", stats: [st], add: num(m[1]), target: "self" }] }; },
  },

  // ── 每级能力状态×N% 伤害提升（per-unit scaling——dmg_boost params 乘算）──
  // "对手每处于1种能力提升(状态)?则(自身)?(造成的)?(攻击)?伤害(提升|提高|增加)N%" → perFoeStage
  { id: "e31-ps-01",
    re: new RegExp(`^(?:对手|对方|敌方)每(?:处于|有)${NUM}?种能力(?:提升|强化|上升)(?:状态)?则(?:自身|自己)?(?:造成(?:的)?)?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perFoeStage: num(m[2]) } }] }),
  },
  // "对手每处于1种能力下降(状态|扰态)?则(自身)?(造成的)?(攻击)?伤害提升N%" → perFoeStageDown
  { id: "e31-ps-02",
    re: new RegExp(`^(?:对手|对方|敌方)每(?:处于|有)${NUM}?种能力(?:下降|降低)(?:状态|扰态)?则(?:自身|自己)?(?:造成(?:的)?)?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perFoeStageDown: num(m[2]) } }] }),
  },
  // "自身每处于1种能力提升状态则(造成)?(攻击)?伤害提升N%" → perStage（裸形——已有门控组内变体不重复）
  { id: "e31-ps-03",
    re: new RegExp(`^(?:自身|自己)每(?:处于|有)${NUM}?种能力(?:提升|强化|上升)(?:状态)?则(?:造成(?:的)?)?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perStage: num(m[2]) } }] }),
  },

  // ── 裸损失体力 ──────────────────────────────────────────
  // "损失N点体力"（主语语境=对手承损——perStageCtx/dot 窗下命中）→ foe_dot flat
  { id: "e31-ls-01",
    re: /^(?:(?:对手|对方|敌方)的?)?损失(\d+)点(?:固定)?(?:体力|HP|生命)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { flat: num(m[1]) } }] }),
  },

  // ── 承伤百分比反弹 ──────────────────────────────────────
  // "将受到的攻击伤害N%反弹给对手" / "所受伤害的N%反弹给对方" → reflect_dmg{n,d}
  { id: "e31-rf-01",
    re: new RegExp(`^将(?:自身|自己)?(?:受到|所受)?(?:的)?(?:攻击)?伤害(?:的)?${NUM}%反弹给(?:对手|对方|敌方)$|^(?:所受|受到)(?:的)?(?:攻击)?伤害(?:的)?${NUM}%反弹给(?:对手|对方|敌方)$|^受到?(?:的)?攻击伤害${NUM}%反弹给(?:对手|对方|敌方)$|^(?:自身|自己)?(?:受到)?(?:的)?(?:攻击|攻击技能)?伤害?的?${NUM}%(?:的)?反弹给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1] ?? m[2] ?? m[3] ?? m[4]), d: 100 } }] }),
  },

  // ── 后备精灵回复 ────────────────────────────────────────
  // "恢复己方所有不在场(且存活)?精灵N点体力" / "…精灵最大体力的N/M" → heal target:bench flat/frac
  { id: "e31-bh-01",
    re: new RegExp(`^(?:恢复|回复)己方所有不在场(?:且存活)?(?:的)?精灵(?:最大体力(?:的)?)?${NUM}点(?:体力|HP)$|^恢复(?:己方)?(?:所有)?不在场(?:的)?精灵${NUM}%$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "bench" }] }),
  },
  { id: "e31-bh-02",
    re: new RegExp(`^(?:恢复|回复)己方所有不在场(?:且存活)?(?:的)?精灵最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "bench" }] }),
  },
  // "自身技能恢复N/M最大体力"（技能主语前缀——"对手每有一只不在场精灵则自身技能恢复1/10"）
  { id: "e31-bh-03",
    re: new RegExp(`^(?:自身|自己)?(?:所有)?技能恢复${NUM}\\s*/\\s*${NUM}(?:最大)?体力(?:的)?$|^恢复${NUM}\\s*/\\s*${NUM}最大体力$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]), target: "self" }] }),
  },

  // ── 承伤减免（第一次/裸形）────────────────────────────────
  // "第一次受到攻击伤害减少N%" → dmg_taken_down{pct,count:1}（count 递减在承伤通道已接）
  { id: "e31-td-01",
    re: new RegExp(`^第(?:一|1)次受到?(?:的)?(?:攻击)?伤害(?:减少|降低|减免)${NUM}%$|^(?:受到|受到来自对手的?)(?:攻击)?伤害(?:减少|降低|减免)${NUM}%$|^(?:攻击)?伤害(?:减少|降低|减免)${NUM}%$|^减少${NUM}%$`),
    go: (m) => { const once = /^第/.test(m[0]); const n = num(m.slice(1).find((x) => x !== undefined)); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: n, ...(once ? { count: 1 } : {}) } }] }; },
  },

  // ── 次数窗伤害提升 ──────────────────────────────────────
  // "自身下N次造成的攻击伤害提升N%" / "下N次攻击伤害提升N%" → dmg_boost{pct,count}（count 窗在伤害通道递减）
  { id: "e31-cb-01",
    re: new RegExp(`^(?:自身|自己)?下${NUM}次(?:造成(?:的)?)?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[2]), count: num(m[1]) } }] }),
  },

  // ── PP 域补全 ─────────────────────────────────────────
  // "(降低|减少|扣除)对手所有技能N-M点PP值" → pp_delta amountRange 全槽各抽（负值即扣）
  { id: "e31-pp-01",
    re: new RegExp(`^(?:(?:使|令|让))?\\s*(?:对手|对方|敌方)(?:所有|全部)?技能PP值?(?:随机)?(?:降低|减少|扣除|损失)(\\d+)-(\\d+)点?$|^(?:降低|减少|扣除|随机减少)(?:对手|对方|敌方)(?:所有|全部)?技能(\\d+)-(\\d+)点PP值?$`),
    go: (m) => { const lo = num(m[1] ?? m[3]); const hi = num(m[2] ?? m[4]); return { effects: [{ op: "pp_delta", amountRange: { min: -Math.max(lo, hi), max: -Math.min(lo, hi) }, target: "opponent", scope: "all" }] }; },
  },
  // "(使|令)对手该(攻击)?技能PP值(额外)?-N" → pp_delta scope:current（当前招式槽——触发语境下 move=对手所用技能）
  { id: "e31-pp-02",
    re: /^(?:使|令|让)(?:对手|对方|敌方)该(?:攻击|属性)?技能PP值?(?:额外)?([-－]\d+|-\d+)$|^使(?:对手|对方|敌方)该技能PP值额外减(\d+)$/,
    go: (m) => ({ effects: [{ op: "pp_delta", amount: m[1] !== undefined ? -Math.abs(parseInt(m[1], 10)) : -num(m[2]), target: "opponent", scope: "current" }] }),
  },
  // "恢复己方所有不在场且存活精灵N点技能PP值" → pp_delta bench +aliveOnly
  { id: "e31-pp-03",
    re: new RegExp(`^恢复(?:己方|我方)(?:所有|全部)?不在场(?:且存活)?(?:的)?精灵(\\d+)点(?:技能)?PP值?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "bench", scope: "all", ...(m[0].includes("存活") ? { aliveOnly: true } : {}) }] }),
  },
  // "(令|使)对手(当回合使用的)?技能PP值?消耗N倍" / "消耗翻倍" → pp_mul{mul}/pp_double（ppCostMul 窗，对手侧）
  { id: "e31-pp-04",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)(?:当回合使用的|释放的|使用的)?技能PP值?(?:额外)?消耗(\d+)倍$|^(?:使|令|让)?(?:对手|对方|敌方)(?:当回合使用的|释放的|使用的)?技能PP值?消耗翻倍$|^(?:对手|对方|敌方)(?:释放|使用)(?:的)?技能消耗的PP值(翻倍|为?(\d+)倍)$/,
    go: (m) => { const mul = m[1] !== undefined ? num(m[1]) : m[3] !== undefined ? num(m[3]) : undefined; const dbl = mul === undefined; const once = m[0].includes("当回合"); return { effects: [{ op: "apply_status", name: dbl ? "pp_double" : "pp_mul", target: "opponent", ...(once ? { turns: 1 } : {}), ...(dbl ? {} : { params: { mul } }) }] }; },
  },
  // "(自身)?使用技能(所)?消耗的PP值为N倍" → pp_mul self（常驻被动）
  { id: "e31-pp-05",
    re: /^(?:自身|自己)?使用(?:技能|攻击)(?:所)?消耗的PP值为(\d+)倍$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: "self", params: { mul: num(m[1]) } }] }),
  },

  // ── 异常域补全 ─────────────────────────────────────────
  // "令对手N%进入AIL、AIL(、AIL)?中的M种异常(状态)?" → random list + chance
  { id: "e31-rd-01",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)(${NUM})%?(?:的?(?:几|概)?率)?进入(${AIL_RE})(?:、|,)(${AIL_RE})(?:(?:、|,)(${AIL_RE}))?中的(${NUM})种异常(?:状态)?$`),
    go: (m) => { const list = [m[3], m[4], m[5]].filter((x) => x !== undefined).map((x) => AILMENTS[x]); return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: num(m[6]) }, ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }; },
  },
  // "(使|令)?对手?(随机)?(进入|陷入)AIL(、AIL)*中的M种异常(状态)?"（任意长度列表）→ random list
  { id: "e31-rd-02",
    re: new RegExp(`^(?:(?:使|令)(?:对手|对方|敌方)?|(?:对手|对方|敌方))?(?:随机)?(?:进入|陷入)((?:${AIL_RE})(?:、|,)(?:${AIL_RE})(?:(?:、|,)(?:${AIL_RE}))*)中的(${NUM})种异常(?:状态)?$`),
    go: (m) => { const list = m[1].split(/、|,/).map((x) => AILMENTS[x]).filter(Boolean); return list.length >= 2 ? { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: num(m[2]) } }] } : null; },
  },
  // "反弹自身所处(的)?异常状态(给对手)?" → transfer_ailments push（自身异常压给对手）
  { id: "e31-ta-01",
    re: /^反弹自身所处(?:的)?异常状态(?:给对手)?$|^将自身所处(?:的)?异常状态反弹给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "transfer_ailments", direction: "push", target: "opponent" }] }),
  },
  // "免除异常状态"（免除=免疫）→ 仅异常；「免下降异常」（倒置）→ 免异常+免弱化。放在 e31-im-02 前面，那条动词只收「免(疫)」。
  { id: "e31-im-02a",
    re: /^(?:自身|自己)?免除(?:所有|全部)?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }),
  },
  { id: "e31-im-02b",
    re: /^(?:自身|自己)?免(?:除)?(?:能力)?下降异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "免异常(状态)?(和|与|、)能力下降(状态)?" → immune_status + immune_degrade 双窗
  { id: "e31-im-02",
    re: /^免(?:疫)?异常(?:状态)?(?:和|与|、)?能力(?:等级)?下降(?:状态)?$|^免疫异常状态和能力下降状态$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "令对手N%其AIL"/"N%令对手其AIL"（"其"中缀变体）→ apply_status
  { id: "e31-ai-01",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)(${NUM})%(?:的?(?:几|概)?率)?其(${AIL_RE})(?:状态)?$|^(${NUM})%(?:的?(?:几|概)?率)?(?:令|使)(?:对手|对方|敌方)其(${AIL_RE})(?:状态)?$|^(?:令|使)(?:对手|对方|敌方)其(${AIL_RE})(?:状态)?$`),
    go: (m) => { const pct = m[1] ?? m[4]; return { effects: [{ op: "apply_status", name: AILMENTS[m[3] ?? m[6] ?? m[7]], target: "opponent", ...(pct !== undefined ? { chance: num(pct) } : {}) }] }; },
  },
  // "(自身攻击)有N%的几率(使|令)对手随机进入AIL、AIL(、AIL)?中的M种异常(状态)?" → random list + chance
  { id: "e31-rd-03",
    re: new RegExp(`^(?:自身|自己)?(?:攻击)?有(${NUM})%(?:的)?(?:几率|概率|机会)(?:使|令)(?:对手|对方|敌方)随机进入(${AIL_RE})(?:、|,)(${AIL_RE})(?:(?:、|,)(${AIL_RE}))?中的(${NUM})种异常(?:状态)?$`),
    go: (m) => { const list = [m[3], m[4], m[5]].filter((x) => x !== undefined).map((x) => AILMENTS[x]); return { effects: [{ op: "apply_status", name: "random", target: "opponent", chance: num(m[1]), random: { list, count: num(m[6]) } }] }; },
  },

  // ── 恢复域词形补全 ─────────────────────────────────────
  // "恢复N点固定(体力|HP|血量)"（"固定"中缀）→ heal flat
  { id: "e31-hl-01",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(\\d+)点固定(?:的)?(?:体力|HP|血量|生命)$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }),
  },
  // "(自身)?恢复N(体力|HP|血量)"（无"点"裸形）→ heal flat
  { id: "e31-hl-02",
    re: new RegExp(`^(?:自身|自己)?(?:恢复|回复)(\\d+)(?:点)?(?:体力|HP|血量|生命)$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }),
  },
  // "造成伤害(值)?(的)?N%恢复自身(体力|血量|HP)" → drain_atk pct 窗（出伤吸血）
  { id: "e31-hl-03",
    re: new RegExp(`^(?:造成|给予)(?:对手|对方|敌方)?(?:攻击)?伤害(?:值|量)?(?:的)?(\\d+)%(?:的)?(?:都会|会|则)?恢复(?:自身|自己)(?:体力|血量|HP|生命)(?:值)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1]), d: 100 } }] }),
  },
  // "(立刻|立即)恢复(自身)?最大体力(的)?N%的体力" → heal frac
  { id: "e31-hl-04",
    re: new RegExp(`^(?:立刻|立即|马上)恢复(?:自身|自己)?(?:最大体力|体力上限)(?:的)?(\\d+)%(?:的)?(?:体力|HP|生命)?$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: 100, target: "self" }] }),
  },
  // "恢复(本次|当次|该次)(受到|攻击)?伤害(量|值)?的?N/M(或N%)的体力" → dmg_to_heal frac（承伤回奶）
  { id: "e31-hl-05",
    re: new RegExp(`^恢复(?:本次|当次|该次)(?:受到(?:的)?|攻击)?伤害(?:量|值)?的?${NUM}\\s*/\\s*${NUM}的(?:体力|HP|生命)$|^恢复(?:本次|当次|该次)(?:受到(?:的)?|攻击)?伤害(?:量|值)?的?(\\d+)%的(?:体力|HP|生命)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: ns.length > 1 ? Math.round((ns[0] * 100) / ns[1]) : ns[0] } }] }; },
  },

  // ── 固伤域词形补全 ─────────────────────────────────────
  // "附加固伤N点" / "附加N点(的)?固伤" → dmg_flat{flat}（裸固伤缩写形）
  { id: "e31-fd-01",
    re: new RegExp(`^附加(?:对手|对方|敌方)?固伤(\\d+)点$|^附加(\\d+)点(?:的)?固伤$|^固伤(\\d+)点$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: num(m[1] ?? m[2] ?? m[3]) } }] }),
  },
  // "(使|令)对手受到等同于自身最大体力N%(的)?(固定伤害|固伤)" → damage kind:fixed flatSelfPct
  { id: "e31-fd-02",
    re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)受到等同于自身最大体力(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfPct: num(m[1]), target: "opponent" }] }),
  },
  // "(N%)?附加等同于(对手|自身)(STAT)值(的)?(固定伤害|固伤)" → damage kind:fixed flat{Foe|Self}StatPct 100%
  { id: "e31-fd-03",
    re: new RegExp(`^(${NUM})%?(?:的?(?:几|概)?率)?附加等同于(对手|对方|敌方|自身|自己)(${STAT_RE})值(?:的)?(?:固定伤害|固伤)$|^附加等同于(对手|对方|敌方|自身|自己)(${STAT_RE})值(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => { const foe = /对手|对方|敌方/.test(m[3] ?? m[5]); const st = STATS[m[4] ?? m[6]]; if (st === undefined || st === "acc") return null; const key = foe ? "flatFoeStatPct" : "flatSelfStatPct"; return { effects: [{ op: "damage", kind: "fixed", power: 0, [key]: { stat: st, pct: 100 }, target: "opponent", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }; },
  },
  // "附加自身双防能力提升总段数乘以N的(固定伤害|固伤)" → dmg_flat{flatDefStageMul}（def+sdf 正级和×N）
  { id: "e31-fd-04",
    re: new RegExp(`^附加自身双防能力(?:提升|强化)(?:总)?段数乘以(\\d+)的(?:固定伤害|固伤)$|^自身双防能力(?:提升|强化)(?:总)?段数乘以(\\d+)的(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flatDefStageMul: num(m[1] ?? m[2]) } }] }),
  },
  // "下N次攻击附加(自身)?当前体力N%的(固定伤害|固伤)" → dmg_flat{selfCurPct,count}（次数窗）
  { id: "e31-fd-05",
    re: new RegExp(`^下${NUM}次(?:攻击|攻击技能)附加(?:自身|自己)?当前体力(?:值)?(\\d+)%(?:的)?(?:固定伤害|固伤)$|^下${NUM}次(?:攻击|攻击技能)附加(?:自身|自己)?当前体力(?:值)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const cnt = ns[0]; const pct = ns.length > 2 ? Math.round((ns[1] * 100) / ns[2]) : ns[1]; return { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { selfCurPct: pct, count: cnt } }] }; },
  },

  // ── 承伤减免/反弹词形补全 ──────────────────────────────
  // "受到的攻击伤害-N%" / "受到的攻击伤害少N%" → dmg_taken_down（负号/少字变体）
  { id: "e31-td-02",
    re: new RegExp(`^受到(?:的)?(?:攻击|攻击技能)?伤害([-－]\\d+)%$|^受到(?:的)?(?:攻击|攻击技能)?伤害少(\\d+)%$`),
    go: (m) => { const n = m[1] !== undefined ? Math.abs(parseInt(m[1], 10)) : num(m[2]); return { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: n } }] }; },
  },
  // "反弹下回合受到的攻击伤害" → reflect_dmg 全额窗（下回合=1 回合窗）
  { id: "e31-rf-02",
    re: /^反弹(?:下回合|下1回合|当回合)?受到?的?(?:攻击|攻击技能)?伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", ...(m[0].includes("回合") ? { turns: 1 } : {}), params: { n: 1, d: 1 } }] }),
  },
  // "(自身)?受到自身最大体力值?N%的(固定伤害|固伤)" → 自伤 damage fixed flatSelfPct
  { id: "e31-sd-01",
    re: new RegExp(`^(?:自身|自己)?受到自身最大体力值?(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfPct: num(m[1]), target: "self" }] }),
  },
  // "(自身)?下N次受到的攻击伤害不超过M点" → dmg_cap{cap,count}（次数制承伤上限窗）
  { id: "e31-cp-01",
    re: new RegExp(`^(?:自身|自己)?下${NUM}次受到(?:的)?(?:攻击|攻击技能)?伤害(?:上限)?不超过(\\d+)点$|^受到(?:的)?(?:攻击|攻击技能)?伤害不超过(\\d+)点$`),
    go: (m) => { const cnt = m[1] !== undefined ? num(m[1]) : 1; return { effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[2] ?? m[3]), count: cnt } }] }; },
  },
  // "(所有|全部)技能(吸|吸取|吸收)对手最大体力N/M" → dmg_flat{foeMaxPct,healEcho}（固伤窗等额吸血——吸取语义近似）
  { id: "e31-dr-01",
    re: new RegExp(`^(?:所有|全部|己方所有|自身所有)(?:的)?(?:技能|攻击技能|攻击|招式)(?:吸取|吸收|吸)(?:对手|对方|敌方)(?:的)?最大(?:体力|HP)(?:的)?${NUM}\\s*/\\s*${NUM}$|^(?:所有|全部|己方所有|自身所有)(?:的)?(?:技能|攻击技能|攻击|招式)(?:吸取|吸收|吸)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:体力|HP)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { foeMaxPct: Math.round((ns[0] * 100) / ns[1]), healEcho: 1 } }] }; },
  },
  // "(吸取|吸收)对手最大体力N/M" 分数前序变体（e6 系已有"吸取对手N/M最大体力"——此处收"最大体力"在前的词序）
  { id: "e31-dr-02",
    re: new RegExp(`^(?:吸取|吸收|吸)(?:对手|对方|敌方)(?:的)?最大(?:体力|HP)(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "percent", frac: { numerator: ns[0], denominator: ns[1] }, target: "opponent" }, { op: "heal", numerator: ns[0], denominator: ns[1], missing: true, target: "self" }] }; },
  },
  // "受到的(固定|百分比|真实)伤害(和|与|、)(固定|百分比|真实)?伤害不超过N点" → dmg_cap{cap,kindMask}（类别承伤上限）
  { id: "e31-cp-02",
    re: new RegExp(`^受到(?:的)?(固定|百分比|真实|攻击)(?:伤害)?(?:和|与|、)(固定|百分比|真实|攻击)?伤害(?:上限)?不超过(\\d+)点$|^受到(?:的)?(固定|百分比|真实|攻击)伤害(?:上限)?不超过(\\d+)点$`),
    go: (m) => {
      const B = { 固定: 1, 百分比: 2, 真实: 8, 攻击: 4 };
      const km = (B[m[1]] ?? 0) | (B[m[2]] ?? 0) | (B[m[4]] ?? 0);
      return { effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[3] ?? m[5]), kindMask: km } }] };
    },
  },
  // "(为|给|附加)N点护盾和(M点)?护罩"——盾罩枚举对（"护盾与护罩"顿号形走 cloneShield；本形"和"连词）
  { id: "e31-sw-01",
    re: new RegExp(`^(?:为|给|使|令)?(?:自身|自己)?(?:附加|获得|生成|创造)?(${NUM})点护(盾|罩)与(?:(${NUM})点)?护(盾|罩)$`),
    go: (m) => {
      const n1 = num(m[1] ?? m[2]); const k1 = m[3] === "盾" ? "shield" : "ward"; const k2 = m[6] === "盾" ? "shield" : "ward"; const n2 = m[4] !== undefined || m[5] !== undefined ? num(m[4] ?? m[5]) : n1;
      const eff = (k, f) => ({ op: "apply_status", name: k, target: "self", params: { flat: f, ...(k === "ward" ? { kindMask: 3 } : {}) } });
      return k1 === k2 ? { effects: [eff(k1, n1 + n2)] } : { effects: [eff(k1, n1), eff(k2, n2)] };
    },
  },
  // "(使|令)?(对手|自身)?X(提升|提高|上升|下降|降低|弱化)N级" —— 无号 stat-stage 词形（"攻击提升1级"/"使对手防御下降2级"）
  { id: "e31-st-06",
    re: new RegExp(`^(?:使|令|让)?(对手|对方|敌方|自身|自己)?(?:的)?(${STAT_RE})(?:能力)?(?:等级)?(提升|提高|上升|增加|增强|下降|降低|弱化|减少|减弱)${NUM}(?:个)?(?:等级|级)?$`),
    go: (m) => { const who = /对手|对方|敌方/.test(m[1] ?? "") ? "opponent" : "self"; const sgn = /下降|降低|弱化|减少|减弱/.test(m[3]) ? -1 : 1; return { effects: [{ op: "apply_stat_stage", stat: STATS[m[2]] ?? m[2], delta: sgn * num(m[4]), target: who }] }; },
  },
  // "(对自身|对自己)造成N点(固定|真实|百分比)?伤害" → self-damage（破盾反噬/自伤变体）
  { id: "e31-sd-02",
    re: new RegExp(`^(?:对|给|令|使)?(?:自身|自己)造成(${NUM})点(?:固定|真实|百分比)?(?:伤害)?$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2]), target: "self" }] }),
  },
  // "消除并获得对手的护盾、护罩" → cleanse{scope:shield, stealShield}（偷盾：被消盾罩转给行动方）
  { id: "e31-st-07",
    re: /^消除并获得(?:对手|对方|敌方)的护[盾罩][、,]?(?:护[盾罩])?(?:效果|类效果)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "shield", target: "opponent", stealShield: true }] }),
  },
  // "(获得|附加)等同于溢出量的护罩" → ward{fromOverflow}（回复封顶外溢转固伤/百分比承伤盾）
  { id: "e31-of-01",
    re: /^(?:获得|附加|获得等同于|附加等同于|得到)(?:等同于)?(?:当次|本次|该次)?(?:回复|恢复|治疗)?(?:量的)?溢出量的护罩$/,
    go: () => ({ effects: [{ op: "apply_status", name: "ward", target: "self", params: { fromOverflow: 1, kindMask: 3 } }] }),
  },
  // "附加溢出量N%的(真实|固定|百分比)?伤害" → damage{flatSelfOverflowPct}
  { id: "e31-of-02",
    re: new RegExp(`^(?:额外)?(?:附加|造成|给予)(?:对手|对方|敌方)?溢出量的?(${NUM})%的(真实|固定|百分比)?伤害$|^附加溢出量(${NUM})%的(真实|固定|百分比)?伤害$`),
    go: (m) => { const p = num(m[1] ?? m[4]); const k = (m[3] ?? m[6]) === "真实" ? "true" : "fixed"; return { effects: [{ op: "damage", kind: k, power: 0, flatSelfOverflowPct: p, target: "opponent" }] }; },
  },
  // "恢复(等同于)?(所拥有|拥有的)?护盾、护罩(值)?之和的体力" → heal{shieldSum}（读盾罩总值不消耗）
  { id: "e31-ss-01",
    re: /^(?:自身)?恢复(?:等同于|相当于|与)?(?:(?:自身|自己)?所?拥有?的?|当前)?护[盾罩](?:、|和|与)?护[盾罩]?(?:值)?(?:之和|总值|合计|总额)?的?(?:体力|HP)(?:值)?$/,
    go: () => ({ effects: [{ op: "heal", target: "self", shieldSum: true }] }),
  },
  // "(获得|附加)等同于(当前)?体力值?的护盾、护罩" → shield+ward fracCurHp 1/1 枚举对
  { id: "e31-ss-02",
    re: /^(?:为|给|令|使)?(?:自身|自己)?(?:附加|获得|生成|创造)?等同于(?:自身|自己)?(?:当前)?体力值?的?护(盾|罩)(?:、|和|与)护(盾|罩)$/,
    go: (m) => {
      const eff = (k) => ({ op: "apply_status", name: k === "罩" ? "ward" : "shield", target: "self", params: { fracCurHpN: 1, fracCurHpD: 1, ...(k === "罩" ? { kindMask: 3 } : {}) } });
      return m[1] === m[2] ? { effects: [eff(m[1])] } : { effects: [eff(m[1]), eff(m[2])] };
    },
  },
  // "(获得|附加)等同于体力值的护盾"（单体当前体力全额——fracCurHp 1/1）
  { id: "e31-ss-03",
    re: /^(?:为|给|令|使)?(?:自身|自己)?(?:附加|获得|生成|创造)?等同于(?:自身|自己)?(?:当前)?体力值?的?护(盾|罩)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: m[1] === "罩" ? "ward" : "shield", target: "self", params: { fracCurHpN: 1, fracCurHpD: 1, ...(m[1] === "罩" ? { kindMask: 3 } : {}) } }] }),
  },
];
