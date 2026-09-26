# 插件体系 v0.2

决策：**复用上游 Cordis core，通过薄 Seer 适配层组合可信应用插件；战斗执行不走 Cordis 事件分发。** 候选 `cordis@4.0.0-rc.10` 须过 M0 门禁。不是直接导入 DSH 全产品，也不同时开发两个内核。[ADR-001](adr/001-plugin-runtime.md)、[来源 S01–S04](sources.md)。

## 1. 最小契约与执行域

每个能力包含稳定 interface、provider、consumer；依赖 provider 的服务键，而不导入具体实现。`PluginManifest` 和 `PluginContext` 示例见 [contracts](contracts.md)。Cordis 类型只存在适配层内部，不进入 battle-core 或 wire schema。

| 类别 | 交付 | 执行域 | 更新策略 |
|---|---|---|---|
| content | 数据、资源 manifest | 编译后只读工件 | 新会话使用 |
| mechanic | operator/handler 与 Schema、fixture | 可信纯规则域 | 新 runtime generation |
| service | 世界、任务、存档 | Host | drain 后重启/切代 |
| presentation | UI slot、场景/特效 | 浏览器可信 bundle | 释放旧资源后替换 |
| agent | Skill/planner/模型 provider | Agent 进程 | 下一次 decision；取消旧请求 |
| adapter | 存储/遥测等 port 实现 | 相应进程 | 依赖下游一起重启 |

模型 provider 输出建议；mechanic handler 输出受控 EffectOp；只有 reducer 提交战斗状态。新精灵优先数据化，不能每只写一份任意脚本。

## 2. 配置与依赖

Profile 是运行组合；Bundle 是插件/默认配置/内容的发布清单。首期仅 `local-minimal` 与 `headless`。配置按 `base → mode → local override → dev` 顺序，使用稳定 entry ID **整行替换 config**；数组替换不拼接，禁隐式深合并。删除 provider 必须连同依赖检查；同一 realm 同 service key 多 provider 报冲突，不按加载顺序抢占。

只接受 JSON 或安全 YAML 数据子集；禁 `!!js`、eval、远程 entry URL 和自动执行安装脚本。依赖解析用已安装、allowlist 的精确 artifact；semver 范围只在发布前解析，运行时用 lockfile。可选依赖缺失给显式 feature flag，不能静默改变规则语义。

启动次序由服务依赖 DAG 决定；scope 父子所有权树与 DAG 是两回事。循环、缺依赖、API 范围不匹配、内容 hash 不匹配均在执行入口前失败。密钥只用 secret reference，不能进入配置导出、hash 清单、客户端或日志。

## 3. 生命周期与回滚范围

`discover → validate → resolve → stage → ready → quiesce → dispose`。

1. Discover 只读 manifest，不执行 entry。校验来源、路径、大小、摘要、依赖及请求能力。
2. Stage 在新 scope 建候选注册；未 ready 前不向正常请求发布。所有注册返回 idempotent disposer，并记录 owner。
3. Activate 只做可撤销资源准备，不发奖励、不改存档、不执行不可回滚网络写入。失败后撤销该批注册；**不称为任意副作用事务**。
4. Ready 才切换路由；升级时旧服务有在途操作则 drain。配置变更失败保留旧 generation，启动失败拒绝开放半成品 Host。
5. Quiesce 拒绝新任务，发送 AbortSignal，等待引用计数归零；超过 5 秒先记录泄漏并终止相应 worker/进程。不能在主线程强制杀掉任意 JS 函数。
6. Dispose 按依赖逆序停止 consumers，再 providers。资源内部释放顺序由 owner 明确编排，不能假定上游任意 effect 的顺序。释放失败继续清理其余资源，聚合诊断；dispose 期间禁新注册。

M0 检验异步 setup 失败、setup 中重入卸载、cleanup 中注册、重复 dispose、依赖消失/恢复。上游无法保证时，适配层封闭不支持路径；如果仍不能满足合同，停止自动 reload、改为受控重启，而非暗中引入 DSH vendor fork。

