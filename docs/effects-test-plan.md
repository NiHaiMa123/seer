# 技能效果复刻——测试规划

> 基线（E5j 结束时）：53798 招 / 114579 子句，parser 覆盖 91.2%（fully 46014），`tests/battle-core` 236 用例全绿（11 文件），10k seeded property 通过，`typecheck`/`content-validate`/`contracts:check` 全过。
>
> 目标：把"解析成功"抬升到"行为可证"——每个已落地的机制有行为级回归，每批残留有显式留档理由，全语料编译与确定性有门禁。

## T0. 已有基线（不复测，只做门禁化）

| 层 | 现状 | 门禁 |
|---|---|---|
| op 单测 | `effects-v3.test.ts`（78）+ `mechanics-v2`/`seals-v2`/`soulmark-fifth-v2`/`interactions-v2`/`switching-v2` | vitest CI |
| golden | `goldens.test.ts`（29） | 字节级快照 |
| 确定性 | `property.test.ts` 10k seeds 不变量 | 每 PR |
| 契约 | `contracts:check` 生成物一致性 | 每 PR |
| 内容 | `content-validate` 18 文件 | 每 PR |

**缺口**：parser→loader→runtime 三段是分开测的；真实语料没有 golden；`UNVERIFIED` 留档无防回归；覆盖率只报不报闸。

## T1. 解析器 golden 快照（✅ 已落地）

`tools/effects-golden.ts` 等距分层抽样 350 条真实技能文本 → `tests/fixtures/parser-golden.json`（`{key,text,flags,effects,unparsed}`）；`tests/battle-core/parser/parser-golden.test.ts` 逐条 re-parse 对比（351 断言全绿）。更新：`pnpm test:effects-golden:update`（显式再生成 + diff 评审）。断言维度：effects 数组、flags、unparsed 全部字段（JSON 序一致）。

## T2. op/flag 原子行为单测（补盲）

按 `EFFECT_DEFS` flag 与 `CompiledEffect` 字段逐行过，缺行为断言的补：

- **窗口类**：`cleanse_lock`（被锁方净化失败 `protected`）、`immune_degrade` 到期、`move_null` prioMin/prioMax/powerBelow/cat 各守卫分支、`hit_fx_null` 次数消耗、`dmg_reduce.count`、`must_miss.count`、`dodge.pct` 概率路径（rng draw 记账断言）。
- **转换类**：`dmg_to_heal.count`、`dmg_to_shield`（伤害→等量护盾）、`kindIfImmune:"true"`（固伤被免→真伤穿透，`damageKind:"true"` 事件）。
- **记账类**：`lastDealt/dynDealt`（n=本回合伤害）、`lastTaken/prevTaken`（上回合承伤谓词——含"自身两次行动间"窗口语义）、`flatPrevTakenPct`、`flatFoeLastDmg`。
- **echo 类**：`cleanse.echoPct`（护盾被消→反噬）、`drainEcho`、`healEcho`（禁疗反噬/等量百分比）、`foe_dot.anyAilDegrade` 门控开/关两支。
- **连击类**：`hitsPerPpGap`（付费后自身槽非满计入 gap）、`hits.perUse+cap`、`powerDropPerHit`（逐击衰减）、`critPerUsePct`（叠用暴击率）、`hitsRange` 分布边界。
- **异常/状态**：`ailment_tick` 池抽样（list/count）、`transfer_ailments` 方向、`clear_stages sign:"up"|"down"` 选择性清除、`stat:"crt"` 只写段位不消费、`immune_status.count` 次数制。
- **先制/顺序**：`prio_push_tick`、`prio_count` 声明消耗、`order:"last"` 的 scaleIf/mulIf、`hitIf` 不命中分支（`missed` 事件而非静默跳过）。

约定：每条用例断言**事件流**（`damage`/`stat-stage`/`pp-delta`/`protected`/`effect-faded`）而非只断言终态——魂印 endure/PP 回补会干扰终态断言。

## T3. 信封与条件组合矩阵

- `chance` 全变体：`chanceMulIf`/`chanceSetIf`/`chancePerUse`/`chancePerStage`/`chancePerMissing`/`chanceBoostPct` 叠加顺序（现行：base→mulIf→setIf→perUse→perStage→perMissing，冻结后快照）。
- `if` 复合：`and/or/not` 嵌套、`prevDamageOdd/Even`/`prevCrit`/`prevDamageKind/NotKind`/`prevDamageAboveFoeHp`、`effWeakVsFoe`（微弱判定边界 eff16∈(0,16)）、`foeCountersUs`/`weCounterFoe`、`selfHpBelow`/`foeHpBelow`（Frac 与 Abs 两系）、`foePpLt`、`sameAttr`、`prevTakenZero`、`not:{selfStatused}`。
- 原子性：`if` 不满足 → 跳过该 op 且后续 op 照常（**含前 op KO 后后续 op 仍结算**的既有断言保留）。

