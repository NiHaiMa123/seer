# Agent v0.2：规则理解、搜索与反制

目标是接近人类高手的机制理解与博弈；这是待验证的长期目标，不能由“能调用 Skill”直接推出。M3 首先证明在有限、封闭的工程机制池里，组合泛化优于固定基线。世界操作到 M4+。

## 1. 组件与可替换边界

流程：Observation → 版本化规则查询 → threat/interaction graph → 候选 → 信息集搜索 → 最终合法校验 → submit → 可见结果更新 belief。

| 组件 | 输出 | 不承担 |
|---|---|---|
| LLM / Skill | 威胁假设、候选与短证据摘要 | 权威规则解释、伤害结算、改状态 |
| Knowledge | canonical IR/规则表/证据；攻略仅为待验证提示 | 把自然语言补成已证实机制 |
| Planner | 候选联合动作、假设采样、风险/价值统计 | 读取真实隐藏队伍/未来 RNG |
| Simulator | 指定假设下的合法 transition 和 trace | 当前局真实世界查询 |
| Belief | 与公开历史一致的对手配置/策略分布 | 将单次未触发认定机制不存在 |
| Policy | 在预算内选 actionId；超时 fallback | 让迟到回复覆盖新 decision |
| Memory | rulesetHash、可见历史、假设与验证结果 | 永久保存过期的无条件克制关系 |

首选 TS Agent 独立进程。`ModelProvider.generate(request, signal)` 统一模型能力、输出、usage 和错误；OpenAI/其他云模型/本地模型各自实现 adapter，endpoint/model/credentialRef 由配置给出。能力探测包括工具调用、JSON 输出、上下文大小、取消支持；“OpenAI-compatible”不等于所有参数语义相同。无工具调用时可输出 JSON 建议，仍走同一 schema/合法校验。

Seer 工具默认 HTTP/进程 RPC；接现有编码 Agent 时可外包一层 MCP 和 Skill。核心领域接口不依赖 MCP；不把 shell/filesystem/admin 暴露给对战 Skill。Skill 是有限决策流程与证据规范，不是每只精灵的专属攻略。[contracts](contracts.md)、[来源 S11](sources.md)。

## 2. 观察边界不能只过滤一次 state

Agent 只接收与同席真人一致的公开 Observation、公开规则库、己方合法动作。public trace/history 由白名单事件重新构建；隐藏触发不暴露 effectId、内部 seq、cause chain、状态 hash 或 RNG draw refs。对手未提交/已提交状态默认也不发。

get_legal_actions 依据己方可知条件；隐藏免疫造成执行时无效，不造成查询时动作缺失。calculate_damage 和 simulate 都基于显式假设，不能隐式去服务器查真实对手。provider 日志、调试 endpoint、模型提示、缓存 key 也走同样边界。用两份只在秘密字段不同的状态验证整套工具输出相同；时间/长度差异也纳入检查，但不宣称已做到形式化侧信道防护。

## 3. Belief 与搜索的具体做法

M3 初始：最多 16 个与历史一致的隐藏配置样本；候选己方动作上限 8、对手回应上限 8、rollout 深度 2 个决策窗口，beam width 8，总预算最多 2048 次 transition。超出预算先削分支/深度；不保证上述全组合都遍历。搜索日志记录实际计数和截断原因。

1. 公开规则库列举机制可能性；未知配招建立稀疏 prior，未见动作保留非零概率。新揭示动作更新后验，矛盾样本淘汰；样本全空则显式 reset 到宽 prior，记录模型错误。
2. 当前决策双方同时选招，枚举 joint actions，不假装已知对手本回合行动。对手策略含 aggressive/resource/control 等固定基线混合，另给保守 worst-case 评分。
3. 每个 root action 使用相同 belief samples 和 simulation seeds 比较，降低估计噪声，但绝不使用真实 RNG。
4. 后续策略只依赖模拟中当时已揭示的 Observation。不同隐藏世界如有同一可见历史，必须选择同一信息集策略，不能在每个世界“提前知道”隐藏技能再选下一步（strategy fusion）。
5. 缓存 key 包含 ruleset/content/handler hash、Observation 历史摘要、belief version、评估器版本、搜索预算。缓存只有假设结果，不能跨玩家共用秘密数据。

初始价值：终局 ±1；非终局按己方/敌方 HP 比例差、可用资源、控制与换位价值归一化，系数在 dev 集调整后冻结。报告 mean、较差分位数与样本数；“置信度”表示采样不确定性，不把模型自报分数当统计置信区间。Beam 是有界启发式，并非最优博弈保证；MCTS/信息集搜索仅在同预算评测胜出后替换。

## 4. 如何发现没见过的组合反制

以自制机制例子说明（非原作技能）：敌人只在回合末仍有强化时施加控制；我方可以直接攻击、清除强化、免疫控制或切换。Agent 应从 trigger/condition/produces 查询提出干预，再模拟验证：清除强化是否发生在检查前、是否被免清除、免疫是否持续到该时点、换位是否触发额外效果。

