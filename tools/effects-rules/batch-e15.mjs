// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e15：魂印长尾第九批——受击触发变体/进入异常/吸血窗/对手定值伤害/耗尽体力/对手stage_tick/闪避/回合数异常。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, STAT_CODE } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 受击触发 ─────────────────────────────────────────────
  // "受到的攻击伤害则X" → reactWrap trigger1（"受到的攻击伤害则回合结束时令对手全属性-1"）
  { id: "e15-rc-01",
    re: /^(?:自身|自己)?受到的攻击伤害则(.+)$/,
    go: (m) => reactWrap(1, {}, m[1]),
  },

  // ── 异常 ────────────────────────────────────────────────
  // "(N%)?(进入|陷入)AIL" → apply_status（"50%进入害怕"——无主语默认对手侧）
  { id: "e15-al-01",
    re: new RegExp(`^(${AIL_RE})(?:状态)?$|^(${NUM}%)?(?:进入|陷入)(${AIL_RE})(?:状态)?$`),
    go: (m) => m[1] !== undefined && m[2] === undefined ? undefined : { effects: [{ op: "apply_status", name: AILMENTS[m[4]], target: "opponent", ...(m[3] !== undefined ? { chance: num(m[3]) } : {}) }] },
  },
  // "(为|给)(自身|自己)附加N回合(的)?AIL" → apply_status turns:N（"为自身附加10回合的冻伤"）
  { id: "e15-al-02",
    re: new RegExp(`^(?:为|给|令|使)(?:自身|自己|对手|对方|敌方)附加${NUM}回合(?:的)?(${AIL_RE})(?:状态)?$`),
    go: (m) => { const who = /自身|自己/.test(m[0]) ? "self" : "opponent"; return { effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: who, turns: num(m[1]) }] }; },
  },
  // "(使|令)(自身|对手)(的)?AIL回合数+N" → 异常自身时长增减——引擎无 ail-extend op → undefined 保残
  { id: "e15-al-03", re: /^(?:使|令)(?:自身|自己|对手|对方|敌方)?(?:的)?.+(?:回合数\+|状态延长)/, go: () => ({ unparsedReason: "ailment-duration-delta — no ail-turn op (deferred)" }) },

  // ── 吸血窗 ──────────────────────────────────────────────
  // "恢复(自身)?(造成|攻击)伤害量?的?N%的体力(值)?" → drain_atk 窗（"恢复造成伤害50%的体力"）
  { id: "e15-dr-01",
    re: /^(?:恢复|回复)(?:自身|自己)?(?:造成|攻击)(?:的)?伤害(?:量)?(?:的)?(\d+)%(?:的)?体力(?:值)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: +m[1], d: 100 } }] }),
  },
  // "恢复(自身)?(造成|攻击)伤害(量)?的?N/M的?体力" → drain_atk 分数变体
  { id: "e15-dr-02",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:造成|攻击)?(?:的)?伤害(?:量)?${NUM}\\s*/\\s*${NUM}的?体力(?:值)?$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: ns[0], d: ns[1] } }] }; },
  },

  // ── 对手伤害/体力 ────────────────────────────────────────
  // "(附加|给予)给对手N点(真实|固定|百分比)伤害" → damage foe（"附加给对手30点真实伤害"）
  { id: "e15-fd-01",
    re: new RegExp(`^(?:附加|给予)给(?:对手|对方|敌方)${NUM}点?(?:的)?(真实|固定|百分比)(?:伤害|固伤)$`),
    go: (m) => { const k = m[2]; return { effects: [{ op: "damage", kind: k === "真实" ? "true" : k === "百分比" ? "percent" : "fixed", power: num(m[1]), target: "opponent" }] }; },
  },
  // "消耗对手全部体力" → damage percent 1/1 foe（耗尽）
  { id: "e15-fd-02",
    re: /^消耗(?:对手|对方|敌方)(?:的)?全部体力$/,
    go: () => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(1, 1), target: "opponent" }] }),
  },

  // ── 对手 stage tick ──────────────────────────────────────
  // "(回合结束时|每回合)?(令|使)对手STAT-N" → stage_tick foe（引擎在 holder 侧 tick——挂对手窗=对手每回合衰减）
  { id: "e15-st-01",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)(${STAT_RE})(-${NUM})$`),
    go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "opponent", params: { stat: STAT_CODE[STATS[m[1]]], delta: -num(m[2]) } })] }),
  },
  // "(回合结束时|每回合)?(令|使)对手全属性-N" → stage_tick foe×5
  { id: "e15-st-02",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)全属性-${NUM}$`),
    go: (m) => ({ effects: ["atk", "def", "spa", "sdf", "spd"].map((s) => liftTick({ op: "apply_status", name: "stage_tick", target: "opponent", params: { stat: STAT_CODE[s], delta: -num(m[1]) } })) }),
  },

  // ── 闪避 ────────────────────────────────────────────────
  // "闪避概率(提升|提高)(至|到|为)?N%" → dodge/must_miss（100%→必闪）
  { id: "e15-dg-01",
    re: /^闪避概率(?:提升|提高|增加)(?:至|到|为)?(\d+)%$/,
    go: (m) => +m[1] >= 100 ? { effects: [{ op: "apply_status", name: "must_miss", target: "self" }] } : { effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: +m[1] } }] },
  },

  // ── 登场精灵（nextAlly 变体） ─────────────────────────────
  // "(令|使)(己方)?登场精灵X" → nextAlly 重定向（"令登场精灵随机1个技能PP值归零"）
  { id: "e15-na-01",
    re: /^(?:令|使)(?:己方|我方)?(?:登场|出战|上场)精灵(.+)$/,
    go: (m) => { const r = parseEffectText(m[1]); if (r.effects.length === 0) return { unparsedReason: `nextAlly body unparsed: ${m[1]}` }; for (const e of r.effects) e.target = "nextAlly"; return r; },
  },
];
