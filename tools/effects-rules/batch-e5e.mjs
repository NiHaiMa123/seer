// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
import { NUM, num } from "./lex.mjs";
import { reactWrap } from "../effects-parse.mjs";

export const rules = [
  // ── E5e 批：承伤减免/转化护盾/nextAlly回血/PP归零窗/惩罚族留档 ──
  { id: "batch-e5e-01", re: new RegExp(`^(?:使|令)?自身下(?:一|${NUM}|次)?(?:次|回合)?受到的伤害减少(\\d+)点$|^受到的伤害减少(\\d+)点$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: num(m[1] ?? m[2]), count: 1 } }] }) },
  { id: "batch-e5e-02", re: new RegExp(`^将自身(?:下)?${NUM}次受到的攻击伤害转化为等量护盾$|^受到的攻击伤害转化为等量护盾$`), go: (m) => ({ effects: [{ op: "apply_status", name: "dmg_to_shield", target: "self", params: { count: m[1] !== undefined ? num(m[1]) : 1 } }] }) },
  { id: "batch-e5e-03", re: new RegExp(`^令己方下(?:一|${NUM})?只(?:出场|出战)?(?:的)?精灵(?:出战时)?恢复(\\d+)点体力$|^下一只出战精灵恢复(\\d+)点体力$`), go: (m) => ({ effects: [{ op: "heal", flat: num(m[1] ?? m[2]), target: "nextAlly" }] }) },
  // "对手下N次使用的技能PP值归零" → trigger3 触发 payload：对手 PP 全槽归零
  { id: "batch-e5e-04", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)下${NUM}次使用的技能PP值(?:额外)?归零$|^(?:令|使|让)(?:对手|对方|敌方)下${NUM}个(?:使用|释放)的?技能PP值归零$`), go: (m) => { const ns = m.slice(1).filter((x) => x !== undefined).map(num); return reactWrap(3, { count: ns[0] }, "对手所有技能PP值归零"); } },
];
