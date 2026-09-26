# 实施路线与阶段验收 v0.1

## 总策略

采用纵向闭环而非一次铺满目录：每阶段都能演示、运行、重放、测试。最终目标是完整页游复刻及具备人类式战术推理的 LLM Agent，但初始只实现代表性机制测试池。12 只精灵只是第一批候选规模，不是硬指标；按机制覆盖率选择。

任一阶段若出现未核实的原作规则，记录 evidence gap 并在可用规则范围内推进，不能无限循环或臆造。

## M0 架构验证与目标版本锁定

任务：
- 明确原作规则快照和首批 1v1/PVP/PVE 范围，建立规则证据索引；
- Cordis 直接使用 vs minimal registry 两个 PoC，比对 API、卸载、跨端和规则并存；
- 定义 contract schemas、插件 manifest、snapshot/observation、command/event schema；
- 小型无头性能基准，选 WebGL-first PixiJS 渲染路线；
- 确认资源公开分发边界。

完成定义：
- 一个文档化规则快照、一个可执行 plugin activation/dispose 测试；
- 完整 API 草案有示例与负向用例；
- 记录 ADR：采用/不采用 Cordis 原因；不创建无消费者空包。

## M1 战斗垂直切片

任务：
- 原子状态转移、可复现 RNG、行动意图验证和两个玩家输入；
- 基础伤害、属性、PP、先制/速度与少量基础状态；
- Headless CLI、完整事件日志、snapshot、replay；
- 最小 PixiJS 战斗场景与 React 技能按钮。

完成定义：
- 选定规则的 Golden Battles 全通过；
- 同输入与 seed 得到逐事件一致的 hash；
- UI 跳过/加速动画不改变结算；
- 运行中无法提交旧状态或重复动作。

## M2 扩展机制与插件系统

任务：
- Content DSL 编译、Effect Registry 与稳定阶段表；
- 代表性强化/吸强/控制/免疫/资源/恢复/切换组合；
- 新机制插件契约、权限、版本 pinned、回归；
- 数据导入和规则证据管理后台最小形态。

完成定义：
- 新增已有机制精灵不用编辑 battle-core；
- 新机制以 handler + test 插件安装并被旧版 session 隔离；
- 未支持的 operator 在 CI 中报错；
- plugin install/dispose/rollback/依赖冲突测试通过。

## M3 第一代智能对战

任务：
- observation/legal actions/knowledge/sim/submit 工具；
- Skill：威胁识别、组合、反制候选、行动后复盘；
- LLM candidate proposer + headless simulator + Beam Search；
- belief state 与“不可偷看”的隐藏信息测试；
- rule-based baseline 与 Agent 对照测试。

完成定义：
- 100% 提交合法 action（非法候选由接口拒绝并计入失败）；
- 关键机制解释以规则与事件证据支撑；
- Novel-mechanic 集没有内置专属攻略，仍可发现有效反制；
- 统计胜率、机制正确率、决策 p95、token/局和模拟吞吐，并出评测报告；
- 复杂机制失败必须标注根因：知识/规则/搜索/动作/感知。

## M4 完整战斗模式与初级世界

任务：
- 队伍 6v6/正式规则（依目标版本核实）、替补切换与队伍资源；
- PVE、Boss 例外与不同模式 ruleset；
- World、Quest、Inventory、Save 最小闭环；
- World Agent 目标编排和 Team Builder。

完成定义：
- 玩家和 Agent 可以完成一个端到端的任务→配队→战斗→奖励→存档流程；
- 局内/局外状态事务边界清晰；
- 规则版本更新不破坏旧存档和回放。

## M5 扩容与性能验证

任务：
- 机制覆盖驱动的精灵/道具/关卡内容导入；
- 纹理 atlas、资源缓存、UI 虚拟化与 GPU 资源回收；
- Simulator worker pool、增量快照、效果索引；
- 公开资产合规与版本交付工具。

完成定义：
- 在声明的目标机器和浏览器上完成帧率/长任务/内存/加载基准；
- 扩容不显著改变单局结算成本（以 active effect 数量为主要量纲）；
- 导入报告无 silent unknown rule；
- 隔离测试证明第三方插件无法直接取得未授权系统能力。

## M6 自我对战与模型优化（按实测收益决定）

任务：经审核的日志训练候选排序/价值模型；对手策略池、自我对战、跨版本评测；高成本大模型留给关键局面，轻量本地模型负责常见局面。

完成定义：与冻结的基线、不同测试对手在未见场景上比较，披露样本量、置信度、模型/Skill/规则版本。若性能没有可验证提高，停止训练路线而不是反复拟合旧样例。

## 最小任务顺序

1. 冻结 schema 和规则证据模板；
2. 做 Cordis 适配 PoC（拒绝没有生命周期/隔离测试的插件框架）；
3. pure battle-core + golden fixture；
4. 1v1 UI + replay；
5. Effect DSL/机制内容包；
6. legal-actions/observe/simulate/submit；
7. LLM Skill + planner + eval；
8. 逐步增加复杂魂印、队伍和地图。

## 风险台账

| 风险 | 早期信号 | 缓解 |
|---|---|---|
| 原作规则资料不完整 | 同技能不同来源互相矛盾 | 锁版本、标来源、pending、对照 fixture |
| 插件过度设计 | 大量空包、改接口比实现功能多 | PoC + 最小内核 + 有消费者才建包 |
| 插件顺序影响战斗 | 不同加载次序不同结果 | 纯 reducer、排序表、固定 hash、重放测试 |
| AI 看似聪明但规则错 | 相似度高而实战无效 | 精确工具+模拟，封闭未见机制评测 |
| Agent 延迟导致卡顿 | UI 主线程受阻/对战超时 | 独立进程、deadline、fallback |
| 资产许可不清 | 资源不能公开分发 | placeholder、自制/获授权素材、分离研究环境 |
| 无限修复循环 | 多轮改动无客观指标 | 验收阈值、时间/尝试预算、停止条件 |

## 不应提前做的事

- 一次导入全部精灵、全部地图或复杂商业化系统；
- UI 高保真先于规则测试；
- 为单一精灵写不可复用机制补丁；
- 在未证明基础 Agent 有效前进行大规模模型微调；
- 同时维护浏览器和服务端两套战斗结算；
- 把真实秘密/原作资产打包进入公开 Git 仓库。

## 规划完成后推荐的第一批 Issues

A. Rule Snapshot & Evidence Register；
B. Plugin Runtime PoC；
C. Battle State/Command/Event Schemas；
D. Deterministic 1v1 Core；
E. Replay & Golden Test Harness；
F. Content DSL Validation；
G. Agent Observation/Action Tool Contract；
H. Headless Simulator Benchmarks。

每个 Issue 应有输入、输出、验收用例、依赖、停止条件和证据路径。先评审架构再开大范围执行任务。
