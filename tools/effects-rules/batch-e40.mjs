// batch-e40：HP阈值威力族变体、承伤上限、次窗增伤、PP连击上限、初始/连用致命率、免疫回响、PP总和谓词、命名前缀、偶数伤害、固伤转真伤尾挂。
import { NUM, num, STAT_RE, STATS, AIL_RE, AILMENTS, frac } from "./lex.mjs";
import { parseEffectText, condOf } from "../effects-parse.mjs";

const stageFx = (stat, delta, target) => ({ op: "apply_stat_stage", stat, delta, target });
const ALL_STATS = ["atk", "def", "spa", "sdf", "spd", "acc"];
// 阈值文本 → { frac:{n,d} } | { abs:N }
const thresholdOf = (s) => {
  if (s === "一半") return { frac: frac(1, 2) };
  const sm = s.match(new RegExp(`^(${NUM})\\s*\\/\\s*(${NUM})$`)); // "1/2"——NUM 内层组：外组取 1/3
  if (sm) return { frac: frac(sm[1], sm[3]) };
  const fm = s.match(new RegExp(`^(${NUM})分之(${NUM})$`)); // "2分之1" = 1/2
  if (fm) return { frac: frac(fm[3], fm[1]) };
  const dm = s.match(new RegExp(`^(${NUM})$`));
  if (dm) return { abs: num(dm[1]) };
  return undefined;
};
const hpCond = (who, th) => {
  const foe = /对手|对方|敌方/.test(who);
  if (th.frac !== undefined) return foe ? { foeHpBelow: th.frac } : { selfHpBelow: th.frac };
  return foe ? { foeHpBelowAbs: th.abs } : { selfHpBelowAbs: th.abs };
};

