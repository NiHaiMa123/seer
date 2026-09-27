# M4-03 — world service（存档/背包/任务 + reward outbox exactly-once）

## 产出

### `packages/world`（新包，域分离：`world.db` 与 `battle.db` 并列）

- **`store.ts` — WorldStore**：`players` / `teams` / `inventory` / `quests` / `rewards`（outbox）五表；`tx()` 单事务；`node:sqlite`。
- **`service.ts` — WorldService**：registerPlayer / profile / saveTeam / teams / quests / **claimReward**。

### Reward outbox — exactly-once（ARCHITECTURE.md 口径）

- 唯一键 = **`(battleId, recipient, resultRevision)` PK**——重复 claim 由键冲突转为回执重放（`fresh:false`），绝不二次入账。
- `claimReward` 单事务做：outbox 插入 + inventory 入账 + 胜/负战绩 + 任务进度推进 + 任务完成奖励——**崩溃安全**：要么全成要么全滚。
- entitlement 由服务侧权威终局决定（`PersistedBattleHost.outcome()` = terminal+revision），调用方不能指定奖励内容；`UNAUTHORIZED` 非 owner；未终局 → 409。
- 合成奖励表（自制）：胜 `item-orb×1`、负/平 `item-shard×1`；任务奖 `q_first_win`/`q_winner_3`/`q_boss_slayer`（胜 epsilon 解锁）。

### Server 端点（strict 校验）

| 路由 | 方法 | 语义 |
|---|---|---|
| `/api/world/player` | POST | 注册 `wpl_*` |
| `/api/world/player/:id` | GET | profile（战绩+背包+任务+队伍） |
| `/api/world/player/:id/team` | PUT/GET | 队伍存档/列表 |
| `/api/world/reward` | POST | 领奖 `{playerId, battleId}` |

建局 `owners:{p1,p2}` 字段把 side 绑到 `wpl_*`——奖励归属登记。

### 客户端

- TeamBuilder：玩家ID 输入 + 注册/刷新 + **存档队伍/一键载入** + profile 条（战绩/背包/任务进度）。
- 战局页：终局后出现 **领取奖励** 按钮（仅 `?wpl=` 登记玩家）；重复点击显示"回执重放——未重复入账"。

## 过程中修复的真实 bug

1. **`team.ts` 参数属性**：`constructor(readonly code…)` 撞 Node strip-only——M4-01 引入后 `node apps/server` 直接崩，连带阻塞本里程碑调试。
2. **v2 pack 默认 species 不存在**：`species` 缺省值写死 v1 的 `syn-alpha/syn-beta`——改为 server 按 pack 前两单位补默认。
3. **嵌套事务**：`claimReward` 外层 tx 里调 `claimRewardTx`（内层再 BEGIN）→ 拆出非事务版 `insertRewardOnce`。
4. **engine 同时判定**：concede 也要等对方 inbox 收齐才 resolve——测试补 p2 合法招。

## 验收

`tests/server/world.test.ts` **5/5**：HTTP 全链 exactly-once（fresh/fresh:false/库存不翻倍）、非 owner 401、未终局 409、db 重开恢复、outbox 键三分量各自独立、任务前置需满 3 胜。

回归：297/297 · typecheck 0 错 · `check:boundaries` PASS · client build OK。
