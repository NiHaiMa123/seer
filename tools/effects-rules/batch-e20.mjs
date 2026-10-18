// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e20：魂印长尾第十四批——残留体力/裸吸取/上限削减/触发前缀变体。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 残留体力（endure 双向）─────────────────────────────
  // "(自身|对手|对方精灵)残留N点(体力|血)" → endure（"自身残留1点体力"/"死亡时对方精灵残留1点血"）
  { id: "p2-ed-03",
    re: /^(?:自身|自己)?(?:若)?(?:受到|遭受|承受)致命(?:伤害|攻击|一击)(?:时|后)?(?:则)?(?:必定)?(?:残留|保留|剩余|余下)(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))点?(?:体力|HP|血)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1]) } }] }),
  },
  { id: "e20-ed-01",
    re: new RegExp(`^(自身|自己|对手|对方|敌方|对方精灵|对手精灵)(?:会|将|则)?残留${NUM}点(?:体力|HP|血)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: /对手|对方|敌方/.test(m[1]) ? "opponent" : "self", params: { hp: num(m[2]) } }] }),
  },
  // "(使|令)对手残留N点体力" → endure opponent
  { id: "e20-ed-02",
    re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)(?:精灵)?残留${NUM}点(?:体力|HP|血)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "opponent", params: { hp: num(m[1]) } }] }),
  },

  // ── 吸取变体 ────────────────────────────────────────────
  // "吸取对手体力" 裸形不猜系数（无分母 drain 量——测试钉住记 no-rule）
  { id: "e20-dr-01",
    re: /^(?:吸取|吸收)(?:对手|对方|敌方)(?:的)?(?:体力|HP)$/,
    go: () => undefined,
  },
  // "(自身所有技能|所有技能)吸取对手N点体力" → 全体招式 drain flat——技能库级 drain 无法逐招挂 → 保残
  { id: "e20-dr-02",
    re: new RegExp(`^(?:自身|自己)?(?:所有|全部|每种)?技能?吸取(?:对手|对方|敌方)${NUM}点(?:体力|HP)$`),
    go: () => ({ unparsedReason: "moveset-wide drain — per-move rider cannot attach from soulmark body (deferred)" }),
  },
  // "吸取对手最大体力N/M的体力" → 尾"的体力"冗余变体（clone e6-121 输出形）
  { id: "e20-dr-03",
    re: new RegExp(`^吸取(?:对手|对方|敌方)(?:最大体力|最大HP)(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:体力|HP)?$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), num(m[2])), target: "opponent" }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), missing: true, target: "self" }] }),
  },
  // "吸取对手最大体力" 无分数裸形 → 全额 drain_dot 近似？无量 → 保残（不可猜系数）
  { id: "e20-dr-04",
    re: /^吸取(?:对手|对方|敌方)最大(?:体力|HP)$/,
    go: () => ({ unparsedReason: "drain quantum unspecified — no coefficient in source (deferred)" }),
  },
  // "自身下N次攻击技能吸取对手最大体力N/M" → 次数域 drain 未建模（drain_dot=回合末 tick，非次数窗）→ 保残
  { id: "e20-dr-05",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次(?:攻击)?技能?吸取(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: () => ({ unparsedReason: "next-use drain scope — count-scoped drain unmodeled (deferred)" }),
  },

  // ── 上限削减/体力上限 ────────────────────────────────────
  // "减少(对手)?最大体力N/M" 裸形 → max_hp_down 对手（"减少最大体力1/3"——上限削减恒为对手侧；hpCapOf 支持 n/d）
  // ── 体力上限变更 → stat_boost{stats:["hp"]}（引擎早已支持：base.hp 加 delta 并同步 currentHp）──
  // 固定值："增加200点体力上限" / "自身增加100点体力上限" / "减少对手120点体力上限"
  { id: "e20-hpmax-flat",
    re: new RegExp("^(?:(\\u81ea\\u8eab|\\u81ea\\u5df1)\\u589e\\u52a0|\\u589e\\u52a0)(" + NUM + ")\\u70b9(?:\\u4f53\\u529b\\u4e0a\\u9650|\\u6700\\u5927\\u4f53\\u529b)$|^\\u51cf\\u5c11(\\u5bf9\\u624b|\\u5bf9\\u65b9|\\u654c\\u65b9)(" + NUM + ")\\u70b9(?:\\u4f53\\u529b\\u4e0a\\u9650|\\u6700\\u5927\\u4f53\\u529b)$"),
    go: (m) => { const opp = m[4] !== undefined; const n = num(m[2] ?? m[5]); return opp ? { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n, d: 1 } }] } : { effects: [{ op: "stat_boost", stats: ["hp"], add: n, target: "self" }] }; } },
  // 百分比："自身体力上限提升20%" / "令对手的体力上限减少35%"
  { id: "e20-hpmax-pct",
    re: new RegExp("^(?:(\\u81ea\\u8eab|\\u81ea\\u5df1)(?:\\u4f53\\u529b\\u4e0a\\u9650|\\u6700\\u5927\\u4f53\\u529b)(\\u63d0\\u5347|\\u589e\\u52a0)|\\u4ee4(\\u5bf9\\u624b|\\u5bf9\\u65b9|\\u654c\\u65b9)\\u7684?(?:\\u4f53\\u529b\\u4e0a\\u9650|\\u6700\\u5927\\u4f53\\u529b)(\\u51cf\\u5c11|\\u964d\\u4f4e))(" + NUM + ")%$"),
    go: (m) => { const opp = m[3] !== undefined; const n = num(m[6]); return opp ? { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n, d: 100 } }] } : { effects: [{ op: "stat_boost", stats: ["hp"], pct: n, target: "self" }] }; } },
  { id: "e20-hp-01",
    re: new RegExp(`^减少(?:对手|对方|敌方)?(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },
  // "削减对手N点体力上限"/"削减对手本场战斗中N点体力上限" → max_hp_down flat
  { id: "e20-hp-02",
    re: new RegExp(`^(?:使用技能)?削减(?:对手|对方|敌方)(?:本场战斗中)?${NUM}点体力上限$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: num(m[1]) } }] }),
  },
];
