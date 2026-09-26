# 实施路线与验收 v0.2

**本轮完成架构规划；下列产品任务均未开始。** 文档/契约示例检查不等于 M0 完成。所有命令是未来执行者必须建立的 script 名称，目前不能声称已存在。先按任务卡顺序完成可审查小提交，不一次铺满空包。

## 1. 工作纪律与停止条件

每项交付必须包含 git SHA、环境、精确命令、exit code、fixture/hash 与结果路径。`NOT_RUN/BLOCKED/FAIL/PASS` 分开；pending 原作规则、跳过测试不能算通过。输入变更后重跑受影响 gate，不靠上次结果。执行者可以修实现，不能为通过而修改 golden expected、隐藏失败局或放宽冻结阈值。

每项最多两轮“有明确假设→有证据修复→同 gate 复测”；仍失败输出根因类别、最小复现与建议，转下一可独立任务。主要实验时间盒见表，是工作量上限而非交付承诺。无原作资料继续 synthetic；性能缺实机明确 BLOCKED，不无限等待。不得把这些规则理解为禁止正常调试或强迫不可能的通过率。

## 2. M0：契约和关键风险验证

依赖顺序：M0-01 → M0-02 → M0-03/M0-04/M0-05 → M0-06。编号只是切片，不要求多个 Agent 并行。

| 任务 | 输入 / 范围 | 产物 | 自动验收 / 证据 | 时间盒与阻塞 |
|---|---|---|---|---|
| M0-01 工作区与规则边界 | 当前 docs、synthetic 默认、官方来源 | pnpm workspace/精确 lock、Node pin、TS strict 配置、`docs/rules/synthetic-v1.md`、原作 claim 模板；只建立有消费者目录 | `pnpm install --frozen-lockfile`、`pnpm typecheck`；`pnpm content:validate` 拒绝缺字段/未知 operator/不明 public license；报告原作 VERIFIED=0 | 1 工作日；外网依赖不可用即 BLOCKED，不造 lock |
| M0-02 正式 contracts | contracts.ts 示例 + synthetic 规范 | public/internal 分入口；Command/Observation/Event/Manifest/Effect/Tool JSON Schema 真源、类型生成、错误表 | `pnpm test:contracts` ≥20 正/反样例；未知字段/越界/伪 actor 拒绝；`pnpm test:privacy` 两秘密状态的 observe/legal/history/trace 完全一致；`pnpm check:boundaries` 禁 internal→client/agent | 1–2 工作日；实现所有 schema，不仅示例 Command |
| M0-03 Cordis 薄适配 PoC | 上游 rc.10 精确工件、ADR-001 | provider/consumer、require/register/own、无业务写入的 staged scope、`artifacts/m0/cordis-report.json` | `pnpm test:plugin` 覆盖缺依赖/冲突/循环/失败清理/异步重入/重复 dispose/cleanup 新注册拒绝；100 cycles owned 资源回基线；类型/API来源记录 | 2 工作日或两轮；失败按 ADR 降级，不能自研全插件平台 |
| M0-04 确定性基础 | synthetic 数值/排序规范 | RNG算法/来源/测试向量、canonical encoder、最小 transition fixture；无真实游戏内容 | `pnpm test:determinism` ≥20 边界向量，Node 与 Playwright Chromium 同 seed 字节一致；输入 frozen 不变；含对象键排列、safe integer、抽样边界、排序与 fault 原子性 | 1–2 工作日；这是 tiny fixture，不能报真实 core 吞吐 |
| M0-05 渲染/成本 PoC | Pixi 8.21.0、R1/R3、可用设备 | React mount+Pixi init/cleanup、占位 atlas、最小 Worker roundtrip 测量、原始性能 samples | `pnpm test:render` 验证重复 mount/unmount/ticker 归零；`pnpm bench:render`/`bench:resources`；记录真实硬件；无 D1 则标 BLOCKED | 1 工作日；不开发高保真 UI/资源市场 |
| M0-06 收敛与进 M1 | 上述报告和 open questions | `docs/m0-results.md`、更新 ADR 状态、已冻结 synthetic-v1、M1 fixture 清单 | `pnpm verify:m0` 聚合前五项，任何硬 gate 非 PASS 返回非零；列未测性能/原作真实性，不能声称 M0 全通过 | 半工作日；功能 M1 可在明确性能 BLOCKED 时继续，但性能 gate 不豁免 |

M0-01 的 synthetic 规范必须明确：2 单位、各 4 动作（普通攻击/先制低伤/强化/回复）、HP/PP/速度/公式/舍入/平速/死亡/失败消耗/struggle/终局。所有数值为自制 fixture，不借原作名字暗示真实性。强化/回复先用最小封闭 IR 证明扩展，复杂魂印留 M2。

M0 schema 非干扰测试可以先用独立投影 fixture 实现，随后 M1 集成真实状态；不能因“核心没完成”忽略 wire 边界。每个 M0 PoC 保持可删除，不永久作为第二套引擎。

## 3. M1：第一个可玩、可重放 1v1

前置：M0 合同/确定性硬 gate 通过，Cordis 路线明确；性能 BLOCKED 有记录。M1 不包含正式多人账号、地图、全部精灵、云模型或第三方任意代码。

