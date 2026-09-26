# M1-05 执行报告：React+Pixi 客户端、HTTP 权威端、e2e

日期：2026-09-26。基线：`26ad279`（M1-04）。任务卡：roadmap §3 M1-05。

## 交付物

| 组件 | 内容 |
|---|---|
| `apps/server/` | `startServer`：node:http JSON API（`POST /api/battle` 建局发两座 token；observe/history/resync/submit/ack）；静态服务 client build；`?slow=ms` 测试注延迟入口 |
| `apps/client/` | React 19.2.8 UI 壳（legalActions 按钮/状态/日志/速度+跳过）+ `BattleScene`（Pixi 双精灵 HP 条 + 事件驱动动画队列 + speed/skip）+ `BattleClient`（轮询 250ms + resync + ack）+ 规则 AI（`?mode=ai`） |
| `tools/build-client.ts` | esbuild 打包（jsx automatic）→ `apps/client/dist/client.js` |
| `tests/e2e/battle.spec.ts` | 4 个 Playwright 场景 |

**契约演进**：公开 Observation 增加 `terminal: {result,reason}|null`——终局结果本属公开信息，客户端此前无法得知。

## 验收（对照任务卡）

| 验收点 | 结果 |
|---|---|
| `test:e2e` 两浏览器上下文对局到终局 | ✅ 双 context 各自点击按钮 → turn 6 KO（p2 胜），两侧 terminal 一致 |
| 跳动画与正常播放 hash 相同 | ✅ 同 seed 两局（speed 1 vs 8+skip）终局 observe 完全一致 |
| mock 慢工具下 UI 可操作 | ✅ history 注入 2s 延迟，submit 不受影响，对局照常推进 |
| socket/scene cleanup 无重复 listener | ✅ StrictMode 双挂载下连击仅一次生效、无 ERR；页面销毁重建 resync 同视角 |

## 过程中的真实发现

1. **server `readBody` 双读 bug**：submit 路径读 body 两次 → 第二次拿空串 → JSON.parse 抛错 → 所有提交静默 500。被 e2e 当场抓住。
2. **dup-replay 撞 UNIQUE**：幂等重放仍走 `recordReceiptTx` → receipt 主键冲突。修法：persisted 层对 `duplicate-replay` 结果跳过写入（真实持久化层 bug）。
3. **Playwright click actionability 陷阱**：检查 enabled 与 click 之间 React 已重渲染为 disabled → click 默认等 actionability 到测试超时。修法：短超时+catch 重试（竞态属协议非缺陷）。
4. **公开 Observation 缺 `terminal` 字段**——契约补加（客户端/UI 合法需要）。
5. **StrictMode 双挂载是天然 cleanup 测试**：两次 init/destroy 暴露出所有未清理资源——客户端经 destroy(client 清 interval + scene destroy ticker)通过。

## 已知限制（如实）

- 轮询而非 WS push（250ms 延迟，e2e 够用；WS 在 transport 层 M2 时升级）
- token 为一次性座位凭证，非真认证；AI 为演示级规则策略
- `--enable-gpu` 下 headless Chromium（桌面 RTX 5080）——不代表低端机性能
