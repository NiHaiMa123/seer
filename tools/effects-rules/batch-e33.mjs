// batch-e33：封顶尾宿主补全 + 残留直连批。
// 目标句式（全部是引擎已具备语义的接线，不引入新机制）：
//   叠用成长宿主：致命几率逐用累加、对手当前体力%固伤逐用累加（"加对手当前体力5%伤害，连续用每次5%，最高30%"）
//   MISS 在 attach-damage.mjs 前置（触发器 2/6，需先于 attach-damage-69 兜底）
//   承伤减半别名、自身体力基数固伤/百分比、吸血分数、N%回血、等量固伤尾、后备回血、
//   技能失败、状态刷新、回合类效果被消除反应、能力下降免疫、强化锁定裸句、
//   体力阈值倍伤、PP随机归零（含 nextFoe）、异常枚举下免疫、体力置为百分比
import { NUM, num, AIL_RE, AILMENTS, STATS, STAT_RE, frac } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

const AIL_LIST = `((${AIL_RE})(?:、(${AIL_RE}))*)`;
// "自身在烧伤、冻伤状态下X" → if:{or:[{selfHas:ail}…]}
const ailOr = (m, idx = 1) => {
  const names = m[idx].match(new RegExp(AIL_RE, "g")) ?? [];
  const or = names.map((n) => ({ selfHas: AILMENTS[n] })).filter((c) => c.selfHas !== undefined);
  return or.length === 0 ? undefined : or.length === 1 ? or[0] : { or };
};

