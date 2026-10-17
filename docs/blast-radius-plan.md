# 缩小经常改动的影响面

状态：阶段 0–5 已实施（2026-10-04）。本文件仍是验收规格。验收者不采信本文末「实施记录」里的自述，会按每阶段「验收」一节重跑命令、再读 diff。

实施约束：

- 一次只做文档「实施顺序」里的当前一步。阶段 0 和阶段 1 一起做。做完一步就停，把结果填进文末「实施记录」，不要接着做下一步。
- 不把 `battle-core` 接进 Cordis，不在对局中途装卸机制。
- 不拆 `damage.ts`。不改已经封顶的复活和吸血。不改 `projectEvent` 的投影结果。不改公开 schema，除非这一步的规格写明要改。
- 不改 `tools/soulmark-parse.mjs`。
- 命令用 `node` 直接跑。本机 `pnpm` 启动器版本可能和 `package.json` 里的 `pnpm@12.6.0` 不一致。PowerShell 不支持 `&&`。
- 没跑的检查写成「未跑」和原因。不要写成通过。
- 阶段 2 的 golden 有差异就停，不要进入阶段 3，也不要改句子语义去把 golden 改回去。
- 阶段 3 若让编译失败数上升，收回新检查或把新失败句子改回 `unparsedReason`。不要放宽基线。
- 阶段 4 的浏览器烟测连不上或失败，阶段不算完成。不要写成环境问题放过。
- 行号会漂。以符号名和注释文字为准，不以行号为准。

战斗引擎继续是编译期登记，不改成 Cordis 热插拔。服务端五个域已经是 Cordis 插件。已有 op 能写出来的新精灵已经只改 `content/`。这份计划只处理现在每次都要穿多层、而且上一轮审计真的漏过的四类改动：新公开事件、新技能句子、新效果旗标、新战斗面板。

不在本计划里做的事：

- 不把 `battle-core` 接进 Cordis，不在对局中途装卸机制。旧局仍靠 `executableHash` 隔离。
- 不拆 `damage.ts`。吸血上限和死亡检查刚稳住，和解析器搬家不能放在同一个改动里。
- 不自动生成中文规则，不从服务端下发客户端插件。
- 不改已经封顶的复活和吸血。不改任何现有事件的投影结果。
- 不把「新 op」收成一行。新 op 今天仍是五处，见阶段 0 第 6 条。`tools/schema-sync-check.ts` 已经在守这五处，本计划不另做一套。

做完之后，日常改动的允许触点：

| 想改的东西 | 现在要动 | 做完后只动 |
|---|---|---|
| 一句已有旗标能表达的技能文本 | `tools/effects-parse.mjs` 里找插入点，插错会截走别的句子 | 对应家族文件加一条规则，在 `order.mjs` 放进同家族宽规则之前，加一条 golden |
| 引擎还不认识的句子 | 同上，还可能顺手编一个没人读的旗标 | 规则只返回 `unparsedReason`。编译检查拒绝「表上有旗标、结算没人读」 |
| 新的公开事件，或少公开一个字段 | `types.ts`、`events.ts`、公开 schema、生成类型、`meta.ts`、`feed.tsx`，漏一处就出上次那种「保护事件发不出去」 | 先改 `event.schema.json`，再补白名单和中文名。四处缺一，`schema-sync` 失败 |
| 战斗页新面板 | `main.tsx` 底部注册，和出招循环挤在一个文件 | `presentation.ts` 加一行。整页（lobby/world/battle）仍留在 `main.tsx`，本计划不搬 |
| 新服务器功能、已有钩子能写的新机制 | 已经是插件 / 登记一行 | 保持，只补顺序测试和一页清单 |

命令一律用 `node` 直接跑。本机 `pnpm` 启动器版本可能和 `package.json` 里的 `pnpm@12.6.0` 不一致，脚本名只作为对照。PowerShell 不支持 `&&`。

对照脚本：

- `node tools/schema-sync-check.ts`（`pnpm test:schema-sync`）
- `node node_modules/vitest/vitest.mjs run <文件>`
- `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit`
- `node tools/effects-compile-check.ts`（`pnpm test:effects-compile`）
- `node tools/effects-ratchet.ts`（`pnpm test:effects-ratchet`）

## 现在代码里已经是真的、计划必须照此写

这些事实和上一版计划不一致。按上一版写检查，阶段 1 会在合入前自己失败。

**公开投影。** `packages/host/src/events.ts` 的 `PUBLIC_TYPES` / `PUBLIC_FIELDS` 是未导出的手写表（约 31–75 行）。随后 78–83 行把每个 `Mechanic.eventFields` 并进去。今天只有魂印：`packages/battle-core/src/mechanics/soulmark/index.ts` 的 `eventFields: { soulmark: ["side", "mark", "name", "effect"] }`。检查必须导入合并之后的那两个绑定，不能自己再抄一张「手写表 + 魂印」。

手写 19 个类型，加上 `soulmark` 共 20 个。`pp-delta` 只有 `side`、`delta`。

**公开 schema。** `packages/contracts/schemas/public/event.schema.json` 的 `oneOf` 也是这 20 支。每支的判别字段是 `properties.type.const`。其余键才是 detail。`type` 本身不是 `PUBLIC_FIELDS` 的成员。比较时先丢掉 `type`。不比较 `required`，不比较嵌套对象（`hpAfter.current`、`stages.atk`）。嵌套漂移本阶段不查，避免把检查写成第二份 schema。

