// batch-e50：尾部 ≥3 频清晰簇——威力随机区间 / 对手体力回复 / 承伤正常折扣 /
// 先手封印 / 降能力免疫变体 / 强化反转·转移变体 / 全槽 PP 削减 / 概率免伤 /
// 镜像回复倍率 / 连攻叠次变体 / 对手在N回合内窗。
// 全部落既有引擎字段——powerRange/atk_taken_frac/move_null/immune_degrade/
// invert_stages/transfer_stages/pp_delta/dmg_immune/foeLastHealPct/hits.perUse/cap。
// reactWrap 只能在 go() 运行时调用（顶层禁止——见 batch-e24 头注）。
import { NUM, num, frac, TYPE_RE } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── 威力随机区间（"威力随机150~200"——attach-damage-71 原为 deferred stub，powerRange 引擎侧早已结算）──
  { id: "e50-01", re: new RegExp(`^威力随机(?:为)?${NUM}\\s*[-~～—至到]\\s*${NUM}(?:点)?$`), go: (m) => ({ attachDamage: { powerRange: { min: num(m[1]), max: num(m[2]) } } }) },
  // ── 回复对手体力上限分数（"恢复对手体力上限1/3的体力"——heal target:opponent，基值=对手最大体力）──
  { id: "e50-02", re: new RegExp(`^(?:恢复|回复|治疗)(?:对手|对方|敌方)(?:的)?(?:体力上限|最大体力)(?:的)?${NUM}/${NUM}(?:的)?体力(?:值)?$|^(?:恢复|回复)(?:对手|对方|敌方)最大体力(?:的)?${NUM}/${NUM}$`), go: (m) => ({ effects: [{ op: "heal", numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]), target: "opponent" }] }) },
  // ── 回满自身体力变体（attach-damage-25 未含"回满自身体力"语序）──
  { id: "e50-03", re: /^回满自身(?:的)?体力$|^回满自身(?:的)?HP$|^自身体力回满$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // ── "受到正常伤害N/M" → atk_taken_frac cat4（标准攻击承伤 ×n/d——e42 "攻击伤害是正常的1/2" 同义）──
  { id: "e50-05", re: new RegExp(`^(?:受到|所受)(?:的)?正常伤害(?:为|是)?(?:正常伤害的?)?${NUM}/${NUM}$|^(?:受到|所受)(?:的)?伤害变为正常(?:的)?${NUM}/${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // ── "本方先手对方技能无效" → move_null + order:first 门（先动结算时封印对手本回合技能）──
  { id: "e50-06", re: /^(?:本方|我方|己方|自身)先手(?:则|时|，|,)?(?:对手|对方|敌方)(?:的)?技能无效$|^(?:若|当)自身先手(?:则|时)?(?:对手|对方|敌方)技能无效$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 }, if: { order: "first" } }] }) },
  // ── "免疫能力下降技能"（技能后缀变体——e13 只覆盖"免疫能力下降(状态)"）──
  { id: "e50-07", re: /^(?:自身|自己)?免疫(?:对手|对方|敌方)?的?能力下降(?:类)?(?:技能|状态)?$|^免疫弱化类技能$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // ── "对手能力提升转成下降"/"对手强化转成下降" → invert_stages sign:up（正级翻负）──
  { id: "e50-08", re: /^(?:使|令|将|把)?(?:对手|对方|敌方)(?:的)?能力(?:提升|强化|上升)(?:状态)?(?:转成|转化为|转变为|反转为)(?:能力)?下降$|^(?:使|令)?对手强化转成下降$/, go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // ── "对手强化转化给自身"（转化给 变体——e44/e38 只有"转移到自身"）──
  { id: "e50-09", re: /^(?:将|把|使|令)?(?:对手|对方|敌方)(?:的)?(?:能力)?(?:强化|提升)(?:状态|效果)?转化给(?:自身|自己)$|^夺取(?:对手|对方|敌方)(?:的)?强化$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "steal", sign: "up" }] }) },
  // ── "必定降低对方所有技能N点PP" → pp_delta 全槽（scope:"all" 缺省语义）──
  { id: "e50-10", re: new RegExp(`^(?:必定|必|直接)?(?:降低|减少|扣除)(?:对手|对方|敌方)(?:的)?所有技能${NUM}点(?:的)?PP(?:值)?$|^(?:必定|必|直接)?(?:使|令)(?:对手|对方|敌方)(?:的)?所有技能PP(?:值)?(?:降低|减少|扣除)${NUM}点$|^(?:对手|对方|敌方)(?:的)?所有技能PP(?:值)?-${NUM}$`), go: (m) => { const v = num(m[1] ?? m[2] ?? m[3]); return { effects: [{ op: "pp_delta", amount: -v, target: "opponent" }] }; } },
  // ── "N%的概率免疫对手攻击技能造成的伤害" → dmg_immune chance（攻击伤害免疫窗，与 e16-61 同构）──
  { id: "e50-11", re: new RegExp(`^${NUM}%(?:的)?(?:概率|几率|机率)免疫(?:对手|对方|敌方)(?:的)?攻击技能造成的伤害$|^${NUM}%(?:的)?(?:概率|几率|机率)免疫攻击伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: num(m[1] ?? m[2]) }] }) },
  // ── "也恢复等量体力的N/M倍" → heal foeLastHealPct（e33-react-05 分数倍变体；react14 触发窗已接）──
  { id: "e50-12", re: new RegExp(`^(?:使|令|让)?(?:自身|自己)?也?恢复等量(?:的)?体力(?:的)?${NUM}/${NUM}倍$|^(?:自身|自己)?也?恢复(?:对手|对方|敌方)等量体力(?:的)?${NUM}/${NUM}倍$|^(?:自身|自己)?也恢复等量(?:的)?体力(?:值)?$`), go: (m) => { const n = m[1] !== undefined || m[3] !== undefined ? num(m[1] ?? m[3]) : 1; const d = m[2] !== undefined || m[4] !== undefined ? num(m[2] ?? m[4]) : 1; return { effects: [{ op: "heal", foeLastHealPct: Math.round((100 * n) / d), target: "self" }] }; } },
  // ── 连攻叠次变体（"连攻对手8次每次次数+1"——连攻 前缀 + 每次次数+M 后缀融合句）──
  { id: "e50-13a", re: new RegExp(`^(?:连攻|连续攻击|攻击|连续打击)(?:对手|对方|敌方)?${NUM}次[，,]?每次(?:使用)?(?:攻击)?次数\\+${NUM}$`), go: (m) => ({ attachDamage: { hits: { min: num(m[1]), max: num(m[1]), perUse: num(m[2]) } } }) },
  { id: "e50-13b", re: new RegExp(`^每次(?:使用)?(?:攻击)?次数\\+${NUM}$|^每次攻击次数增加${NUM}$`), go: (m) => ({ attachDamage: { hits: { min: 1, max: 1, perUse: num(m[1]) } } }) },
  { id: "e50-13c", re: new RegExp(`^最大攻击(?:次数|数)?(?:为)?${NUM}次$|^最大攻击${NUM}次$|^最大攻击次数${NUM}$`), go: (m) => { const v = num(m.slice(1).find((x) => x !== undefined)); return { attachDamage: { hitsCap: v } }; } },
  // ── "下N次受到攻击伤害时X" 融合句 → reactWrap trigger:1 count:N（逗号切散的裸触发词由 dynTrigger count 透传承接）──
  { id: "e50-15", re: new RegExp(`^若?下${NUM}次受到(?:的)?(?:攻击伤害|攻击|伤害)[时后]?(.+)$`), go: (m) => reactWrap(1, { count: num(m[1]) }, m[2]) },
  // ── "N%机率令对手在M回合内AIL" —— bcm 概率剥 + TURNS_PRE 对手在N回合内 前缀补全（TURNS_PRE 扩展在外部补丁）──
  // ── 元素威力域（"火系技能威力提升N%"/"翻N倍"/"翻倍"→dmg_boost{pct,moveType}；只有"为随机倍数"仍留档，不编随机范围）──
  { id: "e50-14", re: new RegExp(`^(${TYPE_RE})系?(?:技能|招式|攻击)(?:的)?威力(翻倍|翻${NUM}倍|提升${NUM}%|为随机倍数)$|^(${TYPE_RE})系?技能(?:造成)?的?伤害(翻倍|提升${NUM}%)$`), go: (m) => { if (/为随机倍数/.test(m[0])) return { unparsedReason: "random-multiplier power — random range unmodeled (deferred)" }; const type = m[1] ?? m[5]; const alt = m[2] ?? m[6]; if (/加倍|翻倍/.test(alt)) return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 100 }, moveType: type }] }; const pctv = m[3] !== undefined ? (num(m[3]) - 1) * 100 : num(m[4] ?? m[7]); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: pctv }, moveType: type }] }; } },
];