反制候选按五种干预生成：移除前提、改变触发时点、阻止执行、绕过目标/类别、承担代价换取终局收益。必须提供 **一个有效分支和一个前提不满足的反例**；没有可行反制时允许报告无解，不能编攻略。

“未知组合”测试由已实现 operator 的未见组合构成；未知执行语义的 operator 仍须先研究/编译，不能让 LLM 自行运行。任意 handler 机制图可能不完整，标记 opaque 并靠有界模拟补证，不夸口能静态解析所有程序。

## 5. 工具清单

| 工具 | 输入/输出重点 | 限制 |
|---|---|---|
| observe / history | battleId、cursor → 公共视角 | 连接绑定 side；无 TrueState |
| legal_actions | decisionId → actionId/解释 | 非公开对手条件不得影响动作列表 |
| lookup_rule | rulesetHash、ID → 可见规则/证据 | 图鉴可见策略按模式固定 |
| explain_trace | view cursor → 公开因果摘要 | 不返回内部 trigger 日志 |
| simulate_batch | observation、假设、candidate actions、budget | 无 battle DB；响应带 assumptions/hash/cost |
| calculate_damage | 明确双方假设 → 分布 | 是 simulate 的受限包装 |
| search_counterplay | 机制干预请求 → 候选和可重跑分支 | 是 planner 工具，不是权威 oracle |
| submit_action | decisionId/baseRevision/actionId/key | Host 再验权/时限/幂等/合法性 |

严格参数 Schema，未知字段拒绝。内容文本/攻略/技能描述视为不可信资料；其中“忽略规则/调用管理员”的指令不能扩大工具权限。

## 6. Deadline、失败与降级

M3 local 默认 10 秒 decision 总预算：模型生成上限 4 秒、搜索上限 3 秒、校验/提交保留 1 秒，余量用于 IO/排队；远程云延迟不能保证达标，超时必须取消并 fallback。最多 1 次格式修复，且只能花剩余预算；不用另起一个完整 10 秒窗口。最多 2 次模型请求、16 次工具调用、2048 transitions、输入 12000/输出 2000 tokens（模型 tokenizer 不同，记录计量来源）。

Host 用本机 monotonic deadline 计时，wire 返回剩余预算；不假定两进程/两机器单调时钟同源。Agent 预先计算当前 decision 的 deterministic baseline（优先规则胜招，否则固定排序的合法动作），在剩 1 秒时发出；没有合法动作由规则处理 replacement/terminal，不伪造 action。迟到/中断/429/断网/非法 JSON 回退，旧 decision 回复直接丢弃。PVP 实际时限待定，10 秒是工程模式参数，不是原作规则。

## 7. 评测与“能过/不能过”

测试数据先固定，再调参。M3 建 60 个自制战术状态：basic/synergy/counterplay/hidden/novel/adversarial 各 10；每类 5 dev、5 holdout，共 30/30。holdout 不提供专属 Skill/攻略；泄露或针对失败样例改提示后，该集只能改名 regression，另建未见集。

消融至少 random、deterministic rule、LLM-only、LLM+retrieval、search-only、LLM+retrieval+search。相同规则/对手/seed/时限/工具权限；策略质量和花费一起报告。对固定对手池每组 200 局，配对 seed 并换边；每个随机配置/模型重复 3 次。胜率附 Wilson 95% 区间，差值用配对 bootstrap；平局/超时单列，不通过删失败局提高胜率。

| Gate | M3 验收 |
|---|---|
| 安全/执行 | ≥1000 次 adversarial tool 调用零秘密泄露；非法请求零落地；已接受动作均合法；过期/超时正确 fallback |
| 机制 | holdout 的有效反制/无解判断 ≥24/30，错误归因到规则/知识/候选/搜索/动作；每题判定由独立 fixture |
| 泛化 | novel 和 counterplay holdout 各 ≥4/5；更换名称/单位/数值后仍通过对应 transfer fixture |
| 增益 | 完整方案相对最强无 LLM 基线胜率差点估计 ≥5pp 且配对 95% CI 下界 >0；未达标不宣称 LLM 增强成功 |
| 预算 | 决策 p95 ≤10 秒含 fallback；按时自主完成率 ≥95%；token/cost/局与 provider/version 有报告 |

上述样本量只能支持有限范围结论，不代表达到全赛尔号人类高手。最多两轮 dev 调整；若增益门禁失败，保留可用 search-only，输出主要失败类型与下一实验，不无限循环优化，也不直接开始微调。

## 8. 世界 Agent 与后续学习

M4 的 world service 暴露任务前置、寻路、背包、配队、奖励查询；World Agent 编排、Battle Agent 局内执行。操作预算、不可逆道具消耗策略与停止条件绑定会话。先结构化操作，再加视觉输入/点击 adapter，分别测视觉误差与战术误差。自我对战/蒸馏到 M6，须先有可信规则、无泄露日志和明确增益，版本更新使旧经验失效或重新验证。