**引擎事件不是内部事件。** `packages/battle-core/src/types.ts` 的 `CORE_EVENT_TYPES` 有 22 个。`packages/contracts/schemas/internal/event-internal.schema.json` 的 `type.enum` 有 24 个。多出来的两个是 Host 自己发的：`decision-opened`、`input-received`（`packages/host/src/host.ts` 约 142、154、279、316 行）。`tests/host/privacy.test.ts` 断言它们不进公开流。禁止写成「`CORE_EVENT_TYPES` 等于内部 enum」。

引擎有、公开没有的两个：`pp-spent`、`rng-draw`。也要钉死，不能把「凡是引擎事件都必须公开」写成检查。

**中文名。** `apps/client/src/meta.ts` 的 `ZH_EVENT`（约 68–74 行）未导出。它缺 `turn-begin`。多出来的 `turn-end` 可以留。`apps/client/src/battle/feed.tsx` 的 `fmtEvent` 自己有 `turn-begin` 分支（约 39 行），所以缺的是表，不是播报。`protected` / `pp-delta` / `struggle-used` 没有专门分支，落到 `zhEvent`。`pp-spent` 返回空串，而且它不是公开类型，测试不得要求它非空。`effect-applied` / `effect-faded` 读 `d.name`，缺 name 时字面量是 `「?」`。

**效果名检查已经有了。** `tools/effects-compile-check.ts` 105–108 行已经要求 `apply_status` / `apply_effect` 的 `name` 是 `EFFECT_DEFS` 的键。`content/claims/_compile-failures.json`（2026-10-03）记录 53697 条、失败 0。`tag:`、`control:` 是运行时 kind 前缀（`ops/apply-effect.ts` 把 `apply_effect` 收成 `` `tag:${name}` ``，`ops/control.ts` 收成 `` `control:${name}` ``），不是 IR 里的 `name`。本计划不加前缀豁免。加了只会把现有红灯放绿，或者放进一批本来就没出现在 IR 里的名字。

**面板注册搬不走「原样 11 行」。** `apps/client/src/main.tsx` 666–677 行登记了 3 个整页和 8 个面板。其中 `App`、`World`、`Lobby`、`HiddenStatus`、`ArenaCards`、`BenchRow`、`PostBattle`、`ClaimReward` 定义在同一个文件。`PostBattle` 闭包了 `ClaimReward`、模块级 `qs` 和 `BATTLE`（21–22 行，读 `location.search`）。`HiddenStatus` / `ArenaCards` 也读 `qs`。ESM 的 import 会提升：`presentation.ts` 若从 `main.tsx` 导入这些组件，同时 `main.tsx` 导入 `presentation.ts`，就是环，而且组件在求值时还在暂时死区。阶段 4 按这个约束写，不按「剪切 11 行」写。

**技能规则不是纯数据。** `tools/effects-parse.mjs` 的 `RULES` 从 47 行到 2604 行。匹配循环（3172–3175 行）只读 `rule.re` 和 `rule.go`。不少 `go` 在运行时调用 `parseEffectText`、`condOf`、`reactWrap`。`re:` 在模块加载时就求值，用到 `NUM`、`AIL_RE`、`STAT_RE` 等。这些常量若跟着规则文件去 import 解析器，加载期就会环死。阶段 2 先把加载期常量抽走，再搬数组。

## 阶段 0：把允许触点写成一页清单

新增 `docs/extension-checklist.md`。只写操作，不写架构。每一节固定四行：改哪些文件、不许改哪些文件、跑哪条命令、怎样算插错。

六条都要写，路径用仓库里真实存在的文件：

1. **新精灵 / 新招式，且 op 已在该 ruleset 的 `operatorAllowlist` 里。** 只改 `content/<pack>/` 的数据，加一条对局测试。不改 `packages/battle-core/src/engine.ts`。跑 `node tools/content-validate.ts content`。插错的样子：diff 里出现 `engine.ts` 或 `damage.ts`。
2. **新服务器域。** 新文件 `apps/server/src/plugins/<name>.ts`，导出 `PluginSpec`。在 `apps/server/src/index.ts` 的 `defaultModulesFor`（119–126 行，现在是 content、battle-manager、battle-api、world-api、static 五行）加一行。不改 `apps/server/src/router.ts` 的分发循环。插错的样子：在已有插件里加一条不属于该域的路由。
3. **新机制，且只用 `Mechanic` 已有钩子。** 新建 `packages/battle-core/src/mechanics/<id>/`，在 `mechanics/index.ts` 的 `MECHANICS` 数组加一行。`sixstat` 必须在 `seals` 前面（文件头写了原因：刻印叠在六维面板上）。不许在 `engine.ts` 里写这个机制的 id。需要的钩子名必须已经出现在 `packages/battle-core/src/mechanics/types.ts` 的 `Mechanic` 上。清单把这些可选钩子原样列出来，避免实施时再猜：`compile`、`checkUnit`、`unitFields`、`checkMove`、`moveFields`、`checkUnitMoveRef`、`checkUnitMove`、`checkInitSlots`、`deriveBase`、`stageKeys`、`applyUnit`、`scaledDamage`、`moveSlots`、`priorityBoost`、`controlImmune`、`stageDropImmune`、`onTurnStart`、`preOrder`、`onKO`、`onSwitchOut`、`onMoveUsed`、`orderRoll`、`onEntry`、`onTurnEnd`、`onFatalDamage`、`absorbDamage`、`onDamaged`、`onDamageDealt`、`onMiss`、`projections`、`eventFields`、`meta`。缺钩子就停，走阶段 5 说的单独契约改动。新公开事件走阶段 1，不在机制 PR 里改 schema。
4. **新技能句子。** 走阶段 2 的家族文件和 `order.mjs`。不能表达就 `unparsedReason`。不许返回一个 `EFFECT_DEFS` 里没有、或有定义但没人读的 `name` / 旗标。
5. **新战斗面板。** 走阶段 4：新组件文件，再在 `presentation.ts` 加一行。不改 `main.tsx` 里的 `submit`、轮询、`scene`。需要观察里没有的字段时，先走阶段 1 改公开观察 schema。整页仍然改 `main.tsx` 里剩下的三行 `registerScreen`，清单写明这是本计划故意留下的。
6. **新 op（本计划不减少触点数，只写明现状）。** 五处，顺序就是 `packages/battle-core/src/ops/index.ts` 文件头：`ops/<name>.ts` 加上 handlers 表一行；`content/schemas/moves.schema.json` 的 if/then；`packages/battle-core/src/loader.ts` 的 `CompiledEffect` 分支；目标 ruleset 的 `operatorAllowlist`；一条测试。`node tools/schema-sync-check.ts` 已经比对这几处。不要在同一个 PR 里再改解析器。

