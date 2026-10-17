// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e23：魂印长尾第十七批——随机偷取/段数固伤/封印概率/属性先制/每级提升固伤。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 随机偷取/能力操作 ────────────────────────────────────
  // "随机偷取对方N项能力值" → transfer randomCount（"随机偷取对方2项能力值"——delta 缺省按1级）
  { id: "e23-tf-01",
    re: new RegExp(`^随机(?:偷取|吸取|夺取)(?:对方|对手|敌方)${NUM}项(?:能力|能力值|属性)(?:等级)?$`),
    go: (m) => ({ effects: [{ op: "transfer_stages", randomCount: num(m[1]), randomDelta: 1, sign: "up" }] }),
  },
  // "自身攻击使对手随机N项能力-K" → random stage down（攻击前缀由触发层挂；"自身攻击使对手随机3项能力-1"）
  { id: "e23-st-01",
    re: new RegExp(`^(?:自身|自己)?(?:攻击|攻击技能)?(?:使|令)(?:对手|对方|敌方)随机${NUM}项(?:能力|属性)(?:等级)?([+-]\\d+)$`),
    go: (m) => { const d = Math.abs(num(m[2])); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[1]), delta: m[2].startsWith("-") ? -d : d, target: "opponent" }] }; },
  },
  // "随机使对手N项(能力|属性)-K并附加给自己" → transfer（"随机使对手2项能力-1并附加给自己"——词序变体）
  { id: "e23-st-02",
    re: new RegExp(`^随机(?:使|令)(?:对手|对方|敌方)${NUM}项(?:能力|能力值|属性)(?:等级)?([+-]\\d+)并附加给自己(?:身上)?$`),
    go: (m) => { const d = Math.abs(num(m[2])); return { effects: [{ op: "transfer_stages", randomCount: num(m[1]), randomDelta: d, sign: m[2].startsWith("-") ? "down" : "up" }] }; },
  },
  // "(使|令)对手随机N项(能力|属性)-K并附加给自己" 补漏（e18x 同族无"随机使"词序——两条并存）
  { id: "e23-st-03",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机${NUM}项(?:能力|能力值)(?:等级)?([+-]\\d+)并附加给自己(?:身上)?$`),
    go: (m) => { const d = Math.abs(num(m[2])); return { effects: [{ op: "transfer_stages", randomCount: num(m[1]), randomDelta: d, sign: m[2].startsWith("-") ? "down" : "up" }] }; },
  },

  // ── 封印/先制 ────────────────────────────────────────────
  // "(属性|攻击)技能有N%几率失效" → move_null cat+chance（"属性技能有50%几率失效"）
  { id: "e19x-mn-01",
    re: /^(属性|攻击|物理|特殊)技能有(\d+)%(?:的)?(?:概率|几率)?(?:使|令)?(?:对手|对方|敌方)?(?:技能)?失效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1, cat: m[1] === "属性" ? 1 : 4, chance: +m[2] } }] }),
  },
  // "(N%)(属性|攻击)技能无效" 前概率变体（"50%属性技能无效"）
  { id: "e19x-mn-02",
    re: /^(\d+)%(?:的)?(?:概率|几率)?(属性|攻击|物理|特殊)?技能无效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1, ...(m[2] !== undefined ? { cat: m[2] === "属性" ? 1 : 4 } : {}), chance: +m[1] } }] }),
  },
  // "自身(属性|攻击)技能+N" → prio_up cat（"自身属性技能+1"=该类先制+N 简写）
  { id: "e19x-pr-01",
    re: /^(?:自身|自己)(属性|攻击|物理|特殊)技能\+(\d+)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: +m[2], cat: m[1] === "属性" ? 1 : 4 } }] }),
  },

  // ── 阶梯固伤/提升 ────────────────────────────────────────
  // "附加自身所有能力提升等级总段数乘以N的固伤" → flatPerStage levels×N（"总段数乘以35"）
  { id: "e23-fl-01",
    re: new RegExp(`^附加(?:自身|自己)?(?:所有|全部)?能力(?:提升|强化)(?:等级)?总段数乘以${NUM}的?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", per: 1, flat: num(m[1]), mode: "levels" } } }),
  },
  // "自身每处于一种能力(提升|强化)则当回合攻击附加N点固伤" → flatPerStage per:1（"一种能力提升"无量词变体）
  { id: "e23-fl-02",
    re: new RegExp(`^(?:自身|自己)每处于一种?能力(?:提升|强化)(?:状态)?则?(?:当回合|本回合)?(?:攻击|攻击技能)?附加(\\d+)点(?:固定伤害|固伤|伤害)$`),
    go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", per: 1, flat: num(m[1]) } } }),
  },
  // "消除对手回合类效果并附加给对手等同的异常状态或能力下降状态" → cleanse 保留 + 镜像未建模半句记残
  { id: "e23-cx-01",
    re: /^消除(?:对手|对方|敌方)回合类效果并附加给(?:对手|对方|敌方)等同的(?:异常状态|能力下降状态|异常状态或能力下降状态)$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }], unparsed: [{ clause: "附加给对手等同的异常状态或能力下降状态", reason: "debuff-mirror — equal-status copy unmodeled (deferred)" }] }),
  },
];
