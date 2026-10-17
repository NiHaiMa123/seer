# 目标架构路线

日期：2026-10-13。状态：步骤 1–9 已落地。

前提是 `plans/engine-atoms.md` 步骤 1–5 已经落地。那五步封的是边界：清单外的键装不上、发不出。本计划从那道边界收到目标形状。不重做那五步，也不把已经能结算的句子打回 `unparsedReason`。

## 目标

基础引擎仍是那个封闭的归约器。中文只在编译器里。本计划做完时，存储形状是下面这样。

**阶段不动。** 就是 `Mechanic` 上已有的钩子。本计划不加钩子，不改 `engine.ts` 的循环。

**`damage` 只留 `power`、`kind`、`target`，再加上信封里的 `if` / `chance`。** 今天写在 `DAMAGE_KEYS` 上的其余键，不再是 `damage` 的可选字段。它们是同一次命中里的 rider。rider 是闭联合：一个 `of`（或一个 op 名）一个读取臂。并进同一击伤害数字的固伤、倍率、致命、威力，必须留在这一次命中里，不能拆成事后再打一击。吸血、命中回复、命中降能力这些已经在 `damage-riders.ts` 里的，仍是命中之后的 rider，调用顺序保持今天的源码顺序。

新算法 = 新的 rider 变体，走已经有的契约（联合分支、schema 的 if/then、那一个读取函数、一条测试）。不给 `damage` 加字段，也不为每种固伤基线各造一个 op 名。

**一条被动只留 `{ hook, guard, chance, bossGate, ops, elseOps }`。** 钩子主语（谁动的、打的哪一类、连用）收进 `guard` 这一个谓词。概率的动态、成长、重置、每场一次，收进 `chance` 这一个闭类型。幅度成长和达顶收进 `ops` 里的一条 op，不在条目上再留字段。`revive` 和 `endure` 仍留在 `mechanics/soulmark/fatal.ts`，`SoulFlagOp` 不加成员。

技能的默认形态仍是命中后的 op 列表。回合窗不再为每一句新造一个 `apply_status` 名字：已经能用 `periodic` 加 payload 表达的，编译器发那一个名字。两边共用同一张原子 op 表。回合窗的存储形状仍是 `apply_status`，名字用已经在结算的 `periodic`（`turns` 留在这条 op 上，`params.win` 是窗口，`payload` 是原子 op）。魂印条目没有持续谓词，不把回合窗收成 `{ hook, guard, ... }`，也不新写回合循环。

## 做到的时候什么只动一处

| 想加的东西 | 只改 |
|---|---|
| 一种新的固伤基线、倍率或威力取法 | 该家族 rider 的一个变体 + 那一个读取函数里的一个臂 |
| 一种新的命中后附加（吸血、回复、降能力这一类） | `damage-riders.ts` 里已有的对应函数 |
| 一种新的被动条件 | `Condition` 里已有的谓词，或 `chance` 的一个已有变体 |
| 一种新的回合窗句子 | 家族规则一条，发出 `periodic` + 已有原子 op，不新增状态名 |
| 一个新 op 名 | 仍是契约五处，见 `docs/extension-checklist.md` 第 6 节。本计划不减少这五处 |

## 不做的事

- 不在同一步里改 `damage.ts` 的公式、又改 `tools/effects-parse.mjs` 或 `tools/effects-rules/`。先让引擎只从命中程序读，再让编译器改发。
- 不改变已经测过的结算顺序。家族函数是剪切，不是重排。`docs/damage-riders-plan.md` 里那五段的相对顺序维持原样。
- 不手改 `content/claims/_effects-coverage.json`、`_coverage-baseline.json`、`_soulmark-coverage.json`。覆盖率数字不是本计划的完成线。
- 不跑 `node tools/soulmark-parse.mjs` 去重写魂印覆盖率。伏尔格安（4625）的正文和快照不一致，重跑会改那只的条目。
- 不搬 `tools/effects-rules/order.mjs`，不把战斗核心接进 Cordis，局中不热换规则。
- 不加 `SoulFlagOp` 成员，不把 `revive` / `endure` 收成普通 op。
- 不修巅峰包 `loadPackFromDir` 对 `mv-2501-s1` 的 `targetScope` 拒载。某一步如果必须装载巅峰包才能验收，先停，单独开契约，不塞进当前步。
- 不为了形状把 `no-rule` 收成一个没人读的效果名，也不删仍被语料或已存储包使用的状态名。