本阶段没有行为变化。写完后逐条对一下路径存在。不另做「扫描 markdown 反引号」的测试，那种测试会把命令和示例也算成路径。

## 阶段 1：公开事件用现有两份表互相钉住

不新建第三份类型目录。线格式的源头仍是公开 schema。Host 白名单仍是投影用的那一份，检查只负责让它们相等。

### 1. 导出已有白名单

在 `packages/host/src/events.ts` 末尾导出合并完成后的 `PUBLIC_TYPES` 和 `PUBLIC_FIELDS`。不要在导出前复制一份新对象，检查要看到魂印并入之后的集合。`projectEvent` 函数体不改。`pp-delta` 继续只有 `side` 和 `delta`。

### 2. 比较函数

在 `tools/schema-sync-check.ts` 里把事件比较做成纯函数，例如 `eventSyncErrors(input): string[]`，脚本在现有 op 检查之后调用它，有错误就继续累加 `errors`，最后仍走现在的 `process.exitCode`。不要在发现第一处时 `process.exit`，否则负例测不到全部条件。

输入从仓库读，不由调用方再维护一份表：

- 公开 schema：`packages/contracts/schemas/public/event.schema.json` 的 `oneOf`。类型 = `properties.type.const`。字段集 = `Object.keys(properties)` 去掉 `"type"`。
- 白名单：从 `@seer/host` 或相对路径导入刚导出的两个绑定。导入路径跟这个文件已经在用的 `../packages/battle-core/src/ops/index.ts` 一样，直接指源文件。
- 引擎类型：`CORE_EVENT_TYPES`。
- 内部 enum：`packages/contracts/schemas/internal/event-internal.schema.json` 的 `properties.type.enum`。
- 中文名：把 `ZH_EVENT` 从 `apps/client/src/meta.ts` 导出后导入。这个文件顶层不碰 DOM，只有 `loadMeta` 里才 `fetch`，Node 可以加载。

判定，全部要有，缺一就失败：

1. schema 的类型集等于 `PUBLIC_TYPES`。多一个、少一个都报出具体名字。
2. 每个类型的字段集等于 `PUBLIC_FIELDS[type]`。报出类型名和差异键。
3. `pp-delta` 的字段集等于 `{side, delta}`。另外单独报一句隐私：出现 `moveId` 或 `ppAfter`。集合相等已经能抓住它，单独一句是为了报错能看出这是脱敏，不是普通键不一致。
4. 内部 enum 减去 `CORE_EVENT_TYPES` 必须正好等于 `["decision-opened", "input-received"]`。这两个不得出现在 `PUBLIC_TYPES` 或公开 schema。反方向：`CORE_EVENT_TYPES` 里每个名字都要在内部 enum 中。
5. `CORE_EVENT_TYPES` 减去 `PUBLIC_TYPES` 必须正好等于 `["pp-spent", "rng-draw"]`。新的引擎事件要么进公开四件套，要么有意加进这个钉。不允许第三种「忘了」。
6. `ZH_EVENT` 的键必须覆盖全部 `PUBLIC_TYPES`。允许多余键（今天的 `turn-end`）。缺一个公开类型就失败。

本阶段要补的唯一文案：`ZH_EVENT` 加上 `"turn-begin": "回合开始"`。`fmtEvent` 的 `turn-begin` 分支不读这张表，播报句子不变。

不改 schema，所以不跑 `contracts:gen`。清单里的「以后新增事件」才要求跑 `node tools/gen-contract-types.ts`。

### 3. `fmtEvent` 测播报，不测投影

`fmtEvent` 在 `feed.tsx`，该文件还 import 了 React。把这个纯函数剪到新文件 `apps/client/src/battle/format.ts`，只 import `meta.ts` 里的 `zhSpecies`、`zhMove`、`zhEvent`、`zhStat`、`zhReason`、`effTag`。函数体逐字不动。`feed.tsx` 再导出它，`main.tsx` 现有 import 路径可以保持。这是阶段 1 里唯一的代码搬家，搬家前后对同一组夹具的返回值必须相同。

新测试 `tests/client/fmt-event.test.ts`。观察夹具固定为 `{ side: "p1", own: { speciesId: "a" }, opponent: { speciesId: "b" } }`，`meta` 为 `null`。带 `side` 却不给这个观察对象会在 `obs.opponent` 上抛，那是夹具错误，不是产品错误。

对下面每一行，返回值必须非空，且不得包含 `「?」`：

