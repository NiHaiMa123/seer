// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e19：魂印长尾第十三批——类别必中/威力翻倍/随机吸取/护盾量词/减伤变体/概率封印/成长变体。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 命中/威力 ────────────────────────────────────────────
  // "(特殊|物理|攻击|属性)攻击必中"/"自身X技能必定命中" → sure_hit cat
  // 另收「特攻/物攻」写法：「自身特攻必定命中」= 特攻（特殊招式）必定命中 → cat 3；
  // 「物攻」= 物理招式 → cat 2。cat 编码与 ops/shared.ts 的招式类别一致（1 属性/2 物理/3 特殊）。
  { id: "e19-mh-01",
    re: /^(?:自身|自己)?(?:所有|全部)?(特殊|特攻|物理|物攻|属性|攻击)(?:攻击|技能)?(?:必定命中|必中)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "sure_hit", target: "self", params: { cat: m[1] === "属性" ? 1 : m[1] === "物理" || m[1] === "物攻" ? 2 : m[1] === "特殊" || m[1] === "特攻" ? 3 : 4 } }] }),
  },
  // "所有攻击技能翻倍" → attachDamage powerMul ×2（"翻倍"=伤害翻倍，沿用 attach-damage-07 域）
  { id: "e19-pw-01",
    re: /^(?:自身|自己)?所有(?:攻击|物理|特殊)?技能?(?:威力|伤害)?翻倍$/,
    go: () => ({ attachDamage: { powerMul: frac(2, 1) } }),
  },
  // "(使|令)自身技能威力提升N%" → attachDamage mul（"使自身技能威力提升20%"——attach-damage-16 的"使自身"变体）
  { id: "e19-pw-02",
    re: new RegExp(`^(?:使|令)自身(?:的|所有|全部)?(?:攻击|属性)?技能?威力(?:提升|提高|增加)${NUM}%$`),
    go: (m) => ({ attachDamage: { mul: frac(100 + num(m[1]), 100) } }),
  },
  // "随机附加N~M点威力" → powerAdd range（区间威力增量——powerAdd 数值域不支持区间 → 保残）
  { id: "e19-pw-03",
    re: new RegExp(`^随机附加${NUM}(?:~|～|-)${NUM}点(?:威力|伤害)$`),
    go: () => ({ unparsedReason: "power-range — random power increment unmodeled (deferred)" }),
  },

  // ── 吸取/护盾量词 ────────────────────────────────────────
  // "(使|令)对手随机N项属性-K并附加给自己" → transfer randomCount（"使对手随机2项属性-1并附加给自己"）
  { id: "e18x-st-01",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机${NUM}(?:项|种)(?:属性|能力值?|能力)(?:等级)?[-+](\\d+)并(?:将该属性)?附加(?:到|给)(?:自己|自身)(?:身上)?$`),
    go: (m) => { const down = m[0].includes("-"); return { effects: [{ op: "transfer_stages", randomCount: num(m[1]), randomDelta: num(m[2]), sign: down ? "down" : "up" }] }; },
  },
  // "增加N点吸收量"/"增加N/M的吸收量" → shield flat（"吸收量"=护盾值别名）
  { id: "e19-sh-01",
    re: new RegExp(`^(?:增加|额外增加|提升)${NUM}点(?:的)?吸收量$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1]) } }] }),
  },
  // "增加N/M的吸收量" 分数吸收量递增——drain 步进无宿主 op（正常路径由魂印 growTail 通道接管；standalone 保残，不产伪护盾）
  { id: "e19-sh-02",
    re: new RegExp(`^增加${NUM}\\s*/\\s*${NUM}的?吸收量$`),
    go: () => ({ unparsedReason: "drain-ramp — growing absorption needs entry growStep (handled at clause level when tail-anchored)" }),
  },
  // "护罩并附加等量的固定伤害" → shield + lastDmgFrac（受击护罩断片——护罩值无来源量 → 保残）
  { id: "e19-sh-03",
    re: /^(?:获得)?护罩并附加等量的(?:固定伤害|固伤)$/,
    go: () => ({ unparsedReason: "shield-amount source — shield magnitude unspecified (deferred)" }),
  },

  // ── 减伤/封印变体 ────────────────────────────────────────
  // "减伤变为N%"/"减伤N%" → dmg_taken_down（"减伤变为50%"）
  { id: "e19-dt-01",
    re: /^减伤(?:变为|为|提升至|提升)?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "百分比减少N%" → pctTakenPct（百分比伤害减免——"百分比减少25%"）
  { id: "e19-dt-02",
    re: /^百分比(?:伤害)?减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "pct_taken_pct", target: "self", params: { pct: +m[1] } }] }),
  },
  // "(使|令)当次附加自身STAT值N%的固伤" → flatSelfStatPct 当次变体
  { id: "e19-st-01",
    re: new RegExp(`^(?:使|令)当次(?:攻击)?附加自身(${STAT_RE})值?(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => { const s = STATS[m[1]]; if (s === undefined || s === "acc") return undefined; return { attachDamage: { flatSelfStatPct: { stat: s, pct: num(m[2]) } } }; },
  },
  // "(N%)几率无效"/"有N%几率(使对手技能)无效" → move_null chance（"50%几率无效"）
  { id: "e19-mn-01",
    re: /^(\d+)%的?几率(?:使|令)(?:对手|对方|敌方)?(?:的)?(?:技能|攻击|招式)?无效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1, chance: +m[1] } }] }),
  },
  { id: "e19-mn-02",
    re: /^(\d+)%几率无效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1, chance: +m[1] } }] }),
  },
  // "共计有N%的几率使对手AIL" → "共计有"概率前缀变体 → 概率+异常
  { id: "e19-al-01",
    re: new RegExp(`^共计有?(\\d+)%的?(?:概率|几率)(?:使|令)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },

  // ── 成长/结算 ────────────────────────────────────────────
  // "每战斗一回合增加N%" → 每回合成长（"每战斗一回合增加5%"——chance 成长宿主由 soulmark 回挂；无宿主时记 grow）
  { id: "e19-gr-01",
    re: /^每战斗一回合(?:概率|几率)?(?:增加|提升|提高)(\d+)%$/,
    go: () => ({ unparsedReason: "grow tail without growing host" }),
  },
  // "使用攻击技能回合结束时X" → 触发粘连——内联体（"使用攻击技能回合结束时速度+1并附加速度值50%的固伤"）
  { id: "e19-tk-01",
    re: /^使用(?:攻击|属性)?技能回合结束(?:时|后)(.+)$/,
    go: (m) => { const r = parseEffectText(`回合结束时${m[1]}`); if (r.effects.length === 0 && !r.flags?.attachDamage) return undefined; return { ...r }; },
  },
  // "(当回合)?使用攻击技能后自身全属性+N" → ALL_STATS 展开 + 攻击使用守卫（"当回合使用攻击技能后自身全属性+1"）
  { id: "e19-ag-01",
    re: new RegExp(`^(?:当回合|本回合)?使用(?:攻击|属性)?技能后(?:自身|自己)?全?属性([+-]${NUM})$|^使用(?:攻击|属性)?技能后(?:自身|自己)?全?属性([+-]${NUM})$`),
    go: (m) => { const d = num((m[1] ?? m[2]).replace("+", "")); const up = (m[1] ?? m[2]).startsWith("+"); return { effects: ALL_STATS.map((stat) => ({ op: "apply_stat_stage", stat, delta: up ? d : -d, target: "self" })) }; },
  },
];
