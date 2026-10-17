// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e43：残留长尾批——裸连击/连击成长、定额承伤变体、固伤+百分比免疫反弹、异常转移吸血、
// 异常种类转化、自耗等量反伤宿主扩展、团队战目标归桶、几率占位机制配合项。
import { NUM, num, frac, STATS, STAT_RE, AILMENTS, AIL_RE } from "./lex.mjs";

const STAT = (w) => STATS[w] ?? w;
const AIL = (w) => AILMENTS[w] ?? w;
const stageFx = (stat, delta, target, extra = {}) => ({ op: "apply_stat_stage", stat, delta, target, ...extra });

export const rules = [
  // ── 裸连击（"连击5次"/"连击2~3次"→attachDamage.hits） ──
  { id: "e43-01",
    re: new RegExp(`^连击(${NUM})[-~—至到](${NUM})次(?:攻击)?$|^连击(${NUM})次$`),
    go: (m) => { const a = num(m[1] ?? m[5]); const b = num(m[3] ?? m[5]); return { attachDamage: { hits: { min: a, max: b } } }; } },
  // ── 命中成长连击（"每次命中后连击数+1"→attachAll.hitsGrow 回挂 hits 宿主） ──
  { id: "e43-02",
    re: new RegExp(`^每(?:次)?命中后?连击(?:次)?数?[+＋](${NUM})$|^每次攻击命中后连击(?:次)?数?[+＋](${NUM})$`),
    go: (m) => ({ attachAll: { hitsGrow: num(m[1] ?? m[2]) } }) },
  // ── 裸"无法行动"（主语省略尾句→control:stun 对手；"对手3回合内无法行动"——内嵌回合窗） ──
  { id: "e43-03",
    re: new RegExp(`^无法行动$|^(?:对手|对方|敌方)(?:${NUM}回合内?)?无法行动$`),
    go: (m) => ({ effects: [{ op: "control", name: "stun", target: "opponent", ...(m[1] !== undefined ? { turns: num(m[1]) } : {}) }] }) },
  // ── "被攻击伤害不超过N"（承伤上限词形变体→dmg_cap） ──
  { id: "e43-04",
    re: new RegExp(`^被攻击伤害不超过(${NUM})(?:点)?$|^自身受到的攻击伤害不超过(${NUM})(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // ── "免疫并反弹自身受到的固定伤害和百分比伤害"（免疫+反伤双窗，kindMask=固伤|百分比=1|2） ──
  { id: "e43-05",
    re: /^免疫并反弹(?:自身|自己)?受到的固定伤害和百分比伤害$|^免疫并反弹(?:自身|自己)?(?:受到的)?(?:固定|固伤)伤害$|^免疫并反弹(?:自身|自己)?受到的(?:百分比|固定)?伤害$/,
    go: (m) => { const km = /固定|固伤/.test(m[0]) ? (/百分比/.test(m[0]) ? 3 : 1) : (/百分比/.test(m[0]) ? 2 : undefined); const mk = km === undefined ? {} : { kindMask: km }; return { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: mk }, { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, ...mk } }] }; } },
  // ── "免疫并反弹物理/特殊伤害"（cat 门控：物理2/特殊3——伤害域非异常域） ──
  { id: "e43-29b",
    re: /^免疫并反弹(物理|特殊)伤害$/,
    go: (m) => { const cat = m[1] === "特殊" ? 3 : 2; return { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { cat } }, { op: "apply_status", name: "counter", target: "self", params: { mul: 1, cat } }] }; } },
  // ── "免疫物理/特殊伤害" 裸免疫（伤害域 cat 门控） ──
  { id: "e43-29c",
    re: /^免疫(物理|特殊)伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { cat: m[1] === "特殊" ? 3 : 2 } }] }) },
  // ── "反弹物理/特殊伤害" 裸反弹（counter cat 门控） ──
  { id: "e43-29d",
    re: /^反弹(物理|特殊)伤害$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: 1, cat: m[1] === "特殊" ? 3 : 2 } }] }) },
  // ── "反弹自身受到的固定伤害和百分比伤害" 裸反弹（kindMask 限定固伤+百分比） ──
  { id: "e43-06",
    re: /^反弹(?:自身|自己)?受到的固定伤害和百分比伤害$|^反弹(?:受到的)?固定伤害和百分比伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, kindMask: 3 } }] }) },
  // ── "每转移一项吸取对手N点体力"（回挂 transfer_ailments 宿主——按迁移条数吸血） ──
  { id: "e43-07",
    re: new RegExp(`^每转移一项吸取对手(${NUM})点(?:体力|HP)$|^每转移一项?(?:则)?吸取对手(${NUM})点体力$`),
    go: (m) => ({ attachAll: { transferDrainPer: num(m[1] ?? m[2]) } }) },
  // ── "每转移一项令对手随机N项技能PP值归零"（按迁移条数 ×N 槽归零） ──
  { id: "e43-07b",
    re: new RegExp(`^每转移一项(?:则)?(?:令|使|让)?(?:对手|对方|敌方)随机(${NUM})项?技能PP值?归(?:零|0)$`),
    go: (m) => ({ attachAll: { transferPpZeroPer: num(m[1]) } }) },
  // ── "将对手所处的烧伤转化为焚烬"（异常转化：先条件施加目标异常，再解除源异常——cond 在源异常仍在场时求值） ──
  { id: "e43-08",
    re: new RegExp(`^将(?:对手|对方|敌方)所处的(${AIL_RE})转化为(${AIL_RE})$|^将(?:对手|对方|敌方)的(${AIL_RE})(?:状态)?转化为(${AIL_RE})(?:状态)?$`),
    go: (m) => { const from = AIL(m[1] ?? m[3]); const to = AIL(m[2] ?? m[4]); return { effects: [{ op: "apply_status", name: to, target: "opponent", if: { foeHas: from } }, { op: "cleanse", scope: "ailment", target: "opponent", effect: [from] }] }; } },
  // ── 团队战目标数——move 级元旗（targets/targetScope；1v1 引擎无语义，数据忠实落字段） ──
  { id: "p2-ig-03",
    re: /^组队[是时可]*以?(?:攻击|作用)(?:多个|(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))个?)(?:目标|人)?$/,
    go: (m) => (m[1] !== undefined ? { flags: { targets: num(m[1]) } } : { flags: { targetScope: "any" } }),
  },
  { id: "p2-ig-04",
    re: /^组队[是时可]*以?影响(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))个$|^组队时最多影响(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))个目标$|^影响(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))人$/,
    go: (m) => ({ flags: { targets: num([m[1], m[3], m[5]].find((x) => x !== undefined)) } }),
  },
  { id: "e43-09",
    re: new RegExp(`^(?:组队[是可]?以?影响|影响|组队时可影响)(${NUM})个目标$`),
    go: (m) => ({ flags: { targets: num(m[1]) } }) },
  { id: "p2-ig-05",
    re: /^组队[是时可]*(?:可以?|可)?(?:向|对|给)(?:己方|我方|本方|自己方|积分|其他精灵)(?:任意)?(?:目标|精灵|人|单位)?(?:使用|施放|作用|赋予)?$|^组队可选择其他精灵$/,
    go: () => ({ flags: { targetScope: "anyAlly" } }),
  },
  { id: "e43-09b",
    re: /^组队可向己方任意目标使用$/,
    go: () => ({ flags: { targetScope: "anyAlly" } }) },
  // ── 信仰对象前置（签名印记跨槽机制——均拥有=全场+bench 判定，未建模） ──
  { id: "e43-10",
    re: /^若?(?:对方|对手|敌方)精灵均拥有信仰对象$/,
    go: () => ({ unparsedReason: "signature mark cross-slot check — deferred" }) },
  // ── "造成的伤害提升"/"属性攻击" 裸碎片归桶（截断源文本） ──
  { id: "e43-11",
    re: /^造成的伤害提升$|^属性攻击$|^致命提升$|^翻倍$/,
    go: () => ({ unparsedReason: "truncated source fragment (UNVERIFIED)" }) },
  // ── "降低对方的能力" 无量化弱化（方向知段数缺→UNVERIFIED，不猜 -1） ──
  { id: "e43-12",
    re: /^降低(?:对方|对手|敌方)的?能力$/,
    go: () => ({ unparsedReason: "unquantified stage drop — count absent (UNVERIFIED)" }) },
  // ── "使用体力药剂变成降低相应的体力"（道具交互域——引擎不建模道具） ──
  { id: "e43-13",
    re: /^使用体力药剂变成降低相应的体力$/,
    go: () => ({ unparsedReason: "item interaction domain — not modeled (deferred)" }) },
];