export const rules = [
  // ── 承伤减半别名（"受到物攻伤害减半"="受到物理攻击伤害减半"——phys_half/spec_half 既有状态） ──
  // "物攻伤害减半"（省主语+省「受到」）。放在 e33-half-01 前面，那条要求句首「受到」。
  { id: "e33-half-00", re: /^(?:自身|自己)?(?:物攻|物理攻击|特攻|特殊攻击)(?:的)?伤害减半$/, go: (m) => ({ effects: [{ op: "apply_status", name: /^(?:自身|自己)?(?:物攻|物理攻击)/.test(m[0]) ? "phys_half" : "spec_half", target: "self" }] }) },
  { id: "e33-half-01", re: /^受到物攻(?:的)?伤害减半$|^受到物理攻击伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "phys_half", target: "self" }] }) },
  // "自身受特攻伤害减半"。放在 e33-half-02 前面，那条吃不下「自身受」。
  { id: "e33-half-02a", re: /^(?:自身|自己)受特攻(?:的)?伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  { id: "p2-half-03",
    re: /^(?:自身|自己)?受到?特攻(?:的)?减伤50%$/,
    go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }),
  },
  { id: "e33-half-02", re: /^受到特攻(?:的)?伤害减半$|^受到特殊攻击伤害减半$|^自己?受特功(?:的)?伤害减半$|^自己?受特殊攻击伤害减半$/, go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  // ── 自身体力基数伤害（flatSelfFrac base 语义既有；"使对手受到自身最大体力1/3的固定伤害"） ──
  { id: "p2-flat-selfmax",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)受到(?:相当于|等同于)?自身最大体力(?:值)?(?:的)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)s*\/s*([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:的)?(?:固伤|固定伤害)$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "max" } }] }),
  },
  { id: "e33-flat-01", re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)受到(?:相当于|等同于)?自身最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "max" } }] }) },
  { id: "e33-flat-02", re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)受到(?:相当于|等同于)?自身当前体力(?:的)?${NUM}\\s*/\\s*${NUM}的(?:固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "current" } }] }) },
  { id: "e33-flat-03", re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)受到(?:相当于|等同于)?自身最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), num(m[2])), percentBase: "selfMax", target: "opponent" }] }) },
  { id: "e33-flat-04", re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)受到(?:相当于|等同于)?自身最大体力(?:的)?${NUM}%的百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), 100), percentBase: "selfMax", target: "opponent" }] }) },
  { id: "e33-flat-05", re: new RegExp(`^附加(?:对手|对方|敌方)当前体力(?:的)?${NUM}%的百分比伤害$|^附加自身当前体力(?:的)?${NUM}%的百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1] ?? m[2]), 100), percentBase: /自身/.test(m[0]) ? "selfCur" : "current", target: "opponent" }] }) },
  // "对对方造成的1/2伤害恢复自身体力"。分数在「伤害」前面。放在 e33-drain-01a 前面。
  { id: "e33-drain-01b", re: new RegExp(`^(?:对|给)(?:对方|对手|敌方)造成的${NUM}\\s*/\\s*${NUM}伤害(?:恢复|回复)(?:自身|自己)?体力$`), go: (m) => ({ attachDamage: { drain: frac(m[1], m[2]) } }) },
  // "对对方伤害的1/2恢复体力"。放在 e33-drain-01 前面，那条要「造成伤害」。
  { id: "e33-drain-01a", re: new RegExp(`^(?:对|给)(?:对方|对手|敌方)伤害的${NUM}\\s*/\\s*${NUM}(?:恢复|回复)(?:自身|自己)?体力$`), go: (m) => ({ attachDamage: { drain: frac(m[1], m[2]) } }) },
  // ── 吸血分数变体（"攻击造成伤害1/2恢复体力"/"将造成伤害的1/2恢复自身体力"） ──
  { id: "p2-drain-02",
    re: /^(?:每次)?攻击(?:造成|造成伤害)将?(?:会)?恢复(?:自身|自己)?体力$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }),
  },
  { id: "e33-drain-01", re: new RegExp(`^(?:攻击)?造成(?:的)?伤害(?:的)?${NUM}\\s*/\\s*${NUM}恢复(?:自身|自己)?体力$|^(?:攻击)?造成伤害${NUM}\\s*/\\s*${NUM}恢复(?:自身|自己)?体力$|^将(?:造成的|攻击)(?:伤害)?(?:的)?${NUM}%恢复(?:为)?(?:自身|自己)?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: frac(ns[0], ns.length > 1 ? ns[1] : 100) } }; } },
  // ── N% 分数回血（"恢复50%的体力"/"恢复自身最大体力的40%"） ──
  { id: "p2-heal-02",
    re: /^(?:恢复|回复)(?:自身|自己)(?:的)?(?:最大体力(?:的)?)?(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))%(?:的)?(?:HP|hp|血量|血)$/,
    go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: 100, target: "self" }] }),
  },
  { id: "e33-heal-01", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:的)?(?:最大体力(?:的)?)?${NUM}%(?:的体力)?$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: 100, target: "self" }] }) },
  // ── 等量固伤尾（"恢复自身体力，使对手受到等量固定伤害"→heal.foeEcho 队列挂载） ──
  { id: "e33-echo-01", re: /^(?:使|令|让)(?:对手|对方|敌方)受到等量(?:的)?(?:固定伤害|固伤)$|^给(?:对手|对方|敌方)造成等量(?:的)?(?:固定伤害|固伤)$/, go: () => ({ attachAll: { healEcho: true } }) },
  // ── 后备回血（"为己方所有不在场精灵恢复200点体力"——heal target:"bench" 既有通道） ──
  { id: "e33-bench-01", re: new RegExp(`^为(?:己方|我方|本方)(?:所有)?(?:不在场|场下|后备)精灵恢复${NUM}点体力$|^恢复(?:己方|我方|本方)(?:所有)?(?:不在场|场下|后备)精灵${NUM}点体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "bench" }] }) },
  // ── 技能失败（"令对方技能失败"→move_null 单次任意类别） ──
  { id: "e33-null-01", re: /^(?:使|令|让)(?:对方|对手|敌方)(?:的)?技能(?:失败|失效)$|^使(?:对方|对手|敌方)技能无效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { count: 1 } }] }) },
  // ── 状态刷新（"将此状态刷新至3回合"→最近 apply_status 的 turns 置位——setTurns 挂载点） ──
  { id: "e33-refresh-01", re: new RegExp(`^(?:并)?将此状态刷新至${NUM}回合$|^(?:并)?(?:将|把)(?:该|此)(?:状态|效果)刷新(?:至|到)${NUM}回合$`), go: (m) => ({ attachAll: { setTurns: num(m[1] ?? m[2]) } }) },
  // ── 自身回合类效果被消除反应式（trigger 13——cleanse.ts 在被清侧派发） ──
  { id: "e33-react-01", re: /^若(?:自身|自己)(?:的)?回合类效果被消除(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(13, {}, m[1]) },
  { id: "e33-react-02", re: /^回合类效果被消除(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(13, {}, m[1]) },
  // reactWrap payload 子句："造成的攻击伤害额外减少N%" → dmg_weaken 对手窗（主语由 TURNS_PRE 对手支剥除）
  { id: "e33-react-03", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)?造成的?攻击?伤害(?:额外)?(?:减少|降低)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: 100 - num(m[1]), d: 100 } }] }) },
  // ── 致命几率逐用累加（"每次攻击提升10%致命，最高提升40%"——critPerUsePct+critPerUseCap 既有通道） ──
  { id: "e33-crit-01", re: new RegExp(`^(?:每次|连续)(?:使用|攻击)?(?:技能)?(?:提升|增加|提高)${NUM}%(?:的)?致命(?:一击)?(?:概率|几率|率)?$`), go: (m) => ({ attachDamage: { critPerUsePct: num(m[1]) } }) },
  { id: "e33-crit-02", re: new RegExp(`^(?:攻击)?(?:技能)?(?:提升|增加|提高)${NUM}%(?:的)?致命(?:一击)?(?:概率|几率|率)?$|^攻击(?:技能)?致命(?:一击)?(?:概率|几率|率)?(?:提升|增加|提高)${NUM}%$`), go: (m) => ({ attachDamage: { critPerUsePct: num(m[1] ?? m[2]) } }) },
  // ── 对手当前体力%固伤逐用累加（"加对手当前体力5%伤害，连续用每次5%，最高30%"——flatFoeCurPctPerUse{base,step,cap}） ──
  { id: "p2-fcp-01",
    re: /^附加(?:对手|对方|敌方)当前(?:体力|HP|hp)(?:值)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%(?:固伤|固定伤害|伤害)$/,
    go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }),
  },
  { id: "e33-fcp-01", re: new RegExp(`^(?:附加|加)(?:对手|对方|敌方)当前体力(?:的)?${NUM}%(?:的)?伤害$|^(?:使|令)(?:对手|对方|敌方)受到(?:自身)?当前体力${NUM}%(?:的)?伤害$`), go: (m) => ({ attachDamage: { flatFoeCurPctPerUse: { base: num(m[1] ?? m[2]) } } }) },
  { id: "e33-fcp-02", re: new RegExp(`^(?:连续用?|连用|连续使用)(?:每次)?${NUM}%$|^每次(?:使用)?(?:提升|增加|提高)${NUM}%$`), go: (m) => ({ attachAll: { flatPctGrow: num(m[1] ?? m[2]) } }) },
  // ── 能力下降类技能免疫（"免疫能力下降类技能"→immune_degrade 既有状态） ──
  { id: "e33-immune-01", re: /^免疫(?:对手|对方|敌方)?(?:的)?能力下降类技能$|^免疫(?:对方|对手)?能力下降$|^免疫(?:对手|对方|敌方)的?弱化(?:类)?技能$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // ── 强化锁定裸句（"能力提升状态无法被消除或吸取"——默认主语自身） ──
  { id: "e33-lock-01", re: /^(?:自身|自己)?的?能力提升状态无法被消除(?:或|和)?(?:吸取|清除)?$|^(?:自身|自己)?的?强化状态无法被(?:消除|清除|吸取)$/, go: () => ({ effects: [{ op: "apply_status", name: "up_lock", target: "self" }] }) },
  // ── 体力阈值威力倍化（"体力低于1/2威力为2倍"→scaleIf selfHpBelow） ──
  { id: "p2-scale-02",
    re: /^(?:自身|自己)?(?:HP|hp|体力)(?:值)?(?:为|是|在)([0-9]+|一|二|两|三|四|五|六|七|八|九|十)s*\/s*([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:时|的时候|以内|以下)?(?:威力|造成(?:的)?伤害)(?:为|是|变成|提升|提高|增加)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)倍$/,
    go: (m) => ({ attachDamage: { scaleIf: { when: { selfHpBelow: { numerator: num(m[1]), denominator: num(m[2]) } }, numerator: num(m[3]), denominator: 1 } } }),
  },
  { id: "p2-scale-03",
    re: /^(?:若|如果|当)?(?:自身|自己)?当前(?:的)?(?:体力|HP|hp|血量)(?:低于|少于|小于)(?:对手|对方|敌方)(?:的)?(?:体力|HP|hp|血量)?(?:时|则|，|,)?(?:威力|造成(?:的)?伤害)(?:翻倍|加倍|为?2倍|提升至2倍)$/,
    go: () => ({ attachDamage: { scaleIf: { when: { selfHpBelowFoe: true }, numerator: 2, denominator: 1 } } }),
  },
  { id: "e33-scale-01", re: new RegExp(`^(?:自身|自己)?(?:体力|HP|hp)低于${NUM}\\s*/\\s*${NUM}(?:时|则)?威力(?:为|变成|提升|翻倍?至?)${NUM}倍$|^(?:自身|自己)?(?:体力|HP|hp)低于${NUM}%(?:时|则)?威力(?:为|变成)${NUM}倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const [a, b, k] = ns.length === 3 ? ns : [ns[0], 100, ns[1]]; return { attachDamage: { scaleIf: { when: { selfHpBelow: { numerator: a, denominator: b } }, numerator: k, denominator: 1 } } }; } },
  // ── 对手体力阈值增伤（"若对手的体力小于300则造成的伤害增加50%"→mulIf foeHpBelowAbs） ──
  { id: "e33-mul-01", re: new RegExp(`^若?(?:对手|对方|敌方)的?体力(?:值)?小?于?${NUM}(?:点)?(?:时|则|，|,)?(?:自身|自己)?(?:造成的|攻击)?伤害(?:增加|提升|提高)${NUM}%$|^若?(?:对手|对方|敌方)的?体力低于${NUM}(?:点)?(?:时|则|，|,)?伤害(?:增加|提升)${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mulIf: { when: { foeHpBelowAbs: ns[0] }, numerator: 100 + ns[1], denominator: 100 } } }; } },
  // ── 随机技能 PP 归零（pp_delta zeroRandom 既有；"45%对手随机一技能0PP"/"使对手随机N个技能PP归零"） ──
  { id: "p2-pp-12",
    re: /^(?:随机)?(?:清空|清除|消除)(?:对手|对方|敌方)(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))[个项只]?技能(?:的)?(?:PP|pp)(?:值)?$/,
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }),
  },
  { id: "e33-pp-01", re: new RegExp(`^(?:${NUM}%)?(?:使|令|让)?(?:对手|对方|敌方)随机(\\d+|一|二|两|三|四|五|六|七|八|九|十)[个项只]?技能(?:(?:的)?PP(?:值)?(?:归零|归0|变为0|变0)|(?:的)?0PP)$|^随机(?:使|令)(?:对手|对方|敌方)(\\d+|一|二|两|三|四|五|六|七|八|九|十)[个项只]?技能PP(?:值)?归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const hasPct = m[0].match(/^(\d+)%/); const cnt = ns[ns.length - 1]; return { effects: [{ op: "pp_delta", zeroRandom: cnt, target: "opponent", ...(hasPct !== null && ns.length > 1 ? { chance: num(hasPct[1]) } : {}) }] }; } },
  { id: "e33-pp-02", re: new RegExp(`^每回合(?:使|令)(?:对手|对方|敌方)随机(\\d+|一|二|两|三|四|五|六|七|八|九|十)[个项只]?技能PP(?:值)?归零$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "pp_zero_tick", target: "self", payload: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] })] }) },
  // ── 异常枚举下免疫（"自身在烧伤、冻伤、中毒状态下免疫所有攻击"——ailCont 合段后命中） ──
  { id: "e33-ail-01", re: new RegExp(`^自身在${AIL_LIST}状态下免疫(?:所有|全部)?(?:攻击|攻击伤害|伤害)$|^在${AIL_LIST}状态下免疫(?:所有|全部)攻击$`), go: (m) => { const w = ailOr(m); return w === undefined ? null : { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", if: w }] }; } },
  { id: "e33-ail-02", re: new RegExp(`^自身在${AIL_LIST}状态下免疫(?:并解除)?(?:所有|全部)?异常(?:状态)?$`), go: (m) => { const w = ailOr(m); return w === undefined ? null : { effects: [{ op: "apply_status", name: "immune_status", target: "self", if: w }] }; } },
  { id: "e33-ail-03", re: new RegExp(`^自身在${AIL_LIST}状态下受到的(?:攻击)?伤害减少${NUM}%$|^自身在${AIL_LIST}状态下受到的伤害减半$`), go: (m) => { const w = ailOr(m); const v = /减半$/.test(m[0]) ? 50 : num(m[m.length - 1]); return w === undefined ? null : { effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: v }, if: w }] }; } },
  // ── 体力置为百分比（"令自身体力等于最大体力的50%"→heal setPct） ──
  { id: "e33-set-01", re: new RegExp(`^(?:使|令|让)(?:自身|自己)(?:的)?体力(?:值)?(?:等于|变为|变成|恢复至|回到)(?:自身|自己)?最大体力(?:的)?${NUM}%$|^(?:自身|自己)(?:的)?体力(?:值)?变为最大体力(?:的)?${NUM}%$`), go: (m) => ({ effects: [{ op: "heal", setPct: num(m[1] ?? m[2]), target: "self" }] }) },
  // ── MISS 闪避窗（"使对手攻击必定MISS"→持有者闪避——must_miss self；引擎按防守方判定） ──
  { id: "e33-miss-01", re: /^(?:使|令|让)(?:对手|对方|敌方)(?:的)?(?:攻击|技能|攻击技能)(?:必定|一定)(?:MISS|miss|未命中|落空)$|^(?:对手|对方|敌方)(?:的)?攻击(?:技能)?必定(?:MISS|miss|未命中)$/, go: () => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", turns: 1 }] }) },
  // ── 威力最高技能 PP 归零（"令对手威力最高的技能PP归零"→pp_delta zeroMaxPower——引擎按 pack 威力取槽，平局取列表序首） ──
  { id: "e33-pp-03", re: /^(?:使|令|让)(?:对手|对方|敌方)(?:的)?威力最高(?:的)?(?:一?个)?技能(?:的)?PP(?:值)?(?:归零|归0|变为0|变0)$/, go: () => ({ effects: [{ op: "pp_delta", zeroMaxPower: true, target: "opponent" }] }) },
  // ── 治疗反应窗（trigger 14——heal wrapper 扫描本 op 新增 heal 事件向对侧持有者派发；"若对手恢复体力则X"） ──
  { id: "e33-react-04", re: /^若(?:对手|对方|敌方)(?:的)?(?:精灵)?(?:恢复|回复|治疗)(?:了)?(?:体力|HP|hp)(?:时|则|后|，|,)?(.+)$/, go: (m) => reactWrap(14, {}, m[1].replace(/^(?:使|令|让)?(?:自身|自己)?恢复等量/, "自身恢复等量")) },
  // payload 子句："自身恢复等量体力的N%"/"恢复等量体力"（镜像对手该次回复量）
  { id: "e33-react-05", re: new RegExp(`^(?:使|令|让)?(?:自身|自己)?恢复(?:对手|对方|敌方)?等量(?:的)?体力(?:的)?${NUM}%$|^(?:自身|自己)?恢复等量(?:的)?体力$|^恢复(?:与|和)(?:对手|对方|敌方)等量(?:的)?体力$`), go: (m) => ({ effects: [{ op: "heal", foeLastHealPct: num(m[1] ?? 100), target: "self" }] }) },
  // ── 异常回合增伤（"自身每有1回合异常状态则造成伤害提升10%，最高70%"——dmgPctPerSelfAilTurn；cap 由 capTail 派发） ──
  { id: "e33-aildmg-01", re: new RegExp(`^(?:自身|自己)每有?(?:一|1)回合异常状态(?:则|时)?造成(?:的)?伤害(?:提升|增加|提高)${NUM}%$|^自身每有?1回合异常(?:则|时)?伤害提升${NUM}%$|^(?:自身|自己)每有?(?:一|1)回合异常状态(?:则|时)?伤害(?:提升|增加|提高)${NUM}%$`), go: (m) => ({ attachDamage: { dmgPctPerSelfAilTurn: { pct: num(m[1] ?? m[2] ?? m[3]) } } }) },
  // ── 命中降下只最大体力（"每次命中后降低对手下只出战精灵最大体力10%，最多降低40%"——foeNextMaxHpAcc 累积入 nextInFx） ──
  { id: "e33-nxhp-01", re: new RegExp(`^每次命中(?:后)?(?:使|令|让|降低)?(?:对手|对方|敌方)(?:的)?下(?:一|1)?只(?:出战|上场|出场)精灵(?:的)?最大体力(?:降低|减少|下降)${NUM}%$|^每次命中(?:后)?降低(?:对手|对方|敌方)(?:的)?下(?:一|1)?只(?:出战|上场|出场)精灵(?:的)?最大体力${NUM}%$`), go: (m) => ({ attachDamage: { foeNextMaxHpAcc: { pct: num(m[1] ?? m[2]) } } }) },
  // ── 本系加成（"获得本系属性加成"→forceStab；"克制对手时获得本系属性加成"→forceStabIf weCounterFoe） ──
  { id: "e33-stab-01", re: /^获得本系(?:属性)?加成$|^(?:自身|自己)(?:技能)?获得本系(?:属性)?加成$/, go: () => ({ attachDamage: { forceStab: true } }) },
  { id: "e33-stab-02", re: /^(?:若|当)?(?:克制|克制对手|遇到天敌)(?:时|则)?获得本系(?:属性)?加成$|^克制(?:对手|对方)(?:时|则)?(?:技能)?获得本系(?:属性)?加成$/, go: () => ({ attachDamage: { forceStabIf: { when: { weCounterFoe: true } } } }) },
  // ── 必定先手+必定暴击 复合（"使下只出场精灵前2回合必定先手必定暴击"——时长由 TURNS_PRE 前缀注入） ──
  { id: "e33-prio-01", re: /^必定先手必定暴击$|^必定先手(?:并|且|同时)必定暴击$/, go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 9 } }, { op: "apply_status", name: "crit_always", target: "self" }] }) },
  // ── 伤害护盾别名（"获得500点伤害护盾"=shield flat——护盾定语"伤害"是风味词） ──
  { id: "e33-shield-01", re: new RegExp(`^获得${NUM}点(?:伤害|攻击)?护盾$|^(?:使|令|让)(?:自身|自己)?获得${NUM}点(?:伤害)?护盾$`), go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // ── "X和Y能力提升N个等级"（枚举列表+"能力提升N个等级"尾——与 +/-N 等价；"防御和特攻能力提升1个等级"） ──
  // ── 裸 "暴击" 尾（"先出手下回合暴击"——时长由前缀注入；crit_always 致命窗） ──
  { id: "e33-crit-03", re: /^暴击$|^致命(?:一)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: 1 }] }) },
  // ── 多属性总和 N% 固定伤害（"附加自身防御、特防和速度总和20%的固定伤害"——flatSelfStatPct stats[] 枚举） ──
  { id: "p2-fstat-02",
    re: /^附加(?:自身|自己)?(物攻|物防|攻击|防御|特攻|特功|特防|速度|命中)(?:值)?(?:与|和|、)(物攻|物防|攻击|防御|特攻|特功|特防|速度|命中)(?:值)?(?:之)?和([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%的(?:固定伤害|固伤)$/,
    go: (m) => { const a = STATS[m[1]], b = STATS[m[2]]; if (a === undefined || b === undefined) return null; return { attachDamage: { flatSelfDefSumPct: num(m[3]) } }; },
  },
  { id: "e33-fstat-01", re: new RegExp(`^附加(?:自身|自己)?(${STAT_RE})((?:、|和|及|与)(?:${STAT_RE}))+总和${NUM}%的(?:固定伤害|固伤)$`), go: (m) => { const seg = m[0].replace(/^附加(?:自身|自己)?/, "").replace(new RegExp(`总和${NUM}%的(?:固定伤害|固伤)$`), ""); const stats = (seg.match(new RegExp(STAT_RE, "g")) ?? []).map((n) => STATS[n]).filter(Boolean); const nv = num((m[0].match(new RegExp(`(${NUM})%`)) ?? [])[1]); if (stats.length === 0 || Number.isNaN(nv)) return null; return { attachDamage: { flatSelfStatPct: { stats, pct: nv } } }; } },
  // ── 多属性总和 N% 百分比伤害（"附加自身防御、特防和速度总和30%的百分比伤害"——percentSelfStatPct；枚举经 enumHead 合段到达） ──
  { id: "e33-pstat-01", re: new RegExp(`^附加(?:自身|自己)(${STAT_RE})((?:、|和|及|与)(?:${STAT_RE}))+总和${NUM}%的百分比伤害$|^附加自身(${STAT_RE})总和${NUM}%的百分比伤害$`), go: (m) => { const seg = m[0].replace(new RegExp(`^附加(?:自身|自己)?`), "").replace(new RegExp(`总和${NUM}%的百分比伤害$`), ""); const stats = (seg.match(new RegExp(STAT_RE, "g")) ?? []).map((n) => STATS[n]).filter(Boolean); const v = num(m[3] ?? m[5]); if (stats.length === 0 || Number.isNaN(v)) return null; return { effects: [{ op: "damage", kind: "percent", percentSelfStatPct: { stats, pct: v }, target: "opponent" }] }; } },
  // ── 固定HP损失（"损失200点固定HP"=fixed 伤害对手侧——react payload/独立子句共用） ──
  { id: "e33-loss-01", re: new RegExp(`^(?:损失|扣除|失去)${NUM}点?(?:固定)?(?:HP|体力|血量|生命)$|^(?:使|令|让)(?:对手|对方|敌方)?(?:损失|扣除|失去)${NUM}点?(?:固定)?(?:HP|体力|血量|生命)$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // ── "自身额外先制+N"（react payload 语境——"额外"是修饰词非独立效果） ──
  { id: "e33-prio-02", re: new RegExp(`^(?:自身|自己)?额外先制([+-]?(?:${NUM}))$|^(?:自身|自己)?先制([+-]\\d+)$`), go: (m) => { const v = num((m[1] ?? m[2] ?? "").replace(/^\+/, "")); return Number.isNaN(v) ? null : { effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: v } }] }; } },
  // ── "若对手当回合使用的技能为攻击/属性技能则X" → trigger 3 声明反应（cat 门控） ──
  { id: "e33-react-06", re: /^若(?:对手|对方|敌方)(?:当|本)回合使用的?技能为(攻击|属性)技能(?:时|则|，|,)?(.+)$/, go: (m) => reactWrap(3, { cat: m[1] === "属性" ? 1 : 4 }, m[2]) },
  { id: "e33-stage-01", re: new RegExp(`^(${STAT_RE})((?:和|及|与)(?:${STAT_RE}))*能力?(?:提升|提高|上升)(${NUM})个?等级$|^(${STAT_RE})((?:和|及|与)(?:${STAT_RE}))*等级(?:提升|提高)(${NUM})$`), go: (m) => { const d = num(m[3] ?? m[6]); const enumPart = m[0].replace(new RegExp(`能力?(?:提升|提高|上升)${NUM}个?等级$|等级(?:提升|提高)${NUM}$`), ""); const stats = (enumPart.match(new RegExp(STAT_RE, "g")) ?? []).map((n) => STATS[n]).filter(Boolean); if (stats.length === 0 || Number.isNaN(d)) return null; return { effects: stats.map((s) => ({ op: "apply_stat_stage", stat: s, delta: d, target: "self" })) }; } },
];
