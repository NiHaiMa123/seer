# Agent 架构：人类式理解、配合和破解 v0.1

## 成功定义

在未针对测试精灵写专属攻略的前提下，Agent 读取合法可见的状态和规则，能解释并验证关键魂印/技能交互，生成候选战术，多回合推演，执行合法操作，并在失败后更新对手认知。不是仅靠 RAG 查“某精灵克制谁”，也不是逐帧让 LLM 点击 UI。

## 组件分工

~~~text
Game Observation (按玩家视角过滤)
   -> Perception / structured state
   -> Knowledge Query (宠物/技能/魂印/效果/规则版本)
   -> Threat & Mechanic Graph
   -> Candidate Proposer (LLM/Skill)
   -> Legal-action filter (engine)
   -> Planner/Search (headless simulator + opponent belief)
   -> Policy selector (收益/风险/时限)
   -> submit_action (authoritative validation)
   -> Event analysis + memory update
~~~

- LLM：语义理解、解释、对手意图假设、组合候选、关键回合分析。
- Skills：工具使用流程、检查清单、机制反制工作流、PVE/PVP 特有决策协议；不是精灵逻辑源码。
- Rule/Knowledge Store：权威结构化效果和版本证据；RAG 仅辅助检索自然语言和案例。
- Battle Core：可执行规则的唯一事实来源，负责伤害/触发/随机/合法性。
- Planner：Beam Search 起步，后续对比 Expectimax、MCTS 等；评测驱动选择。
- Opponent Model：依据已公开行为维护 belief，不访问真实隐藏配置。
- Memory：本局摘要、验证过的机制关系、条件化经验和复盘；过期或失败推断可撤销。

## 允许的工具与 Schema 原则

| Tool | 用途 | 安全性 |
|---|---|---|
| get_battle_observation | 当前公开战局 | 绝不返回 TrueState |
| get_legal_actions | 引擎计算可选行动 | 绑定 actor/turn |
| get_pet / get_move / get_effect | 版本化机制及证据 | 可按已知图鉴权限访问 |
| explain_event_trace | 本回合因果和规则引用 | 对隐藏信息脱敏 |
| calculate_damage | 对给定假设算伤害分布 | 标记未知输入 |
| simulate_turn / simulate_batch | 反事实推演 | 无真实战局写权 |
| search_counterplay | 按机制寻找可行干预 | 返回候选+证据，不当权威 |
| get_battle_history | 公开历史与记忆 | 视角过滤 |
| submit_action | 唯一执行入口 | ACL + legal + expected version + 幂等 |

禁止工具直接 set_hp、edit_opponent_moves、peek_rng、mutate_rules。工具参数用 JSON Schema 校验。决策日志记录 tool params（脱敏）、规则 hash、模型版本、候选与最终决策。

## 不完全信息

内部 TrueState 包括双方实际配招、隐藏资源、RNG；Observation 仅暴露玩家当前能够知道的字段。BeliefState 维护可能的隐藏配招、资源、对手风格及其置信度，随可见事件更新。

模拟时从 belief 采样可能对手配置和应对策略，不能借用真实对象做模拟泄漏。PVE 对 BOSS 机制、脚本和隐藏规则按游戏模式明确可见性。评测必须在对手未知配招测试中测出能力，而非“开全图”。

## 机制理解和反制流程

1. 提取敌方威胁：触发时点、条件、效果、持续时间、可避免/可消除/可绕过的限制；
2. 分析我方合法动作的前置条件与副作用；
3. 构建 cause graph：produces、requires、consumes、blocks、amplifies、alternative；
4. 按“阻止触发 / 绕开依赖 / 打断执行 / 吞下代价 / 改变对位”产生候选；
5. 通过真实规则引擎检查；无效候选必须剔除，并记录失败原因；
6. 结合对手行为与后备精灵价值模拟多个回合；行动后依据新事件修正计划。

