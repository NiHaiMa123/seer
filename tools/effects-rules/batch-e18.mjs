// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e18：魂印长尾第十二批——裸技能失效/等量护盾/下只登场吸取/印记声明窗/随机异常时长/元语句归桶。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS, ALL_AILS } from "./lex.mjs";
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 裸失效/护盾 ──────────────────────────────────────────
  // "(攻击|属性|物理|特殊)技能失效" 裸形 → move_null（魂印语境默认对手侧——受击反制使攻击方技失效）
  { id: "e18-mn-01",
    re: /^(?:对手|对方|敌方)?(?:的)?(?:攻击|属性|物理|特殊)技能失效$/,
    go: (m) => ({ effects: [{ op: "apply_status", name: "move_null", target: /对手|对方|敌方/.test(m[0]) || !/自身|自己/.test(m[0]) ? "opponent" : "self", turns: 1, params: { count: 1 } }] }),
  },
  // "获得等量护盾" → shieldEcho（伤害等量转护盾——attachDamage 通道挂当次伤害）
  { id: "e18-sh-01",
    re: /^获得等量(?:的)?护盾$|^自身获得等量护盾$/,
    go: () => ({ attachDamage: { shieldEcho: true } }),
  },
  // "(造成等量伤害并)获得等量护盾" 并列形亦收（"附加等量护盾"——attachDamage 同上）
  { id: "e18-sh-02",
    re: /^(?:附加|获得)与(?:自身|自己)?(?:造成的)?伤害等量的护盾$/,
    go: () => ({ attachDamage: { shieldEcho: true } }),
  },

  // ── 下只登场/印记窗 ──────────────────────────────────────
  // "吸取(对手)下只登场精灵最大体力N/M" → nextFoe percent + drain（"吸取对手下只登场精灵最大体力的1/3"——e5-16 的"登场"无出字变体）
  { id: "e18-nx-01",
    re: new RegExp(`^(?:吸取|吸收)(?:对手|对方|敌方)?下只(?:登场)?精灵(?:的)?最大体力(?:的)?${NUM}\\s*/\\s*${NUM}$`),
    go: (m) => ({ effects: [{ op: "damage", kind: "percent", frac: frac(num(m[1]), num(m[2])), percentBase: "max", target: "nextFoe", drain: frac(1, 1), drainTo: "foe", power: 0 }] }),
  },
  // "(为|给)(己方|自身)下N回合(战斗)?附加X印记：Y" → apply_mark + 内联体（"为己方下2回合战斗附加辛之印记：免疫异常状态"）
  { id: "e18-mk-01",
    re: new RegExp(`^(?:为|给|令|使)?(?:己方|我方|自身|自己)?下?${NUM}回合(?:战斗|内|中)?附加(.{1,10}?)(?:之)?(?:印记)?[：:](.+)$`),
    go: (m) => {
      const mk = m[2].replace(/(?:之)?(?:印记|效果)$/, "");
      if (/护盾|护罩|异常|伤害|体力|回合|固定|真实|百分比|\d|先制|致命|无法|免疫|PP/i.test(mk)) return undefined;
      const sub = parseEffectText(m[3]);
      if (sub.effects.length === 0 && !sub.flags?.attachDamage && !(sub.unparsed?.length === 0)) return undefined;
      const ops = [{ op: "apply_mark", mark: mk, count: 1, target: "self", turns: num(m[1]) }, ...(sub.effects ?? [])];
      return { effects: ops, unparsed: sub.unparsed ?? [], flags: sub.flags };
    },
  },

  // ── 随机异常时长 ─────────────────────────────────────────
  // "(X中)?随机N种异常状态M回合" → random count + turns（"星赐中随机1种异常状态2回合"——域前缀由调用层剥）
  { id: "e18-rd-01",
    re: new RegExp(`^随机${NUM}?种?异常(?:状态)?${NUM}回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[1] !== undefined ? num(m[1]) : 1 }, turns: num(m[2]) }] }),
  },
  // "令对手随机进入AIL/异常N回合" → random + turns
  { id: "e18-rd-02",
    re: new RegExp(`^(?:令|使)(?:对手|对方|敌方)随机进入${NUM}?种?异常(?:状态)?${NUM}回合$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: "random", target: "opponent", random: { list: ALL_AILS, count: m[1] !== undefined ? num(m[1]) : 1 }, turns: num(m[2]) }] }),
  },

  // ── 元语句/保残归桶 ──────────────────────────────────────
  // "自身所处异常状态回合数-N" → ailment 时长改写未建模
  { id: "e18-df-01",
    re: new RegExp(`^(?:自身|自己)(?:所处)?(?:的)?异常状态回合数(?:-|减少)${NUM}$`),
    go: () => ({ unparsedReason: "ailment-duration-delta — ailment turn rewrite unmodeled (deferred)" }),
  },
  // "(将|会)于(当回合|本回合|回合)结束后消失" → 印记者生命周期声明（元语句——印记声明的存续注记，非独立效果）
  { id: "e18-df-02",
    re: /^(?:将|会|效果)?于?(?:当|本)?回合?结束(?:后|时)?消失$/,
    go: () => ({ unparsedReason: "mark-lifecycle note — declarative expiry annotation" }),
  },
  // "下场不保留"/"下场不" → 换装保留注记
  { id: "e18-df-03",
    re: /^下场不(?:保留|存在|生效|继承)?$/,
    go: () => ({ unparsedReason: "persist-on-switch — buff retention across switch-out unmodeled (deferred)" }),
  },
];
