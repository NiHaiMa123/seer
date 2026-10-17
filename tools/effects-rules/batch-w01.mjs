// 家族文件只在 go() 运行时调用解析器。加载期 re: 只用 ./lex.mjs。顶层禁止调用 parseEffectText / condOf / reactWrap。
// seer-w01：只做「(若)被(对手)击败(，)则对手损失 N (点)体力」这一类整句（含省写「点」的变体）。
//
// 这类句子当前有两种落地：
//   1) 逗号形（"3回合内若被对手击败，则对手损失500体力"）——没有任何规则认，整句 no-rule；
//   2) 则形（"若被对手击败则对手损失500体力"）——heal-216 认了触发头，但 payload「对手损失N体力」
//      （无「点」）没有规则认，整句以 "react payload unparsed" 记未解析。
// 两处都是同一个缺格：`对手损失N点体力`（heal-54 / e33-loss-01）在省写「点」时不匹配。
//
// 复用既有格子：react{trigger:5} + payload 一笔 fixed damage（与 heal-216 落成的形状逐字一致），
// 不新增 op、不新增状态名、不新增 params 键。回合窗由外层 partTurns/ctxTurns 照常注入。
// 有逗号的整句与无逗号的整句都收在本条里：外层解析器把逗号形整段交给规则，规则自行认领，
// 不改 effects-parse.mjs 的通用续接。
import { num } from "./lex.mjs";

export const rules = [
  // "若被(对手)击败则对手损失N点体力"（"点"可省，"则"前的逗号可省，"若"/"被…"可省）
  // 只认整句：触发头与损失尾句必须同现（半句仍留给 heal-216 / batch-e5c-41 的触发头通道）。
  {
    id: "w01-ko-loss-01",
    re: /^若?被(?:对手|对方|敌方)?击败[，,]?则(?:对手|对方|敌方)损失(\d+)点?(?:体力值?|HP)$/,
    go: (m) => ({
      effects: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
        payload: [{ op: "damage", kind: "fixed", power: num(m[1]), target: "opponent" }],
      }],
    }),
  },
];
