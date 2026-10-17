// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── 换人/PP/杂项 ────────────────────────────────────────────
  { id: "misc-01", re: /^(?:使|令)(对方|对手|敌方)?(?:强制)?替换精灵$|^(?:使|令)(对方|对手)下场$/, go: () => ({ effects: [{ op: "force_switch", target: "opponent" }] }) },
  { id: "misc-02", re: new RegExp(`^并?(?:恢复|回复)(?:自身|自己)(?:所有|全部)?(?:技能)?PP(?:值)?${NUM}点$|^并?(?:恢复|回复)(?:自身|自己)?(?:所有|全部)(?:技能)?PP值?$|^(?:恢复|回复)(?:自身|自己)(?:所有|全部)技能${NUM}点PP值?$|^${NUM}%?(?:概率|几率)?(?:恢复|回复)(?:自身|自己)(?:所有|全部)技能PP值?${NUM}点?$|^(?:所有|全部)技能(?:的)?PP值?(?:恢复|回复)${NUM}点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) ? ns[0] : undefined; const amount = pct !== undefined ? ns[1] : ns[0]; return { effects: [amount !== undefined ? { op: "pp_delta", amount, target: "self", scope: "all", ...(pct !== undefined ? { chance: pct } : {}) } : { op: "pp_delta", full: true, target: "self", scope: "all", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  { id: "misc-03", re: new RegExp(`^并?(?:使|令|降低|减少|扣除|消耗)(?:对方|对手|敌方)(?:所有|全部)?(?:技能)?PP(?:值)?${NUM}点?$|^${NUM}%?(?:概率|几率)?降低(?:对手|对方|敌方)(?:所有|全部)技能${NUM}点PP值?$|^降低(?:对手|对方|敌方)(?:所有|全部)技能${NUM}点PP值?$|^降低(?:自身|自己)(?:所有|全部)技能${NUM}点PP值?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const pct = /%/.test(m[0]) && ns.length > 1 ? ns[0] : undefined; const amount = ns[ns.length - 1]; const self = /降低(?:自身|自己)/.test(m[0]); return { effects: [{ op: "pp_delta", amount: -amount, target: self ? "self" : "opponent", scope: "all", ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  // 回合末 PP 恢复（"每回合结束后恢复自身所有技能1点PP值"）
  { id: "misc-04", re: new RegExp(`^每回合(?:结束后|结束时|末)?(?:恢复|回复)(?:自身|自己)(?:所有|全部)技能${NUM}点PP值?$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "pp_tick", target: "self", params: { flat: num(m[1]) } })] }) },
  // 指定槽位 PP 置值（"令对手第2技能PP值归0"→slot；"令对手第五技能PP值归0"→fifth 标记槽）
  { id: "misc-05", re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)(?:的)?第(${NUM})(?:个|项)?技能(?:的)?[pP][pP]值?(?:归|变为|为)(${NUM}|零)$`), go: (m) => { const sn = num(m[1]); const v = m[3] === "零" ? 0 : num(m[4] ?? m[3]); return { effects: [{ op: "pp_delta", slot: sn === 5 ? "fifth" : sn, set: v, target: "opponent" }] }; } },
  // 自身 PP 恢复变体（"恢复2点PP"/"自身所有技能恢复2点PP值"/"使自身所有技能PP值恢复3点"/"恢复至满"）
  { id: "misc-06", re: /^(?:使|令|让)?(?:自身|自己)(?:所有|全部)?技能?(?:的)?[pP][pP]值?(?:恢复|回复)至?满$|^令自身所有技能PP值?恢复至满$/, go: () => ({ effects: [{ op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "恢复自身pp1点"（小写 pp + 数字后置）。放在 misc-07 前面，那条数字在「点」之前。
  { id: "misc-07a", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?[pP]{2}(${NUM})点$`), go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self" }] }) },
  { id: "misc-07", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?${NUM}点[pP][pP]值?$|^(?:使|令|让)?(?:自身|自己)(?:所有|全部)?技能?(?:的)?[pP][pP]值?(?:恢复|回复)${NUM}点$|^(?:自身|自己)?(?:所有|全部)技能(?:恢复|回复)${NUM}点[pP][pP]值?$|^(?:恢复|回复)(?:所有|全部)技能${NUM}点[pP][pP]值?$`), go: (m) => { const n = num(m.slice(1).find((x) => x !== undefined)); return { effects: [{ op: "pp_delta", amount: n, target: "self" }] }; } },
  // 对手所有技能先制（"令对手所有技能先制-2"/"下N回合对手所有技能先制-1"）
  { id: "misc-08", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)(?:所有|全部)技能先制([+-])${NUM}$|^(?:对手|对方|敌方)(?:所有|全部)技能先制([+-])${NUM}$`), go: (m) => { const s = (m[1] ?? m[3]) === "-" ? -1 : 1; return { effects: [{ op: "apply_status", name: "prio_up", target: "opponent", params: { add: s * num(m[2] ?? m[4]) } }] }; } },
  { id: "misc-09", re: new RegExp(`^(?:令|使|让)(对方|对手|敌方)(?:无法|不能)(?:主动)?替换(?:精灵)?[，,]?(?:持续)?${NUM}回合$|^(?:令|使|让)(对方|对手|敌方)束缚${NUM}回合$`), go: (m) => ({ effects: [{ op: "apply_status", name: "bind", target: "opponent", turns: num(m[2] ?? m[3]) }] }) },
  { id: "misc-10", re: new RegExp(`^使自身在接下来的${NUM}回合中(?:每次)?直接攻击必定致命(?:一)?击$|^${NUM}回合内?自身(?:攻击|直接攻击)必定致命(?:一)?击$`), go: () => ({ unparsedReason: "crit mechanic — E4" }) },
  // 低频长尾显式留档
  { id: "misc-11", re: /^最多获得\d+点$/, go: () => ({ unparsedReason: "shield/点数 cap tail — 宿主修饰" }) },
  // 累计先制削减（"每回合都使对手的先制-N"→prio_push_tick 对手侧叠加）
  { id: "misc-12", re: new RegExp(`^每回合都?(?:使|令)(?:对手|对方|敌方)(?:的)?先制([+-])${NUM}$`), go: (m) => { const sgn = m[1] === "-" ? -1 : 1; return { effects: [liftTick({ op: "apply_status", name: "prio_push_tick", target: "self", params: { add: sgn * num(m[2]) } })] }; } },
  // 对手PP计数条件（"对手任意N项技能PP值小于M点则X"→foePpLt cond——被"则"切出后作孤儿条件）
  { id: "misc-13", re: new RegExp(`^(?:若)?对手任意${NUM}项技能PP值?小于(\\d+|${NUM})点$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { orphanCond: { foePpLt: { count: ns[0], lt: ns[1] } } }; } },
  // 切换反应式留档（登场/切换钩子未建模）
  { id: "misc-14", re: new RegExp(`^对手下${NUM}次主动切换或死亡切换精灵时|^对手主动切换精灵则|^对手(?:主动)?切换精灵$`), go: () => ({ unparsedReason: "switch/enter trigger — deferred" }) },
  // 致死存活（"受到致命伤害则强制存活"→endure。count 没人读，缺省保留 1 点）
  { id: "misc-15", re: /^若?本回合受到致命伤害则强制存活$|^受到致命伤害强制存活$|^若?(?:受到|承受)致命(?:一击|伤害)则?保留1点(?:体力|HP)$/, go: () => ({ effects: [{ op: "apply_status", name: "endure", target: "self" }] }) },
  // 承伤百分比减免（"受到伤害减少50%"→dmg_taken_down）
  { id: "misc-16", re: new RegExp(`^(?:受到的|受到|自身受到)(?:攻击)?伤害减少${NUM}%$|^受到的伤害降低${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1]) } }] }) },
  // 能力值对齐（"自身的防御力和对手相同"——设值非 stage，UNVERIFIED）
  { id: "misc-17", re: /^自身的(?:防御|防御力|攻击|特攻|特防|速度)和对手相同$|^使自身(?:防御|特防)力?(?:变为|与)对手相同$/, go: () => ({ unparsedReason: "UNVERIFIED: stat value equal-to-foe" }) },
  // 体力置区间（"变为N-M点体力"——设值非回血，UNVERIFIED 语义基线）
  { id: "misc-18", re: new RegExp(`^变为${NUM}\\s*[-~～]\\s*${NUM}点体力$|^体力变为${NUM}\\s*[-~～]\\s*${NUM}$`), go: () => ({ unparsedReason: "UNVERIFIED: hp set-to-range" }) },
  // 已损HP驱动的异常概率（"自身每损失N%体力则进入异常几率提升M%"——几率修饰语义不明）
  { id: "misc-19", re: new RegExp(`^自身每损失${NUM}%的?体力则进入异常几率提升${NUM}%$`), go: () => ({ unparsedReason: "UNVERIFIED: chance-per-missing-hp on ailment" }) },
  { id: "misc-20", re: new RegExp(`^每回合使用技能则造成伤害前随机吸取(?:对手|对方)${NUM}项能力值?-${NUM}$|^造成伤害前随机吸取(?:对手|对方)${NUM}项能力(?:值)?-${NUM}$`), go: () => ({ unparsedReason: "per-turn steal-stage tick — UNVERIFIED ordering" }) },
  { id: "misc-21", re: new RegExp(`^使用后${NUM}回合攻击击中对象要害概率增加${NUM}\\s*/\\s*${NUM}$`), go: () => ({ unparsedReason: "crit mechanic — E4" }) },
  // "技能未命中时恢复自身最大体力的1/3"（misc-22 的签名不吃「技能未命中时」前缀）。放在 misc-22 前面。
  { id: "p1-misc-01", re: /^(?:自身|自己)?技能未命中时(.+)$/, go: (m) => reactWrap(6, {}, m[1]) },
  { id: "misc-22", re: new RegExp(`^(?:若)?未(?:触发|命中)(?:则|，?)(.+)$`), go: (m) => ({ unparsedReason: `else-branch: ${m[1].slice(0, 20)}` }) },
  // "每回合减少200点伤害"（batch-e5-20a 的签名是「每回合减伤害N」）。放在 misc-23 前面。
  { id: "p1-misc-02", re: new RegExp(`^每回合(?:受到)?减少([0-9]+)(?:点)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "misc-23", re: new RegExp(`^(?:若)?消除成功则(.+)$`), go: (m) => ({ unparsedReason: `then-branch: ${m[1].slice(0, 20)}` }) },
  { id: "misc-24", re: /^使得对方的技能失效$|^令对手(?:的)?技能失效$/, go: () => ({ unparsedReason: "move disable — E4" }) },
];
