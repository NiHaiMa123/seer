// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num } from "./lex.mjs";

export const rules = [
  // ── moveFlags ────────────────────────────────────────────────
  { id: "flags-01", re: /^必中$/, go: () => ({ flags: { accuracy: "always" } }) },
  { id: "flags-02", re: new RegExp(`^先制(?:额外)?([+-]?)${NUM}$|^额外先制([+-]?)${NUM}$`), go: (m) => { const s = m[1] ?? m[2]; const v = num(m[0].match(/\d+/)?.[0] ?? "1"); return { flags: { priority: s === "-" ? -v : v } }; } },
  // "遇天敌先制+3"（"遇"省字；天敌=对手克制我方）。放在 flags-02 后面，那条要求句首「先制」。
  { id: "flags-02b", re: new RegExp(`^遇(?:到)?天敌(?:时|则)?先制([+-]?)${NUM}$`), go: (m) => { const v = num(m[2]); return { flags: { priorityIf: { when: { foeCountersUs: true }, add: m[1] === "-" ? -v : v } } }; } },
  // "先制等级+1"（flags-02 的签名里没有「等级」二字）。放在 flags-03 前面。
  { id: "p1-flags-01", re: new RegExp(`^先制(?:等级|级别)([+-])${NUM}$`), go: (m) => ({ flags: { priority: (m[1] === "-" ? -1 : 1) * num(m[2]) } }) },
  { id: "flags-03", re: /^先手技能$/, go: () => ({ flags: { priority: 1 } }) }, // UNVERIFIED：先手技能≈先制+1
  { id: "flags-04", re: /^组队时(?!.*(?:任意|影响|作用|目标|队员|精灵))/, go: () => ({ ignored: true }) },
  { id: "flags-05", re: /^该技能(在)?战斗中(需要|需)通过/, go: () => ({ unparsedReason: "soulmark-gated" }) },
  // 以及/顿号已经把防御半句切开。只吃残句。及/和粘连、带概率、以及「速度能力提升」不是排序旗标。
  { id: "flags-06", re: /^无视对手速度$/, go: () => ({ flags: { ignoreFoeSpeed: true } }) },
];
