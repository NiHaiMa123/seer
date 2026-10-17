# 技能效果复刻规划（原子化 + 通用化）

状态：规划。输入数据源 = `content/creatures/creatures.json`（4399 精灵图鉴，3526 精灵 / 62647 技能 / 53798 条非空效果文本，`CLAIM-CREATURES-4399` UNVERIFIED——仅作数据源，解析成功 ≠ 原作语义已验证）。

## 0. 语料度量（驱动分批的唯一依据）

子句切分（按 ，。；、 断开）后共 **122,458 子句 / 12,768 归一化模式**（数字、中文数字 → `#`）。覆盖曲线：

| 模式数（按频次排序） | 累计子句覆盖率 |
|---|---|
| top 500 | 66.3% |
| top 1000 | 75.2% |
| top 2000 | 83.3% |
| 全部 | 100% |

结论：**头部极规则**（必中/先制+N/能力等级±/命中后N%异常/消除强化/回合免疫），长尾极长（40% 的模式只出现 1 次）。工程含义：先做频次驱动的原子 op 集，长尾按覆盖率报告逐批清扫；不可解析子句进 `unparsed` 桶，**不臆造语义**。

年代梯度：petNo<2000 的技能 21% 无效果文本，≥2000 的仅 12% 但子句更长更复合——先按模式频次横切，不按 petNo 硬切。

## 1. 效果 IR（对现有 `effects[]` 的最小扩展）

保留 `{op, ...params}` 数组顺序结算模型，为**所有 op 增加统一信封字段**：

```ts
interface EffectOp {
  op: string;
  target?: "self" | "opponent";          // 缺省按 op 语义（damage=opponent，其余=self）
  chance?: number;                        // 0–100，未过 → 发 action-failed/effect-missed 事件
  if?: Condition;                         // 条件谓词，不满足 → 跳过该 op（不视为失败）
  [params: string]: unknown;              // op 自有参数
}
```

`Condition` 是独立可组合谓词集（递归 and/or/not）：

```ts
type Condition =
  | { selfHpBelow: number } | { selfHpAbove: number }
  | { targetHpBelow: number } | { targetHpAbove: number }
  | { order: "first" | "last" }                    // 先出手/后出手
  | { targetHas: string }                          // kind 前缀匹配（"status:burn"、"control:"）
  | { selfHas: string }
  | { statAtLeast: { stat: StatKey; stage: number } }
  | { turnParity: "odd" | "even" }
  | { and: Condition[] } | { or: Condition[] } | { not: Condition };
```

解析器把"先出手的话威力为2倍" → `{op:"damage", power:60, scaleIf:{order:"first", by:2}}`——条件放大归 damage 参数而非独立 op（威力放大不是独立行为，是伤害的属性）。

## 2. op 词汇表（按批扩充；每个 op = 一个处理器文件）

**架构改动**：`applyEffect` 的 9 分支 switch 拆成 `packages/battle-core/src/ops/<op>.ts` 一 op 一文件 + `OPS` 注册表；信封评估（`if`/`chance`/`target` 解析）由分派层统一做。**契约单文件原则不变**——ops 仍是核心语义，新增 op = schema 字段 + handler 文件 + ruleset allowlist + 测试，不走机制插件。

### 实施状态（E0–E2 已落地；相对规划的映射见下）

- **E0 ✅** `ops/` 一 op 一文件 + `OPS` 注册表；`ops/shared.ts`（checkpoint/effStat/resolveHit）、`ops/types.ts`、`ops/cond.ts`（条件谓词）、`ops/effects.ts`（效果定义表）。goldens/158 测试零漂移。
- **E1 ✅**
  - `move.accuracy: number | "always"`（ruleset feature `"accuracy"` 门控；未声明→恒中不耗 draw）；`missed` 公开事件；`acc` 为第 6 维 stage（sixstat 贡献，正级 ×(1+0.5n)、负级查表）。
  - 信封 `chance`（未过→整 op 跳过，draw 记 rng.draws）；`if`（Condition，见 E2）。
  - 异常状态走 `ops/effects.ts` 的 `EFFECT_DEFS` flag 表（`ailment/dot/hot/blockChance/accMul/atkMul/prioAdd/immuneStatus/mustMiss`），kind 直用 name（非 `status:` 前缀——现状已用裸名，不改）。
  - `damage.flatBonus`（额外固伤并入同一伤害实例，不单发事件）；`damage.drain`（按实伤分数回自身，KO 后照常结算）；`clear_stages.sign:"up"|"down"`（消强化/解下降）；`cleanse.scope:"control"|"timed"`（消除回合类效果）；`apply_stat_stage` 多属性 = 解析器展开成多 op（原子性在 op 层）。
  - `apply_status/apply_effect` 的 `turns` 可省 → 永续效果；`params`（整数表）携带 timed 幅值。
