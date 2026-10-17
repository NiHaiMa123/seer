# 基础引擎：技能和魂印收成同一套原子

日期：2026-10-10。状态：步骤 1–5 已落地。

首要目标见仓库 `README.md`：一条实现的增删改只动一处。这份计划回答两件事：现在的技能和魂印离这个目标有多远，基础引擎因此应该长什么样。

## 结论

基础引擎不是插件框架，也不是中文解析器。它是一个封闭的归约器：

一条效果 = 在哪个钩子上 + 一组已经存在的原子 op。

技能和魂印走同一张 op 表、同一批钩子。中文只存在于编译器里。编译器写不出原子，就留下 `unparsedReason`，不给 `damage` 加字段，也不给魂印加第 12 种 flag。

这个形状有一半已经在跑。魂印 3972 条运行时条目里，3955 条已经是钩子乘原子 op。要收的是另外一半：技能上的侧袋、`damage` 上的附加字段、大约 140 个效果名里各自为政的读法，以及魂印里剩下的 17 条 flag。

## 这次量的是什么

数字来自 2026-10-10 的两份覆盖率文件，不是峰值包。峰值包是已经能装载的子集。

| 文件 | 作用 |
|---|---|
| `content/claims/_effects-coverage.json` | 53697 条有文本的技能，解析后的 `effects` / `flags` / `unparsed` |
| `content/claims/_soulmark-coverage.json` | 1881 条魂印（文件头写 1884），解析后的 `entries` |

文件头还写着：技能子句 111233/114579 = 97.1%，整技能 95.2%；魂印子句 2778/3343 = 83.1%，整印 980/1884 = 52.0%。

这两套数已经对齐，覆盖率只认子句。`clauseCoverage` = `clausesParsed / clauses`：按 `；` `。` 切开、且没有被脏文本丢掉的一段，产出至少 1 条 entry，分子就加 1。文件头 2778/3343 = 83.1%，残余子句是 565。

`unparsed` 数组是片段，不是子句。一段里已经写出 entry、又推了一条 `guard unmodeled` 之类的残留，子句仍算解析成功，片段另计。所以片段数大于 565。片段再分成三格，和 `unparsed.length` 之和相等：`fragmentsOnParsedClauses`（成功子句内部的残留）、`fragmentsOnResidualClauses`（整段没写出 entry）、`fragmentsOutsideClauses`（没进分母，例如伴生整段）。`node tools/soulmark-parse.mjs` 会把这三格和 `residualClauses`、`unparsedFragments` 写进报告。`clauseCoverage` 不引用片段数。

现有 `_soulmark-coverage.json` 的 `marks` 没有重跑。文件头现在写着 `residualClauses` 565、`unparsedFragments` 2571、`countDefinition`。2571 是只加 `marks[*].unparsed.length` 的结果，条目上没有另挂 `unparsed`。当前解析器对 creatures.json 的子句账仍是 3343/2778，但伏尔格安（4625）的正文和快照不一致，重跑会改掉那只的条目。对齐计数不改解析结果。

## 技能实际落在哪

98762 个带 `op` 的节点（含嵌套 payload）只使用 15 个 op 名。`OPS` 表里还有 `banish_dead`、`hp_delta`，这份语料里没有出现。

| op | 次数 | 占效果节点 |
|---|---:|---:|
| `apply_stat_stage` | 45641 | 46% |
| `apply_status` | 34567 | 35% |
| `clear_stages` | 5020 | 5% |
| `heal` | 4168 | 4% |
| `cleanse` | 2548 | 3% |
| `damage` | 2459 | 2% |
| `pp_delta` | 1456 | 1% |
| 其余 8 个（`transfer_stages`、`invert_stages`、`control`、`apply_mark`、`copy_stages`、`swap_hp`、`transfer_ailments`、`consume_mark`） | 2903 | 3% |

看起来很原子。不是。原子外面还有三袋参数，编译器往袋子里加键，结算就得去读那个键。

