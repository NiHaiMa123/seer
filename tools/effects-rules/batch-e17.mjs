// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e17：魂印长尾第十一批——等量固伤/自耗体力/属性值附加/等同伤害回血/持有主语/回合数状态/转化异常/随机能力。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 等量/自耗 ─────────────────────────────────────────────
  // "(使|令)对手受到等同于(攻击)?伤害值的固伤" → lastDmgFrac 全量（当次伤害等量固伤）
  { id: "e17-eq-01",
    re: /^(?:使|令)?(?:对手|对方|敌方)受到等同于?(?:攻击|造成的)?伤害值?的?(?:固定伤害|固伤|等量伤害)$/,
    go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, lastDmgFrac: frac(1, 1), target: "opponent" }] }),
  },
  // "消耗自身最大体力的N%" → 自伤百分比（消耗式代价）
  { id: "e17-eq-02",
    re: /^消耗(?:自身|自己)(?:的)?最大体力(?:的)?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(+m[1], 100), target: "self" }] }),
  },
  // "(恢复|回复)等同于(攻击)?伤害N%的体力" → drain_atk（"恢复等同于攻击伤害80%的体力"）
  { id: "e17-eq-03",
    re: /^(?:恢复|回复)等同于?(?:攻击|造成)?伤害(?:的)?(\d+)%(?:的)?体力(?:值)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: +m[1], d: 100 } }] }),
  },

  // ── 属性值附加 ────────────────────────────────────────────
  // "附加(宠名)?STAT值N%的固定伤害" → flatSelfStatPct（"附加乌拉诺斯速度值70%的固定伤害"——值字变体；宠名前缀剥除）
  { id: "e17-st-01",
    re: new RegExp(`^(?:附加|造成)(?:[^，,、；;]{0,6}?)?(${STAT_RE})(?:能力值|值)?(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => { const s = STATS[m[1]]; if (s === undefined || s === "acc") return undefined; return { attachDamage: { flatSelfStatPct: { stat: s, pct: num(m[2]) } } }; },
  },

  // ── 伤害窗口 ─────────────────────────────────────────────
  // "(本场战斗|本局)?(自身)?受到的攻击伤害减少N%" → dmg_taken_down
  { id: "e17-dt-01",
    re: /^(?:本场战斗|本局战斗|本次战斗)?(?:自身|自己)?受到的攻击伤害(?:转变为|转为)?(?:减少|降低|下降)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "(固定|百分比)伤害和(固定|百分比)伤害提升N%" → dmg_boost kindMask（"固定伤害和百分比伤害提升25%"→1|2=3）
  { id: "e17-dt-02",
    re: /^(?:造成|打出)?(?:的)?(?:固定|百分比|真实)伤害[、,，和与]+(?:固定|百分比|真实)伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => { const bits = /真实/.test(m[0]) ? 0b1111 : 0b0011; return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1], kindMask: bits } }] }; },
  },
  // "(自身)?(造成)?(的)?(攻击)?伤害随机提升N%~M%" → pctMin/pctMax（"~"分隔变体）
  { id: "e17-dt-03",
    re: /^(?:自身|自己)?(?:造成)?(?:的)?(?:攻击)?伤害随机(?:提升|提高|增加)(\d+)%(?:~|～|-)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: +m[1], pctMax: +m[2] } }] }),
  },
  // "(当次|本次|此次)攻击必定打出致命一击" → crit_always turns1
  { id: "e17-dt-04",
    re: /^(?:当次|本次|此次|该次)攻击?(?:必定|100%)?打出致命一击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 1 }] }),
  },
  // "(持有精灵|持有者)造成的X" → 主语归一由 normalizeSoulBody 处理；此处收 parse 层"持有"前缀
  { id: "e17-dt-05",
    re: /^受到的攻击伤害转变?为?减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },

  // "每回合?(N%)?免疫异常和能力下降" → 双免疫窗（每回合→turns1 续刷；N%→params.chance 逐次判定）
  { id: "e17-im-01",
    re: /^每回合?(\d+)%免疫异常(?:状态)?(?:和|与|及|以及)(?:所有)?能力(?:下降|弱化)(?:状态)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: 1, params: { chance: +m[1] } }, { op: "apply_status", name: "immune_degrade", target: "self", turns: 1, params: { chance: +m[1] } }] }),
  },
  { id: "e17-im-02",
    re: /^每回合免疫异常(?:状态)?(?:和|与|及|以及)(?:所有)?能力(?:下降|弱化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: 1 }, { op: "apply_status", name: "immune_degrade", target: "self", turns: 1 }] }),
  },
  // "每回合?(N%)?免疫(所有|任何)?异常(状态)?" → 免疫异常窗
  { id: "e17-im-03",
    re: /^每回合?(\d+)%免疫(?:所有|任何|一切)?异常(?:状态)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: 1, params: { chance: +m[1] } }] }),
  },
  { id: "e17-im-04",
    re: /^每回合免疫(?:所有|任何|一切)?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: 1 }] }),
  },
  // "(N%)免疫异常和能力下降" 无前缀概率双免疫（"50%免疫异常和能力下降"）
  { id: "e17-im-05",
    re: /^(\d+)%免疫异常(?:状态)?(?:和|与|及|以及)(?:所有)?能力(?:下降|弱化)(?:状态)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { chance: +m[1] } }, { op: "apply_status", name: "immune_degrade", target: "self", params: { chance: +m[1] } }] }),
  },

  // ── 印记/状态 ────────────────────────────────────────────
  // "(为|给)(自身|对手)附加持续N回合(的)?X" → apply_mark（"为自身附加持续3回合的回能Ⅰ"——具名持续窗近似 mark）
  { id: "e17-mk-01",
    re: new RegExp(`^(?:为|给|令|使)(?:自身|自己|对手|对方|敌方)附加持续${NUM}回合(?:的)?(.{1,10}?)$`),
    go: (m) => { const mk = m[2].replace(/(印记|状态|效果)$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|固定|真实|百分比|\d|先制|致命|无法|免疫/.test(mk)) return undefined; const who = /对手|对方|敌方/.test(m[0].slice(0, 6)) ? "opponent" : "self"; return { effects: [{ op: "apply_mark", mark: mk, count: 1, target: who, turns: num(m[1]) }] }; },
  },
  // "(为|给)(对手)附加N(道|枚|层|个)X" → apply_mark（"为对手附加1道天霆之律"——"附加"变体，e12-mk 只收"施加"）
  { id: "e17-mk-02",
    re: new RegExp(`^(?:为|给|令|使)(?:对手|对方|敌方)附加${NUM}(?:道|枚|层|个|柄)(.{1,8}?)(?:印记)?$`),
    go: (m) => { const mk = m[2].replace(/印记$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: num(m[1]), target: "opponent" }] }; },
  },
  // "附加给对手等同于自身能力(提升|强化)(状态)?的能力下降(状态)?" → 自身正级等额转为对手负级
  // 用已有格子 transfer_stages 的 direction:"upToDown"（与 batch-e6-236／e8-st-03／batch-e5c-04 同一条 IR）：
  // 对手那侧本来就是"能力下降状态"，不需要 invert；自身正级清零走 transfer-stages.ts 的同一分支。
  // id 与位置都不动（前面是 e17-mk-02，后面是 e17-cv-01），已存 id 的相对顺序不变。
  { id: "e17-mk-03",
    re: /^附加给(?:对手|对方|敌方)等同于?(?:自身|自己)?能力(?:提升|强化)(?:状态)?的能力下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "upToDown" }] }),
  },

  // ── 异常转化/随机 ─────────────────────────────────────────
  // "将对手所处的异常状态转化为N回合AIL" → cleanse ailment + 定向异常
  { id: "e17-cv-01",
    re: new RegExp(`^(?:将|把)(?:对手|对方|敌方)(?:所处)?(?:的)?异常状态转化为${NUM}回合(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "cleanse", scope: "ailment", target: "opponent" }, { op: "apply_status", name: AILMENTS[m[2]], target: "opponent", turns: num(m[1]) }] }),
  },
  // "(使|令)(对手和|与)?自身的能力等级发生随机的改变" → 升降方向随机——randomDelta 只建模幅度不建模方向 → 保残
  { id: "e17-cv-02",
    re: /^(?:使|令)(?:对手|对方|敌方)?(?:和|与|、)?(?:自身|自己)?的?能力等级发生随机的?(?:改变|变化)$/,
    go: () => ({ unparsedReason: "random-sign stage delta unmodeled (deferred)" }),
  },
  // "吸取N点" 裸形 → damage+heal（"吸取100点"）
  { id: "e17-cv-03",
    re: new RegExp(`^(?:吸取|吸收)${NUM}点$`),
    go: (m) => ({ effects: [{ op: "damage", power: num(m[1]), kind: "fixed" }, { op: "heal", flat: num(m[1]), target: "self" }] }),
  },
];
