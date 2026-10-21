// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, AILMENTS, AIL_RE, frac, stageFx, tgt, ALL_STATS } from "./lex.mjs";
import { condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [

  // ── 伤害修饰（attachDamage）─────────────────────────────────
  // "对方10%特防-1"/"25%是对手命中-1"（概率在主语后；attach-damage-01 要求概率在句首）。放在 attach-damage-01 前面。
  // 两支：主语+概率+stat (B) / 概率+主语+stat (C)。B 组 1-5，C 组 6-10。
  // 两支：主语+概率+stat (B) / 概率+「是」+主语+stat (C，必带「是」以免与 attach-damage-01 重叠)。B 组 1-5，C 组 6-10。
  { id: "p1-atd-05", re: new RegExp(`^(?:(对方|对手|敌方|自身|自己)([0-9]+)%(?:是)?(${STAT_RE})([+-])?${NUM}|([0-9]+)%是(对方|对手|敌方|自身|自己)(${STAT_RE})([+-])?${NUM})$`), go: (m) => { const b = m[1] !== undefined; const side = b ? m[1] : m[7]; const stat = b ? m[3] : m[8]; const pctv = num(b ? m[2] : m[6]); const sgn = (b ? m[4] : m[9]) === "-" ? -1 : 1; const v = num(b ? m[5] : m[10]); return { effects: [{ op: "apply_stat_stage", stat: STATS[stat], delta: sgn * v, target: tgt(side), chance: pctv }] }; } },
  { id: "attach-damage-01", re: new RegExp(`^${NUM}%(自身|对方|对手|敌方|自己)?(${STAT_RE})(?:等级)?([+-])?${NUM}$`), go: (m) => ({ effects: [stageFx(STATS[m[3]], (m[4] === "-" ? -1 : 1) * num(m[5]), m[2] ? tgt(m[2]) : "self", pct(m[1]))] }) }, // "50%对方防御-1"（无动词带几率）
  { id: "attach-damage-02", re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己)?体力的?${NUM}\\s*/\\s*${NUM}$|^每回合(?:恢复|回复)(?:自身|自己)?体力值?的?${NUM}\\s*/\\s*${NUM}$|^每回合(?:恢复|回复)(?:自身|自己)?最大体力${NUM}\\s*/\\s*${NUM}$|^每回合(?:恢复|回复)(?:自身|自己)?最大体力值?的?${NUM}\\s*/\\s*${NUM}$|^每回合(?:恢复|回复)(?:自身|自己)?最大体力(\\d+)%(?:的)?(?:体力|HP)?$|^每回合(?:恢复|回复)(?:自身|自己)?最大体力的?(\\d+)%(?:的)?(?:体力|HP)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const p = ns.length === 1 ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] }; return { effects: [{ op: "apply_status", name: "hot", target: "self", params: p }] }; } },
  { id: "attach-damage-03", re: new RegExp(`^每回合(?:使用技能)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}最大体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "attach-damage-04", re: new RegExp(`^每回合(?:使用技能)?(?:恢复|回复)(?:自身)?最大体力的${NUM}\\s*/\\s*${NUM}(?:并|，|,)?造成等量(?:固定伤害|固伤|百分比伤害|伤害)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }, { op: "apply_status", name: "dot_field", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "attach-damage-05", re: new RegExp(`^(?:自身)?免疫下${NUM}次受到的(?:攻击|伤害)$|^免疫${NUM}次(?:攻击|伤害)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  { id: "attach-damage-06", re: new RegExp(`^(?:自身)?免疫下${NUM}次(?:自身)?受到的异常状态$|^(?:自身)?免疫${NUM}次异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  { id: "attach-damage-07", re: /^威力翻倍$|^伤害翻倍$|^技能威力翻倍$|^攻击威力翻倍$|^威力加倍$|^伤害加倍$|^(?:自身|自己)?造成的攻击伤害翻倍$|^攻击伤害翻倍$/, go: () => ({ attachDamage: { powerMul: { numerator: 2, denominator: 1 } } }) },
  // 翻倍族 attachAll（作用于句内已产出的同型 op）
  { id: "attach-damage-08", re: /^强化状态翻倍$|^强化效果翻倍$|^能力提升效果翻倍$|^强化翻倍$|^提升效果翻倍$|^自身强化状态翻倍$|^自身强化翻倍$/, go: () => ({ attachAll: { stageDouble: true } }) },
  { id: "attach-damage-09", re: /^(?:造成|令|使)?(?:的)?弱化效果翻倍$|^能力下降效果翻倍$|^弱化翻倍$|^降低效果翻倍$/, go: () => ({ attachAll: { stageDownDouble: true } }) },
  { id: "attach-damage-10", re: /^吸取效果翻倍$|^吸取量翻倍$|^吸血效果翻倍$|^吸取体力效果翻倍$/, go: () => ({ attachAll: { drainDouble: true } }) },
  { id: "attach-damage-11", re: new RegExp(`^自身体力低于${NUM}\\s*/\\s*${NUM}(?:时)?变为吸取对手最大体力的${NUM}\\s*/\\s*${NUM}$|^变为吸取对手最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => {
    // 两组：前置条件 (m[1]/m[2]) + 目标分数 (m[3]/m[4])；无条件变体只有 (m[5]/m[6])
    if (m[3] !== undefined) return { attachAll: { drainSwapIf: { when: { selfHpBelow: frac(m[1], m[2]) }, numerator: num(m[3]), denominator: num(m[4]) } } };
    return { attachAll: { drainSwapIf: { numerator: num(m[5]), denominator: num(m[6]) } } };
  } },
  { id: "attach-damage-12", re: /^固定伤害翻倍$|^固伤翻倍$|^附加固定伤害翻倍$|^附加的固定伤害翻倍$|^附加的固伤翻倍$/, go: () => ({ attachAll: { flatDouble: true } }) },
  // 先制+必中组合（"先制+3且必定命中"）
  { id: "attach-damage-13", re: new RegExp(`^先制\\+${NUM}(?:且|并|同时|,|，)?(?:必定命中|必中)$`), go: (m) => ({ flags: { priority: num(m[1]), accuracy: "always" } }) },
  // "对手下N回合攻击技能无效/属性技能无效"（无效=封印窗口）
  { id: "attach-damage-14", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)下?${NUM}回合(?:内)?攻击技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 4 } }] }) },
  { id: "attach-damage-15", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)下?${NUM}回合(?:内)?(?:使用的)?属性技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 1 } }] }) },
  { id: "attach-damage-16", re: new RegExp(`^(?:技能)?威力(?:提升|提高)${NUM}%$`), go: (m) => ({ attachDamage: { powerMul: { numerator: 100 + num(m[1]), denominator: 100 } } }) },
  { id: "attach-damage-17", re: new RegExp(`^威力(?:提升|提高)${NUM}点$|^(?:此)?(?:技能)?威力提升${NUM}$|^(?:此)?(?:技能)?威力提高${NUM}$`), go: (m) => ({ attachDamage: { powerAdd: num(m[1] ?? m[2] ?? m[3]) } }) },
  // "自身所受特殊攻击伤害减半"（"所受"未落入 normalize 词表时残文）。放在 attach-damage-18 前面，那条只收「受到」。
  { id: "attach-damage-18a", re: /^(?:自身|自己)所受(物理|特殊|物攻|特攻)(?:攻击)?伤害减半$/, go: (m) => { const phys = /^(?:物理|物攻)$/.test(m[1]); return { effects: [{ op: "apply_status", name: phys ? "phys_half" : "spec_half", target: "self", params: { cat: phys ? 2 : 3, n: 1, d: 2 } }] }; } },
  { id: "attach-damage-18", re: /^(?:自身|自己)?受到(?:物理|特殊)攻击伤害减半$|^(?:受到)?(?:物理|特殊)攻击伤害减少\d+%$|^受到物理攻击伤害减少\d+%$|^(?:自身|自己)受到(?:物理|特殊)伤害减半$/, go: (m) => ({ effects: [{ op: "apply_status", name: m[0].includes("物理") ? "phys_half" : "spec_half", target: "self", params: { cat: m[0].includes("物理") ? 2 : 3, n: 1, d: 2 } }] }) },
  { id: "attach-damage-19", re: new RegExp(`^致命(?:一)?击率上升${NUM}\\s*/\\s*${NUM}$|^要害(?:命中)?率(?:提升|上升)${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  { id: "attach-damage-20", re: new RegExp(`^每回合使用技能吸取(?:对手|对方|敌方)${NUM}点体力$|^每回合吸取(?:对手|对方|敌方)${NUM}点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  { id: "attach-damage-21", re: /^恢复效果翻倍$/, go: () => ({ attachAll: { healDouble: true } }) },
  { id: "attach-damage-22", re: /^恢复效果和固定伤害翻倍$|^恢复效果和伤害翻倍$/, go: () => ({ attachAll: { healDouble: true, flatDouble: true } }) },
  { id: "attach-damage-23", re: /^恢复效果和百分比伤害翻倍$|^百分比伤害和恢复效果翻倍$|^恢复与(?:固定|百分比)?伤害翻倍$/, go: () => ({ attachAll: { healDouble: true, dmgDouble: true } }) },
  { id: "attach-damage-24", re: /^百分比伤害翻倍$|^造成的百分比伤害翻倍$/, go: () => ({ attachAll: { dmgDouble: true } }) },
  // 全量回复对手（"恢复对方精灵的全部体力"）。放在 attach-damage-25 前面，那条只回自身。
  { id: "attach-damage-25a", re: /^(?:恢复|回复)(?:对方|对手|敌方)精灵的(?:全部|所有)体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "opponent" }] }) },
  // 全量回复（"直接回满"/"回复全部体力"）
  { id: "attach-damage-25", re: /^直接回满$|^(?:恢复|回复)(?:自身|自己)?全部体力$|^(?:恢复|回复)(?:自身|自己)?所有体力$|^(?:自身|自己)(?:恢复|回复)(?:所有|全部)体力$|^恢复自身所有体力$|^(?:恢复|回复)自身体力$|^(?:恢复|回复)自身(?:全部)?HP$|^(?:恢复|回复)体力$|^恢复体力值$|^(?:恢复|回复)至满体力$|^体力值?回满$|^回满$|^(?:使)?(?:自身|自己)?(?:体力|HP)(?:完全)?恢复(?:满|至满)$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // 每回合分数回复补变体（"每回合恢复1/3体力值"）
  { id: "attach-damage-26", re: new RegExp(`^每回合恢复${NUM}\\s*/\\s*${NUM}体力值?$|^每回合恢复自身体力值的?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { numerator: ns[0], denominator: ns[1] } }] }; } },
  // "N分之M" 非标准分数（"每回合恢复自身体力的5分之1"=1/5）
  { id: "attach-damage-27", re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己)?(?:最大)?体力的?${NUM}分之${NUM}$|^每回合(?:恢复|回复)(?:自身|自己)?最大体力的${NUM}分之${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: ns[1], d: ns[0] } }] }; } },
  // 已损失体力基线（"每回合恢复自身已损失体力的30%"——missing=1 换基线）
  { id: "attach-damage-28", re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己)?已损失体力的${NUM}%$|^每回合(?:恢复|回复)(?:自身|自己)?已损失体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const p = ns.length === 1 ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] }; return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { ...p, missing: 1 } }] }; } },
  // 随机令对手进入单个异常（"30%随机令对手进入烧伤"）
  { id: "attach-damage-29", re: new RegExp(`^${NUM}%?(?:的?几?率)?随机(?:令|使|让)(?:对手|对方|敌方)进入(${AIL_RE})(?:状态)?$|^随机(?:令|使|让)(?:对手|对方|敌方)进入(${AIL_RE})(?:状态)?$`), go: (m) => { const pct = m[1] !== undefined ? num(m[1]) : undefined; const ail = m.slice(1).find((x) => x !== undefined && AILMENTS[x] !== undefined); return { effects: [{ op: "apply_status", name: AILMENTS[ail], target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  { id: "attach-damage-30", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:最大)?体力的?${NUM}分之${NUM}$|^(?:恢复|回复)(?:自身|自己)?最大体力的${NUM}分之${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", target: "self", numerator: ns[1], denominator: ns[0] }] }; } },
  // PP 全技能削减（"令对手所有技能PP值-1"）
  { id: "attach-damage-31", re: new RegExp(`^(?:${NUM}%)?(?:令|使|让)(?:对手|对方|敌方)所有技能PP值?([+-])${NUM}$|^(?:对手|对方|敌方)所有技能PP值?([+-])${NUM}$`), go: (m) => { const s = (m[2] ?? m[4]) === "-" ? -1 : 1; return { effects: [{ op: "pp_delta", amount: s * num(m[3] ?? m[5]), target: "opponent", scope: "all" }] }; } },
  // 定额反弹（"受攻击时反弹N点固定伤害"——counter flag params.flat）
  { id: "attach-damage-32", re: new RegExp(`^(?:受到|受)攻击时反弹(\\d+)点?(?:固定)?伤害$|^反弹(\\d+)点?(?:固定)?伤害$|^反弹(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { flat: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // 反伤百分比（"受到直接攻击伤害的N%反馈给对手"——dmgReflect flag）
  { id: "attach-damage-33", re: new RegExp(`^(?:将|把)?(?:本回合|当回合|当前)?(?:自身)?受到(?:直接)?攻击伤害的${NUM}%(?:会)?(?:反馈|反弹|返还)给(?:对手|对方|敌方)$|^(?:将|把)(?:本回合|当回合)?受到(?:的)?(?:攻击)?伤害${NUM}%(?:反馈|反弹|返还)给?(?:对手|对方|敌方)$|^将受到的伤害的${NUM}%反馈给对手$`), go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1] ?? m[2] ?? m[3] ?? m[4]), d: 100 } }] }) },
  // "使对手的属性技能失效"（多一个"的"；回合与概率由外层挂上）
  { id: "attach-damage-34b", re: /^(?:使|令|让)(?:对手|对方|敌方)的属性技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 } }] }) },
  // 属性技能失效（一次性封印——"使对手下回合属性技能失效"）
  { id: "attach-damage-34", re: /^(?:使|令)(?:对手|对方|敌方)(?:下回合)?属性技能失效$|^(?:对手|对方|敌方)(?:下回合)?属性技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 } }] }) },
  // 镜像提升（"自身附加相同的能力提升"——承接前置弱化：把对手负 delta 复制为自身正 delta）
  { id: "attach-damage-35", re: /^(?:使)?(?:自身|自己)(?:附加|获得)相同的(?:能力)?提升$|^自身获得相同的能力提升$/, go: () => ({ attachAll: { mirrorStages: true } }) },
  // 威力翻倍+消强复合（"威力翻倍并消除对手相应的防御能力提升效果"）
  { id: "attach-damage-36", re: /^威力翻倍并消除对手相应的防御能力提升效果$|^威力翻倍并消除对手(?:防御|双防)能力提升$/, go: () => ({ attachDamage: { powerMul: { numerator: 2, denominator: 1 } }, effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // 损伤反馈回血（"给予对方损伤的1半会回复自己的体力"——1半=1/2 drain）
  { id: "attach-damage-37", re: new RegExp(`^给予对方损伤的(\\d+)半会回复自己的体力$|^(?:造成|给予)(?:对方|对手)伤害的${NUM}%(?:会)?恢复(?:自己|自身)体力$`), go: (m) => m[1] !== undefined ? { attachDamage: { drain: { numerator: 1, denominator: num(m[1]) * 2 } } } : { attachDamage: { drain: { numerator: num(m[2]), denominator: 100 } } } },
  // 裸"所有技能先制+N"（无回合前缀——永续先制窗口）
  { id: "attach-damage-38", re: new RegExp(`^(?:自身|自己)?所有技能先制([+])${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: num(m[2]) } }] }) },
  { id: "attach-damage-39", re: /^(?:若)?(?:对手|对方|敌方)使用属性技能$|^(?:若)?(?:自身)?受到攻击$/, go: () => ({ unparsedReason: "reactive trigger — E4" }) },

  // "每回合结束后若双方任意一方处于异常状态或能力下降状态则令对手受到N点固定伤害" → foe_dot flat + anyAilDegrade 门控
  { id: "attach-damage-40", re: new RegExp(`^每回合(?:结束)?后?若双方任意一?方?处于异常状态或能力下降状态则令(?:对手|对方|敌方)受到${NUM}点(?:固定)?伤害$|^若双方任意一?方?处于异常状态或能力下降状态则(?:每回合)?令(?:对手|对方|敌方)受到${NUM}点(?:固定)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: ns[ns.length - 1], anyAilDegrade: 1 } }] }; } },
  // "若上回合自身未受到攻击伤害则附加对手最大体力N/M的百分比伤害" → dynCond prevDamage + flatFoeFrac
  { id: "attach-damage-41", re: new RegExp(`^若上回合(?:自身|自己)?未受到(?:攻击)?伤害则附加(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}(?:的)?(?:百分比)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatFoeFracIf: { when: { prevTakenZero: true }, numerator: ns[ns.length - 2], denominator: ns[ns.length - 1] } } }; } },
  // "对方所有能力增强效果消失" / "解除这些能力下降状态" → clear_stages 变体
  { id: "attach-damage-42", re: /^(?:对方|对面|对手|敌方)所有能力增强效果消失$|^消除(?:对方|对面|对手|敌方)所有能力增强效果$/, go: () => ({ effects: [{ op: "clear_stages", sign: "up", target: "opponent" }] }) },
  { id: "attach-damage-43", re: /^解除这些能力下降状态$|^解除(?:自身|自己)这些能力下降状态$/, go: () => ({ effects: [{ op: "clear_stages", sign: "down", target: "self" }] }) },
  // "与对手互换当前体力" → swap_hp
  { id: "attach-damage-44", re: /^与(?:对手|对方|敌方)互换当前体力$|^互换(?:双方)?当前体力$|^与(?:对手|对方|敌方)交换(?:当前)?体力$/, go: () => ({ effects: [{ op: "swap_hp", target: "opponent" }] }) },
  // "免疫暴击伤害" → critImmune flag
  { id: "attach-damage-45", re: /^(?:使)?(?:自身|自己)?免疫暴击伤害$|^(?:自身|自己)?不受暴击伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] }) },
  // "若受到攻击则有N%概率使对手携带的M个技能PP归零" → trigger1 + chance + pp zeroRandom payload
  { id: "attach-damage-46", re: new RegExp(`^若(?:自身|自己)?受到攻击则?有?${NUM}%?(?:的?(?:几|概)?率)?(?:使|令)(?:对手|对方|敌方)携带的?${NUM}个技能PP(?:值)?归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = ns.length > 1 ? ns[0] : undefined; return reactWrap(1, { ...(pct !== undefined ? { chance: pct } : {}) }, `使对手携带的${ns[ns.length - 1]}个技能PP归零`); } },
  { id: "attach-damage-47", re: new RegExp(`^有?${NUM}%?(?:的?(?:几|概)?率)?(?:使|令)(?:对手|对方|敌方)携带的?${NUM}个技能PP(?:值)?归零$|^(?:使|令)?(?:对手|对方|敌方)携带的?${NUM}个技能PP(?:值)?归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%|概率/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; return { effects: [{ op: "pp_delta", zeroRandom: ns[ns.length - 1], target: "opponent", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // "若自身能力强化被消除则对手减少N/M最大HP" → trigger7 + max_hp_down payload
  { id: "attach-damage-48", re: new RegExp(`^若(?:自身|自己)?能力强化被消除则(?:对手|对方|敌方)减少${NUM}\\s*/\\s*${NUM}最大(?:HP|体力)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return reactWrap(7, {}, `减少对手${ns[ns.length - 2]}/${ns[ns.length - 1]}最大体力`); } },
  { id: "attach-damage-49", re: new RegExp(`^对手减少${NUM}\\s*/\\s*${NUM}最大(?:HP|体力)$|^使对手减少${NUM}\\s*/\\s*${NUM}最大(?:HP|体力)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: ns[ns.length - 2], d: ns[ns.length - 1] } }] }; } },
  // "若对手下N次攻击miss" → trigger2 对手MISS（孤儿条件）
  { id: "attach-damage-50", re: new RegExp(`^若(?:对手|对方|敌方)下${NUM}次攻击(?:miss|MISS|Miss)$|^若对手攻击(?:miss|MISS|Miss)$`), go: (m) => ({ dynTriggerPart: { trigger: 2, ...(m[1] !== undefined ? { count: num(m[1]) } : {}) } }) },
  // "攻击N-M次" 区间变体（"作N-M次攻击"）
  { id: "attach-damage-51", re: new RegExp(`^作${NUM}[-~—至到]${NUM}(?:次|个)攻击$|^攻击${NUM}[-~—至到]${NUM}(?:次|个)$|^${NUM}次攻击$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { hits: { min: ns.length > 1 ? ns[ns.length - 2] : ns[0], max: ns[ns.length - 1] } } }; } },
  // "几率提升至N%" → chanceSet（attachAll 新增键）
  { id: "attach-damage-52", re: new RegExp(`^(?:触发)?(?:几|概)率提升至${NUM}%$|^(?:几|概)率(?:变为|变成|改为)${NUM}%$`), go: (m) => ({ attachAll: { chanceSet: num(m[1] ?? m[2]) } }) },
  // "造成的伤害增加N%" → 终伤倍率
  { id: "attach-damage-53", re: new RegExp(`^造成的伤害(?:增加|提升|提高)${NUM}%$|^伤害(?:增加|提升)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mul: { numerator: 100 + ns[0], denominator: 100 } } }; } },
  // "自身N回合内免疫能力下降状态" —— 主语在前的变体
  { id: "attach-damage-54", re: new RegExp(`^自身${NUM}回合内免疫能力下降(?:状态)?$|^自身${NUM}回合(?:内)?不受能力下降影响$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self", turns: num(m[1]) }] }) },
  // "消耗自身所有护罩"（护罩=护盾变体）→ consumeShield
  { id: "attach-damage-55", re: /^消耗(?:自身|自己)所有护[盾罩](?:值)?(?:(?:并)?(?:造成|附加)(?:对手|对方|敌方)?等量(?:固定|固伤)?伤害)?$/, go: () => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", consumeShield: true }] }) },
  // "伤害转化为体力" 裸句（承伤转体力窗口）
  { id: "attach-damage-56", re: /^伤害转化为体力$|^将伤害转化为体力$|^伤害值转化为体力$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  // "N%几率让对方X"（让 变体）→ 概率异常
  { id: "attach-damage-57", re: new RegExp(`^${NUM}%几率让(?:对方|对手|敌方)(${AIL_RE})(?:状态)?$|^${NUM}%的?几率让(?:对方|对手|敌方)(${AIL_RE})$`), go: (m) => { const a = AILMENTS[m[2] ?? m[3]]; return a === undefined ? { unparsedReason: `ailment unparsed: ${m[0]}` } : { effects: [{ op: "apply_status", name: a, target: "opponent", chance: num(m[1]) }] }; } },
  // "提升自身的能力" → 全属性+1（默认解释）
  { id: "attach-damage-58", re: /^提升(?:自身|自己)的能力$|^提升自身所有能力$/, go: () => ({ effects: ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: 1, target: "self" })) }) },
  // "受到攻击N%使对手X" 裸形态（无"若/则"）
  { id: "attach-damage-59", re: new RegExp(`^(?:自身|自己)受到攻击${NUM}%使(?:对手|对方|敌方)(.+)$`), go: (m) => reactWrap(1, { chance: num(m[1]) }, `使对手${m[2]}`) },
  // 明确推迟族（reason 显式标注而非泛 unparsed）
  { id: "attach-damage-60", re: /^惩罚|^(?:对方|对面|对手)(?:能力)?等级越高|^(?:此)?技能威力越大|^威力越大$/, go: () => ({ unparsedReason: "punish: foe-stage scaling coefficient absent in text — UNVERIFIED" }) },
  { id: "attach-damage-61", re: /下只出场精灵|下次出战精灵|下一只出场的精灵|下一个出场的精灵|下次登场|下一只精灵/, go: () => ({ unparsedReason: "next-unit effect — E4" }) },
  { id: "attach-damage-62", re: new RegExp(`连续使用(?!.*最[高多])(?!.*次数\\+\\d)|每次使用(?!(?:此技能|该技能|本技能)?(?:则)?(?:自身|自己)?(?:${STAT_RE}|全属性|所有属性|全部能力|全项能力))(?!.*最[高多])(?!.*(?:击败|恢复))(?!.*次数\\+\\d)|^最高\\d+%?$`), go: () => ({ unparsedReason: "stacking per-use — unquantified" }) },
  // "遇到天敌效果翻倍" → effectDouble + foeCountersUs cond；"遇到天敌附加N点固定伤害" → flatIf
  { id: "attach-damage-63", re: /^遇到天敌效果翻倍$|^遇到天敌伤害翻倍$/, go: () => ({ attachAll: { effectDouble: true, effCond: { foeCountersUs: true } } }) },
  { id: "attach-damage-64", re: new RegExp(`^遇到天敌附加${NUM}点(?:固定)?伤害$|^遇到天敌(?:时)?附加${NUM}点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatIf: { when: { foeCountersUs: true }, flat: ns[ns.length - 1] } } }; } },
  // "遇到天敌概率翻倍" → chanceDouble + cond
  { id: "attach-damage-65", re: /^遇到天敌概率翻倍$|^遇到天敌(?:时)?概率翻倍$/, go: () => ({ attachAll: { chanceDouble: true, effCond: { foeCountersUs: true } } }) },
  { id: "attach-damage-66", re: /遇到天敌|天敌时/, go: () => ({ unparsedReason: "type-advantage cond — E4" }) },
  { id: "attach-damage-67", re: /威力越大$|^此技能威力越大/, go: () => ({ unparsedReason: "scaled power — E4" }) },
  { id: "attach-damage-68", re: /^容易打出致命(?:一)?击$|^增加致命一击的概率$|^致命一击概率(?:提升|增加)$|^(?:提升|增加|提高)致命一击(?:的)?概率$/, go: () => ({ unparsedReason: "crit rate unquantified — E4" }) },
  // MISS 反应式（trigger 2=对手MISS / 6=自身MISS；cat:4=攻击守卫——引擎 fireReactive 传 catCode；必须先于 69 兜底）
  { id: "attach-damage-68a", re: /^若(?:对手|对方|敌方)(?:的)?(?:攻击技能|攻击)(?:MISS|miss|未命中|落空)(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(2, { cat: 4 }, m[1]) },
  { id: "attach-damage-68b", re: /^若(?:对手|对方|敌方)(?:的)?(?:技能)?(?:MISS|miss|未命中|落空)(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(2, {}, m[1]) },
  { id: "attach-damage-68c", re: /^若(?:自身|自己)?(?:的)?(?:攻击技能|攻击|技能)?(?:MISS|miss|未命中|落空)(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(6, {}, m[1]) },
  // 下N次攻击MISS反应式（"若对手下1次攻击MISS则对手害怕"——count 记入 react params）
  { id: "attach-damage-68d", re: new RegExp(`^若(?:对手|对方|敌方)下${NUM}?次?(?:使用的?)?攻击(?:技能)?(?:MISS|miss|未命中|落空)(?:时|则|后|，|,)?(.+)$`), go: (m) => reactWrap(2, { cat: 4, ...(m[1] !== undefined ? { count: num(m[1]) } : {}) }, m[2]) },
  // 裸 MISS 尾（"使对手下2回合攻击技能MISS"——主语/时长由前缀剥离，残留部分=持有者闪避窗；must_miss_* 一律 self 持有，foeCtx 不翻转）
  { id: "attach-damage-68e", re: /^(?:攻击技能|攻击)(?:必定|一定)?(?:MISS|miss|未命中|落空)$/, go: () => ({ effects: [{ op: "apply_status", name: "must_miss_atk", target: "self" }] }) },
  { id: "attach-damage-68f", re: /^(?:(?:物理|特殊)(?:攻击)?(?:和|及|与)(?:物理|特殊)(?:攻击)?)对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$|^物理攻击对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$|^特殊攻击对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$/, go: (m) => { const both = /和|及|与/.test(m[0]); const phys = /物理/.test(m[0]); return { effects: [{ op: "apply_status", name: both ? "must_miss_atk" : phys ? "must_miss_phys" : "must_miss_spec", target: "self" }] }; } },
  { id: "attach-damage-68g", re: /^特攻(?:攻击)?对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$/, go: () => ({ effects: [{ op: "apply_status", name: "must_miss_spec", target: "self" }] }) },
  { id: "attach-damage-68h", re: /^物攻(?:攻击)?对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$/, go: () => ({ effects: [{ op: "apply_status", name: "must_miss_phys", target: "self" }] }) },
  { id: "attach-damage-68i", re: /^属性(?:攻击|技能)对(?:自身|自己)(?:必定|一定)?(?:MISS|miss|未命中)$/, go: () => ({ effects: [{ op: "apply_status", name: "must_miss_stat", target: "self" }] }) },
  { id: "attach-damage-68j", re: new RegExp(`^(?:对手|对方|敌方)(?:的)?攻击${NUM}%(?:的)?概率对(?:自身|自己)(?:MISS|miss|未命中)$|^${NUM}%(?:的)?概率(?:使|令)?(?:对手|对方|敌方)(?:的)?(?:物理|特殊)?攻击(?:对(?:自身|自己))?(?:MISS|miss|未命中)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss_atk", target: "self", chance: num(m[1] ?? m[2]) }] }) },
  // "对手下N次使用的攻击技能必定MISS"/"使对手下N次攻击MISS"→must_miss_*（self 持有闪避窗；无"下"=常驻全闪）。下N次没有 must_miss 读取方，不发 count。先于 69 的 MISS 全桶
  { id: "attach-damage-69a", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)下?(?:${NUM})?次?(?:使用的?)?(物理攻击|特殊攻击|攻击技能|属性技能|攻击|技能)(?:必定|一定|百分百)?(?:MISS|miss|未命中|落空)$|^(物理|特殊|攻击)?(?:技能|攻击)?对(?:自身|自己)(?:必定|一定|百分百)?(?:MISS|miss|未命中|落空)$`),
    go: (m) => { const kw = m[2] ?? m[3] ?? ""; const name = /物理/.test(kw) ? "must_miss_phys" : /特殊/.test(kw) ? "must_miss_spec" : /属性/.test(kw) ? "must_miss_stat" : kw === "攻击" || kw === "攻击技能" ? "must_miss_atk" : "must_miss"; return { effects: [{ op: "apply_status", name, target: "self" }] }; } },
  { id: "attach-damage-69", re: /(?<![必一肯]定)(?:MISS|miss)/, go: () => ({ unparsedReason: "miss-reactive — E4" }) },
  { id: "attach-damage-70", re: new RegExp(`^威力(?:为|加|提升至|提升|变为)?${NUM}倍$`), go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1]), denominator: 1 } } }) },
  { id: "attach-damage-71", re: /^威力随机$/, go: () => ({ unparsedReason: "random power — no range" }) },
  { id: "attach-damage-72", re: new RegExp(`^随机恢复(\\d+)[-~—至到](\\d+)点体力$`), go: (m) => ({ effects: [{ op: "heal", flatRange: { min: num(m[1]), max: num(m[2]) }, target: "self" }] }) },
  { id: "attach-damage-73", re: new RegExp(`^(?:附加|随机附加)(\\d+)[-~—至到](\\d+)点?固定伤害$`), go: (m) => ({ attachDamage: { flatRange: { min: num(m[1]), max: num(m[2]) } } }) },
  { id: "attach-damage-74", re: /^(?:将|把)(?:自身)?能力下降状态(?:反馈|转移)给(?:对手|对方|敌方)$|^附加给对手等同的能力下降状态$|^附加给对手对应的能力下降(?:状态|效果)$|^(?:将|把)等同的?能力下降(?:状态)?反馈给(?:对手|对方|敌方)$|^反馈自身能力下降状态$|^转移(?:自身|自己)(?:的)?能力(?:下降|降低)(?:的)?状态给(?:对手|对方|敌方)$|^(?:自身|自己)?(?:的)?能力下降(?:状态|效果)(?:反馈|转移|转嫁)给(?:对手|对方|敌方)$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "push" }] }) },
  // 倍率反馈（"双倍反馈给对手"/"10倍返还"）
  { id: "attach-damage-75", re: new RegExp(`^(?:将|把)(?:自身|自己)(?:的)?能力下降状态?(\\d+|一|二|两|三|四|五|六|七|八|九|十|双)倍?(?:反馈|返还|反馈给|返还给)(?:对手|对方|敌方)?$|^(?:将|把)自身能力下降状态双倍反馈给对手$`), go: (m) => { const t = m[1] === "双" ? 2 : m[1] !== undefined ? num(m[1]) : 2; return { effects: [{ op: "transfer_stages", direction: "push", mul: { numerator: t, denominator: 1 } }] }; } },
  // 能力提升视为下降/下降视为提升（invert_stages）
  { id: "attach-damage-76", re: /^(?:将|把|令)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)状态?视为(?:(?:相应)?的)?(?:能力)?下降(?:状态|效果)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // "将其能力提升状态视为相应的能力下降状态"（主语省略的「其」）/ "将对手能力提升状态视为相应能力下降状态"（「相应」后省「的」）。放在 attach-damage-76 之后，那条要求显式对手侧名词且「相应」后必带「的」。
  { id: "p1-atd-01", re: /^(?:将|把|令)?(?:其|(?:对手|对方|敌方)(?:的)?)能力(?:提升|强化)(?:状态|效果)?视为(?:相应的?)?(?:能力)?下降(?:状态|效果)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  { id: "attach-damage-77", re: /^(?:攻击时)?(?:将|把)(?:自身|自己)(?:的)?能力下降状态视为相应的能力提升状态$/, go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  // 负级锁（"能力下降状态无法被解除或反转"）
  { id: "attach-damage-78", re: /^(?:对手|对方|敌方)?(?:的)?能力下降状态无法被解除或反转$|^(?:使|令)(?:对手|对方|敌方)(?:的)?能力下降状态无法(?:被)?解除(?:或反转)?$/, go: () => ({ effects: [{ op: "apply_status", name: "down_lock", target: "opponent" }] }) },
  // 无视自身弱化
  { id: "attach-damage-79", re: /^无视自身能力下降状态$|^无视(?:自身|自己)的能力下降(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "ignore_self_down", target: "self" }] }) },
  // 双方能力提升同消（"消除双方能力上升"）
  { id: "attach-damage-80", re: /^消除双方能力(?:上升|提升|强化)(?:状态|效果)?$|^消除敌我双方能力(?:提升|强化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "up" }, { op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "attach-damage-81", re: /^消除对手能力提升状态及回合类效果$|^消除(?:对手|对方)能力提升和回合类效果$|^(?:100%)?消除(?:对手|对方|敌方)回合类效果和能力提升状态$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }, { op: "cleanse", target: "opponent", scope: "timed" }] }) },
  { id: "attach-damage-82", re: /^(?:使)?(?:自身|自己)的?能力下降(?:状态|效果)?反转(?:成|为)(?:能力)?提升(?:效果|状态)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  { id: "attach-damage-83", re: new RegExp(`^(?:对手|对方|敌方)无法通过自身技能恢复体力$|^(?:使|令)?(?:对手|对方|敌方)${NUM}回合内?无法通过自身技能恢复体力$|^${NUM}回合内?(?:对手|对方|敌方)无法通过自身技能恢复体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", ...(m[1] ?? m[2] ? { turns: num(m[1] ?? m[2]) } : {}) }] }) },
  { id: "attach-damage-84", re: new RegExp(`^每回合(?:所受)?的?伤害减少(\\d+)(?:点)?$|^每回合(?:自身)?受到的伤害减少(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  { id: "attach-damage-85", re: new RegExp(`^(?:使|令)?自身下?(${NUM})?回合(?:内)?(?:所有技能)?先制\\+${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}), params: { add: num(m[3]) } }] }) },
  { id: "attach-damage-86", re: new RegExp(`^受到致死攻击时则?余下(\\d+)点体力$|^受到致命伤害时保留(\\d+)点?体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1] ?? m[2]) } }] }) },
  { id: "attach-damage-87", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)下?(${NUM})?回合(?:内)?受到的伤害(?:提升|提高)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}), params: { pct: num(m[3]) } }] }) },
  { id: "attach-damage-88", re: new RegExp(`^(?:使|令)(?:对方|对手|敌方)攻击伤害是正常状态下的${NUM}\\s*/\\s*${NUM}倍$|^(?:使|令)(?:对方|对手)攻击伤害(?:变为|为)正常的${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: ns[1], d: ns[2] ?? 100 } }] }; } },
  { id: "attach-damage-89", re: new RegExp(`^(?:使|令)?随机使对手${NUM}种能力(?:等级)?([+-])${NUM}$|^随机使对手${NUM}项能力(?:等级)?([+-])${NUM}$|^随机(?:使|令)(?:对手|对方|敌方)${NUM}种属性(?:等级)?([+-])${NUM}$|^随机(?:对手|对方|敌方)${NUM}项属性([+-])${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const cnt = num(ns[0]); const d = (m[0].includes("-") ? -1 : 1) * num(ns[ns.length - 1]); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: cnt, delta: d, target: "opponent" }] }; } },
  { id: "attach-damage-90", re: new RegExp(`^无视对手(?:速度以及防御|防御)能力(?:强化|提升)(?:状态|效果)?$|^无视对手所有防御能力(?:提升|强化)效果$|^无视对手防御(?:能力)?强化$`), go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  { id: "attach-damage-91", re: new RegExp(`^(?:为|给)自身附加${NUM}点护盾$|^获得${NUM}点护盾$|^自身获得${NUM}点护盾$|^(?:为|给)自身增加${NUM}点护盾(?:值)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[0] } }] }; } },
  // 护盾创造/计数（"创造一个可以吸收300点伤害的护盾"/"获得2个可以吸收N点伤害的护盾"）
  // "为自己创造1个可以吸收N点伤害的护盾"（attach-damage-92 的侧词只有「自身」）。放在 attach-damage-92 前面。
  { id: "p1-atd-02", re: new RegExp(`^(?:为|给)(?:自己|本方)(?:创造|生成|制造)(?:一个|${NUM}个)?(?:可以)?吸收${NUM}点伤害的护盾$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[ns.length - 1], ...(ns.length > 1 ? { count: ns[0] } : {}) } }] }; } },
  { id: "attach-damage-92", re: new RegExp(`^(?:为|给)自身(?:创造|生成|制造)(?:一个|${NUM}个)?(?:可以)?吸收${NUM}点伤害的护盾$|^使自身获得${NUM}个(?:可以)?吸收${NUM}点伤害的护盾(?:（不可叠加）)?$|^获得一个(?:可以)?吸收${NUM}点伤害的护盾$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const flat = ns[ns.length - 1]; const count = ns.length > 1 ? ns[0] : undefined; return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat, ...(count !== undefined ? { count } : {}) } }] }; } },
  // 等量护盾（"为自身附加等量的护盾值"——按当次伤害结算）
  { id: "attach-damage-93", re: /^为自身附加等量的护盾值?$|^附加等量的护盾值?$/, go: () => ({ attachDamage: { shieldEcho: true } }) },
  // 护罩（=ward 固伤/百分比吸收池——kindMask=3 与护盾分立）
  { id: "attach-damage-94", re: new RegExp(`^(?:使|令)?(?:自身|自己)?获得${NUM}个${NUM}点的?护罩$|^(?:为|给)自身附加${NUM}点护罩$|^获得${NUM}点护罩$|^附加${NUM}点护罩$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const flat = ns[ns.length - 1]; const count = ns.length > 1 ? ns[0] : undefined; return { effects: [{ op: "apply_status", name: "ward", target: "self", params: { flat, kindMask: 3, ...(count !== undefined ? { count, each: flat } : {}) } }] }; } },
  { id: "attach-damage-95", re: /护罩消失时|护罩所吸收(?!的?伤害值?\d+%)|护罩值(?!之和|总值|合计|低于)/, go: () => ({ unparsedReason: "shield lifecycle — E4" }) },
  // r6c：「(该|此)护盾消失时反转(对手|对方|敌方)(的)能力提升(状态)」——前窗是护盾生命周期，后文是已有 op
  // （`invert_stages` sign:up / target:opponent，见 batch-e6-181、batch-e32 系）。attach-damage-96 的
  // 「护盾消失时」是未锚定子串，会把这句整句留成 shield lifecycle — E4；这里只认这一种整句，放在它正前方先接住。
  // go 复用已导入的 reactWrap(4)——破盾反应窗与 e28-df-02 / r5d-shield-react 同一主体（damage.ts 吸收池耗尽处 fireReactive 4）。
  // 后文不是「反转对手能力提升状态」的「该护盾消失时X」一律交回 attach-damage-96 留档。
  { id: "r6c-shield-invert", re: /^(?:该|此)护盾消失时(?:反转)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:状态|效果)?$/, go: () => reactWrap(4, {}, "反转对手能力提升状态") },
  { id: "attach-damage-96", re: /护盾消失时|护盾所吸收的伤害(?!值?(?:以固定伤害的形式)?\d+%)|护盾值.*反弹|护盾值总和(?!的?体力)/, go: () => ({ unparsedReason: "shield lifecycle — E4" }) },
  { id: "attach-damage-97", re: new RegExp(`^(?:恢复|回复)${NUM}\\s*/\\s*${NUM}(?:点)?体力$|^恢复自身${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]), target: "self" }] }) },

  { id: "attach-damage-98", re: new RegExp(`^(?:可以)?抵挡${NUM}点?伤害$|^可?抵挡${NUM}点?伤害$|^抵挡${NUM}点?(?:的)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "attach-damage-99", re: new RegExp(`^每回合被攻击所受到的伤害不超过(\\d+)$|^每回合受到的伤害不超过(\\d+)(?:点)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // "附加对手防御值与特防值之和10%的固定伤害"（attach-damage 侧的 flatFoeStatPct 已有读取；batch-e5-11 之和句式只收「双防之和/总和」无「值」字）。放在 batch-e5-11 前面。
  { id: "p1-atd-03", re: new RegExp(`^附加(?:对手|对方|敌方)(?:防御|物防)(?:值)?(?:与|和)(?:特防|物防)值?之和?${NUM}%的(?:固定|固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatFoeStatPct: { stats: ["def", "sdf"], pct: num(m[1]) } } }) },
  // "附加对手特防值的固定伤害"/"附加对手特防值30%的固伤"（单维省略百分比 = 100%）
  { id: "p1-atd-03b", re: /^附加(?:对手|对方|敌方)(防御|特防)值(?:的)?(?:固定|固伤|固定伤害)$/, go: (m) => ({ attachDamage: { flatFoeStatPct: { stats: [m[1] === "特防" ? "sdf" : "def"], pct: 100 } } }) },
  { id: "attach-damage-100", re: new RegExp(`^自身攻击(?:技能)?先制\\+${NUM}$|^攻击必定先出手$|^攻击先制\\+${NUM}$`), go: (m) => ({ flags: { priority: m[1] !== undefined ? num(m[1]) : (m[2] !== undefined ? num(m[2]) : 9) } }) }, // "必定先出手"→9 UNVERIFIED
  { id: "attach-damage-101", re: /^(?:吸取|偷取|吸收)(对手|对方|敌方)(?:的)?能力(?:提升|增强)(?:状态)?$/, go: () => ({ effects: [{ op: "transfer_stages" }] }) },
  { id: "attach-damage-102", re: new RegExp(`^随机恢复(\\d+)(?:[-~—至到](\\d+)|到(\\d+))(?:点)?(?:体力|生命值|HP)$`), go: (m) => ({ effects: [{ op: "heal", flatRange: { min: num(m[1]), max: num(m[2] ?? m[3]) }, target: "self" }] }) },
  { id: "attach-damage-103", re: /^(?:自身)?(?:强化|提升|强化类)效果翻倍$/, go: () => ({ attachAll: { stageDouble: true } }) },
  { id: "attach-damage-104", re: /^效果翻倍$/, go: () => ({ attachAll: { effectDouble: true } }) },
  { id: "attach-damage-105", re: /^若(.+)$/, go: (m) => (condOf(m[1]) !== undefined ? { unparsedReason: "orphan condition" } : null) },
  { id: "attach-damage-106", re: /^无视对手免疫伤害效果$|^无视对手伤害免疫$/, go: () => ({ attachDamage: { pierce: true } }) },
  { id: "attach-damage-107", re: new RegExp(`^(?:对手|对方|敌方)处于异常状态时(?:自身)?造成的伤害提高${NUM}%$`), go: (m) => ({ attachDamage: { mulIf: { when: { foeStatused: true }, numerator: 100 + num(m[1]), denominator: 100 } } }) },
  { id: "attach-damage-108", re: /^消耗自身全部体力$|^消耗自身(?:所有|全部)体力$/, go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent", target: "self" }] }) },
  { id: "attach-damage-109", re: new RegExp(`^(?:对方|对手|敌方)所受伤害的${NUM}\\s*/\\s*${NUM}会?反弹给(?:自己|自身|对方)$|^(?:将|把)所受伤害的${NUM}\\s*/\\s*${NUM}反弹给(?:对手|对方)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "attach-damage-110", re: new RegExp(`^(?:自身)?体力低于${NUM}\\s*/\\s*${NUM}时?威力${NUM}倍$`), go: (m) => ({ attachDamage: { scaleIf: { when: { selfHpBelow: frac(m[1], m[2]) }, numerator: num(m[3]), denominator: 1 } } }) },
  { id: "attach-damage-111", re: new RegExp(`^自身体力高于${NUM}\\s*/\\s*${NUM}时?强化效果翻倍$|^对手处于异常状态时强化效果翻倍$|^自身不处于能力(?:强化|提升)状态时强化效果翻倍$|^自身体力低于${NUM}\\s*/\\s*${NUM}时?强化效果翻倍$`), go: (m) => ({ attachAll: { stageIf: m[1] !== undefined ? { selfHpAbove: frac(m[1], m[2]) } : /异常状态/.test(m[0]) ? { foeStatused: true } : /不处于/.test(m[0]) ? { not: { selfStageUp: true } } : { selfHpBelow: frac(m[3], m[4]) } } }) },
  { id: "attach-damage-112", re: new RegExp(`^(?:恢复体力时)?若?自身体力(?:低于|少于)(?:最大体力的)?${NUM}\\s*/\\s*${NUM}则?恢复效果翻倍$|^(?:恢复体力时)?若?自身体力(?:低于|少于)${NUM}%(?:时)?则?恢复效果翻倍$`), go: (m) => ({ attachAll: { healIf: { selfHpBelow: m[3] !== undefined ? frac(num(m[3]), 100) : frac(m[1], m[2]) } } }) },
  { id: "attach-damage-113", re: new RegExp(`^每回合${NUM}%闪避(?:对手|对方)?攻击$|^${NUM}%(?:概率)?闪避(?:对手|对方)?攻击$|^每回合${NUM}%(?:概率)?(?:使|令)?(?:对手|对方)攻击miss$/i`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: pct(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "attach-damage-114", re: new RegExp(`^(?:使|令|改变)?(自身|对方|对手|自己|敌方)?双防(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[2] === "-" ? -1 : 1) * num(m[3]); const t = m[1] ? tgt(m[1]) : "self"; return { effects: [stageFx("def", d, t), stageFx("sdf", d, t)] }; } },
  { id: "attach-damage-115", re: new RegExp(`^(?:使|令|改变)?(自身|对方|对手|自己|敌方)?双攻(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[2] === "-" ? -1 : 1) * num(m[3]); const t = m[1] ? tgt(m[1]) : "self"; return { effects: [stageFx("atk", d, t), stageFx("spa", d, t)] }; } },
  // "令对手的技能先制-1"。没有回合窗，先制一直在。放在 attach-damage-116 前面，那条要写「回合」。
  { id: "attach-damage-116a", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)的技能先制-${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "opponent", params: { add: -num(m[1]) } }] }) },
  // "双方每有1方精灵先制为0，对手下N回合先制-M"——带 prioZero 门控的削减窗（星光·雷纳多）。
  // 必须排在 attach-damage-116 前面：那条要求句首直接是「(令)对手…下N回合先制-」，认不了这个前置条件。
  { id: "attach-damage-115z", re: new RegExp(`^(?:双方每有?|若有?|若双方每有?)(${NUM})方(?:精灵)?先制为0[，,](?:对手|对方|敌方)下(${NUM})回合(?:所有技能)?先制-${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "opponent", turns: num(m[2]), params: { add: -num(m[3]) }, if: { prioZero: true } }] }) },
  { id: "attach-damage-116", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)下?(${NUM})?回合先制-${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "opponent", turns: m[1] !== undefined ? num(m[1]) : 1, params: { add: -num(m[3]) } }] }) },
  { id: "attach-damage-117", re: /^消强$|^消除强化$|^消除(?:对手|对方)(?:的)?强化$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "attach-damage-118", re: /^最高概率(\d+)%$/, go: (m) => ({ attachAll: { capTail: { value: num(m[1]), unit: "%", src: m[0] } } }) },
  { id: "attach-damage-119", re: new RegExp(`^每次使用增加${NUM}%$|^连续使用每次增加${NUM}%$`), go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1] ?? m[2]), denominator: 100 } } }) },
  { id: "attach-damage-120", re: new RegExp(`^(?:连续使用|每次使用)(?:每次)?(?:基础)?威力(?:(?:提升|提高|增加|加)\\+?|\\+)${NUM}(?:点)?$|^连续使用(?:威力)?提升${NUM}点$|^连续使用(?:每次)?增加${NUM}威力$|^连续使用增加威力${NUM}$`), go: (m) => ({ attachDamage: { powerPerUse: num(m[1] ?? m[2] ?? m[3] ?? m[4]) } }) },
  { id: "attach-damage-121", re: new RegExp(`^随机范围\\d+[-~—至到]\\d+$`), go: () => ({ unparsedReason: "random power — E4" }) },
  { id: "attach-damage-122", re: /^对方能力等级越高|^(?:对手|对方)能力等级越高/, go: () => ({ unparsedReason: "stage-scaled power — E4" }) },
  { id: "attach-damage-123", re: /^惩罚$|^必败$/, go: () => ({ unparsedReason: "ambiguous token" }) },
  { id: "attach-damage-124", re: /^自身所有攻击(?:将)?无视对手能力(?:强化|提升)状态$|^无视对手能力(?:强化|提升)状态$|^无视对手双防能力提升状态$|^无视(?:对手|对方|敌方)(?:的)?双防(?:能力)?(?:提升|强化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  { id: "attach-damage-125", re: new RegExp(`^自身先制([+-])${NUM}$`), go: (m) => ({ flags: { priority: (m[1] === "-" ? -1 : 1) * num(m[2]) } }) },
];