1. **招式旗标，不在 op 列表里。** 23308 条技能带 `flags`。其中 `attachDamage` 11212、`accuracy` 10860、`priority` 4055。`attachDamage` 自己又是一张开表：`scaleIf` 3155、`flatBonus` 1222、`mulIf` 888、`hits` 885、`drain` 473。命中后的吸血、固伤、连击不走 `OPS`，走这只袋子。
2. **`damage` 不是一个 op，是一堆可选字段。** 2459 次里，只有 393 次只带 `power` / `kind` / `target`。其余 2066 次带额外键。最多的是 `if` 1329、`frac` 982、`chance` 227、`percentBase` 170、`selfHp` 112、`drain` 91、`leaveHp` 74。`loader.ts` 里 `CompiledEffect` 的 `damage` 分支还远比语料里出现过的键多。
3. **`apply_status` 的名字约有 140 个，行为不在这一行数据里。** 表上多数行是 `modifier: "params"` 或 `periodic: "params"`，真正的分支在读 `params` 的地方。语料里最高的名字是 `immune_status` 3657、`prio_up` 2597、`react` 2372、`fear` 2140、`hot` 1933。加一种反击算法（谱尼那种 `foeMaxN`）改的是读取方，不是表上多一行。步骤 3 之后，每个名字都标在一根已有读取的轴上；轴上没有读取的新名字，编译检查失败。`counter` 的 `foeMaxN` / `foeMaxD` 仍由 `counterFlatOf` 读取，这一步不拆。

未解析 3334 条子句，2595 条技能至少有一条。原因最多的是 `no-rule` 1920。其后是威力系数未取证、截断、惩罚、性别、属性结算。这些不该用新字段抹平。

## 魂印实际落在哪

3972 条运行时条目：

| 形状 | 条数 |
|---|---:|
| 钩子 × `ops`（和技能同一套 op） | 3955 |
| flag（`SoulFlagOp`，本模块 `if` 结算） | 17 |

钩子分布：`onTurnEnd` 1371、`onMoveUsed` 720、`onTurnStart` 647、`onDamageDealt` 446、`onBattleStart` 278、`onEntry` 204、`onDamaged` 186、`onKO` 77，其余 `onSwitchOut` / `beforeOrder` / `onMiss` 合起来 26。这些名字已经在 `Mechanic` 上。

钩子里面的 op 和技能是同一张表，外加技能语料里没有的 `stat_boost` 64 和 `force_switch` 2。最高的仍是 `apply_status` 3010、`apply_stat_stage` 1132、`damage` 664、`heal` 526。

量的时候 17 条 flag 是第二条指令集：`revive` 13、`endure` 3、`state_rewind` 1。结算在 `packages/battle-core/src/mechanics/soulmark/index.ts` 的 `if (op.op === ...)` 里，不经过 `OPS`。`revive` / `endure` 卡在致命判定，普通 op 列表走到那时候已经晚了。`state_rewind` 和 `endure` 回合末的回卷是同一段状态写入。这一条已经收掉，见步骤 2。现在语料里的 flag 是 `revive` 13、`endure` 3。

未解析原因和技能不同。文件头残余之外，走出来的原因顶上是 `no-rule` 1110、`guard unmodeled` 228、`no-trigger-prefix` 201、具名印记状态机 96。缺的是触发器和条件，不是新的伤害公式。

## 现在的引擎是三层，只有一层像原子

```
中文  →  编译器（effects-rules 顺序链 + soulmark-parse）
      →  IR（op 列表 + flags 袋子 + SoulFlagOp）
      →  归约器（OPS + EFFECT_DEFS 的轴 + 魂印 if）
```

归约器里已经有对的缝：`MECHANICS` 只被循环调用，钩子名不含机制 id；`applyOp` 按 `OPS` 分派；魂印钩子把 `ops` 交回 `applyOp`。

不像原子的是 IR 的边界。一条新句子可以不新增 op 名，只往 `damage`、`attachDamage` 或 `params` 里加一个键。调用方看起来没改引擎，读取方必须改。谱尼的受击固伤就是这种。`state_rewind` 曾经是直接加了 flag 枚举、schema、解析正则和一段 `if`；步骤 2 把这四样一起删了。

中文编译器不要并进引擎。`tools/effects-rules/order.mjs` 是一条总顺序，插错会截走别的句子。那是编译器的问题，用测试锁顺序，不要用它来定义战斗语义。

## 基础引擎应该是什么样

固定三样东西。新玩法只能落在这三样已经有的格子里。

**1. 阶段是固定的。** 就是现在 `Mechanic` 上这些钩子，不多加「某只精灵的阶段」：

`onBattleStart`、`preOrder`、`beforeOrder`、`onTurnStart`、`onEntry`、`beforeHit`、`onMoveUsed`、`onDamageDealt`、`onDamaged`、`onMiss`、`onKO`、`onSwitchOut`、`onFatalDamage`、`onTurnEnd`。

