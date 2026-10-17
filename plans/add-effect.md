# 加一条效果

日期：2026-10-13。状态：规则已落地。已加 15 条。最新六条：`e33-half-02a`（自身受特攻伤害减半）、`heal-162a`（令对手当回合体力恢复效果减少 N%）、`attach-all-11b`（固定加上 N 点固定伤害）、`attach-all-13a`（N% 加 M 点固定伤害）、`e34-cshield-01a`（消耗自身的护盾并附加等量的固定伤害）、`e31-dh-03a`（受到的所有类型伤害的 N/M 转化为自身体力）。「每消除 N 级附加 M 点」单独成句没有清除宿主，没有加。

这是加技能或魂印时的操作顺序。触点上限仍是 [touch-budget.md](touch-budget.md)。扩展清单第 4 节要求加一条 golden；加效果时以本文件为准，不重生成 `tests/fixtures/parser-golden.json`。

一次只加一条。这条没走完，不开始下一条。

## 规则

1. 先用已经有的格子写。技能用现有 op、`periodic` 加已有的 `win`、或已有 rider。魂印用 `{ hook, guard, chance, bossGate, ops, elseOps }`。写不出就留 `unparsedReason`。不新加旗标、`params` 键或结算分支。
2. 技能只改对得上的家族文件，在 `tools/effects-rules/order.mjs` 里把这条放在同家族宽规则之前。不改 `tools/effects-parse.mjs` 的匹配循环，不改其他家族的相对顺序。魂印只改 `tools/soulmark-parse.mjs` 里对得上的那一处，并改这一只已经存好的条目。不整库重跑 `node tools/soulmark-parse.mjs`。
3. 加一条只针对这句的断言。不手改覆盖率 JSON。
4. 然后只把这一条规则的 id 写进 `tests/fixtures/effects-rule-order.json`，位置和 `order.mjs` 里一致。先跑这句的测试，再跑规则顺序测试。顺序测试失败，就是截走了旧句子：撤回这一条，不继续加。

## 开加之前

顺序快照已按当前 `RULES` 重写。共有的 id 相对顺序没变。快照里多出的 `batch-e6-82` 在 `tools/effects-rules/batch-e6.mjs` 中已经没有，邻居仍是 `batch-e6-81` 和 `batch-e6-83`。这次只补齐，没有加新效果。
