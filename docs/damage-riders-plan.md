# 命中后附加段拆出 damage.ts

状态：已实施（2026-10-04）。本文件仍是验收规格。`docs/blast-radius-plan.md` 把这五段明确排后，不在阶段 0–5 里。阶段 2 和阶段 3 已经落地，这一改动只拆这五段。

不改解析器（`tools/effects-parse.mjs`、`tools/effects-rules/`、`tools/soulmark-parse.mjs`）。不改 `hpCapOf`、复活、吸血封顶公式。不改伤害公式本体（命中结算、护盾、免疫、`fireReactive`、机制 `onDamaged` / `onDamageDealt`）。不把 `checkpoint` 拆进附加段。

## 搬哪些

只搬 `packages/battle-core/src/ops/damage.ts` 里、伤害事件已经写入之后、最后那一次 `checkpoint` 之前的五段。一段一个函数，放进新文件 `packages/battle-core/src/ops/damage-riders.ts`。函数就地改 `unit` / `hit` / `events`，返回 `void`。不在函数里调用 `checkpoint`。`damageOp` 仍在五段和夹在中间的未搬代码之后调用一次 `checkpoint`，返回值保持今天的 `continue` / `terminal` / `{ suspend }`。

调用顺序就是今天的源码顺序。中间没点名的三段留在 `damage.ts`：

1. `applyDrainRider` — `drain`、`drainIf`、`drainMul`、`drainTo`、`drainFlat`、`drain_atk`（含 echo 与 `params.count`）、`drainEcho`。`drained` 只在这个函数里累加，`drainEcho` 仍读它。入参含本击 `dmg` 和 `kindEff`（`drainAtkFracs` 要伤害类型）。
2. `applyReflectRider` — `counter` 倍率、`dmgReflect`（含 `params.count`）、`critReflect`、`counterFlat`。入参含 `crit`。
3. `applyFlatEcho` — 只搬 `flatEcho`。
4. 留在原地：`shieldEcho`。
5. `applyHealOnHit` — 只搬 `healOnHit`。
6. 留在原地：`flatOnHit`、`ailmentOnHit`。
7. `applyStageOnHit` — 只搬 `stageOnHit`。仍调用 `statStageOp`，忽略它的返回值（今天就是这样，能力下降不会单独把对局打成终局）。
8. 留在原地：`checkpoint`。

不搬：

- 伤害数字算完之前的 `flatPerStage.drain`（那是固伤并入本击，不是命中后附加段）。
- 低伤免疫里的 echo（`cause: "reflect"` 但发生在扣血之前）。
- `recoilFrac`（反噬，写在伤害事件之前）。
- `shieldEcho`、`flatOnHit`、`ailmentOnHit`。

函数体逐段剪切，不改分支、不改 `Math.floor`、不改 `hpCapOf`。`damage.ts` 里对应位置换成一次调用，注释留一句指向函数名。

## 测试先于剪切

已有、剪切前后都要仍过的：

- `tests/battle-core/ops/effects-v3.test.ts` 的 `drain：按实伤分数回自身`、`drain_atk`、`reflect_dmg params.count=1`、`crit_reflect`、`counter mul:1`。
- `tests/battle-core/engine/audit-regressions.test.ts` 的 `吸血封顶到 hpCapOf`。期望仍是体力不超过 50，不是把封顶拆松。

剪切前先写 `tests/battle-core/ops/damage-riders.test.ts`，对着还没拆的 `damage.ts` 跑绿，再剪切，再跑绿。用 `loadPackFromDir` 的独立 pack，改 `syn-strike` 的 effects，不改 `content/`，不改解析器。双方摘魂印、关复活。p1 速度抬高，p2 出 `syn-purge-mind`（自身 cleanse，不打出伤害、不改能力等级）。

这条测试锁顺序，少一个或换序就失败。一击同时带 `drain` 1/1、`drainEcho`、`flatEcho` 全额、`healOnHit`、`stageOnHit` 防御 -1，受击方带 `reflect_dmg` 1/1。关心的事件子序列必须是：

`hit` → `drain` → `echo`（吸血等量）→ `reflect` → `echo`（等量固伤）→ `heal_on_hit` → `stat-stage(def)`

另外三条，避免只靠顺序测试蒙混数值：

- `flatEcho.pct: 50`：第二笔 `cause: "echo"` 的 amount 等于 `floor(本击伤害 / 2)`。
- `healOnHit` 1/2，且当前体力离 `hpCapOf` 只差 3：治疗量是 3，不是 `floor(最大体力 / 2)`。
- `stageOnHit` 防御与特防各 -1：两级都落到 -1。

## 验收

- `node node_modules/vitest/vitest.mjs run tests/battle-core/ops/damage-riders.test.ts tests/battle-core/ops/effects-v3.test.ts tests/battle-core/engine/audit-regressions.test.ts` 退出码 0。
- `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit` 退出码 0。
- `git diff` 不出现 `tools/effects-parse.mjs`、`tools/effects-rules/`、`tools/soulmark-parse.mjs`、`content/`。
- `damage.ts` 的 diff 只有：导入五个函数、五段调用替换原内联、不再使用的导入删掉。伤害公式、`checkpoint` 调用点、`shieldEcho` / `flatOnHit` / `ailmentOnHit` 的函数体不动。

清单 `docs/extension-checklist.md` 第 1 节加一句：改这五段行为时改 `ops/damage-riders.ts` 里对应函数，并先有该段测试。新精灵仍不许为了过关去改 `damage.ts` 的公式。

## 实施记录

### 已完成（2026-10-04）
- 改动文件：新增 `packages/battle-core/src/ops/damage-riders.ts`（`applyDrainRider`、`applyReflectRider`、`applyFlatEcho`、`applyHealOnHit`、`applyStageOnHit`）；`packages/battle-core/src/ops/damage.ts` 改为按原顺序调用，`shieldEcho` / `flatOnHit` / `ailmentOnHit` 和最后一次 `checkpoint` 留在原地；新增 `tests/battle-core/ops/damage-riders.test.ts`；`docs/extension-checklist.md` 第 1 节补了这五段的触点。解析器和 `content/` 未改。
- 实际跑过的命令和退出码：
  - 剪切前 `node node_modules/vitest/vitest.mjs run tests/battle-core/ops/damage-riders.test.ts` → 0（4 条，对着还没拆的 `damage.ts`）。
  - 剪切后同一命令，加上 `tests/battle-core/ops/effects-v3.test.ts`、`tests/battle-core/engine/audit-regressions.test.ts` → 0（3 文件 150 条）。吸血封顶那条仍在里面。
  - `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false --noEmit` → 0。
- 未跑的命令和原因：无。
- 与规格不一致的地方：`applyFlatEcho` 不接收 `selfHit`。原条件不用它。
