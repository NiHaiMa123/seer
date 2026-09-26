# M1-03 执行报告：公开投影、view cursor、resync、只读工具入口

日期：2026-09-26。基线：`99370bd`（M1-02）。任务卡：roadmap §3 M1-03。

## 交付物与架构变化

**关键语义变化：`publicCursors` 不再使用内部 `eventSeq`**，改为独立的公开流 seq：

- `HostState.publicStream` —— 已投影白名单事件的公开流，seq 连续 1..N
- `emit()` 对每条内部事件做白名单投影：通过 → 进 `publicStream`（`publicSeq` 推进）；内部专属 → 仅留内部日志
- 结果：**`input-received`/`decision-opened`/`pp-spent`/`rng-draw` 永不推进 view cursor**——隐藏事件不可见也不留可推断的空隙信号

**新增**：

- `BattleHost.resync(playerId, since)` —— 返回 `seq>since` 的公开事件 + 权威 Observation；断线/丢包重同步入口
- `createReadOnlyView(host, playerId)` —— 只读工具面（observe/legal_actions/history/resync），Agent 工具面的协议基座；无写路径

## 验收（对照任务卡）

| 验收点 | 结果 |
|---|---|
| `pnpm test:privacy` 接真实 core | ✅ 16 用例：7 个 M0 fixture + **9 个走真实 BattleHost** |
| 改秘密配招/RNG 不改公开响应 | ✅ 两组差异实验：异 seed（无 tie 时公开一致）、对手 PP 篡改（`ppEstimate=unknown` 遮蔽） |
| 隐藏事件不增 view cursor | ✅ `publicSeq` 只数白名单事件；提交（input-received）不涨 cursor；seq 连续无缺口 |
| 断线/重复/丢包重同步同视角 | ✅ `resync(0)` 全量重放一致；mid-cursor 后缀正确；重复 resync canonical 相同 |
| 无内部 hash/trace 出网 | ✅ 公开 JSON 扫描：无 `seedHex|drawCounter|canonicalDigest|receiptId|statePatch|revisionBefore|causeId|rngDraw`；对手 `hidden:true` effect 零投影 |

## 全 gate 回归

typecheck / contracts:check / boundaries / contracts / core(10k seeded) / plugin / determinism 全部 EXIT=0。

## 过程中发现

- **旧实现 cursor 共享内部 seq 是真实语义缺陷**：内部事件会推进 view cursor，给对手留下"有事件但看不到"的时序/计数侧信道。独立公开 seq 同时解决可见性与计数泄露。
- **`hidden` effect 字段**已按对手侧过滤（己方 unit.effects 仍对自身完整可见——v1 未见己方需要隐藏的语义，按现状记录）。

## 已知限制

- `ReadOnlyView` 为进程内闭包——语言级隔离而非安全边界；跨进程/WS 的强制隔离属于 M1-05+ 传输层。
- resync 权威观察快照不区分"快照已含未 ACK 事件"——客户端以 seq 连续性自证，与 viewCursor ack 语义解耦。
