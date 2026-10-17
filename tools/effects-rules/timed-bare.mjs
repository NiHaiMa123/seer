// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, STAT_CODES, AILMENTS, AIL_RE, stageFx, tgt } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";

export const rules = [

  // ── 裸 timed 片段（逗号拆分后无 "N回合" 前缀 → ctxTurns 注入；无 ctx 则永续）──
  { id: "timed-bare-01", re: /^免疫并反弹(?:所有|全部)?(?:受到的)?异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "reflect_status", target: "self" }] }) },
  { id: "timed-bare-02", re: /^免疫(?:所有|全部)?(?:受到的)?异常状态$|^(?:自身)?不会出现异常状态$|^(?:自身)?不受异常状态影响$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  { id: "timed-bare-03", re: /^免疫能力下降(?:状态)?$|^(?:自身)?不受能力下降(?:技能)?影响$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  { id: "timed-bare-04", re: new RegExp(`^(?:令)?自身所有技能先制\\+${NUM}$|^先制\\+${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: num(m[1] ?? m[2]) } }] }) },
  // 类别限定先制（"下回合攻击技能先制+2" / "攻击技能先制+1"）：params.cat 门控——4=任意攻击、1=属性
  { id: "timed-bare-05", re: new RegExp(`^(?:(?:令|使|让)?(?:自身|自己|本方)(?:所有)?)?(攻击|属性)技能先制([+-])${NUM}$|^(?:(?:令|使|让)?(?:自身|自己|本方)下?回合)?(攻击|属性)技能先制([+-])${NUM}$`), go: (m) => { const cat = (m[1] ?? m[4]) === "攻击" ? 4 : 1; const s = (m[2] ?? m[5]) === "-" ? -1 : 1; return { effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: s * num(m[3] ?? m[6]), cat } }] }; } },
  { id: "timed-bare-06", re: new RegExp(`^每回合(?:恢复|回复)(?:自身)?最大体力的${NUM}\\s*/\\s*${NUM}$|^每回合(?:使用技能)?(?:恢复|回复)自身最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  { id: "timed-bare-07", re: new RegExp(`^每回合(?:恢复|回复)(?:自身)?${NUM}\\s*/\\s*${NUM}(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "timed-bare-08", re: new RegExp(`^每回合(?:恢复|回复)(?:自身)?(\\d+)(?:点)?(?:HP|体力|固定体力值|体力值)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "timed-bare-09", re: new RegExp(`^(?:每回合|回合结束时)(?:使用技能)?(?:吸取|吸收)(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$|^(?:每回合|回合结束时)(?:使用技能)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}最大体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  { id: "timed-bare-10", re: new RegExp(`^每回合(?:都)?(?:能)?附加(\\d+)点固定伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "timed-bare-11", re: new RegExp(`^(?:使)?自身下?${NUM}回合(?:的)?攻击威力翻倍$|^${NUM}回合内?自身攻击威力翻倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", turns: num(m[1] ?? m[2]), params: { mul: 2 } }] }) },
  { id: "timed-bare-12", re: new RegExp(`^${NUM}回合无法(?:攻击|行动|使用技能)$|^(?:令|使|让)(?:对方|对手|敌方)${NUM}回合无法(?:攻击|行动|使用技能)$|^(?:对方|对手|敌方)${NUM}回合无法(?:攻击|行动|使用技能)$`), go: (m) => ({ effects: [{ op: "control", name: "block", turns: num(m[1] ?? m[2] ?? m[3]), target: "opponent" }] }) },
  { id: "timed-bare-13", re: new RegExp(`^(?:对手|对方|敌方)释放技能所消耗的PP为${NUM}倍$|^(?:对手|对方)技能消耗PP(?:提升|增加|为)${NUM}倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_double", target: "opponent", params: { mul: num(m[1] ?? m[2]) } }] }) },
  { id: "timed-bare-14", re: new RegExp(`^免疫(?:对手|对方|敌方)?(?:的)?攻击(?:伤害)?$|^抵挡(?:对手|对方)?(?:的)?攻击$|^免疫并?反弹(?:对手|对方)?(?:的)?攻击$`), go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  // 致命一击/必定命中窗口（crit_always/crit_up/must_hit flag 驱动）
  { id: "timed-bare-15", re: new RegExp(`^使自身在接下来的${NUM}回合中(?:每次)?(?:直接)?攻击必定致命(?:一)?击?$|^使自身下${NUM}回合(?:直接)?攻击必定致命(?:一)?击?$|^${NUM}回合内?自身(?:攻击|直接攻击)必定致命(?:一)?击?$|^使自身${NUM}回合(?:内)?攻击必定致命(?:一)?击?$|^(?:使|令)?自身下?${NUM}回合(?:内)?(?:攻击)?必定暴击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: num(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) }] }) },
  { id: "timed-bare-16", re: new RegExp(`^使自身下${NUM}回合攻击必定致命、?必定命中$|^${NUM}回合内?攻击必定致命、?必定命中$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: num(m[1] ?? m[2]) }, { op: "apply_status", name: "must_hit", target: "self", turns: num(m[1] ?? m[2]) }] }) },
  { id: "timed-bare-17", re: new RegExp(`^${NUM}回合(?:内)?(?:攻击)?击中对象要害概率增加${NUM}\\s*/\\s*${NUM}$|^使用后${NUM}回合攻击击中对象要害概率增加${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", turns: ns[0], params: { n: ns[1], d: ns[2] } }] }; } },
  { id: "timed-bare-18", re: /^每次直接攻击必定致命(?:一)?击?$|^必定暴击$|^必定致命(?:一)?击$|^攻击必定暴击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  { id: "timed-bare-19", re: /^受到(?:的)?伤害转化为自身体力$|^受到的伤害转化为自身HP$|^(?:使)?受到的伤害恢复自身体力$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  { id: "timed-bare-20", re: new RegExp(`^使自身下${NUM}次(?:攻击|攻击技能)造成的伤害翻倍$|^自身下${NUM}次(?:攻击)?伤害翻倍$|^下${NUM}次攻击造成的伤害翻倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: num(m[1] ?? m[2] ?? m[3]), pct: 100 } }] }) },
  { id: "timed-bare-21", re: /^(?:使|令)?对手无法通过自身技能恢复(?:HP|体力)$|^对手无法恢复(?:自身)?(?:HP|体力)$|^(?:使|令)(?:对手|对方|敌方)无法(?:回复|恢复)体力$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: 100 } }] }) },
  { id: "timed-bare-22", re: new RegExp(`^每回合(对手|对方|敌方|自身|自己)((${STAT_RE})(?:和(?:${STAT_RE}))+)(?:等级)?([+\\-＋－])${NUM}$|^每回合(对手|对方|敌方|自身|自己)((${STAT_RE})(?:和(?:${STAT_RE}))+)(?:提高|提升|降低|减少)${NUM}个等级$|^(对手|对方|敌方|自身|自己)每回合((${STAT_RE})(?:和(?:${STAT_RE}))+)(?:等级)?([+\\-＋－])${NUM}$`), go: (m) => { const c = { atk: 1, def: 2, spa: 3, sdf: 4, spd: 5, acc: 6 }; const who = /对手|对方|敌方/.test(m[1] ?? m[6] ?? m[10]) ? "opponent" : "self"; const names = (m[2] ?? m[7] ?? m[11]).split("和"); const verb = m[8]; const sgn = m[4] ?? m[13]; const d = (sgn === "-" || sgn === "－" || verb === "降低" || verb === "减少" ? -1 : 1) * num(m[5] ?? m[9] ?? m[14]); return { effects: names.map((n) => liftTick({ op: "apply_status", name: "stage_tick", target: who, params: { stat: c[STATS[n]] ?? 6, delta: d } })) }; } },
  { id: "timed-bare-23", re: new RegExp(`^(?:对手|对方|敌方)每回合(${STAT_RE})(?:等级)?-${NUM}$|^每回合(?:对手|对方|敌方)(${STAT_RE})(?:等级)?-${NUM}$|^每回合(?:使|令)(?:对手|对方|敌方)(${STAT_RE})(?:等级)?-${NUM}$|^每回合(?:对手|对方|敌方)(${STAT_RE})(?:等级)?\\+${NUM}$|^每回合(?:自身|自己)(${STAT_RE})(?:等级)?\\+${NUM}$|^每回合提升(${STAT_RE})(?:等级)?\\+?${NUM}$`), go: (m) => { const st = STATS[m[1] ?? m[3] ?? m[5] ?? m[7] ?? m[9] ?? m[11]]; const code = { atk: 1, def: 2, spa: 3, sdf: 4, spd: 5, acc: 6 }[st] ?? 6; const pos = m[7] !== undefined || m[9] !== undefined || m[11] !== undefined; const who = m[9] !== undefined || m[11] !== undefined ? "self" : "opponent"; return { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: who, params: { stat: code, delta: (pos ? 1 : -1) * num(m[2] ?? m[4] ?? m[6] ?? m[8] ?? m[10] ?? m[12]) } })] }; } },
  { id: "timed-bare-24", re: /^(?:自身|自己)?攻击技能?必定打出致命(?:一)?击?$|^本技能必定致命(?:一)?击?$|^必定致命(?:一)?击?$|^必定打出致命(?:一)?击?$|^(?:自身|自己)?攻击必定致命(?:一)?击?$|^(?:自身|自己)?(?:直接)?攻击必定致命(?:一)?击?$/, go: () => ({ attachDamage: { crit: true } }) },
  // 永续必暴（"自身其它攻击技能必定致命一击"——凡该单位出手即暴）
  { id: "timed-bare-25", re: /^(?:自身|自己|其它|其他)攻击技能?必定致命(?:一)?击?$|^其它攻击技能必定致命(?:一)?击$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },

  // 次数制暴击（"自身下N次攻击必定致命一击"→crit_always params.count）
  { id: "timed-bare-26", re: new RegExp(`^(?:使|令)?(?:自身|自己|己方)?下?${NUM}次(?:攻击|攻击技能)?必定(?:打出)?致命(?:一)?击?$|^(?:己方|自身)下${NUM}次(?:攻击|攻击技能)必定(?:打出)?致命(?:一)?击$|^${NUM}次内?攻击必定致命(?:一)?击?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", params: { count: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "timed-bare-27", re: new RegExp(`^使自身下?${NUM}回合(?:攻击|技能)?必定命中$|^(?:使|令)?(?:对手|对方|敌方)无法闪避(?:自身)?(?:的)?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "must_hit", target: "self", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }) },
  { id: "timed-bare-28", re: /^直接攻击必定命中$|^攻击必定命中$|^必定命中$|^必定命中对方$|^必定命中(?:对手|对方|敌方)$|^自身攻击技能必定命中$|^(?:使|令)自身攻击必定命中$/, go: () => ({ flags: { accuracy: "always" } }) },
  { id: "timed-bare-29", re: new RegExp(`^(?:使|令)?(?:自身)下?${NUM}回合(?:攻击|直接攻击)?必定致命(?:一)?击$|^使自身下${NUM}回合必定致命(?:一)?击$|^下${NUM}回合自身攻击必定致命(?:一)?击?$|^下${NUM}回合(?:内)?(?:的)?(?:攻击)?必定致命(?:一)?击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: num(m[1] ?? m[2] ?? m[3] ?? m[4]) }] }) },
  { id: "timed-bare-30", re: /^攻击必定致命(?:一)?击$|^本回合必定致命(?:一)?击$/, go: () => ({ attachDamage: { crit: true } }) },
  { id: "timed-bare-31", re: new RegExp(`^${NUM}%的?(?:几率)?(?:打出|造成)?致命(?:一)?击$|^${NUM}%概率致命一击$`), go: (m) => ({ attachDamage: { critChance: pct(m[1]) } }) },
  // 封印属性招 / PP 归零 / 伤害转回复 / 低伤免疫
  { id: "timed-bare-32", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)(?:下|当)?(${NUM})?回合内?(?:无法使用属性技能|属性技能无效果?|使用的属性技能无效果?|属性技能(?:暂时)?失效)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: m[1] !== undefined ? num(m[1]) : 1, params: { cat: 1 } }] }) },
  { id: "timed-bare-33", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)(?:${NUM})回合内?无法使用(?:属性|攻击)技能$|^(?:${NUM})回合内?无法使用(?:属性|攻击)技能$`), go: (m) => { const n = m[0].match(NUM); return { effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(n[0]), params: { cat: m[0].includes("属性") ? 1 : 4 } }] }; } },
  { id: "timed-bare-34", re: /^(?:使|令)?(?:对手|对方|敌方)?无法使用(属性|攻击)技能$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: m[1] === "属性" ? 1 : 4 } }] }) },
  // 削上限压给下只出场精灵（"减少对方下次出战精灵的最大体力1/2"——动词在前，精灵即目标）
  { id: "timed-bare-35", re: new RegExp(`^(?:减少|降低)(?:对方|对手|敌方)下(?:(?:一|1)?只|次)(?:出战|出场)?精灵(?:的)?最大体力(?:值)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "nextFoe", params: { n: ns[0], d: ns[1] } }] }; } },
  // 裸概率异常（"对手下只出场精灵100%概率冰封"——nextFoe 前缀切出后余部无前缀形态）
  { id: "timed-bare-36", re: new RegExp(`^${NUM}%(?:概率|几率)?(?:使|令)?(?:对手|对方|敌方)?(${AIL_RE})(?:状态)?$`), go: (m) => { const pct = num(m[1]); const ail = m.slice(2).filter((x) => x !== undefined).map((x) => AILMENTS[x]).find(Boolean); return { effects: [{ op: "apply_status", name: ail, target: "opponent", chance: pct }] }; } },
  { id: "timed-bare-37", re: /^(?:对手|对方|敌方)使用的属性技能无效果?$/, go: () => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: 1 } }] }) },
  { id: "timed-bare-38", re: /^(?:使|令)?(?:对手|对方|敌方)(?:的)?其?(?:攻击|属性)?技能无效果$/, go: () => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent" }] }) },
  { id: "timed-bare-39", re: /^(?:使|令)(?:对手|对方|敌方)使用的?(攻击|属性)技能无效果?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: m[1] === "属性" ? 1 : 4 } }] }) },
  { id: "timed-bare-40", re: /^(?:使|令)(?:对手|对方|敌方)(?:下回合|下1回合|当回合|本回合)使用的?(攻击|属性)技能(?:无效果?|失效)$|^(?:对手|对方|敌方)(?:当回合|本回合)(攻击|属性)技能(?:无效果?|失效)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: 1, params: { cat: (m[1] ?? m[2]) === "属性" ? 1 : 4 } }] }) },
  { id: "timed-bare-41", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机${NUM}(?:项|个)技能PP值?归零$|^随机使对手${NUM}(?:项|个)技能PP值?归零$|^使对手随机${NUM}个技能的PP值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2] ?? m[3]), target: "opponent" }] }) },
  { id: "timed-bare-42", re: new RegExp(`^随机吸取(?:对手|对方|敌方)${NUM}项属性([+-])${NUM}(?:并(?:将该属性|该能力值)?附加(?:给|到)(?:自己|自身)(?:身上)?)?$|^随机吸取(?:对手|对方|敌方)${NUM}种能力(?:等级)?([+-])${NUM}$|^随机吸取对手${NUM}项属性-${NUM}(?:并(?:将该属性|该能力值)?附加(?:给|到)(?:自己|自身)(?:身上)?)?$|^随机(?:令|使)(?:对手|对方|敌方)${NUM}项(?:属性|能力值?|能力)(?:等级)?([+-])${NUM}(?:并(?:将该属性|该能力值)?附加(?:给|到)(?:自己|自身)(?:身上)?)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const steal = /吸取|附加/.test(m[0]); return steal ? { effects: [{ op: "transfer_stages", randomCount: ns[0], randomDelta: Math.abs(ns[ns.length - 1]) }] } : { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: ns[0], delta: -Math.abs(ns[ns.length - 1]), target: "opponent" }] }; } },
  // subjectless 随机N项属性+N（"随机2项属性+1"——无主语按自身）
  { id: "timed-bare-43", re: /^随机([0-9]+)项(?:能力值?|属性)(?:等级)?\+([0-9]+)$/, go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[1]), delta: num(m[2]), target: "self" }] }) },
  // "将自身受到的伤害转化为自身体力"（将+自身 变体）
  { id: "timed-bare-44", re: /^将(?:自身|自己)?受到(?:的)?(?:攻击)?伤害转化为自身体力$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  // stat 数字编码（数据缺陷：改变对手5等级-1 → STAT_CODES 映射，UNVERIFIED）
  { id: "timed-bare-45", re: new RegExp(`^(?:${NUM}%)?(?:改变|令|使)(自身|对手|对方|敌方|自己|本方)?([0-5])等级([+-])${NUM}$`), go: (m) => {
    const stat = STAT_CODES[num(m[3])];
    const t = m[2] ? tgt(m[2]) : "self";
    const d = (m[4] === "-" ? -1 : 1) * num(m[5]);
    const fx = stageFx(stat, d, t);
    if (m[1] !== undefined) fx.chance = num(m[1]);
    return { effects: [fx] };
  } },
  // 裸"自身X等级+N"（无动词；STAT_RE 自带内部捕获 → 组号按 NUM 展开数）
  { id: "timed-bare-46", re: new RegExp(`^(自身|自己|对手|对方|敌方)(${STAT_RE}|双攻|双防)等级([+-])(\\d+)$`), go: (m) => {
    const t = tgt(m[1]); const d = (m[3] === "-" ? -1 : 1) * num(m[4]);
    if (m[2] === "双攻") return { effects: [stageFx("atk", d, t), stageFx("spa", d, t)] };
    if (m[2] === "双防") return { effects: [stageFx("def", d, t), stageFx("sdf", d, t)] };
    return { effects: [stageFx(STATS[m[2]], d, t)] };
  } },
  { id: "timed-bare-47", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }) },
  // 随机进入 ailment 列表中的 N 种（"随机进入麻痹或睡眠中的1种"/"中毒、麻痹中的2种"）
  { id: "timed-bare-48", re: new RegExp(`^(?:${NUM}%)?(?:的?(?:概率|几率))?(?:令|使|随机令|随机使)?(?:对手|对方|敌方)?(?:随机)?进入((?:${AIL_RE})(?:[或、，,](?:${AIL_RE}))*)中(?:的)?${NUM}种(?:异常状态|状态)?$|^(?:${NUM}%)?(?:的?(?:概率|几率))?(?:开始后)?随机附加((?:${AIL_RE})(?:[或、，,](?:${AIL_RE}))*)中(?:的)?${NUM}种(?:异常状态|状态)?$`), go: (m) => {
    const pct = m[1] ?? m[4];
    const listSrc = m[2] ?? m[5];
    if (listSrc === undefined) return null;
    const list = [...listSrc.matchAll(new RegExp(AIL_RE, "g"))].map((x) => AILMENTS[x[0]]);
    const e = { op: "apply_status", name: "random", target: "opponent", random: { list, count: num(m[3] ?? m[6]) } };
    if (pct !== undefined) e.chance = num(pct);
    return { effects: [e] };
  } },
  { id: "timed-bare-49", re: new RegExp(`^(?:${AIL_RE})(?:[、或，,]${AIL_RE})*中的${NUM}种(?:异常状态)?$`), go: () => ({ unparsedReason: "ailment-list tail (list head in prior clause)" }) },
  // 定向解除（"解除自身的烧伤"→effect 过滤；"解除自身所处的异常状态"→ailment scope）
  { id: "timed-bare-50", re: new RegExp(`^解除(自身|自己|对手|对方|敌方)(?:的|所处|所处的)?(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "cleanse", target: tgt(m[1]), scope: "ailment", effect: AILMENTS[m[2]] }] }) },
  { id: "timed-bare-51", re: /^解除(?:自身|自己)(?:的|所处|所处的)?(?:所有)?异常状态$|^解除(?:自身|自己)异常状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  { id: "timed-bare-52", re: /^解除(?:自身|自己)(?:所有)?异常状态和(?:自身)?能力下降状态$|^解除(?:自身|自己)异常状态和能力下降状态$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }, { op: "clear_stages", target: "self", sign: "down" }] }) },
  { id: "timed-bare-53", re: new RegExp(`^解除(?:自身|自己)能力下降状态并回复${NUM}\\s*/\\s*${NUM}体力$|^解除自身弱化并回复${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }, { op: "heal", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]), target: "self" }] }) },
  { id: "timed-bare-54", re: /^下回合受到的伤害转化为自身体力$|^受到伤害转化为(?:自身)?体力$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", turns: 1 }] }) },
  { id: "timed-bare-55", re: new RegExp(`^免疫低于${NUM}的?(?:攻击)?伤害$|^免疫${NUM}点以下的伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_floor", target: "self", params: { min: num(m[1] ?? m[2]) } }] }) },
  { id: "timed-bare-56", re: new RegExp(`^下?${NUM}回合(?:内)?(?:自身)?造成的伤害(?:提升|提高)${NUM}%$|^下回合造成的伤害提高${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", turns: m[1] !== undefined ? num(m[1]) : 1, params: { pct: num(m[2] ?? m[3]) } }] }) },
  { id: "timed-bare-57", re: new RegExp(`^(?:对手|对方|敌方)处于异常状态时固定伤害翻倍$`), go: () => ({ attachDamage: { flatMulIf: { when: { foeStatused: true }, numerator: 2, denominator: 1 } } }) },
];
