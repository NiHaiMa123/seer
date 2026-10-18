// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, ALL_STATS, AILMENTS, AIL_RE, frac, stageFx, TYPE_RE } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { condOf, reactWrap } from "../effects-parse.mjs";

export const rules = [

  // ── timed 窗口 ──────────────────────────────────────────────
  { id: "timed-01", re: new RegExp(`^下${NUM}回合(?:令)?自身(?:所有)?技能先制\\+${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: num(m[1]), params: { add: num(m[2]) } }] }) },
  { id: "timed-02", re: new RegExp(`^${NUM}回合内?[，,]?(?:每回合)?(?:恢复|回复)(自身)?最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", turns: num(m[1]), params: { n: num(m[2]), d: num(m[3]) } }] }) },
  { id: "timed-03", re: new RegExp(`^${NUM}回合内?[，,]?每回合(?:恢复|回复)${NUM}\\s*/\\s*${NUM}(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", turns: num(m[1]), params: { n: num(m[2]), d: num(m[3]) } }] }) },
  // "每回合回1/3HP"/"每回合1/3HP"（"回"省字/无动词形）。放在 timed-04 前面，那条动词只收「恢复/回复」。
  { id: "timed-04a", re: new RegExp(`^每回合(?:回)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:HP|hp|体力)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "每回合(回合结束时)恢复自身全部体力"（timed-04 的「全部体力」支要求后面跟 N/M 分数）。放在 timed-04 前面。
  { id: "p1-timed-03", re: /^每回合(?:回合)?(?:结束)?时?(?:恢复|回复)(?:自身|自己)?(?:全部|所有)体力(?:值)?$/, go: () => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 1 } }] }) },
  { id: "timed-04", re: new RegExp(`^每回合(?:恢复|回复)${NUM}\\s*/\\s*${NUM}(?:HP|体力|最大体力)$|^每回合(?:使用技能)?(?:恢复|回复)(?:自身|自己)?(\\d+)点(?:体力|HP)$|^每回合(?:恢复|回复)(?:自身|自己)?(?:最大HP|最大体力|全部体力)的?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); if (ns.length === 1) return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { flat: ns[0] } }] }; return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // 区间恢复（"每回合随机恢复200-300点体力"→ hot flatMin/flatMax，tick 时掷区间）
  { id: "timed-05", re: new RegExp(`^每回合(?:随机)?(?:恢复|回复)${NUM}\\s*-\\s*${NUM}点?(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { flatMin: num(m[1]), flatMax: num(m[2]) } }] }) },
  { id: "timed-06", re: new RegExp(`^每回合(?:使)?(?:对手|对方|敌方)(?:随机)?(?:受到|损失|扣除)${NUM}\\s*-\\s*${NUM}点?(?:体力|HP|伤害)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flatMin: num(m[1]), flatMax: num(m[2]) } }] }) },
  { id: "timed-07", re: new RegExp(`^${NUM}回合内?免疫并反弹(所有|全部)?(受到的)?异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }, { op: "apply_status", name: "reflect_status", target: "self", turns: num(m[1]) }] }) },
  { id: "timed-08", re: new RegExp(`^${NUM}回合内?免疫(所有|全部)?(受到的)?异常状态$|^${NUM}回合内?(?:自身)?不会出现异常状态$|^${NUM}回合免疫异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }] }) },
  { id: "timed-09", re: new RegExp(`^${NUM}回合(?:内)?免疫能力下降(?:状态)?$|^${NUM}回合自身不受能力下降技能影响$|^免疫能力下降${NUM}回合$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self", turns: num(m[1]) }] }) },
  // 削减当前体力分数（"减少对手当前体力1/3"→percent current 基线）
  { id: "timed-10", re: new RegExp(`^(?:减少|扣除)(?:对手|对方|敌方)(?:的)?当前体力(?:值)?的?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", power: 1, kind: "percent", percentBase: "current", frac: frac(m[1], m[2]) }] }) },
  // d1-miss-heal（d1）：裸形"miss回复1/3体力"（前段"3回合内…"被顿号或分号切开，触发词只剩"miss"）——
  // 与 heal-136 同族（trigger 2）。heal-136 要求"则/时/若"或"对手…MISS"整词，裸"miss回复…"接不到。
  { id: "d1-miss-heal", re: /^(?:对手|对方|敌方)?(?:攻击)?(?:MISS|miss|Miss)(?:则|后|时)?(?:回复|恢复)(.+)$/,
    go: (m) => reactWrap(2, {}, `自身回复${m[1]}`) },
  // 对手攻击 MISS 窗口（"对手2回合内攻击技能MISS"→must_miss timed）
  { id: "timed-11", re: new RegExp(`^(?:对手|对方|敌方)${NUM}回合内?(?:所有)?(?:攻击技能|攻击)(?:必定)?(?:MISS|Miss|miss|未命中)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", turns: num(m[1]) }] }) },
  // 必定闪避窗口（"对手所有攻击必定MISS"→must_miss；"物理攻击对自身必定miss"→must_miss_phys）
  { id: "timed-12", re: new RegExp(`^${NUM}回合内?(?:对手|对方|敌方)?(?:所有)?攻击必定(?:MISS|Miss|miss|未命中)$|^(?:对手|对方|敌方)所有攻击必定(?:MISS|Miss|miss|未命中)$|^(?:令|使|让)?(?:对手|对方|敌方)(?:的)?攻击必定(?:MISS|Miss|miss|未命中)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }) },
  { id: "timed-13", re: /^物理攻击对自身必定(?:MISS|Miss|miss|未命中)$|^特殊攻击对自身必定(?:MISS|Miss|miss|未命中)$|^对手物理攻击必定(?:MISS|miss)$|^对手特殊攻击必定(?:MISS|miss)$/, go: (m) => ({ effects: [{ op: "apply_status", name: /物理/.test(m[0]) ? "must_miss_phys" : "must_miss_spec", target: "self" }] }) },
  // 必定命中修饰（"直接攻击必定直接命中"/"必定命中"→accuracy:always）
  { id: "timed-14", re: /^(?:直接)?攻击必定(?:直接)?命中$|^必定(?:直接)?命中$|^攻击必定命中$/, go: () => ({ flags: { accuracy: "always" } }) },
  // 必定回满（"必定恢复全部体力"）
  { id: "timed-15", re: /^必定恢复(?:全部|所有|满)体力$|^必定恢复全部体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // 裸免疫（"不出现异常状态"→immune_status）
  { id: "timed-16", re: /^不(?:会)?出现(?:任何)?异常状态$|^不会进入异常状态$|^免疫异常状态$|^免疫所有异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // 双方全量回血（"恢复双方所有体力"）
  { id: "timed-17", re: /^恢复(?:双方|敌我双方)(?:所有|全部)体力$|^恢复(?:双方|敌我双方)全部体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "heal", numerator: 1, denominator: 1, target: "opponent" }] }) },
  // 惩罚族碎片（"惩罚"、"此技能威力越大"——系数未公示，UNVERIFIED 显式留档）
  { id: "timed-18", re: /^惩罚$|^此技能威力越大$|^威力越大$|^伤害越高$/, go: () => ({ unparsedReason: "UNVERIFIED: 惩罚族威力系数未公示" }) },
  // 变量 n（"减少n点"、"n等于本回合自身造成的伤害"——运行时量无通用公式）
  { id: "timed-19", re: /[nN]点|等于本回合|等于自身|等于对手/, go: () => ({ unparsedReason: "UNVERIFIED: 变量n引用运行时量，无通用公式" }) },
  // 组队目标（"组队可影响N个目标"——非单体对战语义）
  // 组队目标数——move 级元数据字段（targets；1v1 引擎无语义，数据忠实落字段）
  { id: "timed-20", re: new RegExp(`^组队可影响${NUM}个目标$|^可影响${NUM}个目标$|^影响${NUM}个目标$|^组队[是可]?以?影响${NUM}个目标$`), go: (m) => { const c = m.slice(1).find((x) => x !== undefined); return { flags: { targets: num(c) } }; } },
  { id: "timed-20b", re: /^组队时(?!.*(?:任意|影响|作用|目标|队员|精灵))|^可影响(?:两|几)个目标$/, go: () => ({ unparsedReason: "non-battle: 组队多目标" }) },
  // 属性反转/形态复制（"自身与对方反转战斗时属性"——形态系统未建）
  { id: "timed-21", re: /复制对手(?:的)?(?:形态|特性|种族|形象|样子|技能|招式|[^，,、；;]{0,6}技)/, go: () => ({ unparsedReason: "UNVERIFIED: 形态/属性复制机制" }) },
  // 真实伤害（≈固伤，"附加N点真实伤害"）
  { id: "timed-22", re: new RegExp(`^附加(${NUM})点真实伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // 伤害倍数（"造成的伤害为N倍"）
  { id: "timed-23", re: new RegExp(`^造成的伤害为(${NUM})倍$|^伤害为(${NUM})倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mul: { numerator: ns[0], denominator: 1 } } }; } },
  // 条件倍伤（"低于N/M时伤害为K倍"）
  { id: "timed-24", re: new RegExp(`^(?:体力|HP|血量)?低于(${NUM})\\s*/\\s*(${NUM})时(?:伤害|威力)为(${NUM})倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { mulIf: { when: { selfHpBelow: { numerator: ns[0], denominator: ns[1] } }, numerator: ns[2], denominator: 1 } } }; } },
  // 伤害反馈倍数（"将所受的伤害N倍反馈给对手"）
  { id: "timed-25", re: new RegExp(`^将所?受?到?的?伤害(${NUM})倍反馈给对手$|^将所?受?到?的?伤害(${NUM})倍反弹$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: ns[0] } }] }; } },
  // 伤害下限（"造成的伤害不低于N"）
  { id: "timed-26", re: new RegExp(`^造成的伤害不低于(${NUM})(?:点)?$|^伤害不低于(${NUM})(?:点)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { minDamage: ns[0] } }; } },
  // 固伤翻倍条件（"若当回合造成的伤害高于N则固伤效果翻倍"）
  { id: "timed-27", re: new RegExp(`^若当回合造成的伤害高于(${NUM})则(?:固定伤害|固伤)效果翻倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatMulIf: { when: { prevDamageAboveAbs: ns[0] }, numerator: 2, denominator: 1 } } }; } },
  // N% 无动词全属性（"30%自身全属性+1"）
  { id: "timed-28", re: new RegExp(`^(${NUM})%(?:概率|几率)?(?:令)?(?:自身|自己)全属性([+\\-＋－])(\\d+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const d = (ns[1] === "+" || ns[1] === "＋" ? 1 : -1) * num(ns[2]); return { effects: ALL_STATS.map((s) => stageFx(s, d, "self", num(ns[0]))) }; } },
  // 每回合双防强化（"每回合防御和特防等级+1"→stage_tick 双维）
  { id: "timed-29", re: new RegExp(`^每回合(?:自身|自己)?(?:的)?防御和特防等级?([+\\-＋－])(\\d+)$|^每回合(?:自身|自己)双防([+\\-＋－])(\\d+)$`), go: (m) => { const d = (m[1] === "+" || m[1] === "＋" || m[3] === "+" || m[3] === "＋" ? 1 : -1) * num(m[2] ?? m[4]); return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: 8, delta: d } })] }; } },
  // 自身限时免疫（"自身3回合内免疫异常状态"）
  { id: "timed-30", re: new RegExp(`^(?:自身|自己)?(${NUM})回合内免疫(?:所有)?异常状态$|^免疫异常状态(${NUM})回合$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1] ?? m[2]) }] }) },
  // 消强别名（"令对方能力增强效果消失"→clear_stages up）
  { id: "timed-31", re: /^(?:令|使|让)(?:对手|对方|敌方)能力(?:增强|提升|强化)效果消失$|^消除(?:对手|对方)能力增强效果$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // 强化翻倍（"将所处的强化状态翻倍"→multiplySelf）
  { id: "timed-32", re: /^将?所?处?的?(?:能力)?(?:强化|提升)状态翻倍$|^将自身(?:的)?强化(?:状态)?翻倍$/, go: () => ({ effects: [{ op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self" }] }) },
  // 对手随机 PP 归零（"对手随机2项PP归零"）
  { id: "timed-33", re: new RegExp(`^(?:对手|对方|敌方)随机(${NUM})项PP(?:值)?归零$|^使?(?:对手|对方)随机(${NUM})项技能PP归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // 全 PP 削减（"将对手所有PP减少N点"）
  { id: "timed-34", re: new RegExp(`^将?(?:对手|对方|敌方)(?:的)?所有PP(?:值)?减少(${NUM})点$|^(?:对手|对方)所有技能PP减少(${NUM})点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined && !/^(?:对手|对方|敌方)$/.test(x)).map(num); return { effects: [{ op: "pp_delta", amount: -ns[ns.length - 1], target: "opponent", scope: "all" }] }; } },
  // 防御值等额伤害（"直接造成等同于对手防御值的伤害"）
  { id: "timed-35", re: /^(?:直接)?造成等同于(?:对手|对方|敌方)(?:的)?(?:防御|防御值|防御能力值)的?伤害$/, go: () => ({ attachDamage: { flatFoeDefPct: 100 } }) },
  // 要害率分数（"攻击击中对象要害概率增加1/4"）
  { id: "timed-36", re: new RegExp(`^(?:攻击)?击中(?:对象|对手)?要害(?:的)?概率(?:增加|提升|提高|上升)${NUM}\\s*/\\s*${NUM}$|^要害(?:一击)?概率增加${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return ns[1] !== undefined ? { attachDamage: { critChanceFrac: { numerator: ns[0], denominator: ns[1] } } } : { attachDamage: { critChance: ns[0] } }; } },
  // 已损失体力百分固伤（"附加已损失体力值30%的固定伤害"）
  // "附加自身已损失体力的70%的固定伤害"/"附加自身已损失体力的固定伤害"（timed-37 的签名无「的」分隔、且百分比必填）。放在 timed-37 前面。
  { id: "p1-timed-01", re: new RegExp(`^附加(?:自身|自己)已损失体力的(?:${NUM}%的?)?(?:固定|固伤|固定伤害)$`), go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: m[1] !== undefined ? num(m[1]) : 100, denominator: 100, base: "missing" } } }) },
  { id: "timed-37", re: new RegExp(`^附加(?:自身|自己)?已损失体力(?:值)?${NUM}%的?(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: num(m[1]), denominator: 100, base: "missing" } } }) },
  // 有 N% 几率闪避（"有30%的几率闪避对手攻击"/"每回合有70%闪避对手攻击技能"）
  { id: "timed-38", re: new RegExp(`^有(${NUM})%的?(?:概率|几率)?(?:的?概率)?(?:闪避|躲避)(?:对手|对方|敌方)?(?:的)?攻击(?:技能)?$|^(${NUM})%的?(?:概率|几率)?闪避(?:对手|对方|敌方)?(?:的)?攻击(?:技能)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // 忽略双防值（"自身攻击忽略对手30%的双防值"→ignore_def 本击生效 count:1）
  { id: "timed-39", re: new RegExp(`^(?:自身|自己)?攻击忽略(?:对手|对方|敌方)(${NUM})%的?双防值$|^攻击无视对手(${NUM})%的?双防$|^无视对手(${NUM})%的?防御$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: ns[0], count: 1 } }] }; } },
  // 伤害回血裸句（"造成的伤害恢复自身体力"→drain 1/1）
  { id: "timed-40", re: /^造成的伤害恢复自身体力$|^造成的伤害恢复自身$|^伤害恢复自身体力$/, go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // 用技能回血（"若使用技能则恢复N点体力值"）
  { id: "timed-41", re: new RegExp(`^若使用技能则恢复(${NUM})点体力值?$|^使用技能恢复(${NUM})点体力$`), go: (m) => (m[1] !== undefined
    ? { effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }
    // 「N回合内使用技能恢复X点体力」是回合窗，不是本招一次性回复——与「每回合使用技能恢复…」同走 hot，turns 由前缀注入
    : { effects: [{ op: "apply_status", name: "hot", target: "self", params: { flat: num(m[3]) } }] }) },
  // 属性招后锁攻击（"使用属性技能的下N回合无法使用攻击技能"——主语=使用方；技能效果语境默指对手，封其攻击窗）
  { id: "timed-42", re: new RegExp(`^使用属性技能的下${NUM}回合无法使用攻击技能$|^使用属性技能后${NUM}回合无法使用攻击技能$`), go: (m) => { const n = m[0].match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)/); return { effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(n[0]), params: { cat: 4 } }] }; } },
  // 多 stat 共享值列表（"攻击、速度、双防+1"）
  { id: "timed-43", re: new RegExp(`^(${STAT_RE})(?:、(${STAT_RE}))*(?:、双防)?([+\\-＋－])(\\d+)$`), go: (m) => { const names = m[0].replace(/[+\\-＋－]\\d+$/, "").split("、"); const delta = (m[m.length - 2] === "+" || m[m.length - 2] === "＋" ? 1 : -1) * num(m[m.length - 1]); const stats = names.flatMap((n) => n === "双防" || n === "防御和特防" ? ["def", "sdf"] : [STATS[n]]).filter(Boolean); return stats.length > 0 ? { effects: stats.map((st) => ({ op: "apply_stat_stage", target: "self", stat: st, delta })) } : null; } },
  // 尾巴"最高提升N%"（威力增幅封顶）
  { id: "timed-44", re: /^最高提升(\d+)%$|^最高提高(\d+)%$|^最多提升(\d+)%$/, go: (m) => ({ attachAll: { capTail: { value: num(m[1] ?? m[2] ?? m[3]), unit: "%", src: m[0] } } }) },
  // 概率强化翻倍（"30%概率强化效果翻倍"→deltaMulChance）
  { id: "timed-45", re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?强化效果翻倍$|^(${NUM})%概率提升强化效果$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { stageChanceMul: ns[0] } }; } },
  // "50%弱化翻倍"（timed-46 的签名要求「弱化效果翻倍」）。放在 timed-46 前面。
  { id: "p1-timed-02", re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?弱化翻倍$`), go: (m) => ({ attachAll: { stageChanceMulDown: num(m[1]) } }) },
  { id: "timed-46", re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?弱化效果翻倍$|^(${NUM})%概率弱化效果翻倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { stageChanceMulDown: ns[0] } }; } },
  // 下只出场精灵吸取（"吸取对手下只出场精灵最大体力的1/3"）
  { id: "timed-47", re: new RegExp(`^吸取(?:对手|对方|敌方)下只出场精灵最大体力的${NUM}\\s*/\\s*${NUM}$|^吸取对手下只出场精灵${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const fr = ns.length > 1 ? { numerator: ns[0], denominator: ns[1] } : { numerator: ns[0], denominator: 100 }; return { effects: [{ op: "damage", power: 1, kind: "percent", frac: fr, target: "nextFoe" }, { op: "heal", ...fr, target: "self" }] }; } },
  // 几率倍伤（"30%的几率造成的伤害翻倍"→mulChance）
  { id: "timed-48", re: new RegExp(`^${NUM}%的几率造成的伤害翻倍$|^${NUM}%的?几率伤害翻倍$|^${NUM}%概率伤害翻倍$`), go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1] ?? m[2] ?? m[3]), numerator: 2, denominator: 1 } } }) },
  // 被击败触发（"若被对手击败则对手疲惫3回合"——trigger 5 作用于击杀方）
  // 对手限时异常（payload 变体："对手疲惫3回合"）
  { id: "timed-49", re: new RegExp(`^(?:令|使|让)?(?:对手|对方|敌方)(${AIL_RE})(\\d+)回合$|^(?:对手|对方)进入(${AIL_RE})(\\d+)回合$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const ail = ns.map((x) => AILMENTS[x]).find(Boolean); const t = num(ns.find((x) => /^\d+$/.test(x)) ?? "3"); return { effects: [{ op: "apply_status", name: ail ?? "fatigue", target: "opponent", turns: t }] }; } },
  // 承伤定额减免裸句（"受到攻击伤害降低100点"→dmg_reduce）
  { id: "timed-50", re: new RegExp(`^受到攻击伤害降低(${NUM})点$|^受到(?:的)?攻击伤害降低(${NUM})点$|^受到的攻击伤害减少(${NUM})点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: ns[0] } }] }; } },
  // 对手全 PP 扣减（"令对手随机2个技能的PP值归零" 已在位；此处补"的"变体）
  { id: "timed-51", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)随机(${NUM})个技能的PP值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // 每异常附加固伤（"对手每处于1种异常状态则附加60点固定伤害"）
  { id: "timed-52", re: new RegExp(`^(?:对手|对方|敌方)每处于(?:1|一)种异常状态则附加(${NUM})点(?:固定)?伤害$|^(?:对手|对方|敌方)?每有一种异常状态(?:，|,)?附加(${NUM})点`), go: (m) => { const v = num(m[1] ?? m[3]); return { attachDamage: { flatPerAilment: v } }; } },
  // 反转对手强化（"使对手的能力提升效果反转成能力下降效果"→invert_stages foe up）
  { id: "timed-53", re: /^(?:使|令)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:状态|效果)?反转(?:成|为)能力下降(?:效果|状态)?$|^反转对手能力提升状态$/, go: () => ({ effects: [{ op: "invert_stages", target: "opponent", sign: "up" }] }) },
  // 后手加倍（"后出手威力加倍"→scaleIf order:last）
  { id: "timed-54", re: /^后出手威力加倍$|^后出手(?:造成的)?伤害翻倍$|^后出手时伤害翻倍$/, go: () => ({ attachDamage: { scaleIf: { when: { order: "last" }, numerator: 2, denominator: 1 } } }) },
  // "造成的伤害提升N%-M%"（提升区间→mulRange 本击 roll）
  { id: "timed-55", re: new RegExp(`^(?:造成|自身造成|自身造成的)(?:的)?(?:攻击)?伤害提升${NUM}%[-~—至到]${NUM}%$|^伤害提升${NUM}%[-~—至到]${NUM}%$|^造成的伤害提升${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return ns.length > 1 ? { attachDamage: { mulRange: { min: ns[0], max: ns[1] } } } : { attachDamage: { mul: { numerator: 100 + ns[0], denominator: 100 } } }; } },
  // 承伤转体力（"受到的伤害转化为自身的体力"——"的"变体）
  { id: "timed-56", re: /^受到(?:的)?伤害转化为自身的?体力$|^受到(?:的)?伤害转化为自身的?HP$|^(?:将)?受到(?:的)?攻击伤害转化为自身体力$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  // 有N%几率免疫攻击（"有30%几率免疫对手的攻击伤害"→dodge pct）
  { id: "timed-57", re: new RegExp(`^有(${NUM})%(?:的)?(?:概率|几率)?免疫(?:对手|对方|敌方)?的?攻击(?:伤害)?$|^${NUM}%几率免疫对手攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // 每回合分数回复（"每回合回复1/3最大HP"→hot frac）
  { id: "timed-58", re: new RegExp(`^每回合(?:回复|恢复)${NUM}\\s*/\\s*${NUM}(?:的)?最大(?:HP|体力)$|^每回合回复最大(?:HP|体力)的${NUM}\\s*/\\s*${NUM}$|^每回合(?:恢复|回复)自身${NUM}\\s*/\\s*${NUM}最大(?:HP|体力)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // 双防总和固伤（"附加防御、特防总和30%的固定伤害"）
  { id: "timed-59", re: new RegExp(`^(?:(?:自身|自己)?攻击伤害)?附加(?:自身|自己)?(?:的)?(?:防御|防御、特防|防御和特防|双防值|防御值)(?:总和|之和)?(${NUM})%的?(?:固定|固伤|百分比)?伤害$`), go: (m) => ({ attachDamage: { flatSelfDefSumPct: num(m[1]) } }) },
  // 攻击值百分固伤（"附加自身攻击值30%的固定伤害"）
  { id: "timed-60", re: new RegExp(`^附加(?:自身|自己)攻击(?:值|力)的?(${NUM})%的?(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatSelfAtkPct: num(m[1]) } }) },
  { id: "timed-61", re: new RegExp(`^每回合附加(?:自身|自己)攻击(?:值|力)的?(${NUM})%的?(?:固定|固伤)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { atkPct: num(m[1]) } }] }) },
  // 条件威力提升（"若自身体力高于1/2则威力提升50%"→mulIf ×(100+N)/100）
  { id: "timed-62", re: new RegExp(`^若(.+?)则威力(?:提升|提高|增加)${NUM}%$|^若(.+?)时威力(?:提升|提高)${NUM}%$`), go: (m) => { const cond = condOf(m[1] ?? m[2]); const pct = num(m[3] ?? m[4]); return cond !== undefined ? { attachDamage: { mulIf: { when: cond, numerator: 100 + pct, denominator: 100 } } } : { unparsedReason: `mulIf cond unparsed: ${m[1] ?? m[2]}` }; } },
  // 限时承伤上限带点（"自身3回合内受到的伤害不超过100点"）
  { id: "timed-63", re: new RegExp(`^(?:自身|自己)?(${NUM})回合内(?:自身)?受到的伤害不超过(${NUM})点?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", turns: num(m[1]), params: { cap: num(m[2]) } }] }) },
  // 双倍反转（"双倍反转自身能力下降状态"→invert_stages + deltaMul）
  { id: "timed-64", re: /^双倍反转自身能力下降状态$|^反转自身能力下降状态$|^反转自身能力下降$|^使自身能力下降状态反转$/, go: () => ({ effects: [{ op: "invert_stages", target: "self" }] }) },
  // 解除自身弱化（"消除所有能力下降"→clear_stages self down）
  { id: "timed-65", re: /^消除(?:所有|全部)能力下降$|^解除自身所有能力下降$|^消除自身能力下降状态$|^解除能力下降状态$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // 体力值变体强化翻倍（"体力值低于1/2时强化效果翻倍"）
  { id: "timed-66", re: new RegExp(`^体力值低于${NUM}\\s*/\\s*${NUM}时强化效果翻倍$|^自身当前体力高于最大体力的${NUM}\\s*/\\s*${NUM}时强化效果翻倍$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { stageIf: /高于/.test(m[0]) ? { selfHpAbove: { numerator: ns[0], denominator: ns[1] } } : { selfHpBelow: { numerator: ns[0], denominator: ns[1] } } } }; } },
  // 命中后下只降上限（"每次命中对手会降低对手下只出战精灵最大体力的5%"）
  { id: "timed-67", re: new RegExp(`^每次命中(?:对手|对方|敌方)?会?降低(?:对手|对方|敌方)下只出战精灵最大体力的(${NUM})%$|^命中后降低对手下只精灵最大体力(${NUM})%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "nextFoe", params: { n: ns[0], d: 100 } }] }; } },
  // 致命N击窗口（"致命2击"→crit_always count）
  { id: "timed-68", re: new RegExp(`^致命(${NUM})击$|^下${NUM}击必定致命[一1]?击$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: ns[0] } }] }; } },
  // PP 值条件（"若对手所选择的技能PP值为N则…"）。
  // 谓词已建模：foeMovePpZero / foeMovePpAtLeast 读"本回合选择的那个技能"的剩余 PP。
  // 带「则…无法行动」的完整句由 batch-e41 的 e41-pp-01 处理，这里只兜底其余形态。
  { id: "timed-69", re: new RegExp(`^若(?:对手|对方|敌方)所?选?择?的?技能PP值为${NUM}(?!则(?:当回合)?(?:其|对手|对方|敌方)?无法行动)`), go: () => ({ unparsedReason: "PP 检视：仅建模了「为0则无法行动」与「>=N」，其余形态未覆盖" }) },
  // 裸碎片（"技能"、"会回复自己的HP"——切分残渣，无独立语义）
  { id: "timed-70", re: /^技能$|^技能无效时$|^会回复自己的HP$|^会回复自身体力$/, go: (m) => /回复/.test(m[0]) ? ({ unparsedReason: "orphan drain tail — fraction in prior clause" }) : ({ ignored: true }) },
  // 每回合固伤窗口（"每回合附加100点固伤"→dot flat）
  { id: "timed-71", re: new RegExp(`^每回合附加(${NUM})点(?:固定|固伤)?伤害$|^每回合(?:对|令|使)?(?:对手|对方|敌方)?附加(${NUM})点固伤$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: num(m[1] ?? m[3]) } }] }) },
  // 反弹碎片（"反弹给对手"——并切分残渣）
  { id: "timed-72", re: /^反弹给对手$|^反弹回对手$|^返还给对手$/, go: () => ({ unparsedReason: "orphan reflect tail — merged into prior clause" }) },
  // 后字裸恢复（"后恢复100点体力"——前缀残渣）
  { id: "timed-73", re: new RegExp(`^后(?:恢复|回复)(${NUM})点体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }) },
  // 最高几率尾巴（"最高几率50%"——概率增幅上限注脚）
  { id: "timed-74", re: /^最高(?:的)?(?:几率|概率)(\d+)%$|^几率最高(\d+)%$/, go: (m) => ({ attachAll: { capTail: { value: num(m[1] ?? m[2]), unit: "%", src: m[0] } } }) },
  // 火系等属性承伤减半（"本方受到的火系攻击伤害减半"→dmg_taken_down{pct:50,type}——params.type 系别门控）
  { id: "timed-75", re: new RegExp(`(?:本方|自身|自己)?受到(?:的)?(${TYPE_RE})(?:系)?(?:攻击)?伤害减半|(?:本方|自身|自己)?受到的(${TYPE_RE})(?:系)?伤害减半`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 }, moveType: m[1] ?? m[2] }] }) },
  // 裸免疫碎片（"不出现异常"）
  { id: "timed-76", re: /^不出现异常$|^不会出现异常$|^不会异常$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // 无点固伤变体（"附加60固定伤害"/"附加60伤害"）
  { id: "timed-77", re: new RegExp(`^附加(${NUM})(?:点)?(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // 无点回血变体（"恢复100体力"）
  { id: "timed-78", re: new RegExp(`^恢复(${NUM})(?:点)?体力$|^回复(${NUM})体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[3]), target: "self" }] }) },
  // 本次伤害下限条件（"若本次攻击造成的伤害小于N"→prevDamageBelowAbs）
  { id: "timed-79", re: new RegExp(`^若本次攻击造成的伤害小于(${NUM})$|^若造成的伤害小于(${NUM})(?:点)?$`), go: () => ({ unparsedReason: "orphan condition — then-clause split lost" }) },
  // 异常下倍伤（"自身在烧伤、冻伤、中毒状态下造成的伤害反而加倍"）
  { id: "timed-80", re: new RegExp(`^自身在((${AIL_RE})(?:、(${AIL_RE}))*)状态下造成的伤害(?:反而)?加倍$|^((${AIL_RE})(?:、(${AIL_RE}))*状态下)造成的伤害(?:反而)?加倍$`), go: (m) => { const names = m[0].match(new RegExp(AIL_RE, "g")) ?? []; const or = names.map((n) => ({ selfHas: AILMENTS[n] })).filter((c) => c.selfHas !== undefined); return or.length > 0 ? { attachDamage: { mulIf: { when: or.length === 1 ? or[0] : { or }, numerator: 2, denominator: 1 } } } : null; } },
  // 对手无弱化倍伤（"对手不处于能力下降状态则造成的伤害提高50%"）
  { id: "timed-81", re: new RegExp(`^(?:对手|对方|敌方)不处于能力下降状态则(?:造成的)?伤害(?:提高|提升)(${NUM})%$`), go: (m) => ({ attachDamage: { mulIf: { when: { not: { foeStageDown: true } }, numerator: 100 + num(m[1]), denominator: 100 } } }) },
  // 叠用固伤封顶（"最高附加80点固定伤害"）
  { id: "timed-82", re: new RegExp(`^最高附加(${NUM})点(?:固定|固伤)?伤害$|^最多附加(${NUM})点固定伤害$`), go: (m) => ({ attachDamage: { flatPerUseCap: num(m[1] ?? m[2]) } }) },
  // 先制免疫（"免疫对手的先手攻击技能"→prio_immune）
  { id: "timed-83", re: /^免疫(?:对手|对方|敌方)(?:的)?先手(?:攻击)?技能$|^免疫先手攻击$|^免疫对手先制攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "prio_immune", target: "self" }] }) },
  // 致命免疫（"免疫致命一击伤害"/"致命一击对自身miss"→crit_immune）
  { id: "timed-84", re: /^免疫致命[一1\\d]?击?伤害$|^免疫致命[一1]击$|^致命[一1\\d]?击?对自身[Mm][Ii][Ss][Ss]$|^致命一击对自身无效$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_immune", target: "self" }] }) },
  // 弱化转移：旧名 transfer_down_tick 的脱糖形状。win 19 是原 WIN.transferDown，不新开窗口。
  // plain 让 push 在没有负级时不发 action-failed，事件记在持有者侧。transfer_stages 没有 target 字段。
  { id: "timed-85", re: /^每回合自身的能力下降状态都会转移到对手身上$|^每回合(?:将)?自身能力下降状态转移给对手$|^自身的能力下降状态每回合转移给对手$/, go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 19 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }] }] }) },
  // 满血强化翻倍（"满体力时提升效果翻倍"→stageIf selfHpFull）
  { id: "timed-86", re: /^满体力时(?:强化|提升)效果翻倍$|^自身满体力时强化效果翻倍$/, go: () => ({ attachAll: { stageIf: { selfHpFull: true } } }) },
  // 双攻取高（"将自身攻击和特攻中最高的能力值作为自己的能力值进行攻击"→useBestOffense）
  { id: "timed-87", re: /^将自身攻击和特攻中最高的能力值作为自己的能力值进行攻击$|^以攻击和特攻中较高者进行攻击$/, go: () => ({ attachDamage: { useBestOffense: true } }) },
  // 对手减疗（"对手体力恢复效果减少50%"→heal_cut on foe）
  { id: "timed-88", re: new RegExp(`^(?:对手|对方|敌方)体力恢复效果减少(${NUM})%$|^令对手回复效果减少(${NUM})%$|^对手恢复效果降低(${NUM})%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: ns[0] } }] }; } },
  // 对手固伤上浮（"对手受到的固定伤害和百分比伤害提升50%"→flat_taken_pct 负值）
  { id: "timed-89", re: new RegExp(`^(?:对手|对方|敌方)受到的(?:固定伤害和百分比伤害|固定伤害|固伤)(?:提升|增加)(${NUM})%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "flat_taken_pct", target: "opponent", params: { pct: -num(m[1]) } }] }) },
  // 无动词降级（"20%几率对手防御等级-1"、"15%减少对方防御等级1"）
  { id: "timed-90", re: new RegExp(`^${NUM}%几率(对手|对方|敌方)(${STAT_RE})(?:等级)?([+\\-＋－])${NUM}$|^${NUM}%(?:的?(?:几|概)?率)?(?:减少|降低)(对手|对方|敌方|自身|自己)(${STAT_RE})(?:等级)?([+\\-＋－])?${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const pct = num(ns[0]); const who = ns.find((x) => /对手|对方|敌方/.test(x)) !== undefined ? "opponent" : "self"; const stat = STATS[ns.find((x) => STATS[x] !== undefined)]; const sign = ns.find((x) => /^[+\\-＋－]$/.test(x)); const v = num(ns[ns.length - 1]); return { effects: [stageFx(stat, (sign === "-" || sign === "－" || /减少|降低/.test(m[0]) && sign === undefined ? -1 : 1) * v, who, pct)] }; } },
  // 自身双枚等级（"改变自身防御等级1与命中等级1"——"与"连接各自带值）
  { id: "timed-91", re: new RegExp(`^(?:改变|令|使)(自身|自己)(${STAT_RE})(?:等级)?(\\d+)与(${STAT_RE})(?:等级)?(\\d+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); return { effects: [{ op: "apply_stat_stage", target: "self", stat: STATS[ns[1]], delta: num(ns[2]) }, { op: "apply_stat_stage", target: "self", stat: STATS[ns[3]], delta: num(ns[4]) }] }; } },
  // "和/、"混排枚举（"改变自身特攻、特防和防御等级1"——无符号默认+）
  { id: "timed-92", re: new RegExp(`^(${NUM})%?(?:的?(?:几|概)?率)?(?:改变|令|使)(自身|自己|对手|对方|敌方)((${STAT_RE})(?:[、和与](?:${STAT_RE}))+)(?:等级)?([+\\-＋－])?(\\d+)$`), go: (m) => { const names = m[3].split(/[、和与]/); const d = (m[5] === "-" || m[5] === "－" ? -1 : 1) * num(m[6]); const who = /对手|对方|敌方/.test(m[2]) ? "opponent" : "self"; const pct = m[1] !== undefined ? num(m[1]) : undefined; return { effects: names.map((n) => ({ op: "apply_stat_stage", target: who, stat: STATS[n], delta: d, ...(pct !== undefined ? { chance: pct } : {}) })).filter((e) => e.stat !== undefined) }; } },
  // 孤儿先制条件（"如果先出手"——则臂被切散）
  { id: "timed-93", re: /^(?:如果|若)先出手$|^(?:如果|若)后出手$/, go: () => ({ unparsedReason: "orphan order condition — then-clause split lost" }) },
  // "或" 裸枚举碎片（"或防御等级-2"——或复合被切散的尾臂，重复语义已在主臂）
  { id: "timed-94", re: new RegExp(`^或(?:者)?(?:自身|对手|对方|敌方)?(${STAT_RE})(?:等级)?[+\\-＋－]?${NUM}$|^或(${AIL_RE})$`), go: () => ({ unparsedReason: "or-list tail fragment — sibling carries main effect" }) },
  // 承伤上限裸句（"受到伤害不超过100"→dmg_cap）
  { id: "timed-95", re: new RegExp(`^受到(?:的)?伤害不超过(${NUM})(?:点)?$|^受到的伤害至多(${NUM})点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // "后" 裸前缀（"后对对手造成50点固定伤害"——切分残渣）
  { id: "timed-96", re: new RegExp(`^后(?:对|令|使)(?:对手|对方|敌方)造成(${NUM})点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // 全量恢复+PP（"恢复自身全部体力和所有技能PP值"）
  { id: "timed-97", re: /^恢复(?:自身|自己)全部体力和所有技能PP值?$|^恢复全部体力和PP$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // 生命值回血（"自身恢复100点生命值"）
  { id: "timed-98", re: new RegExp(`^(?:自身|自己)?(?:恢复|回复)(${NUM})点生命值$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self" }] }) },
  // 每回合固伤（"每回合造成100点固定伤害"→dot flat on foe）
  { id: "timed-99", re: new RegExp(`^每回合(?:对(?:对手|对方|敌方))?造成(${NUM})点(?:固定|固伤)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // 吸强别名（"吞噬对手的能力提升效果"→transfer_stages）
  { id: "timed-100", re: /^(?:吞噬|吞食)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "transfer_stages" }] }) },
  // 裸致命（"攻击致命"→crit）
  { id: "timed-101", re: /^攻击致命$|^攻击必定致命$|^造成致命[一1]?击$/, go: () => ({ attachDamage: { crit: true } }) },
  // 反转上升（"反转对手能力上升状态"→invert foe up）
  { id: "timed-102", re: /^(?:使|令|将)?(?:对手|对方|敌方)能力(?:上升|提升|强化)状态反转$|^反转(?:对手|对方|敌方)能力(?:上升|提升|强化)状态$/, go: () => ({ effects: [{ op: "invert_stages", target: "opponent", sign: "up" }] }) },
  // 随机异常种数（"30%几率使对手随机进入2种异常状态"/"15%概率使对手进入随机异常状态"）
  { id: "timed-103", re: new RegExp(`^(?:(${NUM})%(?:的?(?:概率|几率))?)?(?:使|令)(?:对手|对方|敌方)(?:随机)?进入(?:随机)?异常状态$|^(${NUM})%(?:的?(?:概率|几率))?(?:使|令)(?:对手|对方|敌方)随机进入(${NUM})种异常状态$|^(?:使|令)(?:对手|对方|敌方)随机进入(${NUM})种异常状态$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const bare = !/种/.test(m[0]); const pct = /%/.test(m[0]) ? ns[0] : undefined; const cnt = bare ? 1 : (pct !== undefined ? ns[1] : ns[0]); return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: Object.values(AILMENTS), count: cnt }, ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  { id: "timed-104", re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?(?:使|令)(?:对手|对方|敌方)随机进入(${NUM})种异常状态$|^(?:使|令)(?:对手|对方|敌方)随机进入(${NUM})种异常状态$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) ? ns[0] : undefined; const cnt = pct !== undefined ? ns[1] : ns[0]; return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: Object.values(AILMENTS), count: cnt }, ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // 数字致命击（"自身下次攻击技能必定致命1击"/"下回合必定致命2击"→crit_always count）
  { id: "timed-105", re: new RegExp(`^(?:自身|自己)?(?:下次|下${NUM}回合)?攻击技能必定致命(\\d)击$|^(?:自身)?必定致命(\\d)击$|^下回合自身必定致命(\\d)击$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const cnt = Math.max(1, ns[ns.length - 1] ?? 1); return { effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: cnt } }] }; } },
  // 等量固伤变体（"附加等量固伤"）
  { id: "timed-106", re: /^附加等量固伤$|^附加等量的?固定伤害$|^附加等量伤害$/, go: () => ({ attachDamage: { flatEcho: {} } }) },
  // 威力裸值（"威力80"——招式面板注脚，非效果）
  { id: "timed-107", re: /^威力\d+$|^威力：?\d+$/, go: () => ({ ignored: true }) },
  // 概率固伤（"30%概率额外附加60点固定伤害"→flatChance+flat）
  { id: "timed-108", re: new RegExp(`^(${NUM})%(?:的?(?:概率|几率))?额外附加(${NUM})点(?:固定|固伤)?伤害$|^${NUM}%概率附加(${NUM})点固定伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatBonus: ns[1], flatChance: ns[0] } }; } },
  // 每击概率固伤（"每次攻击30%的几率附加60点固定伤害"→flatOnHit）
  { id: "timed-109", re: new RegExp(`^每次攻击(${NUM})%的?(?:概率|几率)附加(${NUM})点(?:固定|固伤)?伤害$`), go: (m) => ({ attachDamage: { flatOnHit: { chance: num(m[1]), flat: num(m[2]) } } }) },
  // 几率分数回血（"30%的几率恢复自身体力的1/3"）
  { id: "timed-110", re: new RegExp(`^(${NUM})%的几率恢复自身体力的${NUM}\\s*/\\s*${NUM}$|^${NUM}%的?几率?恢复${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[1], denominator: ns[2], target: "self", chance: ns[0] }] }; } },
  // 打出致命（"攻击必定打出致命一击"→crit）
  { id: "timed-111", re: /^攻击必定打出致命[一1]?击$|^必定打出致命[一1]?击$|^必定打出致命$/, go: () => ({ attachDamage: { crit: true } }) },
  // 免疫反噬（"免疫则在回合结束时附加N%伤害量的固定伤害"——回合末反噬时点 UNVERIFIED，先按立即等量附加）
  { id: "timed-112", re: new RegExp(`^免疫则(?:在)?回合结束时附加(${NUM})%伤害量的固定伤害$|^免疫(?:成功)?则附加(${NUM})%伤害量的固定伤害$`), go: (m) => ({ attachDamage: { flatEcho: { pct: num(m[1] ?? m[2]) } } }) },
  // 每正级概率（"自身每处于1种能力强化状态则概率提高10%"→chancePerStage 挂 attachAll→本 clause 带 chance op）
  { id: "timed-113", re: new RegExp(`^自身每处于(?:1|一)种能力(?:强化|提升)状态则概率提高(${NUM})%$|^每有一种能力强化状态概率提高(${NUM})%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { chancePerStage: ns[0] } }; } },
  // 含混碎片显式留档
  { id: "timed-114", re: /^附加额外伤害$|^护罩效果$|^护盾效果$/, go: (m) => ({ unparsedReason: `ambiguous fragment: ${m[0]}` }) },
  // 优先出招（"优先出招"/"先出手"≈先制+1；UNVERIFIED 幅值）
  { id: "timed-115", re: /^优先出招$|^(?:必定)?先出手$/, go: () => ({ flags: { priority: 1 } }) },
  // 自身时限免疫（"自身N回合内免疫"/"N回合内自身免疫异常"）
  { id: "timed-116", re: new RegExp(`^(?:自身|自己)${NUM}回合内?免疫(?:异常|异常状态)?$|^${NUM}回合内?自身免疫(?:异常状态?|所有异常)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1] ?? m[2]) }] }) },
  // 自身疲惫（"自身疲惫N回合"→fatigue ailment 自挂）
  { id: "timed-117", re: new RegExp(`^(?:自身|自己)(?:陷入|进入)?疲惫${NUM}回合$`), go: (m) => ({ effects: [{ op: "apply_status", name: "fatigue", target: "self", turns: num(m[1]) }] }) },
  // 每回合吸取对手N/M体力（"吸取对手1/8体力"——无"最大"字样的基线按最大体力）
  { id: "timed-118", re: new RegExp(`^(?:每回合|回合结束时)(?:使用技能)?(?:吸取|吸收)(?:对手|对方|敌方)(?:的)?${NUM}\\s*/\\s*${NUM}(?:点)?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // 每回合吸强（"每回合使用技能吸取对手能力提升状态"→steal_stages_tick）
  { id: "timed-119", re: /^每回合(?:使用技能)?(?:吸取|吸收|偷取|窃取)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化|上升)状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "steal_stages_tick", target: "self" })] }) },
  // "令对方所有增强效果消失"/"令对方能力增强消失" → clear_stages foe up
  { id: "timed-120", re: /^(?:令|使|让)(?:对方|对手|敌方)(?:的)?(?:所有|全部)?(?:能力)?(?:增强|提升|强化)(?:状态|效果)?消失$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "免疫能力下降效果" → immune_degrade
  { id: "timed-121", re: /^免疫(?:自身)?能力下降(?:状态|效果)?$|^自身免疫弱化$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "吸收对手能力上升状态" → transfer steal
  { id: "timed-122", re: /^(?:吸收|吸取|偷取|窃取)(?:对手|对方|敌方)(?:的)?能力(?:上升|提升|强化)状态$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal" }] }) },
  // 概率随机PP置位（"N%的概率使对手的随机M项技能PP值变K"→pp_delta setRandom）
  { id: "timed-123", re: new RegExp(`^${NUM}%(?:的?(?:概|几)?率)?(?:使|令)(?:对手|对方|敌方)(?:的)?随机${NUM}项技能PP值?变(?:为|成)?(\\d+|${NUM})$|^使(?:对手|对方)随机${NUM}项技能PP值?变(\\d+)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const hasPct = m[0].includes("%"); return { effects: [{ op: "pp_delta", setRandom: { count: ns[hasPct ? 1 : 0], value: ns[hasPct ? 2 : 1] }, target: "opponent", scope: "all", ...(hasPct ? { chance: ns[0] } : {}) }] }; } },
  // 每回合全属性（"每回合N%令自身全属性+M"）。脱糖不转发 params.chance；挪到信封 chance 会开始掷骰。百分数不发。
  { id: "timed-124", re: new RegExp(`^每回合${NUM}%(?:的?(?:概|几)?率)?(?:令|使|让)?自身全属性([+\\-＋－])${NUM}$`), go: (m) => { const sgn = m[2] === "-" || m[2] === "－" ? -1 : 1; return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: 9, delta: sgn * num(m[3]) } })] }; } },
  // 条件连击数（"自身每处于N种强化状态则技能连击数+M"→hits.perStage）
  { id: "timed-125", re: new RegExp(`^(自身|对手|对方|敌方)每处于${NUM}种(?:能力)?(强化|提升|弱化|下降)状态则?(?:技能)?连击数\\+(\\d+|${NUM})$`), go: (m) => { const who = /自身/.test(m[1]) ? "self" : "opponent"; const sign = /弱化|下降/.test(m[3]) ? "down" : "up"; const per = num(m[2]); const add = num(m[4] ?? m[3]); return { attachDamage: { hitsPerStage: { who, sign, per, add } } }; } },
  // "若本次攻击造成的伤害小于N则附加M点固定伤害"（flatIfBelow 变体）
  { id: "timed-126", re: new RegExp(`^若?(?:本次|此次|该次)攻击造成的伤害(?:小于|低于)(\\d+)(?:点)?(?:则|,|，)?附加(\\d+)点(?:固定)?伤害$|^若造成的伤害小于(\\d+)(?:点)?则附加(\\d+)点(?:固定)?伤害$`), go: (m) => ({ attachDamage: { flatIfBelow: { min: num(m[1] ?? m[3]), flat: num(m[2] ?? m[4]) } } }) },
  // "若对手MISS则下回合自身必定致命"——reactWrap(2) + 下回合致命 payload
  { id: "timed-127", re: new RegExp(`^若?(?:对手|对方|敌方)(?:攻击)?MISS则?下回合自身(?:攻击)?必定致命(?:一)?击?$`, "i"), go: () => reactWrap(2, {}, "下回合自身攻击必定致命一击") },
  { id: "timed-128", re: /^将自身能力等级返回至上\d+回合结束时$|^能力等级返回至\d+回合前$/, go: () => ({ unparsedReason: "UNVERIFIED: 等级快照回卷——历史 stage 未建模" }) },
  // 强化锁（"自身的能力提升状态无法被消除或吸取"→up_lock）
  { id: "timed-129", re: /^(?:自身|自己)的?能力(?:提升|强化)状态(?:无法|不能)被(?:消除|解除|清除|吸取)(?:或(?:消除|解除|清除|吸取|反转))*$|^能力(?:提升|强化)状态不可被(?:消除|吸取)$|^自身能力提升无法被消除$/, go: () => ({ effects: [{ op: "apply_status", name: "up_lock", target: "self" }] }) },
  // "必定先手必定致命"（并合句：先手档+必暴旗同挂）。放在 timed-130 前面，那条只吃「必定先手」裸形。
  { id: "timed-130a", re: /^必定先手必定致命(?:一)?击?$|^必定先出必定致命(?:一)?击?$/, go: () => ({ flags: { priority: 3 }, attachDamage: { crit: true } }) },
  // 必定先手（"必定先手"≈高先制档位——官方无明确数值，UNVERIFIED +3）
  { id: "timed-130", re: /^必定先手$|^必定先出手$|^必定先出$/, go: () => ({ flags: { priority: 3 } }) },
  // 防御值固伤（"附加对手防御值30%的固定伤害"→flatFoeDefPct；"自身防御、特防总和30%"→flatSelfDefSumPct）
  { id: "timed-131", re: /^附加(?:对手|对方|敌方)(?:的)?防御值?的?(\d+)%(?:的)?(?:固定|固伤)?伤害$/, go: (m) => ({ attachDamage: { flatFoeDefPct: num(m[1]) } }) },
  { id: "timed-132", re: /^附加(?:自身|自己)(?:防御、特防|双防)(?:总和|之和)的?(\d+)%(?:的)?(?:固定|固伤)?伤害$/, go: (m) => ({ attachDamage: { flatSelfDefSumPct: num(m[1]) } }) },
  // 穿透免疫（"无视对手攻击免疫效果"→pierce 穿透 dmg_immune/低伤免疫/伤害转回复）
  { id: "timed-133", re: /^无视(?:对手|对方|敌方)?攻击免疫(?:效果|状态)?$|^无视(?:对手|对方|敌方)?(?:的)?免疫(?:效果|状态)$/, go: () => ({ attachDamage: { pierce: true } }) },
  // 攻击吸血窗（"每次攻击造成伤害的50%恢复自身体力"/"每回合对对方造成伤害的1/3恢复自身体力"→drain_atk）
  { id: "timed-134", re: new RegExp(`^每回合(?:对|向)?(?:对手|对方|敌方)?(?:造成)?的?伤害的?${NUM}\\s*/\\s*${NUM}(?:恢复|回复|转化为)(?:自身)?体力$|^每次攻击(?:造成|对对手造成)?(?:的)?伤害的${NUM}%都?会?(?:恢复|回复)自身体力$|^每次攻击(?:造成)?伤害的${NUM}\\s*/\\s*${NUM}(?:恢复|回复)自身体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const [n, d] = ns.length === 1 ? [ns[0], 100] : ns; return { effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n, d } }] }; } },
  // 次数制异常免疫（"己方免疫下2次受到的异常状态"→immune_status params.count）
  { id: "timed-135", re: new RegExp(`^(?:己方|自身|本方)?免疫下${NUM}次(?:受到的)?异常状态$|^免疫下${NUM}次(?:对手|对方|敌方)?(?:的)?异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  // 定额吸血提升（"吸取效果提升至400点"）→ 覆盖前一条吸血窗的 flat。
  // 引擎 drain_on_use 只读单一 params.flat，不支持条件化提升；若本句带条件
  // （"自身体力低于对手时"），解析层会把 attachAll.drainBoost 转成 unparsedReason。
  { id: "timed-136", re: /^吸取(?:效果|量)?提升至(\d+)点$|^吸血(?:效果|量)?提升至(\d+)点$/, go: (m) => ({ attachAll: { drainBoost: num(m[1] ?? m[2]) } }) },
  // 区间固伤尾巴（"随机附加50-100固伤"→attachDamage.flatRange）
  { id: "timed-137", re: new RegExp(`^(?:随机)?附加${NUM}\\s*-\\s*${NUM}(?:点)?(?:固伤|固定伤害)$|^随机造成${NUM}\\s*-\\s*${NUM}点?(?:固伤|固定伤害)$`), go: (m) => ({ attachDamage: { flatRange: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }) },

  // 命中降级（"每次直接攻击都会使对手防御和特防-1"→stageOnHit）
  { id: "timed-138", re: new RegExp(`^每次(?:直接)?攻击(?:都|就)?会?使(?:对手|对方|敌方)(${STAT_RE})(?:和|、|与)(${STAT_RE})(?:等级)?(-)${NUM}$`), go: (m) => ({ attachDamage: { stageOnHit: [{ stat: STATS[m[1]], delta: -num(m[4]) }, { stat: STATS[m[2]], delta: -num(m[4]) }] } }) },
  { id: "timed-139", re: new RegExp(`^每次(?:直接)?攻击(?:都|就)?会?使(?:对手|对方|敌方)(${STAT_RE})(?:等级)?([+-])${NUM}$`), go: (m) => ({ attachDamage: { stageOnHit: [{ stat: STATS[m[1]], delta: (m[2] === "-" ? -1 : 1) * num(m[3]) }] } }) },
  // 幅值尾巴留位（"最多降低40%"——前条修饰的封顶语义，无锚点直译）
  { id: "timed-140", re: /^最多降低(\d+)%$|^至多降低(\d+)%$|^(?:最多|最高|至多)减少(?:至|到)?(\d+)(?:%|点)?$|^(?:最多|最高|至多)减少(?:至|到)?(\d+)\/(\d+)$/, go: (m) => { const v = m[5] !== undefined ? Math.round((num(m[4]) * 100) / num(m[5])) : num(m[1] ?? m[2] ?? m[3] ?? "0"); return { attachAll: { capTail: { value: v, unit: "%", src: m[0] } } }; } },
  // "最高可叠加至N%/N点/可叠加N次" —— 叠加上限尾（unit 路由：次→growCap=step×N；%/点→growCap）
  { id: "timed-140b", re: /^最[多高](?:可)?叠加至?(\d+)次$|^(?:最多|最高|至多)(?:可)?叠加至?(\d+)(%|点)$|^可叠加至?(\d+)次$/, go: (m) => { const unit = m[3] === "点" ? "点" : m[3] === "%" || m[2] !== undefined ? "%" : "次"; return { attachAll: { capTail: { value: num(m[1] ?? m[2] ?? m[4]), unit, src: m[0] } } }; } },
  // "每次（受到）攻击(的)（减少量|伤害量|幅度|倍率|效果）增加/提升N%" —— body 内成长尾 → attachAll.growTail 挂前条 apply_status growStep
  { id: "timed-140c", re: /^每(?:次|回合)(?:开始|结束)?(?:使用|触发|受到攻击|遭受攻击|受到|攻击)?(?:技能)?(?:时|后|额外)?(?:的)?(?:概率|几率|减少量|伤害量|效果|幅度|倍率|威力)?(?:的)?(?:增加|提高|提升)(\d+)%$/, go: (m) => ({ attachAll: { growTail: { add: num(m[1]), src: m[0] } } }) },
  // "受到（攻击）伤害减少量增加/提升/增减N%" —— 无"每次"锚的受击成长尾（受击语境隐含每次）
  { id: "timed-140d", re: /^受到?的?(?:攻击|攻击技能|攻击伤害)(?:伤害)?(?:的)?(?:减少量|伤害量|幅度|倍率|效果)(?:的)?(?:增加|提高|提升|增减|叠加)(\d+)%$/, go: (m) => ({ attachAll: { growTail: { add: num(m[1]), src: m[0] } } }) },
  // 门控伤害提升（"对手处于能力下降状态造成的伤害提升50%"→dmg_boost + foeStageDown 门控）
  { id: "timed-141", re: new RegExp(`^对手处于能力下降状态(?:时|则|，|,)?(?:自身)?(?:造成的)?伤害提升${NUM}%$|^对手处于能力下降状态(?:时|则|，|,)?伤害提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1] ?? m[2]), foeStageDown: 1 } }] }) },
  { id: "timed-142", re: new RegExp(`^${NUM}回合内?(?:对手|对方|敌方)释放技能所消耗的PP为${NUM}倍$|^${NUM}回合内?(?:对手|对方|敌方)技能消耗PP(?:提升|增加|为)${NUM}倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_double", target: "opponent", turns: num(m[1]), params: { mul: num(m[2]) } }] }) },
  { id: "timed-143", re: new RegExp(`^(?:下)?${NUM}回合内?(?:对手|对方|敌方)受到的伤害提高${NUM}%$|^(?:使)?(?:对手|对方|敌方)${NUM}回合内?受到的伤害提高${NUM}%$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: ns[0], params: { pct: ns[1] } }] }; } },
  { id: "timed-144", re: new RegExp(`^${NUM}回合内?免疫(?:对手|对方|敌方)?(?:的)?攻击(?:伤害)?$|^${NUM}回合内?抵挡(?:对手|对方)?(?:的)?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: num(m[1]) }] }) },
  { id: "timed-145", re: new RegExp(`^可完全抵挡${NUM}次攻击$|^抵挡${NUM}次攻击$|^抵挡下${NUM}次(?:对手|对方|敌方)?(?:的)?攻击$|^免疫下${NUM}次受到的?攻击(?:伤害)?$|^免疫下${NUM}次(?:对手|对方|敌方)?(?:的)?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 99, params: { count: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) } }] }) },
  { id: "timed-146", re: new RegExp(`^${NUM}回合内?(?:对方|对手|敌方)无法(?:攻击|行动|使用技能)$|^(?:令|使|让)(对方|对手|敌方)${NUM}回合无法(?:攻击|行动|使用技能)$`), go: (m) => ({ effects: [{ op: "control", name: "block", target: "opponent", turns: num(m[1] ?? m[3]) }] }) },
];
