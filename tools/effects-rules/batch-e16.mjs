// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e16：魂印长尾第十批——护盾量词/护盾值固伤/免疫变体/锁强化/禁换/随机异常/技能无效。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_AILS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 护盾 ────────────────────────────────────────────────
  // "(获得|附加)(一个)?N点(生命值)?(的)?护盾" → shield flat（"获得一个300点生命值的护盾"）
  { id: "e16-sh-01",
    re: new RegExp(`^(?:使|令|为|给)?(?:自身|自己)?(?:获得|附加)(?:一个|一道|一层)?${NUM}点?(?:生命值|体力值)?(?:的)?护盾$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1]) } }] }),
  },
  // "N点护盾和M点护罩" → shield+shield（护罩=护盾别名）
  { id: "p2-prot-01",
    re: /^(?:可以?|可)?完全(?:抵挡|抵抗|阻挡|低档|挡下)(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))?(?:次|回)?(?:的)?(?:攻击|伤害)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "protect", target: "self", params: { count: m[1] !== undefined ? num(m[1]) : 1 } }] }),
  },
  { id: "e16-sh-02",
    re: new RegExp(`^${NUM}点护盾和${NUM}点护罩$|^(?:获得|附加)${NUM}点(?:的)?护盾(?:,|，|和|及)${NUM}点(?:的)?护罩$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[0] } }, { op: "apply_status", name: "shield", target: "self", params: { flat: ns[1] ?? ns[0] } }] }; },
  },
  // "附加(一个)?等同于自身体力值N%的护盾" → shield fracMaxHp（"体力值"变体）
  { id: "e16-sh-03",
    re: /^(?:为|给|令|使)?(?:自身|自己)?附加(?:一个)?等同于(?:自身|自己)?体力值?的?(\d+)%(?:的)?护盾$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { fracMaxHpN: +m[1], fracMaxHpD: 100 } }] }),
  },
  // "N%的伤害值(在回合结束时)?转化为等量的护盾" → dmg_to_shield（按分数近似——dmg_to_shield count 窗转全额；分数形用 dmgToShield params 无 pct → 保残?）
  { id: "e16-sh-04",
    re: /^附加该护盾值的固伤$|^附加(?:自身|自己)?护盾值的固定伤害$/,
    go: () => ({ attachDamage: { flatSelfShieldPct: 100 } }),
  },
  // "附加自身护盾值N%的固伤" → flatSelfShieldPct
  { id: "e16-sh-05",
    re: /^附加(?:自身|自己)?护盾值(\d+)%(?:的)?(?:固定伤害|固伤|百分比伤害)$/,
    go: (m) => ({ attachDamage: { flatSelfShieldPct: +m[1] } }),
  },

  // ── 免疫 ────────────────────────────────────────────────
  // "免疫(受到的)?(反弹|反弹异常)" → immune_status
  { id: "e16-im-01",
    re: /^(?:自身|自己)?免疫(?:受到的?)?(?:反弹异常|反弹|反噬)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }),
  },
  // "免疫N次攻击技能"/"免疫受到的攻击技能" → dmg_immune count
  { id: "e16-im-02",
    re: new RegExp(`^免疫${NUM}次攻击技能$|^免疫(?:受到的?|所受到的?)(?:攻击技能|攻击|攻击伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: m[1] !== undefined ? { count: num(m[1]) } : {} }] }),
  },
  // "免疫(受到的)?异常和能力下降(状态)?" → immune_status+immune_degrade
  { id: "e16-im-03",
    re: /^免疫(?:受到的?|所受到的?)?异常(?:状态)?和?能力(?:下降|弱化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }),
  },
  // "天生免疫AIL(状态)?" → immune_status ailment
  { id: "e16-im-04",
    re: new RegExp(`^天生免疫(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", ailment: AILMENTS[m[1]], target: "self" }] }),
  },
  // "免疫(固定|百分比)(伤害)?(和|,|、|与)(固定|百分比|真实)(伤害)?" → flat_immune/kindMask
  { id: "e16-im-05",
    re: /^免疫(?:受到的?)?(?:固定|百分比|真实)(?:伤害|固伤)?[、,，和与]+(?:固定|百分比|真实)(?:伤害|固伤)?$/,
    go: (m) => { const t = /真实/.test(m[0]); return t ? { effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] } : { effects: [{ op: "apply_status", name: "flat_immune", target: "self" }] }; },
  },
  // "(有)?N%(的几率)?免疫(该|受到)?(的)?(攻击)?伤害" → dmg_immune chance
  { id: "e16-im-06",
    re: /^(?:有)?(\d+)%(?:的)?(?:几率|概率)?免疫(?:该|受到|所受到)?(?:的)?(?:攻击|攻击伤害|伤害)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: +m[1] }] }),
  },
  // "(后出手|先出手)N%免疫(当回合)?受到的?攻击伤害" → dmg_immune + order cond
  { id: "e16-im-07",
    re: /^(?:自身|自己)?(后出手|先出手)(\d+)%免疫(?:当回合|本回合)?受到的?(?:攻击)?伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: +m[2], turns: 1, if: { order: m[1] === "后出手" ? "last" : "first" } }] }),
  },

  // ── 锁定/封印 ─────────────────────────────────────────────
  // "(无法|不能)进行能力提升"/"无法处于能力提升状态" → no_stage_up
  { id: "e16-lk-01",
    re: /^无法(?:进行能力提升|处于能力提升|进行能力强化|处于能力强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_stage_up", target: "self" }] }),
  },
  // "对手无法处于能力强化状态"（无令/使前缀——主语即对手侧）。放在 e16-lk-02 前面，那条要求句首「令/使」。
  { id: "e16-lk-02a",
    re: /^(?:对手|对方|敌方)无法(?:进行|处于)能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_stage_up", target: "opponent" }] }),
  },
  // "(令|使)对手(无法|不能)进行能力提升(状态)?" → no_stage_up foe
  { id: "e16-lk-02",
    re: /^(?:令|使)(?:对手|对方|敌方)无法(?:进行|处于)能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_stage_up", target: "opponent" }] }),
  },
  // "(令|使)对手无法主动切换(精灵)?" → no_switch
  { id: "e16-lk-03",
    re: /^(?:令|使)?(?:对手|对方|敌方)无法主动切换(?:精灵|出战精灵)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "no_switch", target: "opponent" }] }),
  },
  // "无法消除(自身)?(的)?能力提升状态" → up_lock（自身强化不可被消除）
  { id: "e16-lk-04",
    re: /^(?:对手|对方|敌方)?无法(?:消除|清除|解除)(?:自身|自己)?(?:的)?能力(?:提升|强化)(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "up_lock", target: "self" }] }),
  },
  // "自身无法死亡"/"不会死亡" → endure 常驻
  { id: "e16-lk-05",
    re: /^(?:自身|自己)?(?:无法|不能|不会)死亡$/,
    go: () => ({ effects: [{ op: "apply_status", name: "endure", target: "self" }] }),
  },
  // "对手用技能无法恢复HP"/"无法通过技能回血"（主语随回合窗前缀剥除时无主语，按既有无主语约定发 self 再随 foeCtx 翻转）。放在 e16-lk-06 前面，那条要求句首「令/使」。 ──
  { id: "e16-lk-06a",
    re: /^(?:对手|对方|敌方)(?:用|使用)技能无法(?:恢复|回复)(?:体力|HP)$|^无法通过技能回血$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_block", target: /^(?:对手|对方|敌方)/.test(m[0]) ? "opponent" : "self" }] }),
  },
  // "(令|使)对手(直至下回合结束后)?无法(通过自身技能)?恢复体力" → heal_block（"直至下回合结束后"→2回合）
  { id: "e16-lk-06",
    re: /^(?:令|使)(?:对手|对方|敌方)(?:直至下回合结束后)?无法(?:通过自身技能|通过技能)?恢复(?:体力|HP)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: /直至/.test(m[0]) ? 2 : 1 }] }),
  },

  // ── 随机异常 ─────────────────────────────────────────────
  // "随机进入N种异常(状态)?"/"随机进入一种异常" → random count
  { id: "e16-rd-01",
    re: new RegExp(`^随机进入${NUM}?种?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[1] !== undefined ? num(m[1]) : 1 } }] }),
  },
  // "令对手进入AIL、AIL、AIL3种异常(中|之)?1种" → random list
  { id: "e16-rd-02",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)进入(${AIL_RE})(?:、|,)(${AIL_RE})(?:、|,)(${AIL_RE})(?:${NUM})?种?异常(?:状态)?(?:中|之|种)?${NUM}?种?$`),
    go: (m) => { const ns = m.slice(4).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: [AILMENTS[m[1]], AILMENTS[m[2]], AILMENTS[m[3]]], count: ns.length > 1 ? ns[1] : 1 } }] }; },
  },

  // ── 技能无效 ─────────────────────────────────────────────
  // "(令|使)?(对手|对方)(当回合)?技能无效" → move_null（foeCtx 剥对手主语后裸"技能无效"亦按对手窗收）
  { id: "e16-mn-01",
    re: /^(?:令|使)?(?:对手|对方|敌方)?(?:当回合|本回合)?(?:的|其)?(攻击|属性)?技能无效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: /对手|对方|敌方|其/.test(m[0]) ? "opponent" : "self", turns: 1, params: { count: 1, ...(m[1] === "攻击" ? { cat: 4 } : m[1] === "属性" ? { cat: 1 } : {}) } }] }),
  },
  // "(N%)?免疫该伤害" / "免疫受到的伤害" → dmg_immune（"该"指代当次伤害——bcm 已剥概率）
  { id: "e16-mn-02",
    re: /^免疫(?:该|该次|受到的|所受到的)(?:攻击)?伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }),
  },
  // "(令|使)(对手|对方)随机进入N种异常" → random（"令对手随机进入1种异常状态"）
  { id: "e16-mn-03",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)随机进入${NUM}?种?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[1] !== undefined ? num(m[1]) : 1 } }] }),
  },
  // "无法恢复(自身)?体力" 裸形 → heal_block（foeCtx 翻转后=对手禁疗）
  { id: "e16-mn-04",
    re: /^无法恢复(?:自身|自己)?(?:体力|HP)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "self" }] }),
  },
  // "(令|使)(对手|对方)(每回合)?恢复N点体力" → heal foe（"对手下N回合每回合恢复"结转）
  { id: "e16-mn-05",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)(?:每回合)?恢复${NUM}点?(?:的)?体力$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "opponent" }] }),
  },
  // "触发<名>：X"——印记声明+即时效果（冒号体全解析；marks-06 的具体变体仍先命中）
  { id: "e16-mn-06",
    re: /^触发([一-龥·]{2,8})[：:](.+)$/,
    go: (m) => { const r = parseEffectText(m[2]); if (r.effects.length === 0 && !r.attachDamage && !r.flags?.attachDamage) return { unparsedReason: `mark-declare body unparsed: ${m[2]}` }; return { effects: [{ op: "apply_mark", mark: m[1], count: 1, target: "opponent" }, ...r.effects], flags: r.flags }; },
  },
  // "触发<名>则X"——无冒号印记声明变体（排除"成功/失败"触发结果词）
  { id: "e16-mn-07",
    re: /^触发(?!成功|失败|几率|概率)([一-龥·]{2,8})则(.+)$/,
    go: (m) => { const r = parseEffectText(m[2]); if (r.effects.length === 0 && !r.attachDamage && !r.flags?.attachDamage) return { unparsedReason: `mark-declare body unparsed: ${m[2]}` }; return { effects: [{ op: "apply_mark", mark: m[1], count: 1, target: "opponent" }, ...r.effects], flags: r.flags }; },
  },
];
