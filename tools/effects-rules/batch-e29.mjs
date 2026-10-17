// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e29：魂印长尾第二十三批——击败触发/禁换/nextFoe 异常/对手未用技 defer。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 击败触发 ─────────────────────────────────────────────
  // "每次击败对手(则)?自身<stat>+N" → foeFainted 门 stage（"每次击败对手自身攻击+2"）
  { id: "e29-ko-01",
    re: new RegExp(`^(?:每次|每)击败(?:对手|对方|敌方)(?:精灵)?(?:则|,|，)?(?:自身|自己)?(${STAT_RE})(?:等级)?\\+${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: num(m[2]), target: "self", if: { foeFainted: true } }] }),
  },
  // "自身每击败(一只|N只)精灵则自身造成的伤害提升N%" → foeFainted 门 dmg_boost（叠乘未建模——单次窗近似）
  { id: "e29-ko-02",
    re: new RegExp(`^(?:自身|自己)每击败(?:一|${NUM})?只?精灵则?(?:自身|自己)?(?:造成的)?(?:攻击)?伤害提升(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[2]) }, if: { foeFainted: true } }] }),
  },
  // "自身每击败(一只|N只)精灵则(自身)?致命(一击)?率提升N%" → foeFainted 门 crit_chance
  { id: "e29-ko-03",
    re: new RegExp(`^(?:自身|自己)每击败(?:一|${NUM})?只?精灵则?(?:自身|自己)?致命(?:一击)?率?(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[2]), d: 100 }, if: { foeFainted: true } }] }),
  },

  // ── 禁换/nextFoe ─────────────────────────────────────────
  // "使对手(其)?不能主动切换(上场|精灵)?(进行战斗)?" → no_switch
  { id: "e29-sw-01",
    re: /^(?:使|令)(?:对手|对方|敌方)(?:其)?不能主动切换(?:上场|精灵|出战)?(?:进行战斗)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_switch", target: "opponent" }] }),
  },
  // "(N%)令对手下只(登场|出战)精灵AIL" → nextFoe ailment（"100%令对手下只登场精灵失神"）
  { id: "e29-nf-01",
    re: new RegExp(`^(\\d+)%?(?:的?(?:概|几)率)?(?:使|令)(?:对手|对方|敌方)下只(?:登场|出战|上场)精灵(${AIL_RE})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "nextFoe", ...(m[1] !== undefined && +m[1] < 100 ? { chance: +m[1] } : {}) }] }),
  },
  // "令对手下只(登场|出战)精灵AIL" 无概率裸形
  { id: "e29-nf-02",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下只(?:登场|出战|上场)精灵(${AIL_RE})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "nextFoe" }] }),
  },

  // "N%(的几率)?(1|一)回合做M~K次攻击" → hits+chance（"50%1回合做1~4次攻击"）
  { id: "e29-ht-01",
    re: new RegExp(`^(\\d+)%(?:的?(?:概|几)率)?(?:${NUM}|一|每)?回合?做${NUM}\\s*[-~—至到]\\s*${NUM}次(?:连续)?攻击$`),
    go: (m) => ({ attachDamage: { hits: { min: num(m[3]), max: num(m[4]), chance: +m[1] } } }),
  },

  // ── deferred 归桶 ───────────────────────────────────────
  // "(对手|对方)未使用(攻击)?技能则X" → 对手未出招谓词未建模
  { id: "e29-df-01",
    re: /^(?:对手|对方|敌方)未使用(?:攻击)?技能(?:时|则)/,
    go: () => ({ unparsedReason: "foe not-used-move predicate — unmodeled (deferred)" }),
  },
  // "N%1回合做N~M次攻击" 全角波浪在归一化已转——此条兜"做N~M次攻击"带概率前缀的复合
  { id: "e29-df-02",
    re: new RegExp(`^附加(?:自身|自己)本场战斗(?:当前)?回合数`),
    go: () => ({ unparsedReason: "per-turn-count flat — unmodeled (deferred)" }),
  },
  // "每回合受到(的)?(攻击)?伤害减少量增加N%" → 减伤叠增未建模
  { id: "e29-df-03",
    re: new RegExp(`^每回合受到(?:的)?(?:攻击)?伤害减少量(?:增加|提升|提高)`),
    go: () => ({ unparsedReason: "accumulating damage-reduction — unmodeled (deferred)" }),
  },
  // "提升伤害效果持续到自身死亡或下场"/"持续到死亡" → 常驻-至死时长未建模
  { id: "e29-df-04",
    re: /持续到(?:自身)?(?:死亡|阵亡|下场)/,
    go: () => ({ unparsedReason: "until-death duration — unmodeled (deferred)" }),
  },
  // "(赛尔对战|非赛尔对战|Boss对战)" → PvE 模式谓词
  { id: "e29-df-05",
    re: /赛尔对战|非赛尔|Boss无效|对Boss|boss/i,
    go: () => ({ unparsedReason: "PvE/Boss-mode predicate — unmodeled (deferred)" }),
  },
];