## 路线

按这个顺序。每步的完成线写在下面。没到完成线就不要开下一步。

1. **按状态名封上 `params`。** 已完成的轴检查只看名字，不看 `params` 里的键。`apply_status` / `apply_effect` 的 `params` 今天是一张开表，所以 `counter` 的 `foeMaxN` / `foeMaxD` 能待着，一个没人读的键也能待着。这一步给每个状态名一张它真正读取的键表，做法和 `tools/effect-axis-readers.ts` 一样：从读取点扫，扫不到的键就失败，不许再写一份靠名单放行的总表。`counterFlatOf` 读 `foeMaxN` / `foeMaxD` / `flat`，这三个留在 `counter` 上。别的名字不因此获得它们。编译检查在技能和活解析的魂印上跑：某名字的 `params` 出现了这张表以外的键，就失败。不改结算，不改解析器，除非解析器仍在发一个这张表里没有的键——那种和步骤 5 一样，改发已有的键或留下 `unparsedReason`，二选一，不新造键。完成线：`node tools/effects-compile-check.ts` 与 `node tools/soulmark-compile-check.ts` 都是 `failures=0`。再给 `counter` 加一个没人读的 params 键，检查失败。

2. **给 `DAMAGE_KEYS` 里除信封和 `power` / `kind` / `target` 以外的每个键标一个家族。** 只加检查，不搬 `damage.ts`。一个键恰好一个家族。家族按它写进同一次命中的时刻切，不按键名前缀切：

   | 家族 | 写进哪 | 今天的读取 |
   |---|---|---|
   | `power` | 公式前的威力 | `damage.ts` 威力段 |
   | `formula` | 攻防取值、克制、本系 | `damage.ts` 公式段 |
   | `crit` | 是否致命 | `damage.ts` 致命段 |
   | `scale` | 威力之后的伤害倍率 | `damage.ts` 倍率段 |
   | `flat` | 并入这一击数字的固伤 | `damage.ts` 的 flat 累加段 |
   | `cap` | 上限、下限、留血、把体力对齐 | `damage.ts` 钳制段 |
   | `drain` | 命中之后的吸血 | `applyDrainRider` |
   | `onHit` | 命中之后的回复、能力、异常、等量固伤、护盾回响 | `applyHealOnHit`、`applyStageOnHit`、`applyFlatEcho`，以及仍留在 `damage.ts` 的 `flatOnHit` / `ailmentOnHit` / `shieldEcho` |
   | `strike` | 连击、穿透、耗盾 | `damage.ts` 连击与 pierce 段 |

   信封字段（`if`、`chance` 以及 `EffectEnvelope` 上其余的）不属于任何家族。`op` / `power` / `kind` / `target` 也不属于。`schema-sync` 钉住：`DAMAGE_KEYS` 减去这两组之后，和家族表的键集相等。完成线：类型上多一个 damage 字段但不写进恰好一个家族，`node tools/schema-sync-check.ts` 失败。语料行为不变。

3. **一个家族收成一个函数。一次只搬一个家族。** 从已经有函数的 `drain`、`onHit` 开始，核对它们没有直接读别的家族的键。然后按 `flat`、`crit`、`scale`、`power`、`cap`、`strike`、`formula` 搬。搬是剪切：`damage.ts` 原位置换成一次调用，注释指向函数名。函数仍接收今天的 `DamageFx`，仍读原来的键。不改分支，不改取整，不改调用顺序。这一步不改解析器，不改 `content/`。每个家族搬完，先跑已经覆盖这个家族的对局测试，再搬下一个。完成线：`damage.ts` 里不再出现该家族的 `fx.<键>`。九个家族都到这条线之后，这一步才算完。

