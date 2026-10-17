// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e13：魂印长尾第七批——PP-2/使用技能主语/免疫变体/净化具名/双方消除/被命中反射/真实伤害等。
import { NUM, num, frac, AILMENTS, AIL_RE, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0 && !r.attachDamage && !r.flags?.attachDamage) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── PP ──────────────────────────────────────────────────
  // "(令|使)对手所有技能PP值-N" → pp_delta 负值全表（"所有技能PP值-2"变体）
  { id: "e13-pp-01",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)所有技能PP值-(\\d+)$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[1]), scope: "all", target: "opponent" }] }),
  },
  // "恢复(所有|全部)(攻击|属性)?技能N点PP值" → pp_delta amount:+N scope:all self（"恢复所有攻击技能1点PP值"）
  { id: "e13-pp-02",
    re: new RegExp(`^恢复(?:所有|全部)(?:攻击|属性)?技能${NUM}点PP值$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), scope: "all", target: "self" }] }),
  },
  // "(随机)?使对手全部技能(的)?PP(值)?归零" → pp_delta zero scope:all（"使对手所有PP归零"全表变体）
  { id: "e13-pp-03",
    re: /^(?:随机)?(?:令|使)(?:对手|对方|敌方)(?:所有|全部)技能?(?:的)?PP值?归零$/,
    go: () => ({ effects: [{ op: "pp_delta", zero: true, scope: "all", target: "opponent" }] }),
  },
  // "使对手先制效果失效"/"对手使用的技能先制效果失效" → 净化 prio 窗
  { id: "e13-pp-04",
    re: /^(?:令|使)?对手(?:使用)?(?:的)?技能?(?:的)?先制(?:效果)?失效$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", effect: ["prio_up", "prio_count"], target: "opponent" }] }),
  },

  // ── 免疫/消除 ────────────────────────────────────────────
  // "自身免疫(所有|全部)?(所)?受到的?异常(状态)?" → immune_status（"所有受到的"变体）
  { id: "e13-im-01",
    re: /^自身免疫(?:所有|全部)?所?受到?的?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }),
  },
  // "(免疫|不受)所?受到?的?(能力下降|能力下降状态|弱化)" → immune_degrade 变体
  { id: "e13-im-02",
    re: /^(?:免疫|不受)所?受到?的?(?:能力下降|弱化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "消除双方(所处)?(的)?回合类效果" → both cleanse timed（"双方所处的"变体）
  { id: "e13-im-03",
    re: /^消除双方(?:所处)?(?:的)?回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "self" }, { op: "cleanse", scope: "timed", target: "opponent" }] }),
  },
  // "(消除|解除|清除)(自身|自己|我方)(所处)?(的)?回合类效果" → self cleanse timed 补向
  { id: "e13-im-04",
    re: /^(?:消除|解除|清除|移除)(?:自身|自己|我方|本方)(?:所处)?(?:的)?回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "self" }] }),
  },

  // ── 印记 ────────────────────────────────────────────────
  // "为双方附加X"/"令双方获得X" → apply_mark both（具名状态机双方挂）
  { id: "e13-mk-01",
    re: /^(?:为|给|令|使)双方附加(.{1,8}?)(?:印记|状态)?$/,
    go: (m) => { const mk = m[1].replace(/(印记|状态)$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|固定|真实|百分比|\d|先制|致命|无法|免疫/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: 1, target: "self" }, { op: "apply_mark", mark: mk, count: 1, target: "opponent" }] }; },
  },

  // ── 触发 ────────────────────────────────────────────────
  // "对手技能命中时X"/"对手攻击命中时X" → reactWrap trigger1（对手命中自身→触发）
  { id: "e13-rc-01",
    re: /^对手(?:技能|攻击)命中(?:时|后)(.+)$/,
    go: (m) => { const inner = /^\d+%/.test(m[1]) ? m[1].replace(/^(\d+%)/, "令对手$1") : `令对手${m[1]}`; return reactWrap(1, {}, inner); },
  },
  // "(令|使)对手受到(当回合)?(自身|自己)受到(的)?(伤害|攻击伤害)(的)?(等量|等同|同等)(的)?(固定伤害|固伤|真实伤害)" → reflect_dmg 全量
  { id: "e13-rc-02",
    re: /^(?:令|使)对手受到(?:当回合)?(?:自身|自己)?受到?的?(?:攻击)?伤害(?:的)?(?:等量|等同|同等|相同)(?:的)?(?:固定伤害|固伤|真实伤害|伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }),
  },

  // ── 自伤 ────────────────────────────────────────────────
  // "受到N点(真实|固定|百分比)伤害" → 自伤副作用（主语默认自身）
  { id: "e13-sd-01",
    re: new RegExp(`^(?:自身|自己)?受到${NUM}点?(真实|固定|百分比)(?:伤害|固伤)$`),
    go: (m) => { const k = m[2]; return { effects: [{ op: "damage", kind: k === "真实" ? "true" : k === "百分比" ? "percent" : "fixed", power: num(m[1]), target: "self" }] }; },
  },
  // "对手受N固伤"/"令对手受到N点固定伤害" → 对敌固伤（"受"省略"到"形——"2回合受到攻击，对手受50固伤"）
  { id: "e13-sd-02",
    re: new RegExp(`^(?:使|令|让)?(对手|对方|敌方)受到?${NUM}点?(真实|固定|百分比)?(?:伤害|固伤)$`),
    go: (m) => { const k = m[3]; return { effects: [{ op: "damage", kind: k === "真实" ? "true" : k === "百分比" ? "percent" : "fixed", power: 0, flatBonus: num(m[2]), target: "opponent" }] }; },
  },

  // ── 伤害增幅变体 ─────────────────────────────────────────
  // "(当回合|本回合)?造成(的)?(攻击)?伤害提升N%" → dmg_boost（"造成的攻击伤害提升"变体）
  { id: "e13-dm-01",
    re: /^造成(?:的)?(?:攻击)?伤害提升(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "本次攻击伤害(额外)?(提升|增加)N%" → dmg_boost turns1 变体
  { id: "e13-dm-02",
    re: /^本次攻击伤害(?:额外)?(?:提升|增加|提高)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 1, params: { pct: +m[1] } }] }),
  },
  // "(每次登场)?(致命|暴击)触发几率(为)?N%" → crit_up 变体
  { id: "e13-dm-03",
    re: new RegExp(`^(?:每次登场)?(?:致命|暴击)(?:的)?触发几率(?:为)?(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: +m[1], d: 100 } }] }),
  },

  // ── 恢复 ────────────────────────────────────────────────
  // "(自身|自己)?恢复已损失体力值?的?N%" → missing 变体（"体力值的"）
  { id: "e13-hl-01",
    re: /^(?:自身|自己)?恢复已损失体力值?的?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "heal", numerator: +m[1], denominator: 100, missing: true, target: "self" }] }),
  },
];
