# 总体架构（Architecture v0.1）

状态：规划基线 / 待 Work + Astra High 独立审查。目标：现代赛尔号页游复刻与 LLM 人机操作。此文档是工程设计，不宣称原作所有规则已经验证。

## 1. 不可退让的目标

1. 游戏可玩：从基础战斗逐步扩展到地图、NPC、任务、背包、养成和 PVE/PVP。
2. AI 足够智能：可以读取自身合法信息、理解技能/魂印、识别机制链、寻找反制、推演多回合；不靠针对每只精灵写死攻略。
3. DSH 风格可组合：功能通过 Profile/Bundle + 插件注册；内容包不要求改主程序。
4. 流畅：UI 不等待战斗模拟或 LLM；资源按需加载；重计算脱离渲染主线程。
5. 可验证：每局可重放；规则及数据有版本；未知机制不会无声降级；自动回归先于扩容。
6. 可安全扩展：插件有能力边界，危险操作有权限控制，外部内容/脚本不能获得所有服务端权限。

## 2. 系统全景

~~~text
               ┌──────────────────────────────────────────┐
               │ Web Client (React UI + PixiJS Scene)     │
               │ Input / Animation / UI Extension Slots   │
               └─────────────────┬────────────────────────┘
                                 │ typed API / WS
               ┌─────────────────▼────────────────────────┐
               │ Game Host / Composition Root             │
               │ Profile, Plugin Manager, Service Registry│
               │ Auth, Session, Save, Content Resolver    │
               └─────┬────────────┬───────────┬───────────┘
                     │            │           │
           ┌─────────▼───┐  ┌─────▼─────┐ ┌───▼───────────┐
           │ World/Quest │  │ Battle API│ │ Inventory/Pet │
           │ Plugins     │  │ Authority │ │ Plugins       │
           └─────────────┘  └─────┬─────┘ └───────────────┘
                                  │
                       ┌──────────▼────────────┐
                       │ Pure Battle Runtime  │
                       │ Ruleset + DSL + RNG  │
                       │ Commands -> Events   │
                       └──────────┬────────────┘
                                  │ versioned snapshot
                       ┌──────────▼────────────┐
                       │ Headless Simulator    │
                       │ Worker pool / batch   │
                       └──────────┬────────────┘
                                  │ allowed observations
                       ┌──────────▼────────────┐
                       │ AI Agent Service      │
                       │ LLM + Skills + Tools  │
                       │ Search + Belief + Eval│
                       └───────────────────────┘
~~~

注意：真正对局的 Battle Authority 只接受合法命令并提交状态；Simulator 在复制状态上运行，不具有修改真实对局的权限。服务端不向 Agent 暴露对手未揭示配招等隐藏字段。

## 3. 部署与进程边界

- Web：React 承担设置、背包、图鉴、技能面板、插件管理；PixiJS 承担地图、精灵、动画及特效。UI 订阅状态差量，不在逐帧循环刷新 React。
- Host：首期模块化 Node.js/TypeScript 单体，不从第一天拆微服务。插件提供服务，Host 负责统一 API、存储事务、认证/权限和生命周期。
- Battle Runtime：纯 TypeScript、可无头、无 DOM/网络/数据库/系统时钟依赖；可分别用于权威执行和模拟。
- Agent：独立进程（Python 或独立 TS worker），通过受限 API 调用；MVP 先用 Python 规划与模型适配。模型供应商可替换。
- 持久化：初期 SQLite 或 PostgreSQL 按部署需要选择，通过 Storage Port 隔离；正式多人服优先 PostgreSQL。Redis/队列在有实际并发瓶颈时引入。
- Worker：图像解码/数据解析可用浏览器 Worker；搜索和大批量模拟使用独立服务端 worker pool。禁止把 Agent 深度搜索放在浏览器主线程。

## 4. 软件包与仓库目标结构

~~~text
apps/
  web/              # React shell + PixiJS renderer host
  server/           # server composition root, API and authoritative sessions
  admin/            # data provenance, editor, validation, plugin manager
  headless/         # replay/bench/eval CLI
packages/
  contracts/        # versioned API, schemas, command/event types
  kernel/           # plugin runtime, registry, lifecycle, capability grants
  battle-core/      # pure state transition + deterministic RNG
  battle-dsl/       # effect IR, compiler/interpreter, validation
  battle-sim/       # branching, snapshot, fork, replay
  game-data/        # content compiler, manifests, data indexes
  client-state/     # client projections and network protocol
plugins/
  battle-standard/  # battle service adapter
  pets/ world/ quest/ inventory/ save/
  renderer-pixi/ ui-classic/ ui-modern/
  agent-llm/ agent-search/ agent-rulebased/
content/
  rulesets/ pets/ moves/ effects/ maps/
