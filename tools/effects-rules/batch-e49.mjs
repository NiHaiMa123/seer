// batch-e49：95.4% 残留收口——回避别名 / 自耗半血 / 护盾差值 / 叠用变体 /
// 裸几率异常 / 概率固伤窗 / 技能失效变体 / 双方清除枚举 / perClear rider /
// 先制等级谓词 / 连击按先制等级 / 免疫异常+恢复熔句。
// reactWrap 只能在 go() 运行时调用（顶层禁止——见 batch-e24 头注）。
import { NUM, num, frac, pct, AIL_RE, AILMENTS, STAT_RE, STATS } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── "回避攻击" → dodge（"闪避" 同义别名；"50%回避攻击"） ──
  { id: "e49-01", re: new RegExp(`^${NUM}%(?:概率|几率|机率)?回避(?:对手|对方|敌方)?的?攻击$|^回避(?:对手|对方|敌方)?的?攻击$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: m[1] !== undefined ? pct(m[1]) : 100 }, ...(m[1] === undefined ? { turns: 1 } : {}) }] }) },
  // ── 自耗半血/压血线（"损失一半当前体力值"→percent self current；"消耗自身体力至N点"→leaveHp） ──
  { id: "e49-02", re: new RegExp(`^(?:损失|失去|消耗)(?:自身|自己)?(?:的)?一半(?:当前)?体力(?:值)?$|^(?:损失|失去)(?:自身|自己)?(?:当前)?体力(?:值)?的?一半$`), go: () => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: 1, denominator: 2 }, percentBase: "current", target: "self" }] }) },
  { id: "e49-03", re: new RegExp(`^(?:损失|失去|消耗)(?:自身|自己)?(?:最大体力|体力上限)的?一半$`), go: () => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: 1, denominator: 2 }, target: "self" }] }) },
  { id: "e49-04", re: new RegExp(`^(?:消耗|损失|失去)(?:自身|自己)?体力(?:值)?至${NUM}点$|^(?:使|令)?自身(?:体力)?(?:剩下|剩余|降至?)${NUM}点体力$`), go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: num(m[1] ?? m[2]) }] }) },
  // ── "获得一个双方最大体力差值的护盾" → shield flatMaxHpDiff（"一个" 数量词变体） ──
  // 裸形（无动词）：句中被顿号切开后只剩「双方最大体力之差的护盾/护罩」——
  // 前句已给出"获得"，这里直接落地同一 params 键。
  { id: "e49-05", re: /^(?:使|令)?(?:自身|自己)?获得(?:一个|等同于)?(?:双方)?(?:最大)?(?:体力|HP)差值的护盾$|^(?:使|令)?(?:自身|自己)获得(?:一个|等同于)双方最大体力(?:差值|之差)的护盾$|^(?:双方)?(?:最大)?(?:体力|HP)(?:差值|之差)的?护[盾罩]$/, go: () => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flatMaxHpDiff: 1 } }] }) },
  // ── 叠用变体（"连续使用每次威力提升N%，最高提升至M"/"每次加N%，最高M" —— % 按 flat 功率增量，与 e40-63 约定一致） ──
  { id: "e49-06", re: new RegExp(`^连续使用(?:每次)?威力(?:提升|提高|增加)${NUM}%?(?:，|,)?最高(?:提升|提高|增加)至?${NUM}%?$|^连续使用每次加${NUM}%(?:，|,)?最高(?:提升|提高|增加|至)?${NUM}%?$`), go: (m) => ({ attachDamage: { powerPerUse: num(m[1] ?? m[3]), useCap: num(m[2] ?? m[4]) } }) },
  // ── "连续使用叠加最高N" → flatStackCap（固伤自体叠乘封顶——幅值来自宿主 flat） ──
  { id: "e49-07", re: new RegExp(`^连续使用(?:威力|伤害)?叠加最高${NUM}$|^连续使用(?:固定伤害)?叠加最多${NUM}$`), go: (m) => ({ attachDamage: { flatStackCap: num(m[1]) } }) },
  // ── "N%对方N回合内(每回合)?受到N点伤害" → foe_dot flat+chance+turns（"100%对方5回合内每回合受到100点伤害"） ──
  { id: "e49-08", re: new RegExp(`^${NUM}%(?:概率|几率|机率)?(?:令|使)?(?:对手|对方|敌方)(?:在)?${NUM}回合内(?:，|,)?(?:每回合)?受到${NUM}点(?:固定)?(?:伤害|固伤)$|^(?:令|使)?(?:对手|对方|敌方)(?:在)?${NUM}回合内(?:，|,)?(?:每回合)?受到${NUM}点(?:固定)?(?:伤害|固伤)$|^${NUM}%(?:概率|几率|机率)?(?:令|使)?(?:对手|对方|敌方)(?:在)?${NUM}回合内(?:，|,)?(?:每回合)?受到(?:固伤|固定伤害)${NUM}点$`), go: (m) => {
    // alt1: chance,turns,flat | alt2: turns,flat | alt3: chance,turns,flat
    const chance = num(m[1] ?? m[6]); const turns = num(m[2] ?? m[4] ?? m[7]); const flat = num(m[3] ?? m[5] ?? m[8]);
    const eff = { op: "apply_status", name: "foe_dot", target: "self", params: { flat }, turns };
    if (m[1] !== undefined || m[6] !== undefined) eff.chance = chance;
    return { effects: [eff] };
  } },
  // ── 裸几率异常（"30%疲惫2回合"/"25%麻痹、烧伤、冻伤"——单异常直挂，枚举列表→random count:1，与"N%使对手A、B"约定一致） ──
  { id: "e49-09", re: new RegExp(`^${NUM}%(${AIL_RE})${NUM}回合$|^${NUM}%(${AIL_RE})$|^${NUM}%((?:${AIL_RE})(?:、(?:${AIL_RE}))+)$`), go: (m) => {
    if (m[7] !== undefined) { const list = m[7].split("、").map((a) => AILMENTS[a]); return { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: 1 }, chance: num(m[6]) }] }; }
    if (m[5] !== undefined) return { effects: [{ op: "apply_status", name: AILMENTS[m[5]], target: "opponent", chance: num(m[4]) }] };
    return { effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", turns: num(m[3]), chance: num(m[1]) }] };
  } },
  // ── "使/令…技能消失" → move_null count:1（"使得对方的技能消失" 消失=失效变体） ──
  { id: "e49-10", re: /^(?:使|令|使得)(?:对手|对方|敌方)(?:的)?技能消失$|^(?:对手|对方|敌方)(?:的)?技能(?:失效|消失)$/, go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } }] }) },
  // ── "能力下降状态和护盾效果"（"消除双方A、B和C" 枚举续段——双方=两侧同清） ──
  { id: "e49-11", re: /^能力下降状态[和及](护盾|护罩|回合类)(?:类)?效果$/, go: (m) => { const scope = m[1] === "回合类" ? "timed" : "shield"; return { effects: [
    { op: "clear_stages", sign: "down", target: "self" }, { op: "clear_stages", sign: "down", target: "opponent" },
    { op: "cleanse", scope, target: "self" }, { op: "cleanse", scope, target: "opponent" },
  ] }; } },
  // ── "下降状态"/"提升状态" 裸续段（"消除双方能力上升、下降状态"顿号切余——同 e49-11 双侧同清惯例） ──
  { id: "e49-11b", re: /^(?:能力)?(?:下降|降低)状态[和及](?:回合类)(?:类)?效果$/, go: () => ({ effects: [
    { op: "clear_stages", sign: "down", target: "self" }, { op: "clear_stages", sign: "down", target: "opponent" },
    { op: "cleanse", scope: "timed", target: "self" }, { op: "cleanse", scope: "timed", target: "opponent" },
  ] }) },
  // ── "消除任意一项成功则附加N点固定伤害且令对手随机M个技能PP值归零" → perClear rider ──
  { id: "e49-12", re: new RegExp(`^消除任意(?:一|其中)项(?:状态|效果)?成功则附加${NUM}点(?:固定)?伤害(?:且|并)?(?:令|使)?(?:对手|对方|敌方)随机${NUM}个技能PP值归零$|^消除任意(?:一|其中)项成功则附加${NUM}点(?:固定)?伤害$|^消除任意(?:一|其中)项(?:状态|效果)?成功则(?:令|使)?(?:对手|对方|敌方)随机${NUM}个技能PP值归零$`), go: (m) => {
    const flat = num(m[1] ?? m[3]); const ppz = num(m[2] ?? m[4]);
    return { attachAll: { perClear: { ...(m[1] !== undefined || m[3] !== undefined ? { flat } : {}), ...(m[2] !== undefined || m[4] !== undefined ? { ppZeroFoe: ppz } : {}) } } };
  } },
  // ── "消除双方护盾" / "清除双方护盾效果" ──
  { id: "e49-13", re: /^(?:消除|清除|驱散)双方护盾(?:效果)?$/, go: () => ({ effects: [{ op: "cleanse", scope: "shield", target: "self" }, { op: "cleanse", scope: "shield", target: "opponent" }] }) },
  // ── "自身每有1级先制则连击次数+1" → hitsPerPrio（"最高连击N次"尾句由 hitsCap 既有通道并入） ──
  { id: "e49-14", re: new RegExp(`^(?:自身|自己)每有${NUM}级先制(?:则|时)?连击次数\\+${NUM}$|^(?:自身|自己)每有${NUM}级先制(?:则|时)?攻击次数\\+${NUM}$`), go: (m) => ({ attachDamage: { hitsPerPrio: { per: num(m[1] ?? m[3]), add: num(m[2] ?? m[4]) } } }) },
  // ── "先出手N回合不受能力下降影响" → immune_degrade 条件回合窗 ──
  { id: "e49-15", re: new RegExp(`^先出手${NUM}回合(?:内)?不受能力下降(?:状态|技能)?影响$|^先手${NUM}回合(?:内)?不受能力下降(?:状态|技能)?影响$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self", turns: num(m[1]), if: { order: "first" } }] }) },
  // ── "免疫异常恢复N/M体力" 熔句（"5回合免疫异常恢复最大体力1/2"——无分隔两 op） ──
  { id: "e49-16", re: new RegExp(`^免疫异常(?:状态)?恢复(?:自身)?(?:最大)?体力的?${NUM}\\s*/\\s*${NUM}$|^免疫异常(?:状态)?恢复${NUM}点?体力$`), go: (m) => m[2] !== undefined
    ? { effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }
    : { effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "heal", flat: num(m[3]), target: "self" }] } },
  // ── "限制+N" → priority（"灵光闪"同名技能既有"先制+1"变体——刮写错字别名） ──
  { id: "e49-17", re: new RegExp(`^限制\\+${NUM}$|^限制${NUM}$`), go: (m) => ({ flags: { priority: num(m[1]) } }) },
  // ── "先制等级提升为+N" → priorityMin flag（"提升为"=下限抬升，语义不小于当前值） ──
  { id: "e49-18", re: new RegExp(`^先制等级提升为?\\+?${NUM}$|^先制提升为\\+?${NUM}$`), go: (m) => ({ flags: { priorityMin: num(m[1]) } }) },
  // ── "若自身先制等级大于N时提升为+M" → priorityIf{when:selfPrioAbove,min} 整句直发 ──
  { id: "e49-18b", re: new RegExp(`^若?(?:自身|自己)?先制等级大于${NUM}时?提升为?\\+?${NUM}$|^提升为\\+${NUM}$`), go: (m) => m[3] !== undefined ? ({ flags: { priorityMin: num(m[3]) } }) : ({ flags: { priorityIf: { when: { selfPrioAbove: num(m[1]) }, min: num(m[2]) } } }) },
  // ── "附加给对手等量百分比伤害" → healEcho foe（"恢复体力时若…则附加给对手等量百分比伤害"） ──
  { id: "e49-19", re: /^(?:附加|给予)(?:给)?(?:对手|对方|敌方)(?:造成|附加)?等量(?:的)?百分比伤害$|^给(?:对手|对方|敌方)(?:造成|附加)?等量(?:的)?百分比伤害$|^(?:附加|给予)(?:给)?(?:对手|对方|敌方)等量(?:的)?固定伤害$/, go: () => ({ attachAll: { healEcho: true } }) },
  // ── "对手用属性技能" → dynTrigger trigger3（"用"=使用简写） ──
  { id: "e49-20", re: /^(?:对手|对方|敌方)用属性技能$/, go: () => ({ dynTriggerPart: { trigger: 3 } }) },
];
