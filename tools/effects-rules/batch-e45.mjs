// batch-e45：残留清晰句式第五批
//   1. 转变为吸取/恢复等量（flatRepIf+drain / convToHeal）
//   2. 承伤减免裸形（"伤害减N" / "受到的伤害减N" / "伤害减N%"）
//   3. 已损失生命值%固伤、使自己睡眠、随机吸收属性、使用技能吸血
//   4. 附带N点伤害、触发概率翻倍、消耗全部PP、威力最高技能PP归零
//   5. 场下存活恢复、回合数×N固伤、阵亡计数护盾、免异常次数
//   6. 威力提升N点、重置使用次数、下N次固伤减免、无法通过技能恢复
import { NUM, num, AILMENTS, STATS } from "./lex.mjs";
import { liftTick } from "./tick-shape.mjs";

export const rules = [
  // ── "转变为吸取N-M点体力" → 固伤改写区间+全额吸血 ──
  { id: "e45-01", re: new RegExp(`^转变为吸取(?:对手|对方|敌方)?${NUM}\\s*[~～\\-—]\\s*${NUM}点?(?:体力|体力值|HP)?$`), go: (m) => ({ attachDamage: { flatRepIf: { range: { min: num(m[1]), max: num(m[2]) } }, drain: { numerator: 1, denominator: 1 } } }) },
  // ── "转变为恢复自身等量体力(值)" → 最近 dmg_immune 转 dmg_to_heal ──
  { id: "e45-02", re: /^转变为恢复(?:自身|自己)等量体力(?:值)?$|^转变为恢复(?:自身|自己)等量(?:的)?体力$/, go: () => ({ attachAll: { convToHeal: true } }) },
  // ── "伤害减N"/"受到的伤害减N"/"伤害减N%" ──
  { id: "e45-03", re: new RegExp(`^(?:受到(?:的)?(?:攻击|技能)?伤害|伤害)减${NUM}(点|%)?$`), go: (m) => m[2] === "%" ? ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[1]) } }] }) : ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1]) } }] }) },
  // ── "附加对手已损失生命值N%的百分比伤害" → percentBase:foeMissing ──
  { id: "e45-04", re: new RegExp(`^附加(?:对手|对方|敌方)(?:当前)?(?:已)?损失(?:的)?(?:生命值|体力值|HP)的?${NUM}%(?:的)?百分比伤害$|^造成(?:对手|对方|敌方)已损失生命值${NUM}%的百分比伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: "percent", power: num(m[1] ?? m[2]), percentBase: "foeMissing", target: "opponent" }] }) },
  // ── "使自己睡眠N回合" / "使对手睡眠N回合" ──
  { id: "e45-05", re: new RegExp(`^(?:使|令|让)(?:自己|自身)(${Object.keys(AILMENTS).join("|")})${NUM}回合$|^(?:使|令|让)(?:对手|对方|敌方)(${Object.keys(AILMENTS).join("|")})${NUM}回合$`), go: (m) => { const selfSide = m[1] !== undefined; const ail = AILMENTS[m[1] ?? m[3]]; const turns = num(m[2] ?? m[4]); return ail === undefined ? null : { effects: [{ op: "apply_status", name: ail, target: selfSide ? "self" : "opponent", turns }] }; } },
  // ── "随机吸收对手N项属性-M并附加到自身" → transfer_stages randomCount ──
  { id: "e45-06", re: new RegExp(`^随机(?:吸收|吸取)(?:对手|对方|敌方)${NUM}项(?:能力|属性)[-\\+]?${NUM}?(?:点)?(?:并|再)?(?:附加|添加|转移)(?:到|至|给)(?:自身|自己)(?:身上)?$|^随机吸收(?:对手|对方|敌方)${NUM}项(?:能力|属性)-${NUM}$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { effects: [{ op: "transfer_stages", randomCount: ns[0], randomDelta: ns.length > 1 ? ns[1] : 1 }] }; } },
  // ── "每回合使用技能则吸取对手N点体力" → drain_on_use 窗 ──
  { id: "e45-07", re: new RegExp(`^每回合(?:使用技能|出手|攻击)(?:时|后)?则?(?:额外)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}点?(?:体力|HP)$|^每回合使用技能额外吸取(?:对手|对方|敌方)${NUM}点?(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_on_use", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
  // ── "附带N点伤害"/"额外附带N点固定伤害" ──
  { id: "e45-08", re: new RegExp(`^(?:附带|额外附带|额外附加)${NUM}点?(?:固定|固定伤害|伤害|固伤)?$`), go: (m) => ({ attachDamage: { flat: num(m[1]) } }) },
  // ── "触发概率翻倍"/"概率翻倍" → chanceDouble ──
  { id: "e45-09", re: /^(?:触发|攻击)?(?:的)?(?:概率|几率)翻倍$/, go: () => ({ attachAll: { chanceDouble: true } }) },
  // ── "消耗自身所有技能的PP值" → 全槽归零 ──
  { id: "e45-10", re: /^消耗(?:自身|自己)(?:的)?(?:所有|全部)(?:技能)?的?(?:PP值|PP)$|^消耗(?:自身|自己)所有技能(?:的)?PP值$/, go: () => ({ effects: [{ op: "pp_delta", target: "self", scope: "all", zero: true }] }) },
  // ── "令对手威力最高的攻击技能PP值归零" → slot:"strongest" ──
  { id: "e45-11", re: /^(?:令|使)(?:对手|对方|敌方)(?:的)?威力最高的(?:攻击)?技能(?:的)?PP值归(?:零|0)$/, go: () => ({ effects: [{ op: "pp_delta", zeroMaxPower: true, target: "opponent" }] }) },
  // ── "为己方所有场下存活精灵恢复N点体力" → bench heal ──
  { id: "e45-12", re: new RegExp(`^(?:为|给|令|使)(?:己方|我方|自身)(?:所有)?(?:场下|不在场|后备)(?:的)?(?:存活)?精灵恢复${NUM}点?(?:体力|HP)$|^恢复(?:己方|我方)(?:所有)?(?:场下|不在场)(?:的)?(?:存活)?精灵${NUM}点?(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "bench" }] }) },
  // ── "附加当前战斗回合数×N的固定伤害" → flatPerTurn ──
  { id: "e45-13", re: new RegExp(`^附加(?:当前)?(?:战斗)?回合数[×xX*]${NUM}(?:倍)?的?(?:固定伤害|固伤)$|^附加当前战斗回合数[×xX*]${NUM}`), go: (m) => ({ attachDamage: { flatPerTurn: { mul: num(m[1] ?? m[2]) } } }) },
  // ── "己方每有N只精灵阵亡则为自身附加M点护盾" → shield flatPerDead ──
  { id: "e45-14", re: new RegExp(`^(?:己方|我方|自身)每有${NUM}只精灵(?:阵亡|死亡|倒下)(?:则|就)?(?:为|给)?(?:自身|自己)?附加${NUM}点?(?:护盾|护罩)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "shield", target: "self", params: { flatPerDeadPer: num(m[1]), flatPerDeadAdd: num(m[2]) } }] }) },
  // ── "令己方免疫下N次受到的异常状态" → immune_status count ──
  { id: "e45-15", re: new RegExp(`^(?:令|使)(?:己方|自身|自己)免疫下?${NUM}次(?:受到的|受到的?任何)?异常状态$|^(?:己方|自身)免疫下?${NUM}次异常$`), go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", params: { count: num(m[1] ?? m[2]) } }] }) },
  // ── "使该技能攻击威力提升N点" → powerAdd ──
  { id: "e45-16", re: new RegExp(`^(?:使|令)(?:该|此|本)技能(?:攻击)?威力(?:提升|提高|增加)${NUM}点?$|^威力提升${NUM}点$`), go: (m) => ({ attachDamage: { powerAdd: num(m[1] ?? m[2]) } }) },
  // ── "重置该技能使用次数"/"重置自身连击次数" → resetStacks ──
  { id: "e45-17", re: /^重置(?:该|此|本)技能(?:的)?(?:使用|连击)次数$|^重置(?:自身|自己)(?:的)?连击次数$/, go: () => ({ attachDamage: { resetStacks: true } }) },
  // ── "下N次受到的固伤和百分比伤害减少M%"（固伤 缩写变体）──
  { id: "e45-18", re: new RegExp(`^(?:自身|自己)?下${NUM}次受到的固伤和百分比伤害减少${NUM}%$`), go: (m) => ({ effects: [{ op: "apply_status", name: "flat_taken_pct", target: "self", params: { count: num(m[1]), pct: num(m[2]) } }] }) },
  // ── "对手N回合内无法通过技能恢复自身体力" → heal_block turns ──
  { id: "e45-19", re: new RegExp(`^(?:对手|对方|敌方)${NUM}回合内无法通过技能恢复(?:自身|自己)?体力$|^令(?:对手|对方|敌方)${NUM}回合内无法恢复(?:体力|HP)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "heal_block", target: "opponent", turns: num(m[1] ?? m[2]) }] }) },
  // ── "此技能先制+N"（对手选择攻击技能时此技能先制+N 的 rest 侧）──
  { id: "e45-20", re: new RegExp(`^(?:此|该|本)技能先制([+-])${NUM}$|^先制([+-])${NUM}$`), go: (m) => { const s = m[1] ?? m[3]; const n = num(m[2] ?? m[4]); return { flags: { priority: (s === "-" ? -1 : 1) * n } }; } },
  // ── "不会受到伤害" → dmg_immune 1回合 ──
  { id: "e45-21", re: /^不会受到(?:任何)?伤害$|^本回合不会受到伤害$/, go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1 }] }) },
  // ── "伤害不会低于N点" → dmg_out_floor ──
  { id: "e45-22", re: new RegExp(`^(?:造成的?|攻击)?伤害不会低于${NUM}点?$|^攻击伤害不会低于${NUM}点?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_out_floor", target: "self", params: { min: num(m[1] ?? m[2]) } }] }) },
  // ── "每次免疫成功吸取对手N点体力" → onImmuneDrain 挂 immune_status 宿主 ──
  { id: "e45-23", re: new RegExp(`^(?:每次)?免疫成功(?:则|时|后)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}点(?:体力|HP)$`), go: (m) => ({ attachAll: { onImmuneDrain: num(m[1]) } }) },
  // ── "使对手下回合受到其他技能的伤害翻倍" → dmg_taken_up excludeSelfMove ──
  { id: "e45-24", re: /^(?:使|令)(?:对手|对方|敌方)下回合受到(?:的)?其他技能(?:的)?伤害翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: 1, params: { pct: 100, excludeSelfMove: 1 } }] }) },
  // ── "附加自身的攻击值N%的百分比伤害" → flatSelfStatPct 单维 ──
  { id: "e45-25", re: new RegExp(`^附加(?:自身|自己)的?(攻击|特攻|防御|特防|速度)(?:值|力)?的?${NUM}%的(?:百分比|固定)?伤害$`), go: (m) => ({ attachDamage: { flatSelfStatPct: { stats: [STATS[m[1]]], pct: num(m[2]) } } }) },
  // ── "额外获得N点"（护罩追加幅值——"获得200点护罩，若双防总和高于对手则额外获得60点"）──
  { id: "e45-26", re: new RegExp(`^(?:额外)?获得${NUM}点$|^则额外获得${NUM}点$`), go: (m) => ({ attachAll: { shieldBonusFlat: num(m[1] ?? m[2]) } }) },
  // ── "每次免疫成功则在回合结束时附加N点真实伤害" → onImmuneDmg（timed-112 同款时点近似：立即结算） ──
  { id: "e45-27", re: new RegExp(`^(?:每次)?免疫成功则?(?:在)?回合结束时?附加${NUM}点真实伤害$|^(?:每次)?免疫成功则?(?:在)?回合结束时?附加${NUM}点(?:固定)?伤害$`), go: (m) => ({ attachAll: { onImmuneDmg: num(m[1] ?? m[2]) } }) },
  // ── "受到其他技能的伤害翻倍" 裸形（"使对手下回合…"前缀剥后余部；foeCtx 翻转 target） ──
  { id: "e45-28", re: /^受到(?:的)?其他技能(?:的)?伤害翻倍$/, go: () => ({ effects: [{ op: "apply_status", name: "dmg_taken_up", target: "self", params: { pct: 100, excludeSelfMove: 1 } }] }) },
  // ── "回合结束时附加N点真实/固定伤害" → dealt_tick flat 支（pct=0 定值通道；partCond=immunedThisTurn 时后处理改 perImmune） ──
  { id: "e45-29", re: new RegExp(`^(?:在)?回合结束时?附加${NUM}点真实伤害$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "dealt_tick", target: "self", turns: 1, params: { flat: num(m[1]), trueDmg: 1 } })] }) },
  { id: "e45-30", re: new RegExp(`^(?:在)?回合结束时?附加${NUM}点固定伤害$`), go: (m) => ({ effects: [liftTick({ op: "apply_status", name: "dealt_tick", target: "self", turns: 1, params: { flat: num(m[1]) } })] }) },
];