## T4. react 触发器时序（✅ trigger 1–13 全覆盖）

`effects-v3.test.ts` T4 describe 块（13 用例全绿）覆盖：trigger 4 破盾（破/未破两侧）、6 自MISS、8 回合未受击（回合末边界）、9 对手换入（bench 实切换，payload 落新登场精灵）、11 cat:1、12 cat:2（物理触发/特殊不触发）、max 守卫、prioMin 守卫、count 次数消耗、params.chance 条目级逐次判定（0/100 两极）、payload 内嵌 chance、trigger3 cat:4=非属性技。

**矩阵过程发现两个真问题**：
- `reactWrap` 把 `chance` 挂在 apply_status **op 信封**上（挂窗时判定一次），而 `fireReactive` 读条目 `e.chance`（从没被写入）——`受到攻击时N%几率X` 语义实际是「每次触发判定」。已修：parser 五处 `envelope.chance` → `params.chance`（每触发判定），`fireReactive` 读 `e.chance ?? p.chance`。golden 3959 条目 diff 确认迁移。
- `entry_dispel` 魂印会在换入时清掉留守方的回合类效果（含 react 窗口）——trigger9 测试因此必须用无该魂印的 bench 精灵，属正确交互语义而非 bug。

剩余未测矩阵格（需要专门构造）：trigger2 的 `count` 消耗 + `若对手下N次攻击miss` 孤儿接合、trigger7 的 transfer_stages 派发路径、trigger5 KO 派发 vs turn-end 顺序、payload `if` 复合条件。

## T5. 跨回合与生命周期

- timed `turns` 到期/`turnsRange` 随机持续（分布抽验 min/max 边界）。
- `extendTurns` 续回合、`stage_tick`/`ailment_tick`/`steal_rand_tick`/`cleanse_up_tick`/`cleanse_foe_tick`/`prio_push_tick`/`cleanse_self_ail_tick`/`drain_dot`/`foe_dot` 的 turn-end 顺序与互相触发上限（循环触发保护）。
- 换场：timed 效果随单位下场是否清空（bench 语义——现状按 `onEnterTarget`/`nextFoe` 目标实测）。
- `moveStacks` 换招清零、首击不加。

## T6. 真实数据集成 golden

- 从 creatures.json 选 **6–10 只代表精灵**（早期简单招 + 中期复合招 + 含已落地长尾机制各 1–2 只），其 parsed moves 编成 pack，跑固定 seed 3–5 回合 golden 对局。
- 快照对象：事件流类型序列 + 关键数值（damage/heal/stage delta），不依赖原文语义正确性（UNVERIFIED 数值不验）。
- 准入门槛：所选招式的 parsed effects 全解析（无 unparsed 子句），否则换样本。

## T7. 全语料编译门禁（✅ 已清零，转 ratchet 态）

`tools/effects-compile-check.ts`（`pnpm test:effects-compile`）：coverage 产物 → 组装 move（attachDamage 并入 damage op，无伤害招合成基线）→ schema 校验 + `OPS` 注册表 + `EFFECT_DEFS` 名表三层检查 → `content/claims/_compile-failures.json`。

**当前状态：53697 招 0 失败**；`emptyMoves=1158`（flags-only 104 + 留档残留 1054——schema 已放行空 effects，不计失败）。首跑曾暴露 61206→3996→0 三轮修复（capture-group 错位、`drain/recoilFrac` 键名、stealUpgrade 重复 op、turns/hits 上限、percentBase/direction 枚举、缺失主属性 7 个、中文 status 名泄漏、`cleanse_self_ail` 正名、`mul` Frac 化）。

回归锁定：`tests/battle-core/parser/parser-regression.test.ts`（12 用例覆盖本轮每个 bug 类）。

## T8. 确定性 / property 扩展

- 维持 10k seeds 不变量（HP 边界、无 NaN、事件单调 seq）。
- 新增 invariants：**同一 seed 同一指令流双跑字节一致**（已有）；**`prevTaken/lastTaken/lastDealt/moveStacks` 不出现在快照外的可观察路径**（内部记账不泄到公开事件 detail）。
- 目标化 fuzz：随机合法动作流 × 随机 seed，断言引擎不抛 `EngineFault` 之外的异常（把 crash 与规则拒绝区分开）。

## T9. 覆盖率 ratchet（✅ 已落地）

