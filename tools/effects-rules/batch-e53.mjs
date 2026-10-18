// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e53：no-rule 聚类高频家族收口（纯 parser/数据层）——
//   stage 词形补全（"改变自身防御加1"/"提高自身2级攻击"/"降为0点"）；
//   反应窗补全：per-hit 概率（trigger12）、承伤概率/阈值（trigger1）、对手出招 cat 门（trigger3）、
//     对手切换（trigger9）、每回合用招（trigger11）、能力提升被消（trigger7）、能力下降被解（trigger13）；
//   PP 域：消耗倍率/随机归零/降点；承伤域：dmg_cap/dmg_reduce/dodge/reflect_dmg；
//   出伤域：minDamage/powerPerUse+useCap/critChanceFrac/crit_up/flatFrac 基线；
//   周期域：hot/foe_dot/drain_dot flat 与分数；状态域：immune_status/reflect_status/heal_block/
//     dmg_weaken/cleanse timed/clear_stages stats；击杀条件：foeFainted 谓词（修正"击败对手"方向）；
//   nextAlly/onEnterTarget（"出战时X" 承前己方下只精灵语境）；
//   具名状态→apply_mark 近似（神游/狂信/星赐/星哲/威怯等未建模名，名存可审）。
import { NUM, num, frac, STATS, STAT_RE, ALL_STATS, AILMENTS, AIL_RE, stageFx, TYPE_RE, CONTROL_AILS, ALL_AILS, STAT_CODE } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

/** 统计名集合 → stage code 列表（含双攻/双防/全属性缩写）。 */
const statExpand = (s) => [...s.matchAll(new RegExp(`${STAT_RE}|双攻|双防|攻速|全属性|所有属性|所有能力`, "g"))]
  .flatMap((x) => x[0] === "双攻" ? ["atk", "spa"] : x[0] === "双防" ? ["def", "sdf"] : x[0] === "攻速" ? ["atk", "spd"] : /全属性|所有属性|所有能力/.test(x[0]) ? ALL_STATS : [STATS[x[0]]]).filter(Boolean);

/** 具名状态黑名单——这些词形属于既有语义域，不得落 mark（防御性兜底）。 */
const MARK_BAN = /^(?:异常|能力|伤害|体力|回合|效果|状态|护盾|护罩|先机|先手|先制|提升|下降|等级|攻击|防御|特攻|特防|速度|命中|技能|无效|免疫|恢复|回复|致命|翻倍|减半|胜利|死亡|使用|出手|强化|弱化|混乱)/;

