# 扩展点一页清单

日常改动只许落在下表触点。每节四行：改哪些文件、不许改哪些文件、跑哪条命令、怎样算插错。
测试文件落点以 `tests/README.md` 为准，不要写回 `tests/battle-core/` 根目录。
命令一律用 `node` 直接跑（本机 pnpm 启动器版本可能与 package.json 的 pnpm@12.6.0 不一致）。

## 1. 新精灵 / 新招式（op 已在该 ruleset 的 `operatorAllowlist` 里）

- 改：`content/<pack>/` 的数据文件 + 一条对局测试。
- 不改：`packages/battle-core/src/engine.ts`、`packages/battle-core/src/ops/damage.ts` 的伤害公式、解析器。命中后的吸血、反伤、等量固伤、命中回复、命中降能力改 `packages/battle-core/src/ops/damage-riders.ts` 里对应函数，并先有该段测试。
- 跑：`node tools/content-validate.ts content`。
- 插错的样子：diff 里出现 `engine.ts` 或 `ops/damage.ts`。

## 2. 新服务器域

- 改：新文件 `apps/server/src/plugins/<name>.ts`（导出 `PluginSpec`）+ `apps/server/src/index.ts` 的 `defaultModulesFor` 加一行（现在是 content、battle-manager、battle-api、world-api、static 五行）。
- 不改：`apps/server/src/router.ts` 的分发循环。
- 跑：`node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit`。
- 插错的样子：在已有插件文件里加一条不属于该域的路由，而不是新建插件。

## 3. 新机制（只用 `Mechanic` 已有钩子）

- 改：新建 `packages/battle-core/src/mechanics/<id>/` + `packages/battle-core/src/mechanics/index.ts` 的 `MECHANICS` 数组加一行。`sixstat` 必须在 `seals` 前面（文件头写了原因：刻印叠在六维面板上）。
- 不改：`packages/battle-core/src/engine.ts`——不许在里面写这个机制的 id。
- 跑：`node node_modules/vitest/vitest.mjs run tests/battle-core/mechanics/mechanics-registry.test.ts`。
- 插错的样子：需要的钩子名不在 `packages/battle-core/src/mechanics/types.ts` 的 `Mechanic` 上。现有可选钩子全表：`compile`、`checkUnit`、`unitFields`、`checkMove`、`moveFields`、`checkUnitMoveRef`、`checkUnitMove`、`checkInitSlots`、`deriveBase`、`stageKeys`、`applyUnit`、`scaledDamage`、`moveSlots`、`priorityBoost`、`controlImmune`、`stageDropImmune`、`onTurnStart`、`preOrder`、`onKO`、`onSwitchOut`、`onMoveUsed`、`orderRoll`、`onEntry`、`onTurnEnd`、`onFatalDamage`、`absorbDamage`、`onDamaged`、`onDamageDealt`、`onMiss`、`projections`、`eventFields`、`meta`。缺钩子就停，先单独开一个契约改动（给 `Mechanic` 加可选钩子并在引擎现有循环点调用，钩子名不含机制 id，不带新机制内容数据）。新公开事件走下面第 7 节，不在机制 PR 里改 schema。

## 4. 新技能句子

- 改：`tools/effects-rules/` 里对应家族文件加一条规则，在 `tools/effects-rules/order.mjs` 里把这条放在同家族宽规则之前，其他家族相对顺序不动；加一条 golden。
- 不改：`tools/effects-parse.mjs` 的匹配循环、`tools/soulmark-parse.mjs`。家族文件顶层不许调用 `parseEffectText`/`condOf`/`reactWrap`（只能运行时经 `go` 调用）；`re:` 用的常量从 `./lex.mjs` 导入。
- 跑：`node node_modules/vitest/vitest.mjs run tests/battle-core/parser/parser-golden.test.ts` + `node tools/effects-ratchet.ts`。
- 插错的样子：句子插在宽规则后面（永远匹配不到）或前面抢走了旧句子（golden 会翻脸）。不能表达的句子只许返回 `unparsedReason` 并写明缺哪种语义——不许返回 `EFFECT_DEFS` 里没有、或有定义但没人读的 `name`/旗标（见第 8 节检查）。

