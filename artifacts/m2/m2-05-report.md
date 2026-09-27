# M2-05 执行报告：runtime generations / v1-v2 并存与 drain

日期：2026-09-27。基线：M2-03 验收修补 + M2-04 Host 装配工作树。

## Generation registry

| 能力 | 实现 |
|---|---|
| generation identity | `executableHash/rulesetHash/contentHash` 三轴组成稳定 ID，semver 不替代内容标识 |
| 并存上限 | 默认最多 2 个 active generation；重复 activate 幂等，第三代进入 FIFO 等待队列 |
| 对局固定 | `BattleManager.create()` 获取 generation lease，`PersistedBattleHost` 永久持有当时的 `FrozenPack`；新局默认最新非 draining 代 |
| drain / retire | generation 可标记 draining；有引用时 `retire` 返回 `PLUGIN_IN_USE`，最终引用释放后自动移除并晋升等待代 |
| 局生命周期 | 活跃局禁止 `BattleManager.unload()`；终局后 unload 释放 generation lease，SQLite 工件不删除 |
| executable 边界 | 同进程仅允许相同 `executableHash` 的规则/内容代并存；不同代码代显式 `EXECUTABLE_ISOLATION_REQUIRED`，不拿当前引擎冒充旧工件 |
| composition root | 本地 server 启动时先 activate synthetic-v1，再把 registry 注入 `BattleManager`；HTTP 接口不暴露 generation 管理 |

## 验收

- `pnpm test:generations`：3/3。
  - v1 活跃局期间 activate v2；旧局 RulesRef 与 generationId 不变，新局默认 v2。
  - v1 replay 使用 v1 pack 通过、使用 v2 pack 明确 `ARTIFACT_UNAVAILABLE`。
  - 使用中 retire/unload 拒绝；第三代等待；draining 最后引用释放后自动晋升。
  - 不同 executableHash fail closed。
- 全回归：typecheck PASS、contracts 45/45、core 68/68（含 10k 属性）、protocol 32/32、privacy 16/16、recovery 9/9、plugin 11/11、assembly 2/2、generations 3/3、replay 22/22、e2e 4/4、contracts drift 0、boundaries PASS。

## 边界与下一步

本切片实现的是同一引擎代码下的 ruleset/content generations；不同 executableHash 尚无 worker/进程承载，因此明确拒绝。generation registry 和活动引用当前为进程内状态，SQLite 恢复仍需由工件目录按三类 hash 重新绑定 pack；M2 收口切片应实现 artifact catalog + restore binding，并验证缺工件稳定返回 `ARTIFACT_UNAVAILABLE`。不涉及公网联机。
