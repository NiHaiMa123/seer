// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e28：魂印长尾第二十二批——印记层数增减/最大体力护盾/已损体力护盾/计数 defer。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 印记层数操作 ─────────────────────────────────────────
  // "(增加|获得|叠加|提升)N层<名>" → apply_mark（"回合结束时增加1层自然祝福"——前窗由触发层挂）
  { id: "e28-mk-01",
    re: new RegExp(`^(?:增加|获得|叠加|提升|累积|积累)${NUM}层([一-龥]{2,10}?)(?:印记|烙印|之印)?$`),
    go: (m) => { const mk = m[2].replace(/(?:效果|状态|印记)$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|能力|属性|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, target: "self", count: num(m[1]) }] }; },
  },
  // "<名>层数-N" / "<名>层数清零" → apply_mark 负层 / consume_mark（"蓄力层数-1"/"蓄力层数清零"）
  { id: "e28-mk-02",
    re: new RegExp(`^([一-龥]{2,10}?)(?:的)?层数-${NUM}$`),
    go: (m) => { if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|能力|属性|\d/.test(m[1])) return undefined; return { effects: [{ op: "consume_mark", mark: m[1], target: "self", count: num(m[2]) }] }; },
  },
  { id: "e28-mk-03",
    re: new RegExp(`^([一-龥]{2,10}?)(?:的)?层数(?:清零|清空|归零|重置为0|变为0)$`),
    go: (m) => { if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|能力|属性|\d/.test(m[1])) return undefined; return { effects: [{ op: "consume_mark", mark: m[1], target: "self" }] }; },
  },

  // ── 护盾分数幅值 ─────────────────────────────────────────
  // "为自身附加(一个)?等同于自身最大体力N/M的护盾" → shield fracMaxHp（落地时 params 烘焙 flat）
  { id: "e28-sh-01",
    re: new RegExp(`^(?:为|给)?(?:自身|自己)?附加(?:一|1)?个?等同于(?:自身|自己)?最大体力${NUM}\\s*/\\s*${NUM}的?(?:护盾|护罩)$|^为自身附加(?:自身|自己)?最大体力${NUM}\\s*/\\s*${NUM}的?(?:护盾|护罩)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { fracMaxHpN: ns[0], fracMaxHpD: ns[1] } }] }; },
  },
  // "为自身附加(一个)?已损失体力N%的护盾"/"额度等同于(当前)?已损失体力的护[盾罩]" → shield/ward fracMissing（e26-sh-01 迁移字段——运行时 fracMissingN/D 烘焙；全额变体=1/1）
  { id: "e28-sh-02",
    re: new RegExp(`^(?:为|给)?自身附加(?:(?:一|1)个)?(?:自身|自己)?已损失体力的?(\\d+)%(?:值)?的?护(盾|罩)$|^(?:为|给)?自身附加(?:(?:一|1)个)?(?:额度)?等同于(?:当前)?已损失体力的?护(盾|罩)(?:[和、]护罩)?$`),
    go: (m) => { const isWard = m[2] === "罩" || m[3] === "罩"; const dual = /护(?:盾|罩)[和、]护罩$/.test(m[0]); return { effects: [...(dual && !isWard ? [{ op: "apply_status", name: "ward", target: "self", params: { fracMissingN: 1, fracMissingD: 1, kindMask: 3 } }] : []), { op: "apply_status", name: isWard ? "ward" : "shield", target: "self", params: { fracMissingN: +(m[1] ?? "1"), fracMissingD: m[1] !== undefined ? 100 : 1, ...(isWard ? { kindMask: 3 } : {}) } }] }; },
  },

  // ── 秘法/结界印记声明 ────────────────────────────────────
  // "随机领悟六大界神的一个秘法：Q" / "创造出一个神秘结界：Q" → apply_mark + 内句
  { id: "e28-mk-04",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:概|几)率)?)?(?:随机)?(?:领悟|掌握|习得|创造出|召唤出|开启)(?:.{0,10}?的)?(?:一个|一|1|个)?([一-龥]{0,10}(?:秘法|结界|屏障|法阵|领域|场地|祝福|诅咒|印记|烙印))[：:]?(.+)?$`),
    go: (m) => { const inner = m[3] !== undefined && m[3] !== "" ? parseEffectText(m[3]) : undefined; return { effects: [{ op: "apply_mark", mark: m[2], target: "self" }, ...(inner?.effects ?? [])], unparsed: inner?.unparsed ?? [] }; },
  },

  // ── 计数/触发 defer ─────────────────────────────────────
  // "对手每有N个技能PP值为零则X" → per-zeroed-slot 计数谓词未建模
  { id: "e28-df-01",
    re: new RegExp(`^(?:对手|对方|敌方|自身|自己)每有${NUM}个?技能PP值?(?:为零|归零|为0|≥|大于等于)`),
    go: () => ({ unparsedReason: "per-PP-count predicate — unmodeled (deferred)" }),
  },
  // r5d：后文写清、但 e28-df-02 接不住的同义句——只有「回合结束时若…」这一个前窗形状：
  //   "回合结束时若(自身)护盾或护罩(任意一个|均)消失则X"（千花「则恢复自身最大体力的1/3」、
  //   裳「则下回合自身攻击技能100%打出致命一击」）。带「回合结束时若」前缀时 e28-df-02 从句首就对不上，
  //   整句落不到任何规则。主体与 e28-df-02 一致（reactWrap(4)——damage.ts 吸收池耗尽处 fireReactive 4，ward/shield 同钩）。
  //   e28-df-02 本体一字不动。
  // 已知但不在本路收的：
  //   - "该护盾消失时X"（雪璞/PLD 两条）：后文清楚，但 attach-damage-96 在 order.mjs 里排在 batch-e28 之前，
  //     先把它留档掉；要接住得改 attach-damage.mjs，超出本路「只改 e28-df-02 或它前面」的范围。
  //   - 后文为空的裸句（「该护盾消失时」「护盾消失时」）：go 返回 undefined，交回 e28-df-02 与 attach-damage-95/96 留档。
  //   - 后文还落不下去的：护盾消失后N回合重新被激活 / …层数重置 / 吸收对手所有2点PP值 / 下N回合自身所有技能附加N点固伤。
  //   - 洛基「…若堕恶神祇层数达到3层且2回合内此护盾或护罩任意一个消失则触发额外效果：令对手下1次攻击技能失效」：
  //     后文清楚，但守卫会被外层「若A且B则C」的切分吞掉（effects-parse.mjs 不动），接住就是发一条无门控的 trigger4。
  { id: "r5d-shield-react",
    re: /^回合结束时若(?:自身|自己)?(?:的)?(?:护盾|护罩)(?:或|和|与)(?:护罩|护盾)?(?:任意(?:一|1)个?|均|全部)?(?:都)?消失(?:时)?则(.+)$/,
    go: (m) => {
      const body = m[1];
      if (body === undefined || body === "") return undefined; // 后文为空交回后文规则/留档
      const r = reactWrap(4, {}, body);
      return r.unparsedReason !== undefined ? undefined : r; // 后文解析不出 → 交回 e28-df-02 留档
    },
  },
  // "(护盾或护罩)?任意一个消失则X" → react trigger4 破盾反应窗（damage.ts 吸收池耗尽处 fireReactive 4，ward/shield 同钩）
  { id: "e28-df-02",
    re: /^(?:自身|自己)?(?:的)?(?:护盾|护罩)(?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失(?:时)?则(.+)$|^(?:护盾|护罩)(?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失|^此?护[盾罩]消失时(.+)$/,
    go: (m) => { const body = m[1] ?? m[2]; return body !== undefined && body !== "" ? reactWrap(4, {}, body) : ({ unparsedReason: "shield-destroyed trigger — unmodeled (deferred)" }); },
  },
  // "自身未使用技能则X" → 未出招谓词未建模
  { id: "e28-df-03",
    re: /^(?:自身|自己)?未使用技能(?:时|则)/,
    go: () => ({ unparsedReason: "not-used-move predicate — unmodeled (deferred)" }),
  },
  // "随机触发N-M(道|层)<名>" → 区间层数未建模（mark countRange 无通道）
  { id: "e28-df-04",
    re: new RegExp(`^随机触发${NUM}[-~—至到]${NUM}(?:道|层|枚|个)`),
    go: () => ({ unparsedReason: "mark countRange — unmodeled (deferred)" }),
  },
  // "放逐…不在场精灵"/"背包精灵" → bench 操作未建模（恢复/回复通道已由 e31-bh 系建模——放行）
  { id: "e28-df-07",
    re: /放逐|(?<!己方所有)(?<!己方)不在场精灵|背包内?精灵/,
    go: () => ({ unparsedReason: "bench/banish — unmodeled (deferred)" }),
  },
  // "每提升1层X则获得以下增益：…" → 层数递增触发未建模（整体留档不拆）
  { id: "e28-df-05",
    re: new RegExp(`^每提升${NUM}?层[^：:]{1,10}则(?:获得)?以下`),
    go: () => ({ unparsedReason: "stack-increment trigger — unmodeled (deferred)" }),
  },
  // "最多N层"/"达到N层时X"/"当X叠加至最高时" → 层数阈值/封顶碎片
  { id: "e28-df-06",
    re: new RegExp(`^(?:最多|最高)(?:累计)?(?:可)?${NUM}层|^达到${NUM}层时|当[^，,]{2,12}叠加至最高时`),
    go: () => ({ unparsedReason: "mark-cap / stack-threshold clause — unmodeled (deferred)" }),
  },
];
