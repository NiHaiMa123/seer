// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e30：魂印长尾第二十四批——都有/攻击类 变体/瞬杀/穿透/抵消/分数概率翻倍。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 命中固伤/异常 proc 变体 ──────────────────────────────
  // "每次攻击都有N%几率附加M点(固定伤害|固伤)" → flatOnHit（都有 变体）
  { id: "e30-fh-01",
    re: new RegExp(`^(?:自身|自己)?每次攻击都?有?(\\d+)%(?:的?(?:概|几)?率)?附加(\\d+)点(?:固定伤害|固伤|伤害)$`),
    go: (m) => ({ attachDamage: { flatOnHit: { chance: +m[1], flat: +m[2] } } }),
  },
  // "攻击类技能有N%(的)?(概率|几率)?使对手AIL M回合" → ailment proc + turns（"自身攻击类技能有10%的几率使对手疲惫2回合"）
  { id: "e30-ap-01",
    re: new RegExp(`^(?:自身|自己)?攻击类?(?:技能)?有(\\d+)%(?:的?(?:概|几)率)?使(?:对手|对方|敌方)(${AIL_RE})${NUM}?回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1], ...(num(m[3]) !== undefined ? { turns: num(m[3]) } : {}) }] }),
  },
  // "攻击有N/M的几率威力翻倍" → power_mul chance（分数概率转 pct 整数）
  { id: "e30-pm-01",
    re: new RegExp(`^(?:自身|自己)?攻击(?:技能)?有${NUM}\\s*/\\s*${NUM}的几率威力(?:翻倍|加倍|变为${NUM}倍)$`),
    go: (m) => { const ch = Math.round((100 * num(m[1])) / num(m[2])); const mul = m[3] !== undefined ? num(m[3]) : 2; return { effects: [{ op: "apply_status", name: "power_mul", target: "self", params: { n: mul, d: 1, chance: ch } }] }; },
  },
  // "所有攻击无视对手双防提升" → pierce_stages（双防≈全部强化近似 UNVERIFIED）
  { id: "e30-ps-01",
    re: /^(?:所有|全部)?(?:自身)?攻击(?:技能)?无视(?:对手|对方|敌方)(?:的)?(?:双防|防御和特防|防御特防)(?:能力)?(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }),
  },
  // "N%(概率)?反弹对手的攻击伤害" → reflect_dmg（概率反弹 变体）
  { id: "e30-rf-01",
    re: /^(\d+)%(?:的?(?:概|几)?率)?反弹(?:对手|对方|敌方)的?(?:攻击|攻击伤害|伤害)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: +m[1], d: 100 } }] }),
  },
  // "N%瞬杀(对手)?" → percent KO chance（瞬杀=秒杀 词变体）
  { id: "e30-ko-01",
    re: /^(\d+)%(?:的?(?:概|几)?率)?瞬杀(?:对手|对方|敌方)?$/,
    go: (m) => ({ effects: [{ op: "damage", power: 100, kind: "percent", chance: +m[1] }] }),
  },
  // "当受到的伤害大于自身体力的N/M(时)?，该伤害自动抵消K%" → takenAboveHpFrac 门 + dmg_taken_down
  { id: "e30-td-01",
    re: new RegExp(`^当?受到(?:的)?(?:攻击)?伤害大于自身(?:最大)?体力的?${NUM}\\s*/\\s*${NUM}时?(?:，|,)?(?:该)?伤害自动抵消(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[3]) }, if: { takenAboveHpFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }] }),
  },
  // "该伤害自动抵消N%" 裸形（承接上句语境）→ dmg_taken_down
  { id: "e30-td-02",
    re: /^(?:该)?伤害自动抵消(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "反弹对手的攻击伤害" 裸形（概率已剥离）→ reflect_dmg 全额（UNVERIFIED：未标比例按 100%）
  { id: "e30-rf-02",
    re: /^反弹(?:对手|对方|敌方)的?(?:攻击|攻击伤害|伤害)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }),
  },
  // "必定秒杀"（必定领起形）。放在 e30-ko-02 前面，那条动词前不得带「必定」。
  { id: "e30-ko-02a",
    re: /^必定(?:瞬杀|秒杀)(?:对手|对方|敌方)?$/,
    go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent" }] }),
  },
  // "(直接)?瞬杀(对手)?" 裸形（概率已剥离）→ percent KO
  { id: "e30-ko-02",
    re: /^(?:直接)?(?:瞬杀|秒杀)(?:对手|对方|敌方)?$/,
    go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent" }] }),
  },

  // ── deferred 归桶 ───────────────────────────────────────
  // "<stat>能力值(提升|提高)N%" → 基础数值倍率通道未建模（能力值≠能力等级）
  { id: "e30-df-01",
    re: new RegExp(`^(?:自身|自己)?的?(${STAT_RE}|双防|攻击和速度|双攻)(?:的)?能力值(?:提升|提高|增加|变为)`),
    go: () => ({ unparsedReason: "base-stat multiplier — unmodeled (deferred)" }),
  },
];
