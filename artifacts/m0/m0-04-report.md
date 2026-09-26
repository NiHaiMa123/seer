# M0-04 执行报告：确定性基础

日期：2026-09-26。基线：`315937a`（M0-03 提交）。任务卡见 [roadmap](../../docs/roadmap.md) §2 / [battle-engine](../../docs/battle-engine.md) §5。

## 交付物（experiments/determinism/，可删除 PoC）

- `src/rng.ts` — xoshiro128**（S15 候选；非密码学，PVP 前换 ChaCha20）。128-bit hex seed → 4×u32；禁全零；每次 draw 记录 `{purpose,seq,value}`；`drawBelow(n)` 用**拒绝采样**（无取模偏差），上界 64 次迭代超限报 fault。
- `src/sha256.ts` — 纯 TS SHA-256（同步、跨运行时一致；另有 node:crypto 交叉验证）。
- `src/transition-fixture.ts` — 最小 transition（非真实 core）：速度排序/平速命名 draw、KO 终局、`fault` 输入触发原子性失败。
- `tests/determinism.test.ts` — 41 断言；`tests/browser.spec.ts` — Chromium 字节一致。
- `vectors.json` — 冻结向量（3 组 seed×8 draws + 2 组端到端 transition canonical+hash）。
- `tools/build-det-bundle.ts` — esbuild 打包浏览器 payload。

## 验收命令与结果

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 新增 `@playwright/test@1.63.0`（9-04 发布）、`esbuild@0.28.2`（8-08 发布）；`pnpm-workspace.yaml` 登记 `allowBuilds: esbuild:true` |
| `pnpm test:determinism` | 0 | **41 断言**（要求 ≥20）：向量冻结、BigInt 独立实现交叉验证、种子边界、拒绝采样边界（n=1/2³²/非 2 幂/非法）、canonical 键序/NFC/ASCII/`-0`/非有限/非 safe-int 拒绝、frozen 输入、fault 原子性、终端拒绝 |
| `pnpm test:determinism:browser` | 0 | esbuild iife bundle → Chromium headless 153：3 个 seed × 4 turns，canonical 字符串与 sha256 与 Node 逐字节一致 |
| 其余 gate（typecheck / content / contracts / boundaries / contracts+privacy+plugin tests） | 全 0 | 无回归 |

## 修正记录

- `drawBelow`：`x & mask` 在 n=2³² 时产生符号位负值 → `>>>0` 归一化（mask 与结果均）。新增 n=2³² 边界断言覆盖。
- transition fixture 初版把 `hp<0` 当 fault → 按 synthetic-v1 §4 改为 `Math.max(0, ...)` 钳制。
- `canonicalJson` 补 safe-integer 拒绝（文档要求整数域；`1.5`/`2^53+1` 现会被拒）。

## 诚实边界

- vectors.json 是本实现自冻结（回归稳定性），sha256 有公开向量+node:crypto 独立验证，xoshiro 有 BigInt 参考实现交叉验证；无上游官方向量套件。
- 字节一致仅验证 Chromium 153 headless；未测 WebKit/Firefox/Worker。
- 该 fixture 是 tiny fixture——不报告真实 core 吞吐（M1-05 才测 battle-core 性能）。

## 后续输入（M0-05 渲染 PoC / M0-06 汇总）

RNG/canonical/sha256 三原语定型，M1-01 可原样升入 `packages/battle-core`；`internalSha256=sha256hex(canonicalJson(InternalState))` 的配方已验证。
