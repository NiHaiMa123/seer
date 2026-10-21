// batch-e36：PP 槽位/承伤窗/反弹/复活/双侧 stage 总和家族——全部接线到现有或本轮新增引擎键位。
import { NUM, num, AIL_RE, AILMENTS, STATS, STAT_RE } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── PP 槽位家族 ───────────────────────────────────────────────────────
  // "恢复自身其他技能此技能剩余PP值的50%" → pp_delta{scope:"others",amountFromThisPct}
  { id: "e36-01", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?其他技能(?:此技能|该技能|本技能)?(?:的)?剩余PP值?的${NUM}%$`),
    go: (m) => ({ effects: [{ op: "pp_delta", target: "self", scope: "others", amountFromThisPct: num(m[1]) }] }) },
  // "令对手攻击技能PP值归0" → pp_delta{cat:4,zero}
  { id: "e36-02", re: /^(?:令|使)(?:对手|对方|敌方)(?:的)?攻击技能PP值?归(?:0|零)$/,
    go: () => ({ effects: [{ op: "pp_delta", target: "opponent", cat: 4, zero: true }] }) },
  // "(使|令)双方精灵所有技能PP值归零" → 双侧各一条 zero
  { id: "e36-03", re: /^(?:令|使)双方(?:精灵)?(?:的)?(?:所有|全部)技能PP值?归(?:0|零)$/,
    go: () => ({ effects: [
      { op: "pp_delta", target: "self", zero: true },
      { op: "pp_delta", target: "opponent", zero: true },
    ] }) },
  // "双方每有1项技能PP值为0吸取对手70点体力" → attachDamage flatPerPpZero{who:"both",drain}
  { id: "p2-ppz-01",
    re: /^(?:对手|对方|敌方)每有?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:个|项)?技能(?:的)?(?:PP|pp)(?:值)?为?(?:0|零)(?:则|时)?附加(?:对手|对方|敌方)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)点(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatPerPpZero: { who: "foe", per: num(m[1]), add: num(m[2]) } } }),
  },
  { id: "e36-04", re: new RegExp(`^(双方|敌我双方|对手|对方|敌方|自身|自己|己方|我方)?每有?${NUM}(?:个|项)?技能PP值?为?(?:0|零)(?:则|时)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}点体力$`),
    go: (m) => { const who = m[1] === undefined || /双方/.test(m[1]) ? "both" : /对手|对方|敌方/.test(m[1]) ? "foe" : "self"; return { attachDamage: { flatPerPpZero: { who, per: num(m[2]), add: num(m[3]), drain: true } } }; } },
  // "所有技能的pp值恢复N点"/"恢复自身所有技能pp值" → pp_delta{amount/full}
  { id: "e36-05", re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?(?:的)?所有技能(?:的)?[Pp][Pp]值?$|^所有技能(?:的)?[Pp][Pp]值?恢复${NUM}点$|^(?:恢复|回复)(?:自身|自己)?所有技能${NUM}点[Pp][Pp]值?$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "pp_delta", target: "self", ...(ns.length > 0 ? { amount: ns[0] } : { full: true }) }] }; } },
  // "降低对手所有ppN点"/"降低所有技能N点PP值" → pp_delta{amount:-N}
  { id: "e36-06", re: new RegExp(`^(?:降低|减少|扣除)(?:对手|对方|敌方)(?:的)?所有(?:技能)?(?:的)?pp值?${NUM}点$|^(?:降低|减少|扣除)(?:对手|对方|敌方)?所有技能${NUM}点PP值?$|^(?:对手|对方|敌方)所有技能PP值?-${NUM}$`),
    go: (m) => ({ effects: [{ op: "pp_delta", target: "opponent", amount: -num(m[1] ?? m[2] ?? m[3]) }] }) },
  // "所有技能PP值提高N点" → pp_delta{amount:+N}
  { id: "p2-fpm-01",
    re: /^每损失(?:自身)?(?:最大体力)?(?:值)?(?:的)?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:点)?(?:HP|体力|血量)(?:就|则)?附加([0-9]+|一|二|两|三|四|五|六|七|八|九|十)点(?:固定伤害|固伤)$/,
    go: (m) => ({ attachDamage: { flatPerMissing: { step: num(m[1]), add: num(m[2]) } } }),
  },
  { id: "e36-07", re: new RegExp(`^(?:自身|自己)?(?:的)?所有技能[Pp][Pp]值?(?:提高|提升|增加|恢复)${NUM}点$`),
    go: (m) => ({ effects: [{ op: "pp_delta", target: "self", amount: num(m[1]) }] }) },
  // "此技能不受PP值限制"/"每次攻击不消耗PP值" → pp_free 窗（e5f-06 先例：移动级自由 PP 用持有者窗近似）
  { id: "e36-08", re: /^(?:此|该|本)技能不(?:受|消耗)PP值?(?:限制)?$|^(?:每次|每回合)攻击不消耗PP值?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pp_free", target: "self" }] }) },

  // ── 承伤窗口 ─────────────────────────────────────────────────────────
  // "自身下N次受到的攻击伤害不超过M" → dmg_cap{cap,count}
  { id: "e36-09", re: new RegExp(`^(?:令|使)?(?:自身|自己)下${NUM}次受到的(?:攻击|攻击技能)?伤害不超过${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[2]), count: num(m[1]) } }] }) },
  // "令自身下N次受到的攻击伤害额外减少M%" → atk_taken_frac{cat:4,count,×(100-M)/100}
  { id: "e36-10", re: new RegExp(`^(?:令|使)?(?:自身|自己)下${NUM}次受到的(?:攻击|攻击技能)?伤害(?:额外)?(?:减少|降低|下降)${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: 100 - num(m[2]), d: 100, count: num(m[1]) } }] }) },

  // ── 复活 / 倒下反应 ──────────────────────────────────────────────────
  // "若(本回合)?自身死亡则立刻恢复自身所有体力" → revive_fx{turns:1,pct:100}
  { id: "e36-11", re: /^若?(?:本回合|当回合|该回合)?(?:若)?(?:自身|自己)死亡(?:时|后|则)(?:立刻|立即|马上)?恢复(?:自身|自己)?(?:所有|全部|满)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "revive_fx", target: "self", turns: 1, params: { pct: 100 } }] }) },
  // "若MISS则自身死亡" → react{trigger:6} payload self-KO（damage percent:100 对自身）
  { id: "e36-12", re: /^(?:若|如果)?(?:自身|自己)?(?:技能)?(?:攻击)?(?:MISS|miss|未命中|没有命中)(?:时|后|则)(?:使|令)?(?:自身|自己)死亡$/,
    go: () => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 6 }, payload: [{ op: "damage", power: 100, kind: "percent", target: "self" }] }] }) },
  // "秒杀则令自身全属性+N" —— 击杀即触发（秒杀=击败语义；引擎按 foeFainted 条件门控）
  { id: "e36-13", re: new RegExp(`^(?:秒杀|击杀|击败)(?:对手|对方|敌方)?(?:时|后|则)(?:令|使)?(?:自身|自己)?全属性([+-])${NUM}$`),
    go: (m) => { const d = (m[1] === "-" ? -1 : 1) * num(m[2]); return { effects: ["atk", "def", "spa", "sdf", "spd"].map((stat) => ({ op: "apply_stat_stage", stat, delta: d, target: "self", if: { foeFainted: true } })) }; } },

  // ── 反弹 / 反击 ──────────────────────────────────────────────────────
  // "反弹N倍的伤害给对手" → counter{mul:N}
  { id: "e36-14", re: new RegExp(`^(?:将|把)?反弹${NUM}倍(?:的)?伤害(?:给|至)(?:对手|对方|敌方)$|^反弹${NUM}倍(?:的)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "counter", target: "self", params: { mul: num(m[1] ?? m[2]) } }] }) },
  // "反弹给对手造成伤害值N%的百分比伤害"/"反弹对手伤害N/M" → reflect_dmg
  // 「固伤/固定伤害」是同一形态的别称（反弹的那部分按固伤计）——语料里两种写法都有。
  { id: "e36-15", re: new RegExp(`^反弹给(?:对手|对方|敌方)(?:造成|的)?伤害值?${NUM}%的(?:百分比)?(?:伤害|固伤|固定伤害)$|^反弹(?:对手|对方|敌方)?伤害${NUM}\\s*/\\s*${NUM}$|^自身受到(?:直接)?攻击伤害${NUM}%(?:反馈|反弹)(?:给)?(?:对手|对方|敌方)?$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: ns.length === 1 ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] } }] }; } },
  // "受到攻击N%对手冻伤"（受击→异常载荷；trigger:1 + 条目 chance）
  { id: "e36-16", re: new RegExp(`^受到(?:对手|对方|敌方)?(?:的)?攻击(?:时|后)?${NUM}%?(?:几率|概率)?(?:使|令)?(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const ail = AILMENTS[m[2]]; if (ail === undefined) return null; return { effects: [{ op: "apply_status", name: "react", target: "self", chance: num(m[1]), params: { trigger: 1 }, payload: [{ op: "apply_status", name: ail, target: "opponent" }] }] }; } },
  // "将当回合护盾所吸收的伤害值以固定伤害的形式N%反弹给对手" → shieldAbsorbPct（e35-12 的长尾词序变体）
  { id: "e36-17", re: new RegExp(`^(?:将|把)(?:当回合|本回合)?(?:护盾|护罩)(?:所)?吸收(?:的|到)?伤害值?(?:以固定伤害的形式)?${NUM}%(?:反弹|反馈)(?:给对手|给对方|给对手)?$`),
    go: (m) => ({ attachDamage: { shieldAbsorbPct: num(m[1]) } }) },

  // ── 强化反转 / 消除 ──────────────────────────────────────────────────
  // "双倍反转对手能力提升状态"/"双倍反转对手的能力上升" → invert_stages{up,mul:2}
  { id: "e36-18", re: /^双倍反转(?:对手|对方|敌方)(?:的)?能力(?:提升|增强|强化|上升)(?:状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "up", mul: { numerator: 2, denominator: 1 }, target: "opponent" }] }) },
  // "消除敌我双方能力提升状态和回合类效果" → 双侧 clear up + 双侧 cleanse timed
  { id: "e36-19", re: /^消除(?:敌我|双方|敌我双方)(?:的)?能力(?:提升|增强|强化)(?:状态)?和回合类效果$/,
    go: () => ({ effects: [
      { op: "clear_stages", target: "self", sign: "up" },
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "cleanse", target: "self", scope: "timed" },
      { op: "cleanse", target: "opponent", scope: "timed" },
    ] }) },
  // "(令|使)对方所有(能力)?增强(能力)?效果消失/失效" → clear_stages{foe,up}
  { id: "e36-20", re: /^(?:令|使|将|使得)(?:对方|对手|敌方)(?:的)?(?:所有|全部)?(?:能力|能量)?(?:增强|提升|强化)(?:能力)?(?:的)?效果?(?:消失|失效|被消除)$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "令对手回合类效果失效"/"对手回合类效果失效" → cleanse{timed}
  { id: "e36-21", re: /^(?:令|使)(?:对手|对方|敌方)(?:的)?回合类效果失效$|^(?:对手|对方|敌方)(?:的)?回合类效果失效$/,
    go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // "无视自身所有能力下降状态" → ignore_self_down
  { id: "e36-22", re: /^无视(?:自身|自己)(?:的)?(?:所有|全部)?能力(?:下降|弱化)(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "ignore_self_down", target: "self" }] }) },
  // "无视对方所有防御能力提升效果" → pierce_stages（穿透强化窗近似——破防语义同族）
  { id: "e36-23", re: /^无视(?:对方|对手|敌方)(?:的)?(?:所有|全部)?(?:防御|防御能力)?(?:能力)?(?:提升|增强|强化)(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },

  // ── 附加伤害家族 ─────────────────────────────────────────────────────
  // "附加双方能力下降等级总和XN的固定伤害" → flatPerStage{who:"both",sign:"down",levels}
  { id: "e36-24", re: new RegExp(`^附加双方能力(?:下降|弱化)(?:等级|状态)?总和?[×Xx*]${NUM}的固定伤害$`),
    go: (m) => ({ attachDamage: { flatPerStage: { who: "both", sign: "down", per: 1, flat: num(m[1]), mode: "levels" } } }) },
  // "附加自身能力强化等级总和XN的固定伤害" → flatPerStage{self,up,levels}
  { id: "e36-25", re: new RegExp(`^附加(?:自身|自己)能力(?:强化|提升|增强)(?:等级|状态)?总和?[×Xx*]${NUM}的固定伤害$`),
    go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", per: 1, flat: num(m[1]), mode: "levels" } } }) },
  // "附加自身攻击值与速度值总和N%的百分比伤害" → flatSelfStatPct{stats:[atk,spd]}
  { id: "e36-26", re: new RegExp(`^附加(?:自身|自己)((?:${STAT_RE})(?:值|力)?(?:与|和|、|[+＋])(?:${STAT_RE})(?:值|力)?)(?:的)?总和${NUM}%的(?:百分比|固定)?伤害$`),
    go: (m) => {
      const stats = [...m[1].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]).filter(Boolean);
      if (stats.length < 2) return null;
      return { attachDamage: { flatSelfStatPct: { stats, pct: num(m[2]) } } };
    } },
  // "附加对手当前体力值N%的固伤" → flatFoeFrac{base:"current"}
  { id: "e36-27", re: new RegExp(`^附加(?:对手|对方|敌方)当前体力(?:值)?${NUM}%的(?:固定伤害|固伤|百分比伤害)$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: 100, base: "current" } } }) },
  // "附加对手已损失体力N%的伤害" → flatFoeFrac{base:"missing"}
  { id: "e36-28", re: new RegExp(`^附加(?:对手|对方|敌方)已损失体力(?:值)?${NUM}%的(?:固定|百分比)?伤害$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: 100, base: "missing" } } }) },
  // "附带N点伤害" → attachDamage flatBonus
  { id: "e36-29", re: new RegExp(`^附带${NUM}点(?:固定)?伤害$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // "每损失N点体力附加M点固定伤害" → flatPerMissing 步进固伤
  { id: "e36-30", re: new RegExp(`^(?:自身|自己)?每损失${NUM}点体力(?:值)?(?:则)?(?:额外)?附加${NUM}点(?:固定)?伤害$`),
    go: (m) => ({ attachDamage: { flatPerMissing: { step: num(m[1]), add: num(m[2]) } } }) },
  // "自身立刻恢复N/M生命值" → heal frac（立刻/生命值变体）
  { id: "e36-31", re: new RegExp(`^(?:自身|自己)(?:立刻|立即|马上)?恢复${NUM}\\s*/\\s*${NUM}(?:生命值|体力值?|HP)$|^恢复(?:自身|自己)?${NUM}\\s*/\\s*${NUM}(?:生命值|体力)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] }; } },
  // "(使)自身X力和对手相同" → copy_stages{stat,match,target:self}（match 语义：target 侧被改写为另一侧同维）
  { id: "e36-32", re: new RegExp(`^(?:使|令)?(?:自身|自己)?(?:的)?(${STAT_RE})力?(?:和|与)(?:对手|对方|敌方)(?:的)?相同$`),
    go: (m) => ({ effects: [{ op: "copy_stages", stat: STATS[m[1]], match: true, target: "self" }] }) },
  // ── d1（技能反应窗）：后延封锁/出伤压制/命中失效 ──────────────────────
  // 这三句全库都是“若对手使用X技能，则使用X技能后的下N回合…”整句（尾句独立出现 0 次）：
  // 逗号把题干与后文切成两段，前段由 heal-148a/148b 立起 dynTrigger{trigger:3,cat}，后段就是下面这些尾句。
  // 所以规则只认尾句、发裸 payload op（带自己的 N 回合窗），由匹配循环的 dynTrigger 通道收进 react——不碰匹配循环，也不重复触发词。
  // d1-tail-attr-dmgdown：“…使用属性技能后的下N回合造成的攻击伤害减少X点”（梅林/豹豹大师/罗萨）。
  // 语义是「对手出伤被削 X 点」，而 react payload 里只有 self 派生的 dmg_reduce（承伤定额减免）这一格；
  // payload 的 target 相对持有者解析（"opponent"=触发方=出招方），故 dmg_reduce 挂对手=削其出伤。
  { id: "d1-tail-attr-dmgdown", re: new RegExp(`^使用属性技能后的下${NUM}回合造成的攻击伤害减少${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "opponent", params: { flat: num(m[2]) }, turns: num(m[1]) }] }) },
  // d1-tail-status-hitfx：“…使用攻击技能后的下N回合属性技能命中效果失效”（空元行者/夜居魔使）。
  { id: "d1-tail-status-hitfx", re: new RegExp(`^使用攻击技能后的下${NUM}回合属性技能命中效果失效$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hit_fx_null", target: "opponent", params: { cat: 1 }, turns: num(m[1]) }] }) },
  // d1-tail-move-lock：“…使用(属性|攻击)技能后的下N回合无法使用(攻击|属性)技能”（森曼/罗库/梅林）。
  // 封锁类别取尾句里被锁的那一类，与题干类别不必相同（全库三种搭配：属→攻/属→属/攻→攻）。
  { id: "d1-tail-move-lock", re: new RegExp(`^使用(属性|攻击)技能后的下${NUM}回合无法使用(属性|攻击)技能$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", params: { cat: m[3] === "属性" ? 1 : 4 }, turns: num(m[2]) }] }) },
  // "对手使用属性技能则下N回合无法使用攻击技能" → react{trigger:3,cat:1} payload status_lock{cat:4}
  { id: "e36-33", re: new RegExp(`^(?:若|如果)?(?:对手|对方|敌方)(?:使用|选择了?)(?:的)?属性技能(?:则|后|时)(?:其|对手)?(?:使用属性技能的)?下${NUM}回合(?:内)?无法使用攻击技能$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 3, cat: 1 }, payload: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 4 } }] }] }) },
  // "若对手命中则下N回合对手使用属性技能无效" → react{trigger:1} payload status_lock{cat:1}（命中≈受到伤害通道）
  { id: "e36-34", re: new RegExp(`^(?:若|如果)(?:对手|对方|敌方)(?:技能)?命中(?:时|后|则)下${NUM}回合(?:内)?(?:对手|对方|敌方)?(?:使用)?属性技能无效$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1 }, payload: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 1 } }] }] }) },
  // "下N次攻击技能无视攻击免疫效果" → pierce/免疫穿透窗（count 次数制）
  { id: "e36-35", re: new RegExp(`^下${NUM}次攻击(?:技能)?无视(?:攻击)?免疫(?:效果|状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pierce", target: "self", params: { count: num(m[1]) } }] }) },
  // "每次攻击不消耗PP值"已由 e36-08 覆盖
  // ── react 负载级碎句（触发器已包外层，负载子句独立可解）──
  // "自身死亡"/"令自身死亡" — 反应窗内自灭（"若MISS则自身死亡"负载位）
  { id: "e36-38", re: /^(?:使|令|让)?(?:自身|自己)死亡$/, go: () => ({ effects: [{ op: "damage", power: 100, kind: "percent", target: "self" }] }) },
  // "(使用属性技能的)下N回合无法使用(攻击|属性)技能" — 后延技能封锁
  { id: "e36-39", re: new RegExp(`^(?:使用属性技能的)?下?${NUM}回合(?:内)?(?:对手|对方|敌方)?无法使用(攻击|属性)技能$`), go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: m[2] === "属性" ? 1 : 4 } }] }) },
  // "每回合解除并反馈自身能力下降状态" → down_push_tick（回合末清负级并压给对手）
  { id: "e36-40", re: /^每回合(?:解除|消除)(?:并|后)?(?:反馈|转移)(?:自身|自己)?的?能力(?:下降|降低)状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "down_push_tick", target: "self", turns: 1 })] }) },
  // "每回合解除自身能力下降状态" → cleanse_down_tick
  { id: "e36-41", re: /^每回合(?:解除|消除)(?:自身|自己)?的?能力(?:下降|降低)状态$/, go: () => ({ effects: [liftTick({ op: "apply_status", name: "cleanse_down_tick", target: "self", turns: 1 })] }) },
];
