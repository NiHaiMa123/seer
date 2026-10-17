// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e32：剩余复刻批一——回合窗威力倍率孤儿、防御强化孤儿、pierce/闪避变体、随机多维弱化、反应式击败/消强窗。
// 位置：须在 batchE5c（下一只出战精灵兜底）与 attachDamage-61（下只出场精灵兜底）之前。
import { NUM, num, frac, STATS, STAT_RE, ALL_STATS, AILMENTS, AIL_RE } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText } from "../effects-parse.mjs";

const stat = (w) => STATS[w] ?? { 特殊攻击: "spa", 战术攻击: "atk" }[w];
const AIL = (w) => AILMENTS[w] ?? w;

export const rules = [
  // ── 回合窗威力倍率（TURNS_PRE 吃掉"使自身下N回合"后余"的攻击威力翻倍"）──
  // "的攻击威力翻倍"/"攻击威力翻倍" → power_mul 状态（effTurns 自动挂窗；无窗时=在场常驻）
  { id: "e32-powmul-01", re: /^(?:的)?(?:攻击|所有攻击|攻击技能)(?:的)?威力(?:翻倍|加倍)$/, go: () => ({ effects: [{ op: "apply_status", name: "power_mul", target: "self", params: { n: 2, d: 1 } }] }) },
  { id: "e32-powmul-02", re: new RegExp(`^(?:的)?(?:攻击|所有攻击|攻击技能)(?:的)?威力(?:提升|提高)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "power_mul", target: "self", params: { n: 100 + num(m[1]), d: 100 } }] }) },
  // "的威力翻倍"（"使自身下2回合的威力翻倍"——无攻击词裸尾）
  { id: "e32-powmul-03", re: /^的威力(?:翻倍|加倍)$/, go: () => ({ effects: [{ op: "apply_status", name: "power_mul", target: "self", params: { n: 2, d: 1 } }] }) },

  // ── 无视强化孤儿续段 ────────────────────────────────────────
  // "无视对手速度以及防御能力强化状态" → ignoreFoeSpeed + pierce_stages
  // 注意：「和/及/与」连接词不收——「速度和防御能力强化状态」有「速度能力提升+防御能力提升」歧义读法，保持残留
  { id: "e32-pierce-01", re: /^无视对手(?:速度|速率)以及(?:所有|全部)?防御(?:、特防)?能力(?:强化|提升)(?:的)?状态$/, go: () => ({ flags: { ignoreFoeSpeed: true }, effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "无视对手(所有)?防御、特防能力强化状态" → pierce_stages（顿号切开后两侧各自孤儿兜底）
  { id: "e32-pierce-03", re: /^无视对手(?:所有|全部)?防御$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  { id: "e32-pierce-04", re: /^(?:所有|全部)?(?:防御|特防|双防)能力(?:强化|提升)(?:的)?状态$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "无视对手攻击、特攻能力强化状态" 枚举穿透（仅限顿号——和/及存在枚举归属歧义）
  { id: "e32-pierce-05", re: /^无视对手(?:所有|全部)?(?:攻击|特攻|防御|特防|速度|双攻|双防)、(?:攻击|特攻|防御|特防|速度|双攻|双防)能力(?:强化|提升)(?:的)?状态$/, go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },

  // ── 随机多维弱化 / 吸取 ────────────────────────────────────
  // "使对手N项能力值-M"（语料"使对手2项能力值-1"≈随机N项——随机选维按规则库既有 randomCount 编码）
  { id: "e32-rand-01", re: new RegExp(`^(?:使|令|让)(对手|对方|敌方)(?:随机)?${NUM}项能力(?:值)?(?:等级)?([+-])${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[2]), delta: (m[3] === "-" ? -1 : 1) * num(m[4]), target: "opponent" }] }) },
  // "使对手N项能力值-M并附加到自己身上" → transfer_stages randomCount（同维成对，镜像不落异维）
  { id: "e32-rand-02", re: new RegExp(`^(?:使|令|让)(对手|对方|敌方)(?:随机)?${NUM}项能力(?:值)?(?:等级)?-${NUM}(?:，|,)?并?(?:将|把)?(?:其|该|对应|相同)?(?:能力|等级|属性)?(?:值)?附加(?:到|给)(?:自身|自己)(?:身上)?$`), go: (m) => ({ effects: [{ op: "transfer_stages", randomCount: num(m[2]), randomDelta: num(m[3]) }] }) },

  // ── 免疫/反弹 ────────────────────────────────────────────
  // "免疫伤害"（"受到的伤害低于N则免疫伤害并造成等量固伤"的免疫半段；并切出后孤儿）
  { id: "e32-imm-01", re: /^免疫(?:所有|全部)?(?:受到)?(?:的)?(?:攻击|所有)?伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  // "免疫反弹所有异常"/"免疫并反弹异常状态" → immune_status + reflect_status
  { id: "e32-imm-02", re: /^免疫(?:并|且|和)?反弹(?:所有|全部)?异常(?:状态|效果)?$|^免疫(?:所有|全部)?异常(?:状态|效果)?(?:并|且|和)?反弹$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "reflect_status", target: "self" }] }) },

  // ── 承伤/闪避 ────────────────────────────────────────────
  // "受到伤害翻倍"/"受到的伤害翻倍" → dmg_taken_up 100%（"使对手下回合受到伤害翻倍"经 foeCtx 落到对手侧）
  { id: "e32-dmgup-01", re: /^(?:受到|遭受)(?:的)?(?:攻击|所有|攻击技能)?伤害翻倍$|^(?:受到|遭受)(?:的)?(?:攻击)?伤害提高100%$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "self", params: { pct: 100 } }] }) },
  // "闪避率N%"/"闪避率提升N%" → dodge
  { id: "e32-dodge-01", re: new RegExp(`^(?:自身|自己)?闪避率(?:提升|提高|增加|上升)?${NUM}%$|^闪避率${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "对手下N次攻击技能都有M%的概率被闪避" → dodge 次数窗（params.count 逐次消耗）
  { id: "e32-dodge-02", re: new RegExp(`^(?:对手|对方|敌方)下${NUM}次(?:使用)?(?:攻击|攻击技能|使用的攻击技能)(?:技能)?都?(?:有)?${NUM}%(?:的)?(?:概率|几率)?被(?:自身|自己)?闪避$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: ns[1], count: ns[0] } }] }; } },

  // ── 回合末 tick ──────────────────────────────────────────
  // 自解异常：旧名 cleanse_self_ail。win 15 是原 WIN.cleanseSelfAil。plain 跳过解除封锁，noHooks 不派发解除触发。
  { id: "e32-tick-01", re: /^每回合(?:结束|开始)?(?:时|后)?(?:解除|消除|清除)(?:自身|自己)(?:所有|全部|身上)?(?:的)?异常(?:状态|效果)?$/, go: () => ({ effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 15 }, payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }] }] }) },
  // "每回合反转对手能力提升状态" → invert_stages 经 ailment_tick 载体逐回合派发
  { id: "e32-tick-02", re: /^每回合(?:开始|结束)?(?:时|后)?反转(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:的)?状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "invert_stages", sign: "up", target: "opponent" }] })] }) },
  { id: "e32-tick-03", re: /^每回合(?:开始|结束)?(?:时|后)?反转(?:自身|自己)(?:的)?能力(?:下降|降低)(?:的)?状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "invert_stages", sign: "down", target: "self" }] })] }) },
  // "每回合N%令对手AIL" / "每回合令对手AIL" → ailment_tick payload
  { id: "e32-tick-04", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:都|还|亦|也)?(?:会)?(?:有)?${NUM}%(?:的)?(?:概率|几率)?(?:令|使)(对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_status", name: AIL(m[3]), target: "opponent", chance: num(m[1]) }] })] }) },
  { id: "e32-tick-05", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:令|使)(对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_status", name: AIL(m[2]), target: "opponent" }] })] }) },
  // "每回合附加对手N点固定伤害" → foe_dot flat
  { id: "e32-tick-06", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:附加|使|令)(?:对手|对方|敌方)(?:受到)?${NUM}点(?:固定)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: num(m[1]) } }] }) },
  // "每回合有N%几率降低对手最大体力n/d" → maxhp_tick + per-tick chance
  { id: "e32-tick-07", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:有)?${NUM}%(?:的)?(?:几率|概率)?(?:令|使|降低|减少)?(?:对手|对方|敌方)?(?:的)?最大(?:体力|HP)(?:的)?(?:下降|降低|减少)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "maxhp_tick", target: "opponent", params: { n: num(m[2]), d: num(m[3]), chance: num(m[1]) } })] }) },
  { id: "e32-tick-08", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:降低|减少)(?:对手|对方|敌方)(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "maxhp_tick", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } })] }) },

  // ── 反转/恢复翻倍 ────────────────────────────────────────
  // "双倍反转自身的能力下降" → invert_stages mul:2
  { id: "e32-invert-01", re: /^双倍反转(?:自身|自己)(?:的)?能力(?:下降|弱化|降低)(?:的)?(?:状态)?$/, go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self", mul: frac(2, 1) }] }) },
  // "则恢复效果翻倍"（"HP低于对手时则恢复效果翻倍"剥 cond 后的尾段）→ healDouble
  { id: "e32-healx-01", re: /^则?恢复(?:效果|量)?翻倍$|^则?回复(?:效果|量)?翻倍$/, go: () => ({ attachAll: { healDouble: true } }) },

  // ── 禁疗/失效/先制 ───────────────────────────────────────
  // "对手N回合内无法通过技能恢复体力"（TURNS_PRE 不剥"对手N回合内"——整句入规则）
  { id: "e32-nohr-01", re: new RegExp(`^(?:使|令|让)?(对手|对方|敌方)(?:在)?${NUM}回合(?:内)?(?:所有)?(?:技能)?无法(?:通过技能)?(?:恢复|回复)(?:体力|HP|生命)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: 100 }, turns: num(m[2]) }] }) },
  { id: "e32-nohr-02", re: /^(?:无法|不能)(?:通过技能)?(?:恢复|回复)(?:体力|HP|生命)$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: 100 } }] }) },
  // "技能失效"/"所有技能失效"（"对手下1回合技能失效"剥窗后余部）→ move_null
  { id: "e32-null-01", re: /^(?:所有|全部)?技能失效$|^(?:攻击)?无效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  // "使对手N回合内所有技能失效" → move_null 回合窗
  { id: "e32-null-02", re: new RegExp(`^(?:使|令|让)(对手|对方|敌方)${NUM}回合内?(?:所有|全部)?技能失效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: num(m[2]) }] }) },
  // "令对手下次使用的技能无效" / "下1次对手使用的属性技能无效" → move_null count+cat
  { id: "e32-null-03", re: new RegExp(`^(?:使|令|让)(对手|对方|敌方)下(?:次|${NUM}次)?(?:使用|使用)?(攻击|属性)?(?:的)?技能无效$|^下${NUM}次(对手|对方|敌方)使用(攻击|属性)?(?:的)?技能无效$`), go: (m) => { const cnt = m.slice(1).filter((x) => x !== undefined && /^\d+$|^[一二两三四五六七八九十]$/.test(x)).map(num)[0] ?? 1; const cat = /属性/.test(m[0]) ? 1 : /攻击/.test(m[0]) ? 4 : undefined; return { effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: cnt, ...(cat !== undefined ? { cat } : {}) } }] }; } },
  // "攻击必定先手"/"必定先手"（"下回合攻击必定先手"剥窗后由 flags.priority+effTurns 折算 prio_up）
  { id: "e32-prio-01", re: /^(?:(?:所有|全部|自身|自己)?攻击)?(?:技能)?必定先手$|^(?:攻击)?必定先手$/, go: () => ({ flags: { priority: 3 } }) },
  // "下N次自身技能先制+M" → prio_count
  { id: "e32-prio-02", re: new RegExp(`^下${NUM}次(?:自身|自己)?(?:使用)?(?:攻击|所有)?技能(?:先制|先手)([+-])${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: (m[2] === "-" ? -1 : 1) * num(m[3]), count: num(m[1]) } }] }) },
  // "若本方先手攻击使对方技能失效" → order:first + move_null
  { id: "e32-prio-03", re: /^若(?:本方|己方|自身|自己)?先手攻击(?:使|令)(?:得)?(?:对手|对方|敌方)?技能失效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 }, if: { order: "first" } }] }) },

  // ── 反应式（被击败/强化消失触发）─────────────────────────
  // "若被对方击败，则对手所有能力加强状态消失" → react trigger5 + clear_stages
  { id: "e32-react-01", re: /^若?(?:被|为)(?:对方|对手|敌方|对手技能)?击败(?:后)?(?:，|,)?则?(?:对手|对方|敌方)(?:的)?(?:所有|全部)?能力(?:加强|提升|强化)(?:的)?状态消失$/, go: () => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 5 }, payload: [{ op: "clear_stages", sign: "up", target: "opponent" }] }] }) },
  // "若自身能力强化状态消失，则N回合对手无法使用属性技能" → react trigger7 + status_lock
  { id: "e32-react-02", re: new RegExp(`^若?(?:自身|自己)(?:的)?能力(?:强化|提升)(?:的)?状态(?:被消除|消失|被吸取|被消除或吸取)(?:时|后)?(?:，|,)?则?(?:对手|对方|敌方)?${NUM}回合(?:内)?(?:对手|对方|敌方)?无法使用属性技能$`), go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 7 }, payload: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: 1 }, turns: num(m[1]) }] }] }) },

  // ── 命中/条件威力 ────────────────────────────────────────
  // "自身攻击技能命中则对手全属性-N" → 命中则通用前缀剥 + 全属性尾
  { id: "e32-hit-01", re: new RegExp(`^(?:自身|自己)?(?:攻击|攻击技能|技能)?命中(?:后|时)?则(?:对手|对方|敌方)?全属性([+-])${NUM}$`), go: (m) => { const d = (m[1] === "-" ? -1 : 1) * num(m[2]); return { effects: ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: d, target: "opponent" })) }; } },
  // "自身攻击技能命中则X" 通用剥前缀（命中后效果在用招结算等价——MISS 不触发）
  { id: "e32-hit-02", re: /^(?:自身|自己)?(?:攻击|攻击技能)(?:技能)?命中(?:后|时|对方后|对手后)则(.+)$/, go: (m) => { const r = parseBody(m[1]); return r === null ? { unparsedReason: `hit-then body unparsed: ${m[1].slice(0, 24)}` } : r; } },
  // "自身hp小于N/N时威力加倍" → scaleIf selfHpBelow（hp 小写变体）
  { id: "e32-scale-01", re: new RegExp(`^(?:自身|自己)(?:HP|hp|体力)(?:值)?(?:小于|低于|不足)${NUM}\\s*/\\s*${NUM}(?:时|则)?威力(?:加倍|翻倍)$`), go: (m) => ({ attachDamage: { scaleIf: { when: { selfHpBelow: frac(num(m[1]), num(m[2])) }, numerator: 2, denominator: 1 } } }) },
  // "对对方造成伤害的N%恢复自身体力" → drain pct
  { id: "e32-drain-01", re: new RegExp(`^(?:对|给)(?:对方|对手|敌方)?造成伤害的?${NUM}%(?:的)?(?:恢复|回复|转化为|变为)(?:自身|自己)?(?:体力|HP|生命)?$`), go: (m) => ({ attachDamage: { drain: { numerator: num(m[1]), denominator: 100 } } }) },

  // ── 固伤附加（自身属性值缩放）────────────────────────────
  // "攻击技能附加自身当前体力N%的固定伤害" → flatSelfCurPct
  { id: "e32-flat-01", re: new RegExp(`^(?:攻击技能|攻击|所有攻击)?附加(?:自身|自己)当前体力${NUM}%的(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatSelfCurPct: num(m[1]) } }) },
  // "附加自身A与B总和N%的固定伤害" → flatSelfStatPct stats[]（无顿号粘连形；顿号切开经 parse 合并走 timed-59）
  { id: "e32-flat-02", re: new RegExp(`^(?:攻击技能|攻击|所有攻击)?附加(?:自身|自己)(${STAT_RE})(?:与|和)(${STAT_RE})(?:的)?总和${NUM}%的(?:固定伤害|固伤)$`), go: (m) => { const a = stat(m[1]), b = stat(m[2]); if (a === undefined || b === undefined || a === "acc" || b === "acc") return null; return { attachDamage: { flatSelfStatPct: { stats: [a, b], pct: num(m[3]) } } }; } },

  // ── 受到相当于自身当前体力N/M的百分比伤害 ────────────────
  { id: "e32-pct-01", re: new RegExp(`^(?:使|令|让)(对手|对方|敌方)受到相当于(?:自身|自己)当前体力(?:的)?${NUM}\\s*/\\s*${NUM}的百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[2]), num(m[3])), percentBase: "selfCur", target: "opponent" }] }) },

  // ── 无视免疫次数窗 ───────────────────────────────────────
  // "下N次攻击技能无视对手攻击免疫效果" → pierce status count
  { id: "e32-pi-01", re: new RegExp(`^下${NUM}次(?:使用)?(?:攻击|攻击技能|技能)(?:时)?无视对手(?:的)?(?:攻击)?免疫(?:效果|伤害)?$|^下${NUM}次(?:攻击|攻击技能)无视对手(?:攻击)?免疫(?:效果|伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pierce", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },

  // ── 单次/下次窗口 ────────────────────────────────────────
  // "自身下次攻击造成的伤害提升N%" → 同一次 dmg_boost。放在 e32-next-01 前面：那条吃不下「攻击造成的」。
  { id: "e32-next-01a", re: new RegExp(`^(?:自身|自己)下次攻击造成的伤害(?:提升|提高|增加)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]), count: 1 } }] }) },
  // "自身下次造成的伤害提升N%" → dmg_boost{count:1}（damage.ts 逐招消耗次数窗）
  { id: "e32-next-01", re: new RegExp(`^(?:自身|自己)下次(?:攻击|造成|打出)?(?:的)?(?:攻击)?伤害(?:提升|提高|增加)${NUM}%$|^下次造成的伤害提升${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1] ?? m[2]), count: 1 } }] }) },

  // ── 疲惫（无法攻击帧）───────────────────────────────────
  // "N%令对方疲惫M回合无法攻击" → fatigue turns（疲惫=不可行动标记异常，回合窗落地）
  { id: "e32-fat-01", re: new RegExp(`^(?:${NUM}%)?(?:概率|几率)?令(?:对方|对手|敌方)疲惫${NUM}回合(?:无法攻击|不能行动)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const hasPct = /%/.test(m[0]); return { effects: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: hasPct ? ns[1] : ns[0], ...(hasPct ? { chance: ns[0] } : {}) }] }; } },
];

// go() 内可运行时调用——本批 e32-hit-02 通用剥前缀用
function parseBody(t) {
  const r = parseEffectText(t);
  if (r.effects.length === 0 && r.unparsed.length > 0) return null;
  return { effects: r.effects, flags: r.flags, ...(r.unparsed.length > 0 ? { unparsed: r.unparsed } : {}) };
}