- **E2 ✅**
  - `if` 条件谓词：`selfHpBelow/selfHpAbove/targetHpBelow/targetHpAbove`（分数比较）、`order:"first"|"last"`（行动序，续跑经 `suspension.firstSide`）、`targetHas/selfHas`（kind 前缀）、`targetStatused/selfStatused`（`ailment` flag）、`targetStageUp/selfStageDown`、`statAtLeast`、`and/or/not`。
  - `damage.scaleIf:{when,by}`（条件放大威力——六维公式内生效）；`damage.hits:{min,max}`（连击，逐击伤害事件+checkpoint，`hit`/`hits` 字段公开；KO 停连击）。
  - timed 框架并入 `EFFECT_DEFS`：`hot`/`dot_field`（params 幅值）、`prio_up`（ORDER 段加先制）、`immune_status`（apply_* 落点免疫）、`must_miss*`（RESOLVE_HIT 判 miss）；DoT/HoT 走 TURN_END 通用 tick（`effectTickAmount`），KO 可重新挂起。
- **E3 ✅（解析管线批次）** `pp_delta`/`force_switch`/`protect`/`counter`/`bind`/`copy_stages`/`invert_stages`/`transfer_stages(push,mul)` 已落地；管线 `tools/effects-parse.mjs` 跑出全库覆盖率报告 `content/claims/_effects-coverage.json`。本批新增机制：`powerPerUse/powerMulPerUse/flatPerUse/dmgPerUsePct/useCap`（叠用，moveStacks 计数、换招清零、首击不加）、`hits:{perUse,cap}`（叠用连击）、`hitsCap` 尾巴、`prio_count`（次数制先制，行动声明消耗）、`prioIf`（条件先制）、`dmg_to_heal.count`、`dmg_boost.count`、`dmg_taken_down.count`（次数制窗口）、`dodge`、`dmg_reduce`、`dmg_cap/dmg_floor/dmg_immune_above`、`dmg_weaken`、`flatSelfPct/flatSelfCurPct/flatSelfFrac/flatFoeFrac/flatPerMissing/flatPerStage/flatPerHpPct/flatRange/flatRangeIf/flatIfBelow.selfPct/flatOnHit/ailmentOnHit`、`pierceShield`、`cleanse.scope:"shield"`、`max_hp_down`（限疗上限，hpCapOf）、`heal.missing`（受损基线）、`heal_block`、`move_null`（cat 次数封印）、`status_lock`、`down_lock`、`ignore_self_down`、`no_stage_up`、`pp_double`、`drain_dot`、`stage_tick`、`stageTick 随机维`、`immune_status.count`、数字编码维（1-6→六维序，UNVERIFIED）。
- **E4 ✅（主体）** 反应式触发器链已落地：`kind:"react"` 效果条目 + `params{trigger,cat?,min?,max?,count?}` + `payload`（内嵌 CompiledEffect[]）。trigger 编码：1=持有者受击受伤（cat 门控物理/特殊、min 承伤阈值）、2=对手MISS、3=对手声明行动（cat 门控）、4=持有者护盾被击穿、5=持有者倒下、6=自身MISS、7=自身强化被消除、8=回合未受击、9=对手换入、10=持有者打出致命、11=自身行动（cat 门控）、12=自身攻击命中、13=自身回合类效果被消除。派发走 `fireReactive`（ops/index.ts），payload 经正常 `applyOp` 结算（if/chance/rng 记账保留）；同 trigger+守卫的条目合并 payload，不同守卫不合并。`技能无效时X` → `nullifyOnly` 效果（封印/招式失效路径单独结算，主路径跳过）。其余新增：`leaveHp`、`selfHpBelowAbs/selfHpAboveAbs`、`foeEcho/selfEcho` 分数反噬、`drainEcho`、`dmg_to_heal` 永续、`heal_cut pct:100` 禁疗、`dmg_boost.count` 次数增伤、`cleanse.effect` 列表、`stage_tick` 对手向、`必定暴击`=`crit_always`。**留档**：消耗护盾值转换语义、bench/next-unit（下只出场精灵）、`惩罚`族系数（UNVERIFIED）、`致命+N` 转化率、组队目标、`n` 变量引用、复合条件长尾、形态复制。
- **E5 ✅（覆盖率清扫批 a–j，91.2%）** 每批 = 真实语料取样 → parser 规则（优先复用既有 op/flag）→ loader/schema 同步 → 回归测试。新增机制：`hitIf`（条件命中）、`matchSelfHp`（体力对齐）、`hitsPerPpGap`（PP 缺口连击）、`kindIfImmune:"true"`（固伤免转真伤）、`stat:"crt"` 段位（只记录不消费——转化率未文档化）、`prevDamageOdd/Even`、`prevEffWeak`/`effWeakVsFoe`/`foeCountersUs`、`prevTakenZero`+`prevTaken` 快照（上回合承伤谓词）、`flatFoeFracIf`（条件百分比固伤）、`flatPerMissing.pct`、`ailment_tick`（回合末随机异常池）、`cleanse_lock`（无法解除封锁）、`foe_dot` 的 `anyAilDegrade` 门控、`chanceSet/chanceSetIf`（概率改写）、`pp_delta.zeroRandom`、`max_hp_down` payload 变体、`immune_degrade` 变体、`move_null` 变体、`swap_hp`/`crit_immune`/`dmg_to_heal`/`consumeShield` 语形扩展、`stageChanceMulDown`（弱化翻倍）、`selfHp`（自杀）、healEcho 等量百分比、`turnsRange`（N~M 回合随机持续）、`hit_fx_null`（命中效果封印）、`cleanse.echoPct`（护盾反噬）、`fracRange`、`critPerUsePct`、`drain_dot` 当前体力基线、`trigger 10/11/12/13`、`drainTo:"foe"`、`flatFoeDefSumPct`、`dmgFlat.defSumPct`、`flatHpDiffPct`、`flatPerRemoved`/`flatPerAlive`、`dynDealt`（n=本回合伤害）、`pp_free`、`move_null.powerBelow`、`lastDamageKind`、`cleanse_self_ail_tick`、`powerDropPerHit`、`dmg_to_shield`、`dmg_reduce.count`、`cleanse_up_tick`、`steal_rand_tick`、`dmg_boost.perStage`、`dot_dealt`、`match_hp`、`noStack`、`onEnterTarget`、`prioMin/prioMax`、`flatSelfStatPct`、`flatSelfShieldPct`。结构性修复：`,`/`、` 枚举切碎孤儿（statTail 别名）、`则` 句中前缀剥离后 TURNS_PRE 重扫、`若X则Y` flag-only 路径 cond 丢失、regex 捕获组跨 alternation 错位。

