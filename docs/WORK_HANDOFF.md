# Work / Astra High 交接任务：Seer 架构独立审查与定稿

> 用途：在 ChatGPT Work 模式中选择用户可用的 Astra High（如有该选项），将本文件作为执行任务。当前文档由现有对话整理，不代表已经由 Astra High 审查或运行。仓库为 https://github.com/NiHaiMa123/seer ，默认分支 main。

## 你的角色与目标

作为架构师，独立研究并规划一个“赛尔号页游复刻 + LLM 人机操作”的可落地架构。玩家希望 AI 接近人类高手：理解技能、魂印、被动与条件触发，组合技、反制机制、不完全信息、多回合博弈、PVE/PVP 及以后完整的地图/任务操作。系统还要借鉴 DeepSeek Harness（DSH）的“万物皆插件”，新增功能/精灵/特效/Agent 能尽量安装组件而不改动主程序，并从设计上避免原版页游常见的客户端卡顿。

## 开始前必须做

1. 阅读 main 分支全部规划文件：README.md、docs/architecture.md、docs/plugin-system.md、docs/battle-engine.md、docs/agent.md、docs/data-and-content.md、docs/roadmap.md。
2. 独立核验 DSH/Cordis 官方文档、PixiJS 当前稳定版 API、TypeScript/Node 与浏览器工作线程、插件隔离原则；不要基于不可靠的二手截图直接写架构决定。
3. 区分“项目的设计假设”和“已验证的赛尔号原作规则”。原作数据不足时列出待验证项，不捏造精灵/魂印原始结算顺序。
4. 明确 repo 当前仅架构规划，不应宣称已有战斗引擎/Agent/测试。
5. 在不失去用户原始目标的前提下，批判现有方案，指出过度设计、缺失的接口、不可实现的热替换、安全隐患和被忽略的性能成本。

## 必须解决的问题

A. 最小微内核与插件契约：Cordis 直接用还是适配层？Context/service injection、依赖树、卸载、Profile/Bundle、冲突、能力权限、组件生命周期、模块安全、版本并存。战斗插件不得任意修改权威状态。

B. 游戏与 AI 的边界：client/host/battle-core/simulator/agent 分区；哪些进程、哪些共享库；命令/状态/事件/工具 Schema；同步多人和本地 PVE 的部署可选项；OpenAI/其他模型适配或本地模型的替换 seam。

C. 战斗规则：纯函数 state transition、确定性 RNG、规则阶段表、Effect DSL 与可编程 handler 的划分、特殊魂印/伤害/吸强/切换/复活/模式例外，版本/回放/隐藏信息/循环触发上限。

D. 智能：知识解析与可信规则分离；LLM Skill + typed tools + search/simulation + belief state；LLM 如何发现未知机制组合的反制而非复读攻略；强制合法动作、延时预算与失败 fallback；测试集与消融对比。

E. 性能：React/PixiJS 职责；渲染和服务器逻辑分离；WebGL/WebGPU 取舍；资源 atlas/预加载/回收；agent 模拟吞吐、worker、event index、可观测指标和目标设备基准。

F. 数据与权利：目标版本快照、来源证据、内容包与编译管线、授权/公开仓库边界、可追溯机制真实性；不要将未经许可的原作素材直接提交公开仓库。

G. 扩展性反例：新增普通精灵、新增不支持的魂印 operator、新 UI、新模型、新地图/关卡、规则大版本迁移，逐项写清楚“加哪些插件，哪些核心文件不需要改，哪些必须升级契约”。

## 交付物（写回 GitHub）

- 修订 architecture.md、plugin-system.md、battle-engine.md、agent.md、data-and-content.md、roadmap.md；保留可追溯理由，不覆盖未经核验的原作规则。
- 新增 docs/adr/ 关键 ADR：插件运行时选型、战斗确定性、观察边界、技术栈/部署、版本/迁移。
- 新增 docs/contracts.md：最小真实 TypeScript contract 示例（schema、BattleState/Observation/Command/Event、PluginManifest、EffectDefinition、Agent Tool 与错误码）。
- 新增 docs/performance-plan.md：可执行的性能基准与预算、目标环境、衡量方法。
- 新增 docs/open-questions.md：按阻塞程度排序的决策缺口与验证实验。
- 如合适，给出 repo 目录骨架，但不要生成大量空包或声称已完成尚未跑通的功能。
- 更新 README 入口及依赖图、阶段验收定义。
- 给出 M0 → M1 的精确任务拆分与可自动化验收标准，明确第一轮不追求全部精灵。

## 工作方式和提交纪律

建议开独立规划分支并提交 PR；不得覆盖他人并行改动，先检查最新 main。优先小且可验证的文档/PoC 变更。每个主要架构选择写 alternatives、trade-off、reversibility 与验证方法。

技术事实引用官方材料/版本号；对游戏机制事实标注来源和状态。不要做无止境自我反驳：若关键数据缺失，明确假设与实验，提供可执行下一步，而不是卡在循环中。

最后提供：改动文件清单、架构决策摘要、关键未决问题、commit/PR 链接，以及下一步能够交给执行 Agent 的 M0 任务。不要声称在 Work/Astra High 运行，除非当前确实处于该模式/模型。

## 上游参考

- DSH 官方架构：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- Cordis：https://github.com/cordiverse/cordis
- PixiJS：https://pixijs.com/
- MCP：https://modelcontextprotocol.io/
