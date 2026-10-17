// batch-e48：3-4 频带长尾——受攻击反打 / 附带变体 / 致死保留 / 视为别名 /
// 存活差增威 / PP削减变体 / 融合双句 / 续用威力步进等。
// reactWrap 只能在 go() 运行时调用（顶层禁止——见 batch-e24 头注）。
import { NUM, num, STATS, STAT_RE } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── "受攻击对方X和Y-N" → reactWrap(1) 反打降级（"受攻击"=受到攻击简写） ──
  { id: "e48-01", re: /^受攻击((?:对方|对手|敌方).+)$/, go: (m) => reactWrap(1, {}, m[1]) },
  // ── "每次躲避攻击N%X" → 对手MISS=自身躲避（trigger2） ──
  { id: "e48-02", re: new RegExp(`^(?:每次)?躲避攻击(?:时|后)?${NUM}%(.+)$|^每次躲避攻击(.+)$`), go: (m) => m[2] !== undefined ? reactWrap(2, { chance: num(m[1]) }, m[2]) : reactWrap(2, {}, m[3]) },
  // ── "受到攻击N%回复M体力" → react trigger1 + chance + heal flat ──
  { id: "e48-03", re: new RegExp(`^受到攻击${NUM}%(?:概率|几率)?回复${NUM}点?(?:体力|HP)$`), go: (m) => reactWrap(1, { chance: num(m[1]) }, `回复${m[2]}点体力`) },
  // ── "受到致死攻击剩余N点体力" → endure params.hp ──
  { id: "p2-ed-04",
    re: /^(?:受到|遭受|承受)致死(?:的)?(?:攻击|伤害|一击)(?:时)?(?:则)?(?:余下|剩余|保留|留下)(?:剩余)?(?:下)?(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))点?(?:体力|HP|hp)$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1]) } }] }),
  },
  { id: "e48-04", re: new RegExp(`^受到致死攻击(?:时)?剩余${NUM}点体力$|^(?:受到|遭到)致死攻击余下${NUM}点体力$|^受到致命伤害时(?:对手|对方)剩余${NUM}点体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "endure", target: "self", params: { hp: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // ── "将受伤害N倍返还给对手" → reflect_dmg n/d；"下次受到伤害N%反馈" → count:1 ──
  { id: "e48-05", re: new RegExp(`^将(?:自己|自身)?(?:受到的?|受)?伤害${NUM}倍返还(?:给)?(?:对手|对方|敌方)$|^将下次受到的伤害${NUM}%反馈给对手$`), go: (m) => m[2] !== undefined ? ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[2]), d: 100, count: 1 } }] }) : ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 1 } }] }) },
  // ── "增加N层衰弱" → feeble params.layers（再施加时累加，见 apply-effect） ──
  { id: "e48-05b", re: new RegExp(`^(?:令|使|让)?(?:对手|对方|敌方)?增加${NUM}层衰弱$|^令对手增加一层衰弱$`), go: (m) => ({ effects: [{ op: "apply_status", name: "feeble", target: "opponent", params: { layers: num(m[1] ?? "1") } }] }) },
  // ── "下N次对手使用的属性技能无效" → move_null count+cat ──
  { id: "e48-05c", re: new RegExp(`^下?${NUM}次(?:对手|对方|敌方)使用的?(攻击|属性|物理|特殊)技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1]), cat: /属性/.test(m[2]) ? 1 : 4 } }] }) },
  // ── "每次对手主动切换下场则令对方下只精灵出战时N%X" → trigger9 反应窗 ──
  { id: "e48-05d", re: new RegExp(`^每次对手主动切换下场则(?:令|使)?(?:对手|对方|敌方)下只精灵出战时${NUM}%(.+)$|^每次对手主动切换下场则(?:令|使)?(?:对手|对方|敌方)下只精灵出战时(.+)$`), go: (m) => m[2] !== undefined ? reactWrap(9, { chance: num(m[1]) }, `使对手${m[2]}`) : reactWrap(9, {}, `使对手${m[3]}`) },
  // ── "减少对手N/Mhp" → percent 伤害（hp 小写变体） ──
  { id: "e48-06", re: new RegExp(`^减少(?:对手|对方|敌方)${NUM}\\s*/\\s*${NUM}(?:点)?[hH][pP]$|^减少对手${NUM}\\s*/\\s*${NUM}体力$`), go: (m) => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: num(m[1] ?? m[3]), denominator: num(m[2] ?? m[4]) }, target: "opponent" }] }) },
  // ── "令对方所有能力增加效果消失" → clear_stages{foe,up}（"能力增加效果"变体） ──
  { id: "e48-07", re: /^(?:令|使)(?:对方|对手|敌方)(?:所有|全部)?能力(?:增加|提升|增强)(?:的)?效果?消失$/, go: () => ({ effects: [{ op: "clear_stages", sign: "up", target: "opponent" }] }) },
  // ── "将能力下降效果反馈给对手" → transfer_stages push（"效果"变体） ──
  { id: "e48-08", re: /^将(?:自身的?)?能力下降(?:效果|状态)?反馈给(?:对手|对方|敌方)$/, go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // ── "自身不会被弱化"/"免疫弱化" → immune_degrade（"不会/免疫+弱化"变体）。放在 e48-09 前面，那条要求「不会」直接接「能力下降」。 ──
  { id: "e48-09a", re: /^(?:自身|自己)?(?:免疫|不受|不会(?:被)?)(?:弱化|能力下降)(?:状态)?$|^(?:自身|自己)?(?:能力|属性)(?:等级)?不受影响$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // ── "不会能力下降" → immune_degrade 裸形 ──
  { id: "e48-09", re: /^(?:自身|自己)?不会(?:出现)?能力下降$|^不受能力下降影响$/, go: () => ({ effects: [{ op: "apply_status", name: "immune_degrade", target: "self" }] }) },
  // ── "解除自身状态下降和异常" → clear_stages{self,down} + cleanse ailment 融合 ──
  { id: "e48-10", re: /^解除(?:自身|自己)(?:的)?(?:状态|能力)下降和异常(?:状态)?$|^解弱(?:&|和|与)消强$/, go: () => ({ effects: [{ op: "clear_stages", sign: "down", target: "self" }, { op: "cleanse", scope: "ailment", target: "self" }] }) },
  // ── "若自身状态异常则回满体力" → heal 1/1 if:selfStatused ──
  { id: "e48-11", re: /^若?自身(?:状态|处于)?异常(?:状态)?则?回满体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self", if: { selfStatused: true } }] }) },
  // ── "回满体力" 裸形 → heal 1/1 ──
  { id: "e48-12", re: /^回满体力$|^恢复满体力$/, go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // ── "免疫异常恢复最大体力N/M" → immune_status + heal 融合 ──
  { id: "e48-13", re: new RegExp(`^免疫(?:异常|异常状态)(?:并|且|，|,)?(?:恢复|回复)(?:自身)?最大体力${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) },
  // ── "处于强化或弱化状态都恢复N体力" → heal flat if or[selfStageUp,selfStageDown] ──
  { id: "e48-14", re: new RegExp(`^处于(?:强化|能力提升)或(?:弱化|能力下降)状态(?:时)?都?恢复${NUM}点?(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1]), target: "self", if: { or: [{ selfStageUp: true }, { selfStageDown: true }] } }] }) },
  // ── "自身所有攻击造成的伤害将为自己恢复体力" → 永久 drain_atk 1/1 ──
  { id: "e48-15", re: /^(?:自身|自己)?(?:所有)?攻击(?:技能)?造成的伤害(?:将)?(?:会)?(?:为|给)?(?:自己|自身)恢复体力$/, go: () => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 1 } }] }) },
  // ── "命中对方降低对方所有技能N点PP值" → pp_delta 全槽负（"降低…N点PP"词序变体） ──
  { id: "e48-16", re: new RegExp(`^(?:降低|减少|扣除)(?:对手|对方|敌方)(?:的)?所有技能${NUM}点?(?:PP值|PP)$|^降(?:对手|对方|敌方)PP${NUM}点?$`), go: (m) => ({ effects: [{ op: "pp_delta", amount: -num(m[1] ?? m[2]), target: "opponent", scope: "all" }] }) },
  // ── "每回合附带N点固定伤害" / "每回合附加N点固定"（"附带"变体+截断尾） ──
  { id: "e48-17", re: new RegExp(`^每回合(?:开始|结束)?(?:时|后)?(?:附带|附加)${NUM}点固定(?:伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: num(m[1]) } }] }) },
  // ── "致命一击率为N/N" / "致命一击率上升N/N" → crit_up 分数 ──
  { id: "e48-18", re: new RegExp(`^致命一?击率(?:上升|提升|提高|为)?${NUM}\\s*/\\s*${NUM}$|^致命率为${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: num(m[1] ?? m[3]), d: num(m[2] ?? m[4]) } }] }) },
  // ── "连续使用每次威力提升N，最高提升至M" → powerPerUse+useCap（提升至=绝对上限）
  //    "连续使用威力增加N，最多增加M" → powerPerUse+powerPerUseCap（增加量上限） ──
  { id: "e48-19", re: new RegExp(`^连续使用(?:每次)?威力(?:提升|提高|增加)${NUM}点?(?:，|,)?最高(?:提升|提高|增加)至?${NUM}$`), go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[2]) } }) },
  { id: "e48-19b", re: new RegExp(`^连续使用威力增加${NUM}点?(?:，|,)?最多增加${NUM}$`), go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), powerPerUseCap: num(m[2]) } }) },
  // ── "对方每比己方多存活N只精灵威力提升M点" → powerPerAliveDiff ──
  { id: "e48-20", re: new RegExp(`^(?:对方|对手|敌方)每比(?:己方|我方|自身)多存活${NUM}只精灵(?:，|,)?威力提升${NUM}点?$`), go: (m) => ({ attachDamage: { powerPerAliveDiff: { per: num(m[1]), add: num(m[2]) } } }) },
  // ── "将自身的防御、特防能力提升分别视为攻击、特攻能力提升" → stage_alias ──
  { id: "e48-21", re: /^将(?:自身|自己)的?(?:防御|特防)(?:、|和)?(?:防御|特防)?能力(?:提升|增强)(?:分别)?视为(?:攻击|特攻)(?:、|和)?(?:攻击|特攻)?能力(?:提升|增强)$/, go: () => ({ effects: [{ op: "apply_status", name: "stage_alias", target: "self" }] }) },
  // ── "附加自身能力提升等级总和×N的固定伤害" → flatPerStage levels ──
  { id: "e48-22", re: new RegExp(`^附加(?:自身|自己)能力(?:提升|增强)(?:等级)?总和[×xX*]?${NUM}(?:倍)?的?固定伤害$`), go: (m) => ({ attachDamage: { flatPerStage: { who: "self", sign: "up", per: 1, flat: num(m[1]), mode: "levels" } } }) },
  // ── "对手回合类效果无法被消除则下N次属性技能无效" → move_null 消除失败门控 ──
  { id: "e48-23", re: new RegExp(`^(?:对手|对方|敌方)回合类效果无法被消除则下?${NUM}次(?:对手|对方|敌方)使用的?(?:属性|攻击)?技能无效$`), go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: "opponent", params: { count: num(m[1]) }, if: { not: { prevApplied: true } } }] }) },
  // ── "若本次技能微弱对手则先制+N" → priorityIf effWeakVsFoe ──
  { id: "e48-24", re: new RegExp(`^若?本次技能微弱(?:对手|对方|敌方)?则?先制\\+${NUM}$`), go: (m) => ({ flags: { priorityIf: { when: { effWeakVsFoe: true }, add: num(m[1]) } } }) },
  // ── "消耗自身最大体力的N/M"（无"当前"变体） ──
  { id: "e48-25", re: new RegExp(`^消耗(?:自身|自己)最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, target: "self" }] }) },
  // ── "攻击额外+N" → powerAdd ──
  { id: "e48-26", re: new RegExp(`^攻击额外\\+${NUM}$|^额外\\+${NUM}攻击$`), go: (m) => ({ attachDamage: { powerAdd: num(m[1] ?? m[2]) } }) },
  // ── "增加N点固定伤害"/"附带N点伤害"（动词变体） ──
  { id: "e48-27", re: new RegExp(`^增加${NUM}点(?:固定|固定伤害|伤害|固伤)$|^附带${NUM}点伤害$`), go: (m) => ({ attachDamage: { flat: num(m[1] ?? m[2]) } }) },
  // ── "X、Y能力提升N"（无"等级"/符号裸形——既有路径静默丢首项，此处兜底全维） ──
  { id: "e48-32", re: new RegExp(`^(使|令)?(自身|自己|对手|对方|敌方)?(${STAT_RE})[、，,和及与](${STAT_RE})能力(提升|增强|下降|降低)${NUM}个?(?:等级|级)?$`), go: (m) => { const d = (m[5] === "下降" || m[5] === "降低" ? -1 : 1) * num(m[6]); return { effects: [{ op: "apply_stat_stage", stat: STATS[m[3]], delta: d, target: m[2] === undefined || /自身|自己/.test(m[2]) ? "self" : "opponent" }, { op: "apply_stat_stage", stat: STATS[m[4]], delta: d, target: m[2] === undefined || /自身|自己/.test(m[2]) ? "self" : "opponent" }] }; } },
  // ── "对方下只精灵体力减少N/M" → react payload 内 opponent percent（trigger5/9 语境该单位已在场） ──
  { id: "e48-33", re: new RegExp(`^(?:对手|对方|敌方)下只(?:精灵|出场精灵)(?:出战时)?体力减少${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, target: "opponent" }] }) },
  // ── 裸"体力减少N/M"（nextTgt 前缀剥离后残余；独立出现亦按对手承伤读） ──
  { id: "e48-40", re: new RegExp(`^体力减少${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, target: "opponent" }] }) },
  // ── "受攻击(时|，)反弹N点(固定)伤害"/"反弹N固伤" → counter flat ──
  { id: "e48-34", re: new RegExp(`^受攻击(?:时|后|，|,)?反弹${NUM}点?(?:固定)?伤害$|^受攻击(?:时|后|，|,)?反弹${NUM}固伤$|^反弹${NUM}点?固伤$`), go: (m) => { const n = num(m[1] ?? m[2] ?? m[3]); return m[3] !== undefined ? { effects: [{ op: "apply_status", name: "counter", target: "self", params: { flat: n } }] } : reactWrap(1, {}, `反弹${n}点固定伤害`); } },
  // ── "解弱恢复N/M体力" / "解异常解弱化" 融合 ──
  { id: "e48-35", re: new RegExp(`^解弱(?:化)?(?:，|,)?恢复${NUM}\\s*/\\s*${NUM}体力$|^解异常解弱化$`), go: (m) => m[1] !== undefined ? ({ effects: [{ op: "clear_stages", sign: "down", target: "self" }, { op: "heal", numerator: num(m[1]), denominator: num(m[2]), target: "self" }] }) : ({ effects: [{ op: "clear_stages", sign: "down", target: "self" }, { op: "cleanse", scope: "ailment", target: "self" }] }) },
  // ── "处于强化状态都恢复N体力"（or 弱化 单支变体） ──
  { id: "e48-36", re: new RegExp(`^处于(?:强化|能力提升)状态(?:时)?都?恢复${NUM}点?(?:体力|HP)$|^处于(?:弱化|能力下降)状态(?:时)?都?恢复${NUM}点?(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "self", if: m[2] !== undefined ? { selfStageDown: true } : { selfStageUp: true } }] }) },
  // ── "减对方X N" 无符号降级变体 ──
  { id: "e48-37", re: new RegExp(`^减(?:对方|对手|敌方)(${STAT_RE})${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: -num(m[2]), target: "opponent" }] }) },
  // ── 相邻双/三维同 delta："攻击特攻+1"/"防御速度命中-1"/"对方双方-1"（双方=双防 def+sdf 刮写错字） ──
  { id: "e48-38", re: new RegExp(`^(使|令)?(自身|自己|对方|对手|敌方)?(${STAT_RE}|双方|双攻|双防|攻速)((?:${STAT_RE})?)([+-])${NUM}$`), go: (m) => {
    const g1 = m[3] === "双方" || m[3] === "双防" ? ["def", "sdf"] : m[3] === "双攻" ? ["atk", "spa"] : m[3] === "攻速" ? ["atk", "spd"] : [STATS[m[3]]];
    const g2 = m[4] !== "" ? [...m[4].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]) : [];
    const d = (m[5] === "-" ? -1 : 1) * num(m[6]);
    const tgt = m[2] === undefined || /自身|自己/.test(m[2]) ? "self" : "opponent";
    return { effects: [...g1, ...g2].filter(Boolean).map((st) => ({ op: "apply_stat_stage", stat: st, delta: d, target: tgt })) };
  } },
  // ── 相邻两组各自 delta："攻击+1防御速度+1"/"对方攻击特攻-1命中-1"（NUM 自带捕获组——直接用） ──
  { id: "e48-39", re: new RegExp(`^(使|令)?(自身|自己|对方|对手|敌方)?((?:${STAT_RE})+)([+-])${NUM}((?:${STAT_RE})+)([+-])${NUM}$`), go: (m) => {
    const tgt = m[2] === undefined || /自身|自己/.test(m[2]) ? "self" : "opponent";
    const g1 = [...m[3].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]);
    const g2 = [...m[6].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]);
    const d1 = (m[4] === "-" ? -1 : 1) * num(m[5]); const d2 = (m[7] === "-" ? -1 : 1) * num(m[8]);
    return { effects: [...g1.map((st) => ({ op: "apply_stat_stage", stat: st, delta: d1, target: tgt })), ...g2.map((st) => ({ op: "apply_stat_stage", stat: st, delta: d2, target: tgt }))] };
  } },

  // ── "消耗自身体力的N/M"（裸"体力"=当前体力消耗——与"消耗最大体力"区分） ──
  { id: "e48-41", re: new RegExp(`^消耗(?:自身|自己)体力(?:的)?${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "damage", power: 0, kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, percentBase: "current", target: "self" }] }) },
  // ── "受到攻击N%概率做出超强反击"/"做出超强反击" → 反击量未定义 UNVERIFIED ──
  { id: "e48-42", re: /超强反击/, go: () => ({ unparsedReason: "super-counter magnitude undocumented (UNVERIFIED)", effects: [] }) },
  // ── deferred 域归桶 ──
  { id: "e48-28", re: /^与(?:对方|对手|敌方)翻转属性$|^翻转(?:双方|自身和对手)的?属性$/, go: () => ({ unparsedReason: "type swap unmodeled (deferred)", effects: [] }) },
  { id: "e48-29", re: new RegExp(`^(?:令|使).{1,6}(?:进行|获得)${NUM}次(?:额外)?行动$`), go: () => ({ unparsedReason: "extra action unmodeled (deferred)", effects: [] }) },
  { id: "e48-30", re: /携带技能石|未携带技能石/, go: () => ({ unparsedReason: "held-item predicate unmodeled (deferred)", effects: [] }) },
  // 纯目标句（无能力前缀）。必须锚定整句：未锚定会截走 "攻击 +1组队时可作用己方任意目标"（e53-v25-03）。
  { id: "e48-31", re: /^组队(?:时)?(?:可作用|可以作用|可作用于)?(?:己方)?任意目标$/, go: (m) => ({ flags: { targetScope: /己方/.test(m[0]) ? "anyAlly" : "any" } }) },
];
