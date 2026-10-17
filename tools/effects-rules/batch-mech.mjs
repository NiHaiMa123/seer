// mech：要新机制才写得完、句子本身把系数写清的技能句。
// 放在 order.mjs 末尾（全文件在最后），因此文件内顺序只需保证「新规则在同文件更宽旧规则之前」。
// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num } from "./lex.mjs";

// 招式类别编码（与 reactive / hit_fx_null 的 cat 同）：1=属性（无 damage op）/2=物理/3=特殊/4=任意非属性
const CAT = { 属性: 1, 特殊: 3, 特攻: 3, 物理: 2, 物攻: 2, 攻击: 4 };
const catOf = (w) => CAT[w];

// 受伤阈值 → 对手疲惫：react{trigger:1} 受击窗，min=承伤下限（承伤账 lastTaken 在受击窗之前写入）
const takenFatigue = (min, turns) => ({
  op: "apply_status", name: "react", target: "self", turns: 1,
  params: { trigger: 1, min, count: 1 },
  payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns }],
});

export const rules = [

  // ── 类别命中削减（"对手所有属性技能命中减N%"——dodge{pct,cat} 挂自身，cat 门控来招类别） ──
  // cat 由 missChanceEntries 在 RESOLVE_HIT 里求值（见 ops/effects.ts）——missChanceEntries/RESOLVE_HIT
  // 的其它调用方即使拿不到 move，也照样受这个门约束。
  { id: "mech-acc-cat-01",
    re: /^(?:对手|对方|敌方)(?:所有|全部)?(属性|特殊|特攻|物理|物攻|攻击)(?:技能|招式)?命中(?:率)?(?:减|下降|降低|减少)([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[2]), cat: catOf(m[1]) } }] }) },

  // ── 伤害反弹（打出伤害的 n/d 反噬自己） ──
  // "造成伤害的n/d反弹给自己" → recoilFrac（无「所受」裸形；heal-282 只认「(对方)所受伤害的n/d反弹给自己」）
  { id: "mech-recoil-frac-01",
    re: new RegExp('^(?:将)?(?:制造|造成)(?:的)?伤害(?:值)?(?:的)?' + NUM + '\s*/\s*' + NUM + '(?:会|将|并)?反弹(?:回|给)?(?:自身|自己)$'),
    go: (m) => ({ attachDamage: { recoilFrac: { n: num(m[1]), d: num(m[2]) } } }) },

  // ── 清能力等级（双方向各发一次 clear_stages） ──
  // "消除对手能力提升和下降状态" → 目标侧两条带 sign 的 clear_stages（e39-02c 只认「双方」形）
  { id: "mech-clear-both-01",
    re: /^(?:消除|清除)(?:对手|对方|敌方)(?:的)?能力(?:提升|增强|强化|上升)(?:状态)?(?:和|与|及|、|,|，)(?:能力)?(?:下降|弱化|降低)(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }, { op: "clear_stages", target: "opponent", sign: "down" }] }) },
  // 反序（"消除对手能力下降和提升状态"）同义
  { id: "mech-clear-both-02",
    re: /^(?:消除|清除)(?:对手|对方|敌方)(?:的)?能力(?:下降|弱化|降低)(?:状态)?(?:和|与|及|、|,|，)(?:能力)?(?:提升|增强|强化|上升)(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }, { op: "clear_stages", target: "opponent", sign: "down" }] }) },

  // ── 双类承伤折扣（物理+特殊=任意攻击技 → cat:4 一条窗；「和」「或」两种连词同义） ──
  { id: "mech-taken-cats-01",
    re: new RegExp('^(?:自身|自己)?受到?(?:的)?(?:物理|物攻)(?:攻击)?(?:和|与|及|、|,|，|或)(?:特殊|特攻)(?:攻击)?(?:的)?伤害(?:减少|降低|下降|减)(' + NUM + ')%$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: 100 - num(m[1]), d: 100 } }] }) },

  // ── 受伤阈值 → 对手疲惫（min 门 + fatigue payload） ──
  { id: "mech-taken-fatigue-01",
    re: /^(?:若)?(?:自身|自己)?受伤(?:害)?(?:高于|大于|超过)([0-9]+)(?:点)?则(?:令|使)?(?:对手|对方|敌方)疲惫([0-9]+|一|二|两|三|四|五|六|七|八|九|十)回合$/,
    go: (m) => ({ effects: [takenFatigue(num(m[1]), num(m[2]))] }) },
  { id: "mech-taken-fatigue-02",
    re: /^(?:若)?(?:自身|自己)?受到(?:的)?(?:攻击)?伤害(?:高于|大于|超过)([0-9]+)(?:点)?则(?:令|使)?(?:对手|对方|敌方)疲惫([0-9]+|一|二|两|三|四|五|六|七|八|九|十)回合$/,
    go: (m) => ({ effects: [takenFatigue(num(m[1]), num(m[2]))] }) },

  // ── 对手来伤回血（对手打出的伤害按 n/d 或 n% 转成自身体力，挂承伤方） ──
  // 与自身打出的吸血（e42-33 / applyDrainRider）是两回事：那条挂在打出方，这条挂在被伤害的一方
  { id: "mech-foe-dmg-heal-01",
    re: new RegExp('^(?:对手|对方|敌方)(?:造成|打出)(?:的)?伤害(?:的)?' + NUM + '\\s*/\\s*' + NUM + '(?:会|将|并)?(?:(?:为|给)(?:自身|自己)(?:恢复|回复)|(?:恢复|回复)(?:自身|自己)?)(?:的)?(?:体力|HP)$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  { id: "mech-foe-dmg-heal-02",
    re: new RegExp('^(?:对手|对方|敌方)(?:造成|打出)(?:的)?伤害(?:数?值?)?(?:的)?([0-9]+)\\s*%(?:会|将|并)?(?:(?:为|给)(?:自身|自己)(?:恢复|回复)|(?:恢复|回复)(?:自身|自己)?)(?:的)?(?:体力|HP)$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: num(m[1]) } }] }) },

];