profiles/
  classic.yml modern.yml headless.yml agent-eval.yml
agents/
  battle-agent/ world-agent/ tools/ memory/ eval/
tests/
  golden-battles/ mechanic/ plugin-contract/ replay/ performance/
docs/
~~~

首期不是一次性创建全部空包：按纵向可运行切片逐步落地；contracts 与 battle-core 先建立，新增包必须有消费者和测试。

## 5. 契约与数据流

- Command：带 battle_id、actor_id、turn_id、action、expected_state_version、idempotency_key 的意图。服务端验权、验状态版本和合法性。
- BattleState：内部全量真实状态，不直接出网；含规则快照、双方队伍、PP、状态、回合、RNG 状态。
- Observation：按角色/模式投影，严格删除隐藏字段；Agent 与真人客户端使用同一可见性规则。
- BattleEvent：确定性事实，包含序号、phase、source、targets、before/after patch、cause_chain、rule/effect ID 和 RNG draw refs；兼顾 replay 与调试。
- RenderEvent：由事实事件投影产生，客户端可以跳帧、倍速和跳过；动画完成不能决定伤害/胜负。
- Simulator：接受 snapshot + 规则 hash + hypothetical commands + seed；输出分支结果、事件与统计，不返回未来的真实随机数。
- Content Package：Manifest + schema 校验后的编译结果；战斗开始时绑定不可变规则和插件版本。

## 6. 关键架构决定

### 6.1 插件系统与战斗规则两级分离

Kernel 采用 DSH/Cordis 风格的 Context、service injection、effect disposal、Profile/Bundle；通过 PoC 判定是否直接使用 Cordis，避免盲目二次封装。通用插件仅通过能力契约访问其他服务。

Battle 不允许任意插件监听广播后直接改可变状态；插件只能声明 Effect Definition/Rule Handler，经受控 dispatcher 在明确阶段产生指令，再由 Reducer 提交，参见 battle-engine.md。

### 6.2 扩展分层

- Content Plugin：精灵、技能、魂印、地图、任务、动画的版本化数据。
- Mechanic Plugin：新 DSL operator / trigger / interpreter handler，必须包含参考规则和 golden fixture。
- Service Plugin：背包、任务、存档、配队、Agent/模型适配。
- Presentation Plugin：皮肤、动画、UI panel/slot，不能改权威战斗。
- Adapter Plugin：存储、模型、外部工具。危险能力显式授权。

### 6.3 规则版本不热替换进行中对局

BattleSession 启动时锁定 ruleset_hash、content_hash 和 executable plugin hashes。热替换只影响新会话；旧会话继续旧版本或在无法保留旧运行时明确终止/迁移。存档迁移独立且可回滚。

### 6.4 性能和可观测性

初始体验目标：在目标设备上 60 FPS，渲染帧预算约 16.7ms；量化主线程 long tasks、FPS p95/p99、纹理占用、切图/场景加载、战斗事件吞吐、模拟 turns/sec 和 Agent token/latency。目标需通过基准平台实测，非承诺值。

纹理 atlas、延迟加载与 LRU cache；避免每回合扫描全量效果，编译当前战局 active_effect index；批量模拟使用可复用快照/写时复制并评估序列化成本。资源卸载要释放 GPU 纹理和 listener。

### 6.5 知识产权与资料可信度

原作图像/动画/音乐/文本不默认为可再发布。公开仓库只放自有或获授权资产及可发布的元数据；私有研究资料隔离。规则按来源、日期、目标版本、证据、置信状态标注；与原作不一致时不得将推测写成事实。

## 7. 关键质量门禁

- Pure core 重放：同状态、双行动、同 seed → 完全相同 state hash 和事件顺序；
- Agent 不看隐藏信息，模拟器与正式引擎共享逻辑但不同权限；
- 插件卸载后无僵尸 handler、监听器、资源和服务；缺少依赖必须拒绝启动；
- 规则扩展不破坏已核准的 Golden Tests；每个新增机制有正反边界用例；
- 禁止“可运行但忽略未知 effect”：数据编译应 fail closed；
- 出现不支持原作机制、缺素材或模式差异时记录显式缺口。

## 8. 开放决策（由下阶段证据决定）

1. 目标规则版本快照与具体参考对局范围；
2. 是否直接依赖 Cordis；需验证卸载和版本化注册能否满足服务端；
3. 首期仅离线/单机还是包含实时多人 PVP；
4. 原作规则与资料的合法可用来源；
5. 视觉资源替代方案；Classic/Modern UI 优先级；
6. 性能目标测试设备与网络环境；
7. Agent 决策延时预算和对战模式时限。

参考：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md ；https://pixijs.com/ ；https://modelcontextprotocol.io/
