// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, ALL_STATS, STAT_CODES, stageFx, tgt } from "./lex.mjs";

export const rules = [

  // ── 能力等级 ────────────────────────────────────────────────
  { id: "stages-01",
    // 数字编码维（数据源刮损："50%改变对方5等级-1"——code 1-6 映射六维序 atk/def/spa/sdf/spd/acc，UNVERIFIED）
    re: new RegExp(`^(?:技能使用成功时[，,]?)?${NUM}%(?:的?(?:几|概)?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)([1-6])(?:等级)?([+-])${NUM}$`),
    go: (m) => {
      const STAT_CODES = ["atk", "def", "spa", "sdf", "spd", "acc"];
      return { effects: [stageFx(STAT_CODES[num(m[3]) - 1], (m[4] === "-" ? -1 : 1) * num(m[5]), tgt(m[2]), pct(m[1]))] };
    },
  },
  { id: "stages-02",
    // "技能使用成功时，50%改变自身防御等级+1" / "50%改变对方命中等级-1" / "50%改变对方双防等级-1"
    re: new RegExp(`^(?:技能使用成功时[，,]?)?${NUM}%(?:的?(?:几|概)?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)(${STAT_RE}|双攻|双防)(?:等级)?([+-])${NUM}$`),
    go: (m) => {
      const d = (m[4] === "-" ? -1 : 1) * num(m[5]);
      const stats = m[3] === "双攻" ? ["atk", "spa"] : m[3] === "双防" ? ["def", "sdf"] : [STATS[m[3]]];
      return { effects: stats.map((s) => stageFx(s, d, tgt(m[2]), pct(m[1]))) };
    },
  },
  { id: "stages-03",
    // 无符号尾数："50%改变自身特攻等级2"/"40%改变自身双防等级2" → +2（双防=def+sdf 各一）
    re: new RegExp(`^(?:技能使用成功时[，,]?)?${NUM}%(?:的?(?:几|概)?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)(${STAT_RE}|双攻|双防)(?:等级)?${NUM}$`),
    go: (m) => {
      const stats = m[3] === "双攻" ? ["atk", "spa"] : m[3] === "双防" ? ["def", "sdf"] : [STATS[m[3]]];
      return { effects: stats.filter((s) => s !== undefined).map((s) => stageFx(s, num(m[4]), tgt(m[2]), pct(m[1]))) };
    },
  },
  { id: "stages-04",
    // "自身攻击等级提升1级"/"对手防御等级降低2级"（等级提升句式，无动词"改变"）
    // 签名变体："对手速度降低-1个等级"（降低-1 原文带负号；"提升+1个等级"同理）——动词定号、尾数取绝对值
    re: new RegExp(`^(自身|对方|对手|自己|敌方)(${STAT_RE}|双攻|双防)(?:的)?等级(?:提升|提高|上升|增加)[+-]?${NUM}(?:个)?级$|^(自身|对方|对手|自己|敌方)(${STAT_RE}|双攻|双防)(?:的)?等级(?:降低|减少|下降)[+-]?${NUM}(?:个)?级$|^(自身|对方|对手|自己|敌方)(${STAT_RE}|双攻|双防)(?:能力)?(?:等级)?(?:降低|减少|下降)([+-])${NUM}(?:个)?(?:等级|级)$`),
    go: (m) => {
      // 分支3（动词+显式符号尾数）：m[7]=who m[8]=stat m[9]=sign m[10]=num——动词已是"降低"向，符号冗余校验不翻转
      const statName = m[2] ?? m[5] ?? m[8];
      const d = m[8] !== undefined ? -num(m[10]) : (m[5] !== undefined ? -1 : 1) * num(m[3] ?? m[6]);
      const stats = statName === "双攻" ? ["atk", "spa"] : statName === "双防" ? ["def", "sdf"] : [STATS[statName]];
      return { effects: stats.filter((s) => s !== undefined).map((s) => stageFx(s, d, tgt(m[1] ?? m[4] ?? m[7]))) };
    },
  },
  { id: "stages-05",
    // 几率+多维同值："50%改变对方防御、特防等级-1"
    re: new RegExp(`^${NUM}%(?:的?几?率)?(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)((?:(?:${STAT_RE})、?)+)(?:等级)?([+-])${NUM}$`),
    go: (m) => {
      const stats = [...m[3].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]);
      if (stats.length < 2) return null;
      const d = (m[4] === "-" ? -1 : 1) * num(m[5]);
      return { effects: stats.map((s) => stageFx(s, d, tgt(m[2]), pct(m[1]))) };
    },
  },
  { id: "stages-06",
    re: new RegExp(`^(?:改变|令|使)(自身|对方|对手|自己|敌方|目标)(${STAT_RE})(?:等级)?([+-])${NUM}$`),
    go: (m) => ({ effects: [stageFx(STATS[m[2]], (m[3] === "-" ? -1 : 1) * num(m[4]), tgt(m[1]))] }),
  },
  { id: "stages-07",
    // 裸"攻击+2" / "速度-1"（逗号拆分后主语丢失 → self）
    re: new RegExp(`^(${STAT_RE})(?:等级)?([+-])${NUM}$`),
    go: (m) => ({ effects: [stageFx(STATS[m[1]], (m[2] === "-" ? -1 : 1) * num(m[3]), "self")] }),
  },
  { id: "stages-08",
    // "自身命中+1" 无动词简写
    re: new RegExp(`^(自身|对方|对手|自己)(${STAT_RE})([+-])${NUM}$`),
    go: (m) => ({ effects: [stageFx(STATS[m[2]], (m[3] === "-" ? -1 : 1) * num(m[4]), tgt(m[1]))] }),
  },
  // "自身防御/特防+1"（斜杠分隔同值多维；stages-09 只认「、和与，」）。放在 stages-09 前面。
  { id: "p1-stg-01", re: new RegExp(`^(?:改变|使|令|让)?(自身|对方|对手|自己|敌方)?的?((${STAT_RE})(?:/(?:${STAT_RE}))+)(?:等级)?([+-])${NUM}$`), go: (m) => { const names = [...m[2].matchAll(new RegExp(STAT_RE, "g"))].map((x) => STATS[x[0]]).filter(Boolean); if (names.length < 2) return null; const d = (m[4] === "-" ? -1 : 1) * num(m[5]); return { effects: names.map((s) => ({ op: "apply_stat_stage", stat: s, delta: d, target: m[1] !== undefined ? tgt(m[1]) : "self" })) }; } },
  { id: "stages-09",
    // 多维同值："对方防御、特防-1" / "使自身攻击、速度+2" / "改变对方防御、特防等级-1"（枚举含别名：双攻/双防/攻速）
    // 注：捕获组须包住整个重复段（否则只拿到最后一维）。
    re: new RegExp(`^(?:改变|使|令)?(自身|对方|对手|自己|敌方)((?:(?:${STAT_RE}|双攻|双防|攻速|双刀)、?)+)(?:等级)?(?:额外)?([+-])${NUM}$`),
    go: (m) => {
      const ALIAS = { 双攻: ["atk", "spa"], 双防: ["def", "sdf"], 攻速: ["atk", "spd"], 双刀: ["atk", "spa"] };
      const stats = [...m[2].matchAll(new RegExp(`${STAT_RE}|双攻|双防|攻速|双刀`, "g"))].flatMap((x) => ALIAS[x[0]] ?? [STATS[x[0]]]).filter(Boolean);
      if (stats.length < 2) return null;
      const delta = (m[3] === "-" ? -1 : 1) * num(m[4]);
      return { effects: stats.map((s) => stageFx(s, delta, tgt(m[1]))) };
    },
  },
  { id: "stages-10",
    re: new RegExp(`^(?:技能使用成功时[，,]?)?${NUM}%(?:的?几?率)?(?:使|令|改变)?(对方|对手|敌方)(全属性|全能力|所有属性|全部属性|所有能力|全项能力)(?:等级)?([+-])${NUM}$`),
    go: (m) => { const d = (m[3] === "-" ? -1 : 1) * num(m[4]); return { effects: ALL_STATS.map((s) => stageFx(s, d, "opponent", pct(m[1]))) }; },
  },
  { id: "stages-11",
    re: new RegExp(`^(?:令|使|改变)(自身|自己|对方|对手|敌方)(全属性|全能力|所有属性|全部属性|所有能力|全项能力)(?:等级)?([+-])${NUM}$`),
    go: (m) => { const d = (m[3] === "-" ? -1 : 1) * num(m[4]); return { effects: ALL_STATS.map((s) => stageFx(s, d, tgt(m[1]))) }; },
  },
  { id: "stages-12", re: new RegExp(`^(全属性|全能力|所有属性|全部属性|所有能力|全项能力)(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[2] === "-" ? -1 : 1) * num(m[3]); return { effects: ALL_STATS.map((s) => stageFx(s, d, "self")) }; } },
  // 宿主句 天道降魔阵「另对手全属性－1，3回合内每回合受到100点固定伤害」——「另」是「令」的脱字；
  // 负载与 stages-13 逐字同构（ALL_STATS 全维 -1，目标 opponent）。放在 stages-13 前面。
  { id: "d3-stage-typo-01", re: new RegExp(`^另(对手|对方|敌方)(全属性|全能力|所有属性|全部属性|所有能力|全项能力)(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[3] === "-" ? -1 : 1) * num(m[4]); return { effects: ALL_STATS.map((s) => stageFx(s, d, tgt(m[1]))) }; } },
  { id: "stages-13", re: new RegExp(`^(自身|自己|对方|对手|敌方)(?:额外)?(全属性|全能力|所有属性|全部属性|所有能力|全项能力)(?:等级)?([+-])${NUM}$`), go: (m) => { const d = (m[3] === "-" ? -1 : 1) * num(m[4]); return { effects: ALL_STATS.map((s) => stageFx(s, d, tgt(m[1]))) }; } },
  // "自身N%全属性+K"（概率全属性强化——chance 逐维共享）
  { id: "stages-14", re: new RegExp(`^(?:自身|自己)${NUM}%(?:的?(?:概率|几率))?全属性([+-])${NUM}$|^${NUM}%(?:的?(?:概率|几率))?(?:使|令)?(?:自身|自己)?全属性([+-])${NUM}$`), go: (m) => { const pct = num(m[1] ?? m[4]); const d = ((m[2] ?? m[5]) === "-" ? -1 : 1) * num(m[3] ?? m[6]); return { effects: ALL_STATS.map((s) => ({ op: "apply_stat_stage", stat: s, delta: d, target: "self", chance: pct })) }; } },
  { id: "stages-15", // 同值多维（共享值）："防御和特防等级+1"/"改变自身攻击、防御等级+2"
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:改变|使|令)?(?:自身|自己|对方|对手|敌方)?的?((?:${STAT_RE})(?:(?:和|与|、|，|,)(?:${STAT_RE}))+)等级?([+-])${NUM}$`),
    go: (m) => {
      const pctM = m[0].match(/(\d+)%/);
      const names = [...m[2].matchAll(new RegExp(STAT_RE, "g"))].map((x) => x[0]);
      if (names.length < 2) return null;
      const d = (m[m.length - 2] === "-" ? -1 : 1) * num(m[m.length - 1]);
      const ch = pctM ? { chance: num(pctM[1]) } : {};
      const t = /对手|对方|敌方/.test(m[0]) ? "opponent" : "self";
      return { effects: names.map((s) => ({ ...stageFx(STATS[s], d, t), ...ch })) };
    },
  },
  { id: "stages-16",
    // 异值多维："攻击+2、防御+1" / "使自身攻击+1、速度+1" / "攻速+2命中+1"（别名组）
    re: new RegExp(`^(?:使|令|改变)?(?:(自身|对方|对手|自己|敌方)的?)?((?:(?:${STAT_RE}|攻速|双攻|双防|双刀)(?:等级)?[+-]${NUM}[、,，]?){2,})$`),
    go: (m) => {
      const parts = [...m[2].matchAll(new RegExp(`(${STAT_RE}|攻速|双攻|双防|双刀)(?:等级)?([+-])${NUM}`, "g"))];
      if (parts.length < 2) return null;
      const t = m[1] ? tgt(m[1]) : "self";
      const alias = { 攻速: ["atk", "spd"], 双刀: ["atk", "spa"], 双攻: ["atk", "spa"], 双防: ["def", "sdf"] };
      const out = [];
      for (const p of parts) {
        const d = (p[2] === "-" ? -1 : 1) * num(p[3]);
        for (const st of alias[p[1]] ?? [STATS[p[1]]]) if (st !== undefined) out.push(stageFx(st, d, t));
      }
      return { effects: out };
    },
  },
];