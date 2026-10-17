// batch-e44：残留清晰句式收尾批
//   1. `恢复自身N/M体力值` 值后缀 / `回复自身N-M点体力` 区间回复
//   2. `消除自身能力提升状态` / `清除对方能力提升的效果` / `将对手的强化效果转移到自身`
//   3. `将自身当前体力降低为N` / `使己方下N回合攻击必定致命`
//   4. `体力恢复效果减少N%`（裸形，foeCtx 翻转目标）
//   5. `将自身下N次受到的固定伤害和百分比伤害转化为等量护罩`（dmg_to_shield+kindMask）
//   6. `随机进入X、Y、Z其中N种异常状态` 枚举池 / `每回合降低对手最大HP分数` tick
//   7. `连续使用每次提高N%几率，最多提高M%` → chancePerUse+cap
import { NUM, num, frac, AILMENTS } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";

export const rules = [
  // ── 分数恢复"值"后缀（"恢复自身1/3体力值"）──
  { id: "e44-01", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:的)?${NUM}\/${NUM}(?:的)?(?:体力|体力值|HP)$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  // ── 区间回复（"回复自身100-200点体力" / "随机回复100~200点HP"）──
  { id: "e44-02", re: new RegExp(`^(?:随机)?(?:回复|恢复)(?:自身|自己)?(?:的)?${NUM}\\s*[~～\\-—]\\s*${NUM}点?(?:HP|体力|体力值)?$`), go: (m) => ({ effects: [{ op: "heal", flatRange: { min: num(m[1]), max: num(m[2]) }, target: "self" }] }) },
  // ── 消除自身强化 / 清除对方强化 ──
  { id: "e44-03", re: /^(?:消除|清除|解除)(?:自身|自己|己方)(?:的)?能力(?:提升|强化)(?:的)?(?:状态|效果)$/, go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "up" }] }) },
  { id: "e44-04", re: /^(?:消除|清除|解除)(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)(?:的)?(?:状态|效果)$/, go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // ── 强化转移至自身（"将对手的能力强化效果转移到自己身上"）──
  // "对方能力强化转移给自己"（无介词领起形）。放在 e44-05 前面，那条要求句首「将/把/使/令」。
  { id: "e44-04b", re: /^(?:对手|对方|敌方)能力(?:强化|提升)(?:的)?(?:状态|效果)?(?:转移|转嫁|转交)(?:到|至|给)(?:自身|自己|己方)(?:身上|上)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  { id: "e44-05", re: /^(?:将|把|使|令)(?:对手|对方|敌方)(?:的)?能力(?:强化|提升)(?:的)?(?:状态|效果)(?:转移|转嫁|转交)(?:到|至|给)?(?:自身|自己|己方)(?:身上|上)?$|^(?:转移|夺取)(?:对手|对方|敌方)(?:的)?能力(?:强化|提升)(?:的)?(?:状态|效果)(?:至|到)(?:自身|自己)(?:身上)?$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  // ── 自身体力压为N（"将自身当前体力降低为1"）──
  { id: "e44-06", re: new RegExp(`^(?:将|把|使|令)(?:自身|自己)(?:的)?(?:当前)?体力(?:降低|降|压|变)为${NUM}(?:点)?(?:体力)?$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "self", leaveHp: num(m[1]) }] }) },
  // ── 己方下N回合必定致命 ──
  { id: "e44-07", re: new RegExp(`^(?:使|令)(?:己方|自身|自己|我方)下${NUM}回合(?:攻击|攻击技能)?(?:必定|必然|一定)(?:致命|暴击)$|^使己方下回合攻击必定致命$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: m[1] !== undefined ? num(m[1]) : 1 }] }) },
  // ── 恢复效果削减裸形（foeCtx 下"对手N回合内体力恢复效果减少N%"——turns 前缀已剥，此处按自身发出、foeCtx 翻转）──
  { id: "e44-08", re: new RegExp(`^(?:所有)?(?:体力)?(?:恢复|回复|治疗)(?:的)?效果减少${NUM}%$|^(?:所有)?体力恢复减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "self", params: { pct: num(m[1]) } }] }) },
  // ── 下N次固定+百分比伤害转护罩（kindMask=3）──
  { id: "e44-09", re: new RegExp(`^(?:将|把|使|令)?(?:自身|自己)?下${NUM}次受到的(?:固定伤害和|固定伤害、|固定与)?百分比伤害(?:全部)?转化为等量的?(?:护罩|护盾)$|^受到的固定伤害和百分比伤害转化为等量的?(?:护罩|护盾)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_shield", target: "self", params: { count: m[1] !== undefined ? num(m[1]) : 1, kindMask: 3 } }] }) },
  // ── 枚举异常池（"随机进入烧伤、冻伤、中毒、害怕、疲惫、麻痹其中1种异常状态"）──
  { id: "e44-10", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)?随机进入((?:${Object.keys(AILMENTS).join("|")})(?:、|，|,|或)(?:${Object.keys(AILMENTS).join("|")})(?:(?:、|，|,|或)(?:${Object.keys(AILMENTS).join("|")}))*)其中${NUM}种(?:异常)?状态$`), go: (m) => { const list = m[1].split(/、|，|,|或/).map((x) => AILMENTS[x]).filter(Boolean); return list.length >= 2 ? { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: num(m[2]) } }] } : null; } },
  // ── 每回合降低对手最大HP分数（"每回合降低对手最大HP的1/4"——dynChance 由外层注入）──
  { id: "e44-11", re: new RegExp(`^降低(?:对手|对方|敌方)(?:的)?最大(?:HP|体力)(?:值)?的?${NUM}\/${NUM}$|^使(?:对手|对方|敌方)最大(?:HP|体力)降低${NUM}\/${NUM}$`), go: (m) => { const n = num(m[1] ?? m[3]), d = num(m[2] ?? m[4]); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n, d } }] }; } },
  // ── 每次使用提高几率+上限（"连续使用每次提高10%几率，最多提高40%"→chancePerUse/cap 挂本句 chance 宿主）──
  { id: "e44-12", re: new RegExp(`^连续使用每次(?:提高|增加|提升)${NUM}%(?:的)?(?:几率|概率|命中率)?，?(?:最多|最高)(?:提高|增加|提升|至|到)?${NUM}%$|^每次使用(?:提高|增加)${NUM}%(?:的)?几率(?:，|,)?(?:最多|最高)${NUM}%$`), go: (m) => { const ns = m[1] !== undefined ? [num(m[1]), num(m[2])] : [num(m[3]), num(m[4])]; return { attachAll: { chancePerUse: ns[0], chancePerUseCap: ns[1] } }; } },
  // ── 双方已损失PP总和×N固伤（"附加双方当前已损失技能PP值总和×2的固定伤害"→flatFoePpMissing who:both）──
  { id: "e44-13", re: new RegExp(`^附加双方(?:当前)?(?:已)?损失(?:的)?(?:技能)?PP值?(?:总和)?[×xX*]${NUM}(?:倍)?的?(?:固定伤害|固伤)$`), go: (m) => ({ attachDamage: { flatFoePpMissing: { mul: num(m[1]), who: "both" } } }) },
  // ── 对手恢复效果削减（"对手3回合内体力恢复效果减少50%" / "对手所有体力恢复效果减少50%"）──
  { id: "e44-15", re: new RegExp(`^(?:对手|对方|敌方)${NUM}回合内(?:所有)?(?:体力)?(?:恢复|回复|治疗)(?:的)?效果减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", turns: num(m[1]), params: { pct: num(m[2]) } }] }) },
  { id: "e44-16", re: new RegExp(`^(?:对手|对方|敌方)(?:的)?(?:所有)?(?:体力)?(?:恢复|回复|治疗)(?:的)?效果减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: num(m[1]) } }] }) },
  // ── 每回合概率削上限（"每回合有50%的几率降低对手最大HP的1/4" → maxhp_tick{chance}）──
  { id: "e44-17", re: new RegExp(`^每回合(?:有${NUM}%(?:的)?(?:几率|机率|概率))?降低(?:对手|对方|敌方)(?:的)?最大(?:HP|体力)(?:值)?的?${NUM}\/${NUM}$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "maxhp_tick", target: "self", params: { n: num(m[2]), d: num(m[3]), ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) } })] }) },
  // ── 回合末清负级压给对手（"每回合解除自身能力下降状态并附加给对手相同的能力下降状态"）──
  { id: "e44-18", re: /^每回合(?:解除|消除)(?:自身|自己)(?:的)?能力(?:下降|降低)状态并(?:附加|反弹|转移|反馈)给(?:对手|对方|敌方)(?:相同|同样|等量)的?能力(?:下降|降低)状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "down_push_tick", target: "self", turns: 1 })] }) },
];