| type | 额外字段 | 返回值里要有 |
|---|---|---|
| `turn-begin` | `turn: 2` | `第 2 回合` |
| `action-declared` | `side:"p1"`, `moveId` | `使出` |
| `damage` | `side:"p2"`, `amount:3` | `3 点伤害` |
| `heal` | `side`, `amount` | `恢复` |
| `stat-stage` | `side`, `stat:"atk"`, `deltaApplied:1` | `+1` |
| `stages-transferred` | `side` | `吸取` |
| `stages-cleared` | `side` | `清除` |
| `effect-applied` | `side`, `name:"烧伤"` | `「烧伤」` |
| `effect-faded` | `side`, `name:"烧伤"` | `消退` |
| `control-immune` | `side` | `免疫` |
| `switch` | `side` | `换人` |
| `revive` | `side` | `重新站` |
| `action-failed` | `side` | `无法行动` |
| `missed` | `side`, `moveId` | `没有命中` |
| `protected` | `side` | `保护` |
| `pp-delta` | `side`, `delta:1`，再多塞 `moveId:"secret-move"` | `PP变化`，且整句不含 `secret-move` |
| `struggle-used` | `side` | `挣扎` |
| `ko` | `side` | `倒下` |
| `battle-end` | `reason:"ko"` | `击倒` |
| `soulmark` | `side`, `name`, `mark`, `effect:"endure"` | `保留了 1 点体力` |

再两条锁行为，不是锁覆盖率：

- `effect-applied` 同时带 `name:"烧伤"` 和 `kind:"SHOULD_NOT_SHOW"`。返回值含 `烧伤`，不含 `SHOULD_NOT_SHOW`。`effect-faded` 同样。
- `{ type: "pp-spent" }` 返回 `""`。不要把它改成一句战报。

测试从 `PUBLIC_TYPES` 循环生成「每个公开类型至少一条」。上面的表就是这 20 条的具体字段。新增公开类型时，这张表不更新则测试失败，逼人补一条播报夹具。

### 4. 负例放进测试，不靠手改后还原

`tests/contracts/event-sync.test.ts` 导入 `eventSyncErrors`。仓库现状必须返回空数组。再构造三份只在内存里改过的输入，不写回文件：

- 从类型集去掉 `protected` → 错误信息里有 `protected`。
- 给 `pp-delta` 的 schema 字段加上 `moveId` → 错误信息里有 `moveId`。
- 从 `ZH_EVENT` 去掉 `soulmark` → 错误信息里有 `soulmark`。

不要在工作区里临时删 `PUBLIC_TYPES` 再还原。那种步骤会把半截改动留在树上。

### 5. 清单里的「新公开事件」步骤

写进 `docs/extension-checklist.md`，顺序固定：

1. 改 `packages/contracts/schemas/public/event.schema.json` 的 `oneOf`，加一支。`properties.type.const` 是类型名。不要把 `type` 写进白名单字段。
2. 若引擎会发它：加进 `CORE_EVENT_TYPES` 和 `CoreEventType`，并加进内部 schema 的 enum。若只是 Host 内部事件：加进内部 enum，并改阶段 1 的那个两位钉，同时确认它不在 `PUBLIC_TYPES`。两种不要混在一个类型上。
3. `node tools/gen-contract-types.ts`。
4. `PUBLIC_FIELDS` 补上这个类型。机制自有事件优先写进该机制的 `eventFields`，不要写进 `events.ts` 的手写表。
5. `ZH_EVENT` 补中文名。`format.ts` 的夹具补一行。
6. `node tools/schema-sync-check.ts` 和 `node node_modules/vitest/vitest.mjs run tests/contracts/event-sync.test.ts tests/client/fmt-event.test.ts` 都过。

### 阶段 1 验收

