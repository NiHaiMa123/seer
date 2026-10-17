// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e21：魂印长尾第十五批——次数窗增伤/差值固伤/反伤分数/转化体力/上回合伤害。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 次数窗增伤 ──────────────────────────────────────────
  // "(使|令)自身下N次攻击造成的伤害提升M%" → dmg_boost count（"使自身下3次攻击造成的伤害提升150%"）
  { id: "e21-db-01",
    re: new RegExp(`^(?:使|令|让)自身下?${NUM}次(?:攻击|攻击技能)?(?:造成)?的?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[2], count: num(m[1]) } }] }),
  },
  // "(自身)?下N次攻击(造成的)?伤害提升M%" 无使令变体
  { id: "e21-db-02",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次攻击(?:技能)?(?:造成)?的?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[2], count: num(m[1]) } }] }),
  },
  // "(N%)使自身(攻击技能)?造成的攻击伤害提升M%" → dmg_boost chance（"50%使自身攻击技能造成的攻击伤害提升50%"）
  { id: "e21-db-03",
    re: new RegExp(`^(\\d+)%(?:使|令)(?:自身|自己)(?:攻击技能|攻击)?造成的?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", chance: +m[1], params: { pct: +m[2] } }] }),
  },
  // "自身造成伤害增加N%"/"使自身本次战斗中造成的伤害提高N%"/"使自身攻击技能造成的攻击伤害提升N%" → dmg_boost（"增加/提高"动词+战域/攻击技能中缀变体）
  { id: "e21-db-04",
    re: /^(?:使|令)?(?:自身|自己)(?:本次战斗中|本场战斗中|本局中)?(?:攻击技能|攻击|技能)?造成?的?(?:攻击)?伤害(?:增加|提高|提升)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },

  // ── 转化/反弹 ────────────────────────────────────────────
  // "自身受到伤害转化为体力" → dmg_to_heal（无次数——常时转化窗）
  { id: "e21-cv-01",
    re: /^(?:自身|自己)?受到(?:的)?(?:攻击)?伤害转化为(?:自身|自己)?(?:的)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }),
  },
  // "以百分比伤害形式反弹受到伤害的N/M" → reflect_dmg（"以百分比伤害形式反弹受到伤害的1/2"——分数反伤窗）
  { id: "e21-cv-02",
    re: new RegExp(`^以(?:百分比|固定)?伤害(?:的)?形式反弹(?:自身|自己)?受到(?:的)?伤害(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: num(m[2]), count: 1 } }] }),
  },
  // "仅触发AIL时X" → prevApplied+foeHas 守卫联体（"仅触发焚烬时使自身免疫下1次受到的攻击伤害"——"仅"=触发限定）
  { id: "e21-cv-03",
    re: new RegExp(`^仅(?:触发|命中|施加)(${AIL_RE})时(.+)$`),
    go: (m) => { const r = parseEffectText(m[2]); if (r.effects.length === 0 && !r.flags?.attachDamage) return undefined; const g = { prevApplied: true, ailment: AILMENTS[m[1]] }; const cond = { and: [{ prevApplied: true }, { foeHas: AILMENTS[m[1]] }] }; for (const e of r.effects) e.if = resolveCond(e.if, cond); return r; },
  },
  // "受到致命伤害则X" → 致死 react 包（"受到致命伤害则恢复自身所有体力"）
  { id: "e21-cv-04",
    re: /^受到(?:致死|致命)(?:的)?(?:攻击|伤害)(?:则|时|后)(.+)$/,
    go: (m) => { const r = parseEffectText(m[1]); if (r.effects.length === 0 && !r.flags?.attachDamage) return undefined; return reactWrap(2, {}, m[1]); },
  },

  // ── 固伤/差值 ────────────────────────────────────────────
  // "附加自身上回合造成的伤害值N%的等量固定伤害" → lastDmgFrac n/100（"上回合"快照=lastDealt）
  { id: "e21-fl-01",
    re: /^附加(?:自身|自己)?上回合造成(?:的)?伤害值?(\d+)%(?:的)?等量?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { lastDmgFrac: frac(+m[1], 100) } }),
  },
  // "附加双方(当前)?体力差的固伤"/"附加双防当前体力差的固伤" → flatHpDiffPct:100（"双防"=双方爬取异体）
  { id: "e21-fl-02",
    re: /^附加(?:双方|双防|敌我双方)(?:当前)?(?:体力|HP)(?:值)?差(?:值)?(?:的)?(?:固定伤害|固伤)$/,
    go: () => ({ attachDamage: { flatHpDiffPct: 100 } }),
  },
  // "造成的伤害不超过自身最大体力的一半" → dmg_out_cap 仅 flat——分数封顶未建模 → 保残
  { id: "e21-fl-03",
    re: /^造成的伤害不超过(?:自身|自己)最大体力(?:的)?一半$/,
    go: () => ({ unparsedReason: "out-cap fraction — dmg_out_cap flat-only (deferred)" }),
  },
  // "自身每处于一级速度能力提升则攻击附加N点固定伤害" → flatPerStage 单维——runtime 未过滤 stats 维度（计数全维）→ 保残
  { id: "e21-fl-04",
    re: new RegExp(`^(?:自身|自己)每处于一?级?(${STAT_RE})(?:能力)?(?:提升|强化)(?:状态)?则?(?:当回合)?(?:攻击|攻击技能)?附加(\\d+)点(?:固定|固伤)?伤害$`),
    go: () => ({ unparsedReason: "per-stat stage flat — flatPerStage stats filter unimplemented (deferred)" }),
  },
  // "双方每处于N种能力提升状态则附加K点固伤" → who:both 未建模 → 保残
  { id: "e21-fl-05",
    re: /^(?:双方|敌我双方)每处于(?:\d+|一)种?能力(?:提升|强化|下降)(?:状态)?则附加\d+点(?:固定|固伤)?伤害$/,
    go: () => ({ unparsedReason: "flatPerStage both — two-sided per-stage flat unmodeled (deferred)" }),
  },
];