## 4. 权限与真正隔离

`capabilities` 是请求；Host policy 才能授予，未授予默认拒绝。存储能力按 plugin namespace 限定，网络能力按 provider endpoint 限定，battle.submit 绑定玩家/战局。scope 服务隔离只解决依赖可见性。

**同进程 JS 仍可能直接 import fs/fetch；Readonly/TypeScript/Cordis isolate/Node vm/Worker 均不构成本项目对恶意代码的安全边界。** 首期仅可信代码，第三方仅可导入声明式数据。客户端 executable plugin 同样必须审核，主页面上下文有 token 与 DOM 权限。

将来允许不可信代码时，必须另做无 Host 凭据/数据库挂载的 OS/container 沙箱、受限 RPC、网络 allowlist、CPU/内存/输出配额、终止与恶意插件测试。独立普通进程并不足够。M0–M3 不承诺已有这些能力。[来源 S08](sources.md)。

## 5. 热替换与版本共存

- M1：有活跃局时拒绝升级规则；无局可重启。UI 只做开发 HMR，不宣称生产任意热插拔。
- M2：工件按 `executableHash + rulesetHash + contentHash` 固定；各 generation 独立 registry/worker（代码大版本用进程），同局从不查全局“最新版”。最多同时 2 个 generation，第三次升级等待旧局 drain，不偷偷驱逐。
- 卸载含活跃引用的 mechanic 返回 `PLUGIN_IN_USE`；退役工件保留用于离线回放。旧工件缺失则明确 `ARTIFACT_UNAVAILABLE`，不能拿新代码冒充旧规则。
- UI 替换先卸 listener、ticker、scene owner；共享 atlas 最后引用释放才 unload。Agent provider 替换取消在途请求，迟到回复不能提交新 decision。
- 存档迁移独立于插件卸载；未知插件数据保留在 namespace，未安装时只读封存。

## 6. 用扩展反例验证“万物可插件”

| 变化 | 增加/修改什么 | 不改什么 | 必须升级契约的边界 |
|---|---|---|---|
| 普通精灵，机制已支持 | content 数据 + fixture + 合法资产 | core、Host、Agent loop | 无新语义无需升级；变 contentHash |
| 新魂印，已有阶段/EffectOp 可组合 | mechanic handler 或声明 IR + operator schema + 测试 | reducer、Host、renderer | handler ABI 与 IR 兼容则只新 generation |
| 新魂印要求“跨回合撤销历史行动”等未有语义 | 新 phase/state/EffectOp、回放与投影 | 无关 UI/模型 provider | **必须升 core/IR/状态契约**；不能仅挂监听器 |
| 新 UI 面板/主题 | presentation 注册已有 slot | core/Authority | 若要新公开数据则先改 ObservationSchema；不能偷读内部状态 |
| 新模型 | ModelProvider 实现 + 配置/能力探测 | core、tools、搜索语义 | 不支持工具调用由适配器解析并校验；新能力才升 provider API |
| 新地图/关卡，任务语义已存在 | map/quest content + 自有资源 | core、存储 port | 首个世界系统需要新 world service 与命令契约，不是 M1 现成能力 |
| 新 BOSS 规则 | mode overlay、脚本化声明效果、fixture | 通用 API | 新结算阶段/隐藏策略须升 ruleset/契约 |
| 规则大版本迁移 | 新 generation、content 编译、save migration | 旧局与旧回放工件 | 分别升 state/IR/wire/save；不就地改旧局 |

## 7. 合同门禁

依赖冲突/循环失败、stage 失败不暴露半成品、dispose 后无 owned 注册、100 次装卸资源基线回归、加载顺序打乱不改变战斗结果、同 profile hash 可重建组合、热更新不改旧局 hash、非法 operator/未授权能力拒绝。真实门禁任务见 roadmap M0-03/M2，当前尚未运行。
