// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e26：魂印长尾第二十批——闪避窗/秒杀变体/PP翻倍/护盾变体/nextAlly 补遗。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";


export const rules = [

  // ── 闪避/秒杀 ────────────────────────────────────────────
  // "N%(的几率)?闪避(受到)?(的)?(攻击|伤害)" → dodge pct（"50%闪避受到的攻击"）
  { id: "e26-dg-01",
    re: new RegExp(`^(\\d+)%(?:的?(?:概|几)率)?闪避(?:受到)?(?:的)?(?:攻击|攻击伤害|伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: +m[1] } }] }),
  },
  // 裸"闪避受到的攻击"（无概率=必闪当回合窗——"下回合闪避受到的攻击"经 TURNS_PRE 剥出 turns）
  { id: "e26-dg-02",
    re: /^闪避(?:受到|对手|对方|敌方)?的?(?:所有|全部)?攻击(?:伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: 100 } }] }),
  },
  // "攻击技能命中(对手)?时有N%(的)?(概率|几率)秒杀(对手)?" → percent KO chance（"攻击技能命中对手时有15%的概率秒杀对手"）
  { id: "e26-ko-01",
    re: new RegExp(`^(?:攻击|攻击技能)命中(?:对手|对方|敌方)?时(?:，|,)?有(\\d+)%(?:的)?(?:概率|几率)?秒杀(?:对手|对方|敌方)?$`),
    go: (m) => ({ effects: [{ op: "damage", power: 100, kind: "percent", chance: +m[1] }] }),
  },

  // ── PP 倍率补变体 ────────────────────────────────────────
  // "(对手)?(使用技能)?所?消耗(的)?(技能)?PP值为N倍" / "N%的几率消耗2倍技能PP值" → pp_mul（消耗2倍 变体）
  { id: "e26-pm-01",
    re: new RegExp(`^(?:(对手|对方|敌方)(?:使用技能)?)?所?消耗(?:的)?(?:技能)?PP值为?(\\d+|${NUM})倍$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: /对手|对方|敌方/.test(m[1] ?? "") ? "opponent" : "opponent", params: { mul: num(m[2]) } }] }),
  },
  { id: "e26-pm-02",
    re: new RegExp(`^(\\d+)%(?:的)?(?:概率|几率)?(?:使|令)?(?:对手|对方|敌方)?(?:使用技能)?消耗${NUM}倍(?:技能)?PP值$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: "opponent", params: { mul: num(m[2]) }, chance: +m[1] }] }),
  },

  // ── 护盾补变体 ───────────────────────────────────────────
  // missingPct 没人读。改名 flatCap / fracMissing 会开始封顶或按已损体力出盾。空护盾即今天的结算。
  { id: "e26-sh-01",
    re: new RegExp(`^(?:为|给)?自身附加(?:一|1)个?(?:自身|自己)?已损失体力(\\d+)%(?:值)?的?护(盾|罩)$`),
    go: (m) => { const isWard = m[2] === "罩"; return { effects: [{ op: "apply_status", name: isWard ? "ward" : "shield", target: "self", ...(isWard ? { params: { kindMask: 3 } } : {}) }] }; },
  },
  // "附加一个N点的护盾和一个M点的护罩" → shield+ward 分立池
  { id: "e26-sh-02",
    re: new RegExp(`^(?:为|给)?(?:自身|自己)?附加(?:一|1)个?(\\d+)点的?护盾和(?:一|1)个?(\\d+)点的?护罩$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: +m[1] } }, { op: "apply_status", name: "ward", target: "self", params: { flat: +m[2], kindMask: 3 } }] }),
  },
  // "N%的伤害值(在回合结束时)?转化为等量的护盾" → dmg_to_shield pct 近似全额（UNVERIFIED——dmgToShield 无 pct 通道，按全额窗口）
  { id: "e26-sh-03",
    re: /^(\d+)%的?伤害值(?:在回合结束时)?转化为等量的(?:护盾|护罩)$/,
    go: (m) => ({ unparsedReason: `shield-from-damage pct=${m[1]} — dmgToShield has no pct channel (deferred)` }),
  },
  // "吸取自然界的力量：第N回合开始时为自身附加M点护盾" → mark decl + 回合内盾（前缀触发层挂；体句盾值照发）
  { id: "e26-sh-04",
    re: new RegExp(`^第${NUM}回合开始时?为自身附加(\\d+)点(?:护盾|护罩)$`),
    go: (m) => ({ unparsedReason: `turn-indexed trigger (${m[1]}) — absolute turn number unmodeled (deferred)` }),
  },

  // ── nextAlly 补遗 ────────────────────────────────────────
  // "(使|令)下只(出战)?精灵(登场后)?X" → nextAlly 重定向（"使下只出战精灵下2次技能先制+2"——登场/出战 变体补漏）
  { id: "e26-na-01",
    re: new RegExp(`^(?:使|令)(?:己方|我方)?下(?:一|${NUM})?只(?:出战|登场|上场)?精灵(?:登场后|出战时|上场后)?(.+)$`),
    go: (m) => { const r = parseEffectText(m[2]); if (r.effects.length === 0) return { unparsedReason: `nextAlly body unparsed: ${m[2]}` }; for (const e of r.effects) e.target = "nextAlly"; return { effects: r.effects, unparsed: r.unparsed }; },
  },

  // "下只精灵登场后X" 裸形（无使/令） → nextAlly（"下只精灵登场后随机2个技能PP归零"）
  { id: "e26-na-02",
    re: new RegExp(`^下(?:一|${NUM})?只(?:出战|登场|上场)?精灵(?:登场后|出战时|上场后)(.+)$`),
    go: (m) => { const r = parseEffectText(m[2]); if (r.effects.length === 0) return { unparsedReason: `nextAlly body unparsed: ${m[2]}` }; for (const e of r.effects) e.target = "nextAlly"; return { effects: r.effects, unparsed: r.unparsed }; },
  },
  // "<名>(的力量|之力)：Q" → 具名印记声明（"吸取自然界的力量：第1回合…"——体句照常内解析）
  { id: "e26-mk-02",
    re: /^([一-龥]{2,14}?(?:的力量|之力|之印))[：:](.+)$/,
    go: (m) => { const inner = parseEffectText(m[2]); return { effects: [{ op: "apply_mark", mark: m[1], target: "self" }, ...(inner.effects ?? [])], unparsed: inner.unparsed ?? [] }; },
  },

  // ── deferred 归桶 ───────────────────────────────────────
  // "护盾值(恢复|转化为|提升)" 分数/恢复护盾值通道未建模
  { id: "e26-df-01",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:当前)?护盾值${NUM}%的?体力|^(?:将)?护盾值(?:提升|提高|增加)(?:至|到)?${NUM}%|^(?:自身|自己)?属性技能命中后?附加(?:自身|自己)?(?:当前)?护盾值${NUM}%的?固定伤害$`),
    go: () => ({ unparsedReason: "shield-value heal/scale/flat — unmodeled (deferred)" }),
  },
  // "下只精灵登场后随机N个技能PP归零" → nextAlly pp 通道（nextAlly 内 pp_delta target 已覆写——本句体可解析则走 e26-na-01；此条仅兜 zeroRandom 直写形态）
  // r3b：`re` 不动，只把 `go` 放开 r2c-need-op.md 候选 A 点名的 7 句……实际上技能侧含「背包」的一共 7 条、
  // 6 种字面，全是「自身背包内每(存活|阵亡)N只精灵则X%的(概率|几率)强化效果翻倍」；放行匹配就写成这 6 种。
  // 结算侧由 `apply_stat_stage.deltaMulChance.perBench` 提供（读法在 `ops/stat-stage.ts` 的 `benchMulChanceOf`），
  // 形状与裸句 `timed-45` 同构——宿主整句里只有原来那条「强化效果翻倍」子句的留档消失，其它 effect 一字不动。
  // 收窄必须写在这里（`re` 不动）：`re` 收窄会把 `背包内每少携带`/`背包内每存在`/`背包内每有一` 等
  // 形态直接放到 no-rule。详见 tools/effects-rules/batch-w08.mjs 文件头。
  { id: "e26-df-02",
    re: /^背包|背包内|己方背包/,
    // 整句取自 m.input（本 re 只匹到「背包内」三字，m[0] 不是整句）
    go: (m) => (/^(?:自身|自己|己方|我方)?背包内每(?:存活|阵亡)\d*只精灵则\d+%(?:的?(?:概率|几率))?强化效果翻倍$/.test(m.input ?? m[0])
      ? null // 放行给 batch-w08.mjs 的 w08-bench-stage-01（本句的结算已落地）
      : { unparsedReason: "bench/party scope — unmodeled (deferred)" }),
  },
  // "(对手|敌方)背包内每有一只阵亡精灵" → bench 计数谓词
  { id: "e26-df-03",
    re: /^(?:对手|对方|敌方|自身|己方)?背包内?每有/,
    go: () => ({ unparsedReason: "bench-count predicate — unmodeled (deferred)" }),
  },
  // "所有技能命中率(随机)?降低N%(-M%)?" → acc 泛化通道未建模
  { id: "e26-df-04",
    re: new RegExp(`^(?:所有|全部)?技能命中率(?:随机)?(?:降低|下降|减少|提升)${NUM}%`),
    go: () => ({ unparsedReason: "accuracy-rate adjust — acc channel unmodeled (deferred)" }),
  },
  // "(附加的|获得的)护盾低于N则X" → 护盾值阈值谓词
  { id: "e26-df-05",
    re: new RegExp(`^(?:附加|获得|展开)的?护盾(?:值)?低于${NUM}`),
    go: () => ({ unparsedReason: "shield-value threshold predicate — unmodeled (deferred)" }),
  },
];
