// w12：其余技能整句（语意清楚、现在仍是 no-rule、且不属于 w01–w10 那些类）。
// 只补词形，不新增 op / params 键 / 结算分支；每条都在 tests/battle-core/parser/add-effect-w12.test.ts 有断言。
// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。
import { NUM, num, frac, TYPE_RE, STATS } from "./lex.mjs";

export const rules = [
  // ── 连用威力：既有 deferred-01 只认「增加/提升/提高/加」，语序/百分形缺口 ──
  // 试过补「连续使用每次威力+20，最多60」（格维恩/狂火天裂击）一类「+N」写法：
  // commaRaw 会把「最多60 / 最高+120」切成独立 part，整句规则够不着上限段，故不做。
  // 宿主句 阿苏亚/狂战刃「每次使用威力增加10，最多增加40」（deferred-01 的上限段只认「最高」，e40-05d 的步进段只认「连用」）。
  { id: "w12-pw-most-01",
    re: new RegExp(`^每次使用威力(?:增加|提升|提高|加)${NUM}(?:点)?[,，]?最多(?:增加|提升|提高|为|至|到)?${NUM}(?:点)?(?:威力)?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), useCap: num(m[2]) } }) },
  // 宿主句 哈尼卡/能量球「连续使用威力每次增加20，最高威力60」、芙拉萝儿/炎舞阵「连续使用威力增加20，最高120」
  // ——「威力」在「每次」之前，e53-dmg-03 的槽位对不上。
  { id: "w12-pw-order-01",
    re: new RegExp(`^连续使用威力(?:每次)?(?:增加|提升|提高|加)${NUM}(?:点)?(?:威力)?[,，]?(?:最[多高](?:威力)?(?:增加|提升|为|至|到)?${NUM}(?:点)?(?:威力)?)?$`),
    go: (m) => ({ attachDamage: { powerPerUse: num(m[1]), ...(m[2] !== undefined ? { useCap: num(m[2]) } : {}) } }) },
  // 宿主句 涂蝶/陶醉「连续使用时威力提升100%，最高提升400%」——百分形（e40-15 的步进段不收「时」）。
  { id: "w12-pw-pct-01",
    re: new RegExp(`^连续使用时威力(?:提升|提高|增加)${NUM}%[,，]?最高(?:提升|提高|增加|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachDamage: { powerMulPerUse: { numerator: 100 + num(m[1]), denominator: 100 } }, attachAll: { capTail: { value: num(m[2]), unit: "%", src: m[0] } } }) },

  // ── 连用致命率：既有 e40-17 要求「致命」后带「几率/概率/率」 ──
  // 宿主句 圣魂奥斯卡/灵光分裂斩「每次攻击提升10%致命几率，最高提升40」（尾段无「%」）。
  { id: "w12-crit-use-01",
    re: new RegExp(`^每次(?:攻击|使用)(?:提升|提高|增加)${NUM}%的?致命(?:一击)?(?:几率|概率|率)?[,，]?最高(?:提升|提高|为|至|到)?${NUM}%?$`),
    go: (m) => ({ attachDamage: { critPerUsePct: num(m[1]), critPerUseCap: num(m[2]) } }) },
  // 裸分数致命（"3/16概率暴击"）——e53-v23-06 只收「致命」，不收「暴击」；
  // 带「率/几率」的形由 e53-v23-07（"暴击率2/16"）与 e48-18 收，本条的「概率」二字在分数之后，不与之相撞。
  { id: "w12-crit-frac-01",
    re: new RegExp(`^${NUM}\s*/\s*${NUM}(?:的)?(?:几率|概率)暴击$`),
    go: (m) => ({ attachDamage: { critChanceFrac: { numerator: num(m[1]), denominator: num(m[2]) } } }) },

  // ── 无视对手速度的「及/和」粘连形（r2d 落地；w12 时撤回过，见 scratch/parallel/r2d.md） ──
  // attach-damage-90 / e32-pierce-01 把两种能力绑在「速度以及防御能力」这一个语序上
  // （e53-pie-01 绑的是顿号形），语料里另有「及/和」加「能力」只留在后半的写法。
  // 宿主句 魂·斩月/无影幻灵破「无视对手速度和防御能力强化状态」、邪冥兽/幽暗惊魂击「无视对手速度及防御强化」、
  // 斯科皮恩/魔龙断钢爪「无视对手速度和防御能力提升」。
  // 两个格子都是现成的：flags.ignoreFoeSpeed（batch-e34/e42/e53 已在用）+ apply_status pierce_stages（batch-e32 已在用）。
  // **必须两个都发**——只写排序旗标不写穿强化，就是 parser-regression 那道哨兵防的半个匹配。
  // 哨兵原先把这三句整句锁成 no-rule，r2d 按「先单独审它」的要求把它改成完整 IR；
  // 「无视对手速度能力提升状态」「50%概率无视对手速度」「无视对手速度」仍按原样保持 no-rule。
  { id: "r2d-pierce-speed-01",
    re: new RegExp(`^无视(?:对手|对方|敌方)(?:速度|速率)(?:及|和|与)(?:所有|全部)?(?:防御|防守)?(?:能力)?(?:强化|提升|增强)(?:状态|效果)?$`),
    go: () => ({ flags: { ignoreFoeSpeed: true }, effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },
  // 同一句族的显式「防御能力」语序，与上一条同形但把「能力」写全（宿主句 魂·斩月/无影幻灵破）。
  // 分开成一条只为 id 可追溯；两条互不相撞（上一条的「能力」可选，本条必有）。
  { id: "r2d-pierce-speed-02",
    re: new RegExp(`^无视(?:对手|对方|敌方)(?:速度|速率)(?:及|和|与)(?:所有|全部)?(?:防御|防守)能力(?:强化|提升|增强)(?:状态|效果)?$`),
    go: () => ({ flags: { ignoreFoeSpeed: true }, effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }] }) },

  // ── 承伤反弹的动宾倒装 ──
  // 「将对手的攻击伤害N%反馈给对手」= 把这一击从对手那里吃到的伤害按 N% 弹回去，
  // 与 attach-damage-33（"将本回合受到的攻击伤害N%反馈给对方"）同义，落同一个 reflect_dmg 窗；
  // recoilFrac 是「自己打出的伤害反噬自己」，方向相反，不能拿来顶这一句。
  // 宿主句 万世北溟·玄武/万劫沙柩、六界帝神/天辉斩魔剑。
  { id: "w12-reflect-opp-01",
    re: new RegExp(`^(?:将|把|令|使|让)?(?:对手|对方|敌方)(?:的)?(?:攻击)?伤害${NUM}%(?:反馈|反弹|返还)给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // 「自身受到直接伤害的N%反馈给对手」——e36-15 只认「受到(直接)攻击伤害N%」，多一个「直接伤害」就落空。
  // 宿主句 泠月/风雪交加。reflect_dmg 是已有状态名，n/d 已有键。
  { id: "w12-reflect-direct-01",
    re: new RegExp(`^(?:自身|自己)受到直接伤害的?${NUM}%(?:反馈|反弹|返还)给(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }) },

  // ── 能力下降反馈的词形 ──
  // attach-damage-74 / e41-13 已收「将(自身)能力下降(状态)反馈给对手」；
  // 卡西露/海流漩涡 写成「将能力下降的状态反馈给对手」，「的」插在中间。宿主句 特洛尼特/反馈 另有「降」代「降」的刮写，
  // 同属「能力下降」的省写，一并收在同一条里。
  { id: "w12-down-push-01",
    re: /^(?:将|把)?(?:自身|自己|对手|对方|敌方)?(?:的)?降?能力(?:下降|降低)的?状态(?:反馈|返还|转移|转嫁)给(?:对手|对方|敌方)$/,
    go: () => ({ effects: [{ op: "transfer_stages", direction: "push", sign: "down" }] }) },
  // 每回合把自身能力下降推到对手（宿主句 月影·阿德洛卡/永黯月辉「4回合内，每回合自身的能力下降状态都会反馈到对手身上」）。
  // 同族已有 attach-all-28（回合末解除并反弹→down_push_tick 周期名）。本句是同一格子的「都会反馈到…身上」写法。
  { id: "w12-down-push-tick-01",
    re: /^每回合(?:开始|结束)?(?:时|后)?(?:自身|自己)(?:的)?能力(?:下降|降低)(?:状态|效果)(?:都|均|会)*(?:反馈|返还|转移)到(?:对手|对方|敌方)(?:身上)?$/,
    go: () => ({ effects: [{ op: "apply_status", name: "down_push_tick", target: "self" }] }) },

  // ── 「先手」头（既有 p1-ata-03 认「先手(威力)?N倍」，认不出「先手N倍攻击」） ──
  // 宿主句 炽寒妖兽/火光四射、异能元素·奥薇纳/火光四射、格拉诺/暗影冰锥。
  { id: "w12-first-pow-01",
    re: new RegExp(`^(?:若)?先手${NUM}倍(?:攻击|伤害|威力)$`),
    go: (m) => ({ attachDamage: { scaleIf: { when: { order: "first" }, numerator: num(m[1]), denominator: 1 } } }) },
  // 宿主句 龙神·哈克萨斯/天霸龙魂斩「先手加100固伤」——既有 p2-flat-first 只认「先出手时附加N点固定伤害」。
  { id: "w12-first-flat-01",
    re: new RegExp(`^(?:若)?先手(?:时)?加${NUM}(?:点)?(?:固伤|固定伤害)$`),
    go: (m) => ({ attachDamage: { flatIf: { when: { order: "first" }, flat: num(m[1]) } } }) },
  // 宿主句 震天·猛虎王/狂怒弑神爪「先手对方命中-1」——降维已有格子，缺的只是把「先出手时」写成「先手」。
  { id: "w12-first-stage-01",
    re: new RegExp(`^(?:若)?先手(?:时)?(?:对方|对手|敌方)(${Object.keys(STATS).join("|")})([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1]], delta: (m[2] === "-" ? -1 : 1) * num(m[3]), target: "opponent", if: { order: "first" } }] }) },
  // 宿主句 邪影之尊/邪王焚天斩「先手躲避本回合攻击」（dodge 已有状态名，pct 已有键）。
  { id: "w12-first-dodge-01",
    re: /^(?:若)?先手(?:时)?躲避本回合(?:的)?攻击$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: 100 }, if: { order: "first" } }] }) },
  // 宿主句 创世圣弓/圣光创世箭「先手2回合免疫异常」（immune_status 已有状态名）。
  { id: "w12-first-immune-01",
    re: new RegExp(`^(?:若)?先手${NUM}回合(?:内)?免疫异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "self", turns: num(m[1]), if: { order: "first" } }] }) },

  // ── 「对下N回合自身直接攻击必定暴击」──
  // e44-07 认「使己方下N回合攻击必定暴击」，e34-crit-01 认无时限的「自身直接攻击必定暴击」；
  // 宿主句 忍王·壬无月/天沐剑雨 写成「对下2回合…必定暴击」，两者都对不上。
  { id: "w12-crit-turns-01",
    re: new RegExp(`^(?:对)?下${NUM}回合(?:内)?(?:自身|自己)?直接攻击(?:必定|必然|一定)(?:暴击|致命一?击)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self", turns: num(m[1]) }] }) },
  // 「每次使用烧伤概率提升20%，最高概率100%」——e40-16 的步进段要求「几率/概率」在「提升」之前；
  // 宿主句 不动明王/明王焚天照 把异常名夹在中间。chancePerUse/chancePerUseCap 已有键，挂自身窗口由后续异常句折走。
  { id: "w12-chance-use-01",
    re: new RegExp(`^每次使用(?:[^，,]{1,6}?)?(?:的)?(?:几率|概率)(?:提升|提高|增加)${NUM}%[,，]?最高(?:几率|概率)?(?:提升|提高|为|至|到)?${NUM}%$`),
    go: (m) => ({ attachAll: { chancePerUse: num(m[1]), chancePerUseCap: num(m[2]) } }) },

  // ── 回血：分母词写成「损伤」「一半」而非「伤害N/M」 ──
  // batch-e6-125 认「给予对方损伤的一半…」，但只收「回复/恢复自己(的)体力」；
  // e53-drn-08 要求后面是「恢复(自身|自己)(体力|HP)」（没有「的」）。宿主句 伊洛花/强力吸取、
  // 丽莎布布/究极吸取「…的一半会恢复自己的体力」。
  { id: "w12-drain-half-01",
    re: new RegExp(`^给[与予]?(?:对手|对方|敌方)?(?:伤害|损伤)(?:的)?一半[，,]?(?:会)?(?:恢复|回复)(?:自身|自己|自身体力|自己的体力|自己的HP|自己HP|体力)$`),
    go: () => ({ attachDamage: { drain: frac(1, 2) } }) },
  // 「恢复全身体力」/「恢复全体力」——attach-damage-25 已经把「恢复体力」「恢复全部体力」当成回满。
  // 宿主句 弗希斯/暗影微光、斗魂战甲/逆袭战甲。这里只补「全身」「全体力」，数量词必填，避免再抄一条裸「恢复体力」。
  { id: "w12-heal-full-01",
    re: /^(?:恢复|回复)(?:自身|自己)?(?:全身|全部)体力$|^(?:恢复|回复)(?:自身|自己)?全体力$/,
    go: () => ({ effects: [{ op: "heal", numerator: 1, denominator: 1, target: "self" }] }) },
  // 「直接攻击伤害N%恢复体力」——heal-10 认「造成伤害N%」「伤害的N%」，
  // 多一个「直接」且没有「的」就落空。宿主句 萨恩德斯/飞沙走砾。
  { id: "w12-drain-direct-01",
    re: new RegExp(`^直接攻击伤害${NUM}%(?:恢复|回复)(?:自身|自己)?体力$`),
    go: (m) => ({ attachDamage: { drain: frac(num(m[1]), 100) } }) },

  // ── 「对草系无效」──
  // 宿主句 寄生种子一族（伊洛花/寄生种子 等 60+ 条）。是种子类技能的属性免疫附注：
  // 直译成「对草系攻击免疫」会把宿主技能的伤害通道一起关掉，故按语料原意留档，不落 IR。
  { id: "w12-type-null-01",
    re: new RegExp(`^对?[（(【]?(${TYPE_RE})系(?:精灵)?无效[）)】]?$`),
    go: () => ({ unparsedReason: "type-null note (草系免疫寄生种子) — move-level type immunity unmodeled (deferred)" }) },
];
