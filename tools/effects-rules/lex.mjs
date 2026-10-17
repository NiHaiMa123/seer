/**
 * 技能句子的加载期词法。re: 在模块求值时就编译，这些名字必须在此可用。
 * 本文件禁止 import effects-parse.mjs，否则和规则家族形成加载期环。
 */

export const NUM = "([0-9]+|一|二|两|三|四|五|六|七|八|九|十)";
export const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
export const num = (s) => (s !== undefined && CN[s] !== undefined ? CN[s] : parseInt(s, 10));
export const pct = (s) => num(s);

export const STATS = { 攻击: "atk", 物攻: "atk", 防御: "def", 物防: "def", 特攻: "spa", 特功: "spa", 特防: "sdf", 速度: "spd", 命中: "acc" }; // 特功=特攻错字、物攻/物防=物攻物防别名（数据源刮写缺陷）
export const STAT_RE = "物攻|物防|攻击|防御|特攻|特功|特防|速度|命中";
export const ALL_STATS = ["atk", "def", "spa", "sdf", "spd"]; // 全属性+N → 五维（命中另算，UNVERIFIED）
/** 数据源缺陷：部分老技能 stat 名被刮成数字编码 0-5——按面板顺序 [攻,防,特攻,特防,速,命中] 映射（UNVERIFIED）。 */
export const STAT_CODES = ["atk", "def", "spa", "sdf", "spd", "acc"];
/** stage_tick params.stat 整数码（runtime stagePayload：1-6=直接维 atk..acc，7=随机，8=def+sdf，9=全维，10=statMask）。 */
export const STAT_CODE = { atk: 1, def: 2, spa: 3, sdf: 4, spd: 5, acc: 6 };

export const AILMENTS = {
  烧伤: "burn", 冻伤: "frostbite", 中毒: "poison", 麻痹: "paralysis",
  害怕: "fear", 睡眠: "sleep", 失明: "blind", 失神: "daze",
  束缚: "bind", 混乱: "confuse", 寄生: "parasite", 诅咒: "curse",
  疲惫: "fatigue", 流血: "bleed", 沉默: "silence", 冰封: "freeze", 易燃: "flammable",
  焚烬: "ember", 石化: "petrify", 瘫痪: "shock", 感染: "infect", 狂暴: "rage",
  衰弱: "feeble",
  臣服: "submit", 冷冻: "freeze",
};
export const AIL_RE = Object.keys(AILMENTS).join("|");

/** 控制类异常子集（EFFECT_DEFS blockChance>0 硬控——e6-78 reflect_ctl 同分类）。 */
export const CONTROL_AILS = ["paralysis", "fear", "sleep", "submit", "petrify"];
/** 非限制类异常子集（ailment:true 且无 blockChance）。 */
export const NONCONTROL_AILS = ["burn", "frostbite", "poison", "blind", "daze", "bind", "confuse", "parasite", "curse", "fatigue", "bleed", "silence", "freeze", "flammable", "ember", "shock", "infect", "rage", "feeble"];
/** 全异常键集（"随机N种异常状态"无限定词时的候选池——AILMENTS 值域去重，freeze 有"冰封/冷冻"双中文名只算一次）。 */
export const ALL_AILS = [...new Set(Object.values(AILMENTS))];

/** 系别单系名（长词在前防短词先占——"地面"先于"地"、"冰雪"先于"冰"）；claims 文本以 "X系" 出现。 */
export const TYPE_RE = "地面|冰雪|圣灵|邪灵|远古|神灵|虚空|轮回|自然|神秘|暗影|超能|战斗|机械|普通|飞行|次元|混沌|虫|龙|王|光|电|冰|火|水|草|地";

export const frac = (a, b) => ({ numerator: num(a), denominator: num(b) });
export const stageFx = (stat, delta, target, chance) => ({ op: "apply_stat_stage", stat, delta, target, ...(chance !== undefined ? { chance } : {}) });
export const TGT = { 自身: "self", 自己: "self", 本方: "self", 对方: "opponent", 对手: "opponent", 敌方: "opponent", 目标: "opponent" };
export const tgt = (s) => TGT[s] ?? "opponent";
