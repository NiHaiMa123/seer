# 战斗机制审计 — 2026-10-03

确认 10 项问题：均有可执行复现；4 个对照用例通过、10 个预期行为断言失败。没有修改生产实现或既有测试。审计脚本独立放在 artifacts 下，不加入正常测试集合。

本次范围：截图对应的魂印、效果解析、换人、KO 中断、回合末结算，以及 Core → Host 接口。没有据此声称整个项目已经审计完毕；浏览器 UI、联网并发和完整真实技能语料语义尚未穷举。未将截图中明确延后的功能列为缺陷。

## 验证记录

在项目根目录执行：

```powershell
node node_modules/vitest/vitest.mjs run tests/battle-core tests/host
node node_modules/typescript/bin/tsc -p tsconfig.json
node artifacts/bug-audit/reproduce.mjs
```

- 原有测试：27 个文件 / 805 个用例全部通过。
- TypeScript：通过。
- 审计复现：4 个正常路径对照通过，10 个缺陷断言失败。脚本故意以退出码 1 表示仍存在缺陷，详细证据写入 results.json。
- 环境中的 pnpm 启动器与 package.json 固定版本不一致，因此直接调用本地已安装的 Vitest/TypeScript；没有安装或更新依赖。

审计 fixture 通过 compilePack 正式编译：在 synthetic-v2 内存副本中注入最小魂印/招式，并以固定种子驱动 applyTurn / applyReplacement。少量测试设置低血量或已有反应效果来建立前置状态。没有写入内容包。

## 按优先级排列的问题

### 1. [P1] Host 拒绝引擎合法产出的事件

位置：[executor.ts:40](E:/project/seer/packages/host/src/executor.ts:40)、[executor.ts:117](E:/project/seer/packages/host/src/executor.ts:117)。

`EVENT_TYPES` 缺少 `pp-delta`、`missed`、`protected`。新增效果已经会产出这些事件，内部事件 schema 也已包含它们，但 Host 再校验时抛 `executor transition event is malformed`。

复现 `host-rejects-valid-pp-delta-event`：同一包、同一初始状态和行动，直接调用 Core 返回成功并包含 `pp-delta`，调用 `InProcessTransitionExecutor.applyTurn` 则抛异常。普通攻击的 Host 对照通过。真实影响是 PP 修改等合法技能可能无法通过 Host 完成回合。

修复方向：统一内部事件类型来源，并让每种 Core 事件至少经过一次 Host 验证。内部接收与公开投影必须分开校验，不能为了修复而直接公开所有 PP 信息。

### 2. [P1] 受击魂印互相触发时越过预算并栈溢出

位置：[damage.ts:539](E:/project/seer/packages/battle-core/src/ops/damage.ts:539)、[soulmark/index.ts:188](E:/project/seer/packages/battle-core/src/mechanics/soulmark/index.ts:188)。

伤害直接调用 onDamaged，魂印直接调用 applyOp，再进入伤害处理，形成同步递归。外层 actions 的 `applications` 计数覆盖不到魂印链；配置的 `maxCauseDepth: 64` 也没有在链上执行。

复现 `mutual-on-damaged-respects-effect-budget`：双方装配“受击回复 1 点并对对手造成 1 点固定伤害”，使用正常基础血量发动一次攻击。实际抛出 `RangeError: Maximum call stack size exceeded`，没有返回受控的 EngineFault。

修复方向：共用效果队列、应用次数和因果深度预算；所有钩子与嵌套 payload 都计入同一 transition 预算。

### 3. [P1] 行动声明反应击杀攻击者后，阵亡者仍能出招

位置：[ops/index.ts:144](E:/project/seer/packages/battle-core/src/ops/index.ts:144)、[engine.ts:454](E:/project/seer/packages/battle-core/src/engine.ts:454)。

`fireReactive` 用 `void applyOp` 丢弃 checkpoint 的挂起/终局结果，调用方也不在反应执行后检查攻击者是否仍能行动。

复现 `reactive-lethal-damage-suspends-action`：p1 剩 1 HP，有后备；p2 的声明反应造成 10 固伤。事件先记录 p1 HP=0，随后 p1 仍对 p2 造成 10 伤害，最后才进入换人挂起。

修复方向：反应派发返回并传播 CpResult；反应触发 KO 后立即退出当前动作，不让后续 op 继续消费失效行动。

### 4. [P1] 替补常驻被动永远不初始化

位置：[soulmark/index.ts:296](E:/project/seer/packages/battle-core/src/mechanics/soulmark/index.ts:296)、[soulmark-parse.mjs:232](E:/project/seer/tools/soulmark-parse.mjs:232)。

解析器将常驻免疫、减伤等转为 onBattleStart；运行时仅在 `turn === 1` 对当前在场单位触发。开局坐在后备的精灵错过该入口，换入也不会补初始化。

复现 `bench-passive-initialization`：携带 `sm-passive-ward` 的替补第二回合上场，到第四回合仍没有 `dmg_taken_down`。同魂印作为首发的对照正常生效。

修复方向：把常驻被动装配生命周期与“战斗开始时”一次性触发语义区分开；覆盖首发、首次换入与重复换入。

### 5. [P2] 首发精灵漏掉登场魂印

位置：[engine.ts:114](E:/project/seer/packages/battle-core/src/engine.ts:114)、[engine.ts:307](E:/project/seer/packages/battle-core/src/engine.ts:307)。

initBattle 构造状态后直接进入 collect；首回合只跑 onTurnStart。唯一 onEntry 派发入口在 doSwitch，首发从不经过它。

