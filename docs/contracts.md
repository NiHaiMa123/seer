# 最小契约 v0.2

[contracts.ts](examples/contracts.ts) 是完整、无第三方 import 的 TypeScript 设计示例：BattleState/Observation/Command、内部/公共事件、PluginManifest、EffectDefinition、Agent tools、ModelProvider、Result 错误码与可执行 Command JSON Schema。它不是生产引擎；EffectOp 只示范三个已封闭操作，不假装覆盖切换/复活/所有原作机制。

本轮验证范围见 [validation](validation.md)。完整 wire schemas、类型生成与运行时实现属于 M0。M0 采用 **JSON Schema 为 wire 真源→生成 TS 类型→Ajv 编译校验**；此处手写类型用于评审，迁入正式 contracts 后不得长期维护两份可漂移定义。内部 State 类型不要求直接外发。

## 1. 身份、版本与选招

`Command` 没有 actor/side 字段；session/connection 决定玩家身份，Host 校验战局成员与当前 decision。`actionId` 是该玩家该 decision 的合法动作引用，不是任意脚本或任意伤害值。actionId 不是凭据；Host 仍验证归属。

| 字段 | 语义 |
|---|---|
| schemaVersion | wire 主版本；不兼容版本拒绝，不猜字段 |
| battleId | 对局路由，不能用来绕过 ACL |
| decisionId | 独立决策窗口，包含换人等非普通回合 |
| baseRevision | 创建窗口时的已结算 revision；双方共用 |
| idempotencyKey | 按 authenticated principal + battleId 唯一；保存请求 canonical digest 与 receipt |
| actionId | 当前 decision 给此 side 的动作 ID |

处理顺序：认证/成员验证 → Schema → 幂等历史查询 → 当前 decision/revision/deadline → actionId 合法 → 事务写 inbox/receipt → ACK。**精确重复应在过期检查前返回原 receipt**，否则超时重传会被错判。相同 key 不同内容返回 IDEMPOTENCY_CONFLICT。不同 key 重选返回 ALREADY_SUBMITTED；M1 不支持改招。

inbox 的 private revision 不等于 BattleState.revision。双方收齐后一次推进；终止/规则故障也会结束或冻结 decision。Timeout 是 Host 内部 resolved input，公共用户不能伪造 origin=timeout。

## 2. 消息与重连

HTTP：`POST /v1/battles/:id/commands`、`GET /v1/battles/:id/observation`；WS 仅推送按玩家投影的 events 或 resync-required。每条推送带 battleId、wire version、view cursor；没有内部 seq。命令使用 HTTP 便于幂等，后续 WS 命令 adapter 可复用同一 service。

public cursor 只为该视角实际发送的事件递增，不能用内部 seq 的跳号暴露隐藏事件数。重连携带 lastViewCursor；保留窗口不足返回新的 Observation + cursor，客户端原子替换后接增量。响应不包含对手 inbox、内部 hash、RNG、private causeId。传输最多 64 KiB command、1 MiB observation（初始预算，M0 记录），超限拒绝；有界队列溢出触发重同步而非无限缓存。

`OwnUnit` 显式列出己方数值/效果/强化，M0 按 synthetic 机制补齐字段语义；VisibleOpponent 的 unknown/bucket/exact 是显式 union，不把未知填 0。RulesRef 只有公开规则工件摘要；秘密队伍配置不包含在 contentHash 中，属于私有 match snapshot。

## 3. 投影与非干扰

Authority 内部 Event 与 public BattleEvent 独立定义；禁止对象 spread 后删两个字段。按规则 visibility policy 从事实重建公共事件与公开状态。renderer 消费公共事件，动画本地生成。

非干扰测试：两份私有 state 在对方未揭示配招、PP、RNG、隐藏效果不同，但合法可见历史相同；各自 observe/trace/history/legal_actions 的 canonical 输出必须相同（除去请求 ID、剩余时限等 transport metadata）。模拟器使用传入相同假设时输出相同，不得读入两份真实 state。未来事件实际揭示秘密后，观察才可以不同。

## 4. Simulator 工具

`SimRequest` 输入 observation + hypotheses + 候选 + 独立 seed + budget，不接受真实 snapshot ID。服务先校验规则/内容版本与假设自洽；无法补齐的数值必须要求明确假设或返回错误，不默默使用真实 DB。输出 assumptions/transitionsUsed/truncated 与统计；不把估计说成真实未来。深层策略的信息集限制见 agent.md。

同进程内部 fixture simulator 可取 BattleState，但只在 headless 测试/基准入口。生产 AgentTools 不导出这个函数。MCP adapter 用同一工具 Schema，加标准结构化结果；工具失败与 transport 失败分开，不绕过 Host。

## 5. 错误与恢复

| 代码 | 语义 / 处理 |
|---|---|
| INVALID_SCHEMA | 拒绝未知字段/范围/类型；改请求，不原样重试 |
| UNAUTHORIZED / NOT_FOUND | 无权玩家不返回对局存在/隐藏细节；统一对外响应策略 |
| STALE_DECISION | 重新观察；不可将旧候选自动投到新窗口 |
| ILLEGAL_ACTION | 当前己方动作不合法；不透露对手秘密原因 |
| ALREADY_SUBMITTED | 此窗口已锁招；查本人的 receipt |
| IDEMPOTENCY_CONFLICT | 相同 key 异内容；调用端错误 |
| DEADLINE_EXCEEDED | 窗口过时；Host timeout policy 已接管 |
| BUDGET_EXCEEDED | 搜索/工具预算耗尽；合法 baseline |
| RULESET_MISMATCH / UNSUPPORTED_OPERATOR | 阻止加载/模拟；修内容，不忽略 |
| ARTIFACT_UNAVAILABLE | 旧回放工件缺失；不能用最新版代跑 |
| PLUGIN_IN_USE | drain 后再卸载 |
| ENGINE_FAULT | 保存诊断并冻结局；不发奖；无内部堆栈出网 |
| PROVIDER_UNAVAILABLE | 在预算内一次修复或 fallback |

所有错误只带安全 code/retryable/requestId；细节在受限私有诊断。retryable 不是无限重试许可，总 deadline/次数仍有效。

## 6. 插件与 handler 合同

PluginManifest 的 requestedCapabilities 不自动授权；entrypoints 只允许已安装 bundle 内的规范化路径。PluginContext 是 Seer API，不是 Cordis 原生签名；适配层映射 require/register/own，负责拒绝非法阶段注册及清理。

EffectDefinition 示例使用实例目标 ID 演示封闭语义；正式 authoring DSL 使用 self/opponent 等目标选择器，编译/实例化时解析，不能把某局 unitId 写进可复用内容包。M0/M2 区分 authoring AST、compiled definition、runtime effect instance；每层有独立 Schema。handler ABI 只输出 EffectOp，不返回任意 state patch。