- `node tools/schema-sync-check.ts` 退出码 0。
- `node node_modules/vitest/vitest.mjs run tests/contracts/event-sync.test.ts tests/client/fmt-event.test.ts tests/contracts/contracts.test.ts tests/host/privacy.test.ts` 通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit` 通过。
- `projectEvent` 的 diff 为空。公开 schema 的 diff 为空。

## 阶段 2：技能句子按家族拆开

只搬家。不改正则，不改 `go` 函数体，不改覆盖率，不改 `tools/soulmark-parse.mjs`。魂印解析同一形状，等这一阶段合并并观察一轮再动。两份大文件不要同一轮搬。

匹配顺序仍是先命中先生效。新句子插在宽规则前面会把旧句子抢走，插在后面则永远匹配不到。

### 2a. 先抽加载期词法，再看 golden

新建 `tools/effects-rules/lex.mjs`。从 `effects-parse.mjs` 顶部把这些名字原样搬过去，并导出：`NUM`、`CN`、`num`、`pct`、`STATS`、`STAT_RE`、`ALL_STATS`、`STAT_CODES`、`AILMENTS`、`AIL_RE`、`frac`、`stageFx`、`TGT`、`tgt`。这个文件禁止 import `effects-parse.mjs`。

`effects-parse.mjs` 改为从 `lex.mjs` 导入同名绑定。`parseEffectText`、`condOf`、`normalizeClause`、`reactWrap` 的函数体不改。然后立刻跑：

- `node node_modules/vitest/vitest.mjs run tests/battle-core/parser/parser-golden.test.ts`
- `node tools/effects-ratchet.ts`

golden 是 `JSON.stringify` 逐字段比较（`tests/battle-core/parser/parser-golden.test.ts`），不是近似。任一输出变化就停，不进入 2b，也不「顺便修解析」。

### 2b. 按现有注释分栏剪切

`RULES` 数组按下面这些已经写在源文件里的注释切开。行号会在 2a 之后挪动，以注释文字为准，不以行号为准。每一段整段剪切到对应文件，不手抄正则。

| 文件 | 源注释 |
|---|---|
| `tools/effects-rules/flags.mjs` | `moveFlags` |
| `tools/effects-rules/ignored.mjs` | `可忽略前缀/碎片` |
| `tools/effects-rules/ailment.mjs` | `异常状态施加` |
| `tools/effects-rules/stages.mjs` | `能力等级` |
| `tools/effects-rules/clear.mjs` | `清除/解除/反转/转移` |
| `tools/effects-rules/heal.mjs` | `回复/吸取` |
| `tools/effects-rules/batch-e6.mjs` | `E6 批` |
| `tools/effects-rules/batch-e5.mjs` | `E5 批：` |
| `tools/effects-rules/batch-e5b.mjs` | `E5b 批` |
| `tools/effects-rules/batch-e5d.mjs` | `E5d 批` |
| `tools/effects-rules/batch-e5e.mjs` | `E5e 批` |
| `tools/effects-rules/batch-e5f.mjs` | `E5f 批` |
| `tools/effects-rules/batch-e5g.mjs` | `E5g 批` |
| `tools/effects-rules/batch-e5h.mjs` | `E5h 批` |
| `tools/effects-rules/penalty.mjs` | `惩罚族/威力随强化级数缩放` |
| `tools/effects-rules/batch-e5c.mjs` | `E5c 批` |
| `tools/effects-rules/deferred.mjs` | `推迟/留档` |
| `tools/effects-rules/timed.mjs` | `timed 窗口` |
| `tools/effects-rules/timed-bare.mjs` | `裸 timed 片段` |
| `tools/effects-rules/attach-damage.mjs` | `伤害修饰（attachDamage）` |
| `tools/effects-rules/attach-all.mjs` | `条件增幅修饰` |
| `tools/effects-rules/misc.mjs` | `换人/PP/杂项` |
| `tools/effects-rules/marks.mjs` | `S4 印记族` |

每个文件 `export` 一个数组。元素仍是 `{ re, go }`，再加 `id`。`id` 形如 `ailment-03`，家族内按剪切后的物理顺序从 `01` 编号。匹配循环不读 `id`，所以 golden 不应因此变化。

`go` 里调用的 `parseEffectText`、`condOf`、`reactWrap` 从 `../effects-parse.mjs` 导入。这是环：家族文件 → 解析器 → `order.mjs` → 家族文件。环只能在运行时调用上成立。家族文件的顶层禁止调用这三个函数。`re:` 要用的常量从 `./lex.mjs` 导入。文件顶部写一行注释说明这件事。若某个家族在顶层就调用了解析器，停止拆分，把那段留在 `effects-parse.mjs`，不要改成惰性包装去「修」环。

新建 `tools/effects-rules/order.mjs`。按今天 `RULES` 的物理顺序 import 并拼接。这是以后唯一允许调整家族之间先后的文件。`effects-parse.mjs` 改为 `import { RULES } from "./effects-rules/order.mjs"`，循环仍是 `for (const rule of RULES)`。

### 2c. 顺序快照

把拼接后的 `id` 数组写入 `tests/fixtures/effects-rule-order.json`。测试比较当前序列和这份快照：长度、顺序、id 唯一。有人在家族文件内部调换两条规则，测试失败，必须同时改快照，并在 PR 说明抢走了哪一句。只改快照、不说明，不算过。

### 阶段 2 验收

- `parser-golden` 与 `effects-ratchet` 的数字和 2a 之前相同。golden 文件的 diff 为空。
- `parseEffectText` 函数体相对 2a 之前没有改写。允许的 diff 只是顶部 import 和 `RULES` 那一段消失。
- 顺序快照测试通过。

golden 有差异就停。不进入阶段 3，不在这一阶段改句子语义。

清单里的「加一句」写成：

- 句子能用现有 op 或现有旗标表达：在对应家族文件末尾加规则，在 `order.mjs` 里把这条放在同家族的宽规则之前，其他家族的相对顺序不动。加一条 golden。
- 不能表达：加一条只返回 `unparsedReason` 的规则，写明缺的是哪一种语义。不要返回没人读的 `flags` 或 `effects`。

## 阶段 3：没人读的旗标，检查要失败

名字存在性不要再做一遍。阶段开始时先重跑 `node tools/effects-compile-check.ts`。若失败数不是 0，停下来把新的失败数和种类记进清单，不要用前缀白名单把它压回 0，也不要放宽 `_compile-failures.json` 里的历史数字。2026-10-03 那份 0 失败只是起点，以重跑结果为准。

新检查放在 `tools/effects-compile-check.ts` 同一进程的后半，或者单独的 `tools/effect-flag-readers.ts` 并由编译检查调用。退出码仍是「有失败则 1」。

收集 `packages/battle-core/src/ops/effects.ts` 里 `EffectDef` 的字段名。跳过 `zh`（只是中文标签）。一个旗标算「有读取」当且仅当 `packages/battle-core/src` 里出现下面之一：

- `effectDefOf(...)?.旗标名`，或同一文件里等价的可选链读取。
- 动态读取，只认两处，写死在检查里并注明行号意图：`effectTickAmount` 的 `kind: "dot" | "hot"` 配合 `?.[kind]`，所以 `dot` 和 `hot` 算已读；`effectMul` 的 `key: "accMul" | "atkMul"` 配合 `?.[key]`，所以这两个算已读。不要把任意 `?.[key]` 都当成「全部旗标已读」。

没有读取的旗标必须出现在 `effects.ts` 里新建的 `DEFERRED_FLAGS` 集合中，集合元素是旗标名，不是效果 id。第一跑会列出当前没人读的名字。把这些名字放进集合，每个名字旁一行注释「尚无结算读取」。不要在这一阶段给它们补结算，不要改 `damage.ts`。

以后新旗标只有两条路，写进清单：

- 沿用已有读取。例如又一行 `dmgReduceFlat: "params"`，`effects.ts` 里已经有对 `dmgReduceFlat` 的求和。
- 放进 `DEFERRED_FLAGS`，并且解析器对这种句子返回 `unparsedReason`，不要产出该旗标。

禁止第三种：解析成功、表上有键、集合里没有、源码里也没有读取。

负例：在测试里给检查函数一份假的旗标表，含 `noSuchFlag`，且源码扫描结果里没有它。返回的错误里必须有 `noSuchFlag`。不要往 `EFFECT_DEFS` 里提交这个假键。

阶段 3 验收：重跑后的编译失败数不高于本阶段开始时记下的数。`content/synthetic-v2` 若开始时是 0 失败，结束时仍是 0。负例测试通过。没有为了过检查而新增的结算分支。

## 阶段 4：面板注册离开对战循环

目标只是：新的战斗面板 diff 不再落在 `App` 的出招循环旁边。整页不搬。

### 搬哪些，不搬哪些

留在 `main.tsx` 的：`App`、`World`、`Lobby`、`Root`、`screenId`，以及三行 `registerScreen("battle"|"world"|"lobby")`。这三行旁边加一句注释：整页仍在这里，面板不在这里。

搬到 `apps/client/src/battle/panels.tsx` 的：`HiddenStatus`、`ArenaCards`、`BenchRow`、`PostBattle`、`ClaimReward`。JSX 原样剪切。

它们今天读模块级 `qs` 和 `BATTLE`。不要让 `panels.tsx` 在顶层读 `location`，否则 Node 测试一导入就抛。新建 `apps/client/src/query.ts`，导出函数 `pageQuery()`，函数体内才 `new URLSearchParams(location.search)`。`main.tsx` 在现有 21–26 行改为调用一次 `pageQuery()`，得到原来的 `qs`、`BATTLE`、`TOKEN`、`MODE`、`SPEED`、`AUTOPLAY`。面板组件在渲染时调用 `pageQuery()`。URL 在一次页面生命周期里不变，所以和「模块加载时读一次」是同一个结果。不要改这些常量的名字和用法。

`apps/client/src/presentation.ts` 导出 `registerBuiltinPanels()`。按今天的顺序登记，顺序就是渲染顺序：

1. `battle.top` ← `HiddenStatus`
2. `battle.arena` ← `ArenaCards`，然后 `FieldLog`，然后 `ArenaBanners`
3. `battle.hud` ← `CommandDeck`，然后 `BenchRow`，然后 `PostBattle`

`FieldLog` / `ArenaBanners` 来自 `battle/feed.tsx`，`CommandDeck` 来自 `battle/deck.tsx`。`presentation.ts` 不 import `main.tsx`。

`main.tsx` 删掉那 8 行 `registerPanel`，在原来的 `builtinDisposers` 位置调用 `registerBuiltinPanels()`。三行 `registerScreen` 仍在这次调用之前，和现在一样先登记整页。`Root`、`submit`、轮询、`scene` 不动。

### 测试

`tests/client/presentation.test.ts`：先给 `globalThis.location` 一个 `{ search: "" }`，再 import `presentation.ts` 和 `slots.ts`。调用 `registerBuiltinPanels()` 之后：

- `slots.panelEntries("battle.top")` 长度 1
- `battle.arena` 长度 3
- `battle.hud` 长度 3
- `battle.hud` 的三个组件依次是 `CommandDeck`、`BenchRow`、`PostBattle`

这个测试不 import `main.tsx`，所以不覆盖三行整页登记。整页仍由下面的浏览器烟测看。

`pnpm test:ui-smoke` 即 `node --experimental-strip-types tools/ui-smoke.ts`。它要求本机已有 `http://127.0.0.1:8787` 上的构建产物，并用 Playwright 打开大厅、编队、对战、终局、世界。阶段 4 改了会渲染的组件文件，所以这一步要跑，不能只用注册测试代替。步骤：`node tools/build-client.ts`，另开进程起 `node apps/server/src/index.ts 8787`，再跑烟测。连不上、或任一步失败，阶段 4 不算完成。不要把连接失败写成「环境问题，逻辑已过」。烟测会截图到 `artifacts/ui-check/`，那些 png 本来就在脏工作区里，不要为了烟测去提交无关截图。