## 5. 新战斗面板

- 改：新组件文件 + `apps/client/src/presentation.ts` 的 `registerBuiltinPanels()` 加一行。需要观察里没有的字段时，先走第 7 节改公开观察/事件 schema。新整页仍是 `apps/client/src/main.tsx` 里的三行 `registerScreen`——这是计划故意留下的触点，不是漏搬。
- 不改：`main.tsx` 里的 `submit`、轮询、`scene`。
- 跑：`node node_modules/vitest/vitest.mjs run tests/client/presentation.test.ts`；改动会渲染的组件时再跑 `pnpm test:ui-smoke`（即 `node --experimental-strip-types tools/ui-smoke.ts`，需本机 8787 构建产物）。
- 插错的样子：`presentation.ts` import `main.tsx`（环）；面板组件在模块顶层读 `location`（Node 测试一导入就抛——经 `apps/client/src/query.ts` 的 `pageQuery()` 在渲染时读）。

## 6. 新 op（现状五处，计划不减少触点数）

- 改：顺序同 `packages/battle-core/src/ops/index.ts` 文件头：① `ops/<name>.ts` + handlers 表一行；② `content/schemas/moves.schema.json` 的 if/then 门控；③ `packages/battle-core/src/loader.ts` 的 `CompiledEffect` 联合分支；④ 目标 ruleset 的 `operatorAllowlist`；⑤ 一条测试。
- 不改：同一个 PR 里不要再改解析器。
- 跑：`node tools/schema-sync-check.ts`（已比对这五处）。
- 插错的样子：五处缺一（schema-sync 会报具体哪处不一致），或顺手在 `tools/effects-parse.mjs` 里加了规则。

## 7. 新公开事件（或少公开一个字段）

顺序固定，缺一即 `schema-sync` 失败：

1. 改 `packages/contracts/schemas/public/event.schema.json` 的 `oneOf`，加一支。`properties.type.const` 是类型名；`type` 本身不写进白名单字段。
2. 若引擎会发它：加进 `packages/battle-core/src/types.ts` 的 `CORE_EVENT_TYPES` 和 `CoreEventType`，并加进内部 schema `packages/contracts/schemas/internal/event-internal.schema.json` 的 `type.enum`。若只是 Host 内部事件：只加进内部 enum，并改 `tools/schema-sync-check.ts` 里那个 Host 专属事件钉（现在是 `decision-opened`、`input-received` 两个），同时确认它不在 `PUBLIC_TYPES`。两种不要混在一个类型上。
3. `node tools/gen-contract-types.ts`。
4. `packages/host/src/events.ts` 的 `PUBLIC_FIELDS` 补这个类型。机制自有事件优先写进该机制的 `eventFields`（如魂印），不要写进手写表。
5. `apps/client/src/meta.ts` 的 `ZH_EVENT` 补中文名；`tests/client/fmt-event.test.ts` 的夹具表补一行。
6. 跑：`node tools/schema-sync-check.ts` 和 `node node_modules/vitest/vitest.mjs run tests/contracts/event-sync.test.ts tests/client/fmt-event.test.ts`，都要过。

- 不改：`projectEvent` 函数体；已有事件的投影结果。
- 插错的样子：四处（schema / 白名单 / 内部 enum / 中文名）缺一——「保护事件发不出去」那种事故就是这么来的。

## 8. 新效果旗标（`EffectDef` 字段）

- 改：两条路只许走一条——① 沿用已有读取（例如又一行 `dmgReduceFlat: "params"`，`packages/battle-core/src/ops/effects.ts` 里已有对它的求和）；② 放进 `effects.ts` 的 `DEFERRED_FLAGS` 集合并加注释「尚无结算读取」，同时解析器对这种句子返回 `unparsedReason`，不要产出该旗标。
- 不改：为了过检查给旗标现补结算分支；`packages/battle-core/src/ops/damage.ts`。
- 跑：`node tools/effects-compile-check.ts`。
- 插错的样子（第三种，禁止）：解析成功、表上有键、`DEFERRED_FLAGS` 没有、源码里也没有读取。

