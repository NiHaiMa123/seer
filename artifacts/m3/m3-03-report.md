# M3-03 执行报告：joint-action beam planner

日期：2026-09-27。基线：`ce8c094`（M3-02）。

## `planner.ts`

| 规范（AGENT.md §3） | 实现 |
|---|---|
| 双方同时选招 | root 枚举 own≤8 × opp≤8（opp 合法集来自**假设世界**，非真实推断）；不预设对手动作 |
| 对手策略混合 + worst-case | mean = 全回应均匀 ½ + 策略偏好回应 ½；worst = min over 全回应；选根 worst→mean 破平（保守） |
| 同 belief 样本同 seed | 每个 root 在全部假设样本上评估；policyClass 轮转先验进 oppPick |
| 深度≤2 / beam≤8 / ≤2048 transition | depth2 每节点再展开 ownCap×oppCap；budget 计数硬上限；超限先削 depth2 再削 root 分支，truncations[] 记账 |
| 信息集纪律 | 后续展开用**模拟状态当时的合法集**，不读真局隐藏字段 |
| 挂起 | KO 侧最低存活 bench 自动续跑（guard≤4），不展开 replacement 决策树 |

价值函数（整数、冻结系数）：HP 比例差 ×500 + stage 优势 ±60 + 控制 ±30 + PP 资源 ×50 + bench 差 ×20；终局 ±1000。

## 过程修正

- `applyReplacement` 签名是 `(pack,state,{p1,p2})` 不是 `(pack,state,side,action)`
- `origin:"timeout"` 非法——枚举为 `"timeout_default"`
- `battle.inbox` 是**当前 decision 的单 inbox**（`{p1,p2}` 直连）不是按 decisionId 索引的 map
- 测试 idempotencyKey `kA0xxxx`=7 字符 < minLength 8 → INVALID_SCHEMA 静默死循环

## 验收 `pnpm test:agent` = **32/32**

确定性（同输入→同 action+canonical 同分）、worst≤mean 逐 action 不变量、预算硬上限记账、KO 收敛（worst-case 也判胜）、深度-2 transition 增量验证、planner agent 带 bench 完赛。

## 边界

- replacement 不展开搜索（最低 bench 兜底）
- 对手策略只用 policyClass 启发回应选择，无贝叶斯策略后验
- beam=root 层限宽（深度-2 节点直接全展开），非经典全局 beam——预算内够用，规模上来再换
- oppPick 用 actionId 字面值启发策略类——机制图打分是后续优化点
