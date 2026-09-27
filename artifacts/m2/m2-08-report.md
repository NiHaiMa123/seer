# M2-08 执行报告：不同 executableHash 的独立进程执行域

日期：2026-09-27。输入：M2-07 审计唯一剩余硬缺口。

## 执行域

| 能力 | 实现 |
|---|---|
| executor contract | `TransitionExecutor` 统一 init、legalActions、applyTurn、applyReplacement；Host 所有权威入口均通过 executor |
| 当前引擎快路 | `InProcessTransitionExecutor` 只接受编译期固定的 `ENGINE_EXECUTABLE_HASH`；其他 hash 不得在当前进程冒充执行 |
| 隔离进程 | `ProcessTransitionExecutor` 用有界同步 JSON RPC 启动独立 Node 进程，可信 entrypoint 执行指定工件；5s timeout、4 MiB 输出上限、非零/坏 JSON/畸形结果均 fail closed |
| 工件绑定 | `RuntimeArtifactCatalog.register(pack, processConfig)` 将三 hash generation 与进程 entrypoint/payload 绑定；generation descriptor/lease 标记 isolated |
| Authority 路由 | BattleHost 初始化、观察合法动作、提交合法校验、turn/replacement transition 均走绑定 executor；executor legalActions 是公开合法集唯一权威来源，主进程只补充 wire 描述 |
| 恢复与 replay | BattleManager.restore 恢复 isolated lease/executor；Host/replay 强制 executor 与 pack executableHash 一致，缺 executor 的非当前 hash 在激活 generation 前失败 |
| drain | isolated generation 与普通 generation 共用引用计数；使用中 retire 拒绝，终局 unload 后释放并可退役 |

## 验收

- `pnpm test:executables`：7/7。
  - 不同 executableHash 的 init/legal/live turn/SQLite restore/replay 均在子进程 PID 执行。
  - Host/replay 拒绝错误 executableHash executor；自定义 executor 的 legal set 不再被当前引擎语义裁剪。
  - 缺失 isolated executor 的 restore 在 generation 激活前失败，registry 保持为空。
  - isolated generation markDraining 后使用中 retire 拒绝，终局 unload 释放引用。
  - 子进程初始化故障、非零退出、坏 JSON、超时、输出超限或畸形 init/legal/transition 响应均 fail closed；初始化不创建 SQLite battle、不加入 manager、lease 回到 0。
  - resolve 阶段子进程故障会回滚本次 inbox/receipt/seq，保留此前已接受的另一侧输入且 revision 不推进。
- `pnpm verify:m2`：22/22 PASS；包含 frozen install、内容/契约/边界、core 74（含 10k 属性）、三条复杂交互、protocol/privacy/recovery、plugin/assembly/generation/artifact/executable、Node+Chromium 确定性、replay、固定 v1 hash demo、E2E，以及 tracked/untracked 工作树空白检查。

## 边界

进程 entrypoint 只来自可信 artifact catalog，不是第三方代码沙箱；当前实现每次调用启动独立进程，优先证明隔离和确定性，不声称达到性能预算。后续可在不改变 executor contract 的前提下替换为按 generation 常驻 worker 池并增加 drain/超时基准。测试 legacy entrypoint 使用相同工程规则语义但独立 executable identity，用于证明路由、恢复和故障边界；真实历史引擎工件可通过同一协议接入。

## 结论

M2 roadmap 的机制、content compiler、复杂交互链、v1 固定 hash、插件装配、runtime generations、artifact restore 和 executable isolation 均有自动门禁。M2 完成。
