// batch-e51：残留清晰簇收口——当前体力%固伤 / 技能概率失效 / 命中效果失效 /
// 出伤上限裸句 / 技能封印裸句 / 技能回复阻断裸句 / 损伤分数吸血。
// 全部落既有引擎字段——flatFoeCurPct/dmg_out_cap/hit_fx_null/status_lock/heal_block/drain；
// fumble 为新增行动概率失败状态（effectBlock 读 params.pct）。
import { NUM, num } from "./lex.mjs";

export const rules = [
  // ── 附加N%当前体力值的伤害（"附加15%当前体力值的伤害"/"附加对手当前体力值20%的伤害"→ flatFoeCurPct 对手当前体力%固伤）──
  { id: "p2-fcp-02",
    re: /^附加(?:对手|对方|敌方)当前(?:HP|hp)([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%(?:的)?(?:固伤|固定伤害|伤害)$/,
    go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }),
  },
  { id: "e51-01a", re: new RegExp(`^附加(?:对手|对方|敌方)?的?当前体力值?的?${NUM}%(?:的)?(?:固定)?伤害$`), go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }) },
  { id: "e51-01b", re: new RegExp(`^附加(?:对手|对方|敌方)?的?${NUM}%的?当前体力值?的?(?:固定)?伤害$`), go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }) },
  // 裸变体："附加"被前缀剥后余 "15%当前体力值的伤害"
  { id: "e51-01c", re: new RegExp(`^${NUM}%的?(?:对手|对方|敌方)?当前体力值?的?(?:固定|百分比)?伤害$`), go: (m) => ({ attachDamage: { flatFoeCurPct: num(m[1]) } }) },
  // ── 所有技能有N%概率失效（"对手2回合内所有技能有50%概率失效"——foeCtx 翻转到对手侧；fumble 行动前概率判定）──
  { id: "e51-02", re: new RegExp(`^(?:其|对手|对方|敌方)?所有技能有${NUM}%(?:的)?(?:概率|几率)?(?:无法使用|失效|无效)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "fumble", target: "self", params: { pct: num(m[1]) } }] }) },
  // ── 命中效果失效（"对手属性技能命中效果失效"/"技能命中效果失效"——hit_fx_null，cat 门控）──
  { id: "e51-03", re: /^(?:其|对手|对方|敌方)?(?:使用的?)?(物理|特殊|属性|攻击)?技能?命中效果失效$/, go: (m) => ({ effects: [{ op: "apply_status", name: "hit_fx_null", target: "self",
    params: m[1] === "物理" ? { cat: 2 } : m[1] === "特殊" ? { cat: 3 } : m[1] === "属性" ? { cat: 1 } : undefined }] }) },
  // ── 造成的伤害不超过N 裸句（"对手3回合内造成的伤害不超过200"——dmg_out_cap，foeCtx 翻转）──
  { id: "e51-04", re: new RegExp(`^(?:其|对手|对方|敌方|自身)?造成的?(?:攻击)?伤害不超过${NUM}点?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_cap", target: "self", params: { cap: num(m[1]) } }] }) },
  // ── 使用的属性技能无效（"2回合内令对手使用的属性技能无效"——status_lock cat 门控，foeCtx 翻转）──
  { id: "e51-05", re: /^(?:其|对手|对方|敌方)?(?:使用的?)?(物理|特殊|属性|攻击)?技能无效$/, go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "self",
    params: m[1] === "物理" ? { cat: 2 } : m[1] === "特殊" ? { cat: 3 } : m[1] === "属性" ? { cat: 1 } : undefined }] }) },
  // ── 无法通过技能恢复自身体力 裸句（"使对手当回合内无法通过技能恢复自身体力"——heal_block，foeCtx 翻转）──
  { id: "e51-06", re: /^(?:其)?无法通过技能恢复(?:自身|自己)?的?体力$/, go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "self" }] }) },
  // ── 给予对方损伤的N/M回复自身体力（drain 变体——"给予对方损伤的1/4会回复自己的体力"）──
  { id: "e51-07", re: new RegExp(`^(?:给予|给)(?:对方|对手|敌方)的?(?:损伤|伤害|造成的伤害)的?${NUM}\\s*/\\s*${NUM}的?(?:值)?会?回(?:复|恢)(?:自己|自身)的?(?:体力|HP|生命值?|血)$`), go: (m) => ({ attachDamage: { drain: { n: num(m[1]), d: num(m[2]) } } }) },
  // ── 每回合损失N点体力（foeCtx 下翻转为 dot_field{opponent}；"令对手每回合损失100点体力"直发对手侧）──
  { id: "e51-11", re: new RegExp(`^每回合(?:损失|扣除|失去|减少)${NUM}点(?:的)?(?:体力|HP|生命值?|血|固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "self", params: { flat: num(m[1]) } }] }) },
  { id: "e51-12", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)每回合(?:损失|扣除|失去|减少)${NUM}点(?:的)?(?:体力|HP|生命值?|血|固定伤害|固伤)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // ── 具名形态/携带光环/叙事前缀归桶（非"未识别"——域未建模或纯叙事，显式留档）──
  { id: "e51-08", re: /^携带(?:此|本)?技能时/, go: () => ({ unparsedReason: "carry-skill aura — equip passive unmodeled (deferred)" }) },
  { id: "e51-09", re: /^激发.{1,16}?(?:天生的|失传的|潜在的)?.{0,8}能力$/, go: () => ({ ignored: true }) },
  { id: "e51-10", re: new RegExp(`^(?:自身|自己)进入的.{1,10}(?:增加|延长|减少)${NUM}回合$|^若(?:自身|自己)?未?携带.{1,12}则.*改为.*$|^.+(?:态|境|界|络|域)改为.+$`), go: () => ({ unparsedReason: "named-stance/form domain unmodeled (deferred)" }) },
];
