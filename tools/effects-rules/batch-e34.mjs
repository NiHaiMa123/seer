// batch-e34：no-rule 头部第四批——全部接线既有语义；需要引擎小改的走 attachAll/新键（引擎同批落）。
//   连击区间/上限条件、机率拼写变体、闪避概率、护罩、减半别名、能力增强消失、解弱化、
//   直接攻击暴击、无视速度、招式失效、能力下降反馈、伤害上限、受击回血反应、反弹分数、
//   每回合概率异常 tick、已损失基数伤害、对手侧阶梯固伤、PP 总和固伤、回合末伤害量固伤、
//   PP 对偶设定、体力百分比对调、固伤次数免疫、攻击百分比骑乘、命中耗PP增威、
//   延长/转变形态、裸恢复分数、回合类效果残段、无效化、无奖励句忽略
import { NUM, num, AIL_RE, AILMENTS, STATS, STAT_RE, frac, stageFx } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── 连击区间（"1回合做2-3次攻击"/"3-5次攻击" → attachDamage.hits{min,max}） ──
  { id: "e34-hits-01", re: new RegExp(`^(?:(?:一|1)回合(?:内|中)?)?(?:做|进行|可以?连续)?${NUM}\\s*[-~～—至到]\\s*${NUM}次(?:连续)?攻击$`), go: (m) => ({ attachDamage: { hits: { min: num(m[1]), max: num(m[2]) } } }) },
  // ── 连击上限（"连击上限为5次"→hitsCap；带条件"对手处于异常状态时连击上限为5"→hitsCapIf） ──
  { id: "e34-hcap-01", re: new RegExp(`^(?:(?:对手|对方|敌方)处于异常状态[时则](?:连击|攻击次数)上限为?${NUM}次?|(?:连击|攻击次数)上限为?${NUM}次?$)`), go: (m) => m[1] !== undefined ? { attachDamage: { hitsCapIf: { when: { foeStatused: true }, cap: num(m[1]) } } } : { attachDamage: { hitsCap: num(m[2]) } } },
  // ── 机率拼写变体（"3%机率伤害为3倍" → mulChance；"N%机率令对手AIL" 经 bcm 机率补全走既有规则） ──
  { id: "e34-mul-01", re: new RegExp(`^${NUM}%(?:的)?(?:机率|几率|概率)?伤害为${NUM}倍$`), go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1]), numerator: num(m[2]), denominator: 1 } } }) },
  { id: "e34-ail-01", re: new RegExp(`^${NUM}%(?:的)?(?:机率|几率|概率)令?(对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent", chance: num(m[1]) }] }) },
  // ── 概率闪避（"50%的机率回避对手攻击" → dodge{pct} 持续窗，逐击判定） ──
  { id: "e34-dodge-01", re: new RegExp(`^${NUM}%(?:的)?(?:机率|几率|概率)回避(?:对手|对方|敌方)?的?攻击(?:伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]) } }] }) },
  { id: "e34-dodge-02", re: new RegExp(`^${NUM}%(?:的)?(?:机率|几率|概率)免疫(?:对手|对方|敌方)?的?攻击(?:伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1]) } }] }) },
  // ── 护罩/护盾（"为自身创造一个生命值为300的护罩" → shield flat） ──
  { id: "e34-shield-01", re: new RegExp(`^(?:为|给)(自身|自己)创造(?:一|1)?个?(?:生命值为?|耐久为?|额度为?)?${NUM}点?(?:的)?护[盾罩]$`), go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[2]) } }] }) },
  // ── 减半别名（"自身受到的物理攻击伤害减半" → phys_half / spec_half） ──
  { id: "e34-half-01", re: /^(?:(?:自身|自己)受到(?:的)?|受到?(?:的)?)物理攻击?(?:的)?伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "phys_half", target: "self" }] }) },
  { id: "e34-half-02", re: /^(?:(?:自身|自己)受到(?:的)?|受到?(?:的)?)特殊攻击?(?:的)?伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  // ── 能力增强消失 / 解弱化（"对方能力增强消失" → clear_stages；"解自身弱化" → clear self down） ──
  { id: "p2-clr-01",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)(?:所用|所有)?(?:的)?(?:能力)?(?:提升|增强|强化)(?:状态|效果)?(?:全部)?(?:消失|失效)$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }),
  },
  { id: "p2-clr-02",
    re: /^(?:消除|清除|驱散)(?:对手|对方|敌方)(?:的)?能力等级$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent" }] }),
  },
  { id: "e34-clr-01", re: /^(?:使|令|让)?(?:对手|对方|敌方)(?:的)?能力(?:提升|增强|强化)(?:状态)?(?:消失|消除|清除|消散)$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "e34-clr-02", re: /^解除?(?:自身|自己)(?:的)?弱化(?:状态)?$|^解除?(?:自身|自己)(?:的)?能力下降(?:状态)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // ── 直接攻击必定暴击（"自身直接攻击必定暴击" → crit_always；直接攻击=攻击技，致命只结算攻击伤害） ──
  { id: "e34-crit-01", re: /^(?:自身|自己)?直接攻击必定(?:暴击|致命一?击)$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  // ── 无视速度（move flag——先制打平后不比速度） ──
  { id: "e34-ignspd-01", re: /^无视(?:对手|对方|敌方|对方精灵)?速度$/, go: () => ({ flags: { ignoreFoeSpeed: true } }) },
  // ── 招式失效（"使对手下次施放的技能无效" → move_null count:1） ──
  { id: "e34-null-01", re: /^(?:使|令|让)(?:对手|对方|敌方)下次(?:施放|使用|释放)?的?技能无效(?:（[^）]*）|\([^)]*\))?$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  // ── 能力下降反馈（"将自身能力下降反馈给对手" → transfer_stages push down） ──
  { id: "p2-push-02",
    re: /^将(?:自身|自己)(?:的)?能力(?:下降|弱化)(?:状态)?(?:转移|反馈|施加|附加)(?:到|给)?(?:对手|对方|敌方)(?:身上)?$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }),
  },
  { id: "e34-push-01", re: /^将(?:自身|自己)(?:的)?能力下降(?:状态)?(?:反馈|转移|转移给|施加|附加)给?(对手|对方|敌方)$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // ── 伤害上限（"每回合受到伤害不超过250" → dmg_cap；窗由 partTurns/ctxTurns 注入） ──
  { id: "e34-cap-01", re: new RegExp(`^每回合(?:自身|自己)?受到的?(?:攻击)?伤害不(?:超过|大于)${NUM}点?$|^受到的?(?:攻击)?伤害不(?:超过|大于)${NUM}点?$|^被攻击所受到的伤害不(?:会)?超过${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // ── 受击回血反应（"受到攻击100%恢复1/3HP" → react trigger1 chance + heal payload） ──
  { id: "e34-react-01", re: new RegExp(`^受到攻击${NUM}%(?:的)?(?:几率|机率|概率)?恢复${NUM}\\s*/\\s*${NUM}(?:HP|体力)?$|^受到攻击${NUM}%(?:的)?(?:几率|机率|概率)?恢复${NUM}点?(?:体力|HP)$|^受到攻击${NUM}%(?:的)?(?:几率|机率|概率)?恢复自身最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ch = num(m[1] ?? m[4] ?? m[6]); const n = num(m[2] ?? m[5] ?? m[7]); const d = m[3] !== undefined || m[8] !== undefined ? num(m[3] ?? m[8]) : undefined; return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, ...(ch === 100 ? {} : { chance: ch }) }, payload: [{ op: "heal", ...(d !== undefined ? { numerator: n, denominator: d } : { flat: n }), target: "self" }] }] }; } },
  // ── 反弹分数（"反弹对手1/3造成的伤害" → reflect_dmg{n,d}） ──
  { id: "e34-refl-01", re: new RegExp(`^反弹(?:对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}造成的伤害$|^反弹(?:对手|对方|敌方)?造成?的?伤害(?:的)?${NUM}\\s*/\\s*${NUM}$|^反弹受到?的?伤害(?:的)?${NUM}\\s*/\\s*${NUM}$|^反弹伤害的?${NUM}\\s*/\\s*${NUM}$|^反弹伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[0] ?? 1, d: ns[1] ?? 1 } }] }; } },
  // "做出强力反击"/"反击对手"/"反击"裸形 → counter{mul:1}（反击载体既有，倍率未标按 100% 惯例）
  { id: "e34-refl-02", re: /^(?:做出|进行|发动)?(?:强力|猛烈)?反击(?:对手|对方|敌方|回去)?$/, go: () => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: 1 } }] }) },
  // ── 每回合概率异常 tick（"每回合额外附加50%几率令对手害怕" → ailment_tick payload chance） ──
  { id: "p2-tick-02",
    re: /^每回合(?:额外)?(?:有)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%(?:的)?(?:几率|机率|概率)?(?:让|令|使)(?:对手|对方|敌方)(烧伤|冻伤|中毒|麻痹|害怕|睡眠|失明|失神|束缚|混乱|寄生|诅咒|疲惫|流血|沉默|冰封|易燃|焚烬|石化|瘫痪|感染|狂暴|衰弱|臣服|冷冻)(?:状态)?$/,
    go: (m) => { const il = AILMENTS[m[2]]; if (il === undefined) return null; return { effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_status", name: il, target: "opponent", chance: num(m[1]) }] })] }; },
  },
  { id: "e34-tick-01", re: new RegExp(`^每回合(?:额外)?附加${NUM}%(?:的)?(?:几率|机率|概率)令(对手|对方|敌方)(${AIL_RE})(?:状态)?$|^每回合有${NUM}%(?:的)?几率令(对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => { const ch = num(m[1] ?? m[4]); const ail = AILMENTS[m[3] ?? m[6]]; if (ail === undefined) return null; return { effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_status", name: ail, target: "opponent", chance: ch }] })] }; } },
  // ── 已损失体力百分比伤害（"附加已损失体力值25%的百分比伤害"——惯例：对手已损失，flatFoeFrac 仅固伤族；百分比伤害走 percentBase:"foeMissing"） ──
  { id: "e34-pctmiss-01", re: new RegExp(`^附加(?:对手|对方|敌方)?已损失体力(?:值)?(?:的)?${NUM}%(?:的)?百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 0, frac: frac(num(m[1]), 100), percentBase: "foeMissing", target: "opponent" }] }) },
  // ── 自身当前体力消耗（"消耗自身当前体力的1/2" → percentBase selfCur 自伤） ──
  { id: "e34-selfcost-01", re: new RegExp(`^消耗(?:自身|自己)当前体力(?:的)?${NUM}\\s*/\\s*${NUM}$|^消耗(?:自身|自己)当前体力(?:的)?${NUM}%$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: m[3] !== undefined ? frac(num(m[3]), 100) : frac(num(m[1]), num(m[2])), percentBase: "selfCur", target: "self" }] }) },
  // ── 对手异常计数伤害加成（"对手每处于一种异常状态造成的伤害提升50%" → pctPerFoeAil） ──
  { id: "e34-foeail-01", re: new RegExp(`^(?:对手|对方|敌方)每处于一种异常状态(?:造成的)?伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ attachDamage: { dmgPctPerFoeAil: { pct: num(m[1]) } } }) },
  // ── 一方能力下降固伤（"若有一方处于能力下降状态则附加200固定伤害" → flatIf or-cond） ──
  { id: "p2-flat-first",
    re: /^先出手(?:时)?(?:加|附加|附带|额外附加)(?:\+)?(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))(?:点)?(?:固伤|固定伤害)$/,
    go: (m) => ({ attachDamage: { flatIf: { when: { order: "first" }, flat: num(m[1]) } } }),
  },
  { id: "e34-anydown-01", re: new RegExp(`^若有一方处于能力下降状态则附加${NUM}点?(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatIf: { when: { or: [{ selfStageDown: true }, { foeStageDown: true }] }, flat: num(m[1]) } } }) },
  // ── 回合末伤害量固伤（"回合结束时附加100%伤害量的固定伤害" → dealt_tick{pct}，回合末读 lastDealt） ──
  { id: "e34-dealt-01", re: new RegExp(`^(?:回合结束[时后]|每回合)(?:时)?(?:额外)?附加${NUM}%(?:的)?伤害量的?(?:固定伤害|固伤|百分比伤害|伤害)$|^(?:回合结束[时后]|每回合)(?:时)?(?:额外)?附加(?:造成|自身造成)伤害的${NUM}%(?:的)?(?:固定伤害|固伤|百分比伤害|伤害)$|^(?:回合结束[时后]|每回合)(?:时)?(?:额外)?附加等量(?:的)?伤害$|^(?:回合结束[时后]|每回合)(?:时)?(?:额外)?附加等量固定伤害$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "dealt_tick", target: "self", params: { pct: num(m[1] ?? m[2] ?? 100) } })] }) },
  // ── 双方 PP 对偶（"令双方所有技能PP值等于此技能剩余PP值" → pp_delta setFromThis 双侧） ──
  { id: "e34-ppset-01", re: /^令?双方(?:所有)?技能PP值?等于此技能剩余PP值$/, go: () => ({ effects: [{ op: "pp_delta", target: "self", setFromThis: true }, { op: "pp_delta", target: "opponent", setFromThis: true }] }) },
  // ── 体力百分比对调（"使自身体力百分比与对手体力百分比对调" → hp_swap） ──
  { id: "e34-hpswap-01", re: /^(?:使|令|让)?自身(?:的)?体力百分比与(?:对手|对方|敌方)(?:的)?体力百分比(?:对调|互换|交换)$/, go: () => ({ effects: [{ op: "swap_hp", target: "opponent", swapPercent: true }] }) },
  // ── 固伤次数免疫（"免疫下1次受到的固定伤害和百分比伤害" → flat_immune count） ──
  { id: "e34-imm-01", re: new RegExp(`^免疫下${NUM}次受到的?(?:固定伤害和百分比伤害|百分比伤害和固定伤害|固定伤害或百分比伤害|固定伤害|百分比伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "flat_immune", target: "self", params: { count: num(m[1]) } }] }) },
  // ── 下N次攻击百分比骑乘（"自身下2次攻击技能附加对手最大体力1/3的百分比伤害" → pct_rider{n,d,count}） ──
  { id: "e34-rider-01", re: new RegExp(`^(?:自身|自己)?下${NUM}次攻击(?:技能)?附加(?:对手|对方|敌方)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的百分比伤害$|^下${NUM}次攻击(?:技能)?附加对手最大体力${NUM}%的百分比伤害$`), go: (m) => m[4] !== undefined ? { effects: [{ op: "apply_status", name: "pct_rider", target: "self", params: { count: num(m[4]), n: num(m[5]), d: 100 } }] } : { effects: [{ op: "apply_status", name: "pct_rider", target: "self", params: { count: num(m[1]), n: num(m[2]), d: num(m[3]) } }] } },
  // ── 命中耗PP增威（"下1次攻击命中时消耗所使用攻击技能的全部PP值，每消耗1点威力提升10%" → pp_consume_hit{count,pctPerPp}） ──
  { id: "e34-ppcon-01", re: new RegExp(`^下${NUM}次攻击命中时消耗(?:自身|自己)?所使用(?:的)?攻击技能的全部PP值$|^下${NUM}次攻击命中时消耗(?:所使用)?技能的全部PP值$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_consume_hit", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  { id: "e34-ppcon-02", re: new RegExp(`^每消耗${NUM}?点(?:PP)?(?:威力|伤害)(?:提升|增加)${NUM}%$`), go: (m) => ({ attachAll: { ppPctPerPp: num(m[2]), ...(num(m[1]) > 1 ? { ppStep: num(m[1]) } : {}) } }) },
  { id: "e34-ppcon-03", re: new RegExp(`^每消耗${NUM}?点(?:PP)?令(对手|对方|敌方)全属性([+-]?)${NUM}$`), go: (m) => ({ attachAll: { ppFoeAllDown: num(m[4]), ...(m[1] !== undefined && num(m[1]) > 1 ? { ppStep: num(m[1]) } : {}) } }) },
  // ── 条件延长（"若本次技能造成的伤害高于400则闪避效果延长1回合" → extendTurnsIf 克隆末条+turns+if） ──
  { id: "e34-extend-01", re: new RegExp(`^若本次(?:技能)?造成的伤害高于${NUM}则(闪避|回避|护盾|免疫|效果)?效果?延长${NUM}回合$|^${NUM}回合(?:的)?(?:闪避|回避)效果延长${NUM}回合$`), go: (m) => m[4] !== undefined ? { attachAll: { extendTurns: num(m[5]) } } : { attachAll: { extendTurnsIf: { when: { prevDamageAboveAbs: num(m[1]) }, turns: num(m[3]) } } } },
  // ── 效果转变（"若…则效果转变为300-350点" → flatRangeRepIf 宿主改写；"恢复效果转变为吸取对手N点体力" → healToDrainIf） ──
  { id: "e34-trans-01", re: new RegExp(`^效果转变为${NUM}\\s*[-~～—至到]\\s*${NUM}点(?:伤害|体力)?$|^转变为${NUM}\\s*[-~～—至到]\\s*${NUM}点$`), go: (m) => ({ attachAll: { flatRangeRepIf: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }) },
  { id: "e34-trans-02", re: new RegExp(`^效果转变为附加自身最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的百分比伤害$`), go: (m) => ({ attachAll: { healToPctIf: { n: num(m[1]), d: num(m[2]) } } }) },
  { id: "e34-trans-03", re: new RegExp(`^恢复效果转变为吸取(?:对手|对方|敌方)${NUM}点体力$|^转变为吸取(?:对手|对方|敌方)${NUM}点体力$`), go: (m) => ({ attachAll: { healToDrainIf: { flat: num(m[1] ?? m[2]) } } }) },
  // ── 裸恢复分数（"恢复1/3" → heal frac self；恢复全部体力=1/1 走 heal-06 既有规则） ──
  { id: "e34-heal-01", re: new RegExp(`^恢复${NUM}\\s*/\\s*${NUM}(?:HP|体力)?$|^恢复${NUM}%(?:的)?(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "heal", target: "self", ...(m[3] !== undefined ? { numerator: num(m[3]), denominator: 100 } : { numerator: num(m[1]), denominator: num(m[2]) }) }] }) },
  // "消耗自身的护盾并附加等量的固定伤害"。放在 e34-cshield-01 前面，那条要「造成」且没有「的」。
  { id: "e34-cshield-01a", re: /^消耗(?:自身|自己)的护盾并附加等量的(?:固定伤害|固伤)$/, go: () => ({ attachDamage: { consumeShield: true } }) },
  // ── 消耗护盾转固伤（"消耗自身所有护盾值并造成等量固定伤害" → attachDamage consumeShield 引擎既有） ──
  { id: "e34-cshield-01", re: /^消耗(?:自身|自己)(?:所有|全部)?护盾(?:值)?并造成等量(?:固定伤害|固伤|伤害)$/, go: () => ({ attachDamage: { consumeShield: true } }) },
  // ── 对手 PP 亏损总和固伤（"附加对手已损失PP值总和×20的固定伤害" → flatFoePpMissing） ──
  { id: "e34-ppmiss-01", re: new RegExp(`^附加(?:对手|对方|敌方)(?:当前)?(?:已)?损失(?:的)?(?:技能)?PP值?(?:总和)?[×xX*]${NUM}的?(?:固定伤害|固伤)$|^附加(?:对手|对方|敌方)已损失PP值总和${NUM}倍?的?(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatFoePpMissing: { mul: num(m[1] ?? m[2]) } } }) },
  // ── 对手阶梯固伤（"对手每损失2点体力则额外附加1点固定伤害" → flatPerFoeMissing{step,add}） ──
  { id: "e34-foestep-01", re: new RegExp(`^(?:对手|对方|敌方)每损失${NUM}点体力则?(?:额外)?附加${NUM}点(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatPerFoeMissing: { step: num(m[1]), add: num(m[2]) } } }) },
  // ── 同维等级相同计数固伤（"对手每有1项能力等级与自身相同则附加70点固定伤害" → flatPerMatchedStage） ──
  { id: "e34-match-01", re: new RegExp(`^(?:对手|对方|敌方)每有?${NUM}项能力等级与自身相同则?附加${NUM}点(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatPerMatchedStage: { per: num(m[1]), add: num(m[2]) } } }) },
  // ── 对手低 PP 计数先制（"对手每有1个技能PP值小于3先制+1" → move flag prioPerFoeLowPp） ──
  { id: "e34-priolow-01", re: new RegExp(`^(?:对手|对方|敌方)每有?${NUM}个技能PP值?小于${NUM}先制([+-]?)${NUM}$`), go: (m) => ({ flags: { prioPerFoeLowPp: { below: num(m[2]), per: num(m[1]), add: (m[3] === "-" ? -1 : 1) * num(m[4]) } } }) },
  // ── 动态几率（"几率等同于出手时自身当前体力百分比" → chanceSelfCurPct attachAll） ──
  { id: "e34-dyn-01", re: /^几率等同于(?:出手时)?自身当前体力百分比$/, go: () => ({ attachAll: { chanceSelfCurPct: true } }) },
  // ── 场下阵亡消逝（"令对方场下阵亡的首位精灵消逝" → banish_dead 后备槽位移除） ──
  { id: "e34-banish-01", re: /^令?(?:对手|对方|敌方)场下阵亡的?(?:首位|第一只|首个)?精灵消逝$/, go: () => ({ effects: [{ op: "banish_dead", target: "opponent" }] }) },
  // ── 对手下只出场先制失效（"击败对手则对方下只出战精灵首回合先制效果失效" → prio_negate nextFoe） ──
  { id: "e34-prio-01", re: new RegExp(`^(?:对手|对方|敌方)下只(?:出战|出场|登场)?精灵首回合(?:的)?先制效果?失效$|^(?:对方|对手)下回合(?:出战|出场)精灵(?:的)?先制效果?失效$|^首回合(?:的)?先制效果?失效$|^首回合(?:的)?先制效果?无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_negate", target: m[0].startsWith("首回合") ? "opponent" : "nextFoe", turns: 1 }] }) },
  // ── 未受固伤条件异常（"若对手未受到固定伤害则100%令对手冰封" → prevDamageNotKind:"fixed"——我方上一击非固伤即对手未受固伤） ──
  { id: "e34-flatgate-01", re: new RegExp(`^若(?:对手|对方|敌方)未受到固定伤害则${NUM}%?令(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]), if: { prevDamageNotKind: "fixed" } }] }) },
  // ── 场域/奖励/多人目标忽略（非战斗语义） ──
  { id: "p2-ig-01",
    re: /^(?:在)?战斗结束[时后](?:可以|可)?获得[^，,。；;]*(?:泰坦之灵|泰坦之魂|赛尔豆)/,
    go: () => ({ ignored: true }),
  },
  { id: "e34-ig-01", re: /^(?:使用后)?在?战斗结束[时后](?:可以|可)?获得[^，,。；;]*(?:赛尔豆|精灵豆|赛尔金豆|经验|学习力)/, go: () => ({ ignored: true }) },
  { id: "e34-ig-02", re: /^组队(?:是)?(?:可以|可)?(?:影响|作用)(?:${NUM})个目标$|^组队有效$/, go: () => ({ ignored: true }) },
  { id: "e34-ig-03", re: /^(?:普通|水|火|草|电|冰|地面|飞行|超能|格斗|机械|龙|圣灵|远古|神秘|次元|邪灵|混沌|自然|虫|光|暗|神灵|轮回|王|虚空|亡灵|时光)(?:系|属性)?(?:物理|特殊|属性)?攻击$/, go: () => ({ ignored: true }) },
  // ── 不明语义窄钉（等级相关——系数未文档化；"绝对方击"命名机制；"自然庇佑"命名印记） ──
  { id: "e34-uv-01", re: /^(?:自身|自己|对手|对方|敌方)?等级越高/, go: () => ({ unparsedReason: "level-scaled effect — coefficient undocumented (UNVERIFIED)" }) },
  // "绝对方击"→反击语义建模：等量反伤 payload（react trigger1 + flatSelfLastTaken——命名异体沿用反击读法）
  { id: "e34-uv-02", re: new RegExp(`^受到攻击${NUM}%(?:的)?(?:几率|机率|概率)?(?:做出|使用|发动)?绝对方击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", chance: num(m[1]), params: { trigger: 1 }, payload: [{ op: "damage", power: 0, kind: "fixed", flatSelfLastTaken: true }] }] }) },
  // "受到攻击N%进入X" → 命名印记建模（apply_mark mark:<名>——印记即命名状态的引擎表示）
  { id: "e34-uv-03", re: new RegExp(`^受到攻击${NUM}%(?:的)?(?:几率|机率|概率)?进入([^，,。；;]{2,10})$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", chance: num(m[1]), params: { trigger: 1 }, payload: [{ op: "apply_mark", mark: m[2], target: "self" }] }] }) },
  // ── 非限制类子集：随机附加/进入的载体未建模，整句留档；"免疫…非限制类" → immune{nonCtl:1} ──
  { id: "e34-uv-04b", re: /^免疫(?:受到的|承受的)?非限制类异常(?:状态)?$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { nonCtl: 1 } }] }) },
  { id: "e34-uv-04", re: new RegExp(`非限制类异常状态`), go: () => ({ unparsedReason: "non-control ailment subset — carrier form unmodeled (UNVERIFIED)" }) },
  // ── 强化前快照补偿（"若强化前自身处于能力下降状态则额外获得等同的能力提升状态"——"等同"读法歧义：+|down| 增益 vs 置位 +|down|——UNVERIFIED） ──
  { id: "e34-uv-05", re: /强化前(?:自身|自己)?处于能力下降状态则额外获得等同的能力提升状态/, go: () => ({ unparsedReason: "pre-buff snapshot mirror — 'equal' read ambiguous (UNVERIFIED)" }) },
];
