# 触点预算

日期：2026-10-13。状态：步骤 1–3 已落地。

前提是 `plans/engine-atoms.md` 步骤 1–5、`plans/target-route.md` 步骤 1–9 已经落地。本计划不重做那两份，也不开路线的第 10 步。它把「一条实现只动一处」放宽成按档的上限：能少就少，不许超出这一档。

`docs/extension-checklist.md` 仍是贵的那几档要改哪些文件。本计划只规定最多动几处，不改那份清单。

## 目标

新句子先走最便宜的一档，走不通就停。不要为了形状整齐去改更贵的一档。测试跟着这条改动走，用来锁行为，不算再发明一种语义。技能句子用一条针对这句的断言，不重生成 `tests/fixtures/parser-golden.json`。一次加一条的顺序见 [add-effect.md](add-effect.md)。

## 预算

| 想加的东西 | 最多动几处 | 动哪里 | 不要顺手动 |
|---|---|---|---|
| 现有规则已经能写出的精灵、招式、魂印 | 1 | `content/<pack>/` | 解析器、`engine.ts`、`damage.ts` |
| `amountExpr` 已有节点可组合的新幅值 | 1 | `content/<pack>/`；需识别新中文时走下一档家族规则 | 新幅值字段、新状态名、新结算分支 |
| 一句新中文，但 op、回合窗、rider、已有状态名都够用 | 2 | 家族规则一条；`order.mjs` 放在同家族宽规则之前 | `effects-parse.mjs` 的匹配循环、`soulmark-parse.mjs`、新状态名 |
| 已有轴、已有 `params` 键，只是缺一个状态名 | 再加 1 | `EFFECT_DEFS` 一行 | 新的结算 `if`、新的 `params` 键 |
| 一种新的固伤、倍率、吸血、命中附加 | 1 | 那个家族 rider 函数里的一个臂 | `damage` 上的新字段 |
| 一整族机制，钩子已经有 | 2 | `mechanics/<id>/` + `MECHANICS` 一行 | `engine.ts` 里写机制名 |
| 一个服务端域 | 2 | 新插件文件 + `defaultModulesFor` 一行 | 往别的插件里塞路由 |
| 一个面板（观察里已有字段） | 2 | 新组件 + `presentation.ts` 一行 | `main.tsx` 的出招、轮询、场景 |
| 一个新 op | 5 | 处理函数和 `OPS` 一行、schema、`CompiledEffect`、`operatorAllowlist`、一条测试 | 同一个改动里再改解析器 |
| 一个新公开事件 | 5 | 公开 schema、内部枚举、生成类型、投影字段、中文名 | 改已有事件的投影 |

新 op 和新公开事件的五处是核对关系，缺一处会装载失败或事件发不出去。这两类本来就少，不把它们收成代码生成。

删的时候按同一档反向做。还要连带改联合类型、schema、解析器和结算分支的，说明它本来就不在这一档里。

## 新句子怎么落

能用现有中文规则对上的，只改数据包。

对不上、但结算已经有格子的，编译器发已有中间表示，不进引擎：

- 回合窗发 `{ op: "apply_status", name: "periodic", params: { win }, payload }`。`win` 用现成窗口，payload 用现成原子 op。不新开窗口，不加状态名。
- 命中附加发已有 rider，不往 `damage` 上加键。
- 被动发 `{ hook, guard, chance, bossGate, ops, elseOps }`。不给 `SoulFlagOp` 加成员。
- 状态的 `params` 只用已经有读取的键。没有读取就留下 `unparsedReason`，不要先造键再补一个空读。

这三处同时出现，才算超出预算：新状态名、新 `params` 键、一段新的结算 `if`。这种句子停在未解析，或者单独开上面的五处契约。两件事不要做在同一次改动里。

## 不做的事

- 不把 `doom`、`dot_field`、`hot`、`drain_dot`、`foe_dot`、`pp_drain` 改成 `periodic`。一句对得上的中文只动家族规则，运行时那一个分支会脱糖。
- 不给 `SoulFlagOp` 加成员，也不把 `turn_heal`、`turn_flat`、`hit_shield` 这些旧旗标迁进 `OPS`。`revive` 和 `endure` 留在 `mechanics/soulmark/fatal.ts`。
- 不新增 `Mechanic` 钩子。缺的钩子先单独开契约：加一个可选钩子，在引擎现有循环点调用，钩子名里不写机制 id。
- 不修巅峰包 `mv-2501-s1` 的 `targetScope` 拒载。
- 不跑 `node tools/soulmark-parse.mjs`，不手改覆盖率 JSON，不重生成 `parser-golden.json`。
- 不把中文匹配链收成局中插件。
- 不改客户端视觉。那份计划是 `plans/ui-redesign.md`，不在这里执行。

## 路线

1. **README 改认预算。** 已完成。开头不再写「做不到一处就不要做」。上限指向本文件。`plans/README.md` 收入本文件，并标明已经落地的两份计划。不改扩展清单。
2. **锁住不许再长的闭集。** 已完成。`EFFECT_DEFS` 里 `periodic` 轴只有 `doom`、`dot_field`、`hot`、`drain_dot`、`foe_dot`、`pp_drain` 和名字 `periodic`；前六个才由 `periodicFormOf` 脱糖。`SoulFlagOp` 与 `soulmarks.schema.json` 的 `soulOp.op` 都等于现在这十个旗标。`SoulHookOp` 只有 `hook`、`guard`、`chance`、`bossGate`、`ops`、`elseOps`。要放行一个新名字，先改这两条测试，不在功能改动里顺手加。
3. **改掉会让人再加周期名的注释。** 已完成。`ops/periodic.ts` 的文件头和 `EffectDef.periodic` 的注释不再说全部具名 tick 都在挂载时脱糖。
