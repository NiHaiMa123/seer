# synthetic-v1 工程规则 v1.0.0（冻结）

这是自制工程规范（fixture），**不声称对应任何赛尔号原作版本**。所有数值为工程选择，单位/动作命名不借用原作名称；原作规则走 `content/claims/` 的 claim register 单独求证，见 [data-and-content](../data-and-content.md)。

对应数据包：`content/synthetic-v1/`（`pack.json` + `units.json` + `moves.json`）；规则工件：`content/rulesets/synthetic-v1.json`。内容由 `pnpm content:validate` 校验。

## 1. 范围

- 1v1、单方出战位、无后备、无切换、无复活、无 BOSS overlay（M2 引入）。
- 2 个单位，各 4 个动作：普通攻击 / 先制低伤 / 强化 / 回复。
- RNG 仅用于 ORDER 阶段平速判定；伤害无随机浮动、无命中/闪避/暴击。
- 本文件中的阶段名引用 [battle-engine](../battle-engine.md) 的阶段表；v1 未使用的阶段仍为空操作。

## 2. 单位

| unitId | hp | atk | def | spd |
|---|---|---|---|---|
| syn-alpha | 120 | 40 | 30 | 50 |
| syn-beta | 140 | 35 | 35 | 40 |

字段均为有界正整数。战斗中每个单位另有：`stages = {atk, def, spd}` 初始 0，范围 [-6, +6]；`pp[moveId]` 初始为该动作上限。

## 3. 动作

两个单位共用同一动作池（`moveIds` 相同）：

| moveId | 类别 | pp | priority | effect |
|---|---|---|---|---|
| syn-strike | 普通攻击 | 35 | 0 | `damage(power=40)` |
| syn-jab | 先制低伤 | 30 | +1 | `damage(power=20)` |
| syn-bolster | 强化 | 20 | 0 | `apply_stat_stage(stat=atk, delta=+1, target=self)` |
| syn-recover | 回复 | 10 | 0 | `heal(numerator=1, denominator=2, target=self)` |

## 4. 公式与舍入

只允许整数运算；每个公式给出乘除顺序与 floor 时点；中间值不得超过 JS safe integer。

- **能力值**：`eff = floor(base × num / den)`。stat stage `s ∈ [-6,6]`：`s ≥ 0` 时 `(num, den) = (2+s, 2)`；`s < 0` 时 `(num, den) = (2, 2−s)`。`s = 0` → `eff = base`。
- **伤害**（`damage` op）：`dmg = max(1, floor(power × atkEff / (2 × defEff)))`。atkEff/defEff 为含 stage 的有效值。无属性克制、无波动、无暴击。
- **回复**（`heal` op）：`amount = floor(maxHP × numerator / denominator)`，加到 current HP 后以 maxHP 封顶。
- **强化**（`apply_stat_stage` op）：`stage' = clamp(stage + delta, -6, +6)`；结果与现值相同视为失败（见 §7）。
- **struggle**（规则内置，非内容数据）：`dmg = floor(userMaxHP / 4)`，无视 atk/def 与 stage；命中后自身承受 `recoil = floor(userMaxHP / 8)`。不消耗 PP。

参考数值（手算，供 golden 交叉检查）：syn-alpha 的 syn-strike 对 syn-beta（无 stage）：`floor(40×40/(2×35)) = 22`。syn-beta 的 syn-strike 对 syn-alpha：`floor(40×35/(2×30)) = 23`。syn-jab 对 syn-beta：`floor(20×40/70) = 11`。

## 5. 阶段序列（v1 子集）

`INIT → COLLECT → ORDER → BEFORE_ACTION → RESOLVE_HIT → CHECKPOINT → AFTER_ACTION → TURN_END → NEXT`

