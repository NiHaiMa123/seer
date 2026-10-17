// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, AILMENTS, AIL_RE, stageFx, tgt, ALL_STATS } from "./lex.mjs";
import { parseEffectText, reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5c 批 ──
  // 数字前缀可能已被解析层的 bcm 阶段剥成 dynChance，送进来的 part 形如
  // "使对手所有攻击miss"；也可能整句未剥（"50%使对手所有攻击miss"）。
  // 两种都要认，数字缺省时 chance 由 dynChance 注入（见 op 注入处）。
  // 原先要求「数字 + 概率」齐全，导致该句落到 attach-damage-69 的
  // miss-reactive 兜底、must_miss 整条丢失（golden 3015 回归）。
  { id: "batch-e5c-01", re: new RegExp(`^(?:(\\d+)(?:%的?)?(?:概率|几率|机率)?)?(?:令|使|让)(?:对手|对方|敌方)所有攻击(?:必定)?(?:MISS|Miss|miss|未命中)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "must_miss", target: "self", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  { id: "batch-e5c-02", re: /^不受伤害$|^自身不受伤害$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }) },
  { id: "batch-e5c-03", re: /^若对手先手技能则(\d+)%?(.+)$|^若对手使用先手技能则(\d+)%?(.+)$/, go: (m) => reactWrap(3, { prioMin: 1, chance: num(m[1] ?? m[3]) }, `对手${(m[2] ?? m[4]).trim()}`) },
  { id: "batch-e5c-04", re: /^将自身相应的能力提升赋予给对手相应的能力下降$|^将自身的能力提升赋予给对手的能力下降$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "upToDown" }] }) },
  { id: "batch-e5c-05", re: new RegExp(`^每回合被攻击所收(?:到|受)的伤害不超过(\\d+)$|^每回合被攻击所受伤害不超过(\\d+)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  { id: "batch-e5c-06", re: /^技能无效时[，,]?(.+)$/, go: (m) => { const sub = parseEffectText(m[1]); if (sub.effects.length === 0) return { unparsedReason: `nullify payload unparsed: ${m[1]}` }; return { effects: sub.effects.map((e) => ({ ...e, nullifyOnly: true })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) }; } },
  { id: "batch-e5c-07", re: /^技能无效时$/, go: () => ({ unparsedReason: "nullify-trigger orphan" }) },
  // "自身(下次)被击败后下一只出场的精灵X" → trigger 5 自身倒下反应式，payload 内层经 nxs 落 nextAlly
  { id: "batch-e5c-07a", re: /^(?:若)?(?:自身|自己)(?:下次|下一次)?被击败后[，,]?(.+)$/, go: (m) => reactWrap(5, {}, m[1]) },
  { id: "batch-e5c-08", re: /下一只出战精灵|下一只出场|下一个出场精灵|下一个出战精灵/, go: () => ({ unparsedReason: "next-unit target — deferred batch" }) },
  // "对手无法使用自身能力提升状态"（batch-e5c-09 的动词表不含「使用」）。放在 batch-e5c-09 前面。
  { id: "p1-e5c-01", re: /^(?:对手|对方|敌方)无法(?:使用|获得|出现)(?:自身|自己)?(?:的)?能力(?:提升|强化)(?:状态|效果)$/, go: () => ({ effects: [{ op: "apply_status", name: "no_stage_up", target: "opponent" }] }) },
  { id: "batch-e5c-09", re: /^对手无法使自身能力(?:出现)?提升(?:状态)?$|^(?:对手|对方|敌方)无法(?:使)?(?:自身|自己)?强化(?:自己)?$|^(?:对手|对方|敌方)无法(?:使自身)?能力(?:出现)?提升$|^令(?:对手|对方)无法提升能力$|^使(?:对手|对方)无法提升能力$/, go: () => ({ effects: [{ op: "apply_status", name: "no_stage_up", target: "opponent" }] }) },
  // "对方用的属性技能无效果"（batch-e5c-10 无「用的」且尾词只收「无效(果)」）。放在 batch-e5c-10 前面。
  { id: "p1-e5c-03", re: /^(?:对手|对方|敌方)(?:用的?)?(?:属性|攻击)技能无效(?:果)?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: /攻击/.test(m[0]) ? 4 : 1 } }] }) },
  { id: "batch-e5c-10", re: new RegExp(`^对手使用(?:的)?(?:属性|攻击)技能无效(?:果)?$|^(?:对手|对方)(?:属性|攻击)技能无效(?:果)?$|^使对手(?:属性|攻击)技能无效(?:果)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: /攻击/.test(m[0]) ? 4 : 1 } }] }) },
  // "直接攻击附带80%烧伤"（"附带"+裸概率，省「令对手」）。放在 batch-e5c-11a 前面，那条要求「直接攻击N%令」。
  { id: "batch-e5c-10b", re: new RegExp(`^(?:直接)?攻击附带${NUM}%(?:的?(?:几|概)?率)?(?:令|使|让)?(?:对手|对方|敌方)?(${AIL_RE})(?:状态)?$`), go: (m) => ({ attachDamage: { ailmentOnHit: { name: AILMENTS[m[2]], pct: num(m[1]) } } }) },
  // "直接攻击50%令对手冻伤"。放在 batch-e5c-11 前面，那条要「每次攻击」或「攻击有」。
  { id: "batch-e5c-11a", re: new RegExp(`^直接攻击${NUM}%令(?:对手|对方|敌方)(${AIL_RE})$`), go: (m) => ({ attachDamage: { ailmentOnHit: { name: AILMENTS[m[2]], pct: num(m[1]) } } }) },
  { id: "batch-e5c-11", re: new RegExp(`^每次攻击都有${NUM}%(?:几率)?令对手(${AIL_RE})$|^每次攻击${NUM}%令对手(${AIL_RE})$|^(?:令|使|让)?自身攻击有${NUM}%(?:的?(?:概率|几率))?使(?:对手|对方|敌方)(${AIL_RE})$|^攻击有${NUM}%(?:的?概率)?使(?:对手|对方)(${AIL_RE})$|^攻击(?:时)?有${NUM}%(?:的?(?:概率|几率))?使对手(${AIL_RE})$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined); const pct = num(ns.find((x) => typeof x === "string" && /^\d+$/.test(x)) ?? "50"); const ail = ns.map((x) => AILMENTS[x]).find(Boolean); return { attachDamage: { ailmentOnHit: { name: ail, pct } } }; } },
  // 阈值固伤/损失阶梯/承伤翻倍/随机异常计数
  { id: "batch-e5c-12", re: new RegExp(`^随机附加(\\d+)[-~—至到](\\d+)点固伤$|^随机附加(\\d+)[-~—至到](\\d+)点固定伤害$`), go: (m) => ({ attachDamage: { flatRange: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }) },
  // "直接造成100点固定伤害"（"直接"领起形）。放在 batch-e5c-13 前面，那条动词后不得带「直接」。
  { id: "batch-e5c-13a", re: new RegExp(`^直接造成(\\d+)点(?:固定|固伤)伤害$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  { id: "batch-e5c-13", re: new RegExp(`^给(?:对手|对方|敌方)造成(\\d+)点(?:固定|固伤)?伤害$|^造成(\\d+)点(?:固定|固伤)?伤害$|^固定伤害提高(\\d+)点$|^固定伤害提升(\\d+)点$`), go: (m) => ({ attachDamage: { flatBonus: num(m[1] ?? m[2] ?? m[3] ?? m[4]) } }) },
  { id: "batch-e5c-14", re: new RegExp(`^每损失(\\d+)点体力(?:则)?额外附加(\\d+)点(?:固定)?伤害$|^每损失(\\d+)点体力附加(\\d+)点固伤$`), go: (m) => ({ attachDamage: { flatPerMissing: { step: num(m[1] ?? m[3]), add: num(m[2] ?? m[4]) } } }) },
  { id: "batch-e5c-15", re: new RegExp(`^(?:对手|对方|敌方)(?:下${NUM}回合|下回合)受到的伤害翻倍$|^(?:使|令)(?:对手|对方|敌方)${NUM}回合内?受到的伤害翻倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: num(m[1] ?? m[2] ?? "1"), params: { pct: 100 } }] }) },
  // "随机进入N-M种异常状态"——抽取数区间（countRange 先抽数量再逐项抽取）
  { id: "batch-e5c-16", re: new RegExp(`^(?:(\\d+)%(?:的?(?:几|概)?率)?)?(?:使|令)?(?:对手|对方|敌方)?随机进入${NUM}\\s*[~～-]\\s*${NUM}种(?:异常)?状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: Object.values(AILMENTS), count: num(m[2]), countRange: { min: num(m[2]), max: num(m[3]) } }, ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  { id: "batch-e5c-17", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)随机进入${NUM}种异常状态$|^随机(?:使|令)?(?:对手|对方|敌方)?进入${NUM}种异常状态$|^${NUM}%(?:的?(?:几|概)?率)?随机进入${NUM}种(?:异常)?状态$|^(?:对手|对方|敌方)${NUM}%?(?:的?(?:几|概)?率)?随机进入${NUM}种(?:异常)?状态$`), go: (m) => { const pct = m[3] !== undefined ? num(m[3]) : m[5] !== undefined ? num(m[5]) : undefined; return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: Object.values(AILMENTS), count: num(m[1] ?? m[2] ?? m[4] ?? m[6]) }, ...(pct !== undefined ? { chance: pct } : {}) }] }; } },
  { id: "batch-e5c-18", re: /^消除(?:对方|对手|敌方)强化等级$|^消除(?:对方|对手|敌方)的?强化(?:状态)?$|^消强$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // 无符号多维（"50%改变自身防御、特防等级2"→+2 各维）
  { id: "batch-e5c-19", re: new RegExp(`^${NUM}%(?:的?几?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)((?:(?:${STAT_RE})、?)+)(?:等级)?${NUM}$`), go: (m) => {
    const t = tgt(m[2]); const c = num(m[1]);
    const stats = [...m[3].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]);
    const ns = m.slice(4).filter((x) => x !== undefined).map(num);
    return { effects: stats.map((st) => stageFx(st, ns[ns.length - 1] ?? 1, t, c)) };
  } },
  // 伤害阈值→次数免疫（"造成的伤害高于N则免疫下M次受到的异常状态"）
  { id: "batch-e5c-20", re: new RegExp(`^造成的伤害高于(\\d+)则免疫下(\\d+)次受到的异常状态$|^伤害超过(\\d+)则免疫下(\\d+)次异常状态$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[2] ?? m[4]) }, if: { prevDamageAboveAbs: num(m[1] ?? m[3]) } }] }) },
  // "并" 切分碎片收尾（免疫/反弹/扣除/进入 宾语在上半句）
  { id: "batch-e5c-21", re: /^反弹异常状态$|^反弹(?:所有)?异常状态$|^反弹除\S{2}外所有受到的异常状态$|^反弹所有受到的异常状态$|^反弹异常$/, go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  { id: "batch-e5c-22", re: /^免疫异常状态$|^免疫所有异常状态$|^免疫(?:对手|对方|敌方)异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // "令自身免疫下1次受到的异常状态"（令/使 前缀 + 下N次 计数 + 受到的 变体）
  { id: "batch-e5c-23", re: new RegExp(`^(?:令|使|让)(?:自身|自己)免疫下${NUM}次(?:受到|遭受)?的?(?:异常|异常状态|对手的攻击|攻击伤害|攻击)$|^(?:令|使|让)(?:自身|自己)免疫下次(?:受到|遭受)的(?:攻击|攻击伤害)$`), go: (m) => { const isAtk = /攻击/.test(m[0]); return { effects: [{ op: "apply_status", name: isAtk ? "dmg_immune" : "immune_status", target: "self", params: { count: num(m[1] ?? "1") } }] }; } },
  { id: "batch-e5c-24", re: /^直接扣除对手等量体力$|^扣除对手等量体力$|^扣除对方等量体力$/, go: () => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: 1 } }] }) },
  // "对手N%进入<异常>状态"（换入触发 payload 与直连——进入 定向变体）
  { id: "batch-e5c-25", re: new RegExp(`^(?:令|使|让)?(?:对手|对方|敌方)(${NUM})%?(?:的?(?:几|概)?率)?进入(${AIL_RE})(?:状态)?$`), go: (m) => { const ail = m.slice(1).find((x) => x !== undefined && AILMENTS[x] !== undefined); const pct = m.slice(1).find((x) => x !== undefined && /^[\d一二两三四五六七八九十]+$/.test(x)); return { effects: [{ op: "apply_status", name: AILMENTS[ail], target: "opponent", ...(pct !== undefined ? { chance: num(pct) } : {}) }] }; } },
  { id: "batch-e5c-26", re: new RegExp(`^(?:同时)?进入${NUM}回合(${AIL_RE})(?:状态)?$|^(?:自身|自己)?进入(${AIL_RE})(?:状态)?$`), go: (m) => {
    const ail = m[2] ?? m[3]; const turns = m[1];
    return { effects: [{ op: "apply_status", name: AILMENTS[ail], target: "self", ...(turns !== undefined ? { turns: num(turns) } : {}) }] };
  } },
  { id: "batch-e5c-27", re: /^免疫$|^自身免疫$|^自身免疫异常$|^自身免疫(?:所有)?异常状态$|^免疫(?:所有)?异常$|^技能无法附加异常状态$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  { id: "batch-e5c-28", re: /^免疫(?:对手|对方|敌方)下?次(?:攻击|攻击技能)?(?:技能)?(?:造成的)?伤害$|^免疫(?:对手|对方|敌方)(?:的)?下?一?次攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }] }) },
  { id: "batch-e5c-29", re: /^消除(?:敌我双方|双方|敌我)(?:的)?回合类效果$|^消除双方回合类效果$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "timed" }, { op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // 敌我双侧目标（"令敌我双方全属性-1" / "敌我双方同时进入沉默状态"→self+opponent 各一份）
  { id: "batch-e5c-30", re: new RegExp(`^(?:令|使|让)?敌我双方全属性([+-])${NUM}$`), go: (m) => { const s = m[1] === "-" ? -1 : 1; return { effects: ["self", "opponent"].flatMap((t) => ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: s * num(m[2]), target: t }))) }; } },
  { id: "batch-e5c-31", re: new RegExp(`^(?:令|使|让)?敌我双方(?:同时)?进入(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "self" }, { op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }) },
  { id: "batch-e5c-32", re: new RegExp(`^(?:令|使|让)?敌我双方(?:同时)?进入${NUM}回合(${AIL_RE})(?:状态)?$|^(?:令|使|让)?敌我双方(?:同时)?${NUM}回合(${AIL_RE})(?:状态)?$`), go: (m) => { const t = num(m[1] ?? m[3]); const k = m[2] ?? m[4]; return { effects: [{ op: "apply_status", name: k, target: "self", turns: t }, { op: "apply_status", name: k, target: "opponent", turns: t }] }; } },
  { id: "batch-e5c-33", re: /^无视对手护盾(?:效果)?$|^无视对手护盾$|^并无视对手护盾效果$/, go: () => ({ attachDamage: { pierce: true } }) },
  { id: "batch-e5c-34", re: /^吸取$|^吸收$/, go: () => ({ unparsedReason: "bare drain verb — pair with prior clause" }) },
  // 定值回血补充变体（"恢复100点体力值"）
  { id: "batch-e5c-35", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(\\d+)点体力值?$|^恢复(\\d+)点(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "self" }] }) },
  // 额外定值吸取（"额外吸取N点体力"/"吸取50点体力"——一次性固定伤害+等额回血，同 ~300 行模式）
  { id: "batch-e5c-36", re: new RegExp(`^(?:额外)?(?:吸取|吸收)(?:对手|对方|敌方)?(\\d+|${NUM})点(?:体力|HP)$`), go: (m) => { const n = num(m[1] ?? m[2]); return { effects: [{ op: "damage", kind: "fixed", power: n }, { op: "heal", flat: n, target: "self" }] }; } },
  // "随机自身3属性+1"（随机+自身+属性 无量词省字形）。放在 batch-e5c-37 前面，那条量词在「随机」之后。
  { id: "batch-e5c-37a", re: new RegExp(`^随机(对手|对方|敌方|自身|自己)${NUM}(?:项|种)?(?:能力值?|属性)([+\\-＋－])${NUM}$`), go: (m) => { const who = /对手|对方|敌方/.test(m[1]) ? "opponent" : "self"; return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: num(m[2]), delta: (m[3] === "-" || m[3] === "－" ? -1 : 1) * num(m[4]), target: who }] }; } },
  // 随机项 stage（"对手随机2项能力值-1"/"令自身随机2项属性+1"→stat:"random"+randomCount）
  { id: "batch-e5c-37", re: new RegExp(`^(?:令|使|让)?(对手|对方|敌方|自身|自己)(?:的)?随机${NUM}(?:项|种)(?:能力值?|属性)([+\\-＋－])${NUM}$|^随机(?:令|使|让)(对手|对方|敌方|自身|自己)${NUM}(?:项|种)(?:能力值?|属性)([+\\-＋－])${NUM}$`), go: (m) => { const who = /对手|对方|敌方/.test(m[1] ?? m[5]) ? "opponent" : "self"; const cnt = num(m[2] ?? m[6]); const sgn = (m[3] ?? m[7]) === "-" || (m[3] ?? m[7]) === "－" ? -1 : 1; const d = sgn * num(m[4] ?? m[8]); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: cnt, delta: d, target: who }] }; } },
  // 孤儿触发器扩展（"若下回合受到攻击"/"若被对方击败"——payload 被切散，dynTrigger 注入后续 part）
  { id: "batch-e5c-38", re: /^若?下回合受到攻击$/, go: () => ({ dynTriggerPart: { trigger: 1 } }) },
  { id: "batch-e5c-39", re: /^受到物理?(?:攻击|攻击伤害)(?:时|则)?$|^受到物攻(?:时|则|伤害)?$/, go: () => ({ dynTriggerPart: { trigger: 1, cat: 2 } }) },
  { id: "batch-e5c-40", re: /^自身受到攻击(?:时|则)?$|^若自身受到攻击$/, go: () => ({ dynTriggerPart: { trigger: 1 } }) },
  { id: "batch-e5c-41", re: /^若?被(?:对方|对手|敌方|对方精灵)击败$/, go: () => ({ dynTriggerPart: { trigger: 5 } }) },
  // "若对手造成的伤害低于N" 孤儿（则臂被切散）→ trigger1 max 门控
  { id: "batch-e5c-42", re: new RegExp(`^若?(?:对手|对方|敌方)造成的伤害(?:若)?低于${NUM}(?:点)?$`), go: (m) => ({ dynTriggerPart: { trigger: 1, max: num(m[1]) } }) },
  // 换入孤儿触发器（"对手主动切换精灵时"/"对手下N次主动切换或死亡切换精灵时"——payload 被切散）
  { id: "batch-e5c-43", re: /^对手主动切换精灵(?:则|时)$/, go: () => ({ dynTriggerPart: { trigger: 9 } }) },
  { id: "batch-e5c-44", re: new RegExp(`^对手下${NUM}次主动切换或死亡切换精灵时$|^对手下${NUM}次切换精灵时$`), go: (m) => ({ dynTriggerPart: { trigger: 9, count: num(m[1] ?? m[2]) } }) },
  // 低血直接回满（"若当前体力低于N则直接回满"）
  { id: "batch-e5c-45", re: new RegExp(`^若?(?:当前|自身)?体力(?:低于|小于|不足)(\\d+|${NUM})(?:点)?则?(?:直接)?回满$|^若当前体力低于${NUM}则直接回满$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", if: { selfHpBelowAbs: ns[0] } }] }; } },
  // 反伤窗口（"将下次受到的伤害N%反馈给对手"→reflect_dmg count:1）
  // "将下一次受到的伤害100%反馈给对手"（batch-e5c-46 的签名只收「下次」）。放在 batch-e5c-46 前面。
  { id: "p1-e5c-02", re: new RegExp(`^将下(?:一|1)次受到的伤害${NUM}%(?:反馈|反弹|返回)给(?:对手|对方|敌方)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100, count: 1 } }] }) },
  { id: "batch-e5c-46", re: new RegExp(`^将下次受到的伤害${NUM}%(?:反馈|反弹|返回)给(?:对手|对方|敌方)$|^下次受到的伤害${NUM}%(?:反馈|反弹)给对手$`), go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100, count: 1 } }] }) },
  // 回合边界孤儿（"回合开始时"——时点修饰无语义）
  { id: "batch-e5c-47", re: /^回合开始时$|^回合结束时$|^出手前$/, go: () => ({ ignored: true }) },
  // 裸对手固伤（"对手受到N点固定伤害"→fixed damage）
  { id: "batch-e5c-48", re: new RegExp(`^(?:令|使|让)?(?:对手|对方|敌方)受到(\\d+|${NUM})点固定伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // 条件全额吸血（"对手处于任意异常状态时造成的伤害将全额恢复体力"→drainIf 1/1）
  { id: "batch-e5c-49", re: /^(?:对手|对方|敌方)处于(?:任意)?异常状态时(?:自身)?造成的伤害(?:将|会)?全额恢复(?:自身)?体力$/, go: () => ({ attachDamage: { drainIf: { when: { foeStatused: true }, numerator: 1, denominator: 1 } } }) },
  // 双倍吸强（"双倍吸取对手能力提升状态"→transfer mul:2）
  { id: "batch-e5c-50", re: /^(双倍|两倍)(?:吸取|吸收|偷取|转移)(?:对手|对方|敌方)?(?:的)?能力(?:提升|强化|上升)状态(?:双倍)?(?:转移?到(?:自己|自身)身上?)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", mul: { numerator: 2, denominator: 1 } }] }) },
  // "并双倍转移到自己身上" 尾句（并-切分残片——接续吸取的双倍传导）
  { id: "batch-e5c-51", re: /^双倍转移?到(?:自己|自身)身上?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", mul: { numerator: 2, denominator: 1 } }] }) },
  // 先手威力倍率（"先手威力2倍"→scaleIf order:first）
  { id: "batch-e5c-52", re: new RegExp(`^先手(?:时)?威力(?:为)?${NUM}倍$|^先出手(?:时)?威力${NUM}倍$`), go: (m) => ({ attachDamage: { scaleIf: { when: { order: "first" }, numerator: num(m[1] ?? m[2]), denominator: 1 } } }) },
  // 每回合计定值回血变体（"每回合恢复100点固定体力"）
  { id: "batch-e5c-53", re: new RegExp(`^每回合(?:恢复|回复)(\\d+|${NUM})点固定体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 封印/失效窗口补充变体
  { id: "batch-e5c-54", re: new RegExp(`^${NUM}回合内?(?:令|使|让)(?:对手|对方|敌方)(?:使用的)?属性技能无效$|^令对手${NUM}回合内?属性技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1] ?? m[2]), params: { cat: 1 } }] }) },
  { id: "batch-e5c-55", re: new RegExp(`^(?:下|令|使)?${NUM}?回合内?(?:自身)?造成的(?:攻击)?伤害翻倍$|^下${NUM}回合(?:内)?(?:攻击)?伤害翻倍$|^(?:自身)?造成的攻击伤害翻倍$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_mul", target: "self", turns: num(m[1] ?? m[2] ?? "1"), params: { mul: 2 } }] }) },
  { id: "batch-e5c-56", re: /^(?:令|使|让)(?:对手|对方|敌方)(?:使用的)?(属性|攻击)技能无效果?$|^(?:对手|对方|敌方)(属性|攻击)技能无效果?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: (m[1] ?? m[2]) === "属性" ? 1 : 4 } }] }) },
  { id: "batch-e5c-57", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)下?${NUM}次技能无效果?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1]) } }] }) },
  { id: "batch-e5c-58", re: new RegExp(`^(?:使|令)(?:对方|对手|敌方)攻击伤害是正常状态下的?${NUM}\\s*/\\s*${NUM}$|^攻击伤害是正常状态的?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  { id: "batch-e5c-59", re: new RegExp(`^(?:自身)?攻击伤害是正常状态下的(\\d+)倍$|^攻击伤害变为?正常(?:状态)?的(\\d+)倍$`), go: (m) => ({ attachDamage: { mul: { numerator: num(m[1] ?? m[2]), denominator: 1 } } }) },
  // 次数制固伤窗口（"下N次攻击附加M点固定伤害"）
  { id: "batch-e5c-60", re: new RegExp(`^(?:自身)?下?${NUM}次(?:攻击|攻击技能)?(?:额外)?附加(\\d+)点(?:固定)?伤害$|^下${NUM}次攻击附加(\\d+)点(?:固定|固伤)$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: ns[ns.length - 1], count: ns[0] } }] }; } },
  // 命中回血（"每次攻击恢复自身体力的1/3"）
  // "每次攻击恢复自身1/4体力"（batch-e5c-61 的分数分支要求「体力的/最大」）。放在 batch-e5c-61 前面。
  { id: "p1-e5c-04", re: new RegExp(`^每次(?:攻击|直接攻击)(?:恢复|回复)(?:自身|自己)?${NUM}\s*/\s*${NUM}(?:的)?(?:最大)?体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { healOnHit: { numerator: ns[0], denominator: ns[1] } } }; } },
  { id: "batch-e5c-61", re: new RegExp(`^每次(?:攻击|直接攻击)(?:恢复|回复)(?:自身|自己)?(?:最大)?体力的${NUM}\\s*/\\s*${NUM}$|^每次攻击(?:恢复|回复)${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { healOnHit: { numerator: ns[0], denominator: ns[1] } } }; } },
  { id: "batch-e5c-62", re: new RegExp(`^每回合受到(\\d+)点(?:固定)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "self", params: { flat: num(m[1]) } }] }) },
  // 概率DoT窗口（"15%概率令对手在3回合内每回合受到30点固定伤害"）——chance 门控 dot_field
  { id: "batch-e5c-63", re: new RegExp(`^${NUM}%?(?:的?(?:概|几)率)?(?:令|使|让)(?:对手|对方|敌方)在${NUM}回合内?(?:，|,)?每回合受[到收](\\d+)点(?:固定|固伤)?伤害$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dot_field", target: "opponent", turns: ns[1], params: { flat: ns[2] }, chance: ns[0] }] }; } },
  { id: "batch-e5c-64", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)在${NUM}回合内?(?:，|,)?每回合受[到收](\\d+)点(?:固定|固伤)?(?:伤害)?$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "dot_field", target: "opponent", turns: ns[0], params: { flat: ns[1] } }] }; } },
  { id: "batch-e5c-65", re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)每回合受到(\\d+)点(?:固定)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // 减疗窗口（"对手恢复体力时恢复效果减少N%"——压给对手）
  { id: "batch-e5c-66", re: new RegExp(`^(?:对手|对方|敌方)(?:恢复体力时)?(?:的)?恢复效果减少${NUM}%$|^使(?:对手|对方|敌方)恢复效果(?:减少|降低)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // 随机 PP 归零主语前置变体
  { id: "batch-e5c-67", re: new RegExp(`^(?:对手|对方|敌方)随机${NUM}(?:项|个)(?:的)?技能PP值?归零$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  { id: "batch-e5c-68", re: new RegExp(`^随机${NUM}(?:项|个)(?:的)?技能PP值?[归清][零0]$|^随机${NUM}项技能PP值?归0$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "获得等量的护盾、护罩"——承伤转盾窗（"受到真实伤害后获得等量的护盾"→dmg_to_shield）
  { id: "batch-e5c-69", re: /^获得等量的(?:护盾|护罩)(?:值)?(?:、|，|,)?(?:护罩|护盾)?(?:值)?$|^获得等同于伤害的护盾$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_shield", target: "self" }] }) },
  // endure / 高伤免疫 / 固伤减免 / 概率闪避 / dmg_out_pct 定时窗口
  { id: "batch-e5c-70", re: new RegExp(`^受到致命伤害时残留(\\d+)点体力$|^(?:受到|遭)致死攻击时余下(\\d+)点体力$|^受到致死伤害时保留(\\d+)点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  { id: "batch-e5c-71", re: new RegExp(`^免疫大于(\\d+)(?:点)?的攻击伤害$|^免疫(?:超过|高于)(\\d+)(?:点)?的攻击伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune_above", target: "self", params: { max: num(m[1] ?? m[2]) } }] }) },
  { id: "batch-e5c-72", re: new RegExp(`^(?:自身|自己)?受到的固定伤害和百分比伤害减少${NUM}%$|^(?:对手|对方|敌方)造成的固定伤害和百分比伤害减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "flat_taken_pct", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  { id: "batch-e5c-73", re: new RegExp(`^(?:有)?${NUM}%的?几率回避对手攻击?$|^回避对手攻击$|^${NUM}%几率回避对手攻击?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2] ?? m[3] ?? "100") } }] }) },
  { id: "batch-e5c-74", re: new RegExp(`^(?:恢复|回复)${NUM}\\s*/\\s*${NUM}(?:点)?(?:HP|体力|体力值)$|^(?:恢复|回复)自身${NUM}\\s*/\\s*${NUM}(?:HP|体力)$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]), target: "self" }] }) },
  { id: "batch-e5c-75", re: new RegExp(`^(?:自身)?下${NUM}回合(?:内)?(?:自身)?造成的伤害(?:提高|提升)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", turns: num(m[1]), params: { pct: num(m[2]) } }] }) },
  // 每回合承伤固伤附加（"每回合都能附加N点固定伤害"→dmg_flat 窗口）
  { id: "batch-e5c-76", re: new RegExp(`^每回合都能附加(\\d+)点(?:固定)?伤害$|^都能附加(\\d+)点(?:固定)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // 损伤反馈吸取（"给予对方损伤的1/4会回复自己的HP"——已由前部合并规则覆盖）
  // 造成值百分比固伤（"附加所造成伤害值N%的固定伤害"）
  { id: "batch-e5c-77", re: new RegExp(`^附加所?造成伤害值?的?${NUM}%的?(?:固定)?伤害$|^附加本次攻击造成伤害的${NUM}%固定伤害$`), go: (m) => ({ attachDamage: { flatEcho: { pct: num(m[1] ?? m[2]) } } }) },
];
