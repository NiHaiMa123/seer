# M1-06 执行报告：demo、CLI、基准、verify:m1 聚合收官

日期：2026-09-26。基线：`0c58499`（M1-05）。任务卡：roadmap §3 M1-06。

## 交付物

| 交付物 | 内容 |
|---|---|
| `pnpm demo:m1` | 零人工干预全序列 demo：create→connect(双端 resync)→submit(脚本动作)→resolve→events→replay→verify，证据落盘 `artifacts/m1/m1-06-demo.json` |
| `pnpm bench:m1` | Host+SQLite 提交吞吐基准 → `artifacts/m1/m1-06-bench.json` |
| `pnpm verify:m1` | 16-gate 聚合（含 e2e、replay:verify、perf:render、demo:m1、git diff --check）→ `artifacts/m1/verify-m1.json` |

## 证据（本轮真实运行）

- **demo**：11 回合 KO（p2 胜）；**57 公开事件 / 112 内部事件**——隐藏类事件不外发有数值证据；replay hash 与在线终局完全一致
- **bench**（Ryzen 9800X3D, Node 24.18.0, win32）：40 局/240 回合，**96 turns/s**，turn-commit 延迟 mean 9.37ms / p95 9.98ms / p99 10.58ms（含 SQLite 事务——非网络、不代表低端机）
- **verify:m1 = 16/16 gates PASS**

## M1 全景（对照 roadmap）

| 任务 | 关键证据 |
|---|---|
| M1-01 battle-core | 29 golden + 10,000 seeded property + EFFECT_LIMIT 恶意夹具原子性 |
| M1-02 host 协议 | 21 协议场景：幂等/冲突/超时默认/ACK 隔离/断点拒绝全过 |
| M1-03 公开投影 | 独立公开流 seq；隐藏事件不涨 cursor；差异秘密态公开字节一致 |
| M1-04 持久化 | SQLite 五表 + 三断点崩溃恢复 + 20 局 replay hash 一致 |
| M1-05 UI/e2e | 双浏览器上下文真实点击到 KO；skip/正常终局一致 |
| M1-06 聚合 | verify:m1 16/16；demo 全序列证据落盘 |

## 诚实边界

- 合成规则集（VERIFIED=0），非原作
- 轮询协议非 WS；token 座位制非真认证；规则 AI 为演示级
- 所有性能数字出自桌面级 RTX 5080/9800X3D，不代表低端机
- Cordis 插件容器仅 PoC 级接入；正式插件装配（ruleset/artifact agents）在 M2