| 批 | 新 op（参数） | 覆盖的代表模式 |
|---|---|---|
| **E1** | `accuracy` 字段 + RESOLVE_HIT（base×accMul 判定，`missed` 事件）；`always_hit`；`apply_status` 扩全异常表；`fixed_damage`（额外#点固伤）；`drain`（伤害按比回血）；`stage_multi`（一次多属性±，解析"防御、特防-1"）；`dispel`（消除强化/回合类/能力）；`absorb_stages`（吸取强化=现有 transfer_stages）；`acc` stage 维度 | 必中、先制+N、命中后N%异常、解除/消除、N%改变等级、免疫N回合 → ~60% |
| **E2** | `power_scale` 条件放大（并入 damage.scaleIf）；`multi_hit`（#~#次攻击）；`timed` 框架（`apply_effect` 产 `{kind:"timed:*", remainingTurns, params}`，turnEnd 解释器分发：`dot`、`hot`、`prio_buff`、`crit_window`、`immune_window`、`reflect_window`、`dmg_amp`） | 下N回合先制+N、N回合免疫/反弹、连击、威力条件加倍 → ~75% |
| **E3** | `pp_delta`（PP-N）；`force_switch`；`protect`（完全抵挡）；`counter`（反伤倍率）；`bind`（束缚 DoT+禁换）；`stat_copy`/`mirror`；叠用族（per-use 威力/固伤/先制/连击+cap）；次数制窗口（prio_count/dmg_to_heal.count/dmg_boost.count/dmg_taken_down.count）；护盾生命周期（shield/pierceShield/cleanse:shield）；限疗 max_hp_down；禁疗 heal_block；move_null 封印；drain_dot；扁平固伤谱系（flatSelfPct/flatSelfCurPct/flatSelfFrac/flatFoeFrac/flatPerMissing/flatPerStage/flatPerHpPct/flatRangeIf/flatIfBelow） | 实测全库 53798 招：**79.7% 子句覆盖**（91314/114579，fully 37600），反应式/魂印/下场精灵/护盾消耗链显式留档 |
| **E4** | `react` 触发器链（受击/对手MISS/对手行动/破盾/倒下/自身MISS + cat/min/count 守卫）；`nullifyOnly`；`leaveHp`；echo 谱系（foeEcho/selfEcho/drainEcho）；`cleanse.effect[]` | 实测 **81.9% 子句覆盖**（93856/114579，fully 38902），护盾消耗/bench/惩罚系数留档 |
| **E5a–j** | 见上「E5 ✅」清单（60+ 机制/字段，全部走既有 op 信封） | 实测 **91.2% 子句覆盖**（104512/114579，fully 46014/53798，partial 5363）；tests/battle-core 236 全绿 |
| **T7 门禁批** | `tools/effects-compile-check.ts` 全语料编译门禁（schema+ops+EFFECT_DEFS 三层）；sanity sweep 拦截畸形 IR；schema 修正（damage 的 power 条件必填、turns≤99、hits≤300、percentBase+max、direction+upToDown、flatPerStage.stats、effects.minItems 移除、新增 deltaMulChance/critChanceFrac/stageOnHit/drainFlat/flatSelfDefSumPct/flatFoeDefPct/flatPerRemoved）；parser 修正（capture-group 错位×4、`drain:{n,d}`错键、stealUpgrade 重复 op、cleanse_self_ail 正名）；`random`/`no_switch` 入 EFFECT_DEFS；`transfer_stages.mul` Frac 化 + steal 分支消费 | **53697 招 0 失败**（emptyMoves 1158：flags-only 104 + 留档残留 1054）；T9 ratchet + T1 golden(350) 就位；90.9% 子句覆盖（fully 45739） |
| **T4 矩阵批** | react trigger 1–13 全矩阵测试（13 新用例）；**修 plumbing bug**：`reactWrap` 的 `chance` 从 apply_status op 信封（挂窗判定一次）迁入 `params.chance`（`fireReactive` 每次触发判定——「受到攻击时N%几率X」的正确语义），`e.chance ?? p.chance` 双读兼容 | 91 用例全绿；T4 测试中发现 `entry_dispel` 魂印换入时清除留守方回合类效果（含 react 窗口）属正确语义 |

