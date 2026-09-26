# M0-03 执行报告：Cordis 薄适配 PoC

日期：2026-09-26。基线：`6f84b24`（M0-02 提交）。上游工件：`cordis@4.0.0-rc.10`（npm，integrity 见 [cordis-report.json](cordis-report.json)）。

## 交付物

- `experiments/cordis/src/adapter.ts` — PluginHost 薄适配：manifest 校验、capability 白名单、requires 前置检查（缺依赖/自依赖循环）、staged 失败回滚、幂等 unload、`disposeAll` 覆盖 pending。唯一 import cordis 的包。
- `experiments/cordis/tests/plugin.test.ts` — 11 用例覆盖门禁项。
- `artifacts/m0/cordis-report.json` — 探测到的上游语义、API 面、决策与限制。

## 验收命令

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | lockfile 一致（cordis rc.10 精确锁入） |
| `pnpm typecheck` | 0 | 含 adapter/tests |
| `pnpm test:plugin` | 0 | 11/11：缺依赖、冲突、循环、失败清理、异步重入、重复 dispose、cleanup 注册拒绝、100 cycles 回基线 |
| `pnpm contracts:check` / `check:boundaries` / `content:validate` / `test:contracts` / `test:privacy` | 0 | 无回归 |

## 关键探测发现（详表见 JSON）

- 上游 `inject` 缺依赖**静默挂起**而非报错 → 适配层必须前置检查（已实现）。
- 上游对重复 provide、dispose 中注册、重复 dispose 均有正确行为（抛错/幂等）。
- 依赖消失→插件挂起、恢复→**自动 restart**：M2 对 mechanic 插件评估此语义；synthetic 期不依赖。

## 诚实边界

PoC 通过 ≠ 生产可用声明：未做不可信代码隔离（按设计不在首期）、未验证 DSH vendor 差异、未做真实 profile/bundle 文件装载。结论 ADOPT-PENDING，由 M0-06 汇总判定。