技能的默认钩子是命中后的 op 列表。先制、命中、威力这一类打在招式上的，是招式字段（`priority`、`accuracy`），不是效果名。

**2. 原子 op 是一张短表，每张表的参数是闭的。** 以语料里真的出现过的为准：

`apply_stat_stage`、`apply_status`、`clear_stages`、`heal`、`cleanse`、`damage`、`pp_delta`、`transfer_stages`、`invert_stages`、`control`、`apply_mark`、`consume_mark`、`copy_stages`、`swap_hp`、`transfer_ailments`、`stat_boost`、`force_switch`。

`damage` 只保留 `power`、`kind`、`target`，加上已经通用的 `if` / `chance`。分数伤害、留 1 血、吸血、附加固伤，各自是列表里的下一条 op，或者是命中信封里一种已经登记的 rider。新算法 = 新 op 名，走契约，不给 `damage` 加可选字段。

`apply_status` 的 `name` 必须落在下面某一根轴上，轴的读取方只有一处：

| 轴 | 现有例子 | 加一个新名字时只改 |
|---|---|---|
| `ailment` | 烧伤、害怕、麻痹 | `EFFECT_DEFS` 一行（`dot` / `blockChance` / `accMul` / `atkMul` 已有读取） |
| `periodic` | `hot`、`stage_tick`、`drain_dot` | 一行，payload 仍是原子 op |
| `immune` | `immune_status`、`dmg_immune`、`heal_block` | 一行，`params` 用已有的位和概率 |
| `reflect` | `reflect_dmg`、`reflect_status` | 一行 |
| `modifier` | `prio_up`、`dmg_reduce`、`dodge` | 一行，且这个键已经有读取 |
| `shield` | `shield`、`ward` | 一行 |
| `react` | `react` | 一行，payload 仍是原子 op。只有名字 `react` 会派发 |

`random` 不是第八根轴。它在挂载前被 `fx.random` 改写成具体异常，运行时不会留下 kind `"random"`。`next_chance`、`type_swap`、`type_copy` 是 modifier 槽位 `nextChance` / `typeSwap` / `typeCopy`，读取仍是原来的几率窗和系别覆写，只是改走 `isMod`。

轴上没有的键，不许出现在 `params` 里。`foeMaxN` 这种就是轴上没有的键。要它，先决定它是 `damage` 的哪一种闭参数，再让编译器去发，而不是在 `counter` 上打一个洞。步骤 3 只检查状态名落在哪根轴，没有改 `counter` 的键。

**3. 一条被动 = `{ hook, guard, chance, bossGate, ops, elseOps }`。** 魂印已经是这个形状。技能的回合窗也是这个形状，只是现在写成了 `apply_status` 加 `turns`。flag 枚举不再增长。

`revive` 和 `endure` 留在 `mechanics/soulmark/fatal.ts`，因为它们改的是致命判定的返回值，普通 op 列表表达不了「不要死」。这个文件只收致命判定和 endure 那一次回合末快照恢复，不收回合末回血、PP、固伤。`state_rewind` 已并进这次恢复，不单占一个 op 名。

编译器（`tools/effects-rules/`、`tools/soulmark-parse.mjs`）只允许发出上面的 IR。它不是引擎的一部分。删掉某个家族文件，战斗核心仍能结算已经编译好的包。

服务端 Cordis 插件、客户端面板注册维持现状。它们装卸的是域和界面，不是一条伤害公式。局中不热换规则。

## 做到哪一步算靠近了目标

按这个顺序。每步的完成线是「再加一条同类效果只动一处」。没到完成线就不要开下一步。

