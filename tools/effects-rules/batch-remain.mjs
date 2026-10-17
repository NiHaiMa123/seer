// remain：上一轮 mech 因「现有钩子接不住」跳过的、语意清楚的句子。
// 放在 order.mjs 末尾（batchMech 之后），文件内顺序只需保证「新规则在同文件更宽旧规则之前」。
// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, ALL_AILS } from "./lex.mjs";

export const rules = [
  // 「伤害N%反馈对手」。不写「受到」，以免截走「受到伤害N%反馈给对手」。
  // 时长不同的免疫+反弹不再并成 dmg_immune，见 effects-parse.mjs。不要删这条，也不要改那道门。
  { id: "remain-reflect-pct-01",
    re: new RegExp(`^伤害${NUM}%反馈(?:给)?(?:对手|对方|敌方)$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: num(m[1]), d: 100 } }] }) },
  // ── 自耗至残留 N 点 + 区间固伤（"消耗自身体力至残留1点HP给对手造成250-350点伤害"） ──
  // 宿主句 幻影蝶/风翼蝶舞祭、帝皇之御/神谕涤罪曲：两个半边都已有格子——
  // 「消耗自身体力至N点」= e49-04（damage self + cap leaveHp），「给对手造成A-B点伤害」= attach-damage-73 的 flatRange。
  // 这条只把两者按原样拼起来，并放开 e49-04 没收的「残留」与「HP」两个词形。
  { id: "remain-selfcost-01",
    re: new RegExp('^消耗(?:自身|自己)?体力(?:值)?至(?:残留)?' + NUM + '(?:点)?(?:HP|hp|体力)?给(?:对手|对方|敌方)造成' + NUM + '\s*[-~～—至到]\s*' + NUM + '点?(?:固定)?(?:伤害|固伤)$'),
    go: (m) => ({ effects: [
      { op: "damage", kind: "fixed", power: 1, target: "self", leaveHp: num(m[1]) },
      { op: "damage", kind: "fixed", power: num(m[2]), target: "opponent", flatRange: { min: num(m[2]), max: num(m[3]) } },
    ] }) },

  // ── 受击阈值 → 对手随机 M 种异常（"每次受到伤害时若高于N则使对手随机进入M种异常状态"） ──
  // 宿主句 天启帝君/轮回之狱、八岐大蛇/永恒长眠、西曼德妮/高维干涉 等。
  // 守卫（trigger 1 + min）与 payload（random{list,count}）都是现成格子，缺的只是这条中文；不新增 params 键。
  { id: "remain-taken-random-01",
    re: new RegExp('^(?:每次|每|若)?(?:自身|自己)?受到伤害(?:时|后)?(?:若)?(?:高于|大于|超过)([0-9]+)(?:点)?则(?:令|使)?(?:对手|对方|敌方)随机进入(' + NUM + ')种异常状态$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, min: num(m[1]) }, payload: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: num(m[2]) } }] }] }) },

  // ── 每回合对手所有招式 PP 值 -N（"每回合对手所有招式PP值-1"） ──
  // 已有 pp_drain（回合末窗口 WIN.ppDrain 对对手全招式扣 flat）。上一轮 mech 按"现有钩子接不住"跳过，
  // 实际接得住：这是技能句，走的是家族规则 + 已有周期名，不是新周期名。句中的「招式」与「技能」同义。
  { id: "remain-pp-turn-01",
    re: new RegExp('^每回合(?:结束时|结束后|结束)?(?:令|使)?(?:对手|对方|敌方)(?:的)?(?:所有|全部)?(?:招式|技能)PP值?[-−－](' + NUM + ')$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: num(m[1]) } }] }) },
  // ── 属性交换的动宾倒装（"5回合内和对方的属性交换"） ──
  // 同族已有 p2-type-02（"和对手交换属性"）。语料 纳瓦雷多/属性反转、纳多雷/属性反转 用的是
  // 「和对方的属性交换」——动词在名词后，那条规则的 (?:交换|互换|对调|反转) 位置对不上。
  // type_swap 是计时标记（battleTypesOf 计算型覆写，到期还原），交换对称，标记在自身即可。
  { id: "remain-typeswap-01",
    re: /^(?:(?:使|令)?(?:自身|自己|本方)?(?:的)?(?:和|与|跟))?(?:对手|对方|敌方)(?:战斗时)?(?:的)?属性(?:交换|互换|对调)$/,
    go: () => ({ effects: [{ op: "apply_status", name: "type_swap", target: "self" }] }) },

  // ── 血量阈值秒杀的同义句形（"若敌方血量低于N则必定秒杀"） ──
  // 已有「若对手体力不足N则直接秒杀」= damage{kind:percent,power:100}（秒杀走 100% 百分比伤害通道）+ foeHpBelowAbs 门。
  // 语料 鬼剑骷髅/狂野罗刹、鬼剑罗刹/狂野罗刹。不新增键、不新增分支。
  { id: "remain-seekill-01",
    re: new RegExp('^(?:若|如果)?(?:敌方|对手|对方)(?:的)?(?:血量|体力)(?:低于|少于|小于|不足)(' + NUM + ')(?:点)?则(?:必定|直接)?秒杀(?:对手|对方|敌方)?$'),
    go: (m) => ({ effects: [{ op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: num(m[1]) } }] }) },
  // ── 压制对手出伤（"使对手1回合造成伤害是原来1/2"） ──
  // 方向与「对手造成的伤害减半」相反：那条是自身承伤减半（dmg_taken_down 挂自身），
  // 这条是让对手打出来的伤害变小（dmg_weaken 挂对手，走 dmgOutFrac 管线）。
  // dmg_weaken 是已有修饰窗，n/d 是已有键；语料 圣甲地裂/百裂拳、圣甲·卡修斯/百裂拳。
  { id: "remain-weaken-01",
    re: new RegExp('^(?:使|令|让)?(?:对手|对方|敌方)?造成(?:的)?伤害(?:是|为|变为|变成)原来(?:的)?([0-9]+)\s*/\s*([0-9]+)$|^(?:使|令|让)?(?:对手|对方|敌方)?造成(?:的)?伤害减半$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: m[1] !== undefined ? { n: num(m[1]), d: num(m[2]) } : { n: 1, d: 2 } }] }) },
  // ── 「先手」写成"先手"而非"先出手时"（"先手免疫当回合伤害"） ──
  // 同族 deferred-21 只认裸「免疫当回合伤害」，前缀"先手"由 condOf 认成 order:first；
  // 但整段不是"若P则Y"形式，condOf 不切分——所以这里整句吃下，条件走 if。
  // 语料 龙胆天神/单骑万侯斩、龙胆·赵云/枪神渺云刺（后半"并恢复X体力"由逗号/并切分后各自成 op）。
  // ── 全类型承伤减半 / 类别承伤的动宾倒装（"受到所有伤害减半"、"减少受到的25%的特殊攻击伤害"） ──
  // 「受到所有伤害」是已有 dmg_taken_down（承伤 %）的整句写法：既有规则只认「受到的(攻击)伤害」，
  // 多一个「所有」就落空。语料 火舞天尊/天衣无缝。
  { id: "remain-taken-all-01",
    re: new RegExp('^(?:自身|自己)?受到(?:的|所有|全部|一切)+(?:攻击)?伤害(?:减少|降低)(' + NUM + ')%$|^(?:自身|自己)?受到(?:的|所有|全部|一切)+(?:攻击)?伤害减半$'),
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: m[1] !== undefined ? num(m[1]) : 50 } }] }) },
  // 「减少受到的N%的X攻击伤害」是动宾倒装（既有 e34-half-02 / attach-damage-18 都是「受到X伤害减少N%」的正序）。
  // spec_half/phys_half 是已有状态名（modifier 轴 dmgTakenCatFrac，cat 2=物理/3=特殊，n/d 是分数）。
  { id: "remain-taken-cat-inv-01",
    // 数字不用 NUM：NUM 自带捕获组会把类别挤到 m[3]，这里写明非捕获的数字分支，类别就是 m[2]。
    re: /^(?:自身|自己)?(?:减少|降低)受到的([0-9]+|一|二|两|三|四|五|六|七|八|九|十)%的?(物理|物攻|特殊|特攻)(?:攻击)?伤害$/,
    go: (m) => { const phys = /^(?:物理|物攻)$/.test(m[2]); const pct = num(m[1]); return { effects: [{ op: "apply_status", name: phys ? "phys_half" : "spec_half", target: "self", params: { cat: phys ? 2 : 3, n: 100 - pct, d: 100 } }] }; } },

  { id: "remain-first-immune-01",
    re: /^(?:若)?先手免疫当回合(?:受到的)?(?:攻击)?伤害$/,
    go: () => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1, if: { order: "first" } }] }) },

  // ── r3：被击败触发（"若被击败则对手损失N体力"）——**本条不做，留作单独契约** ──
  // 试过两版，都撤回：
  //   ① 宽版（整段吃下含尾段）：宿主句 斯凯尔托斯/灵尊·斯凯尔 的旧 op
  //      `damage{power:1,if:{prevCrit}}` 与 `cap leaveHp` 从顶层搬进新 react 的 payload，
  //      整条 react 还多一个 if:{prevCrit}——旧效果没留在原位。
  //   ② 窄版（正则锚 $，只吃「触发+损失」两半）：顶层的 damage/cap 是留住了，
  //      但新 react 成了 pendingReact，尾段那两条仍被折进它的 payload（改形换了位置，没消失）。
  // 根因是解析器的合并范围，不是缺一条中文规则：同 clause 内普通 op 会被折进先前 react 的 payload
  // （`pendingReact`，effects-parse.mjs），而既有 16 条同形句
  // "若被对手击败则对手损失N点体力，造成致命伤害时，对手剩余1点体力" 本来就是
  // 一条 react 把尾段吞进 payload 的形态。要让尾段留在原位，得改 pendingReact / partCond 的结转范围,
  // 那会改 21 条以上既有句的 IR。按 remain3.md「不能锁改形后的 IR」停在未解析。

  // ── r3：衍化/复原/改为逆转（灭战神决·盖亚的「武道衍化轨迹」） ──
  // 三句各自是一个开关位的置位、清除、切换到另一状态，都无计时：
  //   "衍化自身的武道"（战·破元归衍）→ tag:wudao:forward
  //   "复原自身的武道衍化轨迹"（战·归真复元）→ 清除（clear）
  //   "将自身的武道衍化轨迹改为逆转"（战·日月逆行）→ tag:wudao:revert（正转位互斥让出）
  // name 用 ASCII 串（"wudao"）：moves.schema 的 op name 是 ^[a-z][a-z0-9_-]*$，
  // 中文名进不了包；mark 那一路用的是无 pattern 的 mark 字段，与此不同。
  // 走新 op set_mode_flag（五处契约：处理函数+OPS、schema、CompiledEffect、operatorAllowlist、测试）。
  // 三个状态用同一 name 的两个后缀表达，不新增 EFFECT_DEFS 状态名；判读谓词由既有 selfHas 承载
  // （读法写作 "tag:wudao:forward" / "tag:wudao:revert"，已由 ops/mode-flag.test.ts 锁住）。
  // 宿主招式里"下1次衍化时时全属性+1"一类以「衍化」为触发点的效果仍走各自既有通道，本条只管开关位本身。
  { id: "r3-wudao-evolve-01",
    re: /^衍化(?:自身|自己)(?:的)?武道$/,
    go: () => ({ effects: [{ op: "set_mode_flag", name: "wudao", target: "self" }] }) },
  { id: "r3-wudao-restore-01",
    re: /^复原(?:自身|自己)(?:的)?武道衍化轨迹$/,
    go: () => ({ effects: [{ op: "set_mode_flag", name: "wudao", target: "self", clear: true }] }) },
  { id: "r3-wudao-revert-01",
    re: /^将(?:自身|自己)(?:的)?武道衍化轨迹改为逆转$/,
    go: () => ({ effects: [{ op: "set_mode_flag", name: "wudao", target: "self", to: "revert" }] }) },

  // ── r3：伤害计算时克制倍数至少为 N（改克制的下限形；1=不微弱） ──
  // 宿主句 逐界苍星/彼空·苍星坠梦。既有 heal-11 认的是「(攻击时)(造成的)伤害不会出现微弱」，
  // 本句把同一语义写成「克制倍数至少为1」；noResist 是已有 attachDamage 键
  // （formula 切片 noResist：eff16<16 抬到 16），本条只补词形，不动 damage.ts。
  // 只收下限为 1 的裸形；带「若…则克制倍数至少为1.25」一类条件分支不在本条内（写死区间没有通用读法）。
  { id: "r3-noresist-01",
    re: /^(?:伤害计算时|计算伤害时)?克制倍数至少为1$/,
    go: () => ({ attachDamage: { noResist: true } }) },

];
