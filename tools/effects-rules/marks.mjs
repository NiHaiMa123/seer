// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, ALL_STATS } from "./lex.mjs";
import { condOf } from "../effects-parse.mjs";

export const rules = [

  // ===== S4 印记族：可数层数标记（apply_mark/consume_mark；unit/slot/field 三挂载位）=====
  // 槽位散布："随机为对手任意技能散布N枚X印记"——每层独立随机落槽（槽满丢弃，UNVERIFIED）
  { id: "marks-01", re: new RegExp(`^(?:100%的?(?:几率|概率)?)?随机为(?:对手|对方|敌方)任意技能散布${NUM}枚(.{1,8}?)$|^为(?:对手|对方|敌方)任意技能散布${NUM}枚(.{1,8}?)$|^散布${NUM}枚(.{1,8}?印记)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2] ?? m[4] ?? m[6], at: "slot", pick: "randomMove", count: num(m[1] ?? m[3] ?? m[5]), target: "opponent" }] }) },
  // 层数门槛条件散布："若对手致命裂痕≥N层则额外散布M枚X"
  { id: "marks-02", re: new RegExp(`^若(?:对手|对方|敌方)(?:当前精灵)?(.{1,8}?(?:印记|裂痕))[≥＞=]+${NUM}层则(?:额外)?(?:为(?:对手|对方)任意技能)?散布${NUM}枚(.{1,8}?)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[4], at: "slot", pick: "randomMove", count: num(m[3]), target: "opponent", if: { markCountAtLeast: { mark: m[1], n: num(m[2]), on: "foe" } } }] }) },
  // 单位印记："为对手当前精灵附加N层X" / "为对手下只出战精灵附加N层X" / "自身获得N层X"
  { id: "marks-03", re: new RegExp(`^(?:为|令|给)(?:对手|对方|敌方)下只(?:出战|登场)精灵附加${NUM}层(.{1,8}?)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2], count: num(m[1]), target: "nextFoe" }] }) },
  { id: "marks-04", re: new RegExp(`^(?:为|令|给)(?:对手|对方|敌方)(?:当前精灵)?附加${NUM}层(.{1,8}?)$|^(?:对手|对方|敌方)附加${NUM}层(.{1,8}?印记)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2] ?? m[4], count: num(m[1] ?? m[3]), target: "opponent" }] }) },
  // 裸印记名："辛之印记"/"获得X印记"（独立残段 → unit 印记近似，UNVERIFIED）
  { id: "marks-05", re: /^(.{1,6}之印记)$|^获得(.{1,6}印记)$/, go: (m) => ({ effects: [{ op: "apply_mark", mark: m[1] ?? m[2], target: "self" }] }) },
  // "获得N分X音"——音符系印记计数（"获得1分强音"/"获得1分1332音"；分=计数单位）
  { id: "marks-05b", re: new RegExp(`^获得${NUM}分([一-龥·\\d]{1,10}?音)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2], count: num(m[1]), target: "self" }] }) },
  // "触发<名>：该技能PP值归0"——具名印记施加+当次技能PP清零（"若对手不处于记忆破碎触发记忆破碎：该技能PP值归0"——：体为印记声明的即时效果）
  { id: "marks-06", re: /^触发([一-龥·]{2,8})：该技能PP值归0$/, go: (m) => ({ effects: [{ op: "apply_mark", mark: m[1], target: "opponent" }, { op: "pp_delta", zero: true, target: "opponent", scope: "current" }] }) },
  { id: "marks-07", re: new RegExp(`^(?:为|令|给)自身附加${NUM}层(.{1,8}?)$|^自身获得${NUM}层(.{1,8}?印记)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2] ?? m[4], count: num(m[1] ?? m[3]), target: "self" }] }) },
  // 裸命名印记："为对手精灵附加痴愚"/"附加痴愚"（count:1；已知状态/护盾/数字由前置规则先匹配）
  { id: "marks-08", re: /^(?:为|给|令)(?:对手|对方|敌方|自身|自己|己方)(?:精灵|场上精灵)?附加([一-龥]{2,8})(?:印记|标记|层数)?$|^附加([一-龥]{2,8})印记$/, go: (m) => { const mk = m[1] ?? m[2]; if (/护盾|护罩|异常|伤害|体力|回合|效果|状态|固定|真实|百分比|\d/.test(mk)) return undefined; return { effects: [{ op: "apply_mark", mark: mk, count: 1, target: /自身|自己|己方/.test(m[0].slice(0, 6)) ? "self" : "opponent" }] }; } },
  // 场地印记："为己方场上附加N柄X" / "场上附加N回合X印记"
  { id: "marks-09", re: new RegExp(`^(?:为|令|给)己方场上附加${NUM}(?:柄|个|层)(.{1,8}?)$|^附加${NUM}柄(.{1,8}?)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[2] ?? m[4], at: "field", count: num(m[1] ?? m[3]), target: "self" }] }) },
  { id: "marks-10", re: new RegExp(`^(?:为|令|给)(己方|对方|对手)(?:场上)?附加${NUM}回合(.{1,10}?)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[3], at: "field", turns: num(m[2]), target: m[1] === "己方" ? "self" : "opponent" }] }) },
  // "为己方下N回合战斗附加X印记"（下N回合战斗 = field 时限窗）
  { id: "marks-11", re: new RegExp(`^(?:为|给|令)(己方|对方|对手)下?${NUM}回合(?:战斗)?(?:中|内)?附加?(.{1,10}?)$`), go: (m) => ({ effects: [{ op: "apply_mark", mark: m[3], at: "field", turns: num(m[2]), target: m[1] === "己方" ? "self" : "opponent" }] }) },
  // 层数缩放真伤/固伤："对手每存在1层X则附加N点真实伤害"
  { id: "marks-12", re: new RegExp(`^(?:对手|对方|敌方)?每存在${NUM}层(.{1,8}?(?:印记|裂痕))则?(?:技能)?附加${NUM}点(真实|固定|百分比)?伤害$`), go: (m) => ({ effects: [{ op: "damage", kind: m[4] === "真实" ? "true" : "fixed", power: 0, flatPerMark: { mark: m[2], add: num(m[3]), on: "foe", ...(num(m[1]) > 1 ? { per: num(m[1]) } : {}) }, target: "opponent", if: { markCountAtLeast: { mark: m[2], n: 1, on: "foe" } } }] }) },
  // 层数概率加成："对手每存在1层X则几率提升N%"——修饰招式 mulChance 的有效概率
  { id: "marks-13", re: new RegExp(`^(?:对手|对方|敌方)?每存在${NUM}层(.{1,8}?(?:印记|裂痕))则几率提升${NUM}%$`), go: (m) => ({ attachDamage: { mulChancePerMark: { mark: m[2], add: num(m[3]), on: "foe", ...(num(m[1]) > 1 ? { per: num(m[1]) } : {}) } } }) },
  // 层数次数盾："对手每存在1层处决印记自身免疫1次受到的异常状态/能力下降"
  { id: "marks-14", re: new RegExp(`^(?:对手|对方|敌方)?每存在${NUM}层(.{1,8}?(?:印记|裂痕))则?自身免疫1次受到的?(异常状态|能力下降状态?)$`), go: (m) => ({ effects: [{ op: "apply_status", name: m[3].includes("异常") ? "immune_status" : "immune_degrade", target: "self", countPerMark: { mark: m[2], on: "foe", ...(num(m[1]) > 1 ? { per: num(m[1]) } : {}) }, if: { markCountAtLeast: { mark: m[2], n: 1, on: "foe" } } }] }) },
  // 场地种类数缩放："场上每有1种五行印记，自身造成的攻击伤害提升25%"
  { id: "marks-15", re: new RegExp(`^(?:场上)?每有1种(.{1,8}?)(?:，|,)?自身造成的攻击伤害提升${NUM}%$|^双方场上的(.{1,8}?)每.{0,4}自身攻击伤害提升${NUM}%$`), go: (m) => ({ attachDamage: { mulPerMark: { add: num(m[2] ?? m[4]), at: "field", kinds: true, on: "both" } } }) },
  // 印记条件强化翻倍："全属性+1，对手存在X印记则强化效果翻倍"
  { id: "marks-16", re: new RegExp(`^全属性\\+${NUM}[，,](?:对手|对方|敌方)存在(.{1,8}?)则强化效果翻倍$`), go: (m) => ({ effects: ALL_STATS.map((st) => ({ op: "apply_stat_stage", stat: st, delta: num(m[1]), target: "self", deltaMulIf: { when: { markCountAtLeast: { mark: m[2], n: 1, on: "foe" } }, numerator: 2, denominator: 1 } })) }) },
  // 消耗印记："消耗N柄圣剑"（场地）/ "解放自身持有的全部龙鳞"（单位，*后缀族匹配）
  { id: "marks-17", re: new RegExp(`^消耗${NUM}柄(.{1,8}?)$`), go: (m) => ({ effects: [{ op: "consume_mark", mark: m[2], at: "field", count: num(m[1]), target: "self" }] }) },
  { id: "marks-18", re: new RegExp(`^解放(?:自身|自己)(?:当前)?(?:持有的)?全部(.{0,8}?鳞|.{0,8}?印记)$|^解放全部(.{1,8}?)$`), go: (m) => ({ effects: [{ op: "consume_mark", mark: `*${m[1] ?? m[2] ?? ""}`, at: "unit", target: "self" }] }) },
  // 印记存在条件（泛化尾门）："对手存在X印记则Y" 由 condOf 吊装；"则强化效果翻倍" 接 attachAll.stageIf
  { id: "marks-19", re: /^(对手|对方|敌方)存在(.{1,10}?)则强化效果翻倍$/, go: (m) => { const c = condOf(`${m[1]}存在${m[2]}`); return c !== undefined ? { attachAll: { stageIf: c } } : { unparsedReason: `stageIf mark-cond unparsed: ${m[2]}` }; } },
  // 未量化的层数缩放尾句——记显式留档而非静默
  { id: "marks-20", re: /每存在\d+层|每有\d+层|每存在1层|每有1层/, go: () => ({ unparsedReason: "per-mark scaling — unquantified target (UNVERIFIED)" }) },
  // ===== r4a：「下(一)?N次」单次窗——后文（marks-21 之后）已有现成 op 的形态 =====
  // 每条 go() 从被 marks-21 整段留档的句子上剥掉「下N次」窗头，余部（不含窗头）交给本句内
  // **逐字复制**的下游规则正则判定；不复制下游 op 定义，避免与别的家族形成反向依赖。
  // 命中计数在原子的 m[1]（窗头里那个 NUM 的捕获组），余部在 m[2]，余部里的数字在 m[3]。
  // 只收有数字的窗头（下1次/下一次/下2次/下N次）：余部必须自带下游规则认得的时点词
  // （"技能…先制"/"攻击命中时"/"攻击技能…"），裸谓词（"造成的伤害提高N%"/"受到…伤害减少N%"）
  // 才补「攻击」——与 heal-105/e31-cb-01、e53-red-04 同形。「下次X」裸形仍归 marks-21。
  // 先制窗："下N次(自身)?(使用)?(攻击|所有)?技能(先制|先手)±M" → prio_count{add,count}（e32-prio-02 同形）
  { id: "r4a-next-prio-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:自身|自己)?(?:使用)?(?:攻击|所有)?技能(?:先制|先手)([+-])([0-9]+|一|二|两|三|四|五|六|七|八|九|十))$`), go: (m) => ({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: (m[3] === "-" ? -1 : 1) * num(m[4]), count: num(m[1] ?? "1") } }] }) },
  // "下N次攻击(技能)?(时)?无视(对手)?(攻击)?免疫(效果|状态)?" → pierce{count}（e32-pi-01 / e36-35 同形）
  { id: "r4a-next-pierce-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:自身|自己)?(?:使用)?攻击(?:技能)?(?:时)?无视(?:对手(?:的)?)?(?:攻击)?免疫(?:效果|状态)?)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pierce", target: "self", params: { count: num(m[1] ?? "1") } }] }) },
  // "下N次攻击命中时消耗(自身|自己)?所使用(的)?攻击技能的全部PP值" → pp_consume_hit{count}（e34-ppcon-01 同形）
  { id: "r4a-next-ppcon-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:自身|自己)?攻击命中时消耗(?:自身|自己)?所使用(?:的)?攻击技能的全部PP值)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "pp_consume_hit", target: "self", params: { count: num(m[1] ?? "1") } }] }) },
  // "下N次(自身)?(造成的)?伤害(提升|提高|增加)K%" → dmg_boost{pct,count}（e31-cb-01 同形）
  { id: "r4a-next-dmgboost-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:自身|自己)?(?:造成的?)?(?:攻击)?伤害(?:提升|提高|增加)([0-9]+)%)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: num(m[3]), count: num(m[1] ?? "1") } }] }) },
  // "下N次(自身)?受到(的)?(攻击)?伤害减少K%" → dmg_taken_down{pct,count}（e9-tk-03 / e53-red-04 同形）
  { id: "r4a-next-taken-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:自身|自己)?受到?的?(?:攻击)?伤害减少([0-9]+)%)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: num(m[3]), count: num(m[1] ?? "1") } }] }) },
  // "下N次(攻击|攻击技能)(必定|必然)?打出偶数(攻击)?伤害" → even_dmg{count}（e40-10 同形）
  { id: "r4a-next-even-01", re: new RegExp(`^(?:下(?:${NUM}|一)次)((?:攻击|攻击技能)(?:必定|必然)?打出偶数(?:攻击)?伤害)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "even_dmg", target: "self", params: { count: num(m[1] ?? "1") } }] }) },
  // "下次X"其余形态——单次窗口未覆盖者仍显式留档（须在全部下次具体规则之后）
  // 「技能无效」由 batch-e35 的 e35-null15 处理（trigger 19），这里排除掉别抢
  { id: "marks-21", re: new RegExp(`^下(?:次|${NUM}次)(?!受|对手|对方|敌方|技能无效)`), go: () => ({ unparsedReason: "next-apply window — single-use mounting not modeled (deferred)" }) },
];
