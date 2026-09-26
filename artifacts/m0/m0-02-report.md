# M0-02 执行报告：正式 contracts

日期：2026-09-26。基线：`451b79f`（M0-01 提交）。任务卡见 [roadmap](../../docs/roadmap.md) §2。

## 环境

Windows / Node v24.18.0 / pnpm 12.6.0；新增 devDeps 精确锁定：`json-schema-to-typescript@16.0.0`（发布 2026-08-28）、`vitest@5.0.1`（2026-09-15）。未用 vitest 5.0.2（发布不足 24h，会被 minimumReleaseAge 拦截）。

## 交付物

| 产物 | 路径 |
|---|---|
| 契约包 | `packages/contracts/`（`exports`: `.` → `src/index.ts` 公开，`./internal` → `src/internal.ts` 内部） |
| wire JSON Schema 真源 | `schemas/public/`：command、observation、event、manifest、effect、tool、error；`schemas/internal/`：state、event-internal、input |
| 类型生成 | `tools/gen-contract-types.ts`（jstt → `src/generated/**`）；`pnpm contracts:check` 漂移检测 |
| Ajv 校验器 | `validators`（公开 7）/ `internalValidators`（内部 3），Ajv 8.17.1 strict+allErrors |
| canonical 编码 | `src/canonical.ts`：ASCII 键序、NFC、拒绝 NaN/Infinity/-0/非 ASCII 键 |
| 非干扰投影 fixture | `tests/contracts/projection-fixture.ts`（白名单重建，非 spread-删除） |
| 边界检查 | `tools/check-boundaries.ts`：公开入口传递依赖不得达 internal；internal 导入者须在登记清单 |

Command 无 actor/side 字段（身份来自会话）；Observation 的 `ppEstimate` 用 `unknown|exact` union；公共事件 union 与内部事件完全分离；`simulate_batch` 只接受假设不接受 snapshotId——以上均由反例用例验证。

## 验收命令与结果

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | supply-chain policy 校验通过，lockfile 一致 |
| `pnpm typecheck` | 0 | 全仓库 strict（含 generated、tests、docs 示例） |
| `pnpm content:validate` / `:selftest` | 0 / 0 | PASS；7/7 fixture |
| `pnpm contracts:check` | 0 | 生成物与 schema 一致，无漂移 |
| `pnpm check:boundaries` | 0 | 公开入口图不触 internal；internal 导入者 = contracts 自身 + tests |
| `pnpm test:contracts` | 0 | **45 用例**通过（要求 ≥20）：正样本 + 缺字段/未知字段/越界/伪 actor/快照走私/路径穿越/未知 op/枚举越界 |
| `pnpm test:privacy` | 0 | 7 用例：双秘密态 observe/legalActions/publicEvents canonical 字节一致；公开字段差异仍可区分（防假阳性）；投影输出过公开 schema |

## 修正记录（诚实声明）

- `then.required` 触发 Ajv `strictRequired`（moves schema）→ then 内补 `properties` 声明，未降低 strict。
- `type:[a,b]` 触发 `strictTypes` → 改 `anyOf`，未开 `allowUnionTypes`。
- 隐私 fixture 初版误改"观察者己方可见字段"导致假失败 → 拆成按侧变秘密的三态 fixture（A/B/C）。
- generated `minItems` tuple 类型对构造不便 → codegen 加 `ignoreMinAndMaxItems`（wire 校验仍强制 minItems）。

## 范围外

- 这些是 wire/schema 层验证；不证明命令已被授权、动作在回合内合法、引擎确定、真实 Host 无泄露——属 M1+。
- 投影 fixture 是测试替身，不是 Authority 投影实现（M1-03）。
- Cordis 生命周期、RNG vectors、渲染实测仍为 M0-03/04/05 NOT_RUN。

## 后续输入（M0-03 Cordis PoC）

`packages/contracts/` 已存在；PluginManifest schema 与 `PluginContext` 适配面（require/register/own）可直接引用公开类型；实验目录 `experiments/cordis/` 的消费者即 PoC 自身。
