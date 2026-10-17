// w10 家族：能力等级历史回溯。只放这一类句子，匹配循环、order.mjs、schema 不动。
// 语料唯一形态：「(先|后)出手时将自身能力等级返回至上一回合结束时」。
// 结算靠每回合已存的 turnStartStages 快照（ops/slots/w10.ts 直读，无新 op、无新状态名）。
import { NUM, num } from "./lex.mjs";

// "先出手时/后出手时"只是出手序前缀，非效果条件——命中即剥除。
// 唯一承重片段是"将自身能力等级返回至上一回合结束时"：时点由"上一回合结束时"钉死，
// 不随前缀改写；前置谓词由解析器按上下文补进 e.if（整段只有这一句时才成孤儿谓词）。
const BODY = "将自身能力等级返回至上" + NUM + "回合结束时";

export const rules = [
  { id: "w10-rewind-01", re: new RegExp(`^(?:(?:先|后)出手时)?${BODY}$`), go: (m) => ({
    effects: [{ op: "stages_rewind", target: "self", turns: num(m[1]) }],
  }) },
];
