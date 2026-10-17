// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e10：魂印长尾第四批——消除回合类/伤害转体力/反弹阈值/回合末扣血/登场窗/先制补遗。
import { NUM, num, frac, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0 && !r.attachDamage) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── 消除回合类效果 ──────────────────────────────────────
  // "(攻击技能|属性技能|攻击|自身)?消除对手回合类效果" → cleanse timed foe
  { id: "e10-cl-01",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|属性技能|使用攻击技能|使用属性技能|技能)?消除(?:对手|对方|敌方)回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }] }),
  },
  // "消除对手回合类效果并反转对手能力提升" → cleanse timed + invert
  { id: "e10-cl-02",
    re: /^消除(?:对手|对方|敌方)回合类效果并反转(?:对手|对方|敌方)能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }, { op: "invert_stages", sign: "up", target: "opponent" }] }),
  },
  // "消除对手回合类效果和护盾效果" → cleanse timed + shield
  { id: "e10-cl-03",
    re: /^消除(?:对手|对方|敌方)回合类效果和护盾(?:效果)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }, { op: "cleanse", scope: "shield", target: "opponent" }] }),
  },
  // "消除双方能力提升状态和回合类效果" → 双侧 cleanse up + timed
  { id: "e10-cl-04",
    re: /^消除双方能力(?:提升|强化)(?:状态)?和回合类效果$/,
    go: () => ({ effects: ["self", "opponent"].flatMap((t) => [{ op: "clear_stages", target: t, sign: "up" }, { op: "cleanse", scope: "timed", target: t }]) }),
  },
  // "(有N%的几率)?消除对手回合类效果"——"有"在 part 通道已剥；整句收几率形态
  { id: "e10-cl-05",
    re: /^(?:有)?(\d+)%(?:的)?(?:几率|概率)?消除(?:对手|对方|敌方)回合类效果$/,
    go: (m) => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent", chance: +m[1] }] }),
  },

  // ── 伤害转体力/护盾 ──────────────────────────────────────
  // "将本回合受到的攻击伤害转化为体力"/"下回合受到的攻击伤害转化为自身体力" → dmg_to_heal
  { id: "p2-dh-02",
    re: /^(?:将|把)?(?:本回合|当回合|下回合)?受到的?(?:攻击)?伤害转化(?:为|成)恢复(?:自身|自己)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }),
  },
  { id: "e10-dh-01",
    re: /^(?:将|把)?(?:本回合|当回合|下回合|受到的)?受到?的?攻击?伤害转化(?:为|成)(?:自身|自己)?的?(?:体力|HP)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }),
  },
  // "受到的攻击伤害转化为护盾" → dmg_to_shield
  { id: "e10-dh-02",
    re: /^(?:将|把)?受到?的?攻击?伤害转化(?:为|成)(?:等量)?(?:的)?护盾$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_shield", target: "self" }] }),
  },

  // ── 反弹阈值 ────────────────────────────────────────────
  // "反弹当回合受到的大于N的伤害" → reflect_dmg 1/1 + takenAbove 守卫
  { id: "e10-rf-01",
    re: /^反弹(?:当回合|本回合)?受到?的?(?:攻击)?(?:伤害)?大于(\d+)(?:点)?的?伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 }, if: { takenAboveAbs: +m[1] } }] }),
  },

  // ── 回合末扣血 ──────────────────────────────────────────
  // "敌我双方每回合损失N点体力" → 双侧 dot flat
  { id: "e10-dt-01",
    re: /^(?:敌我双方|敌我|双方)(?:在场)?(?:精灵)?每回合损失(\d+)点(?:体力|HP)$/,
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: "dot_field", target: t, params: { flat: +m[1] } })) }),
  },
  // "回合结束时对手减少N/M(的)?(最大)?体力" → foe_dot frac（turn-end 重写后余形；"对手减少N/M最大体力"本体）
  { id: "e10-dt-02",
    re: new RegExp(`^(?:每回合)?(?:对手|对方|敌方)(?:的)?体力?减少${NUM}\\s*/\\s*${NUM}(?:的)?(?:最大)?体力$|^(?:每回合)?令?(?:对手|对方|敌方)减少${NUM}\\s*/\\s*${NUM}最大体力$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { n: ns[0], d: ns[1] } }] }; },
  },
  // "回合结束时吸取对手最大体力N/M" → 每回合 drain——tick 重写后由 drain_dot 规则收；此处收裸"每回合吸取"变体
  { id: "e10-dt-03",
    re: new RegExp(`^每回合(?:吸取|吸收)(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },

  // ── 登场/先制补遗 ──────────────────────────────────────
  // "(之后)?(每次)?(首次)?登场前N回合(内)?(免疫|免)异常(状态)?" → immune_status turns（e8-im-14 的全变体）
  { id: "e10-en-01",
    re: new RegExp(`^(?:之后)?(?:每次)?(?:首次|初次|每次登场后)?登场前(${NUM})回合(?:内)?(?:免疫|免)异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }] }),
  },
  // "自身所有技能先制+N"→prio_up 已由 e9-pr-01 收；"攻击先制+N"裸形如已由 flags.priority 收
  // "下回合自身所有技能先制+N" 等窗——TURNS_PRE 已收；"本场战斗结束前" e9-pr-04 已收
  // "50%的几率使本回合受到的攻击伤害减半" → 当回合承伤减半 + chance
  { id: "e10-tk-01",
    re: /^(?:(\d+)%(?:的)?(?:几率|概率)?)?(?:使|令)?(?:本回合|当回合)受到?的?攻击?伤害减半$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", turns: 1, ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { pct: 50 } }] }),
  },
  // "(若对手处于烧伤状态)?当回合自身造成的伤害随机提升N-M%" → dmg_boost pctMin/pctMax
  { id: "e10-tk-02",
    re: /^(?:自身|自己)?造成?的?(?:攻击)?伤害随机(?:提升|提高|增加)(\d+)\s*[-~～—]\s*(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: +m[1], pctMax: +m[2] } }] }),
  },
  // "每战斗一回合增加N%" → 每在场回合成长——growStep 宿主缺失时近似常驻 boost？不猜——留残
];
