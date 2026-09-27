# synthetic-v2 工程规则规范（M2）

**状态**：自制合成规则集，不声称对应任何原作。版本化 ID `synthetic-v2`，语义版本 `2.0.0`，IR version `1`（feature-gated additive 扩展，不改变 handler ABI）。

v2 在 v1 之上增加机制；**v1 包在 v2 引擎下运行时行为逐字节不变**——所有 v2 特性由 ruleset `features` 显式开启，v1 ruleset 无该字段即全部关闭。v1 全部数值规则（公式、PP、平速、struggle、200 回合上限）沿用不重复定义。

## 1. features 开关

ruleset JSON 新增 `features: string[]`（可省）。v2 合法值：

```text
bench | damage_kinds | control | revive | stat_ops | mode_overlay
```

引擎对未声明特性的 op/状态一律视为未知 → compile 失败或 EngineFault。

## 2. 后备（bench）

- 每方除 active unit 外可有 `bench: UnitDef[]`（0..2）。v1 内容无 bench → 引擎不写 `sides.bench` 字段（保持旧 hash）。
- `act_switch-<i>`（i 为 bench 下标）当 bench[i].hp>0 时合法；占用本侧整回合行动。
- 动作组：switch 属于 **switch 组**，在 ORDER 中先于一切 move（含先制）。同回合双 switch 各自生效。
- 换入单位 stages/effects 为自身值（不继承换下者）。换下单位保留 HP/PP/stages/effects。

## 3. 替代（replacement decision）

- CHECKPOINT 判 KO 且该方 bench 有存活单位 → transition 挂起，开 `kind:"replacement"` decision（仅阵亡方 actor，其余方视为已提交）。
- 该方提交 `act_switch-<i>` → 换入 bench[i]，turn 继续执行**尚未执行的另一方动作**（阵亡者原行动作废，不消耗其 PP——v1 规则已如此）。
- 超时默认：bench 下标最小存活者。
- 双方同 transition 内同时 KO → draw（terminal 立即判定，不开 replacement）。
- 阵亡方 bench 全灭 → 正常 KO 终局。

## 4. 新增 EffectOp（stat_ops / damage_kinds / control / revive / mode_overlay）

### 4.1 `transfer_stages`（吸强，stat_ops）

源=对手，目标=自身。原子两步：可转移集合 = 源当前非零 stages 的各项绝对值；逐项 `target = clamp(target+abs(srcStage))`，`src = 0`。stage 为负时仍转移（吸走弱化）。

### 4.2 `clear_stages`（消强，stat_ops）

目标（`self|opponent`）全部 stages 置 0。失败条件：目标全部 stage 已为 0 → action-failed（PP 照扣）。

### 4.3 `damage` 扩展 kind（damage_kinds）

| kind | 公式 |
|---|---|
| `standard` | v1 公式不变 |
| `fixed` | `dmg = power`（无视 atk/def/stages） |
| `percent` | `dmg = floor(power × target.maxHp / 100)`（无视 stages） |
| `true` | standard 公式但 defEff 按 stage=0 计算 |

v1 的 `damage` 无 `kind` 字段 → standard；v2 事件 detail 只在 kind≠standard 时加 `damageKind`。

### 4.4 `control`（control）

`{op:"control", name:"stun", turns:n, target}`：给目标施加 `control:stun` 效果（`remainingTurns:n`）。被控制方 BEFORE_ACTION 判定动作 → `action-failed`（reason:"controlled"，PP 照扣），**每阻断一次行动 remainingTurns-1**，归零立即移除（发 `effect-faded`）——`turns=n` 阻断恰好 n 次行动（含施加当回合内后到的行动）。控制效果不走 TURN_END 递减。重复施加同名控制：刷新 remainingTurns 为较大者（不叠加）。**含 `cleanse` op 的动作穿透控制**（净化是被控方的反制手段），正常消耗 PP 并执行。

### 4.5 `cleanse`（control）

`{op:"cleanse", target:"self"}`：移除自身全部 `control:*` 效果；无控制时 action-failed。

### 4.6 `apply_status` 扩展（control）

`{op:"apply_status", name:"immune_control", turns:n, target:"self"}`：获得 `immune_control` 效果——免疫 `control` op（含同回合后到的控制）。到期移除。

### 4.7 `revive`（revive）

unit def 增加 `revives: integer ≥0`（默认 0）。CHECKPOINT KO 判定时，若该单位 `revives>0`：消耗 1，`currentHp = floor(maxHp/2)`，原地继续（**不清 stages/effects**），不触发 replacement。revives 随单位换入保留。

### 4.8 `apply_effect`（mode_overlay）

`{op:"apply_effect", name:<string>, turns:n, target}`：给目标挂公开效果 `{kind:"tag:"+name, remainingTurns:n}`——纯计数标签，供 BOSS 标记类机制使用。

## 5. Mode overlay（mode_overlay）

ruleset 新增 `modeOverlays: { <mode>: { immuneControl?:bool, immuneClearStages?:bool } }`。unit def 增加 `mode?: string`。被 overlay 标记的单位：
- `immuneControl` → `control` op 对其施加无效（action-failed reason:"overlay_immune"）
- `immuneClearStages` → `clear_stages`/`transfer_stages` 对其 stage 无效果

不逐 unitId 判断，按 `mode` 字段统一覆盖。

## 6. 事件（v2 新 detail/类型）

新增 detail 白名单字段（v1 事件不变）：
- `switch`（public）：`{side, outUnitId, inUnitId, via:"action"|"replacement"}`
- `control-applied`（public）：`{side, name, turns}`
- `control-faded`（public）：`{side, name}`
- `control-immune`（public）：`{side, name}`
- `stages-transferred`（public）：`{side, stages:{atk,def,spd}}`
- `stages-cleared`（public）：`{side}`
- `revive`（public）：`{side, hpAfter}`
- `damage` 增 `damageKind`（kind≠standard 时）
- `action-failed` reason 增 `"controlled"|"overlay_immune"`

replacement decision 事件 `decision-opened` 复用（内部类型，不入公开流——同 v1）；公开流新增 `switch` 即可见换人。

## 7. 不变量（追加 v1 §14）

- bench 进出不重排，不复制状态；换入单位 stages/effects 为快照值。
- replacement 不消耗阵亡者未执行动作的 PP。
- 同一 control 只存一条效果记录；叠加刷新 turns 不产生第二条。
- revive 只在 CHECKPOINT 消耗，不等 TURN_END。
- v1 包在 v2 引擎下所有事件/hash 与 v1 引擎输出逐字节一致。

## 8. v2 内容包（fixture）

3 单位/方：active `syn-gamma`（HP150/ATK45/DEF28/SPD60）+ bench `syn-delta`（HP90/ATK55/DEF20/SPD70, revives:1）、`syn-epsilon`（HP110/ATK38/DEF40/SPD45, mode:"boss"）。
动作：v1 四件 + `syn-drain`（transfer_stages）/ `syn-purge`（clear_stages）/ `syn-slam`（damage kind:true power30）/ `syn-blast`（damage kind:percent power25）/ `syn-hex`（control stun turns1）/ `syn-purge-mind`（cleanse）/ `syn-ward`（apply_status immune_control turns2）/ `syn-brand`（apply_effect "marked" turns3）。

BOSS 标记：`modeOverlays.boss = {immuneControl:true, immuneClearStages:true}`。