1. **对齐计数。** 已完成。覆盖率只认子句（565 条残余子句）。`unparsed` 条数是片段，单独命名为 `unparsedFragments`（快照里 2571），不参与 `clauseCoverage`。文件头 `countDefinition` 写的是这一句。
2. **冻住 flag。** 已完成。`SoulFlagOp` 不再加成员。`revive` 留下：致命判定，返回半血而不是倒下。`endure` 留下：致命判定留 1 血，并且只在 `endurePending` 时做那一次回合末快照恢复（`mechanics/soulmark/fatal.ts`，不收回合末回血、回 PP、固伤）。`state_rewind` 收掉：语料里唯一一句是谱尼「残留 1 点血，同时回合末回到上回合结束时状态（每场一次）」，和 `endure` 的那一次恢复是同一件事。schema 枚举、联合类型、`if (op.op === "state_rewind")` 已一起删除。解析器碰到这句，同段已有 `endure` 就不再发条目；没有 `endure` 则留下 `unparsedReason`，不新开 flag。
3. **给 `EFFECT_DEFS` 的每个名字标轴。** 已完成。每个名字恰好一根轴：`ailment` / `periodic` / `immune` / `reflect` / `modifier` / `dmgShield` / `reactive`。`next_chance`、`type_swap`、`type_copy` 改成 modifier 槽位 `nextChance` / `typeSwap` / `typeCopy`，原来的 `kind ===` 读取改成 `isMod`。`random` 不是轴，是挂载前改写（`apply-effect` 消费 `fx.random`）；再出现一个只有中文名的状态，检查失败。`react` 只认名字 `react`。完成线：`tools/effect-axis-readers.ts` 由 `tools/effects-compile-check.ts` 调用。新状态名如果轴上没有对应读取，编译检查失败。没有把已有读取的名字退回 `unparsedReason`。
4. **封上 `damage` 和 `attachDamage`。** 已完成。清单在 `packages/battle-core/src/ops/damage-keys.ts`，不从类型现算。`DAMAGE_KEYS` 是 `CompiledEffect` 的 damage 分支并上信封（`if` / `chance` 以及其余信封字段）。`ATTACH_DAMAGE_KEYS` 是技能语料里出现过的 attachDamage 键，再加 `attachChance`（合并时改写成 `chance`，它不是 damage 字段）。`compilePack` 扫招式效果（含 payload），魂印编译扫 `ops` / `elseOps` / `atCapOps`（含 payload）；清单外的键拒载。`tools/effects-compile-check.ts` 在合并前拒 attachDamage 的清单外键，合并后拒 damage 的清单外键。`tools/schema-sync-check.ts` 钉住：类型 ∪ 信封 = `DAMAGE_KEYS`，schema 的 damage then 不得超出，非信封的 damage 字段必须出现在 then。已有 rider（吸血、`flatEcho`、`healOnHit`、`stageOnHit`、`foeNextMaxHpAcc`）留在 `damage-riders.ts`，这份清单不新增键。`params` 不是 damage 的键。魂印解析器曾把 `growPer` 打到同一句的每条 op 上，damage 没人读；现在只打到 `apply_status` / `apply_effect`。巅峰包里御象灵尊（4002）那条 damage 上的 `params` 已去掉。`counter` 的 `foeMaxN` / `foeMaxD` 仍不在这一步。完成线：清单外的键装载失败。技能编译检查 `checked=53697 failures=0`，魂印编译检查 `failures=0`。
5. **编译器只发清单内的 IR。** 已完成。新句子仍是家族文件加一条、`order.mjs` 放在同家族宽规则之前。效果键不另抄清单：`tools/ir-keys.ts` 按 `CompiledEffect` 的对应分支加信封现取。招式旗标是 `MOVE_FLAG_KEYS`（没有 `powerRandom`）。`effects-compile-check` 在合并前拒清单外旗标（`FLAG_KEY`），schema 通过后拒该 op 清单外的键（`IR_KEY`，含 payload / ops / elseOps / atCapOps）。魂印编译检查扫活解析，不读旧覆盖率：hook 用 `SoulHookOp`，flag 用 `SoulFlagOp`，嵌套 op 走同一张效果清单。三处漏出的键改回清单内，没有为了清单把技能退回 unparsed：`e53-cvt-01` 的 cleanse 发 `effect` 而不是没人读的 `ailment`；`attach-damage-69a` 不再给 must_miss 发没人读的 `count`；`powerRandom` 只做「威力随机」的内部标记，发出前删掉。不搬 `order.mjs`，不把战斗核心接进 Cordis。完成线：清单外的键编译检查失败。技能 `checked=53697 failures=0`，魂印 `petsWithMark=1884 marks=1718 entries=3971 failures=0`。覆盖率仍是 `skills=53798 fully=51194 partial=1831 clauses=111233/114579 (97.1%)`。

不做的事：不按精灵写脚本；不把中文规则生成进引擎；不在同一次改动里拆 `damage.ts` 又改解析器；不为了覆盖率把 `no-rule` 收成一个没人读的效果名。
