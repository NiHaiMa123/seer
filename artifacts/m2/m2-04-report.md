# M2-04 执行报告：Cordis Host 装配 / 多局管理 / transport 边界

日期：2026-09-27。基线：`10dfbf3` + M2-03 验收修补工作树。

## 装配

| 能力 | 实现 |
|---|---|
| Cordis 生产入口 | M0-03 窄适配包提升为 `@seer/plugin-runtime`；仍只有该包 import `cordis@4.0.0-rc.10` |
| 真实 Host 服务 | `battleManagerPlugin()` 以 manifest policy 注册 `battle.manager`，服务值为真实 `BattleManager` |
| 多局管理 | `BattleManager` 统一 create/get/require/ids，拒绝内存或 SQLite 中重复 battleId；每局持有独立 `PersistedBattleHost` |
| server composition | `startServer()` 先加载 Cordis 服务，再从 service registry 获取 manager；关闭时先停 transport，再卸载插件并关闭 store |
| transport DTO | create/submit/ack/query 严格字段、类型和范围校验；Command 复用公开 schema；body 上限 64 KiB |
| 身份隔离 | 随机 128-bit token 精确绑定 `{battleId, playerId}`；跨局 token 返回 401，DTO 失败不触碰 Host |

## 验收

- `pnpm test:plugin`：11/11，保留 M0 Cordis 生命周期、失败清理与 100 cycles 门禁。
- `pnpm test:assembly`：2/2，覆盖真实 service 装配/卸载、双局隔离、重复 ID 拒绝、跨局 token、未知字段、坏 JSON、超大 body、失败前后 revision 不变。
- 全回归：typecheck PASS、contracts 45/45、core 68/68（含 10k 属性）、protocol 32/32、privacy 16/16、recovery 9/9、replay 22/22、demo PASS、e2e 4/4、contracts drift 0、boundaries PASS。

## 边界

本切片仍是单进程本地 Host：token registry 不跨重启，不含公网账号鉴权、配额、房主接管或 fencing；这些保持在 M4 联网边界。运行中对局固定 manager 注入的 pack，不进行机制插件热替换。`experiments/cordis` 保留为源码路径以延续 M0 证据，公开包名与生产依赖面已收敛为 `@seer/plugin-runtime`。