export const rules = [

  // ===== 能力等级词形补全 =====
  // "改变自身防御加1"/"改变对方防御、特防的等级-1"——动词尾（加/减/提升/降低/上升/下降）或"的等级±N"
  { id: "e53-stg-01",
    re: new RegExp(`^(?:改变|减少|降低)(自身|自己|对方|对手|敌方|目标)((?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性)(?:[、，,，和](?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性))*)(?:的)?(?:(等级)([+-])|(加|减|提升|提高|增强|降低|减少|下降|上升))${NUM}(?:个)?(?:等级|级)?$`),
    go: (m) => {
      const side = /自身|自己|本方|己方/.test(m[1]) ? "self" : "opponent";
      const stats = statExpand(m[2]);
      if (stats.length === 0) return null;
      const neg = m[4] === "-" || /减|降低|下降/.test(m[5] ?? "") || /^减少|降低/.test(m[0]);
      const d = (neg ? -1 : 1) * num(m[6]);
      return { effects: stats.map((s) => stageFx(s, d, side)) };
    },
  },
  // "提高自身2级攻击"/"降低对手1级防御"——动词+N级+STAT 语序
  { id: "e53-stg-02",
    re: new RegExp(`^(提升|提高|增强|降低|减少|下降)(自身|自己|对方|对手|敌方|目标)?${NUM}级(${STAT_RE}|双攻|双防|全属性)(?:的)?(?:等级)?$`),
    go: (m) => {
      const neg = /降低|减少|下降/.test(m[1]);
      const side = /对方|对手|敌方/.test(m[2] ?? "") ? "opponent" : "self";
      const stats = statExpand(m[4]);
      if (stats.length === 0) return null;
      return { effects: stats.map((s) => stageFx(s, (neg ? -1 : 1) * num(m[3]), side)) };
    },
  },
  // "将对手的攻击和特攻能力降为0点"→clear_stages stats（置零语义=清双侧等级）
  { id: "e53-stg-03",
    re: new RegExp(`^(?:将|使|令)(?:对手|对方|敌方)的?((?:${STAT_RE})(?:(?:和|与|、|，|,)(?:${STAT_RE}))*)的?(?:能力|等级)?降(?:为|至|到|低?至)0(?:点|级|个等级)?$`),
    go: (m) => {
      const stats = statExpand(m[1]);
      if (stats.length === 0) return null;
      return { effects: [{ op: "clear_stages", target: "opponent", stats }] };
    },
  },
  // "先出手N%使对手STAT±M"→stage + order:first 门（"先出手100%使对手防御-1"）
  { id: "e53-stg-04",
    re: new RegExp(`^先出手${NUM}%?(?:的?(?:概率|几率))?(?:使|令)(?:对手|对方|敌方)(${STAT_RE})([+-])${NUM}$`),
    go: (m) => ({ effects: [{ ...stageFx(STATS[m[2]], (m[3] === "-" ? -1 : 1) * num(m[4]), "opponent", num(m[1])), if: { order: "first" } }] }),
  },
  // "每回合提升攻击+1，速度+1"/"每回合提升特攻等级+1"——逐维 stage_tick（逗号由分句器切开，本规则收单段多维亦行）
  { id: "e53-stg-05",
    re: new RegExp(`^每回合(?:提升|提高|增加)(?:自身|自己)?(.+)$`),
    go: (m) => {
      const out = [];
      for (const p of m[1].split(/[，,、]/)) {
        const pm = p.match(new RegExp(`^(${STAT_RE}|双攻|双防|攻速|全属性|所有属性)(?:的)?(?:等级)?[+＋\\-－]?(${NUM})(?:个)?(?:等级|级)?$`));
        if (pm === null) return null;
        const neg = /[-－]/.test(pm[2]);
        for (const s of statExpand(pm[1])) out.push(liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: STAT_CODE[s] ?? 1, delta: (neg ? -1 : 1) * num(pm[3]) } }));
      }
      return out.length > 0 ? { effects: out } : null;
    },
  },
  // "每回合恢复N/M(的体力|HP)?"→hot 分数（"每回合恢复1/4的体力"/"每回合恢复1/3"——体力后缀可缺）
  { id: "p2-hot-01",
    re: /^(?:自身|自己)每回合恢复(?:自身|自己)?(?:的)?(?:([0-9]+|一|二|两|三|四|五|六|七|八|九|十)s*\/s*([0-9]+|一|二|两|三|四|五|六|七|八|九|十)|([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:点)?)(?:体力|HP|血量)$/,
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: ns.length > 1 ? { n: ns[0], d: ns[1] } : { flat: ns[0] } }] }; },
  },
  { id: "e53-hot-01",
    re: new RegExp(`^每回合恢复(?:自身|自己)?(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:体力|HP|生命|血量)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "(每回合)?附加自身体力与STAT总和N%固伤"——体力+属性混合基数未建模 → 留档
  { id: "e53-def-05",
    re: /^(?:每回合)?附加(?:自身|自己)(?:的)?(?:体力|HP|生命)(?:与|和|、|\+)[一-龥]{1,4}(?:的)?总和\d+%/,
    go: () => ({ unparsedReason: "hp+stat composite flat base unmodeled (deferred)" }) },

  // ===== 反应窗补全 =====
  // "每回合使用技能(时|则)?X"→react trigger11（持有方每次出招）
  { id: "e53-use-01", re: /^每回合使用技能(?:时|后|则)?(.+)$/,
    go: (m) => reactWrap(11, {}, m[1]) },
  // "(对手|对方)用属性技能则X"/"对手若使用攻击技能则X"/"若对手使用属性攻击则X"→react trigger3 cat 门
  { id: "e53-foe-01",
    re: /^若?(对手|对方|敌方)(?:若)?(?:用|使用|选择|释放)(属性技能|属性攻击|物理攻击|物理技能|特殊攻击|特殊技能|攻击技能|先手技能|先制技能)(?:时|后|则|，|,)?(.+)$/,
    go: (m) => {
      const kw = m[2];
      const guard = /先手|先制/.test(kw) ? { prioMin: 1 } : { cat: /属性/.test(kw) ? 1 : /物理/.test(kw) ? 2 : /特殊/.test(kw) ? 3 : 4 };
      return reactWrap(3, guard, m[3]);
    },
  },
  // "若对手当回合切换精灵则X"→react trigger9（对手换入时观察方 payload）
  { id: "e53-foe-02",
    re: /^若?(对手|对方|敌方)(?:当|本)?回合(?:主动)?切换(?:精灵|下场)(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(9, {}, m[2]) },
  // "对手用属性技能受到150伤害"式：触发方承伤（reactWrap 内部把无主语"受到N伤害"改写为对手承伤）
  { id: "e53-foe-03",
    re: /^若?(对手|对方|敌方)用(属性技能|攻击技能)(?:，|,)?(.+)$/,
    go: (m) => reactWrap(3, { cat: m[2] === "属性技能" ? 1 : 4 }, m[3]) },
  // "每次攻击(都)?有N%(概率|几率)?X"/"每回合攻击(有|都)N%X"/"所有直接攻击(都|将)有N%X"→react trigger12+chance
  { id: "e53-hit-01",
    re: new RegExp(`^(?:每次|每回合|所有|一切)(?:直接)?攻击(?:都|将|后|有)*${NUM}%(?:的)?(?:概率|几率|机率)?(.+)$`),
    go: (m) => reactWrap(12, { chance: num(m[1]) }, m[2]) },
  // "攻击低于N次则每次M%几率令对手AIL"——连击技第 1..N-1 次命中挂概率（trigger12 count=N-1 近似 hit-count 门）
  { id: "e53-hit-01b",
    re: new RegExp(`^(?:攻击|出手)(?:次数)?(?:低于|少于|不足|不到)${NUM}次(?:则|，|,)?(?:每次)?(?:攻击)?${NUM}%?(?:的)?(?:概率|几率|机率)?(.+)$`),
    go: (m) => reactWrap(12, { chance: num(m[2]), count: Math.max(1, num(m[1]) - 1) }, m[3]) },
  // "每回合有N%(概率|几率|机率)X"——周期概率派发（ailment_tick 载荷层 chance）
  { id: "e53-tick-01",
    re: new RegExp(`^每回合有?${NUM}%(?:的)?(?:概率|几率|机率)(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0) return null;
      const ch = num(m[1]);
      return { effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: sub.effects.map((e) => ({ ...e, chance: e.chance !== undefined ? Math.round(e.chance * ch / 100) : ch })) })], ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "每回合额外附加N%几率使对手AIL"——概率尾同样走 ailment_tick
  { id: "e53-tick-02",
    re: new RegExp(`^每回合(?:额外)?附加${NUM}%(?:的)?(?:概率|几率|机率)?(使|令)(对手|对方|敌方)(.+)$`),
    go: (m) => {
      const sub = parseEffectText(`${m[2]}${m[3]}${m[4]}`);
      if (sub.effects.length === 0) return null;
      const ch = num(m[1]);
      return { effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: sub.effects.map((e) => ({ ...e, chance: e.chance !== undefined ? Math.round(e.chance * ch / 100) : ch })) })], ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "受攻击N%(使|令)?(对手)?X"/"受到攻击N%X"→react trigger1+chance
  { id: "e53-hit-02",
    re: new RegExp(`^(?:受到|受)(?:到)?攻击${NUM}%?(?:的)?(?:概率|几率|机率)?(.+)$`),
    go: (m) => reactWrap(1, { chance: num(m[1]) }, m[2]) },
  // "受到伤害超过N对手X"/"受到的伤害大于N对手X"→react trigger1 min 门（>N 严格——dmgMin 语义 dmg<=min 不触发，故 min=N）
  { id: "e53-hit-03",
    re: new RegExp(`^受到(?:的)?伤害(?:超过|大于)${NUM}(?:点)?(?:，|,|则)?(.+)$|^受到伤害超过${NUM}(?:点)?(?:，|,|则)?(.+)$`),
    go: (m) => reactWrap(1, { min: num(m[1] ?? m[3]) }, m[2] ?? m[4]) },
  // "受到攻击(时)?(使|令)?对手X" 裸形（无概率）——react trigger1
  { id: "e53-hit-04",
    re: /^(?:受到|受)攻击(?:时|后)?(?:，|,)?(?:使|令)(对手|对方|敌方)(.+)$/,
    go: (m) => reactWrap(1, {}, `令${m[1]}${m[2]}`) },
  // "若对手受到(特攻|物理|攻击)伤害则X"→react trigger12 cat 门（我方打击令对手承伤=持有方命中）
  { id: "e53-hit-05",
    re: /^若?(对手|对方|敌方)受到(特殊攻击|特殊|特攻|物理攻击|物理|攻击|致命)?伤害(?:时|后|则|，|,)?(.+)$/,
    go: (m) => {
      if (/致命/.test(m[2] ?? "")) return { unparsedReason: "foe lethal-hit survival clause — leaveHp rider needs move-host (deferred)" };
      const cat = m[2] === undefined ? 4 : /特殊|特攻/.test(m[2]) ? 3 : /物理/.test(m[2]) ? 2 : 4;
      return reactWrap(12, { cat }, m[3]);
    },
  },
  // "若自身能力(提升|强化|状态)?(效果)?被(消除|清除|吸取)则X"→react trigger7（持有方正级被清）
  { id: "e53-trg7-01",
    re: /^若?(自身|自己)?能力(提升|强化|状态)?(?:的)?(?:状态|效果)?被(?:对手|对方|敌方)?(消除|清除|吸取|驱散)(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(7, {}, m[4]) },
  // "若自身能力下降(状态)?被解除则X"→react trigger13（持有者 debuff 被净化）
  { id: "e53-trg13-01",
    re: /^若?(自身|自己)能力(下降|弱化)(?:的)?状态被(?:解除|净化|消除)(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(13, {}, m[3]) },
  // "若未恢复体力则X"/"若恢复失败则X"——react 负载链 prevApplied（heal 满血发 action-failed → prevApplied=false）
  { id: "e53-heal-01",
    re: /^若?未(?:恢复|回复|吸取)(?:到)?(?:体力|HP|生命)(?:则|时|，|,)?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1]);
      if (sub.effects.length === 0) return { unparsedReason: `heal-fail payload unparsed: ${m[1]}` };
      return { effects: sub.effects.map((e) => ({ ...e, if: resolveCond(e.if, { not: { prevApplied: true } }) })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "(解除|消除|吸取|吸收|无视|反转|命中|弱化|强化|反弹)成功(则)?X" 粘连形→payload 挂 prevApplied 门
  { id: "e53-prev-01",
    re: /^(解除|消除|吸取|吸收|无视|反转|命中|弱化|强化|反弹)成功(?:则|时|，|,)?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0) return { unparsedReason: `prevApplied payload unparsed: ${m[2]}` };
      return { effects: sub.effects.map((e) => ({ ...e, if: resolveCond(e.if, { prevApplied: true }) })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },

  // ===== PP 域 =====
  // "(对手|对方|敌方)(释放|使用)技能(所有|所)?消耗的?(PP|pp)(值)?为N倍"→pp_mul 对手侧
  { id: "e53-pp-01",
    re: new RegExp(`^(?:对手|对方|敌方)(?:释放|使用)技能(?:所有|所)?消耗的?(?:PP|pp)(?:值)?为${NUM}倍$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: "opponent", params: { mul: num(m[1]) } }] }) },
  // "N%降低对手M点pp值"/"100%降低对方PP2点"→pp_delta amount:-M 对手
  { id: "e53-pp-02",
    re: new RegExp(`^(?:降低|减少|扣除|消耗)(?:对手|对方|敌方)${NUM}点?(?:PP|pp)(?:值)?$|^(?:降低|减少)(?:对方|对手|敌方)(?:PP|pp)${NUM}点$|^(?:使|令)(?:对手|对方|敌方)(?:PP|pp)(?:值)?-${NUM}$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[1] ?? m[2] ?? m[3]), target: "opponent" }] }) },
  // "对手随机N项技能pp值归零"→pp_delta zeroRandom（e33-pp-01 的词形补漏："2项技能pp值"）
  { id: "e53-pp-03",
    re: new RegExp(`^(?:对手|对方|敌方)随机${NUM}(?:项|个|只)?技能(?:(?:的)?(?:PP|pp)(?:值)?(?:归零|归0|为0|变0))$|^随机(?:使|令)?(?:对手|对方|敌方)?${NUM}(?:项|个)技能PP(?:值)?归零$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "双方/自身所有技能PP值均不为满时恢复PP值"→保残（条件域 selfPpAllNotFull 未建模）
  { id: "e53-pp-04",
    re: /PP值?均不?为满|PP值?不满时恢复|其他攻击技能附加/,
    go: () => ({ unparsedReason: "moveset-scope PP/flat rider — clause needs per-move mount (deferred)" }) },

  // ===== 承伤域 =====
  // "每回合(被攻击|受到攻击)…伤害(不会|不)?超过N"→dmg_cap（attach-damage-99 的"不会超过"/"受到攻击"变体补全）
  { id: "e53-cap-01",
    re: new RegExp(`^每回合(?:被攻击|受到攻击|受攻击|被攻击攻击)?(?:所)?受到?的?(?:攻击)?伤害(?:不会|不|未)?超过${NUM}(?:点)?$|^每回合被攻击所受到的伤害不会超过${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2]) } }] }) },
  // "每回合受到伤害-N"→dmg_reduce flat（定额承伤减免窗）
  { id: "e53-cap-02",
    re: new RegExp(`^每回合受到(?:的)?伤害-${NUM}$|^每回合(?:受到|受)攻击伤害-${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "使对方攻击伤害(为|是)正常(状态|情况)?(下)?(的|了)?N/M(倍)?"→dmg_weaken（attach-damage-88 词形补全："了1/2"/"正常下"）
  { id: "e53-cap-03",
    re: new RegExp(`^使(对方|对手|敌方)攻击伤害(?:为|是)正常(?:状态|情况)?下?(?:的|了)?${NUM}\\s*/\\s*${NUM}(?:倍)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: num(m[2]), d: num(m[3]) } }] }) },
  // "每回合有N%闪避对手攻击"→dodge pct
  { id: "e53-cap-04",
    re: new RegExp(`^每回合有?${NUM}%(?:的?(?:概率|几率))?闪避(?:对手|对方|敌方)?的?(?:攻击|伤害)$|^每回合(?:自身)?${NUM}%闪避`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: num(m[1] ?? m[2]) } }] }) },
  // "每回合反弹对方伤害N/M"/"将受到的伤害N倍反馈给对方"→reflect_dmg{n,d}
  { id: "e53-cap-05",
    re: new RegExp(`^每回合反弹(?:对方|对手|敌方)?(?:的)?(?:攻击)?伤害${NUM}\\s*/\\s*${NUM}$|^每回合反弹(?:对方|对手)${NUM}\\s*/\\s*${NUM}(?:的)?伤害?$|^将受到?的?(?:攻击)?伤害${NUM}倍反馈(?:给)?(?:对方|对手|敌方)$|^将受到?的?伤害${NUM}倍反弹$`),
    go: (m) => {
      const ns = m.slice(1).filter((x) => x !== undefined).map(num);
      const p = ns.length === 1 ? { n: ns[0], d: 1 } : { n: ns[0], d: ns[1] };
      return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: p }] };
    },
  },
  // "自身受到直接攻击的伤害N%反馈给对手"→reflect_dmg pct
  { id: "e53-cap-06",
    re: new RegExp(`^(?:自身|自己)?受到(?:直接)?攻击(?:的)?伤害${NUM}%(?:的)?(?:反馈|反弹|返还)给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // "每回合攻击恢复自身体力N/M"→drain_atk 分数窗（"攻击恢复"=出伤吸血持续语义）
  { id: "e53-cap-07",
    re: new RegExp(`^每回合攻击(?:恢复|回复)(?:自身|自己)?(?:体力|HP)${NUM}\\s*/\\s*${NUM}$|^每回合攻击恢复自身体力${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // "受到攻击100%自身恢复N点HP"→react trigger1 heal flat
  { id: "e53-cap-08",
    re: new RegExp(`^受到(?:的)?攻击${NUM}%?(?:的?(?:概率|几率))?(?:使|令)?自身恢复${NUM}(?:点)?(?:HP|体力|生命)(?:值)?$`),
    go: (m) => reactWrap(1, { chance: num(m[1]) }, `恢复自身${num(m[2])}点体力`) },
  // "每回合受到攻击恢复N点HP"→react trigger1 heal flat（无概率=100%）
  { id: "e53-cap-09",
    re: new RegExp(`^每回合受到(?:的)?攻击恢复${NUM}(?:点)?(?:HP|体力|生命)(?:值)?$`),
    go: (m) => reactWrap(1, {}, `恢复自身${num(m[1])}点体力`) },

  // ===== 出伤域 =====
  // "每回合造成的伤害不少于N"→dmg_out_floor（持有方出伤下限窗；区别于招式级 minDamage）
  { id: "e53-dmg-01",
    re: new RegExp(`^每回合造成的伤害不少于${NUM}$|^每回合(?:造成|给予)(?:的)?(?:攻击)?伤害不低于${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", params: { min: num(m[1] ?? m[2]) } }] }) },
  // "造成的伤害不少于N"裸形→attachDamage minDamage（招式本体地板）
  { id: "e53-dmg-02",
    re: new RegExp(`^造成的伤害不少于${NUM}(?:点)?$|^造成伤害不少于${NUM}$`),
    go: (m) => ({ attachDamage: { minDamage: num(m[1] ?? m[2]) } }) },
  // "连续使用每次威力增加+N"（+号/威力前后置变体；"，最(高|多)M" cap 尾被 commaRaw 粘回同 part——内联吸收 → useCap）
  { id: "e53-dmg-03",
    re: new RegExp(`^连续使用(?:每次)?(?:(?:威力)?(?:增加|提升|提高|加)|增加威力)\\+?${NUM}(?:点)?(?:威力)?(?:[，,](?:最[高多])(?:提升|增加|提高|至|到|威力)?${NUM}(?:点)?(?:威力)?)?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), ...(m[2] !== undefined ? { useCap: num(m[2]) } : {}) } }) },
  // "每次使用增加N点(固定)?伤害，最多造成M点(固定)?伤害"——commaRaw 粘回的 flatPerUse+cap 复合段
  { id: "e53-dmg-03b",
    re: new RegExp(`^每次使用(?:增加|提升|额外增加|额外附加)${NUM}点(?:固定|固伤)?伤害[，,](?:最多|最高)(?:造成|附加|提升)?${NUM}点(?:固定|固伤)?伤害$`),
    go: (m) => ({ attachDamage: { flatPerUse: num(m[1]), flatPerUseCap: num(m[2]) } }) },

  // "打出致命一击概率增加N/M"/"致命一击机率上升N/M"→crit_up{n,d}
  { id: "e53-dmg-04",
    re: new RegExp(`^(?:打出|造成)?致命[一1]?击(?:的)?(?:概率|几率|机率|率)(?:增加|提升|提高|上升)${NUM}\\s*/\\s*${NUM}$|^致命[一1]?击率上升${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: ns[0], d: ns[1] } }] }; },
  },
  // "后出手的话威力翻倍/为N倍"（OCR 变体：未/为了为/威为）→scaleIf order:last
  { id: "e53-dmg-05",
    re: new RegExp(`^后出手(?:的话|时)?[，,]?(?:威力|威)(?:未|为|加倍|翻倍|加|至|了为)?${NUM}?倍$|^后出手的话威力翻倍$`),
    go: (m) => ({ attachDamage: { scaleIf: { when: { order: "last" }, numerator: m[1] !== undefined ? num(m[1]) : 2, denominator: 1 } } }) },
  // "附加对手已损失(生命值|HP|体力)N%(的固定伤害|固伤|伤害|固定值)?"→attachDamage flatFoeFrac{base:missing}
  { id: "e53-dmg-06",
    re: new RegExp(`^附加(?:对手|对方|敌方)已损失(?:生命值|HP|体力|生命)${NUM}%(?:的)?(?:固定伤害|固伤|伤害|固定值|血量)?$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: 100, base: "missing" } } }) },
  // "附加自身当前体力N/M的百分比伤害"→percent damage percentBase:selfCur
  { id: "e53-dmg-07",
    re: new RegExp(`^附加(?:自身|自己)当前体力${NUM}\\s*/\\s*${NUM}的?百分比伤害$|^附加自身当前体力${NUM}%(?:的)?百分比伤害$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const p = ns.length === 1 ? { numerator: ns[0], denominator: 100 } : { numerator: ns[0], denominator: ns[1] }; return { effects: [{ op: "damage", kind: "percent", power: 1, frac: p, percentBase: "selfCur", target: "opponent" }] }; },
  },
  // "附加自身当前体力N/M(的)?固定伤害|固伤"→attachDamage flatSelfFrac{base:current}
  { id: "e53-dmg-08",
    re: new RegExp(`^附加(?:自身|自己)当前体力${NUM}\\s*/\\s*${NUM}(?:的)?(?:固定伤害|固伤|固定值)$`),
    go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "current" } } }) },
  // "附加自身最大(HP|体力)N%的固定伤害"→attachDamage flatSelfFrac
  { id: "e53-dmg-09",
    re: new RegExp(`^附加(?:自身|自己)最大(?:HP|体力|生命值|生命)${NUM}%(?:的)?(?:固定伤害|固伤|固定值)$`),
    go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: num(m[1]), denominator: 100, base: "max" } } }) },
  // "附加对手防御力N%的固定伤害"→attachDamage flatFoeDefPct
  { id: "e53-dmg-10",
    re: new RegExp(`^附加(?:对手|对方|敌方)(?:防御|防御力)${NUM}%(?:的)?(?:固定伤害|固伤|固定值)$`),
    go: (m) => ({ attachDamage: { flatFoeDefPct: num(m[1]) } }) },
  // "直接减少对手1/N最大(HP|体力)"→percent damage（直接=独立结算段）
  { id: "e53-dmg-11",
    re: new RegExp(`^直接减少(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}最大(?:HP|体力|生命值|生命)(?:值)?$|^直接减少对手${NUM}%最大(?:HP|体力)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "percent", power: 1, frac: ns.length === 1 ? frac(ns[0], 100) : frac(ns[0], ns[1]), target: "opponent" }] }; },
  },
  // "随机降低对手N/M至P/Q当前体力值"→fracRange percent damage
  { id: "e53-dmg-12",
    re: new RegExp(`^随机(?:降低|减少)(?:对手|对方|敌方)?${NUM}\\s*/\\s*${NUM}至${NUM}\\s*/\\s*${NUM}(?:的)?(?:当前)?体力(?:值)?$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, fracRange: { min: frac(num(m[1]), num(m[2])), max: frac(num(m[3]), num(m[4])) }, percentBase: "current", target: "opponent" }] }) },
  // "给予对方伤害的N/M恢复为己方HP"/"造成伤害的N/M恢复自身体力"→attachDamage drain
  { id: "e53-dmg-13",
    re: new RegExp(`^给予(?:对方|对手|敌方)伤害的${NUM}\\s*/\\s*${NUM}恢复(?:为)?(?:己方|自身|自己)(?:HP|体力|生命)$|^(?:造成|给予)(?:对方|对手|敌方)?伤害${NUM}\\s*/\\s*${NUM}恢复(?:为)?(?:己方|自身|自己)(?:HP|体力)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { drain: frac(ns[0], ns[1]) } }; },
  },
  // "造成的伤害(都|将)恢复自身体力"→drain_atk 1/1（全额吸血窗）
  { id: "e53-dmg-14",
    re: /^造成的伤害(?:都|将|会)?恢复(?:自身|自己)?体力$|^造成的伤害回复体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 } }] }) },
  // "打出致命一击恢复满体力"/"打出致命一击恢复自身全部体力"→react trigger10+heal 1/1
  { id: "e53-dmg-15",
    re: /^打出致命[一1]?击(?:恢复|回复)(?:满|全部|所有)(?:体力|HP|生命)$/,
    go: () => reactWrap(10, {}, "恢复自身全部体力") },

  // ===== 周期域 =====
  // "每回合恢复N点(体力|血|血量|HP)?"/"每回合回复150P"/"每回合恢复130"→hot flat
  { id: "e53-tick-07",
    re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己)?${NUM}(?:点)?(?:体力|血量|血|HP|P|生命)?(?:值)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { flat: num(m[1]) } }] }) },
  // "每回合恢复自最大体力的N/M"（"自"缺"身"刮损变体）
  { id: "e53-tick-08",
    re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己|自)?最大体力${NUM}\\s*/\\s*${NUM}(?:的?体力|的?HP|的?生命值?)?$|^每回合恢复自最大体力的${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: ns[0], d: ns[1] } }] }; },
  },
  // "随机恢复N-M点(生命|体力|HP|血量|血)?"/"随机恢复200~400点伤害"(OCR"伤害"=体力) →heal flatRange
  { id: "e53-tick-03",
    re: new RegExp(`^随机(?:恢复|回复)${NUM}[-~～]${NUM}(?:点)?(?:自身|自己)?(?:体力|HP|生命|血量|血|伤害|固定HP)?(?:值)?$`),
    go: (m) => ({ effects: [{ op: "heal", flatRange: { min: num(m[1]), max: num(m[2]) }, target: "self" }] }) },
  // "令对手每回合受到N点固定伤害"→foe_dot flat（对手侧周期扣血窗）
  { id: "e53-tick-04",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)每回合(?:受到|收到|受)${NUM}点(?:固定|固伤)?伤害$|^令对手每回合收到${NUM}点固定伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "每回合附加(对手|对方)N点固定伤害"→foe_dot flat
  { id: "e53-tick-05",
    re: new RegExp(`^每回合附加(?:对手|对方|敌方)?${NUM}点(?:固定|固伤|固定伤)?伤害$|^每回合附加${NUM}伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // "每回合附加自身物理攻击N%的固定伤害"→dmg_flat atkPct（attack 值百分比固伤窗）
  { id: "e53-tick-06",
    re: new RegExp(`^每回合附加(?:自身|自己)(?:物理)?攻击${NUM}%(?:的)?(?:固定伤害|固伤|固定值)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { atkPct: num(m[1]) } }] }) },
  // "每回合攻击有N%几率使对手AIL"→react12 已由 e53-hit-01 收；此处收"每回合被攻击所受到的伤害"已收。

  // ===== 状态域 =====
  // "不会出现异常(状态|状况)"→immune_status（TURNS_PRE 已剥窗；"5回合内不会出现异常状态"）
  { id: "e53-st-01",
    re: /^(?:自身|自己|己方)?不会(?:出现|有|受到)异常(?:状态|状况|情况)(?:作用|影响)?$|^(?:自身|自己)?不受异常(?:状态|状况|情况)影响$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // "反弹所有受到的(异常|异样)(状态)?"→reflect_status
  { id: "e53-st-02",
    re: /^反弹(?:所有|全部|一切)?受到的?(?:异常|异样)(?:状态|情况)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self" }] }) },
  // "对手无法通过(自身)?技能(回复HP|回血|恢复体力)"→heal_block
  { id: "e53-st-03",
    re: /^(?:对手|对方|敌方)无法通过(?:自身|自己)?技能(?:回复HP|回血|恢复体力|回复体力|恢复HP|回复)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent" }] }) },
  // "自身不受能力下降类技能影响"/"不受能力下降影响"→immune_degrade
  { id: "e53-st-04",
    re: /^(?:自身|自己)?不受(?:对手|对方|敌方)?能力(?:下降|弱化)(?:类)?(?:技能|效果)?(?:影响|作用)$|^(?:自身|自己)免疫能力(?:下降|弱化)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "令对手当前拥有的回合类效果消失"→cleanse timed（"拥有"变体）
  { id: "e53-st-05",
    re: /^(?:使|令|消除)?(?:对手|对方|敌方)(?:当前|现在)?拥?有?的?回合类效果消失$/,
    go: () => ({ effects: [{ op: "cleanse", scope: "timed", target: "opponent" }] }) },
  // "解除自身能力下降状态(1回合)?"→clear_stages self sign:down
  { id: "e53-st-06",
    re: /^解除(?:自身|自己)能力(?:下降|弱化)(?:的)?状态(?:\d+回合)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // "令对方所有能力增强效果消失"补漏（"能增强"/"增强消失效果"词形——normalize 已归一，此处兜底裸形）
  { id: "e53-st-07",
    re: /^(?:令|使|消除)(?:对方|对手|敌方)所有(?:能力|能)?(?:增强|强化|提升)(?:效果|状态)?消失$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "解除成功恢复所有体力"→heal 1/1 + prevApplied（解除=前列 op 的成功谓词）
  { id: "e53-st-08",
    re: /^解除成功(?:则|，|,)?(?:恢复|回复)(?:自身|自己)?(?:所有|全部|满)体力$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", if: { prevApplied: true } }] }) },
  // "为自身附加N回合的<名>"/"附加N回合的<名>"→apply_mark turns（具名时限印记近似）
  { id: "e53-nm-01",
    re: new RegExp(`^(?:为|给|令|使)(自身|自己|对方|对手|敌方)?(?:附加|获得)${NUM}回合的?([一-龥]{2,6})$|^附加${NUM}回合的?([一-龥]{2,6})$`),
    go: (m) => {
      const mk = m[3] ?? m[5];
      const turns = num(m[2] ?? m[4]);
      if (mk === undefined || MARK_BAN.test(mk)) return null;
      const side = m[1] === undefined || /自身|自己/.test(m[1]) ? "self" : "opponent";
      return { effects: [{ op: "apply_mark", mark: mk, turns, target: side }] };
    },
  },
  // "(令|使)X(进入)?<具名>状态"→AILMENTS 命中走 apply_status，否则 apply_mark（神游/狂信/星赐/威怯 等未建模名存可审）
  { id: "e53-nm-02",
    re: /^(?:令|使|让)(自身|自己|对方|对手|敌方|己方|本方)(?:进入)?([一-龥]{2,5}?)(?:状态|的?印记)?$/,
    go: (m) => {
      const nm = (m[2] ?? "").replace(/状态$/, "");
      const side = /自身|自己|己方|本方/.test(m[1]) ? "self" : "opponent";
      if (AILMENTS[nm] !== undefined) return { effects: [{ op: "apply_status", name: AILMENTS[nm], target: side }] };
      if (MARK_BAN.test(nm) || /无效|免疫|翻倍|减半|状态|印记$/.test(nm) || nm.length < 2) return null;
      return { effects: [{ op: "apply_mark", mark: nm, target: side }] };
    },
  },
  // "出战时N%<AIL>"——承前"令己方下只出战精灵X"语境：nextAlly 登场时对对手生效（onEnterTarget=opponent）
  { id: "e53-entry-01",
    re: new RegExp(`^(?:且|并)?出战时${NUM}%?(?:的?(?:概率|几率))?(?:进入)?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "nextAlly", onEnterTarget: "opponent", ...(num(m[1]) < 100 ? { chance: num(m[1]) } : {}) }] }) },
  // "出战时N%<具名>"——非异常名录落 mark（砥砺/凝滞 等）
  { id: "e53-entry-02",
    re: new RegExp(`^(?:且|并)?出战时${NUM}%?(?:的?(?:概率|几率))?(?:进入)?([一-龥]{2,5})(?:状态)?$`),
    go: (m) => {
      const mk = m[2];
      if (MARK_BAN.test(mk) || /状态|印记$/.test(mk)) return null;
      return { effects: [{ op: "apply_mark", mark: mk, target: "nextAlly", onEnterTarget: "opponent", ...(num(m[1]) < 100 ? { chance: num(m[1]) } : {}) }] };
    },
  },
  // "牺牲自己使下回合出场精灵X"→selfHp 自杀 + nextAlly payload（"必定命中/先手/致命" flags 折成下只精灵状态）
  { id: "e53-sac-01",
    re: /^牺牲(?:自己|自身|自我)(?:，|,|。)?(?:使|令)?下(?:回合|一?只|个)(?:回合|出场|出战|登场|上场)?的?(?:己方|本方)?精灵(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1].replace(/^第一回合/, "下回合")); // 换入语境"第一回合"≡新精灵的下回合（窗等价）
      const payload = [...sub.effects.map((e) => ({ ...e, target: "nextAlly" }))];
      if (sub.flags?.accuracy === "always") payload.push({ op: "apply_status", name: "must_hit", target: "nextAlly", turns: 1 });
      if (sub.flags?.priority !== undefined) payload.push({ op: "apply_status", name: "prio_up", target: "nextAlly", turns: 1, params: { add: sub.flags.priority } });
      if (sub.flags?.attachDamage?.crit === true || sub.flags?.crit === true) payload.push({ op: "apply_status", name: "crit_up", target: "nextAlly", turns: 1, params: { n: 1, d: 1 } });
      if (payload.length === 0) return { unparsedReason: `sacrifice payload unparsed: ${m[1]}` };
      return { effects: [{ op: "damage", kind: "fixed", power: 0, target: "self", selfHp: true }, ...payload], ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // ===== 补遗家族 =====
  // "(自身|对手)STAT(和STAT)*等级±N"——无动词裸形（"对方物攻和特攻等级-1"，bcm 剥完概率后抵达）
  { id: "e53-stg-06",
    re: new RegExp(`^(自身|自己|对方|对手|敌方)((?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性)(?:[、，,，和](?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性))*)(?:的)?等级([+-])${NUM}$`),
    go: (m) => {
      const stats = statExpand(m[2]);
      if (stats.length === 0) return null;
      const d = (m[3] === "-" ? -1 : 1) * num(m[4]);
      return { effects: stats.map((s) => stageFx(s, d, /自身|自己/.test(m[1]) ? "self" : "opponent")) };
    },
  },
  // "使自身获得一个(可|可以|能够)?吸收N点伤害的护盾"→shield flat（吸收/抵挡词形并入）
  { id: "e53-sh-01",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?获得一?个?(?:可|可以|能够|能)?(?:吸收|抵挡)${NUM}点伤害的护盾$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1]) } }] }) },
  // 顿号/逗号粘连的速度+防御强化。和/及整句不拆开写成排序旗标（测试锁定为 no-rule）
  { id: "e53-pie-01",
    re: /^无视对手(?:速度|速率)(?:、|，|,)(?:所有|全部)?(?:防御|防守)能力(?:提升|强化|增强)(?:的)?(?:状态)?$/,
    go: () => ({ flags: { ignoreFoeSpeed: true }, effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // "每次造成的伤害值(都|将|会)?恢复(为)?自身体力"→drain 1/1（全额吸血）
  { id: "e53-drn-01",
    re: /^每次造成的?伤害值?(?:都|将|会|并)?恢复(?:为|成)?(?:自身|自己)的?体力$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // "每次(直接攻击)?造成伤害的N/M恢复(为)?体力"→drain 分数
  { id: "e53-drn-02",
    re: new RegExp(`^每次(?:直接攻击)?造成(?:的)?伤害(?:的)?${NUM}\\s*/\\s*${NUM}恢复(?:为|成)?(?:自身|自己)?的?体力$`),
    go: (m) => ({ attachDamage: { drain: frac(m[1], m[2]) } }) },
  // "每回合反弹对手的N/M伤害"/"反弹对手N/M伤害"→reflect_dmg 分数
  { id: "e53-refl-01",
    re: new RegExp(`^(?:每回合)?反弹(?:对手|对方|敌方)(?:的)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:(?:攻击)?伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "(使|令)?对手属性技能(N%)?(概率)?失效"→move_null cat:1 chance
  { id: "e53-mvnull-01",
    re: new RegExp(`^(?:使|令)?(对手|对方|敌方)(?:的)?属性技能(?:有)?${NUM}?%?(?:的)?(?:概率|几率)?失效$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, ...(m[2] !== undefined ? { chance: num(m[2]) } : {}) }] }) },
  // "解除自身能力下降(等级|状态)"→clear_stages sign:down self
  { id: "e53-cls-01",
    re: /^(?:解除|消除|清除)(?:自身|自己)的?能力(?:下降|弱化)(?:的)?(?:等级|状态|效果)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // "(最多|最高)(提升|增加|造成)?N(点)?(威力|固定伤害|固伤|伤害)?"→capTail 点值域（宿主由 capTail 路由器认领：powerPerUse→useCap/flatPerUse→flatPerUseCap）
  { id: "e53-ctail-01",
    re: new RegExp(`^(?:最多|最高)(?:提升|增加|提高|造成|附加)?${NUM}(?:点)?(?:固定|固伤|伤害|威力)?$`),
    go: (m) => ({ attachAll: { capTail: { value: num(m[1]), unit: "点", src: m[0] } } }) },
  // "攻击伤害是正常(状态下|情况|情况下的)?N倍"→powerMul
  { id: "e53-pct-01",
    re: new RegExp(`^(?:攻击|技能)?伤害是正常(?:状态|情况)(?:下|的)?的?${NUM}倍$|^攻击伤害是正常的${NUM}倍$`),
    go: (m) => ({ attachDamage: { powerMul: frac(num(m[1] ?? m[2]), 1) } }) },
  // "恢复效果和固伤(效果|值)?翻倍"→healDouble+flatDouble（attach-damage-22 的"固伤"词形变体）
  { id: "e53-hdbl-01",
    re: /^恢复效果和固伤(?:效果|值)?翻倍$|^恢复与固伤(?:效果|值)?翻倍$/,
    go: () => ({ attachAll: { healDouble: true, flatDouble: true } }) },
  // "令对方所有能力(增强|强化|提升)?效果消失"/"消除对方所有(属性)?强化效果"→clear_stages up
  { id: "e53-clr-01",
    re: /^(?:令|使|消除|清除)(?:对方|对手|敌方)(?:的)?所有(?:能力|属性)?(?:增强|强化|提升|增益)(?:的)?效果?消失$|^(?:令|使|消除|清除)(?:对方|对手|敌方)(?:的)?所有(?:能力|属性)?(?:增强|强化|提升)效果$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "(自身)?(不会|不会受到|无法|不能)(再)?出现异常状态"→immune_status（持有者异常免疫窗）
  { id: "e53-imm-01",
    re: /^(?:自身|自己)?(?:不会|不会受到|无法|不能)(?:再)?出现(?:任何|所有)?异常状态$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // "附加自身STAT值N%的X伤害"→flatSelfStatPct（e17 的"百分比伤害/伤害"后缀变体；"附加自身速度值17%的百分比伤害"）
  { id: "e53-flat-01",
    re: new RegExp(`^附加(?:自身|自己)(${STAT_RE})(?:的)?值?${NUM}%(?:的)?(?:固定伤害|固伤|百分比伤害|伤害|固定值)$`),
    go: (m) => { const s = STATS[m[1]]; if (s === undefined || s === "acc") return null; return { attachDamage: { flatSelfStatPct: { stat: s, pct: num(m[2]) } } }; } },
  // "(改变|转为|变成)(对方)?<AIL>(状态)?"→apply_status（"15%改变对方害怕"——改变为某异常）
  { id: "e53-ail-01",
    re: new RegExp(`^(?:改变|转为|变成)(${STAT_RE}|对方|对手|敌方|自身|自己)?(${AIL_RE})(?:状态)?$`),
    go: (m) => { const ail = AILMENTS[m[2]]; if (ail === undefined || STATS[m[1] ?? ""] !== undefined) return null; return { effects: [{ op: "apply_status", name: ail, target: /对方|对手|敌方/.test(m[1] ?? "") ? "opponent" : "self" }] }; } },
  // "令对方所有能力增强效果消失N%令对方AIL回合无法攻击"——清强化+概率控制复合（"消失10%令对方疲惫1回合无法攻击"）
  { id: "e53-ailturn-01",
    re: new RegExp(`^(?:令|使|消除)(?:对方|对手|敌方)所有能力(?:增强|强化|提升)效果消失${NUM}%(?:概率|几率)?令(?:对方|对手|敌方)(${AIL_RE})${NUM}回合(?:内)?(?:无法攻击|不能行动)$`),
    go: (m) => { const ail = AILMENTS[m[2]]; if (ail === undefined) return null; return { effects: [{ op: "clear_stages", target: "opponent", sign: "up" }, { op: "apply_status", name: ail, target: "opponent", chance: num(m[1]), turns: num(m[3]) }] }; } },
  // "附加自身当前<X值>等量的固定伤害"→flatPerMark（互动值/充能值等具名计数资源，量=层数）
  { id: "e53-mark-01",
    re: /^附加(?:自身|自己)当前([一-龥]{1,6}?(?:值|计数|印记))等量的?(?:固定伤害|固伤)$/,
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "opponent", flatPerMark: { mark: m[1], add: 1, on: "self" } }] }) },
  // "每回合攻击附加N点(固定)?伤害"→react12 负载固伤（攻击事件域常态窗）
  { id: "e53-tickdmg-01",
    re: new RegExp(`^每回合攻击(?:时|都)?附加${NUM}点(?:固定|固伤)?伤害$`),
    go: (m) => reactWrap(12, {}, `附加${num(m[1])}点固定伤害`) },
  // "不会出现异常状态作用N回合"→immune_status turns
  { id: "e53-imm-07",
    re: new RegExp(`^不会(?:再)?出现(?:任何|所有)?异常状态作用${NUM}回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]) }] }) },
  // "不会出现异常状态下N回合X"→免疫窗+窗内效果粘连（"下1回合自身攻击先制+1"）
  { id: "e53-imm-03",
    re: new RegExp(`^不会(?:再)?出现(?:任何|所有)?异常状态下?${NUM}回合(?:，|,)?(.+)$`),
    go: (m) => {
      const t = num(m[1]);
      const sub = parseEffectText(m[2]);
      const payload = [...sub.effects];
      // "自身攻击先制+N"落 flags.priority——折成 prio_up 随窗挂上
      if (sub.flags?.priority !== undefined) payload.push({ op: "apply_status", name: "prio_up", target: "self", turns: t, params: { add: sub.flags.priority } });
      if (payload.length === 0) return null;
      return { effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: t }, ...payload.map((e) => ({ ...e, turns: e.turns ?? t }))], ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "(对手|对方|己方|本方)下只精灵(出战|登场)?时X"→next-unit 重定向（对手侧 nextFoe / 己方 nextAlly）
  { id: "e53-nxt-01",
    re: /^(对手|对方|敌方|己方|本方)下(?:一?只|个)(?:出战|上场|登场)?精灵(?:出战|登场|上场|入场)?时(.*)$/,
    go: (m) => {
      const t = /对手|对方|敌方/.test(m[1]) ? "nextFoe" : "nextAlly";
      const tail = (m[2] ?? "").replace(/^的/, "");
      if (tail === "") return null;
      const sub = parseEffectText(tail);
      if (sub.effects.length === 0) return null;
      return { effects: sub.effects.map((e) => ({ ...e, target: t })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "(减少|扣除)(对方)?下只(出战)?精灵N/M(血量|体力)"→percent nextFoe（"减少对方下只出战精灵1/3体力"）
  { id: "e53-nxt-02",
    re: new RegExp(`^(?:减少|扣除|损失)(?:对方|对手|敌方)?下只(?:出战|上场|登场)?精灵${NUM}\\s*/\\s*${NUM}(?:的)?(?:血量|体力|HP|生命|最大体力)?$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(m[1], m[2]), target: "nextFoe" }] }) },
  // "恢复自身所有技能N点PP"→pp_delta +N scope:all
  { id: "e53-pp-05",
    re: new RegExp(`^恢复(?:自身|自己)?所有技能${NUM}点PP(?:值)?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self", scope: "all" }] }) },
  // "恢复自身全部体力(值)?(和|与)所有技能PP(值)?"→heal 1/1 + pp_delta full
  { id: "e53-pp-06",
    re: /^恢复(?:自身|自己)?全部体力(?:值)?(?:和|与|，|,|及)?所有技能[Pp][Pp](?:值)?$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "恢复自身全部体力值与PP值"→heal 1/1 + pp_delta full（"与PP值"无"所有技能"中介形）
  { id: "e53-pp-07",
    re: /^恢复(?:自身|自己)?全部体力(?:值)?与PP(?:值)?$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }, { op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "自身所有技能的PP值+N"→pp_delta self scope:all
  { id: "e53-pp-08",
    re: new RegExp(`^自身所有技能(?:的)?PP值?([+＋\\-－])?${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: (m[1] === "-" || m[1] === "－" ? -1 : 1) * num(m[2]), target: "self", scope: "all" }] }) },
  // "自身所有技能下N回合先制+M"→prio_up{add,turns}
  { id: "e53-prio-01",
    re: new RegExp(`^自身所有技能下?${NUM}回合先制[+＋]${NUM}$|^所有技能先制[+＋]${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: m[1] !== undefined ? num(m[1]) : undefined, params: { add: num(m[2] ?? m[3]) } }] }) },
  // "每回合附加自己STAT值N%的固定伤害"→ailment_tick 载荷 stat-pct flat
  { id: "e53-tickdmg-02",
    re: new RegExp(`^每回合附加(?:自己|自身)(${STAT_RE})值?(?:的)?${NUM}%(?:的)?(?:固定伤害|固伤|固定值)$`),
    go: (m) => { const s = STATS[m[1]]; if (s === undefined || s === "acc") return null; return { effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "damage", kind: "fixed", power: 0, flatSelfStatPct: { stat: s, pct: num(m[2]) }, target: "opponent" }] })] }; } },
  // "先出手N回合不受对手攻击性技能伤害"/"先出手N回合免伤"→dmg_immune{cat:4}+order:first
  { id: "e53-imm-04",
    re: new RegExp(`^先出手${NUM}?回合?(?:自己|自身)?(?:不受|免疫)(?:对手|对方|敌方)?攻击性?技能?伤害$|^先出手${NUM}?回合?(?:自己|自身)?免伤$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: m[1] !== undefined || m[2] !== undefined ? num(m[1] ?? m[2]) : 1, params: { cat: 4 }, if: { order: "first" } }] }) },
  // "对手AIL状态下STAT-N"→条件弱化（if:{foeHas:ail}——"对手烧伤状态下攻击-1"）
  { id: "e53-condstg-01",
    re: new RegExp(`^(对手|对方|敌方)(${AIL_RE})状态下?(${STAT_RE})([+＋\\-－])${NUM}$`),
    go: (m) => { const ail = AILMENTS[m[2]], st = STATS[m[3]]; if (ail === undefined || st === undefined) return null; return { effects: [{ op: "apply_stat_stage", stat: st, delta: (m[4] === "-" || m[4] === "－" ? -1 : 1) * num(m[5]), target: "opponent", if: { foeHas: ail } }] }; } },
  // "对手AIL状态附加N点(固定)?伤害"→flatIf{foeHas}
  { id: "e53-condstg-02",
    re: new RegExp(`^(对手|对方|敌方)(${AIL_RE})状态附加${NUM}点(?:固定|固伤)?伤害$`),
    go: (m) => { const ail = AILMENTS[m[2]]; if (ail === undefined) return null; return { attachDamage: { flatIf: { when: { foeHas: ail }, flat: num(m[3]) } } }; } },
  // "先出手N%(令|使)对手AIL"→chance ailment + order:first 门
  { id: "e53-first-01",
    re: new RegExp(`^先出手${NUM}%(?:的?(?:概率|几率))?(?:使|令)(对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const ail = AILMENTS[m[3]]; if (ail === undefined) return null; return { effects: [{ op: "apply_status", name: ail, target: "opponent", chance: num(m[1]), if: { order: "first" } }] }; } },
  // "每回合(被攻击|受到)(的)?(攻击)?伤害?不超过N"→dmg_cap（e53-cap-01 的"伤害"字缺省变体）
  { id: "e53-cap-10",
    re: new RegExp(`^每回合(?:被攻击|受到|受到攻击)(?:的)?(?:攻击)?(?:伤害)?不超过${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1]) } }] }) },
  // "每回合受到攻击N%使对手X"→trigger1+chance
  { id: "e53-hit-06",
    re: new RegExp(`^每回合受到攻击${NUM}%(?:的?(?:概率|几率))?(.+)$`),
    go: (m) => reactWrap(1, { chance: num(m[1]) }, m[2]) },
  // "造成伤害的N/M(回血|恢复自身|恢复为自身体力)"→drain 分数
  { id: "e53-drn-03",
    re: new RegExp(`^造成伤害的${NUM}\\s*/\\s*${NUM}(?:回血|恢复自身|恢复为自身体力|恢复自身体力)$`),
    go: (m) => ({ attachDamage: { drain: frac(m[1], m[2]) } }) },
  // "(使|令)对手AIL+AIL(N回合)"→双异常（共享 chance/turns 由外层 bcm/partTurns 挂）
  { id: "e53-ail-02",
    re: new RegExp(`^(?:使|令)(对手|对方|敌方)(${AIL_RE})[+＋](${AIL_RE})${NUM}回合$`),
    go: (m) => { const a1 = AILMENTS[m[2]], a2 = AILMENTS[m[3]]; if (a1 === undefined || a2 === undefined) return null; return { effects: [{ op: "apply_status", name: a1, target: "opponent", turns: num(m[4]) }, { op: "apply_status", name: a2, target: "opponent", turns: num(m[4]) }] }; } },
  // "造成等量的固定(伤害|固伤)"→lastDmgFrac 1/1（等量=当次伤害等额——e14-36 同键）
  { id: "e53-drn-04",
    re: /^造成等量的?固定(?:伤害|固伤)$|^造成等量(?:的)?固伤(?:伤害)?$/,
    go: () => ({ attachDamage: { lastDmgFrac: { numerator: 1, denominator: 1 } } }) },
  // "造成的攻击伤害额外恢复至体力"→heal 1/1（"恢复至体力"=恢复至满）
  { id: "e53-drn-05",
    re: /^造成的?(?:攻击)?伤害(?:额外)?恢复至(?:体力|满血|HP|生命)$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // "(使|令)对手随机N种异常状态"→random 载体
  { id: "e53-ail-03",
    re: new RegExp(`^(?:使|令)(对手|对方|敌方)随机(?:进入)?${NUM}?种异常状态$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[2] !== undefined ? num(m[2]) : 1 } }] }) },
  // "(自身|对手)(STATS)(±)N"——无动词无"等级"裸形（"100%对方双防-1"，bcm 剥概率后抵达）
  { id: "e53-stg-07",
    re: new RegExp(`^(自身|自己|对方|对手|敌方)((?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性)(?:[、，,，和](?:${STAT_RE}|双攻|双防|攻速|全属性|所有属性))*)([+＋\\-－])${NUM}$`),
    go: (m) => {
      const stats = statExpand(m[2]);
      if (stats.length === 0) return null;
      const d = (m[3] === "-" || m[3] === "－" ? -1 : 1) * num(m[4]);
      return { effects: stats.map((s) => stageFx(s, d, /自身|自己/.test(m[1]) ? "self" : "opponent")) };
    },
  },
  // "对手使用体力药剂时效果变成减少相应的体力"——道具域未建模 → 显式留档
  { id: "e53-def-02",
    re: /(?:体力|生命|HP)?药剂|药水|回复道具/,
    go: () => ({ unparsedReason: "item/potion domain unmodeled (deferred)" }) },
  // "造成的攻击伤害不低于<相对基线>"（体力上限之和/受击N倍/已损失N%——非绝对 minDamage 可表达域 → 留档）
  { id: "e53-def-03",
    re: /^造成的?(?:攻击)?伤害不低于|造成的攻击伤害不低于/,
    go: () => ({ unparsedReason: "relative damage floor (sum-of-max / ×taken / %missing) unmodeled (deferred)" }) },
  // "组队可以向己方任意(目标|队员)使用"——targetScope 元旗（anyAlly）
  { id: "e53-def-04",
    re: /^组队(?:时)?(?:可以|可)?(?:向|向己方|对己方|向任意|对任意)(?:己方|任意己方|任意)?(?:目标|队员|精灵)(?:使用|施放)?$/,
    go: (m) => ({ flags: { targetScope: /己方/.test(m[0]) ? "anyAlly" : "any" } }) },
  // "任意一方未触发则X"——前列多 op 任一未生效谓词（prevApplied 只看紧邻上一 op，any-of 谓词未建模 → 显式留档）
  { id: "e53-any-01",
    re: /^(?:任意一方|任一方|两方之一|二者之一)(?:都)?未触发(?:效果)?(?:则|，|,)?(.+)$/,
    go: () => ({ unparsedReason: "any-prior-op-failure predicate unmodeled (deferred)" }) },
  // "受到N点X系攻击伤害"/"令对手使用的X系攻击技能无效"——属性键域未建模（e47/e50 先例显式留档）
  { id: "e53-ele-01",
    re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)?(?:直接)?受到${NUM}点.{1,4}系(?:攻击)?伤害$|^(?:自身|自己)?令?(?:对手|对方|敌方)使用的?.{1,4}系攻击技能无效$`),
    go: () => ({ unparsedReason: "element-typed damage/nullify — type domain unmodeled (deferred)" }) },
  // "对手每处于1回合的<名>N回合内令对手技能无效"——具名计时印记域，按层换算回合窗未建模 → 保残
  { id: "e53-def-01",
    re: /对手每处于\d+回合的.{1,6}\d+回合内令对手技能无效|处于怀生菩怜态|拒赦怒威态|百天浮世络|无罔形态|强击形态/,
    go: () => ({ unparsedReason: "named timed-state machine — per-mark-turn skill-nullify unmodeled (deferred)" }) },

  // ===== e53 追加第六批（残余聚类） =====
  // "N%改变(自身|对方)(STAT|某些属性|等级|全属性)等级?(±M)?"——裸"等级"无符号默认 自身+1/对方-1
  { id: "e53-stg-09",
    re: new RegExp(`^(?:${NUM}%)?改变(自身|自己|对方|对手|敌方)(?:的)?(.+?)([+-]?)${NUM}?$`),
    go: (m) => {
      const side = /自身|自己/.test(m[2]) ? "self" : "opponent";
      const ch = m[1] !== undefined ? num(m[1]) : undefined;
      const body = m[3].replace(/等级/g, "").replace(/的$/, "");
      const d = m[5] !== undefined ? (m[4] === "-" ? -1 : 1) * num(m[5]) : side === "opponent" ? -1 : 1;
      if (/某些|随机/.test(body)) return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: 1, delta: d, target: side, ...(ch !== undefined ? { chance: ch } : {}) }] };
      if (body === "" || /全|所有|全部/.test(body)) return { effects: ALL_STATS.map((s) => stageFx(s, d, side, ch)) };
      const st = STATS[body]; if (st === undefined) return null;
      return { effects: [stageFx(st, d, side, ch)] };
    },
  },
  // "N%降低对方PPN点"/"N%降低对方N点PP值"→pp_delta chance
  { id: "e53-pp-12",
    re: new RegExp(`^${NUM}%降低(?:对方|对手|敌方)(?:的)?PP(?:值)?${NUM}(?:点)?$|^${NUM}%降低(?:对方|对手|敌方)${NUM}点PP(?:值)?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[2] ?? m[3]), target: "opponent", scope: "all", chance: num(m[1]) }] }) },
  // "随机使对手N项PP值归零"/"使对手随机N项(像)PP归零"→pp_delta zeroRandom
  { id: "e53-pp-13",
    re: new RegExp(`^随机(?:使|令)(?:对手|对方|敌方)?${NUM}[项个种像]?[Pp][Pp](?:值)?归零$|^(?:使|令)(?:对手|对方|敌方)随机${NUM}[项个种像](?:技能)?[Pp][Pp](?:值)?归零$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1] ?? m[2]), target: "opponent" }] }) },
  // "降低对方N点战斗时最(高|好|大)HP"→max_hp_down flat
  { id: "e53-hp-01",
    re: new RegExp(`^降低(?:对方|对手|敌方)${NUM}点(?:战斗时)?的?最[高好大](?:的)?HP$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // "若自身强化(效果)?(被)?(消除|消失)则X"→react trigger7
  { id: "e53-trg-7a",
    re: /^若(?:自身|自己)?强化(?:的|效果|状态)?(?:被)?(?:消除|消失|清除)(?:则|，|,|后)?(.+)$/,
    go: (m) => reactWrap(7, {}, m[1]) },
  // "造成等同于(攻击)?伤害量的(固定|固)?伤(害)?"→lastDmgFrac 1/1；"造成等同于恢复量的固伤"→healEcho
  { id: "e53-eql-01",
    re: /^造成等同于(?:攻击)?伤害量(?:值)?的(?:固定|固|百分比|真实)?伤(?:害)?$|^造成等量的(?:固定|固|百分比|真实)?伤(?:害)?$/,
    go: () => ({ attachDamage: { lastDmgFrac: { numerator: 1, denominator: 1 } } }) },
  { id: "e53-eql-02",
    re: /^造成等同于恢复量的(?:固定|固|百分比|真实)?伤(?:害)?$|^(?:并)?造成恢复量的固定伤害$/,
    go: () => ({ attachAll: { healEcho: true } }) },
  // "每回合受到伤害的N%(反馈|反弹|返还)给对手"→reflect_dmg pct（"每回合/的"变体）
  { id: "e53-rfl-06",
    re: new RegExp(`^每回合受到伤害的${NUM}%(?:会)?(?:反馈|反弹|返还)给(?:对手|对方|敌方)$|^(?:自身|自己)?受到(?:的)?(?:直接)?攻击伤害(?:的)?${NUM}%(?:会)?(?:反馈|反弹|返还)给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // "N~M回合X"→turnsRange 窗（payload 子解析）
  { id: "e53-trn-01",
    re: new RegExp(`^${NUM}\\s*[~～-]\\s*${NUM}回合(?:内)?(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[3]);
      if (sub.effects.length === 0) return null;
      const tr = { min: Math.min(num(m[1]), num(m[2])), max: Math.max(num(m[1]), num(m[2])) };
      return { effects: sub.effects.map((e) => ({ ...e, turnsRange: tr })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "造成的攻击伤害为奇数则X"/"为偶数则X"→if prevDamageOdd/Even 包裹
  { id: "e53-par-01",
    re: /^造成(?:的)?(?:攻击)?伤害为(奇数|偶数)(?:时|则|，|,)?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0) return null;
      const c = m[1] === "奇数" ? { prevDamageOdd: true } : { prevDamageEven: true };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "每回合攻击先制+N"→prio_up 持续窗
  { id: "e53-tick-09",
    re: new RegExp(`^每回合攻击先制\\+${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: num(m[1]) } }] }) },
  // "每回合(攻击)?造成伤害的N%恢复自身体力"→drain_atk 分数窗
  { id: "e53-tick-10",
    re: new RegExp(`^每回合(?:攻击)?造成(?:的)?伤害(?:的)?${NUM}%(?:的)?恢复(?:自身|自己)?体力$|^每回合(?:攻击)?造成(?:的)?伤害(?:的)?${NUM}%(?:的)?恢复(?:自身|自己)?HP$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // "每回合附加对手最大体力N/M的(百分比|固定)伤害"→foe_dot 分数（对手max 基数）
  { id: "e53-tick-11",
    re: new RegExp(`^每回合附加(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}的(?:百分比|固定|固伤)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "N%的(概率|几率)X"→通用概率包（载荷子解析套 chance；已带 chance 的不覆盖）
  { id: "e53-chn-01",
    re: new RegExp(`^${NUM}%的?(?:概率|几率|机率)(.+)$`),
    go: (m) => {
      const ch = num(m[1]);
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0) return null;
      return { effects: sub.effects.map((e) => ({ ...e, chance: e.chance !== undefined ? Math.round(e.chance * ch / 100) : ch })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "每回合自身(的)?(攻击|技能)(有)?N%(的几率)?X"→react12 变体（hit-01 自身主语形）
  { id: "e53-hit-08",
    re: new RegExp(`^每回合(?:自身|自己)(?:的)?(?:攻击|技能)有?${NUM}%(?:的)?(?:概率|几率|机率)?(.+)$`),
    go: (m) => reactWrap(12, { chance: num(m[1]) }, m[2]) },
  // "将能力下降转给(对方|对手)"→transfer_stages push down（"转给"变体）
  { id: "e53-tfs-01",
    re: /^将(?:自身的?)?能力(?:的)?下降(?:效果|状态)?(?:转移|转|移|反馈)给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // "攻击必定致命(一击)?"/"每次直接攻击必定(致命(一)?击?)?"→crit_always
  { id: "e53-crt-01",
    re: /^(?:攻击|出手)(?:技能)?(?:必定|必)致命(?:一)?击?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  { id: "e53-crt-02",
    re: /^每次(?:直接)?攻击(?:必定|必)(?:致命(?:一)?击?|暴击)?$/,
    go: (m) => /致命|暴击/.test(m[0]) ? { effects: [{ op: "apply_status", name: "crit_always", target: "self" }] } : { effects: [{ op: "apply_status", name: "hit_fx_null", target: "self" }] } },
  // "自身受到的固定伤害和百分比伤害减(半)?"→dmg_taken_down pct50 kindMask:3（截尾"减"≈减半）
  { id: "e53-red-01",
    re: /^(?:自身|自己)?受到的?(?:固定伤害和百分比伤害|百分比伤害和固定伤害|固定伤害|百分比伤害|固伤)(?:减半|减少50%|减)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50, kindMask: 3 } }] }) },
  // "自身受到的特攻伤害减半"/"受到特攻伤害减半"→spec_half（"特攻"=特殊攻击省字）
  { id: "e53-red-02",
    re: /^(?:自身|自己)?受到的?(?:特攻|特殊攻击|特殊)(?:攻击)?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self", params: { cat: 3, n: 1, d: 2 } }] }) },
  // "使自身下N次攻击技能必定触发<名>"→apply_mark 具名印记 + count 充能层近似
  { id: "e53-nmk-01",
    re: new RegExp(`^(?:使|令)?自身下?${NUM}次(?:攻击|攻击技能|技能)必定触发(.{2,12})$`),
    go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2].replace(/效果$/, ""), target: "self", count: num(m[1]) }] }) },
  // "对手使用技能(时|后)X"→react trigger11（对手每回合出招观察窗）
  { id: "e53-use-02",
    re: /^(?:对手|对方|敌方)使用技能(?:时|后|，|,)?(.+)$/,
    go: (m) => reactWrap(11, {}, m[1]) },
  // "若对手(AIL)(则|，)?威力翻倍"→scaleIf foeHas 门
  { id: "e53-scl-01",
    re: new RegExp(`^若(?:对手|对方|敌方)(?:处于)?(${AIL_RE})(?:状态)?(?:时|则|，|,)?威力翻倍$`),
    go: (m) => AILMENTS[m[1]] === undefined ? null : ({ attachDamage: { scaleIf: { when: { foeHas: AILMENTS[m[1]] }, numerator: 2, denominator: 1 } } }) },
  // "若没有命中(对手)?则X"→react trigger6（自身 miss）
  { id: "e53-mis-01",
    re: /^若(?:自身|自己)?(?:技能|攻击)?(?:MISS|miss|未命中|没有命中)(?:对手|对方|敌方)?(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(6, {}, m[1]) },
  // "令对方所有(能力效果|增强能力)消失"→clear_stages foe up（词序/省字变体）
  { id: "e53-st-09",
    re: /^(?:令|使|消除)(?:对方|对手|敌方)所有(?:(?:增强|强化|提升|增加)?能力|能力(?:增强|强化|提升|增加)?|增加|增强)(?:的)?(?:效果|状态)?消失$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "N%令对手AILN%令对手AIL..."——无分隔连珠概率异常段（"10%对手烧伤10%对手冻伤10%中毒"——目标词可省；首段 N% 可被 bcm 层剥走）
  { id: "e53-chn-02",
    re: new RegExp(`^(?:${NUM}%(?:令|使)?(?:对手|对方|敌方)?(?:${AIL_RE})(?:状态)?|(?:令|使)(?:对手|对方|敌方)(?:${AIL_RE})(?:状态)?)(?:${NUM}%(?:令|使)?(?:对手|对方|敌方)?(?:${AIL_RE})(?:状态)?)+$`),
    go: (m) => {
      const segs = m[0].match(new RegExp(`${NUM}%(?:令|使)?(?:对手|对方|敌方)?(?:${AIL_RE})(?:状态)?|(?:令|使)(?:对手|对方|敌方)(?:${AIL_RE})(?:状态)?`, "g")) ?? [];
      const fx = [];
      for (const s of segs) {
        const sm = s.match(new RegExp(`^(${NUM})%(?:令|使)?(?:对手|对方|敌方)?(${AIL_RE})(?:状态)?$`)) ?? s.match(new RegExp(`^(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`));
        if (!sm) return null;
        const ail = sm[3] ?? sm[1];
        if (AILMENTS[ail] === undefined) return null;
        fx.push({ op: "apply_status", name: AILMENTS[ail], target: "opponent", ...(sm[3] !== undefined ? { chance: num(sm[1]) } : {}) });
      }
      return { effects: fx };
    },
  },
  // "闪避(对手)?(的)?(直接)?攻击"/"闪避直接攻击"→dodge 100
  { id: "e53-ddg-01",
    re: /^闪避(?:对手|对方|敌方)?(?:的)?(?:直接|直接攻击|攻击)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: 100 } }] }) },
  // "(自身)?失去全部体力"→percent 100 self（带自身主语变体）
  { id: "e53-hpl-01",
    re: /^(?:自身|自己)失去全部体力$/,
    go: () => ({ effects: [{ op: "damage", kind: "percent", power: 100, target: "self" }] }) },
  // "免疫(对手)?下N次非致命一击造成的攻击伤害"——非暴击免疫域（暴击穿透门未建模 → 留档）
  { id: "e53-def-08",
    re: new RegExp(`^(?:自身|自己)?免疫(?:对手|对方|敌方)?下?${NUM}?次?非致命一击(?:造成)?的?(?:攻击)?伤害$`),
    go: () => ({ unparsedReason: "non-crit attack immunity — crit-bypass gate unmodeled (deferred)" }) },
  // "使N回合内受到(的)?(攻击)?伤害减半"→dmg_taken_down pct50 turns（"使3回合内受到的伤害减半"）
  { id: "e53-red-03",
    re: new RegExp(`^(?:使|令)?${NUM}回合内受到?的?(?:攻击)?伤害减半$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", turns: num(m[1]), params: { pct: 50 } }] }) },
  // "造成(的)?(攻击)?伤害(都|全部)?将?恢复自身体力"→drain 1/1（伤害全额回血）
  { id: "e53-drn-06",
    re: /^(?:每次)?造成(?:的)?(?:攻击)?伤害(?:值)?(?:都|全部|完全)?将?恢复(?:自身|自己)?(?:体力|HP)$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // "每回合(回复|恢复)造成伤害N/M的HP"→drain_atk 分数窗（"回复造成伤害"语序变体）
  { id: "e53-tick-12",
    re: new RegExp(`^每回合(?:回复|恢复)造成(?:的)?伤害${NUM}\\s*/\\s*${NUM}的?(?:HP|体力|生命值?)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "每回合(回复|恢复)(自身)?已损失HP的N%"→hot missing（HP 词形补漏）
  { id: "e53-tick-13",
    re: new RegExp(`^每回合(?:恢复|回复)(?:自身|自己)?已损失(?:的)?(?:HP|体力)(?:的)?${NUM}%$|^每回合(?:恢复|回复)(?:自身|自己)?已损失(?:的)?(?:HP|体力)(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const p = ns.length === 1 ? { n: ns[0], d: 100 } : { n: ns[0], d: ns[1] }; return { effects: [{ op: "apply_status", name: "hot", target: "self", params: { ...p, missing: 1 } }] }; },
  },
  // "造成(的)?(攻击)?伤害提升N"(裸数≈%截尾)→dmg_boost pct
  { id: "e53-dm-01",
    re: new RegExp(`^造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)${NUM}%?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]) } }] }) },
  // "当前体力低于对手威力翻倍"/"当前体力低于最大体力的N/M时威力翻倍"→scaleIf 条件门
  { id: "e53-scl-02",
    re: new RegExp(`^当前体力低于(?:对手|对方|敌方)?威力翻倍$|^当前体力低于(?:自身|自己)?最大体力的${NUM}\\s*/\\s*${NUM}时?威力翻倍$`),
    go: (m) => ({ attachDamage: { scaleIf: { when: m[1] === undefined ? { selfHpBelowFoe: true } : { selfHpBelow: frac(m[1], m[2]) }, numerator: 2, denominator: 1 } } }) },
  // "自身每有N点STAT值..."——按属性值定额缩放域未建模 → 留档
  { id: "e53-def-06",
    re: new RegExp(`^自身每有?${NUM}点(${STAT_RE})值`),
    go: () => ({ unparsedReason: "per-stat-quantum scaling unmodeled (deferred)" }) },
  // "自身每有N项(非第五)?技能PP值不满..."——按PP不满槽位计数域未建模 → 留档
  { id: "e53-def-07",
    re: new RegExp(`^自身每有?${NUM}(?:项|个)(?:非第五)?技能PP值?不满`),
    go: () => ({ unparsedReason: "per-PP-not-full-slot scaling unmodeled (deferred)" }) },

  // ===== e53 追加第七批 =====
  // "N%令对方AIL-N"/"N%令对手AIL N"——裸数=回合窗（"25%令对方疲惫1"/"50%令对手疲惫2"）
  { id: "e53-ail-09",
    re: new RegExp(`^(?:${NUM}%)?(?:的?(?:概率|几率|机率))?(?:令|使)(对手|对方|敌方)(${AIL_RE})${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent", turns: num(m[4]), ...(m[1] !== undefined ? { chance: num(m[1]) } : {}) }] }) },
  // "降低对方N点战斗时最(高|好|大)(HP|体力|生命值)"→max_hp_down（"体力"词形补漏）
  { id: "e53-hp-02",
    re: new RegExp(`^降低(?:对方|对手|敌方)${NUM}点(?:战斗时)?的?最[高好大](?:的)?(?:HP|hp|体力|生命值)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // "降低对方N/M的HP"→percent damage frac（"降低对方1/8的HP"）
  { id: "e53-hp-03",
    re: new RegExp(`^(?:降低|减少)(?:对方|对手|敌方)(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:HP|体力|生命值)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), num(m[2])), target: "opponent" }] }) },
  // "每回合(回复|恢复)N/M体力(值)?"→hot 分数（"每回合回复1/3体力值"）
  { id: "e53-tick-14",
    re: new RegExp(`^每回合(?:回复|恢复)${NUM}\\s*/\\s*${NUM}(?:的)?(?:体力|HP|生命值?)(?:值)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "每回合攻击附加X"→react12 载荷（"每回合攻击附加自身当前体力1/2的固定伤害"）
  { id: "e53-hit-09",
    re: /^每回合攻击附加(.+)$/,
    go: (m) => reactWrap(12, {}, `附加${m[1]}`) },
  // "每回合使用攻击技能N%令对手AIL"→react11+chance（"每回合使用攻击技能70%令对手焚烬"）
  { id: "e53-use-03",
    re: new RegExp(`^每回合使用(?:攻击|属性)?技能${NUM}%(.+)$`),
    go: (m) => reactWrap(11, { chance: num(m[1]), ...(m[0].includes("攻击") && !/属性/.test(m[0]) ? { cat: 4 } : /属性/.test(m[0]) ? { cat: 1 } : {}) }, m[2]) },
  // "自身下N次受到(的)?(攻击)?伤害减少N%"→dmg_taken_down count窗
  { id: "e53-red-04",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次受到?的?(?:攻击)?伤害(?:减少|降低|下降)${NUM}%?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { count: num(m[1]), pct: num(m[2]) } }] }) },
  // "自身下N次受到(的)?(攻击)?伤害减少N点"→dmg_reduce count窗
  { id: "e53-red-05",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次受到?的?(?:攻击)?伤害(?:减少|降低|下降)${NUM}点$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { count: num(m[1]), flat: num(m[2]) } }] }) },
  // "造成的伤害低于N则X"→prevDamageBelowAbs 门控包裹
  { id: "e53-par-02",
    re: new RegExp(`^造成(?:的)?(?:攻击)?伤害低于${NUM}(?:点)?(?:时|则|，|,)?(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0) return null;
      const c = { prevDamageBelowAbs: num(m[1]) };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "使自身获得一个(可以)?(吸收|吸取)N点(伤害)?的护盾"→shield flat（"可以吸收"/"个"词形）
  { id: "e53-shd-01",
    re: new RegExp(`^(?:使|令)?自身获得一个?(?:可以)?(?:吸收|吸取|抵挡|抵御)?${NUM}点?(?:伤害)?的?(?:护盾|护罩)$|^(?:使|令)?自身获得${NUM}个?${NUM}(?:的)?(?:护盾|护罩)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1] ?? m[3]) } }] }) },
  // "获得等同于对手最大体力N/M的护盾(、护罩)?"→shield fracFoeMaxHp
  { id: "e53-shd-02",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?获得(?:一个|等同于|相当于)?(?:对手|对方|敌方)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的?(?:护盾|护罩)(?:、|，|,)?(?:护罩|护盾)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { fracFoeMaxHpN: num(m[1]), fracFoeMaxHpD: num(m[2]) } }] }) },
  // "获得等同于对手护盾值N%的护盾"——敌盾镜像域未建模 → 留档
  { id: "e53-def-09",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?获得(?:一个|等同于|相当于)?(?:对手|对方|敌方)(?:的)?护盾值${NUM}%的护盾`),
    go: () => ({ unparsedReason: "foe-shield-mirrored shield amount unmodeled (deferred)" }) },
  // "若自身持有(红|白)色?(或(红|白)色)?龙鳞则X翻倍"→mulIf/flatMulIf or-cond
  { id: "e53-hld-01",
    re: new RegExp(`^若(?:自身|自己)持有(红|白)色?或?(红|白)?色?龙鳞则?(?:使|令)?(.+)$`),
    go: (m) => {
      const marks = [m[1], m[2]].filter((x) => x !== undefined).map((c) => `${c}龙鳞`);
      const cond = marks.length === 1 ? { markCountAtLeast: { mark: marks[0], n: 1, on: "self" } } : { or: marks.map((k) => ({ markCountAtLeast: { mark: k, n: 1, on: "self" } })) };
      const body = m[3];
      if (/增伤效果|造成的伤害|攻击伤害/.test(body) && /翻倍|2倍|两倍/.test(body)) return { attachDamage: { mulIf: { when: cond, numerator: 2, denominator: 1 } } };
      if (/固定伤害|固伤/.test(body) && /翻倍|2倍|两倍/.test(body)) return { attachDamage: { flatMulIf: { when: cond, numerator: 2, denominator: 1 } } };
      if (/百分比伤害/.test(body) && /翻倍|2倍|两倍/.test(body)) return { unparsedReason: "percent-damage multiplier unmodeled (deferred)" };
      const sub = parseEffectText(body);
      if (sub.effects.length === 0) return null;
      return { effects: sub.effects.map((e) => ({ ...e, if: cond })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "自身护盾值高于N则X"/"低于N则X"→not selfShieldBelow 门控包裹
  { id: "e53-shg-01",
    re: new RegExp(`^(?:若)?(?:自身|自己)(?:的)?(?:护盾|护罩)(?:值)?(高于|大于|超过|低于|小于|不足)${NUM}(?:点)?(?:时|则|，|,)?(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[3]);
      if (sub.effects.length === 0) return null;
      const n = num(m[2]);
      const c = /高于|大于|超过/.test(m[1]) ? { not: { selfShieldBelow: n + 1 } } : { selfShieldBelow: n };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "若对手使用天生先制等级>0的技能则X"→react3 prioMin 门（"命中前"时点由触发链保证）
  { id: "e53-foe-05",
    re: /^若?(对手|对方|敌方)使用(?:天生)?先制(?:等级)?(?:>0|大于0|为正)?的?技能(?:则|时|后|，|,)?(?:命中前)?(.+)$/,
    go: (m) => reactWrap(3, { prioMin: 1 }, m[2]) },
  // "自身下N次受到的攻击伤害转化为体力值"→dmg_to_heal count窗
  { id: "e53-cnv-01",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?下?${NUM}次受到?的?(?:攻击)?伤害转化为(?:自身|自己)?(?:体力|体力值|HP)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { count: num(m[1]) } }] }) },
  // "使自身下N次攻击获得<名>效果"→apply_mark 具名印记 + count 充能层近似
  { id: "e53-nmk-02",
    re: new RegExp(`^(?:使|令)自身下?${NUM}次攻击(?:技能)?获得(.{2,12}?)(?:效果|状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2].replace(/效果$/, ""), target: "self", count: num(m[1]) }] }) },
  // "效果结束后X"——到期触发域未建模 → 留档
  { id: "e53-def-10",
    re: /^效果结束后?|^效果消失后|^效果到期后/,
    go: () => ({ unparsedReason: "on-expire rider unmodeled (deferred)" }) },
  // "每回合回复(自身)?最大体力N/M的最大体力"——冗余尾（tick-08 词形补漏）
  { id: "e53-tick-15",
    re: new RegExp(`^每回合(?:回复|恢复)(?:自身|自己)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}的最大体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "攻击必定致命，每次攻击都有N%X"——commaRaw"致命+每次"粘句整收（crit flag + react12 载荷）
  { id: "e53-crt-03",
    re: new RegExp(`^攻击(?:技能)?必定致命[，,](?:每次|每回合)攻击(?:都|将|后|有)*${NUM}%(.+)$`),
    go: (m) => ({ attachDamage: { crit: true }, ...(reactWrap(12, { chance: num(m[1]) }, m[2]) ?? { unparsedReason: `react payload unparsed: ${m[2]}` }) }) },
  // "附加自身双防总和值N%固定伤害"/"附加自身双攻总和值N%固定伤害"→flatSelfStatPct stats[]
  { id: "e53-flt-01",
    re: new RegExp(`^附加(?:自身|自己)?(双防|双攻|攻防|体攻)总和值?${NUM}%(?:的)?(?:固定|固伤|固定伤)?伤害$`),
    go: (m) => { const pair = { 双防: ["def", "sdf"], 双攻: ["atk", "spa"], 攻防: ["atk", "def"], 体攻: ["hp", "atk"] }[m[1]]; if (pair === undefined) return null; return { attachDamage: { flatSelfStatPct: { stats: pair, pct: num(m[2]) } } }; } },
  // "使用X系招式威力N倍/伤害XN"→dmg_boost{pct,type}（params.type 系别门控；非 TYPE 名单的前缀形仍留档）
  { id: "e53-def-11",
    re: new RegExp(`^(?:自己|自身|我方|己方)?(?:使用)?(${TYPE_RE})系?(?:招式|技能|攻击)(?:的)?(?:威力|伤害)(?:为|是|提升|提高|增加|X|x|\\*|×)?([0-9]+(?:\\.[0-9]+)?|一|二|两|三|四|五|六|七|八|九|十)(?:倍)?$|^(?:自己|自身)?(${TYPE_RE})系?(?:招式|技能|攻击)(?:的)?(?:威力|伤害)(?:加倍|翻倍)$`),
    go: (m) => { const type = m[1] ?? m[3]; const raw = parseFloat(m[2]); const n = isNaN(raw) ? num(m[2]) : raw; const pctv = /加倍|翻倍/.test(m[0]) ? 100 : Math.round((n - 1) * 100); return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: pctv }, moveType: type }] }; } },
  { id: "e53-def-11b",
    re: /^自己使用.{1,4}系(?:招式|技能)/,
    go: () => ({ unparsedReason: "element-typed move clause — payload unmodeled (deferred)" }) },
  // ── 第八批：中句击杀门控/noResist/缺尾分数伤害/自愈削减/复合概率威力/免疫窗 ──
  // "(当次|本次|每次)击败(对手|对方|敌方)(精灵)?X"→子句全体挂 foeFainted 门
  { id: "e53-kil-01",
    re: /^(?:当次|本次|此次|每次)击败(?:对手|对方|敌方)(?:精灵)?(?:时|后|，|,)?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1]);
      if (sub.effects.length === 0) return null;
      const c = { foeFainted: true };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "造成的伤害不会发生微弱"→noResist（克制<1.0 抬平，damage.ts 已支持）
  { id: "e53-nwk-01",
    re: /^(?:自身|自己)?造成(?:的)?(?:攻击)?伤害(?:都)?(?:不会|不?再?可能)(?:出现|发生|产生)?微弱$|^(?:自身|自己)?(?:攻击|技能)伤害不会微弱$/,
    go: () => ({ attachDamage: { noResist: true } }) },
  // "附加对手最大体力N/M"(缺"伤害/百分比伤害"尾)→percent frac（power:1 占位）
  { id: "e53-ptc-02",
    re: new RegExp(`^附加(?:对手|对方|敌方)(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ attachDamage: { power: 1, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "(使|令)自身(所有)?体力恢复效果减少N%"→heal_cut self（e44-08 的"令自身"语序变体）
  { id: "e53-hct-01",
    re: new RegExp(`^(?:使|令)?自身(?:的)?(?:所有)?体力恢复(?:的)?效果减少${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "self", params: { pct: num(m[1]) } }] }) },
  // "N%概率威力翻倍体力低于N/M时概率增加N%"——基础 mulChance + 低血 chanceMulIf 复合
  { id: "e53-mch-01",
    re: new RegExp(`^${NUM}%(?:概率|几率)?威力翻倍(?:，|,)?(?:自身|自己)?体力低于${NUM}\\s*/\\s*${NUM}时概率(?:增加|提升|提高)${NUM}%$`),
    go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1]), numerator: 2, denominator: 1 }, chanceMulIf: { when: { selfHpBelow: { numerator: num(m[2]), denominator: num(m[3]) } }, numerator: 100 + num(m[4]), denominator: 100 } } }) },
  // "免疫下N次(自身)?受到(的)?(攻击)?(伤害)?"裸尾→dmg_immune count窗
  { id: "e53-imm-05",
    re: new RegExp(`^免疫(?:自身|自己)?下?${NUM}次(?:自身|自己)?受到(?:的)?(?:攻击|攻击伤害|伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1]) } }] }) },
  // "附加自身当前已损失技能PP值总和xN的固定伤害"——self PP 亏损域未建模（flatFoePpMissing 仅对手侧）→留档
  { id: "e53-def-12",
    re: new RegExp(`^附加(?:自身|自己)(?:当前)?(?:已)?损失(?:的)?(?:技能)?PP值?(?:总和)?[×xX*]?${NUM}倍?的?(?:固定|固伤|固定伤)?伤害$`),
    go: () => ({ unparsedReason: "self-pp-missing aggregate damage unmodeled (deferred)" }) },
  // "威力翻N倍"/"伤害翻N倍"裸形（bcm 吃掉 N% 前缀后余词；倍率入 numerator）
  { id: "e53-pwr-01",
    re: new RegExp(`^威力翻${NUM}倍$|^伤害翻${NUM}倍$`),
    go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1] ?? m[2]), denominator: 1 } } }) },
  // "致命(一)击率(为|是)?N%"→crit_up pct（分数形已由 e48-18 收）
  { id: "e53-crt-04",
    re: new RegExp(`^致命(?:一)?击率(?:为|是|提升|提高|上升|增加)?${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // ── 第九批：复合异常/口语降防/裸等级/特殊攻击MISS/伤害阈值门/倍威力 ──
  // "(使|令)对手AIL+AIL(N回合)?"——加号并列双异常
  { id: "e53-dal-01",
    re: new RegExp(`^(?:使|令)(对手|对方|敌方|自身|自己|本方)(${AIL_RE})\\+(${AIL_RE})(?:状态)?(?:${NUM}?回合)?$`),
    go: (m) => { const t = /对手|对方|敌方/.test(m[1]) ? "opponent" : "self"; const turns = m[4] !== undefined ? { turns: num(m[4]) } : {}; return { effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: t, ...turns }, { op: "apply_status", name: AILMENTS[m[3]], target: t, ...turns }] }; },
  },
  // "(使|令)对手AIL(AIL)?(或|和|、)AIL"——或列选一 → random list
  { id: "e53-rdl-01",
    re: new RegExp(`^(?:使|令)(对手|对方|敌方)(${AIL_RE})(${AIL_RE})?(?:或|和|、)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const list = [m[2], m[3], m[4]].filter((x) => x !== undefined).map((k) => AILMENTS[k]); return list.length < 2 ? null : { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: 1 } }] }; },
  },
  // "降(低)?对方N点(STAT)"——点量降属（"降对方1点物防"）
  { id: "e53-dst-01",
    re: new RegExp(`^(?:降低?|减少?)(?:对方|对手|敌方)${NUM}点(${STAT_RE}|防御|特防|攻击|特攻|速度|命中)$`),
    go: (m) => { const st = { 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }[m[2]]; return st === undefined ? null : { effects: [{ op: "apply_stat_stage", stat: st, delta: -num(m[1]), target: "opponent" }] }; },
  },
  // "降低自身(的)?(STAT)等级N"——无符号正数=降（"降低自身的特攻等级1"）
  { id: "e53-dst-02",
    re: new RegExp(`^(?:降低|减少)自身(?:的)?(${STAT_RE}|攻击|防御|特攻|特防|速度|命中)等级${NUM}$`),
    go: (m) => { const st = { 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }[m[1]]; return st === undefined ? null : { effects: [{ op: "apply_stat_stage", stat: st, delta: -num(m[2]), target: "self" }] }; },
  },
  // "(自身|自己)(的)?(STAT|双防|双攻|全属性)等级±N"裸形——动词省略默认提升（"100%自身速度等级1"）
  { id: "e53-stb-01",
    re: new RegExp(`^(?:自身|自己)(?:的)?(双防|双攻|全属性|所有属性|${STAT_RE}|攻击|防御|特攻|特防|速度|命中)等级([+-]?${NUM})$`),
    go: (m) => {
      const v = num(m[2].replace(/^\+/, ""));
      if (m[1] === "双防") return { effects: [{ op: "apply_stat_stage", stat: "def", delta: v, target: "self" }, { op: "apply_stat_stage", stat: "sdf", delta: v, target: "self" }] };
      if (m[1] === "双攻") return { effects: [{ op: "apply_stat_stage", stat: "atk", delta: v, target: "self" }, { op: "apply_stat_stage", stat: "spa", delta: v, target: "self" }] };
      if (m[1] === "全属性" || m[1] === "所有属性") return { effects: ALL_STATS.map((s) => ({ op: "apply_stat_stage", stat: s, delta: v, target: "self" })) };
      const st = { 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }[m[1]];
      return st === undefined ? null : { effects: [{ op: "apply_stat_stage", stat: st, delta: v, target: "self" }] };
    },
  },
  // "使对手特殊攻击(技能)?(失效|MISS)"→move_null cat:3
  { id: "e53-mnl-01",
    re: /^(?:使|令)(?:对手|对方|敌方)(?:的)?特殊攻击(?:技能)?(?:失效|MISS|miss|无效)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 3 } }] }) },
  // "造成(的)?(攻击)?伤害(高于|低于)N(点)?(X)"——prevDamage 阈值门包裹
  { id: "e53-dth-01",
    re: new RegExp(`^造成(?:的)?(?:攻击)?伤害(高于|超过|大于|低于|小于|不足)${NUM}(?:点)?(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[3]);
      if (sub.effects.length === 0) return null;
      const c = /高于|超过|大于/.test(m[1]) ? { prevDamageAboveAbs: num(m[2]) } : { prevDamageBelowAbs: num(m[2]) };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "造成的伤害额外翻倍"/"伤害额外翻倍"→powerMul 2（"额外"词形变体）
  { id: "e53-dbl-01",
    re: /^(?:自身|自己)?造成(?:的)?(?:攻击)?伤害额外翻倍$|^伤害额外翻倍$/,
    go: () => ({ attachDamage: { powerMul: { numerator: 2, denominator: 1 } } }) },
  // "N%几率N倍威力"/"N%几率为N倍"→mulChance（"倍威力"尾序变体）
  { id: "e53-mch-02",
    re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(?:为|是|有)?${NUM}倍威力$`),
    go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1]), numerator: num(m[2]), denominator: 1 } } }) },
  // "受到X系攻击"——系别承伤域未建模（ele-01 同族）→留档
  { id: "e53-def-16",
    re: /^(?:若)?受到[^，,；;]{1,4}系攻击(?:时|伤害|技能)?$/,
    go: () => ({ unparsedReason: "element-typed damage received — type domain unmodeled (deferred)" }) },
  // "(令|使)?(自身|自己|本方)疲惫N回合(无法攻击|不能行动)?"——自疲惫（"无法攻击"是疲惫内禀描述尾）
  { id: "e53-fat-01",
    re: new RegExp(`^(?:令|使)?(?:自身|自己|本方)疲惫${NUM}回合(?:内)?(?:无法攻击|不能行动|无法行动)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "fatigue", target: "self", turns: num(m[1]) }] }) },
  // "N%几率(为|是)?N倍"裸倍率→mulChance（无威力/伤害尾词变体）
  { id: "e53-mch-03",
    re: new RegExp(`^${NUM}%的?(?:概率|几率)(?:为|是|有)?${NUM}倍$`),
    go: (m) => ({ attachDamage: { mulChance: { chance: num(m[1]), numerator: num(m[2]), denominator: 1 } } }) },
  // ── 第十批：drain 词形/威力加减/react 前缀/阈值门/具名 deferred ──
  // "(对方)?造成(的)?伤害N%恢复(自身|自己)?体力"→drain pct（"对方"=对对方，宾语非主语）
  { id: "e53-drn-07",
    re: new RegExp(`^(?:对方|对对手|对敌方)?造成(?:的)?伤害(?:的)?${NUM}%恢复(?:为|成|自身|自己)?的?(?:体力|HP)$|^伤害(?:的)?${NUM}%恢复(?:自身|自己)?(?:体力|HP)$`),
    go: (m) => ({ attachDamage: { drain: { numerator: num(m[1] ?? m[2]), denominator: 100 } } }) },
  // "技能威力加N%"/"威力加倍"→powerMul
  { id: "e53-pwr-02",
    re: new RegExp(`^(?:技能|攻击)?威力加${NUM}%$|^(?:技能|攻击)?威力加倍$`),
    go: (m) => ({ attachDamage: { powerMul: { numerator: m[1] !== undefined ? 100 + num(m[1]) : 2, denominator: 100 } } }) },
  // "受(到)?攻击则X"→react trigger1
  { id: "e53-atk-01",
    re: /^(?:受到|受)攻击(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(1, {}, m[1]) },
  // "恢复(自身)?所有PP"→pp_delta full（e6-104 的"无技能词"变体）
  { id: "e53-ppf-01",
    re: /^恢复(?:自身|自己)?所有[Pp][Pp](?:值)?$|^恢复(?:自身|自己)?所有pp$/,
    go: () => ({ effects: [{ op: "pp_delta", full: true, target: "self", scope: "all" }] }) },
  // "自身使用攻击技能则X"→react trigger12
  { id: "e53-use-04",
    re: /^自身使用攻击(?:技能)?(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(12, {}, m[1]) },
  // "致命(一击)?(机率|几率|概率)附加N/M"→crit_up（"附加"=增加词形）
  { id: "e53-crt-05",
    re: new RegExp(`^致命[一1]?击?(?:机率|几率|概率)附加${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "附加本次降低体力(值)?N%的固定伤害"→lastDmgFrac（当次伤害额为基线）
  { id: "e53-ldf-01",
    re: new RegExp(`^附加本次降低体力(?:值)?${NUM}%的?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { lastDmgFrac: { numerator: num(m[1]), denominator: 100 } } }) },
  // "给予对方伤害(的)?N/M恢复(自身)?体力"→drain frac
  { id: "e53-drn-08",
    re: new RegExp(`^给予对方伤害(?:的)?${NUM}\\s*/\\s*${NUM}恢复(?:自身|自己)?(?:体力|HP)$`),
    go: (m) => ({ attachDamage: { drain: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "受到伤害转化成体力"→dmg_to_heal（无 count 常驻窗）
  { id: "e53-cnv-02",
    re: /^(?:自身|自己)?受到(?:的)?(?:攻击)?伤害转化(?:成|为)(?:自身|自己)?(?:体力|HP|体力值)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  // "每回合使对方损失N点固定伤害"→foe_dot flat（"损失"动词变体）
  { id: "e53-tick-16",
    re: new RegExp(`^每回合(?:使|令)(?:对方|对手|敌方)损失${NUM}点(?:固定伤害|固伤|伤害|体力|HP)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { flat: num(m[1]) } }] }) },
  // "若本方先手(则|时)?X"→order:first 门包裹
  { id: "e53-fst-01",
    re: /^若(?:本方|我方|己方|自身|自己)先手(?:则|时|，|,)?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1]);
      if (sub.effects.length === 0) return null;
      const c = { order: "first" };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "使对手造成的伤害减少N/M"→dmg_weaken{n,d} opp（"减少"分数变体）
  { id: "e53-wkn-01",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)造成(?:的)?伤害减少${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "减少N/M的最大体力"→percent damage（主语省略按对手侧——"直接减少对手1/4最大体力"同族）
  { id: "e53-pct-03",
    re: new RegExp(`^(?:直接)?减少(?:对手|对方|敌方)?的?${NUM}\\s*/\\s*${NUM}(?:的)?最大体力$`),
    go: (m) => ({ attachDamage: { power: 1, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "对手下N次体力恢复效果减少N%"→heal_cut count 窗
  { id: "e53-hct-02",
    re: new RegExp(`^(?:对手|对方|敌方)下?${NUM}次(?:的)?体力恢复(?:的)?效果减少${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: num(m[2]) } }] }) },
  // "每回合结束时若敌我双方任意一方处于异常或能力下降状态则令对手受到N点固定伤害"→foe_dot flat + or 门
  { id: "e53-tick-17",
    re: new RegExp(`^每回合结束(?:时|后)?若(?:敌我)?双方?任意一方处于(?:异常状态?|异常)(?:或|和)?(?:能力)?下降(?:状态)?则令?(?:对手|对方|敌方)受到${NUM}点(?:固定伤害|固伤)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { flat: num(m[1]) }, if: { or: [{ selfStatused: true }, { foeStatused: true }, { selfStageDown: true }, { foeStageDown: true }] } }] }) },
  // "回合类效果无法被消除"→timed_lock（e42-118 同族裸形）
  { id: "e53-tlk-01",
    re: /^(?:自身|自己)?的?回合类效果无法被消除$/,
    go: () => ({ effects: [{ op: "apply_status", name: "timed_lock", target: "self" }] }) },
  // "使自身随机获得X状态或Y状态"——具名状态随机挑选域未建模 → 留档
  { id: "e53-def-17",
    re: /^使?自身随机获得.{1,8}状态(?:或|和|、).{1,8}状态$/,
    go: () => ({ unparsedReason: "self-random named-state pick unmodeled (deferred)" }) },
  // "首次使用的技能所附加的效果失效"——首发结算失效域未建模 → 留档
  { id: "e53-def-18",
    re: /^首次使用的技能所附加的效果失效$|^(?:令|使)首次使用的技能(?:所)?附加的效果失效$/,
    go: () => ({ unparsedReason: "first-use rider nullification unmodeled (deferred)" }) },
  // "进入的异常状态必定为控制类异常状态"——异常重分类域未建模 → 留档
  { id: "e53-def-19",
    re: /进入的异常状态必定为控制类异常状态|异常状态必定为控制类/,
    go: () => ({ unparsedReason: "ailment reclassification unmodeled (deferred)" }) },
  // "(对方|对手|敌方|自身|自己)消强"→clear_stages up（"消强"=消除强化口语缩写）
  { id: "e53-cls-04",
    re: /^(对方|对手|敌方|自身|自己)消强$/,
    go: (m) => ({ effects: [{ op: "clear_stages", target: /对手|对方|敌方/.test(m[1]) ? "opponent" : "self", sign: "up" }] }) },
  // "受到(的)?固定伤害和百分比伤害减少"裸尾——无额值量化 → 留档
  { id: "e53-def-20",
    re: /^(?:自身|自己)?受到(?:的)?(?:固定伤害|百分比伤害)(?:和|与|及)(?:固定伤害|百分比伤害)减少$/,
    go: () => ({ unparsedReason: "unquantified damage reduction (deferred)" }) },
  // ── 第十一批：异常转化/出场异常/统攻/对手hot变体/随机降属/条件翻倍/偷强 ──
  // "(令|使|把)对手所处的AIL转化为AIL"→cleanse 指定 effect + 定向异常（"将…"留给 e43-08：先条件施加再解除）
  { id: "e53-cvt-01",
    re: new RegExp(`^(?:令|使|把)(?:对手|对方|敌方)(?:所处)?(?:的)?(${AIL_RE})(?:状态)?转化为(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "cleanse", scope: "ailment", effect: AILMENTS[m[1]], target: "opponent" }, { op: "apply_status", name: AILMENTS[m[2]], target: "opponent" }] }) },
  // "(令|使)对手所处的异常状态转移给自身"——异常窃取域未建模 → 留档
  { id: "e53-def-21",
    re: /^(?:令|使|将|把)(?:对手|对方|敌方)(?:所处)?(?:的)?异常状态转移给(?:自身|自己|自己方)$/,
    go: () => ({ unparsedReason: "ailment steal unmodeled (deferred)" }) },
  // "令对手下N只出场精灵进入AIL"→nextFoe 异常
  { id: "e53-nxt-03",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)下?${NUM}?只?(?:出场|出战|上场)精灵进入(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "nextFoe" }] }) },
  // "令对手进入N种控制类异常状态"→random{list:CONTROL_AILS}（控制类=blockChance>0 硬控子集）
  { id: "e53-def-22",
    re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)进入${NUM}?种控制类异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: CONTROL_AILS, count: num(m[1] ?? "1") } }] }) },
  // "令对手攻击技能无法造成伤害"→self dmg_immune cat:4
  { id: "e53-nod-01",
    re: /^(?:令|使)(?:对手|对方|敌方)攻击(?:技能)?无法造成(?:伤害|任何伤害)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { cat: 4 } }] }) },
  // "令对手攻击和特攻中最高的能力值作为自己的能力值进行攻击"→unify_offense 对手侧
  { id: "e53-unf-01",
    re: /^(?:令|使)(?:对手|对方|敌方)(?:的)?攻击和特攻中最高的能力值作为自己的?能力值进行攻击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "unify_offense", target: "opponent" }] }) },
  // "回合结束时附加对手最大体力N/M的固伤"→foe_dot 分数
  { id: "e53-tick-18",
    re: new RegExp(`^(?:回合结束(?:时|后)|每回合)附加(?:对手|对方|敌方)最大体力${NUM}\\s*/\\s*${NUM}的?(?:固定伤害|固伤|伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "回合结束时附加对手造成伤害等量的固定伤害"——对手伤害量回响域未建模 → 留档
  { id: "e53-def-23",
    re: /^(?:回合结束(?:时|后)|每回合)附加(?:对手|对方|敌方)造成(?:的)?伤害等量(?:的)?(?:固定伤害|固伤|伤害)$/,
    go: () => ({ unparsedReason: "foe-dealt echo unmodeled (deferred)" }) },
  // "N%几率额外增加N(点)?固定伤害"→flatBonus+flatChance（bcm 孤儿概率回补同族）
  { id: "e53-fbc-01",
    re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?额外增加${NUM}点?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[2]), flatChance: num(m[1]) } }) },
  // "N%几率随机降低对方N个?属性N个?等级"→apply_stat_stage stat:random
  { id: "e53-rst-01",
    re: new RegExp(`^(?:${NUM}%)?(?:的?(?:概率|几率))?随机降低(?:对方|对手|敌方)${NUM}?个?属性(?:的)?${NUM}个?等级$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); const hasPct = m[1] !== undefined; const cnt = hasPct ? ns[1] : ns[0]; const d = hasPct ? ns[2] : ns[1]; return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: cnt ?? 1, delta: -(d ?? 1), target: "opponent", ...(hasPct ? { chance: ns[0] } : {}) }] }; } },
  // "若对手AIL(状态)?强化效果翻倍"→stageDouble + foeHas 门
  { id: "e53-dbl-02",
    re: new RegExp(`^若(?:对手|对方|敌方)(?:处于)?(${AIL_RE})(?:状态)?(?:则|时|，|,)?(?:强化|提升|能力强化|能力提升)效果翻倍$`),
    go: (m) => AILMENTS[m[1]] === undefined ? null : ({ attachAll: { stageDouble: true, effCond: { foeHas: AILMENTS[m[1]] } } }) },
  // "若对手AIL(状态)?附加N点(固定)?伤害"→flatIf foeHas
  { id: "e53-flt-02",
    re: new RegExp(`^若(?:对手|对方|敌方)(?:处于)?(${AIL_RE})(?:状态)?(?:则|时|，|,)?附加${NUM}点?(?:固定)?伤害$`),
    go: (m) => AILMENTS[m[1]] === undefined ? null : ({ attachDamage: { flatIf: { when: { foeHas: AILMENTS[m[1]] }, flat: num(m[2]) } } }) },
  // "令对手的能力强化转移到自己身上"→transfer_stages 默认拉取（attach-damage-101 同族）
  { id: "e53-tfs-02",
    re: /^(?:令|使|将|把)(?:对手|对方|敌方)(?:的)?能力(?:强化|提升)(?:状态)?转移到(?:自己|自身|自己方)(?:身上)?$/,
    go: () => ({ effects: [{ op: "transfer_stages" }] }) },
  // "每消耗1层X"——层数消耗计数域未建模 → 留档
  { id: "e53-def-24",
    re: new RegExp(`^(?:每|若|当)?消耗(?:${NUM}|一|两)?层`),
    go: () => ({ unparsedReason: "stack-consume counter unmodeled (deferred)" }) },
  // ── 第十二批：自异常/致死endure窗/承伤类别窗/反弹变体/先攻谓词/随机自异常 ──
  // "为自身附加N种异常状态"→random self
  { id: "e53-rsa-01",
    re: new RegExp(`^为?自身附加${NUM}种异常状态$|^为自身附加${NUM}?种异常$/`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "self", random: { list: ALL_AILS, count: num(m[1] ?? 1) } }] }) },
  // "吸取效果提升N点" / "提升至N/M"：都是给前一条吸血窗改值/改分数，不是新开命中 rider
  // （属性招无 damage 宿主，rider 会被分组器当孤儿拒载）。
  { id: "e53-drb-01",
    re: new RegExp(`^吸取效果提升${NUM}点$|^吸取效果提升至${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => m[2] !== undefined
      ? ({ attachAll: { drainBoostFrac: frac(m[2], m[3]) } })
      : ({ attachAll: { drainBoost: num(m[1]) } }) },
  // "若本次攻击未打出致命一击则X"→not prevCrit 门包裹
  { id: "e53-ocr-01",
    re: /^若本次攻击未打出致命一击则?(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1]);
      if (sub.effects.length === 0) return null;
      const c = { not: { prevCrit: true } };
      return { effects: sub.effects.map((e) => ({ ...e, if: e.if !== undefined ? { and: [c, e.if] } : c })), ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    },
  },
  // "若对手当回合(选择|使用)属性技能则X"→react trigger3 cat:1（"选择"词形）
  { id: "e53-foe-06",
    re: /^若?(?:对手|对方|敌方)当回合(?:选择|使用)(?:了)?属性技能(?:则|时|后|，|,)?(.+)$/,
    go: (m) => reactWrap(3, { cat: 1 }, m[1]) },
  // "若对手当回合未使用攻击技能则X"——foe-used-cat 谓词未建模 → 留档
  { id: "e53-def-25",
    re: /^若?(?:对手|对方|敌方)当回合未使用(?:攻击|属性)?技能/,
    go: () => ({ unparsedReason: "foe-didn't-use-cat predicate unmodeled (deferred)" }) },
  // "若命中前对手处于异常状态则将其能力提升状态视为相应的能力下降状态"→invert_stages + foeStatused
  { id: "e53-inv-01",
    re: /^若?(?:命中前)?(?:对手|对方|敌方)处于异常状态(?:时|则|，|,)?(?:将|把)其能力提升状态视为相应(?:的)?能力下降(?:状态|效果)$/,
    go: () => ({ effects: [{ op: "invert_stages", target: "opponent", sign: "up", if: { foeStatused: true } }] }) },
  // "下N次受到致死伤害时保留N点体力"→endure{hp,count}
  { id: "e53-end-01",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次受到(?:的)?(?:致死|致命)(?:攻击|伤害)(?:时|后)?保留${NUM}点?体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[2]) } }] }) },
  // "下N次受到的固定伤害减少N%"→dmg_taken_down count+kindMask（fixed=1/percent=2/true=8）
  { id: "e53-dtd-01",
    re: new RegExp(`^(?:自身|自己)?下?${NUM}次受到(?:的)?(固定伤害|百分比伤害|固定伤害和百分比伤害)减少${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { count: num(m[1]), pct: num(m[3]), kindMask: m[2].includes("和") ? 3 : m[2] === "固定伤害" ? 1 : 2 } }] }) },
  // "解除自身的<名>态"→cleanse self mark scope
  { id: "e53-rmv-01",
    re: /^解除自身的(.{2,10}?)(?:状态)?$/,
    go: (m) => /能力|强化|提升|下降|弱化/.test(m[1]) ? null : ({ effects: [{ op: "consume_mark", mark: m[1].replace(/态$/, ""), target: "self" }] }) },
  // "解除自身(的)?能力下降状态"→clear_stages self down
  { id: "e53-clr-02",
    re: /^解除自身(?:的)?(?:能力|能量)下降(?:状态)?$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // "N/M伤害反弹"→reflect_dmg 分数（"1/4伤害反弹"）
  { id: "e53-rfl-01",
    re: new RegExp(`^${NUM}\\s*/\\s*${NUM}伤害反弹(?:自身)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "受到任何伤害X"→react trigger1（"任何"量词变体）
  { id: "e53-atk-02",
    re: /^受到任何(?:的)?伤害(?:时|后|则|，|,)?(.+)$/,
    go: (m) => reactWrap(1, {}, m[1]) },
  // "每回合反弹(对方|对手)伤害(的)?N/M"→reflect_dmg 分数常驻
  { id: "e53-rfl-02",
    re: new RegExp(`^每回合反弹(?:对方|对手|敌方)(?:的)?伤害(?:的)?${NUM}\\s*/\\s*${NUM}$|^每回合反弹(?:对方|对手|敌方)${NUM}\\s*/\\s*${NUM}的?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // "(对方|对手)增强效果消失"→clear_stages up（"增强"=强化词形）
  { id: "e53-clr-03",
    re: /^(?:对方|对手|敌方)(?:的)?(?:所有)?(?:能力)?(?:增强|强化|提升)效果消失$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "最高100%使对手AIL"→孤儿 cap 前缀剥除 + 异常（"最高"=cap 残留，独立句读=概率上限值）
  { id: "e53-cap-11",
    re: new RegExp(`^最高${NUM}%(?:使|令)(对手|对方|敌方|自身|自己|本方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: /对手|对方|敌方/.test(m[2]) ? "opponent" : "self", chance: num(m[1]) }] }) },
  // "HP小于N/M威力翻倍"→scaleIf selfHpBelow（无"若"裸条件句）
  { id: "e53-scl-03",
    re: new RegExp(`^(?:自身|自己)?HP小于${NUM}\\s*/\\s*${NUM}(?:时|则|，|,)?威力(?:为${NUM}倍|翻倍|加倍)$`),
    go: (m) => ({ attachDamage: { scaleIf: { when: { selfHpBelow: frac(m[1], m[2]) }, numerator: m[3] !== undefined ? num(m[3]) : 2, denominator: 1 } } }) },
  // "N%概率出现AIL、AIL…"（概率前缀可被 bcm 剥走——几率位可选）→random list + chance
  { id: "e53-ral-01",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:概率|几率))?)?(?:令|使)?(对手|对方|敌方|自身|自己)?出现((?:${AIL_RE})(?:[、，,](?:${AIL_RE}))+)(?:中|之中)?的?${NUM}?种?(?:异常)?(?:状态)?$`),
    go: (m) => { const list = m[3].split(/[、，,]/).map((k) => AILMENTS[k]).filter((x) => x !== undefined); return list.length < 2 ? null : { effects: [{ op: "apply_status", name: "random", target: /对手|对方|敌方/.test(m[2] ?? "") ? "opponent" : "self", ...(m[1] !== undefined ? { chance: num(m[1]) } : {}), random: { list, count: m[4] !== undefined ? num(m[4]) : 1 } }] }; } },
  // "N%命中率"——裸命中率尾句：acc 通道未建模留档
  { id: "e53-def-36",
    re: new RegExp(`^(?:${NUM}%)?命中率$`),
    go: () => ({ unparsedReason: "accuracy-rate adjust — acc channel unmodeled (deferred)" }) },
  // "N%概率免疫对手伤害"→dmg_immune chance
  { id: "e53-imm-06",
    re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?免疫(?:对手|对方|敌方)?(?:的)?(?:攻击)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", chance: num(m[1]) }] }) },
  // "N%?降低自身当前体力N/M"→self percent current damage
  { id: "e53-pct-04",
    re: new RegExp(`^(?:${NUM}%)?(?:的?(?:概率|几率))?(?:降低|减少)自身当前体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", kind: "percent", power: 1, percentBase: "current", frac: frac(ns[ns.length - 2], ns[ns.length - 1]), target: "self", ...(m[1] !== undefined ? { chance: ns[0] } : {}) }] }; } },
  // "受到物理攻击N%(的)?(几率)?将?对手AIL"→react trigger1 cat:2 + ailment payload
  { id: "e53-atk-03",
    re: new RegExp(`^受到物理攻击(?:时|后)?(?:有)?${NUM}%的?(?:几率|概率)?(?:将|令|使)?(?:(对手|对方|敌方)(${AIL_RE})|(${AIL_RE})(对手|对方|敌方))(?:状态)?$`),
    go: (m) => { const subj = m[2] ?? m[5]; const ail = m[3] ?? m[4]; return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, cat: 2 }, payload: [{ op: "apply_status", name: AILMENTS[ail], target: /对手|对方|敌方/.test(subj) ? "opponent" : "self", chance: num(m[1]) }] }] }; } },
  // "(本回合|当回合)?(自身|本方)疲惫(一|1)回合无法攻击"/"本方一回合无法攻击"→自疲惫 1 回合
  { id: "e53-fat-02",
    re: /^(?:本回合|当回合)?(?:自身|自己|本方)疲惫?(?:一|1)回合无法攻击$|^(?:自身|自己|本方)(?:一|1)回合无法攻击$|^(?:自身|自己|本方|己方|我方)疲惫$/,
    go: () => ({ effects: [{ op: "apply_status", name: "fatigue", target: "self", turns: 1 }] }) },
  // "(自身)?(攻击|特攻)命中提高N个等级"——spa/atk+acc 双维
  { id: "e53-stg-12",
    re: new RegExp(`^(?:自身|自己|令自身)?(攻击|特攻)(?:、|和)?命中(?:等级)?(?:提高|提升|增加|增强|上升)${NUM}个?等级?$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: m[1] === "特攻" ? "spa" : "atk", delta: num(m[2]), target: "self" }, { op: "apply_stat_stage", stat: "acc", delta: num(m[2]), target: "self" }] }) },
  // "若消耗的PP值≥N点则X"——PP 消耗谓词未建模 → 留档
  { id: "e53-def-26",
    re: new RegExp(`^若?(?:此技能|本技能|技能)?消耗(?:的)?PP值?(?:≥|>=|大于等于|大于|超过|达到)${NUM}`),
    go: () => ({ unparsedReason: "pp-spent predicate unmodeled (deferred)" }) },
  // "附加大量真实伤害"——真实伤害大量=未量化 → 留档
  { id: "e53-def-27",
    re: /^附加大量真实伤害|附加大量(?:的)?真实?伤害/,
    go: () => ({ unparsedReason: "unquantified true damage (deferred)" }) },
  // "对手回合类效果被消除后X"——timed 消除触发窗未建模 → 留档
  { id: "e53-def-28",
    re: /^(?:对手|对方|敌方)回合类效果被消除后/,
    go: () => ({ unparsedReason: "timed-effect removal trigger unmodeled (deferred)" }) },
  // "为自身附加回合数等于其中烧伤回合数合计的<名>"——跨异常回合聚合 → 留档
  { id: "e53-def-29",
    re: /附加回合数等于|回合数合计/,
    go: () => ({ unparsedReason: "cross-ailment turns aggregate unmodeled (deferred)" }) },
  // "若本次攻击微弱对手则X"——微弱谓词+除法缩放复合 → 留档
  { id: "e53-def-30",
    re: /^若本次攻击微弱对手则|^若攻击微弱/,
    go: () => ({ unparsedReason: "weak-hit conditional + divisor scale unmodeled (deferred)" }) },
  // "恢复120点HP"+STAT列表复合（"被攻击恢复120点HP防御特防+2"——HP+双维同句）→heal+stageFx
  { id: "e53-cmp-02",
    re: new RegExp(`^(?:恢复|回复)${NUM}点(?:HP|体力)((?:${STAT_RE})(?:${STAT_RE})?)[+＋](${NUM})$`),
    go: (m) => { const stats = m[2].match(/特攻|特功|特防|攻击|防御|速度|命中|物攻|物防/g) ?? [m[2]]; const st = stats.map((k) => STATS[k]).filter((x) => x !== undefined); return st.length === 0 ? null : { effects: [{ op: "heal", flat: num(m[1]), target: "self" }, ...st.map((s) => ({ op: "apply_stat_stage", stat: s, delta: num(m[3]), target: "self" }))] }; } },
  // "附加等同于<名>的体力N%的百分比伤害"——具名印记宿主 HP 基线未建模 → 留档
  { id: "e53-def-14",
    re: new RegExp(`^附加等同于.{1,8}的体力${NUM}%的?百分比伤害$|^附加等同于.{1,8}的体力${NUM}%$`),
    go: () => ({ unparsedReason: "named-mark hp base — mark-hp percent damage unmodeled (deferred)" }) },
  // "此技能命中值提升N"——命中通道未建模（e26-95 同族）→留档
  { id: "e53-def-13",
    re: new RegExp(`^(?:此|本|该)?技能命中(?:值|率|度)(?:提升|提高|增加)${NUM}%?$`),
    go: () => ({ unparsedReason: "accuracy-rate adjust — acc channel unmodeled (deferred)" }) },
  // ── 第十三批：no-rule 残余——翻转/定额承伤/上限消耗/赋予/裸尾 ───────────
  // "使对手的能力等级提升翻转为能力等级下降" → invert_stages foe（升→降定向翻转）
  { id: "e53-inv-02",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)的?(?:能力(?:等级)?(?:的)?)?(?:提升|强化|增强|上升)(?:的)?(?:状态)?翻转为(?:能力(?:等级)?(?:的)?)?(?:下降|降低|弱化)(?:的)?(?:状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", target: "opponent", sign: "up" }] }) },
  // "每次受到伤害减少N点" → dmg_reduce flat（每次受击定额减免）
  { id: "e53-rdc-02",
    re: new RegExp(`^每次受到(?:的)?(?:攻击)?伤害减少${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // "附加(对方|对手|敌方)的?STAT值的?N%固定伤害" → flatFoeStatPct（对手属性值定额固伤——e31 同键的 attachDamage 形）
  { id: "e53-fsf-01",
    re: new RegExp(`^附加(?:对方|对手|敌方)的?(${STAT_RE})值的?${NUM}%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => { const s = STATS[m[1]]; return s === undefined || s === "acc" ? null : { attachDamage: { flatFoeStatPct: { stat: s, pct: num(m[2]) } } }; } },
  // "消耗自身体力上限的N%" → self percent damage（上限百分比体力代价）
  { id: "e53-cst-02",
    re: new RegExp(`^(?:消耗|扣除|损失)(?:自身|自己)?(?:的)?(?:最大)?(?:体力|HP)(?:上限)?的${NUM}%$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, percentBase: "selfMax", frac: frac(num(m[1]), 100), target: "self" }] }) },
  // "(自身)?能力不会下降" → immune_degrade（能力下降免疫裸句）
  { id: "e53-igd-01",
    re: /^(?:自身|自己)?(?:的)?能力(?:等级)?(?:强化状态|提升状态)?不会(?:被|受到)?(?:的)?(?:下降|降低|减少|弱化)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "(使|令)(自身|自己)攻击必中" → accuracy always（attach-damage-13 同旗裸句形）
  { id: "e53-hit-10",
    re: /^(?:使|令|让)?(?:自身|自己)(?:的)?(?:攻击|技能|所有攻击|全部攻击)?(?:必定命中|必中|必定击中)$/,
    go: () => ({ flags: { accuracy: "always" } }) },
  // "随机赋予对手N种异常(状态)?" → random（"赋予"谓词变体）
  { id: "e53-ral-02",
    re: new RegExp(`^随机(?:赋予|给予)${NUM}种?异常(?:状态)?$|^随机赋予(?:对手|对方|敌方)${NUM}种?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: num(m[1] ?? m[2] ?? "1") } }] }) },
  // "N%AIL(状态)?" → ailment foe chance（"命中后40%烧"尾句——bcm 不吃 AIL 裸词首）
  { id: "e53-pct-05",
    re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  // "伤害N/M恢复体力" → drain frac（heal-10 的分数变体——百分号外的分数形）
  { id: "e53-drn-09",
    re: new RegExp(`^(?:造成的|攻击造成的)?伤害(?:值|数值)?的?${NUM}\\s*/\\s*${NUM}(?:将|会|则)?(?:恢复|回复|转化为|转为)(?:自身|自己)?体力$`),
    go: (m) => ({ attachDamage: { drain: frac(m[1], m[2]) } }) },
  // ── 第十四批 ──────────────────────────────────────────────────
  // "每回合受到的伤害减半" → dmg_taken_down pct50（每回合窗=常驻等效）
  { id: "e53-rdc-03",
    re: /^每回合受到(?:的)?(?:攻击|攻击技能)?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }] }) },
  // "(使|令)?对手的属性攻击失效" → move_null cat1（attach-damage-34 的"攻击"词形变体）
  { id: "e53-nul-02",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)的?属性(?:技能|攻击)失效$/,
    go: () => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 } }] }) },
  // "附加(对手)?已损失体力N%(的)?(固伤|固定伤害)" → flatFoeFrac base:missing
  { id: "e53-ffm-01",
    re: new RegExp(`^附加(?:对手|对方|敌方)?已损失体力(?:值)?的?${NUM}%(?:的)?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatFoeFrac: { numerator: num(m[1]), denominator: 100, base: "missing" } } }) },
  // "必定造成双倍伤害"（必定领起形）。放在 e53-mul-02 前面，那条动词后不得带「必定」。
  { id: "e53-mul-02a",
    re: /^必定造成(?:的)?双倍伤害$/,
    go: () => ({ attachDamage: { mul: { numerator: 2, denominator: 1 } } }) },
  // "造成双倍伤害"/"双倍伤害" → mul 2（"双倍"不全局归一——保护"双倍反转/奉还/反馈"字面值）
  { id: "e53-mul-02",
    re: /^造成(?:的)?双倍伤害$|^双倍伤害$/,
    go: () => ({ attachDamage: { mul: { numerator: 2, denominator: 1 } } }) },
  // "绝对优先出招" → prio_up 大幅（e11 必定先手同族近似——+9 覆盖常规区间）
  { id: "e53-pr-02",
    re: /^绝对优先(?:出招|出手|攻击|行动)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 9 } }] }) },
  // "消除(对手)能力的上升状态" → clear_stages up（"上升"词形变体）
  { id: "e53-clr-04",
    re: /^(?:消除|清除|解除)(?:对手|对方|敌方)的?能力(?:的)?(?:上升|提升|强化|增强)(?:的)?(?:状态|效果)$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "受到(的)?(攻击)?伤害转换为(自身)?体力" → dmg_to_heal（"转换为"变体）
  { id: "e53-dth-02",
    re: /^受到(?:的)?(?:攻击)?伤害转换为(?:自身|自己)?体力$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_to_heal", target: "self" }] }) },
  // "(对手)?技能消耗N倍PP(值)?" → pp_mul（"消耗2倍PP"语序变体）
  { id: "e53-ppm-02",
    re: new RegExp(`^(?:对手|对方|敌方)的?技能消耗${NUM}倍PP值?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_mul", target: "opponent", params: { mul: num(m[1]) } }] }) },
  // "(吞噬|吸取|吸收|偷取)对手的能力提升(效果)?(转移到自身)" → transfer_stages steal
  { id: "e53-stl-02",
    re: /^(?:吞噬|吸取|吸收|偷取|转化)(?:对手|对方|敌方)的?(?:能力)?(?:提升|强化|上升|增强)(?:的)?(?:状态|效果)?(?:并)?(?:转移?到(?:自己|自身)身上?)?$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "steal" }] }) },
  // "增加N(固伤|固定伤害)" → flatBonus（e48-27 的"点"省字变体）
  { id: "e53-flt-06",
    re: new RegExp(`^(?:增加|附加)${NUM}(?:固伤|固定伤害)$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // "免疫异常(和)?弱化" → immune_status+immune_degrade（"异常弱化"=异常+能力下降合称）
  { id: "e53-igd-02",
    re: /^免疫(?:的)?异常(?:和|与|及)?弱化(?:状态)?$|^免疫异常弱化$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "恢复(自身)?体力N(点)?"/"恢复N(点)?" → heal flat（数尾省"点体力"）
  { id: "e53-hl-02",
    re: new RegExp(`^(?:恢复|回复)(?:自身|自己)?体力${NUM}(?:点)?$|^(?:恢复|回复)${NUM}点?$|^(?:恢复|回复)(?:自身|自己)?${NUM}点?(?:的)?(?:体力|HP)$`),
    go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2] ?? m[3]), target: "self" }] }) },
  // ── 第十五批 ──────────────────────────────────────────────────
  // "(为|给)自身创造(一个)?N点(体力|HP)?(的)?护盾" → shield flat（"500点体力的护盾"——attach-damage-92 的无吸收词变体）
  { id: "e53-sh-02",
    re: new RegExp(`^(?:为|给)?(?:自身|自己)创造(?:一|1)个?(?:的)?${NUM}点?(?:体力|HP)?的?护盾$|^(?:为|给)?(?:自身|自己)创造(?:一|1)个?${NUM}点护盾$|^(?:为|给)?(?:自身|自己)创造(?:一|1)?个?体力为${NUM}的?护盾$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: ns[ns.length - 1] } }] }; } },
  // "威力N-M随机"/"威力随机N-M" → powerRange（e50-01 词序变体）
  { id: "e53-pwr-03",
    re: new RegExp(`^威力${NUM}\\s*[-~～—至到]\\s*${NUM}(?:点)?随机$|^威力${NUM}\\s*[-~～—至到]\\s*${NUM}(?:点)?$`),
    go: (m) => ({ attachDamage: { powerRange: { min: num(m[1] ?? m[3]), max: num(m[2] ?? m[4]) } } }) },
  // "连续每次加N%，最高M%" → powerPerUse+useCap（e49-06 的"使用"省字变体）
  { id: "e53-ppu-02",
    re: new RegExp(`^连续每次加${NUM}%(?:，|,)?最高(?:至|到|为|提升|增加)?${NUM}%?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[2]) } }) },
  // "(自身)?随机一项?属性提升N阶段" → random stat +N self（"项/阶段"量词变体）
  { id: "e53-rst-02",
    re: new RegExp(`^(?:自身|自己)?随机(?:一|1)项?属性?(?:等级)?(?:提升|提高|增加)${NUM}(?:个)?(?:阶段|等级)?$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: "random", randomCount: 1, delta: num(m[1]), target: "self" }] }) },
  // "(对手|对方|敌方)随机(一|N)?项?属性降低N阶段" → random stat -N foe
  { id: "e53-rst-03",
    re: new RegExp(`^(?:对手|对方|敌方)随机(?:(一|1)项?|(${NUM})项)?属性?(?:等级)?(?:降低|下降|减少)${NUM}(?:个)?(?:阶段|等级)?$`),
    go: (m) => { const cnt = m[2] !== undefined ? num(m[2]) : 1; const d = num(m[3] ?? m[4]); return { effects: [{ op: "apply_stat_stage", stat: "random", randomCount: cnt, delta: -d, target: "opponent" }] }; } },
  // "(令|使)对方增强效果消失" → clear_stages up（attach-damage-42 的"所有能力"省字变体）
  { id: "e53-clr-05",
    re: /^(?:令|使|消除)?(?:对方|对手|敌方)(?:所有)?能力?(?:增强|强化|提升|上升)效果消失$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent", sign: "up" }] }) },
  // "每次攻击附加N点固定伤害" → flatBonus（每击固伤=attachDamage 平铺等价）
  { id: "e53-flt-07",
    re: new RegExp(`^每次攻击附加${NUM}点?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatBonus: num(m[1]) } }) },
  // "受到(的)?伤害N倍返还(给)?(对手)?" → reflect_dmg n:1
  { id: "e53-ref-03",
    re: new RegExp(`^受到(?:的)?(?:攻击)?伤害(?:的)?${NUM}倍(?:反馈|返还|反弹|奉还)(?:给)?(?:对手|对方|敌方)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 1 } }] }) },
  // "反转(对手)能力上升(状态)?" → invert_stages foe（"反转"="翻转"变体）
  { id: "e53-inv-03",
    re: /^(?:使|令|让)?反转(?:对手|对方|敌方)的?能力(?:上升|提升|强化|增强)(?:的)?(?:状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", target: "opponent", sign: "up" }] }) },
  // ── 第十六批 ──────────────────────────────────────────────────
  // "N%(AIL)(对手|对方|敌方)" → ailment 倒装（"10%冻伤对方"）
  { id: "e53-pct-06",
    re: new RegExp(`^${NUM}%(?:的?(?:概率|几率))?(${AIL_RE})(对手|对方|敌方)(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  // "(自身)?(STAT)每回合±N" → stage_tick self（"速度每回合-1"主语省字）
  { id: "e53-tck-02",
    re: new RegExp(`^(${STAT_RE})每回合([+-])${NUM}$`),
    go: (m) => { const st = STATS[m[1]]; return st === undefined ? null : { effects: [liftTick({ op: "apply_status", name: "stage_tick", target: "self", params: { stat: STAT_CODE[st], delta: (m[2] === "-" ? -1 : 1) * num(m[3]) } })] }; } },
  // "牺牲(全部)?体力(给|为)对手造成N-M点伤害" → selfHp + flatRange foe
  { id: "e53-sui-02",
    re: new RegExp(`^牺牲(?:自身|自己)?(?:所有|全部)?(?:的)?(?:体力|HP|生命)(?:给|为|对)?(?:对手|对方|敌方)?造成${NUM}\\s*[-~～—至到]\\s*${NUM}点?(?:固定|固伤|的)?伤害$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: 0, target: "self", selfHp: true }, { op: "damage", kind: "fixed", power: 0, flatRange: { min: num(m[1]), max: num(m[2]) }, target: "opponent" }] }) },
  // "每回合对手的能力强化状态都会转移到自己身上" → steal_stages_tick（回合末吸强）
  { id: "e53-stl-03",
    re: /^每回合(?:对手|对方|敌方)的?能力(?:强化|提升|上升|增强)(?:的)?状态?(?:都)?(?:会)?转移到(?:自己|自身)身上?$/,
    go: () => ({ effects: [liftTick({ op: "apply_status", name: "steal_stages_tick", target: "self" })] }) },
  // "(该|本|此)?技能暴击率N%" → critChanceFrac 基率（非提升——天生面板率）
  { id: "e53-crc-02",
    re: new RegExp(`^(?:该|本|此)?技能暴击率(?:为|是)?${NUM}%$`),
    go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: 100 } } }) },
  // "若(对手)本回合恢复体力则X" → react trigger15（"本回合"变体——e35-09 同族）
  { id: "e53-trg15-01",
    re: /^若?(?:对手|对方|敌方)(?:本回合|当回合)(?:恢复|回复)(?:了)?(?:体力|HP)(?:时|则|，|,)?(.+)$/,
    go: (m) => reactWrap(15, {}, m[1]) },
  // "(降低|减少)对手N/M-N/M体力" → percent damage fracRange（分数区间削减）
  { id: "e53-pct-07",
    re: new RegExp(`^(?:降低|减少|扣除)(?:对手|对方|敌方)(?:的)?${NUM}\\s*\\/\\s*${NUM}\\s*[-~～—至到]\\s*${NUM}\\s*\\/\\s*${NUM}(?:的)?(?:体力|HP)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, fracRange: { min: frac(m[1], m[2]), max: frac(m[3], m[4]) }, target: "opponent" }] }) },
  // ── 第十七批 ──────────────────────────────────────────────────
  // "(使|令)?对手(所有)?先制(类)?效果失效" → prio_negate foe（"使对手所有先制效果失效"）
  { id: "e53-prn-01",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)的?(?:所有|全部|任何)?先制(?:类)?效果失效$/,
    go: () => ({ effects: [{ op: "apply_status", name: "prio_negate", target: "opponent" }] }) },
  // "(对手)?(属性技能|攻击技能|技能)(命中)?效果失效" → move_null cat（"属性技能命中效果失效"）
  { id: "e53-mvl-02",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)?的?(属性技能|攻击技能|攻击|技能)(?:命中)?(?:的)?效果失效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: /属性/.test(m[1]) ? 1 : /攻击/.test(m[1]) ? 4 : 0 } }] }) },
  // "(消除|清除|解除)对手(STAT)能力|效果" → clear_stages stats（"消除对手防御能力"防御→双防）
  { id: "e53-clr-07",
    re: new RegExp(`^(?:消除|清除|解除)(?:对手|对方|敌方)的?(${STAT_RE})(?:能力|效果)$`),
    go: (m) => { const st = STATS[m[1]]; if (st === undefined) return null; return { effects: [{ op: "clear_stages", target: "opponent", stats: st === "def" ? ["def", "sdf"] : [st] }] }; } },
  // "N/M致命一击" → critChanceFrac 分率先置（"4/16致命一击"）
  { id: "e53-crc-03",
    re: new RegExp(`^${NUM}\\s*\\/\\s*${NUM}致命[一1]?击$`),
    go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "(使|令)?对手受到的伤害翻倍" → dmg_taken_up pct:100
  { id: "e53-dtu-01",
    re: /^(?:使|令|让)?(?:对手|对方|敌方)(?:的)?受到(?:的)?伤害翻倍$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", params: { pct: 100 } }] }) },
  // "无异常(状态)?和(能力)?下降" → 双免疫（"炎魔之铠"：免疫异常+免疫弱化）
  { id: "e53-imm-08",
    re: /^无异常(?:状态)?和(?:能力)?下降$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // "使对手进入异常状态的概率提升N%"——异常施加概率增幅通道未建模 → 留档
  { id: "e53-def-37",
    re: new RegExp(`^(?:每次(?:直接)?攻击)?(?:使|令)?(?:对手|对方|敌方)(?:随机)?进入异常状态的概率(?:提升|提高|增加)${NUM}%$|^使对手进入异常状态的概率(?:提升|提高|增加)${NUM}%$`),
    go: () => ({ unparsedReason: "ailment-apply chance boost unmodeled (deferred)" }) },
  // "(使|令)对手(当回合)?(拥有的)?回合类效果消失" → cleanse timed（"令对手当回合拥有的回合类效果失效"）
  { id: "e53-cls-05",
    re: /^(?:使|令|让)(?:对手|对方|敌方)(?:当回合|本回合|当前)?(?:当前)?(?:拥有的)?回合类效果消失$/,
    go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
  // "(层数|回合数|次数)?为偶数X"——奇偶谓词未建模 → 留档
  { id: "e53-def-34",
    re: /^(?:层数|回合数|次数|数量|回合)?为偶数/,
    go: () => ({ unparsedReason: "parity predicate unmodeled (deferred)" }) },
  // ── 第十八批 ──────────────────────────────────────────────────
  // "(为|给)自身创造(一)?个?体力为N的护罩" → ward flat（护罩=ward 与护盾分立）
  { id: "e53-shd-03",
    re: new RegExp(`^(?:为|给)?(?:自身|自己)创造(?:一|1)?个?体力为${NUM}的?护罩$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "ward", target: "self", params: { flat: num(m[1]), kindMask: 3 } }] }) },
  // "(使|令)?(对手)除(STAT)外的(属性|能力)±N" → 其余各维 stage（"对方除速度外的属性-1"）
  { id: "e53-stg-10",
    re: new RegExp(`^(?:使|令|让)?(?:对手|对方|敌方)除(${STAT_RE})外(?:的)?(?:属性|能力)?([+-]${NUM}|提升${NUM}|提高${NUM}|增加${NUM}|降低${NUM}|减少${NUM})$`),
    go: (m) => { const ex = STATS[m[1]]; if (ex === undefined) return null; const dn = m[2].match(new RegExp(NUM)); if (dn === null) return null; const d = (/降低|减少|-/.test(m[2]) ? -1 : 1) * num(dn[0]); return { effects: [...new Set(Object.values(STATS))].filter((v) => v !== ex).map((v) => ({ op: "apply_stat_stage", stat: v, delta: d, target: "opponent" })) }; } },
  // "(使|令)对手本回合(技能|攻击|属性技能|攻击技能)失效" → move_null turns:1 cat
  { id: "e53-mvl-03",
    re: /^(?:使|令|让)(?:对手|对方|敌方)(?:本回合|当回合|当前回合)(属性技能失效|攻击技能失效|技能失效|攻击失效)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", turns: 1, params: { cat: /属性/.test(m[1]) ? 1 : /攻击/.test(m[1]) ? 4 : 0 } }] }) },
  // "免疫大于N的(攻击)?伤害" → dmg_immune_above{max}（>N 归零）
  { id: "e53-ima-01",
    re: new RegExp(`^免疫大于${NUM}的?(?:攻击)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune_above", target: "self", params: { max: num(m[1]) } }] }) },
  // ── 第十九批 ──────────────────────────────────────────────────
  // "复制对手(STAT、)…的能力(提升|上升|强化)状态" → copy_stages sign:up（枚举剥壳后命中——段位列表即"全部正面段"语义）
  { id: "e53-cpy-01",
    re: new RegExp(`^复制(?:对手|对方|敌方)(?:的)?(?:(?:${STAT_RE})[、])*(?:${STAT_RE})?的?能力(?:提升|上升|强化|增强)(?:的)?状态$|^复制(?:对手|对方|敌方)(?:的)?全属性(?:的)?能力(?:提升|上升|强化|增强)(?:的)?状态$`),
    go: () => ({ effects: [{ op: "copy_stages", sign: "up", target: "opponent" }] }) },
  // "每回合使对手N项能力-M并附加给自己" → steal_rand_tick（回合末随机吸强 count 门）
  { id: "e53-stt-01",
    re: new RegExp(`^每回合(?:使|令)(?:对手|对方|敌方)${NUM}项能力([+-]${NUM})(?:并)?附加给(?:自己|自身)$`),
    go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "steal_rand_tick", target: "self", params: { count: num(m[1]) } })] }) },
  // "翻转自身能力(下降|降低|弱化)(效果)?" → invert_stages self sign:down（"翻转"="反转"变体）
  { id: "e53-inv-04",
    re: /^翻转(?:自身|自己)的?能力(?:下降|降低|弱化)(?:的)?(?:状态|效果)?$|^翻转(?:自身|自己)的?能力(?:下降|降低)效果$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  // "消除(双方|对手)?能力提升状态、能力下降状态和(护盾|护罩|回合类)(类)?效果" → clear up+down + cleanse scope（双侧时 self+opponent 双发）
  { id: "e53-bth-01",
    re: /^消除(双方|敌我双方|敌我|对手|对方|敌方)?能力(?:提升|上升|强化|增强)(?:的)?(?:状态)?[、，,](?:能力)?(?:下降|降低)(?:的)?状态和?(护盾|护罩|回合类)(?:类)?(?:效果)?$/,
    go: (m) => { const both = /双方|敌我/.test(m[1] ?? ""); const ts = both ? ["self", "opponent"] : ["opponent"]; const scope = m[2] === "回合类" ? "timed" : "shield"; return { effects: ts.flatMap((x) => [{ op: "clear_stages", sign: "up", target: x }, { op: "clear_stages", sign: "down", target: x }, { op: "cleanse", scope, target: x }]) }; } },
  // "每次使用增加N项，最高M项"——逐项 stage 计数随用增长未建模 → 留档
  { id: "e53-def-38",
    re: new RegExp(`^每次使用增加${NUM}项(?:，|,|且)?(?:最高|最多)${NUM}项?$|^每次使用增加${NUM}项$`),
    go: () => ({ unparsedReason: "per-use stat count growth unmodeled (deferred)" }) },
  // ── 第二十一批 ────────────────────────────────────────────────
  // "命中对手"→flags accuracy always（bcm 概率壳剥后裸句——"100%命中对手"=必中）
  { id: "e53-hit-11",
    re: /^命中(?:对手|对方|敌方)$/,
    go: () => ({ flags: { accuracy: "always" } }) },
  // "每回合有N%使对手属性技能失效" → ailment_tick payload move_null cat1 chance
  { id: "e53-tck-03",
    re: new RegExp(`^每回合有${NUM}%(?:的?(?:概率|几率))?使(?:对手|对方|敌方)属性技能失效$`),
    go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, chance: num(m[1]) }] })] }) },
  // "每回合有N%令自身全属性±M" → ailment_tick payload all-stage chance
  { id: "e53-tck-04",
    re: new RegExp(`^每回合有${NUM}%(?:的?(?:概率|几率))?(?:令|使)(?:自身|自己)全属性([+-]${NUM})$`),
    go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "ailment_tick", target: "self", payload: [{ op: "apply_stat_stage", stat: "all", delta: num(m[2]), target: "self", chance: num(m[1]) }] })] }) },
  // "使自身的能力下降状态反转成能力上升(状态)?" → invert self down（"反转成能力上升"变体）
  { id: "e53-inv-05",
    re: /^(?:使|令)(?:自身|自己)的?能力(?:下降|降低)(?:的)?(?:状态|效果)?反转(?:成|成为|为)(?:能力)?(?:提升|上升)(?:的)?(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  // "反转自身弱化(效果|状态)?" → invert self down（"弱化"="能力下降"同义）
  { id: "e53-inv-06",
    re: /^反转(?:自身|自己)弱化(?:的)?(?:效果|状态)?$|^反转(?:自身|自己)的?能力弱化(?:的)?(?:效果|状态)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "down", target: "self" }] }) },
  // "给予对手损伤的一半恢复自身血量" → drain 1/2（"损伤的一半"="伤害的一半"省字）
  { id: "e53-drn-10",
    re: /^给予(?:对手|对方|敌方)损(?:伤的)?一半(?:会|将|并)?(?:回|恢)复(?:自己|自身|我方)(?:的)?(?:血量|体力|HP)$/,
    go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 2 } } }) },
  // "当次攻击击败对手减少下只出战精灵N/M血量" → damage percent nextFoe + foeFainted 门
  { id: "e53-nft-01",
    re: new RegExp(`^当次攻击击败(?:对手|对方|敌方)减少(?:对方|对手|敌方)?下只(?:出战)?精灵${NUM}\\s*\\/\\s*${NUM}(?:血量|体力|HP)$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: 1, frac: frac(m[1], m[2]), target: "nextFoe", if: { foeFainted: true } }] }) },
  // "令对手有N%的几率进入AIL" → ailment chance（"有N%几率"介词变体）
  { id: "e53-pct-08",
    re: new RegExp(`^令(?:对手|对方|敌方)有${NUM}%的?(?:概率|几率)(?:进入|陷入)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const ail = AILMENTS[m[2]]; return ail === undefined ? null : { effects: [{ op: "apply_status", name: ail, target: "opponent", chance: num(m[1]) }] }; } },
  // "(使|令)自身免疫下N次受到的伤害" → dmg_immune{count}
  { id: "e53-imi-01",
    re: new RegExp(`^(?:使|令)(?:自身|自己)免疫下${NUM}次受到(?:的)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1]) } }] }) },
  // "每回合吸收对手强化状态" → steal_stages_tick（"吸收"="吸取"变体）
  { id: "e53-stl-04",
    re: /^每回合吸收(?:对手|对方|敌方)(?:的)?(?:能力)?(?:强化|提升|上升|增强)(?:的)?状态$/,
    go: () => ({ effects: [liftTick({ op: "apply_status", name: "steal_stages_tick", target: "self" })] }) },
  // "对方攻击伤害是正常状态下的N/M倍" → dmg_weaken（"是…倍"语序变体）
  { id: "e53-wkn-02",
    re: new RegExp(`^(?:对方|对手|敌方)攻击伤害是正常状态下的?${NUM}\\s*\\/\\s*${NUM}倍?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "所有技能的PP值提高N点" → pp_delta +N all
  { id: "e53-pp-14",
    re: new RegExp(`^所有技能的?PP(?:值)?(?:提高|提升|增加|恢复)${NUM}点?$`),
    go: (m) => ({ effects: [{ op: "pp_delta", amount: num(m[1]), target: "self", scope: "all" }] }) },
  // "(使|令)对手随机N个的PP归零" → zeroRandom（"个的PP"脱字变体）
  { id: "e53-pp-15",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)随机${NUM}个(?:的)?PP(?:值)?归零$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // "(使|令)?自身体力值?降为1" → heal set:1（"体力值"变体——e42-115 姊妹）
  { id: "e53-set-01",
    re: /^(?:使|令)(?:自身|自己)(?:的)?体力值?降为(?:1|一)(?:点)?$/,
    go: () => ({ effects: [{ op: "heal", set: 1, target: "self" }] }) },
  // "(为|给)自身增加N点?护盾" → shield flat（"增加"动词+无"点"变体——attach-damage-91 补漏）
  { id: "e53-shd-04",
    re: new RegExp(`^(?:为|给)(?:自身|自己)增加${NUM}点?护盾$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flat: num(m[1]) } }] }) },
  // "连续使用每次威力增加N，最高增加威力M" → powerPerUse+useCap（无%纯威力步进——e40-112 姊妹）
  { id: "e53-pwu-01",
    re: new RegExp(`^(?:连续使用每次|连续攻击每次|每次使用|每次)(?:威力|技能威力|攻击)(?:增加|提升|提高|加|[+＋])${NUM}[，,]?最高(?:增加|提升|提高|为|至|到)?(?:威力)?${NUM}$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[2]) } }) },
  // "全属性提升(了)?" → 各维 +1。必须展开成五维：引擎的 stat:"all" 只用于
  // 「全正级翻倍」（multiplySelf），发裸 stat:"all" 会被 stat-stage.ts:82 抛 OP_SCHEMA，
  // 装载期 content:validate 也报 'stat "all" requires multiplySelf'（peak 3 条）。
  { id: "e53-stg-11",
    re: /^全属性(?:提升|提高|增加|上升|强化)$/,
    go: () => ({ effects: ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: 1, target: "self" })) }) },
  // "(对手)?(STAT)±N.(STAT)±N" → 双维同向 stage（点号并列——勿切分丢主语；"对手攻击-1.特攻-1"）
  { id: "e53-stg-08",
    re: new RegExp(`^(对手|对方|敌方|自身|自己)?(${STAT_RE})([+-]${NUM})\\.(${STAT_RE})([+-]${NUM})$`),
    go: (m) => { const t = /对手|对方|敌方/.test(m[1] ?? "") ? "opponent" : "self"; const out = []; for (const [k, s] of [[m[2], m[3]], [m[5], m[6]]]) { const st = STATS[k]; if (st === undefined) return null; out.push({ op: "apply_stat_stage", stat: st, delta: num(s), target: t }); } return { effects: out }; } },
  // "消除双方强化/弱化"短形（省"能力"——attach-damage-80 需能力关键词，117 仅对手向）
  { id: "e53-clr-06",
    re: /^消除(?:敌我)?双方(?:的)?(?:能力)?(强化|弱化|增益|减益)(?:状态|效果)?$/,
    go: (m) => { const sign = /弱化|减益/.test(m[1]) ? "down" : "up"; return { effects: [{ op: "clear_stages", target: "self", sign }, { op: "clear_stages", target: "opponent", sign }] }; } },
  // "消除双方攻击和特攻降低状态"——枚举维定向清级（"下降状态"续段经"和"连读保留主语）
  { id: "e53-clr-08",
    re: new RegExp(`^消除(?:敌我)?(双方|对手|对方|敌方|自身|自己)(?:的)?((?:${STAT_RE})(?:[、和](?:${STAT_RE}))*)(?:能力)?(提升|提高|增强|上升|强化|降低|减少|下降)(?:状态|效果)$`),
    go: (m) => { const sign = /降低|减少|下降/.test(m[3]) ? "down" : "up"; const stats = m[2].split(/[、和]/).map((x) => STATS[x]); if (stats.includes(undefined)) return null; const ts = m[1] === "双方" ? ["self", "opponent"] : [/对手|对方|敌方/.test(m[1]) ? "opponent" : "self"]; return { effects: ts.flatMap((tg) => stats.map((st) => ({ op: "clear_stages", target: tg, sign, stats: [st] }))) }; } },
  // 裸值省略 stage："降低对手防御"/"令对手防御降低"/"对手防御降低"/"使自身攻击提升"/"降低对手防御1级"——无数值默认 ±1
  { id: "e53-stg-13",
    re: new RegExp(`^(?:使|令|让)?(对手|对方|敌方|自身|自己)?((?:${STAT_RE})(?:[、和](?:${STAT_RE}))*|双攻|双防|全属性|所有属性|全部能力|全项能力)(?:的)?(?:能力)?(?:等级)?(降低|减少|下降|提升|提高|增加|上升)([+-]?${NUM})?(?:个)?级?$|^(降低|减少|下降|提升|提高|增加|上升)(对手|对方|敌方|自身|自己)?((?:${STAT_RE})(?:[、和](?:${STAT_RE}))*|双攻|双防|全属性|所有属性|全部能力|全项能力)(?:的)?(?:能力)?(?:等级)?([+-]?${NUM})?(?:个)?级?$`),
    go: (m) => {
      const who = m[1] ?? m[7]; const st = m[2] ?? m[8]; const verb = m[3] ?? m[6]; const nv = m[4] ?? m[9];
      const t = /对手|对方|敌方/.test(who ?? "") ? "opponent" : "self";
      const d = /降低|减少|下降/.test(verb) ? -1 : 1; const v = nv !== undefined ? Math.abs(num(nv)) : 1;
      const stats = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"], 全属性: ["all"], 所有属性: ["all"], 全部能力: ["all"], 全项能力: ["all"] }[st] ?? st.split(/[、和]/).map((x) => STATS[x]);
      if (stats[0] === undefined) return null;
      return { effects: stats.map((s) => ({ op: "apply_stat_stage", stat: s, delta: d * v, target: t })) };
    } },
  // "对手受到的伤害减半"——对手承伤减半（与 e8-285 "对手攻击伤害减半"方向相反：此为我方输出减半）
  { id: "e53-dtw-01",
    re: /^(?:对手|对方|敌方)受到(?:的)?(?:攻击|物理|特殊)?伤害减半$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "opponent", params: { pct: 50 } }] }) },
  // "下次受到致死伤害时保留N点体力" → endure（endure 自耗于致死一击，窗即次数）
  { id: "e53-end-02",
    re: new RegExp(`^(?:自身|自己)?(?:下次|下${NUM}次|下回合)?受到致死(?:攻击|伤害)(?:时|后)?保留(\\d+)点?体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1] ?? m[2]) } }] }) },
  // "对手受到相当于本次伤害的1/3的百分比伤害" → flatEcho 分数折算（"相当于"=等量 echo）
  { id: "e53-eql-04",
    re: new RegExp(`^(?:对手|对方|敌方)受到相当于本(?:次|回合)?(?:攻击)?伤害的?${NUM}\\s*/\\s*${NUM}的?(?:百分比|固定)?伤害$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatEcho: { pct: Math.round((ns[0] / ns[1]) * 100) } } }; } },
  // "攻击N次"→hits{min:1,max:N}（"10%攻击2次"——bcm 概率经 dynChance 结转 hits.chance）
  { id: "e53-hit-12",
    re: new RegExp(`^攻击${NUM}次$`),
    go: (m) => ({ attachDamage: { hits: { min: 1, max: num(m[1]) } } }) },
  // "免疫攻击伤害"→dmg_immune kindMask4；"免疫…攻击技能造成的伤害"不带 kindMask（概率由前缀注入）
  { id: "e53-imm-09",
    re: /^免疫(?:对手|对方|敌方)?(?:攻击技能|攻击)(?:造成的|造成)?(?:的)?伤害$/,
    go: (m) => (/攻击技能/.test(m[0])
      ? { effects: [{ op: "apply_status", name: "dmg_immune", target: "self" }] }
      : { effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { kindMask: 4 } }] }) },
  // "连续攻击每次提高5%最多40%" → dmgPerUsePct+dmgPerUsePctCap（"提高"省"威力/伤害"）
  { id: "e53-pwu-02",
    re: new RegExp(`^(?:连续攻击|连续使用|每次)(?:攻击|威力|伤害)?每次?(?:提高|增加|提升)${NUM}%[，,]?最多(?:提高|增加|提升|为)?${NUM}%$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { dmgPerUsePct: ns[0], dmgPerUsePctCap: ns[1] } }; } },
  // "每回合N%免疫对手攻击技能/伤害" → dmg_immune{kindMask4,chance}（params.chance=逐击判定，"每回合"=常驻逐击概率）
  { id: "e53-imm-10",
    re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:有)?${NUM}%(?:的)?(?:几率|概率)?免疫(?:对手|对方|敌方)?(?:攻击|攻击技能)(?:造成的|造成)?(?:的)?(?:伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { kindMask: 4, chance: num(m[1]) } }] }) },
  // "X降为0点" → clear_stages 对手侧（"将对手的攻击降为0点"——归零=清段）
  { id: "e53-zero-01",
    re: new RegExp(`^(${STAT_RE})降为0(?:点)?$`),
    go: (m) => ({ effects: [{ op: "clear_stages", stats: [STATS[m[1]]], target: "opponent" }] }) },
  // "加命中N"→self hit+N；"降命中N"→foe hit-N（"加"=自buff/"降"=敌debuff 惯例——瞄准/扔沙变体）
  { id: "e53-stg-22",
    re: new RegExp(`^加(${STAT_RE})(?:等级)?\\+?${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: num(m[2]), target: "self" }] }) },
  { id: "e53-stg-23",
    re: new RegExp(`^降(${STAT_RE})(?:等级)?-?${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: -num(m[2]), target: "opponent" }] }) },
  // "令对手有N%进入AIL状态" → apply_status chance（"有N%"中置概率）
  { id: "e53-ail-11",
    re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)有${NUM}%(?:的)?(?:几率|概率)?进入?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) }] }) },
  // "每回合免疫(受到的)?异常" → immune_status（"每回合"周期=常驻免疫语义等价）
  { id: "e53-imm-11",
    re: /^每回合(?:开始|结束)?(?:时|后)?免疫(?:受到|所受)?(?:的)?(?:所有|全部)?异常(?:状态)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }] }) },
  // "所有技能(自身)?先制±N" → prio_up
  { id: "e53-prio-09",
    re: new RegExp(`^所有技能(?:自身|自己|的)?先制([+-＋-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: (m[1] === "-" ? -1 : 1) * num(m[2]) } }] }) },
  // "自身附加相同能力的提升" → copy_stages sign:up（反转成功则"附加相同能力的提升"=复制对手原强化）
  { id: "e53-cpy-02",
    re: /^(?:自身|自己)?(?:附加|获得|复制|偷取)?相同能力的?(?:提升|强化|上升)(?:状态)?$/,
    go: () => ({ effects: [{ op: "copy_stages", sign: "up", target: "self" }] }) },
  // "免疫则在回合结束时附加N%伤害量固伤" → dmg_immune{echoFlatPct}
  { id: "e53-imm-12",
    re: new RegExp(`^免疫则(?:在)?(?:本回合|回合|下回合)?结束时?附加${NUM}%(?:的)?(?:攻击)?伤害量?(?:的)?(?:固定|固伤|伤害)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { echoFlatPct: num(m[1]) } }] }) },
  // "使用属性/攻击技能失效" → move_null cat（"使用X技能失效"=该类技能被封锁）
  { id: "e53-mnl-02",
    re: /^使用(?:属性|攻击)技能失效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { cat: /属性/.test(m[0]) ? 1 : 4 } }] }) },
  // "使自身随机进入N种异常" → random 自指（己方异常自添——特殊献祭类技能）
  { id: "e53-rnd-01",
    re: new RegExp(`^(?:令|使|让)?(?:自身|自己)随机进入${NUM}?种?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "self", random: { list: ALL_AILS, count: num(m[1]) } }] }) },
  // "反弹下N次(自身)?受到的异常" → reflect_status count 门
  { id: "e53-rfl-09",
    re: new RegExp(`^反弹下${NUM}次(?:自身|自己)?(?:所)?受到的?异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_status", target: "self", params: { count: num(m[1]) } }] }) },
  // "召唤伙伴进行N-M次攻击" → hits 区间（伙伴=追加攻击段数语义）
  { id: "e53-hit-13",
    re: new RegExp(`^(?:召唤(?:自己的?|己方)?(?:伙伴|同伴|盟友|召唤兽|精灵))?进行${NUM}\\s*[-~～—至到]\\s*${NUM}次攻击$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { hits: { min: ns[0], max: ns[1] } } }; } },
  // "使AIL"裸形（"30%使烧伤"——令/使+异常省主语）
  { id: "e53-ail-12",
    re: new RegExp(`^(?:令|使|让)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }) },
  // "使对手随机N个技能PP归零" → pp_delta zeroRandom
  { id: "e53-ppz-02",
    re: new RegExp(`^(?:使|令|让)(?:对手|对方|敌方)随机${NUM}个技能PP(?:值)?归零$`),
    go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // "造成伤害的N%恢复自身体力M回合" → drain_atk turns（"对对手造成伤害的50%恢复自身体力3回合"）
  { id: "e53-drn-11",
    re: new RegExp(`^(?:[对给](?:对手|对方|敌方))?造成(?:的)?伤害的?${NUM}%(?:都)?会?恢复(?:自身|自己)的?体力${NUM}回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", turns: num(m[2]), params: { n: num(m[1]), d: 100 } }] }) },
  // "(直接)?造成等同于对手STAT值的固定伤害" → flatFoeStatPct 100%
  { id: "e53-eql-05",
    re: new RegExp(`^(?:直接)?造成等同于(?:对手|对方|敌方)(?:的)?(${STAT_RE})(?:值)?的?(?:固定|固定伤害|伤害)$`),
    go: (m) => { const s = STATS[m[1]]; return s === undefined || s === "acc" ? null : { attachDamage: { flatFoeStatPct: { stat: s, pct: 100 } } }; } },
  // "+N%AIL"（"+10%冻伤"——追加概率异常）
  { id: "e53-ail-13",
    re: new RegExp(`^\\+(\\d+)%(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }) },
  // "威力为N倍/威力变为N倍" → powerMul
  { id: "e53-pwu-03",
    re: new RegExp(`^威力(?:变)?为${NUM}倍$`),
    go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1]), denominator: 1 } } }) },
  // "令自身造成的攻击伤害(额外)?提升N%" → dmg_boost
  { id: "e53-dbu-01",
    re: new RegExp(`^(?:令|使|让)?自身造成的?(?:攻击)?伤害(?:额外)?(?:提升|提高|增加)${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]) } }] }) },
  // "造成等量的固定伤害N回合内" → flatEcho + effTurns（"造成等量固伤3回合内"窗化回响）
  { id: "e53-eql-06",
    re: new RegExp(`^(?:给|对)?(?:对手|对方|敌方)?造成(?:等量的?|等量)(?:固定|固定伤害|固伤)(?:伤害)?(?:下)?(${NUM})回合(?:内)?$`),
    go: (m) => ({ attachDamage: { flatEcho: { pct: 100 } }, effTurns: num(m[1]) }),
  },
  // "每回合受到N点(固定)伤害" → foe_dot flat（"每回合都会受到200点固定伤害"——受击方=对手侧 tick）
  { id: "e53-dot-01", re: new RegExp(`^每回合(?:(?:开始|结束)?时|后)?受到${NUM}点(?:固定|百分比)?伤害$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: num(m[1]) } }] }) },
  // "抵挡(对手)当次攻击" → dmg_immune count:1（一次性格挡）
  { id: "e53-imm-16", re: /^抵挡(?:对手|对方|敌方)?的?当次攻击$|^抵挡当次攻击$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }] }) },
  // "(所有攻击技能)附有N%的秒杀" → percent-100 damage + chance（秒杀=全额百分比）
  { id: "e53-ohk-01", re: new RegExp(`^(?:自己的|自身的|本方的)?所有?(?:进攻|攻击|伤害)?技能?都?附有${NUM}%(?:的)?秒杀$|^附有${NUM}%(?:的)?秒杀$`), go: (m) => ({ effects: [{ op: "damage", power: 100, kind: "percent", chance: num(m[1] ?? m[2]) }] }) },
  // "为双方附加N回合AIL" → 双侧异常（为→令双方 normalize 后同形）
  { id: "e53-bal-01", re: new RegExp(`^令双方(?:附加)?${NUM}回合(?:的)?(${AIL_RE})(?:状态)?$|^令双方进入(${AIL_RE})(?:状态)?$`), go: (m) => { const nm = m[2] ?? m[3]; const t = m[1] !== undefined ? num(m[1]) : undefined; return { effects: ["self","opponent"].map((tgt) => ({ op: "apply_status", name: AILMENTS[nm], target: tgt, ...(t !== undefined ? { turns: t } : {}) })) }; } },
  // "消除双方的护盾、护罩效果" → cleanse shield both
  { id: "e53-cls-02", re: /^消除(?:双方|敌我双方)的?(?:护盾、护罩|护罩、护盾|护盾|护罩)(?:效果|状态)?$/, go: () => ({ effects: [{ op: "cleanse", scope: "shield", target: "self" }, { op: "cleanse", scope: "shield", target: "opponent" }] }) },
  // "随机附加N种异常(状态)" → random{count}（附加=赋予变体）
  { id: "e53-rnd-04", re: /^随机附加(\d+)种(?:异常状态|异常)$|^随机附加一种(?:异常状态|异常)$/, go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[1] !== undefined ? num(m[1]) : 1 } }] }) },
  // "消耗自身的<名>" → consume_mark（具名资源/印记；护盾类由 consumeShield 先收）
  { id: "e53-cns-01", re: /^消耗自身的?([\u4e00-\u9fff]{1,6})$/, go: (m) => { if (/护盾|护罩|体力|生命|PP|pp|点|%|回合|状态|能力|伤害|\d/.test(m[1])) return undefined; return { effects: [{ op: "consume_mark", mark: m[1], target: "self" }] }; } },
  // "获得(点数)等同于(双方)最大体力差值的护盾(，最高N点)" → shield flatMaxHpDiff(+cap)
  // cap 没人读。改成 flatCap 会开始封顶，结算就变了。上限不发。
  { id: "e53-shd-05", re: new RegExp(`^(?:使|令)?(?:自身|自己)?获得(?:点数|数量|一个)?等同于(?:双方)?(?:最大)?(?:体力|HP)差值的护盾(?:，|,)?(?:最高|上限为?|不超过)?(${NUM})?点?$`), go: () => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flatMaxHpDiff: 1 } }] }) },
  // "对手每处于1回合异常状态吸取对手N点体力" → drain_dot flat + foeStatused 门控
  { id: "e53-drnt-01", re: new RegExp(`^(?:对手|对方|敌方)每处于(?:1|一)?回合异常状态(?:时|，|,)?吸取(?:对手|对方|敌方)${NUM}点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { flat: num(m[1]) }, if: { foeStatused: true } }] }) },
  // "造成致死伤害时令其保留N点体力" → endure foe（致死免死=对手侧 endure）
  { id: "e53-end-03", re: new RegExp(`^造成致死伤害时(?:令|使)(?:其|对手|对方)保留${NUM}点体力$|^致死时(?:令|使)(?:其|对手|对方)残留?${NUM}点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "opponent", params: { hp: num(m[1] ?? m[2]) } }] }) },
  // "将对手所处的异常状态转化为AIL" → cleanse ailment + apply_status（转化=替换）
  { id: "e53-trn-02", re: new RegExp(`^(?:将|令|把|使)(?:对手|对方|敌方)所处?的?(?:全部)?异常状态?转化为(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "cleanse", scope: "ailment", target: "opponent" }, { op: "apply_status", name: AILMENTS[m[1]], target: "opponent" }] }) },
  // "附加攻击伤害N%的(百分比)伤害" → flatEcho pct（攻击伤害=出伤基数）
  { id: "e53-ech-01", re: new RegExp(`^附加攻击伤害${NUM}%(?:的)?(?:百分比)?(?:伤害)?$`), go: (m) => ({ attachDamage: { flatEcho: { pct: num(m[1]) } } }) },
  // "吸取其最大体力N/M" → percent drain + heal（其=宾指代——e53 镜像"吸取对手"）
  { id: "e53-drn-12", re: new RegExp(`^(?:吸取|吸收)其(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "damage", power: 1, kind: "percent", frac: { numerator: ns[0], denominator: ns[1] } }, { op: "heal", numerator: ns[0], denominator: ns[1], target: "self" }] }; } },
  // "恢复等量体力值" → drain 1/1（等量体力值=按出伤等量回血——区别于 foeLastHealPct 镜像"恢复等量体力"）
  { id: "e53-heq-01", re: /^(?:额外|使自身|令自身)?恢复等量(?:的)?体力值$/, go: () => ({ attachDamage: { drain: { numerator: 1, denominator: 1 } } }) },
  // "对手使用威力(不高于|大于)N的(攻击|属性)技能时<payload>" → react trigger3 + powerMax/Min + cat
  { id: "e53-rpw-01",
    re: new RegExp(`^若?(?:对手|对方|敌方)使用威力(不高于|不超过|小于等于|小于|低于|大于等于|不低于|不少于|大于|高于)${NUM}的?(攻击|属性)?技能[时后则]?(.*)$`),
    go: (m) => { const pw = num(m[2]); const lo = /不高于|不超过|小于等于|小于|低于/.test(m[1]); const params = lo ? { powerMax: /不高于|不超过|小于等于/.test(m[1]) ? pw : pw - 1 } : { powerMin: /大于等于|不低于|不少于/.test(m[1]) ? pw : pw + 1 }; if (m[3] !== undefined) params.cat = m[3] === "属性" ? 1 : 4; return reactWrap(3, params, m[4].trim()); } },
  // "当前体力低于N/M时恢复效果翻倍" → healDouble（时条件由 effCond 通道挂）
  { id: "e53-hdx-01", re: /^(?:当前)?体力低于1\s*\/\s*2时恢复效果翻倍$/, go: () => ({ attachAll: { healDouble: true } }) },
  // "无视护盾效果" → pierceShield（deferred-28 主体变体收无对手版）
  // "自身攻击无视对手护盾"（主语「自身攻击」领起形）。放在 e53-prc-01 前面，那条句首不得带主语。
  { id: "e53-prc-00", re: /^(?:自身|自己)攻击无视(?:对手|对方|敌方)护盾(?:效果|状态)?$/, go: () => ({ attachDamage: { pierceShield: true } }) },
  { id: "e53-prc-01", re: /^无视护盾(?:效果|状态)?$|^无视(?:对手|对方|敌方)护盾(?:效果)?$/, go: () => ({ attachDamage: { pierceShield: true } }) },
  // ── auditable 留档 ────────────────────────────────────────
  { id: "e53-def-39", re: /^每次在场限\d+次$|^在场限\d+次$/, go: () => ({ unparsedReason: "per-presence use cap — window unmodeled" }) },
  { id: "e53-def-40", re: /^若(?:对手|对方|敌方)为(?:对方|对手|敌方)存活精灵中唯一(?:没有|拥有).{1,8}的精灵则/, go: () => ({ unparsedReason: "bench-unique selector — single-survivor cond unmodeled" }) },
  { id: "e53-def-41", re: /^若消除的数额相等则/, go: () => ({ unparsedReason: "cleared-count equality cond — unmodeled" }) },
  { id: "e53-def-42", re: /^(?:对手|对方|敌方)每处于(?:一种|1种)异常状态(?:造成|则造成)伤害提升\d+%$/, go: () => ({ unparsedReason: "per-ailment-count scaling — dimension unmodeled" }) },
  { id: "e53-def-43", re: /^(?:自身|自己)每有1级先制|自身每有\d*篇/, go: () => ({ unparsedReason: "per-prio/per-mark scaled damage — dimension unmodeled" }) },
  { id: "e53-def-44", re: /^最高不超过/, go: () => ({ unparsedReason: "fractional cap tail — cap dimension unmodeled" }) },
  { id: "e53-def-45", re: /^己方在场精灵|^己方在场/, go: () => ({ unparsedReason: "ally on-field target — target domain unmodeled" }) },
  { id: "e53-def-46", re: /^转变为等量的真实伤害$|^转变为真实伤害$/, go: () => ({ unparsedReason: "true-kind echo conversion — kind dimension unmodeled" }) },
  // ── v22 批：残余聚类头部收口 ──────────────────────────────
  // "(攻击)?伤害为正常(状态|情况)(下)?N倍" → powerMul（"攻击伤害为正常状态2倍"）
  { id: "e53-v22-01", re: new RegExp(`^(?:攻击)?伤害为正常(?:状态|情况)?(?:下)?的?${NUM}倍$|^(?:攻击)?伤害变为正常(?:状态|情况)?(?:下)?的?${NUM}倍$`),
    go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1] ?? m[2]), denominator: 1 } } }) },
  // "使对手能力提升(状态|效果)转化(到|为)自身(上|身上)" → transfer_stages pull（"使对手能力提升效果转化到自身上"）
  { id: "e53-v22-02", re: /^(?:使|令|将|把)(?:对手|对方|敌方)的?能力(?:提升|强化)(?:的)?(?:状态|效果|等级)?转化(?:到|至|给)(?:自身|自己)(?:身上|上)?$/,
    go: () => ({ effects: [{ op: "transfer_stages" }] }) },
  // "使对手能力提升(状态)?变为能力下降" → invert_stages up（attach-damage-76 的"变为"变体）
  { id: "e53-v22-03", re: /^(?:使|令|将|把)(?:对手|对方|敌方)的?能力(?:提升|强化)(?:的)?(?:状态|效果)?(?:变为|变成|转为)(?:能力)?下降(?:状态|效果)?$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },
  // "(使)?自身弱化(状态)?消失" → clear_stages self down（"消失"词形——弱化=能力下降口语）
  { id: "e53-v22-04", re: /^(?:使|令)?(?:自身|自己)的?(?:能力)?弱化(?:的)?状态?消失$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "self", sign: "down" }] }) },
  // "使自身下次攻击造成的伤害提升N%" → dmg_boost{pct,count:1}（e32-next-01 的"使+攻击造成的"变体）
  { id: "e53-v22-05", re: new RegExp(`^(?:使|令)(?:自身|自己)下(?:一|1)?次(?:攻击|技能)?造成的?(?:攻击)?伤害(?:提升|提高|增加)${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[1]), count: 1 } }] }) },
  // "N%吸血(效果|状态)" → drain_atk pct 窗（"100%吸血效果"）
  { id: "e53-v22-06", re: new RegExp(`^${NUM}%的?吸血(?:效果|状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // "吸取对手N点(固定)?伤害" → fixed 伤害 + 等量回血（heal-152 的"伤害"尾变体）
  { id: "e53-v22-07", re: new RegExp(`^吸取(?:对手|对方|敌方)${NUM}点?(?:固定|固伤)?伤害$`),
    go: (m) => { const n = num(m[1]); return { effects: [{ op: "damage", kind: "fixed", power: n }, { op: "heal", flat: n, target: "self" }] }; } },
  // "使对方伤害下降" 未量化削弱 → 留档（降幅不明）
  { id: "e53-v22-08", re: /^(?:使|令)(?:对方|对手|敌方)(?:的)?(?:攻击)?伤害(?:下降|降低|减少)$/,
    go: () => ({ unparsedReason: "unquantified foe damage reduction — magnitude unstated" }) },
  // "(将|把)(所受|受到)伤害的N/M反弹给(对手|对方)" → reflect_dmg frac（归一化后=受到…；attach-damage-109 被遮蔽的"给对手"方向）
  { id: "e53-v22-09", re: new RegExp(`^(?:将|把)?(?:所[受收]|受到)伤害的?${NUM}\\s*/\\s*${NUM}(?:会)?反弹(?:回|给)?(?:对手|对方|敌方)$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // ── v23 批：残余聚类二轮收口 ──────────────────────────────
  // "伤害为N%"/"伤害变为N%" → powerMul 百分比基率（"伤害为200%"=×2）
  { id: "e53-v23-01", re: new RegExp(`^伤害(?:为|变为|是)${NUM}%$`),
    go: (m) => ({ attachDamage: { powerMul: { numerator: num(m[1]), denominator: 100 } } }) },
  // "反弹N/M伤害给自己" → recoilFrac（无"所受"裸形）
  { id: "e53-v23-02", re: new RegExp(`^反弹${NUM}\\s*/\\s*${NUM}(?:的)?伤害(?:反弹)?给(?:自己|自身)$`),
    go: (m) => ({ attachDamage: { recoilFrac: { n: num(m[1]), d: num(m[2]) } } }) },
  // "每次加N固伤" → flatPerUse（"每次加20固伤，最高加100"分句后各半）
  { id: "e53-v23-03", re: new RegExp(`^每次(?:使用|攻击)?(?:加|附加|额外附加)${NUM}(?:点)?(?:固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatPerUse: num(m[1]) } }) },
  // "最高加N"/"最多加N" → flatPerUseCap（分句 cap 尾）
  { id: "e53-v23-04", re: new RegExp(`^最[高多](?:加|增至?|到)${NUM}(?:点)?$`),
    go: (m) => ({ attachDamage: { flatPerUseCap: num(m[1]) } }) },
  // "躲避本回合攻击" → dodge turns:1（deferred-09 的回合窗变体）
  { id: "e53-v23-05", re: /^躲避(?:本回合|当回合|下回合)(?:的)?(?:对手|对方|敌方)?(?:的)?攻击(?:技能)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: 100 } }] }) },
  // "N/M几率致命(一击)" → critChanceFrac（"1/4几率致命"）
  { id: "e53-v23-06", re: new RegExp(`^${NUM}\\s*/\\s*${NUM}(?:的)?(?:几率|概率)(?:打出)?致命[一1]?击?$`),
    go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "暴击率N/M" → critChanceFrac（"暴击率2/16"）
  { id: "e53-v23-07", re: new RegExp(`^暴击率${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },
  // "附加自身X值N/M的固定伤害" → flatSelfStatPct 分数变体（"附加自身速度值1/8的固定伤害"——pct 整数校验要求走 n/d 通道）
  { id: "e53-v23-08", re: new RegExp(`^附加自身(${STAT_RE})值?${NUM}\\s*/\\s*${NUM}的?(?:固定|固伤)?伤害$`),
    go: (m) => { const s = STATS[m[1]]; if (s === undefined || s === "acc") return null; return { attachDamage: { flatSelfStatPct: { stat: s, numerator: num(m[2]), denominator: num(m[3]) } } }; } },
  // "恢复N/M体力/K回合" → hot 分数 × turns（"恢复1/3体力/4回合"）
  { id: "e53-v23-09", re: new RegExp(`^(?:每回合)?恢复${NUM}\\s*/\\s*${NUM}体力\\s*/\\s*${NUM}回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", turns: num(m[3]), params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // "(使|令)?(对手)?属性技能N回合(内)?失效" → status_lock cat:1 turns（"使对手属性技能3回合失效"）
  { id: "e53-v23-10", re: new RegExp(`^(?:使|令)?(?:对手|对方|敌方)?的?属性技能${NUM}回合(?:内)?(?:失效|无效)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "status_lock", target: "opponent", turns: num(m[1]), params: { cat: 1 } }] }) },
  // "造成对手N点伤害" → damage fixed（"造成对手400伤害"主语内嵌）
  { id: "e53-v23-11", re: new RegExp(`^造成(?:对手|对方|敌方)${NUM}点?伤害$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "fixed", power: num(m[1]) }] }) },
  // "X状态下威力翻倍" → scaleIf foeHas（"烧伤状态下威力翻倍"——技能语境=对手处于异常）
  { id: "e53-v23-12", re: new RegExp(`^(${AIL_RE})状态下?威力(?:翻倍|加倍|为2倍)$`),
    go: (m) => ({ attachDamage: { scaleIf: { when: { foeHas: AILMENTS[m[1]] }, numerator: 2, denominator: 1 } } }) },
  // "(威力|攻击)?造成伤害低于N有?(的)?几率(使|令)X" → 伤害阈 cond + 无量词几率留档（chanceVar 审计同 e22）
  { id: "e53-v23-13", re: new RegExp(`^(?:威力|攻击)?(?:所)?造成(?:的)?伤害低于${NUM}(?:点)?(?:时|则|，|,)?有?(?:的)?几率(?:使|令|让)(.+)$`),
    go: (m) => {
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0 || sub.unparsed.length > 0) return { unparsedReason: `damage-threshold chance payload unparsed: ${m[2]}` };
      const fx = sub.effects.map((e) => ({ ...e, if: { prevDamageBelowAbs: num(m[1]) }, ...(e.op === "apply_status" ? { params: { ...(e.params ?? {}), chanceVar: 1 } } : {}) }));
      return { effects: fx };
    } },
  // "受到(的)?伤害(减少|降低|-)N" → dmg_reduce flat（"受伤减少100"/"受到伤害-100"——词形归一后归此）
  { id: "e53-v23-14", re: new RegExp(`^受到(?:的)?伤害?(?:减少|降低|-)${NUM}点?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // ── v23 auditable 留档 ────────────────────────────────────
  { id: "e53-v23-15", re: /^若为(?:攻击|属性|物理|特殊)(?:的)?技能则/, go: () => ({ unparsedReason: "per-move cat predicate — clause-level cond unmodeled (deferred)" }) },
  { id: "e53-v23-16", re: /^若?受到(?:对手|对方|敌方)?的?消强(?:化)?攻击/, go: () => ({ unparsedReason: "dispel-attack trigger — move-quality predicate unmodeled (deferred)" }) },
  { id: "e53-v23-17", re: new RegExp(`^若?(?:对手|对方|敌方)的?(?:≥|大于等于|不低于|不少于|超过|大于)?${NUM}项技能PP值?归零`), go: () => ({ unparsedReason: "pp-zero-count predicate — slot-count cond unmodeled (deferred)" }) },
  { id: "e53-v23-18", re: new RegExp(`^每增加了?${NUM}项能力`), go: () => ({ unparsedReason: "per-stage-gain trigger — edge trigger unmodeled (deferred)" }) },
  { id: "e53-v23-19", re: /^(?:直接)?扣除(?:对方|对手|敌方)场下/, go: () => ({ unparsedReason: "bench target — off-field unit domain unmodeled (deferred)" }) },
  { id: "e53-v23-20", re: /^反弹(?:特殊|物理|特殊攻击|物理攻击)(?:的)?伤害$/, go: () => ({ unparsedReason: "cat-scoped unquantified reflect — magnitude+category both absent (deferred)" }) },
  // ── v24：payload 残段/裸反馈/裸上限 ─────────────────────
  // "不超过N" 裸尾（react payload 残段——"受到攻击不超过280"的 cap 语义）
  { id: "e53-v24-01", re: /^不超过(\d+)(?:点)?$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1]) } }] }) },
  // "反弹对手伤害N/M"（含"的"）→ reflect_dmg 分数反噬
  { id: "e53-v24-02", re: new RegExp(`^反弹(?:对手|对方|敌方)(?:的)?伤害(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: ns[0], d: ns[1] } }] }; } },
  // "N%反馈给对手"（bcm 已豁免"反馈"——百分比是反馈量非概率）
  { id: "e53-v24-03", re: new RegExp(`^${NUM}%(?:的)?反馈给(?:对手|对方|敌方)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // "减少其最大体力的N/M"（"其"=对手，无"对手"主语的省写形）
  { id: "e53-v24-04", re: new RegExp(`^减少(?:其|对方|敌方)?最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "apply_status", name: "max_hp_down", target: "opponent", params: { n: ns[0], d: ns[1] } }] }; } },
  // ── v25：组队目标元数据（语义清楚的非 1v1 描述字段——targets/targetScope 落 move 级，1v1 引擎忽略） ──
  { id: "e53-v25-01", re: new RegExp(`^组队(?:是|可以|可|时|是可以)?(?:可以)?影响${NUM}个目标$|^(?:可|可以)?影响${NUM}个目标$|^影响${NUM}个目标$`), go: (m) => { const n = num(m.slice(1).find((x) => x !== undefined)); return { flags: { targets: n } }; } },
  { id: "e53-v25-02", re: /^组队(?:是|可以|可|时)?(?:向|对|向己方)?(?:己方)?任意(?:目标|队员|精灵)(?:使用|施放)?$|^组队时?可作用己方任意目标$/, go: () => ({ flags: { targetScope: "anyAlly" } }) },
  { id: "e53-v25-03", re: new RegExp(`^(${STAT_RE})\\s*([+\\-]\\s*${NUM})组队时?可作用己方任意目标$`), go: (m) => ({ effects: [stageFx(STATS[m[1]], num(m[2].replace(/\s/g, "")), "self")], flags: { targetScope: "anyAlly" } }) },
  // ── v25：元素维度（params.type 系别门控——statusGateOk/dmgOutPctOf 消费 move.type） ──
  { id: "e53-v25-04", re: new RegExp(`^(?:本方|自身|自己)?受到的?(${TYPE_RE})(?:系)?(?:的)?(?:攻击|技能|招式)?伤害减半$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 }, moveType: m[1] }] }) },
  { id: "e53-v25-05", re: new RegExp(`^(?:本方|自身|自己)?受到的?(${TYPE_RE})(?:系)?(?:的)?(?:攻击|技能|招式)?伤害(?:减少|降低|下降|削弱)${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[2]) }, moveType: m[1] }] }) },
  { id: "e53-v25-06", re: new RegExp(`^(?:自身|自己)?使用(${TYPE_RE})(?:系)?(?:技能|招式|攻击)(?:时)?(?:造成的)?(?:威力|伤害)(?:翻倍|加倍|翻${NUM}倍|为${NUM}倍|×${NUM}倍?|提升${NUM}%)$|^(${TYPE_RE})(?:系)?(?:技能|招式|攻击)(?:的)?(?:威力|伤害)(?:翻倍|加倍|翻${NUM}倍|为${NUM}倍|×${NUM}倍?|提升${NUM}%)$`),
    go: (m) => { const type = m[1] ?? m[3]; const ns = m.slice(1).map((x) => (x !== undefined ? num(x) : NaN)).filter((n) => Number.isInteger(n)); const um = m[0].match(/提升(\d+)%/); const pct = um !== null ? num(um[1]) : ns.length > 0 ? (ns[ns.length - 1] - 1) * 100 : 100; return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct }, moveType: type }] }; } },

  // ===== v26：属性复制/反转（type_copy/type_swap 计时标记——battleTypesOf 计算型覆写，到期自动还原） =====
  // "使自身的属性和对方的属性相同"/"自身与对方战斗时属性相同"→type_copy（battleTypesOf 取对手系别）
  { id: "e53-v26-01",
    re: /^(?:使|令)(?:自身|自己|本方)(?:的)?属性(?:和|与)(?:对方|对手|敌方)(?:的)?(?:属性)?相同$|^(?:使|令)?(?:自身|自己|本方)(?:的)?(?:属性)?(?:和|与)(?:对方|对手|敌方)(?:的)?(?:战斗时)?(?:属性)?相同$|^(?:和|与)(?:对方|对手|敌方)(?:战斗时)?(?:的)?属性相同$/,
    go: () => ({ effects: [{ op: "apply_status", name: "type_copy", target: "self" }] }) },
  // "复制对手属性"→type_copy（timed-21 的形态/特性/种族域保持 deferred）
  { id: "e53-v26-02",
    re: /^复制(?:对手|对方|敌方)(?:的)?属性$/,
    go: () => ({ effects: [{ op: "apply_status", name: "type_copy", target: "self" }] }) },
  // "(自身)(与|和)(对方|对手)反转(战斗时)?(的)?属性"/裸"反转(战斗时)?属性"→type_swap（交换对称，标记在自身即可）
  { id: "p2-type-02",
    re: /^(?:(?:使|令)?(?:自身|自己)?(?:和|与|跟))?(?:对手|对方|敌方)(?:的)?(?:交换|互换|对调|反转)(?:战斗时)?(?:的)?属性$/,
    go: () => ({ effects: [{ op: "apply_status", name: "type_swap", target: "self" }] }),
  },
  { id: "e53-v26-03",
    re: /^(?:(?:使|令)?(?:自身|自己|本方)?(?:的)?(?:与|和|于)(?:对方|对手|敌方))?反转(?:战斗时)?(?:的)?属性$/,
    go: () => ({ effects: [{ op: "apply_status", name: "type_swap", target: "self" }] }) },
  // "反转(对手)?属性能力"→invert_stages{sign:up}。含"并反转"的复合句不在此拆，整句无主规则
  { id: "e53-v26-04",
    re: /^反转(?:对手|对方|敌方)?(?:的)?属性能力$/,
    go: () => ({ effects: [{ op: "invert_stages", sign: "up", target: "opponent" }] }) },

  // ===== v27：免疫并X 复合兜底（"疫" lookbehind 保住整句后，X=并列续段由子解析照常发射） =====
  // "免疫并(令对手麻痹|反弹异常|恢复体力)" → immune_status + X（e5-21/e35-06b/e43-05 等整句规则先行，本规则只接残余）
  { id: "e53-v27-01",
    re: /^免疫并(.+)$/,
    go: (m) => { const sub = parseEffectText(m[1]); return { effects: [{ op: "apply_status", name: "immune_status", target: "self" }, ...sub.effects], ...(sub.unparsed.length > 0 ? { unparsedReason: `immune-tail residual: ${m[1].slice(0, 20)}` } : {}) }; } },
];