- **INIT**：放置双方单位，HP= max，PP=上限，stages=0，turn=0；随后开第一个 decision。
- **COLLECT**：收集双方意图；任一方超时由 Host 产生 Timeout 输入（超时方按 §9 默认策略）。收齐后冻结进入 ORDER。
- **ORDER**：双方各产生一个有序行动项。排序键：`priority` 降序 → `effSpd` 降序 → 平速判定（见 §6）。先制动作 tie 仍按 effSpd/平速比较。
- **BEFORE_ACTION**：逐项检查行动仍可执行：单位 KO 则跳过该项；动作不合法则视为失败并消耗 PP（见 §7）。合法动作扣 1 点对应 PP，然后进入 RESOLVE_HIT。
- **RESOLVE_HIT**：按 effect 顺序应用 op。每个改变 HP 的 op 完成后进入 CHECKPOINT。
- **CHECKPOINT**：HP ≤ 0 的单位标记 KO；随后按 §8 判定终局。终局成立则当前行动与后续行动不再执行。
- **AFTER_ACTION / TURN_END**：v1 无效果，空操作。
- **NEXT**：若有任一方无存活单位或 turn ≥ 200 → END；否则 turn+1，回 COLLECT 开新 decision。

## 6. 平速判定

effSpd 相等时，对该平速组取一次 RNG draw `u ∈ [0, 2^32)`：`u < 2^31` 则 unitId 字典序小者先动，否则大者先动。v1 每局至多一次平速判定；draw 计入 RNG 状态，replay 可复现。平速不区分 side，unitId 形如 `p1.unit` / `p2.unit`。

## 7. 失败与 PP 消耗

- 合法动作一经 BEFORE_ACTION 扣 PP 即消耗，不因后续失败退还。
- `apply_stat_stage` 结果与现值相同（已在 ±6 边界）→ 动作失败，产出 failed 事件，PP 已扣。
- `heal` 时 HP 已满 → 动作失败，产出 failed 事件，PP 已扣。
- 目标已 KO 的行动项在 BEFORE_ACTION 被跳过，**不消耗 PP**（行动项单位死亡才有此情形；v1 目标恒为对方出战单位）。
- `damage` / `struggle` 在 v1 不会失败。

## 8. KO 与终局

- CHECKPOINT 发现 HP ≤ 0 → KO。
- v1 单方只有一个单位：任一方 KO → 对方获胜，对局结束（`result: win/loss`）。
- struggle 的 recoil 是独立 HP 变更：先结算对目标的伤害并 CHECKPOINT（目标 KO 则 recoil 不再执行），目标存活才结算 recoil；recoil 致使用者 KO → 对方获胜。v1 不存在同回合双 KO 路径。
- `turn > 200` 仍未分胜负 → `result: draw, reason: turn_limit`。

## 9. 合法动作与默认策略

- 合法动作集 = 该单位 `pp > 0` 的动作 ∪ `{concede}`；全部 PP 为 0 时 = `{struggle, concede}`。
- `concede` 始终合法，立即判负。
- Timeout/缺省输入使用确定默认策略：取合法动作列表中字典序最小的 actionId（v1 即"还剩 PP 的第一个动作"，否则 `struggle`）。不随机挑选。

## 10. 封闭 IR（v1 operator 全集）

| op | 参数 | 语义 | 失败条件 |
|---|---|---|---|
| `damage` | `power: int ≥ 1` | §4 伤害公式，目标恒为对方 | 无 |
| `apply_stat_stage` | `stat ∈ {atk,def,spd}`、`delta: int ≠ 0`、`target = self` | §4 clamp | 结果不变 |
| `heal` | `numerator: int > 0`、`denominator: int > 0`、`target = self` | §4 回复 | HP 已满 |

未列入上表的 op 一律 `UNSUPPORTED_OPERATOR`，编译/校验拒绝，不静默忽略。目标选择器 v1 固定：伤害→对方、其余→self；扩展选择器属于契约升级。

## 11. 显式排除（M2+ 处理）

切换/后备/复活、命中/闪避/暴击、多段攻击、控制与免疫、吸强/消强、持续伤害、退场效果、伤害分类穿透、BOSS/mode overlay、任何原作机制。这些语义需要新 operator/phase/状态字段时，按 [plugin-system §6](../plugin-system.md) 升级契约，不在 v1 打补丁。

## 12. 版本与冻结

`rulesetId = synthetic-v1`、`rulesetVersion = 1.0.0`、IR version = 1。修改本文件任何数值/顺序/公式即新版本号；旧 replay 按旧版本工件回放（[ADR-005](../adr/005-versions-and-migrations.md)）。