结构化机制例如“自身 HP 低于对手时本回合先制增加”应直接检索 DSL 条件和时点，而不是让 LLM 根据文字猜哪个阶段生效。单个特定精灵的经验只形成有前提的案例，不上升为无条件攻略。

## 决策循环与预算

- 每回合固定 Observe → Retrieve → Generate → Validate → Search → Decide → Act → Reflect。
- 普通局面缓存策略/小模型；高价值转折点调用高能力 LLM。
- 总时间/令牌/模拟次数/分支数有明确上限，超限回退到合法基线行动而非卡死。
- LLM 失败或输出格式错误：重试次数受限，进行合法化检查，必要时使用 deterministic fallback。
- 绝不能在事件触发链内调用远程 LLM，避免对局延迟取决于外部 API。
- 双方同步对战需战斗时限和超时默认策略，客户端显示 Agent 正在决策但仍保持响应。

## 搜索初步设计

MVP：LLM 产生少量不同战术的候选，始终保留引擎合法行动集用于 fallback，Beam Search 在代表性的对手行动/隐藏状态采样上跑短深度。比较 win/loss、队伍 HP、资源、行动权、状态与风险；评价函数参数化，不能只按当前伤害选。

指标：合法动作率、胜率（注明对手/规则版本/样本量）、未知机制测试正确率、counterplay discovery、每局 token、决策延迟 p50/p95、每秒模拟回合、失败模式分布。对比 random、规则基线、仅 LLM、LLM+检索、LLM+simulation 四组消融。

## 长期学习

阶段 1：保存可重放对局，归纳有证据的失败/成功案例；检索时匹配适用条件。
阶段 2：利用经过审核的对局生成候选排序/价值数据，防止自我确认偏误。
阶段 3：Self-play + 人类测试对手 + 不同策略池，防止只针对单个基线过拟合。
阶段 4：必要时蒸馏本地较小模型负责高频决策；不影响高能力模型参与关键战术推理。

任何记忆必须标明规则 hash、对位、可见信息、条件和结果；随着机制版本更新自动失效或重新验证。

## 世界 Agent 与视觉操作（后期）

World Agent 负责目标分解、任务前置、寻路、道具/精灵培养，Battle Agent 只负责局内决策。一个高层任务例如获取某精灵可编排 Quest → Team Builder → Battle → Review，但要限定资源预算、尝试次数、停止条件和用户许可范围。

优先结构化 API 操作，让决策和 UI 感知误差分开测。后加视觉 Adapter 以截图/控件观察与点击操作；二者共享同一决策核，不允许视觉模式透传隐藏状态。

## 评测测试集

- Basic：属性、强化、先制、伤害和合法性。
- Synergy：两到三种技能/魂印连锁；资源保留 vs 消耗。
- Counterplay：阻止触发、绕过免疫、切换与后备资源。
- Hidden-info：未公开配招、多种对手意图与错误预测修正。
- Novel-mechanic：仅提供新机制规则，不提供专属攻略。
- Adversarial：对手故意诱导、异常/中断、超时和无解局面。
- Transfer：同一个机制变化目标、顺序和精灵时能否泛化。

预先划分训练/调参/封闭测试集；不能在封闭评测失败后将专属解答加入 Skill 再宣称零样本泛化。每项结论须报告样本、规则覆盖与置信区间。

## Agent 插件契约（示意）

~~~typescript
interface BattleAgent {
  decide(input: {
    observation: BattleObservation;
    legalActions: BattleAction[];
    deadlineMs: number;
    rulesetHash: string;
  }): Promise<{
    action: BattleAction;
    rationale?: string;
    evidenceIds?: string[];
  }>;
}
~~~

模型适配器、Skill、Planner、Memory、Evaluator 都是独立插件。允许切换模型并在同样 replay/评测上比较。Skill 来源、版本和工具权限一并记录。模型的自然语言解释不替代 simulation/canonical rules。

参考：https://modelcontextprotocol.io/ ；https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
