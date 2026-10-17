# 魂印（Soulmark）实现规划

> 阶段定位：技能效果管线已全绿（53697 招编译门禁零失败 / 765 vitest / 7 e2e）。
> 本文档只规划，不动实现。原则：万物皆模块 + 干涉最小 + 语义不臆造（UNVERIFIED 留档）。

## 0. 现状盘点

| 层 | 状态 |
|---|---|
| 机制模块 | `packages/battle-core/src/mechanics/soulmark/index.ts` 已注册，可整体插拔 |
| soulOp | 9 种手写 op：`immune_control`/`immune_stage_down`/`priority_high_hp`/`endure`/`turn_heal`/`turn_pp_restore`/`turn_flat`/`entry_dispel`/`hit_shield` |
| 钩子面 | `priorityBoost` / `controlImmune` / `stageDropImmune` / `onEntry` / `onFatalDamage` / `absorbDamage` / `onDamaged` / `onTurnEnd` + `checkUnit`/`unitFields`/`applyUnit`/`checkInitSlots`/`projections`/`eventFields`/`meta` |
| 数据 | `content/creatures/creatures.json`：1884 只精灵带 `soulMark.text` 原文（未解析） |
| 合成验证 | `content/synthetic-v2/soulmarks.json` 5 条 fixture + `soulmark-fifth-v2.test.ts` 26 用例 |
| 留档 | `content/claims/_soulmark-deferred.json`：11 个引用印记/魂印的技能（帝皇铠甲·五行印记、弑序神罗·致命印记等） |
| 缺口 | 真实魂印文本**零解析**；11 个印记技能全部 UNVERIFIED 挂起 |

## 1. 真实语料触发器/效果族分布（1884 条采样）

| 触发器（出现次数） | 频次 | 映射钩子 |
|---|---|---|
| 回合开始时/每回合开始 | 551+51 | `onTurnStart`（新钩子） |
| 回合结束时 | 471 | `onTurnEnd` ✓ 已有 |
| 登场时/出场 | 234+25 | `onEntry` ✓ 已有 |
| 受到攻击时 | 203 | `onDamaged` ✓ 已有 |
| 击败对手后 | 74 | `onKO`（新钩子） |
| 受到致命伤害 | 14 | `onFatalDamage` ✓ 已有 |
| 换下/主动切换 | 13+28 | `onSwitchOut`（新钩子） |
| 选择技能的回合 | 若干 | `beforeAction`/`onActionDeclared`（新钩子） |
| 使用攻击技能时 | — | `onMoveUsed(cat)`（新钩子） |

| 效果族 | 频次 | 复用点 |
|---|---|---|
| boss无效/有效 | 546+83 | `modeOverlays.boss` 已有 → 加 `bossGate` 标记 |
| 恢复/吸血 | 404 | `heal` / `drain` op |
| 异常状态 | 291 | `apply_status` + `chance` 信封 |
| 先制 | 277 | `priorityBoost` 钩子（扩为条件化） |
| 固定/百分比伤害 | 270+66 | `damage` op（fixed/percent kind） |
| 免疫（控制/异常/攻击） | 236 | `immune_*` 模板 + 条件谓词 |
| 致命一击 | 186 | `crit_always`/`critChance` 窗口 |
| PP 操作 | 134 | `pp_delta` op |
| 护盾 | 95 | 护盾位已有（`hit_shield`/dmgShield） |
| 强化/弱化 | 36+大量 | `apply_stat_stage` + 条件谓词 |
| 反弹/弹伤 | 45 | `counter`/`react trigger:1` 复用 |
| 印记 | 4（+技能侧11） | 计数器效果（见 §4） |

关键观察：**子句语法与技能文本同一族**（`100%令对手麻痹`/`能力值-1`/`固定伤害`），
`parseEffectText` 的子句规则库大部分可直接复用——差异集中在**触发前缀**而非效果体。

## 2. 目标架构：魂印 = 钩子 × 原子 op

现有 9 个 soulOp 是"机制写死"形态。目标形态（向后兼容共存）：

```jsonc
// 魂印条目新形态（与旧 soulOp 并存于 effects[]）
{
  "hook": "onTurnStart" | "onTurnEnd" | "onEntry" | "onDamaged" | "onKO" | "onFatalDamage" | "onSwitchOut" | "beforeAction" | "onMoveUsed",
  "guard": { /* Condition —— 直接复用 loader.ts Condition 联合 */ },
  "chance": 50,              // 复用信封语义
  "ops": [ /* CompiledEffect —— 零新增语义，op 注册表直接可用 */ ],
  "elseOps": [ /* "未触发则X" 分支 —— 新信封维度 */ ],
  "bossGate": true           // （boss无效）→ modeOverlays.boss 时跳过
}
```

