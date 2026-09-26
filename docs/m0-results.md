# M0 结果汇总

日期：2026-09-26。执行至 `5294a06`（M0-05）+ 本次收敛提交。聚合证据：`artifacts/m0/verify-m0.json`。

## 任务结论

| 任务 | 结果 | 证据 |
|---|---|---|
| M0-01 工程基座 + synthetic-v1 + 内容校验 | **PASS** | `artifacts/m0/m0-01-report.md`；7/7 校验自测；VERIFIED=0 |
| M0-02 正式 contracts（schema→类型→Ajv） | **PASS** | `artifacts/m0/m0-02-report.md`；45 契约用例 + 7 隐私用例 + 边界检查 |
| M0-03 Cordis 薄适配 PoC | **PASS（ADOPT-PENDING→采纳薄适配路线）** | `artifacts/m0/cordis-report.json`；11 用例覆盖全部生命周期门禁 |
| M0-04 确定性基础 | **PASS** | `artifacts/m0/m0-04-report.md`；41 断言 + Node↔Chromium 字节一致 |
| M0-05 渲染/Worker 成本 PoC | **PASS（本机数据，非低配结论）** | `artifacts/m0/render-report.json`；10k sprite 60fps、worker RTT ~0.02ms |
| M0-06 汇总 | **PASS** | `pnpm verify:m0` = 13/13 gate 全绿（本提交 SHA 见 verify-m0.json） |

## verify:m0 覆盖的 gate

`install --frozen-lockfile` · `typecheck` · `content:validate` · `content:validate:selftest` · `contracts:check`（生成物漂移）· `check:boundaries` · `test:contracts` · `test:privacy` · `test:plugin` · `test:determinism` · `test:determinism:browser` · `perf:render` · `git diff --check`

前置环境：Node 24、pnpm 12+、Chromium（`pnpm exec playwright install chromium`，perf 依赖 `--enable-gpu`，缺 GPU 机器会偏慢但不断言阈值）。

## 决策回填

- **ADR-001**：Cordis `4.0.0-rc.10` 满足窄合同（薄适配成立）→ 标记**已采纳（M1 范围）**。上游 `inject` 缺依赖是静默挂起——依赖检查必须在适配层前置；dep 消失→restart 语义已记录，mechanics 插件不在局中依赖它。
- **RNG**：xoshiro128** 通过 M0-04（算法正确性 + 跨运行时一致）。PVP 正式局仍按 §5 换 ChaCha20 流（Q13 未关闭）。
- **数值/编码**：canonical JSON + 纯 TS SHA-256 字节一致已证 → 作为 public/internal hash 配方冻结。
- **渲染**：pixi.js 8.21.0 PoC 通过 → 维持选型；低配结论**不**据此给出。

## 不能声称已完成的事（按规范列出）

- 原作规则/资产：全部 UNVERIFIED，VERIFIED=0；代码许可 Q05 未解决。
- 低配性能 gate：Q06 无实机 → **BLOCKED→NOT_RUN**，不豁免；高性能桌面数字不构成替代证据。
- 真实 battle-core/Host/UI/Agent：未开始（这是设计，不是遗漏）。
- Cordis 生产热替换、DSH vendor 差异、插件市场隔离：范围外/未验证。
- Worker 实际 sim 负载成本、SQLite/SQL 层：未测。

## M1 fixture 清单（M1-01 起可直接用）

- `content/synthetic-v1/`（pack：2 unit × 4 move）+ `tools/content-validate.ts` 生命周期检查。
- `@seer/contracts` 公开/内部双入口 + Ajv validators + `canonicalJson` + `tests/contracts/projection-fixture.ts`（M1-03 真实投影替换 fixture）。
- `experiments/determinism/` 的 `rng.ts`/`sha256.ts`/`transition-fixture.ts` + `vectors.json` → 升入 `packages/battle-core`。
- `experiments/cordis/src/adapter.ts`（PluginHost）→ Host 插件面参考实现。
- `pnpm verify:m0` 聚合命令本身成为 CI 前置。