清单写明：新面板 = 新组件文件 + `presentation.ts` 一行。新整页 = 仍是 `main.tsx` 的 `registerScreen`。需要新公开字段先走阶段 1。

## 阶段 5：机制登记只加测试

`MECHANICS` 维持手写数组。不要改成扫目录自动加载。`sixstat` 必须在 `seals` 之前，按目录名排序会把这个顺序打乱。

新测试 `tests/battle-core/mechanics/mechanics-registry.test.ts`：

- `MECHANICS` 的 `id` 不重复。
- `sixstat` 的下标小于 `seals`。
- `packages/battle-core/src/mechanics/` 下的目录名集合（不含文件 `index.ts`、`types.ts`）等于 `id` 集合。今天应是 `fifth`、`seals`、`sixstat`、`soulmark`。

新机制的完成定义写进清单：测试只通过公开钩子触发。diff 里没有 `engine.ts`。如果做不到，先单独开一个改动：给 `Mechanic` 加一个可选钩子，并在引擎现有循环点调用它。钩子名不能含机制 id。那个改动不带新机制的内容数据。

## 明确排后

`damage.ts` 里命中之后的附加段（吸血、反伤、等量固伤、命中回复、命中降能力）不在阶段 0–5 里。阶段 2 和阶段 3 落地后另开 `docs/damage-riders-plan.md`：一段一个函数，checkpoint 仍在 `damage.ts` 里调用一次，解析器不一起改。

