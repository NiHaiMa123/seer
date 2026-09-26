# Seer Reborn — 架构规划与实施基线

目标：赛尔号页游复刻 + 能理解技能/被动组合与反制的 LLM 玩家；支持插件化内容、功能、UI、模型和规则扩展。

**当前只有架构文档与 TypeScript 契约示例，没有可玩的客户端、战斗引擎或 Agent。** 2026-09-26 已完成基于 main `3dcb760` 的独立架构审查。原作规则/素材尚未验证导入；首轮先做自制 `synthetic-v1` 1v1 工程切片。本项目非原作官方项目。

## 核心决定

- TypeScript + Node 24 本地 Host，React/PixiJS 8 WebGL 优先，SQLite；正式多人后续增加。
- Cordis core + 薄适配层，候选版本须通过 M0；DSH vendor 与上游保证不能混同。
- 权威引擎与模拟器复用纯 core；规则决定结果，动画只表现结果。
- 玩家与 Agent 共用可见性规则；模拟只基于显式假设，不能读取真实秘密状态。
- 新普通精灵加数据；新语义可能要升级 operator/phase/core 契约。运行中对局不热换规则。
- 以封闭测试/消融衡量智能，以真实设备基准衡量流畅；未测指标不称通过。

## 阅读与执行入口

| 文档 | 内容 |
|---|---|
| [架构审查](docs/architecture-review.md) | 14 项发现、严重程度、修改理由、交接覆盖 |
| [总体架构](docs/architecture.md) | 边界、进程、依赖图、部署/目录选择 |
| [插件体系](docs/plugin-system.md) | DI、生命周期、安全、热替换与 8 类扩展反例 |
| [战斗引擎](docs/battle-engine.md) | 阶段表、数值/RNG、原子结算、DSL、回放 |
| [Agent](docs/agent.md) | Skill/tools、信息集搜索、未知组合、预算、消融门禁 |
| [数据与内容](docs/data-and-content.md) | 证据、真实性、编译、公开资产、迁移 |
| [契约](docs/contracts.md) / [TS 示例](docs/examples/contracts.ts) | 状态/观察/命令/事件/插件/效果/工具/错误码 |
| [性能计划](docs/performance-plan.md) | 目标设备、负载、采样方法、预算、未来命令 |
| [实施路线](docs/roadmap.md) | 精确 M0/M1 任务卡、自动验收、停止条件、首项执行指令 |
| [待决问题](docs/open-questions.md) | 原作快照、证据、插件实验、设备等阻塞项 |
| [技术来源](docs/sources.md) / [本轮检查](docs/validation.md) | 官方来源/版本、实际验证范围 |
| [原始交接要求](docs/WORK_HANDOFF.md) | 本次审查输入，保留原文便于追溯 |

## 关键 ADR

[001 插件运行时](docs/adr/001-plugin-runtime.md) · [002 战斗确定性](docs/adr/002-deterministic-battle.md) · [003 观察边界](docs/adr/003-observation-and-simulation.md) · [004 技术栈/部署](docs/adr/004-stack-and-deployment.md) · [005 版本/迁移](docs/adr/005-versions-and-migrations.md)。各项均含 alternatives、trade-off、可逆性、验证方法。

## 阶段状态

| 阶段 | 完成的含义 | 当前 |
|---|---|---|
| 架构审查 | 文档/ADR/契约示例、可执行下一步 | 已完成，验证范围见 validation |
| M0 | Schema、插件/确定性/渲染实验有真实结果 | 待执行 |
| M1 | 本地 1v1 可玩、持久化、重放、隐私与性能报告 | 待执行 |
| M2 | 复杂机制/切换/复活/规则版本并存 | 待执行 |
| M3 | LLM+搜索通过泛化、消融、预算门禁 | 待执行 |
| M4–M6 | 世界/多人、扩容、可验证学习收益 | 后续 |

下一步交给执行 Agent：从 [roadmap 的 M0-01](docs/roadmap.md) 开始，先提交一个小而可验收的工程基座，不直接批量生成所有系统。代码许可和原作资产授权另行确认；公开仓库不加入未经许可的原作资源。
