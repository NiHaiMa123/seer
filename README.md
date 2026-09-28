# Seer Reborn — 架构规划与实施基线

目标：赛尔号页游复刻 + 能理解技能/被动组合与反制的 LLM 玩家；支持插件化内容、功能、UI、模型和规则扩展。

**当前已完成 M0–M4。** 具备：确定性战斗引擎（v1/v2 机制）、Host 协议与隐私投影、SQLite 持久化与回放、Cordis 插件装配、runtime generations、BattleAgent（工具/simulate/belief/beam 搜索/LLM 适配）与 WorldAgent、评测门禁（60 fixture、6 消融、配对统计）、赛尔号式战斗 UI（React+PixiJS）、队伍编辑、PVE/BOSS、世界层（存档/背包/任务/奖励 exactly-once/地图会话）。原作规则/素材仍未验证导入，现有玩法只代表 `synthetic-v1/v2` 工程规则。本项目非原作官方项目。

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

## 模块清单

按 [插件体系](docs/plugin-system.md) 的 6 类组织。**装配方式**列说明该模块目前如何被组合进系统：`数据` = drop-in 文件即生效；`接缝` = 依赖注入/抽象接口已就位，替换实现只需改接线处；`静态` = 改代码重新编译。

### content（数据 → 编译后只读工件）

| 模块 | 位置 | 装配 |
|---|---|---|
| 规则包 synthetic-v1/v2（units/moves/ruleset/modeOverlays/limits） | `content/synthetic-v{1,2}/` | **数据**——`loader` 按 packId 装载，rulesetHash 钉到对局 |
| 属性克制表 + 精灵属性/招式属性（v2） | `content/rulesets/typechart.json`、units.types、moves.type | **数据**——ruleset 声明 `typeChartFile` 即启用；表体计入 rulesetHash；单位 types/招式 type 校验到表 |
| claims/校验 schema | `content/claims/`、`content/schemas/` | 数据 + `tools/content-validate.ts` |
| 客户端中文显示名映射 | `apps/client/src/meta.ts` | 静态（表现层字典，不进协议） |

### mechanic（可信纯规则域 → 新 runtime generation）

| 模块 | 位置 | 装配 |
|---|---|---|
| 阶段结算/命令处理 | `battle-core/engine.ts` | core 内部，升契约走新 generation |
| operator 语义（damage/heal/stat_stage/control/cleanse/transfer/clear/apply_status/apply_effect） | `engine.ts` + `loader.ts` | **接缝**——allowlist 门控，新 op 须升 core 契约 |
| 确定性 RNG | `battle-core/rng.ts` | 接缝（seed 注入） |
| canonical/SHA-256 | `battle-core/sha256.ts`、`contracts/canonical.ts` | 接缝 |
| 队伍展开/校验（team→species+bench） | `host/team.ts` | 接缝（纯函数） |
| boss overlay（immuneControl/immuneClearStages） | `content` modeOverlays + engine | **数据** |

### service（Host 域 → drain 后切代）

`apps/server` 已由 Cordis `PluginHost` 装配：每个域是独立 manifest 插件，通过 `ctx.require/provide` 依赖服务键，`ctx.own(router.register(...))` 把路由生命周期绑进插件——`unloadPlugin()` 即撤销该插件的全部路由/服务。