`tools/effects-ratchet.ts`（`pnpm test:effects-ratchet`）：对比 `content/claims/_coverage-baseline.json`，clauseCoverage 回退 >0.1pp / fullyParsed 回退 / topUnparsed[50] 无 reason 占比上升 → FAIL。当前基线：90.9% / fully 45739 / top50NoReason 15。

## T10. 契约 / 边界

- `contracts:check`（生成物同步）+ `check:boundaries`（ops 不依赖 app 层）。
- schema 三处一致性测试化：`moves.schema.json` 主 properties / then 白名单 / loader TS 类型——加一条静态校验脚本断言新字段三者同步（防"加了 then 忘加 properties"型 bug，历史已发生两次）。

## T11. 性能与资源

- parse 全库耗时基线（当前 ~30s 量级，记录不门禁）；单招 parse p99 < 5ms。
- 引擎：单 turn p95 < 5ms（synthetic pack）；10k property 总时长 < 90s。

## T12. 浏览器 e2e（✅ 首跑通过）

- Playwright `tests/e2e/battle.spec.ts` **7/7 全过**（真实双浏览器对局、skip-animation 与同状态比对、延迟历史 UI、bench/换人、队伍编辑器、重进再同步、world→boss→concede→奖励循环）。
- 手动 `browser_preview` + demo server（:8787）验证：synthetic-v2 PVE 跑至终局 `{"result":"p1","reason":"ko"}`，事件类型 `turn-begin/action-declared/stat-stage/damage/heal/action-failed/ko/battle-end` 全部经 `feed.tsx` 渲染。
- 发现 UI 缺口并修：`protected`/`pp-delta`/`struggle-used` 缺中文标签（→ `apps/client/src/meta.ts`）；`rng-draw` 故意不公开（隐私边界）。
- 剩余：T6 真实 golden 精灵注入 UI 逐步断言；`protected`/`pp-delta`/`struggle-used` 的确定性 UI 用例（需可复现的对局触发这三类事件）。

## 测试数据管理规则

- fixture 文本一律来自 `creatures.json` 原文（注明 petNo/moveId 溯源）；数值断言走 synthetic（UNVERIFIED 不验原作精确值）。
- seed 固定：`start("<hex32>")`，禁止 `Date.now`/`Math.random`。
- 事件级断言优先于终态断言（魂印 endure/PP 回补会改写终态）。
- 每次语义修正必须带一个 failing→passing 的用例（现有工作流已遵守，写入规则）。

## 执行顺序建议

1. **T7 全语料编译门禁**（先兜底——schema/loader 漂移是历史最高频 bug 类）
2. T9 覆盖率 ratchet（护栏）
3. T1 解析器 golden（锁行为）
4. T4 react 矩阵 + T2 补盲（按批补）
5. T6 真实 golden + T12 浏览器 e2e
6. T3/T5/T8/T10/T11 滚动补齐

## 执行状态（2026-10 全绿收口）

| 层 | 状态 | 产物 |
|---|---|---|
| T2 op/flag 原子行为 | ✅ 113 用例 | `effects-v3.test.ts` |
| T3 信封/条件矩阵 | ✅ +9 用例；修 `chancePerUse` 不进 `moveStacks` 真 bug | `effects-v3.test.ts` + `engine.ts` |
| T4 react 触发器 1–13 | ✅ +13 用例；修 react 条目级 chance 未接线 | `fireReactive` + parser |
| T5 生命周期 | ✅ +7 用例（到期语义/turnsRange/换场冻结/moveStacks 随迁/互弹链终止/先递减后 DoT） | `effects-v3.test.ts` |
| T6 真实数据 golden | ✅ 4 真实精灵 152 事件流快照；新增 `real-v1` ruleset + typechart 补"普通"中性行 | `real-golden.test.ts` + `tests/fixtures/real-golden.json` |
| T7 编译门禁 | ✅ 53697 招 0 失败 | `tools/effects-compile-check.ts` |
| T8 泄漏不变量 | ✅ 78 事件 × 递归键扫描零泄漏 | `leakage.test.ts` |
| T9 ratchet | ✅ 90.9% PASS | `tools/effects-ratchet.ts` |
| T10 schema 同步 | ✅ 修 `apply_effect` 门控过宽（turnsRange/random/payload 是假承诺） | `tools/schema-sync-check.ts` |
| T11 性能基线 | ✅ compilePack 28.9ms / turn p95 0.084ms / 语料 parse 8534/s | `artifacts/perf-baseline.json` |
| T12 浏览器 e2e | ✅ Playwright 7/7 | `tests/e2e/` |

后续：魂印实现规划见 `docs/soulmark-plan.md`（S1–S6 分批）。
