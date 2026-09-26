# M1-01 执行报告：pure battle-core + synthetic-v1 loader

日期：2026-09-26。基线：`55bb4ca`（M0-06 收敛后）。任务卡：roadmap §3 M1-01。

## 交付物

**`packages/battle-core/`**（`@seer/battle-core`，pure TS、无 I/O、确定性 transition）：

| 文件 | 内容 |
|---|---|
| `rng.ts` / `sha256.ts` | 自 `experiments/determinism` 升入（向量回归仍过） |
| `types.ts` | `CoreState`（internal `BattleState` 的纯战斗子集，直接复用生成类型防漂移）、`CoreEvent`、`EngineFault`、`CoreResult` |
| `loader.ts` | `compilePack`（纯）+ `loadPackFromDir`（node fs 便利层）：Ajv 校验 + operator ⊆ allowlist + 引用完整性 + `ruleset/content/executableHash` 计算 |
| `engine.ts` | `initBattle` / `legalActions` / `defaultAction` / `applyTurn`（ORDER→…→NEXT 的纯 transition，phase 静止于 collect/end，中间相在 transition 内部展开） |

## 验收

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm test:core` | 0 | **29 个 golden**（要求 ≥24）：全部手算数值对照 §4 参考值（strike 22/23、jab 11、heal 60、struggle 30+recoil 15、强化后 34）+ 序/priority/tiebreak/PP 消耗/失败条件/struggle 合法性/concede/超时默认/无效动作/KO 打断/turn-limit/终局拒绝/恶意 fixture 原子性/确定性 |
| 属性测试 | 0 | **10,000 seeded 局** ~43s：每步断言 HP/PP/stage 有界、输入与旧 state 不变、revision 单调、rng-draw 仅平速产生 ≤1/回合；前 50 局 canonical 轨迹复跑字节一致 |
| 全 gate 回归 | 0 | contracts:check / boundaries / contracts / privacy / plugin / determinism / determinism:browser 全过（**含内部 schema 加字段后的重新生成与隐私测试**） |

## 设计裁决（写回规范理解）

1. **§9 默认动作**：字面字典序最小会把 `act_concede` 选成超时默认（认输）。按括注"v1 即还剩 PP 的第一个动作"实现为只在 move 动作里取字典序最小，全耗光才 `act_struggle`；**超时永不产生 concede**。
2. **§6 "每局至多一次平速判定"**：若 spd 相等则每回合都会 tie；spec 语义要求 memoize。内部 `BattleState` 增补 `speedTiebreak`（required，`p1|p2|null`）——首个 tie 消耗一次 draw 并持久化胜者，后续 tie 复用。这是 M0-02 schema 的加性演进。
3. **EngineFault 一律 Result**：`applyTurn` 捕获 `EngineFault`（含 effect 内的 `UNSUPPORTED_OPERATOR`）返回 `{ok:false}`，不向外抛；非 EngineFault 异常仍抛出（引擎 bug 不当 fault 吞）。
4. **超时 null → 默认策略**：`ResolvedAction|null` 为 null 时走 §9 默认——timeout_default origin 由 Host 记录，core 只看动作本身。

## 已知限制 / 不声称

- **struggle 在现有数值下不可自然到达**（strike 7 回合 KO，而 PP 总量 100+）——spec 的合法集合规则仍实现并被 crafted-state golden 覆盖。
- `check:boundaries` 已把 `packages/battle-core` 列为 internal 合法消费者（M0-02 预留）。
- **tsconfig include 漏网修复**：`experiments/**` 此前从未进 strict typecheck（rng readonly、adapter exactOptionalPropertyTypes、plugin manifest cast 等 6 处潜在错误被本次浮出并修复）——这是真实的验证缺口，现在全仓库都在 include 内。
