// r2e：对手造成的伤害转为自己回血。只放本路规则。
// 已有格子：apply_status name dmg_to_heal（承伤方把受到的伤害转成体力，读法在 ops/axes.ts 的 dmgToHeal；
// 全额走 damage.ts 的 dmgToHealOn 拦截分支、比例走 dmgToHealPctOf），params 只用已读取的 n/d 与 pct。
// 不新增 op、不新增 params 键、不改 EFFECT_DEFS。自己打出的伤害那一侧由 drain_atk 承载，不在本路。
// 本文件排在 order.mjs 最后，规则只落在现在没有规则命中的句子上；旧句的先后由前面的家族决定，这里不会截走。
import { NUM, num } from "./lex.mjs";

// 「所有/全部/一切」限定，两种落位都收：对手【所有攻击】造成的伤害 / 对手造成的【所有】伤害
const ALL_Q = "(?:所有|全部|一切)";
// 伤害来源形态：对手(造成|打出)(的)?(攻击)?(造成的)?伤害
//              ／对手(攻击|技能|招式)(造成的)?伤害（"对手攻击造成的伤害"）
const foeDamage = (allQ) =>
  "(?:对手|对方|敌方)(?:(?:造成|打出)(?:的)?" + allQ + "(?:的)?(?:(?:攻击|技能|招式)(?:造成)?(?:的)?)?"
  + "|" + allQ + "(?:的)?(?:攻击|技能|招式|攻击技能)(?:造成)?(?:的)?)(?:攻击)?伤害(?:数?值?)?";
// 回血尾：都将为自己恢复体力／都恢复自身体力／将恢复体力（恢复与回复同义，体力与HP同义）
const HEAL_TAIL = "(?:都|将|会|并|均)*?(?:(?:为|给)(?:自身|自己)(?:恢复|回复)|(?:恢复|回复)(?:自身|自己)?)(?:的)?(?:体力|HP|hp)(?:值)?";

export const rules = [
  // ── 句里写了分数的（"对手造成的伤害的1/2会为自身恢复体力"）→ dmg_to_heal n/d ──
  { id: "r2e-foe-dmg-heal-frac-01",
    re: new RegExp(`^${foeDamage(ALL_Q + "?")}(?:的)?${NUM}\s*/\s*${NUM}${HEAL_TAIL}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },

  // ── 句里写了百分数的（"对手打出的伤害的50%将会恢复自身体力"）→ dmg_to_heal pct ──
  { id: "r2e-foe-dmg-heal-pct-01",
    re: new RegExp(`^${foeDamage(ALL_Q + "?")}(?:的)?${NUM}\s*%${HEAL_TAIL}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: num(m[1]) } }] }) },

  // ── 写了「所有…都将」而没写系数的（"对手所有攻击造成的伤害都将为自己恢复体力"）→ 全额 pct 100 ──
  // 宿主句 上古剑圣/黄泉两仪、樱洛/糖弹疾风。必须带「所有/全部/一切」才收：没写限定也没写数字的不做。
  { id: "r2e-foe-dmg-heal-all-01",
    re: new RegExp(`^${foeDamage(ALL_Q)}${HEAL_TAIL}$`),
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 100 } }] }) },

];
