# Seer Reborn

**第一目标：一条实现按触点预算改，能少就少。**

上限写在 [触点预算](plans/touch-budget.md)。一处做得到就只动一处；做不到就停在该档上限，不要再加文件。超出预算的改动不要做。句子现有钩子和 op 写不出，就停在未解析，或者单独开一个契约改动。不要为了覆盖率再加一种专属 flag、一个新参数、一条解析正则和一段结算 `if`。覆盖率不是完成。

这条规则压过本文件以外的旧说法。旧文档里「万物可插件 / 已经是插件」如果和这里冲突，以这里为准。触点预算是这条规则的上限，不是另一套目标。

## 各档最少动哪里

| 想加的东西 | 只许动 | 不算一处 |
|---|---|---|
| 已有 op 能表达的精灵、招式、魂印子句 | `content/<pack>/` 的数据 | 改解析器、schema、引擎 |
| 已有钩子能写的一整族机制 | `packages/battle-core/src/mechanics/<id>/` + `mechanics/index.ts` 的 `MECHANICS` 一行 | 在 `engine.ts` 里写这个机制的名字 |
| 一个服务端域 | `apps/server/src/plugins/<name>.ts` + `defaultModulesFor` 一行 | 往别的域的文件里塞路由 |
| 一个战斗面板（观察里已有字段） | 新组件 + `apps/client/src/presentation.ts` 一行 | 改 `main.tsx` 的出招、轮询、场景 |
| 一个新 op、新公开事件、新旗标、新魂印 flag | 先停。这是契约改动，按 [扩展清单](docs/extension-checklist.md) 走完每一处，不叫插件 | 在 `SoulFlagOp` 或 `tools/soulmark-parse.mjs` 里加第 N 种专属语义 |

战斗规则是编译期登记，不是局中热插拔。旧对局靠 `executableHash` 隔离。服务端域可以卸载；一条技能语义不能。

删掉一条实现必须是反向的同一档：删目录、删注册行、或删数据。还要同时改联合类型、schema、解析器和结算分支的，就还不是这一档。

## 目录

源码只有这些顶层目录。根目录上的 `_*`、`tmp-*`、`fix-*.mjs`、`--*` 是本地探针或误把参数当成路径生成的，放进 `scratch/`，不进仓库，也不是结构的一部分。

| 目录 | 是什么 | 增删时动哪里 |
|---|---|---|
| `apps/server` | Cordis 插件装配的 Host。一个域一个文件 | `src/plugins/` + `src/index.ts` 的 `defaultModulesFor` |
| `apps/client` | 战斗 UI。面板走注册表 | `src/presentation.ts`、`src/slots.ts` |
| `packages/battle-core` | 确定性规则。机制在 `src/mechanics/<id>/`，op 在 `src/ops/` | 见上表。引擎只扫 `MECHANICS` 和 `OPS` |
| `packages/host` | 对局协议、投影、回放、代际 | 新公开事件还要改契约，不是只改这里 |
| `packages/contracts` | 线协议 schema 和生成类型 | 机制模块不拥有线格式 |
| `packages/agent` | 决策循环和模型适配 | 新模型实现同一个 `generate` |
| `packages/world` | 地图、存档、任务 | 世界服务 |
| `content/` | 规则包、图鉴、schema | 能被现有 op 表达的内容只改这里 |
| `tools/` | 校验、解析、构建。不是玩法 | 新句子进 `tools/effects-rules/` 的家族文件，顺序只改 `order.mjs` |
| `tests/` | 产品测试。规则在 [tests/README.md](tests/README.md) | 按被锁的边界放，不平铺 |
| `experiments/` | Cordis 适配、确定性、渲染的实验和它们自己的测试 | 实验自测留在实验旁边 |
| `docs/` | 架构和清单。操作以 [扩展清单](docs/extension-checklist.md) 为准 | 不在文档里发明第二套触点 |
| `plans/` | 结构性计划。一份一个文件 | 一条实现最多动几处见 [触点预算](plans/touch-budget.md)。贵档要改哪些文件仍以扩展清单为准 |
| `artifacts/` | 阶段报告和截图 | 不放源码 |

`packages/battle-core/src/mechanics/index.ts` 写明了：机制注册是编译期静态组合。`packages/battle-core/src/ops/index.ts` 写明了：新 op 仍是五处。触点预算不再把这五处收成一处。目标仍是少进这两张闭集。

## 测试

产品测试只在 `tests/`。目录和命名规则、以及什么改动不许伪装成测试，写在 [tests/README.md](tests/README.md)。`tests/structure.test.ts` 锁住这个形状，平铺回 `tests/battle-core/*.test.ts` 会失败。

## 命令

```bash
node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit
node node_modules/vitest/vitest.mjs run tests/structure.test.ts
node tools/content-validate.ts content
node apps/server/src/index.ts 8787
```

本机 `pnpm` 启动器可能和 `package.json` 里的 `pnpm@12.6.0` 不一致。门禁用 `node` 直接跑。脚本名只是对照，见 `package.json`。

## 还不宣称

- 局中热替换规则，或同进程插件是安全沙盒。
- 中文技能文本或魂印文本是插件。它们是一条有顺序的匹配链。
- 一只精灵「子句 100%」等于下一条子句只改一处。