- **零新 op**：全部效果落到现有 15 个 op 原子集（`apply_stat_stage`/`damage`/`heal`/`apply_status`/`cleanse`/`pp_delta`/`control`/`transfer_stages`/`clear_stages`/`force_switch`/`copy_stages`/`invert_stages`/`swap_hp`/`transfer_ailments`/`apply_effect`）。
- **旧 9 soulOp 保留**：synthetic packs 继续工作；新 grammar 并行存在。迁移评估在 S5 之后做（不动既有行为）。
- **新钩子最小集**：`onTurnStart`（551 次，最高频）/`onKO`/`onSwitchOut`/`onMoveUsed`/`beforeAction`。钩子签名沿用 `TurnEndCtx` 模式：`(ctx) => void`，hurt 通道走 checkpoint。
- **bossGate**：`modeOverlays` 已有 boss 声明——魂印效果加 `bossGate` 字段，foe.mode==="boss" 时整段跳过（不逐条判定，符合"boss无效"语义）。

## 3. 解析管线：parser 复用 + 触发前缀表

```
soulMark.text ──分句──> 触发前缀剥离（表驱动）──> 剩余子句 → parseEffectText 规则链
                                                    │
                                          效果体语法完全一致，
                                          仅包裹 hook/guard/chance/bossGate
```

新增解析规则（全是"包装层"，不动效果语法）：
- `每回合开始时X` / `回合结束时X` / `登场时X` / `受到攻击时X` / `击败对手时X` / `换下时X` / `使用攻击技能时X`
- `若P则X` / `若P，50%令X` / `，未触发则Y`（elseOps）
- `（boss无效）`/`（boss有效）` 尾缀 → bossGate
- 魂印名前缀 `蜜：`/`问：` 剥除（注意 pet-4714 有 FAQ 垃圾文本——数据清洗项）

## 4. 印记（Mark-stack）机制——魂印联动技能的前置

`_soulmark-deferred.json` 的 11 技能依赖**可数层数的印记**：
- `致命印记`/`致命裂痕`：挂在**招式槽位**上的计数（"散布2枚印记到任意技能"）
- `五行印记`：场上计数（"每有1种提升25%"）

方案：印记 = `apply_status` 的 `mark:*` kind + `params.count` 计数：
- 新 flag `stackable`（EFFECT_DEFS）：同名效果叠加时 `params.count += n` 而非合并
- 新条件谓词 `markCountAtLeast { kind, n }` / `foeMarkCount { kind }`（"对手每存在1层裂痕则附加100真伤" → `flatPerMark { kind, add }`）
- 印记位置语义 `slotMark: true`（挂到招式槽而非单位）——**UNVERIFIED** 候选，先记 flag 再实现

## 5. 分批实施计划（频率优先，每批带测试）

| 批 | 内容 | 预估覆盖 |
|---|---|---|
| S1 | soulmark schema 扩 `hook/guard/chance/ops/elseOps/bossGate`；`onTurnStart`/`onKO`/`onSwitchOut`/`onMoveUsed`/`beforeAction` 五个新钩子；钩子派发接 checkpoint | 基础设施 |
| S2 | 触发前缀解析 + 高频效果映射（恢复/先制/固伤/异常/免疫/强化）→ 覆盖率脚本（复刻 effects-parse 模式：`soulmark-parse.mjs` 产出覆盖率报告） | **已落地：22.6% 子句**（667 条 entries 全过 soulHook schema；详见 §5.1 实测分布） |
| S3 | `未触发则` elseOps 信封 + 条件复合（`若对手处于能力下降则`）+ `之后概率提升N%` 累积计数（params.count 复用） | **部分落地**：见 §5.2 |
| S4 | `stackable` 印记 + 槽位印记 + 11 个 deferred 技能落地 + `markCount` 谓词族 | **已落地**：见 §5.3 |
| S5 | 真实精灵魂印 golden（带 soulMark 的 4 精灵 pack 事件流快照，T6 同款 harness）+ 全量魂印编译门禁 | **已落地**：见 §5.3 |
| S6 | 旧 9 soulOp → 新 grammar 迁移评估（可选，独立决策） | 清理 |

