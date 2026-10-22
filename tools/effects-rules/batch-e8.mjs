// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e8：魂印长尾第二批——免疫窗/吸取变体/固伤动态/PP 区间/承伤变体/能力转移/杂项 body。
import { NUM, num, frac, AILMENTS, AIL_RE, STAT_RE, STATS } from "./lex.mjs";
import { parseEffectText, condOf, reactWrap, resolveCond } from "../effects-parse.mjs";

const ALL_AIL = Object.values(AILMENTS);
// inner-parse 条件注入：递归解析 rest 并把 cond 合进每条 op 的 if
const gated = (rest, cond) => {
  const r = parseEffectText(rest);
  if (r.effects.length === 0) return { unparsedReason: "gated body unparsed" };
  for (const e of r.effects) e.if = resolveCond(e.if, cond);
  return r;
};

export const rules = [

  // ── 免疫/保护窗 ──────────────────────────────────────────
  // "免疫下N次受到的攻击伤害"/"抵挡一次攻击伤害" → dmg_immune count
  { id: "e8-im-01",
    re: new RegExp(`^(?:自身|自己)?免疫下?(${NUM})?次受到的攻击(?:技能)?(?:伤害)?$|^(?:自身|自己)?(?:可以)?抵挡一?(${NUM})?次攻击(?:技能)?(?:伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1] ?? m[2] ?? "1") } }] }),
  },
  // "免疫下N次受到的异常(状态)"/"免疫受到的1次异常状态" → immune_status count
  { id: "e8-im-02",
    re: new RegExp(`^(?:自身|自己)?免疫(?:下)?${NUM}次?受到?的?异常(?:状态)?$|^(?:自身|自己)?免疫受到?的?${NUM}次异常(?:状态)?$|^(?:自身|自己)?免疫下?${NUM}次异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[1] ?? m[2] ?? m[3]) } }] }),
  },
  // "免疫物理攻击(伤害)"/"免疫特殊攻击(伤害)" → 类别闪避窗
  { id: "e8-im-03",
    re: /^(?:自身|自己)?免疫(?:对手|对方|敌方)?的?物理攻击(?:伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "must_miss_phys", target: "self" }] }),
  },
  { id: "e8-im-04",
    re: /^(?:自身|自己)?免疫(?:对手|对方|敌方)?的?特殊攻击(?:伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "must_miss_spec", target: "self" }] }),
  },
  // "天生免疫AIL"/"免疫AIL(状态)（非all）" → 定向免疫 immune_status:ailment
  { id: "e8-im-05",
    re: new RegExp(`^(?:天生)?免疫(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", ailment: AILMENTS[m[1]], target: "self" }] }),
  },
  // ——下只精灵系列在 ./next-ally.mjs（须在 attach-damage-61 next-unit 兜底之前）——
  // "本场战斗自身免疫受到的(固定|百分比|固定伤害和百分比)伤害" → flat_immune
  // 含「秒杀」：秒杀在本项目用 damage{kind:"percent",power:100} 表达，
  // 因此免疫秒杀 = 免疫百分比伤害（同一 flat_immune 通道，不需要新 op）。
  { id: "e8-im-08",
    re: /^(?:本场战斗)?(?:自身|自己)?免疫(?:受到|所受)?的?(?:固定伤害和百分比伤害|百分比伤害和固定伤害|固定伤害|百分比伤害|秒杀|固定|固伤)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "flat_immune", target: "self" }] }),
  },
  // "N%免疫当回合受到的攻击伤害"/"N%的几率抵挡当回合受到的攻击伤害" → dmg_immune chance（当回合由 effTurns 注入 turns:1）
  { id: "e8-im-09",
    re: /^(\d+)%(?:的)?(?:几率|概率)?(?:免疫|抵挡)(?:当回合)?(?:自身|自己)?受到?的?攻击?(?:伤害)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: +m[1] }] }),
  },
  // "反弹免疫伤害的N%"/"反弹免疫伤害的N/M" → reflect_dmg（免疫掉的伤害回敬）
  { id: "e8-im-10",
    re: /^反弹免疫伤害(?:的)?(\d+)%$|^反弹免疫伤害(?:的)?(\d+)\s*\/\s*(\d+)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: m[1] !== undefined ? { n: +m[1], d: 100 } : { n: +m[2], d: +m[3] } }] }),
  },
  // "免疫对手下一次攻击伤害" → dmg_immune count:1
  { id: "e8-im-11",
    re: /^免疫(?:对手|对方|敌方)下(?:一|1)?次攻击(?:技能)?(?:伤害)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }] }),
  },
  // "若当回合受到攻击伤害后X" → 承伤守卫 + inner（"后"连词，condPrefix 只吃"则"）
  { id: "e8-im-12",
    re: /^(?:若)?(?:当|本)?回合(?:自身|自己)?受到(?:的)?攻击伤害后(.+)$/,
    go: (m) => gated(m[1], { not: { prevTakenZero: true } }),
  },
  // "双方在场精灵本场战斗免疫下1次受到的异常状态" → 双方 count:1
  { id: "e8-im-13",
    re: /^双方(?:在场)?精灵(?:本场战斗)?免疫下?(\d+)?次?受到?的?异常(?:状态)?$/,
    go: (m) => ({ effects: ["self", "opponent"].map((t) => ({ op: "apply_status", name: "immune_status", target: t, params: { count: +(m[1] ?? "1") } })) }),
  },
  // "首次登场前N回合免疫异常状态" → turns 窗（登场 hook 由魂印层承担）
  { id: "e8-im-14",
    re: new RegExp(`^(?:首次|初次)登场前(${NUM})回合免疫异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }] }),
  },

  // ── 恢复/吸取 ────────────────────────────────────────────
  // "(立刻|立即|马上)?恢复N点(体力|HP)"/"为自身恢复N点体力" → heal flat（前缀变体）
  { id: "e8-hl-01",
    re: /^(?:立刻|立即|马上|直接)?恢复(\d+)点(?:体力|HP)$|^为(?:自身|自己)恢复(\d+)点(?:体力|HP)$/,
    go: (m) => ({ effects: [{ op: "heal", flat: +(m[1] ?? m[2]), target: "self" }] }),
  },
  // "(使|令)自身恢复最大体力的N/M" → heal frac（使令前缀变体）
  { id: "e8-hl-02",
    re: new RegExp(`^(?:使|令|让)(?:自身|自己)恢复(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },
  // "(攻击)?恢复自身双防(之)?和的?N%的?体力" → heal defSumPct
  { id: "e8-hl-03",
    re: /^(?:攻击)?恢复(?:自身|自己)双防(?:之)?和的?(\d+)%(?:的)?体力$/,
    go: (m) => ({ effects: [{ op: "heal", defSumPct: +m[1], target: "self" }] }),
  },
  // "伤害量(的)?N/M恢复自身体力" → 伤害分流回血（attachDamage.drain——魂印层折算 drain_atk）
  { id: "e8-hl-04",
    re: new RegExp(`^伤害量(?:的)?${NUM}\\s*/\\s*${NUM}恢复(?:自身|自己)?体力$`),
    go: (m) => ({ attachDamage: { drain: frac(num(m[1]), num(m[2])) } }),
  },
  // "(吸取|吸收)对手N/M的?(当前)?体力" → percent(current) + heal frac
  { id: "p2-drain-03",
    re: /^(?:吸收|吸取)(?:对方|对手|敌方)(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))分之(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))(?:的)?(?:最大)?体力$/,
    go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(num(m[3]), num(m[1])), percentBase: "current" }, { op: "heal", numerator: num(m[3]), denominator: num(m[1]), target: "self" }] }),
  },
  { id: "e8-hl-05",
    re: new RegExp(`^(?:吸取|吸收)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}的?(?:当前)?体力$`),
    go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(num(m[1]), num(m[2])), percentBase: "current" }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },
  // "(吸取|吸收)对手已损失体力的N/M" → flatFoeFrac missing + drain 1/1（扣多少回多少）
  { id: "e8-hl-06",
    re: new RegExp(`^(?:吸取|吸收)(?:对手|对方|敌方)已损失体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatFoeFrac: { base: "missing", numerator: num(m[1]), denominator: num(m[2]) }, drain: frac(1, 1) }] }),
  },
  // "(吸取|吸收)对手N/M最大体力" → 吸收动词变体
  // 「最大HP / 最大生命值」是「最大体力」的另两种写法（pet-2929「每2回合吸收对手1/3最大HP」）。
  // 注意这条必须留在 batch-e8：**不要**把「吸收」放进更靠前的 batch-e6-121——
  // 那条产出 heal missing（以已损失体力为基线），语义与本条不同，抢先匹配会退化。
  { id: "e8-hl-07",
    re: new RegExp(`^吸收(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}最大(?:体力|HP|生命值)$`),
    go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(num(m[1]), num(m[2])) }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },
  // "吸取对手伤害值N%的体力" → 出伤分流（attachDamage.drain——常驻 drain_atk 折算）
  { id: "e8-hl-08",
    re: /^吸取(?:对手|对方|敌方)?伤害值(\d+)%(?:的)?体力$/,
    go: (m) => ({ attachDamage: { drain: frac(+m[1], 100) } }),
  },
  // "(自身)攻击(技能)?吸取对手最大体力N/M" → 攻击限定变体（攻击语义词由触发层承担）
  { id: "e8-hl-09",
    re: new RegExp(`^(?:自身|自己)?攻击(?:技能)?(?:吸取|吸收)(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(num(m[1]), num(m[2])) }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }),
  },
  // "属性技能(吸取|吸收)对手N点体力" → 类别主语剥除走内解析（cat 限制由魂印层 entry.cat 承担，standalone 语境下该类招式即本招）
  { id: "e8-hl-10",
    re: /^(?:属性|攻击)技能((?:吸取|吸收).+)$/,
    go: (m) => { const r = parseEffectText(m[1]); return r.effects.length === 0 ? { unparsedReason: "cat-subject body unparsed" } : r; },
  },
  // "对手N回合(内)无法(通过自身技能)?恢复(自身)?体力" → heal_block turns（"无法恢复自身体力"变体）
  { id: "e8-hl-11",
    re: new RegExp(`^(?:对手|对方|敌方)(${NUM})回合(?:内)?无法(?:通过自身技能)?恢复(?:自身|自己)?体力$|^(?:使|令)(?:对手|对方|敌方)(${NUM})回合(?:内)?无法恢复体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: num(m[1] ?? m[2]) }] }),
  },
  // "恢复N-M点体力并附加等量固伤" → heal flatRange + flatSelfLastHeal（等量=回复量100%）
  { id: "e8-hl-12",
    re: /^(?:随机)?恢复(\d+)\s*[-~～—]\s*(\d+)点体力并附加等量(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ effects: [{ op: "heal", flatRange: { min: +m[1], max: +m[2] }, target: "self" }, { op: "damage", kind: "fixed", power: 0, flatSelfLastHeal: true }] }),
  },
  // "附加等同(于)?恢复量的固定伤害" → flatSelfLastHeal（当次回复量固伤——本招 heal 已结算语义近似）
  { id: "e8-hl-13",
    re: /^附加等同(?:于|与)?恢复量的固定伤害$/,
    go: () => ({ attachDamage: { flatSelfLastHeal: true } }),
  },
  // "受到致命(一击|伤害)残留N点(HP|体力)"/"保留N点体力" → endure
  { id: "e8-hl-14",
    re: /^受到致命[一1]?击?残留(\d+)点(?:HP|体力)$|^(?:残留|保留|余下|留下)(\d+)点(?:HP|体力|生命)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: +(m[1] ?? m[2]) } }] }),
  },

  // ── 固伤/百分比 ──────────────────────────────────────────
  // "追加N点固定伤害" → flatBonus
  { id: "e8-ft-01",
    re: /^追加(\d+)点(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatBonus: +m[1] } }),
  },
  // "追加对手最大体力N/M的固定伤害" → flatFoeFrac（追加≈附加同义；"使用物理攻击追加…"触发层管命中语境）
  { id: "e8-ft-02",
    re: new RegExp(`^(?:追加|附加)(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFrac: { numerator: ns[ns.length - 2], denominator: ns[ns.length - 1], base: "max" } } }; },
  },
  // "附加自身双防(能力值)?总和N%的(固定伤害|固伤)" → flatSelfDefSumPct
  { id: "e8-ft-02b",
    re: /^(?:附加|附带)(?:自身|自己)双防(?:能力值)?总和(?:的)?(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatSelfDefSumPct: +m[1] } }),
  },
  // "附加对手攻击值N%的固定伤害" → flatFoeStatPct
  { id: "e8-ft-03",
    re: new RegExp(`^附加(?:对手|对方|敌方)(${STAT_RE})值(?:的)?(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatFoeStatPct: { stat: STATS[m[1]], pct: +m[2] } } }),
  },
  // "附加(相当于)?(本次|当回合|当次)攻击(造成)?伤害值?N%的(固定伤害|固伤)" → flatSelfLastDmgPct
  { id: "e8-ft-04",
    re: /^附加(?:相当于|等同于|等于)?(?:本次|当回合|当次|该次)?攻击?(?:造成)?的?伤害(?:值|数值)?(?:的)?(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatSelfLastDmgPct: +m[1] } }),
  },
  // "附加伤害值N%的固定伤害" → flatSelfLastDmgPct（"伤害值"=当次出伤）
  { id: "e8-ft-05",
    re: /^附加(?:所|当次)?(?:造成)?伤害值(?:的)?(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatSelfLastDmgPct: +m[1] } }),
  },
  // "附加对手(上次|上回合)造成(的)?(攻击)?伤害(数值|值)?N%的固定伤害" → flatPrevTakenPct（对手上次打我们的伤害）
  { id: "e8-ft-06",
    re: /^附加(?:对手|对方|敌方)(?:上次|上回合)造成(?:的)?(?:攻击)?伤害(?:数值|值)?(?:的)?(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatPrevTakenPct: +m[1] } }),
  },
  // "附加对手已损失体力N/M的(固定|固伤)" → flatFoeFrac missing（独立 damage 窗——standalone 也可结算）
  { id: "e8-ft-07",
    re: new RegExp(`^附加(?:对手|对方|敌方)已损失体力值?${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$|^附加(?:对手|对方|敌方)已损失体力值?(?:的)?(\\d+)%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatFoeFrac: { base: "missing", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? 100) } }] }),
  },
  // "自身攻击(技能)?随机附加N-M点固定伤害" → flatRange
  { id: "e8-ft-08",
    re: /^(?:自身|自己)?(?:攻击|攻击技能)?(?:随机)?附加(\d+)\s*[-~～—]\s*(\d+)点(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatRange: { min: +m[1], max: +m[2] } } }),
  },
  // "攻击命中附加对手最大体力N/M的固定伤害" → flatFoeFrac（命中语义由触发层承担）
  { id: "e8-ft-09",
    re: new RegExp(`^(?:攻击)?命中后?附加(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }),
  },
  // "攻击附加自身最大体力N/M的固定伤害" → flatSelfFrac
  { id: "e8-ft-10",
    re: new RegExp(`^(?:攻击)?附加(?:自身|自己)最大体力${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }),
  },
  // "令对手受到自身最大体力N%的固定伤害" → flatSelfPct 独立 damage
  // 「最大体力值」是同一说法的两种写法（pet-4088「令对手受到自身最大体力值30%的固定伤害」），
  // 字符类一并收，语义不变。
  { id: "e8-ft-11",
    re: /^(?:令|使)(?:对手|对方|敌方)受到(?:自身|自己)最大体力(?:值)?(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfPct: +m[1] }] }),
  },
  // "对手受到自身已损失HP的N倍伤害" → flatSelfFrac missing ×N
  { id: "e8-ft-12",
    re: new RegExp(`^(?:对手|对方|敌方)受到(?:自身|自己)已损失(?:HP|体力)(?:的)?(${NUM})倍(?:的)?伤害$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, flatSelfFrac: { base: "missing", numerator: num(m[1]), denominator: 1 } }] }),
  },
  // "对手每处于1种能力提升状态则附加N点固伤" → flatFoeStageUpCountMul（foe 侧 perStage）
  { id: "e8-ft-13",
    re: /^(?:对手|对方|敌方)每处于(?:1|一)种能力(?:提升|强化)(?:状态)?则?附加(\d+)点(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatFoeStageUpCountMul: +m[1] } }),
  },
  // "自身每处于1种能力提升(状态)?则(攻击)?附加N点(固定|固伤)" → flatStageUpCountMul
  { id: "e8-ft-14",
    re: /^(?:自身|自己)每处于(?:1|一)?种?能力(?:提升|强化)(?:状态)?则?(?:攻击|攻击技能|攻击命中后)?附加(\d+)点(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatStageUpCountMul: +m[1] } }),
  },
  // "50%的几率附加本次攻击造成伤害值N%的固定伤害" 句中几率变体由 bcm 句首通道覆盖——补"几率附加"连体
  { id: "e8-ft-15",
    re: /^(\d+)%(?:的)?(?:几率|概率)附加(?:本次|当次)?攻击?造成(?:的)?伤害值(?:的)?(\d+)%(?:的)?(?:固定伤害|固伤)$|^有?(\d+)%(?:的)?(?:几率|概率)?附加攻击伤害(\d+)%(?:的)?(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatSelfLastDmgPct: +(m[2] ?? m[4]), flatChance: +(m[1] ?? m[3]) } }),
  },
  // "本次攻击(造成)?(的)?伤害提升N%"/"当次攻击造成的伤害提升N%" → 当次出伤倍率（attachDamage.mul 等价提升）
  { id: "e8-ft-16",
    re: /^(?:本次|当次|该次)攻击(?:造成)?的?伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ attachDamage: { mul: frac(100 + +m[1], 100) } }),
  },
  // "直到下场自身造成的攻击伤害提升N%" → 常驻 dmg_boost（下场语义=不换场常驻）
  { id: "e8-ft-17",
    re: /^直到下场(?:自身|自己)?造成的?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "(自身)攻击(技能)?无视对手能力提升状态" → pierce_stages
  { id: "e8-ft-18",
    re: /^(?:自身|自己)?(?:攻击|攻击技能|所有攻击技能)?无视(?:对手|对方|敌方)能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }),
  },
  // "拥有者额外受到伤害值N%的百分比伤害" → pct_taken_pct（拥有者=持有者自身）
  { id: "e8-ft-19",
    re: /^拥有者额外受到伤害值(\d+)%(?:的)?百分比伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "pri_taken_pct", target: "self", params: { pct: +m[1] } }] }),
  },

  // ── 承伤 ────────────────────────────────────────────────
  // "本次(攻击)?(受到)?伤害减少N点"/"收到的伤害减少N%" → dmg_reduce/dmg_taken_down 变体
  { id: "e8-tk-01",
    re: /^本次(?:攻击)?(?:受到)?的?伤害减少(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: +m[1] } }] }),
  },
  { id: "e8-tk-02",
    re: /^(?:收到|所受)(?:的)?(?:攻击)?伤害减少(\d+)%$|^减少(\d+)%(?:的)?伤害量?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +(m[1] ?? m[2]) } }] }),
  },
  // "造成攻击伤害减少N%"——"减少攻击伤害"歧形（=出伤减免 UNVERIFIED→承伤减少）
  { id: "e8-tk-03",
    re: /^造成攻击伤害减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] } }] }),
  },
  // "体力低于对手受到的伤害减少N%" → 守卫 dmg_taken_down（无连词直接粘连）
  { id: "e8-tk-04",
    re: /^体力低于对手受到?的?(?:攻击)?伤害减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: +m[1] }, if: { selfHpBelowFoe: true } }] }),
  },
  // "使对手本回合造成的伤害减少N%" → 对手出伤压制（dmg_boost 负 pct 压对手）
  { id: "e8-tk-05",
    re: /^(?:使|令)(?:对手|对方|敌方)本回合造成(?:的)?伤害减少(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "opponent", turns: 1, params: { pct: -num(m[1]) } }] }),
  },
  // "减少对手N/M(的)?体力"/"减少N/N(最大)?HP" → percent 直接削减
  { id: "e8-tk-06",
    re: new RegExp(`^减少(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:的)?(?:体力|HP)$|^减少${NUM}\\s*/\\s*${NUM}(?:最大)?(?:HP|体力)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", power: 1, kind: "percent", frac: frac(ns[0], ns[1]) }] }; },
  },
  // "对手攻击伤害减半" → 承伤减半（对手打我们的伤害）
  { id: "p2-tk-08",
    re: /^(?:对手|对方|敌方)(?:的)?(?:造成的|造成)的?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] }),
  },
  { id: "p2-tk-09",
    re: /^(?:自身|自己)?受到(?:的)?(?:所有|全部)?(?:攻击)?伤害(?:降低|减少|下降)1\/2$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] }),
  },
  { id: "e8-tk-07",
    re: /^(?:对手|对方|敌方)(?:的)?攻击伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] }),
  },
  // "下N次受到的伤害不超过M"/"受到第N次伤害不超过M" → dmg_cap count（NUM 自带捕获组——slice 过滤取数）
  { id: "e8-tk-08",
    re: new RegExp(`^(?:受到第${NUM}次|下${NUM}次受到|自身受到的下?${NUM}次)(?:的)?(?:攻击)?伤害不超过(\\d+)(?:点)?$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map((x) => +x); return { effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: ns[ns.length - 1], count: ns.length > 1 ? ns[0] : 1 } }] }; },
  },
  // "50%下一次受到的伤害减少N点" → chance dmg_reduce（"50%下"连写 bcm 不吃——整句匹配）
  { id: "e8-tk-09",
    re: /^(\d+)%(?:的)?(?:几率|概率)?下(?:一|1)?次受到?的?(?:攻击)?伤害减少(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", chance: +m[1], params: { flat: +m[2], count: 1 } }] }),
  },
  // "自身100%闪避对手的下N次攻击技能" → must_miss（次数没人读，不发 count）
  { id: "e8-tk-10",
    re: new RegExp(`^(?:自身|自己)(\\d+)%闪避(?:对手|对方|敌方)的下?(${NUM})?次?攻击(?:技能)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", ...(num(m[1]) < 100 ? { chance: +m[1] } : {}) }] }),
  },

  // ── PP ──────────────────────────────────────────────────
  // "清除对手所有PP"/"(N%)?将对手所有pp降为0" → pp_delta zero all（N% 由 bcm 剥离注入 chance——两种形态都收）
  { id: "e8-pp-01",
    re: /^清除(?:对手|对方|敌方)(?:所有|全部)(?:技能)?(?:的)?PP(?:值)?$|^(?:(\d+)%(?:的)?(?:几率|概率)?)?(?:将|把|令|使)(?:对手|对方|敌方)(?:所有|全部)(?:技能)?(?:的)?[pP]{2}(?:值)?降为0$/,
    go: (m) => ({ effects: [{ op: "pp_delta", zero: true, target: "opponent", scope: "all", ...(m[1] !== undefined ? { chance: +m[1] } : {}) }] }),
  },
  // "(自身)?(释放|使用)技能N%不消耗PP" → pp_free chance
  { id: "e8-pp-02",
    re: /^(?:自身|自己)?(?:释放|使用)(?:攻击|攻击技能|属性)?技能(\d+)%(?:的)?(?:几率|概率)?不(?:再)?消耗(?:技能)?PP(?:值)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self", chance: +m[1] }] }),
  },
  // "(使用技能)?不受PP值限制" → pp_free
  { id: "e8-pp-03",
    re: /^(?:自身|自己)?(?:使用技能)?不(?:再)?受(?:到)?PP值?限制$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }),
  },
  // "(使|令)对手(下回合)?(使用技能)?所消耗(的)?PP值为N倍"/"消耗PP值翻倍" → pp_mul opponent（ppCostMul params 通道；NUM 自带捕获——slice 过滤）
  { id: "e8-pp-04",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:下回合|当回合)?(?:使用|释放)?技能所?消耗?(?:的)?PP值?为?${NUM}倍$|^(?:对手|对方|敌方)(?:使用|释放)?技能(?:的)?PP值?消耗为?${NUM}倍$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: "opponent", params: { mul: num(m.slice(1).find((x) => x !== undefined)) } }] }),
  },
  // "(使|令)对手所有技能PP(值)?随机减少N-M点" → pp_delta amountRange foe
  { id: "e8-pp-05",
    re: /^(?:使|令|降低)?(?:对手|对方|敌方)(?:所有|全部)技能(?:的)?(?:PP值?)?(?:随机)?(?:减少|降低|扣除)(\d+)\s*[-~～—]\s*(\d+)点(?:PP|pp)?(?:值)?$/,
    go: (m) => ({ effects: [{ op: "pp_delta", amountRange: { min: -num(m[2]), max: -num(m[1]) }, target: "opponent", scope: "all" }] }),
  },
  // "(自身|对手)随机N个技能PP值±K" → amountRandom（NUM 自带捕获——不再外包括号）
  { id: "e8-pp-06",
    re: new RegExp(`^(?:自身|自己)随机${NUM}个?(?:属性)?技能PP值?([+-])${NUM}$|^(?:对手|对方|敌方)随机${NUM}个?(?:属性)?技能PP值?([+-])${NUM}$`),
    go: (m) => { const foe = m[4] !== undefined; const sg = (foe ? m[5] : m[2]) === "-" ? -1 : 1; return { effects: [{ op: "pp_delta", amountRandom: { count: num(m[1] ?? m[4]), delta: sg * num(m[3] ?? m[6]) }, target: foe ? "opponent" : "self" }] }; },
  },
  // "(攻击|攻击技能)?(令|使)对手随机N个技能PP值归零" → 攻击动词前缀变体（NUM 自带捕获）
  { id: "e8-pp-07",
    re: new RegExp(`^(?:攻击|攻击技能)?(?:使|令)?(?:对手|对方|敌方)随机${NUM}个?(?:属性)?技能(?:的)?PP值?归(?:零|0)$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }),
  },
  // "(恢复)?随机N个技能M点PP值" → amountRandom 正增量（无 ± 号的恢复形——"随机2个技能1点PP值"）
  { id: "e8-pp-08b",
    re: new RegExp(`^(?:恢复|回复)?随机${NUM}个?技能${NUM}点PP值?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amountRandom: { count: num(m[1]), delta: num(m[2]) }, target: "self" }] }),
  },
  // "恢复自身最大体力N/M和随机K个技能J点PP值" → 复合（NUM 自带捕获——索引顺排）
  { id: "e8-pp-08",
    re: new RegExp(`^恢复(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}和随机${NUM}个技能${NUM}点PP值?$`),
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }, { op: "pp_delta", amountRandom: { count: num(m[3]), delta: num(m[4]) }, target: "self" }] }),
  },

  // ── 能力 ────────────────────────────────────────────────
  // "(吸取|吸收)对手(速度|攻击|…)(能力)?(提升|上升)" → 定向吸级（steal+stat/sign 过滤）
  { id: "e8-st-01",
    re: new RegExp(`^(?:吸取|吸收)(?:对手|对方|敌方)(?:的)?(${STAT_RE})(?:能力)?(?:提升|上升|强化)(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "transfer_stages", direction: "steal", stat: STATS[m[1]], sign: "up" }] }),
  },
  // "(能)?(吸取|吸收)对手能力提升(状态)?" → 全维吸强
  { id: "e8-st-02",
    re: /^(?:能)?(?:吸取|吸收)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "steal" }] }),
  },
  // "(将|把)自身(相应)?能力(提升)?(赋予|附加|转移)给对手(相应)?能力下降" → upToDown
  { id: "e8-st-03",
    re: /^(?:之后)?(?:将|把)(?:自身|自己)(?:的)?(?:相应)?能力(?:提升|强化)?(?:状态)?(?:赋予|附加|转移|给予)给(?:对手|对方|敌方)(?:相应)?的?能力?下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "upToDown" }] }),
  },
  // "(自身)(所有|全部)?能力下降(反转|翻转)为(能力)?(上升|提升)" → invert_stages down
  { id: "e8-st-04",
    re: /^(?:自身|自己)?(?:所有|全部)?能力下降(?:状态)?反转(?:成|为)(?:能力)?(?:上升|提升)(?:状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }),
  },
  // "(提升|上升)至对手能力等级"/"使自身能力等级与对手相同" → copy_stages match self
  { id: "e8-st-05",
    re: /^(?:提升|上升|提高)至(?:对手|对方|敌方)能力等级$|^(?:使|令)(?:自身|自己)(?:所有|全部)?能力等级与(?:对手|对方|敌方)相同$/,
    go: () => ({ effects: [{ op: "copy_stages", match: true, target: "self" }] }),
  },
  // "解除自身能力下降及异常状态" → clear down + cleanse ailment（"及"连词变体）
  { id: "e8-st-06",
    re: /^解除(?:自身|自己)?(?:的)?能力下降(?:状态)?(?:及|与|和|、)(?:所有|全部)?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }, { op: "cleanse", scope: "ailment", target: "self" }] }),
  },
  // "自身所有能力值提升N点" → 全维+N（ALL_STATS 展开——值=等级 UNVERIFIED）
  { id: "e8-st-07",
    re: new RegExp(`^(?:自身|自己)(?:所有|全部)能力(?:值|等级)?(?:提升|增加|上升)(${NUM})(?:点|级)?$`),
    go: (m) => ({ effects: ["atk", "def", "spa", "sdf", "spd"].map((stat) => ({ op: "apply_stat_stage", stat, delta: num(m[1]), target: "self" })) }),
  },
  // "自身使用攻击时随机令自身N项属性+K" → 随机升（NUM 自带捕获——索引顺排）
  { id: "e8-st-08",
    re: new RegExp(`^(?:自身|自己)?(?:使用)?攻击?时?随机(?:令|使)(?:自身|自己)${NUM}项属性([+-])${NUM}$|^随机令(?:自身|自己)${NUM}项属性([+-])${NUM}$`),
    go: (m) => { const i = m[4] !== undefined ? 4 : 1; return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[i]), delta: (m[i + 1] === "-" ? -1 : 1) * num(m[i + 2]), target: "self" }] }; },
  },
  // "随机令对手或自身随机N项属性+K" → 随机双方目标——近似对手侧（"或"择一 UNVERIFIED→对手）
  { id: "e8-st-09",
    re: new RegExp(`^随机令(?:对手|对方|敌方)或(?:自身|自己)随机${NUM}项属性([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[1]), delta: (m[2] === "-" ? -1 : 1) * num(m[3]), target: "opponent" }] }),
  },
  // "随机吸取对手N-M项属性-1" → steal countRange（NUM 自带捕获）
  { id: "e8-st-10",
    re: new RegExp(`^随机(?:吸取|吸收)(?:对手|对方|敌方)${NUM}\\s*[-~～—]\\s*${NUM}项(?:属性|能力)(?:等级)?-?${NUM}?$`),
    go: (m) => ({ effects: [{ op: "transfer_stages", randomCount: num(m[1]), randomCountRange: { min: num(m[1]), max: num(m[2]) }, randomDelta: num(m[3] ?? "1") }] }),
  },
  // "使对手和自身的能力等级发生随机的改变" → 双方随机各1 ±1（"随机改变"幅度不明 UNVERIFIED→±1 随机项）
  // —— 幅度缺数字：留残
  // "解除自身能力下降状态" → clear_stages down self（"解除"动词变体）
  { id: "e8-st-11",
    re: /^解除(?:自身|自己)?(?:的)?能力下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }),
  },

  // ── 异常 ────────────────────────────────────────────────
  // "(所有|自身)攻击N%令对手AIL" → 命中异常窗（"所有攻击30%令对手害怕"——攻击语境由外层 hook 承担）
  { id: "e8-al-01",
    re: new RegExp(`^(?:所有|全部|自身|自己)?(?:攻击|攻击技能|技能)?(\\d+)%(?:的)?(?:几率|概率)?(?:使|令)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "自身所有技能有N%(使|令)得?对手AIL" → 技能异常窗
  { id: "e8-al-02",
    re: new RegExp(`^(?:自身|自己)(?:所有|全部)?技能有?(\\d+)%(?:的)?(?:几率|概率)?(?:使|令)得?(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "(吸收|吸取|消除|命中)成功N%令对手AIL" → prevApplied 守卫 + 异常
  { id: "e8-al-03",
    re: new RegExp(`^(?:吸收|吸取|消除|命中|解除)成功(\\d+)%(?:的)?(?:几率|概率)?(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1], if: { prevApplied: true } }] }),
  },
  // "使对手N%(几率)?随机进入一种异常状态" → random ailment（NUM 自带捕获）
  { id: "e8-al-04",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)${NUM}%(?:的)?(?:几率|概率)?随机进入${NUM}种异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AIL, count: num(m[2]) }, chance: num(m[1]) }] }),
  },
  // "(自身)?(下次|下次攻击)?使对手随机进入N?种异常状态" → random
  { id: "e8-al-05",
    re: new RegExp(`^(?:自身|自己)?(?:下次|下1次|下次攻击)?(?:使|令)(?:对手|对方|敌方)随机进入${NUM}?种?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AIL, count: num(m[1] ?? "1") } }] }),
  },
  // "(N%几率)?(使|令)?对手随机进入AIL1、AIL2、AIL3(的N种异常(状态)?)?" 列举池（"异常状态"尾缀可缺省）
  { id: "e8-al-06",
    re: new RegExp(`^(?:${NUM}%)?(?:的)?(?:几率|概率)?(?:使|令)?(?:对手|对方|敌方)?随机(?:进入|陷入)((?:${AIL_RE})(?:[、,，和或](?:${AIL_RE}))+)(?:中|之中)?的?(?:${NUM}种)?(?:异常)?(?:状态)?$`),
    go: (m) => {
      const list = (m[2] ?? "").match(new RegExp(AIL_RE, "g"))?.map((x) => AILMENTS[x]).filter(Boolean) ?? [];
      if (list.length < 2) return { unparsedReason: `ailment pool unparsed: ${m[0]}` };
      const pct = m[1] !== undefined ? +m[1] : m[0].match(/^(\d+)%/)?.[1];
      return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: [...new Set(list)], count: 1 }, ...(pct !== undefined ? { chance: +pct } : {}) }] };
    },
  },
  // "自身受到攻击(伤害)?N%令对手AIL" → reactWrap 受击
  { id: "e8-al-07",
    re: new RegExp(`^(?:自身|自己)?受到攻击(?:伤害)?(\\d+)%(?:的)?(?:几率|概率)?(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const r = reactWrap(1, {}, `令对手${m[2]}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = +m[1]; return r; },
  },
  // "每次受到攻击N%使对手AIL" → reactWrap（"每次受到"节律变体）
  { id: "e8-al-08",
    re: new RegExp(`^每次受到(?:的)?攻击(\\d+)%(?:的)?(?:几率|概率)?(?:使|令)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const r = reactWrap(1, {}, `令对手${m[2]}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = +m[1]; return r; },
  },
  // "50%解除自身所有异常" → cleanse ailment chance
  { id: "e8-al-09",
    re: /^(\d+)%(?:的)?(?:几率|概率)?解除(?:自身|自己)(?:所有|全部)?异常(?:状态)?$/,
    go: (m) => ({ effects: [{ op: "cleanse", scope: "ailment", target: "self", chance: +m[1] }] }),
  },
  // 自解异常：旧名 cleanse_self_ail，窗口 15（WIN.cleanseSelfAil）。
  { id: "e8-al-10",
    re: /^每回合解除(?:自身|自己)?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 15 }, payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }] }] }),
  },

  // ── 回合/切换 ────────────────────────────────────────────
  // "对手下N次(攻击|属性)技能无效"/"令对手当前使用技能无效" → move_null count
  { id: "e8-tn-01",
    re: new RegExp(`^(?:对手|对方|敌方)下(?:${NUM})?次(?:使用)?(攻击|属性)技能无效$|^(?:对手|对方|敌方)下(?:${NUM})?次技能无效$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { ...(m[2] === "属性" ? { cat: 1 } : m[2] === "攻击" ? { cat: 4 } : {}), count: num(m[1] ?? m[3] ?? "1") } }] }),
  },
  // "令对手当前使用技能无效"/"对手当回合技能失效" → move_null 当回合
  { id: "e8-tn-02",
    re: /^(?:令|使)(?:对手|对方|敌方)当前(?:使用)?(?:的)?技能无效$|^(?:对手|对方|敌方)当回合(?:使用)?(?:的)?技能(?:无效|失效)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1 }] }),
  },
  // "使对手下N次技能先制-K" → prio_count 对手侧（NUM 自带捕获——索引顺排）
  { id: "e8-tn-03",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下${NUM}?次技能先制([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "opponent", params: { add: (m[2] === "-" ? -1 : 1) * num(m[3]), count: num(m[1] ?? "1") } }] }),
  },
  // "对手受到的伤害不少于N点" → dmg_out_floor（我方出伤下限）
  { id: "e8-tn-04",
    re: /^(?:对手|对方|敌方)受到(?:的)?伤害不少于(\d+)点$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", params: { min: +m[1] } }] }),
  },
  // "忽略对手防御值的N%" → ignore_def（"防御值"变体）
  // 「攻击」作主语是常驻语义（"攻击忽略对手防御值的20%"＝每次攻击都无视），
  // 与「下次攻击忽略…」的次数窗（heal-226，count:1）不是一回事，故此处不挂 count。
  { id: "e8-tn-05",
    re: /^(?:自身|自己)?(?:所有)?(?:攻击|攻击技能)?忽略(?:对手|对方|敌方)防御值(?:的)?(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: +m[1] } }] }),
  },
  // "自身所有攻击技能威力提升N%"/"攻击技能威力提升N%" → power_mul flag
  { id: "e8-tn-06",
    re: /^(?:自身|自己|所有|全部)?(?:攻击|攻击技能|技能|所有攻击技能|所有技能)威力(?:提升|提高|增加)(\d+)%$/,
    go: (m) => ({ attachDamage: { powerMul: frac(100 + +m[1], 100) } }),
  },
  // "(所有|攻击)?(技能)?威力翻倍" → powerMul 2×
  { id: "e8-tn-07",
    re: /^(?:所有|全部|攻击|自身|自己)?(?:攻击|技能|攻击技能)?威力翻倍$/,
    go: () => ({ attachDamage: { powerMul: frac(2, 1) } }),
  },
  // "(N%的几率)?造成N%的伤害" → 随机倍率（bcm 剥率注入 chance；"的几率"/裸"造成N%伤害"都吃；整除→dmg_mul，否则 dmg_boost pct）
  { id: "e8-tn-08",
    re: /^(?:(\d+)%(?:的)?)?(?:(?:的)?(?:几率|概率))?造成(\d+)%(?:的)?伤害$/,
    go: (m) => { const mul = +m[2] / 100; const ch = m[1] !== undefined ? { chance: +m[1] } : {}; return Number.isInteger(mul) ? { effects: [{ op: "apply_status", name: "dmg_mul", target: "self", ...ch, params: { mul } }] } : { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", ...ch, params: { pct: +m[2] - 100 } }] }; },
  },
  // "(N%)?造成A-B倍伤害" → 倍率区间→dmg_boost pctMin/pctMax（chance 由 bcm 注入）
  { id: "e8-tn-09",
    re: /^(?:(\d+)%(?:的)?(?:几率|概率)?)?造成(\d+)\s*[-~～—]\s*(\d+)倍伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", ...(m[1] !== undefined ? { chance: +m[1] } : {}), params: { pctMin: (+m[2] - 1) * 100, pctMax: (+m[3] - 1) * 100 } }] }),
  },
  // "自身下次攻击技能造成的伤害翻倍"/"下次攻击造成N倍伤害" → dmg_mul（count 没人读）
  { id: "e8-tn-10",
    re: /^(?:自身|自己)?下(?:一|1)?次(?:攻击|攻击技能)?造成(?:的)?(?:攻击)?伤害翻倍$|^(?:自身|自己)?下(?:一|1)?次攻击造成(\d+)倍伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: m[1] !== undefined ? +m[1] : 2 } }] }),
  },
  // "(在)?本次战斗(中)?(自身)?(造成的)?攻击?伤害(提高|提升|增加)N%" → 常驻 dmg_boost（本场战斗=不换场窗）
  { id: "e8-tn-11",
    re: /^(?:自身|自己)?(?:在)?本次战斗(?:中|内)?(?:的)?(?:自身|自己)?(?:造成)?(?:的)?(?:攻击)?伤害(?:提高|提升|增加)(\d+)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: +m[1] } }] }),
  },
  // "(所有|全部)攻击技能翻倍" → dmg_mul 2
  { id: "e8-tn-12",
    re: /^(?:所有|全部)(?:攻击|攻击技能|技能)?(?:的)?伤害?翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", params: { mul: 2 } }] }),
  },
  // "(将|把)受到(的)?伤害的N%反馈给对手" → reflect_dmg
  { id: "e8-tn-13",
    re: /^(?:将|把)?受到(?:的)?伤害(?:的)?(\d+)%(?:的)?反馈给(?:对手|对方|敌方)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: +m[1], d: 100 } }] }),
  },
  // "对手使用技能消耗PP值翻倍"已收 e7-pp-10 —— "所消耗的PP值为N倍"无主语残句不猜
  // "提升状态被消除则对手AIL" → trigger 7 reactWrap（被消除谓词 condOf 无 → 显式规则）
  { id: "e8-tn-14",
    re: new RegExp(`^(?:自身|自己)?(?:的)?能力(?:提升|强化)(?:状态)?被消除(?:时|后|则)?(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => reactWrap(7, {}, `令对手${m[1]}`),
  },
  // "(自身)?攻击(技能)?打出致命一击则令对手随机N个技能PP值归零" → prevCrit 守卫
  { id: "e8-tn-15",
    re: new RegExp(`^(?:自身|自己)?(?:攻击|攻击技能)?(?:打出|造成)致命[一1]?击则(?:令|使)(?:对手|对方|敌方)随机(${NUM})个?(?:属性)?技能PP值?归(?:零|0)$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent", if: { prevCrit: true } }] }),
  },
  // "自身所处异常状态回合数-N" → ailment 时长减——运行时有 ailment turns 缩短通道？检查：无→留残
  // "令对手所有异常状态回合数变为N回合" → 异常时长覆写——unmodeled→留残
];