## 9. 组合数值

- 改：已有节点能表达的幅值只改 `content/<pack>/`。需要识别新中文时，家族规则发同一个 `amountExpr`，沿用第 4 节触点；不再增加 `statSumPct2`、`perXxx` 等专属幅值字段。
- 支持：`heal.amountExpr`、`hp_delta.amountExpr`；`apply_status` 的 `dmg_boost`（增伤百分比）、`dmg_reduce`（减伤点数）、`dmg_flat`（附加固伤点数）。其他状态没有通用读数入口，schema 会拒绝，不能只挂字段。
- 节点：整数、`{stat, of?}`、`{count:"ailments", of?}`、`{sum:[...]}`、`{product:[...]}`、`{difference:[a,b]}`（差的绝对值）、`{divide:{value,by}}`（正整数分母，每个节点向下取整）、`{min:[...]}`、`{max:[...]}`。`of` 为 `self` / `foe` / `target`，默认 `self`。异常按种类去重；读取不存在的单位或面板维度得到 0。求值限 256 个节点、32 层，所有中间值必须是安全整数。
- 上下文：直接 op 的 `self` 是执行者，`target` 是接收者（含逐个后备）；持久状态的 `self` / `target` 是状态持有者，`foe` 是结算时的当前对手。状态表达式保存到内部状态，每次结算重新读取，换对手或面板变化不会沿用施加时的旧数。

`apply_status` 的 `dmg_boost`、`dmg_reduce`、`dmg_flat` 需要在施加时定值时可加 `"amountTiming": "apply"`，并提供 `amountExpr` 或受支持的旧幅值来源（如 `statDiff` / `perAilment`）；缺省不写该字段，仍按上面的规则动态读取。冻结时按最终状态持有者求值：`self` 和 `target` 指持有者，`foe` 指另一侧单位，因此施加到 `target: "opponent"` 时也以接收方为视角。内部状态只保存求出的整数 `amountExpr`，不保存 `amountTiming`。

例如“恢复自身攻击与特攻之和的 40%”只需已有的回复 op：

```json
{
  "op": "heal",
  "target": "self",
  "amountExpr": {
    "divide": {
      "value": { "product": [{ "sum": [{ "stat": "atk" }, { "stat": "spa" }] }, 40] },
      "by": 100
    }
  }
}
```

“对手每有两种异常增伤 30%，最高 90%”使用同一组节点：

```json
{
  "op": "apply_status",
  "name": "dmg_boost",
  "target": "self",
  "turns": 3,
  "amountExpr": {
    "min": [90, { "product": [{ "divide": { "value": { "count": "ailments", "of": "foe" }, "by": 2 } }, 30] }]
  }
}
```

`amountExpr` 优先于旧的基础幅值字段；已有条件、护盾消耗、回复增减等流程仍按原顺序执行。回复和直损不会因负幅值反向扣血或加血。`statDiff`、`statSumPct`、`perAilment` 保留兼容，经同一个适配层读取，不要求批量迁移旧数据或解析规则。

新增表达式节点仍是单独的契约改动：同步内容和内部状态的 `numericValue` schema，运行 `node tools/gen-contract-types.ts`，在 `ops/value.ts` 加求值分支和行为测试。类型直接取生成的状态契约；`schema-sync-check` 检查两份 schema 同形，不另建手写节点联合。不要在同一次契约改动里再改中文匹配链。

验证：`node tools/schema-sync-check.ts`；`node node_modules/vitest/vitest.mjs run tests/battle-core/ops/numeric-value.test.ts tests/battle-core/mechanics/mechanics-registry.test.ts tests/agent/tools.test.ts`。
