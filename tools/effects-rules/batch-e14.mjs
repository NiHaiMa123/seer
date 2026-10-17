// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e14：魂印长尾第八批——翻倍变体/提升区间/次数窗增伤/伤害反馈/承伤转体力/自留血/最大体力附加/体力设为定值。
import { NUM, num, frac, AILMENTS, AIL_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 翻倍/倍率变体 ─────────────────────────────────────────
  // "(使|令)?(自身|自己)?造成(的)?(攻击)?伤害翻倍" → dmg_mul 2（"使造成的伤害翻倍"/"造成的伤害翻倍"）
  { id: "e14-db-01",
    re: /^(?:使|令)?(?:自身|自己)?造成(?:的)?(?:攻击)?伤害?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: 2 } }] }),
  },
  // "(本次|当次|本回合)(出手|攻击)?(伤害|伤害)?翻倍" → dmg_mul turns1
  { id: "e14-db-02",
    re: /^(?:本次|当次|本回合)(?:出手|攻击|攻击伤害|伤害)?(?:的)?(?:攻击)?伤害?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", turns: 1, params: { mul: 2 } }] }),
  },
  // "(造成|攻击)?(攻击)?伤害提升N%-M%" → dmg_boost 区间（"造成的伤害提升50%-150%"）
  { id: "e14-db-03",
    re: /^(?:使|令)?(?:自身|自己)?(?:造成|攻击)?(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%-(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: +m[1], pctMax: +m[2] } }] }),
  },
  // "(下|接下来|之后)?N次攻击(造成的)?(攻击)?伤害(提高|提升)N%" → dmg_boost {pct,count}
  { id: "e14-db-04",
    re: new RegExp(`^(?:下|接下来|之后)?${NUM}次攻击(?:造成)?(?:的)?(?:攻击)?伤害(?:提高|提升|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[2], count: num(m[1]) } }] }),
  },
  // "(使|令)自身下1次攻击(造成的)?(伤害)?(提高|提升)N%" → 同上1次
  { id: "e14-db-05",
    re: /^(?:使|令)?自身下1次攻击(?:造成)?(?:的)?(?:攻击)?伤害(?:提高|提升|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1], count: 1 } }] }),
  },
  // "(自身)?伤害(的)?N%(会)?附加到自身攻击伤害中" → flatDealtPct 变体
  { id: "e14-db-06",
    re: /^(?:自身|自己)?(?:攻击|造成)?伤害(?:的)?(\d+)%(?:的等量)?(?:会)?附加到(?:自身|自己)(?:的)?攻击伤害中$/,
    go: (m) => ({ attachDamage: { lastDmgFrac: frac(+m[1], 100) } }),
  },

  // ── 伤害反馈 ─────────────────────────────────────────────
  // "受到伤害反弹100点固定伤害"（无「攻击/每次」的承伤定额反伤）。放在 e14-rf-01 前面，那条要求句首「反馈给对手」。
  { id: "e14-rf-00",
    re: new RegExp(`^受到伤害反弹${NUM}点(?:固定|固定伤害|伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { flat: num(m[1]) } }] }),
  },
  // "(每次受到攻击)?(都|就)?会?反馈给对手N/M(的)?(固定|真实)?伤害" → reflect_dmg frac
  { id: "e14-rf-01",
    re: new RegExp(`^(?:每次受到攻击)?(?:都|就)?会?反馈给(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定|真实)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },
  // "反弹伤害N/M给对手" → reflect_dmg（语序变体）
  { id: "e14-rf-02",
    re: new RegExp(`^反弹(?:伤害)?${NUM}\\s*/\\s*${NUM}给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },
  // "将(所|受到的)?(攻击)?伤害反弹给对手" → reflect_dmg 全量（"将受到的攻击伤害反弹给对手"）
  { id: "e14-rf-03",
    re: /^将(?:所)?受到的?(?:攻击)?伤害反弹给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }),
  },

  // ── 承伤转体力 ────────────────────────────────────────────
  // "(第|下)N次受到的攻击伤害转化为自身体力" → dmg_to_heal count（"第1次"变体）
  { id: "e14-th-01",
    re: new RegExp(`^(?:令|使)?(?:自身|自己)?(?:第|下)${NUM}次受到的攻击伤害转化为(?:自身|自己)体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { count: num(m[1]) } }] }),
  },
  // "受到的攻击伤害转化为(自身)?体力" 裸形 → dmg_to_heal 常驻
  { id: "e14-th-02",
    re: /^受到的攻击伤害转化为(?:自身|自己)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }),
  },

  // ── 自留血/自伤 ───────────────────────────────────────────
  // "(使|这)?保留N点体力"/"只保留1点体力" → endure {hp:N}
  { id: "e14-sd-01",
    re: new RegExp(`^(?:使|令|这|只)?保留${NUM}点?体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1]) } }] }),
  },
  // "减少对手N/M(的)?(最大)?体力" → damage percent foe（"减少对手1/3最大体力"）
  { id: "e14-sd-02",
    re: new RegExp(`^减少(?:对手|对方|敌方)(?:最大体力|体力最大值|最大体力值)?(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:最大)?体力$|^减少(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:的)?最大体力$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(ns[0], ns[1]), target: "opponent" }] }; },
  },
  // "(将|把|使)对手体力变为N" → heal set opponent
  { id: "e14-sd-03",
    re: new RegExp(`^(?:将|把|使|令)(?:对手|对方|敌方)(?:的)?体力变为${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", set: num(m[1]), target: "opponent" }] }),
  },

  // ── 附加变体 ──────────────────────────────────────────────
  // "(攻击)?附加最大体力N/M的(固伤|固定伤害)" → flatSelfFrac（裸"最大体力"=自身基准）
  { id: "e14-ft-01",
    re: new RegExp(`^(?:攻击|攻击技能)?附加(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatSelfFrac: frac(m[1], m[2]) } }),
  },
  // "附加对手体力N/M的(固伤|固定伤害)" → flatFoeFrac（裸"对手体力"=对手当前体力分数）
  { id: "e14-ft-02",
    re: new RegExp(`^(?:攻击|攻击技能)?附加(?:对手|对方|敌方)体力(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:固定伤害|固伤|百分比伤害)$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: frac(m[1], m[2]) } }),
  },
  // "随机附加N-M点固定伤害" → flatRange（"自身使用攻击技能随机附加200-300点固定伤害"）
  { id: "e14-ft-03",
    re: new RegExp(`^(?:自身|自己)?(?:使用攻击技能)?随机附加${NUM}-${NUM}点?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } }),
  },
  // 「附件」是「附加」的脱字（宿主句 暴风烈焰「对方烧伤时，附件100点伤害」、超震拳风「随机恢复100-200HP，随机附件100-200固定伤害」、
  // 爆发冲击「10%几率额外附件200点固定伤害」）。负载与 e14-ft-03／attach-all-10 逐字同构；「随机附件N-M」的 M 缺「点」字，一并收。
  { id: "d3-attach-typo-01",
    re: new RegExp(`^随机附件${NUM}-${NUM}点?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } }),
  },
  { id: "d3-attach-typo-02",
    re: new RegExp(`^附件${NUM}点?(?:固定伤害|固伤|伤害)$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }),
  },
];
