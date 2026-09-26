# M1-04 执行报告：SQLite 持久化、headless replay、crash recovery

日期：2026-09-26。基线：`35eeac7`（M1-03）。任务卡：roadmap §3 M1-04。

## 交付物

| 文件 | 内容 |
|---|---|
| `packages/host/src/store.ts` | `BattleStore`：node:sqlite（`DatabaseSync`，零原生依赖）；`battles`(init 快照+权威态+meta) / `internal_events` / `public_stream` / `receipts` / `resolved_inputs` 五表；每个写入单元独立事务；`coreHashOf`（剥协议字段的 hash 口径） |
| `packages/host/src/persisted.ts` | `PersistedBattleHost`：`submit`→tx1{receipt+input事件+inbox态} + resolve 后 tx2{state+事件+公开流+resolvedInput+stateHash}；`restore` 崩溃恢复（未决完整 inbox → 补确定性 resolve） |
| `packages/host/src/replay.ts` | `replayBattle`：init 快照 → 逐 resolvedInput `applyTurn` → 逐步比对 `state_hash`；负例码 `ARTIFACT_UNAVAILABLE` / `REPLAY_MISMATCH` / `MALFORMED_RECORD` |
| `tools/replay-verify.ts` | `pnpm replay:verify` 门禁：20 seeded 局全量重放 + 2 负例 |

## 验收（对照任务卡）

| 验收点 | 结果 |
|---|---|
| `test:recovery` 三断点 | ✅ 9/9：收 A 后/收 B 后结算 commit 前/结算 commit 后 ACK 前——恢复均不丢已 ACK 意图、不重复 transition |
| `replay:verify` ≥20 局 | ✅ 22/22：20 局逐 transition hash 一致 + tamper→REPLAY_MISMATCH + missing→ARTIFACT_UNAVAILABLE |
| 篡改 manifest/旧工件缺失 | ✅ 负例全显式失败（rulesetHash 篡改 → ARTIFACT_UNAVAILABLE；init 损坏 → MALFORMED_RECORD） |

## 过程中的真实发现

1. **`revealedMoveIds` 归属错误（真实 bug）**：原本 Host 在 resolve 后写 `unit.revealedMoveIds`——该字段在 hash 状态内 → 持久化 hash 与 core 重放不一致。修法：揭示逻辑下沉到 `applyTurn`（确定性 transition 产物），Host 只包装事件。**这正是"hash 必须对齐 core 口径"的价值**。
2. **WAL 模式在 Windows 的 `close()` 会 EPERM**（wal/shm 清理句柄）→ 单进程嵌入式改默认 rollback journal。
3. **Node strip-only 不支持 TS 参数属性**（`constructor(private x)`）→ `EngineFault`/`HostError` 显式字段声明。
4. **公开流 seq 与内部 seq 的口径一致性**：`commitResolution` 用 `coreHashOf`（剥 inbox/decision/cursors/eventSeq）使 hash 与 `applyTurn` 输出同口径——否则 replay 永远 mismatch。

## 已知限制（如实）

- 崩溃模拟为**进程内对象丢弃+restore**（同一 sqlite 文件）：真实跨进程/断电崩溃的语义等价性需要 transport 层（M1-05+）覆盖；当前证明了"持久化→重建→继续"的确定性等价。
- `pendingDecisionId` 恢复路径只处理"收齐未 resolve"；收 A 未收 B 的中间态只需继续等 B（无悬挂清理）。
- resolved_inputs 以 `decision_id` 为幂等键（每决策至多一条）——合理但隐含 v1 每回合至多一决策。
