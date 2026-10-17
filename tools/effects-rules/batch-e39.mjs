// batch-e39：血量比较先制、双方结算、条件真伤/护盾回响、PP 随机归零、AIL 解除反应、裸句式长尾。
import { NUM, num, STAT_RE, STATS, AIL_RE, AILMENTS, frac } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";
import { reactWrap } from "../effects-parse.mjs";

const STBIT = { atk: 1, def: 2, spa: 4, sdf: 8, spd: 16, hp: 32 };
const PAIR = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"] };
const STOK = `(?:${STAT_RE}|双攻|双防)`;
const statMaskOf = (zhList) => zhList.flatMap((z) => PAIR[z] ?? [STATS[z]]).reduce((a, s) => a | (STBIT[s] ?? 0), 0);
const TICK_IDX = { atk: 0, def: 1, spa: 2, sdf: 3, spd: 4, acc: 5 };

export const rules = [
  // ── 血量比较先制（"血量高于对手先制+1"——prio_up 1回合条件窗） ──
  { id: "e39-01",
    re: /^(?:若)?(?:自身|自己)?(?:当前)?(?:体力|血量|HP)(?:高于|大于|超过)(?:对手|对方|敌方)(?:的)?(?:体力|血量|HP)?[,，]?先制\+?(\d+)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: num(m[1]) }, if: { selfHpAboveFoe: true } }] }) },
  { id: "e39-01b",
    re: /^(?:若)?(?:自身|自己)?(?:当前)?(?:体力|血量|HP)(?:低于|小于|不足)(?:对手|对方|敌方)(?:的)?(?:体力|血量|HP)?[,，]?先制\+?(\d+)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: num(m[1]) }, if: { selfHpBelowFoe: true } }] }) },
  // ── 双方结算 ──
  // "使对手和自身同时降低1/4最大HP" → 双侧 percent 伤害（self 侧 percentBase 缺省=hit 自身 max）
  { id: "e39-02",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)和(?:自身|自己)(?:同时)?(?:降低|减少|损失|扣除)${NUM}\\s*\\/\\s*${NUM}(?:的)?(?:最大)?(?:体力|HP)(?:值)?$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(m[1], m[2]), percentBase: "max", target: "opponent" }, { op: "damage", kind: "percent", frac: frac(m[1], m[2]), target: "self" }] }) },
  // "使双方精灵所有技能PP值归零" → 双侧 pp_delta zero
  { id: "e39-02b",
    re: /^(?:使|令)(?:敌我)?双方(?:精灵)?(?:的)?(?:所有|全部)(?:精灵)?(?:的)?(?:所有|全部)?技能PP(?:值)?归[零0]$/,
    go: () => ({ effects: [{ op: "pp_delta", target: "opponent", zero: true }, { op: "pp_delta", target: "self", zero: true }] }) },
  // "消除双方能力提升、下降状态" → 双侧 clear_stages（sign 缺省=全部）
  { id: "e39-02c",
    re: /^消除(?:敌我)?双方能力(?:提升|强化|上升)[、,，]?(?:和|与)?(?:能力)?(?:下降|降低)状态$|^消除(?:敌我)?双方能力(?:上升|下降)(?:的)?状态$/,
    go: () => ({ effects: [{ op: "clear_stages", target: "opponent" }, { op: "clear_stages", target: "self" }] }) },
  // ── 条件威力（AIL 枚举任一；与 e38-31 同惯例 selfHas） ──
  // "自身处于烧伤、中毒、冻伤状态时威力翻倍" → scaleIf or selfHas
  { id: "e39-03",
    re: new RegExp(`^(?:自身|自己)(?:在|处于)((?:${AIL_RE})(?:、(?:${AIL_RE}))+)(?:的)?(?:状态)?时(?:威力|伤害|攻击伤害)(?:翻倍|加倍|变为2倍)$`),
    go: (m) => { const ails = m[1].split("、").map((a) => ({ selfHas: AILMENTS[a] })); return { attachDamage: { scaleIf: { when: { or: ails }, numerator: 2, denominator: 1 } } }; } },
  // "自身体力低于1/2时造成的伤害为N倍" 类已走 cond；裸"造成的伤害为N倍" → mul
  { id: "e39-04",
    re: new RegExp(`^(?:自身|自己)?造成的?(?:攻击)?伤害(?:为|是|变为)${NUM}倍$|^(?:攻击)?伤害(?:为|是|变为)${NUM}倍$`),
    go: (m) => ({ attachDamage: { mul: frac(m[1] ?? m[2], 1) } }) },
  // ── 本次攻击无法造成伤害 ──
  { id: "e39-05",
    re: /^(?:本次|该次|此次|当次)(?:攻击|技能|攻击技能)?(?:将)?无法(?:对(?:对手|对方|敌方))?造成(?:任何)?伤害$|^本次攻击伤害为0$/,
    go: () => ({ attachDamage: { cap: 0 } }) },
  // ── 等量护盾/等量真伤回响（回挂最近 damage；无宿主时挂本招） ──
  { id: "e39-06",
    re: /^(?:且|并)?为(?:对手|对方|敌方)附加等量(?:的)?护盾(?:值)?$|^使(?:对手|对方|敌方)获得等量(?:的)?护盾(?:值)?$/,
    go: () => ({ attachAll: { foeShieldEcho: true } }) },
  { id: "e39-07",
    re: /^(?:额外)?附加等量(?:的)?真实伤害$|^(?:额外)?附加与(?:之|其)(?:等量|相同)(?:的)?真实伤害$/,
    go: () => ({ attachAll: { trueEcho: true } }) },
  // ── PP 随机归零 ──
  { id: "e39-08",
    re: new RegExp(`^(?:使|令)(?:对手|对方|敌方)(?:其)?随机(?:的)?${NUM}个?(?:的|项)?技能(?:的)?PP(?:值)?归[零0]$`),
    go: (m) => ({ effects: [{ op: "pp_delta", target: "opponent", zeroRandom: num(m[1]) }] }) },
  // ── 下只精灵免疫攻击伤害 ──
  // "(自身下场后)令己方下只出战精灵免疫下N次对手攻击技能造成的伤害"——nextTgt 包装器改 target，内层发 dmg_immune
  { id: "e39-09",
    re: new RegExp(`^免疫(?:对手|对方|敌方)?下?(?:${NUM}|次)(?:对手|对方|敌方)?(?:的)?攻击(?:技能)?(?:造成|带来)?的?(?:攻击)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: m[1] !== undefined ? num(m[1]) : 1 } }] }) },
  // ── 视为命中 / 强制执行命中效果 ──
  { id: "e39-10",
    re: /^(?:本次|该次|此次|当次)(?:的)?技能视为命中$|^(?:强制)?执行命中(?:的)?效果$|^视为命中(?:效果)?$/,
    go: () => ({ flags: { accuracy: "always" } }) },
  // ── 单维段数缩放 ──
  // "自身X能力每提升N段则附加M点固定伤害" → flatPerStage 单维过滤
  { id: "e39-11",
    re: new RegExp(`^自身(${STAT_RE})(?:能力)?每提升${NUM}(?:个)?段(?:位|级)?(?:[，,]?则|时|，|,)?附加${NUM}点(?:固定|固定伤害|固伤)$`),
    go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", stat: STATS[m[1]], per: num(m[2]), flat: num(m[3]), mode: "levels" } } }) },
  // "自身X每提升N段则回合结束时减少对手P/Q最大HP" → maxhp_tick 段数放大（perStageStat 整型码=STAGE_TICK_CODES 下标+1）
  { id: "e39-12",
    re: new RegExp(`^自身(${STAT_RE})(?:能力)?每提升${NUM}(?:个)?段(?:位|级)?(?:[，,]?则|时|，|,)?回合结束时?减少(?:对手|对方|敌方)${NUM}\\s*\\/\\s*${NUM}(?:的)?最大(?:体力|HP)(?:值)?$`),
    go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "maxhp_tick", target: "self", params: { n: num(m[3]), d: num(m[4]), perStageStat: TICK_IDX[STATS[m[1]]] + 1, perStagePer: num(m[2]) } })] }) },
  // ── 每回合使用攻击技能附加自身属性值N%伤害 ──
  // 百分比形 → pct_rider{statMask}（基数=自身对应面板和）；固定形 → dmg_flat{statSumPct,statMask}
  { id: "e39-13",
    re: new RegExp(`^每回合使用(?:攻击|属性)?技能附加(?:自身|自己)?(${STOK}(?:、${STOK})*)(?:的)?(?:数值|值)?(?:总和|之和)?的?${NUM}%的(百分比|固定|固定伤害|固伤)伤害?$|^每回合(?:用)?攻击附加(?:自身|自己)?(${STOK}(?:、${STOK})*)(?:的)?(?:数值|值)?(?:总和|之和)?的?${NUM}%的(百分比|固定|固定伤害|固伤)伤害?$`),
    go: (m) => {
      const zh = (m[1] ?? m[4]).split("、");
      const mask = statMaskOf(zh);
      const pct = num(m[2] ?? m[5]);
      const pctKind = /百分比/.test(m[0]);
      return pctKind
        ? { effects: [{ op: "apply_status", name: "pct_rider", target: "self", params: { n: pct, d: 100, statMask: mask } }] }
        : { effects: [{ op: "apply_status", name: "dmg_flat", target: "self", params: { statSumPct: pct, statMask: mask } }] };
    } },
  // ── 免疫下N次对手的攻击 ──
  { id: "e39-14",
    re: new RegExp(`^(?:自身免疫|免疫)(?:对手|对方|敌方)?下?${NUM}次(?:对手|对方|敌方)?(?:的)?攻击(?:技能)?(?:造成的?伤害)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1]) } }] }) },
  // ── 自身异常解除反应（trigger 16） ──
  // "自身烧伤状态解除后则恢复自身所有体力" / "狂暴状态解除后恢复全部体力"
  { id: "e39-15",
    re: new RegExp(`^(?:若)?(?:自身|自己)(${AIL_RE}|狂信|神游|算力限制)(?:的)?状态?(?:解除|消除|消失)(?:后|时)(?:则)?(.+)$`),
    go: (m) => reactWrap(16, undefined, m[2], (sub) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 16 }, ailment: AILMENTS[m[1]] ?? m[1], payload: sub.effects }] })) },
  // ── 裸"回合类效果"尾段 → 延续前消除动词（"消强以及回合类效果"） ──
  { id: "e39-16",
    re: /^(?:对手|对方|敌方)?的?回合类效果$/,
    go: () => ({ effects: [{ op: "cleanse", target: "opponent", scope: "timed" }] }) },
];
