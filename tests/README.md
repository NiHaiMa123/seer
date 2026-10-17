# 测试目录和规则

产品测试只放在 `tests/`。实验自己的测试留在 `experiments/<name>/tests/`，不搬进来。

`tests/structure.test.ts` 检查下面的形状。把文件放错地方，这条会失败。

## 目录

第一层是被锁的包或应用，不是里程碑，也不是日期。

```
tests/
  structure.test.ts     只锁本文件描述的形状
  fixtures/             夹具。新的大段 JSON、HTML 放这里，按边界分子目录
  e2e/                  浏览器整条路径，文件名 *.spec.ts
  agent/                packages/agent
  battle-core/          见下一节，不许再平铺
  client/               apps/client
  content/              图鉴解析等内容工具
  contracts/            线协议
  host/                 packages/host
  server/               apps/server 的插件和路由
```

`battle-core` 下面只有这五格。新文件必须进其中一格。

| 目录 | 锁什么 | 不锁什么 |
|---|---|---|
| `mechanics/` | 一个机制家族、登记表、魂印钩子派发 | 中文句子怎么切 |
| `ops/` | 一个 op、一段结算、一个旗标有没有人读 | 新句子的正则 |
| `parser/` | 中文句子到 IR。技能规则顺序、魂印文本解析 | 打完整回合 |
| `engine/` | 加载、回合、切换、确定性、泄漏、合成规则 golden | 某一只真实精灵的图鉴快照 |
| `content/` | 真实语料包能装载，并用固定种子打出一份快照 | 单条 op 的公式 |

现有文件名里的 `-v2`、`T6` 是历史名字，不要再加。新文件用行为命名：`tests/battle-core/<组>/<行为>.test.ts`。

## 规则

1. 一个文件只锁一个边界。跨边界的回归放进它真正会失败的那一格，不建 `misc/`。
2. 夹具只放 `tests/fixtures/`。测试里可以写短的合成句。整段事件流、整页 HTML、上百条解析样本不要写进测试文件。
3. 从 `tests/<域>/<组>/` 引用仓库根用 `../../../`。内容目录的惯用写法是 `join(fileURLToPath(new URL("../..", import.meta.url)), "..", "content")`。不要写绝对路径，不要把夹具复制进测试目录。
4. 没有 `.test` / `.spec` 的辅助模块和用它的测试放同一目录。现在是 `tests/host/legacy-executable.ts`、`tests/contracts/projection-fixture.ts`。
5. 测试不引入新语义。为了让一句中文变绿而加 flag、加 op、改 schema、加 `SoulFlagOp` 分支，那不是测试改动，先停。
6. e2e 只测浏览器里的整条路径，不测单条 op。Playwright 的匹配是仓库里的 `*.spec.ts`。
7. 不在仓库根、`tools/`、`packages/`、`apps/` 里放 `*.test.ts` 或 `*.spec.ts`。
8. 旧计划文档可能还写着搬动前的路径（`tests/battle-core/parser-golden.test.ts` 这种）。以这个目录和 `structure.test.ts` 为准。

## 跑

```bash
node node_modules/vitest/vitest.mjs run tests/structure.test.ts
node node_modules/vitest/vitest.mjs run tests/battle-core/mechanics
node node_modules/vitest/vitest.mjs run tests/battle-core/parser/parser-golden.test.ts
```

一组测试就是一个目录。不要再把新测试的路径写回 `tests/battle-core/*.test.ts`。
