// w08 家族：出战背包。只放这一类句子，匹配循环、order.mjs、schema 不动。
//
// 全量核对（`scratch/parallel/w08-probe.mjs`、`scratch/parallel/r2c-probe.mjs`，只读）后本类
// **只有一种形态**：技能侧 53780 条效果文本里「出战背包」0 命中；含「背包」的恰好 7 条，全是
//   「自身背包内每(存活|阵亡)N只精灵则X%的(概率|几率)强化效果翻倍」（6 种字面）。
// 除此之外技能侧含「背包」的句子一条都没有——「背包内每额外拥有」「背包内每存在一种三兄弟」
// 等只出现在攻略散文（`obtainText`/`text`）里，不进 `skills[].effect`。
//
// r2c / r3b 结论：这一档落地的形状是**挂在 `deltaMulChance` 上**，不另发 op、不另插 periodic：
//   `apply_stat_stage` 的正 delta 条目加 `deltaMulChance = { chance: X, numerator: 2, denominator: 1,
//   perBench: { of: "alive"|"dead", per: N } }`。判定概率 = min(100, X × max(1, ⌊背包计数 / N⌋))
//   ——背包计数 0 时保底一次 X% 判定；计数读法与 `ops/effects.ts` 的 `dmgOutPctOf` 同一份
//   （`bench` 存活/阵亡，banished 的槽位两边都不计）。读法在 `ops/stat-stage.ts` 的
//   `benchMulChanceOf`，schema 键在 `content/schemas/moves.schema.json` 的 `deltaMulChance.perBench`。
//   这个形状与裸句 `timed-45`（`30%概率强化效果翻倍` → 同键无 perBench）同构，所以命中本句时
//   宿主整句里原来那条「强化效果翻倍」子句的留档消失、**其它 effect 的种类与次序逐字不变**。
//
// 顺序契约：`batchE26` 排在 `batchW08` 之前，`e26-df-02` 的 `/^背包|背包内|己方背包/` 会整面兜住
// 这 7 句，所以放行必须写在 `e26-df-02` 的 `go` 里（它的 `re` 不动）——`re` 收窄会把
// `背包内每少携带`/`背包内每存在`/`背包内每有一` 等形态直接放到 no-rule。
// 本表保持本文件；现状由 tests/battle-core/parser/add-effect-w08.test.ts 与
// tests/battle-core/parser/add-effect-r3b.test.ts 锁住。
import { NUM, num } from "./lex.mjs";

// 计数前缀：`(自身|己方)?背包内每(存活|阵亡)N只精灵则`——`NUM` 自带捕获组，N 落在 m[2]。
const BENCH = `(?:自身|自己|己方|我方)?背包内每(存活|阵亡)${NUM}?只精灵则`;

export const rules = [
  // "自身背包内每存活/阵亡N只精灵则X%的(概率|几率)强化效果翻倍" → 正 delta stage 的 deltaMulChance 带背包计数
  // N 省略（"背包内每存活只精灵"）按每 1 只；X% 是可选的（省略=100%，概率键要求 ≥1）
  { id: "w08-bench-stage-01",
    re: new RegExp(`^${BENCH}(${NUM})%的?(?:概率|几率)强化效果翻倍$`),
    go: (m) => ({ attachAll: { stageChanceMul: num(m[3]), bench: { of: m[1] === "阵亡" ? "dead" : "alive", per: num(m[2] ?? "1") } } }),
  },
  // 省略「的」与概率词：「…则50%强化效果翻倍」
  { id: "w08-bench-stage-02",
    re: new RegExp(`^${BENCH}(${NUM})%强化效果翻倍$`),
    go: (m) => ({ attachAll: { stageChanceMul: num(m[3]), bench: { of: m[1] === "阵亡" ? "dead" : "alive", per: num(m[2] ?? "1") } } }),
  },
  // 省略概率：「…则强化效果翻倍」（按 100% 判定，仍随背包计数保底一次）
  { id: "w08-bench-stage-03",
    re: new RegExp(`^${BENCH}强化效果翻倍$`),
    go: (m) => ({ attachAll: { stageChanceMul: 100, bench: { of: m[1] === "阵亡" ? "dead" : "alive", per: num(m[2] ?? "1") } } }),
  },
];
