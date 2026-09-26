# M2-03 执行报告：bench / switch / replacement / revive（mid-turn 挂起+续跑）

日期：2026-09-26。基线：`60f0857`（M2-02）。

## 机制

| 能力 | 实现 |
|---|---|
| bench | `sides[s].bench?: internalUnit[]`——v1 pack 不出现该字段（hash 不变） |
| 主动换入 | `act_switch-<i>`：ORDER 中 switch 组先于一切 move；换下/换入各自保留自身 stages/effects |
| KO→挂起 | bench 有存活者 → `state.suspension={koSide, remaining}`，phase=`checkpoint`；阵亡者 queued action 作废 |
| `applyReplacement` | 独立 transition：换入 → 执行 suspended remaining → TURN_END → 下一 collect |
| revive | KO 检查先消耗 revives → hp=floor(max/2) 原地复活，无 KO 事件 |
| Host 协议 | `decision.kind:"replacement"`、单 actor=koSide；超时→`defaultReplacement`（最低存活 bench） |
| 观察投影 | `own.bench`（完整）/`opponent.benchAlive`（数量）；switch legalAction 带 unitId |
| Replay | resolvedInput 顺序回放：`state.suspension` 检测 → `applyReplacement` 分支 |

## 契约演进（加性）

- internal state：`sides[s].bench?`、`suspension?{koSide,remaining}`、`internalUnit` 提取为命名定义供 bench 复用
- observation：`own.bench[]`、`opponent.benchAlive`、`mode`/`revives` 透出
- legalAction：switch `{kind:"switch", unitId}`（契约里已前瞻存在）

## 语义决定（过程修正）

1. **stray phase="end"**：`else` 兜底把挂起态错判终局——改为仅 `next.terminal` 时 end，挂起保持 checkpoint。
2. **replacement 内 remaining 为 actionId 字符串**：resume 时重走 resolveAction——确定性、可序列化、进 hash。
3. **switch 组先于一切 move**：ORDER 先按 isSwitch 分组再按 spd——v1 无 switch → 行为不变。
4. **`inboxComplete`**：restore 恢复判定改为 `decision.actors.every(inbox 非空)`——replacement 是单 actor。

## 验收

- core 层 `switching-v2.test.ts` **11/11**：init bench 字段存在性（v1 hash）、switch 合法集/挂起隔离、via:"action" 换入保自身 stage、死 bench 拒绝、KO 挂起、applyReplacement 全链路（turn+1/phase collect/阵亡者进 bench）、concede、无 bench 直接终局（v1 兼容）、revive 复活/耗尽转挂起
- host 层 `replacement.test.ts` **2/2**：单 actor 决策 + 非 actor UNAUTHORIZED + 幂等重放 receipt + timeout 默认替补
- 全回归：core 68/68（含 10k 属性）、replay:verify 22/22、protocol 21+privacy 9、recovery 9、contracts drift 0、boundaries PASS

## 边界

suspension.remaining 至多保存"一个未行动方"的 actionId（行动串行执行，KO 时另一侧只可能未动或已动）；再挂起（continuation 自己也死）用 `{p1:null,p2:null}` 兜底——由测试 golden 覆盖。bench 不设上限（ruleset.limits 后续可加 benchSize）。
