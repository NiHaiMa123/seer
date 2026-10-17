// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num, pct, STATS, STAT_RE, ALL_STATS, STAT_CODES, AILMENTS, AIL_RE, tgt } from "./lex.mjs";
import { reactWrap, src_strip } from "../effects-parse.mjs";

export const rules = [

  // ── 异常状态施加 ────────────────────────────────────────────
  // "3回合攻击命中40%烧伤"（句首回合窗剥除后残文"攻击命中N%X"）。放在 ailment-01 前面，那条的动词前缀不含「命中」。
  { id: "ailment-01a",
    re: new RegExp(`^(?:攻击)?命中${NUM}%(?:的?(?:几|概)?率)?(?:令|使|让)?(?:对方|对手|敌方)?(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: pct(m[1]) }] }),
  },
  { id: "ailment-01",
    re: new RegExp(`^(?:命中后|命中时|命中则|攻击|使用技能|技能使用成功时)?(?:有)?${NUM}%?(?:的?(?:几|概)?率)?(?:随机)?(?:令|使|让)(对方|对手|敌方|自身|自己|本方)(${AIL_RE})(?:状态)?(?:在?(\\d+)回合内?)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: tgt(m[2]), ...(m[1] !== undefined ? { chance: pct(m[1]) } : {}), ...(m[4] ? { turns: num(m[4]) } : {}) }] }),
  },
  { id: "ailment-02",
    re: new RegExp(`^(?:有)?${NUM}%?(?:的?(?:几|概)?率)?(对方|对手|敌方|自身|自己|本方)(${AIL_RE})(?:状态)?(?:在?(\\d+)回合内?)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: tgt(m[2]), ...(m[1] !== undefined ? { chance: pct(m[1]) } : {}), ...(m[4] ? { turns: num(m[4]) } : {}) }] }),
  },
  // "所有技能有N%几率令对手X"（魂印语境：每击附带概率异常——react trigger12 payload，chance 注入）
  { id: "ailment-03",
    re: new RegExp(`^(?:自身|自己)?(?:所有|任何|全部)?技能(?:有)?${NUM}%(?:的?(?:概率|几率))?(?:令|使|让)(对方|对手|敌方|自身|自己|本方)(${AIL_RE})(?:状态)?(?:在?(\\d+)回合内?)?$`),
    go: (m) => { const r = reactWrap(12, {}, `令${m[2]}${m[3]}${m[4] !== undefined ? `在${m[4]}回合` : ""}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = pct(m[1]); return r; },
  },
  { id: "ailment-04",
    re: new RegExp(`^(?:命中后)?(?:${NUM}%)?(?:的?(?:概|几)?率)?(?:令|使|让)(对方|对手|敌方)(?:陷入|进入)(${AIL_RE})状态?(?:(\\d+)回合)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[3]], target: "opponent", ...(m[1] !== undefined ? { chance: pct(m[1]) } : {}), ...(m[4] ? { turns: num(m[4]) } : {}) }] }),
  },
  { id: "ailment-05", re: new RegExp(`^必定(?:令|使|让)(?:对方|对手|敌方)(${AIL_RE})(?:状态)?$|^100%(?:的?(?:概|几)?率)?(?:令|使|让)(?:对方|对手|敌方)(${AIL_RE})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1] ?? m[2]], target: "opponent" }] }) },
  { id: "ailment-06",
    re: new RegExp(`^(?:命中后)?(${AIL_RE})(?:对方|对手|敌方)?(?:(\\d+)回合)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "opponent", ...(m[2] ? { turns: num(m[2]) } : {}) }] }),
  },

  // "让对方防御等级-2"/"50%让对方速度等级-1"（动词「让」不在 ailment-07 的动词表里）。放在 ailment-07 前面。
  // "必定让对方速度等级-1"（p1-ail-01 的签名不带「必定」）。放在 p1-ail-01 前面。
  { id: "p1-ail-00", re: new RegExp(`^必定让(对方|对手|敌方)(${STAT_RE})(?:的)?(?:等级)?([+-])${NUM}$`), go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[2]], delta: (m[3] === "-" ? -1 : 1) * num(m[4]), target: "opponent" }] }) },
  { id: "p1-ail-01",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?让(对方|对手|敌方)(${STAT_RE})(?:的)?(?:等级)?([+-])${NUM}$`),
    go: (m) => ({ effects: [{ op: "apply_stat_stage", stat: STATS[m[3]], delta: (m[4] === "-" ? -1 : 1) * num(m[5]), target: "opponent", ...(m[1] !== undefined ? { chance: pct(m[1]) } : {}) }] }),
  },

  // 旧式"N%改变<侧><stat…>(等级)?±M"——stat 可并列（、，或空连写）；多组逐组展开；尾部悬空 stat 组通过 dynStage 续接下一 part
  { id: "ailment-07",
    re: new RegExp(`^(?:${NUM}%(?:的?(?:几|概)?率)?)?(?:改变|令|使)(?:到)?(自身|对方|对手|自己|敌方|目标|已方|本方|自身自身)(.+)$`),
    go: (m) => {
      const side = /^(?:对方|对手|敌方)$/.test(m[2]) ? "opponent" : "self";
      const pct = m[1] !== undefined ? num(m[1]) : undefined;
      const segRe = new RegExp(`(${STAT_RE}|特殊攻击|战术攻击|双攻|双防|全属性|所有属性|所有能力|[0-5])(?:的得|的呢|的)?(?:等级|等)?([+-]?)${NUM}`, "g");
      const hits = [...m[3].matchAll(segRe)];
      const statOf = (k) => k === "双攻" ? ["atk", "spa"] : k === "双防" ? ["def", "sdf"] : k === "全属性" || k === "所有属性" || k === "所有能力" ? ALL_STATS : k === "特殊攻击" ? ["spa"] : k === "战术攻击" ? ["atk"] : /^[0-5]$/.test(k) ? [STAT_CODES[num(k)]] : [STATS[k]];
      if (hits.length === 0) {
        // 纯 stat 串无 delta（"改变自身攻击"——delta 在被逗号切走的下一 part）→ dynStage 挂起
        const dm0 = m[3].match(new RegExp(`^[、,，或和\\s]*((?:${STAT_RE}|特殊攻击|战术攻击)(?:[、,，或和\\s]+(?:${STAT_RE}|特殊攻击|战术攻击))*)[、,，或和\\s]*$`));
        if (!dm0) return null;
        const stats0 = [...dm0[1].matchAll(new RegExp(STAT_RE + "|特殊攻击|战术攻击", "g"))].map((x) => ({ 特殊攻击: "spa", 战术攻击: "atk" }[x[0]] ?? STATS[x[0]])).filter(Boolean);
        return stats0.length > 0 ? { effects: [], dynStage: { side, stats: stats0, ...(pct !== undefined ? { chance: pct } : {}) } } : null;
      }
      const hitFx = [];
      for (const h of hits) {
        const k = h[1];
        const names = statOf(k);
        let d = num(h[3]); if (h[2] === "-") d = -d;
        for (const st of names) hitFx.push({ op: "apply_stat_stage", stat: st, delta: d, target: side, ...(pct !== undefined ? { chance: pct } : {}) });
      }
      // 尾部悬空 stat（"改变自身攻击，特攻等级1" 逗号切开——第一段只有 stat 无 delta → 记 side+pending stats）
      const rest = src_strip(m[3], hits);
      const dm = rest.match(new RegExp(`^[、,，或和\\s]*((?:(?:${STAT_RE}|特殊攻击|战术攻击)[、,，或和\\s]*)+)$`));
      // 守卫：命中全是数字 stat 码（"威力低于100" 的 "0"→码0）且残文仍有实质词汇 → 非 stat 文本被误拆，整体放弃
      // （真实 stat 名命中时容忍尾缀"级/点/个/体力"等，保持旧式宽容行为）
      if (!dm && hits.every((h) => /^[0-5]$/.test(h[1])) && /[\u4e00-\u9fff]/.test(rest.replace(/[、,，或和\s级点个层]/g, ""))) return null;
      // 「100%使对手20」「额外增加50点」：数字 stat 码与数值粘连，delta 读成 0。原文缺字，不猜哪一维、几级。
      if (hits.some((h) => num(h[3]) === 0)) return { unparsedReason: "stat stage delta 0 — stat code fused with number (source text truncated)" };
      const dangling = dm ? [...dm[1].matchAll(new RegExp(STAT_RE + "|特殊攻击|战术攻击|[0-5]", "g"))].map((x) => statOf(x[0])).flat().filter(Boolean) : [];
      // 同段悬空 stat（"攻击、特攻等级+2" 里 攻击 共享末组 delta）直接补齐；跨 part 悬空（逗号切开）记 dynStage
      const effects = [];
      if (dangling.length > 0) {
        const last = hits[hits.length - 1];
        let d = num(last[3]); if (last[2] === "-") d = -d;
        for (const st of dangling) effects.push({ op: "apply_stat_stage", stat: st, delta: d, target: side, ...(pct !== undefined ? { chance: pct } : {}) });
      }
      // 悬空 stat 在原文中位于带 delta 组之前——按原文序排放
      return { effects: [...effects, ...hitFx] };
    },
  },
];
