# 战斗引擎 v0.2：确定性、原子结算与规则证据

状态：设计。以下顺序为 `synthetic-v1` 工程规范，**不是已经验证的赛尔号原作顺序**。现代原作另建 `seer-<snapshot>`，各阶段/公式通过证据才能启用；未知规则不进入该 ruleset 的可玩池。

## 1. 单一纯状态转移

`transition(state, resolvedInput, frozenRules) -> Result<{state, events}, EngineFault>`。

State 含规则引用、双方单位、PP、状态、decision、RNG 状态与事件计数。resolvedInput 是 Authority 收齐并认证后的联合意图/强制替换/Timeout 决定。函数不读系统时钟、网络、DB、DOM；相同版本工件、状态、输入和 RNG 得到相同输出。Simulator 复用此函数，在自建假设世界运行。

状态只由 reducer 修改；handler 返回 EffectOp，不能持有 Authority 可变对象。外层冻结/拷贝防误写，可信代码审查及 import lint 防意外 IO；不声称这能隔离恶意脚本。

## 2. 决策窗口与选招收集

- 一个 `decisionId` 绑定 `baseRevision`、参与 sides、允许行动和模式。双方同时决策时基准相同。
- Host 私有 inbox 收一方行动时不递增 BattleState.revision，不更新对方 Observation/cursor。选招不能泄露对手已选什么。
- 身份由会话确定，不能信任 payload.actorId；命令只使用 server-issued actionId。首次合法提交锁定；相同 idempotencyKey/内容重试返回同 receipt，异内容冲突；另一 key 重选返回 ALREADY_SUBMITTED。
- 收齐或 deadline 触发后，Authority 产生有序 joint input；记录 Timeout 与默认策略版本。无合法战斗动作时由规则暴露 `struggle`；强制替换/终局是独立 decision，不用空列表时随便选招。
- 选招合法性只用己方已知条件；对手隐藏免疫不应让“可选攻击”消失。执行中再判断动作失败/无效及 PP 消耗，避免合法性工具成为秘密 oracle。

## 3. 工程阶段表

| 阶段 | synthetic-v1 的决定 | 未来原作需证据的内容 |
|---|---|---|
| INIT / ENTRY | 初始化，执行明确登场效果，再开 decision | 开场效果、魂印/装备顺序 |
| COLLECT | 收集双方意图；状态冻结 | 是否同步选招及模式差异 |
| ORDER | 切换动作组、动作先制、速度；同值用指定 RNG 判定一次 | 先制/速度修正取值时点、平速处理 |
| BEFORE_ACTION | 检查仍可行动、控制/封锁、目标合法；按表扣 PP | 失败退还/消耗、封属等时点 |
| RESOLVE_HIT | 命中、替代/取消、伤害分类、减免、扣 HP | 各伤害类别与穿透顺序 |
| CHECKPOINT | 每次 HP 改变后检查 KO、复活、替换/终局 | 多段攻击中断、同归于尽、复活优先级 |
| AFTER_ACTION | 后置效果，继续 checkpoint；再执行仍有效的下一行动 | 击败触发、吸强、追加攻击 |
| TURN_END | 按规则槽持续伤害/回复/到期，逐项 checkpoint | 持续回合计数、离场/死亡保留 |
| NEXT | 开新 decision 或结束 | BOSS 模式覆盖 |

M1 只启用无切换/复活的子集；M2 引入后备和 interrupt continuation。强制换人暂停在 checkpoint，保存 continuation，再开 `replacement` decision；替补不能继承已失效的原行动。不是把所有 KO 都延迟到回合尾。

同阶段排序必须由版本化 RuleTable 定义：phase/group、业务优先级、规则指定 tie-break、稳定 effectInstanceId。字典序只用于规范明确无先后差别的最后排序；不能拿 ID 排序替代未核实原作语义。禁止依赖插件注册顺序或 Cordis emit 顺序。

## 4. Effect DSL 与 handler

编译时校验有限的 trigger、condition AST、EffectOp、目标选择器、duration/stackPolicy 与模式；禁 eval/任意 JS 表达式。先只实现当前 fixtures 所需 operator，遇到未知 operator 编译失败，不能忽略。