**status 表层（已实现，略有修订）**：unit.effects 的 `kind` 直用效果名 + `ops/effects.ts` 的 `EFFECT_DEFS` 数据表声明 flag——引擎按 flag 解释，新增效果 = 数据行不是代码分支。覆盖异常状态（烧伤/冻伤/中毒 dot 1/8、麻痹 25% 阻断、害怕/睡眠 100% 阻断、失明/失神 命中减半）与 timed 窗口（hot/dot_field/prio_up/immune_status/must_miss*），timed 幅值经效果条目 `params` 携带。数值 UNVERIFIED。

**先制**：`先制+N` 子句折叠进 move 静态 `priority`；"下N回合先制+M" = `timed:prio_buff`。

## 2.5 命中率模型（已调研，多源一致：4399 官方调整公告 + biligame 对战机制 + PVE 百科）

**每技能独立基础命中率**，不设全局面板值：

- 常规档位 `100/95/90/85/60/50/40/30`；**攻击招大多为 95%**，技能石类 100%，控场招 40–60%。
- 著名个例：极度冰点 30%、千华觅月歌 0%、灵魂干涉 70%。
- 现代属性攻击 ≈ 必中；早期例外存在。**仅强化自身的属性攻击必中**；对敌属性招 MISS 时公示 `miss` 字样。
- `"必中"` 效果文本 = 跳过命中判定（语料中 10,697 条技能命中此 pattern，占 17%）。
- 回合类效果可授予"必定 miss"窗口（语料 580 条含 MISS 语义，现代技能有"若攻击 MISS 则…"条件链）→ miss 必须是一等公开事件。

**命中等级**：是第 6 项能力等级（攻/防/特攻/特防/速度/命中），**没有独立"闪避"等级**——闪避通过"令对方命中 −N"或 timed miss 窗口实现。

- 正级乘 `(1+0.5n)`：+1→1.5 … +6→4.0；负级固定表 `-1:0.85, -2:0.70, -3:0.55, -4:0.45, -5:0.35, -6:0.25`（命中弱化经官方削弱，与其他五维的 `2/(2+n)` 不同）。
- `finalAcc = clamp(base × accMul[stage] × turnEffectMul, 0, 100)`；>100% 按必中处理。
- 局外加成（目镜 +3%/+4%、祝福腰带 5%、精准特性、套装）属装备/特性层，不进招式包——留档。

