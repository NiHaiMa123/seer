# M3-02 执行报告：Belief 隐藏世界采样 + Knowledge 机制图

日期：2026-09-27。基线：`cf319e5`（M3-01）。

## Belief（`belief.ts`）

synthetic 规则下对手**隐藏维度只有两个**：bench 组成（公开只见 `benchAlive` 数量）+ PP 状态（`ppEstimate` 恒 unknown → 未揭示招可能耗尽）。moveset/stages/effects/mode/revives 全公开——**不进 belief**（如实不假装有更多信息维度）。

| 语义（AGENT.md §3） | 实现 |
|---|---|
| ≤16 样本与历史一致 | benchCombos(benchAlive) × moveSubsets(⊇revealed) 全组合，seeded 均匀+随机补样 |
| 未见动作非零概率 | moveSubsets 枚举未揭示招的全部 2^n 保留/耗尽组合 |
| 新揭示 → 后验收窄 | update 按 observation hash 幂等重算；revealed 变化自动收窄组合 |
| 矛盾样本淘汰 | `eliminate(predicate, reason)`——全淘汰 → reset 宽 prior + modelErrors+1 + resets[] 归因记录 |
| 确定性 | 同 (pack, obs, seed) → canonical 相同样本集（DeterministicRng 派生 seed） |
| 策略先验 | policyClass ∈ {aggressive,defensive,control,baseline} 轮转覆盖——M3-03 联合搜索用 |

## Knowledge（`knowledge.ts`）

`mechanismOf(moveId)`：move → 机制图（clear_stages/transfer_stages/priority/control/cleanse/damage/heal/fixedOrPercent）。`counterplayFor`：五类干预 × 真实 op 匹配——替换了 M3-01 的字面正则 hack。

## 接入

`BattleAgent({useBelief:true})` → 每步 `belief.update(obs)` 样本作为 simulate_batch hypotheses（消融变量：baseline 满配置 vs belief 采样）。

## 过程修正

- `rng.below` 笔误 → `drawBelow`（查 rng.ts 实际 API）
- 测试 fixture 臆测 `purge-mind`=clear_stages——**真实 op 是 cleanse**；clear_stages 在 `syn-purge` 上。测试改按真实数据
- `toBe` 引用相等 → canonical 值相等（lastKey 缓存返回同值新对象）

## 验收 `pnpm test:agent` = **24/24**（+12 belief/knowledge）

benchAlive 精确约束、揭示招⊆样本、确定性、幂等、淘汰/reset/modelError 归因、策略类覆盖、机制图 op 正确、counterplay 只挑真实 op、useBelief agent 完赛。typecheck/boundaries PASS。

## 边界

belief 不做"对手会怎么想"的策略后验更新（只采样世界状态）——策略推理在 M3-03 planner 联合动作搜索里。counterplay 启发式不声称穷尽（机制图按 op 覆盖，opaque handler 仍靠有界模拟）。
