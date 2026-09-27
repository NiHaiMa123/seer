# M3-04 执行报告：ModelProvider + 提案管线 + deadline/fallback

日期：2026-09-27。基线：`b74ec84`（M3-03）。

## `provider.ts`

`ModelProvider.generate(request, signal)` 唯一入口：
- `EchoProvider`：离线确定性 mock（prompt 正则取合法动作）+ `inject` 钩子供错误注入
- `OpenAiProvider`：OpenAI-compatible `/chat/completions` adapter——endpoint/model/credentialRef 分离配置；**credentialRef 只收环境变量名**（构造时校验存在，值永不进配置/日志/提示）
- `capabilities()`：toolCalls/jsonOutput/cancelable/contextTokens——adapter 如实声明进缓存键

## `llm.ts` — LlmPolicy + DecisionClock

预算（本机 monotonic，LOCAL_BUDGET 10s/4s/3s/1s）：模型 ≤4s、校验+提交保留 1s、模型调用 ≤2（含 1 修复）、输入 ≤12000/输出 ≤2000 tokens。

管线：buildPrompt（**只含公开字段**——测试断言无 seedHex/drawCounter/inbox/ppEstimate）→ generate（**Promise.race 预算超时——不假设 provider 遵守 AbortSignal**）→ extractJson → actionId ∈ legalActions 校验 → ≤1 次修复重试 → fallback = 预计算的 decideBaseline。

## 过程抓到的真实 bug

1. **AbortSignal 信任错位**：abort 只发信号不取消 provider 内部 promise——mock 挂起测试实测 5s 超时暴露。修：Promise.race(预算超时)。**这是对远端 provider 正确的健壮语义**
2. EchoProvider 正则 `[a-z0-9-,\s]` 漏 `_` → `act_syn-strike` 截成 `act` → 非法动作
3. TS 参数属性（`constructor(private readonly x)`）撞 strip-only——三处改显式字段（全仓 grep 清零）

## 接入

`BattleAgent({policy:"llm", provider})` + `stepAsync()`——LLM 消融组的入口。

## 验收 `pnpm test:agent` = **42/42**（+10）

llm/llm-repaired/fallback 三路径、非法 actionId 拒绝、provider 挂起超时 <3s 兜底、≥3 模型调用 cap、reserve 内零调用、token 记账、credentialRef 拒绝值/缺失 env、prompt 无隐藏字段扫描、llm agent 完赛。回归 111 + boundaries PASS。

## 边界

- 无真实模型调用证据（全 mock）——M3-05 评测仍以 mock 管线跑，真实 provider 增益数据需用户提供 endpoint
- prompt 构建是最小版（无机制图/历史注入）——Skill 检索增强在 M3-05 消融参数
- 迟到丢弃语义由 decided+idempotency 兜底（Host 侧已证幂等），未做 wall-clock 竞态测试
