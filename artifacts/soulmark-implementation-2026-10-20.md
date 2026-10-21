# 魂印解析与状态审计实施报告

日期：2026-10-20  
实时审计：[`soulmark-status-after-2026-10-20.json`](soulmark-status-after-2026-10-20.json)  
before 基线：[`soulmark-audit-2026-10-20.md`](soulmark-audit-2026-10-20.md)

## 实施范围

生产构建入口与 live compile checker 现在都以 `parseSoulmarkText(text, c.name)` 调用解析器。编译文档使用 `c.id.replace(/^pet-/, "")` 生成完整 ID 后缀；审计按精灵 ID / 图鉴键关联变体，不按 `petNo` 合并，并报告缺失或重复 ID。新增的审计 CLI 可导入而不自动执行，默认向 stdout 输出，也可通过显式报告路径写出；它不改写 source、content 或 claims 快照。

解析状态明确区分“明示无特性”“无条目但有残文”“无条目且无残文”“部分解析”和“有条目且无残文”。编译成功或没有残文只说明当前解析结果，不代表行为已经完整实现。

运行时修正与回归覆盖包括：未知 guard 不再泄漏条件回血、固伤、else 或跨分号裸句；属性技能命中、未命中及 nullify/阻止路径的边界；`amountTiming: "apply"` 在施加时按最终持有者视角冻结幅值，缺省仍动态求值；每损失 1% HP 的步进采用向下取整；`hp_delta` 的关联回血在 KO checkpoint 前结算且不使自伤致死者复活。新增或扩展的真实运行时用例位于 `tests/battle-core/mechanics/soulmark-parser-boundaries.test.ts`、`tests/battle-core/ops/numeric-snapshot.test.ts`、`tests/battle-core/ops/effects-v3.test.ts` 和 `tests/battle-core/ops/hp-delta-checkpoint.test.ts`。

## 实时解析与 pack 对照

本次审计读取 3,526 条目录记录，其中 1,884 条有魂印文本；排除 73 条明示无特性后，解析候选为 1,811 条。

| 当前解析状态 | 数量 | 含义 |
| --- | ---: | --- |
| 明示无特性 | 73 | 从实现候选中排除 |
| 无条目、有残文 | 128 | 源文本有尚未解析的片段 |
| 无条目、无残文 | 0 | 此状态若出现属于异常 |
| 部分解析 | 904 | 有解析条目，同时仍有残文 |
| 有条目、无残文 | 779 | 解析器没有报告残文，不等于行为认证 |
| 解析错误 | 0 | 本次未发现解析异常 |

当前可明确计入“已知不完整”的下界为 1,032 条：904 条部分解析加 128 条有残文但无输出。0 条无条目且无残文、0 个 parser error；779 条有条目无残文仍未经过逐条行为认证。

残文原因按片段聚合（同一条记录可贡献多个原因）：`no-rule` 910 段、未知 guard 延后 471 段、缺少触发前缀 212 段、`prevApplied` 缺少同事件 fallback host 191 段、关联尾句无法安全拆分 113 段、孤立条件 67 段、未建模具名状态机 53 段、跨触发边界的 fallback 52 段、属性域变更未建模 37 段。完整原因及样例见 after JSON。

before 文件保留的是旧审计口径：未传名称时曾列出 881 条未完成；同一文件的传名称统计是 933 条有条目无残文、801 条部分解析、74 条有残文但无条目、3 条静默跳过，对应 878 条未完成。本次 after 的已知不完整下界为 1,032 条；增加反映收紧条件、时序等误实现判定并显式保留残留后的重新计数，不代表源记录数量增加。旧 before 文件保持原样；不能把 881 当作当前 after 统计。

当前 `content/peak` 有 1,600 个魂印目录、1,589 个挂载引用；manifest 确认无空目录和悬空引用。逐条源记录与 pack 对照为：1,076 个 effect 数组相同；500 个数组有差异，另有 24 个解析器当前无条目但 pack 仍存条目；33 个解析输出对应的目录缺失；169 个尚未生成目录；82 条源记录不在 pack 范围，其中 74 条当前解析出条目。审计中的 1,609 条“pack 内且解析出条目”记录有 1,565 条挂载匹配、33 条非手工未挂载、11 条手工巅峰条目未挂载，错误引用与歧义均为 0。数组差异可能来自人工准确映射，也可能来自解析器保守输出；应按原文和条款逐项复核后同步，不能整库覆盖或把目录差异直接判成自动修复项。

手工巅峰的 12 个默认未挂载链接单独报告，不计为自动挂载修复；其中 11 条当前满足“pack 内且有解析条目”的统计口径。历史 50 条空目录清理中，49 条仍保持删除且未挂载；`pet-4695` 仅恢复了有确证的初始 HP 子集，相关成本机制仍延后。

审计未发现缺少精灵 ID、重复完整精灵 ID、重复 pack unit ID 或关联歧义。

