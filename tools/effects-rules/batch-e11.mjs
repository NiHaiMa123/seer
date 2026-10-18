// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e11：魂印长尾第五批——先手/双方异常/类别承伤/触发X：标记尾/控制类解除/杂项补遗。
import { NUM, num, frac, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0 && !r.attachDamage) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── 先手/无效 ────────────────────────────────────────────
  // "(自身)?必定先手" → prio_up 大幅（必定先手无精确模型——+9 覆盖常规先制区间 UNVERIFIED）
  { id: "e11-pr-01",
    re: /^(?:自身|自己)?必定先手$/,
    go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 9 } }] }),
  },

  // ── 双方异常 ────────────────────────────────────────────
  // "令双方AIL N回合" → 双侧异常窗
  { id: "p2-al-03",
    re: /^(?:敌我双方|双方)(烧伤|冻伤|中毒|麻痹|害怕|睡眠|失明|失神|束缚|混乱|寄生|诅咒|疲惫|流血|沉默|冰封|易燃|焚烬|石化|瘫痪|感染|狂暴|衰弱|臣服|冷冻)(?:状态)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)回合$/,
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: AILMENTS[m[1]], target: t, turns: num(m[2]) })) }),
  },
  { id: "e11-al-01",
    re: new RegExp(`^(?:令|使)双方(${AIL_RE})(?:状态)?${NUM}回合$`),
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: AILMENTS[m[1]], target: t, turns: num(m[2]) })) }),
  },
  // "令双方AIL" 无回合 → 双侧
  { id: "p2-al-04",
    re: /^(?:敌我双方|双方)(烧伤|冻伤|中毒|麻痹|害怕|睡眠|失明|失神|束缚|混乱|寄生|诅咒|疲惫|流血|沉默|冰封|易燃|焚烬|石化|瘫痪|感染|狂暴|衰弱|臣服|冷冻)(?:状态)?$/,
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: AILMENTS[m[1]], target: t })) }),
  },
  // "为双方附加N回合AIL"——第三种写法（克律莎/远古雷律）。
  // 注意词序：数字在前、异常名在后（"为双方附加2回合混乱"），与 p2-al-03 相反。
  // 前缀「并」由 part 循环剥掉，所以这里只认裸形。
  { id: "p2-al-03b",
    re: new RegExp(`^为(?:敌我)?双方附加${NUM}回合(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: AILMENTS[m[2]], target: t, turns: num(m[1]) })) }),
  },
  { id: "e11-al-02",
    re: new RegExp(`^(?:令|使)双方(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: AILMENTS[m[1]], target: t })) }),
  },

  // ── 类别承伤 ────────────────────────────────────────────
  // "受到(的)?(固定伤害|百分比伤害|固定伤害和百分比伤害|百分比伤害和固定伤害)(提升|提高|增加)N%" → dmg_taken_up kindMask:3
  { id: "e11-tk-01",
    re: /^受到?(?:的)?(?:固定伤害和百分比伤害|百分比伤害和固定伤害|固定伤害|百分比伤害|固定伤害或百分比伤害)(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "self", params: { pct: +m[1], kindMask: 3 } }] }),
  },
  // "(令|使)?本次受到的攻击伤害降低N%" → dmg_taken_down pct
  { id: "e11-tk-02",
    re: /^(?:(\d+)%(?:的)?(?:几率|概率)?)?(?:令|使)?本次受到?的?攻击?伤害(?:降低|减少)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { pct: +m[2] } }] }),
  },
  // "N%几率令下次受到的攻击伤害降低M%" → count:1 承伤
  { id: "e11-tk-03",
    re: /^(?:(\d+)%(?:的)?(?:几率|概率)?)?(?:令|使)?下(?:一|1)?次受到?的?攻击?伤害(?:降低|减少)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { pct: +m[2], count: 1 } }] }),
  },
  // "受到攻击伤害50%减少N点"→chance reduce；"受到攻击(伤害)?减少N点" → dmg_reduce flat
  { id: "e11-tk-04",
    re: /^受到(?:的)?(?:攻击|攻击伤害|伤害)(?:减少|降低)(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: +m[1] } }] }),
  },

  // ── 无视提升 ────────────────────────────────────────────
  // "(自身)?(攻击)?无视对手(所有)?能力(提升|强化)(状态|效果)?" → pierce_stages（e8-ft-18 全变体）
  { id: "e11-ig-01",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|出手|所有攻击)?无视(?:对手|对方|敌方)(?:的)?(?:所有|全部)?能力(?:提升|强化)(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }),
  },
  // "无视对手防御强化N%" → ignore_def 强化值百分（"防御强化"=防御能力值）
  { id: "e11-ig-02",
    re: /^无视(?:对手|对方|敌方)(?:的)?防御(?:强化|能力|值|等级)?(?:的)?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: +m[1] } }] }),
  },

  // ── 触发X：标记尾（"触发暗影护盾：2回合内…"实体侧）──
  // —— PART_PRE_STRIP 已加"出场后/登场后"；"触发<名>：" 见 effects-parse 头通道 ——
  // "每N回合(触发|转动|开启)一次<名>" → 周期触发——引擎无周期钩子，交 deferred（见 soulmark-parse 残留模式）

  // ── 解除控制类异常 ──────────────────────────────────────
  // "解除自身控制类异常状态" → cleanse control scope（control:* 状态族——束缚/沉默等带 control: 前缀的效果）
  { id: "e11-cl-01",
    re: /^解除(?:自身|自己)?(?:的)?控制类异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "control", target: "self" }] }),
  },
  // "解除自身所有(控制类)?异常(状态)?和(能力)?下降" 全量复合
  { id: "e11-cl-02",
    re: /^解除(?:自身|自己)?(?:所有|全部)?(?:控制类)?异常(?:状态)?(?:以及|和|与|、)(?:所有|全部)?能力?下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "ailment", target: "self" }, { op: "clear_stages", target: "self", sign: "down" }] }),
  },

  // ── 受击触发变体 ────────────────────────────────────────
  // "每次受到攻击(都)?有?N%几率令自身(双防|stat)+K" → reactWrap（都有/都有N% 变体经 part 通道）
  { id: "e11-rc-01",
    re: /^每次受到(?:的)?攻击(?:伤害)?(?:有|都有|均有)?(\d+)%(?:的)?(?:几率|概率)?(.+)$/,
    go: (m) => { const r = reactWrap(1, {}, `令自身${m[2].replace(/^(?:令|使)?自身/, "")}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = +m[1]; return r; },
  },
  // "(自身)?当回合受到攻击则回合结束时X" → 受击守卫 tick（cond 近似：当回合被击过 → 回合末效果）
  { id: "e11-rc-02",
    re: /^(?:自身|自己)?当回合受到(?:的)?攻击(?:伤害)?则(.+)$/,
    go: (m) => gated(m[1], { not: { prevTakenZero: true } }),
  },
];