每批门禁：parser golden（魂印文本分层抽样）+ compile-check 扩展 + effects-v3 同款行为断言 + 泄漏不变量复用。

### 5.1 S2 实测（`test:soulmark-parse` → `content/claims/_soulmark-coverage.json`）

管线：HTML 实体清理 → FAQ `答：X是：` 正文抽取 / `>>>` 尾巴剥离 → 文本级 `以上效果boss无效` + 子句级 `（boss无效）` → 代号/编号复合前缀循环剥 → `每场战斗限一次`→`limitBattle`、`首次登场`→`onEntry+limitBattle` → `，`段按触发词切组 + 前句触发器继承 + `当P时R`守卫吊装（P 走 `若P则`）→ `parseEffectText` 复用解析体。

- 输入 1884 条魂印文本 / 2945 有效子句（脏文本不计入分母）：**fully=248 partial=531，731 条 entry，clause 覆盖 24.8%**
- hook 分布：onTurnEnd 203+ / onMoveUsed 187+ / onTurnStart 183+ / onEntry 36+ / onKO 26 / onDamaged 24+ / onBattleStart（含被动映射）/ onSwitchOut
- 解析产物 731/731 全过 soulmarks.schema.json soulHook 校验（ops 走 moves.schema 效果项 $ref）
- 未覆盖主桶：`no-trigger-prefix` ~1378（S3/S4 语义族为主）、inner 片段 ~1950（子句已出条目不否决）、`move-flag`（attachDamage 非 flat 变体）、`post-damage-trigger`、`party-scope`、`slot-mark` 等已显式分桶
- 新增运行时能力：`cat` 数组（攻击=[2,3]）、`onBattleStart`（turn===1 随 TURN_START 派发一次）、`switcher:"foe"`（`对手换下时`双侧派发）、`limitBattle`（`soul.firedOnce` 内部记账）、`chanceGrow`（`soul.chanceAcc` 累积）、`MoveUsedCtx.order`（先/后出手守卫下沉 ops `if:{order}`）
- 与原 ~60% 预估的差距全部有显式 reason——印记/形态/被动余量按设计留 S3/S4

新增门禁：`test:soulmark-parse`（覆盖率脚本）+ `test:soulmark-parse:test`（40 条分层用例 + soulmark-hooks 20 条）。

### 5.2 S3 已落地子项

- **`elseOps`**：runtime 信封 S1 已具备；parser 侧 `未触发则Y` 经 parseEffectText 落成 op 级 `if:{not:prevApplied}`——runSoulHook 的 prevApplied 近似语义等价，无需再拆。
- **复合条件**：condOf 增 `且|并且` → `and` 递归（or 已有）——技能/魂印双侧受益，golden 无回归。
- **概率累积**：`chanceGrow:{add,cap}` 字段 + `soul.chanceAcc` 内部记账——"之后本次在场该概率提升N%，最高M%"尾句自动挂最近带概率条目（ops 同值 chance 上吊 entry 级）。
- **常驻被动族零新 op 落地**：`onBattleStart` + `apply_status`（无 turns=永久）——映射表 `dmg_boost`/`dmg_taken_down`/`flat_taken_pct`/`immune_status`/`immune_degrade`/`crit_immune`/`crit_up`/`reflect_dmg`/`dmg_floor`/`dodge`。承伤减半已实测断言（同 seed 对比验证）。
- **概率免疫/条件被动**（`50%免疫致命一击`、`满体力时免疫`）→ `chance-passive`/`conditional-passive` 显式分桶，不臆造。

**S3 未做（留后续批）**：`base-stat-boost`（体力+N——需验证图鉴种族值是否已含加成，不臆造）、`post-damage-trigger` 钩子、回合数窗口被动（`登场N回合内`）、`party-scope`（背包/场下目标域）。

### 5.3 S4+S5 实测

**S4 印记体系**（`ops/mark.ts` 新模块 + damage/apply_status/engine 接线）：