**数据源决策**：不抓 4399/wiki 逐招命中率——编译期按默认规则落 `move.accuracy`（全部标 `UNVERIFIED`，不做逐招取证）：

1. `"必中"` 文本 → `accuracy:"always"`（无条件命中，不吃命中等级/回合修正；语料直出 10,697 条）。
2. 属性攻击（`kind` 解析为 status 类、无 damage op）→ 默认 100。
3. 其余攻击招 → 默认 95。
4. 人工 override 表 `content/seer-4399-2026-09/accuracy-overrides.json`：著名低命中招逐条登记（如 极度冰点 30、千华觅月歌 0、灵魂干涉 70），带出处注释；表不存在 = 全默认。
5. 引擎留 `accuracy` 逐招字段——将来若有更准数据源，只改编译产物不改机制。

**现有引擎兼容点**：五维 stage 公式 `(2+n)/2`、`2/(2+|n|)` 与原作一致✓；新增 `acc` stage 维度走 `stageKeys` 机制钩子（不硬编三维）；RESOLVE_HIT 判定段在效果循环前；MISS → 公开 `missed` 事件。

## 3. kind 字段与双属性

`kind` 编码了 类型+攻击类别（"火系物攻"/"光飞行特攻"/"属性攻击"），解析器产出 `category: physical|special|status` + `types: string[]`。

- 双属性**守方**：typechart-4399 表已有手工标定行（不用乘积推断）。
- 双属性**攻击方招式**：表格未覆盖——按"主属性=第一个词素"落地并在 claim 记 `UNVERIFIED` 待验证项，不臆造乘积规则。

`power:null`（23594 条，基本是属性攻击）→ 纯效果招，无 damage op。

## 4. 管线

```
content/creatures/creatures.json
  → tools/effects/parse.ts      子句切分 → 模式表 → ops[] | unparsed
  → tools/effects/coverage.ts   模式×覆盖率报告（驱动下批实现顺序）
  → tools/effects/compile.ts    skills → moves.json（id=mv-<petNo>-<i>，中文名留 name 字段）
  → content/seer-4399-2026-09/  新 pack + ruleset（operatorAllowlist/damageKinds/features 按批开启）
```

- **逐批可回退**：每批一个 generation/ruleset 特征位，运行中局不换语义（现架构天然保证）。
- **魂印留档**：效果文本命中 `魂印|印记|印记层|专属特性` 的技能 + 全部 `soulMark` 字段 → `content/claims/_soulmark-deferred.json`（当前仅 ~11 技能明文提及魂印；印记类机制如"处决印记"一并留档）。做魂印时统一处理。
- **跳过**：组队多目标（"组队时可以影响3个目标"）、`level`/`recommended`/`obtainUrl` 等元数据不进战斗包。

## 5. 契约与投影面

- `moves.schema.json` per-op allOf 逐批扩字段；`contracts:gen` 同步生成。
- 新事件类型最少化：`missed`、`status-tick`（DoT 扣血仍走 `damage`+`cause`）、`effect-missed`（chance 未过）。白名单只放行公开字段。
- stageKeys：命中（`acc`）作为第 6 个 stage 维度（倍率表独立：+n=1+0.5n，−n 查表）；**不设 eva 维度**——闪避由"令对手命中−N"与 timed miss 窗口表达。`stageKeys` 机制钩子已支持注入，不硬编进核心三维。
- `describeEffect`/徽标：新 op 的展示文案由参数模板生成（`power/chance/turns` 插值），不再逐 op 手写中文句——静态字典只兜底未知 op。

## 6. 批次验收

- E0（骨架）：现有 9 op 搬进 `ops/` 不改语义；goldens/155 测试零漂移为门槛。
- E1–E4：每批产出①覆盖率报告增量 ②该批 op 的单测（含条件/概率路径，rng draw 可审计）③一把真实精灵的 golden 对局 ④`unparsed` 清单更新。
- 全量门槛：`content:validate`、`contracts:check`、`check:boundaries`、确定性 property（同 seed 双跑字节一致）、replay-verify。

## 7. 明确不宣称

- 中文效果文本解析是**模式匹配归一化**，不等于原作逐字规则核验；boss 战特化文本（"boss无效"）保留标注不执行。
- 双属性攻击方克制、异常状态精确数值（麻痹概率、DoT 分数）按 4399 表/惯例落地，逐项记 `UNVERIFIED`；命中率机制按调研模型实现，**逐招命中值用默认规则+人工 override**，不做逐招取证。
- 魂印、专属印记、精灵间联动效果在留档批次前不进入可玩池。
