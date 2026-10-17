// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e27：魂印长尾第二十一批——先手免疫/清除变体/体力互换/消除+固伤组合/defer 补桶。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 免疫/抵挡 ────────────────────────────────────────────
  // "免疫对手的先手攻击伤害" → dmg_immune order:last（对手先手=我方后手）
  { id: "e27-im-01",
    re: /^免疫(?:对手|对方|敌方)的?先手(?:攻击|攻击伤害|伤害)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", if: { order: "last" } }] }),
  },
  // "N%免疫当回(合)?受到的伤害" → dmg_immune chance（"当回"丢字变体在归一化补齐）
  { id: "e27-im-02",
    re: new RegExp(`^(\\d+)%(?:的?(?:概|几)率)?免疫(?:当|本)?回合?受到(?:的)?(?:攻击|攻击伤害|伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: +m[1] }] }),
  },

  // ── 清除/互换/组合消除 ───────────────────────────────────
  // "清除(对手)?强化状态" → clear_stages up（清除=消除 词变体）
  { id: "e27-cs-01",
    re: /^清除(?:对手|对方|敌方)?(?:的)?(?:能力)?(?:强化|提升)(?:状态)?$/,
    go: (m) => ({ effects: [{ op: "clear_stages", target: /对手|对方|敌方/.test(m[0]) ? "opponent" : "opponent", sign: "up" }] }),
  },
  // "与对手互换(当前)?(双方的)?体力" → swap_hp
  { id: "e27-sw-01",
    re: /^(?:与|和)(?:对手|对方|敌方)互换(?:当前)?(?:双方|彼此)?的?(?:体力|HP|生命值)$/,
    go: () => ({ effects: [{ op: "swap_hp", target: "opponent" }] }),
  },
  // "消除对手回合类效果并附加(给对手)?N点(固定伤害|固伤)" → cleanse + fixed
  { id: "e27-cc-01",
    re: new RegExp(`^消除(?:对手|对方|敌方)回合类效果并附加(?:给(?:对手|对方|敌方))?(\\d+)点(?:固定伤害|固伤|伤害)$`),
    go: (m) => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }, { op: "damage", kind: "fixed", power: +m[1], target: "opponent" }] }),
  },
  // "自身技能命中前若处于全属性提升状态则消除对手能力提升状态" → selfStageUp 门 + cleanse（"命中前"由触发层挂）
  { id: "e27-cc-02",
    re: /^(?:自身|自己)?(?:技能|攻击)?命中前若(?:自身|自己)?处于全属性(?:提升|强化)状态则消除(?:对手|对方|敌方)能力(?:提升|强化)状态$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up", if: { selfStageUp: true } }] }),
  },

  // ── 具名清单免疫 / 单维反转 ───────────────────────────────
  // "免疫受到的AIL、AIL" → 两条 immune_status 各带自己的 ailment（AIL_RE 无捕获组，显式补两组）
  { id: "e27-df-01",
    re: new RegExp(`^(?:自身|自己)?免疫(?:自身|自己)?受到的(${AIL_RE})(?:、|和|或)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [AILMENTS[m[1]], AILMENTS[m[2]]].map((a) => ({ op: "apply_status", name: "immune_status", ailment: a, target: "self" })) }),
  },
  // "反转对手<stat>能力提升状态" → invert_stages 带 stat（只翻这一维，sign 仍是 up）
  // 只认提升/强化；无能力名的全维句仍由 batch-e6-181 接。
  { id: "e27-df-02",
    re: new RegExp(`^反转(?:对手|对方|敌方)(?:的)?(${STAT_RE})(?:能力)?(?:提升|强化)(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent", stat: STATS[m[1]] }] }),
  },
  // "吸取对手能力提升等级总段数xN点体力" → per-stage drain 未建模
  { id: "e27-df-03",
    re: new RegExp(`^吸取(?:对手|对方|敌方)能力(?:提升|强化)等级?总段数`),
    go: () => ({ unparsedReason: "per-stage drain — unmodeled (deferred)" }),
  },
  // "每消除成功1项则附加N点" → 消除计数固伤未建模
  { id: "e27-df-04",
    re: new RegExp(`^每消除成功${NUM}?项`),
    go: () => ({ unparsedReason: "per-cleanse-count flat — unmodeled (deferred)" }),
  },
  // "(技能)威力高于N则X" → 威力谓词未建模
  { id: "e27-df-05",
    re: new RegExp(`^(?:技能)?威力(?:高于|大于|超过|不低于|不少于)${NUM}`),
    go: () => ({ unparsedReason: "power-threshold predicate — unmodeled (deferred)" }),
  },
];