| 模块 | 位置 | 装配 |
|---|---|---|
| **HTTP 路由表**（方法+路径分发、405 聚合、路由 disposer） | `apps/server/src/router.ts` | 服务键 `http.router` |
| **content 插件**：`/api/content/:packId` + pack 目录 | `apps/server/src/plugins/content.ts` | **运行时插件** `content`，提供 `content.catalog` |
| **battle 插件**：建局/observe/history/resync/submit/ack + PVE 驱动 | `apps/server/src/plugins/battle.ts` | **运行时插件** `battle-api`，require `battle.manager`+`content.catalog`，提供 `battle.api` |
| **world 插件**：玩家/队伍/地图/op/会话/reward 路由 | `apps/server/src/plugins/world.ts` | **运行时插件** `world-api`，require `world.service`+`battle.api` |
| **static 插件**：客户端静态资源 + SPA catch-all | `apps/server/src/plugins/static.ts` | **运行时插件** `static-web`，依赖顺序保证最后注册 |
| 对局协议核心（幂等回执/令牌/提交管线） | `host/host.ts` | 服务键 `battle.manager`（battle-manager 插件包装） |
| 公开投影/隐私白名单 | `host/project.ts` | 接缝（白名单增删=契约变更） |
| SQLite 持久化 + 崩溃恢复 | `host/persisted.ts`、`host/store.ts` | 接缝（store 可换实现） |
| 回放验证 | `host/replay.ts`、`tools/replay-verify.ts` | 接缝 |
| runtime generations（executable+ruleset+content 三 hash 钉版） | `host/generations.ts`、`manager.ts` | 接缝 |
| 世界域逻辑：profile/背包/任务/队伍存档/reward outbox | `world/service.ts`、`world/store.ts` | 服务键 `world.service`（composition root 提供） |
| 地图/寻路/会话预算/不可逆门控 | `world/map.ts` + `service.ts` | 接缝（地图是数据表） |
| PVE bot 席位 | `plugins/battle.ts` `drivePve` | 随 battle 插件生命周期 |

### presentation（浏览器 bundle）

客户端有 slot 注册表（`client/slots.ts`）：`registerScreen(id, C)` 注册整页、`registerPanel(area, C)` 往面板区追加组件，返回的 disposer 即卸载。面板只拿公开 Observation 上下文（隐私边界不变）。

| 模块 | 位置 | 装配 |
|---|---|---|
| **slot 注册表**（screen + panel area + disposer） | `client/slots.ts` | **注册表**——新页面/面板不改分发逻辑 |
| 战斗场景（程序化精灵/浮字/动画队列） | `client/scene.ts` | 静态（Pixi 宿主是固定挂载点） |
| 战斗面板 ×6（顶栏/替补横幅/替补行/技能栏/日志/终局条） | `client/main.tsx` | **panel 插件** `battle.top`/`battle.hud` |
| 编队大厅 / 世界页 / 战斗页 | `client/main.tsx` | **screen 插件** `lobby`/`world`/`battle` |
| 协议客户端 | `client/api.ts` `BattleClient` | 接缝（in-process 可换） |
| 客户端 AI（mode=ai 自动出招） | `client/ai.ts` | 接缝 |
| 内容元数据缓存/中文字典 | `client/meta.ts` | 接缝 |

### agent（独立进程 → 下一次 decision 生效）

| 模块 | 位置 | 装配 |
|---|---|---|
| BattleAgent 决策循环 | `agent/agent.ts` | **policy 参数换实现**（baseline/planner/llm） |
| 8 工具 strict 分发 | `agent/tools.ts` `ToolServer` | 接缝（ReadOnlyView/SubmitFn 注入） |
| 假设世界模拟 | `agent/simulate.ts` | 接缝 |
| belief 隐藏世界采样（≤16 样本） | `agent/belief.ts` | 接缝 |
| 机制图/反制查询 | `agent/knowledge.ts` | 接缝 |
| joint-action beam planner | `agent/planner.ts` | 接缝 |
| ModelProvider（Echo/OpenAI adapter）+ deadline/fallback | `agent/provider.ts`、`llm.ts` | **接缝**——新模型=实现 `generate(request,signal)` |
| 评测 harness（60 fixture/6 消融/配对统计） | `agent/eval.ts`、`tools/eval-m3.ts`、`tools/m3-fixtures.ts` | 静态 |
| WorldAgent（目标驱动编排） | `agent/world-agent.ts` | 接缝（`WorldOps` 可换 HTTP/in-process） |

### adapter（port 实现）

| 模块 | 位置 | 装配 |
|---|---|---|
| Cordis 插件运行时装配 | `experiments/cordis/`（`@seer/plugin-runtime`） | **已接管 `apps/server` 生产装配**：manifest 校验（重复 id/缺失依赖/服务键冲突/capability 越权）+ `loadPlugin/unloadPlugin` 生命周期 |
| HTTP 传输校验 | `apps/server/transport.ts` | 静态 |
| SQLite driver | `host/store.ts`、`world/store.ts` | 接缝 |