## 实施顺序

1. 阶段 0 和阶段 1 一起做。都是清单和检查，不改对局结果。阶段 1 里剪 `fmtEvent` 是唯一的代码移动，用夹具锁返回值。
2. 阶段 2。先 2a 再 2b。只看 golden、ratchet 和规则顺序快照。
3. 阶段 3。可能给 `DEFERRED_FLAGS` 补名字，不补结算。
4. 阶段 4。注册测试加上浏览器烟测。
5. 阶段 5。

每一阶段可以单独停。阶段 2 的 golden 若变了，不进入阶段 3。阶段 3 若让编译失败数上升，收回新检查或把新失败的句子改回 `unparsedReason`，不靠放宽基线过关。阶段 4 的烟测若失败，不进入阶段 5。

## 实施记录

实施者每做完一个阶段追加一节。验收者只把它当线索，不把它当证据。

格式：

```
### 阶段 N — 未开始
- 改动文件：
- 实际跑过的命令和退出码：
- 未跑的命令和原因：
- 与规格不一致的地方（没有就写「无」）：
```

### 阶段 0 — 已完成（2026-10-04）
- 改动文件：新增 `docs/extension-checklist.md`（8 节：计划 6 条 + 新公开事件步骤 + 新旗标两条路）。
- 实际跑过的命令和退出码：无（纯文档，无行为变化）；逐条核对过引用路径存在（`apps/server/src/plugins/`、`defaultModulesFor`、`mechanics/` 四目录、`tools/content-validate.ts`、`Mechanic` 钩子名逐一比对 types.ts 一致）。第 4/5/8 节引用的 `tools/effects-rules/`、`presentation.ts`、`query.ts`、`DEFERRED_FLAGS` 是阶段 2/3/4 的终态路径，规格本如此。
- 未跑的命令和原因：无。
- 与规格不一致的地方：第 2 节的验收命令规格未写死，选了 `tsc --noEmit`；第 3 节写了「若尚无 mechanics-registry.test.ts 则跑 tests/battle-core 目录」兜底（该测试属阶段 5）。

### 阶段 1 — 已完成（2026-10-04）
- 改动文件：
  - `packages/host/src/events.ts`：末尾 `export { PUBLIC_FIELDS, PUBLIC_TYPES }`（机制合并后导出，`projectEvent` 未动）。
  - `apps/client/src/meta.ts`：`ZH_EVENT` 改导出，补 `"turn-begin": "回合开始"`（本阶段唯一文案改动）。
  - `apps/client/src/battle/format.ts`：新增，`fmtEvent` 函数体逐字搬入，只 import meta.ts 六个名字。
  - `apps/client/src/battle/feed.tsx`：删 `fmtEvent` 定义，`export { fmtEvent } from "./format.ts"` 再导出；import 收窄为 `zhReason`（其余名字只在 fmtEvent 里用）。`main.tsx` import 路径未动。
  - `tools/schema-sync-check.ts`：新增 `EventSyncInput`/`loadEventSyncInput`/`eventSyncErrors` 导出 + `HOST_ONLY_EVENTS`/`ENGINE_PRIVATE_EVENTS` 两颗钉；在 ruleset 检查后调用并累加 `errors`，出口仍是 `process.exitCode`。
  - `tests/contracts/event-sync.test.ts`、`tests/client/fmt-event.test.ts`：新增。
- 实际跑过的命令和退出码：
  - `node tools/schema-sync-check.ts` → 0（PASS）。
  - `node node_modules/vitest/vitest.mjs run tests/contracts/event-sync.test.ts tests/client/fmt-event.test.ts tests/contracts/contracts.test.ts tests/host/privacy.test.ts` → 0（4 文件 91 测试全过）。
  - `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit` → 0。
  - 未跑 `node tools/gen-contract-types.ts`：本阶段未改 schema，按规格不要求。
- 未跑的命令和原因：见上一条末项。
- 与规格不一致的地方：
  - 测试 import `schema-sync-check.ts` 会把既有 op 检查整套跑一遍（stdout 打一遍「schema-sync: PASS」，`process.exitCode` 被置 0）；规格指定函数放该文件，此为其代价，无副作用到断言。
  - 负例用的深拷贝在测试文件内（`clone`），不是规格禁止的「删白名单再还原」。

### 阶段 2 — 已完成（2026-10-04）
- 改动文件：`tools/effects-parse.mjs`（`RULES` 改为从 `./effects-rules/order.mjs` 导入）；`tools/effects-rules/` 下 `lex.mjs`、`order.mjs`、`order.d.mts` 和 23 个家族文件；`tests/fixtures/effects-rule-order.json`；`tests/battle-core/parser/effects-rule-order.test.ts`。`tools/soulmark-parse.mjs` 未改。
- 实际跑过的命令和退出码：
  - `node node_modules/vitest/vitest.mjs run tests/battle-core/parser/parser-golden.test.ts tests/battle-core/parser/effects-rule-order.test.ts`（同批还有旗标、面板、机制登记测试）→ 0。其中 parser-golden 351、规则顺序 1。没有跑 `effects-golden.ts` 去改写夹具。
  - `node tools/effects-ratchet.ts` → 0。`coverage=91.1% (base 90.9%) fully=45840 (base 45730) top50NoReason=0 (base 15)`，`ratchet PASS`。没有 `--update-baseline`。
  - `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit` → 0（补了下面的声明之后）。
- 未跑的命令和原因：没有一份拆分前的 golden 文件副本可做字节 diff。夹具测试 351 条对上现有 `tests/fixtures/parser-golden.json`，且本阶段没有更新该夹具。
- 与规格不一致的地方：新增 `tools/effects-rules/order.d.mts`，只声明 `RULES: { id: string }[]`。否则顺序测试导入 `order.mjs` 时 tsc 报 TS7016。声明不参与运行时匹配。

