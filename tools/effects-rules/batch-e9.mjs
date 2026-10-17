// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e9：魂印长尾第三批——护盾/先制变体/致命窗/命中闪避/承伤变体/异常复合。
import { NUM, num, frac, AILMENTS, AIL_RE } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── 护盾 ────────────────────────────────────────────────
  // "获得一个可抵御N伤害护盾"/"(为|给)自身附加N点护盾"/"获得N点护盾(值)?"/"护盾值增加N" → shield flat
  { id: "e9-sh-01",
    re: /^获得(?:一个)?(?:可抵御)?(\d+)(?:点|伤害)?(?:的)?护盾(?:值)?$|^(?:为|给)(?:自身|自己)附加(\d+)点(?:的)?护盾(?:值)?$|^护盾值(?:增加|提升|提高)(\d+)(?:点)?$/,
    go: (m) => { const v = m.slice(1).find((x) => x !== undefined); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: +v } }] }; },
  },
  // "(为|给)自身附加等同于自身最大体力值?N/M的护盾"/"自身最大体力值N的护盾" → fracMaxHp
  { id: "e9-sh-02",
    re: new RegExp(`^(?:为|给)(?:自身|自己)附加(?:一个)?(?:等同于|相当于)?(?:自身|自己)?最大体力值?${NUM}\\s*/\\s*${NUM}的护[盾罩]$|^附加一个自身最大体力${NUM}\\s*/\\s*${NUM}的护[罩盾]$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { fracMaxHpN: ns[0], fracMaxHpD: ns[1] } }] }; },
  },
  // "(N%的几率)?获得一个N点的护盾" → shield + chance（bcm 剥率后剩"的几率获得"——整句匹配）
  { id: "e9-sh-03",
    re: /^(?:(\d+)%(?:的)?)?(?:的)?(?:几率|概率)?获得(?:一个)?(\d+)点(?:的)?护盾$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { flat: +m[2] } }] }),
  },
  // "下只登场精灵获得N点护盾(和护罩)?" → nextAlly shield（护罩并入同一吸收池——双池语义 UNVERIFIED 取近似）
  { id: "e9-sh-04",
    re: /^(?:己方|本方)?下(?:一|1)?只(?:登场|出战|出场)?精灵获得(\d+)点护[盾罩](?:和(\d+)点护[罩盾])?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "nextAlly", params: { flat: +m[1] + (m[2] !== undefined ? +m[2] : 0) } }] }),
  },
  // "附加X点护盾和(Y点)?护罩"/"附加X点护罩和(Y点)?护盾" → shield + ward 分立池（罩=固伤/百分比 kindMask=3）；同词枚举（"护盾和护盾"）合池
  { id: "e9-sh-05",
    re: /^(?:为|给|使|令)?(?:自身|自己)?(?:附加|获得|生成|创造)?(\d+)点护(盾|罩)[和、](?:(\d+)点)?护(盾|罩)$/,
    go: (m) => {
      const n1 = num(m[1]); const k1 = m[2] === "盾" ? "shield" : "ward"; const k2 = m[4] === "盾" ? "shield" : "ward"; const n2 = m[3] !== undefined ? num(m[3]) : n1;
      const eff = (k, f) => ({ op: "apply_status", name: k, target: "self", params: { flat: f, ...(k === "ward" ? { kindMask: 3 } : {}) } });
      return k1 === k2 ? { effects: [eff(k1, n1 + n2)] } : { effects: [eff(k1, n1), eff(k2, n2)] };
    },
  },
  // "N回合内物理攻击无法命中(自己|自身)" → must_miss_phys turns（"触发暗影护盾：…"的实体侧）
  { id: "e9-sh-06",
    re: new RegExp(`^(?:${NUM}回合内)?物理攻击无法命中(?:自己|自身)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss_phys", target: "self", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }),
  },
  { id: "e9-sh-07",
    re: new RegExp(`^(?:${NUM}回合内)?特殊攻击无法命中(?:自己|自身)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss_spec", target: "self", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }),
  },
  // "使对手受到自身恢复体力值等量的固伤" → flatSelfLastHeal 独立 damage
  { id: "e9-sh-08",
    re: /^(?:使|令)(?:对手|对方|敌方)受到(?:自身|自己)恢复(?:的)?体力(?:值)?等量的?(?:固定伤害|固伤)$/,
    go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfLastHeal: true }] }),
  },
  // "附加恢复体力值等量固伤" → attachDamage flatSelfLastHeal（"恢复体力值等量"词序变体——attachAll 的"等同于恢复量"不覆盖）
  { id: "e9-sh-09",
    re: /^附加(?:自身|自己)?恢复(?:的)?体力(?:值)?等量的?(?:固定伤害|固伤)$/,
    go: () => ({ attachDamage: { flatSelfLastHeal: true } }),
  },
  // "恢复自身最大体力的N/M并附加等量固伤" → heal + flatSelfLastHeal 复合
  { id: "e9-sh-10",
    re: new RegExp(`^恢复(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}并附加等量(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }, { op: "damage", kind: "fixed", power: 0, flatSelfLastHeal: true }] }),
  },
  // "恢复自身已损失体力值N%的体力" → heal missing pct
  { id: "e9-sh-11",
    re: /^恢复(?:自身|自己)?已损失体力(?:值)?(\d+)%(?:的体力值?)?$/,
    go: (m) => ({ effects: [{ op: "heal", missing: true, numerator: +m[1], denominator: 100, target: "self" }] }),
  },
  // "直接攻击造成伤害的20%回体"（"直接"领起 + "回体"省字）。放在 e9-sh-12 前面，那条尾词只收「恢复体力」。
  { id: "e9-sh-12a",
    re: /^直接攻击造成(?:的)?伤害(?:的)?(\d+)%回体$/,
    go: (m) => ({ attachDamage: { drain: frac(+m[1], 100) } }),
  },
  // "(自身使用攻击)?造成伤害的N%恢复自身体力" → 出伤分流（"的N%"百分数变体）
  { id: "e9-sh-12",
    re: /^(?:自身|自己)?(?:使用)?(?:攻击)?造成(?:的)?伤害(?:的)?(\d+)%(?:的)?恢复(?:自身|自己)?体力$|^(?:自身|自己)?使用攻击造成(?:的)?伤害(?:的)?(\d+)%(?:的)?恢复(?:自身|自己)?体力$/,
    go: (m) => ({ attachDamage: { drain: frac(+(m[1] ?? m[2]), 100) } }),
  },
  // "造成伤害的N%恢复自身体力并附带K%几率令对手AIL" → drain + 概率异常复合
  { id: "e9-sh-13",
    re: new RegExp(`^(?:自身|自己)?造成(?:的)?伤害(?:的)?(\\d+)%(?:的)?恢复(?:自身|自己)?体力并附?带?(\\d+)%(?:的)?几率(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ attachDamage: { drain: frac(+m[1], 100) }, effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent", chance: +m[2] }] }),
  },
  // "令自身吸取对手体力数值恢复到初始状态" → 全恢复（吸取语意=回满 UNVERIFIED→heal 1/1）
  { id: "e9-sh-14",
    re: /^(?:使|令)(?:自身|自己)吸取(?:对手|对方|敌方)体力(?:数值)?恢复到初始状态$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }),
  },
  // "对手每处于一种能力下降则(回合结束)?自身恢复N点?体力" → flatPerStage foe/down
  { id: "e9-sh-15",
    re: /^(?:对手|对方|敌方)每处于(?:1|一)种能力?下降(?:状态)?则?(?:回合结束(?:时|后)?)?(?:自身|自己)?恢复(\d+)点?(?:的)?体力$/,
    go: (m) => ({ effects: [{ op: "heal", flatPerStage: { who: "foe", sign: "down", per: 1, flat: +m[1] }, target: "self" }] }),
  },
  // "(自身)每处于1种能力提升状态则恢复N点体力" → flatPerStage self/up
  { id: "e9-sh-16",
    re: /^(?:自身|自己)?每处于(?:1|一)种能力(?:提升|强化)(?:状态)?则?恢复(\d+)点?(?:的)?体力$/,
    go: (m) => ({ effects: [{ op: "heal", flatPerStage: { who: "self", sign: "up", per: 1, flat: +m[1] }, target: "self" }] }),
  },
  // "恢复自身最大体力N/M的体力" → heal frac（"的体力"冗余尾变体）
  { id: "e9-sh-17",
    re: new RegExp(`^恢复(?:自身|自己)?最大体力${NUM}\\s*/\\s*${NUM}的体力$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },

  // ── 先制 ────────────────────────────────────────────────
  // "全技能先制+N"/"使用攻击技能先制+N"/"攻击技能先制+N" → prio_up 变体
  { id: "e9-pr-01",
    re: new RegExp(`^(?:全技能|全部技能|使用(?:攻击|属性)?技能|攻击技能|属性技能|自身技能)?先制([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }),
  },
  // "(首次|第一次)攻击先制+N" → prio_count 1
  { id: "e9-pr-02",
    re: new RegExp(`^(?:首次|第一次|初次)(?:攻击)?(?:技能)?先制([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]), count: 1 } }] }),
  },
  // "前N次所有技能先制+K" → prio_count
  { id: "e9-pr-03",
    re: new RegExp(`^前${NUM}次(?:所有|全部)?技能先制([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: (m[2] === "-" ? -1 : 1) * num(m[3]), count: num(m[1]) } }] }),
  },
  // "本场战斗结束前自身所有技能先制+N" → prio_up（"结束前"=常驻）
  { id: "e9-pr-04",
    re: new RegExp(`^本场战斗结束前(?:自身|自己)?(?:所有|全部)?技能先制([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }),
  },

  // ── 致命 ────────────────────────────────────────────────
  // "(第一次|首次|下次|下1次)攻击(必定|100%)?致命(一击)?" → crit_always count:1
  { id: "e9-cr-01",
    re: /^(?:自身|自己)?(?:第一次|首次|初次|下次|下1次|下一个)攻击(?:技能)?(?:必定|100%的?(?:几率|概率)?|必)?(?:打出)?致命[一1]?击?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: 1 } }] }),
  },
  // "(我方|自身)?(每次|所有)?攻击必定致命(一击)?"/"必定致命一击" → crit_always
  { id: "e9-cr-02",
    re: /^(?:(?:我方|己方|自身|自己)(?:的)?)?(?:每次|所有|全部)?攻击?(?:必定|必中)?致命[一1]?击?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }),
  },
  // "下1次攻击技能100%打出致命一击"/"自身首次使用攻击技能100%打出致命一击" → count:1
  { id: "e9-cr-03",
    re: /^(?:自身|自己)?(?:下1次|下次|首次|第一次)(?:使用)?(?:攻击|攻击技能|技能)(?:\d+)%?(?:的?(?:几率|概率))?打出致命[一1]?击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: 1 } }] }),
  },
  // "(N%的几率)?打出致命一击"/"使用攻击N%打出致命一击"/"攻击N%的几率打出致命一击" → crit_up {n,d}
  { id: "e9-cr-04",
    re: /^(?:自身|自己)?(?:使用)?(?:攻击|攻击技能|技能)?(?:(\d+)%(?:的)?(?:几率|概率)?)?打出致命[一1]?击$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: m[1] !== undefined ? +m[1] : 50, d: 100 } }] }),
  },
  // "(当回合|每回合)?攻击N%的几率打出致命一击" —— 前置%形态由 e9-cr-04/bcm 收；"几率打出"连体补
  { id: "e9-cr-05",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|技能|当回合攻击)?(\d+)%(?:的)?(?:几率|概率)?打出致命[一1]?击$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: +m[1], d: 100 } }] }),
  },
  // "受到致命(攻击|伤害)(时|后)?(100%)?残留N点?(体力|血)" → endure（"残留1血"无"点"变体）
  { id: "e9-cr-06",
    re: /^受到致命(?:攻击|伤害|一击)(?:时|后|下)?(?:\d+%)?(?:的?(?:几率|概率))?残留(\d+)点?(?:体力|血|HP|生命)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: +m[1] } }] }),
  },
  // "残留N点血"/"余下N点血" → endure（"血"单字变体）
  { id: "e9-cr-07",
    re: /^(?:残留|保留|余下|留下|留下余|剩余)(\d+)点(?:血|HP|生命|体力)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: +m[1] } }] }),
  },

  // ── 命中/闪避 ────────────────────────────────────────────
  // "自身所有技能(附带)?必中(效果)?"/"所有攻击附带必中" → must_hit
  { id: "e9-hit-01",
    re: /^(?:自身|自己)?(?:所有|全部)(?:技能|攻击)(?:附带|附加)?(?:的)?必中(?:效果)?$|^(?:附带|附加)必中(?:效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "must_hit", target: "self" }] }),
  },
  // "闪避下1次受到的攻击" → must_miss（次数没人读，不发 count）
  { id: "e9-hit-02",
    re: new RegExp(`^(?:自身|自己)?闪避下?(${NUM})?次受到?的?攻击(?:技能)?(?:伤害)?$`),
    go: () => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self" }] }),
  },
  // "(自身)?N%(的几率)?闪避对手(的)?(攻击|攻击技能)" → must_miss chance
  { id: "e9-hit-03",
    re: /^(?:自身|自己)?(\d+)%(?:的)?(?:几率|概率)?闪避(?:对手|对方|敌方)(?:的)?攻(?:击)?(?:技能)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", chance: +m[1] }] }),
  },

  // ── 承伤/减少 ────────────────────────────────────────────
  // "受到伤害减少N/M" → 分数承伤减免（dmg_taken_down pct 近似——1/3→33）
  { id: "e9-tk-01",
    re: new RegExp(`^受到(?:的)?(?:攻击)?伤害减少${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: Math.round((num(m[1]) * 100) / num(m[2])) } }] }),
  },
  // "(我方|己方)受到的伤害减少N点" → dmg_reduce flat（"我方"=自身侧）
  { id: "e9-tk-02",
    re: /^(?:我方|己方)受到?的?(?:攻击)?伤害减少(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: +m[1] } }] }),
  },
  // "下N次(自身)?受到的伤害减少K%" → dmg_taken_down count
  { id: "e9-tk-03",
    re: new RegExp(`^下${NUM}次(?:自身|自己)?受到?的?(?:攻击)?伤害减少(\\d+)%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[2], count: num(m[1]) } }] }),
  },
  // "受到的攻击伤害和固定伤害减少N%" → dmg_taken_down（固伤同减 UNVERIFIED→合并 pct）
  { id: "e9-tk-04",
    re: /^受到?的?攻击伤害和固定伤害减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "自身体力减少N点" → 自残固伤
  { id: "e9-tk-05",
    re: /^(?:自身|自己)体力减少(\d+)点$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: +m[1], target: "self" }] }),
  },

  // ── 异常复合 ────────────────────────────────────────────
  // "(攻击)?使对手N%AIL" → 句中百分率变体（"使对手100%烧伤"）
  { id: "e9-al-01",
    re: new RegExp(`^(?:攻击|攻击技能)?(?:使|令)(?:对手|对方|敌方)(\\d+)%(?:的)?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "攻击使对手AIL" → 攻击动词前缀裸形（"攻击使对手烧伤"）
  { id: "e9-al-02",
    re: new RegExp(`^(?:攻击|攻击技能|出手)(?:使|令)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }),
  },
  // "(自身)?免疫异常状态和能力下降(状态)?" → immune_status + down_lock 复合
  { id: "e9-al-03",
    re: /^(?:自身|自己)?免疫异常(?:状态)?和(能力)?下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "down_lock", target: "self" }] }),
  },
  // "(自身)?免疫能力下降和异常(状态)?" → 倒序变体
  { id: "e9-al-04",
    re: /^(?:自身|自己)?免疫能力(?:下降|弱化)(?:状态)?和异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "down_lock", target: "self" }] }),
  },
  // "解除自身异常和能力下降" → cleanse ailment + clear_stages down（"解除…和…"连词变体）
  { id: "e9-al-05",
    re: /^解除(?:自身|自己)?(?:的)?异常(?:状态)?和(能力)?下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "ailment", target: "self" }, { op: "clear_stages", target: "self", sign: "down" }] }),
  },
  // "(N%)?令对手下只(出战|登场)精灵(进入)?AIL" → nextFoe ailment
  { id: "e9-al-06",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)下(?:一|1)?只(?:出战|出场|登场|出站)精灵进入?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "nextFoe" }] }),
  },
  // "攻击命中已处于AIL状态的对手时附加自身最大体力N/M固伤"——条件固伤无通道（无 flatSelfFracIf），如实留残

  // ── 触发/杂项 ────────────────────────────────────────────
  // "回合开始为自身附加X" 等回合头词形由 TURNS_PRE/既有规则收——此处收"回合开始时，若P则Y"粘连孤句
  // "自身当回合使用属性技能则下回合令对手无法通过自身技能恢复体力" → heal_block foe turns:1
  { id: "e9-mx-01",
    re: /^(?:下回合起?|下回合|当回合)?(?:令|使)?(?:对手|对方|敌方)无法通过自身技能恢复(?:自身|自己)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: 1 }] }),
  },
  // 裸形"无法通过自身技能恢复(自身)?体力"——"令对手下N回合"剥窗后余部（foeCtx 结转 → opponent）
  { id: "e9-mx-02",
    re: /^无法通过自身技能恢复(?:自身|自己)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent" }] }),
  },
  // "对手每有一只不在场精灵"类 per-unit——交还给 deferred（此处不发规则）
];