### 独立辅助

| 模块 | 位置 |
|---|---|
| 门禁聚合 verify:m0~m4 | `tools/verify-*.ts` |
| 确定性实验（向量/跨进程/浏览器） | `experiments/determinism/` |
| 渲染基准 | `experiments/render/` |
| 测试 | `tests/{battle-core,contracts,host,server,agent,e2e}/` |
| 阶段验证报告 | `artifacts/m{0..4}/` |

## 加/改/删模块的现状操作

| 操作 | 现在怎么做 | 「万物可插件」目标态 |
|---|---|---|
| 加精灵/招式（已有 op） | 往 pack JSON 加数据（含 types/type） → `content-validate` | ✅ 已是数据化 |
| 换克制表/加新属性 | 改 `typechart.json` 或 ruleset 指新文件 → 新 rulesetHash | ✅ 表=规则数据，钉版不串 |
| 加新语义 op | 升 core 契约 + 新 generation（规格允许，不能挂监听器冒充） | 同 |
| 换 LLM provider | 实现 `ModelProvider` 接口注入 | ✅ 已是接缝 |
| 加 UI 面板/页面 | `slots.registerPanel/registerScreen` 注册组件 | ✅ 已是注册表 |
| 加服务端 API 域 | 写 `PluginSpec`（manifest+setup），`host.loadPlugin` 进 `defaultModules`，路由用 `ctx.own(router.register)` | ✅ 已是运行时插件 |
| 运行中卸载某域 | `await host.unloadPlugin("world-api")` → 其路由/服务全部撤销（`tests/server/plugins.test.ts` 验证） | ✅ 已验证 |

**仍不宣称**：跨版本任意热替换（插件更新走「新 generation 重建 + 排空旧会话」，规格§5 语义）；同进程插件非安全沙箱——只承载可信代码，不信任第三方插件仍需 OS/容器隔离 + 受限 RPC。

## 常用命令

```bash
pnpm serve:demo      # 起 demo 服务器 :8787（战斗 UI 入口 /）
pnpm test:e2e        # 构建客户端 + Playwright 全链测试
pnpm verify:m4       # M4 聚合门禁（其余 verify:m0~m3 同理）
pnpm typecheck       # 全仓类型检查（含 apps）
pnpm test:agent      # agent 包测试
```

## 关键 ADR

[001 插件运行时](docs/adr/001-plugin-runtime.md) · [002 战斗确定性](docs/adr/002-deterministic-battle.md) · [003 观察边界](docs/adr/003-observation-and-simulation.md) · [004 技术栈/部署](docs/adr/004-stack-and-deployment.md) · [005 版本/迁移](docs/adr/005-versions-and-migrations.md)。各项均含 alternatives、trade-off、可逆性、验证方法。

## 阶段状态

| 阶段 | 完成的含义 | 当前 |
|---|---|---|
| 架构审查 | 文档/ADR/契约示例、可执行下一步 | 已完成，验证范围见 validation |
| M0 | Schema、插件/确定性/渲染实验有真实结果 | 已完成 |
| M1 | 本地 1v1 可玩、持久化、重放、隐私与性能报告 | 已完成 |
| M2 | 复杂机制/切换/复活/规则版本并存 | 已完成：`pnpm verify:m2` 22/22 PASS |
| M3 | LLM+搜索通过泛化、消融、预算门禁 | 已完成：`pnpm verify:m3` 9/9 PASS（真 LLM 增益待 endpoint） |
| M4 | 表现层/队伍/PVE/世界服务/世界 Agent | 已完成：`pnpm verify:m4` 9/9 PASS |
| M5–M6 | 多人、扩容、可验证学习收益 | 后续 |

当前为本地 Host + synthetic 规则；不扩展公网联机。代码许可和原作资产授权另行确认；公开仓库不加入未经许可的原作资源。
