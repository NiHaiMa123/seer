# M2-07 完成定义审计与收口门禁

日期：2026-09-27。聚合证据：`artifacts/m2/verify-m2.json`；M2-08 纳入后最终结果 **22/22 PASS**。

## Roadmap 完成定义逐项核对

| 完成条件 | 状态 | 证据 |
|---|---|---|
| 新普通单位只加数据 | PASS | `loader-v2.test.ts` 纯 JSON 新单位编译，contentHash 改变且无 core 修改 |
| 至少 3 种复杂交互链 + 反例 | PASS | `interactions-v2.test.ts`：control→cleanse/普通动作阻断；吸强→switch 状态隔离/boss overlay；revive→耗尽→replacement/无 bench 终局 |
| 未知 operator fail | PASS | loader schema/allowlist/feature gate；`mind_control` 与未声明 feature 负例 |
| v1/v2 同时运行旧局 hash 不变 | PASS | generation pin + artifact restore；v1 初始 hash 固定 `806630...7c26`，M1 完整 demo hash 固定 `605035...dbd3e`，replay 22/22 |
| 新 phase/状态契约有 ADR | PASS | ADR-006 + optional suspension/checkpoint/replacement 契约；v1 不写新增字段 |
| 每机制正/负/边界 fixture | PASS | mechanics 18、switching 12、loader 11；补齐 timed tag fade 和 bench feature/0..2 数量边界 |
| 原作未证继续隔离 | PASS | content gate 显示 synthetic-v1/v2 均 `SYNTHETIC`，原作 VERIFIED=0 |
| content compiler | PASS | `compilePack` schema+semantic compiler、三 hash 工件、未知语义拒绝、数据单位门禁 |
| runtime generations | PASS | 同 executableHash 双代、第三代等待、drain、artifact catalog、恢复绑定及不同 executableHash 独立进程执行域均完成；见 M2-08 |

## 本轮修正

- 将伪 golden（只匹配 64 位格式）改为固定 v1 初始 hash，并让 M1 demo 强制比对历史最终 hash。
- 新增三条独立复杂交互链，每条包含有效分支和前提不满足/免疫/资源耗尽反例。
- synthetic-v2 文档 IR 口径从错误的 2 修正为 feature-gated additive IR 1；switch actionId 修正为 `act_switch-<i>`。
- 冻结 `limits.maxBenchSize=2`；v1 无 bench feature 时强制拒绝，v2 第三个 bench 强制拒绝。
- 补齐 `apply_effect` 三回合到期 fade 边界。
- 新增 `verify:m2`：安装锁、类型、内容、契约、边界、core、交互链、协议、恢复、插件、装配、generation、artifact、executable isolation、Node/Chromium 确定性、replay、固定 hash demo、E2E、tracked/untracked 工作树空白检查共 22 项。

## 结论

本审计最初识别的唯一硬缺口——不同 `executableHash` 的隔离执行域——已由 M2-08 补齐。可信 catalog 绑定独立进程 entrypoint，live transition、SQLite restore、replay 和 drain 均有自动测试；无 executor 的非当前 hash 仍 fail closed。`pnpm verify:m2` 22/22 PASS 后，M2 可标记为完成。
