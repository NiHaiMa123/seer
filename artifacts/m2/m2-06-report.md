# M2-06 执行报告：artifact catalog / SQLite restore binding

日期：2026-09-27。基线：M2-03～M2-05 工作树。

## 工件目录与恢复

| 能力 | 实现 |
|---|---|
| artifact catalog | `RuntimeArtifactCatalog` 保存可信编译后的 `FrozenPack`，以 `executableHash/rulesetHash/contentHash` 为唯一索引；同一对象重复注册幂等，不同 pack/executor 配置冲突则拒绝 |
| metadata 校验 | resolve 同时校验 rulesetId、rulesetVersion、irVersion；三 hash 格式或规则引用畸形返回 `MALFORMED_RECORD` |
| manager restore | `BattleManager.restore()` 对 SQLite init/state 做完整契约、battleId、seed 与工件身份校验；校验完成后才 activate/acquire generation lease并调用崩溃恢复路径 |
| draining restore | 已存在但 draining 的 generation 允许恢复既有持久局并恢复引用；新建局仍禁止选择 draining generation |
| 失败原子性 | 工件缺失、错误版本或 restore 失败时不加入 manager；已获取 lease 会释放 |
| replay hardening | replay 从只比 rulesetHash 升为比较 executable/ruleset/content 三 hash及 rulesetVersion/irVersion，错误工件明确 `ARTIFACT_UNAVAILABLE` |
| composition root | 本地 server 显式注册 synthetic-v1 catalog，并将 catalog + generation registry 一起注入 manager；无网络侧工件加载 |

## 验收

- `pnpm test:artifacts`：5/5。
  - 中断局在新 manager/registry 中按持久化三 hash 恢复，Observation 与 receipt 保持一致。
  - 空 catalog 和仅含 v2 的错误 catalog 恢复 v1 均 fail closed，manager 不产生半恢复实例。
  - 篡改 state 的 contentHash/executableHash 或 init 的 contentHash 后，restore 与 replay 均返回 `ARTIFACT_UNAVAILABLE`。
  - state/init battleId 错绑返回 `MALFORMED_RECORD`，且不激活 generation。
  - 同一三 hash 下不同内存 pack 或 executor 配置返回 `ARTIFACT_CONFLICT`。
- 相关门禁：generations 3/3、recovery 9/9、replay 22/22、assembly 2/2、typecheck PASS。
- 全回归：contracts 45/45、core 68/68（含 10k 属性）、protocol 32/32、privacy 16/16、plugin 11/11、e2e 4/4、contracts drift 0、boundaries PASS。

## 边界

Catalog 当前只接受 composition root 显式提供的可信内存工件，不扫描目录、不下载远程包、不执行第三方代码。不同 executableHash 仍需独立 worker/进程。HTTP token registry 不跨重启，因此 server 尚未公开自动恢复 API；本切片完成的是 Host/SQLite 的确定性恢复绑定，不是联网会话恢复。
