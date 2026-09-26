# ADR-006：M2 机制演进 —— feature-gated IR 与版本隔离

状态：**已采纳（M2-01 落地）**。日期：2026-09-26。

## 问题

M2 需要切换/复活/吸强/控制/伤害分类/mode overlay 等新机制，同时满足验收"v1/v2 同时运行旧局 hash 不变"——v2 引擎加载 v1 包时必须产出与 v1 引擎逐字节一致的状态与事件。

## 决策

**feature-gated IR**：ruleset JSON 增加 `features: string[]` 显式开关（bench/damage_kinds/control/revive/stat_ops/mode_overlay）。v1 ruleset 无该字段 → 全部关闭 → 引擎走 v1 代码路径，不写 `sides.bench` 等新字段，不在事件 detail 增加新键——hash 自然不变。编译器在 semantic 层把"op 存在但 feature 未声明"判 PackLoadError（v1 包混入 v2 语义 = 编译失败，而非静默忽略）。

## 契约演进（本任务落地）

- ruleset schema：`features`/`damageKinds`/`modeOverlays` 均为 **optional additive**——v1 artifact 无需修改即通过新 schema。
- units schema：`revives`/`mode` optional additive。
- moves schema：effect 新增 `kind`/`name`/`turns` optional + 按 op 的 then 条件；`damage` 无 kind 时等价 standard（v1 语义不变）。
- internal state / public observation 的 `bench`/`switch`/`replacement` 字段在 **M2-03** 升（replacement decision kind 已在契约中，无需新枚举）。

## 拒绝替代方案

| 方案 | 问题 |
|---|---|
| 引擎无条件支持新 op | v1 局 replay hash 会带 v2 字段 → 破坏版本隔离验收 |
| 每机制一个 schema 版本 | 十倍维护成本；feature flag 单点即可判定语义域 |
| 编译时忽略未声明 feature 的字段 | 静默语义漂移——spec 明禁"忽略未知" |

## 验证路径

M2-01：`loader-v2.test.ts` 10 用例（编译/feature 门禁/未知 op/新单位纯数据）。M2-02/03：每机制 pos/neg/boundary fixture。M2-04：v1 局重放 hash 与 v1 引擎输出逐字节一致。
