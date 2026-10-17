// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// batch-e22：魂印长尾第十六批——受击中概/附带概率/每异常吸取/下只登场异常/概率区间保残。
import { NUM, num, frac, AILMENTS, AIL_RE, STATS, STAT_RE, ALL_STATS } from "./lex.mjs";

const AIL = (w) => AILMENTS[w] ?? w;
import { parseEffectText, reactWrap, resolveCond } from "../effects-parse.mjs";

export const rules = [

  // ── 受击概率 ────────────────────────────────────────────
  // "(自身)?受到攻击(伤害)?有N%(的几率)?令对手AIL" → react + chance payload（"自身受到攻击伤害有50%的几率令对手烧伤"）
  { id: "e22-rf-01",
    re: new RegExp(`^(?:自身|自己)?受到(?:攻击|攻击伤害|伤害)有(\\d+)%(?:的)?(?:概率|几率)(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => { const r = reactWrap(1, {}, `令对手${m[2]}`); if (r.effects?.[0]?.payload !== undefined) for (const p of r.effects[0].payload) p.chance = +m[1]; return r; },
  },
  // "附带N%几率令对手AIL" → chance 异常（"附带15%几率令对手睡眠"——附带=附加通道连词）
  { id: "e22-al-01",
    re: new RegExp(`^(?:附带|附加|并)有?(\\d+)%(?:的)?(?:概率|几率)(?:使|令)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "opponent", chance: +m[1] }] }),
  },
  // "(每次)?击败对手则有N%令对手下只登场精灵进入AIL" → foeFainted+nextFoe+chance（"每次击败对手则有50%令对手下只登场精灵进入害怕"）
  { id: "e22-nx-01",
    re: new RegExp(`^(?:每次)?击败(?:对手|对方|敌方)则(?:有)?(\\d+)%(?:的)?(?:概率|几率)?令(?:对手|对方|敌方)下只(?:登场|出战)?精灵进入(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[2]], target: "nextFoe", chance: +m[1], if: { foeFainted: true } }] }),
  },

  // ── 未建模归桶 ──────────────────────────────────────────
  // "对手每处于一种异常状态则(攻击技能)?吸取对手N点体力" → per-ailment drain 未建模
  { id: "e22-df-01",
    re: new RegExp(`^(?:对手|对方|敌方)每处于一种?异常(?:状态)?则?(?:攻击技能|攻击)?(?:吸取|吸收)(?:对手|对方|敌方)?${NUM}点(?:体力|HP)?$`),
    go: () => ({ unparsedReason: "per-ailment drain — flatPerAilment drain channel unmodeled (deferred)" }),
  },
  // "(N%-M%)的几率令对手AIL"/"(N%-M%)令对手AIL" → 概率区间未建模
  { id: "e22-df-02",
    re: new RegExp(`^(\\d+)%(?:-|~|～)(\\d+)%(?:的)?(?:概率|几率)?(?:令|使)(?:对手|对方|敌方)(.+)$`),
    go: () => ({ unparsedReason: "chance-range — probability interval unmodeled (deferred)" }),
  },
  // "有自身当前体力百分比(一半)?的概率令对手X" → 当前体比动态概率未建模（chanceSelfMissingPct 仅已损域）
  { id: "e22-df-03",
    re: /^有自身当前体力百分比(?:的?一半)?的?(?:概率|几率)(?:令|使)(?:对手|对方|敌方)(.+)$/,
    go: () => ({ unparsedReason: "dyn-chance self-current-hp — only missing-hp chance modeled (deferred)" }),
  },
  // "(N%)?几率令对手AIL" 无量词几率 → 先落 chanceVar 占位 op；后续"几率等同于自身当前体力百分比"尾句可填实
  //（chanceSelfCurPct），无尾句时 sanity sweep 统一归 deferred
  { id: "e22-df-04",
    re: new RegExp(`^(?:有)?几率(?:令|使)(?:对手|对方|敌方)(${AIL_RE})(?:状态)?$`),
    go: (m) => ({ effects: [{ op: "apply_status", name: AIL(m[1]), target: "opponent", params: { chanceVar: 1 } }] }),
  },
];