- 三类印记存储：unit 印记（`effects[]` 复用，`kind:"mark:<name>"` stackable+cap）、槽位印记（`unit.moveMarks[moveId][mark]`）、场地印记（`side.fieldMarks[]`，回合末递减）
- `MarkRef` 计数源：`on`(self/foe/both) × `at`(unit/slot/field) × `kinds`(种类数) × `per`(每N层一档)；谓词 `markCountAtLeast`/`fieldMarkKindsAtLeast`；消耗 `consume_mark`（精确名/`*`通配/`*龙鳞`后缀族）
- 缩放字段：`mulPerMark`/`flatPerMark`/`mulChancePerMark`（damage）+ `countPerMark`（apply_status 次数）
- 固伤免疫族：`flat_immune` 效果 + `kindIfImmune` 对象形（`{from,flat}` 转真伤）；drain_dot tick 经 `params.kiiFlat` 接入同一转换管线
- KO 清槽位印记（shared.ts），场地印记回合末递减（engine.runTurnEnd）
- parser：`ctxMarkScale` 中句吊装通道（"场上每有1种五行印记，伤害提升25%"），`每存在N层` per 除法，3 处 `(${NUM})?` 嵌套捕获组下标错位修复，`臣服` ailment，`免疫固定伤害、百分比伤害`/`对手免疫固定伤害则转变为真实伤害` 句式
- 11 个 deferred 技能：38 fx 编译通过；残余 18 条全部显式分桶（party-scope 场下追踪/处决·龙鳞生命周期/首用槽位失效/等量指代——合法延迟语义，非 parser 缺口）
- 测试：`marks.test.ts` 11 例 + parser-regression 追加 6 例锁定本批修复

**S5 真实 golden + 编译门禁**：

- `tools/soulmark-compile-check.ts`（npm script `test:soulmark-compile`）：逐精灵 parseSoulmarkText → soulmark 文档 → ① soulmarks.schema 单条校验（moves.schema addSchema 跨文件 $ref）② ops/elseOps 递归 OPS 注册表 + EFFECT_DEFS 名检查 ③ 全部条目组文档过 `soulmarkMechanic.compile` 生产路径端到端复核 → `_soulmark-compile-failures.json`
- 实测：**1884 魂印文本 → 602 marks / 738 entries / 0 failures**
- `tests/battle-core/mechanics/real-soulmark-golden.test.ts`：4 真实精灵（赤瞳·缪斯 onTurnEnd / 天弓黄忠 onKO / 魔龙·加洛斯格 onDamaged / 卧龙诸葛 onEntry）组 pack 固定 seed 对局 → 81 事件含 **14 次 soulmark 派发**，快照 `tests/fixtures/real-soulmark-golden.json`（`UPDATE_SOUL_GOLDEN=1` 重新生成）
- 数据怪癖记录：幽美（3471）复合属性"暗影神秘"不在 typechart 攻方行——4399 表非对称（复合防型仅部分有攻方行），golden 改用卧龙诸葛

## 6. UNVERIFIED 预登记（不臆造）

- `记录的体力值`（pet-4713 登场记录型）→ 需要 unit 级 `memory` 字段存任意快照——新内部状态维度
- `每在场概率提升5%`（pet-4718）→ 累计概率是 per-unit 持久计数 + 换入继承——印记/计数器族的边界情况
- `己方下只精灵继承上述所有效果`→ 效果转移给未登场单位（nextInFx 已支持即时效果，**长期增益转移**语义未文档化）
- `技能PP值为0则取消体力上限提升`（pet-4714）→ HP 上限随 PP 动态浮动——maxhp_tick 有先例但反向语义未验证
- FAQ/攻略文本混入 soulMark.text（pet-4714）→ 数据清洗标注 `DIRTY_TEXT`，不参与解析
- `五行印记每剩余5回合`→ 印记带回合数 + 回合数谓词——等印记落地再判定

## 7. 与技能效果管线的接口契约

- 魂印 `ops[]` 走与技能 `effects[]` **同一个** `applyOp` 派发（chance/if/envelope 全套复用）
- 魂印事件一律 `type:"soulmark"` 已锁定（eventFields 注册）
- react 触发器（params.trigger 1–13）对魂印 payload 天然可用——`受到攻击时X` ≈ `react{trigger:1}`，优先复用 react 而非新钩子
- T8 泄漏不变量对魂印自动生效（soulmark 模块已走 projections）

## 8. 验收线

1. `soulmark-parse` 覆盖率报告 ≥85% 子句（首期目标，弱于技能的 91%——魂印长尾更重）
2. 11 个 deferred 技能全部出 UNVERIFIED → 编译通过
3. 带魂印真实精灵 golden 事件流稳定
4. 机制插拔不变量：删除 mechanics/soulmark 目录 + 注册行后全量测试仍绿（无魂印 pack 不受影响）
5. 合成 soulmark 26 用例全程不回退
