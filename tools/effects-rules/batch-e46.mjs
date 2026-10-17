// batch-e46：承伤吸血别名 / 抵挡回合变体 / 裸减半 / 用招先制 / bench 溢出恢复 / EOT 重触发
import { NUM, num, AILMENTS, STATS, STAT_RE } from "./lex.mjs";

export const rules = [
  // ── "造成伤害的N%将恢复体力" / "造成伤害N%回复自身体力" → drain_atk（e15 变体补全） ──
  { id: "e46-01", re: new RegExp(`^造成(?:的)?伤害(?:的)?${NUM}%(?:将)?(?:会)?(?:恢复|回复)(?:自身|自己)?(?:的)?体力(?:值)?$|^造成伤害的${NUM}%用于恢复(?:自身)?体力$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: num(m[1] ?? m[2]), d: 100 } }] }) },
  // ── "每回合吸取对手N/M最大HP" → drain_dot（最大HP 写法补全） ──
  { id: "e46-02", re: new RegExp(`^每回合(?:使用技能)?(?:吸取|吸收)(?:对手|对方|敌方)${NUM}\s*/\s*${NUM}最大HP$`), go: (m) => ({ effects: [{ op: "apply_status", name: "drain_dot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // ── "可以抵挡下N回合对手的攻击伤害" → dmg_immune turns（e6-88 的"下"变体） ──
  { id: "e46-03", re: new RegExp(`^(?:可以)?抵挡下?${NUM}回合(?:内)?(?:对手|对方|敌方)?的?攻击(?:伤害)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_immune", target: "self", turns: num(m[1]) }] }) },
  // ── 裸"特殊攻击减半"/"物理攻击减半"（"3回合特殊攻击减半"——TURNS_PRE 剥后余形） ──
  { id: "e46-04", re: /^(?:自身|自己)?(?:受到的?)?特殊攻击(?:的?伤害)?减半$/, go: () => ({ effects: [{ op: "apply_status", name: "spec_half", target: "self" }] }) },
  { id: "e46-05", re: /^(?:自身|自己)?(?:受到的?)?物理攻击(?:的?伤害)?减半$/, go: () => ({ effects: [{ op: "apply_status", name: "phys_half", target: "self" }] }) },
  // ── "自身使用属性技能时能较快出手" → prio_up cat:1（属性技=status） ──
  { id: "e46-06", re: /^(?:自身|自己)?使用属性技能时(?:能)?(?:较快|更快|优先)出手$/, go: () => ({ effects: [{ op: "apply_status", name: "prio_up", target: "self", params: { add: 1, cat: 1 } }] }) },
  // ── "恢复Nhp"/"恢复N点" 裸定额恢复 ──
  { id: "e46-07", re: new RegExp(`^恢复${NUM}(?:点|hp|HP|Hp)(?:体力)?$|^恢复(?:自身|自己)${NUM}hp$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "self" }] }) },
  // ── "吸取时若自身满体力则为己方所有不在场精灵恢复N点体力" → drain_dot 挂 benchHeal 参数 ──
  { id: "e46-08", re: new RegExp(`^吸取时若(?:自身|自己)满(?:体力|血)则(?:为|给)(?:己方|我方)(?:所有)?不在场(?:的)?精灵恢复${NUM}点(?:体力|HP)$`), go: (m) => ({ attachAll: { benchHealOnDrain: { flat: num(m[1]), hpFull: 1 } } }) },
  // ── "回合结束后额外触发N次该效果"（回合结束后→每回合 归一后的形态）→ eotReplay 挂宿主 ──
  { id: "e46-09", re: new RegExp(`^每回合(?:结束后)?额外触发${NUM}次该效果$|^额外触发${NUM}次该效果$`), go: (m) => ({ attachAll: { eotReplay: { count: num(m[1] ?? m[2]) } } }) },
  // ── "自身不受能力下降技能影响下N回合自身攻击先制+M" 熔句 ──
  { id: "e46-10", re: new RegExp(`^(?:自身|自己)?不受能力下降(?:技能|状态)?影响下?${NUM}回合(?:自身|自己)?攻击(?:技能)?先制\\+${NUM}$`), go: (m) => ({ effects: [
    { op: "apply_status", name: "immune_degrade", target: "self", turns: num(m[1]) },
    { op: "apply_status", name: "prio_up", target: "self", turns: num(m[1]), params: { add: num(m[2]), cat: 4 } },
  ] }) },
  // ── "降低对方X等级N"（无符号 = 降 N 级；"50%降低对方命中等级1"——bcm 剥几率后余形） ──
  { id: "e46-14", re: new RegExp(`^(?:降低|减少|令|使)(?:对手|对方|敌方)(${STAT_RE})等级${NUM}$|^降低(?:对手|对方|敌方)(${STAT_RE})${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[1] ?? m[3]], delta: -num(m[2] ?? m[4]), target: "opponent" }] }) },
  // ── "令对方所有能力增强效果消失命中后N%令对方烧伤" 熔句（缺分号的复合句） ──
  { id: "e46-15", re: new RegExp(`^(?:令|使)?(?:对方|对手|敌方)所有能力(?:增强|提升)效果消失,?命中后${NUM}%令(?:对方|对手|敌方)(?:的)?(${Object.keys(AILMENTS).join("|")})(?:状态)?$`), go: (m) => ({ effects: [
    { op: "clear_stages", target: "opponent", sign: "up" },
    { op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: num(m[1]) },
  ] }) },
  // ── "随机附加N种弱化类异常状态" → 弱化池未定义 ──
  { id: "e46-11", re: new RegExp(`^随机附加${NUM}种弱化类异常(?:状态)?$|^随机使对手进入${NUM}种弱化类异常`), go: () => ({ unparsedReason: "weaken-ailment pool undefined (deferred)" }) },
  // ── "若对手不是雄性"/性别谓词 → 性别域未建模 ──
  { id: "e46-12", re: /雄性|性别|雌性/, go: () => ({ unparsedReason: "gender domain unmodeled (deferred)" }) },
  // ── "每回合附加N固伤" 裸形 → dealt_tick flat 变体（对手承伤端语义近似 dot）──
  { id: "e46-13", re: new RegExp(`^每回合附加${NUM}点?(?:固伤|固定伤害)$|^每回合额外附加${NUM}点?固伤$`), go: (m) => ({ effects: [{ op: "apply_status", name: "foe_dot", target: "self", params: { flat: num(m[1] ?? m[2]) } }] }) },
];
