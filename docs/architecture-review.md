# 独立架构审查记录

日期：2026-09-26。输入：main `3dcb760070239b3b723675b7e7d991c08facbcf7` 的 README、六份设计文档和 WORK_HANDOFF。仓库无产品源码、package manifest 或已运行战斗测试。本轮为架构审查与契约示例，不等于完成 M0/M1。

## 发现与处置

| ID / 级别 | 原方案问题 | 后果 | 决定与验证入口 |
|---|---|---|---|
| R01 / P0 | Command 共用 state version，无 inbox 语义 | A 提交可能让 B 过期；ACK 泄露行动 | 冻结 decision/baseRevision、私有 inbox；M1-02 |
| R02 / P0 | 内部 Event 含 patch、cause、RNG refs | 只过滤 state 仍泄密 | 公共事件另建 union、独立 cursor；M0-02 |
| R03 / P0 | simulator snapshot 来源模糊 | 可通过伤害/合法动作反推秘密 | 仅观察和自建 belief；ADR-003 |
| R04 / P0 | 无持久化 ACK、崩溃、重复奖励约定 | 重复结算/发奖或动作丢失 | 事务 receipt、输入日志、outbox；M1-04/M4 |
| R05 / P1 | Cordis/DSH 当作可互换运行时 | vendor 修复与上游保证不等价 | 薄适配、固定候选、实测；ADR-001 |
| R06 / P1 | “事务式激活/热替换”无副作用范围 | 文件/网络不可自动回滚 | staged registry、activation 禁业务写入、generation pin |
| R07 / P1 | 能力声明容易误解为沙箱 | fs/fetch 可绕过 Context | 可信代码模型；第三方执行延期 |
| R08 / P1 | 确定性仅写 seed | 数值/hash 漂移、半回合状态 | 整数/舍入、canonical bytes、原子 transition、失败上限 |
| R09 / P1 | 抽象 phase 把复活检查放回合尾 | KO/复活可能需行动中打断 | 伤害后检查点与独立 decision；原作顺序待证 |
| R10 / P1 | 搜索缺信息集约束 | 未来策略使用未揭示秘密，成绩虚高 | 联合动作、信息集共享策略、隐藏世界配对 |
| R11 / P1 | 性能无设备/负载/测量方式 | 高配演示掩盖复制/资源开销 | 基准矩阵和帧时间分位数；实测留空 |
| R12 / P2 | Python/TS、SQLite/PG、双内核并列 | 首轮范围扩散 | TS Agent、本地 SQLite、一个 Cordis PoC |
| R13 / P1 | “生成 golden”可能实现自己出答案 | 错误语义自证 | 工程规范/原作证据独立给 expected |
| R14 / P2 | 缺扩展反例与版本轴职责 | 误以为任意魂印只加 JSON | 扩展矩阵、ADR-005 |

## 保留的正确方向

保留纯 core、引擎与模拟器共享、React/Pixi 分工、数据化规则、可撤销插件、版本 pin、观察投影、LLM+工具+模拟、证据驱动扩容。未找到足以把具体原作结算顺序标记 VERIFIED 的资料；没有补写猜测的原作规则。

## 交接覆盖

| WORK_HANDOFF | 交付 |
|---|---|
| A 插件/隔离/版本 | plugin-system、contracts、ADR-001/005 |
| B 分区/部署/模型 seam | architecture、contracts、ADR-004 |
| C 确定性/DSL/特殊规则 | battle-engine、ADR-002 |
| D 智能/未知反制/评测 | agent、ADR-003、roadmap M3 |
| E 性能 | performance-plan |
| F 数据/公开边界 | data-and-content、open-questions |
| G 扩展反例 | plugin-system 第 6 节 |
| 精确 M0→M1 | roadmap，未运行 gate 不标完成 |

## 本轮验证与限制

交付前执行文档链接/空白检查与契约示例检查，结果见 [validation](validation.md)。Cordis 生命周期、浏览器性能、原作真实性和 Agent 智能实验属于 M0+；不能把文档检查称为产品测试通过。性能阈值是预算，不是实测。