export const rules = [
  // ── HP 阈值威力族变体（"一半"/"N分之1"/"时候/事/是"/"加N倍"/"威力N倍"/裸"身HP"） ──
  { id: "e40-01",
    re: new RegExp(`^(?:若|如果)?(自身|自己|身|对方|对手|敌方)(?:的)?(?:HP|hp|Hp|体力|血量|威力)(?:值)?(?:小于|低于|不足)(.+?)(?:是|事|时|候|的时|则|，|,|的)*(?:(?:造成的|造成)(?:攻击)?伤害|威力)(?:(?:为|是|提升|提高|增加|加|大于|等于)(${NUM})倍|(${NUM})倍|翻倍|加倍)$`),
    go: (m) => {
      const th = thresholdOf(m[2]);
      if (th === undefined) return null;
      const mul = m[3] !== undefined ? num(m[3]) : m[5] !== undefined ? num(m[5]) : 2;
      return { attachDamage: { mulIf: { when: hpCond(m[1], th), numerator: mul, denominator: 1 } } };
    } },
  // ── 承伤上限（"受伤害小于260"/"2回合受到伤害不超过260"/"受伤不超过250"→dmg_cap{cap}；turns 前缀走 TURNS_PRE） ──
  { id: "e40-02",
    re: new RegExp(`^(?:受到|遭受|受|受到攻击)?(?:的)?(?:攻击)?伤害(?:值)?(?:小于|低于|不足|不超过|不多于|不大于)${NUM}(?:点)?$|^(?:自身|自己)?受伤(?:害)?不(?:超过|大于|多于|高于)${NUM}(?:点)?$|^受伤(?:小于|低于|不足)${NUM}(?:点)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: num(m[1] ?? m[2] ?? m[3]) } }] }) },
  // ── 次窗增伤（"令自身下N次攻击造成的伤害翻倍/提升M%"→dmg_boost{count,pct}） ──
  { id: "e40-03",
    re: new RegExp(`^(?:使|令)(?:自身|自己)下(${NUM})次(?:攻击|攻击技能)(?:造成的|造成)?(?:的)?伤害(?:翻倍|加倍|为2倍)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: num(m[1]), pct: 100 } }] }) },
  { id: "e40-03b",
    re: new RegExp(`^(?:使|令)(?:自身|自己)下(${NUM})次(?:攻击|攻击技能)(?:造成的|造成)?(?:的)?伤害(?:提升|提高|增加)(${NUM})%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { count: num(m[1]), pct: num(m[3]) } }] }) },
  // ── PP 低值连击上限（"当前技能PP值小于N时连击上限为M"→hits.capIfPpBelow——cap 替代 max 参与抽取，可上抬） ──
  { id: "e40-04",
    re: new RegExp(`^(?:当前|本)?(?:技能|招式)?的?PP值?(?:小于|低于|不足)(${NUM})时?(?:连击|攻击次数)(?:的)?上限为?(${NUM})(?:次)?$|^连击次数上限为?(${NUM})$`),
    go: (m) => (m[5] !== undefined ? { attachDamage: { hits: { min: 1, max: 1, cap: num(m[5]) } } } : { attachDamage: { hits: { capIfPpBelow: { pp: num(m[1]), cap: num(m[3]) } } } }) },
  // ── 初始/连用致命率（"初始致命一击率为20%，每次使用提高20%，最高100%"→critInitPct+critPerUsePct+cap） ──
  { id: "e40-05",
    re: new RegExp(`^初始致命(?:一击)?率(?:为|是)?${NUM}%[，,]?每次(?:使用|攻击)(?:则|时)?(?:致命(?:一击)?率|致命一击几率|致命几率)?(?:提高|提升|增加)${NUM}%[，,]?最高(?:为|达到|至|提高到|提升到|提高|提升)?${NUM}%$`),
    go: (m) => ({ attachDamage: { critInitPct: num(m[1]), critPerUsePct: num(m[2]), critPerUseCap: num(m[3]) } }) },
  { id: "e40-05b",
    re: new RegExp(`^初始致命(?:一击)?率(?:为|是)?${NUM}%$`),
    go: (m) => ({ attachDamage: { critInitPct: num(m[1]) } }) },
  // "每次使用则当回合造成的攻击伤害额外提升N%，最高额外提升M%" → dmgPerUsePct+cap（逗号合并后整句入）
  { id: "e40-05c",
    re: new RegExp(`^每次(?:使用|攻击)(?:则|时|后)?(?:当回合)?(?:造成的|造成)?(?:攻击)?伤害(?:额外)?(?:提升|提高|增加)${NUM}%[，,]?最高(?:额外)?(?:提升|提高|增加|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachDamage: { dmgPerUsePct: num(m[1]), dmgPerUsePctCap: num(m[2]) } }) },
  // "每次增加20，最高165"（省「使用」）。放在 e40-05d 前面，那条要求「每次使用」。
  { id: "e40-05f",
    re: new RegExp(`^每次(?:则|时)?(?:技能)?(?:威力)?(?:提升|提高|增加|加)\\+?(${NUM})(?:点)?[，,]?最高(?:提升|提高|增加|为|至|到)?(${NUM})(?:点|威力)?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[3]) } }) },
  // "每次使用威力提升N%，最高M" → powerPerUse+useCap
  { id: "p2-per-01",
    re: /^每次使用(?:提升|提高|增加)(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))%威力[，,]?最高(?:提升|提高|增加|为|至|到)?(([0-9]+|一|二|两|三|四|五|六|七|八|九|十))%$/,
    go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1]), denominator: 100 } }, attachAll: { capTail: { value: num(m[3]), unit: "%", src: m[0] } } }),
  },
  { id: "e40-05d",
    re: new RegExp(`^每次使用(?:则|时)?(?:技能)?(?:威力)?(?:提升|提高|增加|加)\\+?(${NUM})(?:点)?[，,]?最高(?:提升|提高|增加|为|至|到)?(${NUM})(?:点|威力)?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[3]) } }) },
  // "每次使用提高N%，最高M%" 无名叠用（无名词语境按威力百分比解释——与 deferred-03 同义加 cap）
  { id: "e40-05e",
    re: new RegExp(`^每次使用(?:技能)?(?:则|时|后)?(?:额外)?(?:提升|提高|增加)${NUM}%[，,]?最高(?:额外)?(?:提升|提高|增加|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1]), denominator: 100 } }, attachAll: { capTail: { value: num(m[2]), unit: "%", src: m[0] } } }) },
  // ── 免疫+反伤回响（"免疫对手下N次攻击技能造成的伤害，并附加给对手此攻击伤害M%的固定伤害"→dmg_immune{count,echoFlatPct}） ──
  { id: "e40-06",
    re: new RegExp(`^免疫(?:对手|对方|敌方)下(${NUM})次(?:攻击|攻击技能)(?:造成的|造成)?(?:的)?伤害[，,]?并?附加给(?:对手|对方|敌方)此攻击伤害(${NUM})%的(?:固定|百分比)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1]), echoFlatPct: num(m[3]) } }] }) },
  { id: "e40-06b",
    re: new RegExp(`^免疫(?:对手|对方|敌方)下(${NUM})次(?:攻击|攻击技能)(?:造成的|造成)?(?:的)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: num(m[1]) } }] }) },
  // "附加给对手此攻击伤害N%的固定伤害" 孤儿尾 → attachAll 回挂最近 dmg_immune
  { id: "e40-06c",
    re: new RegExp(`^附加给(?:对手|对方|敌方)此攻击伤害(${NUM})%的(?:固定|百分比)?伤害$|^将?此(?:攻击)?伤害的(${NUM})%(?:以固定伤害)?(?:反弹|反馈|返还)给(?:对手|对方|敌方)$`),
    go: (m) => ({ attachAll: { immuneEchoFlatPct: num(m[1] ?? m[3]) } }) },
  // ── 命名前缀（"无为：…"/"星皇之怒：…"/"（名字：效果）"——名号非语义，剥壳后整句重解析） ──
  { id: "e40-07",
    re: /^[（(]?([一-龥]{1,10})[：:](.+?)[)）]?$/,
    go: (m, raw) => {
      const name = m[1];
      if (/^(?:若|如果|当|使|令|先制|必中|效果|威力|命中|受到|遭受|造成|每次|每回合|下|本回合|当回合|自身|自己|对手|对方|敌方|附加|恢复|消耗|解除|消除|免疫|反弹|吸取|攻击|伤害|回合)/.test(name)) return null;
      const sub = parseEffectText(m[2]);
      if (sub.effects.length === 0 && Object.keys(sub.flags ?? {}).length === 0) return { unparsedReason: `named-prefixed payload unparsed: ${m[2]}` };
      return { effects: sub.effects, flags: sub.flags, ...(sub.unparsed.length > 0 ? { unparsed: sub.unparsed } : {}) };
    } },
  // ── "每次用自身STAT±N"（"若对手体力大于300，则每次用自身攻击+1"——用=使用变体） ──
  { id: "e40-08",
    re: new RegExp(`^每次用(?:使)?(?:自身|自己)?(${STAT_RE}|全属性|所有属性)([+\\-＋－]?)${NUM}(?:个)?(?:等级)?$`),
    go: (m) => { const d = (m[2] === "-" || m[2] === "－" ? -1 : 1) * num(m[3]); const list = /全属性|所有属性/.test(m[1]) ? ALL_STATS : [STATS[m[1]]]; return { effects: list.map((s) => stageFx(s, d, "self")) }; } },
  // ── "转变为真实伤害" 孤儿尾 → dmg_flat 宿主 kii 标记 / attachDamage kindIfImmune 兜底 ──
  { id: "e40-09",
    re: /^则?(?:转变|转换|变为|转成)为?(?:全部)?真实伤害$/,
    go: () => ({ attachAll: { dmgFlatKii: true } }) },
  // ── 偶数伤害窗（"下N次攻击技能必定打出偶数攻击伤害"→even_dmg{count}） ──
  { id: "e40-10",
    re: new RegExp(`^(?:使|令)?(?:自身|自己)?下(${NUM})次(?:攻击|攻击技能)(?:必定|必然)?打出偶数(?:攻击)?伤害$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "even_dmg", target: "self", params: { count: num(m[1]) } }] }) },
  // ── 连击威力不衰减（"…触发连击效果时威力不再下降"→hitsNoDecay 标记——当前无衰减机制，记语义） ──
  { id: "e40-11",
    re: new RegExp(`^(?:触发致命一击后)?(?:使|令)?(?:自身|自己)?下${NUM}?次?(?:攻击|攻击技能)?(?:触发|打出)连击(?:效果)?时威力不再(?:下降|降低|衰减)$|^连击(?:时)?威力不再(?:下降|降低|衰减)$`),
    go: () => ({ attachDamage: { hitsNoDecay: true } }) },
  // ── 叠用+上限合并形（逗号已把"最高/最多"尾句接回宿主——cap 系字段全部既有） ──
  // "每次使用额外附加N点，最高M点" → flatPerUse+flatPerUseCap
  { id: "e40-14",
    re: new RegExp(`^每次使用(?:额外)?附加${NUM}点(?:的)?(?:固定)?(?:伤害)?[，,]?最高(?:附加|额外附加|为|至|到)?${NUM}点(?:的)?(?:固定)?(?:伤害)?$|^每次使用增加${NUM}点(?:的)?(?:固定)?(?:伤害)?[，,]?最高(?:附加|额外附加|增加|为|至|到)?${NUM}点(?:的)?(?:固定)?(?:伤害)?$|^连续使用每次增加${NUM}点?(?:固伤|固定伤害)[，,]?最高(?:附加|增加|为|至|到)?${NUM}点?(?:固伤|固定伤害)$|^连续使用每次增加${NUM}点(?:固定)?(?:伤害)?[，,]?最高(?:附加|增加|为|至|到)?${NUM}点(?:的)?(?:固定)?(?:伤害)?$|^连续使用每次增加${NUM}点固定伤害[，,]?最高附加${NUM}点固定伤害$|^连续使用每次增加${NUM}[，,]?最高附加${NUM}$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { flatPerUse: ns[0], flatPerUseCap: ns[1] } }; } },
  // "每次使用威力增加25%，最高威力增加100%"（上限句带「威力」重词形）。放在 e40-15 前面，那条上限段只收裸「最高…%」。
  { id: "e40-15a",
    re: new RegExp(`^(?:连续使用每次|连续攻击每次|每次使用|连续使用|每次)(?:威力|技能威力)(?:额外)?(?:增加|提升|提高|加)${NUM}%[，,]?最高威力(?:增加|提升|提高|为|至|到|额外提升)?${NUM}%$`),
    go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1]), denominator: 100 } }, attachAll: { capTail: { value: num(m[2]), unit: "%", src: m[0] } } }) },
  // "连续使用每次增加N%，最高M%"/"每次使用威力增加N%，最高增加M%"/"每次增加N%，最高M%" → powerMulPerUse；cap 走 capTail 通道（分数固伤基值折算 40%→200%）
  { id: "e40-15",
    re: new RegExp(`^(?:连续使用每次|连续攻击每次|每次使用|连续使用|每次)(?:威力|技能威力|攻击)?(?:额外)?(?:增加|提升|提高|加)${NUM}%[，,]?最高(?:增加|提升|提高|为|至|到|额外提升)?${NUM}%$`),
    go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1]), denominator: 100 } }, attachAll: { capTail: { value: num(m[2]), unit: "%", src: m[0] } } }) },
  // "每次使用概率/几率增加N%，最高概率M%" → chancePerUse+chancePerUseCap
  { id: "e40-16",
    re: new RegExp(`^每次使用(?:额外|技能)?(?:的)?(?:概率|几率|触发率|命中率)(?:增加|提升|提高)${NUM}%[，,]?最高(?:概率|几率|为|至|到)?${NUM}%$|^每次(?:使用|攻击)(?:额外)?提升${NUM}%[，,]?最高(?:概率|几率)${NUM}%$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachAll: { chancePerUse: ns[0], chancePerUseCap: ns[1] } }; } },
  // "每次攻击提升N%的致命几率，最高提升M%" → critPerUsePct+cap
  { id: "e40-17",
    re: new RegExp(`^每次(?:攻击|使用)(?:提升|提高|增加)${NUM}%的?致命(?:一击)?(?:几率|概率|率)?[，,]?最高(?:提升|提高|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachDamage: { critPerUsePct: num(m[1]), critPerUseCap: num(m[2]) } }) },
  // "每次命中对手会降低对手下只出战精灵最大体力N%，最多降低M%" → foeNextMaxHpAcc{pct,cap}
  { id: "e40-18",
    re: new RegExp(`^每次(?:攻击)?命中(?:对手|对方|敌方)?(?:后|时|还|都|亦|会)*(?:使|令|降低)?(?:对手|对方|敌方)下(?:一|${NUM})?只(?:出场|出战)?(?:的)?精灵(?:的)?最[大高](?:体力|HP)(?:值)?(?:的)?${NUM}%[，,]?最[多高](?:降低|为|至|到)?${NUM}%$`),
    go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return { attachDamage: { foeNextMaxHpAcc: { pct: ns[ns.length - 2], cap: ns[ns.length - 1] } } }; } },
  // "自身每有1回合异常状态造成伤害提升N%，最高M%" → dmgPctPerSelfAilTurn{pct,cap}
  { id: "e40-19",
    re: new RegExp(`^(?:自身|自己)每有?(?:一|1)回合异常状态?(?:则|时)?造成(?:的)?伤害(?:提升|增加|提高)${NUM}%[，,]?最高(?:提升|提高|增加|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachDamage: { dmgPctPerSelfAilTurn: { pct: num(m[1]), cap: num(m[2]) } } }) },
  // "每次使用该技能击败对手则恢复自身全部体力" → heal full + foeFainted 门控
  { id: "e40-20",
    re: /^每次使用(?:该|此|本)?技能?击败对手则恢复自身(?:全部|所有)体力$/,
    go: () => ({ effects: [{ op: "heal", target: "self", numerator: 1, denominator: 1, if: { foeFainted: true } }] }) },
  // ── 条件零耗（"若自身体力小于1/2每次攻击不消耗PP"→move.ppFreeIf） ──
  { id: "e40-13",
    re: new RegExp(`^(?:若|如果)?(?:自身|自己)(?:的)?(?:HP|hp|Hp|体力|血量)(?:值)?(?:小于|低于|不足)(${NUM}\\s*\\/\\s*${NUM}|${NUM}分之${NUM}|一半)(?:是|事|时|候|的时|则|，|,)?(?:每次攻击|攻击|每次|使用技能|技能)?(?:都)?不(?:再)?消耗PP(?:值)?$`),
    go: (m) => { const th = thresholdOf(m[1].replace(/\s/g, "")); return th?.frac !== undefined ? { flags: { ppFreeIf: { selfHpBelow: th.frac } } } : { flags: { ppFreeIf: { selfHpBelowAbs: th?.abs ?? 1 } } }; } },
  // ── "消耗此技能全部PP值以X"（无为系：自耗全PP换载荷——prevApplied 门控） ──
  { id: "e40-12",
    re: /^消耗(?:此|该|本)技能(?:的)?全部PP值以(.+)$/,
    go: (m) => {
      const sub = parseEffectText(m[1]);
      if (sub.effects.length === 0) return { unparsedReason: `pp-burn payload unparsed: ${m[1]}` };
      return { effects: [{ op: "pp_delta", target: "self", zero: true, scope: "current" }, ...sub.effects.map((e) => ({ ...e, if: { prevApplied: true } }))] };
    } },
];
