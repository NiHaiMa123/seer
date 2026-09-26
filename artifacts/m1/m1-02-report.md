# M1-02 执行报告：Host 协议层（单局队列/绑定/inbox/幂等/超时）

日期：2026-09-26。基线：`0625dfd`（M1-01）。任务卡：roadmap §3 M1-02。

## 交付物

**`packages/host/`**（`@seer/host`，进程内单局 Authority）：

| 文件 | 内容 |
|---|---|
| `types.ts` | `HostState`（完整 internal `BattleState` + 内部事件日志 + receipts + resolvedInputs）、`HostError`（wire code 枚举子集）、`toCore`/`fromCore` 适配 |
| `host.ts` | `BattleHost`：`observe`/`history`/`ack`/`submit`/`receiptFor`/`expireDecision`；decision 生命周期（open→collect→resolve→next）；无 wall-clock，deadline 为逻辑字段 |
| `events.ts` | `CoreEvent`→`InternalEvent` 包装（seq/causeId/revision 对）；internal→public **类型+字段双重白名单投影** |
| `project.ts` | 侧锁定 `Observation`：己方 PP 明、对手 `ppEstimate=unknown`、hidden effects 不外发；`projectHistory` seq>cursor 过滤 |

## 协议语义（对应任务卡验收）

- **决策**：`dec_<battle>-t<turn>`，actors=存活侧；提交进 `inbox`（schema 字段 `canonicalDigest`/`receiptId`/`receivedSeq` 齐全），收齐即 resolve。
- **幂等**：`idempotencyKey` 全局（不限决策期）——同 key 同 payload → `duplicate-replay`；异 payload → `IDEMPOTENCY_CONFLICT`；决策关闭后精确重复仍取回 receipt。每侧每决策仅一提交（`ALREADY_SUBMITTED`）。
- **拒绝**：`UNAUTHORIZED`（未绑定玩家/非 actor）、`STALE_DECISION`（关闭/错 decisionId/baseRevision）、`INVALID_SCHEMA`（actionId 形态）、`ILLEGAL_ACTION`（当前不可行，如有 PP 时 struggle）、`NOT_FOUND`（battleId 不符）。
- **超时**：`expireDecision` 由调用方驱动；未提交侧不进 inbox，resolved action = `null` → §9 确定默认（实测 bolster），receipt 痕迹记 `timeout_default`。
- **ACK**：`ack` 只前进己方 `publicCursors`，单调 clamp 到 `eventSeq`。

## 验收

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm test:protocol` | 0 | **21 场景**（要求 ≥16）：任务卡全部点名场景覆盖（交换顺序一致/同时成功/重复一次/异 key 冲突/ACK 隔离/过期+伪侧拒绝/过期后 receipt 取回） |
| 全 gate 回归 | 0 | contracts/boundaries/privacy/core(10k seeded)/plugin/determinism 全过 |

## 过程中的真实发现

- **inbox schema 反例**：`inboxSubmission.actionId` 必须 `act_` 形态——超时不产生真实 actionId，因此**超时不写 inbox**（inbox 只记录真实提交）；timeout 痕迹放 receipt 与 `input-received(timedOut)` 内部事件。
- **`causeId` 为 `string|null`**（事件引用 id），非 seq 数字——包装签名已按 schema 修正。
- 公开事件白名单 vs 内部事件 union：公共侧无 `pp-spent`/`rng-draw`/`decision-opened`/`input-received`/`effect-applied`——这些是私密粒度，投影丢弃；`battle-end` 亦不在 union 但保留公开（终局必然公开）。

## 已知限制（如实记录）

- `ENGINE_FAULT` 目前是抛 `HostError`——正确姿势是持久化 fault 后进入 suspended/error 态（contracts §5）；**fault 持久化属 M1-04 持久化范畴**，当前会抛出并记录。
- Host 进程内单线程顺序处理；并发（多局/跨进程 WS）在 M1-03+ 与 Fastify 集成时展开。
- `deadlineMs` 为逻辑字段——wall-clock 调度器属 transport 层。
