// batch-e47：对手最大体力百分比吸血 / 消耗体力等量固伤 / 连续攻击几率步进 /
// 系别谓词宿主句 / 害怕条件减伤 / 永久必致命 / 裸"结束时"回复 /
// 元素·克制·天赋·编队域 deferred 归类。
import { NUM, num, TYPE_RE } from "./lex.mjs";

export const rules = [
  // ── "己方在场精灵吸取对手最大体力N%"：单打=自身按对手最大体力 N% 吸血
  //    （percent 伤害 + drain 1/1 等额回血；1v1 域下"在场精灵"即自身） ──
  { id: "e47-01", re: new RegExp(`^(?:己方|我方|已方)?(?:所有)?在场精灵(?:吸取|吸收)(?:对手|对方|敌方)最大体力的${NUM}%$|^(?:己方|我方|已方)?(?:所有)?在场精灵(?:吸取|吸收)(?:对手|对方|敌方)最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => m[2] !== undefined
    ? { effects: [{ op: "damage", power: 1, kind: "percent", frac: { numerator: num(m[2]), denominator: num(m[3]) } }, { op: "heal", numerator: num(m[2]), denominator: num(m[3]), target: "self" }] }
    : { effects: [{ op: "damage", power: num(m[1]), kind: "percent" }, { op: "heal", numerator: num(m[1]), denominator: 100, target: "self" }] } },
  // ── "给对手附加消耗体力N/M等量的固定伤害"：消耗体力=自身已损失 HP ──
  { id: "e47-02", re: new RegExp(`^(?:给|对|向)(?:对手|对方|敌方)?附加(?:消耗|已消耗)体力${NUM}\\s*/\\s*${NUM}等量的(?:固定|真实)伤害$`), go: (m) => ({ attachDamage: { flatSelfFrac: { numerator: num(m[1]), denominator: num(m[2]), base: "missing" } } }) },
  // ── "连续攻击每次提高N%几率，最多提高M%"（连续攻击=连续使用变体） ──
  { id: "e47-03", re: new RegExp(`^连续攻击(?:每次|每攻击一次)?提高${NUM}%(?:的)?几率，?最多提高${NUM}%$`), go: (m) => ({ attachAll: { chancePerUse: num(m[1]), chancePerUseCap: num(m[2]) } }) },
  // （注："对手害怕则下N次受到的伤害减少M点"由 condOf 的 foeHas:fear 门控 + dmg_reduce 承接，无需专门规则）
  // ── "从下回合开始必定致命一击"：无时限 crit_always ──
  { id: "e47-05", re: /^从?下回合(?:起|开始)(?:自身)?必定致命(?:一击|击)?$/, go: () => ({ effects: [{ op: "apply_status", name: "crit_always", target: "self" }] }) },
  // ── 裸"结束时恢复自身最大体力N/M"（定时窗内续段 → hot） ──
  { id: "e47-06", re: new RegExp(`^结束时恢复(?:自身|自己)最大体力的${NUM}\\s*/\\s*${NUM}$`), go: (m) => ({ effects: [{ op: "apply_status", name: "hot", target: "self", params: { n: num(m[1]), d: num(m[2]) } }] }) },
  // ── 元素域：属性招式伤害倍率（无元素乘算域 → deferred） ──
  { id: "p2-type-01",
    re: /^(?:使|令)?(?:自身|自己)?(?:使用)?(地面|冰雪|圣灵|邪灵|远古|神灵|虚空|轮回|自然|神秘|暗影|超能|战斗|机械|普通|飞行|次元|混沌|虫|龙|王|光|电|冰|火|水|草|地)(?:系)?(?:招式|招数|技能)(?:造成)?(?:的)?伤害[×xX*]?([0-9]+|一|二|两|三|四|五|六|七|八|九|十)(?:倍)?$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: (num(m[2]) - 1) * 100 }, moveType: m[1] }] }),
  },
  { id: "p2-type-03",
    re: /^(?:自身|自己)(?:使用)?(地面|冰雪|圣灵|邪灵|远古|神灵|虚空|轮回|自然|神秘|暗影|超能|战斗|机械|普通|飞行|次元|混沌|虫|龙|王|光|电|冰|火|水|草|地)(?:系)?(?:的)?(?:技能|招式|攻击)?(?:的)?威力翻倍$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 100 }, moveType: m[1] }] }),
  },
  { id: "e47-07", re: new RegExp(`^(?:自己|自身)使用(${TYPE_RE})(?:系)?(?:招式|招数)伤害[×xX*]?${NUM}(?:倍)?$|^(?:自己|自身)使用(${TYPE_RE})(?:系)?(?:招式|招数)伤害${NUM}%$`), go: (m) => { const type = m[1] ?? m[3]; const pctv = m[4] !== undefined ? num(m[4]) - 100 : (num(m[2]) - 1) * 100; return { effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: pctv }, moveType: type }] }; } },
  // 「克制倍数至少为 1.25/1.5/2」不在这里落。唯一的技能宿主是阶梯：
  // 至少为 1，1 层未来奇点则至少为 1.25，2 层 1.5，3 层 2。
  // noResist 是单值，同键后写盖先写，条件又挂不上去，落了就会变成无条件至少 2 倍。
  // 继续交给下面的 e47-08 留档。单值下限的结算读法留在 damage-family.ts，等有不覆盖的字段再发。
  { id: "e47-08", re: /^以.{1,4}系(?:进行)?伤害结算$|^克制倍数(?:取|至少|至多|最少|最多|为|不低于|不高于).*$|^.{1,4}系技能威力为随机倍数$|^(?:对手|对方|敌方)?对(?:自身|自己)的?克制倍数/, go: () => ({ unparsedReason: "type override / element settle unmodeled (deferred)", effects: [] }) },
  // ── 天赋值 / 编队目标数 / 幕颜色：未建模域 → deferred ──
  { id: "e47-09", re: /天赋值/, go: () => ({ unparsedReason: "talent value unmodeled (deferred)", effects: [] }) },
  { id: "e47-10", re: /组队(?:时|是)?(?:可以)?影响(\d+)个目标/, go: (m) => ({ flags: { targets: num(m[1]) } }) },
  // （注："随机进入N种控制类异常"由 e6-41 先行归类 UNVERIFIED，无需重复）
  { id: "e47-12", re: /^将.{1,3}幕的颜色改为.{1,4}$/, go: () => ({ unparsedReason: "curtain color unmodeled (deferred)", effects: [] }) },
];