| 语义 | 表达办法 | 原子/冲突约束 |
|---|---|---|
| 普通/固定/百分比/特殊伤害 | 带 DamageKind 的 DamageIntent，经阶段 pipeline 变成 ApplyDamage | 免疫/减免/穿透分槽，不能只设一个 priority |
| 强化、消强 | StatStageOp + clamp | 上限、零值、免疫由 ruleset 指定 |
| 吸強 | TransferStages，先计算可转移集合，再同时减源增目标 | 不拆成可能被中途触发打断的两次任意赋值 |
| 反弹/替代/取消 | intent rewrite，带 effectInstanceId 和 replacement history | 每个替代对同一 intent 最多应用一次（工程规则） |
| 切换/复活 | RequestSwitch/Revive 操作进入 checkpoint | 清理离场状态、次数消费与恢复值在同一事务 |
| BOSS 例外 | mode overlay + 明确 hook | 不在任意 handler 写 `if petName` 补丁 |

大而稀有的机制可用可信 typed handler，输入只读 context，输出受控 EffectOp；复用已有 ABI 不需改 reducer。若新机制需要新的状态字段/phase/EffectOp，必须升级 core/IR 契约，见插件扩展反例。

Mechanic metadata 的 requires/produces/consumes 等可由有限 AST 提取；任意 handler 需显式提供元数据并测试其一致性。`counters` 是条件化推论，不是引擎真理。模型不能自行补可执行语义。

## 5. RNG、数值与 canonical hash

M0 冻结 `rngAlgorithmId`、seed 编码、测试向量、抽样方法与 draw 顺序。synthetic/local 的候选为显式 uint32 运算的 xoshiro128**，非密码学 RNG；已查作者参考实现，JS 实现/seed 映射/向量仍需 M0 核验，禁止全零状态。Host 用系统熵生成 seed，真实 state/seed 不出网；模拟用独立 seed。**隐藏 seed 不足以证明未来随机数不可预测**：正式 PVP 前必须采用可重放的密码学随机流（候选 ChaCha20，RFC 8439 向量），单局独立密钥/nonce、明确 counter 上限，记录到私有回放；审核实现和泄露面，不自行发明密码算法。[来源 S15/S16](sources.md)。只记录命名用途及实际 draw，拒绝采样用于整数区间，防取模偏差。

HP/PP/速度/计数用有界整数，比例用整数分子分母/基点；每个公式规定乘除顺序和 floor 时点，中间值不得超过 JS safe integer。若确需大整数，内部 BigInt、wire 十进制字符串并升 schema；禁 NaN/Infinity/-0 和浮点容差作为“重放一致”。

canonical 编码规则：只允许 JSON 值；对象键按 ASCII 顺序排序（键与 IDs 限 ASCII，禁 localeCompare；文本值编码前规范 NFC，拒绝未配对代理项）；数组保留语义顺序；无 undefined；整数十进制；UTF-8；hash 为 SHA-256。时间戳/遥测不进入 canonical state。状态、内部事件与公共观察分别 hash；**内部 hash 也不发给 Agent**，防字典推断秘密。M0 将编码器测试向量固定，不能依赖未经规范的 JSON.stringify 对象插入顺序。

## 6. 有界触发与故障

队列迭代处理，记录 causeId、depth、effectInstance、trigger occurrence；禁止递归调用栈无限生长。synthetic-v1 初始限制：单 transition 最多 4096 effect applications、最大因果深度 64、单事件最大 64 KiB；预算写入 ruleset 并 hash。重复效果不等于循环，不能只按相同 effectId 粗暴去重。

超限/未知操作/不变量破坏返回 EngineFault；**整次 transition 不提交**，原 state/RNG 保留。Authority 持久化 fault 后进入 suspended/error，输出无秘密的故障码；不裁定正常胜负、不发奖。生产规则包上线前必须消除该故障，不能截断队列后当作成功。wall-clock 超时只由 Host/Worker watchdog 处理，属于基础设施故障，不进入规则胜负。

## 7. 回放与验收

私有 ReplayBundle = engine/executable/IR/content/ruleset hashes + 初始状态 + 已提交 resolved inputs + seed/state + 内部事件/hash + checkpoints。重放重新执行规则并比对每步 hash；只播放 RenderEvent 不算规则回放。玩家回放另做视角投影，不能把私有 bundle 公开。

M1 核验：合法/过期/重复/双提交，PP 耗尽与 struggle，先制/平速，控制失效动作，KO 打断，数值边界，同 seed、shuffle content load、两进程重放一致。M2 加强化/吸强/控制反制、所有伤害类别、替代链、切换/复活、同时 KO、上限失败原子性、模式例外与旧版本回放。

Golden 的 expected 来自独立工程规范或原作观测，由 fixture 作者先写，不由当前 reducer 输出自动“批准”。属性测试补不变量：HP/PP 范围、无重复奖励、终局不再接受行动、同输入一致。pending 原作用例不计入通过率。具体数量/命令见 [roadmap](roadmap.md)。
