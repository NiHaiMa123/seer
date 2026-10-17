// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e12：魂印长尾第六批——PP翻倍/本场战斗/自伤百分比/印记量词/被命中触发/杂项。
import { NUM, num, frac, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0 && !r.attachDamage) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── PP ──────────────────────────────────────────────────
  // "(释放|使用)技能所消耗的PP值翻倍" → pp_double self
  { id: "e12-pp-01",
    re: /^(?:自身|自己)?(?:释放|使用)?(?:的)?技能?所?消耗?的?PP值?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_double", target: "self" }] }),
  },
  // "消耗(此技能|自身)(的)?(全部|所有)PP值" → pp_delta zero self（自耗式触发代价）
  { id: "e12-pp-02",
    re: /^消耗(?:此|该|自身|自己)?技能?(?:的)?(?:全部|所有)PP值$/,
    go: () => ({ effects: [{ op: "pp_delta", zero: true, target: "self" }] }),
  },
  // "额外使当次(使用)?的?技能不消耗PP值" → pp_free（"额外使"前缀变体）
  { id: "e12-pp-03",
    re: /^(?:额外)?(?:使|令)?当次(?:使用)?(?:的)?技能不(?:再)?消耗PP值?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }),
  },
  // "不为满的技能不会消耗PP值" → pp_free（"不会消耗"变体——近似）
  { id: "e12-pp-04",
    re: /^(?:自身|自己)?(?:使用|释放)?技能不?会?消耗PP值$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }),
  },

  // ── 本场战斗 ────────────────────────────────────────────
  // "(自身)?在(本场|本次)战斗中?(的)?(攻击)?伤害(提升|提高|增加)N%" → dmg_boost 常驻
  { id: "e12-bt-01",
    re: /^(?:自身|自己)?在?(?:本场|本次)战斗中?(?:的)?(?:自身|自己)?(?:造成)?(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "本场战斗免疫AIL(状态)?" → 定向免疫
  { id: "e12-bt-02",
    re: new RegExp(`^本场战斗免疫(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", ailment: AILMENTS[m[1]], target: "self" }] }),
  },
  // "免疫所受到的异常(状态)?" → immune_status（"所"字变体）
  { id: "e12-bt-03",
    re: /^免疫所?受到?的?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }),
  },

  // ── 自伤/反弹 ────────────────────────────────────────────
  // "受到最大体力N%的百分比伤害" → 自身承伤百分比（裸句=自伤副作用）
  { id: "e12-sd-01",
    re: /^受到(?:自身|自己)?最大体力(?:的)?(\d+)%(?:的)?百分比伤害$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(+m[1], 100), target: "self" }] }),
  },
  // "以固定伤害的形式反弹受到的攻击伤害" → reflect_dmg 全量
  { id: "e12-sd-02",
    re: /^以固定伤害的形式反弹受到?的?(?:攻击)?伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }] }),
  },
  // "每回合造成的攻击伤害提升N%"（"每回合"节律前缀 + 出伤提升——窗口内逐回合生效，按 tick 化 hot 同族取 dmg_boost）。放在 e12-sd-03 前面，那条是"减少"。
  { id: "e12-sd-02b",
    re: /^每回合造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "每回合造成攻击伤害减少N%" → 自身出伤压制（歧形收 dmg_boost 负 pct）
  { id: "e12-sd-03",
    re: /^每回合造成攻击伤害减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: -num(m[1]) } }] }),
  },
  // "(将)?伤害提升至N%"/"伤害提升为N%" → mul/pct 倍率（"提升至150%"=+50）
  { id: "e12-sd-04",
    re: /^(?:将|把|使)?伤害提升(?:至|为|到)(\d+)%$/,
    go: (m) => { const p = +m[1] - 100; return p % 100 === 0 ? { effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: p / 100 + 1 } }] } : { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: p } }] }; },
  },
  // "将对手体力降为1点" 归一后由 e6-143 收——"把对手体力降为N" 变体已覆盖

  // ── 印记量词 ────────────────────────────────────────────
  // "(为|给|令)(对手)?施加N(道|枚|层|道|个)X" → apply_mark（"1道诡符"等量词变体）
  { id: "e12-mk-01",
    re: new RegExp(`^(?:为|给|令)(?:对手|对方|敌方)施加${NUM}(?:道|枚|层|个|柄)(.{1,8}?)(?:印记)?$`),
    go: (m) => { const mk = m[2].replace(/印记$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: num(m[1]), target: "opponent" }] }; },
  },
  // "施加N(道|层)X" 无目标 → self（无主语保守化——挂自身印记）
  { id: "e12-mk-02",
    re: new RegExp(`^施加${NUM}(?:道|枚|层|个|柄)(.{1,8}?)(?:印记)?$`),
    go: (m) => { const mk = m[2].replace(/印记$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: num(m[1]), target: "self" }] }; },
  },
  // "增加N层X"/"叠加N层X" → apply_mark add（"增加1层自然祝福"量词变体）
  { id: "e12-mk-03",
    re: new RegExp(`^(?:增加|叠加|获得)${NUM}层(.{1,8}?)(?:印记)?$`),
    go: (m) => { const mk = m[2].replace(/印记$/, ""); if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: num(m[1]), target: "self" }] }; },
  },
  // "蓄力层数-K并附加…" —— 印记消耗复合：消耗蓄力层 → consume_mark + 内解析
  { id: "e12-mk-04",
    re: new RegExp(`^(.{1,6}?)层数-${NUM}(?:并|,|，|且)(.+)$`),
    go: (m) => { const r = parseEffectText(m[3]); if (r.effects.length === 0 && !r.attachDamage && !r.flags?.attachDamage) return { unparsedReason: `mark-consume tail unparsed: ${m[3]}` }; return { effects: [{ op: "consume_mark", mark: m[1], count: num(m[2]), target: "self" }, ...r.effects], flags: r.flags }; },
  },

  // ── 被命中触发 ────────────────────────────────────────────
  // "(每次登场)?(首次)?被(属性|攻击)技能命中后X" → reactWrap trigger3 cat
  { id: "e12-rc-01",
    re: /^(?:每次登场)?(?:首次|第一次|初次)?被(属性|攻击)技能命中(?:后|时)(.+)$/,
    go: (m) => reactWrap(3, { cat: m[1] === "属性" ? 1 : 4 }, m[2]),
  },
  // "被攻击命中后X" 裸形 → trigger1
  { id: "e12-rc-02",
    re: /^被攻击命中(?:后|时)(.+)$/,
    go: (m) => reactWrap(1, {}, m[1]),
  },

  // ── 杂项 ────────────────────────────────────────────────
  // "攻击伤害翻倍N%触发" → dmg_mul + chance（"触发"尾为语气词——part 通道已剥"触发"头）
  { id: "e12-mx-01",
    re: /^(?:自身|自己)?(?:攻击|造成)?(?:攻击)?伤害翻倍(\d+)%(?:的)?(?:几率|概率)?触发$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", chance: +m[1], params: { mul: 2 } }] }),
  },
  // "N%触发"尾变体——"攻击伤害翻倍"主形由 e8/dmg 规则收；"翻倍N%触发"整句在此收
  { id: "e12-mx-02",
    re: /^(?:自身|自己)?(?:攻击|造成)?(?:攻击)?伤害?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: 2 } }] }),
  },
  // "提升N点威力"/"威力+N点" → powerAdd 语序变体（"威力提升N点"已由既有规则收）
  { id: "e12-mx-03",
    re: new RegExp(`^提升${NUM}点威力$|^威力\\+${NUM}$|^威力提升${NUM}点$`),
    go: (m) => ({ attachDamage: { powerAdd: num(m.slice(1).find((x) => x !== undefined)) } }),
  },
];
