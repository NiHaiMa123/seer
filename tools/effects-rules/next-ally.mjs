// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// next-ally：下只登场精灵效果——target:nextAlly 运行时本就有，须在 attach-damage-61 的 next-unit 兜底之前命中。
import { NUM, num } from "./lex.mjs";

export const rules = [
  // "(令|使)下只(登场|出战)精灵N回合(内)免疫异常状态" → nextAlly turns
  { id: "nx-im-01",
    re: new RegExp(`^(?:令|使|让)?(?:己方|本方)?下(?:一|1)?只(?:登场|出战|出场)?(?:的)?精灵${NUM}回合(?:内)?免疫异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "nextAlly", turns: num(m[1]) }] }),
  },
  // "(令|使)下只精灵免疫N次异常" → nextAlly count
  { id: "nx-im-02",
    re: new RegExp(`^(?:令|使|让)?(?:己方|本方)?下(?:一|1)?只(?:登场|出战|出场)?(?:的)?精灵免疫${NUM}次异常(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "immune_status", target: "nextAlly", params: { count: num(m[1]) } }] }),
  },
  // "(令|使)下只登场精灵N回合(内)免疫能力下降" → nextAlly down_lock
  { id: "nx-im-03",
    re: new RegExp(`^(?:令|使|让)?(?:己方|本方)?下(?:一|1)?只(?:登场|出战|出场)?(?:的)?精灵${NUM}回合(?:内)?免疫能力(?:下降|弱化)(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "down_lock", target: "nextAlly", turns: num(m[1]) }] }),
  },
  // "吸取对手下只出场精灵1/3(的)最大体力" → nextFoe 百分比伤害 + 等量吸血（吸取=伤害+自回同量）
  { id: "nx-drain-01",
    re: new RegExp(`^(?:吸取|吸收|吸走)(?:对手|对方|敌方)下(?:一|1)?只?(?:出战|出场|登场)?的?精灵(?:的)?(?:最大体力(?:的)?)?${NUM}\\s*/\\s*${NUM}(?:的)?(?:最大)?体力$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, percentBase: "max", target: "nextFoe", drain: { numerator: 1, denominator: 1 } }] }),
  },
  { id: "nx-drain-02",
    re: new RegExp(`^(?:吸取|吸收|吸走)(?:对手|对方|敌方)下(?:一|1)?只?(?:出战|出场|登场)?的?精灵(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: { numerator: num(m[1]), denominator: num(m[2]) }, percentBase: "max", target: "nextFoe", drain: { numerator: 1, denominator: 1 } }] }),
  },
  // "减少对手下只出场精灵1/2最大体力" → nextFoe max_hp_down 分数（与 "减少1/2最大体力"→max_hp_down 一致语义）
  { id: "nx-hp-01",
    re: new RegExp(`^减少(?:对手|对方|敌方)下(?:一|1)?只?(?:出战|出场|登场)?的?精灵${NUM}\\s*/\\s*${NUM}(?:的)?最大体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "nextFoe", params: { n: num(m[1]), d: num(m[2]) } }] }),
  },
  // "降低对手下只出场精灵最大体力N%" → nextFoe max_hp_down 百分比
  { id: "nx-hp-02",
    re: new RegExp(`^(?:降低|减少)(?:对手|对方|敌方)下(?:一|1)?只?(?:出战|出场|登场)?的?精灵(?:的)?最大体力${NUM}%$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "nextFoe", params: { pct: num(m[1]) } }] }),
  },
  // "每使用此技能击败一只精灵则减少对手下只出场精灵N%最大体力" → foeFainted 门控的 nextFoe max_hp_down
  { id: "nx-hp-03",
    re: new RegExp(`^每?(?:使用此技能|使用技能)?击败一?只?精灵则?减少(?:对手|对方|敌方)下(?:一|1)?只?(?:出战|出场|登场)?的?精灵${NUM}%最大体力$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "max_hp_down", target: "nextFoe", params: { pct: num(m[1]) }, if: { foeFainted: true } }] }),
  },
];
