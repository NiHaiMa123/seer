# M3-01 执行报告：agent 工具层 + deterministic baseline

日期：2026-09-27。基线：`8d20ce6`（M2 收官）。

## 产出（`packages/agent/`）

| 组件 | 说明 |
|---|---|
| `views.ts` | `AgentView`/`SubmitFn` 结构接口——agent 包**不 import @seer/host**，任何满足形状的对象可注入（in-process/HTTP/mock） |
| `simulate.ts` | `assumedState`：公开 Observation + hypotheses → CoreState（对手隐藏字段只来自显式假设）；`simulateBatch`：hypotheses×candidates×对手合法集 推演，预算硬上限，响应全整数（koRateBps/expectedHpSwingMilli——canonicalJson 兼容） |
| `tools.ts` | `ToolServer`：8 工具分发；tool.schema.json Ajv strict 先验（未知字段拒绝）；`callCount`/`transitionsSpent` 计量点为 M3 预算门禁预备 |
| `baseline.ts` | deterministic rule 策略：KO 优先 → 低血回复 → max expectedHpSwing → 字典序兜底；replacement 选最低存活 bench；无 LLM 无 RNG |
| `agent.ts` | `BattleAgent`：decision 驱动 step/run，幂等 key 含 side，**提交被拒不记 decided**，lastError 可查 |

## 过程抓到的真实 bug

1. **幂等 key 跨侧碰撞**：两侧同决策同动作 → 同 key → 后提交方 `UNAUTHORIZED`（key 属对方）→ key 加 side 前缀
2. **`canonicalJson` 拒浮点**：koRate/expectedHpSwing 是小数 → 全部改整数 bps/milli
3. **公开事件是扁平 union**：字段在事件上不在 `detail`——explainTrace 重写 + 无 seq（公开流 seq 在包装层）
4. **schema 严格**：`battleId` 必须 `btl_` 前缀、`rulesetHash` 必须 `sha256:` 64hex、lookup_rule 也要 battleId

## 验收 `pnpm test:agent` = **12/12**

- schema 边界：未知工具/字段/hypotheses>16/candidates>8/budget>2048 全拒
- simulate：同请求 canonical 字节一致；**前后 host state canonical 不变、事件数不变**（不触真局实证）；假设可覆盖对手隐藏招
- lookup_rule/explain_trace/calculate_damage：公开数据可查、trace 无内部字段扫描通过、伤害整数值与手算一致
- baseline：replacement 选最低 bench、双 baseline 对局完赛终局一致、每决策至多一次提交、v1 pack 兼容

## 边界（明确不做）

Belief 多样本后验、joint-action beam、ModelProvider、deadline/fallback、60 状态评测——依次在 M3-02~05。当前 baseline 用"对手满配置"单一假设，是最弱基线（消融组底层）。
