// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e24：魂印长尾第十八批——受击则反应壳/残留体力/翻倍概率/周期触发保残/吸取承伤。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 受击则反应壳（兜底：具体形态由前序 reactWrap 规则先吃）────────
  // "(自身|自己)受到攻击(后|时)?则?Q" → reactWrap（"自身受到攻击则回合结束时吸取对手最大体力的1/3"——无条件壳让位后无规则接）
  { id: "e24-rx-01",
    re: /^(?:若|当|本)?(?:回合)?(?:自身|自己)受到(?:对手|对方|敌方)?的?(?:攻击|攻击伤害|伤害)(?:后|时)?则?(.+)$/,
    go: (m) => reactWrap(1, {}, m[1]),
  },

  // ── 残留体力补遗 ─────────────────────────────────────────
  // "首次死亡时残留N点体力" → endure hp（count 没人读；触发后整条摘掉）
  { id: "e24-ed-01",
    re: new RegExp(`^首次死亡时残留(\\d+)点(?:体力|血|HP)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1]) } }] }),
  },
  // "死亡时则?对手残留N点(体力|血)" → endure opponent（"死亡时则对手残留1点体力"——时则粘连）
  { id: "e24-ed-02",
    re: new RegExp(`^(?:自身|自己)?(?:死亡|阵亡)时则?(?:使|令)?(?:对手|对方|敌方)(?:精灵)?残留(\\d+)点(?:体力|血|HP)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "opponent", params: { hp: num(m[1]) } }] }),
  },

  // ── 概率翻倍/承伤转化 ────────────────────────────────────
  // "造成伤害N%翻倍" → mulChance（"造成伤害40%翻倍"）
  { id: "e24-mc-01",
    re: new RegExp(`^造成(?:的)?(?:攻击)?伤害(?:有)?${NUM}%(?:的?(?:概|几)率)?(翻倍|加倍|变为${NUM}倍|提升${NUM}%)$`),
    go: (m) => { const w = m[2]; const nm = w === "翻倍" || w === "加倍" ? 2 : w.startsWith("变为") ? num(w.slice(2, -1)) : 1 + num(w.slice(2, -1)) / 100; return { attachDamage: { mulChance: { chance: num(m[1]), numerator: Math.round(nm * 100), denominator: 100 } } }; },
  },
  // "吸取此回合受到(的)?攻击伤害" → dmg_to_heal 当回合窗（"吸取此回合受到攻击伤害"）
  { id: "e24-dh-01",
    re: /^(?:吸取|吸收|将)(?:自身|自己)?此回合受到(?:的)?(?:攻击|攻击伤害|伤害)(?:转化为自身体力|的体力)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", turns: 1 }] }),
  },
  // max_hp_down 不读 count。n/d 照旧；次数键过不了 params 检查，也不会因此变成一次。
  { id: "e24-hd-01",
    re: new RegExp(`^(?:自身|自己)攻击技能减少(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },

  // ── deferred 归桶 ───────────────────────────────────────
  // "每N回合(触发|转动|开启|旋转|掷出)一次X" → 周期触发未建模
  { id: "e24-df-01",
    re: new RegExp(`^每${NUM}回合(?:触发|转动|开启|旋转|掷出|轮转)一次|^每经过${NUM}回合`),
    go: () => ({ unparsedReason: "periodic-N-turn trigger — engine has no every-N-turn hook (deferred)" }),
  },
  // "首回合/第一回合 X" → 首回合窗未建模
  { id: "e24-df-02",
    re: /^(?:(?:使|令)(?:自身|自己)?)?(?:首回合|第一回合|第1回合|自身上场首回合)(?!(?:的)?先制)(?:，|,|自身)?/,
    go: () => ({ unparsedReason: "first-turn window — unmodeled (deferred)" }),
  },
  // "附加对手已损失体力N%-M%(的)?(固伤|固定伤害)" → 分数区间固伤未建模
  { id: "e24-df-03",
    re: /已损失体力的?(\d+)%[-~—至到](\d+)%(?:的)?(?:固定伤害|固伤|伤害)$/,
    go: () => ({ unparsedReason: "missing-HP fraction-range flat — unmodeled (deferred)" }),
  },
  // "(双方|敌我)每处于N种能力(提升|强化)…" → flatPerStage who 不支持双侧
  { id: "e24-df-04",
    re: new RegExp(`^(?:双方|敌我双方|双防)每处于`),
    go: () => ({ unparsedReason: "both-sides per-stage scaling — unmodeled (deferred)" }),
  },
  // "对手每次(提升|强化)能力时…" → 对手能力提升事件谓词未建模
  { id: "e24-df-05",
    re: /^对手每次(?:提升|强化|获得)(?:能力|强化)/,
    go: () => ({ unparsedReason: "foe-stage-up event predicate — unmodeled (deferred)" }),
  },
];