4. **收成一个命中程序。** 新增一个函数，它是唯一还按旧键名分派的地方：把今天的 `DamageFx` 收成 `{ power, kind, target, riders }`。`riders` 的顺序就是今天这些键被读取的源码顺序。`damage.ts` 只执行这个程序，不再读家族键。结算结果不变。这一步仍不改解析器，旧键还在类型上，所以已编译的包还能装。完成线：一条现有对局测试（沿用 `tests/battle-core/ops/damage-riders.test.ts` 那种同时带多个 rider 的用例）的事件顺序不变；`damage.ts` 的 diff 只有调用程序，没有新的 `fx.<家族键>`。

5. **`attachDamage` 的合并收成一个函数。** 今天同一段「`attachChance` 改写成 `chance`，其余键抄到第一条 `damage` 上」抄在 `tools/effects-compile-check.ts`、`tools/build-peak-roster.mjs`、`tools/build-pet-roster.mjs`，以及 `tests/battle-core/content/real-golden.test.ts`、`tests/battle-core/mechanics/real-soulmark-golden.test.ts`、`tests/battle-core/mechanics/soulmark-r4.test.ts`。收成一处，这六处改为调用它。不改合并规则，不改 `tools/effects-parse.mjs` 里另一处把几率折进 `attachDamage` 的折叠。完成线：六处不再各写一份拷贝；技能编译检查仍是 `checked=53697 failures=0`。

6. **编译器按家族改发 rider。一次一个家族。** 顺序用步骤 3 的顺序。一个家族的内部步骤是：
   1. 给这个家族一个闭联合。固伤是一个 `flat` rider，`of` 区分基线（自身最大体力、对手双防、每层印记……），不是每个基线一个 op。倍率、威力、致命、钳制、连击同样各是一个 rider 名。命中之后的那几个保持今天的函数名。
   2. 分组规则写死：rider 只许紧跟在一条 `damage` 后面，或出现在它的 payload 里。分组器把它们收进步骤 4 的程序。单独一条 `flat` 装载失败。rider 不走通用 `applyOp` 时间线，避免同一击被结算两次。
   3. 编译器改发这个 rider，不再发旧键。`order.mjs` 只在同家族宽规则之前插入，不搬文件。
   4. 跑 `node tools/effects-parse.mjs` 刷新覆盖率，再跑两个编译检查。然后从命中程序里删掉这个家族的旧键读取，并从 `DAMAGE_KEYS` 去掉这些键。旧键再出现就拒载。
   5. 已存储的巅峰包、宠物包如果还带旧键，用现有的 `tools/build-peak-roster.mjs`、`tools/build-pet-roster.mjs` 重编。不手改 JSON，不跑 `soulmark-parse.mjs`。

   一个家族的完成线：该家族的旧键不再出现在 `DAMAGE_KEYS` 里，编译检查 `failures=0`，步骤 4 的那条顺序测试仍过。九个家族都到这条线之后，`CompiledEffect` 的 `damage` 分支只剩 `power`、`kind`、`target` 和信封。这是 `damage` 那一句目标的完成线。

   吸血家族已到这条线：七个旧键不在 `DAMAGE_KEYS` 里；`effects-compile-check` 与 `soulmark-compile-check` 都是 `failures=0`；`tests/battle-core/ops/damage-riders.test.ts` 的顺序仍是 hit、drain、echo、reflect、echo、heal、stage。已存储包只重跑了 `tools/build-pet-roster.mjs`，没有跑 `build-peak-roster.mjs`；旧键已抬走。91 条只有 rider、没有 `damage` 宿主的技能按分组规则拒载，不剥。后八个家族也到了这条线：`effects-compile-check` 是 `checked=53697 failures=0`，`soulmark-compile-check` 是 `entries=3971 failures=0`。没有跑 `build-peak-roster.mjs`，已存储包用编译器的抬升函数原地收成 rider。

