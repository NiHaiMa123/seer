# 插件体系设计 v0.1

## 目标与边界

借鉴 DSH 基于 Cordis 的共享 Context、服务注入、Profile/Bundle、可撤销注册和有序配置覆盖；不要将“所有东西都是插件”误解为“每个插件都能修改所有系统内部状态”。最小 Kernel 保留类型契约、生命周期、服务发现、权限/隔离、配置、版本及审计。

先做 Cordis PoC 决定直接复用或用兼容抽象，不默认自研。功能模块、模型适配、UI、资源及具体战斗规则均可组合，但权威状态转移的确定性保证必须留在 Battle Core。

## 插件类别与执行域

| 类别 | 内容 | 执行域 | 更换限制 |
|---|---|---|---|
| content | 精灵、技能、魂印、地图、关卡、道具 | 编译后静态数据 | 新局生效 |
| mechanic | trigger/operator/规则解释器 | 受控的纯函数规则域 | 规则版本快照 |
| service | 任务、背包、存档、配队、匹配 | Host | 需要迁移检查 |
| presentation | UI、主题、特效、场景适配 | 客户端 | 可热替换且资源可释放 |
| agent | LLM provider、Skill、工具、planner、记忆 | Agent 进程 | 不影响战斗权威性 |
| adapter | DB、模型 API、日志、素材源 | 受权限约束的 Host/Agent | 按依赖重启 |

内容插件优先数据化，不能为每只精灵生成一份 JS 逻辑。新语义才增加 mechanic 插件。

## 契约示意（目标 API，非 Cordis 原生签名）

~~~typescript
type Capability =
  | "battle.observe" | "battle.submit" | "battle.simulate"
  | "content.register" | "ui.register"
  | "storage.read" | "storage.write" | "network.request";

interface PluginManifest {
  id: string;                  // reverse-DNS or seer.*
  version: string;             // semver
  apiRange: string;            // supported contract versions
  type: "content" | "mechanic" | "service" |
        "presentation" | "agent" | "adapter";
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  capabilities?: Capability[];
  entrypoints?: { server?: string; client?: string; agent?: string };
  contentHash?: string;
  signature?: string;
}

interface Disposable { dispose(): void | Promise<void> }

interface SeerContext {
  services: ServiceRegistry;
  events: DomainEventBus;
  config: Readonly<ResolvedConfig>;
  register<T>(key: TypedRegistrationKey<T>, value: T): Disposable;
  require<T>(key: TypedServiceKey<T>): T;
}
~~~

所有注册行为返回 Disposable 且归属当前 plugin scope；一个 scope 卸载时逆序撤销。禁止插件绕过注册表把 listener/handler 注册为不可回收的全局单例。

## 加载流程

1. Discover：仅识别 manifest，不执行未知代码。
2. Validate：Schema、API 兼容、依赖范围、冲突、循环、权限、内容哈希。
3. Resolve：按依赖拓扑排序；可选依赖提供降级标志；冲突不隐式覆盖。
4. Authorize：确认插件来源/签名和权限；服务器不可静默授予文件系统与网络权限。
5. Activate：创建 scope，注入服务，注册能力；事务式激活，失败回滚该 scope。
6. Ready：所有必需 service 就绪后开放外部请求。
7. Quiesce/Dispose：拒绝新任务，结束或等待引用中的工作，逆序释放 listener、UI、worker、GPU、service。
8. Verify：测试无悬挂注册与资源泄漏。

依赖提供者卸载时，下游须先停用或切换替代服务；不允许指向已销毁实例。运行中权威对战的规则依赖必须保留 pinned 版本，不能热卸载。

## Profile/Bundle

Profile 是可版本化配置叠层；Bundle 是发布单位（声明一组 plugins/config/content）。建议：base → game-mode → user override → dev overlay。冲突合并必须定义清楚，数组顺序变化不可影响战斗语义。

~~~yaml
profile: modern-local
bundles:
  - seer.base
  - seer.battle
  - seer.world
  - seer.ui-modern
  - seer.agent-llm
ruleset: modern-2026-pinned
plugins:
  seer.renderer.pixi:
    backend: webgl
  seer.agent.llm:
    provider: configurable
~~~

Profile 不能把 secret 写到仓库；用户配置/凭据单独存储，导出时脱敏。建议提供 classic、modern、headless、agent-eval 四种组合，但首个 milestone 只实现 modern-minimal 与 headless。

## 战斗机制注册特例

Mechanic 插件只注册 versioned effect definition/handler。Handler 不能访问系统时间、文件、网络、不可控 RNG、全局可变状态；输入只包含明确的 snapshot/context，输出 typed effect commands 和排队事件。Dispatcher 验证 command、循环上限与因果链，Reducer 唯一提交权威状态。

同一 phase 同一 priority 时，采用有明确定义的稳定 tie-break 规则，绝不能依赖安装顺序或 JS 对象迭代偶然性。各类替代/取消/反弹等效果需要自己的规则阶段，禁止用简单数字 priority 包办。

新机制上线要求：schema + operator docs + 触发/反触发测试 + 多效果组合测试 + replay fixture + 规则证据与版本。

## 热更新策略

- UI/theme/content：开发环境可以 HMR；生产环境安装需检查占用和清理；内容更新仅进入新战斗实例。
- Service：优雅停用、迁移与恢复；不可热替换有活跃事务的实例。
- Battle core / mechanic：新会话加载新 hash；旧会话保持 pinned 运行时；不能保留旧代码时必须安全结束或等待会话完成。
- Save schema：前向兼容、迁移脚本、dry-run、备份与回滚；不可自动破坏未知插件字段。
- Plugin uninstall：依赖阻断、数据所有权与资源清理须提示。

## 插件安全

将自有可信代码插件与第三方不可信插件分级。数据插件采用严格 schema/大小限制/资源路径限制。第三方可执行插件采用独立进程或有效 sandbox + 能力代理；不能相信 TS 类型或单纯 VM 沙盒能构成隔离。限制 CPU、内存、IO、事件量和模拟时间。Agent 的 battle.submit 需经过游戏权限、合法行动及幂等校验；battle.simulate 无权改当前局。

## 插件合同测试

- 依赖丢失/版本冲突/循环失败可诊断；
- 启动失败时原子回滚；
- 卸载后注册表、事件订阅、worker、纹理句柄无泄漏；
- 两个 Profile 的同一 ruleset+seed 得到同一事件与 state hash；
- UI 替换不影响 battle hash；模型替换不影响引擎结果；
- 内容包未知 operator 被拒绝；规则包 hash 不一致拒绝进入对局；
- 旧对局在热更新后重放不变。

## 决策门槛：直接使用 Cordis 还是仅借鉴

制作两种小 PoC：A 直接基于 Cordis；B 自定义 minimal registry。对照测试服务注入、scope dispose、Profile 合并、SSR/浏览器双环境、规则版本并存、错误恢复和依赖升级。除非 A 不能满足关键约束，否则优先复用而不是写相似框架。

官方架构参考：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