复现 `initial-entry-hook`：魂印“登场时攻击 +1”，首回合结束攻击等级仍为 0，登场事件为 0。同魂印经主动换入的对照得到 +1。

修复方向：明确初始化的 ENTRY 阶段，且登场造成 KO 时同样能进入 replacement，而非仅补一个无中断处理的函数调用。

### 6. [P2] 强制换人绕过登场生命周期

位置：[force-switch.ts:28](E:/project/seer/packages/battle-core/src/ops/force-switch.ts:28)。

force_switch 直接交换 active/bench 并发 switch 事件，没有复用普通换人的 onEntry / nextInFx 等处理。

复现 `forced-switch-entry-hook`：目标已换成 syn-epsilon，但其“登场攻击 +1”没有触发。普通换入对照正常。

修复方向：共用换入结算路径；主动、被迫、阵亡换人的换下触发是否相同可独立配置，但换入效果不能消失。

### 7. [P2] KO 换人后续跑的动作漏掉 onMoveUsed

位置：[engine.ts:1146](E:/project/seer/packages/battle-core/src/engine.ts:1146)、[engine.ts:1180](E:/project/seer/packages/battle-core/src/engine.ts:1180)。

applyReplacement 复制了另一套行动实现，但没有普通 applyTurn 中的 onMoveUsed 派发。

复现 `replacement-resumes-on-move-used`：回合开始魂印击杀对面首发，替换完成后幸存方已提交的攻击继续执行；动作声明、伤害存在，使用技能魂印事件为 0。正常路径的对照会触发。

同一分支还缺少主路径的 hitIf、hitFxNull、叠用计数等步骤；本轮仅将 onMoveUsed 列为动态验证的缺陷，其他差异需在修复时补行为等价测试。

修复方向：抽取同一个动作执行流程，使用 continuation 传入先后手与进度，避免双份逻辑继续漂移。

### 8. [P2] 回合末 KO 后剩余结算被整体跳过

位置：[engine.ts:302](E:/project/seer/packages/battle-core/src/engine.ts:302)、[engine.ts:1187](E:/project/seer/packages/battle-core/src/engine.ts:1187)。

runTurnEnd 可能在中途返回挂起，但保存时直接设置 `teDone: true`；replacement 因此认为整个回合末已经完成。

复现 `turn-end-resumes-remaining-hooks`：持有者第一个回合末条目造成 KO，第二个条目应自身攻击 +1。换入完成后 turn 已推进为 2，但攻击仍为 0。

修复方向：保存回合末 phase/side/effect 的准确游标，恢复尚未执行的条目；简单重跑整个回合末又会重复伤害和扣时长。

### 9. [P2] 首回合濒死回卷不恢复能力等级

位置：[soulmark/index.ts:268](E:/project/seer/packages/battle-core/src/mechanics/soulmark/index.ts:268)、[soulmark/index.ts:451](E:/project/seer/packages/battle-core/src/mechanics/soulmark/index.ts:451)。

初始 `soul.prev.stages` 是空对象，回卷又只遍历快照已有键。首回合新增的能力变化不会被清回初值。

复现 `first-turn-endure-restores-stages`：先使用攻击 +3，再受到致命伤害。日志确实出现 endure 和 endure_rewind，HP 回满 444，攻击仍为 +3，而初始为 0。

修复方向：初始化完整的零等级快照，或者回卷时完整替换全部 stage 维度，包含 acc 等扩展维度。

### 10. [P2] 魂印解析丢弃对手先/后手条件，却计为完整解析

位置：[soulmark-parse.mjs:121](E:/project/seer/tools/soulmark-parse.mjs:121)、[soulmark-parse.mjs:249](E:/project/seer/tools/soulmark-parse.mjs:249)。

两个前缀匹配后都只留下 `actor: foe`，先/后手条件被剥掉，没有转换为 guard。

复现 `parser-foe-order-condition`：

- `对手先出手时恢复自身100点体力`
- `对手后出手时恢复自身100点体力`

两句编成完全相同的 onMoveUsed + heal，无任何 order 条件，且均为 `unparsed: []`。

真实语料也有对应入口：pet-4613「艾克特希」的“对手先出手时当回合自身受到的攻击伤害减少20%”产出的 actor:foe 条目缺少先手条件。原文与解析结果保存在 results.json。

修复方向：保留条件 AST，给成对的相反条件做语义差异断言；无法表达时进入 unparsed，不得计入完整支持。

## 为什么原有全绿没有拦住

1. Core 测试主要直接调用引擎，Host 测试的动作没有产生所有新增事件，因此接口白名单漂移没有被覆盖。
2. 魂印测试多在首发、不中断的路径运行；替补常驻被动、首发 onEntry、强制换入、回合末中断都需要独立案例。
3. 普通回合和 replacement 使用两份行动实现，测试没有约束它们对等价状态产生一致的技能语义。
4. 编译门禁与 schema-sync 证明形状可编译、字段注册一致，不能证明中文条件被保留，也未覆盖 Host 的事件白名单。
5. Golden 可以锁住既有行为，仍需独立语义断言。现有真实魂印 golden 的“至少出现一个魂印事件”无法证明每个应触发的生命周期都发生。
6. 单项效果预算测试不能替代嵌套触发预算；必须覆盖双向反应循环及非递归的大量 payload。

建议先修复 P1 的 Host 接口、反应中断和预算，再统一换人/动作/回合末 continuation；之后将本报告的缺陷断言迁入正式回归测试，并增加首发/替补 × 普通/强制/KO 换人 × 普通/续跑动作的组合覆盖。

