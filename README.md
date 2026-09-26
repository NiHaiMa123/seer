# Seer Reborn（架构规划阶段）

赛尔号页游复刻及可扩展智能 Agent 项目。目标是复刻可验证的游戏规则，提供可插件化的游戏、内容、表现和 AI 系统，使 LLM 能基于技能、魂印、状态及规则进行战术推理、模拟、反制和完整游戏操作。

> 当前仓库仅提交架构规划，不代表已经实现客户端、战斗引擎或 Agent。本项目不是原作官方项目。原作素材、名称、文本和规则资料的使用与分发须分别核实权利与许可。

## 项目目标

- 现代赛尔号机制为最终覆盖目标，先用少量代表性精灵完成最小可验证闭环；
- DSH/Cordis 风格的插件组合：微内核、服务依赖、可撤销注册、Profile/Bundle；
- 战斗引擎独立、权威、确定性、无头运行，与动画渲染和 AI 推演隔离；
- 新精灵原则上用数据包扩展，新机制经版本化 Effect DSL/执行器扩展；
- LLM + Skills + Tools + 搜索/模拟，支持不完全信息对战，不直接读取对手隐藏数据；
- 页面不卡顿、资源懒加载、可回放、可测试、可观测。

## 规划文档

1. [总架构](docs/architecture.md)：边界、进程与包结构、关键技术决策。
2. [插件系统](docs/plugin-system.md)：生命周期、契约、Manifest、隔离和热替换。
3. [战斗引擎](docs/battle-engine.md)：确定性状态机、结算、DSL、回放和验证。
4. [Agent 架构](docs/agent.md)：LLM/Skill/工具/搜索/记忆/评测。
5. [数据与资源](docs/data-and-content.md)：版本、溯源、授权和导入流程。
6. [路线与验收](docs/roadmap.md)：迭代切片、完成定义和风险。
7. [Work / Astra High 交接指令](docs/WORK_HANDOFF.md)：可直接在 Work 模式继续审查、细化和执行。

## 先决原则

- **规则归引擎，战术归 Agent，表现归客户端**；效果结算不依赖帧、UI 或 LLM。
- **可插件化不等于任意代码可修改核心状态**：战斗扩展须走受控事件/命令协议。
- **先正确再优化**：先固定规则快照与 Golden Tests，再扩大精灵池。
- **不写伪功能**：未知原作机制需显式标记，禁止凭猜测当作已验证规则。
- **公开分发与研究环境分离**：无许可资源不得默认纳入公开发布。

## 资料参考

- [DeepSeek Harness 官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Cordis](https://github.com/cordiverse/cordis)
- [PixiJS](https://pixijs.com/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

见文档中的「开放问题」；规则细节以经过核验的目标版本为准。
