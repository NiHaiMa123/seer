# M4-04 — 世界探索 + World Agent 分离（AGENT.md §8）

## 产出

### `packages/world` 扩展

- **`map.ts`** — 合成地图：5 节点（town/route-1/route-2/arena/cave）+ 邻接边 + `pathTo` BFS 最短路径。
  - 动作分 **free**（rest/forage/challenge）与 **irreversible**（buy-potion/sell-orb）——后者显式标记供策略门控。
- **`store.ts`** — `sessions` 表（opsLeft/irreversible/stopped）+ `players.location` 迁移列；`spendOp` 在调用方事务内扣减（**预算与业务写同提交——崩溃不超支**）；`takeItem` 条件更新防负库存。
- **`service.ts`** — `openSession({ops, allowIrreversible})` / `stopSession` / `map()` / `move()`（邻接校验，非邻接不耗预算）/ `act()`（irreversible 未授权 → `POLICY_DENIED`；余额不足 → `INSUFFICIENT` 且回滚不耗预算）。
  - `challenge` 动作返回 `{pack, bossTeam}` 规格——world 层不持有 battle 句柄。

### `packages/agent` — `world-agent.ts`

- **`WorldOps`** 抽象（profile/map/move/act/stop）——in-process 或 HTTP 可互换，与 BattleAgent 的 `AgentView` 同构。
- **`WorldAgent`**：目标驱动（quest/item/reach）+ BFS 寻路；每步 `step()` 语义化返回，预算尽/停机由会话错误冒泡收敛。

### Server 路由

| 路由 | 语义 |
|---|---|
| `POST /api/world/session` | 开会话 `{playerId, ops, irreversible}` → `ses_*` |
| `POST /api/world/session/:id/stop` | 停机（此后一切 op → SESSION_STOPPED） |
| `GET /api/world/player/:id/map` | 地图视图（当前位置 + 节点动作） |
| `POST /api/world/op` | `{sessionId, op:"move",nodeId}` / `{op:"act",actionId}` |

`act:"challenge"` 由 transport 自动翻译成 **pve 建局**（玩家队取存档 `main`、bot 席位、owner 登记）——返回 `{battleId, token}` 直接可玩、可领奖。

## 抓到的真实 bug

- **同节点 move 绕过 stopped 检查**（"原地不动免费"短路在 session 校验前）——stopped 会话仍能 op。修：stopped 检查前置。
- `reach` 语义重排：到达即 done（原实现在目标点误触发第一个动作——可能撞上不可逆 buy）。

## 验收

`world-ops.test.ts` **4/4** + `world-agent.test.ts` **4/4**：
- 邻接拒绝不耗预算 · forage 入账 · POLICY_DENIED/INSUFFICIENT 门控 · ops=1 耗尽 · stop 全拒 · challenge→建局→认输→领奖全链
- Agent：BFS 3 步到 arena（预算 8-3）· item 目标 move+forage×2·done · 预算尽抛错收敛 · 同点 reach 零预算 done

回归 **305/305** · typecheck 0 · boundaries PASS。

## 未做（诚实边界）

- World Agent 无 LLM 编排——确定性策略先行（LLM adapter 是 M4+ 可选项）
- 视觉/点击 adapter 未做（§8 明确后置）
- forage 概率表、战斗→地图掉落联动未做
