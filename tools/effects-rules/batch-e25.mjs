// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e25：魂印长尾第十九批——全体技异常 proc/布置印记/异常回合数变体/defer 补桶。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 全体技/命中后异常 proc ───────────────────────────────
  // "(自身)?(所有|全部|任意)(攻击|技能|攻击技能)?N%(几率)?令对手AIL" → ailment chance（"自身所有攻击技能70%令对手麻痹"）
  { id: "e25-ail-01",
    re: new RegExp(`^(?:自身|自己)?(?:所有|全部|任意)(?:攻击|攻击技能|技能|技能命中后)?(?:，|,)?(\\d+)%(?:的?(?:概|几)率)?(?:使|令)(?:对手|对方|敌方)(${AIL_RE})${"$"}`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "所有技能命中后N%令对手AIL" → 同上（命中后词序）
  { id: "p2-hit-11",
    re: /^(?:若)?命中(?:后)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%(?:的)?(?:概率|几率)?(?:令|使)(?:对手|对方|敌方)(烧伤|冻伤|中毒|麻痹|害怕|睡眠|失明|失神|束缚|混乱|寄生|诅咒|疲惫|流血|沉默|冰封|易燃|焚烬|石化|瘫痪|感染|狂暴|衰弱|臣服|冷冻)(?:状态)?$/,
    go: (m) => { const il = AILMENTS[m[2]]; if (il === undefined) return null; return { effects: [{ op: "apply_status", name: il, target: "opponent", chance: num(m[1]) }] }; },
  },
  { id: "e25-ail-02",
    re: new RegExp(`^(?:自身|自己)?(?:所有|全部)?技能命中后(\\d+)%(?:的?(?:概|几)率)?(?:使|令)(?:对手|对方|敌方)(${AIL_RE})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "(使用|释放)攻击(技能)?时(有)?N%几率令对手AIL" → 攻击 proc（"自身使用攻击时有50%几率令对手焚烬"）
  { id: "e25-ail-03",
    re: new RegExp(`^(?:自身|自己)?(?:使用|释放|使出)攻击(?:技能)?时(?:，|,)?(?:有)?(\\d+)%(?:的?(?:概|几)率)?(?:使|令)(?:对手|对方|敌方)(${AIL_RE})$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },

  // ── 布置/生成印记 ────────────────────────────────────────
  // "(给对手周围)?布置N层<名>(：Q)?" → apply_mark（"给对手周围布置1层密集火网：…"——层数即印记强度）
  { id: "e25-mk-01",
    re: new RegExp(`^(?:给(?:对手|对方|敌方|自身|自己)(?:周围)?)?(?:布置|铺设|张设)${NUM}层([^：:，,、；;]{2,10}?)(?:印记|烙印|之印)?[：:](.+)?$|^给(?:对手|对方|敌方)(?:周围)?(?:布置|铺设|张设)${NUM}层([^：:，,、；;]{2,10})$`),
    go: (m) => { const mark = (m[2] ?? m[5]).replace(/(?:效果|状态|印记)$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mark)) return undefined; const inner = m[3] !== undefined && m[3] !== "" ? parseEffectText(m[3]) : undefined; const effs = [{ op: "apply_mark", mark, target: /对手|对方|敌方/.test(m[0].slice(0, 6)) ? "opponent" : "self", count: num(m[1] ?? m[4]) }, ...(inner?.effects ?? [])]; return { effects: effs, unparsed: inner?.unparsed ?? [] }; },
  },

  // "对手每处于1种异常状态则攻击命中后附加N点(固定伤害|固伤)" → flatPerAilment（"则攻击命中后"中隔变体）
  { id: "p2-fail-01",
    re: /^(?:对手|对方|敌方)每(?:存在|处于|有)(?:1|一|([0-9]+|一|二|两|三|四|五|六|七|八|九|十))(?:种|项|个)?异常状态(?:时)?(?:则|,|，)?附加(\d+)点(?:固定伤害|固伤|伤害)$/,
    go: (m) => ({ attachDamage: { flatPerAilment: num(m[2]) } }),
  },
  { id: "e25-fa-01",
    re: new RegExp(`^(?:对手|对方|敌方)每处于(?:1|一|${NUM})(?:种|项|个)?异常状态(?:时)?(?:则|,|，)?(?:(?:攻击|攻击技能)命中后?)?(?:攻击|攻击技能)?附加(\\d+)点(?:固定伤害|固伤|伤害)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerAilment: ns[ns.length - 1] } }; },
  },

  // ── 随机异常列表补变体 ───────────────────────────────────
  // "随机进入A和B(其中|中)N?种异常(状态)?" → AIL list random pick（"令对手随机进入焚烬和冰封其中1种异常状态"）
  { id: "e25-ra-01",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机进入(${AIL_RE})(?:和|、|或)(${AIL_RE})(?:其中)?${NUM}?种异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: [AILMENTS[m[1]], AILMENTS[m[2]]], count: 1 } }] }),
  },
  // "(N%)?(使|令)对手随机进入A、B…(中)?(的)?N?种异常状态" —— 百分概率 + 列表已在既有规则；此条补"和"字分隔三列
  { id: "e25-ra-02",
    re: new RegExp(`^(\\d+)%?(?:的?(?:概|几)率)?(?:使|令)(?:对手|对方|敌方)随机进入(${AIL_RE})(?:和|、|或)(${AIL_RE})(?:其中)?${NUM}?种异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", chance: +m[1], random: { list: [AILMENTS[m[2]], AILMENTS[m[3]]], count: 1 } }] }),
  },

  // ── 封印概率补遗 ─────────────────────────────────────────
  // "(对手|对方)的?(属性|攻击)技能有N%(概率|几率)无效" → move_null cat+chance（"对手的属性技能有50%概率无效"——的/概率 变体）
  { id: "e25-mn-01",
    re: /^(?:对手|对方|敌方)的?(属性|攻击|物理|特殊)技能有(\d+)%(?:的)?(?:概率|几率)?无效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1, cat: m[1] === "属性" ? 1 : 4, chance: +m[2] } }] }),
  },

  // ── deferred 归桶 ───────────────────────────────────────
  // "(AIL|进入AIL)几率提升N%"/"AIL触发几率为N%" → 异常施加率增减通道未建模
  { id: "e25-df-01",
    re: new RegExp(`^(?:进入)?(${AIL_RE})(?:状态)?(?:的)?(?:触发)?几率(?:提升|提高|增加|为)${NUM}%?$`),
    go: () => ({ unparsedReason: "ailment proc-chance adjust — unmodeled (deferred)" }),
  },
  // "使对手所有异常状态回合数变为N回合" → 异常时长重写未建模
  { id: "e25-df-02",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:所有|全部)?异常状态回合数变为${NUM}回合$`),
    go: () => ({ unparsedReason: "ailment duration rewrite — unmodeled (deferred)" }),
  },
  // "对手所有回合类效果的回合数变为1回合" → 回合类时长重写未建模
  { id: "e25-df-03",
    re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)(?:所有|全部)?回合类效果的回合数变为${NUM}回合$`),
    go: () => ({ unparsedReason: "timed-effect duration rewrite — unmodeled (deferred)" }),
  },
  // "触发N(-M)?种(以上)?异常时" → 施加计数谓词未建模
  { id: "e25-df-04",
    re: new RegExp(`^触发${NUM}(?:[-~—至到]${NUM})?种(?:以上)?异常(?:状态)?时`),
    go: () => ({ unparsedReason: "applied-count predicate — unmodeled (deferred)" }),
  },
];
