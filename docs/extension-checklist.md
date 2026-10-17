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
