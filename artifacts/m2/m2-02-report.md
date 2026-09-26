# M2-02 执行报告：引擎机制①（stat_ops/damage_kinds/control/overlay）

日期：2026-09-26。基线：`6fac548`（M2-01）。

## 落地机制（applyEffect 全实现）

| 机制 | 语义 | 事件 |
|---|---|---|
| `transfer_stages` | 原子吸强（负 stage 取绝对值转移，clamp ±6）；全零→`no-stages`；boss→`overlay_immune` | stages-transferred |
| `clear_stages` | 目标清零；全零→`no-stages`；boss→`overlay_immune` | stages-cleared |
| `damage.kind` | fixed=power 原样；percent=floor(power×maxHp/100)；true=def 按 stage0；standard 不带 damageKind 字段（v1 兼容） | damage+damageKind |
| `control` | `control:stun` 按**阻断次数**消耗（turns=n 恰阻 n 次行动，含施加当回合后到的）；PP 照扣 | effect-applied/faded |
| `cleanse` | 清除全部 control:*；**穿透控制**（被控仍可用——反制手段）；无控制→`no-control` | effect-faded |
| `apply_status` | `immune_control` 免疫 control op | control-immune |
| `apply_effect` | `tag:<name>` 计数标签 | effect-applied |
| `mode overlay` | immuneControl/immuneClearStages 按 unit.mode 查 ruleset，不写 if-petName | — |

## 语义决定（测试驱动出来的修正）

1. **stun 回合语义**：初版"施加当回合同 turn 递减"会让 stun(1) 立刻消失；改为按**阻断次数**消耗——施加当回合不递减（`appliedTurn` 标记），每次 BEFORE_ACTION 阻断 -1。免疫类仍走 TURN_END。
2. **cleanse 穿透**：受控单位动作全废会让 purge-mind 成为死牌——含 cleanse 的动作穿透控制（spec §4.4 已同步修订）。
3. **stun 同回合起效**：快者优先时控制可阻断当回合对方的行动——这是"次数"语义的自然结果，已进 spec。

## 验收

- `mechanics-v2.test.ts` = **17/17**（每机制 pos/neg/boundary + overlay 负例 + crafted 注入 fixture）
- v1 字节级回归：core 57/57、replay:verify 22/22、protocol 21/21、privacy 9/9——**hash 零漂移**

## 契约演进

internal state unit +`mode`/`revives`/`appliedTurn`（optional additive）；internal event enum +6 类型；public event union +7 变体（switch/revive 为 M2-03 预埋，damage 增可选 damageKind，action-failed 增 4 reason）。