### 阶段 3 — 已完成（2026-10-04）
- 改动文件：`packages/battle-core/src/ops/effects.ts` 在 `EffectDef` 后增加 `DEFERRED_FLAGS`，唯一元素 `"reactive"`（注释：尚无结算读取；`fireReactive` 按 `kind==="react"` 派发，不读该字段）；`tools/effect-flag-readers.ts`；`tools/effects-compile-check.ts` 在写报告前并入 `UNREAD_FLAG`；`tests/battle-core/ops/effect-flag-readers.test.ts`。没有改 `damage.ts`，没有给 `reactive` 补结算，没有把 `noSuchFlag` 写进 `EFFECT_DEFS`。
- 实际跑过的命令和退出码：
  - `node tools/effects-compile-check.ts` → 0。`checked=53697 failures=0 emptyMoves=1145(flags=100,unparsed=1045)`。工具会重写 `content/claims/_compile-failures.json`，失败数仍是 0，没有放宽基线。
  - `node node_modules/vitest/vitest.mjs run tests/battle-core/ops/effect-flag-readers.test.ts` → 0（2 条：仓库内未读集合为空；假旗标 `noSuchFlag` 会被报出）。类型收窄之后重跑过一次，仍是 0。
- 未跑的命令和原因：本轮记录的是接上 `UNREAD_FLAG` 之后的那次编译检查。失败数是 0，不高于计划起点的 0。
- 与规格不一致的地方：`effectDefFlags` / `deferredFromSrc` 对正则捕获组做了 `undefined` 收窄，否则 `noUncheckedIndexedAccess` 下 tsc 报 TS2532/TS2345/TS2322。扫描结果不变。

### 阶段 4 — 已完成（2026-10-04）
- 改动文件：新增 `apps/client/src/query.ts`（`pageQuery()`）、`apps/client/src/presentation.ts`（`registerBuiltinPanels`）、`apps/client/src/battle/panels.tsx`（`HiddenStatus`、`ArenaCards`、`BenchRow`、`PostBattle`；`ClaimReward` 不导出）；`apps/client/src/main.tsx` 改为调用一次 `pageQuery()`，删掉 8 行 `registerPanel`，在三行 `registerScreen` 之后调用 `registerBuiltinPanels()`；`tests/client/presentation.test.ts`。
- 实际跑过的命令和退出码：
  - `node node_modules/vitest/vitest.mjs run tests/client/presentation.test.ts` → 0（1 条）。
  - `node tools/build-client.ts` → 0（`apps/client/dist/client.js`）。
  - `node apps/server/src/index.ts 8787` 起服务，`http://127.0.0.1:8787/` 应答后跑 `node --experimental-strip-types tools/ui-smoke.ts` → 0。`11 pass / 0 fail`（大厅、编队、对战、终局、世界、领奖、回世界）。烟测结束后已停掉该服务。截图写在 `artifacts/ui-check/`，未提交。
- 未跑的命令和原因：无。
- 与规格不一致的地方：`location = { search: "" }` 写在测试函数里、`registerBuiltinPanels()` 之前，而不是写在 import 之前。ESM 不允许语句出现在 import 前。面板不在模块顶层读 `location`。`presentation.ts` 不 import `main.tsx`。

### 阶段 5 — 已完成（2026-10-04）
- 改动文件：新增 `tests/battle-core/mechanics/mechanics-registry.test.ts`。`MECHANICS` 仍是 `mechanics/index.ts` 里的手写数组，没有改成扫目录。`engine.ts` 没有因本阶段加机制名分支。清单第 3 节的运行命令去掉了「若尚无该测试则跑整个 battle-core」的兜底。
- 实际跑过的命令和退出码：`node node_modules/vitest/vitest.mjs run tests/battle-core/mechanics/mechanics-registry.test.ts` → 0（1 条：id 不重复，`sixstat` 下标小于 `seals`，目录名 `fifth`/`seals`/`sixstat`/`soulmark` 与 id 集合相同）。烟测 11/0 通过之后才把本阶段标完成。
- 未跑的命令和原因：无。
- 与规格不一致的地方：无。

## 验收时独立重跑

验收者不改生产代码，除非发现规格本身写错。对实施者声称已完成的阶段，至少重跑该阶段「验收」一节里的命令，并核对下面这些不变量：

| 阶段 | 必须仍成立 |
|---|---|
| 0+1 | `projectEvent` 函数体无行为差；公开 schema 无 diff；`pp-delta` 公开字段仍只有 `side` 和 `delta`；`decision-opened` 与 `input-received` 仍不在公开类型里；`fmtEvent` 对 `pp-spent` 仍返回空串；`turn-begin` 播报仍是「第 N 回合」，不是新加的中文表值 |
| 2 | `tests/fixtures/parser-golden.json` 无 diff；`tools/soulmark-parse.mjs` 无 diff；`parseEffectText` 函数体无语义改写 |
| 3 | 编译失败数不高于该阶段开始时的记录；`damage.ts` 无 diff；没有为了过检查新增的结算分支 |
| 4 | `presentation.ts` 不 import `main.tsx`；三行 `registerScreen` 仍在 `main.tsx`；面板顺序仍是 top 1 个、arena 3 个、hud 为 CommandDeck、BenchRow、PostBattle；烟测真实跑过 |
| 5 | `MECHANICS` 仍是手写数组，不是扫目录；`sixstat` 仍在 `seals` 之前；`engine.ts` 无因本阶段产生的机制名分支 |