## 150 个 ID 的保存基线复核

以下只采用 manifest 的 `finalBaselineAccounting`，以清理前持久化的 `saved.effects` 和精确的 `creatureId#oldIndex` 为集合基准：

| 清理前基线条目 | 数量 | 最终结论 |
| --- | ---: | --- |
| 总数 | 435 | 分区互斥且合计一致 |
| 原样保留 | 169 | 与清理前保存条目逐项一致 |
| 已修正或部分保留 | 17 | 对应当前 18 个 effect 条目 |
| 有旧索引证据的删除 | 209 | 旧签名与对应的清理前条目一致 |
| 尚未解决的旧索引映射 | 40 | 不视为已认证或已安全删除 |

完整分区为 `435 = 169 + 17 + 209 + 40`。历史 round2 操作数不是同一持久化基线下的互斥集合，不加到 209 的删除数中。独立复核确认 209 个删除签名都能对应清理前的 `saved.effects[oldIndex]`，169 个原样保留项都与基线及当前内容一致，也没有陈旧保留索引；这些索引级证据不等同于精灵行为完整认证。

40 个仍未解决的旧条目映射如下：

```text
pet-3647#2, pet-3802#3, pet-3897#2,
pet-3965#0/#1, pet-4220#2/#3, pet-4288#0/#1/#2/#3,
pet-4343#0/#1, pet-4350#0, pet-4373#0/#1, pet-4377#0/#1,
pet-4398#0, pet-4450#2/#3/#4, pet-4531#0, pet-4644#0,
pet-4663#1, pet-4749#0/#2, pet-4765#0/#2, pet-4802#0,
pet-4818#0, pet-4823#2, pet-4853#0/#1, pet-4875#1/#3,
pet-4908#0, pet-4911#0, pet-4928#0, pet-4940#0
```

因此，至少 40 个清理前效果仍有明确的旧索引映射未解决；此外，live audit 中的解析残文也反映更多尚未覆盖的规则。不能把 435 个基线条目或 1,811 个解析候选当作已实现数量，也不能从 779 个“有条目、无残文”推导出完整行为认证数。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全量 Vitest | 163 files、2,356 tests 全通过。首次沙箱运行的 26 个 loopback HTTP 用例因 `connect EACCES 127.0.0.1:1443` 失败；按授权重跑后通过。 |
| `pnpm typecheck` | 通过 |
| `pnpm content:validate` | 24 个文件检查，0 findings |
| `pnpm test:schema-sync` | 通过；TS ops 45、envelope 14、conditions 150、features 10，与 schema gatedOps 45、props 267、conditions 150 对齐 |
| `pnpm contracts:check` | 通过 |
| `pnpm check:boundaries` | 通过；扫描 446 个文件、23 个内部 importer |
| `pnpm test:effects-golden:check` | 通过；360 个 fixture 条目匹配 parser golden |
| `pnpm test:effects-golden` | 361/361 通过 |
| effects compile check | 53,697 条检查，0 failures；337 条 emptyMoves（47 flags、290 unparsed）。输入副本为 `scratch/architecture-review-temp/_effects-coverage.json`；检查结果写入 `scratch/architecture-review-temp/_compile-failures.json` |
| soulmark compile check | `--no-write`；1,884 条有文本记录、1,683 条 mark、3,623 个 entry，0 failures |
| 实时状态审计 | parser errors、无残文空条目异常、ID/关联歧义均为 0；报告写入 after JSON |

全程未运行生产构建脚本或完整魂印生成器。检查前后 `ENGINE_VERSION="0.1.0"`、`IR_VERSION=1` 和派生 hash 定义未改；`content/claims` 快照与 parser/real golden 文件 SHA-256 与检查前记录一致，相关文件无 diff。

## 尚未覆盖的行为边界

本轮是定点正确性审计，不是对全部 1,811 个候选或全部 150 个 ID 的行为认证。`onMoveUsed` 只覆盖成功命中并完成技能执行的子集，不能证明纯“使用技能”、miss 或其他结算阶段语义都已实现；需要在命中后到回合结束的第二阶段触发仍有明确延后项。物理与特殊技能的 `catStreak` 分开计数，物理转特殊会重置，不能等价为跨类别的“连续 N 次攻击技能”；`guard.if.catStreakAtLeast` 也不走 soulmark 的 `beforeHit` 路径，目前仅 `subject.streak` / `sameMove` 有相应的提前施加路径。回合开始时判定资格、回合结束时再执行的效果不能在结束时重新读取旧 guard；只有已有冻结状态表达精确时才可使用，否则继续延后。

具名状态/资源状态机、属性克制表修改、跨条目聚合引用、复活 checkpoint、无法安全关联的 fallback 以及其他审计 JSON 中标为 deferred 或 `no-rule` 的条款，仍需后续逐项实现和真实运行时验证。解析为空、编译通过、golden 匹配和索引复核都不能替代这些行为验证。