7. **被动的主语和概率收进 `guard` 和 `chance`。** 先加一个读取函数，魂印结算只通过它看主语和概率。主语是这些已有字段：`actor`、`victim`、`who`、`switcher`、`cat`、`streak`、`streakN`、`sameMove`、`alwaysHit`。它们变成 `guard` 上的谓词，不新发明条件。概率是这些已有字段：`chanceDyn`、`chanceGrow`、`chanceResetOnFire`、`limitBattle`，收成 `chance` 的闭类型，仍由原来的那一次判定读取。然后编译器改发新形状，活解析的编译检查通过后，再从 `SoulHookOp` 删掉旧字段。旧字段被 `tools/ir-keys.ts` 的条目检查拒绝。已存储的魂印走步骤 6 的重编规则，不跑 `soulmark-parse.mjs`。完成线：`SoulHookOp` 上除了六个目标字段以外，不再有主语字段和概率字段。`node tools/soulmark-compile-check.ts` 为 `failures=0`。

   主语和概率已到这条线：结算只经 `readSoul`。`guard` 是主语谓词，或原来的 Condition；两者都有时世界谓词在 `guard.if`。`chance` 是 `{ base, dyn, grow, resetOnFire, once }`，仍由原来那一次判定读取。`SoulHookOp` 顶层不再有那九个主语字段和 `chanceDyn`、`chanceGrow`、`chanceResetOnFire`、`limitBattle`。`node tools/soulmark-compile-check.ts` 是 `entries=3971 failures=0`。`content/synthetic-v2/soulmarks.json` 与 `content/peak/soulmarks.json` 用 `liftSoulEntry` 原地收过，没有跑 `soulmark-parse.mjs`。幅度成长的七个字段还在条目上。

8. **幅度成长收成 `ops` 里的一条 op。** 涉及 `growStep`、`growCap`、`growPoint`、`resetOnCap`、`atCapMul`、`atCapNext`、`atCapOps`。这些不是 `guard`，也不是 `chance`：它们改的是这一条被动每次结算的幅度，并且在达顶时多派发一段 op。收成一条 op，放在该条目 `ops` 的开头，payload 放今天的 `atCapOps`。新 op 走契约五处。魂印钩子不按 op 名再写一个 `if`，达顶后的派发在这个 op 的处理函数里调用已有的 `applyOp`。编译器改发、检查通过、存储包重编之后，从 `SoulHookOp` 删掉这七个字段。完成线：条目类型只剩 `{ hook, guard, chance, bossGate, ops, elseOps }`。再加一种成长只加这个 op 的一个闭变体，不加条字段。这是被动那一句目标的完成线。`SoulFlagOp` 仍只有已经冻住的成员。

   幅度成长已到这条线：`grow` 的 `of` 只有 `magnitude`，放在该条目 `ops` 的开头。`step`、`magCap`、`point`、`resetOnCap`、`atCapMul`、`atCapNext` 在这条 op 上；达顶负载是 `payload`，由这个 op 在兄弟 op 之后调用 `applyOp`。魂印钩子不按 op 名分支。`beforeOrder` 的先制区间是 `ops` 里的 `priority`（`min`/`max`），`orderRoll` 仍在排序时掷点，条目上不再留 `prio`。`SoulHookOp` 只剩 `hook`、`guard`、`chance`、`bossGate`、`ops`、`elseOps`。`SoulFlagOp` 成员没动。`node tools/soulmark-compile-check.ts` 是 `entries=3971 failures=0`。`node tools/schema-sync-check.ts` 通过（`gatedOps=42`，`props=257`，`conditions=142`）。`content/synthetic-v2/soulmarks.json` 与 `content/peak/soulmarks.json` 用 `liftSoulGrow` / `liftSoulPrio` 原地收过，没有跑 `soulmark-parse.mjs`。