| 任务 / 依赖 | 实现与输出 | 自动验收 |
|---|---|---|
| M1-01 / M0-02,04 | pure battle-core、synthetic-v1 loader、阶段表、整数伤害/PP/先制/强化/回复/struggle、基础控制失败 fixture | `pnpm test:core` ≥24 独立 golden；≥10000 seeded 属性用例验证 HP/PP/输入不变/确定性；默认 fixture 循环上限不触发，恶意 fixture 确定触发且原状态不变 |
| M1-02 / 01 | Host 单局队列、身份绑定、decision/private inbox、idempotency、Timeout policy | `pnpm test:protocol` ≥16 场景；A/B 交换顺序结果一致；同时首提交均成功；重复只一次生效；异内容 key 冲突；A ACK 不改 B observation；过期/伪 side 拒绝；精确重复在过期后仍取回 receipt |
| M1-03 / 01,02 | public projection、view cursor/WS reconnect、无真实状态的只读工具入口 | `pnpm test:privacy` 接真实 core；改秘密配招/RNG 不改公开响应；隐藏事件不增 view cursor；断线/重复/丢包重同步得到同视角状态；无内部 hash/trace 出网 |
| M1-04 / 02 | SQLite 事务 inbox/receipt/state/log；headless replay；crash recovery | `pnpm test:recovery` 在收 A 后、收 B 提交前、结算 commit 后 ACK 前杀进程；恢复不丢已 ACK 意图/不重复 transition；`pnpm replay:verify` ≥20 局逐事件/state hash 一致；篡改 manifest/旧工件缺失明确失败 |
| M1-05 / 03 | React 技能按钮、Pixi 占位战斗、规则 AI、连 Host；动画倍速/跳过 | `pnpm test:e2e` 两浏览器上下文输入及玩家对基线完整终局；跳动画与正常播放 authoritative hash 相同；UI 在 mock 慢工具时可操作；socket/scene cleanup 无重复 listener |
| M1-06 / 04,05 | 可启动 demo、CLI、基准、演示说明与已知局限 | `pnpm verify:m1` 串联 typecheck/content/core/protocol/privacy/recovery/e2e/replay；`bench:core B1`、R1/R3/H1 真实报告；每 gate 单列 PASS/FAIL/BLOCKED |

首批 24 golden 至少：伤害/舍入 4、PP/struggle 3、先制/速度/平速 4、强化/回复 4、失败动作 2、KO/终局 3、RNG/排序 2、故障回滚 2。它们来自 synthetic 规范；原作测试另册。更高数量不能补偿关键类别缺失。

M1 完成的用户可见结果：一条启动命令进入本地网页，选择动作打一局，有胜负和公开回放；关闭重启可恢复已持久化局；headless 能复跑同局。报告明确“工程测试规则”，不冒充已完成赛尔号全部战斗。

## 4. M2–M6

| 阶段 | 范围 | 完成定义 / 止损 |
|---|---|---|
| M2 机制与插件 | 后备切换、checkpoint/复活、吸强/消强、控制/反控、伤害分类、mode overlay、content compiler、runtime generations | 新普通单位只加数据，至少 3 种复杂交互链 + 反例；未知 operator fail；v1/v2 同时运行旧局 hash 不变；新 phase 升契约有 ADR；每机制正/负/边界 fixture；原作未证继续隔离 |
| M3 智能对战 | 受限 tools/Skill、模型 adapter、belief、模拟池、joint-action beam、fallback | agent.md 的 60 状态/dev-holdout、6 组消融、paired 200局×3重复、安全/预算/增益 gate；两轮 dev 后无增益保留 search-only，不能直接跳微调 |
| M4 模式与初级世界 | 目标版本队伍规模、PVE/BOSS、world/quest/inventory/save、奖励 outbox；联网 PVP 可选 | 一个任务→配队→战斗→奖励→存档闭环；重试/崩溃不重复发奖；模式可见性与原作规则有证据；公网前加鉴权/配额/房主接管/fencing/重连及 Q13 密码学随机流测试 |
| M5 扩容与交付 | 机制覆盖驱动导入、atlas/缓存、正式最低设备预算、内容编辑工具 | B2/B3/R2/R3 等基准达标；公开资产清单完整；扩容不扫描全图鉴；未知/冲突报告可追踪；第三方执行仍须另过 sandbox gate |
| M6 学习与优化 | 经审核对局、自我对战、多对手池、轻模型蒸馏 | 未见场景相对冻结基线有统计增益并满足成本预算；没有增益停止，保持现有可用策略 |

视觉点击 Agent、纯浏览器离线、WebGPU/WASM、微服务、全量素材高保真、插件市场均为后续独立需求，不塞进 M0/M1。

## 5. 可直接交给执行 Agent 的第一项任务

> 只执行 M0-01，并为 M0-02 准备输入。先拉取最新 main/已合并规划分支，读 README、contracts、battle-engine、ADR-001/004。建立 pnpm+TS strict 的最小 workspace 与精确依赖锁，创建 synthetic-v1 工程规则和 claim 模板、内容验证脚本；不实现完整战斗、不接云模型、不导入原作资产、不建无消费者包。运行 frozen install/typecheck/content validate，提交命令和结果到 artifacts/m0。遇到依赖不可安装或规范冲突，记录 BLOCKED 与最小原因；禁止修改验收来假装完成。完成后交付一个小提交及后续 M0-02 的输入清单。

## 6. 证据路径约定

后续工程结果：`artifacts/m0/`、`artifacts/m1/`、`artifacts/perf/`、`artifacts/eval/`；大型/private replay 不直接入 public Git，用摘要清单与受控存储引用。报告中不要记录模型密钥、内部隐藏战局数据或未经许可资料。README 进度只在对应 gate 真实运行后更新。
