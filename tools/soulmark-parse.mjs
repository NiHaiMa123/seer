/**
 * tools/soulmark-parse.mjs —— 魂印文本解析器 + 覆盖率报告（S2）。
 *
 * 管线：soulMark.text → 清理（HTML 实体/名前缀/编号项/FAQ 垃圾）→ "；"切子句
 *   → 文本级/子句级 boss 门控剥离 → 触发前缀 → hook → 余文交 parseEffectText
 *   → {hook,victim?,actor?,cat?,chance?,bossGate?,ops} 条目（ops 复用技能效果注册表，
 *     schema soulHook 形状）。无法落定的子句进 unparsed（显式 reason，不臆造）。
 *
 * 运行：node tools/soulmark-parse.mjs [creatures.json 路径] [输出目录]
 * 产物：_soulmark-coverage.json（覆盖率+unparsed 频次）、_soulmark-parsed.json（逐精灵条目）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEffectText, condOf, reactWrap, liftDrainRiders, isHitRider, isNoiseFragment, OF_RIDER_FIELDS, ON_HIT_RIDER_FIELDS, DRAIN_RIDER_KEYS } from "./effects-parse.mjs";
import { AILMENTS } from "./effects-rules/lex.mjs";

const PREV_APPLIED_RESULT_OPS = new Set([
  "damage", "heal", "cleanse", "clear_stages", "invert_stages", "apply_stat_stage", "pp_delta", "apply_mark",
]);
const PREV_APPLIED_STATUS_RESULTS = new Set(["shield", "ward", "heal_block", "no_switch"]);
/** Positive classification of direct outcomes; a chance field does not turn an installed window into an event result. */
const isPrevAppliedResultOp = (op) => {
  if (op === null || typeof op !== "object") return false;
  if (op.op === "apply_status") return Object.values(AILMENTS).includes(op.name) || PREV_APPLIED_STATUS_RESULTS.has(op.name);
  return PREV_APPLIED_RESULT_OPS.has(op.op);
};

const MAX_HP_ABSORB_RE = /吸取(?:对手|对方|敌方)(?:的)?最大(?:体力|HP)/;
const maxHpAbsorbHpDelta = (ops, sourceText, hasGrowingAmount = false) => {
  if (!MAX_HP_ABSORB_RE.test(sourceText)) return { found: false, ops };
  const damageIndexes = [];
  const healIndexes = [];
  const formulaIndexes = [];
  const growIndexes = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op?.op === "damage" && op.kind === "percent") damageIndexes.push(i);
    else if (op?.op === "heal" && (op.target ?? "self") === "self") healIndexes.push(i);
    else if (op?.op === "formula" && op.of === "frac") formulaIndexes.push(i);
    else if (op?.op === "grow") growIndexes.push(i);
  }
  const removed = new Set([...damageIndexes, ...healIndexes, ...formulaIndexes]);
  const invalidRemoved = new Set([...removed, ...growIndexes]);
  const invalidOps = ops.filter((_, i) => !invalidRemoved.has(i));
  // The new paired hp_delta mapping is only needed when the amount grows along
  // with the max-HP drain. Keep older standalone drain/factor paths unchanged.
  if (growIndexes.length === 0 && !hasGrowingAmount) return { found: false, ops };
  if (damageIndexes.length !== 1 || healIndexes.length !== 1 || formulaIndexes.length > 1) {
    return { found: true, converted: false, ops: invalidOps };
  }

  const damageIndex = damageIndexes[0];
  const healIndex = healIndexes[0];
  const damage = ops[damageIndex];
  const heal = ops[healIndex];
  const formulaIndex = formulaIndexes[0];
  const formula = formulaIndex === undefined ? undefined : ops[formulaIndex];
  const ratio = (n, d) => Number.isInteger(n) && Number.isInteger(d) && n > 0 && d > 0 ? { numerator: n, denominator: d } : undefined;
  const damageFrac = formula !== undefined
    ? formula.value
    : damage.frac !== undefined
      ? damage.frac
      : ratio(damage.power, 100);
  const healFrac = ratio(heal.numerator, heal.denominator);
  const compatibleFrac = damageFrac !== undefined
    && Number.isInteger(damageFrac.numerator) && Number.isInteger(damageFrac.denominator)
    && damageFrac.numerator > 0 && damageFrac.denominator > 0
    && (damageFrac.of === undefined || damageFrac.of === "max")
    && healFrac !== undefined
    && damageFrac.numerator * healFrac.denominator === healFrac.numerator * damageFrac.denominator;
  const sameGate = JSON.stringify(damage.if ?? null) === JSON.stringify(heal.if ?? null)
    && damage.chance === heal.chance
    && (formula === undefined || JSON.stringify(formula.if ?? null) === JSON.stringify(damage.if ?? null));
  const formulaFollowsDamage = formulaIndex === undefined || (damageIndex < formulaIndex && formulaIndex < healIndex);
  const maxHpBased = (damage.percentBase === undefined || damage.percentBase === "max")
    && (damage.frac?.of === undefined || damage.frac.of === "max");
  if (!compatibleFrac || !sameGate || !formulaFollowsDamage || !maxHpBased || damage.target === "self") {
    return { found: true, converted: false, ops: invalidOps };
  }

  const hpDelta = {
    op: "hp_delta",
    target: "opponent",
    frac: { numerator: damageFrac.numerator, denominator: damageFrac.denominator, of: "max" },
    kind: "percent",
    cause: "soulmark:absorb",
    healSelf: { numerator: 1, denominator: 1, of: "dealt" },
    ...(damage.chance !== undefined ? { chance: damage.chance } : {}),
    ...(damage.if !== undefined ? { if: damage.if } : {}),
  };
  const convertedOps = [];
  for (let i = 0; i < ops.length; i++) {
    if (i === damageIndex) convertedOps.push(hpDelta);
    else if (!removed.has(i)) convertedOps.push(ops[i]);
  }
  return { found: true, converted: true, ops: convertedOps };
};

/** 已收成 rider 的旧键在宿主后面。按键读写，避免把旧键写回 damage。 */
const readHit = (ops, key) => {
  if (!Array.isArray(ops)) return undefined;
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o == null || typeof o !== "object") continue;
    if (o.of === key) return o.value;
    if (o.op === "damage" && o[key] !== undefined) return o[key];
    if (isHitRider(o.op) && o.of === undefined && o[key] !== undefined) return o[key];
  }
  return undefined;
};
const writeHit = (ops, key, value) => {
  if (!Array.isArray(ops)) return false;
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o == null || typeof o !== "object") continue;
    if (o.of === key) { o.value = value; return true; }
    if (o.op === "damage" && o[key] !== undefined) { o[key] = value; return true; }
    if (isHitRider(o.op) && o.of === undefined && o[key] !== undefined) { o[key] = value; return true; }
  }
  if (DRAIN_RIDER_KEYS.includes(key)) {
    for (let i = ops.length - 1; i >= 0; i--) if (ops[i]?.op === "applyDrainRider") { ops[i][key] = value; return true; }
  }
  const ofOp = Object.entries(OF_RIDER_FIELDS).find(([, keys]) => keys.includes(key))?.[0];
  const onOp = Object.entries(ON_HIT_RIDER_FIELDS).find(([, keys]) => keys.includes(key))?.[0];
  let host = -1;
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i]?.op === "damage") { host = i; break; }
  if (host < 0) return false;
  let end = host + 1;
  while (end < ops.length && isHitRider(ops[end]?.op)) end++;
  const op = ofOp ?? onOp;
  if (op === undefined) { ops[host][key] = value; return true; }
  ops.splice(end, 0, ofOp !== undefined ? { op, of: key, value } : { op, [key]: value });
  return true;
};
const dropBagKey = (flags, key) => {
  const ad = flags?.attachDamage;
  if (ad === undefined || ad === null || typeof ad !== "object" || ad[key] === undefined) return;
  delete ad[key];
  if (Object.keys(ad).length === 0) delete flags.attachDamage;
};

// 魂印守卫本地扩展：裸"命中"系（"若命中则"/"命中时"）→ 上次攻击落地记账谓词。
// 技能侧不启此谓词——技能效果本就在命中后结算，守卫是冗余；魂印钩子独立于命中结算，谓词有实义。
const smCondOf = (p) => {
  const n = p.replace(/^若/, "").replace(/[时后]$/, "");
  if (/^(?:攻击|技能|招式)?命中(?:对手|目标)?$/.test(n)) return { selfHitStreakAtLeast: 1 };
  if (/^(?:攻击|技能|招式)?未命中(?:对手|目标)?$/.test(n)) return { not: { selfHitStreakAtLeast: 1 } };
  return condOf(p);
};

/**
 * 魂印语境里「必定命中」的类别限定（cat 编码与全引擎一致：1=属性/2=物理/3=特殊，
 * 4=任意攻击招=物理+特殊）。
 * 原文写「攻击技能 / 所有攻击」时说的是**攻击招式**必定命中，不含属性技能；
 * 裸「必中」「所有技能必定命中」不带类别限定 → 全类别（must_hit，缺省 cat）。
 * 技能侧不走这里：技能里的「自身攻击技能必定命中」指的是这一招自己必中（accuracy 旗标），
 * 那是另一层语义，所以判定放在魂印解析层而不是规则表。
 */
const soulMustHitCat = (text) => (/(?:攻击技能|所有攻击|全部攻击)/.test(String(text ?? "")) ? 4 : undefined);

// 段级冗余主语剥除的递归护栏：「未剥」探针要跨 parseSoulmarkText 调用共享（r0 探针内不得再剥）
let r3cRedOff = false;
const SRC = "content/creatures/creatures.json";
const OUT_DIR = "content/claims";

/* ---------- 文本级清理 ---------- */

// 常见 HTML 实体（图鉴页抓取残留）。
const ENTITY_RE = /&(middot|rdquo|ldquo|quot|amp|nbsp|hellip);/g;
const ENTITY_MAP = { middot: "·", rdquo: "”", ldquo: "“", quot: '"', amp: "&", nbsp: " ", hellip: "…" };
const cleanEntities = (s) => s.replace(ENTITY_RE, (_, e) => ENTITY_MAP[e] ?? " ").replace(/&g[te];|&l[te];|&le;/g, (m) => (m === "&lt;" ? "小于" : m === "&gt;" ? "大于" : m === "&le;" ? "小于等于" : "大于等于"));

/** 「双方X值之差」→ UnitState.base 的维度键。 */
const STAT_DIFF_DIM = { "防御值": "def", "特防值": "sdf", "体力上限值": "hp", "体力上限": "hp", "速度值": "spd", "攻击值": "atk", "特攻值": "spa" };

/**
 * 「回合开始时自身根据双方X值之差n触发以下效果：①…②…③若n≥200则…」→ 直接产出条目。
 *
 * 4 只魂印（决囚钢骨/堕魂之手/覆骸冥土/拟态绞索）共用这一个骨架，n 是同一读数。
 * 不使用局部变量作用域；普通效果读取 statDiff 幅值，回合开始快照效果由 amountTiming:"apply" 冻结：
 *   n              → |自身该维 - 对手该维|
 *   ①/②/③ 的效果措辞各不相同，逐个映射到已有 op 的对应字段。
 * 映射不上的分档返回 null（调用方保留原文，交给常规留档，不静默丢失）。
 *
 * 返回 { entries, consumed } 或 null（不是这个骨架）。
 */
function statDiffEntries(src, bossGate) {
  const localBossTail = src.match(/[（(][^（）()]*?[BbＢ][OoＯ][SsＳ][SsＳ]?(?:无效|中无效|免疫)[^（）()]*?[）)]\s*$/);
  const source = localBossTail === null ? src : src.slice(0, localBossTail.index).trimEnd();
  const entryBossGate = bossGate || localBossTail !== null;
  const head = source.match(/^(?:掌[：:])?\s*回合开始时自身根据双方([^\s，,]{1,6}?)之差\s*[nN]\s*触发(?:如下|以下)?效果[:：]/);
  if (head === null) return null;
  const stat = STAT_DIFF_DIM[head[1]];
  if (stat === undefined) return null;
  const body = source.slice(head[0].length);
  // 分档切分：①②③ 或 1. 2. 3.（语料里常见「①.」和「1、」两种混排）
  const parts = body
    .split(/[①②③④⑤]|(?:^|\s)[1-5][.．、]\s*|[；;]/)
    .map((x) => x.replace(/^[\s.．、]+|[\s.]+$/g, "").trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const ops = [];
  const residuals = [];
  const snapshotSensitive = (clause) => /^当回合(?:使用技能时附加\s*[nN]\s*点固定伤害|被击败时对手无法主动切换精灵\s*[nN]\s*\/\s*\d+\s*回合)$/.test(clause);
  /** 每个分档 → 零个或多个 op；null = 该档映射不了。 */
  const translate = (clause) => {
    // "若n≥T则X" → X 带 nAbove 条件
    const cond = clause.match(/^若\s*[nN]\s*(>=|≥|>)\s*(\d+)\s*则(.+)$/);
    if (cond !== null) {
      // Stat differences are integers: n>k is exactly n≥k+1.
      const thr = Number(cond[2]) + (cond[1] === ">" ? 1 : 0);
      const inner = translate(cond[3].trim());
      if (inner === null) return null;
      return inner.map((o) => ({ ...o, if: { statDiffAbove: { stat, atLeast: thr } } }));
    }
    // ② 恢复 n 点体力
    if (/^恢复\s*[nN]\s*点体力$/.test(clause)) return [{ op: "heal", target: "self", statDiff: stat }];
    // ① 受到的伤害减少 n 点；明确写攻击才限制到标准攻击伤害，未写类别不缩窄原文范围。
    const red = clause.match(/^当回合受到的(攻击)?伤害减少\s*[nN]\s*点$/);
    if (red !== null) return [{ op: "apply_status", name: "dmg_reduce", target: "self", turns: 1, statDiff: stat, amountTiming: "apply", ...(red[1] !== undefined ? { params: { kindMask: 4 } } : {}) }];
    // ① 附加 n 点固定伤害 → foe_dot
    const dot = clause.match(/^当回合使用技能时附加\s*[nN]\s*点固定伤害$/);
    if (dot !== null) return null; // 每次出招重算与触发时冻结不等价。
    // ① 造成的伤害提升 n%；明确写攻击才限制到标准攻击伤害，未写类别保留原文范围。
    const boost = clause.match(/^当回合造成的(攻击)?伤害提升\s*[nN]\s*%$/);
    if (boost !== null) return [{ op: "apply_status", name: "dmg_boost", target: "self", turns: 1, statDiff: stat, amountTiming: "apply", ...(boost[1] !== undefined ? { params: { kindMask: 4 } } : {}) }];
    // ③ 免疫受到的异常状态
    if (/^当回合免疫受到的异常状态$/.test(clause)) return [{ op: "apply_status", name: "immune_status", target: "self", turns: 1 }];
    // ③ 攻击必定打出致命一击
    if (/^当回合攻击必定(?:打出)?致命一击$/.test(clause)) return [{ op: "apply_status", name: "crit_always", target: "self", turns: 1 }];
    // ③ 所有技能先制+1
    const prio = clause.match(/^当回合所有技能先制([+-])\s*(\d+)$/);
    if (prio !== null) return [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: (prio[1] === "-" ? -1 : 1) * Number(prio[2]) } }];
    // ③ 受到的非真实伤害减少 30%
    const nr = clause.match(/^当回合受到的非真实伤害减少\s*(\d+)\s*%$/);
    if (nr !== null) return [{ op: "apply_status", name: "dmg_taken_down", target: "self", turns: 1, params: { pct: Number(nr[1]), kindMask: 7 } }];
    // ① 当回合被击败时对手无法主动切换精灵（时长由 n/200 决定，无对应动态持续时长字段）
    const lock = clause.match(/^当回合被击败时对手无法主动切换精灵\s*[nN]\s*\/\s*(\d+)\s*回合$/);
    if (lock !== null) return null; // 持续时长也必须按回合开始时 n 冻结。
    return null;
  };

  for (const p of parts) {
    const t = translate(p);
    if (t === null) {
      residuals.push({ clause: p, reason: snapshotSensitive(p)
        ? "statDiff timing — per-use trigger or dynamic-duration hook unavailable (deferred)"
        : "statDiff clause — effect shape unmodeled (deferred)" });
      continue;
    }
    ops.push(...t);
  }
  return {
    entries: ops.length > 0 ? [{ hook: "onTurnStart", ...(entryBossGate ? { bossGate: true } : {}), ops }] : [],
    unparsed: residuals,
    consumed: src.length,
  };
}

// 文本级 boss 门控（"以上效果boss无效"覆盖整条魂印；位置任意）。
const TEXT_BOSS_RE = /以上(?:效果|特效)(?:对)?[BbＢ][OoＯ][SsＳ][SsＳ]?(?:无效|中无效)[！!]?|所有(?:效果|特效|技能效果|特性效果)(?:对)?[BbＢ][OoＯ][SsＳ][SsＳ]?(?:无效|中无效)/;
// 子句级 boss 门控（"（boss无效）"/"（下场后重置，BOSS无效）"/"（除…外的所有效果boss无效）"前/后置）。
const CLAUSE_BOSS_RE = /[（(][^（）()]*?[BbＢ][OoＯ][SsＳ][SsＳ]?(?:无效|中无效|免疫)[^（）()]*?[）)]/;
const BOSS_SCOPE_TRIGGER_RE = /(?:战斗开始|战斗结束|(?:当)?(?<!上)回合开始|(?:当)?(?<!上)回合结束|自身登场|登场|出场|受到致命伤害|受到(?:攻击|技能|伤害)|自身使用(?:攻击|属性|物理|特殊)?技能)(?:时|后)/g;
// 结果分支标记尾（"…未触发则"）——boss 注记作用域切分的锚点之一。
const OUTCOME_BRANCH_TAIL = /(?:免疫成功|触发成功|施加成功|反转成功|未触发|未命中|未击败|没有触发|均未触发|皆未触发|免疫失败|触发失败|反转失败)(?:则|，|,)*$/;
function splitLocalBossScopes(raw) {
  const invalidatedSkill = raw.match(/(?:若|当)?(?:(?:己方|我方|对手|对方|敌方|自身|自己)[^，,；;。]{0,8})?技能(?:效果)?无效时/);
  const nextEntry = raw.match(/(?:自身|自己)?下回合(?:登场|出场)时/);
  if (invalidatedSkill !== null && nextEntry !== null && invalidatedSkill.index < nextEntry.index) {
    return [
      ...splitLocalBossScopes(raw.slice(0, invalidatedSkill.index)),
      { text: raw.slice(invalidatedSkill.index), localBossGate: false, crossEventDefer: true },
    ];
  }
  const shieldEquality = raw.match(/若(?:对手|对方|敌方)(?:的)?(?:护盾|护罩)(?:[、和与及])?(?:护盾|护罩)?(?:数量|数值|量)?相等/);
  if (shieldEquality !== null && /(?:额外)?(?:消除|清除).{0,12}(?:护盾|护罩)/.test(raw.slice(shieldEquality.index))) {
    return [
      ...splitLocalBossScopes(raw.slice(0, shieldEquality.index)),
      { text: raw.slice(shieldEquality.index), localBossGate: false, shieldEqualityDefer: true },
    ];
  }
  const note = CLAUSE_BOSS_RE.exec(raw);
  if (note === null) return [{ text: raw, localBossGate: false }];
  const prefix = raw.slice(0, note.index);
  const suffix = raw.slice(note.index + note[0].length);
  let scopeStart = 0;
  const timingTriggers = [...prefix.matchAll(BOSS_SCOPE_TRIGGER_RE)];
  const eventStarts = [];
  for (let i = 0; i < timingTriggers.length; i++) {
    const trigger = timingTriggers[i];
    let start = trigger.index;
    const previous = i > 0 ? timingTriggers[i - 1] : undefined;
    const scanStart = previous === undefined ? 0 : previous.index + previous[0].length;
    const scopeText = prefix.slice(scanStart, trigger.index);
    const guards = [...scopeText.matchAll(/(?:若|当)/g)];
    const guard = guards.at(-1);
    if (guard !== undefined) {
      // 「若/当」守卫：只有当**切点落在它自己的子句内部**时才回退作用域起点——
      //   条件短语内部（"若自身体力低于**回合开始时**则…"）：切开会把条件短语劈开 → 必须回退；
      //   载荷段内部（"若P则每回合**结束时**X"）：切开会拆散条件与负载 → 必须回退；
      //   而切点若在**别的子句**（pet-4751："…若体力上限不大于100则消耗自身全部体力并令对手失明，
      //   且本场战斗中己方所有精灵**登场时**…"）：回退会把中间整段划出 boss 门的作用域，
      //   触发词与它的载荷分属两段 → 条件成 cond-orphan 孤儿、负载被无条件执行 → 不得回退。
      const guardIdx = scanStart + guard.index;
      // 该「若」的子句 = 条件短语 + 载荷段；切点落在子句内 → 切分会劈开条件与负载 → 必须回退；
      // 切点在其后的**别的子句** → 回退会把中间整段划出 boss 门的作用域（pet-4751）→ 不得回退。
      const ze = prefix.indexOf("则", guardIdx);
      const hasZe = ze >= 0 && ze < trigger.index;
      // 载荷段起点：有「则」在其后；无「则」时看触发词是否还在条件短语里
      let payloadStart;
      let triggerInPhrase = false;
      if (hasZe) payloadStart = ze + 1;
      else {
        const c0 = prefix.slice(guardIdx).search(/[，,]/);
        const firstComma = c0 >= 0 ? guardIdx + c0 : -1;
        if (firstComma < 0 || trigger.index < firstComma) { payloadStart = guardIdx; triggerInPhrase = true; }
        else payloadStart = firstComma + 1;
      }
      const cut = prefix.slice(payloadStart).search(/[，,、]/);
      const clauseEnd = cut >= 0 ? payloadStart + cut : prefix.length;
      // If a condition introduces this timing clause, retain its prefix with the event.
      if (triggerInPhrase || trigger.index < clauseEnd) {
        // 「当回合」的「当」是**时点词**（本回合），不是守卫：回退目标不能是它——
        //   那会把守卫短语（「…自身体力低于对手则」）切到前一段，负载失去守卫 → **无条件执行**
        //   （pet-3422 / pet-3446 蒂亚斯）。
        const isTurnTimeWord = scopeText.slice(guard.index + 1).startsWith("回合");
        if (!isTurnTimeWord) { start = guardIdx; }
        else {
          const beforeWord = scopeText.slice(0, guard.index);
          const beforeTrigger = prefix.slice(0, previous === undefined ? 0 : previous.index);
          // a) 「则」引出的载荷里（"…低于对手则当回合…"）：条件、载荷、触发词同属一个子句
          //    → 回退到**触发词起点**（整句保持在同一作用域，条件不丢）。
          // b) 「若」子句把触发词包在里面（"若回合开始时自身满体力则当回合…"）：该条件含快照时点、
          //    不可建模，负载必须跟着条件一起被扣下 → 维持原回退点（负载仍被扣，不无条件执行）。
          // c) 其余（"…令对手害怕，当回合未受到攻击则…"）→ 维持原回退点。
          const inZePayload = /则$/.test(beforeWord);
          const condOwnsTrigger = /若/.test(beforeTrigger);
          start = inZePayload && !condOwnsTrigger ? (previous === undefined ? 0 : previous.index) : guardIdx;
        }
      }
    }
    // 结果分支标记（"未触发则回合结束时X"）与"若/当"守卫同理：它是负载的前置作用域，
    // 切分不得把它甩在前一段——否则条件成孤儿（cond-orphan），负载被无条件执行。
    const outcomeTail = scopeText.match(OUTCOME_BRANCH_TAIL);
    if (outcomeTail !== null) {
      const oStart = scanStart + outcomeTail.index;
      if (guard === undefined || oStart < start) start = oStart;
    }
    // 切点前若以「条件 + 则」收尾（"…自身受到攻击伤害高于400则"），该条件与切点后的负载同属一句——
    // 切分不得把条件甩在前一段：条件成 cond-orphan 孤儿，负载被无条件执行（pet-3767 加梵迪）。
    const lastComma = Math.max(scopeText.lastIndexOf("，"), scopeText.lastIndexOf(","), scopeText.lastIndexOf("、"));
    if (lastComma >= 0) {
      const tail = scopeText.slice(lastComma + 1).trim();
      if (tail.length >= 3 && tail.length <= 26 && /则$/.test(tail)) {
        const cStart = scanStart + lastComma + 1;
        if (cStart < start) start = cStart;
      }
    } else if (guard === undefined) {
      // 条件在句首（scopeText 整段就是条件）：同样不得被切开
      const scopeTrimmed = scopeText.trim();
      if (scopeTrimmed.length >= 3 && scopeTrimmed.length <= 26 && /则$/.test(scopeTrimmed) && scanStart < start) start = scanStart;
    }
    // Coordinated effects ("X，同时Y") share one semantic scope; a trailing boss note
    // applies to the full linked group rather than just its final timing clause.
    const between = previous === undefined ? "" : prefix.slice(previous.index + previous[0].length, trigger.index);
    if (previous !== undefined && /(?:同时|并且|且)\s*$/.test(between)) start = eventStarts[i - 1];
    // 时点词落在**名词位置**（快照引用）时不是时序锚点："与回合开始时差值""战斗开始时所记录数值"
    //   —— 在那里切分会把尾注所属的子句劈成两半，注记随切分一起丢失：
    //   原文写了 boss无效，现网却让该效果照常生效（pet-4877 锢魂铁犀 / pet-4921 天堂极龙兽）。
    const afterTrigger = prefix[trigger.index + trigger[0].length] ?? "";
    const isSnapshotRef = /[的所差值之]/.test(afterTrigger);
    const opensScope = !isSnapshotRef;
    eventStarts.push(opensScope ? start : scopeStart);
    if (opensScope) scopeStart = start;
  }
  return [
    ...splitLocalBossScopes(prefix.slice(0, scopeStart)),
    ...(prefix.slice(scopeStart).trim() !== "" ? [{ text: prefix.slice(scopeStart), localBossGate: true }] : []),
    ...splitLocalBossScopes(suffix),
  ];
}
// boss 有效标注——等价未声明，剥掉即可。
const BOSS_OK_RE = /[（(][BbＢ][OoＯ][SsＳ][SsＳ]?(?:有效|中有效)[）)]/g;

// 名前缀："蜜：" "防:"（魂印代号 + 全/半角冒号——逐文本与逐子句均可能出现；
// 前缀词若含触发关键字则视为正文保留，如"回合开始：X"不剥）。
const NAME_PREFIX_RE = /^[一-龥A-Za-z·\s]{1,14}[：:]|^(?:buff|BUFF|效果)?(?:说明|作用如下|效果如下|机制)[：:]|^[Tt]\d{1,2}[：:]|^[一-龥]{1,2}，/;
const NAME_PREFIX_GUARD = /回合|攻击|受到|对手|自身|登场|击败|使用|战斗|体力|每/;
const NAMED_DOMAIN_LABEL_RE = /^(?:[^：:]{1,18}(?:图腾|场地效果说明|场地|庇护|状态说明|轮舞)[^：:]{0,8}|(?:触发|开启|启动)[^：:]{1,18}(?:轮舞|循环|状态机|印记)[^：:]{0,4})[：:]/;
const stripNamePrefix = (s) => {
  const m = s.match(NAME_PREFIX_RE);
  if (m === null || NAME_PREFIX_GUARD.test(m[0]) || NAMED_DOMAIN_LABEL_RE.test(s)) return s;
  return s.slice(m[0].length);
};
// 编号项前缀："1、" "2." "（1）" / 名缩写+编号："鲁 1."——4399 魂印常见编号分条。
const NUM_PREFIX_RE = /^(?:[0-9０-９]{1,2}[、.．]|[（(][0-9０-９]{1,2}[）)]|[①②③④⑤⑥⑦⑧⑨⑩]|第?[一二三四五六七八九十]+[条、.]|第[一二三四五六七八九十0-9]+柄[:：]?|[一-龥]{1,4}\s+[0-9０-９]{1,2}[、.])/;
// FAQ 块先截到「答：」；答案正文可能直接开始，也可能带「赛尔号X是：」或「X的魂印是印名：」引导。
const FAQ_ANSWER_RE = /答[：:]/;
const FAQ_ANSWER_LEAD_RE = /^(?:(?:赛尔号)?[^，,。；;]{0,30}?(?:的)?(?:魂印|专属特性|特性)(?:是|为|叫)(?:[一-龥]{1,2})?[：:]|(?:赛尔号)?[^，,。；;]{1,30}是[：:])\s*/;
// 尾巴噪声："X进化图种族值技能表>>>" / ">>>" 之后整段。
const TAIL_NOISE_RE = />>>.{0,30}|[一-龥]{1,8}(?:进化图|种族值|技能表|获得方法|培养方案).*$/;

// 无效果/脏文本整句判定。
const EMPTY_MARK_RE = /^该精灵(?:没有专属特性|暂无特性|没有特性|特性暂未开放)/;
const DIRTY_RE = /^(?:问|答)[：:]|图鉴|技能表|种族值|进化图|获得方法|新闻|攻略|精灵资料|\.com|http|是什么？|有什么效果|效果如何|^\d+$|^[一-龥]$|^赛尔号.{1,10}$|^.{1,10}(?:魂印|特性)是/i;

/** 触发存在但语义未支持的显式分桶（诚实归类，不进 hook×ops 模型）。全部 ^ 锚定。 */
const UNSUPPORTED_TRIGGERS = [
  { re: /^背包内(?!每存在|每存活(?:一|1)只?精灵)|^己方每有(?!一?只?精灵存活)|^己方场下(?!每有一只精灵存活)|^场下精灵|^背包中/, reason: "party-scope" },
  { re: /^使用第[一二三四五六七八九十\d]+技能/, reason: "slot-mark" },
  { re: /^(?:自身|自己)?主动切换时.{0,24}(?:选择并使用|使用自身的?第?[一二三四五六七八九十\d]+号位技能)/, reason: "switch-move window — selected-move/switch timing unmodeled (deferred)", quarantine: true },
  { re: /^抵挡(?:所有)?(?:攻击|伤害)/, reason: "passive-modifier" },
  { re: /^必杀/, reason: "passive-modifier" },
  // 跨单位快照传递（"将自身能力提升状态附加给己方下只出战精灵"——需 from-unit 引用，无对应 op）
  { re: /^将自身能力(?:提升|下降)?状态?附加给(?:己方)?下只出战精灵|^将自身能力(?:提升)?(?:状态)?转移给/, reason: "stage-snapshot-transfer (deferred)" },
  // 秒杀/即死族（"N%秒杀对手"/"必定瞬杀"——执行语义非伤害管线；锚定句首避免误杀触发体内的秒杀碎片）
  { re: /^(?:当回合)?(?:自身|自己)?(?:所有)?(?:攻击|技能)?(?:技能)?\d+%(?:的?(?:概率|几率))?秒杀|^(?:所有|任何)技能必定瞬杀|^必定瞬杀|直接秒杀|直接瞬杀/, reason: "instant-KO (deferred)" },
  // 动态成长标量（绝对点步进"每降低N点体力概率提升N%"——perHpLostStep 只覆盖 % 步进，点步进无对应字段）
  { re: /每降低\d+点(?:体力|生命|HP)|每损失\d+点(?:体力|生命|HP)|体力每损失\d+点/, reason: "per-unit-scaling (deferred)" },
  // （失效条件已由 condOf.nullifiedCatMask 承担——引擎在 status-locked/move-nullified 路径写位）
  // 性别门：裸形「对手为雄性/雌性/无性别」（condOf 已有 foeGender 谓词）放行；尾巴「精灵」同位语已并入 condOf。
  // 只有否定形（「若对手不是雄性精灵」——谓词取反未建模）与裸「性别」字样留在这条里。
  { re: /不是(?:雄性|雌性|无性别)|不为(?:雄性|雌性|无性别)|性别/, reason: "gender-cond — foe-gender predicate not modeled (deferred)" },
  { re: /信仰对象/, reason: "named target relation — external unit reference unmodeled (deferred)", quarantine: true },
  // 场下/背包态（"自身位于场下时X"——非出战位生效域未建模；"位于场上时"为恒真冗余前缀，body 归一剥离）
  { re: /^(?:自身|自己)?位于场(?:下|边|后)|己方下只(?:出战)?精灵/, reason: "party-scope — off-field/next-ally target unmodeled (deferred)", quarantine: true },
  { re: /异常状态?(?:只|至多|最多|仅)?持续.{0,4}回合/, reason: "ailment-duration-cap — debuff turn clamp not modeled (deferred)" },
  // 复活族扩展（"受到攻击伤害低于N则N%几率复活"——与 self-KO revive 同一检查点缺口）
  { re: /复活|重生/, reason: "revive/checkpoint — hook not modeled (deferred)" },
  // 结算已有、只是被这条笼统门控拦下的族：`消除对手能力提升状态`（clear_stages 的 sign:"up" 现成格子）
  // 与 `自身受到攻击伤害降低N%`（react trigger 1 + dmg_taken_down 是现成格子）。
  // 这两条放在 revive 行之后——顺序测试（soul-shape）只锁相对次序，新增追加在末尾即可。
  { re: /^消除(?:对手|对方|敌方)能力(?:提升|强化)(?:、|和|及|与)?(?:下降|弱化)?(?:状态)?$/, reason: "clear-stages clause — FALLTHROUGH" },
  { re: /^(?:自身|自己)受到(?:攻击|物理|特殊)?伤害(?:降|减)低\d+%$/, reason: "taken-down clause — FALLTHROUGH" },
  // 体力检查点存取（"记录自身的体力值…回归记录的体力值"——快照存取对，运行时无 checkpoint 原语）
  { re: /记录.{0,6}体力|记录此伤害|回归记录|体力值?恢复?到?记录/, reason: "checkpoint-restore — hp snapshot/restore pair not modeled (deferred)" },
  // 异常进入边沿触发（"进入疲惫状态时X"——施加边沿钩子未建模，区别于"处于X状态"电平谓词）
  { re: /进入[^，,；;]{1,10}状态时/, reason: "edge-trigger — ailment-entry transition hook not modeled (deferred)" },
  // 连续使用：攻击/属性技能的类别连用（streak）和同一技能连用（sameMove）已建模。其余（相同类型/每连续使用1回合/威力叠加）仍延期。
  // 负向先行：不吞「连续使用 攻击技能 / 属性技能 / 同一技能 / 相同的技能」，否则组级 test 会在触发词之前把整句 defer 掉。
  { re: /连续使用(?![\s，,]*(?:(?:攻击|属性)技能|同一(?:个)?技能|相同的技能))/, reason: "consecutive-use — streak tracking not modeled (deferred)" },
  // 日历/周期触发（"每月N日"/"每个月的N日"——非战斗时域）
  { re: /每个?月(?:的)?\d+日|每周[一二三四五六日]/, reason: "calendar trigger — non-battle timescale (deferred)" },
  // 动态概率已建模（chanceDyn 挂载）；此桶仅兜底非常规表述
  { re: /几率等同.{0,10}(?:几率|百分比.{0,6}几率)|概率随.{0,10}变化/, reason: "dynamic-chance variant — nonstandard dynamic-chance phrasing (deferred)" },
  // 具名印记层数按层直接缩放幅值（当前计数引用只能表达固定 countPerMark，不能表达每层伤害/减伤系数）。
  { re: /^每有(?:\d+|一|两|二|三|四|五|六|七|八|九|十)(?:层|句)/, reason: "per-mark scaling — stack/count-dependent magnitude unmodeled (deferred)", quarantine: true },
  // “未触发则重新触发登场效果并……”依赖再次派发既有 entry hook，整条 else 组需保留。
  { re: /^(?:若)?未触发则重新触发(?:自身的?)?登场效果/, reason: "entry-effect replay — linked fallback payload unmodeled (deferred)", quarantine: true },
  // 低血量分支中以刚结算的攻击伤害为基准，当前持久窗/回合末 hook 不能等价表达。
  { re: /^若.{2,32}?则附加等量固伤/, reason: "damage-result reference — equal amount of preceding attack unmodeled (deferred)" },
  // 具名招式触发（"N%触发百刃斩"——外部 move 引用无对应 op）
  { re: /\d+%(?:的?(?:概率|几率))?触发[一二三四五六七八九十百千刃斩裂空破绝灭神魔光暗火水冰雷风土龙圣灵超能次元暗影]/, reason: "named-move trigger — external move ref not modeled (deferred)" },
  // 专属道具计数（"每拥有N方永昌玺"——外部 inventory 引用）
  { re: /每拥有|永昌玺|专属道具/, reason: "inventory-count — external item ref (deferred)" },
  // 技能崩溃指令（"未来指令会在技能崩溃时"——外部机制引用）
  { re: /技能崩溃|未来指令/, reason: "external-mechanic ref (deferred)" },
  // 能力上限（"增加N点防御上限"——±6 封顶域提升，无对应字段）
  { re: /增加\d+点(?!.{0,3}(?:体力|生命)).{1,4}上限|(?:防御|特防|攻击|特攻|速度)上限/, reason: "stat-cap raise — stage ceiling unmodeled (deferred)" },
  { re: /缔结契约|契约精灵|存活期间可守护|初始体力为.{1,10}的/, reason: "companion/summon — ally entity lifecycle unmodeled (deferred)" },
  { re: /(?:变为|切换为|开启|若当前为|处于).{1,4}形态|形态（|形态：/, reason: "form-state — mode switching unmodeled (deferred)" },
  // 具名状态机（武道轨迹衍化/血之道·邪之道·天之道——form-mode 轮转未建模）
  { re: /武道|血之道|邪之道|天之道|轨迹.{0,4}衍化/, reason: "named state-machine — mode-track unmodeled (deferred)" },
  // 具名机制（TOH勘定技能记录/危机感计数——pet-specific mechanic unmodeled）
  { re: /勘定|危机感|赛博共振器|共振器|配置一个|开启状态|和平对抗/, reason: "named-mechanic — pet-specific domain unmodeled (deferred)" },
  // 具名来源过滤（"免疫B-ROBO造成的攻击伤害"——来源限定谓词未建模）
  { re: /免疫.{0,10}造成的攻击伤害|免疫[A-Za-z0-9-]{2,}/, reason: "source-filter — named-origin immunity unmodeled (deferred)" },
  // 伴生实体（"与X缔结契约"/"辛存活期间"——companion lifecycle 未建模）
  { re: /缔结契约|存活期间|守护.{0,4}自身/, reason: "companion — ally-entity lifecycle unmodeled (deferred)" },
  // 护盾击破触发（"自身护盾被击破时"——soulmark 无 onShieldBroken 钩子/payload 通道）
  { re: /护盾被(?:击破|打破|击碎|破除)/, reason: "shield-break trigger — soulmark hook unmodeled (deferred)" },
  // 护盾生命周期片段（"恢复所拥有护盾"/"此护盾消失"/"护盾被消除"——护盾值恢复/被消事件的 referent 链未建模；"护盾消失时X"已下放 effects-parse → react trigger4）
  { re: /恢复所拥有护盾|此护盾消失|护盾被消(?:除|去)/, reason: "shield lifecycle fragment (UNVERIFIED)" },
  // 回复事件触发（"对手每恢复1次体力"/"自身恢复体力时"——无 heal-react 钩子）
  { re: /每恢复\d+次体力|恢复体力时/, reason: "heal-react — heal-event trigger unmodeled (deferred)" },
  // 秒杀域（"对手执行秒杀效果时"/"被秒杀"——insta-KO 机制未建模）。
  // 「免疫(受到的)秒杀」不在此列：秒杀本身用 damage{kind:"percent",power:100} 表达，
  // 免疫秒杀 = 免疫百分比伤害（flat_immune 通道，规则在 batch-e8 的 e8-im-08）。
  { re: /(?<!免疫.{0,4})执行秒杀|秒杀效果|被秒杀/, reason: "insta-KO domain — one-shot mechanic unmodeled (deferred)" },
  // 先制上限（"自身先制等级不高于0"——prio ceiling 域未建模）
  { re: /先制等级不高于|先制不高于/, reason: "prio-cap — priority ceiling unmodeled (deferred)" },
  // 属性相性域（"自身微弱对手"/"克制倍数改为除以"——typechart 读写未建模）
  { re: /微弱对手|克制.*倍数|克制对手时|计算攻击伤害时|为.{1,4}系(?:时|则|，|,)|变更为.{1,6}系|不为.{1,4}系|龙系|属性.{0,2}改变/, reason: "attr-domain — typechart mutation unmodeled (deferred)" },
  // 出战次数派发（"根据本场战斗自身的出战次数，依次触发等量下列效果"——entry-count dispatch）
  { re: /根据本场战斗|依次触发等量/, reason: "entry-count dispatch — per-entry selector unmodeled (deferred)" },
  // 延迟启动（"从下回合开始"——delayed window 无字段）
  { re: /从下回合开始/, reason: "delayed-start — next-turn window unmodeled (deferred)" },
  // 附属类异常（"附属类异常状态"——sub-ailment 类别未建模）
  { re: /附属类异常/, reason: "sub-ailment class unmodeled (deferred)" },
  // 命中反应窗（"技能命中则在回合结束后X"——move-landed 二段钩子未建模，prevApplied 条目守卫不可达）
  { re: /命中则(?:在)?回合结束|技能命中则/, reason: "hit-window — move-landed second-phase trigger unmodeled (deferred)" },
  { re: /^回合开始时[，,、\s]*若.{1,30}则当回合攻击技能\d+%(?:的)?(?:几率|概率)打出致命(?:一击)?/, reason: "attack-category window — turn-start crit status cannot retain attack-only category (deferred)", quarantine: true },
  { re: /(?:消耗高出的体力并获得等量护盾|消耗(?:自身|自己的)?护盾并恢复等量体力|(?:若)?(?:自身|自己)?(?:拥有|存在)护罩则获得等量护盾)/, reason: "resource-value transfer — current HP/shield amount cannot be consumed or copied (deferred)", quarantine: true },
  // 对手附加异常反应（"对手每次执行异常状态附加效果后"——apply-observed 钩子未建模）
  { re: /执行.{0,6}异常.{0,4}附加|每次.*附加.*后/, reason: "foe-apply react — ailment-application trigger unmodeled (deferred)" },
  // 先制清除（"清除所有先制效果"——cleanse prio-scope 未建模）
  { re: /清除.{0,4}先制/, reason: "cleanse-prio — priority-window removal unmodeled (deferred)" },
  // 伤害改判（"伤害改判为N"——结果改写非管线语义）
  { re: /伤害改判为/, reason: "damage reclassification (deferred)" },
  // 重新触发登场效果（"重新触发自身的登场效果"——重放机制未建模）
  { re: /重新触发.{0,8}登场/, reason: "entry-effect replay (deferred)" },
  // 属性记录引用（"记录对手属性"/"克制该属性"/"微弱该属性"——存取属性快照无对应字段）
  { re: /记录(?:对手|对方|敌方)?属性|克制该属性|微弱该属性/, reason: "attr-record — stored-type reference not modeled (deferred)" },
  // 回合类效果消去免疫（"回合类效果无法被消除"——cleanse 免疫域未建模）
  { re: /回合类效果无法?被?消除|无法被消除/, reason: "cleanse-immune — anti-cleanse domain unmodeled (deferred)" },
  // 具名效果引用谓词（"未受到时空加速的伤害"/"若对手处于痴愚的精灵已阵亡"——外部效果快照引用）
  { re: /未受到(?!(?:攻击|攻击伤害|伤害|致命|异常))[一-龥]{2,10}(?:的)?(?:攻击|攻击伤害|伤害)/, reason: "named-effect ref — external-effect snapshot not modeled (deferred)" },
  // 能力等级变化边沿谓词（"能力等级发生变化"——stage 变迁跟踪未建模）
  { re: /能力等级发生(?:了)?变化/, reason: "stage-change — transition tracking unmodeled (deferred)" },
  // 先制等级变化比较（"先制等级与上回合不相等/高于上回合"——跨回合先制快照未建模）
  { re: /先制等级与上回合|先制等级.{0,4}上回合/, reason: "prio-snapshot — cross-turn prio compare unmodeled (deferred)" },
  // 效果削弱渐进（"之后每次登场时触发效果削弱到N/M"——渐进改写未建模）
  { re: /效果削弱到|削弱到.{0,6}最大体力/, reason: "progressive-weaken — staged magnitude override unmodeled (deferred)" },
  // 体力上限动态变化：已由 batch-e20 的 e20-hpmax-flat / e20-hpmax-pct 落地到
  // stat_boost{stats:["hp"]}。这里只兜底带额外限定、那两条认不了的形态
  // （如"每回合开始时提升1%的体力上限"这种逐回合重复触发的表述——周期语义另议）。
  { re: /每回合.{0,10}(?:提升|提高|增加|减少|降低).{0,8}体力上限/, reason: "max-HP manipulation — E4" },
  // 跨条目前向引用（"获得上述所有效果"/"继承累计的概率"/"通过上述方式附加过N种"——跨条目效果打包/计数引用未建模）
  { re: /上述所有效果|上述效果|上述方式|以上效果|全部触发|已经通过|累计的(?:概率|几率|效果|层数)|继承.{0,6}(?:概率|几率|层数)/, reason: "cross-entry ref — aggregate effect/probability reference unmodeled (deferred)" },
  // 己方精灵死亡事件（"己方每有一只精灵死亡则X"——ally-KO 观察域 victim:ally 未建模，仅 self/foe）
  { re: /己方每有一只精灵死亡|每有一只精灵死亡|己方精灵(?:被|每)?(?:死亡|阵亡)/, reason: "ally-death — victim:ally scope unmodeled (deferred)" },
  // 上下文指代属性（"自身对应的能力值+1"——"对应"引用前文的属性选择，无指代链字段）
  { re: /对应的能力值|对应的属性值|对应属性/, reason: "contextual-stat — referent-stat indirection unmodeled (deferred)" },
  // 元素系别加成（"电系技能伤害提升20%"——招式系别限定无对应字段）
  { re: /[冰火水草电机械地面飞行超能普通战斗暗影光次元邪灵自然王神灵混沌圣灵远古虫龙]系(?:技能|攻击|招式)?(?:的)?(?:伤害|威力|输出)(?:提升|提高|增加|翻倍|增强)/, reason: "element-typed boost — move-type restriction unmodeled (deferred)" },
  // 效果改挂到异触发（"未触发则此效果改为回合开始时触发"——hook 重挂未建模）
  { re: /此效果改为|效果改为.{0,10}触发|改为.{0,8}(?:回合|登场|下回合).{0,4}触发/, reason: "remount-hook — trigger relocation unmodeled (deferred)" },
  // 阵营/名录谓词（"对手为英雄圣殿成员"/"若对手为X成员"——外部名册引用）
  { re: /为.{1,8}(?:圣殿|殿堂|成员|系列|阵营|组织)/, reason: "faction-roster — external roster ref (deferred)" },
  // 效果递减参照（"效果减少N%"——前条幅度衰减谓词未建模）
  { re: /^效果(?:减少|降低|衰减)\d+%$/, reason: "effect-decay — magnitude decay ref unmodeled (deferred)" },
  // 背包在场谓词（"自身位于出战背包时"——位置谓词，单位总在出战位=恒真，UNVERIFIED）
  { re: /位于出战背包时|处于背包中|存活于(?:出战)?背包/, reason: "bench-position predicate (UNVERIFIED)" },
  { re: /效果结束后|状态结束后/, reason: "status-end trigger — ailment-expiry hook unmodeled (deferred)" },
  // 招式类型使用史（"此技能的类型本次登场未使用过"——per-entry move-type 使用追踪未建模）
  { re: /此技能的类型|技能的类型.{0,6}(?:未|没)(?:使用|用)过|类型本次登场/, reason: "skill-type-usage — per-entry move-type tracking unmodeled (deferred)" },
  // 回合类效果消除反应（"对手的回合类效果被消除时"——cleanse-observed trigger 未建模）
  { re: /回合类效果被消(?:除|去)|效果被消除时/, reason: "cleanse-react — turn-effect-removal trigger unmodeled (deferred)" },
  // 列表随机择一（"随机触发以下效果中的1个：A、B、C"——枚举效果择一选择器未建模）
  { re: /随机触发以下效果|随机(?:触发|获得).{0,6}效果中的?[0-9一二两三四五六七八九十]+个/, reason: "random-choice — listed-effect selection unmodeled (deferred)" },
  // 印记过期结算（"记忆破碎结束时对手恢复因此损失的所有PP值"——mark-expiry refund 未建模）
  { re: /(?<!回合)(?<!阶段)(?<!战斗)(?<!战斗阶段)结束时|恢复因此损失|因此损失的所有/, reason: "mark-expiry refund — removal-side-effect unmodeled (deferred)" },
  // 登场效果重触发（"重新触发自身的登场效果"——hook replay 未建模）
  { re: /重新触发|再次触发.{0,6}登场/, reason: "entry-retrigger — hook replay unmodeled (deferred)" },
  // 出场次数计数（"本场战斗自身每出战1次"——entry-count formula）
  { re: /每出战\d+次|每上场\d+次|出战\d+次|本场战斗.{0,6}出战/, reason: "entry-count dispatch — per-entry selector unmodeled (deferred)" },
  // PP随机区间（"pp值分别随机变化为m-n中的一个值"——per-slot range-set 未建模）
  { re: /分别随机变化为|随机变化为.{0,10}一个值|pp值.{0,4}随机/, reason: "pp-range — per-slot random amount unmodeled (deferred)" },
  // 特性名录计数（"对方精灵每有一个含有秒杀的特性"——external trait-list reference）
  { re: /含有.{0,4}的特性|除此特性外|每有一个.{0,4}特性/, reason: "trait-count — external trait roster unmodeled (deferred)" },
  // 印记声明块（"风龙结：…"/"希望之花：…"——具名印记状态机声明，整体归入 named domain）
  { re: /^[一-龥·]{2,8}：|数量达到\d+时|消耗所有.{0,4}的?[一-龥]{2,8}/, reason: "mark-declaration — named-mark state machine unmodeled (deferred)" },
  { re: /^(?:[^：:]{1,18}(?:图腾|场地效果说明|场地|庇护|状态说明|轮舞)[^：:]{0,8})[：:]|^(?:触发|开启|启动)[^：:]{1,18}(?:轮舞|循环|状态机|印记)[^：:]{0,4}[：:]/, reason: "named-domain definition — field/state-machine effects unmodeled (deferred)", quarantine: true },
  { re: /(?:点亮|连接)(?:对应|上一|前一|未被点亮)|(?:点亮|连接).{0,12}(?:进度|上一颗|前一颗|次数)/, reason: "named-state transition — linked counter/state snapshot unmodeled (deferred)", quarantine: true },
  // 印记持有者引用（"狩杀之的的体力"/"标记为狩杀之的"——跨单位印记指代/赋予未建模；获得N层X 的 apply_mark 授权不受此桶）
  { re: /[之魂愚祰耀怯]的(?:体力|PP|精灵|对手|自身)|标记为.{1,6}的|标记.{1,6}为.{1,6}的/, reason: "mark-holder-ref — cross-unit mark referent unmodeled (deferred)" },
  // 重置此效果（"重置此效果"——自指效果状态机复位，跨条目引用）
  { re: /^重置此效果$|^重置上述效果$/, reason: "cross-entry ref — aggregate effect/probability reference unmodeled (deferred)" },
  // 队友/相邻/首发位引用（"与自身相邻的精灵"/"首位精灵"——party-scope 参照域未建模）
  { re: /相邻的精灵|首位精灵|己方其他精灵|后排精灵|替补精灵|背包中精灵/, reason: "party-scope — adjacent/bench ally referent unmodeled (deferred)" },
  // 具名队友存在谓词（"若己方存在西忒蕾妃"——物种名册身份判定未建模）
  { re: /(?:若)?(?:己方|我方)(?:中|里|内)?(?:还)?存在[一-龥·]{2,8}(?:时|则|，|,|且|$)/, reason: "named-ally predicate — species identity unmodeled (deferred)" },
  // 登场效果比例可变状态（"本效果比例减少10%"/"重置自身登场效果的比例"——条目级可变系数未建模）
  { re: /效果的比例|比例(?:每)?(?:减少|增加|重置)|重置.{0,6}比例|变化量/, reason: "mutable mark ratio — entry coefficient state unmodeled (deferred)" },
  // 异常回合数增量（"自身流血回合数+1"——在挂异常 remainingTurns 后置增量无对应 op）
  { re: new RegExp(`(?:${"感染|害怕|麻痹|冰封|烧伤|睡眠|沉默|臣服|焚烬|失明|混乱|石化|束缚|瘫痪|流血|疲惫|诅咒|冻伤"}|异常状态)(?:的)?回合数\\s*[+＋加\\-－−减]\\s*\\d+`), reason: "ailment-duration mutation — post-hoc remainingTurns change unmodeled (deferred)", quarantine: true },
  // 无效化成功事件（"无效成功则恢复…"——招式被本印记无效化的观察钩子未建模）
  { re: /^(?:若|当)?(?:技能|招式|使其)?无效(?:化)?成功(?:时|后|则|，|,)/, reason: "nullify-success — move-nullification observation unmodeled (deferred)" },
  // 具名资源/形态域（"获得N点算力"/"算力乱流"/"星赐中随机"/"衍化"——具名资源与形态机未建模）
  { re: /算力|衍化|星赐|极速形态|毁灭形态/, reason: "named-resource/form domain unmodeled (deferred)" },
  // 同死结算（"双方同时死亡时对手残留N点体力"——互倒序列域未建模）
  { re: /双方同时死亡|同归于尽|同时倒下/, reason: "mutual-KO resolution unmodeled (deferred)" },
  // 下场保留/不保留（"此效果下场不保留"——切换持久化域未建模）
  { re: /下场(?:时)?(?:不)?保留|换下后(?:仍)?保留|切换后保留/, reason: "switch-persistence — cross-switch retention unmodeled (deferred)" },
  // 体力上限变动：常规「增加/提升/减少/降低 N点或N% 体力上限」已由 batch-e20 的
  // e20-hpmax-flat / e20-hpmax-pct 落到 stat_boost{stats:["hp"]}，这里只兜底
  // **带额外周期/累计/基线语义**的形态（"每回合…"、"每减少过N点…恢复"、"上限1/3"、"上限大于N"）。
  { re: /每回合.{0,12}(?:增加|提升|提高|扣除|减少|降低|衰减|削减|重置).{0,6}(?:体力|生命|最大体力)上限|每(?:减少|增加|提升|降低)过?\d+点(?:的)?(?:体力|生命|最大体力)上限|(?:体力|生命|最大体力)上限(?:变为|重置|衰减)/, reason: "max-HP mutation — hpMax domain unmodeled (deferred)" },
  // 护盾生命周期（"护盾消失后N回合重新被激活"——盾破碎/重激活状态机未建模）
  { re: /护盾消失后.{0,8}重新|护罩消失后.{0,8}重新|重新被激活|护盾重新激活/, reason: "shield lifecycle — break/rearm state machine unmodeled (deferred)" },
  // boss 域谓词（"boss对战中上限翻倍"——PvE 上限翻倍无对应通道；纯"boss无效/有效"尾注由 bossGate 层承载，勿吞）
  { re: /boss(?:对战|战|战斗)中/, reason: "PvE/Boss-mode predicate — unmodeled (deferred)" },
];
// "效果是：X" / "效果为X" preamble——剥掉再进触发匹配。
const EFFECT_PREAMBLE_RE = /^(?:专属)?(?:特性|魂印|buff|[Bb]uff)?(?:效果|说明)?(?:是|为|：|:)/;
// 战斗时域前言（"在战斗中"/"对战时"/"出战时"——always-on 语义前缀，剥掉进被动匹配）
const BATTLE_PREAMBLE_RE = /^(?:在|于)?(?:战斗中|对战中|对局中|战斗过程(?:中)?|战斗期间|对战时|战斗时|本场战斗中|本次战斗中)[，,、\s]*/;
// 概率累积尾句："之后本次在场该概率提升5%"/"每次使用额外增加5%，最高25%"——挂到该子句末条 entry。
const GROW_TAIL_RE = /[，,]?(?:(?:之后|此后|以后)(?:本次在场|本场战斗|在场|本回合)?(?:该)?概率(?:提升|增加|提高)|每次(?:使用|触发|受到攻击|遭受攻击|受到|攻击)(?:技能)?后?(?:额外)?(?:概率|减少量|伤害量|效果|幅度|倍率)?(?:的)?(?:增加|提高|提升)|每在场(?:概率)?(?:提升|增加))(\d+)%(?:[，,]?最高(?:提升|增加|到|为|减少)?(\d+)%)?$|[，,]?每回合(?:的)?(?:吸收量|吸取量|恢复量|伤害量|伤害)?(?:额外)?(?:增加|提升|提高)(\d+)\s*\/\s*(\d+)(?:的?(?:吸收量|吸取量|恢复量))?(?:[，,]?最多(?:吸收|吸取|恢复|达到|为)(\d+)\s*\/\s*(\d+)(?:的?最大体力)?)?$/;
// "成功/失败+异常名+则"链的异常名单（感染…冻伤——与 effects-parse AIL_RE 保持同步，独立维护免环依赖）
const AIL_ALT = "感染|害怕|麻痹|冰封|烧伤|睡眠|沉默|臣服|焚烬|失明|混乱|石化|束缚|瘫痪|流血|疲惫|诅咒|冻伤";
// "每场战斗限一次"：前缀或中缀限定——剥离后置 entry.limitBattle。
const BATTLE_LIMIT_RE = /^(?:每场战斗|每次战斗|全场)[中内里]?(?:仅|只)?限一次|，?(?:每场战斗|每次战斗|全场)[中内里]?(?:仅|只)?限一次|，?(?:每场战斗|每次战斗|本场战斗|全场)(?:内)?(?:仅|只)(?:能|可)?(?:触发|使用|生效)(?:一|1)次?/;
// "首次登场/首次出战"：onEntry + 全场一次。
const FIRST_ENTRY_RE = /^首次(?:登场|出战|出场|上场|入场)(?:时|后|，|,)?/;

/**
 * 常驻被动族 → onBattleStart + apply_status 永久效果（无 turns 即永久，EFFECT_DEFS 已定义全部语义）。
 * mk 返回 {name, params?}；条目形态 {hook:"onBattleStart", ops:[{op:"apply_status",name,target:"self",params}]}。
 */
const PASSIVES = [
  { re: /^(?:自身)?(?:所有)?(?:攻击|攻击技能)?(?:造成的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { pct: +m[1] } }) },
  // 威力加成窗（"所有技能威力提升N%"→power_mul 分数倍率）
  { re: /^(?:自身|所有|全部)?(?:攻击)?(?:攻击技能|技能)?威力(?:提升|提高|增加)(\d+)%/, mk: (m) => ({ name: "power_mul", params: { n: 100 + +m[1], d: 100 } }) },
  { re: /^造成(?:的)?伤害(?:提升|增加|提高)(\d+)%|^(?:自身|自己)(?:造成的)?伤害(?:提升|增加|提高)(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { pct: +(m[1] ?? m[2]) } }) },
  { re: /^满(?:体力|HP)时造成的?伤害提升(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { pct: +m[1], selfHpFull: 1 } }) },
  { re: /^(?:自身)?(?:受到|所受)(?:的|对手)?(?:攻击)?伤害(?:减少|降低|下降|减免)(\d+)%/, mk: (m) => ({ name: "dmg_taken_down", params: { pct: +m[1] } }) },
  { re: /^(?:对战中?|战斗中)(?:所受|受到)?的?伤害(?:减少|降低)(\d+)%/, mk: (m) => ({ name: "dmg_taken_down", params: { pct: +m[1] } }) },
  // 百分比伤害减免（单类型版）——必须先于合并形态规则
  { re: /^百分比伤害(?:减少|降低|下降)(\d+)%|^受到(?:的)?百分比伤害(?:减少|降低)(\d+)%/, mk: (m) => ({ name: "pct_taken_pct", params: { pct: +(m[1] ?? m[2]) } }) },
  { re: /^受到(?:对手|对方|敌方)?的?先制(?:攻击)?(?:技能)?(?:的)?伤害(?:减少|降低|减免)(\d+)%/, mk: (m) => ({ name: "pri_taken_pct", params: { pct: +m[1] } }) },
  { re: /^(?:固定伤害[、和与]|[、和与])?百分比伤害(?:减少|降低)(\d+)%|^固定伤害减少(\d+)%|^受到(?:的)?固定伤害和百分比伤害减少(\d+)%/, mk: (m) => ({ name: "flat_taken_pct", params: { pct: +(m[1] ?? m[2] ?? m[3]) } }) },
  // 攻击吸血（造成伤害的N%恢复自身体力——drain_atk 分数窗）
  { re: /^(?:所有)?(?:攻击|攻击技能|自身攻击)?造成(?:的)?(?:攻击)?伤害(?:的)?(\d+)%(?:恢复|回复|转化为|转为)自身体力|^攻击附带(\d+)%的?吸血(?:效果)?|^所有攻击技能造成的伤害的(\d+)%恢复自身体力|^造成攻击伤害恢复自身体力/, mk: (m) => ({ name: "drain_atk", params: m[0].includes("%") ? { n: +(m[1] ?? m[2] ?? m[3]), d: 100 } : { n: 1, d: 1 } }) },
  { re: /^(?:所有)?(?:攻击|攻击技能)?造成(?:的)?(?:攻击)?伤害(?:的)?(\d+)\s*\/\s*(\d+)(?:恢复|回复|转化为)自身体力/, mk: (m) => ({ name: "drain_atk", params: { n: +m[1], d: +m[2] } }) },
  { re: /^(?:每次受到攻击都)?(?:会)?反弹(\d+)\s*\/\s*(\d+)(?:对手|受到|所受)?的?(?:攻击)?伤害(?:给对手)?|^反弹对手造成的伤害的?(\d+)\s*\/\s*(\d+)|^每次受到攻击都会反馈给对手(\d+)\s*\/\s*(\d+)的?伤害/, mk: (m) => ({ name: "reflect_dmg", params: { n: +(m[1] ?? m[3] ?? m[5]), d: +(m[2] ?? m[4] ?? m[6]) } }) },
  { re: /^致命一击造成的伤害提升(\d+)%|^致命[一1]?击伤害提升(\d+)%/, mk: (m) => ({ name: "crit_dealt", params: { pct: +(m[1] ?? m[2]) } }) },
  // "初始致命几率N%"——常驻暴击率面板基线（crit_up n/d 窗）
  { re: /^初始(?:的)?(?:致命|暴击)(?:一击)?(?:的)?(?:几率|概率|率)(?:为)?(\d+)%/, mk: (m) => ({ name: "crit_up", params: { n: +m[1], d: 100 } }) },
  { re: /^免疫(?:所有|任何)?(?:的)?异常状态|^不受(?:任何|所有)?异常(?:状态)?(?:的?影响)?/, mk: () => ({ name: "immune_status" }) },
  { re: /^(?:天生)?免疫(?:能力)?(?:下降|弱化)(?:状态)?/, mk: () => ({ name: "immune_degrade" }) },
  { re: /^免疫(?:对手?)?致命一击/, mk: () => ({ name: "crit_immune" }) },
  { re: /^免疫固定伤害[、和与](?:百分比)?伤害|^免疫固定和百分比伤害|^免疫固定伤害、百分比伤害/, mk: () => ({ name: "flat_immune" }) },
  { re: /致命一击(?:的?几率|概率)?(?:上升|提升|提高)(\d+)\s*\/\s*(\d+)/, mk: (m) => ({ name: "crit_up", params: { n: +m[1], d: +m[2] } }) },
  { re: /致命一击(?:的?几率|概率)?(?:上升|提升|提高)(\d+)%|^(?:暴击|致命一击)率?(?:上升|提升|提高)(\d+)%|^有?(\d+)%(?:几率|概率)?打出致命[一1]?击|^增加(\d+)%的?致命[一1]?击(?:概率|几率)|^增加(\d+)%致命[一1]?击概率|^(?:所有|自身)?(?:攻击|攻击技能|所有攻击|技能)?暴击(?:的?几率|概率|率)?(?:上升|提升|提高|增加)(\d+)%/, mk: (m) => ({ name: "crit_up", params: { n: +(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]), d: 100 } }) },
  { re: /^反弹(?:对手|受到|所受)?(?:的)?(?:攻击)?伤害(?:的)?(\d+)\s*\/\s*(\d+)/, mk: (m) => ({ name: "reflect_dmg", params: { n: +m[1], d: +m[2] } }) },
  { re: /^免疫低于(\d+)(?:点)?的?(?:攻击)?伤害/, mk: (m) => ({ name: "dmg_floor", params: { min: +m[1] } }) },
  { re: /^(\d+)%(?:概率|几率)?(?:使)?对手攻击落空/, mk: (m) => ({ name: "dodge", params: { pct: +m[1] } }) },
  { re: /^有?(\d+)%(?:概率|几率)?闪避(?:当回合)?(?:受到|对手)?(?:的)?(?:所有)?攻击/, mk: (m) => ({ name: "dodge", params: { pct: +m[1], cat: 4 } }) },
  // 概率免疫异常（immune_chance flag——每次施加单独判定）
  { re: /^有?(\d+)%(?:概率|几率)?免疫(?:所有|任何)?(?:的)?异常(?:状态)?|^满体力时有?(\d+)%(?:概率|几率)?免疫所有异常状态/, mk: (m) => ({ name: "immune_chance", params: m[2] !== undefined ? { chance: +m[2], hpFull: 1 } : { chance: +m[1] } }) },
  // 类别必中（"所有特殊攻击必定命中"→sure_hit cat=3）
  { re: /^(?:所有|自身)?特殊攻击必定命中$|^所有特殊攻击必中$/, mk: () => ({ name: "sure_hit", params: { cat: 3 } }) },
  { re: /^(?:所有|自身)?物理攻击必定命中$/, mk: () => ({ name: "sure_hit", params: { cat: 2 } }) },
  { re: /^(?:所有|自身)?攻击必定命中$|^所有技能必定命中$|^攻击必中$/, mk: () => ({ name: "sure_hit" }) },
  // 抵挡型护盾（"带有能抵挡N点伤害的护盾"——dmg_shield 永久窗，耗尽即止）
  { re: /^带有?能抵挡(\d+)点伤害的护盾|^拥有能抵挡(\d+)点伤害的护盾/, mk: (m) => ({ name: "shield", params: { flat: +(m[1] ?? m[2]) } }) },
  // 对手必定 MISS（must_miss 施加给对手侧）
  { re: /^令对手(?:所有|当回合)?(?:攻击|攻击技能|技能)?必定(?:MISS|miss|未命中|落空)/, mk: () => ({ name: "must_miss", target: "opponent" }) },
  { re: /^对手攻击(?:有?(\d+)%|必定)(?:MISS|miss|未命中|落空)/, mk: (m) => m[1] !== undefined ? { name: "dodge", params: { pct: +m[1] } } : { name: "must_miss", target: "opponent" } },
  // "使对手攻击miss"/"有N%miss" → 对手 must_miss / 自身 dodge
  { re: /^使对手攻击(?:技能)?(?:MISS|miss|未命中|落空)$|^令对手攻击(?:技能)?(?:MISS|miss|未命中|落空)$/, mk: () => ({ name: "must_miss", target: "opponent" }) },
  { re: /^有?(\d+)%(?:概率|几率)?(?:MISS|miss|未命中|落空)$/, mk: (m) => ({ name: "dodge", params: { pct: +m[1] } }) },
  // 使用技能无视强化（pierce_stages 常驻——"使用技能无视对手能力提升状态"）
  { re: /^(?:使用技能|攻击时|攻击)?无视(?:对手|对方|敌方)(?:的)?能力(?:提升|强化)状态/, mk: () => ({ name: "pierce_stages" }) },
  // 攻特取高（unify_offense——"攻击和特攻等于其中最高的一项"）
  { re: /^(?:自身)?攻击和特攻(?:值)?等于其中最高(?:的)?一项/, mk: () => ({ name: "unify_offense" }) },
  // 先制常驻（prio_up 永久窗——params.add）
  { re: /^(?:当回合)?(?:自身)?所有技能先制\+(\d+)|^(?:自身)?(?:所有)?(?:攻击)?技能先制\+(\d+)/, mk: (m) => ({ name: "prio_up", params: { add: +(m[1] ?? m[2]) } }) },
  // 攻特取高（unify_offense——攻击/特攻取较高项）
  { re: /^在战斗中?，?攻击和特攻(?:值)?等于其中最高的一项|^攻击和特攻(?:值)?(?:均)?等于其中最高(?:的)?(?:一项|值)/, mk: () => ({ name: "unify_offense" }) },
  // 致命一击伤害概率免疫（crit_dodge——受暴击时按概率将伤害归零）
  { re: /^有?(\d+)%(?:概率|几率)?免疫(?:对手|对方)?(?:受到|所受)?的?致命[一1]?击(?:造成?的?伤害)?/, mk: (m) => ({ name: "crit_dodge", params: { chance: +m[1] } }) },
  // 次数免疫（"可以抵挡2次攻击伤害"→dmg_immune count）
  { re: /^可以?抵挡(两|\d+)次(?:攻击|攻击伤害|伤害)/, mk: (m) => ({ name: "dmg_immune", params: { count: m[1] === "两" ? 2 : +m[1] } }) },
  // 攻击自带暴击率（"自身攻击30%打出致命一击"→crit_up 分数窗）
  { re: /^(?:自身)?攻击(?:技能)?有?(\d+)%(?:的?(?:概|几)?率)?打出致命[一1]?击/, mk: (m) => ({ name: "crit_up", params: { n: +m[1], d: 100 } }) },
  // 威力翻倍窗（power_mul flag——威力×n/d；"N%概率威力翻倍"→chance 逐击判定）
  { re: /^(?:自身|自己)?(?:所有|攻击)?(?:攻击)?(?:技能|攻击)?(?:有)?(\d+)%(?:的?(?:概率|几率))?(?:使(?:自身|自己)?(?:技能|攻击)?)?威力翻倍|^威力翻倍$|^(?:所有|全部)?(?:攻击|技能)?(?:攻击技能|技能|攻击)?威力翻倍$|^(?:所有)?(?:攻击)?技能有?(\d+)%(?:的?(?:概率|几率))?(?:使)?威力翻倍/, mk: (m) => { const pct = m[1] ?? m[2]; return { name: "power_mul", params: pct !== undefined ? { n: 2, d: 1, chance: +pct } : { n: 2, d: 1 } }; } },
  { re: /^(?:自身)?攻击(?:技能)?有?(\d+)\s*\/\s*(\d+)(?:的?(?:概率|几率))?威力翻倍/, mk: (m) => ({ name: "power_mul", params: { n: 2, d: 1, chance: Math.round((+m[1] * 100) / +m[2]) } }) },
  // 必定暴击（"所有攻击必定打出致命一击"→crit_up 100%）
  { re: /^(?:所有|自身)?(?:攻击|攻击技能|技能)?必定打出致命[一1]?击$|^必定致命[一1]?击$|^必定暴击$/, mk: () => ({ name: "crit_up", params: { n: 100, d: 100 } }) },
  // 反弹分数窗（standalone "反弹N/N对手造成的伤害"→reflect_dmg 常驻）
  { re: /^反弹(\d+)\s*\/\s*(\d+)(?:对手|对方|敌方)?造成的伤害|^反弹(\d+)\s*\/\s*(\d+)(?:对手|对方|敌方)(?:的)?伤害/, mk: (m) => ({ name: "reflect_dmg", params: { n: +(m[1] ?? m[3]), d: +(m[2] ?? m[4]) } }) },
  // "将对手的攻击伤害N%反馈给对手" → reflect_dmg（反馈=反弹同族）
  { re: /^将(?:对手|对方|敌方)的?(?:攻击)?伤害(?:的)?(\d+)%(?:反馈|反弹|返还)给(?:对手|对方|敌方)/, mk: (m) => ({ name: "reflect_dmg", params: { n: +m[1], d: 100 } }) },
  // standalone "先制+N" → prio_up 常驻
  { re: /^先制\+(\d+)$/, mk: (m) => ({ name: "prio_up", params: { add: +m[1] } }) },
  // 攻击附带吸血窗（"所有攻击附带5%的吸血效果"→drain_atk 分数）
  { re: /^(?:所有|任何)?(?:自身)?攻击(?:技能)?(?:都?将?|额外)?附带(\d+)%(?:的)?吸血/, mk: (m) => ({ name: "drain_atk", params: { n: +m[1], d: 100 } }) },
  // 攻击附带定额固伤窗（"任何攻击技能都将附带100点固定伤害"→dmg_flat）
  { re: /^(?:所有|任何|自身)?攻击(?:技能)?(?:都?将?|额外)?附(?:带|加)(\d+)点(?:固定|固伤)?伤害/, mk: (m) => ({ name: "dmg_flat", params: { flat: +m[1] } }) },
  // 承伤减免定额（"受到的伤害减少N点"→dmgReduceFlat 常驻窗；"来自雄性精灵"等条件形态交守卫路径，不在此近似）
  { re: /^受到(?:的)?(?:攻击)?伤害减少(\d+)点?$|^减少(\d+)点(?:的)?伤害$/, mk: (m) => ({ name: "dmg_reduce", params: { flat: +(m[1] ?? m[2]) } }) },
  // 按自身最大体力比例附固伤（"附带自身最大体力15%的固定伤害"→dmg_flat.selfMaxPct；"最多N点"尾由 dmgCap 回挂 params.cap）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)自身最大(?:体力|HP)(\d+)%(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { selfMaxPct: +m[1] } }) },
  // 对手当前体力比例附固伤（"攻击附加对手当前生命值30%的固定伤害"→foeCurPct）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)对手当前(?:生命|体力)值?(\d+)%(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { foeCurPct: +m[1] } }) },
  // 对手双防之和比例附固伤（"附加对手双防值之和30%的固定伤害"→foeDefSumPct）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)对手(?:的)?双防值?之?和?的?(\d+)%(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { foeDefSumPct: +m[1] } }) },
  // 自身双防提升段数×N 附固伤（"附加自身防御和特防能力提升总段数乘以50的固定伤害"→flatDefStageMul）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)自身(?:防御和特防|双防)(?:的)?能力?提升总段数(?:乘以|乘|×)(\d+)(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { flatDefStageMul: +m[1] } }) },
  // 上回合承伤×N% 附固伤（"附加自身上回合受到伤害数值50%的固定伤害"→prevTurnTakenPct）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)自身上回合受(?:到|的)?伤害(?:数值)?的?(\d+)%(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { prevTurnTakenPct: +m[1] } }) },
  // 当次威力×N 附固伤（"附加等同于当次技能威力值2倍的固定伤害"→flatPowerMul）
  { re: /^(?:所有|任何|自身)?(?:攻击(?:技能)?(?:都?将?|额外)?)?附(?:带|加)等同于?(?:当次|该次|本?次)?技能?威力值?的?(\d+)倍(?:的)?固定伤害/, mk: (m) => ({ name: "dmg_flat", params: { flatPowerMul: +m[1] } }) },
  // 能力提升种数×N 附固伤（"双方每处于一种能力提升状态则附加60点固定伤害"/"自身每处于…"）
  { re: /^(?:双方|自身|对手)(?:精灵)?每处于一种能力提升状态(?:则|，|,)?附(?:带|加)(\d+)点(?:固定)?伤害/, mk: (m) => ({ name: "dmg_flat", params: { [/双方/.test(m[0]) ? "flatBothStageUpCountMul" : /对手/.test(m[0]) ? "flatFoeStageUpCountMul" : "flatStageUpCountMul"]: +m[1] } }) },
  // 强化种数×N% 伤害提升（"自身每处于1种能力提升则造成攻击伤害提高10%"→dmg_boost perStage）
  { re: /^(?:自身|自己)每处于(\d+)种能力提升(?:状态)?则造成(?:的)?(攻击)?伤害(?:提高|提升|增加)(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { perStage: +m[3], ...(m[2] !== undefined ? { kindMask: 4 } : {}) } }) },
  // 对手强化种数×N% 承伤减免（"对手每处于1种能力提升则自身受到攻击伤害降低10%"→dmg_taken_down perFoeStage）
  { re: /^(?:对手|对方|敌方)每处于(\d+)种能力提升(?:状态)?则(?:自身|自己)?受到(?:的)?(攻击)?伤害(?:降低|减少|下降|减免)(\d+)%/, mk: (m) => ({ name: "dmg_taken_down", params: { perFoeStage: +m[3], ...(m[2] !== undefined ? { kindMask: 4 } : {}) } }) },
  // 回复倍率窗（"自身恢复能力翻倍"/"恢复比例提升N%"→heal_boost）
  { re: /^(?:自身|自己)?(?:本次在场|在场|本回合|当回合)?(?:的)?(?:体力|HP|生命)?恢复(?:能力|效果|量|比例)?(?:翻倍|(?:提升|提高|增加)(\d+)%)$/, mk: (m) => ({ name: "heal_boost", params: { pct: m[1] !== undefined ? +m[1] : 100 } }) },
  // perHpDiff 缩放（"每与对手相差80点伤害提升40%[最高160%]"——dmgOutPctOf 逐击求值，cap 走 cap-tail/growTail）
  { re: /^每与对手相差(\d+)点(?:体力)?(?:，|,|则)?(?:自身|自己)?造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { perHpDiffEvery: +m[1], perHpDiffPct: +m[2] } }) },
  // perShield 缩放（"双方每有5点护盾伤害提升1%[最高75%]"——who:1=self 2=foe 3=both）
  { re: /^(自身|自己|对手|对方|敌方|双方|敌我双方)?每有(\d+)点护盾(?:值)?(?:，|,|则)?(?:自身|自己)?造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\d+)%/, mk: (m) => ({ name: "dmg_boost", params: { perShieldEvery: +m[2], perShieldPct: +m[3], perShieldWho: m[1] === undefined ? 3 : /自身|自己/.test(m[1]) ? 1 : /对手|对方|敌方/.test(m[1]) && !/双/.test(m[1]) ? 2 : 3 } }) },
  // pctPerAilTurn 缩放（"自身每有1回合流血，当回合攻击伤害提高15%"——落地时按异常剩余回合烘焙 pct）
  { re: new RegExp(`^(?:自身|自己)每有(?:1|一)回合(${AIL_ALT})(?:状态)?[，,、]?(?:当回合|本回合)?(?:自身|自己)?(?:攻击技能)?造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)(\\d+)%`), mk: (m) => ({ name: "dmg_boost", params: {}, pctPerAilTurn: { ail: AILMENTS[m[1]], pct: +m[2] } }) },
];

/** 面板加成型魂印（"体力+10 攻击+15"/"体力值增加5%"族）→ onBattleStart + stat_boost ops。
 * 整句必须全部由属性加项/分隔符/（强化后为：…）括注构成——混入其他语义返回 undefined 交后续规则。
 */
const STAT_KEY_MAP = { 体力: "hp", 生命: "hp", 攻击: "atk", 防御: "def", 特攻: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" };
const statClauseOps = (gtext) => {
  const src = gtext.replace(/[（(]强化后为?[:：]?[^）)]*[）)]/g, "").replace(/^(?:神|魔|袭|野|异|烈|惑|迅|暴|魂)[:：]/, "")
    .replace(/增加(\d+)点(?:体力|生命)(?:值)?上限/g, "体力+$1"); // "增加N点体力上限" → 面板加项形态

  const re = /(体力|生命|攻击|防御|特攻|特防|速度|命中|双攻|双防|全属性|六项|全部能力)(?:值|力)?\s*(?:\+\s*(\d+)|(?:增加|提升|提高)(\d+)%)/g;
  const adds = new Map(); // stat -> add
  const pcts = new Map(); // stat -> pct
  let rest = src;
  let m;
  let any = false;
  while ((m = re.exec(src)) !== null) {
    any = true;
    const key = m[1];
    let stats = key === "全属性" || key === "六项" || key === "全部能力" ? ["hp", "atk", "def", "spa", "sdf", "spd"]
      : key === "双攻" ? ["atk", "spa"]
      : key === "双防" ? ["def", "sdf"]
      : [STAT_KEY_MAP[key]];
    if (stats[0] === undefined) return undefined;
    stats = stats.filter((s) => s !== "acc"); // acc 是 stage 域非面板——stat_boost 不承接
    if (m[2] !== undefined) for (const s of stats) adds.set(s, (adds.get(s) ?? 0) + +m[2]);
    else for (const s of stats) pcts.set(s, (pcts.get(s) ?? 0) + +m[3]);
  }
  if (!any) return undefined;
  rest = src.replace(re, "");
  if (!/^[\s、，,：:]*$/.test(rest)) return undefined; // 残留非加项文本 → 交后续规则
  const ops = [];
  const group = (map, field) => {
    const byVal = new Map();
    for (const [s, v] of map) { const l = byVal.get(v) ?? []; l.push(s); byVal.set(v, l); }
    for (const [v, stats] of byVal) ops.push({ op: "stat_boost", stats, [field]: v, target: "self" });
  };
  group(adds, "add");
  group(pcts, "pct");
  return ops.length > 0 ? ops : undefined;
};

/** 条件被动 → flag params 门控。只并入该名字读取点真看的键。
 * 读不到的谓词仍算认出来（SWALLOW）：返回 undefined 会改走 guard，门控就会开始生效。 */
const passCondGate = (cond, name) => {
  const GATED = {
    dmg_boost: ["selfHpFull", "foeStageDown", "foeStageUp", "foeStatused", "selfStatused", "selfHpBelowFoe", "selfHpAboveFoe"],
    dmg_taken_down: ["selfHpFull", "foeStageDown", "foeStageUp", "foeStatused", "selfStatused", "selfHpAbove", "selfHpBelow", "foeHpAboveAbs", "foeHpBelowAbs", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    dmg_taken_up: ["selfHpFull", "foeStageDown", "foeStageUp", "foeStatused", "selfStatused", "selfHpAbove", "selfHpBelow", "foeHpAboveAbs", "foeHpBelowAbs", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    dmg_reduce: ["selfHpFull", "foeStageDown", "foeStageUp", "foeStatused", "selfStatused", "selfHpAbove", "selfHpBelow", "foeHpAboveAbs", "foeHpBelowAbs", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    immune_chance: ["selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    drain_atk: ["selfHpFull", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown", "foeStatused"],
    heal_boost: ["selfHpFull", "selfStatused", "selfHpAbove", "selfHpBelow", "selfHpBelowFoe", "selfHpAboveFoe", "foeStatused", "foeStageUp", "foeStageDown", "selfStageUp", "selfStageDown"],
    dmg_flat: ["selfHpFull", "foeStageDown", "foeStageUp", "selfStatused", "selfHpAbove", "selfHpBelow", "foeHpAboveAbs", "foeHpBelowAbs", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    crit_up: ["selfHpFull", "foeHpAboveAbs", "foeHpBelowAbs", "selfHpBelowFoe", "selfHpAboveFoe", "selfStageUp", "selfStageDown"],
    dodge: ["selfHpBelowFoe", "selfHpAboveFoe"],
  };
  // dmgOutPctOf 不读 selfStage*；immune 不读 selfHpFull（hpFull 才是满血门，改名会开始生效）；dmgFlatOf 不读 foeStatused。
  const SWALLOW = {
    dmg_boost: ["selfStageUp", "selfStageDown"],
    immune_chance: ["selfHpFull"],
    dmg_flat: ["foeStatused"],
  };
  const ok = GATED[name];
  const swallow = SWALLOW[name] ?? [];
  if (ok === undefined && swallow.length === 0) return undefined;
  const copy = ok ?? [];
  const out = {};
  let seen = false;
  const take = (key, write) => {
    if (copy.includes(key)) { write(); seen = true; return true; }
    if (swallow.includes(key)) { seen = true; return true; }
    return false;
  };
  const subs = cond?.and !== undefined ? cond.and : [cond];
  for (const s of subs) {
    if (s === undefined || typeof s !== "object") return undefined;
    if (s.selfHpFull === true) { if (!take("selfHpFull", () => { out.selfHpFull = 1; })) return undefined; }
    else if (s.foeStageDown === true) { if (!take("foeStageDown", () => { out.foeStageDown = 1; })) return undefined; }
    else if (s.foeStageUp === true) { if (!take("foeStageUp", () => { out.foeStageUp = 1; })) return undefined; }
    else if (s.foeStatused === true) { if (!take("foeStatused", () => { out.foeStatused = 1; })) return undefined; }
    else if (s.selfStatused === true) { if (!take("selfStatused", () => { out.selfStatused = 1; })) return undefined; }
    else if (s.selfHpAbove !== undefined) { if (!take("selfHpAbove", () => { out.selfHpAboveFracN = s.selfHpAbove.numerator; out.selfHpAboveFracD = s.selfHpAbove.denominator; })) return undefined; }
    else if (s.selfHpBelow !== undefined) { if (!take("selfHpBelow", () => { out.selfHpBelowFracN = s.selfHpBelow.numerator; out.selfHpBelowFracD = s.selfHpBelow.denominator; })) return undefined; }
    else if (s.foeHpAboveAbs !== undefined) { if (!take("foeHpAboveAbs", () => { out.foeHpAboveAbs = s.foeHpAboveAbs; })) return undefined; }
    else if (s.foeHpBelowAbs !== undefined) { if (!take("foeHpBelowAbs", () => { out.foeHpBelowAbs = s.foeHpBelowAbs; })) return undefined; }
    else if (s.selfHpBelowFoe === true) { if (!take("selfHpBelowFoe", () => { out.selfHpBelowFoe = 1; })) return undefined; }
    else if (s.selfHpAboveFoe === true) { if (!take("selfHpAboveFoe", () => { out.selfHpAboveFoe = 1; })) return undefined; }
    else if (s.selfStageUp === true) { if (!take("selfStageUp", () => { out.selfStageUp = 1; })) return undefined; }
    else if (s.selfStageDown === true) { if (!take("selfStageDown", () => { out.selfStageDown = 1; })) return undefined; }
    else return undefined;
  }
  return seen ? out : undefined;
};

/** 条件翻倍克隆窗互斥：标量门经 NEG_KEY 反门、分数门经 not*FracN/D 反门（"P时X翻倍"=¬P 基窗 + P 双倍窗）。 */
const negateBaseParam = (o, cond) => {
  const NK = { selfHpBelowFoe: "notSelfHpBelowFoe", selfHpAboveFoe: "notSelfHpAboveFoe", foeStatused: "notFoeStatused", selfStatused: "notSelfStatused", selfStageUp: "notSelfStageUp", selfStageDown: "notSelfStageDown" };
  const ck = cond !== undefined && typeof cond === "object" && cond.and === undefined && cond.or === undefined ? Object.keys(cond).find((k) => cond[k] === true && NK[k] !== undefined) : undefined;
  if (ck !== undefined) o.params = { ...(o.params ?? {}), [NK[ck]]: 1 };
  else if (cond?.selfHpBelow !== undefined) o.params = { ...(o.params ?? {}), notSelfHpBelowFracN: cond.selfHpBelow.numerator, notSelfHpBelowFracD: cond.selfHpBelow.denominator };
  else if (cond?.selfHpAbove !== undefined) o.params = { ...(o.params ?? {}), notSelfHpAboveFracN: cond.selfHpAbove.numerator, notSelfHpAboveFracD: cond.selfHpAbove.denominator };
};
const markPermanentBattleStartClone = (entry, base, clone) => {
  if (entry?.hook !== "onBattleStart" || base.turns !== undefined || clone.turns !== undefined) return;
  base.stack = true;
  clone.stack = true;
};

// 破盾边沿触发（组级与 body 再分派共用）——"护[盾罩](或护罩)?(任意一个)?消失(时|后|则)X" → react trigger4
const SHIELD_BREAK_RE = /^(?:若|当)?(?:自身|自己)?(?:的)?护[盾罩](?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失(?:时|后|则)(.+)$|^(?:若|当)?(?:自身|自己)?(?:的)?此?护[盾罩]消失(?:时|后|则)(.+)$|^护[盾罩](?:或|和|与)(?:护罩|护盾)?任意(?:一|1)个?消失(?:时|后|则)(.+)$/;

/** 触发前缀表——先长后短，首个命中即停。extra 字段并入条目；
 * mk(gtext) 动态形态：返回 {hook,extra,body} 或 undefined（守卫/注入值需正则捕获量时用）。 */
const TRIGGERS = [
  // ── onDamageDealt（攻击方命中后）——先于 onMoveUsed 的近似规则 ──
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?(?:攻击|攻击技能|技能)?造成(?:的)?(?:攻击)?伤害(?:若)?(?:高于|大于|超过)(\d+)(?:点)?则?/); if (t === null) return undefined; return { hook: "onDamageDealt", extra: { guard: { prevDamageAboveAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { mk: (g) => { const t = g.match(/^(?:若)?(?:当回合|本次|本回合)?(?:自身|自己)?(?:攻击|攻击技能|技能)?造成(?:的)?(?:攻击)?伤害(?:若)?(?:低于|小于|不足)(\d+)(?:点)?[则，,]?/); if (t === null) return undefined; return { hook: "onDamageDealt", extra: { guard: { prevDamageBelowAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  // 成功命中发生在 move resolution 完成后，适用于属性技能等无伤招式；攻击类别须保留 cat。
  { re: /^(?:当|每次|若)?(?:自身|自己)?(?:使用|释放|打出)?(?:攻击技能|攻击)(?:成功)?命中(?:对手|目标)?(?:时|后|则|[，,])/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  { re: /^(?:当|每次|若)?(?:自身|自己)?(?:使用)?(?:攻击技能|攻击|直接攻击)(?:成功)?命中(?:对手|目标)?(?:时|后)/, hook: "onDamageDealt" },
  { re: /^命中后/, hook: "onDamageDealt" },
  // "自身(每次)?(物理|特殊|攻击)(技能)?命中(后|时)X" → onDamageDealt + cat（类别词限维；"自身特殊攻击命中后"/"使用物理攻击追加"）
  { mk: (g) => { const t = g.match(/^(?:若|当|每次)?(?:自身|自己)?(?:使用|释放|打出)?的?(物理|特殊)攻击(?:技能)?(?:(?:命中|击中)(?:对手|对方|敌方)?(?:时|后|，|,|则)|(?=追加|附加))/); if (t === null) return undefined; return { hook: "onDamageDealt", extra: { cat: t[1] === "物理" ? 2 : 3 }, body: g.slice(t[0].length) }; } },
  { re: /^(?:若|当|每次)?(?:自身|自己|我方|己方)?(?:每次|每回|都)?(?:使用|释放|打出)?的?(?:攻击|攻击技能|所有攻击|所有攻击技能)(?:命中|击中)(?:对手|对方|敌方)?(?:(?:时|后)则|时|后|则)/, hook: "onDamageDealt" },
  { re: /^(?:若|当|每次)?(?:自身|自己)?(?:使用|释放)?(?:攻击|攻击技能|所有攻击|所有攻击技能)(?=追加(?:对手|对方|敌方|\d))/, hook: "onDamageDealt" },
  { re: /^(?:若|当|每次)?(?:自身|自己)?(?:使用|释放)?(?:攻击|攻击技能|属性技能)?打出致命[一1]?击[，,、]?(?:时|后|则)/, hook: "onDamageDealt", extra: { guard: { prevCrit: true } } },
  // "减少N来自雄性精灵的伤害" → 受击钩 + foeGender 守卫 + 裸"受到的攻击伤害减少N点"
  //（condOf 的 foeGender 谓词是现成的；这句只是把"来自X性精灵"改写成语义相同的守卫）。
  { mk: (g) => {
      const t = g.match(/^(?:减少|降低)(\d+)点?来自(雄|雌)性精灵的(?:攻击)?(?:伤害|固伤|百分比伤害)/);
      if (t === null) return undefined;
      return { hook: "onDamaged", extra: { guard: { foeGender: t[2] === "雄" ? "male" : "female" } }, body: `受到的攻击伤害减少${t[1]}点` };
    } },
  // 三条"只差触发词"的常驻被动——体内谓词在 PASSIVES 里已有格子，缺的只是句首触发词：
  //   「出手…」= 每次使用技能（onMoveUsed + actor:self）
  //   「…必定先手」= 攻击必定先手（e32-prio-01 的补形；同族 e11 用 +9，这里沿用 e32 的 flags.priority=3）
  { mk: (g) => {
      const t = g.match(/^(?:每次|每)?出手(?=[，,、\s]*(?:恢复|回复|吸取|附加|令|使|造成|获得|消除|清除|无视))/);
      if (t === null) return undefined;
      return { hook: "onMoveUsed", extra: { actor: "self" }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") };
    } },
  { mk: (g) => {
      const t = g.match(/^(?:(?:自身|自己)?(?:所有|全部)?(?:攻击|技能))?必定先手$/);
      if (t === null) return undefined;
      // 与既有「攻击必定先手」同形（onMoveUsed + actor/cat 守卫），别挂成 onBattleStart+turns:1 的一次性窗
      return { hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, body: "必定先手" };
    } },
  // "受到的攻击伤害反弹给对手" → onDamaged + reflect_dmg（与上面"反馈给对手"同义，只是动词是"反弹"）。
  // 宿主 帝皇之御/莎利奥/艾斯德诺：三种写法都是承伤侧全额反弹。
  { mk: (g) => {
      const t = g.match(/^(?:自身|自己)?(?:将(?:自身|自己)?)?受到的(?:攻击)?伤害(?:反弹|反馈|返还)(?:给)?(?:对手|对方|敌方)$/);
      if (t === null) return undefined;
      return { hook: "onDamaged", body: "反弹对手造成的伤害的1/1" };
    } },
  // "自身免疫并反弹异常状态" → onBattleStart + immune_status + reflect_status（"免疫并反弹异常状态"的裸句
  // 已在 PASSIVES 有格子，缺的只是句首「自身」让分组不认它）。
  { mk: (g) => {
      // 只吃"整段就是这句"的裸句；带"且/并"续段的宿主（冥霞"…免疫并反弹受到的异常状态且使用技能无视…"）
      // 留给既有触发/守卫机制，别把 回合开始时 的钩子改写成登场时。
      const t = g.match(/^(?:自身|自己)(免疫并反弹(?:所有)?(?:受到的)?异常状态)$/);
      if (t === null) return undefined;
      return { hook: "onBattleStart", body: t[1] };
    } },
  // 同族三形：主语换成"X性精灵"、或"对X性精灵"（打出侧）。都是把性别限定改写成 foeGender 守卫，
  // 体内留下 condOf/mk 已经认识的裸谓词，不新增谓词、不新增钩子。
  { mk: (g) => {
      const t = g.match(/^(?:减少|降低)(\d+)%来自(雄|雌)性精灵的(?:攻击)?伤害/);
      if (t === null) return undefined;
      return { hook: "onDamaged", extra: { guard: { foeGender: t[2] === "雄" ? "male" : "female" } }, body: `受到的攻击伤害减少${t[1]}%` };
    } },
  { mk: (g) => {
      const t = g.match(/^(雄|雌)性精灵对自身造成的(?:攻击)?伤害(?:减少|降低)(\d+)%/);
      if (t === null) return undefined;
      return { hook: "onDamaged", extra: { guard: { foeGender: t[1] === "雄" ? "male" : "female" } }, body: `受到的攻击伤害减少${t[2]}%` };
    } },
  { mk: (g) => {
      const t = g.match(/^(雄|雌)性精灵攻击我方时/);
      if (t === null) return undefined;
      return { hook: "onDamaged", extra: { guard: { foeGender: t[1] === "雄" ? "male" : "female" } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") };
    } },
  { mk: (g) => {
      const t = g.match(/^对(雄|雌)性精灵造成的(?:攻击)?伤害(?:提升|增加|提高)(\d+)%/);
      if (t === null) return undefined;
      return { hook: "onDamageDealt", extra: { guard: { foeGender: t[1] === "雄" ? "male" : "female" } }, body: `造成的伤害提升${t[2]}%` };
    } },
  { re: /^(?:当|每次)?(?:自身|自己)?造成(?:的)?(?:攻击)?伤害(?:时|后)/, hook: "onDamageDealt" },
  { re: /^(?:当|每次|若)?(?:自身|自己)?(?:攻击技能|攻击|直接攻击)?打出致命[一1]?击(?:时|后)/, hook: "onDamageDealt", extra: { guard: { prevCrit: true } } },
  { re: /^(?:每次|当)?(?:自身)?攻击(?:都有|有|时)?(?=\d+%)/, hook: "onDamageDealt" },
  { re: /^自身(?:所有|全部)?攻击技能(?=有?\d+%|有?\d+%的?(?:几|概)?率|令|使|消除|清除|恢复|造成|附加|降低|提升|额外|打出)/, hook: "onDamageDealt" },
  { re: /^(?:所有|每次|自身)?攻击(?:技能)?(?=(?:附带|附加))/, hook: "onDamageDealt" },
  { mk: (g) => { const t = g.match(/^有?(\d+)%(?=的?(?:概|几)?率?附加|附加)/); if (t === null) return undefined; return { hook: "onDamageDealt", weak: true, extra: { chance: +t[1] }, body: g.slice(t[0].length) }; } },
  { re: /^(?=附加(?:对手|对方|敌方|自身|\d|使|令))/, hook: "onDamageDealt", weak: true },
  { re: /^附加后[，,]?(?=若|当|对手|对方|敌方|自身|使|令|\d)/, hook: "onDamageDealt", weak: true },
  { re: /^攻击(?=[，,]?(?:附加|消除|清除))/, hook: "onDamageDealt" },
  { re: /^若?(?:自身|自己)?打出致命[一1]?击[，,、]?则/, hook: "onDamageDealt", extra: { guard: { prevCrit: true } } },
  { re: /^每次(?:自身|自己)?攻击(?:对手|对方|敌方)?(?=\d+%|的?\d+%|使|令|造成|恢复|附加)/, hook: "onDamageDealt" },
  { mk: (g) => { const t = g.match(/^(?:第[一1]个?回合|首个回合|第一个回合|首回合)[，,、]?/); if (t === null) return undefined; return { hook: "onEntry", extra: { injectTurns: 1 }, body: g.slice(t[0].length) }; } },
  { re: /^首次出战(?:时|后|，|,)?/, hook: "onEntry" },
  { re: /^(?:当回合|本回合)?(?:自身|自己)?攻击(?:技能)?击中(?:对手|对方|敌方)?(?:时|后|则(?:回合?结束?时)?)/, hook: "onDamageDealt" },
  { re: /^(?:若)?对手攻击(?:技能)?命中(?:自身|自己)?(?:时|后|则)/, hook: "onDamaged" },
  // "作为首发精灵时" → onBattleStart（首发=战斗开始部署）
  { re: /^(?:自身|自己)?作为首发精灵(?:时|，|,)?/, hook: "onBattleStart" },
  { mk: (g) => { const t = g.match(/^登场后首回合[，,、]?/); if (t === null) return undefined; return { hook: "onEntry", extra: { injectTurns: 1 }, body: g.slice(t[0].length) }; } },
  // ── onMiss（MISS 反制）──
  { re: /^(?:当|每次|若)?(?:当回)?对手攻击(?:技能)?(?:MISS|miss|未命中|落空)(?:时|后|则)/, hook: "onMiss", extra: { who: "foe" } },
  { re: /^(?:当|每次|若)?(?:当回)?(?:自身|自己)攻击(?:技能)?(?:MISS|miss|未命中|落空)(?:时|后|则)/, hook: "onMiss", extra: { who: "self" } },
  // ── 受击伤害阈值（onDamaged+guard；ctx.amount→lastDamage）──
  { mk: (g) => { const t = g.match(/^(?:若|当)?(?:自身|自己)?受到(?:对手|对方|敌方)?(?:直接)?(?:的)?(?:(?:攻击|技能)(?:的)?伤害|攻击|技能|伤害)?(?:的)?(?:伤害)?(?:高于|大于|超过)(\d+)(?:点)?[，,、]?(?:时|后|则)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { guard: { prevDamageAboveAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { mk: (g) => { const t = g.match(/^(?:若|当)?(?:自身|自己)?受到(?:对手|对方|敌方)?(?:直接)?(?:的)?(?:(?:攻击|技能)(?:的)?伤害|攻击|技能|伤害)?(?:的)?(?:伤害)?(?:低于|小于|不足)(\d+)(?:点)?[，,、]?(?:时|后|则)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { guard: { prevDamageBelowAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  // "自身当回合受到的攻击伤害低于N则回合结束时X" —— 当回合受击窗 + 回合末体（回合词在体内不走 当回合 前缀——钉扎：当回合受击→onTurnEnd+takenBelow）
  { mk: (g) => { const t = g.match(/^(?:若)?(?:当回合|本回合)?(?:自身|自己)?(?:(?:当|本)回合)?受到(?:的)?(?:攻击)?伤害(?:低于|小于|不足)(\d+)(?:点)?(?:，|,|、|\s)*(?:则)?/); if (t === null || !/(?:当|本)回合/.test(t[0])) return undefined; return { hook: "onTurnEnd", extra: { guard: { takenBelowAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^回合结束[时后][，,、]?/, "") }; } },
  { mk: (g) => { const t = g.match(/^(?:若)?(?:当回合|本回合)?(?:自身|自己)?(?:(?:当|本)回合)?受到(?:的)?(?:攻击)?伤害(?:高于|大于|超过)(\d+)(?:点)?(?:，|,|、|\s)*(?:则)?/); if (t === null || !/(?:当|本)回合/.test(t[0])) return undefined; return { hook: "onTurnEnd", extra: { guard: { takenAboveAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^回合结束[时后][，,、]?/, "") }; } },
  // "受到的攻击伤害高于自身最大体力的1/2" —— 分数门（onDamaged 时 lastTaken 已记账）
  { mk: (g) => { const t = g.match(/^(?:若|当)?(?:自身|自己)?受到(?:对手|对方|敌方)?(?:直接)?(?:的)?(?:攻击)?(?:的)?伤害(?:高于|大于|超过)自身最大体?力(?:值)?的?(\d+)\/(\d+)[，,、]?(?:时|后|则)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { guard: { takenAboveHpFrac: { numerator: +t[1], denominator: +t[2] } } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  // "将对手攻击伤害N%反馈给对手" → onDamaged + reflect_dmg（"反馈"≈反弹）
  { mk: (g) => { const t = g.match(/^(?:将|把)?(?:对手|对方|敌方)(?:的)?攻击伤害(\d+)%(?:的)?(?:伤害)?反馈给(?:对手|对方|敌方)/); if (t === null) return undefined; return { hook: "onDamaged", body: `将受到的攻击伤害${t[1]}%反弹给对手` + g.slice(t[0].length) }; } },
  // "对手造成(的)伤害低于/高于N则X"（foe 出伤=自身受击——onDamaged+guard，则体触发词再分派可改挂 onTurnEnd）
  { mk: (g) => { const t = g.match(/^(?:对手|对方|敌方)造成(?:的)?(?:攻击)?(?:的)?(?:伤害)?(?:高于|大于|超过)(\d+)(?:点)?[，,、]?(?:时|后|则)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { guard: { prevDamageAboveAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { mk: (g) => { const t = g.match(/^(?:对手|对方|敌方)造成(?:的)?(?:攻击)?(?:的)?(?:伤害)?(?:低于|小于|不足)(\d+)(?:点)?[，,、]?(?:时|后|则)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { guard: { prevDamageBelowAbs: +t[1] } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  // ── 背包作用域（benchNameCount 守卫——"背包内每存在N种X精灵时每回合Y"）──
  // 存活计数缩放（"己方每有一只精灵存活则恢复50点"→heal flatPerAlive{per:1}——flat 被替换为 存活数×add）
  { mk: (g) => { const t = g.match(/^(?:己方|背包内?|己方场下)(?:每有|有)(?:一|1)只?精灵存活则?/); if (t === null) return undefined; return { hook: "onTurnEnd", weak: true, extra: { flatPerAlive: true }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { mk: (g) => { const t = g.match(/^背包内?每存活(?:一|1)只?精灵则?/); if (t === null) return undefined; return { hook: "onTurnEnd", weak: true, extra: { flatPerAlive: true }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { mk: (g) => { const t = g.match(/^背包内每存在(\d+|一)种(.+?)(?:兄弟)?精灵(?:时|，|,|。)/); if (t === null) return undefined; return { hook: "onTurnEnd", extra: { guard: { benchNameCount: { substr: t[2].replace(/精灵$/, ""), count: t[1] === "一" ? 1 : +t[1] } } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "").replace(/^(?:自身)?每回合(?:开始|结束)?(?:时|后|，|,)?/, "") }; } },
  // 无物种名的"每存在N种精灵" → 按背包存活计数缩放（flatPerAlive 近似：species-unique→living-count）
  { mk: (g) => { const t = g.match(/^背包内每存在(?:\d+|一)?种精灵(?:时|，|,|。)?/); if (t === null) return undefined; return { hook: "onTurnEnd", weak: true, extra: { flatPerAlive: true }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "").replace(/^(?:自身)?每回合(?:开始|结束)?(?:时|后|，|,)?/, "") }; } },
  // ── 首回合/前N回合窗口（onEntry + injectTurns——计时效果按注入回合数递减）──
  { mk: (g) => { const t = g.match(/^(?:前|登场后前|出场后前|出场前|登场前|(?:每次|自身|自己|自身每次|自己每次)?(?:登场|出场)(?:之?后|时))(\d+)回合(?:内)?|^登场(\d+)回合内|^出场(\d+)回合内|^(?:每次)?(?:自身|自己)?(?:每次)?(?:登场|出场)首回合(?:内)?|^(?:出场|登场)?首回合(?:内)?|^效果(?:是|为)?首次登场|^每次登场首次?攻击(?:技能)?/); if (t === null) return undefined; const turns = +(t[1] ?? t[2] ?? t[3] ?? 1); return { hook: "onEntry", extra: { injectTurns: turns }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  // ── 使用所有技能 ──
  { re: /^使用所有技能(?:都有|时|，|,)/, hook: "onMoveUsed", extra: { actor: "self" } },
  // “属性技能命中后”在 resolveHit 成功后派发 onMoveUsed；onDamageDealt 不会收到无伤害的属性招式。
  { re: /^(?:当|每次)?(?:自身|自己)?属性技能命中(?:后|时|则|，|,)/, hook: "onMoveUsed", extra: { actor: "self", cat: 1 } },
  { re: /^对手(?:每次)?属性技能命中(?:后|时|则|，|,)/, hook: "onMoveUsed", extra: { actor: "foe", cat: 1 } },
  // "每经过/每隔 N 个回合 X" → __turn__ + everyNTurns 守卫（周期门；"每经过3回合，X积蓄强力攻击"）
  { mk: (g) => { const t = g.match(/^每(?:经过|隔|过)(\d+)个?回合(?:，|,|、|\s)*(.+)$/); if (t === null) return undefined; return { hook: "__turn__", extra: { guard: { everyNTurns: +t[1] }, injectTurns: 1 }, body: t[2] }; } },
  // "使用攻击(技能)时 X"（无"技能"裸形——"使用攻击时50%附加…"）
  { re: /^(?:每次|当|若)?(?:自身|自己)?(?:每次|每回)?(?:使用|释放)攻击(?:技能)?(?:时|后|，|,|则)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, useTime: true },
  // "对手(使用)?(物理|特殊)攻击命中自身时X" → onDamaged + cat（命中侧事件）
  { mk: (g) => { const t = g.match(/^对手(?:每次)?(?:使用|释放)?的?(物理|特殊)攻击(?:技能)?命中(?:自身|自己)(?:时|后|则|，|,)/); if (t === null) return undefined; return { hook: "onDamaged", extra: { cat: t[1] === "物理" ? 2 : 3 }, body: g.slice(t[0].length) }; } },
  // "双方出手后X" → 回合末结算（双侧行动完毕≈onTurnEnd UNVERIFIED）
  { re: /^(?:双方|敌我双方)出手后[，,、]?/, hook: "onTurnEnd" },
  // "对手攻击技能命中自身时X"/"对手技能命中时X" —— 受击钩（cat 未声明按全类）
  // 注意：这里**不**收「或」前缀——并列触发词（"自身攻击技能命中对手后或对手攻击技能命中自身后"，
  // pet-3825）若在此放行，body 二次匹配会**替换** hook（soulmark-parse.mjs 的 `hook = nhook`），
  // 第一个触发词（我方命中对手）的条目会被覆盖掉——残文归零但语义丢一半。
  // 正确形态是同一组 payload 挂两个 hook（两条条目），属「并列触发词」机制缺口。
  { re: /^对手(?:每次)?(?:使用|释放)?的?(?:攻击技能|技能|攻击)?命中(?:自身|自己)?(?:时|后|则|，|,)/, hook: "onDamaged" },
  // "对手攻击时X"（pet-4587「奇数回合对手攻击时70%闪避对手的攻击」）——对手发动攻击＝我方受击，
  // 与上一条同钩（onDamaged）。**只认「对手攻击时」这一形态**：带「使用攻击技能时」的是纯用技
  // 反应窗（onMoveUsed actor:foe），不能改挂 onDamaged，否则触发时机整体前移。
  { re: /^(?:对手|对方|敌方)(?:每次)?攻击时[，,、]?/, hook: "onDamaged" },
  // ── 条件窗（standalone "若P则X" → onTurnEnd+guard+turns:1 刷新窗）──
  // "若回合开始/结束时P则X"（触发词内嵌 cond——精确钩子 + guard；"若回合结束时自身满体力则恢复1/4"）
  { mk: (g) => { const t = g.match(/^若(?:每|当)?回合(开始|结束)[时后](?:，|,|、|\s)*(.{2,24}?)(?:，|,|、|\s)*则(.+)$/); if (t === null) return undefined; const c = smCondOf(t[2].replace(/^处于/, "自身处于")); if (c === undefined) return { hook: t[1] === "开始" ? "onTurnStart" : "onTurnEnd", extra: { guardDropped: t[2] }, body: t[3] }; const subs = c.and ?? [c]; if (subs.some((x) => x.order !== undefined)) return undefined; return { hook: t[1] === "开始" ? "onTurnStart" : "onTurnEnd", extra: { guard: c }, body: t[3] }; } },
  { mk: (g) => { const t = g.match(/^若(.{2,24}?)(?:，|,|、|\s)*则(.+)$/); if (t === null) return undefined;
      // cond 槽内的技能使用事件（"若对手使用属性技能则X"）→ onMoveUsed 钩子而非守卫谓词
      const um = t[1].match(/^(对手|对方|敌方|对方|自身|自己)?(?:每次|每回合)?(?:使用|释放|出手|打出)(属性|攻击|物理|特殊|的)?技能(?:时)?$/);
      if (um !== null) { const actor = um[1] !== undefined && /对手|对方|敌方/.test(um[1]) ? "foe" : "self"; const cat = um[2] === "属性" ? 1 : um[2] === "攻击" ? [2, 3] : um[2] === "物理" ? 2 : um[2] === "特殊" ? 3 : undefined; return { hook: "onMoveUsed", extra: { actor, ...(cat !== undefined ? { cat } : {}) }, body: t[2] }; }
      let c = smCondOf(t[1].replace(/^处于/, "自身处于"));
      if (c === undefined) return undefined;
      let body2 = t[2];
      // "若P，Q则X"——首逗号误切 P 边界（"若体力低于1/2，自身体力低于对手则X"）：body 首部再含谓词+则 时并入守卫
      const t2 = body2.match(/^(.{2,24}?)(?:，|,|、)*则(.+)$/);
      if (t2 !== null) { const c2 = smCondOf(t2[1].replace(/^处于/, "自身处于").replace(/时$/, "")); if (c2 !== undefined) { c = { and: [c, c2] }; body2 = t2[2]; } }
      const subs = c.and ?? [c]; if (subs.some((x) => x.order !== undefined || x.catStreakAtLeast !== undefined || x.moveCatSameAsPrev !== undefined || x.moveCatDiffPrev !== undefined)) return { hook: "onMoveUsed", extra: { actor: /对手|对方|敌方/.test(t[1] + (t2 !== null ? t2[1] : "")) ? "foe" : "self", guard: c }, body: body2 };
      return { hook: "__turn__", extra: { guard: c, injectTurns: 1 }, body: body2 }; } },
  // 裸 "P则X"（无"若"——"对手处于失明状态则…"/"攻击伤害高于400则…"）：仅当 P 可解为谓词才接管
  // "P每处于N种能力(提升|下降)(状态)?则X" —— per-stage 缩放前缀（非门控，乘算语义）：注入 part 级前缀让 perStageCtx 生效
  { headOnly: true, mk: (g) => { const t = g.match(/^((?:自身|自己|对手|对方|敌方)?每(?:处于|有)(?:1|一|\d+)种能力(?:提升|强化|上升|下降|降低)(?:状态|扰态)?)则(.+)$/); if (t === null) return undefined; return { hook: "__turn__", body: `${t[1]}，${t[2]}` }; } },
  // "对手每有N只不在场精灵则X" —— bench 计数缩放前缀注入（foeBenchCtx）
  { headOnly: true, mk: (g) => { const t = g.match(/^((?:对手|对方|敌方)每有(?:\d+|一|两|二)只不在场(?:的)?精灵)则(.+)$/); if (t === null) return undefined; return { hook: "__turn__", body: `${t[1]}，${t[2]}` }; } },
  { headOnly: true, mk: (g) => { const t = g.match(/^(.{2,24}?)则(.+)$/); if (t === null || /^若/.test(g) || /^(?:回合|每回合|当回合|本回合|下回合|之后)/.test(t[1])) return undefined; const c = smCondOf(t[1].replace(/^处于/, "自身处于").replace(/时$/, "")); if (c === undefined) return undefined; const subs = c.and ?? [c]; if (subs.some((x) => x.order !== undefined || x.catStreakAtLeast !== undefined || x.moveCatSameAsPrev !== undefined || x.moveCatDiffPrev !== undefined || x.not?.catStreakAtLeast !== undefined || x.not?.moveCatSameAsPrev !== undefined || x.not?.moveCatDiffPrev !== undefined)) return { hook: "onMoveUsed", extra: { actor: /对手|对方|敌方/.test(t[1]) ? "foe" : "self", guard: c }, body: t[2] };
    // 事件谓词走事件钩子（"受到攻击伤害则X"→onDamaged；"攻击伤害高于N则X"→onDamageDealt——守卫随事件判定而非回合末）
    if (c.and === undefined && c.or === undefined) {
      if (c.not?.prevTakenZero === true) return { hook: "onDamaged", body: t[2] };
      const evKeys = Object.keys(c);
      if (evKeys.length === 1) {
        if (/^(?:prevDamage|dealt|prevCrit|prevHeal)/.test(evKeys[0])) return { hook: "onDamageDealt", extra: { guard: c }, body: t[2] };
        if (/^taken/.test(evKeys[0])) return { hook: "onDamaged", extra: { guard: c }, body: t[2] };
      }
    }
    return { hook: "__turn__", extra: { guard: c, injectTurns: 1 }, body: t[2] }; } },
  // "X时Y"变体——仅限移动谓词（"使用技能类型与上次相同时先制+1"——无"则"的 catStreak/moveSame 守卫切分；泛"时"切会误伤"回合开始时"类真触发词，故收窄）
  { headOnly: true, mk: (g) => { const t = g.match(/^(.{2,24}?)时(.{2,})$/); if (t === null || /^若/.test(g) || /^(?:回合|每回合|当回合|本回合|下回合|之后|回合开始|回合结束)/.test(t[1])) return undefined; const c = smCondOf(t[1].replace(/^处于/, "自身处于")); if (c === undefined) return undefined; const subs = c.and ?? [c]; const isMovePred = subs.some((x) => x.catStreakAtLeast !== undefined || x.moveCatSameAsPrev !== undefined || x.moveCatDiffPrev !== undefined || x.moveSameAsPrev !== undefined || x.moveDiffPrev !== undefined || x.not?.catStreakAtLeast !== undefined || x.not?.moveCatSameAsPrev !== undefined || x.not?.moveCatDiffPrev !== undefined || x.not?.moveSameAsPrev !== undefined || x.not?.moveDiffPrev !== undefined); if (!isMovePred) return undefined; return { hook: "onMoveUsed", extra: { actor: /对手|对方|敌方/.test(t[1]) ? "foe" : "self", guard: c }, body: t[2] }; } },
  // "每一次/每次(自身)恢复体力时X" → onTurnEnd + prevHealAbove:0 守卫（本回合回过血→结算；"每一次恢复体力，使自身下回合造成的伤害提升30%"）
  { re: /^每(?:一次|当|若)?(?:自身|自己)?(?:恢复|回复)(?:了)?体力(?:值|量)?(?:时|后|，|,|则)/, hook: "onTurnEnd", extra: { guard: { prevHealAbove: 0 } } },
  // "恢复(的)体力值低于/高于N则X"——当次回复量阈值守卫（__turn__ 继承 heal 所在钩，lastHeal 记账顺序读）
  { mk: (g) => { const t = g.match(/^若?恢复(?:的)?体力(?:值|量)?(低于|少于|不足|高于|超过)(\d+)(?:点)?(?:，|,|、|\s)*则(.+)$/); if (t === null) return undefined; const k = t[1]; return { hook: "__turn__", extra: { guard: /低|少|不足/.test(k) ? { prevHealBelow: +t[2] } : { prevHealAbove: +t[2] } }, body: t[3] }; } },
  // "若P触发X：Y"（无"则"，"："印记声明边界——"若对手不处于记忆破碎触发记忆破碎：该技能PP值归0"）
  { mk: (g) => { const t = g.match(/^若(.{2,24}?)(?=触发[一-龥·]{2,8}：)/); if (t === null) return undefined; const c = smCondOf(t[1].replace(/^处于/, "自身处于")); if (c === undefined) return undefined; const subs = c.and ?? [c]; if (subs.some((x) => x.order !== undefined)) return undefined; return { hook: "__turn__", extra: { guard: c }, body: g.slice(1 + t[1].length) }; } },
  // "每回合若P则X" —— 逐回合条件窗（__turn__ 哨兵 + guard + 1t 注入；有 turn 钩子时继承）
  { mk: (g) => { const t = g.match(/^每回合(?:开始|结束)?(?:时|，|,)?若(.{2,24}?)则(.+)$/); if (t === null) return undefined; const c = smCondOf(t[1].replace(/^处于/, "自身处于")); if (c === undefined) return undefined; const subs = c.and ?? [c]; if (subs.some((x) => x.order !== undefined || x.catStreakAtLeast !== undefined || x.moveCatSameAsPrev !== undefined || x.moveCatDiffPrev !== undefined)) return { hook: "onMoveUsed", extra: { actor: /对手|对方|敌方/.test(t[1]) ? "foe" : "self", guard: c }, body: t[2] }; return { hook: "__turn__", extra: { guard: c, injectTurns: 1 }, body: t[2] }; } },
  // "第一回合X"/"首回合X" —— 首回合窗（onBattleStart + 1t 注入——登场回合限定 UNVERIFIED）
  { mk: (g) => { const t = g.match(/^第[一1]回合[，,、]?(?:内)?(.+)$/) ?? g.match(/^首回合[，,、]?(?:内)?(.+)$/); if (t === null || t[1] === "") return undefined; return { hook: "onBattleStart", extra: { injectTurns: 1 }, body: t[1] }; } },
  { re: /^(?:首|第一)回合[，,、]?$/, hook: "onBattleStart", extra: { injectTurns: 1 } },
  // "下次使用技能先制±K" → beforeOrder 一次性排序加权（"下次"≈下一次行动 UNVERIFIED）
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?下次(?:(?:使用|所有|全部|攻击)?技能?)?先制([+-]\d+)$/); if (t === null) return undefined; const v = parseInt(t[1], 10); return { hook: "__beforeOrderOnce__", extra: { prioV: v }, body: "" }; } },
  // "下回合X"/"自身下回合X" → onTurnEnd + 1t 注入（回合末开窗覆盖次回合——EXACT；不误吞"下回合开始/结束时"）
  { re: /^(?:自身|自己)?下回合(?!开始|结束|时)[，,、]?/, hook: "onTurnEnd", weak: true, extra: { injectTurns: 1 } },
  // "本回合X"/"当回合X" → onTurnEnd + 1t 注入（次轮窗近似"当回合"——±1 回合 UNVERIFIED；不误吞"本回合未受击"族；命中语境"当回合攻击击中"交 onDamageDealt）
  { re: /^(?:本回合|当回合)(?!开始|结束|未|没|自身攻击|攻击击中|攻击命中|自身出手|对手攻击)[，,、]?(?:内)?/, hook: "onTurnEnd", weak: true, extra: { injectTurns: 1 } },
  // ── 本回合未受击 → onTurnEnd + prevTakenZero 守卫 ──
  { re: /^(?:若)?(?:本回合|回合内|每回合)?未受到(?:攻击|攻击伤害|伤害)/, hook: "onTurnEnd", extra: { opIf: { prevTakenZero: true } } },
  { re: /^(?:若)?(?:本回合|回合内)(?:没有|未)受到(?:攻击|攻击伤害|伤害)/, hook: "onTurnEnd", extra: { opIf: { prevTakenZero: true } } },
  // "N%的几率将本回合受到的伤害转化为自身体力" → onDamaged + chance + dmg_to_heal（消费全短语，body 合成等价受击转化句式）
  { mk: (g) => { const t = g.match(/^(\d+)%(?:的?(?:几|概)?率)?将本回合受到(?:的)?伤害转化为自身体力/); if (t === null) return undefined; return { hook: "onDamaged", extra: { chance: +t[1] }, body: "受到的伤害转化为自身体力" + g.slice(t[0].length) }; } },
  // "将本回合受到的伤害转化为自身体力"（无概率版） → onDamaged + dmg_to_heal
  { mk: (g) => { const t = g.match(/^将(?:本回合|当回合)?受到(?:的)?(?:攻击)?伤害转化为自身体力/); if (t === null) return undefined; return { hook: "onDamaged", body: "受到的伤害转化为自身体力" + g.slice(t[0].length) }; } },
  // "有N%几率使对手X"/"N%概率令对手X" → onDamageDealt + chance（命中后附加语义；动词零宽保留给 inner）
  { mk: (g) => { const t = g.match(/^有?(\d+)%(?:的?(?:几|概)?率)?(?=(?:使|令|消除|清除|附加|造成|恢复)对手)/); if (t === null) return undefined; return { hook: "onDamageDealt", weak: true, extra: { chance: +t[1] }, body: g.slice(t[0].length) }; } },
  // 通用"N%几率X"（不限目标——"40%几率使自身损失"承接使用技能钩子；动词零宽）
  { mk: (g) => { const t = g.match(/^有?(\d+)%(?:的?(?:几|概)?率)?(?=(?:使|令|消除|清除|解除|附加|造成|恢复|降低|提升))/); if (t === null) return undefined; return { hook: "onDamageDealt", weak: true, extra: { chance: +t[1] }, body: g.slice(t[0].length) }; } },
  // KO：自身倒下（先于"击败对手"——"自身被击败"含"击败"子串）
  { re: /^(?:当|若)?(?:(?:自身|自己)(?:被击败|倒下|死亡|被击倒|战败|被(?:对手|对方|敌方)击败)|被(?:对手|对方|敌方)击败|被击败|被打败|被击倒)(?:时|后|则)?[，,、\s]*(?:则)?|^死亡后|^死亡时(?=对手|对方|敌方|下|自身|自己|则|使|令|将|反|恢复|回复|吸收|消除|清除|随机|，|,)/, hook: "onKO", extra: { victim: "self" } },
  { re: /^(?:每次|当|每)(?:自身|自己)?(?:击败|击杀|战胜)(?:对手|对方|敌方|对方出战)?(?:一|1)?只?(?:精灵)?(?:时|后|，|,)/, hook: "onKO", extra: { victim: "foe" } },
  { re: /^每击败(?:对手|对方|敌方|对方出战)?(?:一|1)?只?精灵|^(?:击败|击杀|击倒|战胜)(?:对手|对方|敌方)(?:时|后|则)|^(?:自身|自己)(?:击败|击杀|击倒|战胜)(?:对手|对方|敌方)(?:时|后|则)?/, hook: "onKO", extra: { victim: "foe" } },
  // "对手换下则下只出战精灵X" → onSwitchOut + retarget:nextFoe（nextInFx 延迟结算；必须先于裸换下规则）
  { mk: (g) => { const t = g.match(/^(?:每次)?对手(?:每次)?(?:主动)?(?:换下|切换下场|切换离场|离场|下场|被换下|切换精灵|主动切换)(?:时|后|则)(?:对方|对手|敌方)?下一只?(?:出战)?精灵(?:出战|登场)?时?/); if (t === null) return undefined; return { hook: "onSwitchOut", extra: { switcher: "foe", retarget: "nextFoe" }, body: g.slice(t[0].length) }; } },
  // 换场（"换下"先于"登场"）
  { re: /^(?:每次)?对手(?:每次)?(?:主动)?(?:换下|切换下场|切换离场|离场|下场|被换下|切换精灵|主动切换)(?:时|后|则)?/, hook: "onSwitchOut", extra: { switcher: "foe" } },
  // "首次使用攻击技能X" → onMoveUsed + limitBattle（全场仅一次）
  { re: /^(?:本场战斗中)?首次使用攻击技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3], limitBattle: true } },
  { re: /^(?:当|每次|若)?(?:自身|自己)?使用必中技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", alwaysHit: true } },
  { re: /^(?:当|每次|若)?(?:自身|自己)?使用非必中技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", alwaysHit: false } },
  { re: /^(?:若|当)?(?:自身|自己)?攻击技能先出手(?:时|则)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3], guard: { order: "first" } } },
  { re: /^(?:若|当)?(?:自身|自己)?攻击技能后出手(?:时|则)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3], guard: { order: "last" } } },
  { re: /^(?:若|当)?(?:自身|自己)?属性技能先出手(?:时|则)/, hook: "onMoveUsed", extra: { actor: "self", cat: 1, guard: { order: "first" } } },
  // "双方任意一方使用技能时X" → onMoveUsed actor 双侧（dupActor→self+foe 双发条目——单侧语义按"对手"指代翻转近似 UNVERIFIED）
  { re: /^(?:双方|敌我)?任意一方使用技能(?:时|后|，|,)?|^双方(?:任意一方)?使用技能时/, hook: "onMoveUsed", extra: { actor: "self", dupActor: true } },
  { re: /^(?:每次)?(?:敌我双方|双方)(?:任意一方|中任意一方|之一)?使用攻击技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3], dupActor: true } },
  { re: /^(?:每次)?(?:敌我双方|双方)(?:任意一方|中任意一方|之一)?使用属性技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", cat: 1, dupActor: true } },
  { re: /^首次(?:攻击|出手|使用技能)(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", limitBattle: true } },
  { re: /^首次使用属性技能(?:时|后|则|，|,)?/, hook: "onMoveUsed", extra: { actor: "self", cat: 1, limitBattle: true } },
  // "自身每次出手时X"/"出手时X"/"当出手时自身体力少于1/2时X" → onMoveUsed（出手≈出招；余文 HP 谓词落 pendingCond 守卫）
  // 尾词收「后」：「出手后恢复…」（出手之后）同样是出招时点——原来只认 时/，/,，
  // 「出手后」整组匹配不上触发词，回血那半句被丢掉、只留「并造成等量固定伤害」。
  { re: /^(?:当|若)?(?:自身|自己)?(?:每次|每次出手|出手)(?:时|后|，|,)[，,、]?(?=若|当|造成|使|令|附加|恢复|消除|清除|\d|有|自身体力|自身HP|对手|自身|使)/, hook: "onMoveUsed", extra: { actor: "self" } },
  { re: /^(?:当|每次)?(?:自身)?(?:主动)?(?:换下|离场|下场|撤退|被换下|切换下场)(?:时|后)/, hook: "onSwitchOut" },
  { mk: (g) => {
    const m = g.match(/^(?:每次)?(?:自身)?(?:直接)?攻击(?:技能)?(?:(?:时|后)(?=有?\d+%|使|令|附加|恢复|造成)|(?=有(?:自身|自己)(?:当前)?(?:体力|HP)百分比))/);
    if (m === null) return undefined;
    // 动态概率家族需保留「攻击有」前缀给 inner；钩子仍必须是每次攻击而非开战。
    const dynamic = /有(?:自身|自己)(?:当前)?(?:体力|HP)百分比/.test(g);
    return { hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, body: dynamic ? g : g.slice(m[0].length) };
  } },
  // "第N回合X"——回合序数窗（onTurnStart+turnEq guard）
  { mk: (g) => { const t = g.match(/^第(\d+)回合(?:，|,|，|时)?/); if (t === null) return undefined; return { hook: "onTurnStart", extra: { guard: { turnEq: +t[1] } }, body: g.slice(t[0].length) }; } },
  // "结束时X"/"战斗阶段结束时X"（"回合结束时"截断/变体——仅当余文以效果动词起首才接管，防吞"战斗结束时"；阶段=回合近似 UNVERIFIED）
  { re: /^(?:战斗阶段)?结束[时后](?=恢复|回复|吸取|吸收|令|使|附加|消除|造成|提升|提高|减少)|^(?:(?:自身|自己)?回合|当回合)?结束[时后]/, hook: "onTurnEnd" },
  { re: /^(?:当|每次|首次)?(?:自身|自己)?(?:登场|出场|上场|出战|上阵|切换上场|替换上场|换入)(?:时|后|之后)/, hook: "onEntry" },
  { re: /^自身登场时/, hook: "onEntry" },
  { re: /^(?:自身|自己)?(?:每次|每)(?:登场|出场|上场|入场)(?:时|后|，|,)|^登场时|^出场时/, hook: "onEntry" },
  // 致命伤害——legacy endure 语义族；复杂体转 unparsed（S3）
  { re: /^(?:当|受到)?致命(?:一击|伤害|攻击)(?:时|后)|^(?:若|当)?(?:自身|自己)?(?:下[一1]?次|下次|首次|首回合)?受到?致[死命](?:攻击|伤害|一击|伤|命)?(?:时|后|则|(?=残留|保留|余下|留下|剩|不死))/, hook: "__fatal__" },
  // 受击
  { re: /^(?:当|每次)?(?:自身|自己)?(?:每次|每回)?(?:[受到收]到|受打)(?:对手|敌方)?(?:攻击|攻击伤害|伤害|技能攻击)(?:时|后|则)/, hook: "onDamaged" },
  // "受到伤害双防+3"/"受到攻击后X"裸承接（无时/后词尾，动词前瞻）
  { re: /^(?:自身|自己)?受到(?:对手|对方|敌方)?(?:的)?(?:攻击)?伤害(?=双防|防御|特防|攻击|速度|命中|体力|全属性|恢复|附加|令|使|造成)/, hook: "onDamaged" },
  // kind-限定承伤触发（"受到真实/固定/百分比伤害后X"→onDamaged+takenKind 守卫，依赖 lastTakenKind 记账）
  { mk: (g) => { const t = g.match(/^(?:当|每次)?(?:自身|自己)?受到(真实|固定|百分比)伤害(?:时|后|则)/); if (t === null) return undefined; const kind = t[1] === "真实" ? "true" : t[1] === "固定" ? "fixed" : "percent"; return { hook: "onDamaged", extra: { guard: { takenKind: kind } }, body: g.slice(t[0].length).replace(/^[，,、\s]+/, "") }; } },
  { re: /^(?:若|当)?miss(?:时|后|则)/i, hook: "onMiss", extra: { who: "foe" } }, // "miss时X"——对手攻击落空（自身闪避）
  { re: /^(?:自身|自己)?[受到收]到(?:对手|敌方)?攻击(?=\d+%)/, hook: "onDamaged" },
  { re: /^对手攻击(?:自身)?时|^对手(?:每次)?攻击时/, hook: "onDamaged" },
  // 技能使用（限定 cat 的先于通用）
  // "自身每使用N次攻击技能则X" → onMoveUsed + opParams.growPer（N 击一步成长窗）
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?每使用(\d+)次攻击技能(?:时|后)?则?/); if (t === null) return undefined; return { hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3], opParams: { growPer: +t[1] } }, body: g.slice(t[0].length) }; } },
  // "自身每使用N次(属性|攻击)技能则X" → onMoveUsed（N=1→useGrow 重触发叠深：条目 growStep=幅值；N>1→opParams.growPer 步进窗）
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?每使用(\d+)次(属性|攻击)?技能(?:时|后)?则?/); if (t === null) return undefined; return { hook: "onMoveUsed", extra: { actor: "self", ...(t[2] === "属性" ? { cat: 1 } : t[2] === "攻击" ? { cat: [2, 3] } : {}), ...(+t[1] > 1 ? { opParams: { growPer: +t[1] } } : { useGrow: true }) }, body: g.slice(t[0].length) }; } },
  // "每受到N次攻击则X" → onDamaged + useGrow（每次受击幅值叠深）
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?每(?:受到|遭受)(\d+)次(?:的)?(?:攻击|攻击伤害|伤害)(?:时|后)?则?/); if (t === null) return undefined; return { hook: "onDamaged", extra: { actor: "self", ...(+t[1] > 1 ? { opParams: { growPer: +t[1] } } : {}), useGrow: true }, body: g.slice(t[0].length) }; } },
  // "每使用一次（攻击|属性）技能X" → onMoveUsed（"每使用一次"=每次使用，无计数窗）
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?每使用一次?(属性|攻击)?技能(?:时|后|则|，|,)?/); if (t === null) return undefined; return { hook: "onMoveUsed", extra: { actor: "self", ...(t[1] === "属性" ? { cat: 1 } : t[1] === "攻击" ? { cat: [2, 3] } : {}) }, body: g.slice(t[0].length).replace(/^(?:从下回合起|从下个回合起)(?:自身|自己)?在本场战斗中?/, "") }; } },
  // "（与X）每持续战斗N回合X" → onTurnEnd + everyNTurns（N=1 即逐回合；搭挡名前缀剥除）
  { mk: (g) => { const t = g.match(/^(?:与[^，,。；]{1,8})?每持续战斗(\d+)回合(?:时|后|则|，|,)?/); if (t === null) return undefined; return { hook: "onTurnEnd", extra: { guard: { everyNTurns: +t[1] } }, body: g.slice(t[0].length) }; } },
  // 「若…使用攻击/属性技能」单独成组（逗号后才是负载）——若形触发词到组尾就结束，没有「时/后/则」。
  // 尾段可省只对「若」形开放：若把通用触发词的尾段也放开，「每次自身使用攻击技能在…」
  // 「自身使用攻击技能前…」这类组尾会误落成裸触发组，把钩子结转给下一组——
  // 实测会让 4 条魂印回归（pet-3139/3525/3557/4347），残文净增。
  { re: /^若(?:自身|自己|我方|己方|本方)?(?:每次)?使用攻击技能$/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, useTime: true },
  { re: /^若(?:自身|自己|我方|己方|本方)?(?:每次)?使用属性技能$/, hook: "onMoveUsed", extra: { actor: "self", cat: 1 }, useTime: true },
  { re: /^(?:当|每次|若)?(?:自身|自己|我方|己方|本方)?(?:当回合|本回合)?(?:每次)?使用攻击技能(?:时|后|则|，|,|(?=附加|使|令|造成|恢复|消除|清除|降低|提升|减少|额外|吸取|有|都|\d))/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, useTime: true },
  { re: /^对手(?:每次)?使用攻击技能(?:时|后|则|，|,|(?=有|都))/, hook: "onMoveUsed", extra: { actor: "foe", cat: [2, 3] }, useTime: true },
  // "对手使用攻击技能命中率降低N%" → onMoveUsed foe + dodge（foe 命中率降幅≈自身闪避窗）
  { mk: (g) => { const t = g.match(/^对手(?:每次)?使用(?:攻击|属性)?技能命中率?(?:降低|下降|减少)(\d+)%/); if (t === null) return undefined; return { hook: "onMoveUsed", extra: { actor: "foe" }, body: `<acc_down ${t[1]}>` + g.slice(t[0].length) }; } },
  { re: /^(?:当|每次)?(?:自身|我方|己方|本方)?(?:当回合|本回合)?(?:每次)?使用(?:属性|工具)技能(?:时|后|则|，|,|(?=有|都|增加|使|令|附加|恢复|回复|吸取|减少|降低|提升|造成|消除|清除|额外|对|\d))/, hook: "onMoveUsed", extra: { actor: "self", cat: 1 }, useTime: true },
  { re: /^对手(?:每次)?使用属性技能(?:时|后|则|，|,|(?=有|都))/, hook: "onMoveUsed", extra: { actor: "foe", cat: 1 }, useTime: true },
  // 「自身当回合使用属性技能」与攻击技能规则同形（:1060 允许「当回合|本回合」中缀）——
  // 少了这一段，属性分支会落成 onBattleStart，并与同一子句里的攻击分支并成一条（pet-4272 卜云）。
  { re: /^(?:当|每次|若)?(?:自身|自己|我方|己方|本方)?使用属性技能(?:时|后|则|，|,|(?=有|都|恢复|回复|使|令|附加|吸取|造成))/, hook: "onMoveUsed", extra: { actor: "self", cat: 1 }, useTime: true },
  // "使用物理攻击时"/"使用特殊攻击时"（cat 精确：2=物理 3=特殊）
  { re: /^(?:当|每次|若)?(?:自身|自己)?(?:每次)?使用物理攻击(?:技能)?(?:时|后|则|，|,)/, hook: "onMoveUsed", extra: { actor: "self", cat: 2 } },
  { re: /^(?:当|每次|若)?(?:自身|自己)?(?:每次)?使用特殊攻击(?:技能)?(?:时|后|则|，|,)/, hook: "onMoveUsed", extra: { actor: "self", cat: 3 } },
  { re: /^(?:当|若)?(?:自身|自己)?使用物理攻击(?=恢复|回复|使|令|附加|造成|吸收|吸取|消除)/, hook: "onMoveUsed", extra: { actor: "self", cat: 2 } },
  { re: /^(?:当|若)?(?:自身|自己)?使用特殊攻击(?=恢复|回复|使|令|附加|造成|吸收|吸取|消除)/, hook: "onMoveUsed", extra: { actor: "self", cat: 3 } },
  { re: /^对手(?:每次)?使用物理攻击(?:技能)?(?:时|后|则|，|,)/, hook: "onMoveUsed", extra: { actor: "foe", cat: 2 } },
  { re: /^对手(?:每次)?使用特殊攻击(?:技能)?(?:时|后|则|，|,)/, hook: "onMoveUsed", extra: { actor: "foe", cat: 3 } },
  // "所有攻击技能X"/"所有技能X" —— 骑带式 rider（cat [2,3] / 全类别）
  { re: /^(?:所有|全部|每次使用)攻击技能(?:，|,|(?=使|令|附加|恢复|造成|消除|清除|降低|提升|减少|额外|吸取|有|都|\d))/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] }, useTime: true },
  { re: /^(?:所有|全部|每次使用)技能(?:，|,|(?=使|令|附加|恢复|造成|消除|清除|降低|提升|减少|额外|吸取|有|都|\d))/, hook: "onMoveUsed", extra: { actor: "self" }, useTime: true },
  // "自身攻击技能X"（动词骑带——消除/清除/恢复/造成/附加/先制）

  // 类别连用（"连续使用攻击/属性技能时X"）：上一动与本动同属攻击(2|3)或同属属性(1)。
  // 威力成长 / 把已附加固伤有条件翻倍不在本桶——__streakDefer__ 交回 deferred，不假装解析成功。
  // 纯「先制+N」走 beforeOrder（排序时读 prevMoveCat）；「先制+N且Y」先制单独成条，Y 仍是 onMoveUsed。
  { mk: (g) => {
    const t = g.match(/^(?:(对手|对方|敌方)|(?:自身|自己)?)连续(\d+)?(?:次|回合)?使用[\s，,]*(攻击|属性)技能(?:时|则)?/);
    if (t === null) return undefined;
    const actor = t[1] !== undefined ? "foe" : "self";
    const attack = t[3] === "攻击";
    const extra = { actor, cat: attack ? [2, 3] : 1, streak: attack ? "attack" : "status", ...(t[2] !== undefined ? { streakN: +t[2] } : {}) };
    const body = g.slice(t[0].length).replace(/^[，,、\s]+/, "");
    if (/威力|每连续|叠加|附加的?固定伤害翻倍|固伤翻倍/.test(body)) return { hook: "__streakDefer__", extra, body };
    const pm = actor === "self" ? body.match(/^先制\+(\d+)(?:[且并，,](.+))?$/) : null;
    if (pm !== null) {
      const rest = (pm[2] ?? "").replace(/^[，,、\s]+/, "");
      return { hook: rest === "" ? "__streakPrio__" : "onMoveUsed", extra: { ...extra, prioV: +pm[1] }, body: rest };
    }
    return { hook: "onMoveUsed", extra, body };
  } },
  // 同一技能连用（"连续使用同一技能 / 相同的技能时X"）：行动方回合初 prevMoveId 等于本动（运行时 sameMove）。不限类别。
  // 「相同类型」「每连续使用1回合再加」没有对应计数器，不在本桶（DEFERRED 负向先行只放行同一技能 / 相同的技能）。
  { mk: (g) => {
    const t = g.match(/^若?(?:(对手|对方|敌方)|(?:自身|自己)?)连续使用[\s，,]*(?:同一(?:个)?技能|相同的技能)(?:时|则)?/);
    if (t === null) return undefined;
    const actor = t[1] !== undefined ? "foe" : "self";
    const extra = { actor, sameMove: true };
    const body = g.slice(t[0].length).replace(/^[，,、\s]+/, "");
    if (/威力|每连续|每次触发|叠加|附加的?固定伤害翻倍|固伤翻倍/.test(body)) return { hook: "__streakDefer__", extra, body };
    const pm = actor === "self" ? body.match(/^先制\+(\d+)(?:[且并，,](.+))?$/) : null;
    if (pm !== null) {
      const rest = (pm[2] ?? "").replace(/^[，,、\s]+/, "");
      return { hook: rest === "" ? "__streakPrio__" : "onMoveUsed", extra: { ...extra, prioV: +pm[1] }, body: rest };
    }
    return { hook: "onMoveUsed", extra, body };
  } },
  // "受到的伤害大于N则X" → onDamaged + prevDamageAboveAbs op 守卫
  { mk: (g) => { const t = g.match(/^(?:自身|自己)?受到(?:的)?(?:攻击)?伤害(?:若)?(?:大于|高于|超过)(\d+)(?:点)?[，,、]?则?/); if (t === null) return undefined; return { hook: "onDamaged", extra: { opIf: { prevDamageAboveAbs: +t[1] } }, body: g.slice(t[0].length) }; } },
  // "下回自身X"（"下回合"缩写变体）→ onTurnEnd + 1t 注入
  { re: /^下回(?!合)(?:自身|自己)?[，,、]?/, hook: "onTurnEnd", extra: { injectTurns: 1 } },
  // "打出致命一击则X"/"致命一击后X" → onDamageDealt + prevCrit 守卫
  { mk: (g) => { const t = g.match(/^(?:自身)?(?:攻击)?(?:打出|造成)致命[一1]?击(?:时|后|则)[，,、]?/) ?? g.match(/^致命[一1]?击后[，,、]?/); if (t === null) return undefined; return { hook: "onDamageDealt", extra: { opIf: { prevCrit: true } }, body: g.slice(t[0].length) }; } },
  { re: /^(?:当|每次)?(?:自身)?(?:每次)?使用技能(?:时|后|则|，|,|(?=若))/, hook: "onMoveUsed", extra: { actor: "self" }, useTime: true },
  // 语料省略「时」时仍可能明确表示使用技能触发；保留显式类别门控，只在后接概率或效果谓词时承认。
  { mk: (g) => {
    const t = g.match(/^(?:当|每次|若)?(?:自身|自己)?(?:每次)?使用(攻击|属性|物理|特殊)?技能(?=有?\d+%|令|使|附加|恢复|回复|吸取|造成|消除|清除|降低|提升|增加|先制)/);
    if (t === null) return undefined;
    const cat = t[1] === "攻击" ? [2, 3] : t[1] === "属性" ? 1 : t[1] === "物理" ? 2 : t[1] === "特殊" ? 3 : undefined;
    return { hook: "onMoveUsed", extra: { actor: "self", ...(cat === undefined ? {} : { cat }) }, body: g.slice(t[0].length), useTime: true };
  } },
  { re: /^对手(?:每次)?使用技能(?:时|后|则|，|,|(?=若))/, hook: "onMoveUsed", extra: { actor: "foe" }, useTime: true },
  // 裸类别前缀（"属性技能吸取对手150点体力"——省略"使用"）
  { re: /^(?:自身|自己)?属性技能(?=\d|有|使|令|附加|吸取|恢复|造成)/, hook: "onMoveUsed", extra: { actor: "self", cat: 1 } },
  { re: /^(?:自身|自己)?攻击技能(?=\d|有|使|令|附加|吸取|恢复|造成)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  { re: /^(?:每次)?(?:自身)?直接攻击(?:都有|有|时)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  // "每次攻击都/时X"（无"直接"——频率词触发变体）
  { re: /^(?:自身|自己)?每次攻击(?:都|时|后|，|,|(?=有|使|令|附加|恢复|造成|吸|\d))/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  // "首次/第一次受到攻击X" → onDamaged + limitBattle（"第一次受到攻击伤害减少30%"）
  { re: /^(?:首次|第一次|初次)受到?(?:对手|对方|敌方)?的?(?:攻击|攻击伤害|伤害)(?:时|后|，|,|(?=减少|降低|减免|免疫|反弹|造成|附加|恢复|有|使|令))/, hook: "onDamaged", extra: { limitBattle: true } },
  { re: /^(?:自身)?攻击(?:技能)?(?=随机附加|有\d+%|必定)/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  // 致命一击触发型已被 onDamageDealt+prevCrit 守卫覆盖（顶部新规则先命中）
  // 先后手条件触发：保留"先出手时"在体内——parseEffectText 的 condPrefix 会产出 {order} 守卫挂到 ops 上
  { re: /^(?=(?:自身?)?先出手(?:时|则|，|,|自身|使|令|攻击|附加|恢复|造成)|(?:自身?)?后出手(?:时|则|，|,|自身|使|令|对手|附加|吸取|恢复)|先手时|后手时|先出手，|后出手，)/, hook: "onMoveUsed", extra: { actor: "self" } },
  // 对手先/后手：守卫挂在条目级 guard——condEval 的 order 是"行动方序位"，actor:foe 时即对手序位
  { re: /^(?:若|当)?(?:对手|对方|敌方)先出手(?:时|则|[，,])/, hook: "onMoveUsed", extra: { actor: "foe", guard: { order: "first" } } },
  { re: /^(?:若|当)?(?:对手|对方|敌方)后出手(?:时|则|[，,])/, hook: "onMoveUsed", extra: { actor: "foe", guard: { order: "last" } } },
  // "闪避则X"/"闪避成功则X" → onMiss who:foe（对手攻击落空=自身闪避）
  { re: /^(?:若)?闪避(?:成功)?(?:则|时|后)/, hook: "onMiss", extra: { who: "foe" } },
  // "攻击时X"：近似 on-use（命中语义归 post-damage-trigger 族单独处理）
  { re: /^(?:每次)?(?:自身)?攻击时/, hook: "onMoveUsed", extra: { actor: "self", cat: [2, 3] } },
  // 战斗开始
  { re: /^(?:进入)?战斗开始时/, hook: "onBattleStart" },
  // 回合开始/结束（"每回合"优先于"回合"）
  { re: /^每次回合开始时|^每回合开始时|^每回合开始(?=使|令|为|给|附|若|当|恢|对|自|吸|造|消|减|免|增|获|将|\d)|^回合开始时|^回合开始[，,、]|^回合开始$|^回合开始(?=使|令|若|当|恢复|对|自|吸|造|附|消|减|免|增|获|将|给|\d)/, hook: "onTurnStart" },
  { mk: (g) => { const t = g.match(/^(单数|奇数|偶数)回合(?:结束)?时?[，,、]?/); if (t === null) return undefined; return { hook: "onTurnEnd", extra: { opIf: { turnParity: /偶/.test(t[1]) ? "even" : "odd" } }, body: g.slice(t[0].length) }; } }, // "单数/偶数回合结束时X"——onTurnEnd + turnParity op 守卫
  { re: /^每次回合结束时|^每次回合结束后|^每回合结束时|^回合结束时|^在回合结束时|^回合结束[，,、]|^回合结束后|^在回合结束后|^战斗阶段结束[时后](?=.)|^战斗阶段结束[时后]?$|^战斗阶段结束(?=消除|清除|令|使|恢复|回复|吸取|附加|造成|对)|^每回合末|^回合结束$|^每回合结束(?!时)|^回合结束(?=使|令|若|当|恢复|对|自|吸|造|附|消|减|免|增|获|将|给)/, hook: "onTurnEnd" },
  // "使/令X回合开始/结束时Y"（中置回合词——"使自身回合结束后攻击+2"→onTurnEnd+atk+2；body 保留原文，回合短语是 foe_dot 路由判别词）
  { mk: (g) => { const t = g.match(/^(使|令)(自身|对手|对方|己方)?(?:在)?(回合结束[时后]|回合开始[时后])/); if (t === null) return undefined; return { hook: /开始/.test(t[3]) ? "onTurnStart" : "onTurnEnd", body: g }; } },
  // "每N回合X"——整除周期门（onTurnEnd + everyNTurns 守卫；"每2回合吸收1/3最大HP"）
  { mk: (g) => { const t = g.match(/^每(\d+)回合(?:内)?(?:开始|结束)?(?:时|后)?[，,、]?/); if (t === null) return undefined; return { hook: "onTurnEnd", extra: { guard: { everyNTurns: +t[1] } }, body: g.slice(t[0].length) }; } },
  // 裸"每回合X"（未明示开始/结束）：与 legacy turn_heal/turn_flat 同族 → 回合末结算。
  { re: /^每回合(?!开始|结束|末)/, hook: "onTurnEnd" },
  // 先制区间族（beforeOrder 需 prio 而非 ops——体解析命中"先制+X"时转 prio）
  { re: /^自身选择技能(?:时|的回合)|^选择技能的回合|^(?:自身)?出招前/, hook: "__order__" },
  // "若为攻击技能则X"/"若为属性技能则X"——出招类别门（cond 域外的 cat 直通条目 cat 字段）
  { mk: (g) => { const t = g.match(/^若(?:为|是|使用的?是|用的是)(攻击|属性)(?:类)?(?:的)?技能[，,、\s]*则/); if (t === null) return undefined; return { hook: "onMoveUsed", extra: { actor: "self", cat: t[1] === "属性" ? 1 : [2, 3] }, body: g.slice(t[0].length) }; } },
  // "若P则X"兜底（P 未建模——守卫显式掉落记 UNVERIFIED，效果体仍解析；置于队尾让 KO/换装/序位等真实触发先匹配）
  { mk: (g) => { const t = g.match(/^若(.{2,24}?)(?:，|,|、|\s)*则(.+)$/); if (t === null) return undefined; if (/护[盾罩](?:或|和|与)?护?[罩盾]?任意?(?:一|1)?个?消失/.test(t[1])) return undefined; const c = smCondOf(t[1].replace(/^处于/, "自身处于").replace(/时$/, "")); if (c !== undefined) return undefined; return { hook: "__turn__", extra: { guardDropped: t[1], injectTurns: 1 }, body: t[2] }; } },
];

/** 体文本中引用招式威力/类别的 op 键——魂印无招式上下文，检出即整条 unparsed。 */
const MOVE_CTX_KEYS = ["dynBase", "powerMul", "powerAdd", "powerSet", "scaleIf", "powerMax"];
const hasMoveCtx = (ops) =>
  ops.some((fx) => MOVE_CTX_KEYS.some((k) => k in fx));

/** 魂印体规范化：隐式主语补全（"处于X状态"=自身；"令其/使其"=对手）。仅作用于交 parseEffectText 前的 body。 */
const normalizeSoulBody = (s) =>
  s.replace(/[（(](?![^（）()]*[\d%/＋+])[^（）()]{1,24}[）)]/g, "") // 纯散文括注剥除（"（双方同时适用）"——枚举/数值括注保留）
    .replace(/[（(]([^（）()]*(?:死亡|残留|复活|阵亡|击败)[^（）()]*)[）)]/g, "，$1，") // 死亡/复活域括注抽为独立组（"（双方同时死亡时对手残留1点体力）"——不粘连主句，归 revive deferred）
    .replace(/^若?处于/, "若自身处于").replace(/^处于/, "若自身处于")
    .replace(/^(?:对手|对方|敌方)若/, "若对手")
    .replace(/令(?=其)/g, "令对手").replace(/使(?=其)/g, "使对手")
    .replace(/^(?:持有精灵|持有者|携带者)(?=造成的|的|使用|攻击|受到|每|当|若)/, "自身") // 持有侧主语归一（"持有精灵造成的…"=印记持有者自身）
    .replace(/最体力/g, "最大体力") // "吸取对手最体力1/3"漏字异体
    .replace(/的体力值/g, "的体力") // "恢复最大体力20%的体力值"——值字词尾冗余（"体力值之差"属内嵌不受影响）
    .replace(/(\d+)点P值/g, "$1点PP值") // "恢复1点P值"漏字异体
    .replace(/下(\d+)(?=受到)/g, "下$1次受到") // "免疫下1受到攻击伤害"缺次异体
    .replace(/受到受到/g, "受到") // 触发注入"受到"与原句重叠的双写
    .replace(/受到[，,、\s]+(?=攻击伤害|攻击|伤害)/g, "受到的") // "免疫下1受到 攻击伤害"断句标点→的
    .replace(/(体力|HP)[、，,](?:pp值|PP值?)[、，,]能力等级(?=返回)/g, "$1$2能力等级") // "体力、pp值、能力等级返回上回合"——枚举顿号粘连防切分
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/, "") // 圈号枚举序号剥除（"②恢复自身最大体力的1/3"）
    .replace(/(?<=触发[^：:，,、；;]{1,10}):/g, "：") // 印记声明半宽冒号归一（"触发残杀效果:…"→全宽，mk 触发表只收全宽）
    .replace(/精灵存货/g, "精灵存活") // OCR 异体（"背包每有一只精灵存货"=存活）
    .replace(/(\d+)%(?:的?(?:概率|几率))?触发[一-龥]{2,10}(?:：|:)/g, "$1%") // 具名效果内联定义（"25%触发虚空黑洞：吸取…"→25%门控直接绑 payload——名为标签不建模）
    .replace(/^(?:位于|处于)场内的/, "") // "位于场内的自身恢复…"——在场恒真冗余前缀
    .replace(/^[^，,、；;:：\d]{2,8}中(?=随机)/, "") // "星赐中随机N种异常"——印记域内随机施加，域前缀由 mark-declaration 链承担
    .replace(/领(?=对手|对方|敌方)/g, "令") // "领对手"为"令对手"爬取形变异体
    .replace(new RegExp(`(?:令|使)(?:敌我)?双方(${AIL_ALT})(?:状态)?`, "g"), (_, a) => `令对手${a}，令自身${a}`) // "令敌我双方流血"→双侧异常各挂一条（同条目两 op）
    .replace(/额外(?=(?:提升|提高|增加|叠加)\d+%)/g, "") // "触发几率额外提升10%"——额外=副词，成长尾词形归一
    .replace(/^[A-Za-z0-9αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]{1,4}[：:]/, "") // 代号前缀剥除（"M3：每回合…"/"α：自身处于…"——单宠代号声明，非印记分界）
    .replace(/^(?:自身|自己)?在?(?:本场战斗中|本场战斗中时)[，,、]?/, "") // "自身(在)本场战斗中攻击技能命中后…"——战域恒真前缀
    .replace(/^(?:自身|自己)?每回合(?=有)/, "自身") // "自身每回合有70%闪避"——常驻概率窗（dodge 逐击判定等价回合轮）
    .replace(/^触发后/, "之后") // "触发后X"≈后续子句（免疫反弹触发的后续结算近似）
    .replace(/^(?:则|，|,|、)*转变为/, "") // "P时转变为造成伤害的75%恢复自身体力"——转变=数值重述前缀（守卫由条件层承载）
    .replace(/^(?:在|受|受到)[^，,、；;：:]{1,10}(?:庇护|庇佑|祝福|眷顾|加护|保佑)下[，,、]?/, "") // "在风神的庇护下，X"——修饰性开场白剥除
    .replace(/^(?:其|该|此)?效果(?:是|为)[：:]?/, "") // "其效果为回合结束时…"——散文引导词剥除
    .replace(/^(?:自身|自己)?天生(?=免疫|不受|拥有|具有)/, "自身") // "自身天生免疫…"——"天生"=常驻修饰词
    .replace(/^(若?)我方(?=使用|受到|攻击|每|先)/, "$1自身") // "若我方使用攻击技能"——我方=自身近似（魂印语境持有者即行动方）。
    // 用 $1 回填：原句有「若」才带「若」，原句没有（「我方攻击必定致命」）就不凭空加——
    // 原来写死替换成「若自身」，会给无「若」的段平白套上条件（pet-3361 残文「若自身攻击必定致命」）。
    .replace(/^(?:自身|自己)?(?:所有|全部|每次|每次使用)攻击(?:技能)?(?=无视|穿透|必定致命|必中)/, "") // "自身所有攻击无视对手强化"——主语前缀剥除走裸效果路径
    .replace(/^若若/, "若").replace(/^赛尔号[^，,；;。·]*[·：:]/, "")
    .replace(/且(?=本场战斗|每回合|下回合|回合结束|当前回合|登场)/g, "，") // "X且本场战斗Y"——窗口词起的并列子句切分（窄域防误切"且"连动词）
    .replace(/^(?:自身|自己)?回合结束时/, "每回合").replace(/^当回合结束时/, "每回合").replace(/^战斗阶段结束时/, "每回合").replace(/^结束时(?=恢复|回复|吸取|令|使)/, "每回合") // "自身/当回合/战斗阶段结束时恢复…"→每回合 tick（回合末结算近似，UNVERIFIED±0）
    .replace(/^效果(?:是|为|：|:)?(?=每次|每|自身|对手|对方|敌方|攻击|使|令|在|当|若)/, "") // "效果每次攻击…"——"效果"引导词剥除（非招式文本的"效果："头——那边有独立通道）
    .replace(/^回合结束(?!时|后|后，|,)/, "回合结束时").replace(/^回合开始(?!时|后|后，|,)/, "回合开始时") // "回合结束使…"无时变体→带时（内层按每回合归一）
    .replace(/^(?:自身|自己)(?:所有|全部|每种)?(?:攻击|属性|物理|特殊)?技能?的?(?=致命|暴击|命中|先制|威力|伤害|PP|pp|附加)/, "") // 体首属主前缀（"自身所有攻击技能的致命一击几率上升1/16"——归属语境在 soulmark 恒为自身招式）
    .replace(/^第[一1]个?回合[，,、]?/, "当回合") // 体首"第一回合"≈当回合窗（登场/首回合语境等价）
    .replace(/^(?:若|当)?(?:自身|自己)?位于场上时[，,、]?/, "") // "位于场上时"——魂印持有者出战恒真冗余前缀
    // R4 同义改写：只改写成技能规则表已认的旧句式，不补数、不换主语
    .replace(/^(?:恢复|回复)(?:自身|自己)?(\d+)(?:点)?(?:Hp|HP|hp|体力)$/, "恢复自身$1点体力") // "恢复200Hp"/"恢复自身200体力"
    .replace(/^自身(?=受到(?:物理|特殊)攻击(?:时|后|则))/, "") // "自身受到物理攻击时X"——受击方恒为持有者，自身主语冗余（落回"受到物理攻击时"旧句式）
    // "自身攻击|技能…"——魂印里行动方恒为持有者，自身主语冗余（同上一行的受击侧）。成对锚（可选的"技能"引导词必须在"攻击"之前）
    // 防止从"自身攻击[技能]…"中间截断；若剥后落不到规则表，内层路径会把它退回来，不产生新语义。
    .replace(/^自身(?=(?:技能)?(?:攻击|技能)(?:技能)?(?:必定|必中|忽略|命中|后|时|有|\d|造成|打出|附加|附带|吸取|消除|使|令))/, "")
    // 同上，句首"自身"落在一个旧句式动词上时冗余（"自身使用技能…"=裸"使用技能…"）：动词锚定，不会从"自身使用技能时吸取…"中间截断
    .replace(/^自身(?=使用技能)/, "")
    .replace(/所有技能命中时/g, "所有技能命中后") // "命中时"与"命中后"同挂点（规则表只认后者），不改数、不改主语
    .replace(/清除(对手|对方|敌方)回合类效果/g, "消除$1回合类效果")
    .replace(/恢复自身所有体力和技能PP值/g, "恢复自身所有体力、恢复自身所有技能PP值")
    .replace(/^(对手|对方|敌方)(\d+)回合内(?:所有)?技能(?:无效|失效)$/, "$1下$2回合技能无效")
    .replace(/[（(][^（()）]*$/, ""); // 未闭合括号尾（爬取截断——"所有攻击先制+1（金角魔王和银角魔王"）

/** inner 自消化"效果翻倍"幻影旗接管：probe.effDoubleFlag 标记的 powerMul/scaleIf{2/1} 只是占位——就地翻倍 probe.effects 后删旗（裸句 probe 路径专用，常规路径走 doMount）。 */
const applyPhantomDouble = (probe) => {
  const pk = probe.effDoubleFlag;
  if (pk === undefined || probe.flags?.attachDamage?.[pk] === undefined) return;
  const pc = probe.flags.attachDamage[pk]?.when;
  const clones = [];
  for (const o of probe.effects) {
    if (pc !== undefined && (o.op === "damage" || o.op === "heal")) o.mulIf = { when: pc, numerator: 2, denominator: 1 };
    else if (o.op === "apply_stat_stage" && o.delta > 0) { if (pc !== undefined) o.deltaMulIf = { when: pc, numerator: 2, denominator: 1 }; else o.delta *= 2; }
    else if (o.op === "heal" && o.numerator !== undefined) o.numerator *= 2;
    else if (o.op === "apply_status") {
      if (pc !== undefined) clones.push({ ...o, params: { ...o.params }, if: pc });
      else if (o.params?.flat !== undefined) o.params.flat *= 2;
      else if (o.params?.pct !== undefined) o.params.pct *= 2;
      else if (o.params?.n !== undefined) o.params.n *= 2;
    }
  }
  probe.effects.push(...clones);
  delete probe.flags.attachDamage[pk];
};

const SOUL_SUBJECT_KEYS = ["actor", "victim", "who", "switcher", "cat", "streak", "streakN", "sameMove", "alwaysHit"];

function isBareSoulCondition(g) {
  if (g == null || typeof g !== "object" || Array.isArray(g)) return false;
  const keys = Object.keys(g);
  return keys.length === 1 && !SOUL_SUBJECT_KEYS.includes(keys[0]) && keys[0] !== "if";
}

/** 主语收进 guard，概率收成 chance 闭类型。解析过程仍用旧字段，出口和已存储包走这一个函数。 */
export function liftSoulEntry(e) {
  if (e == null || typeof e !== "object" || typeof e.hook !== "string") return e;
  const bag = {};
  let moved = false;
  for (const k of SOUL_SUBJECT_KEYS) {
    if (e[k] !== undefined) {
      bag[k] = e[k];
      delete e[k];
      moved = true;
    }
  }
  if (moved) {
    if (isBareSoulCondition(e.guard)) bag.if = e.guard;
    else if (e.guard !== null && typeof e.guard === "object") Object.assign(bag, { ...e.guard, ...bag });
    e.guard = bag;
  }
  const chance = e.chance !== null && typeof e.chance === "object" ? { ...e.chance } : {};
  let chanceMoved = false;
  if (typeof e.chance === "number") {
    chance.base = e.chance;
    chanceMoved = true;
  }
  if (e.chanceDyn !== undefined) {
    chance.dyn = e.chanceDyn;
    delete e.chanceDyn;
    chanceMoved = true;
  }
  if (e.chanceGrow !== undefined) {
    chance.grow = e.chanceGrow;
    delete e.chanceGrow;
    chanceMoved = true;
  }
  if (e.chanceResetOnFire === true) {
    chance.resetOnFire = true;
    chanceMoved = true;
  }
  if ("chanceResetOnFire" in e) delete e.chanceResetOnFire;
  if (e.limitBattle === true) {
    chance.once = true;
    chanceMoved = true;
  }
  if ("limitBattle" in e) delete e.limitBattle;
  if (chanceMoved) e.chance = chance;
  return e;
}

const SOUL_GROW_KEYS = ["growStep", "growCap", "growPoint", "resetOnCap", "atCapMul", "atCapNext", "atCapOps"];

/** 幅度成长收成 ops 开头的 grow。解析过程仍写旧字段，出口和已存储包走这一个函数。 */
export function liftSoulGrow(e) {
  if (e == null || typeof e !== "object" || typeof e.hook !== "string") return e;
  if (!SOUL_GROW_KEYS.some((k) => e[k] !== undefined)) return e;
  const op = { op: "grow", of: "magnitude" };
  if (typeof e.growStep === "number") op.step = e.growStep;
  if (typeof e.growCap === "number") op.magCap = e.growCap;
  if (e.growPoint === true) op.point = true;
  if (e.resetOnCap === true) op.resetOnCap = true;
  if (typeof e.atCapMul === "number") op.atCapMul = e.atCapMul;
  if (e.atCapNext === true) op.atCapNext = true;
  if (Array.isArray(e.atCapOps) && e.atCapOps.length > 0) op.payload = e.atCapOps;
  const ops = Array.isArray(e.ops) ? e.ops : [];
  if (ops[0]?.op === "grow" && ops[0]?.of === "magnitude") ops[0] = { ...ops[0], ...op };
  else ops.unshift(op);
  e.ops = ops;
  for (const k of SOUL_GROW_KEYS) delete e[k];
  return e;
}

/** beforeOrder 的先制区间收成 ops 里的 priority。解析过程仍写 prio，出口和已存储包走这一个函数。 */
export function liftSoulPrio(e) {
  if (e == null || typeof e !== "object" || typeof e.hook !== "string") return e;
  const p = e.prio;
  if (p == null || typeof p !== "object" || typeof p.min !== "number" || typeof p.max !== "number") return e;
  const op = { op: "priority", min: p.min, max: p.max };
  const ops = Array.isArray(e.ops) ? e.ops : [];
  if (ops[0]?.op === "priority") ops[0] = { ...ops[0], ...op };
  else ops.unshift(op);
  e.ops = ops;
  delete e.prio;
  return e;
}

/** 单条魂印文本 → { entries, unparsed, bossGate }。entries 为 schema soulHook 形状。 */
export function parseSoulmarkText(text, petName) {
  const entries = [];
  const unparsed = [];
  // Use-time migration is delayed until all group tails, upgrades and cross-group
  // mounts have landed. Otherwise a later grow/else clause can attach to a
  // battle-start react window instead of the source move entry.
  const plainUseMigrations = [];
  const pointGrow = new Set(); // growStep 为裸值（点）域的条目——"最高N点"只回挂点域宿主，不与 % 域混挂
  let bossGate = false;
  let textBossGate = false;
  let anyBossGate = false;
  if (text === null || text === undefined) return { entries, unparsed, bossGate, clauseTotal: 0, clausesParsed: 0, fragmentsOnParsed: 0, fragmentsOnResidual: 0, fragmentsOutside: 0 };
  let src = cleanEntities(String(text)).trim();
  // 裸名前缀（"布莱克所有攻击附带…"——无冒号的自称名；含"作为首发精灵"的自称；括号形态后缀取基名）
  const baseName = petName?.split(/[（(]/)[0];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 名字别名：全称 + 尾部 2~4 字简称（"夜魔之神布莱克"的"布莱克"——魂印常以短名指代；长名才有后缀歧义空间）
  const nameAlts = baseName === undefined || baseName === "" ? [] : [...new Set([baseName, ...(baseName.length >= 4 ? [4, 3, 2].map((n) => baseName.slice(-n)) : [])])].sort((a, b) => b.length - a.length);
  // 印名别名（"魂印是：丽 每回合…"——印名冠词后空格直跟正文；`是/为：X`/`X：`句首 1-2 字捕获）
  const markName = (() => { const mm = src.match(/(?:魂印|特性)(?:的)?(?:是|为|叫)[：:]([一-龥]{1,2})\s/) ?? src.match(/^([一-龥]{1,2})[：:]\s/); return mm?.[1]; })();
  if (markName !== undefined && !nameAlts.includes(markName)) nameAlts.push(markName);
  const stripPet = (s, look) => { for (const a of nameAlts) { const r = s.replace(new RegExp(`^${esc(a)}\\s*(?=${look})`), ""); if (r !== s) return r; } return s; };
  if (nameAlts.length > 0) src = stripPet(src, `所有|每|自身|攻击|对|回|受|免疫|在|处|使|令|技|先|后|登|作`);
  if (src === "" || EMPTY_MARK_RE.test(src)) return { entries, unparsed, bossGate, clauseTotal: 0, clausesParsed: 0, fragmentsOnParsed: 0, fragmentsOnResidual: 0, fragmentsOutside: 0 };
  // FAQ 块抽取：答案可能直接是正文，也可能有标题式引导；只去掉已识别的答前言。
  const faq = src.match(FAQ_ANSWER_RE);
  if (faq) {
    src = src.slice(faq.index + faq[0].length);
    const lead = src.match(FAQ_ANSWER_LEAD_RE);
    if (lead !== null) src = src.slice(lead[0].length);
    else {
      // 旧 FAQ 变体把印名和「效果如下」分开写：「魂印是骁，效果如下：1、…」。
      const list = src.match(/^[^。；;]{0,100}?效果如下[:：]/);
      if (list !== null) src = src.slice(list[0].length);
    }
  }
  else {
    // "答：...魂印是<印名>，效果如下： 1、X：…"——是后接印名非冒号的 QA 变体，取"效果如下："之后
    const lst = src.match(/(?:问：|答：|的魂印是|效果?是)[\s\S]{0,80}?效果如下[:：]/);
    if (lst) src = src.slice(lst.index + lst[0].length);
  }
  src = src.trimStart();
  if (src === "" || EMPTY_MARK_RE.test(src)) return { entries, unparsed, bossGate, clauseTotal: 0, clausesParsed: 0, fragmentsOnParsed: 0, fragmentsOnResidual: 0, fragmentsOutside: 0 };
  // 印名冠词（"的魂印是骁：每回合…"——FAQ 抽取后遗留的单字印名+冒号；仅句首剥，中段"危机感：定义"保留分桶）
  src = src.replace(/^[㐀-䶿一-龥]{1,3}：(?=[一-龥0-9]{4,})/, "");
  src = src.replace(TAIL_NOISE_RE, "");
  if (TEXT_BOSS_RE.test(src)) { bossGate = true; textBossGate = true; anyBossGate = true; src = src.replace(TEXT_BOSS_RE, ""); }
  src = stripNamePrefix(src).replace(BOSS_OK_RE, "");

  // 技能生效后转移强化及其同次失败分支：复用 onMoveUsed 与 prevApplied，
  // 不能迁往行动前的 react 11，也不能在回合末猜测之前是否转移成功。
  const afterTransfer = src.match(/^(?:自身)?使用技能时将自身(?:相应的|的)?能力提升(?:状态)?赋予给对手(?:相应的|的)?能力下降(?:状态)?[（(]技能生效后触发[）)][，,]若未触发(?:效果)?则减少对手(\d+)\s*\/\s*(\d+)最大(?:体力|HP)[。.]?$/);
  if (afterTransfer !== null && +afterTransfer[2] > 0) {
    entries.push({ hook: "onMoveUsed", guard: { actor: "self" }, ...(textBossGate ? { bossGate: true } : {}), ops: [
      { op: "transfer_stages", direction: "upToDown" },
      { op: "hp_delta", target: "opponent", frac: { numerator: +afterTransfer[1], denominator: +afterTransfer[2], of: "max" }, kind: "percent", if: { not: { prevApplied: true } } },
    ] });
    return { entries, unparsed, bossGate: textBossGate, clauseTotal: 1, clausesParsed: 1, fragmentsOnParsed: 0, fragmentsOnResidual: 0, fragmentsOutside: 0 };
  }

  // A duration-bearing state introduced earlier in the same source can define
  // a later `name：...` block even when the name itself has no generic marker
  // such as 图腾/场地/状态. Keep this relation source-local and literal: ordinary
  // soulmark headings are not treated as state domains unless the text first
  // introduces that exact duration-bearing name.
  const introducedDomainLabels = new Set();
  for (const match of src.matchAll(/(?:获得|进入|开启|启动|附加|赋予)(?:\d+|[一二两三四五六七八九十]+)?回合的?([一-龥·]{2,10}?)(?=[，,；;。\s])/g)) {
    const name = match[1];
    if (name !== undefined && src.includes(`${name}：`)) introducedDomainLabels.add(name);
  }
  const isIntroducedDomainLabel = (s) => {
    const label = s.match(/^([^：:]{1,18})[：:]/);
    return label !== null && introducedDomainLabels.has(label[1]);
  };

  // 「自身位于/存活于出战背包时，<效果>」——前置守卫。剥离后让效果本体走常规规则。
  // 注意：只剥前缀；"本人已出场则失效"这一半尚未建模
  // （见 tests/battle-core/parser/bench-position.test.ts 的说明）。
  src = src.replace(/^(?:[^，,；;]{0,8})?(?:位于|存活于)出战背包(?:时|中)[，,、]?\s*/, "");

  // ── 「根据双方X值之差n触发以下效果：①…②…③若n≥200则…」直接产条目 ──
  // 语料只有 4 只（决囚钢骨/堕魂之手/覆骸冥土/拟态绞索），骨架固定、n 是同一读数。
  // 即时幅值与静态分档可直接翻译；持续效果若需要把回合开始时 n 冻结，当前 IR 无此能力，逐档保留 residual。
  {
    const sd = statDiffEntries(src, bossGate);
    if (sd !== null) {
      for (const e of sd.entries) entries.push(e);
      unparsed.push(...sd.unparsed);
      src = src.slice(sd.consumed).trim();
      if (src === "") {
        const parsed = sd.entries.some((e) => (e.ops?.length ?? 0) > 0);
        return {
          entries,
          unparsed,
          bossGate: anyBossGate || entries.some((e) => e.bossGate === true),
          clauseTotal: 1,
          clausesParsed: parsed ? 1 : 0,
          fragmentsOnParsed: parsed ? sd.unparsed.length : 0,
          fragmentsOnResidual: parsed ? 0 : sd.unparsed.length,
          fragmentsOutside: 0,
        };
      }
    }
  }

  let lastHook; // 触发器继承：无前缀子句沿用同一文本内前句的 hook
  let guardQuarantine = false; // 未知守卫后的关联语句暂不解析，直到显式、可解析的触发前缀重新建立边界
  let condHold = false; // 上一组是未建模的**条件**（"自身克制对手时"）——它的效果组必须被扣下，不能因自带触发词就无条件执行
  let condHoldHasPayload = false; // 同一分号子句内已扣留完整负载；不能再吞下一个独立时序子句
  const guardUnmodeledReason = "guard unmodeled — effect withheld (deferred)";
  let guardQuarantineReason = guardUnmodeledReason;
  let namedDomainQuarantine = false;
  const namedDomainReason = "named-domain definition — field/state-machine effects unmodeled (deferred)";
  const isGuardElse = (s) => /^(?:若)?(?:未触发|未命中|未击败|没有触发|均未触发|皆未触发|反转失败|触发失败|免疫成功|触发成功)(?:令|使|恢复|回复|吸取|造成|附加|消除|清除|解除|下|回合|自身|对手|对方|敌方|则)/.test(s);
  const startsWithSupportedTrigger = (s) => {
    if (isGuardElse(s)) return false;
    // 「先出手时效果翻倍」仍指向前面的宿主，不能释放未知条件的隔离。
    if (/效果(?:翻倍|加倍)$/.test(s)) return false;
    // A typed incoming-attack react is an explicit event boundary, even though
    // its existing IR is encoded as a battle-start `react` window rather than
    // one of the ordinary hook prefixes below.
    if (/^(?:自身|自己)?受到(?:物理|特殊)攻击(?:时|后|则)/.test(s)) return true;
    for (const t of TRIGGERS) {
      if (t.mk !== undefined) {
        const r = t.mk(s);
        // Generic conditions/passives use __turn__ as the parser's default timing bucket.
        // They cannot prove a new independent event boundary after an unknown guard.
        if (r !== undefined && r.extra?.guardDropped === undefined && r.hook !== "__turn__" && r.weak !== true) return true;
      }
      if (t.re !== undefined && t.weak !== true && t.hook !== "__turn__") {
        const m = s.match(t.re);
        if (m !== null && m.index === 0) return true;
      }
    }
    return false;
  };
  const firstSupportedTriggerOffset = (s) => {
    for (let i = 1; i < s.length; i++) {
      if (!/[，,、\s]/.test(s[i - 1] ?? "")) continue;
      if (startsWithSupportedTrigger(s.slice(i))) return i;
    }
    return -1;
  };
  const danglingEmpty = []; // {text,atEntries}——跨。段裸触发：hook 经 lastHook 结转后续子句；文本末仍无条目产出才记 empty-body
  let clauseTotal = 0;
  let clausesParsed = 0; // 产出 ≥1 条 entry 的子句计数（残余 unparsed 片段不否决该句）
  // 片段账：与子句账分开。onParsed = 已算出 entry 的子句里仍推入的残留；onResidual = 没算出 entry 的子句；outside = 没进入子句分母（伴生整段、循环后的空体）。
  let fragmentsOnParsed = 0;
  let fragmentsOnResidual = 0;
  let fragmentsOutside = 0;
  let fragmentCursor = 0;
  const recordOuterResidual = (clause, reason) => {
    const text = clause.trim();
    if (text === "") return;
    // 纯噪声片段（图鉴页尾 / 裸主语 / 编号残渣）不记残文——它们承载不了任何效果。
    // 但只在**本记录已产出条目**时丢：一条什么都没解析出来的记录若把残文也丢了，
    // 就成了「无输出且无残文」的空记录（审计会记成异常，真内容被静默吞掉）。
    if (isNoiseFragment(text) && entries.length > 0) return;
    unparsed.push({ clause: text, reason });
    clauseTotal++;
    fragmentsOnResidual++;
    fragmentCursor = unparsed.length;
  };
  for (const rawPart of src.split(/[；;。]/).flatMap(splitLocalBossScopes)) {
    const raw = rawPart.text;
    bossGate = textBossGate || rawPart.localBossGate; // 全文标注覆盖全部；局部括注仅覆盖其最近独立时序片段。
    if (rawPart.localBossGate) anyBossGate = true;
    if (namedDomainQuarantine) {
      recordOuterResidual(raw, namedDomainReason);
      continue;
    }
    if (rawPart.crossEventDefer) {
      const reason = "cross-event prerequisite — skill-invalid condition cannot guard a later entry event (deferred)";
      recordOuterResidual(raw, reason);
      guardQuarantine = true;
      guardQuarantineReason = reason;
      lastHook = undefined;
      continue;
    }
    if (rawPart.shieldEqualityDefer) {
      const reason = "shield-value comparison — equal shield/ward amounts cannot guard the linked effect (deferred)";
      recordOuterResidual(raw, reason);
      guardQuarantine = true;
      guardQuarantineReason = reason;
      lastHook = undefined;
      continue;
    }
    let clause = raw.trim();
    const firstUseBeforeWindow = /首次(?:使用|攻击|出手).{0,32}(?:在打出之前|打出之前)/.test(clause);
    let namedDefinitionQuarantine = false;
    // FIRST_ENTRY_RE's `chance.once` is not a substitute for a first-turn
    // window. Preserve the linked branch instead of emitting an effect that
    // can trigger on a later turn.
    if (/^首次(?:登场|出战|出场|上场|入场)(?:后|时)?[，,、\s]*(?:首回合|第一回合|第1回合)(?:内|中)?[，,、\s]*使用(?:攻击|属性|物理|特殊)?技能(?:后|时|则)/.test(clause)) {
      const reason = "first-entry move window — first-turn gate cannot be represented by once (deferred)";
      recordOuterResidual(clause, reason);
      guardQuarantine = true; guardQuarantineReason = reason; lastHook = undefined;
      continue;
    }
    // These linked phrases depend on the result/amount of the current hit, or
    // couple mutually exclusive stage branches across timing windows. Do not
    // retain an ungated stat, priority, heal, or damage fragment from the same
    // raw clause when the complete relation is not expressible.
    const hasZeroDamageDrain = /(?:造成(?:的)?(?:攻击)?伤害|攻击伤害)为?0(?:点)?(?:时|后|则)[，,、\s]*(?:吸取|吸收)(?:对手|对方|敌方)/.test(clause);
    const hasThresholdMaxHpDrain = /(?:自身|自己)?造成(?:的)?(?:攻击)?伤害(?:高于|大于|超过)\d+(?:点)?(?:时|后|则)[，,、\s]*(?:吸取|吸收)(?:对手|对方|敌方)最大(?:体力|HP)/.test(clause);
    const hasNoHighDamageStage = /自身未造成(?:高于|大于|超过)\d+(?:点)?的?(?:攻击)?伤害的回合[，,、\s]*战斗阶段结束[时后][，,、\s]*(?:自身|自己)?(?:特攻|速度)/.test(clause);
    const hasPairedStageBranches = /若(?:敌我双方|敌我|双方)(?:中)?(?:任意一方|有一方|一方).{0,24}处于能力(?:提升|强化)(?:的)?状态.{0,60}则[\s\S]*若(?:敌我双方|敌我|双方)(?:中)?(?:皆|都|均)不处于能力(?:提升|强化)/.test(clause);
    if (hasZeroDamageDrain || hasThresholdMaxHpDrain || hasNoHighDamageStage) {
      const reason = "damage-result branch — hit outcome/amount cannot be represented by the current hook window (deferred)";
      recordOuterResidual(clause, reason);
      guardQuarantine = true; guardQuarantineReason = reason; lastHook = undefined;
      continue;
    }
    if (hasPairedStageBranches) {
      const reason = "stage-state split — mutually exclusive turn windows cannot share a frozen condition (deferred)";
      recordOuterResidual(clause, reason);
      guardQuarantine = true; guardQuarantineReason = reason; lastHook = undefined;
      continue;
    }
    if (condHold && condHoldHasPayload) { condHold = false; condHoldHasPayload = false; }
    if (guardQuarantine && clause !== "") {
      if (condHold) {
        // 上一 clause 末尾是**未建模的条件**（"自身微弱对手时"）——本 clause 是它的负载，
        // 整句留档、不能无条件执行（pet-4814 娜诺：两个未建模条件 + 一个负载组）。
        // 扣留到此结束：条件作用域覆盖到本 clause 末，后面的是独立子句。
        recordOuterResidual(clause, guardQuarantineReason);
        condHold = false;
        condHoldHasPayload = false;
        guardQuarantine = false;
        guardQuarantineReason = guardUnmodeledReason;
        lastHook = undefined;
        continue;
      }
      // 新子句自己带未建模条件时，让正常守卫路径接管整句；不能跳过条件去找后面的触发词。
      const head = clause.split(/[，,]/)[0].trim();
      const newBareGuard = /(?:时|则)$/.test(head) && UNSUPPORTED_TRIGGERS.some((u) =>
        /^(?:attr-domain|gender-cond)/.test(u.reason) && u.re.test(head));
      if (newBareGuard || startsWithSupportedTrigger(clause)) {
        guardQuarantine = false;
        guardQuarantineReason = guardUnmodeledReason;
        lastHook = undefined;
      } else {
        const boundary = firstSupportedTriggerOffset(clause);
        if (boundary > 0) {
          recordOuterResidual(clause.slice(0, boundary), guardQuarantineReason);
          clause = clause.slice(boundary).trim();
          guardQuarantine = false;
          guardQuarantineReason = guardUnmodeledReason;
          lastHook = undefined;
        } else {
          recordOuterResidual(clause, guardQuarantineReason);
          continue;
        }
      }
    }
    // A turn-start comparison grants a crit window for attacks made during
    // that turn. Keep the snapshot predicate and probability on the applying
    // turn-start hook; onDamageDealt would be too late for the current hit.
    const turnStartCrit = clause.match(/^回合开始时[，,、\s]*自身(?:当前)?体力(高于|大于|超过|低于|小于|少于|不足)(?:对手|对方|敌方)(?:的)?(?:体力)?则当回合攻击(\d+)%(?:的)?(?:几率|概率)打出致命(?:一击)?[，,、\s]*自身(?:当前)?体力(高于|大于|超过|低于|小于|少于|不足)(?:对手|对方|敌方)(?:的)?(?:体力)?则当回合攻击(\d+)%(?:的)?(?:几率|概率)打出致命(?:一击)?$/);
    if (turnStartCrit !== null) {
      const condOfSide = (comparison) => smCondOf(`自身体力${comparison}对手`);
      const firstCond = condOfSide(turnStartCrit[1]);
      const secondCond = condOfSide(turnStartCrit[3]);
      if (firstCond !== undefined && secondCond !== undefined) {
        entries.push(
          { hook: "onTurnStart", guard: firstCond, ops: [{ op: "apply_status", name: "crit_up", target: "self", turns: 1, params: { n: +turnStartCrit[2], d: 100 } }] },
          { hook: "onTurnStart", guard: secondCond, ops: [{ op: "apply_status", name: "crit_up", target: "self", turns: 1, params: { n: +turnStartCrit[4], d: 100 } }] },
        );
        fragmentsOutside += unparsed.length - fragmentCursor;
        fragmentCursor = unparsed.length;
        clauseTotal++; clausesParsed++;
        continue;
      }
    }
    // 伴生上下文传染：段内命中契约/召唤即整段记 companion（同。段内后续编号项均属伴生作用域）
    if (/缔结契约|与.{1,6}缔结|缔结伴生|存活期间|守护.{1,8}存活|伴生(?:精灵|伙伴)|召唤.{1,4}(?:伙伴|守卫|化身)/.test(clause)) {
      unparsed.push({ clause: raw.trim().slice(0, 120), reason: "companion/summon — contract entity unmodeled (deferred)" });
      continue;
    }
    // 复合前缀循环剥："迪 4、" "战: 2、" 等代号/编号可叠加
    for (;;) {
      let c2 = stripNamePrefix(clause.replace(NUM_PREFIX_RE, "")).trim().replace(/^[""''「」『』]+/, "");
      // 子句级裸名前缀（"混元天尊登场后与…"——petName+触发词起首）
      if (nameAlts.length > 0) c2 = stripPet(c2, `所有|每|自身|攻击|对|回|受|免疫|在|处|使|令|技|先|后|登|作|死|开|缔|附|进|变|切|闪|驱|失|获|吸|恢|造|消|抵|免|克|微`);
      if (c2 === clause) break;
      clause = c2;
      if (clause === "") break;
    }
    if (clause === "") continue;
    if (CLAUSE_BOSS_RE.test(clause)) { bossGate = true; anyBossGate = true; clause = clause.replace(CLAUSE_BOSS_RE, "").replace(/^[，,、\s]+|[，,、\s]+$/g, ""); }
    if (clause === "") continue;
    if (DIRTY_RE.test(clause) || /^无特性$|^没有特性/.test(clause)) {
      // 脏尾截断：编号子句+尾部站点噪声（"…最高400点 3、（boss无效） 精灵资料：…"）——截掉脏尾保留头部有效子句；整段脏文本才跳过
      const head = clause.replace(/(?:精灵资料|图鉴|技能表|种族值|进化图|获得方法|新闻|攻略|\.com|https?|是什么？|有什么效果|效果如何)[\s\S]*$/, "").replace(/[，,、\s]+$/, "").replace(/\s+[0-9０-９]{1,2}[、.．]\s*$/, "");
      if (head === "" || DIRTY_RE.test(head) || /^无特性$|^没有特性/.test(head)) continue; // 脏文本不计入覆盖率分母
      clause = head;
    }
    clause = clause.replace(EFFECT_PREAMBLE_RE, "").replace(BATTLE_PREAMBLE_RE, "").replace(/^[，,、\s]+/, "").replace(/\s+[0-9０-９]{1,2}[、.．]\s*$/, "");
    if (clause === "") continue;
    fragmentsOutside += unparsed.length - fragmentCursor;
    fragmentCursor = unparsed.length;
    clauseTotal++;
    let segParsed = false; // 子句级"已产出"标记——段内任一组产出 ≥1 条 entry 即置位；段末统一计 1（残余 unparsed 片段不否决该句）
    let rewindAwait; // 回卷句先于同段 endure 出现时暂存。段末并进 endure，否则记 unparsed。不发 flag。
    const unparsedAtClause = unparsed.length;
    try {


    // 全场一次限定——剥离后贴到产出条目上
    let limitBattle = false;
    if (BATTLE_LIMIT_RE.test(clause)) { limitBattle = true; clause = clause.replace(BATTLE_LIMIT_RE, "").replace(/^[，,、\s]+/, "").trim(); }
    // "只能触发N次"（N>1）——每场触发计数未建模（limitBattle 仅布尔域）
    if (/(?:仅|只)(?:能|可)?(?:触发|使用|生效)(?:\d+|[二两三四五六七八九十])次/.test(clause)) { unparsed.push({ clause, reason: "battle-limit-count — per-battle trigger count >1 unmodeled (deferred)" }); continue; }
    // "在一场战斗中"/"本场战斗中"引导词——无信息量前缀剥除
    clause = clause.replace(/^(?:在)?(?:一|本|每|此|该)场?战斗(?:中|内|里)[，,]?/, "");
    // "对手每回合X"主语前置 → "每回合对手X"（触发锚定每回合，对手留给 inner 作目标提示）
    clause = clause.replace(/^(对手|对方|敌方)(每回合)/, "$2$1");
    // "，下场后保留"/"，保留"尾修饰——跨切换持久化未建模：尾句剥除并留档（主语义保留）
    const persistm = clause.match(/[，,、\s]*(?:下场后|下场|切换后)?保留(?:效果|状态)?$/);
    if (persistm !== null && persistm[0].trim() !== "") { unparsed.push({ clause: persistm[0].trim(), reason: "persist-on-switch — buff retention across switch-out unmodeled (deferred)" }); clause = clause.slice(0, persistm.index).replace(/[，,、\s]+$/, ""); }
    // "（最多每回合回复N点）"尾句 → 本子句 heal op cap
    let clauseCap;
    const capm = clause.match(/[（(]最多(?:每回合)?(?:回复|恢复|获得|提高|提升|增加)?(\d+)点(?:体力|伤害)?[)）]\s*$/);
    if (capm) { clauseCap = +capm[1]; clause = clause.slice(0, capm.index).replace(/[，,、\s]+$/, ""); }
    // "最多恢复至自身最大体力的N/M"尾句 → 本子句 heal op capFrac（回复后 HP 顶帽——cap 是量帽，capFrac 是结果帽）
    let clauseCapFrac;
    const cfm = clause.match(/[，,、\s]*最多恢[复回]至(?:自身|自己)?(?:的)?最大(?:体力|HP)(?:值)?的?(\d+)\s*\/\s*(\d+)\s*$/);
    if (cfm) { clauseCapFrac = { n: +cfm[1], d: +cfm[2] }; clause = clause.slice(0, cfm.index).replace(/[，,、\s]+$/, ""); }
    // "（A和B在背包时生效）"背包精灵守卫 → 子句级 pendingCond 种子（名列表 AND 复合）
    let clauseBenchCond;
    const benchm = clause.match(/[（(](.+?)在背包(?:中|内)?时(?:才)?生效[）)]/);
    if (benchm) {
      const names = benchm[1].split(/[和与、，,\s]+/).filter((n) => n !== "");
      const conds = names.map((n) => ({ benchNameCount: { substr: n.replace(/(?:同时|均|皆|都|一起)$/, ""), count: 1 } }));
      clauseBenchCond = conds.length === 1 ? conds[0] : conds.length > 1 ? { and: conds } : undefined;
      clause = clause.replace(benchm[0], "").replace(/[，,、\s]+$/, "");
    }
    // "（将…强制替换为…）"等机制说明括号 → 剥除（解释性注释非条件；"（对手背包无存活精灵则该效果不触发）"整括号一并剥——foe-bench 谓词未建模，丢门控但保主语义）
    clause = clause.replace(/[（(](?:将|即|即：|注：|说明：|buff说明：?)[^（）()]{2,80}[）)]/g, "").replace(/[（(][^（）()]*背包[^（）()]*不触发[^（）()]*[）)]/g, "");
    let entryScopeTurns; // 首次登场 scope：句内被动按登场短窗结算（UNVERIFIED——窗口时长近似 1 回合）
    if (FIRST_ENTRY_RE.test(clause)) { limitBattle = true; entryScopeTurns = 1; clause = "登场时" + clause.replace(FIRST_ENTRY_RE, ""); } // "首次登场时X" → onEntry + limitBattle
    // 裸编号尾段（DIRTY 截尾残留的" \d+"/" \d+、"——FAQ 页码碎屑，剥除让 GROW_TAIL_RE 的 $ 锚点生效）
    clause = clause.replace(/\s+[0-9０-９]{1,2}[、.．]?\s*$/, "").replace(/精灵存货/g, "精灵存活"); // "精灵存货" OCR 异体（"背包每有一只精灵存货"=存活——触发扫描在 normalizeSoulBody 之前）
    // 概率累积尾句剥离——挂到最近一条带概率的 entry（ops 同值 chance 吊到 entry 级）
    let growTail;
    const gm = clause.match(GROW_TAIL_RE);
    const ptg = gm === null ? clause.match(/(?:之后|此后|以后)(?:本次在场|在场)?每回合(?:开始|结束)?(?:时|后)?(?:的)?(?:(?:恢复|回复|吸取|吸收|伤害|攻击伤害|固伤|回复)量)?(?:的)?(?:额外)?(?:提升|增加|提高)(\d+)%(?:[，,]?(?:最高|至多|最多)(?:提升|增加|至|到|为|达)?(\d+)%)?$/) : null;
    if (ptg !== null) { growTail = { add: +ptg[1], ...(ptg[2] !== undefined ? { cap: +ptg[2] } : {}), turnRearm: true }; clause = clause.slice(0, ptg.index).replace(/[，,、\s]+$/, ""); }
    if (gm) { // gm[1]/gm[2]=百分点形；gm[3..6]=分数形（"每回合增加1/9的吸收量，最多吸收1/3"——折合成百分点域步进/封顶）
      growTail = gm[1] !== undefined
        ? { add: +gm[1], ...(gm[2] !== undefined ? { cap: +gm[2] } : {}) }
        : { add: Math.round((+gm[3] * 100) / +gm[4]), ...(gm[5] !== undefined ? { cap: Math.round((+gm[5] * 100) / +gm[6]) } : {}) };
      clause = clause.slice(0, gm.index).replace(/[，,、\s]+$/, "");
    }
    const attachGrow = () => {
      const e = entries[entries.length - 1];
      if (e === undefined || e.ops === undefined) return false;
      // "之后每回合X量提升N%"逐回合尾——只走条目级 growStep 通道并把钩改挂 onTurnStart（params.growStep 是逐击域不适用）
      if (growTail?.turnRearm === true) {
        if (e.ops.length === 0) return false;
        e.growStep = growTail.add;
        if (growTail.cap !== undefined) e.growCap = growTail.cap;
        e.hook = "onTurnStart";
        return true;
      }
      if (e.chance !== undefined) { e.chanceGrow = growTail; return true; }
      const chs = e.ops.map((o) => o.chance);
      if (chs.length > 0 && chs[0] !== undefined && chs.every((c) => c === chs[0])) {
        for (const o of e.ops) delete o.chance;
        e.chance = chs[0];
        e.chanceGrow = growTail;
        return true;
      }
      // dmgOutPct 宿主（"伤害提升N%，每次使用增加M%最高K%"→params.growStep/growCap）
      const sh = [...e.ops].reverse().find((o) => o.op === "apply_status" && o.params !== undefined);
      if (sh !== undefined) {
        // crit_up 的 n/d 就是触发概率（"3回合致命几率加1/8"），不是幅度。
        // 成长应走条目级 chance/chanceGrow（引擎按 chanceGrow 递增判定），
        // 而不是 params.growStep（那会经 accGrow 改 n，把概率当幅度放大）。
        if (sh.name === "crit_up") {
          const n = Number(sh.params.n);
          const d = Number(sh.params.d);
          if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) {
            e.chance = Math.round((n * 100) / d);
            e.chanceGrow = growTail;
            // n/d 已提升为条目概率，op 上不再重复留一份
            delete sh.params.n;
            delete sh.params.d;
            if (Object.keys(sh.params).length === 0) delete sh.params;
            return true;
          }
          return false;
        }
        sh.params.growStep = growTail.add;
        if (growTail.cap !== undefined) sh.params.growCap = growTail.cap;
        return true;
      }
      // 兜底：条目级幅度成长（soul.magAcc→growOp 注入各 op 幅度字段——damage/heal/分数窗通用）
      if (e.ops.length > 0) {
        e.growStep = growTail.add;
        if (growTail.cap !== undefined) e.growCap = growTail.cap;
        return true;
      }
      return false;
    };
    if (clause === "") { // 裸尾句：直接挂前句末条 entry
      if (growTail !== undefined && !attachGrow()) unparsed.push({ clause: gm[0].trim(), reason: "grow-tail-orphan" });
      continue;
    }

    // 已知但暂不支持的触发/限定族——显式分桶（仅句首命中提前 defer；句中命中交 segBoundary 切组后按组 defer，防拖累前段已解析部分）
    const unsup = UNSUPPORTED_TRIGGERS.find((u) => { const m = clause.match(u.re); return m !== null && m.index === 0; });
    // reason 尾缀 FALLTHROUGH 的两行（clear-stages / taken-down）等于"抢在 R4 之前整句拦下"，它们要发的
    // clear_stages{foe,up} 和 dmg_taken_down{pct} 都是现成格子，所以列作"未被支持的触发"的豁免：
    // 放行后落得到旧句式的就照旧句式发，落不到的（如"消除对手能力提升效果"）仍按原路退回、reason 逐字不变。
    if (unsup !== undefined && !unsup.reason.endsWith("FALLTHROUGH")) {
      if (unsup.quarantine === true) {
        recordOuterResidual(clause, unsup.reason);
        guardQuarantine = true; guardQuarantineReason = unsup.reason; lastHook = undefined;
      } else {
        // 条件类族（typechart 相性 / 性别）以**裸条件**形态出现时（"自身克制对手时"），
        // 条件本身没建模 → 它后面的效果（"战斗阶段结束时…反转对手能力提升状态"）
        // 不能无条件执行。挂起标记：下一组即使自带触发词也要被扣下，
        // 否则等于把带条件的效果改成无条件跑（pet-4814 娜诺就是这种）。
        const condFamily = unsup.reason.startsWith("attr-domain") || unsup.reason.startsWith("gender-cond");
        const bareCond = condFamily && /(?:时|则)[，,、]?$/.test(clause.trim());
        if (bareCond) { condHold = true; condHoldHasPayload = false; guardQuarantine = true; guardQuarantineReason = unsup.reason; lastHook = undefined; }
        unparsed.push({ clause, reason: unsup.reason });
      }
      continue;
    }
    const clauseEntryStart = entries.length;

    // "，"段内嵌触发词/被动族/未支持族 → 开新组；其余并入前组
    // "P时"谓词起首段自成边界（"…+1，自身不处于能力提升状态时变为…"——cond 转挂下组，避免谓词被吞进前组 inner）
    const condSeg = (seg) => {
      const m = seg.match(/^(.{2,24}?)时/);
      if (m === null) return false;
      const c = smCondOf(m[1].replace(/^(?:当|若)/, "").replace(/^处于/, "自身处于"));
      if (c === undefined) return false;
      const subs = c.and ?? c.or ?? [c];
      return !subs.some((x) => x !== undefined && typeof x === "object" && x.order !== undefined); // order 谓词交触发表
    };
    // 段级「冗余主语」剥除（与组首奇偶行、p3/w11 的 body 级 R4 链同一件事）：句首「自身/自己」在魂印语境里
    // 恒为持有者，同族裸形本来就已在规则表落地（"恢复最大体力的1/4"、"自身恢复150点体力"一直在发）。
    // 触发扫描在组文本上做，剥除必须放在切段这一层才够得着。只收"动词+从属词白名单"的确定形，
    // 不为整齐去放宽（"自身技能命中后…"这类带从属内容的整句仍收在原文里）。
    const redSubject = (s) => s
      .replace(/^自身(?=恢复)/, "") // 自身恢复最大体力的17% → 恢复最大体力的17%（回血 tick）
      // r4b：同族裸形"句首自身 + 动词"在别处已经逐字落地，句首「自身」只是冗余主语。
      // 只收"后面紧跟的动词短语本身就是旧句开头"的确定形；剥后落不到规则表的整段保持原文（redTry 门槛兜底）。
      .replace(/^自身(?=吸取(?:对手|对方|敌方))/, "") // 吸取对手400点体力 / 吸取对手最大体力的1/3（骑乘式吸取旧格）
      // r6b：同族「句首自身 + 动词短语」——魂印语境里持有者恒为自身，剥掉后整段落回语料里已经在发的同一格。
      // 每条只认后面紧跟的动词短语本身（该短语的裸形在语料别处一直在发），不按动词泛化；redTry 门槛兜底。
      .replace(/^自身(?=每次登场首次攻击技能)/, "") // 每次登场首次攻击技能必定打出致命一击（同格：每次登场首次攻击造成的伤害提升150% 聆风）
      .replace(/^自身(?=首次(?:登场)?受到的)/, "") // 首次受到的攻击时伤害减少60%（克利奥）/ 首次登场受到的伤害高于N则…（克里斯托）
      .replace(/免疫自身(?=受到)/, "免疫") // 免疫自身受到攻击伤害 → 免疫受到攻击伤害（贝乌索「下回合免疫受到攻击伤害」同格）
      .replace(/^自身(?=使用技能时)/, "") // 使用技能时附加350点固定伤害（onMoveUsed 旧格）
      .replace(/^自身(?=属性技能(?:命中|附加))/, "") // 属性技能命中后/附加X（属性招式命中旧格）
      .replace(/^自身(?=攻击技能命中(?:后|时))/, "") // 攻击技能命中后造成的伤害提升50%（onDamageDealt 旧格）
      .replace(/^自身(?=攻击(?:后|时)(?:附加|造成))/, "") // 攻击后附加伤害值99%的百分比伤害（onMoveUsed 旧格）
      .replace(/^自身(?=攻击(?:有|必定))/, "") // 攻击有50%使对手随机进入…（onDamageDealt 旧格）
      .replace(/^自身(?=所有攻击(?:有|\d))/, "") // 所有攻击50%的几率打出致命一击（战首 react 旧格）
      .replace(/^自身(?=受到(?:攻击|技能|特殊|物理)?(?:伤害|攻击)?(?:时|后|有|降|减))/, "") // 受到特殊攻击时50%令对手麻痹（onDamaged react 旧格）
      .replace(/^自身(?=每回合(?:都)?有)/, "") // 每回合都有一定几率闪避对手攻击技能（逐回合概率窗旧格）
      .replace(/^自身(?=每次使用技能有)/, "") // 每次使用技能有30%令对手害怕（onMoveUsed 旧格）
      .replace(/^自身(?=连续使用)/, "") // 连续使用同一技能时造成的攻击伤害提升30%（sameMove 旧格）
      .replace(/^自身(?=免疫并反弹)/, "") // 免疫并反弹受到的异常状态（免疫+反弹旧格）
      .replace(/^自身(?=保留\s*\d+\s*点?(?:体力|血|HP))/, "") // 保留1点体力（endure 旧格）
      .replace(/^自身(?=体力每(?:损失|降低|减少))/, "")
      // r5b：重复写出的冗余主语「自身自身下回合…」——前一个是多余的，剥掉后落回「下回合造成的攻击伤害提升50%」旧格。
      // 不锚定句首（重复主语可能出现在组首，也可能落在条件余文里）；只认后接时间窗的确定形，不按叠字泛化。
      .replace(/自身(?=自身(?:下回合|本回合|当回合))/, "");
    // 递归护栏 r3cRedOff 是模块级的（跨 parseSoulmarkText 调用共享——r0 探针内不得再剥）
    const withRedOff = (fn) => { const p = r3cRedOff; r3cRedOff = true; try { return fn(); } finally { r3cRedOff = p; } };
    // 只有"剥后确实整句落到规则表、且未剥本来解不出"时才生效（不抢旧行为、不产生新语义）。
    const redTry = (s) => {
      if (r3cRedOff) return s;
      const t = redSubject(s);
      if (t === s) return s;
      const rr = parseSoulmarkText(t); // 剥后能整句解？（句首只有一个主语，递归深度 1）
      if (rr.unparsed.length !== 0 || rr.entries.length === 0) return s;
      const r0 = withRedOff(() => parseSoulmarkText(s)); // 未剥本来就能解——不抢，保持旧行为
      return r0.entries.length === 0 ? t : s;
    };
    const segBoundary = (seg) =>
      condSeg(seg) || TRIGGERS.some((t) => (t.re !== undefined && t.re.test(seg)) || (t.mk !== undefined && t.mk(seg) !== undefined)) || UNSUPPORTED_TRIGGERS.some((u) => u.re.test(seg)) || PASSIVES.some((p) => p.re.test(seg)) || statClauseOps(seg) !== undefined || /^(?:.{2,24}时)?转变为/.test(seg) || /^触发后/.test(seg) || /^(?:之后|此后|以后)?每(?:回合|次|使用|触发)(?:技能)?(?:时|后|额外)?(?:概率|几率|的)?(?:增加|提升|提高|叠加)/.test(seg) || /^(?:之后|此后|以后)?每(?:回合|次|使用|触发)[一-龥]{0,10}?(?:概率|几率|减少量|伤害量|效果|幅度|倍率)(?:的)?(?:增加|提升|提高|叠加)/.test(seg) || /^最高|^最多/.test(seg) || new RegExp(`^(?:若)?(?:未触发|未命中|未击败|没有触发|均未触发|皆未触发|反转失败|触发失败)(?:${AIL_ALT}|闪避)?(?:则|，|,)`).test(seg) || /^(?:若)?(?:免疫|触发|施加|反转)?成功则/.test(seg) || new RegExp(`^(?:若)?(?:触发|施加|反转)(?:${AIL_ALT})?则`).test(seg) || /^(?:自身|自己)?(?:的)?(?:HP|体力|血量|生命值)?(?:最大)?(?:体力|HP|生命值)?每(?:降低|减少|损失|下降)\d+%|^每(?:降低|减少|损失|下降)\d+%/.test(seg)
      // r5b：段首「自身自身下回合…」与「自身受到(物理|特殊)攻击…」自成一组。前者是重复写出的冗余主语（同上）；
      // 后者是受击反应窗——它是独立监听器，不该被前一段的「未触发则…」并走（单独出现时与裸形逐字同 IR，挂点不变）。
      // 两条都只认短语本身的确定形，不按动词泛化；即便剥后落不到规则表，redTry 的门槛也会把整段退回原文。
      || /^自身(?=自身(?:下回合|本回合|当回合))|^自身(?=受到(?:特殊|物理)攻击(?:时|后|则))/.test(seg);
    const groups = [];
    let cur = [];
    cur.linkedContinuation = false;
    // 结果分支标记（"触发成功/未触发…"）——「且」内联切分时用它判断能不能把前半段另起一组：
    // 带标记的分支必须与其尾句保持在一起（尾句要跟着该分支的作用域）。
    const outcomeMarker = /(?:免疫成功|触发成功|施加成功|反转成功|未触发|未命中|未击败|免疫失败|触发失败|反转失败)/;
    // 空格=句界（图鉴源用空格分句："…80% 回合开始时，…"——无正句内空格，已全库验证）；
    // 与 "，" 同级切分，每段再过 segBoundary 判定是否开新组（裸触发/新触发→独立组）
    let parenDepth = 0; // 括号内枚举不切组（"（防御+2，特防+2）"是上一句的维度列表——，碎片曾整批丢进 no-trigger-prefix）
    for (const seg of clause.split(/[，,\s　]+/)) {
      const linkedSegment = /^(?:并且?|且|同时|以及)/.test(seg.trim());
      let cs = seg.trim().replace(/[％﹪]/g, "%").replace(/[＋﹢]/g, "+").replace(/[－﹣]/g, "-").replace(/^(?:并且?|且|同时|以及|此外|另外)[，,、]?/, "").replace(NUM_PREFIX_RE, "").replace(/\s+[0-9０-９]{1,2}[、.．]?\s*$/, "").trim();
      if (cs === "" || /^[0-9０-９]{1,2}$/.test(cs)) continue; // 纯编号段=FAQ 页码碎屑
      if (cur.length === 0 && linkedSegment) cur.linkedContinuation = true;
      cs = redTry(cs); // 段级冗余主语剥除（只在剥后确实落到规则表、且未剥解不出时才生效；否则整段保持原文）
      const nested = parenDepth > 0;
      parenDepth = Math.max(0, parenDepth + (cs.match(/[（(]/g) ?? []).length - (cs.match(/[）)]/g) ?? []).length);
      if (nested) { cur.push(cs); continue; } // 括号深内的片段并入当前组不做边界判定；括号字符保留——下游 cap-tail/stat 处理器需要"（…）"标记
      // "且"内联边界（"先出手特攻+1且回合结束时恢复X"——逗号未断处且+触发词二次切分）
      // 切出的前半段要按普通分段处理：当前组非空、前半段本身是边界（自带触发词）、
      // 且两边都没有结果分支标记时，另起一组。
      // 不另起的后果：「A，B且C」并成一组——A 的触发词与守卫罩住 C，C 的触发词丢失，
      // 条件还可能被 A 的守卫反号（pet-3839：双防提升条件把「不处于」取反成「处于」，
      // 效果永远不触发）。
      // 结果分支标记（"触发成功/未触发…"）不能拆：尾句必须跟着该分支的作用域，
      // 否则会逃成无条件条目（soulmark-parse.test 的「不误伤并列子句」用例）。
      const qi = cs.length > 4 ? cs.search(/且(?=回合开始|回合结束|受到攻击|若(?:自身|对手|对方|当|每)|对手使用|自身登场|每次|本场战斗|每回合|下回合|当前回合)/) : -1;
      if (qi > 0) {
        const head = cs.slice(0, qi).trim();
        const hasOutcome = outcomeMarker.test(head) || cur.some((x) => outcomeMarker.test(x));
        const bareEvent = cur.length === 1 && TRIGGERS.some((t) => {
          if (t.re !== undefined) { const m = cur[0].match(t.re); return m !== null && m[0].length === cur[0].length; }
          const r = t.mk?.(cur[0]);
          return r !== undefined && r.body === "";
        });
        if (cur.length > 0 && !hasOutcome && !bareEvent && segBoundary(head)) { groups.push(cur); cur = [head]; }
        else cur.push(head);
        groups.push(cur);
        cur = [cs.slice(qi + 1).trim()]; cur.linkedContinuation = true; continue;
      }
      if (cur.length > 0 && segBoundary(cs)) { groups.push(cur); cur = [cs]; cur.linkedContinuation = linkedSegment; }
      else cur.push(cs);
    }
    if (cur.length > 0) groups.push(cur);
    // A result branch may be split at `且` before it reaches the effect
    // parser. Preserve that scope across tokenizer groups: a bare timed/passive
    // tail joined with a conjunction is still part of `triggered/failed then`
    // and cannot escape as an unconditional entry.
    let outcomeScopePending = false;
    let outcomeChanceGrowCapPending = false;
    const outcomeChanceGrow = /^(?:若)?(?:未触发|未命中|未击败|没有触发|均未触发|皆未触发)(?:则|，|,)(?:(?:下次|本次在场|在场)?[^，,；;。]{0,12}(?:概率|几率)(?:提升|增加|提高)\d+%|下次提升\d+%)/;
    const outcomeGrowCap = /^最高(?:提升至|提高到|增加到|提升|提高|增加|为|至|到|可达|可叠加)?\d+%?$/;
    for (const group of groups) {
      const groupText = group.join("，").trim().replace(/^[，,、；;：:\s]+/, "");
      const linked = group.linkedContinuation === true;
      if (outcomeScopePending) {
        if (outcomeChanceGrowCapPending && !linked && outcomeGrowCap.test(groupText)) {
          // A bare cap is the terminal part of the same explicit failed-chance
          // growth clause. Let the existing chanceGrow cap handler consume it.
          outcomeScopePending = false;
          outcomeChanceGrowCapPending = false;
          group.outcomeChanceGrowCap = true;
        } else if (!linked && startsWithSupportedTrigger(groupText)) {
          outcomeScopePending = false;
          outcomeChanceGrowCapPending = false;
        } else group.withholdOutcomeTail = true;
      }
      if (outcomeMarker.test(groupText)) {
        outcomeScopePending = true;
        outcomeChanceGrowCapPending = outcomeChanceGrow.test(groupText);
      }
    }

    let pendingCond = clauseBenchCond; // 跨组条件（"P时，Q"逗号拆分——P 暂存 Condition；括号背包守卫预置种子）
    let pendingCondSrc; // 条件来源子句（orphan 诊断时挂原文而非 JSON）
    let lastGrowMount; // 名宿成长挂载点（"感染几率增加10%，最高50%"——cap 尾随跨条目名宿回挂）
    let pendingEmpty; // 裸触发组结转（"回合开始时"独占一组被逗号边界切开——其 hook 结转 lastHook，不即时报 empty-body）
    let pendingBenchCtx; // "背包内每存活/阵亡N只精灵"跨组缩放语境（逗号把计数片段与效果句切开——flags.benchCtx 透出后暂存，挂下一组 pct/shield op）
    let pendingHpStep; // "自身HP每降低N%"跨组步进语境（逗号切开后暂存，下组 pct 宿主转 perHpLostStep/perHpLostPct）
    let pendingHpStepKindMask; // 显式“攻击技能前”步进只覆盖攻击伤害类型
    let pendingAilTurn; // "自身每有1回合流血"跨组缩放语境（逗号切开——下组 pct 窗转 pctPerAilTurn 落地烘焙）
    let pendingHpDiffCtx; // "每与对手相差N点"跨组缩放语境（下组 pct 窗转 perHpDiffEvery/perHpDiffPct）
    let pendingShieldCtx; // "双方每有N点护盾"跨组缩放语境（下组 pct 窗转 perShieldEvery/perShieldPct/perShieldWho）
    let pendingAtCap; // "当效果叠加至N%时"跨组达顶语境（逗号切开——下组 ops 归入宿主 atCapOps 而非独立条目）
    const elsePending = []; // "不相同时X"inner else 支路暂存——newEntry 落地后克隆 not 守卫条
    const condGroups = () => (pendingCond !== undefined ? pendingCond : undefined);
    const enterQuarantine = (reason) => {
      guardQuarantine = true;
      guardQuarantineReason = reason;
      lastHook = undefined;
      pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined;
      pendingBenchCtx = undefined; pendingHpStep = undefined; pendingHpStepKindMask = undefined; pendingAilTurn = undefined;
      pendingHpDiffCtx = undefined; pendingShieldCtx = undefined; pendingAtCap = undefined;
      lastGrowMount = undefined; elsePending.length = 0;
    };
    const quarantineGroup = (text, reason) => {
      // 纯噪声片段（图鉴页尾 / 裸主语 / 编号残渣）不记残文——同 recordOuterResidual 的口径。
      if (!isNoiseFragment(text) || entries.length === 0) unparsed.push({ clause: text, reason });
      enterQuarantine(reason);
    };
    const prevAppliedHost = () => {
      const entry = entries[entries.length - 1];
      if (entries.length <= clauseEntryStart || entry?.hook === undefined || lastHook?.hook !== entry.hook) return undefined;
      const entryGuard = entry.guard;
      const entryActor = entryGuard?.actor ?? entry.actor;
      const entryCat = entryGuard?.cat ?? entry.cat;
      const hostActor = lastHook.extra?.actor;
      const hostCat = lastHook.extra?.cat;
      if (hostActor !== undefined && entryActor !== hostActor) return undefined;
      if (hostCat !== undefined && JSON.stringify(entryCat) !== JSON.stringify(hostCat)) return undefined;
      // Entry chance failure selects elseOps before the main ops run. It cannot
      // be observed by a later `if: not prevApplied` in the skipped main list.
      // Keep a host only when a real operation in the same event can update the
      // runner's prevApplied outcome; a chance field alone is not such a result.
      return Array.isArray(entry.ops) && entry.ops.some(isPrevAppliedResultOp) ? entry : undefined;
    };
    outerG: for (const g of groups) {
      const linkedContinuation = g.linkedContinuation === true;
      const groupUnparsedStart = unparsed.length;      let gtext = g.join("，").trim().replace(/^[，,、；;：:\s]+/, "").replace(/，(?=[+-]\d)/g, ""); // "体力，+10"切分碎片回拼——逗号后紧跟有符号数属上维度增量，非子句边界
      if (gtext === "") continue;
      if (g.withholdOutcomeTail === true) {
        quarantineGroup(gtext, "prevApplied branch continuation — linked tail cannot be detached safely (deferred)");
        continue;
      }
      if (/^(?:若)?(?:未触发|未命中|未击败|没有触发|均未触发|皆未触发|触发成功|触发失败|免疫成功|免疫失败)(?:则)?(?:在)?回合(?:开始|结束)(?:时|后)/.test(gtext)) {
        quarantineGroup(gtext, "cross-event outcome — previous trigger result cannot guard a later turn event (deferred)");
        continue;
      }
      const linkedOutcomeScope = /(?:免疫成功|触发成功|施加成功|反转成功|未触发|未命中|未击败|免疫失败|触发失败|反转失败)/.test(gtext);
      if (namedDefinitionQuarantine) { recordOuterResidual(gtext, "named-domain definition — field/state-machine effects unmodeled (deferred)"); continue; }
      if (NAMED_DOMAIN_LABEL_RE.test(gtext) || isIntroducedDomainLabel(gtext)) {
        namedDefinitionQuarantine = true;
        namedDomainQuarantine = true;
        quarantineGroup(gtext, "named-domain definition — field/state-machine effects unmodeled (deferred)");
        continue;
      }
      // “首次使用……在打出之前”的前置关系覆盖随后清场窗口；它不能被中间的回合结束触发词释放。
      if (firstUseBeforeWindow && (/(?:首次(?:使用|攻击|出手))/.test(gtext) || /^在打出之前/.test(gtext))) {
        quarantineGroup(gtext, "first-use prerequisite — before-first-use window cannot be represented (deferred)");
        continue;
      }
      // 单字孤儿（"辛"/"时"——名前缀剥后残余，无语义载量）
      if (/^[一-龥]$/.test(gtext)) continue;
      // "赛尔号X·"整句残余——FAQ/名前缀污染（无语义载量）
      if (/^赛尔号[一-龥]{1,10}[·:]?$/.test(gtext)) continue;
      // "对手若P则X"→"若对手P则X"（body 级归一不覆盖组首；condOf 认"对手体力低于N%"）
      gtext = gtext.replace(/^(?:对手|对方|敌方)若/, "若对手");
      // "本场战斗"范围前缀剥除（"本场战斗造成的攻击伤害提升10%"=常驻窗——无中字尾的 bare 形，BATTLE_PREAMBLE 未覆盖）
      gtext = gtext.replace(/^本场战斗(?=造成|受到|自身|对手|对方|的)/, "");
      // "自身位于场上时"恒真冗余前缀（魂印持有者出战恒真——组级剥除，body 级另有 normalizeSoulBody 同构处理）
      gtext = gtext.replace(/^(?:若|当)?(?:自身|自己)?位于场上时[，,、]?/, "");
      // 奇偶回合窗：同一魂印里的偶句已经是裸形（"偶数回合使用技能后吸取对手最大体力的1/3"），句首「自身」只是冗余主语。
      // 触发扫描在 gtext 上先行（normalizeSoulBody 只作用于交 parseEffectText 的 body），剥除要放在这一层才够得着。
      gtext = gtext.replace(/^自身(?=(?:奇数|偶数)回合)/, "");
      gtext = gtext.replace(/^效果(?:是|为|：|:)?(?=每次|每|自身|对手|对方|敌方|攻击|使|令|在|当|若)/, ""); // "效果每次攻击…"引导词——触发词匹配前剥（body 级 normalizeSoulBody 同构但触发在 gtext 上先行）
      gtext = gtext.replace(/^(?:其|该|此)?效果(?:是|为)[：:]?/, ""); // "其效果为回合结束时…"散文引导词（组级同构剥除）
      if (gtext === "") continue;
      // 组级裸名前缀补剥（"死亡后，混元天尊开始免疫…"逗号切组后名+动词起首——子句级剥只覆盖组首）
      if (nameAlts.length > 0) gtext = stripPet(gtext, `所有|每|自身|攻击|对|回|受|免疫|在|处|使|令|技|先|后|登|作|死|开|缔|附|进|变|切|闪|驱|失|获|吸|恢|造|消|抵|免|克|微`);
      // Quarantine before any tail handler can mutate the previous entry (dynamic chance,
      // grow, attach-all, caps, and other cross-group mounts all share this boundary).
      if (guardQuarantine) {
        if (startsWithSupportedTrigger(gtext) && !linkedContinuation && !condHold) {
          guardQuarantine = false;
          guardQuarantineReason = guardUnmodeledReason;
          lastHook = undefined;
        } else {
          // condHold：上一组是**未建模的条件**（"自身克制对手时"）。本组是它的效果，
          // 即使自带触发词也不能无条件执行——扣下，条件残文留在前一条。
          //
          // 这里**不改** condHold：被扣下的这组可能是
          //   ① 又一个未建模条件（"自身微弱对手时 自身克制对手时，负载"）→ 扣留要继续传递；
          //   ② 该条件的负载 → 扣留由 clause 边界收口（line 1493 的 condHold 分支）。
          // 提前清掉 condHold 会让下一个组通过 line 1901 的解除条件，负载变成无条件执行
          // ——pet-4814 娜诺正是这个形状。
          if (condHold) {
            const bareGuard = UNSUPPORTED_TRIGGERS.some((u) =>
              /^(?:attr-domain|gender-cond)/.test(u.reason) && u.re.test(gtext) && /(?:时|则)[，,、]?$/.test(gtext.trim()));
            if (!bareGuard) condHoldHasPayload = true;
          }
          quarantineGroup(gtext, guardQuarantineReason);
          continue;
        }
      }
      // A comma-delimited `若P，X` is a guard even without `则`. If P has no
      // supported predicate, retain the linked body and quarantine its tails;
      // otherwise the preceding explicit turn hook can make X unconditional.
      // Event phrases such as `若自身被击败时` still go through their explicit
      // trigger rule, while modeled predicates (for example `自身满体力`) remain
      // available to the normal condition carry path below.
      const unknownGuardIn = (text) => {
        const comma = text.match(/^若([^，,、]{2,32}?)(?:时)?[，,、]\s*(.+)$/);
        const timed = text.match(/^若([^，,、]{2,32}?)时(.+)$/);
        const bare = text.match(/^若([^，,、]{2,32}?)(?:时)?$/);
        const then = text.match(/^若([^，,、]{2,32}?)则(.+)$/);
        const m = then ?? comma ?? timed ?? bare;
        if (m === null || smCondOf(m[1].replace(/^处于/, "自身处于")) !== undefined) return false;
        if (startsWithSupportedTrigger(text)) return false;
        // More specific deferred families should retain their established
        // reason instead of being collapsed into the generic guard bucket.
        if (UNSUPPORTED_TRIGGERS.some((u) => u.re.test(text))) return false;
        const hasBody = comma !== null || timed !== null || then !== null;
        const looksLikeAction = /(?:触发|令|使|造成|恢复|回复|吸取|消除|清除|解除|提升|增加|降低|减少|免疫)/.test(text);
        return hasBody || !looksLikeAction;
      };
      let unknownGuard = unknownGuardIn(gtext);
      // A trigger and a comma-style guard can land in one parser group when the
      // guard itself has no modeled predicate, e.g. `回合开始时，若未知条件`.
      // Inspect only explicit event prefixes; default-timed conditions do not
      // establish a trustworthy boundary after an unknown guard.
      if (!unknownGuard) {
        for (const t of TRIGGERS) {
          if (t.re === undefined || t.weak === true || t.hook === "__turn__") continue;
          const m = gtext.match(t.re);
          if (m === null || m.index !== 0 || m[0].length === 0) continue;
          const rest = gtext.slice(m[0].length).replace(/^[，,、\s]+/, "");
          if (unknownGuardIn(rest)) { unknownGuard = true; break; }
        }
      }
      if (unknownGuard) {
        quarantineGroup(gtext, guardUnmodeledReason);
        continue;
      }
      // "此效果翻倍"/"本场战斗此效果翻倍" → attachAll effectDouble 挂载 token（回挂前条目 ops）
      if (/^(?:本场战斗)?(?:此|该|上述)效果翻倍$/.test(gtext)) gtext = "<attachAll effectDouble>";
      // "几率等同(于)自身当前/已损失体力百分比" —— 动态概率挂载前条目（chanceDyn：判定时刻按体力比例算）
      const dynM = gtext.match(/^(?:有(?:一定)?几率|几率|概率)(?:等同于?|等于|与)?(?:自身|自己|对手|对方|敌方)?((?:当前|现有|剩余)?已损失|损失|当前|现有|剩余)?的?体力(?:值)?的?百分比$/);
      if (dynM !== null && entries.length > 0) {
        const missing = /损失/.test(dynM[1] ?? "");
        const foeSide = /对手|对方|敌方/.test(dynM[0]);
        entries[entries.length - 1].chanceDyn = foeSide ? (missing ? "foeMissingHpPct" : "foeHpPct") : (missing ? "selfMissingHpPct" : "selfHpPct");
        segParsed = true; continue;
      }
      // 残留前导标点二次剥除（rest/im[2] 重派后可能带"，"——成长尾/挂载尾正则均 ^ 锚定）
      gtext = gtext.replace(/^[，,、；;：:\s]+/, "");
      // "之后X"/"触发后X"——接续副词（组首语境下表"随后/前一子句触发后结算"，无独立语义；body 归一另有同款）
      gtext = gtext.replace(/^触发后/, "之后");
      if (gtext.startsWith("之后") && gtext.length > 2) gtext = gtext.slice(2);
      if (gtext === "") continue;
      // Permanent maximum-HP costs cannot be represented by the temporary max_hp_down status.
      // Keep the linked cost and recovery together so a free full heal is never emitted.
      if (/消耗自身\d+点(?:体力上限|最大体力).{0,12}(?:并|后|，|,)\s*(?:恢复|回复)(?:自身)?全部(?:体力|HP)/.test(gtext)) {
        const reason = "permanent max-HP cost — semantic cost unsupported (deferred)";
        quarantineGroup(gtext, reason);
        continue;
      }
      // A start/end-of-turn condition that assigns a later move-triggered effect crosses timing windows.
      // Defer the whole group before ordinary trigger extraction can move its guard onto onMoveUsed.
      if (/^(?:每次)?(?:回合开始|回合结束)(?:时|后|[，,])(?:若|当).{1,36}?(?:则|时)(?:当回合|本回合)?(?:自身|自己)?使用(?:攻击|属性|物理|特殊)?技能/.test(gtext)) {
        const reason = "nested trigger timing — turn-scope condition cannot guard later move event (deferred)";
        quarantineGroup(gtext, reason);
        continue;
      }
      // 括号内联封顶尾（"降低10%（最高可叠加5次）"——括号含数字不被纯文本剥除，残留句尾）→ 剥出追加为新组走 gcap/rdc 回挂本组条目
      const ipc = gtext.match(/[（(](最高(?:可)?叠加(?:至|到)?\d+(?:次|%|点)|最多(?:可)?叠加(?:至|到)?\d+(?:次|%|点)|至多叠加(?:至|到)?\d+(?:次|%|点)|最[高多至]+(?:减少|降低|减免)(?:至|到)?\d+%?)[)）]\s*$/);
      if (ipc !== null) { groups.push([ipc[1]]); gtext = gtext.slice(0, gtext.length - ipc[0].length).replace(/[，,\s]+$/, ""); if (gtext === "") continue; }
      // "背包内每存活N只精灵则护盾值增加M" —— 护盾按背包存活数加成（回挂前条 shield.params.flatPerBench；非独立窗）
      const shb = gtext.match(/^背包内每存活(?:\d+|一)只精灵则护盾值(?:增加|提升|提高)?(\d+)(?:点)?$/);
      if (shb !== null) {
        const sh = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "shield" && o.params?.flat !== undefined);
        if (sh !== undefined) { sh.params.flatPerBench = +shb[1]; continue; }
      }
      // 上组整段延期时，后续纯修饰尾（最高/最多/每…增加·提升·叠加）并入该 deferred 残留——同属其语义，不再独立孤儿
      if (/deferred/.test(unparsed[unparsed.length - 1]?.reason ?? "") && /^(?:最高(?:提升|提高|增加|为|至|到|可达|可叠加|叠加至)?\d+[%点]?|最多可?叠加\d+次|最高\+\d+|每(?:次|回合)(?:开始|结束)?(?:使用|触发)?(?:技能)?(?:时|后|额外)?(?:概率|几率)?(?:增加|提高|提升|叠加)\d+[%点]?|(?:每次|每回合|每使用|每触发)?(?:可)?(?:叠加|增加|提升)\d+点)$/.test(gtext)) { unparsed[unparsed.length - 1].clause += "，" + gtext; continue; }
      // 组级"最高N%"/"最多叠加N次"尾句 → 回挂最近 growStep op 的 growCap（含括号/可叠加至变体）
      const gc0 = gtext.replace(/^[（(]/, "").replace(/[)）]$/, "");
      const gcap = gc0.match(/^最高(?:提升|提高|增加|为|至|到|可达|可叠加|可叠加至|的?概率|的?几率)?(\d+)%?$/) ?? gc0.match(/^最[高多]可?叠加(?:至|到)?(\d+)次$/) ?? gc0.match(/^最高\+(\d+)$/);
      if (gcap !== null) {
        // "最多/高可叠加N次"：apply_mark→cap；pct 窗宿主→条目 growStep=pct, growCap=pct×N（与 markCap 通道同构；仅"次"尾为次数域，"可叠加至N%"是百分域封顶）
        if (/叠加(?:至|到)?\d+次/.test(gc0)) {
          const mk2 = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_mark");
          if (mk2 !== undefined) { mk2.cap = +gcap[1]; continue; }
          const ge0 = entries[entries.length - 1];
          // dmg_weaken n/d 宿主（"令对手伤害减少N%…可叠加M次"）：n/d 域方向与 growOp 相反——拆分为独立负 pct 域条目，
          // 负 growStep/负 growCap（cap<0=地板）使减免逐次加深；同条目的正向 pct 宿主仍走下分支各自封顶
          const wk = [...(ge0?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "dmg_weaken" && o.params?.n !== undefined && o.params?.d !== undefined);
          let wkDone = false;
          if (wk !== undefined && ge0 !== undefined) {
            const red = Math.round(100 - (wk.params.n * 100) / wk.params.d);
            const wkParams = { ...wk.params }; delete wkParams.n; delete wkParams.d;
            ge0.ops = ge0.ops.filter((o) => o !== wk);
            entries.push({ ...ge0, ops: [{ ...wk, name: "dmg_boost", params: { ...wkParams, pct: -red } }], growStep: -red, growCap: -red * +gcap[1] });
            wkDone = true;
          }
          const ph2 = [...(ge0?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined && o.params.pct >= 0);
          if (ph2 !== undefined) { ge0.growStep = ph2.params.pct; ge0.growCap = ph2.params.pct * +gcap[1]; continue; }
          // 数值 add 宿主（"从下回合起所有技能先制+1，最高叠加3次"）→ 条目 growStep=add, growCap=add×N（growOp 注入 params.add）
          const ad2 = [...(ge0?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && typeof o.params?.add === "number");
          if (ad2 !== undefined && ge0 !== undefined) { ge0.growStep = ad2.params.add; ge0.growCap = ad2.params.add * +gcap[1]; continue; }
          // heal/drain 分数宿主（"吸取对手最大体力1/3，最多叠加3次"——op 级 numerator/denominator 走 growOp gfrac 注入）
          const hf2 = [...(ge0?.ops ?? [])].reverse().find((o) => (o.op === "heal" || o.op === "damage") && typeof o.numerator === "number" && typeof o.denominator === "number");
          if (hf2 !== undefined && ge0 !== undefined) { const bp = Math.round((hf2.numerator * 100) / hf2.denominator); ge0.growStep = bp; ge0.growCap = Math.min(100, bp * +gcap[1]); continue; }
          if (wkDone) continue;
        }
        // "最高+N"裸值绝对封顶（"下回合先制+1，最高+3"）→ add 宿主条目 growStep=add, growCap=N（growOp 注入 params.add 总额封顶）
        if (/^最高\+\d+$/.test(gc0)) {
          const ad3 = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && typeof o.params?.add === "number");
          const ge5 = entries[entries.length - 1];
          if (ad3 !== undefined && ge5 !== undefined) { ge5.growStep = ad3.params.add; ge5.growCap = +gcap[1]; continue; }
        }
        // "最高可叠加至N%"（百分域总额封顶——非次数）：pct 宿主无成长轨时建条目 growStep=pct, growCap=N（growOp 封顶结果值恰为总额语义）
        if (/可叠加至?\d+%/.test(gc0)) {
          const ge4 = entries[entries.length - 1];
          const pctHost = [...(ge4?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined);
          if (pctHost !== undefined && ge4 !== undefined && ge4.growStep === undefined) { ge4.growStep = pctHost.params.pct; ge4.growCap = +gcap[1]; continue; }
        }
        const host = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.growStep !== undefined);
        if (host !== undefined) { host.params.growCap = +gcap[1]; continue; }
        const ge = entries[entries.length - 1];
        if (ge !== undefined && ge.chanceGrow !== undefined) { ge.chanceGrow = { ...ge.chanceGrow, cap: +gcap[1] }; continue; }
        if (lastGrowMount !== undefined && lastGrowMount.chanceGrow !== undefined && lastGrowMount.chanceGrow.cap === undefined) { lastGrowMount.chanceGrow = { ...lastGrowMount.chanceGrow, cap: +gcap[1] }; continue; }
        if (ge !== undefined && ge.growStep !== undefined) { ge.growCap = +gcap[1]; continue; }
        // perStage 宿主（"每处于1种能力提升则伤害提升20%，最高60%"）→ perStageCap 封顶维度乘算（运行时新增字段）
        const sh2 = [...(ge?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && (o.params?.perStage !== undefined || o.params?.perFoeStage !== undefined || o.params?.perFoeStageDown !== undefined || o.params?.perBenchDead !== undefined || o.params?.perBenchAlive !== undefined || o.params?.perHpDiffPct !== undefined || o.params?.perShieldPct !== undefined) && o.params?.perStageCap === undefined);
        if (sh2 !== undefined) { sh2.params.perStageCap = +gcap[1]; continue; }
        // pctPerAilTurn 宿主（"每有1回合流血伤害提升15%，最高90%"）→ spec.cap
        const shAil = [...(ge?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.pctPerAilTurn !== undefined && o.pctPerAilTurn.cap === undefined);
        if (shAil !== undefined) { shAil.pctPerAilTurn = { ...shAil.pctPerAilTurn, cap: +gcap[1] }; continue; }
        // 无成长轨 pct 宿主（"每次使用攻击技能…威力提升5%，最高30%"——重触发叠深近似：条目 growStep=pct, growCap=cap，growOp 封结果值=总额，UNVERIFIED）
        const ph3 = [...(ge?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined && o.params.pct >= 0);
        if (ge !== undefined && ph3 !== undefined) { ge.growStep = ph3.params.pct; ge.growCap = +gcap[1]; continue; }
        // shield 宿主（"最高600"无单位总额封顶 → params.flatCap——落地时 flatPerBench 加成受此封顶）
        const sh3 = [...(ge?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "shield" && o.params?.flat !== undefined && o.params.flatCap === undefined);
        if (sh3 !== undefined) { sh3.params.flatCap = +gcap[1]; continue; }
        // damage op 叠用宿主跨组回挂（"附加自身最大体力20%固伤，每次使用增加10%，最高40%"）：flat*Frac 值域封顶 → powerMulPerUseCap = N/base×100
        // 前一条目已经把家族键收成 rider，从 rider 上读写，不写回 damage。
        const dOps = ge?.ops;
        if (readHit(dOps, "powerMulPerUse") !== undefined && readHit(dOps, "powerMulPerUseCap") === undefined) {
          const fb = readHit(dOps, "flatSelfFrac")?.numerator ?? readHit(dOps, "flatFoeFrac")?.numerator ?? readHit(dOps, "flatSelfStatPct") ?? readHit(dOps, "flatFoeStatPct");
          writeHit(dOps, "powerMulPerUseCap", fb !== undefined && fb > 0 && fb <= +gcap[1] ? { numerator: Math.round((+gcap[1] * 100) / fb), denominator: 100 } : { numerator: 100 + +gcap[1], denominator: 100 });
          continue;
        }
        if ((readHit(dOps, "flatPerUse") !== undefined && readHit(dOps, "flatPerUseCap") === undefined) || (readHit(dOps, "dmgPerUsePct") !== undefined && readHit(dOps, "dmgPerUsePctCap") === undefined) || (readHit(dOps, "critPerUsePct") !== undefined && readHit(dOps, "critPerUseCap") === undefined) || (readHit(dOps, "chancePerUse") !== undefined && readHit(dOps, "chancePerUseCap") === undefined)) {
          if (readHit(dOps, "flatPerUse") !== undefined && readHit(dOps, "flatPerUseCap") === undefined) writeHit(dOps, "flatPerUseCap", +gcap[1]);
          else if (readHit(dOps, "dmgPerUsePct") !== undefined && readHit(dOps, "dmgPerUsePctCap") === undefined) writeHit(dOps, "dmgPerUsePctCap", +gcap[1]);
          else if (readHit(dOps, "critPerUsePct") !== undefined && readHit(dOps, "critPerUseCap") === undefined) writeHit(dOps, "critPerUseCap", +gcap[1]);
          else writeHit(dOps, "chancePerUseCap", +gcap[1]);
          continue;
        }
        // chance 宿主（"每次攻击命中后20%令对手害怕，最高80%"）→ 条级 chanceGrow 封顶：
        // 显式步进优先（chancePerUse=每次+N% 已在 op 上）；无步进时以基础 chance 为步进（重触发叠深近似 UNVERIFIED）
        if (ge !== undefined && ge.chanceGrow === undefined) {
          const cpu = [...(ge?.ops ?? [])].reverse().find((o) => o.chancePerUse !== undefined);
          const ch2 = [...(ge?.ops ?? [])].reverse().find((o) => o.chance !== undefined);
          const step = cpu?.chancePerUse ?? ch2?.chance;
          if (step !== undefined) {
            const base = ch2?.chance;
            for (const o of ge.ops) { delete o.chancePerUse; delete o.chancePerUseCap; if (base !== undefined && o.chance === base) delete o.chance; }
            if (base !== undefined) ge.chance = base;
            ge.chanceGrow = { add: step, cap: +gcap[1] }; continue;
          }
        }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // 组级"最多/最高减少[至]N%（或N/M）"减免总额封顶 → growStep 宿主 growCap=cap−basePct（pct+acc≤cap，按总额语义折算）
      const rdc = gtext.match(/^(?:最多|最高|至多)(?:减少|降低|减免)(?:至|到)?(\d+)%?$/) ?? (() => { const f = gtext.match(/^(?:最多|最高|至多)(?:减少|降低|减免)(?:至|到)?(\d+)\/(\d+)$/); return f === null ? null : [f[0], String(Math.round((+f[1] * 100) / +f[2]))]; })();
      if (rdc !== null) {
        const e = entries[entries.length - 1];
        const host = [...(e?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.growStep !== undefined);
        if (host !== undefined) { host.params.growCap = Math.max(0, +rdc[1] - (host.params.pct ?? 0)); continue; }
        if (e !== undefined && e.growStep !== undefined) { e.growCap = +rdc[1]; continue; }
        // 无成长轨的 pct 减免宿主（"受到伤害减少30%，最高减少50%"）→ 条目 growStep=pct + growCap=cap（重触发叠深、cp 封结果值=总额语义）
        const rp = [...(e?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined);
        if (e !== undefined && rp !== undefined) { e.growStep = rp.params.pct; e.growCap = +rdc[1]; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // 裸修饰语孤儿（"每处于1种能力提升状态"独立成组——perStage 乘算修饰缺宿主 op）
      if (/^(?:自身|自己|对手|对方|敌方)?每(?:处于|有|存在)(?:1|一|每)?种?能力(?:提升|强化|下降)(?:状态)?$/.test(gtext)) { unparsed.push({ clause: gtext, reason: "modifier orphan — per-stage scaling host missing (UNVERIFIED)" }); continue; }
      // "最高先制+N"（"所有攻击先制+1，最高先制+5"）→ 最近 beforeOrder 条目 prio.max 封顶；无宿主报孤儿
      const gpc = gtext.match(/^最高(?:可?叠加(?:至|到)?)?先制\+?(\d+)$/);
      if (gpc !== null) {
        const ph = [...entries].reverse().find((e) => e.prio !== undefined);
        if (ph !== undefined) { ph.prio.max = Math.min(ph.prio.max, +gpc[1]); continue; }
        // prio_up 常驻宿主（"所有技能先制+1，最高先制+3"——无 beforeOrder 区间时按成长封顶）
        const gpe = entries[entries.length - 1];
        const pu = [...(gpe?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "prio_up" && typeof o.params?.add === "number");
        if (pu !== undefined && gpe !== undefined) { gpe.growStep = pu.params.add; gpe.growCap = +gpc[1]; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // 组级"最高N点"（裸值成长封顶——"每回合增加50点，最高400点"）→ 最近 point-domain growStep 条目 growCap；无宿主报孤儿
      const gcap3 = gtext.match(/^最高(?:提升|提高|增加|为|至|到|可叠加至?|可达)?(\d+)点$/);
      if (gcap3 !== null) {
        const ge3 = entries[entries.length - 1];
        if (ge3 !== undefined && pointGrow.has(ge3) && ge3.growCap === undefined) { ge3.growCap = +gcap3[1]; continue; }
        // shield/ward 宿主（"为双方附加200点护盾，最高400点"——总额封顶 → flatCap）
        const sw3 = [...(ge3?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && (o.name === "shield" || o.name === "ward") && o.params?.flat !== undefined && o.params.flatCap === undefined);
        if (sw3 !== undefined) { sw3.params.flatCap = +gcap3[1]; continue; }
        // damage 叠用宿主（"附加N点固伤，每次使用增加M点，最高K点"）→ flatPerUseCap
        if (readHit(ge3?.ops, "flatPerUse") !== undefined && readHit(ge3?.ops, "flatPerUseCap") === undefined) { writeHit(ge3.ops, "flatPerUseCap", +gcap3[1]); continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // "最高附加N点固伤"动词嵌入形 → 同款宿主链（固伤点域封顶）
      const gcap4 = gtext.match(/^最高(?:可)?(?:叠加至?|附加|提升|提高|增加|为|至|到|可达)?(\d+)点(?:固定伤害|固伤)$/);
      if (gcap4 !== null) {
        const ge4 = entries[entries.length - 1];
        if (ge4 !== undefined && pointGrow.has(ge4) && ge4.growCap === undefined) { ge4.growCap = +gcap4[1]; continue; }
        if (readHit(ge4?.ops, "flatPerUse") !== undefined && readHit(ge4?.ops, "flatPerUseCap") === undefined) { writeHit(ge4.ops, "flatPerUseCap", +gcap4[1]); continue; }
        const sw4 = [...(ge4?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && (o.name === "shield" || o.name === "ward") && o.params?.flat !== undefined && o.params.flatCap === undefined);
        if (sw4 !== undefined) { sw4.params.flatCap = +gcap4[1]; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // "护[盾罩](或护罩)?(任意一个)?消失(时|后)X" → react trigger4 边沿（破盾一次性反应窗——勿走 cond 电平"无盾时每回合判定"歧义路径）
      const sbr = gtext.match(SHIELD_BREAK_RE);
      if (sbr !== null) {
        const body2 = sbr[1] ?? sbr[2] ?? sbr[3];
        const rw = reactWrap(4, {}, body2);
        if (rw !== undefined && (rw.effects ?? []).length > 0) {
          entries.push({ hook: "onBattleStart", ...(bossGate ? { bossGate: true } : {}), ops: rw.effects });
          segParsed = true; continue;
        }
        unparsed.push({ clause: gtext, reason: "shield-break payload unparsed (deferred)" }); continue;
      }
      // "自身HP每降低N%"/"体力每损失N%"/"每损失N%体力" 步进前缀 → pendingHpStep（前缀剥出后余文继续；下组 pct 宿主转 perHpLostStep/perHpLostPct）
      const hps = gtext.match(/^(?:自身|自己)?(?:的)?(?:HP|体力|血量|生命值)?(?:最大)?(?:体力|HP|生命值)?每(?:降低|减少|损失|下降)(\d+)%(?:的)?(?:最大)?(?:体力|HP|生命值)?(?:，|,|则|时)?|^每(?:降低|减少|损失|下降)(\d+)%(?:的)?(?:最大)?(?:体力|HP|生命值)?(?:，|,|则|时)?/);
      if (hps !== null) { pendingHpStep = +(hps[1] ?? hps[2]); gtext = gtext.slice(hps[0].length).replace(/^[，,、则时]+/, ""); if (gtext === "") { segParsed = true; continue; } }
      // "自身每有N回合AIL" 步进前缀 → pendingAilTurn（逗号切开的独立分句；下组 pct 宿主转 pctPerAilTurn）
      const apt = gtext.match(new RegExp(`^(?:自身|自己)每有(\\d+|一)回合(${AIL_ALT})(?:状态)?(?:，|,|则|时|$)`));
      if (apt !== null && AILMENTS[apt[2]] !== undefined) {
        pendingAilTurn = { ail: AILMENTS[apt[2]], per: apt[1] === "一" ? 1 : +apt[1] };
        gtext = gtext.slice(apt[0].length).replace(/^[，,、则时]+/, "");
        if (gtext === "") { segParsed = true; continue; }
      }
      // "减伤效果降低15%"/"伤害提升效果降低10%"/"几率提升10%" 效果步进退变尾（pendingHpStep 语境→前 pct 宿主挂 perHpLostStep+perHpLostPct±N）
      const hsm = pendingHpStep !== undefined ? gtext.match(/^(?:减伤|伤害减免|承伤减免|受到的伤害|增伤|伤害提升|攻击伤害提升|伤害|几率|概率|恢复|恢复量|护盾值|效果)(?:的)?(?:效果|量|值)?(降低|减少|下降|衰减|提升|增加|提高|上升|翻倍)(\d+)%(?:的)?$/) : null;
      if (hsm !== null) {
        const sgn = /降低|减少|下降|衰减/.test(hsm[1]) ? -1 : /翻倍/.test(hsm[1]) ? 0 : 1;
        const host = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken|heal_boost/.test(o.name ?? ""));
        if (host !== undefined) { host.params = { ...host.params, perHpLostStep: pendingHpStep, perHpLostPct: sgn === 0 ? host.params.pct : sgn * +hsm[2] }; pendingHpStep = undefined; continue; }
      }
      // "最多吸取N点(HP|体力)" 吸取量封顶尾 → 最近 drain_atk op params.cap（吸取产 heal op 时兜底 heal.cap——吸取量=治疗量）
      const dcp = gtext.match(/^(?:最多|至多|最高)吸取(\d+)点(?:HP|体力|生命)?$/);
      if (dcp !== null) {
        const cand = [...(entries[entries.length - 1]?.ops ?? [])].reverse();
        const dh = cand.find((o) => o.op === "apply_status" && o.name === "drain_atk" && o.params !== undefined);
        if (dh !== undefined) { dh.params.cap = +dcp[1]; continue; }
        const hl = cand.find((o) => o.op === "heal");
        if (hl !== undefined) { hl.cap = +dcp[1]; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // 组级"每次使用(攻击技能|则)?额外增加N点固伤" → flatPerUse 回挂最近 damage op（防触发词把"每次使用"剥成 onMoveUsed 新条目）
      const gpu = gtext.match(/^每次使用(?:攻击技能|技能)?(?:都)?(?:额外|则额外|则)?(?:增加|提升|提高|附加)(\d+)点(?:固定|固伤|的固定|的固伤)?(?:伤害)?$/);
      if (gpu !== null) {
        const dh = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "damage");
        if (dh !== undefined) { dh.flatPerUse = (dh.flatPerUse ?? 0) + +gpu[1]; continue; }
        unparsed.push({ clause: gtext, reason: "growth-orphan" }); continue;
      }
      // 组级"每次使用/触发/受到攻击…(概率|减少量|伤害量|幅度)增加|提升N%[，最高M%]"成长尾 → 回挂最近条目 chanceGrow 或 growStep（"最高M%"→cap/growCap）
      const gg = gtext.match(/^每(?:次|回合)(?:开始|结束)?(?:使用|触发|受到攻击伤害|受到攻击|遭受攻击|受到|攻击)?(?:技能)?(?:时|后|额外)?(?:的)?(?:[\u4e00-\u9fa5]{0,4}?(?:概率|几率)|伤害减少量|减少量|伤害量|效果|幅度|倍率)?(?:的)?(?:增加|提高|提升|增减)(\d+)%(?:，|,)?(?:最高(\d+)%?)?$/);
      if (gg !== null) {
        const cap = gg[2] !== undefined ? +gg[2] : undefined;
        const e = entries[entries.length - 1];
        if (e !== undefined && e.chance !== undefined) { e.chanceGrow = cap !== undefined ? { add: +gg[1], cap } : { add: +gg[1] }; continue; }
        // react 包络宿主（"受到攻击则30%令对手冰封，每次触发几率提升10%，最高80%"）→ react.params.growStep/growCap——每触发 growAcc 抬 payload chance（fireReactive 逐触发读）
        const rk = [...(e?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "react" && o.payload !== undefined);
        if (rk !== undefined) { rk.params = { ...(rk.params ?? {}), growStep: +gg[1], ...(cap !== undefined ? { growCap: cap } : {}) }; continue; }
        // 嵌套 payload chance（react 包络内 roll——提升到条级 chance 等价单次 roll，chanceGrow 通道可达）
        const nest = [...(e?.ops ?? [])].reverse().flatMap((o) => o.payload ?? []).find((p) => p.chance !== undefined);
        if (nest !== undefined && e !== undefined) { e.chance = nest.chance; for (const o of e.ops) for (const p of (o.payload ?? [])) if (p.chance === nest.chance) delete p.chance; e.chanceGrow = cap !== undefined ? { add: +gg[1], cap } : { add: +gg[1] }; continue; }
        const host = [...(e?.ops ?? [])].reverse().find((o) => o.chance !== undefined);
        if (host !== undefined) { const e2 = entries[entries.length - 1]; for (const o of e2.ops) if (o.chance === host.chance) delete o.chance; e2.chance = host.chance; e2.chanceGrow = cap !== undefined ? { add: +gg[1], cap } : { add: +gg[1] }; continue; }
        // crit_up 宿主（"初始致命几率30%，每回合致命几率增加10%"）→ 条目级 growStep：n/d 域逐结算注入，onBattleStart 宿主转 onTurnEnd 刷新窗使每回合递增落地
        const cu = [...(e?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "crit_up" && o.params?.n !== undefined);
        if (cu !== undefined) { if (e.hook === "onBattleStart") e.hook = "onTurnEnd"; e.growStep = +gg[1]; if (cap !== undefined) e.growCap = cap; continue; }
        const sh = [...(e?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params !== undefined);
        if (sh !== undefined) { sh.params.growStep = +gg[1]; if (cap !== undefined) sh.params.growCap = cap; continue; }
        if (e !== undefined && (e.ops?.length ?? 0) > 0) { e.growStep = +gg[1]; delete e.growPoint; pointGrow.delete(e); if (cap !== undefined) e.growCap = cap; continue; }
        unparsed.push({ clause: gtext, reason: "grow-tail-orphan" }); continue;
      }
      // "几率提升至N%"（裸目标值尾——cap 并入最近 chanceGrow；无宿主报孤儿）
      const gcap2 = gtext.match(/^(?:时|则)?(?:概率|几率)(?:提升|提高|增加)至(\d+)%$/);
      if (gcap2 !== null) {
        const ge = entries[entries.length - 1];
        if (ge !== undefined && ge.chanceGrow !== undefined) { ge.chanceGrow = { ...ge.chanceGrow, cap: +gcap2[1] }; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // "最多恢复至自身最大体力的N/M"独立组 → 最近 heal op capFrac（空格/逗号切离宿主的兜底）
      const gcf = gtext.match(/^最多恢[复回]至(?:自身|自己)?(?:的)?最大(?:体力|HP)(?:值)?的?(\d+)\s*\/\s*(\d+)$/);
      if (gcf !== null) {
        const hhost = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "heal" && o.capFracN === undefined);
        if (hhost !== undefined) { hhost.capFracN = +gcf[1]; hhost.capFracD = +gcf[2]; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // "叠加N点"/"每次增加N点"/"每回合增加N点"裸值成长尾 → 最近条目 growStep（裸值域——growOp 注入 power/flat）
      const stk = gtext.match(/^(?:每次|每回合|每使用)?(?:可)?(?:叠加|增加|提升)(\d+)点(?:[，,]?最高(\d+)点)?$/);
      if (stk !== null) {
        const e = entries[entries.length - 1];
        if (e !== undefined && (e.ops?.length ?? 0) > 0) { e.growStep = +stk[1]; e.growPoint = true; pointGrow.add(e); if (stk[2] !== undefined) e.growCap = +stk[2]; segParsed = true; continue; }
        unparsed.push({ clause: gtext, reason: "grow-tail-orphan" }); continue;
      }
      // "之后重置此效果/重置此计数" → 最近 growStep 宿主 resetOnCap（叠满→触发→清零循环）
      if (/^(?:之后|然后|随后)?重置此(?:效果|计数|数值|成长)$/.test(gtext)) {
        const host = pendingAtCap ?? lastGrowMount ?? [...entries].reverse().find((e) => e.growStep !== undefined || e.growCap !== undefined);
        if (host !== undefined) { host.resetOnCap = true; continue; }
        unparsed.push({ clause: gtext, reason: "reset-tail-orphan" }); continue;
      }
      // "数值叠加至最高后下1次触发时造成的X值提升N%" → 最近 grow 宿主 atCapMul + atCapNext（下1次=延一档判定）
      const atm = gtext.match(/^(?:数值|效果|减伤数值)?叠加至最高(?:后|时)?(?:下|后)?1?次?(?:触发时|生效时)?(?:，|,)?(?:造成的|造成的)?(.{0,12})(?:值)?(?:提升|提高|增加)(\d+)%$/);
      if (atm !== null && /触发时/.test(gtext)) {
        const host = lastGrowMount ?? [...entries].reverse().find((e) => e.growStep !== undefined || e.growCap !== undefined);
        if (host !== undefined) { host.atCapMul = 1 + (+atm[2]) / 100; host.atCapNext = true; continue; }
        unparsed.push({ clause: gtext, reason: "cap-tail-orphan" }); continue;
      }
      // "该X效果增加N%"（"该伤害提升效果增加10%"）→ 最近 apply_status op 的 growStep
      const th = gtext.match(/^(?:该|此|上述).{0,8}效果(?:增加|提高|提升)(\d+)%$/);
      if (th !== null) {
        const host = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params !== undefined);
        if (host !== undefined) { host.params.growStep = +th[1]; continue; }
        const e3 = entries[entries.length - 1];
        if (e3 !== undefined && (e3.ops?.length ?? 0) > 0) { e3.growStep = +th[1]; continue; }
        unparsed.push({ clause: gtext, reason: "grow-tail-orphan" }); continue;
      }
      // "未触发则下次触发/本次在场概率提升N%[，最高M%]" → else 守卫 + 前条目 chanceGrow（未触发成长近似每次成长）
      const ncg = gtext.match(new RegExp(`^未触发则(?:下次(?:触发)?|本次在场此?|在场此?|此)?(?:${AIL_ALT}|触发)?的?(?:概率|几率)?(?:额外)?(?:提升|增加|提高)(至|到)?(\\d+)%(?:[，,]?最高(?:提升|增加|到|至)?(\\d+)%)?$`));
      if (ncg !== null) {
        const e = entries[entries.length - 1];
        const PCT_WIN2 = new Set(["dodge", "immune_chance", "dmg_taken_down", "dmg_reduce", "drain_atk"]);
        const pctHost = e?.ops.find((o) => o.op === "apply_status" && PCT_WIN2.has(o.name) && o.params?.pct !== undefined);
        if (e !== undefined && (e.chance !== undefined || e.ops.some((o) => o.chance !== undefined) || pctHost !== undefined)) {
          if (e.chance === undefined) {
            if (pctHost !== undefined) { e.chance = pctHost.params.pct; pctHost.params = { ...pctHost.params, pct: 100 }; } // pct 窗提升为条目概率（pct 本就是该窗触发率——提升后窗恒生效由概率门控）
            else { const c0 = e.ops.find((o) => o.chance !== undefined).chance; for (const o of e.ops) if (o.chance === c0) delete o.chance; e.chance = c0; }
          }
          // "提升至N%"=下次判定抬到 N（近似：一次性补齐差额）；裸"提升N%"=累进成长
          const add = ncg[1] !== undefined ? Math.max(0, +ncg[2] - (e.chance ?? 0)) : +ncg[2];
          e.chanceGrow = { ...(ncg[3] !== undefined ? { add, cap: +ncg[3] } : { add }), on: "fail" }; segParsed = true; continue;
        }
        unparsed.push({ clause: gtext, reason: "grow-tail-orphan" }); continue;
      }
      // "触发后概率重置"（"上述冰封效果触发后概率重置"——命中后 chanceAcc 清零，chanceResetOnFire 引擎字段）
      const rst = gtext.match(/^(?:上述\S{0,8}?(?:效果|状态)?[,，、]?)?(?:触发|命中|生效|施加)成功后?(?:此|该|自身)?(?:的)?(?:触发)?(?:概率|几率)(?:重新?计算|重置|归零|还原|清空)$|^(?:上述|该|此)\S{0,8}?(?:效果|状态)?触发后(?:此|该|自身)?(?:的)?(?:概率|几率)(?:重新?计算|重置|归零|还原|清空)$/);
      if (rst !== null) {
        const e = entries[entries.length - 1];
        if (e !== undefined && (e.chanceGrow !== undefined || e.chance !== undefined)) { e.chanceResetOnFire = true; segParsed = true; continue; }
        unparsed.push({ clause: gtext, reason: "chance-reset — no chance host (deferred)" }); continue;
      }
      // "成功则X"/"免疫成功则X"/"触发成功则X"/"若触发AIL则X" → 正向 prevApplied 守卫（else 反义族，同一挂载通道；AIL 限定按泛化 prevApplied 近似 UNVERIFIED）
      const okm = gtext.match(/^(?:若)?(?:免疫|触发|施加|反转)?成功则(.+)$/) ?? gtext.match(/^(?:触发|施加|反转)成功(?!则|，|,)(.+)$/) ?? gtext.match(/^(?:若)?(?:双方)?(?:均|皆)未触发则(.+)$/) ?? gtext.match(new RegExp(`^(?:若)?(?:触发|施加|反转)(?:${AIL_ALT})则(.+)$`));
      if (okm !== null) {
        const pos = !/未触发/.test(okm[0]);
        const g2 = pos ? { prevApplied: true } : { not: { prevApplied: true } };
        const rest = okm[1].trim();
        const sub = parseEffectText(normalizeSoulBody(rest), { keepDrainKeys: true, fracFlatChance: true });
        liftDrainRiders(sub.effects, sub.flags, { lone: "drain" });
        const host = prevAppliedHost();
        // An immunity window describes protection offered by a status, not
        // successful prevention of an incoming move. Likewise, an orphan
        // `triggered successfully` clause has no event result to observe.
        if (/免疫成功/.test(okm[0]) || host === undefined) {
          quarantineGroup(gtext, "prevApplied prerequisite — no same-event successful host (deferred)");
          continue;
        }
        if (sub.effects.length > 0) {
          if (!pos && /(?:均|皆)未触发/.test(okm[0]) && entries.length - clauseEntryStart > 1) {
            quarantineGroup(gtext, "prevApplied aggregate prerequisite — multiple entry outcomes are not shared by the hook runner (deferred)");
            continue;
          }
          if (!pos && host.chance !== undefined) {
            host.elseOps = [...(host.elseOps ?? []), ...sub.effects];
          } else {
            for (const o of sub.effects) host.ops.push({ ...o, if: o.if !== undefined ? { and: [g2, o.if] } : g2 });
          }
          for (const u of sub.unparsed) unparsed.push(u);
          if (sub.unparsed.length > 0) enterQuarantine("prevApplied branch payload partially unmodeled — linked tail withheld (deferred)");
          segParsed = true; continue;
        }
        quarantineGroup(gtext, "prevApplied prerequisite — linked payload has no supported effect (deferred)");
        continue;
      }
      // "未触发则X"/"未命中则X"组级 else 链：余文无触发词时并入前条目 ops（else 语义=前 op 未适用则本条）；
      // 余文自带触发词则照常触发流 + {not:prevApplied} 暂存（"未触发则回合结束时X"）
      const elsem = gtext.match(new RegExp(`^(?:若)?(?:未触发|未命中|未击败|没有触发|均未触发|皆未触发|反转失败|触发失败)(?:${AIL_ALT}|闪避)?(?:则|，|,)(.+)$`));
      if (elsem !== null) {
        const rest = elsem[1].trim();
        // Replaying an entry effect is linked to the earlier entry branch and
        // cannot be reduced to the generic not-prevApplied condition below.
        // Quarantine before this early else path can append a free-standing
        // cleanse/status effect to the previous supported host.
        if (/^重新触发(?:自身的?)?登场效果/.test(rest)) {
          quarantineGroup(gtext, "entry-effect replay — linked fallback payload unmodeled (deferred)");
          continue;
        }
        const host = prevAppliedHost();
        if (host === undefined) {
          quarantineGroup(gtext, "prevApplied prerequisite — no same-event fallback host (deferred)");
          continue;
        }
        // 事件词起首的余文走正常触发流（"未触发则回合结束时X"→新条目+守卫）；
        // 非事件词（"未触发则100%令对手失明"）→ ops 并入前条目（else 语义=前 op 未适用）
        const eventLead = /^(?:回合|受到|登场|出场|击败|击倒|换下|闪避|出手|先出手|后出手|每次|每回合|当回合|下回合|使用|自身登场|首次|受到攻击|受到技能|对手使用|对手攻击|对手回合|对手登场|对手出场|对手换下|对手受到)/.test(rest);
        if (eventLead) {
          quarantineGroup(gtext, "prevApplied prerequisite — fallback crosses trigger boundary (deferred)");
          continue;
        }
        if (rest !== "") {
          const sub = parseEffectText(normalizeSoulBody(rest), { keepDrainKeys: true, fracFlatChance: true });
          liftDrainRiders(sub.effects, sub.flags, { lone: "drain" });
          if (sub.effects.length > 0) {
            if (host.chance !== undefined) {
              host.elseOps = [...(host.elseOps ?? []), ...sub.effects];
            } else {
              for (const o of sub.effects) host.ops.push({ ...o, if: o.if !== undefined ? { and: [{ not: { prevApplied: true } }, o.if] } : { not: { prevApplied: true } } });
            }
            for (const u of sub.unparsed) unparsed.push(u);
            if (sub.unparsed.length > 0) enterQuarantine("prevApplied fallback payload partially unmodeled — linked tail withheld (deferred)");
            segParsed = true; continue;
          }
        }
        quarantineGroup(gtext, "prevApplied prerequisite — linked fallback payload has no supported effect (deferred)");
        continue;
      }
      // "不相同时X"/"不同时X" 互补 else 支路（"使用技能类型与上次相同时先制+1，不相同时恢复最大体力1/3"）——克隆前条目钩子+守卫取反，body ops 收进克隆条
      const notM = gtext.match(/^(?:不|非|反之|否则)?(?:相同|一样|同)(?:的|时|，|,)+(.+)$/);
      if (notM !== null) {
        const prev = entries[entries.length - 1];
        const g0 = prev?.guard;
        const rest = notM[1].trim();
        if (prev !== undefined && g0 !== undefined && rest !== "") {
          const sub = parseEffectText(normalizeSoulBody(rest), { keepDrainKeys: true, fracFlatChance: true });
          liftDrainRiders(sub.effects, sub.flags, { lone: "drain" });
          if (sub.effects.length > 0) {
            const ng = g0.not !== undefined ? g0.not : { not: g0 };
            entries.push({ hook: prev.hook, ...(prev.actor !== undefined ? { actor: prev.actor } : {}), guard: ng, ...(prev.bossGate === true ? { bossGate: true } : {}), ops: sub.effects });
            for (const u of sub.unparsed) unparsed.push(u);
            segParsed = true; continue;
          }
        }
      }
      // 裸条件组暂存："自身体力低于对手时"/"对手体力大于300时"等 condOf 可判、自身非触发/被动/面板族（须带"时/若"语境标记——"对手烧伤"裸句是效果非谓词）
      const hasCondMark = /^(?:当|若)/.test(gtext) || /时$/.test(gtext.trim());
      const bareCond = gtext.replace(/^(?:当|若)/, "").replace(/[，,、\s]*时$/, "").trim();
      const condCand = bareCond !== "" && bareCond.length <= 24 ? smCondOf(bareCond.replace(/^处于/, "自身处于")) : undefined;
      const condProbe = parseEffectText(normalizeSoulBody(gtext), { keepDrainKeys: true, fracFlatChance: true });
      liftDrainRiders(condProbe.effects, condProbe.flags, { lone: "keep" });
      if (condCand !== undefined && (hasCondMark || condProbe.effects.length === 0)
        && !TRIGGERS.some((t) => (t.re !== undefined && t.re.test(gtext)) || (t.mk !== undefined && t.mk(gtext) !== undefined))
        && !PASSIVES.some((p) => p.re.test(gtext)) && statClauseOps(gtext) === undefined
        && !UNSUPPORTED_TRIGGERS.some((u) => u.re.test(gtext))) {
        pendingCond = pendingCond === undefined ? condCand : { and: [pendingCond, condCand] };
        pendingCondSrc = pendingCondSrc ?? gtext;
        continue;
      }
      // 致命族 flag op 早退（"50%概率重生"/"死亡时30%复活"/"残留1点HP"——soulOp 顶层条目，机制 onFatalDamage 内联结算；先于 deferred 门使已实现形态落地）
      {
        const rvm = gtext.match(/^(?:有?(\d+)%(?:的)?(?:概率|几率|可能性)?)?(?:使自身|自身|自己)?(?:浴火)?(?:重生|复活)(?:一次|1次|一回)?$/)
          ?? gtext.match(/^(?:若)?(?:自身|自己)?(?:被击败|死亡)(?:时|后)(?:，|,)?(?:有?(\d+)%(?:的)?(?:概率|几率)?)?(?:浴火)?(?:重生|复活)(?:一次|1次|一回)?$/);
        if (rvm !== null) {
          const ch = rvm[1] ?? rvm[2];
          entries.push({ op: "revive", ...(ch !== undefined && +ch < 100 ? { chance: +ch } : {}), ...(bossGate ? { bossGate: true } : {}) });
          segParsed = true; continue;
        }
        const edm = gtext.match(/^(?:使自身|自身|自己)?(?:将|可|可以|能够|会)?(?:残留|保留|余下|留下|剩下)(?:至|到)?1\s*(?:点)?(?:滴)?(?:血|体力|HP|点体力|点血|滴血)(?:不死)?$/);
        if (edm !== null) { entries.push({ op: "endure", ...(bossGate ? { bossGate: true } : {}) }); segParsed = true; continue; }
        // 「回合结束后体力/PP/能力等级返回上回合结束时状态」是 endure 的后半句（每场一次的快照恢复），不是新 flag。
        if (/^(?:(?:回合结束后?|每回合(?:结束后?)?)[，,、]?)?(?:自身|自己)?(?:的)?(?:(?:体力|HP|pp值|PP|能力等级|状态)[、，,和与]?){1,4}返回(?:至|到)?上回合结束时?(?:的)?状态$/.test(gtext)) {
          if (entries.some((e) => e.op === "endure")) segParsed = true;
          else rewindAwait = gtext;
          continue;
        }
      }

      const unsup2 = UNSUPPORTED_TRIGGERS.find((u) => u.re.test(gtext) && !u.reason.endsWith("FALLTHROUGH")); // 同上：FALLTHROUGH 行不拦"组内已经能解"的余文
      if (unsup2 !== undefined) {
        const deferredText = pendingCondSrc !== undefined && pendingCond !== undefined ? pendingCondSrc : gtext;
        // 条件类族（typechart 相性 / 性别）以**裸条件**形态出现时（"自身克制对手时"），
        // 条件本身没建模 → 它后面的效果（"战斗阶段结束时…反转对手能力提升状态"）
        // 不能无条件执行。挂起标记：下一组即使自带触发词也要被扣下，
        // 否则等于把带条件的效果改成无条件跑（pet-4814 娜诺就是这种）。
        const condFamily = unsup2.reason.startsWith("attr-domain") || unsup2.reason.startsWith("gender-cond");
        if (condFamily && /(?:时|则)[，,、]?$/.test(gtext.trim())) {
          condHold = true;
          condHoldHasPayload = false;
          guardQuarantine = true;
          guardQuarantineReason = unsup2.reason;
          lastHook = undefined;
        }
        if (unsup2.quarantine === true) quarantineGroup(gtext, unsup2.reason);
        else {
          unparsed.push({ clause: deferredText, reason: unsup2.reason });
          if (linkedOutcomeScope) enterQuarantine("prevApplied branch payload unmodeled — linked tail withheld (deferred)");
        }
        pendingCond = undefined; pendingCondSrc = undefined; continue;
      } // 条件已结转进 deferred 报告——不再双报 cond-orphan

      // 组内"条件时余文"剥离（"对手体力大于300时，所有攻击暴击几率提升25%"；无逗号时仅当余文以则/动词起且谓词非 order——"对手先出手时"交触发表）
      for (;;) {
        // 段首整句命中触发词则交触发表（"打出致命一击时X"——condOf 的 prevCrit 只是守卫，触发钩子才是主语义）
        if (TRIGGERS.some((t) => (t.re !== undefined && t.re.test(gtext)) || (t.mk !== undefined && t.mk(gtext) !== undefined))) break;
        const im = gtext.match(/^(.{2,24}?)时([，,].+|则.+|.{2,})$/);
        if (im === null) break;
        const c = smCondOf(im[1].replace(/^(?:当|若)/, "").replace(/^处于/, "自身处于"));
        if (c === undefined) break;
        const subs = c.and ?? c.or ?? [c];
        if (subs.some((x) => x !== undefined && typeof x === "object" && x.order !== undefined)) break;
        pendingCond = pendingCond === undefined ? c : { and: [pendingCond, c] };
        pendingCondSrc = pendingCondSrc ?? im[1];
        gtext = im[2].replace(/^[，,、\s]+|^[，,]?则/, "");
      }
      if (gtext === "") continue;
      // "时-条件"剥离后余文仍含逗号尾段且尾段自带新条件/触发 → 尾段回队成新组（"遇到天敌时X，自身是对方天敌时每回合Y"——两条件子句独立结算，pendingCond 由前段先消费）
      if (pendingCond !== undefined && /[，,]/.test(gtext)) {
        const parts = gtext.split(/[，,]/).map((x) => x.trim()).filter((x) => x !== "");
        let cut = -1;
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i];
          const pm = p.match(/^(.{2,24}?)时/);
          const isCond = pm !== null && smCondOf(pm[1].replace(/^(?:当|若)/, "").replace(/^处于/, "自身处于")) !== undefined;
          const isTrig = TRIGGERS.some((t) => (t.re !== undefined && t.re.test(p)) || (t.mk !== undefined && t.mk(p) !== undefined));
          const isUnsup = UNSUPPORTED_TRIGGERS.some((u) => u.re.test(p)); // deferred 段同样独立成组（防拖累前段已解析部分）
          if (isCond || isTrig || isUnsup) { cut = i; break; }
        }
        if (cut > 0) { groups.push(parts.slice(cut)); gtext = parts.slice(0, cut).join("，"); }
      }

      // 面板加成族 → onBattleStart + stat_boost（整句全为属性加项才接管）
      const statOps = statClauseOps(gtext);
      if (statOps !== undefined) {
        if (pendingCond !== undefined) { unparsed.push({ clause: gtext, reason: "conditional-stat" }); pendingCond = undefined; pendingCondSrc = undefined; continue; }
        pendingEmpty = undefined;
        entries.push({ hook: "onBattleStart", ...(limitBattle ? { limitBattle: true } : {}), ...(bossGate ? { bossGate: true } : {}), ops: statOps });
        segParsed = true;
        continue;
      }

      // 常驻被动族 → onBattleStart + apply_status 永久；带条件 → 可门控参数并入，否则回合末刷新窗
      // 全匹配门：re 无 $ 锚的裸句会前缀命中吞掉尾句（"伤害提升50%，效果翻倍"——尾句须回流到 probe/inner 路径）
      const capm = gtext.match(/^(.+?)[，,]最多(\d+)点(?:伤害)?$/); // "附带…，最多N点"：上限尾剥出挂 params.cap
      const passGtext = capm !== null ? capm[1] : gtext;
      const pass = (lastHook === undefined || /^初始/.test(passGtext)) ? PASSIVES.find((p) => { const mm = passGtext.match(p.re); return mm !== null && mm[0] === passGtext; }) : undefined; // lastHook 语境下裸句应继承前钩子而非落 onBattleStart（"初始X"自带战首作用域——豁免继承）
      if (pass !== undefined) {
        const m = passGtext.match(pass.re);
        const spec = pass.mk(m);
        const op = { op: "apply_status", name: spec.name, target: spec.target ?? "self", ...(spec.params !== undefined ? { params: { ...spec.params } } : {}), ...(spec.pctPerAilTurn !== undefined ? { pctPerAilTurn: spec.pctPerAilTurn } : {}) };
        if (capm !== null) {
          if (spec.name === "dmg_flat") op.params = { ...(op.params ?? {}), cap: +capm[2] };
          else unparsed.push({ clause: `最多${capm[2]}点`, reason: "cap tail without cap-able passive host" });
        }
        // pendingHpStep（"HP每降低10%，受到的伤害减少5%"——PASSIVES 路径 pct 窗同样转 perHpLostStep/perHpLostPct）
        if (pendingHpStep !== undefined && op.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken/.test(spec.name)) {
          const { pct, ...rest } = op.params; op.params = { ...rest, perHpLostStep: pendingHpStep, perHpLostPct: pct }; pendingHpStep = undefined;
        }
        if (pendingCond !== undefined) {
          const gate = passCondGate(pendingCond, spec.name);
          if (gate !== undefined) { op.params = { ...(op.params ?? {}), ...gate }; entries.push({ hook: "onBattleStart", ...(limitBattle ? { limitBattle: true } : {}), ...(bossGate ? { bossGate: true } : {}), ops: [op] }); }
          else { op.turns = 1; entries.push({ hook: "onTurnEnd", guard: pendingCond, ...(bossGate ? { bossGate: true } : {}), ops: [op] }); } // 条件被动→回合末条件刷新窗（turns:1 持续至下轮判定，±1 回合近似）
          pendingCond = undefined; pendingCondSrc = undefined;
          pendingEmpty = undefined;
          segParsed = true;
          continue;
        }
        if (entryScopeTurns !== undefined && op.params?.count === undefined) op.turns = Math.max(op.turns ?? 0, entryScopeTurns);
        pendingEmpty = undefined;
        entries.push({ hook: entryScopeTurns !== undefined ? "onEntry" : "onBattleStart", ...(limitBattle ? { limitBattle: true } : {}), ...(bossGate ? { bossGate: true } : {}), ops: [op] });
        segParsed = true;
        continue;
      }

      // "当P时R"/"P时R"前置守卫：段首非触发词但余文以触发词开头 → P 转 "若P则" 并入体（condOf 判不了 P 时自然回流 unparsed）
      let hoistCond = "";
      const hm = gtext.match(/^(当|若|处于)(.{2,20}?)时(.+)$/);
      if (hm !== null && !TRIGGERS.some((t) => t.re !== undefined && t.re.test(gtext)) && TRIGGERS.some((t) => t.re !== undefined && t.re.test(hm[3]))) {
        hoistCond = hm[1] === "处于" ? `若自身处于${hm[2]}则` : `若${hm[2].replace(/^若/, "").replace(/^处于/, "自身处于")}则`;
        gtext = hm[3];
      }

      // 触发前缀
      let hook, extra = {}, body = gtext, inherited = false;
      let plainUseCandidate = false, plainUseMatchedHead = "", plainUseNestedChanged = false;
      // "若P，则X"逗号切组后"则"落组首——剥除走触发环（pendingCond 已由 cond 组暂存）
      if (pendingCond !== undefined && /^则/.test(gtext)) { gtext = gtext.replace(/^则/, ""); body = gtext; }
      // "N%…" 组：已有上下文钩子时优先继承（"自身死亡时，50%令X"→onKO 而非 onDamageDealt 重推导）
      const pctLead = gtext.match(/^有?(\d+)%(?:的?(?:几|概)?率)?[，,]?/);
      if (pctLead !== null && lastHook !== undefined) {
        hook = lastHook.hook; extra = { ...lastHook.extra, chance: +pctLead[1] }; inherited = true;
        body = hoistCond + gtext.slice(pctLead[0].length).replace(/^[，,、\s]+/, "");
      }
      if (hook === undefined) for (const t of TRIGGERS) {
        if (t.mk !== undefined) {
          const r = t.mk(gtext);
          if (r === undefined) continue;
          // weak 首扫：外境钩已立时只取 extra（"登场时，背包每有一只精灵存活则X"——计数缩放不抢 onEntry 时序）
          if ((r.weak ?? t.weak) === true && lastHook !== undefined) { hook = lastHook.hook; extra = { ...lastHook.extra, ...(r.extra ?? {}) }; body = hoistCond + (r.body ?? "").replace(/^[，,、\s]+/, ""); inherited = true; break; }
          hook = r.hook; extra = r.extra ?? {}; body = hoistCond + (r.body ?? "").replace(/^[，,、\s]+/, "");
          if (r.useTime === true) { plainUseCandidate = true; plainUseMatchedHead = gtext.slice(0, gtext.length - body.length); }
          break;
        }
        const m = gtext.match(t.re);
        if (m) { hook = t.hook; extra = t.extra ?? {}; body = hoistCond + gtext.slice(m[0].length).replace(/^[，,、\s]+/, ""); if (t.useTime === true) { plainUseCandidate = true; plainUseMatchedHead = m[0]; } break; }
      }
      // 类别连用里明确不做的体（威力成长、附加固伤翻倍）——退回 deferred，不落条目
      if (hook === "__streakDefer__") {
        unparsed.push({ clause: gtext, reason: "consecutive-use — move-power scaling stays deferred" });
        pendingCond = undefined; pendingCondSrc = undefined; continue;
      }
      // 「先制+N」在排序时生效（onMoveUsed 的 prio_up 赶不上本回合先后手）
      if (typeof extra.prioV === "number") {
        entries.push({ hook: "beforeOrder", ...(bossGate ? { bossGate: true } : {}), prio: { min: extra.prioV, max: extra.prioV }, streak: extra.streak, ...(extra.sameMove === true ? { sameMove: true } : {}), ...(extra.cat !== undefined ? { cat: extra.cat } : {}) });
        const { prioV: _pv, ...rest } = extra;
        extra = rest;
        if (hook === "__streakPrio__") {
          if (!inherited) lastHook = { hook: "onMoveUsed", extra: { actor: extra.actor, cat: extra.cat, streak: extra.streak, ...(extra.sameMove === true ? { sameMove: true } : {}) } };
          pendingEmpty = undefined; segParsed = true; continue;
        }
      }
      // __turn__ 哨兵：standalone"若P则"在有 turn 钩子时继承（"回合开始时若P则"→onTurnStart 精确覆盖当回合窗，默认 onTurnEnd 次轮刷新近似）
      if (hook === "__turn__") hook = lastHook !== undefined && (lastHook.hook === "onTurnStart" || lastHook.hook === "onEntry" || lastHook.hook === "onTurnEnd") ? lastHook.hook : "onTurnEnd";
      // body 残余触发头再分派（"回合开始时若P则自身攻击命中时X"——外层消费守卫/窗口后内层触发定精确钩子；guard 跨层 and 合并，最多 2 层防循环）
      for (let depth = 0; depth < 4 && hook !== undefined && hook !== "__beforeOrderOnce__"; depth++) {
        body = body.replace(/^[，,、\s]+|^[且并]/, "").replace(/^[，,、\s]+/, ""); // "造成的伤害低于N且回合结束时"——连接词后再触发分派
        // 破盾边沿："回合结束时若护盾消失则X"——触发头剥后 body 仍带边沿前缀，下放 react4（勿走"若P则"电平守卫）
        const bsbr = body.match(SHIELD_BREAK_RE);
        if (bsbr !== null) {
          const rw = reactWrap(4, {}, bsbr[1] ?? bsbr[2] ?? bsbr[3]);
          if (rw !== undefined && (rw.effects ?? []).length > 0) { entries.push({ hook: "onBattleStart", ...(bossGate ? { bossGate: true } : {}), ops: rw.effects }); }
          else unparsed.push({ clause: gtext, reason: "shield-break payload unparsed (deferred)" });
          pendingEmpty = undefined; segParsed = true; continue outerG;
        }
        // "回合开始时若P则当回合自身攻击技能X"：「当回合」后紧跟出招触发词时剥掉，让内层触发定钩子（否则 X 在回合开始就结算）
        if (depth === 0) body = body.replace(/^当回合(?=(?:自身|自己)?(?:攻击|属性)技能(?:有?\d+%|令|使|消除|附加|造成|恢复|吸取))/, "");
        // react 载荷头（受击/对手行动类）与裸几率前缀不是钩子重挂——留给 inner reactWrap/dynChance 通道（"登场3回合内受到攻击则X"/"回合开始时50%令X"——op 级 chance 是 chanceMulIf 挂载宿主）
        // 「对手攻击时」是**受击事件点**（不是 react 载荷头），要放行让二次匹配把它挂到 onDamaged
        // （pet-4587「奇数回合对手攻击时70%闪避对手的攻击」）；「对手攻击技能命中自身时」仍由上一条触发词先收。
        if (/^(?:若|当)?(?:[受到收]到|被(?=(?:对手|对方|敌方)?攻击)|遭受|对手(?:每次)?(?:攻击(?!时)|使用(?:攻击|属性)?技能|攻击技能|属性技能))/.test(body) || /^有?\d+%/.test(body)) break;
        let nbody = null, nextra, nhook, weak = false;
        for (const t of TRIGGERS) {
          if (t.headOnly === true) continue; // 组首专用 mk（裸"P则X"等）——body 内的 P则 属 op.if 通道，不在此重挂守卫
          if (t.mk !== undefined) { const r = t.mk(body); if (r === undefined) continue; nhook = r.hook; nextra = r.extra ?? {}; nbody = r.body ?? ""; weak = (r.weak ?? t.weak) === true; break; }
          const tm = body.match(t.re);
          if (tm) { nhook = t.hook; nextra = t.extra ?? {}; nbody = body.slice(tm[0].length); weak = t.weak === true; break; }
        }
        if (nbody === null || (nbody === body && (nhook === hook || nhook === "__turn__" || weak === true))) break; // 无进展 break——body 未变且 hook 无变化/弱触发时；hook 变化本身算进展（"使对手在回合结束时X"只重挂钩子不剥文）
        if (nextra.guard !== undefined && extra.guard !== undefined) nextra = { ...nextra, guard: { and: [extra.guard, nextra.guard] } };
        extra = { ...extra, ...nextra };
        if (nhook !== "__turn__" && weak !== true) {
          if (plainUseCandidate && nhook !== hook) plainUseNestedChanged = true;
          hook = nhook; // __turn__/weak（"当回合"窗口标记）不覆盖既有精确钩子
        }
        body = nbody.replace(/^[，,、\s]+/, "");
      }
      if (hook === "__turn__") hook = lastHook !== undefined && (lastHook.hook === "onTurnStart" || lastHook.hook === "onEntry" || lastHook.hook === "onTurnEnd") ? lastHook.hook : "onTurnEnd";
      // A turn-start/entry snapshot cannot directly gate an effect that only occurs on a later move.
      // Keep that compound scope (and its else tail) residual instead of checking the condition at move time.
      if (["onTurnStart", "onTurnEnd", "onEntry"].includes(hook) && /^(?:若|当).{2,40}?(?:则|时)(?=(?:自身|自己)?使用(?:攻击|属性|物理|特殊)?技能)/.test(body)) {
        const reason = "nested trigger timing — turn-scope condition cannot guard later move event (deferred)";
        quarantineGroup(gtext, reason);
        continue outerG;
      }
      // guardDropped 不能只作为旁注：当前条件连同 body 一起保留为 residual，避免效果体被降成无条件执行。
      // 同时清掉 hook 与跨组挂载上下文；后续 chance/else/裸尾会在上方 quarantine 分支隔离。
      if (extra.guardDropped !== undefined) {
        quarantineGroup(gtext, guardUnmodeledReason);
        continue;
      }
      // __beforeOrderOnce__：一次性排序加权（"下次使用技能先制±K"→beforeOrder+limitBattle+prio 区间）
      if (hook === "__beforeOrderOnce__") {
        entries.push({ hook: "beforeOrder", limitBattle: true, ...(bossGate ? { bossGate: true } : {}), prio: { min: extra.prioV, max: extra.prioV } });
        pendingEmpty = undefined; segParsed = true;
        continue;
      }
      // 同一技能门控只在出招钩子上结算（onMoveUsed / beforeOrder 读 prevMoveId 与本动）。体里再挂到回合末等钩子会丢掉门控、变成每回合触发——整组退回 deferred。
      if (extra.sameMove === true && hook !== undefined && hook !== "onMoveUsed" && hook !== "beforeOrder") {
        unparsed.push({ clause: gtext, reason: `consecutive-use — same-move gate not evaluated on ${hook} (deferred)` });
        pendingCond = undefined; pendingCondSrc = undefined; continue;
      }
      if (hook === undefined && lastHook !== undefined) { hook = lastHook.hook; extra = lastHook.extra; inherited = true; }
      // standalone 恢复（次优先级：裸"恢复X"≈每回合回复——UNVERIFIED；继承失败才接管，保 KO/登场语境；
      // pendingCond 暂存时交条件刷新窗——守卫须落 entry.guard 而非压进 op.if）
      if (hook === undefined && pendingCond === undefined && /^(?:(?:自身|自己)?恢复|回复)/.test(gtext)) { hook = "onTurnEnd"; extra = {}; }
      // body 级裸名前缀补剥（触发词吞下的 body 首可能仍是"名+动词"——"死亡后混元天尊开始免疫…"）
      if (nameAlts.length > 0 && body !== undefined) body = stripPet(body, `所有|每|自身|攻击|对|回|受|免疫|在|处|使|令|技|先|后|登|作|死|开|缔|附|进|变|切|闪|驱|失|获|吸|恢|造|消|抵|免|克|微`);
      // standalone 全 stat_stage/常驻 apply_status 子句（"自身80%全属性+1"/"自身所有技能额外先制+1"——无触发词的常驻变动；
      // 限 apply_stat_stage 与无 turns/count 限制的 apply_status——时限/次数窗的裸句缺触发语境，仍走 no-trigger-prefix）
      if (hook === undefined) {
        const probe = parseEffectText(normalizeSoulBody(gtext), { keepDrainKeys: true, fracFlatChance: true });
        // 必中裸句（"必中"——flags.accuracy 折算 must_hit 常驻窗）
        // 类别限定读原文：「自身攻击技能必定命中」说的是**攻击招式**必定命中，
        // 不是所有招式——原折算一律给 must_hit（无 cat），把属性技能也带上了。
        // cat 4 = 任意攻击招（物理+特殊），与全引擎类别编码一致。
        if (probe.effects.length === 0 && probe.flags?.accuracy === "always") {
          const hitCat = soulMustHitCat(gtext);
          probe.effects.push(hitCat === undefined
            ? { op: "apply_status", name: "must_hit", target: "self" }
            : { op: "apply_status", name: "sure_hit", target: "self", params: { cat: hitCat } });
        }
        // drain 裸句（"造成攻击伤害的30%恢复至体力"——袋子或单独一条 rider 折算 drain_atk 常驻窗）
        // 判据是「本组里没有伤害宿主」，不是「本组只剩它一条」：吸血 rider 挂的是伤害，
        // 没有伤害可挂时它就是独立吸血窗（drain_atk）。同组还有别的常驻状态时
        // （"自身特攻必定命中且造成伤害50%恢复自身体力"）两条都要留下，不能只留一条。
        {
          const noDmgHost = !probe.effects.some((o) => o.op === "damage");
          const flagDrain = noDmgHost ? probe.flags?.attachDamage?.drain : undefined;
          const lone = probe.effects.length === 1 && probe.effects[0].op === "applyDrainRider" ? probe.effects[0] : undefined;
          const dr = flagDrain ?? (lone !== undefined && Object.keys(lone).every((k) => k === "op" || k === "drain") ? lone.drain : undefined);
          if (dr !== undefined) {
            if (probe.flags?.attachDamage?.drain !== undefined) {
              delete probe.flags.attachDamage.drain;
              if (Object.keys(probe.flags.attachDamage).length === 0) delete probe.flags.attachDamage;
            }
            const drainOp = { op: "apply_status", name: "drain_atk", target: "self", params: { n: dr.numerator, d: dr.denominator } };
            probe.effects = probe.effects.length === 0
              ? [drainOp]
              : [...probe.effects.filter((o) => o.op !== "applyDrainRider"), drainOp];
          }
        }
        // powerMul 裸句折算（"对手异常时自身攻击威力翻倍"——attachDamage.powerMul → power_mul 常驻倍率窗）
        if (probe.effects.length === 0 && probe.flags?.attachDamage?.powerMul !== undefined) {
          const pm = probe.flags.attachDamage.powerMul;
          probe.effects.push({ op: "apply_status", name: "power_mul", target: "self", params: { n: pm.numerator, d: pm.denominator } });
          if (probe.effDoubleFlag !== "powerMul") dropBagKey(probe.flags, "powerMul");
        }
        // flatBonus 裸句折算（"先出手时所有攻击附加N点固定伤害"——attachDamage.flatBonus → dmg_flat 常驻窗）
        if (probe.effects.length === 0 && probe.flags?.attachDamage?.flatBonus !== undefined) {
          const flat = probe.flags.attachDamage.flatBonus;
          probe.effects.push({ op: "apply_status", name: "dmg_flat", target: "self", params: { flat } });
          dropBagKey(probe.flags, "flatBonus");
        }
        // mul 裸句折算（"造成伤害提升N%"——attachDamage.mul 分数倍率 → dmg_boost pct 常驻窗）
        if (probe.effects.length === 0 && probe.flags?.attachDamage?.mul !== undefined) {
          const ml = probe.flags.attachDamage.mul;
          const pct = Math.round((ml.numerator * 100) / ml.denominator) - 100;
          if (pct !== 0) probe.effects.push({ op: "apply_status", name: "dmg_boost", target: "self", params: { pct } });
          dropBagKey(probe.flags, "mul");
        }
        // 动态 flat 裸句折算（"附加所造成伤害值N%的固伤"——attachDamage.flat*Pct/Mul → dmg_flat 动态窗；
        // attachDamage 键名与 dmg_flat.params 键名不同源，须按表映射——flatSelfPct=selfMaxPct、flatFoeCurPct=foeCurPct 等）
        if (probe.effects.length === 0 && probe.flags?.attachDamage !== undefined) {
          const ad = probe.flags.attachDamage;
          const AD_TO_FLAT_PARAMS = { flatSelfLastDmgPct: "flatSelfLastDmgPct", flatPrevTurnTakenPct: "flatPrevTurnTakenPct", flatPrevTakenPct: "flatPrevTakenPct", flatFoeCurPct: "foeCurPct", flatPowerMul: "flatPowerMul", flatDefStageMul: "flatDefStageMul", flatStageUpCountMul: "flatStageUpCountMul", flatBothStageUpCountMul: "flatBothStageUpCountMul", flatFoeStageUpCountMul: "flatFoeStageUpCountMul", flatSelfPct: "selfMaxPct", flatSelfDefSumPct: "defSumPct", flatFoeDefSumPct: "foeDefSumPct", flatSelfAtkPct: "atkPct" };
          const dk = Object.keys(AD_TO_FLAT_PARAMS).find((k) => ad[k] !== undefined);
          if (dk !== undefined) {
            probe.effects.push({ op: "apply_status", name: "dmg_flat", target: "self", params: { [AD_TO_FLAT_PARAMS[dk]]: ad[dk] } });
            if (probe.effDoubleFlag !== dk) dropBagKey(probe.flags, dk);
          }
        }
        // count 计数窗是自消耗型被动（"免疫一次异常状态"/"下N次伤害提升M%"——次数即语境）；时限窗仍排除（缺起始触发）
        const COUNT_PASSIVE = new Set(["immune_status", "immune_degrade", "shield", "ward", "dodge", "crit_immune", "endure", "dmg_cap", "dmg_reduce", "dmg_boost", "dmg_flat", "dmg_taken_down"]);
        const passiveOk = (o) => o.op === "apply_stat_stage" || o.op === "stat_boost" || (o.op === "apply_status" && (o.params?.count === undefined || (o.target === "self" && COUNT_PASSIVE.has(o.name))));
        // 裸伤害/PP/净化句（"所有技能秒杀对手"/"清空对手所有技能PP值"——无触发词的常驻动作 → 自身出招语境 UNVERIFIED）；
        // heal 例外放行：仅"吸取对手X"型 damage+heal 复合（吸取=攻击回血，出招语境）；裸"恢复X"不走此路（保持回合末回复语义）
        // 家族 rider 贴在前一个动作上，不单独算一条裸动作。至少要有一条真正的动作，单独一条 rider 不进这里。
        // 效果翻倍的占位键不是这条伤害的家族键，先拿走，抬完再放回给 applyPhantomDouble。
        const phantomKey = probe.effDoubleFlag;
        const phantomVal = phantomKey !== undefined ? probe.flags?.attachDamage?.[phantomKey] : undefined;
        if (phantomVal !== undefined) dropBagKey(probe.flags, phantomKey);
        liftDrainRiders(probe.effects, probe.flags, { lone: "drain" });
        if (phantomVal !== undefined) {
          if (probe.flags.attachDamage === undefined) probe.flags.attachDamage = {};
          probe.flags.attachDamage[phantomKey] = phantomVal;
        }
        // clear_stages 是同族裸动作（“清理对手回合类效果”的 cleanse 已在列内）——FALLTHROUGH 放行过来的
        // “消除对手能力提升状态”就落在这条裸动作路径上。只对确实命中 FALLTHROUGH 行的句子开这一格，
        // 免得把别的“消除…”碎片（句尾不是「状态」，从未被那行接住）顺手也解析了。
        const fallThroughRow = UNSUPPORTED_TRIGGERS.some((u) => u.reason.endsWith("FALLTHROUGH") && u.re.test(gtext));
        const ACTION_BARE = new Set(["damage", "pp_delta", "cleanse", "transfer_ailments", ...(fallThroughRow ? ["clear_stages"] : [])]);
        const bareOp = (o) => ACTION_BARE.has(o.op) || o.op === "heal" || isHitRider(o.op);
        if (probe.unparsed.length === 0 && probe.effects.length > 0 && probe.effects.some((o) => ACTION_BARE.has(o.op)) && probe.effects.every(bareOp)) {
          let cur;
          for (const o of probe.effects) {
            if (isHitRider(o.op) && cur !== undefined) cur.ops.push(o);
            else {
              cur = { hook: "onMoveUsed", actor: "self", ...(pendingCond !== undefined ? { guard: pendingCond } : {}), ...(bossGate ? { bossGate: true } : {}), ops: [o] };
              entries.push(cur);
            }
          }
          pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined; segParsed = true;
          continue;
        }
        // pendingHpStep 步进语境+裸被动句：pct 窗转 perHpLost*；非 pct 宿主（stat_stage 等）不可步进化 → 诚实 deferred 弃 op
        if (pendingHpStep !== undefined && probe.effects.length > 0) {
          let anyPct = false;
          for (const o of probe.effects) {
            if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken|heal_boost/.test(o.name ?? "")) {
              const { pct, ...rest } = o.params; o.params = { ...rest, perHpLostStep: pendingHpStep, perHpLostPct: pct }; anyPct = true;
            }
          }
          pendingHpStep = undefined;
          if (!anyPct) { unparsed.push({ clause: gtext, reason: "per-unit-scaling — HP-step host not pct-window (deferred)" }); pendingEmpty = undefined; continue; }
        }
        if (probe.unparsed.length === 0 && probe.effects.length > 0 && probe.effects.every(passiveOk)) {
          applyPhantomDouble(probe);
          if (pendingCond !== undefined) for (const o of probe.effects) { // 条件 stat → 门控参数（可判则永久窗）或回合末条件刷新窗
            const gate = o.op === "apply_status" ? passCondGate(pendingCond, o.name) : undefined;
            if (gate !== undefined) { o.params = { ...(o.params ?? {}), ...gate }; entries.push({ hook: "onBattleStart", ...(bossGate ? { bossGate: true } : {}), ops: [o] }); }
            else {
              // "X达到N层时…"：层数阈是这条效果自己的门，不只是条目守卫（e6-188 同形）
              if (o.if === undefined && pendingCond?.markCountAtLeast !== undefined) o.if = pendingCond;
              entries.push({ hook: "onTurnEnd", guard: pendingCond, ...(bossGate ? { bossGate: true } : {}), ops: [o] });
            }
          }
          else for (const o of probe.effects) entries.push({ hook: "onBattleStart", ...(limitBattle ? { limitBattle: true } : {}), ...(bossGate ? { bossGate: true } : {}), ops: [o] });
          // 同组时长尾（"使对手属性技能无效，2回合内"——probe.turnsTail 覆盖最近时长 op 的默认窗）
          if (probe.turnsTail !== undefined) { const host = [...probe.effects].reverse().find((o) => o.turns !== undefined) ?? probe.effects[probe.effects.length - 1]; if (host !== undefined) host.turns = probe.turnsTail; }
          // dynChance（"攻击有自身当前体力百分比的概率令对手AIL"——条级动态概率挂本组新条目）
          if (probe.flags?.dynChance !== undefined) for (let i = entries.length - probe.effects.length; i < entries.length; i++) if (i >= 0) entries[i].chanceDyn = probe.flags.dynChance;
          pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined; segParsed = true;
          continue;
        }
        // 裸时长残段独立成组（"X，2回合内"）→ 回挂最近条目时长可受 op（默认窗被真实值覆盖）
        if (probe.turnsTail !== undefined) {
          const host = [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.turns !== undefined) ?? [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status");
          if (host !== undefined) { host.turns = probe.turnsTail; continue; }
          unparsed.push({ clause: gtext, reason: "turns-tail orphan — no host effect to attach (UNVERIFIED)" });
          pendingEmpty = undefined; continue;
        }
      }
      // 条件+无触发效果（"克制对手时吸取对手最大体力1/4"——pendingCond 已暂存但无钩子）→ 回合末条件刷新窗（与条件被动同管线，UNVERIFIED 近似）
      if (hook === undefined && pendingCond !== undefined) {
        const probe2 = parseEffectText(normalizeSoulBody(gtext), { keepDrainKeys: true, fracFlatChance: true });
        const probe2Key = probe2.effDoubleFlag;
        const probe2Val = probe2Key !== undefined ? probe2.flags?.attachDamage?.[probe2Key] : undefined;
        if (probe2Val !== undefined) dropBagKey(probe2.flags, probe2Key);
        liftDrainRiders(probe2.effects, probe2.flags, { lone: "drain" });
        if (probe2Val !== undefined) {
          if (probe2.flags.attachDamage === undefined) probe2.flags.attachDamage = {};
          probe2.flags.attachDamage[probe2Key] = probe2Val;
        }
        // 无钩修饰 token（"P时伤害减免提高到N%"——chanceSet 克隆 pct 窗挂前条目宿主，与挂载循环同构）
        const aaTok = probe2.unparsed.find((u) => typeof u === "object" && /^<attachAll (.+)>$/.test(u.clause));
        if (aaTok !== undefined && aaTok.clause === "<attachAll chanceSet>" && typeof aaTok.chanceSet === "number") {
          // "P时几率提升至N%"挂前一条带 chance 的 op（麻痹/PP 归零）；pct 窗仍走下面的互斥克隆
          if (entries.length > clauseEntryStart) {
            let hitChance = false;
            for (const o of entries[entries.length - 1]?.ops ?? []) if (o.chance !== undefined) { o.chanceSetIf = { when: pendingCond, value: aaTok.chanceSet }; hitChance = true; }
            if (hitChance) { pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined; segParsed = true; continue; }
          }
          const NEG_KEY = { selfHpBelowFoe: "notSelfHpBelowFoe", selfHpAboveFoe: "notSelfHpAboveFoe", foeStatused: "notFoeStatused", selfStatused: "notSelfStatused", selfStageUp: "notSelfStageUp", selfStageDown: "notSelfStageDown" };
          const condKey = pendingCond.and === undefined && pendingCond.or === undefined ? Object.keys(pendingCond).find((k) => pendingCond[k] === true && NEG_KEY[k] !== undefined) : undefined;
          const PCT_WIN = new Set(["dodge", "dmg_boost", "dmg_taken_down", "dmg_taken_up", "dmg_reduce", "immune_chance", "drain_atk"]);
          const host = condKey !== undefined ? [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && (PCT_WIN.has(o.name) ? o.params?.pct !== undefined : o.name === "crit_up" && o.params?.n !== undefined)) : undefined;
          const gate = host !== undefined ? passCondGate(pendingCond, host.name) : undefined;
          if (host !== undefined && gate !== undefined) {
            const entry = entries[entries.length - 1];
            const clone = { op: "apply_status", name: host.name, target: host.target ?? "self", ...(host.turns !== undefined ? { turns: host.turns } : {}), params: { ...(host.params?.cat !== undefined ? { cat: host.params.cat } : {}), ...(host.name === "crit_up" ? { n: aaTok.chanceSet, d: 100 } : { pct: aaTok.chanceSet }), ...gate } };
            markPermanentBattleStartClone(entry, host, clone);
            entry.ops.push(clone);
            host.params = { ...(host.params ?? {}), [NEG_KEY[condKey]]: 1 };
            pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined; segParsed = true;
            continue;
          }
        }
        if (probe2.unparsed.length === 0 && probe2.effects.length > 0) {
          applyPhantomDouble(probe2);
          entries.push({ hook: "onTurnEnd", guard: pendingCond, ...(bossGate ? { bossGate: true } : {}), ops: probe2.effects });
          pendingCond = undefined; pendingCondSrc = undefined; pendingEmpty = undefined; segParsed = true;
          continue;
        }
      }
      if (hook === undefined) { // inner 延迟/修饰原因透传——比裸 no-trigger-prefix 更诚实（"伤害减免提高到80%"→set-override deferred）
        const probe3 = parseEffectText(normalizeSoulBody(gtext), { keepDrainKeys: true, fracFlatChance: true });
        liftDrainRiders(probe3.effects, probe3.flags, { lone: "keep" });
        // 无钩修饰 token + 组内孤儿谓词（"若P时减免效果翻倍"——probe3 的 orphanCond 转挂载条件）
        const modTok = probe3.unparsed.find((u) => typeof u === "object" && /^<attachAll (takenDownDouble|drainDouble|dmgDouble|healDouble|flatDouble|chanceDouble)>$/.test(u.clause));
        const mCond = probe3.orphanCond ?? pendingCond;
        const negateBase = negateBaseParam; // 共享 helper（标量+分数门互斥反门）
        if (modTok !== undefined && entries.length > 0) {
          const prevOps = entries[entries.length - 1].ops;
          const kind = modTok.clause.match(/^<attachAll (.+?)>$/)[1];
          let hit = false;
          for (const o of [...prevOps]) { // 快照迭代——克隆回挂 prevOps 不自吞
            if (kind === "takenDownDouble" && o.op === "apply_status" && (o.name === "dmg_taken_down" || o.name === "dmg_reduce")) {
              if (mCond !== undefined) { const g = passCondGate(mCond, o.name); if (g !== undefined) { entries[entries.length - 1].ops.push({ op: "apply_status", name: o.name, target: o.target ?? "self", ...(o.turns !== undefined ? { turns: o.turns } : {}), params: { ...(o.params ?? {}), ...(o.params?.pct !== undefined ? { pct: Math.min(100, o.params.pct * 2) } : {}), ...g } }); negateBase(o, mCond); hit = true; } }
              else if (o.params?.pct !== undefined) { o.params = { ...o.params, pct: Math.min(100, o.params.pct * 2) }; hit = true; }
            } else if ((kind === "drainDouble" || kind === "dmgDouble") && (o.op === "heal" || o.op === "damage")) {
              if (mCond !== undefined) o.mulIf = { when: mCond, numerator: 2, denominator: 1 };
              else { if (o.numerator !== undefined) o.numerator *= 2; if (o.flat !== undefined) o.flat *= 2; if (o.power !== undefined) o.power *= 2; }
              hit = true;
            } else if (kind === "healDouble" && o.op === "heal") {
              if (mCond !== undefined) o.mulIf = { when: mCond, numerator: 2, denominator: 1 };
              else { if (o.numerator !== undefined) o.numerator *= 2; else if (o.flat !== undefined) o.flat *= 2; }
              hit = true;
            } else if (kind === "flatDouble" && o.op === "damage" && o.kind === "fixed") {
              if (mCond !== undefined) o.flatMulIf = { when: mCond, numerator: 2, denominator: 1 };
              else o.flatMul = { numerator: 2, denominator: 1 };
              hit = true;
            } else if (kind === "chanceDouble" && o.chance !== undefined) {
              if (mCond !== undefined) o.chanceMulIf = { when: mCond, numerator: 2, denominator: 1 };
              else o.chance = Math.min(100, o.chance * 2);
              hit = true;
            }
          }
          if (hit) { if (probe3.orphanCond === undefined && pendingCond !== undefined) { pendingCond = undefined; pendingCondSrc = undefined; } pendingEmpty = undefined; segParsed = true; continue; }
        }
        // 注意花括号：else 必须绑到外层 if（写成 `if (A) for (…) if (B) …; else …;`
        // 会让 else 挂到内层 if 上，外层为假时整段 gtext 残文就不推了——真内容被静默丢掉）。
        if (probe3.unparsed.length > 0 && probe3.unparsed.every((u) => u.reason !== "no-rule")) {
          for (const u of probe3.unparsed) if (!isNoiseFragment(u.clause) || entries.length === 0) unparsed.push(u);
        } else if (!isNoiseFragment(gtext) || entries.length === 0) {
          unparsed.push({ clause: gtext, reason: "no-trigger-prefix" });
        }
        pendingEmpty = undefined; continue;
      }
      if (!inherited) { const { dupActor: _dd, guardDropped: _gd2, ...extraKeep } = extra; lastHook = { hook, extra: extraKeep }; }
      if (limitBattle) extra = { ...extra, limitBattle: true };
      if (hook === "__fatal__" || hook === "__crit__" || hook === "__order__") {
        // beforeOrder 特例：体为"先制+K"/"先制-K"时可直接落 prio 区间
        if (hook === "__order__") {
          const pm = body.match(/^先制([+-]\d+)$/);
          if (pm) {
            const v = parseInt(pm[1], 10);
            entries.push({ hook: "beforeOrder", ...(bossGate ? { bossGate: true } : {}), prio: { min: v, max: v } });
            continue;
          }
        }
        // __fatal__ + 留血体 → endure flag op（"受到致命一击残留1点HP"/"有1次机会残留1点体力"——legacy endure 回卷语义，一次性）
        if (hook === "__fatal__") {
          const em = body.match(/^(?:(?:有?1次机会|有?一次机会)使?)?(?:使自身|自身|自己)?(?:将|可|可以|能够|会)?(?:(?:有)?100%的?(?:概率|几率)?)?(?:残留|保留|余下|留下|剩下)(?:至|到)?1\s*(?:点)?(?:滴)?(?:血|体力|HP|点体力|点血|滴血)?(?:不死)?$/);
          if (em !== null) { entries.push({ op: "endure", ...(bossGate ? { bossGate: true } : {}) }); segParsed = true; continue; }
        }
        unparsed.push({ clause: gtext, reason: hook === "__fatal__" ? "fatal-trigger" : hook === "__crit__" ? "crit-trigger" : "order-context" });
        continue;
      }
      if (body === "") {
        // 裸触发组：hook 结转 lastHook（下组继承），记 pendingEmpty 待子句末兜底；触发头带 guard 时转 pendingCond（"造成的伤害低于200，回合结束时P则X"——阈值守卫随下组 op.if 落位，不随空触发丢失）
        if (!inherited) {
          const { guard: bareGuard, opIf: bareOpIf, ...extraKeep } = extra;
          lastHook = { hook, extra: extraKeep };
          for (const bc of [bareGuard, bareOpIf]) if (bc !== undefined) { pendingCond = pendingCond === undefined ? bc : { and: [pendingCond, bc] }; pendingCondSrc = pendingCondSrc ?? gtext; } // opIf 同走 pendingCond（"奇数回合，使用属性技能则X"——奇偶守卫随下组 op.if 落位）
          pendingEmpty = { text: gtext, atEntries: entries.length };
        }
        else unparsed.push({ clause: gtext, reason: "empty-body" });
        continue;
      }

      // "<acc_down N>" 标记体（"对手使用技能命中率降低N%"→自身闪避窗）
      const accm = body.match(/^<acc_down (\d+)>(.*)$/);
      if (accm !== null) body = accm[2].trim() === "" ? "" : accm[2];
      if (body.startsWith("都")) body = body.slice(1); // "都有50%概率X"——触发 lookahead 留下的"都"引导词
      // 体首"cond，则rest"回收（逗号合组残留："回合开始时体力低于对手，则所有技能先制+1"→"若cond则rest"）
      const czm = body.match(/^(.{2,24}?)[，,、]则(.+)$/);
      if (czm !== null) {
        const c = smCondOf(czm[1].replace(/^(?:当|若)/, "").replace(/^处于/, "自身处于"));
        if (c !== undefined) body = `若${czm[1]}则${czm[2]}`;
      }
      // 体首"下N回合"剥出（"受到攻击则下2回合造成的伤害提高100%"——窗口回合注入产出 op）
      let bodyTurns;
      const tpre = body.match(/^(?:未来|接下来|此后)(\d+)个?回合[内中]?[，,]?/) ?? body.match(/^下(\d+)个?回合[内中]?[，,]?/) ?? body.match(/^下回合[，,]?/);
      if (tpre !== null) { bodyTurns = +(tpre[1] ?? 1); body = body.slice(tpre[0].length); }
      // "转变为X/改为X"：升级分支（"体力低于1/2时转变为恢复1/3"——与前一同钩条目互斥，前缀剥离走常规解析）
      const upgMatch = body.match(/^(?:转)?(?:变为?|改为)(.+)$/);
      const isUpgrade = upgMatch !== null;
      if (upgMatch !== null) body = upgMatch[1].trim();
      // 体尾"几率等同(于)X体力百分比"——动态概率挂载本组条目（chanceDyn：判定时刻按体力比例算）
      let bodyDyn;
      const bDynM = body.match(/[，,、\s]*(?:有(?:一定)?几率|几率|概率)(?:等同于?|等于|与)?(自身|自己|对手|对方|敌方)?((?:当前|现有|剩余)?已损失|损失|当前|现有|剩余)?的?体力(?:值)?的?百分比$/);
      if (bDynM !== null) {
        const missing = /损失/.test(bDynM[2] ?? "");
        const foeSide = /对手|对方|敌方/.test(bDynM[1] ?? "");
        bodyDyn = foeSide ? (missing ? "foeMissingHpPct" : "foeHpPct") : (missing ? "selfMissingHpPct" : "selfHpPct");
        body = body.slice(0, bDynM.index);
      }
      // 类别主语结转（"后出手时属性技能吸取…"——触发层未带 cat 时 body 首类别词归 entry.cat，不落 if:{} 或丢限制）
      if (hook === "onMoveUsed" && extra.cat === undefined) {
        const cm2 = body.match(/^(?:自身|自己)?(属性|物理|特殊|攻击)(?:攻击)?(?:技能|招式)(?=\d|有|使|令|附加|吸取|恢复|造成|消除|降低|提升|对)/);
        if (cm2 !== null) {
          extra = { ...extra, cat: cm2[1] === "属性" ? 1 : cm2[1] === "物理" ? 2 : cm2[1] === "特殊" ? 3 : [2, 3] };
          body = body.slice(cm2[0].length);
        }
      }
      // "每低N点恢复M点体力" 步进回复（阈值由条目 guard.selfHpBelowAbs 烘入——"若体力低于500点则每低1点恢复1点"）
      let pbHeal;
      const pbm = body.match(/^(?:自身|自己)?每低(\d+)点(?:体力|HP)?(?:，|,)?(?:自身|自己)?恢复(\d+)点(?:体力|HP)?/);
      if (pbm !== null && extra.guard?.selfHpBelowAbs !== undefined) {
        pbHeal = { op: "heal", perBelowAbs: { threshold: extra.guard.selfHpBelowAbs, per: +pbm[1], add: +pbm[2] }, target: "self" };
        body = body.slice(pbm[0].length).replace(/^[，,、\s]+/, "");
      }
      // 体首"吸取此回合受到(攻击)?伤害"→回溯吸血（承伤快照等额固伤 + drain 1/1 回吸——非 dmg_to_heal；"N%触发<名>："/"触发<名>："具名内联定义前缀就地消费）
      let rtkOp;
      const rtk = body.match(/^(?:(\d+)%(?:的?(?:概率|几率))?)?(?:触发[^：:，,、；;]{2,10}[：:])?\s*吸取(?:此回合|本回合|当回合|该回合)受到(?:的)?(?:攻击)?伤害/);
      if (rtk !== null) { rtkOp = { op: "damage", kind: "fixed", power: 0, flatSelfLastTaken: true, drain: { numerator: 1, denominator: 1 }, target: "opponent", ...(rtk[1] !== undefined ? { chance: +rtk[1] } : {}) }; body = body.slice(rtk[0].length).replace(/^[，,、\s]+/, ""); }
      // 体首"每有N回合AIL"步进前缀（触发剥后余文——"回合开始时自身每有1回合流血"→pendingAilTurn，下组 pct 窗烘焙）
      const apt2 = body.match(new RegExp(`^(?:自身|自己)每有(\\d+|一)回合(${AIL_ALT})(?:状态)?[，,、]?(?=当回合|本回合|$|造成|攻击)`));
      if (apt2 !== null && AILMENTS[apt2[2]] !== undefined) {
        pendingAilTurn = { ail: AILMENTS[apt2[2]], per: apt2[1] === "一" ? 1 : +apt2[1] };
        body = body.slice(apt2[0].length).replace(/^[，,、则时]+/, "");
      }
      // 体首"每与对手相差N点"步进前缀（"若体力低于对手则每与对手相差80点伤害提升40%"——pendingHpDiffCtx）
      const hdc = body.match(/^每与对手相差(\d+)点(?:体力|HP)?(?:，|,|则|时)?/);
      if (hdc !== null) { pendingHpDiffCtx = { per: +hdc[1] }; body = body.slice(hdc[0].length); }
      // 体首"X每有N点护盾"步进前缀（"双方每有5点护盾伤害提升1%"——pendingShieldCtx，who:1=self 2=foe 3=both）
      const shc = body.match(/^(自身|自己|对手|对方|敌方|双方|敌我双方)?每有(\d+)点护盾(?:值)?(?:，|,|则|时)?/);
      if (shc !== null) { pendingShieldCtx = { per: +shc[2], who: shc[1] === undefined ? undefined : /自身|自己/.test(shc[1]) ? 1 : /对手|对方|敌方/.test(shc[1]) ? 2 : 3 }; body = body.slice(shc[0].length); }
      // 体首"本次在场体力恢复效果提升N%"（PASSIVES 仅全句通道——body 内嵌形态直发 heal_boost op）
      let hbOp;
      const hbm = body.match(/^(?:自身|自己)?(?:本次在场|在场|本回合|当回合)?(?:的)?(?:体力|HP|生命)?恢复(?:能力|效果|量|比例)(?:翻倍|(?:提升|提高|增加)(\d+)%)/);
      if (hbm !== null) {
        hbOp = { op: "apply_status", name: "heal_boost", target: "self", params: { pct: hbm[1] !== undefined ? +hbm[1] : 100 } };
        body = body.slice(hbm[0].length).replace(/^[，,、\s]+/, "");
      }
      const { effects, flags, unparsed: inner, effDoubleFlag, orphanCond, turnsTail } = parseEffectText(body === "" ? body : normalizeSoulBody(body), { keepDrainKeys: true, fracFlatChance: true });
      if (pbHeal !== undefined) effects.unshift(pbHeal);
      if (hbOp !== undefined) effects.unshift(hbOp);
      if (rtkOp !== undefined) effects.unshift(rtkOp);
      let mountedPrev = false; // 跨条目挂载消费标记（"固伤翻倍"挂前条目 op——组级产出成立抑 no-op 误报）
      if (accm !== null) effects.unshift({ op: "apply_status", name: "dodge", target: "self", params: { pct: +accm[1] } });
      // 裸时长尾（"X，2回合内"——inner 剥出 turnsTail 无载荷）→ 回挂最近时长可受 op（已有 turns 的默认窗被真实值覆盖）
      if (turnsTail !== undefined) {
        const host = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.turns !== undefined) ?? [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status");
        if (host !== undefined) host.turns = turnsTail;
      }
      if (orphanCond !== undefined) { pendingCond = pendingCond !== undefined ? { and: [pendingCond, orphanCond] } : orphanCond; pendingCondSrc = pendingCondSrc ?? gtext; } // 组级孤儿谓词结转（"后出手时"独立成组→order 守卫挂下组 ops）
      // effectDouble 挂载辅助（"效果翻倍"——inner 以 effDoubleFlag 幻影旗编码时由本层真正挂载）
      const cloneFlagOp = (fk, fv, cond) => {
        const w = fv !== undefined && typeof fv === "object" && fv.when !== undefined ? fv.when : undefined;
        const g = w !== undefined ? { and: [cond, w] } : cond;
        let op;
        if (fk === "mul" || fk === "mulIf") op = { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: Math.round((fv.numerator * 100) / fv.denominator) - 100 } };
        else if (fk === "mulRange") op = { op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: fv.min, pctMax: fv.max } };
        else if (fk === "flatBonus") op = { op: "damage", kind: "fixed", power: fv, target: "opponent" };
        else if (fk === "flatRange") op = { op: "damage", kind: "fixed", power: 1, flatRange: fv, target: "opponent" };
        else if (fk === "flatFoeFrac") op = { op: "damage", kind: "percent", frac: { numerator: fv.numerator, denominator: fv.denominator }, target: "opponent" };
        else if (fk === "flatSelfFrac") op = { op: "damage", kind: "fixed", power: 0, flatSelfFrac: fv, target: "opponent" };
        else if (fk === "flatSelfPct") op = { op: "damage", kind: "fixed", power: 0, flatSelfFrac: { numerator: fv, denominator: 100, base: "max" }, target: "opponent" };
        else if (fk === "drain") op = { op: "apply_status", name: "drain_atk", target: "self", params: { n: fv.numerator, d: fv.denominator } };
        else if (fk === "flatPerStage" || fk === "flatSelfDefSumPct" || fk === "flatFoeDefPct" || fk === "flatFoeDefSumPct" || fk === "flatMaxHpDiffPct") op = { op: "damage", kind: "fixed", power: 0, [fk]: fv, target: "opponent" };
        if (op !== undefined) { op.if = g; effects.push(op); }
        return op;
      };
      const mutateFlag = (fk, fv) => {
        const ad = flags.attachDamage;
        if (fk === "mul" || fk === "mulIf") fv.numerator = fv.numerator * 2 - fv.denominator;
        else if (fk === "mulRange") { fv.min *= 2; fv.max *= 2; }
        else if (fk === "flatBonus" || fk === "flatSelfPct" || fk === "flatPerStage" || fk === "flatSelfDefSumPct" || fk === "flatFoeDefPct" || fk === "flatFoeDefSumPct" || fk === "flatMaxHpDiffPct" || fk === "minDamage") ad[fk] = fv * 2;
        else if (fk === "flatRange") { fv.min *= 2; fv.max *= 2; }
        else if (fk === "flatFoeFrac" || fk === "flatSelfFrac" || fk === "drain" || fk === "flatEcho" || fk === "healOnHit") { if (typeof fv === "object" && fv !== null && fv.numerator !== undefined) fv.numerator *= 2; else return false; }
        else return false;
        return true;
      };
      // 翻倍挂载：ops 条件→mulIf/克隆，无条件→就地×2；flag 宿主同处理（effDoubleFlag 幻影键跳过）
      const doMount = (cond, prevOps) => {
        let hit = false;
        for (const o of [...prevOps, ...effects]) {
          const sink = prevOps.includes(o) ? prevOps : effects;
          if (cond !== undefined && (o.op === "damage" || o.op === "heal")) { o.mulIf = { when: cond, numerator: 2, denominator: 1 }; hit = true; }
          else if (o.op === "apply_stat_stage" && o.delta > 0) { if (cond !== undefined) sink.push({ ...o, if: o.if !== undefined ? { and: [cond, o.if] } : cond }); else o.delta *= 2; hit = true; }
          else if (o.op === "heal" && o.numerator !== undefined) { o.numerator *= 2; hit = true; }
          else if (o.op === "damage" && o.power !== undefined) { o.power *= 2; hit = true; }
          else if (o.op === "apply_status" && (o.params?.flat !== undefined || o.params?.pct !== undefined || (o.params?.n !== undefined && o.params?.d !== undefined))) {
            if (cond !== undefined) sink.push({ ...o, params: { ...o.params }, if: o.if !== undefined ? { and: [cond, o.if] } : cond });
            else if (o.params.flat !== undefined) o.params.flat *= 2;
            else if (o.params.pct !== undefined) o.params.pct *= 2;
            else o.params.n *= 2;
            hit = true;
          }
        }
        const ad = flags?.attachDamage;
        if (ad !== undefined && typeof ad === "object") {
          for (const fk of Object.keys(ad)) {
            if (fk === effDoubleFlag) continue;
            if (cond !== undefined) { if (cloneFlagOp(fk, ad[fk], cond) !== undefined) hit = true; }
            else if (mutateFlag(fk, ad[fk])) hit = true;
          }
          if (hit && effDoubleFlag !== undefined && ad[effDoubleFlag] !== undefined) { delete ad[effDoubleFlag]; if (Object.keys(ad).length === 0) delete flags.attachDamage; }
        }
        return hit;
      };
      // inner 增长尾接管（"下次触发几率提升N%"/"几率变为N%"——体拆后残留，贴条级 chanceGrow）
      let innerGrow;
      let localAtCap; // "当效果叠加至N%时"本组达顶（pct 宿主在待建条目——step=宿主 pct 基值，newEntry 落地后结转 pendingAtCap）
      let pendingPromoteChance; // 本组 effects 内 op.chance 提升为条级 chance（配合 innerGrow chanceGrow）
      let adGrowStep; // attachDamage 幅度成长（"每次使用增加N%"——powerMulPerUse/markCap 通道）
      let adGrowCap; // markCap pct 窗叠加封顶层（"减少N%可叠加M次"——cap=pct×M）
      let healEchoMounted; // healEcho 跨组挂载成功标记——effects 层 <healEcho> 孤儿记录抑制（语义已由挂载承载）
      for (const u of inner) {
        const t = typeof u === "string" ? u : (u.clause ?? "");
        if (t === "<healEcho>") {
          if (healEchoMounted === true) continue;
          // 裸 healEcho 跨层挂载（宿主 heal 由本层注入 inner 未见——"每低1点恢复1点体力并附加等量固伤"的 pbHeal 通道）
          const pool0 = [...effects, ...(entries[entries.length - 1]?.ops ?? [])];
          let hit0 = false;
          for (const o of pool0) {
            if (o.op === "heal") { o.foeEcho = true; hit0 = true; }
            else if (o.op === "applyDrainRider" || (o.op === "damage" && o.drain !== undefined)) { o.drainEcho = { numerator: 1, denominator: 1 }; hit0 = true; }
            else if (o.op === "apply_status" && (o.name === "drain_atk" || o.name === "hot")) { o.params = { ...(o.params ?? {}), echoN: 1, echoD: 1 }; hit0 = true; }
          }
          if (hit0) { healEchoMounted = true; continue; }
        }
        const gm2 = t.match(/^(?:下次触发|触发)?(?:的)?(?:几率|概率)(?:提升|提高|增加|变为)(\d+)%(?:[，,]?最多(?:提升|提高|增加|变为)?(\d+)%)?$/)
          ?? t.match(/^(?:概率|几率)(?:每次)?(?:提升|提高|增加)(\d+)%(?:[，,]?最多(?:提升|提高|增加)?(\d+)%)?$/)
          ?? t.match(/^(?:之后)?(?:本次在场|在场期间|本回合在场)?(?:该)?(?:概率|几率)(?:提升|提高|增加)(\d+)%(?:[，,]?最高(?:可)?(?:提升|提高|增加|达到|为)?(\d+)%)?$/) // "之后本次在场该概率提升5%"——per-presence 成长按每场近似（UNVERIFIED：下场不清账）
          ?? t.match(/^(?:之后)?(?:每次使用|每次触发|每次攻击|每回合)(?:技能)?后?(?:额外)?(?:的?[\u4e00-\u9fa5]{0,4}?(?:概率|几率)|的?(?:效果|伤害|数值))?(?:增加|提高|提升)(\d+)%(?:[，,]?最高(?:可)?(?:提升|提高|增加|达到|为|叠加)?(\d+)%)?$/)
          ?? t.match(/^(?:之后)?每回合(?:的?(?:概率|几率))?(?:降低|减少)(\d+)%(?:[，,]?最低(?:为|至)?(\d+)%)?$/);
        if (gm2 !== null) { const neg = /降低|减少/.test(gm2[0]); innerGrow = { add: (neg ? -1 : 1) * +gm2[1], ...(gm2[2] !== undefined ? { cap: +gm2[2] } : {}), kind: /概率|几率/.test(gm2[0]) ? "chance" : (/效果|伤害|数值/.test(gm2[0]) ? "mag" : "auto") }; continue; }
        // "最高N%"/"最多提升N%"裸尾 → 回挂本组/上条 growStep op 的 growCap
        const capm = t.match(/^最高(?:提升至|提高到|增加到|提升|提高|增加|为|至|到|可达|可叠加)?(\d+)%$/) ?? t.match(/^最多可叠加(\d+)次$/);
        if (capm !== null) {
          const host = [...effects].reverse().find((o) => o.op === "apply_status" && o.params?.growStep !== undefined) ?? [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.growStep !== undefined);
          if (host !== undefined) { host.params.growCap = +capm[1]; continue; }
          if (innerGrow !== undefined && innerGrow.cap === undefined) { innerGrow = { ...innerGrow, cap: +capm[1] }; continue; }
          const ge2 = entries[entries.length - 1];
          if (ge2 !== undefined && ge2.chanceGrow !== undefined) { ge2.chanceGrow = { ...ge2.chanceGrow, cap: +capm[1] }; continue; }
          if (lastGrowMount !== undefined && lastGrowMount.chanceGrow !== undefined) { lastGrowMount.chanceGrow = { ...lastGrowMount.chanceGrow, cap: +capm[1] }; continue; }
          if (ge2 !== undefined && ge2.growStep !== undefined) { ge2.growCap = +capm[1]; continue; }
          // chance 宿主（"20%令对手害怕，最高80%"）→ chanceGrow 封顶；显式步进(chancePerUse)优先，否则以基础 chance 为步进（UNVERIFIED）
          const cpuE = [...effects].reverse().find((o) => o.chancePerUse !== undefined);
          const chE = [...effects].reverse().find((o) => o.chance !== undefined);
          if (cpuE !== undefined || chE !== undefined) {
            // 宿主在本组 effects（待建条目）——chanceGrow 经 innerGrow 通道落到 newEntry，chance 同步提升
            const step = cpuE?.chancePerUse ?? chE.chance;
            const base = chE?.chance;
            for (const o of effects) { delete o.chancePerUse; delete o.chancePerUseCap; if (base !== undefined && o.chance === base) delete o.chance; }
            if (base !== undefined) pendingPromoteChance = base;
            innerGrow = { ...(innerGrow ?? {}), add: step, cap: +capm[1], kind: "chance" }; continue;
          }
          const cpu = [...(ge2?.ops ?? [])].reverse().find((o) => o.chancePerUse !== undefined);
          const ch2 = [...(ge2?.ops ?? [])].reverse().find((o) => o.chance !== undefined);
          const step = cpu?.chancePerUse ?? ch2?.chance;
          if (ge2 !== undefined && step !== undefined && ge2.chanceGrow === undefined) {
            const base = ch2?.chance;
            for (const o of ge2.ops ?? []) { delete o.chancePerUse; delete o.chancePerUseCap; if (base !== undefined && o.chance === base) delete o.chance; }
            if (base !== undefined) ge2.chance = base;
            ge2.chanceGrow = { add: step, cap: +capm[1] }; continue;
          }
          unparsed.push({ clause: t, reason: "cap-tail-orphan" }); continue;
        }
        // "<attachAll turnsTail>" 跨句时长尾（"该护盾持续3回合"）→ 回挂最近一条 apply_status op 的 turns
        const tt = t.match(/^<attachAll turnsTail>$/) ? gtext.match(/(\d+)回合/) : null;
        if (tt !== null) {
          const host = [...effects].reverse().find((o) => o.op === "apply_status") ?? [...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status");
          if (host !== undefined) { host.turns = +tt[1]; continue; }
        }
        // "<attachAll chanceDouble|chanceBoostPct|effectDouble>" 跨句修饰（"几率翻倍"/"概率提升N%"/"效果翻倍"）→ 回挂前一条目 ops
        // 带 pendingCond 时走条件挂载：chance→chanceMulIf（精确）、damage/heal→mulIf（精确）、其余→克隆 op 带 if
        const aa = t.match(/^<attachAll (chanceDouble|chanceBoostPct|effectDouble|healDouble|drainDouble|takenDownDouble|flatDouble|dmgDouble|chanceSet|healEcho|healEchoFrac)>$/);
        if (aa !== null) {
          const prevOps = entries.length > clauseEntryStart ? entries[entries.length - 1].ops : []; // "；"子句独立——修饰不跨界挂载（"A则50%麻痹；B则50%归零，P时几率提升"——chanceSet 宿主限本子句）
          const allOps = [...prevOps, ...effects]; // 同组 inner 直产 op 也是宿主（"先出手时伤害提升50%，体力低于对手时效果翻倍"——宿主在本句）
          const cbm = gtext.match(/(\d+)%/);
          // cond 兜底链：pendingCond（跨组）→ u.effCond（inner P时 规则内联条件）→ extra.opIf（"未受攻击则"op 注入）→ extra.guard（"若P则"条目守卫——标记组无 op，守卫应转成挂载条件）
          const cond = pendingCond ?? (typeof u === "object" ? u.effCond : undefined) ?? extra.opIf ?? extra.guard;
          const clearCond = () => { pendingCond = undefined; pendingCondSrc = undefined; };
          if (aa[1] === "chanceDouble") {
            let hit = false;
            for (const o of allOps) if (o.chance !== undefined) { if (cond !== undefined) o.chanceMulIf = { when: cond, numerator: 2, denominator: 1 }; else o.chance = Math.min(100, o.chance * 2); hit = true; }
            // crit_up 宿主（"致命几率翻倍"——条件翻倍发补窗 crit_up{n,d-n,gate}：n/d+(1−n/d)·n/(d−n)≡2n/d）
            for (const o of allOps) if (o.op === "apply_status" && o.name === "crit_up" && o.params?.n !== undefined && o.params?.d !== undefined) {
              if (cond !== undefined) { const g = passCondGate(cond, "crit_up"); if (g !== undefined && o.params.d > o.params.n) { const cl = { op: "apply_status", name: "crit_up", target: "self", params: { ...g, n: o.params.n, d: o.params.d - o.params.n } }; if (prevOps.includes(o)) { entries[entries.length - 1].ops.push(cl); mountedPrev = true; } else effects.push(cl); hit = true; } }
              else { o.params = { ...o.params, n: Math.min(100, o.params.n * 2) }; hit = true; }
            }
            // pct 窗宿主（"P时几率翻倍"——immune_chance/dodge 等：条件翻倍发补窗 pct'=P·100/(100−P)，组合概率恰为 2P）
            {
              const NEG_KEY = { selfHpBelowFoe: "notSelfHpBelowFoe", selfHpAboveFoe: "notSelfHpAboveFoe", foeStatused: "notFoeStatused", selfStatused: "notSelfStatused", selfStageUp: "notSelfStageUp", selfStageDown: "notSelfStageDown" };
              const condKey = cond !== undefined && typeof cond === "object" && cond.and === undefined && cond.or === undefined ? Object.keys(cond).find((k) => cond[k] === true && NEG_KEY[k] !== undefined) : undefined;
              const PCT_WIN = new Set(["dodge", "dmg_boost", "dmg_taken_down", "dmg_taken_up", "dmg_reduce", "immune_chance", "drain_atk"]);
              for (const o of allOps) if (o.op === "apply_status" && PCT_WIN.has(o.name) && o.params?.pct !== undefined) {
                if (cond !== undefined) {
                  const g = condKey !== undefined ? passCondGate(cond, o.name) : undefined;
                  if (g !== undefined) { const pc = Math.min(100, Math.floor((o.params.pct * 100) / Math.max(1, 100 - o.params.pct))); const clone = { op: "apply_status", name: o.name, target: o.target ?? "self", ...(o.turns !== undefined ? { turns: o.turns } : {}), params: { ...(o.params?.cat !== undefined ? { cat: o.params.cat } : {}), pct: pc, ...g } }; const owner = prevOps.includes(o) ? entries[entries.length - 1] : { hook }; markPermanentBattleStartClone(owner, o, clone); if (prevOps.includes(o)) { entries[entries.length - 1].ops.push(clone); mountedPrev = true; } else effects.push(clone); o.params = { ...o.params, [NEG_KEY[condKey]]: 1 }; hit = true; }
                } else { o.params = { ...o.params, pct: Math.min(100, o.params.pct * 2) }; hit = true; }
              }
            }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "chanceSet") {
            // "P时几率变为/提升至N%"：宿主 op chance → chanceSetIf 条件改写（runtime 已支持）
            const v = typeof u === "object" ? u.chanceSet : undefined;
            let hit = false;
            if (v !== undefined) for (const o of allOps) if (o.chance !== undefined) { if (cond !== undefined) o.chanceSetIf = { when: cond, value: v }; else o.chance = v; hit = true; }
            if (!hit && v !== undefined && cond !== undefined) {
              // pct 参数窗宿主（"40%几率闪避→dodge{pct:40}"）→ 克隆门控异值窗 + 宿主反门控（互斥："低于对手 60%"/"否则 40%"，非叠加）
              const NEG_KEY = { selfHpBelowFoe: "notSelfHpBelowFoe", selfHpAboveFoe: "notSelfHpAboveFoe", foeStatused: "notFoeStatused", selfStatused: "notSelfStatused", selfStageUp: "notSelfStageUp", selfStageDown: "notSelfStageDown" };
              const condKey = typeof cond === "object" && cond.and === undefined && cond.or === undefined ? Object.keys(cond).find((k) => cond[k] === true && NEG_KEY[k] !== undefined) : undefined;
              const PCT_WIN = new Set(["dodge", "dmg_boost", "dmg_taken_down", "dmg_taken_up", "dmg_reduce", "immune_chance", "drain_atk"]);
              const host = condKey !== undefined ? allOps.find((o) => o.op === "apply_status" && (PCT_WIN.has(o.name) ? o.params?.pct !== undefined : o.name === "crit_up" && o.params?.n !== undefined)) : undefined;
              if (host !== undefined) {
                const gate = passCondGate(cond, host.name);
                if (gate !== undefined) {
                  const clone = { op: "apply_status", name: host.name, target: host.target ?? "self", ...(host.turns !== undefined ? { turns: host.turns } : {}), params: { ...(host.params?.cat !== undefined ? { cat: host.params.cat } : {}), ...(host.name === "crit_up" ? { n: v, d: 100 } : { pct: v }), ...gate } };
                  const owner = prevOps.includes(host) ? entries[entries.length - 1] : { hook };
                  markPermanentBattleStartClone(owner, host, clone);
                  if (prevOps.includes(host)) { entries[entries.length - 1].ops.push(clone); mountedPrev = true; } else effects.push(clone); // 克隆挂宿主同条目同钩
                  host.params = { ...(host.params ?? {}), [NEG_KEY[condKey]]: 1 }; // 互斥半支：条件成立时基窗关闭
                  clearCond(); continue;
                }
              }
            }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "chanceBoostPct" && cbm !== null) {
            // pendingHpStep 语境："体力每损失5%体力，害怕概率增加5%"——chance 宿主 op 挂 chancePerMissing（既有已损体力步进概率通道，判定时刻动态加成）
            if (pendingHpStep !== undefined) {
              const hostOp = [...allOps].reverse().find((o) => o.chance !== undefined);
              if (hostOp !== undefined) { hostOp.chancePerMissing = { per: pendingHpStep, step: +cbm[1] }; pendingHpStep = undefined; clearCond(); continue; }
            }
            const f = 100 + (+cbm[1]); let hit = false;
            for (const o of allOps) if (o.chance !== undefined) { if (cond !== undefined) o.chanceMulIf = { when: cond, numerator: f, denominator: 100 }; else o.chance = Math.min(100, Math.floor((o.chance * f) / 100)); hit = true; }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "effectDouble") {
            if (doMount(cond, prevOps)) { clearCond(); continue; }
            // 唯一内容是幻影旗（如"P时提升效果翻倍"独立成句——scaleIf{P,2/1} 已承载全部语义）→ 消耗标记不留孤儿
            if (effDoubleFlag !== undefined && flags?.attachDamage?.[effDoubleFlag] !== undefined) continue;
          } else if (aa[1] === "healDouble") {
            // "恢复效果翻倍"：heal 挂 mulIf 或无条件 numerator/flat ×2（与 effects 层 healDouble 语义同构）
            let hit = false;
            for (const o of allOps) if (o.op === "heal") { if (cond !== undefined) o.mulIf = { when: cond, numerator: 2, denominator: 1 }; else if (o.numerator !== undefined) o.numerator *= 2; else if (o.flat !== undefined) o.flat *= 2; if (prevOps.includes(o)) mountedPrev = true; hit = true; }
            if (hit) { clearCond(); continue; }
            // 无 heal 宿主 → heal_boost 常驻窗（"体力低于1/2时自身恢复能力翻倍"——翻倍=回复量+100%，cond→params 门控）
            const gate = cond !== undefined ? passCondGate(cond, "heal_boost") : undefined;
            effects.push({ op: "apply_status", name: "heal_boost", target: "self", params: { pct: 100, ...(gate ?? {}) } });
            if (cond === undefined || gate !== undefined) { clearCond(); continue; }
            continue; // cond 不可门控 → 窗已出（近似 UNVERIFIED），cond 留守卫链兜底
          } else if (aa[1] === "flatDouble") {
            // "固伤翻倍"：fixed damage 挂 mulIf 或 power ×2（跨子句宿主=前条目 fixed damage op）
            let hit = false;
            for (const o of allOps) if (o.op === "damage" && (o.kind === "fixed" || o.params?.kind === "fixed")) { if (cond !== undefined) o.mulIf = { when: cond, numerator: 2, denominator: 1 }; else if (o.power !== undefined) o.power *= 2; hit = true; }
            if (!hit) { const ds = entries[entries.length - 1]?.ops.filter((o) => o.op === "damage" && o.kind === "fixed") ?? []; const d = ds.find((o) => o.flatMul === undefined && o.flatMulIf === undefined); if (d !== undefined) { if (cond !== undefined) d.flatMulIf = { when: cond, numerator: 2, denominator: 1 }; else d.flatMul = { numerator: 2, denominator: 1 }; hit = true; } else if (ds.length > 0) hit = true; /* 已由 ad.flatMul 通道挂载——token 视为已消费 */ }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "dmgDouble") {
            // "伤害翻倍"：damage/heal 挂 mulIf 或 power/numerator/flat ×2
            let hit = false;
            for (const o of allOps) if (o.op === "damage" || o.op === "heal") { if (cond !== undefined) o.mulIf = { when: cond, numerator: 2, denominator: 1 }; else { if (o.power !== undefined) o.power *= 2; if (o.numerator !== undefined) o.numerator *= 2; if (o.flat !== undefined) o.flat *= 2; } if (prevOps.includes(o)) mountedPrev = true; hit = true; }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "drainDouble") {
            // "吸取效果翻倍"：吸取=百分比伤害+等量回血 → heal+damage 双端同步 ×2/mulIf
            let hit = false;
            for (const o of allOps) if (o.op === "heal" || o.op === "damage") { if (cond !== undefined) o.mulIf = { when: cond, numerator: 2, denominator: 1 }; else { if (o.numerator !== undefined) o.numerator *= 2; if (o.flat !== undefined) o.flat *= 2; if (o.power !== undefined && (o.kind === "percent" || o.params?.kind === "percent")) o.power *= 2; } if (prevOps.includes(o)) mountedPrev = true; hit = true; }
            if (hit) { clearCond(); continue; }
          } else if (aa[1] === "healEcho" || aa[1] === "healEchoFrac") {
            // "附加等量固定伤害"跨组回挂：heal→foeEcho；drain_atk/hot 窗→params.echoN/D（逐击/逐回合结算时反噬）
            const fr = typeof u === "object" && u.healEchoFrac !== undefined ? [u.healEchoFrac.numerator, u.healEchoFrac.denominator] : [1, 1];
            // 宿主域扩展："恢复N点体力，若P则附加等量固定伤害"——heal 宿主可能在本子句更早条目（prevOps 只覆盖紧邻前条）
            const HOST_OP = (o) => o.op === "heal" || o.op === "applyDrainRider" || (o.op === "damage" && o.drain !== undefined) || (o.op === "apply_status" && (o.name === "drain_atk" || o.name === "hot"));
            const echoOps = [...allOps];
            for (const o of allOps) if (o.payload !== undefined) for (const p of o.payload) if (HOST_OP(p)) echoOps.push(p); // 紧邻前条 react payload 内宿主
            for (let ei = entries.length - 2; ei >= clauseEntryStart && !echoOps.some(HOST_OP); ei--) {
              const found = [];
              for (const o of entries[ei].ops ?? []) {
                if (HOST_OP(o)) found.push(o);
                if (o.payload !== undefined) for (const p of o.payload) if (HOST_OP(p)) found.push(p); // react payload 内的 hot/drain 宿主（"受击则回合结束恢复N点，低于1/2附加等量固伤"）
              }
              if (found.length > 0) echoOps.push(...found);
            }
            let hit = false;
            for (const o of echoOps) {
              if (o.op === "heal") { o.foeEcho = { numerator: fr[0], denominator: fr[1] }; hit = true; }
              else if (o.op === "applyDrainRider" || (o.op === "damage" && o.drain !== undefined)) { o.drainEcho = { numerator: fr[0], denominator: fr[1] }; hit = true; }
              else if (o.op === "apply_status" && (o.name === "drain_atk" || (o.name === "hot" && (o.target ?? "self") === "self"))) {
                const gate = cond !== undefined ? passCondGate(cond, o.name) : undefined;
                o.params = { ...(o.params ?? {}), echoN: fr[0], echoD: fr[1], ...(gate !== undefined && o.name === "drain_atk" ? Object.fromEntries(Object.entries(gate).map(([k, v]) => [`echo${k[0].toUpperCase()}${k.slice(1)}`, v])) : {}) };
                hit = true;
              }
            }
            if (hit) { healEchoMounted = true; if (prevOps.length > 0 && allOps.some((o) => prevOps.includes(o))) mountedPrev = true; clearCond(); continue; }
          } else if (aa[1] === "takenDownDouble") {
            // "减免效果翻倍"：dmg_taken_down/dmg_reduce 宿主 pct/flat ×2 或条件克隆窗（P 时基窗反门互斥）
            let hit = false;
            for (const o of allOps) if (o.op === "apply_status" && (o.name === "dmg_taken_down" || o.name === "dmg_reduce")) {
              if (cond !== undefined) { const g = passCondGate(cond, "dmg_taken_down"); if (g !== undefined) { const cl = { op: "apply_status", name: o.name, target: o.target ?? "self", ...(o.turns !== undefined ? { turns: o.turns } : {}), params: { ...(o.params ?? {}), ...g } }; if (o.params?.pct !== undefined) cl.params.pct = Math.min(100, o.params.pct * 2); if (prevOps.includes(o)) { entries[entries.length - 1].ops.push(cl); mountedPrev = true; } else effects.push(cl); negateBaseParam(o, cond); } }
              else if (o.params?.pct !== undefined) o.params = { ...o.params, pct: Math.min(100, o.params.pct * 2) };
              else if (o.params?.flat !== undefined) o.params = { ...o.params, flat: o.params.flat * 2 };
              if (prevOps.includes(o)) mountedPrev = true;
              hit = true;
            }
            if (hit) { clearCond(); continue; }
          }
        }
        const uc = typeof u === "string" ? u : u.clause;
        // "最多可叠加N次"跨组结转 → 前条目/当前句最近 apply_mark.cap
        if (typeof u === "object" && u.markCap !== undefined) {
          const mk = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_mark");
          if (mk !== undefined) { mk.cap = u.markCap; continue; }
          // pct 窗叠加（"对手造成的伤害减少20%直到下场，最多可叠加3次"）→ 宿主条目 growStep=pct, growCap=pct×N
          const ph = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.params?.pct !== undefined);
          if (ph !== undefined) {
            const pe = (entries[entries.length - 1]?.ops ?? []).includes(ph) ? entries[entries.length - 1] : undefined;
            if (pe !== undefined) { pe.growStep = ph.params.pct; pe.growCap = ph.params.pct * u.markCap; continue; }
            adGrowStep ??= ph.params.pct; adGrowCap ??= ph.params.pct * u.markCap; continue;
          }
        }
        // "最多N点（伤害）"跨组结转 → 前条目/当前句最近 damage op 的 cap（dmg_flat 窗挂 params.cap）
        if (typeof u === "object" && u.dmgCap !== undefined) {
          const cand = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse();
          const dm = cand.find((o) => o.op === "damage") ?? cand.find((o) => o.op === "apply_status" && o.name === "dmg_flat");
          if (dm !== undefined) { if (dm.op === "damage") dm.cap = u.dmgCap; else dm.params = { ...(dm.params ?? {}), cap: u.dmgCap }; continue; }
        }
        // "最多恢复N点"跨组结转 → 最近 heal op 的 cap
        if (typeof u === "object" && u.healCap !== undefined) {
          const hl = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "heal");
          if (hl !== undefined) { hl.cap = u.healCap; continue; }
        }
        // 裸"护盾/护罩"枚举残段 → 克隆最近护盾 op（"获得等量的护盾、护罩"——护罩=护盾别名）
        if (uc !== undefined && /^(?:护盾|护罩)$/.test(uc.trim())) {
          const src = [...effects, ...(entries[entries.length - 1]?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === "shield");
          if (src !== undefined) { effects.push({ ...src, params: { ...(src.params ?? {}) } }); continue; }
        }
        // 单字/引号孤儿（"辛""时"——名前缀/实体剥后残余，无语义载量）
        if (uc !== undefined && /^[「『"'“”]?[一-龥][」』"'“”]?$/.test(uc.trim())) continue;
        // "X几率增加N%"名宿成长（"感染几率增加10%"→ 跨条目按名挂 chanceGrow；宿主在前条目，本章见 e25-df-01 延迟桶）
        const ailGrow = typeof u === "object" && u.reason === "ailment proc-chance adjust — unmodeled (deferred)"
          ? (u.clause ?? "").match(/^([一-龥]{1,4})(?:的)?(?:触发)?(?:概率|几率)(?:提升|提高|增加)(?:为|至|到)?(\d+)%?$/) : null;
        if (ailGrow !== null && AILMENTS[ailGrow[1]] !== undefined) {
          const want = AILMENTS[ailGrow[1]];
          let mounted = false;
          for (let i = entries.length - 1; i >= 0 && !mounted; i--) {
            const e = entries[i];
            const host = [...(e.ops ?? [])].reverse().find((o) => o.op === "apply_status" && o.name === want);
            if (host === undefined) continue;
            if (e.chanceGrow === undefined) {
              const base = e.chance ?? host.chance;
              for (const o of e.ops) if (o.chance === base) delete o.chance;
              if (base !== undefined) e.chance = base;
              e.chanceGrow = { add: +ailGrow[2] };
              lastGrowMount = e;
            }
            mounted = true;
          }
          if (mounted) continue;
        }
        // "当效果叠加至N%时" inner 孤儿 → pct 宿主 growStep+growCap，并挂起 pendingAtCap（下组 ops 归入 atCapOps）
        const acap = t.match(/^当(?:(?:此|该)?效果|数值|减伤数值|累计)?(?:效果)?叠加至(\d+)%时?$/);
        if (acap !== null) {
          const phE = [...effects].reverse().find((o) => o.op === "apply_status" && typeof o.params?.pct === "number");
          if (phE !== undefined) { localAtCap = { step: phE.params.pct, cap: +acap[1] }; continue; }
          const he = [...entries].reverse().find((e) => (e.ops ?? []).some((o) => o.op === "apply_status" && typeof o.params?.pct === "number"));
          if (he !== undefined) {
            const ph = he.ops.find((o) => o.op === "apply_status" && typeof o.params?.pct === "number");
            if (he.growStep === undefined) he.growStep = ph.params.pct;
            he.growCap = +acap[1];
            pendingAtCap = he;
            continue;
          }
        }
        // "重置此效果/重置此计数" inner 孤儿 → 最近 grow 宿主 resetOnCap（叠满→触发→清零循环）
        if (/^(?:之后|然后|随后)?重置此(?:效果|计数|数值|成长)$/.test(t)) {
          const rst = pendingAtCap ?? [...entries].reverse().find((e) => e.growStep !== undefined || e.growCap !== undefined || e.chanceGrow !== undefined);
          if (rst !== undefined) { rst.resetOnCap = true; continue; }
        }
        // "数值叠加至最高后下1次触发时…值提升N%" inner 孤儿 → atCapMul + atCapNext（下1次=延一档）
        const atm2 = (typeof u === "object" ? u.clause : null)?.match(/^(?:数值|效果|减伤数值)?叠加至最高(?:后|时)?(?:下|后)?1?次?(?:触发时|生效时)(?:，|,)?(?:造成的)?(.{0,12}?)(?:值)?(?:提升|提高|增加)(\d+)%$/) ?? null;
        if (atm2 !== null) {
          const ah = [...entries].reverse().find((e) => e.growStep !== undefined || e.growCap !== undefined);
          if (ah !== undefined) { ah.atCapMul = 1 + (+atm2[2]) / 100; ah.atCapNext = true; continue; }
        }
        // "最高…N点"裸尾跨句孤儿（capTail 在 effects 层失挂——growStep 宿主在条级）：回挂最近条目
        const capPt = typeof u === "object" && u.reason === "cap tail without growing host"
          ? (u.clause ?? "").match(/^最高(?:可)?(?:叠加至?|提升至|提高到|增加到|提升|提高|增加|附加|为|至|到|可达)?(\d+)点(?:固定|固伤|的固定|的固伤)?(?:伤害)?$/) : null;
        if (capPt !== null) {
          const ge3 = entries[entries.length - 1];
          if (ge3 !== undefined && pointGrow.has(ge3) && ge3.growCap === undefined) { ge3.growCap = +capPt[1]; continue; }
          if (ge3 !== undefined && ge3.growStep !== undefined && ge3.growCap === undefined) { ge3.growCap = +capPt[1]; continue; }
          if (readHit(ge3?.ops, "flatPerUse") !== undefined && readHit(ge3?.ops, "flatPerUseCap") === undefined) { writeHit(ge3.ops, "flatPerUseCap", +capPt[1]); continue; }
          const swc = [...(ge3?.ops ?? [])].reverse().find((o) => o.op === "apply_status" && (o.name === "shield" || o.name === "ward") && o.params?.flat !== undefined && o.params.flatCap === undefined);
          if (swc !== undefined) { swc.params.flatCap = +capPt[1]; continue; }
          unparsed.push({ clause: u.clause, reason: "cap-tail-orphan" }); continue;
        }
        // "不相同时X"/"不同时X" inner else 支路（逗号碎进 inner 循环——守卫在待建条目 extra.guard）→ 克隆条目 + not 守卫
        const notIn = (typeof u === "string" ? u : (u.clause ?? "")).match(/^(?:不|非|反之|否则)?(?:相同|一样|同)(?:的|时|，|,)+(.+)$/);
        if (notIn !== null && extra.guard !== undefined) {
          const sub = parseEffectText(normalizeSoulBody(notIn[1]), { keepDrainKeys: true, fracFlatChance: true });
          liftDrainRiders(sub.effects, sub.flags, { lone: "drain" });
          if (sub.effects.length > 0) { elsePending.push({ guard: extra.guard.not !== undefined ? extra.guard.not : { not: extra.guard }, ops: sub.effects, hook, extra }); for (const su of sub.unparsed) unparsed.push(su); continue; }
        }
        // 内层残文传播：纯噪声片段（图鉴页尾 / 裸主语 / 编号残渣）同样不记残文。
        if (typeof u === "string") { if (!isNoiseFragment(u) || entries.length === 0) unparsed.push({ clause: u }); }
        else if (!isNoiseFragment(u.clause) || entries.length === 0) unparsed.push(u);
      }
      // inner 自消化幻影旗：effects 非空时 inner 不发 marker，powerMul/scaleIf{2/1} 只是占位——本层补真正的"效果翻倍"挂载
      if (effDoubleFlag !== undefined && flags?.attachDamage?.[effDoubleFlag] !== undefined) {
        const phantom = flags.attachDamage[effDoubleFlag];
        if (doMount(phantom?.when, entries[entries.length - 1]?.ops ?? []) && flags.attachDamage !== undefined) { delete flags.attachDamage[effDoubleFlag]; if (Object.keys(flags.attachDamage).length === 0) delete flags.attachDamage; }
      }
      // attachDamage 键在魂印语境 = 命中后附加效果 → 转独立 op（固伤/分数固伤/吸血/必暴/暴率窗）
      if (flags.attachDamage !== undefined && typeof flags.attachDamage === "object") {
        const ad = flags.attachDamage;
        if (ad.flatBonus !== undefined) { effects.push({ op: "damage", kind: "fixed", power: ad.flatBonus, ...(ad.flatChance !== undefined ? { chance: ad.flatChance } : {}), target: "opponent" }); delete ad.flatBonus; }
        // 分数型固伤的触发概率（"50%几率附加对手体力1/3的固伤"）——概率挂 damage op 上（op 级 chance＝未过则整 op 跳过）。
        // 漏挂＝该 50% 变成 100%（效果每次都结算）。
        const flatCh = ad.flatChance !== undefined ? { chance: ad.flatChance } : {};
        if (ad.flatFoeFrac !== undefined) {
          const f = ad.flatFoeFrac;
          effects.push(f.base === "current" ? { op: "damage", kind: "percent", frac: { numerator: f.numerator, denominator: f.denominator }, percentBase: "current", target: "opponent", ...flatCh }
            : f.base === "missing" ? { op: "damage", kind: "fixed", power: 0, flatFoeFrac: f, target: "opponent", ...flatCh }
            : { op: "damage", kind: "percent", frac: { numerator: f.numerator, denominator: f.denominator }, target: "opponent", ...flatCh });
          delete ad.flatFoeFrac;
        }
        if (ad.flatSelfFrac !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatSelfFrac: ad.flatSelfFrac, target: "opponent", ...flatCh }); delete ad.flatSelfFrac; }
        if (ad.flatSelfFracIf !== undefined) { const { when, ...f } = ad.flatSelfFracIf; effects.push({ op: "damage", kind: "fixed", power: 0, flatSelfFrac: f, target: "opponent", if: when, ...flatCh }); delete ad.flatSelfFracIf; }
        if (ad.flatFoeFracIf !== undefined) { const { when, ...f } = ad.flatFoeFracIf; effects.push({ op: "damage", kind: "fixed", power: 0, flatFoeFrac: f, target: "opponent", if: when, ...flatCh }); delete ad.flatFoeFracIf; }
        if (ad.flatSelfPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatSelfFrac: { numerator: ad.flatSelfPct, denominator: 100, base: "max" }, target: "opponent", ...flatCh }); delete ad.flatSelfPct; }
        // flatSelfStatPct/flatFoeStatPct（"附加自身攻击值25%的百分比伤害"/"吸取对手自身速度值30%的体力"）→ damage op + 随附 drain 全吸（须在 ad.drain 通用转换之前消费，防 drain_atk 常驻窗语义漂移）
        if (ad.flatSelfStatPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatSelfStatPct: ad.flatSelfStatPct, ...(ad.drain !== undefined ? { drain: ad.drain } : {}), target: "opponent" }); delete ad.flatSelfStatPct; delete ad.drain; }
        if (ad.flatFoeStatPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatFoeStatPct: ad.flatFoeStatPct, ...(ad.drain !== undefined ? { drain: ad.drain } : {}), target: "opponent" }); delete ad.flatFoeStatPct; delete ad.drain; }
        if (ad.drain !== undefined) {
          const params = { n: ad.drain.numerator, d: ad.drain.denominator };
          // 同一句的等量固伤是这次吸血的回响。折进 drain_atk，避免袋子上剩下的 drainEcho 被收成没有伤害宿主的 rider。
          if (ad.drainEcho === true) { params.echoN = 1; params.echoD = 1; delete ad.drainEcho; }
          else if (ad.drainEcho !== undefined && typeof ad.drainEcho === "object") { params.echoN = ad.drainEcho.numerator; params.echoD = ad.drainEcho.denominator; delete ad.drainEcho; }
          effects.push({ op: "apply_status", name: "drain_atk", target: "self", params });
          delete ad.drain;
        }
        if (ad.crit === true) { effects.push({ op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 } }); delete ad.crit; }
        if (ad.critChance !== undefined) { effects.push({ op: "apply_status", name: "crit_up", target: "self", turns: 1, params: { n: ad.critChance, d: 100 } }); delete ad.critChance; }
        if (ad.mul !== undefined) { const pct = Math.round((ad.mul.numerator * 100) / ad.mul.denominator) - 100; if (pct !== 0) effects.push({ op: "apply_status", name: "dmg_boost", target: "self", params: { pct } }); delete ad.mul; }
        // flatRange（"随机附加N-M点固伤"）→ fixed damage 区间
        if (ad.flatRange !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 1, flatRange: ad.flatRange, ...(ad.flatChance !== undefined ? { chance: ad.flatChance } : {}), target: "opponent" }); delete ad.flatRange; }
        if (ad.flatChance !== undefined) delete ad.flatChance; // 已并入上方 flatBonus/flatRange 的 chance 信封（孤儿形态无意义）
        // minDamage（"造成的伤害不少于N"）→ dmg_out_floor 下限窗
        if (ad.minDamage !== undefined) { effects.push({ op: "apply_status", name: "dmg_out_floor", target: "self", params: { min: ad.minDamage } }); delete ad.minDamage; }
        // critChanceFrac（"暴击率上升N/M"）→ crit_up 分数窗
        if (ad.critChanceFrac !== undefined) { effects.push({ op: "apply_status", name: "crit_up", target: "self", params: { n: ad.critChanceFrac.numerator, d: ad.critChanceFrac.denominator } }); delete ad.critChanceFrac; }
        // mulChance（"N%伤害翻倍"）→ dmg_boost + 条级 chance
        if (ad.mulChance !== undefined) { const pct = Math.round((ad.mulChance.numerator * 100) / ad.mulChance.denominator) - 100; if (pct !== 0) { effects.push({ op: "apply_status", name: "dmg_boost", target: "self", params: { pct } }); if (extra.chance === undefined) extra = { ...extra, chance: ad.mulChance.chance }; } delete ad.mulChance; }
        // stageOnHit（"命中后自身攻击+1"）→ apply_stat_stage
        if (ad.stageOnHit !== undefined) { for (const s of ad.stageOnHit) effects.push({ op: "apply_stat_stage", stat: s.stat, delta: s.delta, target: s.target ?? "self" }); delete ad.stageOnHit; }
        // 同组已有自身回复时，「等量」指实际回复量，复用 heal.foeEcho；
        // 不读 onMoveUsed 中不存在的 lastDamage，也不复用上次回复快照。
        if (ad.flatEcho !== undefined && ad.flatEcho.pct === undefined) {
          const heal = [...effects].reverse().find((o) => o.op === "heal" && (o.target ?? "self") === "self");
          if (heal !== undefined) {
            heal.foeEcho = true;
            if (ad.flatEcho.when !== undefined && JSON.stringify(ad.flatEcho.when) !== JSON.stringify(heal.if)) heal.foeEchoIf = { when: ad.flatEcho.when };
            delete ad.flatEcho;
          }
        }
        // flatEcho（"附加自身造成的伤害N%的固伤"）→ lastDmgFrac（ctx.lastDamage 分数固伤；无 pct=全额）
        if (ad.flatEcho !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 1, lastDmgFrac: { numerator: ad.flatEcho.pct ?? 100, denominator: 100 }, ...(ad.flatEcho.when !== undefined ? { if: ad.flatEcho.when } : {}), target: "opponent" }); delete ad.flatEcho; }
        // flatIf（条件固伤 {when,flat|range}）/ flatRangeIf → damage op + if
        if (ad.flatIf !== undefined) { const d = { op: "damage", kind: "fixed", if: ad.flatIf.when, target: "opponent" }; if (ad.flatIf.flat !== undefined) d.power = ad.flatIf.flat; else if (ad.flatIf.range !== undefined) d.flatRange = ad.flatIf.range; else d.power = 1; effects.push(d); delete ad.flatIf; }
        if (ad.flatRangeIf !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 1, flatRange: { min: ad.flatRangeIf.min, max: ad.flatRangeIf.max }, if: ad.flatRangeIf.when, target: "opponent" }); delete ad.flatRangeIf; }
        // critIf/critChanceIf（{when,cond}/{when,chance} 包装形态）→ crit 窗 + if:.when
        if (ad.critIf !== undefined) { effects.push({ op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 }, if: ad.critIf.when ?? ad.critIf }); delete ad.critIf; }
        if (ad.critChanceIf !== undefined) { effects.push({ op: "apply_status", name: "crit_up", target: "self", turns: 1, params: { n: ad.critChanceIf.chance ?? 50, d: 100 }, if: ad.critChanceIf.when ?? ad.critChanceIf }); delete ad.critChanceIf; }
        // drainIf（{when,numerator,denominator}）→ drain_atk + if:.when
        if (ad.drainIf !== undefined) { effects.push({ op: "apply_status", name: "drain_atk", target: "self", params: { n: ad.drainIf.numerator ?? 1, d: ad.drainIf.denominator ?? 2 }, if: ad.drainIf.when ?? ad.drainIf }); delete ad.drainIf; }
        // powerMul（威力倍率分数）→ power_mul flag（"威力翻倍"——放大威力而非伤害；1× 时并入 dmg_boost 近似）
        if (ad.powerMul !== undefined) { const { numerator: pn, denominator: pd } = ad.powerMul; if (pn > pd) effects.push({ op: "apply_status", name: "power_mul", target: "self", params: { n: pn, d: pd } }); delete ad.powerMul; }
        // pierce（"无视对手护盾"）→ pierce 状态窗
        if (ad.pierce !== undefined) { effects.push({ op: "apply_status", name: "pierce", target: "self" }); delete ad.pierce; }
        // shieldEcho（造成伤害转护盾）→ dmg_to_shield 窗
        if (ad.shieldEcho !== undefined) { effects.push({ op: "apply_status", name: "dmg_to_shield", target: "self", params: { count: 1 } }); delete ad.shieldEcho; }
        // flatPerStage / pctPerSelfStage / flatSelfDefSumPct → damage op 原生字段透传
        if (ad.flatPerStage !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 1, flatPerStage: ad.flatPerStage, target: "opponent" }); delete ad.flatPerStage; }
        // mulRange（"伤害随机提升N-M%"）→ dmg_boost pctMin/pctMax 持久窗（每击 roll）
        if (ad.mulRange !== undefined) { effects.push({ op: "apply_status", name: "dmg_boost", target: "self", params: { pctMin: ad.mulRange.min, pctMax: ad.mulRange.max } }); delete ad.mulRange; }
        // flatMul/drainMul/powerMulPerUse → 挂载本组或前条目 damage op（逗号分组把宿主切开的情形）；无宿主→记档，不造幻影伤害 op
        const prevEntryOps = entries[entries.length - 1]?.ops ?? [];
        if (ad.flatMul !== undefined) { const d = effects.find((e) => e.op === "damage" && e.kind === "fixed") ?? prevEntryOps.find((e) => e.op === "damage" && e.kind === "fixed"); if (d !== undefined) { const mc = pendingCond ?? extra.guard; if (mc !== undefined) { d.flatMulIf = { when: mc, ...ad.flatMul }; pendingCond = undefined; pendingCondSrc = undefined; } else d.flatMul = ad.flatMul; if (prevEntryOps.includes(d)) mountedPrev = true; delete ad.flatMul; } }
        if (ad.flatMulIf !== undefined) { const d = effects.find((e) => e.op === "damage" && e.kind === "fixed") ?? prevEntryOps.find((e) => e.op === "damage" && e.kind === "fixed"); if (d !== undefined) { const mc = pendingCond ?? extra.guard; d.flatMulIf = mc !== undefined ? { ...ad.flatMulIf, when: { and: [ad.flatMulIf.when, mc] } } : ad.flatMulIf; if (pendingCond !== undefined) { pendingCond = undefined; pendingCondSrc = undefined; } if (prevEntryOps.includes(d)) mountedPrev = true; delete ad.flatMulIf; } }
        if (ad.drainMul !== undefined) { const d = effects.find((e) => e.op === "damage") ?? prevEntryOps.find((e) => e.op === "damage"); const h = effects.find((e) => e.op === "heal") ?? prevEntryOps.find((e) => e.op === "heal"); if (d !== undefined || h !== undefined) { const mCond = pendingCond ?? extra.guard; if (mCond !== undefined) { if (d?.drain !== undefined) d.drainIf = { when: mCond, numerator: d.drain.numerator ?? 1, denominator: d.drain.denominator ?? 2 }; else if (d !== undefined) d.mulIf = { when: mCond, numerator: 2, denominator: 1 }; if (h !== undefined) h.mulIf = { when: mCond, numerator: 2, denominator: 1 }; pendingCond = undefined; pendingCondSrc = undefined; } else { if (d !== undefined) { if (d.drain !== undefined) d.drainMul = ad.drainMul; else if (d.frac !== undefined) d.frac = { numerator: d.frac.numerator * 2, denominator: d.frac.denominator }; else d.drainMul = ad.drainMul; } if (h !== undefined) { if (h.numerator !== undefined) h.numerator *= 2; else if (h.flat !== undefined) h.flat *= 2; } } if (prevEntryOps.includes(d) || prevEntryOps.includes(h)) mountedPrev = true; delete ad.drainMul; } }
        if (ad.powerMulPerUse !== undefined) { const d = effects.find((e) => e.op === "damage") ?? prevEntryOps.find((e) => e.op === "damage"); if (d !== undefined) { d.powerMulPerUse = ad.powerMulPerUse; if (ad.powerMulPerUseCap !== undefined) { d.powerMulPerUseCap = ad.powerMulPerUseCap; delete ad.powerMulPerUseCap; } delete ad.powerMulPerUse; } }
        // flatPerUse（"附加100点固伤，每次使用增加100点，最高400点"）→ 固伤 op flatPerUse/Cap（逗号分组时回挂前条 damage）
        if (ad.flatPerUse !== undefined) { const d = effects.find((e) => e.op === "damage" && e.kind === "fixed") ?? prevEntryOps.find((e) => e.op === "damage" && e.kind === "fixed") ?? effects.find((e) => e.op === "damage") ?? prevEntryOps.find((e) => e.op === "damage"); if (d !== undefined) { d.flatPerUse = ad.flatPerUse; if (ad.flatPerUseCap !== undefined) { d.flatPerUseCap = ad.flatPerUseCap; delete ad.flatPerUseCap; } if (prevEntryOps.includes(d)) mountedPrev = true; delete ad.flatPerUse; } }
        else if (ad.flatPerUseCap !== undefined) { const d = effects.find((e) => e.op === "damage" && e.flatPerUse !== undefined) ?? prevEntryOps.find((e) => e.op === "damage" && e.flatPerUse !== undefined); if (d !== undefined) { d.flatPerUseCap = ad.flatPerUseCap; if (prevEntryOps.includes(d)) mountedPrev = true; delete ad.flatPerUseCap; } }
        if (ad.flatSelfDefSumPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatSelfDefSumPct: ad.flatSelfDefSumPct, target: "opponent" }); delete ad.flatSelfDefSumPct; }
        if (ad.flatFoeDefPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatFoeDefPct: ad.flatFoeDefPct, target: "opponent" }); delete ad.flatFoeDefPct; }
        // pctPerSelfStage（"自身每处于1种能力提升则伤害提升20%"）→ dmg_boost params.perStage（dmgOutPctOf 原生支持）
        if (ad.pctPerSelfStage !== undefined) { effects.push({ op: "apply_status", name: "dmg_boost", target: "self", params: { perStage: ad.pctPerSelfStage } }); delete ad.pctPerSelfStage; }
        // powerMulPerUse 幻影："伤害提升N%，每次使用增加M%"与 ad.mul 同源（成长由 growStep 承载）——仅共存时消费；
        // 独立存在（"每次使用增加N%"）→ entry growStep 近似（叠用乘区→线性幅度，UNVERIFIED）
        if (ad.powerMulPerUse !== undefined) {
          if (ad.mul !== undefined) delete ad.powerMulPerUse;
          else { adGrowStep ??= ad.powerMulPerUse.numerator - 100; delete ad.powerMulPerUse; }
        }
        // mulChancePerUse/mulChanceUseCap（"每次使用几率增加N%，最高几率M%"）→ 条级 chanceGrow（魂印无 damage op 宿主，mulChance 已折算为条级 chance + dmg_boost）
        if (ad.mulChancePerUse !== undefined || ad.mulChanceUseCap !== undefined) {
          innerGrow = { ...(innerGrow ?? {}), ...(ad.mulChancePerUse !== undefined ? { add: ad.mulChancePerUse } : {}), ...(ad.mulChanceUseCap !== undefined ? { cap: ad.mulChanceUseCap } : {}), kind: "chance" };
          delete ad.mulChancePerUse; delete ad.mulChanceUseCap;
        }
        // flatFoeDefSumPct（"附加对手双防之和N%固伤"）→ damage op 原生字段（runtime damage.ts:386）
        if (ad.flatFoeDefSumPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatFoeDefSumPct: ad.flatFoeDefSumPct, target: "opponent" }); delete ad.flatFoeDefSumPct; }
        if (ad.flatMaxHpDiffPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatMaxHpDiffPct: ad.flatMaxHpDiffPct, target: "opponent" }); delete ad.flatMaxHpDiffPct; }
        // 动态固伤新族（"对手当前生命值N%"/"上回合承伤N%"/"当次威力N倍"/"双防段数×N"/"提升种数×N"）→ damage op 原生字段透传
        for (const fk of ["flatFoeCurPct", "flatPrevTurnTakenPct", "flatSelfLastDmgPct", "flatPowerMul", "flatDefStageMul", "flatStageUpCountMul", "flatBothStageUpCountMul", "flatFoeStageUpCountMul"]) {
          if (ad[fk] !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, [fk]: ad[fk], target: "opponent" }); delete ad[fk]; }
        }
        // flatPrevTakenPct（"受到等同于伤害值的固定伤害"——当回合已承伤等额反伤）→ damage op 原生字段
        if (ad.flatPrevTakenPct !== undefined) { effects.push({ op: "damage", kind: "fixed", power: 0, flatPrevTakenPct: ad.flatPrevTakenPct, target: "opponent" }); delete ad.flatPrevTakenPct; }
        // flatEcho（"附加等量固定伤害"/"相当于本次伤害"——出伤回响需宿主 damage op；无宿主则孤立无意义）
        if (ad.flatEcho !== undefined) { const d = effects.find((e) => e.op === "damage") ?? prevEntryOps.find((e) => e.op === "damage"); if (d !== undefined) { d.flatEcho = ad.flatEcho; delete ad.flatEcho; } }
        // scaleIf/mulIf（条件增伤）→ dmg_boost + 消费时门控参数（passCondGate 可判则永久窗）
        // 幻影门：heal/stage 已挂 op 级 mulIf/deltaMulIf 且本组无 damage op 时跳过（"恢复1/3，若P则效果翻倍"的翻倍已由 heal.mulIf 承载，dmg_boost 是幻影）
        const doubleHosted = effects.some((e) => e.mulIf !== undefined || e.deltaMulIf !== undefined) && !effects.some((e) => e.op === "damage");
        for (const k of ["scaleIf", "mulIf"]) {
          if (ad[k] !== undefined) {
            const si = ad[k]; const pct = Math.round((si.numerator * 100) / si.denominator) - 100;
            const gate = si.when !== undefined ? passCondGate(si.when, "dmg_boost") : {};
            // gate 不可判（如 not.prevApplied 的"未触发则"else 分支）→ 挂 op 级 if 守卫，不丢弃
            if (!doubleHosted && pct !== 0) effects.push({ op: "apply_status", name: "dmg_boost", target: "self", ...(gate === undefined && si.when !== undefined ? { if: si.when } : {}), params: { pct, ...(gate ?? {}) } });
            delete ad[k];
          }
        }
        if (Object.keys(ad).length === 0) delete flags.attachDamage;
      }
      // 招式级先制/必中窗 → 短回合 flag op（onEntry/onMoveUsed 语境近似 UNVERIFIED）
      if (flags.priority !== undefined) { effects.push({ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: flags.priority } }); delete flags.priority; }
      if (flags.priorityIf !== undefined && typeof flags.priorityIf === "object") { effects.push({ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: flags.priorityIf.add }, ...(flags.priorityIf.when !== undefined ? { if: flags.priorityIf.when } : {}) }); delete flags.priorityIf; }
      if (flags.accuracy === "always") { const hitCat = soulMustHitCat(gtext); effects.push(hitCat === undefined ? { op: "apply_status", name: "must_hit", target: "self", turns: 1 } : { op: "apply_status", name: "sure_hit", target: "self", turns: 1, params: { cat: hitCat } }); delete flags.accuracy; }
      // dynChance（"攻击有自身当前体力百分比的概率令对手AIL"——effects 层无法回写条级 → flags 透传，条目 chanceDyn 承接）
      if (flags.dynChance !== undefined) { bodyDyn = flags.dynChance; delete flags.dynChance; }
      // benchCtx 透出（"背包内每阵亡一只精灵，造成伤害提升10%"——pct 窗转 perBenchDead/Alive 计数乘算；本组无 op 时结转 pendingBenchCtx 挂下一组）
      if (flags.benchCtx !== undefined) { pendingBenchCtx = flags.benchCtx; delete flags.benchCtx; }
      if (pendingBenchCtx !== undefined && effects.length > 0) {
        const bc = pendingBenchCtx; const key = bc.dead ? "perBenchDead" : "perBenchAlive";
        let applied = false;
        for (const o of effects) {
          if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit/.test(o.name ?? "")) {
            const { pct, ...rest } = o.params; o.params = { ...rest, [key]: pct, ...(bc.per > 1 ? { perBenchEvery: bc.per } : {}) }; applied = true;
          }
          else if (o.op === "apply_status" && o.name === "shield" && o.params?.flat !== undefined) { o.params = { ...o.params, flatPerBench: o.params.flat * bc.per }; applied = true; }
        }
        if (applied) pendingBenchCtx = undefined;
      }
      // pendingHpStep 结转（"HP每降低10%，受到的伤害减少5%"——pct 窗转 perHpLostStep/perHpLostPct 已损体力步进乘算；只绑紧邻效果句——无 pct 宿主即清，防跨句误挂）
      if (pendingHpStep !== undefined && effects.length > 0) {
        let hpApplied = false;
        for (const o of effects) {
          if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken|heal_boost/.test(o.name ?? "")) {
            const { pct, ...rest } = o.params; o.params = { ...rest, perHpLostStep: pendingHpStep, perHpLostPct: pct }; hpApplied = true;
          }
        }
        pendingHpStep = undefined;
        if (!hpApplied) { unparsed.push({ clause: gtext, reason: "per-unit-scaling — HP-step host not pct-window (deferred)" }); continue; }
      } else if (pendingHpStep !== undefined && effects.length === 0) pendingHpStep = undefined; // 语境已消费于失败/空组——防跨句误挂
      // pendingAilTurn 结转（"自身每有1回合流血，当回合伤害提高15%"——pct 窗转 pctPerAilTurn 落地烘焙；只绑紧邻效果组）
      if (pendingAilTurn !== undefined && effects.length > 0) {
        let ailApplied = false;
        for (const o of effects) {
          if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken|heal_boost/.test(o.name ?? "")) {
            const { pct, ...rest } = o.params;
            o.pctPerAilTurn = { ail: pendingAilTurn.ail, per: pendingAilTurn.per, pct };
            o.params = rest;
            ailApplied = true;
          }
        }
        if (ailApplied) pendingAilTurn = undefined;
        else unparsed.push({ clause: gtext, reason: "ailment-turn scaling — pct-window host absent (deferred)" });
      }
      // pendingHpDiffCtx（"每与对手相差80点…提升40%"）/pendingShieldCtx（"双方每有5点护盾…提升1%"）——pct 窗转 perHpDiff/perShield 步进参数
      if (pendingHpDiffCtx !== undefined && effects.length > 0) {
        let hd = false;
        for (const o of effects) {
          if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken/.test(o.name ?? "")) {
            const { pct, ...rest } = o.params; o.params = { ...rest, perHpDiffEvery: pendingHpDiffCtx.per, perHpDiffPct: pct }; hd = true;
          }
        }
        if (hd) pendingHpDiffCtx = undefined;
        else unparsed.push({ clause: gtext, reason: "hp-diff scaling — pct-window host absent (deferred)" });
      }
      if (pendingShieldCtx !== undefined && effects.length > 0) {
        let sh = false;
        for (const o of effects) {
          if (o.op === "apply_status" && o.params?.pct !== undefined && /dmg_boost|dmg_taken|dmg_weaken|dodge|crit|drain|pct_taken/.test(o.name ?? "")) {
            const { pct, ...rest } = o.params; o.params = { ...rest, perShieldEvery: pendingShieldCtx.per, perShieldPct: pct, ...(pendingShieldCtx.who !== undefined ? { perShieldWho: pendingShieldCtx.who } : {}) }; sh = true;
          }
        }
        if (sh) pendingShieldCtx = undefined;
        else unparsed.push({ clause: gtext, reason: "shield-count scaling — pct-window host absent (deferred)" });
      }
      for (const k of Object.keys(flags)) unparsed.push({ clause: k === "attachDamage" && typeof flags.attachDamage === "object" ? `attachDamage:${Object.keys(flags.attachDamage).join("+")}` : `${k}`, reason: "move-flag" });
      if (effects.length === 0) { if (inner.length === 0 && pendingCondSrc !== gtext && !mountedPrev && pendingBenchCtx === undefined && pendingAilTurn === undefined && pendingHpDiffCtx === undefined && pendingShieldCtx === undefined && (!isNoiseFragment(gtext) || entries.length === 0)) unparsed.push({ clause: gtext, reason: "no-op" }); continue; } // pendingCond/pendingBenchCtx/缩放语境本组新设时语境已结转——不算孤儿
      if (hasMoveCtx(effects)) { unparsed.push({ clause: gtext, reason: "move-power-ref" }); continue; }
      // flatPerAlive：存活计数缩放（"己方每有一只精灵存活则恢复N点"——heal.flat→floor(alive/1)×flat）
      if (extra.flatPerAlive === true) for (const o of effects) { if (o.op === "heal" && o.flat !== undefined) { o.flatPerAlive = { per: 1, add: o.flat }; delete o.flat; } else if (o.op === "apply_status" && (o.name === "shield" || o.name === "ward") && typeof o.params?.flat === "number" && o.params.flatPerBench === undefined) { o.params.flatPerBench = o.params.flat; o.params.flat = 0; } }
      // 体首"下N回合"剥出 → turns 注入（inner TURNS_PRE 只对产 op 的路径生效，flags/转换 op 会丢回合）
      if (bodyTurns !== undefined) for (const o of effects) { if (o.op === "apply_status") o.turns = Math.max(o.turns ?? 0, bodyTurns); }
      // injectTurns：注入持续回合（"前N回合X"——窗口时长取内置时长与 N 的较大值，防欠应用）
      // count 窗 op 豁免（"若P则下次攻击X"——params.count 即生命周期，turns 会提前灭窗）
      if (extra.injectTurns !== undefined) for (const o of effects) { if (o.op === "apply_status" && o.params?.count === undefined) o.turns = Math.max(o.turns ?? 0, extra.injectTurns); }
      // opIf：注入 op 级守卫（"未受到攻击恢复N点"——已有 if 的以 and 复合）。
      // formula 只是分数载体，条件由宿主 damage/heal 各自携带；给它再挂一次会让同一条件
      // 在 IR 里出现两遍，且与 skill 侧的形态不一致（parser-golden 也有同款）。
      if (extra.opIf !== undefined) for (const o of effects) { if (o.op === "formula") continue; o.if = o.if !== undefined ? { and: [extra.opIf, o.if] } : extra.opIf; }
      // retarget：换入延迟目标（"下只出战精灵X"——ops 改挂 nextInFx 通道）
      if (extra.retarget !== undefined) for (const o of effects) { o.target = extra.retarget; }
      // opParams：growPer 只进会读 params 的状态 op。打到 damage 上没人读，装载会拒。
      if (extra.opParams !== undefined) for (const o of effects) {
        if (o.op !== "apply_status" && o.op !== "apply_effect") continue;
        o.params = { ...(o.params ?? {}), ...extra.opParams };
      }
      const { injectTurns: _it, opIf: _oi, flatPerAlive: _fpa, retarget: _rt, opParams: _op, dupActor: _da, guardDropped: _gd, prioV: _pv, useGrow: _ug, ...restExtra } = extra;
      // pendingCond：跨组暂存条件 → 沉入 op 级 if（"若P则沉入 ops"——单 op 条目与 guard 等价，多 op 保持逐 op 门控；已等值 if 不重复包裹）
      if (pendingCond !== undefined) {
        const pcJ = JSON.stringify(pendingCond);
        for (const o of effects) { o.if = o.if === undefined ? pendingCond : JSON.stringify(o.if) === pcJ ? o.if : { and: [pendingCond, o.if] }; }
        pendingCond = undefined; pendingCondSrc = undefined;
      }
      pendingEmpty = undefined;
      // innerGrow 分流：概率类尾句→chanceGrow；幅度类（效果/伤害/数值/无概率语境的裸"每次使用"）→growStep/growCap（magAcc 注入 op 幅度）
      const growFields = (() => {
        const base = adGrowStep !== undefined ? { growStep: adGrowStep, ...(adGrowCap !== undefined ? { growCap: adGrowCap } : {}) } : {};
        if (innerGrow === undefined) return base;
        const { add, cap, kind } = innerGrow;
        const hasChance = restExtra.chance !== undefined || effects.some((o) => o.chance !== undefined);
        if (kind === "chance" || (kind === "auto" && hasChance)) {
          // chanceGrow 只在条级 chance 判定上生效——op 级 chance 须同步提升为条级 chance，否则成长通道死挂
          if (restExtra.chance === undefined && pendingPromoteChance === undefined) {
            const hop = effects.find((o) => o.chance !== undefined);
            if (hop !== undefined) { pendingPromoteChance = hop.chance; for (const o of effects) if (o.chance === hop.chance) delete o.chance; }
          }
          return { ...base, chanceGrow: cap !== undefined ? { add, cap } : { add } };
        }
        return { growStep: base.growStep ?? add, ...(cap !== undefined ? { growCap: cap } : {}) };
      })();
      // "每使用N次X技能则…/每受到N次攻击则…" 重触发叠深：条目 growStep=首个 pct 幅值（growOp 每次触发把 magAcc 注入 pct——与"每次使用增加N%"同构）
      if (_ug === true && growFields.growStep === undefined) {
        const ph = effects.find((o) => o.op === "apply_status" && typeof o.params?.pct === "number");
        if (ph !== undefined) growFields.growStep = ph.params.pct;
      }
      // 折算时仍读 damage / 袋子上的家族键。条目落地前收成 rider，旧键不进已存储的 ops。
      // 效果翻倍的占位键不是这条伤害的倍率。上面没挂走就丢掉，不收成 rider。
      if (effDoubleFlag !== undefined) dropBagKey(flags, effDoubleFlag);
      liftDrainRiders(effects, flags, { lone: "drain" });
      const currentHitWindow = /(?:命中|击中)(?:后|时)/.test(gtext)
        && !/(?:下次|下一次|下回合|接下来|此后|之后|随后)/.test(`${gtext} ${body}`)
        && hook === "onMoveUsed"
        && bodyDyn === undefined
        && !effects.some((o) => o.op === "apply_status" && o.params?.chanceSelfMissingPct !== undefined)
        && effects.some((o) => o.op === "apply_status" && o.name === "dmg_boost")
        && /造成(?:的)?(?:攻击)?伤害(?:提升|提高|增加)\d+%/.test(`${gtext} ${body}`);
      const currentHitDrain = /(?:命中|击中)(?:后|时)/.test(gtext)
        && !/(?:下次|下一次|下回合|接下来|此后|之后|随后)/.test(`${gtext} ${body}`)
        && hook === "onMoveUsed"
        && effects.some((o) => o.op === "apply_status" && o.name === "drain_atk")
        && /造成(?:的)?(?:攻击)?伤害(?:的)?\d+%恢复/.test(`${gtext} ${body}`);
      if (currentHitWindow || currentHitDrain) {
        quarantineGroup(gtext, "post-hit modifier — current damage/heal has already resolved before this hook (deferred)");
        continue;
      }
      const maxHpAbsorb = maxHpAbsorbHpDelta(effects, `${gtext} ${body}`, growTail !== undefined || growFields.growStep !== undefined || growFields.growCap !== undefined);
      if (maxHpAbsorb.found) {
        effects.splice(0, effects.length, ...maxHpAbsorb.ops);
        if (!maxHpAbsorb.converted) {
          delete growFields.growStep;
          delete growFields.growCap;
          growTail = undefined;
          unparsed.push({ clause: gtext, reason: "max-HP drain — damage/heal amount cannot be tied to actual HP dealt (deferred)" });
        }
      }
      if (effects.length === 0 && maxHpAbsorb.found) continue;
      const newEntry = { hook, ...restExtra, ...growFields, ...(localAtCap !== undefined ? { growStep: localAtCap.step, growCap: localAtCap.cap } : {}), ...(pendingPromoteChance !== undefined ? { chance: pendingPromoteChance } : {}), ...(bossGate ? { bossGate: true } : {}), ...(bodyDyn !== undefined ? { chanceDyn: bodyDyn } : {}), ops: effects };
      if (plainUseCandidate && hook === "onMoveUsed" && restExtra.actor === "foe"
        && effects.some((o) => o.op === "apply_status" && o.name === "dmg_taken_down")
        && !/(?:下[一1]?次|下回合|下一回合)/.test(gtext)) {
        quarantineGroup(gtext, "incoming attack modifier — conditional current-hit window unmodeled (deferred)");
        continue;
      }
      const plainUseHeadIsImmediate = plainUseCandidate
        && !/技能生效后触发/.test(String(text))
        && plainUseMatchedHead !== ""
        && /(?:使用|释放)/.test(plainUseMatchedHead)
        && !/后\s*$/.test(plainUseMatchedHead)
        && !/^若/.test(plainUseMatchedHead)
        && !/(?:首次|第一次|首个|第\d+|下次|下一次|下回合|之后|此前|先选择|选择技能)/.test(plainUseMatchedHead);
      const plainUseActor = restExtra.actor ?? "self";
      entries.push(newEntry);
      if (plainUseCandidate && plainUseHeadIsImmediate && hook === "onMoveUsed" && unparsed.length === groupUnparsedStart) {
        plainUseMigrations.push({
          entry: newEntry,
          clause: gtext,
          source: `${gtext} ${body}`,
          head: plainUseMatchedHead,
          actor: plainUseActor,
          cat: restExtra.cat,
          nestedChanged: plainUseNestedChanged,
          inherited,
          linkedContinuation,
          maxHpAbsorb: maxHpAbsorb.found && maxHpAbsorb.converted,
        });
      }
      if (!plainUseCandidate && maxHpAbsorb.converted && hook === "onMoveUsed" && !/(?:命中|击中)/.test(gtext)) {
        unparsed.push({ clause: gtext, reason: "move-use scope — onMoveUsed observes successful hits only; MISS is not modeled (deferred)" });
      }
      if (localAtCap !== undefined) { pendingAtCap = newEntry; localAtCap = undefined; }
      // pendingAtCap：本组 ops 是上组"当…叠加至N%时"的达顶负载——归入 atCapOps 而非独立条目（"当效果叠加至75%时，重置此效果，自身所有能力值提升50点"）
      if (pendingAtCap !== undefined && pendingAtCap !== newEntry) {
        entries.pop();
        pendingAtCap.atCapOps = effects;
        pendingAtCap = undefined;
        segParsed = true;
        continue;
      }
      if (pendingAtCap === newEntry) pendingAtCap = newEntry; // 自身达顶组——payload 语境保留供下组消费
      // inner 收的"不相同时X"else 支路：克隆本条钩子+守卫取反（"使用技能类型与上次相同时先制+1，不相同时恢复…"——catStreak 互斥分支）
      for (const ep of elsePending) { if (ep.guard === undefined) continue; entries.push({ hook: newEntry.hook, ...(newEntry.actor !== undefined ? { actor: newEntry.actor } : {}), guard: ep.guard, ...(newEntry.bossGate === true ? { bossGate: true } : {}), ops: ep.ops }); }
      elsePending.length = 0;
      if (_da === true && !inherited && newEntry.actor === "self") entries.push({ ...newEntry, actor: "foe" }); // "双方任意一方"——双侧 hook 各一条
      // 升级为互斥分支：前一同钩条目的守卫并入 not（"恢复1/4，低于1/2时转变为恢复1/3"——base 分支排除升级条件）
      if (isUpgrade && entries.length >= 2) {
        const prev = entries[entries.length - 2];
        const excl = newEntry.guard ?? newEntry.ops?.find((o) => o.if !== undefined)?.if;
        if (prev.hook === hook && excl !== undefined) {
          prev.guard = prev.guard !== undefined ? { and: [prev.guard, { not: excl }] } : { not: excl };
        } else if (excl !== undefined && /^(?:onDamageDealt|onDamaged|onMoveUsed|onKO)$/.test(prev.hook)) {
          // 事件钩互斥："伤害超过300时令双方流血，若对手处于流血状态则改为全属性+1"——改为支路继承前条事件钩与守卫，前条并入 not
          newEntry.hook = prev.hook;
          for (const k of ["actor", "cat", "victim"]) if (prev[k] !== undefined && newEntry[k] === undefined) newEntry[k] = prev[k];
          if (prev.guard !== undefined) newEntry.guard = newEntry.guard !== undefined ? { and: [prev.guard, newEntry.guard] } : prev.guard;
          prev.guard = prev.guard !== undefined ? { and: [prev.guard, { not: excl }] } : { not: excl };
        }
      }
      segParsed = true;
    }
    if (rewindAwait !== undefined) {
      if (entries.some((e) => e.op === "endure")) segParsed = true;
      else unparsed.push({ clause: rewindAwait, reason: "snapshot rewind belongs to endure; no endure on this mark" });
    }
    if (pendingCond !== undefined) unparsed.push({ clause: pendingCondSrc ?? JSON.stringify(pendingCond), reason: "cond-orphan" });
    if (pendingEmpty !== undefined) danglingEmpty.push(pendingEmpty);
    if (clauseCap !== undefined) for (let i = clauseEntryStart; i < entries.length; i++) for (const o of entries[i].ops ?? []) if (o.op === "heal" && o.cap === undefined) o.cap = clauseCap;
    if (clauseCapFrac !== undefined) for (let i = clauseEntryStart; i < entries.length; i++) for (const o of entries[i].ops ?? []) if (o.op === "heal" && o.capFracN === undefined) { o.capFracN = clauseCapFrac.n; o.capFracD = clauseCapFrac.d; }
    if (growTail !== undefined) {
      if (guardQuarantine) { if (!isNoiseFragment(gm[0].trim()) || entries.length === 0) unparsed.push({ clause: gm[0].trim(), reason: guardQuarantineReason }); }
      else if (!attachGrow()) unparsed.push({ clause: gm[0].trim(), reason: "grow-tail-orphan" });
    }
    if (segParsed) clausesParsed++;
    } finally {
      const added = unparsed.length - unparsedAtClause;
      if (segParsed) fragmentsOnParsed += added;
      else fragmentsOnResidual += added;
      fragmentCursor = unparsed.length;
    }

  }
  // 空体裸触发兜底：设置点之后无任何条目产出才算孤儿（hook 已继承给后续子句则静默）
  for (const d of danglingEmpty) if (entries.length === d.atEntries) unparsed.push({ clause: d.text, reason: "empty-body" });
  fragmentsOutside += unparsed.length - fragmentCursor;
  // next_chance 盖戳：params.ei=产出条目索引（"未触发则下次触发几率提升N%"——单次窗限定到所属条目，多触发魂印不串扰）
  for (let ei = 0; ei < entries.length; ei++) {
    for (const o of [...(entries[ei].ops ?? []), ...(entries[ei].elseOps ?? [])]) {
      if (o.op === "apply_status" && o.name === "next_chance") o.params = { ...(o.params ?? {}), ei };
    }
  }
  // 后组可能把家族键写回已经落地的 damage。出口再收一次，旧键不进已存储的 ops。
  // 主语和概率也在这一处收成 guard / chance，不在每条规则里各写一份。
  for (const e of entries) {
    if (Array.isArray(e?.ops)) liftDrainRiders(e.ops, undefined, { lone: "drain" });
    if (Array.isArray(e?.elseOps)) liftDrainRiders(e.elseOps, undefined, { lone: "drain" });
    if (Array.isArray(e?.atCapOps)) liftDrainRiders(e.atCapOps, undefined, { lone: "drain" });
    liftSoulEntry(e);
    liftSoulGrow(e);
    liftSoulPrio(e);
  }
  // Convert only fully assembled, fully lifted entries. This preserves grow
  // tails, mutually exclusive branches and later event-scope corrections.
  for (const candidate of plainUseMigrations) {
    const index = entries.indexOf(candidate.entry);
    if (index < 0) continue; // e.g. the entry was absorbed into an at-cap host
    const entry = candidate.entry;
    const cat = candidate.cat;
    const reactCat = cat === undefined ? undefined
      : cat === 1 || cat === 2 || cat === 3 ? cat
        : Array.isArray(cat) && cat.length === 2 && cat[0] === 2 && cat[1] === 3 ? 4
          : null;
    const ops = entry.ops ?? [];
    const growIndexes = ops.flatMap((op, opIndex) => op.op === "grow" ? [opIndex] : []);
    const magnitudeGrowPayload = growIndexes.length === 1
      && growIndexes[0] === 0
      && ops[0]?.of === "magnitude"
      && typeof ops[0]?.step === "number"
      && (ops[0]?.magCap === undefined || typeof ops[0].magCap === "number")
      && ops[0]?.payload === undefined
      && ops[0]?.if === undefined
      && ops[0]?.chance === undefined
      && ops[0]?.chanceMulIf === undefined
      && ops[0]?.chanceSetIf === undefined
      && ops[0]?.chanceGrow === undefined
      && ops[0]?.nullifyOnly === undefined
      && ops.length === 2
      && ops[1]?.op === "hp_delta"
      && candidate.maxHpAbsorb;
    const currentFractionDamagePayload = ops.length === 3
      && ops[0]?.op === "damage"
      && ops[0]?.kind === "percent"
      && ops[0]?.power === 1
      && ops[0]?.target === "opponent"
      && ops[1]?.op === "formula"
      && ops[1]?.of === "percentBase"
      && ops[1]?.value === "current"
      && ops[2]?.op === "formula"
      && ops[2]?.of === "frac"
      && typeof ops[2]?.value === "object"
      && ops[2]?.value !== null
      && typeof ops[2]?.value.numerator === "number"
      && typeof ops[2]?.value.denominator === "number";
    const singleAtomPayload = ops.length === 1 && ops[0]?.op !== "formula" && ops[0]?.op !== "grow";
    const hasChance = ops.some((op) => op.chance !== undefined || op.flatChance !== undefined);
    const hasEmbeddedMagnitudeTail = ops.some((op) => op.op === "apply_status"
      && (op.params?.growStep !== undefined || op.params?.growCap !== undefined));
    const expectedGuard = { actor: candidate.actor, ...(cat !== undefined ? { cat } : {}) };
    const actualGuard = entry.guard;
    const actorCatGuard = actualGuard === undefined
      || (Object.keys(actualGuard).every((key) => key === "actor" || key === "cat")
        && actualGuard.actor === candidate.actor
        && JSON.stringify(actualGuard.cat) === JSON.stringify(expectedGuard.cat));
    const fieldsSafe = Object.keys(entry).every((key) => ["hook", "ops", "actor", "cat", "guard"].includes(key));
    const followupTiming = /(?:下(?:[0-9０-９一二两三四五六七八九十百]+)?(?:个)?(?:回合|次|招|击|只)|下一次|下个|接下来|下回合|下一回合|之后|此后|随后|本次在场|在场首次)/.test(candidate.source);
    const safe = candidate.head !== ""
      && /(?:使用|释放)/.test(candidate.head)
      && !/后\s*$/.test(candidate.head)
      && !/(?:首次|第一次|首个|第\d+|下次|下一次|下回合|之后|此前|先选择|选择技能)/.test(candidate.head)
      && !followupTiming
      && entry.hook === "onMoveUsed"
      && !candidate.nestedChanged
      && !candidate.inherited
      && !candidate.linkedContinuation
      && actorCatGuard
      && !entry.bossGate
      && !entry.limitBattle
      && fieldsSafe
      && (cat === undefined || reactCat !== null)
      && (candidate.actor === "self" || candidate.actor === "foe")
      && !entry.chance && !entry.chanceGrow && !entry.chanceDyn
      && !entry.atCapOps && !entry.elseOps
      && !ops.some((op) => op.if !== undefined || op.elseOps !== undefined || op.atCapOps !== undefined)
      && (!hasChance || ops.length === 1)
      && !hasEmbeddedMagnitudeTail
      && (growIndexes.length === 0 || magnitudeGrowPayload)
      && (singleAtomPayload || magnitudeGrowPayload || currentFractionDamagePayload);
    if (safe) {
      const params = { trigger: candidate.actor === "self" ? 11 : 3, ...(reactCat !== undefined ? { cat: reactCat } : {}) };
      const react = { op: "apply_status", name: "react", target: "self", params, stack: true, payload: ops };
      entries[index] = { hook: "onBattleStart", ops: [react] };
      continue;
    }
    const existing = unparsed.some((u) => u.clause === candidate.clause && /move-use scope/.test(u.reason ?? ""));
    if (!existing) {
      const reason = entry.bossGate
        ? "move-use scope — boss gate cannot persist across the react window (deferred)"
        : followupTiming
          ? "move-use scope — delayed or later-action effect is outside this immediate react window (deferred)"
          : "move-use scope — additional guard, limit, linked trigger, or payload is not supported by the plain-use react path (deferred)";
      unparsed.push({ clause: candidate.clause, reason });
      fragmentsOnParsed++;
    }
  }
  return { entries, unparsed, bossGate: anyBossGate || entries.some((e) => e.bossGate === true), clauseTotal, clausesParsed, fragmentsOnParsed, fragmentsOnResidual, fragmentsOutside };
}

export function run(catalogPath = SRC, outDir = OUT_DIR) {
  const cat = JSON.parse(readFileSync(catalogPath, "utf8"));
  const creatures = Object.values(cat.creatures);
  const report = {
    generated: new Date().toISOString().slice(0, 10),
    pets: 0, petsWithMark: 0, fullyParsed: 0, partialParsed: 0,
    clauses: 0, clausesParsed: 0, clauseCoverage: "0%", markCoverage: "0%",
    // clauseCoverage = clausesParsed/clauses。一条子句（；。切开且未当脏文本丢弃）产出 ≥1 条 entry 即计入分子。
    // residualClauses = 分母 − 分子。unparsedFragments 是 unparsed 数组条数，含已解析子句内部的残留，不参与 clauseCoverage。
    residualClauses: 0, unparsedFragments: 0,
    fragmentsOnParsedClauses: 0, fragmentsOnResidualClauses: 0, fragmentsOutsideClauses: 0,
    topUnparsed: [], marks: {},
  };
  const unparsedFreq = new Map();
  for (const c of creatures) {
    report.pets++;
    const sm = c.soulMark;
    const text = (sm?.text ?? "").trim();
    if (!text) continue;
    report.petsWithMark++;
    const { entries, unparsed, clauseTotal, clausesParsed, fragmentsOnParsed, fragmentsOnResidual, fragmentsOutside } = parseSoulmarkText(text, c.name);
    report.clauses += clauseTotal;
    report.clausesParsed += clausesParsed;
    report.fragmentsOnParsedClauses += fragmentsOnParsed;
    report.fragmentsOnResidualClauses += fragmentsOnResidual;
    report.fragmentsOutsideClauses += fragmentsOutside;
    if (unparsed.length === 0) report.fullyParsed++;
    else if (entries.length > 0) report.partialParsed++;
    report.marks[c.petNo ?? c.id] = { pet: c.name, bossGate: entries.some((e) => e.bossGate === true), entries, ...(unparsed.length ? { unparsed } : {}) };
    for (const u of unparsed) {
      const norm = String(u.clause ?? "").replace(/\d+/g, "#").replace(/[一二两三四五六七八九十]/g, "#");
      const cur = unparsedFreq.get(norm) ?? { count: 0, reason: undefined };
      cur.count++;
      if (cur.reason === undefined && u.reason !== undefined) cur.reason = u.reason;
      unparsedFreq.set(norm, cur);
    }
  }
  report.topUnparsed = [...unparsedFreq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 200).map(([pattern, v]) => ({ pattern, count: v.count, ...(v.reason !== undefined ? { reason: v.reason } : {}) }));
  report.residualClauses = report.clauses - report.clausesParsed;
  report.unparsedFragments = report.fragmentsOnParsedClauses + report.fragmentsOnResidualClauses + report.fragmentsOutsideClauses;
  report.clauseCoverage = `${((report.clausesParsed / Math.max(1, report.clauses)) * 100).toFixed(1)}%`;
  report.markCoverage = `${((report.fullyParsed / Math.max(1, report.petsWithMark)) * 100).toFixed(1)}%`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "_soulmark-coverage.json"), JSON.stringify(report, null, 2));
  console.log(`soulmarks=${report.petsWithMark} fully=${report.fullyParsed} partial=${report.partialParsed} clauses=${report.clausesParsed}/${report.clauses} (${report.clauseCoverage}) residualClauses=${report.residualClauses} unparsedFragments=${report.unparsedFragments} (onParsed=${report.fragmentsOnParsedClauses} onResidual=${report.fragmentsOnResidualClauses} outside=${report.fragmentsOutsideClauses})`);
  return report;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) run();