9. **技能回合窗发已经在结算的 `periodic`。** 只迁 `periodic` 轴上那些 `*_tick` 名字。一次迁一个名字。改发出这个名字的家族规则，改发脱糖之后的形状：`{ op: "apply_status", name: "periodic", turns, params: { win }, payload }`。`turns` 留在 `apply_status` 上，装载时仍读成 `remainingTurns`。`win` 用这个名字今天在 `periodicFormOf` 里对应的窗口，不新开窗口。`payload` 不带 `transfer_stages` 类型上没有的 `target`；`plain` / `noHooks` 是信封上已经在读的键，脱糖形状要带上，否则 tick 语义会变。不改 `SoulHookOp`，不加 `Condition` 成员，不改 `engine.ts` 的循环，不改 `tools/effects-parse.mjs` 的匹配循环，不改 `tools/soulmark-parse.mjs`。这个名字在活语料里不再出现、已存储包也不再引用之后，才从 `EFFECT_DEFS` 和 `periodicFormOf` 删掉它。删名字和删脱糖分支是同一处的反向。还要连带改 guard 或结算的，就不算这一步。完成线：`tools/effect-axis-readers.ts` 仍过；对一个已经迁完的名字，解析器再发出它，编译检查以 `UNKNOWN_STATUS` 失败。技能命中后的 op 列表保持原样，不把普通 `apply_status` 全改成钩子。

   `transfer_down_tick` 已到这条线：`timed-85` 改发 `periodic`，`params.win` 为 19。`EFFECT_DEFS` 和 `periodicFormOf` 已删这个名字。`content/peak/moves.json` 12 条、`content/claims/_effects-coverage.json` 15 条按同一形状收过，没有跑 `effects-parse.mjs`。

   `cleanse_self_ail` 已到这条线：四条家族规则改发 `periodic`，`params.win` 为 15。`EFFECT_DEFS` 和 `periodicFormOf` 已删这个名字。峰值包和覆盖率各 16 条保留原来的 `if: { selfStatused: true }`，没有跑 `effects-parse.mjs`。`node tools/effect-axis-readers.ts` 通过。`node tools/effects-compile-check.ts` 是 `checked=53697 failures=0`。其余 `*_tick` 名字还在。

   `cleanse_up_tick` 已到这条线：`batch-e5h-18` 改发 `periodic`，`params.win` 为 14。`EFFECT_DEFS` 和 `periodicFormOf` 已删这个名字。峰值包和覆盖率各 10 条保留原来的 `turns`（9 条 3 回合、1 条 4 回合），payload 是 `clear_stages`（`sign: "up"`、`plain`，不带 `noHooks`），没有跑 `effects-parse.mjs`。`node tools/effect-axis-readers.ts` 通过。`node tools/effects-compile-check.ts` 是 `checked=53697 failures=0`。其余 `*_tick` 名字还在。

   `stage_tick`、`pp_tick`、`prio_push_tick`、`steal_stages_tick`、`steal_rand_tick`、`cleanse_down_tick`、`down_push_tick`、`cleanse_foe_tick`、`ailment_tick`、`pp_zero_tick`、`dealt_tick`、`maxhp_tick` 已到这条线。解析出口在后处理之后把这十二个名字收成 `periodic`，窗口分别是 6、7、8、10、11、12、12、13、16、16、17、20。`transfer_stages` 不带 `target`。`cleanse_foe_tick` 的 `params` 只留 `win`，原来的 `count` 不留；活语料没有句子再发出这个名字。`plain` / `noHooks` 与删掉前的脱糖一致。`EFFECT_DEFS` 和 `periodicFormOf` 已删这十二个名字。`content/peak/moves.json` 1009 条、`content/claims/_effects-coverage.json` 1054 条、`content/peak/soulmarks.json` 与 `content/claims/_soulmark-coverage.json` 各 9 条、`tests/fixtures/parser-golden.json` 5 条按同一形状收过，没有跑 `effects-parse.mjs`，没有跑 `soulmark-parse.mjs`。`node tools/effect-axis-readers.ts` 通过。`node tools/effects-compile-check.ts` 是 `checked=53697 failures=0`。`node tools/soulmark-compile-check.ts` 是 `entries=3972 failures=0`。`doom`、`dot_field`、`hot`、`drain_dot`、`foe_dot`、`pp_drain` 还在。家族规则改为在 `go()` 里 `liftTick`，发出的就是这十二个窗口的 `periodic`。带回合窗的 random 施加仍先写成 `ailment_tick`，出口再收。免疫门同时认 `dealt_tick` 和 `periodic` win 17；弱化反推同时认 `cleanse_down_tick` 和 win 12 的 `clear_stages`。`dealt` 的承伤端在主语翻转之后按最终 `target` 对齐。没有重跑 `effects-parse.mjs`，没有重跑 `soulmark-parse.mjs`。
