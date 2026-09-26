# M0-01 执行报告：工作区与规则边界

日期：2026-09-26。基线：main `ce6c301fdb0aeb5dd89e1b345b04042927746892`（含已合并的架构审查分支）。任务卡见 [roadmap](../../docs/roadmap.md) §2/§5。

## 环境

- Windows（git-bash），Node v24.18.0，pnpm 12.6.0（`packageManager` / `engines` 锁定），npm registry 可达。
- devDeps 精确锁定：typescript 6.0.3、ajv 8.17.1、@types/node 24.13.5。
- 注：@types/node 24.19.0 发布不足 24h，触发 pnpm `minimumReleaseAge` 策略；改用 24.13.5（发布 >7 天），未保留自动豁免项。

## 交付物

| 产物 | 路径 |
|---|---|
| pnpm workspace / 精确 lock | `pnpm-workspace.yaml`、`pnpm-lock.yaml`（含 supply-chain policy 校验） |
| Node / TS 基线 | `.node-version`（24.18.0）、`tsconfig.json`（strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess）、`.npmrc`（engine-strict、save-exact） |
| 工程规则规范 | `docs/rules/synthetic-v1.md`（2 单位 × 4 动作：普通攻击/先制低伤/强化/回复；公式、舍入、平速判定、失败消耗、struggle、KO/终局/回合上限；封闭 IR 3 op） |
| 规则工件 | `content/rulesets/synthetic-v1.json`（operatorAllowlist、limits、rng algorithmId） |
| 内容包 | `content/synthetic-v1/`（pack.json + units.json + moves.json，CC0-1.0 public） |
| 原作 claim 模板 | `content/claims/_template.claim.json` + `README.md`（`_` 前缀不参与校验） |
| JSON Schema 真源 | `content/schemas/{ruleset,pack,units,moves,claim}.schema.json`（draft-07，additionalProperties=false） |
| 校验脚本 | `tools/content-validate.ts`（Node 24 原生 type stripping 运行，无构建步骤） |

未创建无消费者目录：`packages/`、`apps/`、`experiments/` 仅作为 workspace glob 预声明；`contracts` 正式包属 M0-02，Cordis/render 实验属 M0-03/M0-05。

## 验收命令与结果

| 命令 | exit code | 结果 |
|---|---|---|
| `pnpm install` | 0 | 8 packages，生成 pnpm-lock.yaml |
| `pnpm install --frozen-lockfile` | 0 | "Lockfile passes supply-chain policies / up to date" |
| `pnpm typecheck` | 0 | tsc strict 通过（tools + docs/examples/contracts.ts） |
| `pnpm content:validate` | 0 | PASS：4 files checked，0 findings，packs=[synthetic-v1/SYNTHETIC] |
| `pnpm content:validate:selftest` | 0 | 7/7 PASS |

selftest 覆盖的拒绝路径（临时 fixture 构造，非仓库文件）：

| fixture | 预期拒绝 | 实际 |
|---|---|---|
| valid-baseline | 无 findings | PASS |
| missing-field（unit 缺 spd） | SCHEMA | PASS |
| unknown-operator（`drain_soul`） | UNKNOWN_OPERATOR | PASS |
| public-license-unclear（identifier=UNKNOWN） | LICENSE | PASS |
| dangling-move-ref | REF | PASS |
| bad-claim-verification（PROBABLY） | SCHEMA | PASS |
| unknown-ruleset-ref | REF | PASS |

## 原作真实性

`originalClaimsVerified = 0`（VERIFIED=0）。当前仓库无任何 VERIFIED 原作规则、无原作素材导入；synthetic-v1 全部字段 `verification: SYNTHETIC`。

## 范围外 / 未运行（诚实边界）

- Cordis 安装/生命周期（M0-03）、确定性 vectors（M0-04）、渲染基准（M0-05）：NOT_RUN。
- 性能实测（D1/D2/D3 设备）：NOT_RUN，不属于本任务。
- `content:validate` 目前校验结构与静态约束；不执行数值语义（公式正确性由 M1 golden 测试证明）。
- move effect 的 per-op 参数经 schema `if/then` 校验；op 白名单在 ruleset 工件，跨文件检查在 validator 代码中。

## M0-02 输入清单（正式 contracts）

1. 本任务产出：`docs/examples/contracts.ts`（既有设计示例）、`docs/rules/synthetic-v1.md`（领域语义来源）、`content/schemas/`（schema 编写与 if/then 惯例）、Ajv 8.17.1 + TS strict 工具链、validator 的 Finding/code 风格。
2. 需新建（不属本任务）：`packages/contracts/`（public/internal 分入口）、wire 层 JSON Schema 真源→生成 TS 类型→Ajv 编译、`pnpm test:contracts`（≥20 正/反样例）、`pnpm test:privacy`（双秘密状态非干扰 fixture）、`pnpm check:boundaries`（禁 internal→client/agent import）。
3. 现成输入：`contracts.md` §5 错误码表、§1 Command 字段语义（baseRevision/idempotencyKey/decisionId）、contracts.ts 的 Action/Decision/LegalAction 联合类型、§3 非干扰测试定义。
4. 约定沿用：`schemaVersion` 整数、ID 用 `^[a-z0-9][a-z0-9-]*$`、digest 用 `sha256:<64hex>`、verification 四值枚举、`additionalProperties: false` 默认。
