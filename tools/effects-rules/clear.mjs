// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, STATS, STAT_RE, tgt } from "./lex.mjs";

export const rules = [

  // ── 清除/解除/反转/转移 ─────────────────────────────────────
  // "消除对手所有强化状态"（clear-01 的修饰位在「能力/全属性」上，不含「所有强化」）。放在 clear-01 前面。
  { id: "p1-clr-03", re: /^(?:消除|驱散|清除)(?:对手|对方|敌方)(?:的)?(?:所有|全部|全项)?强化(?:状态|效果)$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "clear-01", re: /^(?:消除|驱散)(对手|对方|敌方)(的)?(能力|全属性|所有能力)?(提升|增强|上升|强化)(状态|效果)?(消失)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  { id: "clear-02", re: /^令对方(所有|全部)能力(增强|提升)(?:效果)?消失$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "解除自身所有的能力下降状态"（「所有」与「能力」之间多一个「的」）。放在 clear-03 前面，那条不含这个「的」。
  { id: "p1-clr-01", re: /^(?:解除|清除|消除)(自身|自己)(?:的)?(?:所有|全部)(?:的)?(?:能力)?(下降|弱化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  { id: "clear-03", re: /^(?:解除|清除|消除)(自身|自己)(的)?(所有|全部|能力)?(能力)?(下降|弱化)(状态|效果)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  { id: "clear-04", re: /^(?:解除|清除|消除)(对方|对手|敌方)(的)?(能力)?下降(状态|效果)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "down" }] }) },
  { id: "clear-05", re: /^反转(自身|自己)(的)?能力下降(状态)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  { id: "clear-06", re: /^反转(对手|对方|敌方)(的)?能力(提升|增强)(状态)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // "反转对手能力提升效果"（clear-06 尾词只收「状态」，「效果」尾是空档；带「的」的形态归 e53-inv-03）。放在 clear-06 后面。
  { id: "p1-clr-02", re: /^反转(对手|对方|敌方)能力(提升|增强|强化)效果$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // ── 形近字别名（全库唯一/两例的宿主句，逐字钉住，不改语序、不发明系数） ──
  // 宿主句 魔灵牵魂咒／摄魄令「解除自身能力下降状态，解除成则免疫下1次受到的攻击」——「成」是「成功」的脱字；
  // 负载与 attach-damage-05 同形（dmg_immune count:1），门是 prevApplied（上游 clear-03 的解除结果）。
  { id: "d3-clr-typo-01", re: /^解除成则免疫下1次受到的攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 }, if: { prevApplied: true } }] }) },
  // 宿主句 轮回之狱／永恒长眠「…使对手随机进入2种异常状态，未进入异常则消除对手回合类效果」。
  // 「未进入异常」= 上一条异常施加未落地（prevApplied 的否定，与「未触发则…」同门）；负载是 clear-07 的同一 IR。
  { id: "d3-clr-neg-01", re: /^未进入异常则消除对手回合类效果$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed", if: { not: { prevApplied: true } } }] }) },
  { id: "clear-07", re: /^消除对手回合类效果$|^消除(对方|对手)回合类效果$|^消除(?:对手|对方|敌方)的回合类效果$|^消除(?:对手|对方|敌方)回合效果$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // "清除对手能力强化和回合类效果"/"消除所有回合类效果" —— 复合净化
  { id: "clear-08", re: /^(?:消除|清除)(?:对手|对方|敌方)的?(?:能力)?(?:提升|强化)(?:状态)?(?:和|与|、)回合类效果$|^(?:消除|清除)(?:对手|对方|敌方)的?回合类效果(?:和|与|、)(?:能力)?(?:提升|强化)(?:状态|效果)?$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent" }, { op: "cleanse", target: "opponent", scope: "timed" }] }) },
  { id: "clear-09", re: /^消除所有回合类效果$|^消除(?:场上|彼此)?回合类效果$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "timed" }, { op: "cleanse", target: "opponent", scope: "timed" }] }) },
  { id: "clear-10", re: /^消除(?:自身|自己)(?:的)?(?:所有|全部)?回合类效果$|^清空(?:自身|自己)(?:所有|全部)?回合类效果$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "timed" }] }) },
  { id: "clear-11", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?消除(?:对手|对方|敌方)回合类效果$`), go: (m) => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed", chance: num(m[1]) }] }) },
  { id: "clear-12", re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?消除(?:对手|对方|敌方)能力(?:提升|强化)状态$`), go: (m) => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up", chance: num(m[1]) }] }) },
  // "清除自身所有异常状态"（clear-13 的动词只收「解除/消除」）。放在 clear-13 前面。
  { id: "p1-clr-04", re: /^(?:解除|消除|清除)(自身|自己)(?:的)?(?:所有|全部)?异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  // "清除对手所有异常状态"（clear-14 同缺口）。放在 clear-14 前面。
  { id: "p1-clr-05", re: /^(?:解除|消除|清除)(对手|对方|敌方)(?:的)?(?:所有|全部)?异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "ailment" }] }) },
  { id: "clear-13", re: /^(?:解除|消除)(自身|自己)(的)?(所有|全部)?异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  { id: "clear-14", re: /^(?:解除|消除)(对方|对手|敌方)(的)?(所有|全部)?异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "ailment" }] }) },
  { id: "clear-15", re: /^(?:吸取|偷取)(对手|对方|敌方)(的)?(能力|全属性)?(提升|增强)(状态)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  { id: "clear-16", re: /^(?:消除|驱散)(对手|对方)(的)?能力(提升|增强)(状态)?，?并将?该?(?:属性)?(?:效果)?附加给?自己$|^(?:使|令)(?:对手|对方|敌方)(?:的)?能力(?:提升|增强)(?:效果|状态)?转化到(?:自己|自身)(?:身上)?$|^(?:对手|对方|敌方)(?:的)?能力(?:提升|增强)(?:效果|状态)?转化到(?:自己|自身)(?:身上)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  { id: "clear-17", re: /^(?:复制|获得|偷取)(对方|对手|敌方)的?能力(提升|增强)(?:状态)?$/, go: () => ({ effects: [{ op: "copy_stages", sign: "up" }] }) },
  // "将自身能力提升状态附加给己方下只出战精灵" → copy_stages match+sign:up self→nextAlly 推送
  { id: "clear-18", re: /^(?:将|把)自身(?:的)?能力(提升|强化|下降|弱化)(?:状态)?(?:附加|转移|传递|复制)给(?:己方|我方)?下(?:一|1)?只?(?:出战)?精灵$|^(?:将|把)自身(?:的)?能力(提升|强化|下降|弱化)(?:状态)?(?:附加|转移|传递)给(?:对手|对方|敌方)$/, go: (m) => { const sign = /提升|强化/.test(m[1] ?? m[2]) ? "up" : "down"; const tgt = /对手|对方|敌方/.test(m[0]) ? "opponent" : "nextAlly"; return { effects: [{ op: "copy_stages", match: true, sign, target: tgt }] }; } },
  // 反向等级同步（"使对手该能力等级变为与自身相同"/"使对手防御等级变为与自身相同"→copy_stages match）
  { id: "clear-19", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:该|其|所有|全部)?(${STAT_RE})?(?:能力)?等级变为与自身(?:的)?相同$|^使(?:对手|对方|敌方)(?:所有|全部)?能力等级与自身相同$`), go: (m) => ({ effects: [{ op: "copy_stages", match: true, target: "opponent", ...(m[1] !== undefined && STATS[m[1]] !== undefined ? { stat: STATS[m[1]] } : {}) }] }) },
  { id: "clear-20", re: /^并?将?该?属性?(?:提升|增强)?(?:效果|状态)?附加给(?:自己|自身)$/, go: () => ({ attachAll: { stealUpgrade: true } }) },
];
