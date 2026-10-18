// batch-e35：缩放/印记/护盾/反弹/秒杀家族——全部接线到现有或本轮新增引擎键位。
import { NUM, num, AIL_RE, AILMENTS, frac } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // "下N次技能无效时令对手X" → react{trigger:19,count:N}（招式被 move_null 拦下时派发）。
  // trigger 19 是本项目新增的"招式被失效"编码，派发点在 engine.ts 的 move-nullified 分支。
  { id: "e35-null15", re: new RegExp("^下" + NUM + "次(?:自身)?技能无效时令(?:对手|对方|敌方)([一-龥]+)$"),
    go: (m) => { const ail = AILMENTS[m[2]] ?? m[2]; return { effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 19, count: num(m[1]) }, payload: [{ op: "apply_status", name: ail, target: "opponent" }] }] }; } },
  // ── 能力等级缩放威力 ────────────────────────────────────────────────
  // "对手每处于1种能力下降状态威力提升20%" → powerPerStageScale pct/count
  { id: "e35-01", re: new RegExp(`^(?:对手|对方|敌方)每处于${NUM}种能力(?:等级)?(?:下降|弱化)(?:状态)?威力(?:提升|增加|提高)${NUM}%$|^每处于${NUM}种能力(?:等级)?(?:下降|弱化)(?:状态)?威力(?:提升|增加|提高)${NUM}%$`),
    go: (m) => { const i = m[1] !== undefined ? 1 : 3; return { attachDamage: { powerPerStageScale: { who: "foe", sign: "down", per: num(m[i]), add: num(m[i + 1]), kind: "pct" } } }; } },
  // "威力提升值为对手当前能力下降状态总和×30%" → powerPerStageScale flat/levels
  { id: "e35-02", re: /^威力(?:提升|增加|提高)值为?(?:对手|对方|敌方)(?:当前)?能力(?:等级)?(?:下降|弱化)(?:状态)?(?:的)?总和?[×*](\d+)%?$|^威力(?:提升|增加|提高)值为?(?:对手|对方|敌方)(?:当前)?能力(?:等级)?(?:下降|弱化)(?:状态)?(?:的)?总和乘(?:以)?(\d+)%?$/,
    go: (m) => ({ attachDamage: { powerPerStageScale: { who: "foe", sign: "down", per: 1, add: num(m[1] ?? m[2]), mode: "levels", kind: "flat" } } }) },
  // "自身每处于1种能力提升状态威力提升N%" 百分号变体
  { id: "e35-03", re: new RegExp(`^(?:自身|自己)每处于${NUM}种能力(?:等级)?(?:提升|强化|上升)(?:状态)?威力(?:提升|增加|提高)${NUM}%$`),
    go: (m) => ({ attachDamage: { powerPerStageScale: { who: "self", sign: "up", per: num(m[1]), add: num(m[2]), kind: "pct" } } }) },
  // ── 死亡计数固伤 ────────────────────────────────────────────────────
  // "每有1只精灵死亡则附加100点固定伤害"/"对手每有1只精灵阵亡附加N点"
  { id: "e35-04", re: new RegExp(`^(?:(己方|我方|对手|对方|敌方)(?:的)?)?每有${NUM}只精灵(?:死亡|阵亡|倒下)(?:则|时)?(?:额外)?附加${NUM}点(?:固定)?伤害$`),
    go: (m) => { const who = m[1] === undefined ? "all" : /己|我/.test(m[1]) ? "self" : "foe"; return { attachDamage: { flatPerDead: { who, per: num(m[2]), add: num(m[3]) } } }; } },
  // ── 满连击秒杀 ──────────────────────────────────────────────────────
  // "若本回合攻击次数达到最大则必定秒杀对手" → koIfHitsMax（hit 数达 hits.max 时最后一击必杀）
  { id: "e35-05", re: /^(?:若)?(?:本回合|该回合|当回合)?(?:的)?攻击次数达到(?:上限|最大值?|最大次数)(?:时|则)(?:必定)?(?:秒杀|击杀|击倒|击败)(?:对手|对方|敌方)?$/,
    go: () => ({ attachDamage: { koIfHitsMax: true } }) },
  // ── 控制异常反弹 / 状态镜像 / 固伤减免 ───────────────────────────────
  // "反弹所有受到的控制类异常状态"
  { id: "e35-06", re: /^(?:将|把)?(?:自身|自己)?(?:受到的|承受的)(?:所有|全部)?控制类?异常状态?(?:全部)?反弹(?:给(?:对手|对方|敌方))?$|^反弹(?:自身|自己)?(?:受到的|承受的)(?:所有|全部)?控制类?异常状态?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "reflect_ctl", target: "self" }] }) },
  // "免疫并反弹(所有)?(受到的)?控制类异常状态" → immune{ctl:1}+reflect_ctl（并保留整句后 ctl 免疫可缩域）
  { id: "e35-06b", re: /^免疫并反弹(?:所有|全部)?(?:受到的|承受的)?控制类异常状态?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { ctl: 1 } }, { op: "apply_status", name: "reflect_ctl", target: "self" }] }) },
  // "对手的状态变化会同时作用在自己的身上" → mirror_stages
  { id: "e35-07", re: /^(?:对手|对方|敌方)的(?:能力|状态)变化会?(?:同时)?作用(?:在|到)?(?:自己|自身)(?:的)?身上$/,
    go: () => ({ effects: [{ op: "apply_status", name: "mirror_stages", target: "self" }] }) },
  // "受到的固定伤害降低N%" → fixed_taken_pct 计时窗（flat_taken_pct 的固伤单列版）
  { id: "e35-08", re: new RegExp(`^(?:自身|自己)?(?:受到的|承受的)(?:所有|全部)?固定伤害(?:降低|减少|下降)${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "fixed_taken_pct", target: "self", params: { pct: num(m[1]) } }] }) },
  // ── 反应式 ─────────────────────────────────────────────────────────
  // "若对手当回合恢复体力则自身附加对手最大体力1/N的百分比伤害" → react trigger 15
  { id: "e35-09", re: new RegExp(`^(?:若|当)?(?:对手|对方|敌方)(?:当回合|本回合)?恢复(?:了)?体力(?:时|则)?(?:自身)?附加(?:对手|对方|敌方)?最大体力(${NUM})\\/(${NUM})的百分比伤害$`),
    go: (m) => reactWrap(15, undefined, `附加对手最大体力${m[1]}/${m[2]}的百分比伤害`, (sub) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 15 }, payload: sub.effects }] })) },
  // "受到攻击N%概率做出绝对反击" → react{trigger:1} payload 等量反伤
  { id: "e35-10", re: new RegExp(`^受到(?:对手|对方|敌方)?(?:的)?攻击(?:时|后)?有?${NUM}%?(?:的)?概率?(?:做出|发动|进行)?绝对反击$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", chance: num(m[1]), params: { trigger: 1 }, payload: [{ op: "damage", power: 0, kind: "fixed", flatSelfLastTaken: true }] }] }) },
  // "受到攻击N%进入X（印记名）" → react{trigger:1} payload apply_mark
  { id: "e35-11", re: new RegExp(`^受到(?:对手|对方|敌方)?(?:的)?攻击(?:时|后)?有?${NUM}%(?:的)?概率?(?:使|令)?(?:自身|自己)?进入(\\S{2,8})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", chance: num(m[1]), params: { trigger: 1 }, payload: [{ op: "apply_mark", mark: m[2], target: "self" }] }] }) },
  // ── 护盾/护罩家族 ───────────────────────────────────────────────────
  // "护盾所吸收的伤害值N%反弹" → attachDamage shieldAbsorbPct
  { id: "e35-12", re: new RegExp(`^(?:护盾|护罩)(?:所)?吸收(?:的|到)?伤害值?(?:的)?${NUM}%(?:反弹|反馈|反弹给对手)$|^将(?:护盾|护罩)(?:所)?吸收(?:的|到)?伤害(?:值)?(?:的)?${NUM}%(?:反弹|反馈)(?:给对手|给对方)?$`),
    go: (m) => ({ attachDamage: { shieldAbsorbPct: num(m[1]) } }) },
  // "每恢复1点吸取对手N点体力"（挂 pp_delta 宿主）→ attachAll drainPerPpPoint
  { id: "e35-13", re: new RegExp(`^每恢复${NUM}点(?:PP|pp)?(?:值)?(?:则|就)?吸取(?:对手|对方|敌方)${NUM}点体力$`),
    go: (m) => ({ attachAll: { drainPerPpPoint: { per: num(m[1]), flat: num(m[2]) } } }) },
  // "若当前护罩值低于N则造成的固定伤害翻倍" → attachAll flatMulIf{selfShieldBelow}
  { id: "e35-14", re: new RegExp(`^若(?:当前)?(?:自身|自己)?(?:护盾|护罩)值低于${NUM}(?:点)?则(?:造成的)?(?:固定)?伤害翻倍$`),
    go: (m) => ({ attachAll: { flatMulIf: { when: { selfShieldBelow: num(m[1]) }, numerator: 2, denominator: 1 } } }) },
  // "复制成功则自身免疫下N次受到的异常状态" → immune_status count 门（prevApplied 由 copy_stages 写）
  { id: "e35-15", re: new RegExp(`^复制(?:成功|对手能力提升)?(?:后|时)?则?(?:自身|自己)?免疫下${NUM}次(?:受到的)?异常状态$|^复制(?:成功|对手能力提升)?(?:后|时)?则?(?:自身|自己)?免疫(?:对手|对方|敌方)下${NUM}次(?:施加的)?异常状态$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[1] ?? m[2]) }, if: { prevApplied: true } }] }) },
  // "随机附加A、B、C其中N种异常状态"/"使对手A、B、C其中N种异常状态" → random list（"其中N种"自带随机择一语义）
  { id: "e35-16", re: new RegExp(`^(?:随机)?(?:使|令|附加|给予)?(?:对手|对方|敌方)?(?:处于|进入|受到)?((?:(?:${AIL_RE})、)+(?:${AIL_RE}))其中${NUM}种异常状态?$`),
    go: (m) => {
      const list = [...new Set([...m[1].matchAll(new RegExp(AIL_RE, "g"))].map((x) => AILMENTS[x[0]]).filter(Boolean))];
      return list.length === 0 ? { unparsedReason: "ailment enum list" } : { effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list, count: num(m[2]) } }] };
    } },
  // "攻击无效效果延续至下回合" —— 已有链路：batch-e5f-20 → attachAll.extendTurns，条件化由解析层 partCond→extendTurnsIf 转换完成，此处不再重复。
  // "若回合开始时自身处于能力下降状态则解除并将能力下降状态反弹给对手"
  { id: "e35-18", re: /^(?:若|当)?回合开始时?(?:若)?(?:自身|自己)处于能力(?:下降|弱化)(?:状态)?(?:时|则)?解除(?:自身|自己)?能力(?:下降|弱化)(?:状态)?(?:并|且|再|同时)?将(?:其|该)?能力?(?:下降|弱化)?(?:状态)?反弹给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [
      { op: "clear_stages", target: "self", sign: "down", if: { selfStageDownStart: true } },
      { op: "transfer_stages", direction: "push", sign: "down", if: { selfStageDownStart: true } },
    ] }) },
  // "将能力下降状态反弹给对手"（独立子句——"解除自身能力下降，并将能力下降反弹给对手"切分尾段）
  { id: "e35-18b", re: /^(?:并|且|再|同时)?将(?:其|该|自身|自己)?(?:的)?能力?(?:下降|弱化)(?:状态)?反弹给(?:对手|对方|敌方)$|^(?:并|且|再|同时)?将(?:其|该)?能力(?:下降|弱化)?(?:状态)?反弹给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // "造成的伤害提升对手能力下降总段数乘以10%" → dmgPctPerFoeDownStage
  { id: "e35-20", re: new RegExp(`^(?:造成的)?伤害(?:提升|增加|提高)(?:对手|对方|敌方)?能力(?:下降|弱化)(?:状态)?(?:的)?总段数[乘×*](?:以)?${NUM}%$`),
    go: (m) => ({ attachDamage: { dmgPctPerFoeDownStage: { pct: num(m[1]) } } }) },
];
