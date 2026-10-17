// batch-e52：魂印长尾散件——主语前置净化自身 / 随机PP归零语序变体 /
// 异常回合数扣减留档 / 自身AIL turns 补型已在 e45-05 内扩。
import { NUM, num, AILMENTS } from "./lex.mjs";

const AIL_KEYS = Object.keys(AILMENTS).join("|");

export const rules = [
  // ── 自身解除异常主语前置（"自身解除所处的异常状态"——解除自身X 的同义语序）──
  { id: "e52-01a", re: /^(?:自身|自己)解除(?:所处的|所中的|身上)?(?:的)?(?:所有|全部|所有异常)?异常(?:状态)?$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  { id: "e52-01b", re: /^解除(?:自身|自己)(?:所处的|所中的|身上)?(?:的)?(?:所有|全部)?异常(?:状态)?$/, go: () => ({ effects: [{ op: "cleanse", target: "self", scope: "ailment" }] }) },
  // ── 随机语序PP归零（"随机令对手2个技能PP值归0"——词序变体，令对手随机N个 已建模）──
  { id: "e52-02", re: new RegExp(`^随机令(?:对手|对方|敌方)${NUM}个技能PP?值?归(?:0|零)$`), go: (m) => ({ effects: [{ op: "pp_delta", zeroRandom: num(m[1]), target: "opponent" }] }) },
  // ── 异常剩余回合扣减（"自身所处的异常状态减少N回合"——ailment duration-delta 无 op，显式留档）──
  { id: "e52-03", re: new RegExp(`^(?:自身|自己|对手|对方|敌方)?(?:所处的|所中的|身上)?(?:的)?异常(?:状态)?(?:减少|缩短)${NUM}回合$`), go: () => ({ unparsedReason: "ailment-duration-delta — ailment turn decrement unmodeled (deferred)" }) },
  // ── 使自身AIL裸句补型（"使自身流血"/"令自身害怕"——无回合窗的自身异常常驻）──
  { id: "e52-04", re: new RegExp(`^(?:使|令|让)(?:自身|自己)(${AIL_KEYS})(?:状态)?$`), go: (m) => ({ effects: [{ op: "apply_status", name: AILMENTS[m[1]], target: "self" }] }) },
  // ── 对手技能N%失效（"令对手当回合使用的技能20%失效"——fumble 施加到对手；当回合窗→turns:1）──
  { id: "e52-05", re: new RegExp(`^(?:令|使|让)(?:对手|对方|敌方)(当回合|本回合)?(?:使用的|所用的|所有|全部)?技能(?:有)?${NUM}%(?:的?(?:概率|几率))?(?:无法使用|失效|无效)$`), go: (m) => ({ effects: [{ op: "apply_status", name: "fumble", target: "opponent", params: { pct: num(m[2]) }, ...(m[1] !== undefined ? { turns: 1 } : {}) }] }) },
];
