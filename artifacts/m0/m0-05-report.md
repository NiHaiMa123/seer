# M0-05 执行报告：渲染与主线程成本 PoC

日期：2026-09-26。基线：`d9d6fce`（M0-04 提交）。任务卡见 [roadmap](../../docs/roadmap.md) §2。

## 交付物

- `experiments/render/`：pixi.js **8.21.0**（锁版，2026-09-17 发布）最小场景——1280×720，**10,000 个程序化 sprite**（8×8 生成纹理，无真实资产）。
- `tests/perf.spec.ts`：内置静态服务器 → headless Chromium → 采集 → 写 `artifacts/m0/render-report.json`。
- `pnpm perf:render` 一键复跑；`tools/build-render-bundle.ts` esbuild 打包。

## 实测结果（render-report.json）

| 指标 | 值 |
|---|---|
| 冷启动（模块加载→首帧） | **141 ms** |
| 帧时长 p50 / p95 / p99 | 16.6 / 17.6 / 17.9 ms（240 帧，10k sprite 每帧微动） |
| 平均 fps | **60.06** |
| Worker round-trip | mean 0.02 ms，p95 0.1 ms（500 次） |
| structuredClone ~10KB observation | mean 0.05 ms（500 次） |

环境：headless Chromium 153 + `--enable-gpu`（ANGLE D3D11 → **NVIDIA RTX 5080**）。GL renderer 已记录在 JSON。

## 验收命令

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm perf:render` | 0 | 4.3s 完成；断言 spriteCount=10000、frames≥240、fps>5、workerRtt<50ms |
| 其余全部 gate（install/typecheck/content/contracts/boundaries/4 测试套件） | 全 0 | 无回归 |

## 过程中的真实发现（写入实现注释/报告）

- Playwright headless shell **默认 SwiftShader 软光栅**——`--enable-gpu` 后才走真实 GPU。两者 WebGL renderer 字符串不同，报告记录实测者。
- 软光栅下 10k sprite 全帧重绘会显著拖慢 RAF；perf PoC 一律带 `--enable-gpu`。

## 诚实边界

- 这是**桌面 GPU** 数字，不代表低配门槛结论——performance-plan P-01/P-02 需低配机（Q06）才判定，此前保持 NOT_RUN。
- PoC 不含 React、无 UI 事件、无真实资产解码；冷启动 ≠ 生产首屏。
- Worker RTT 是空消息 echo 下限，非 sim 批量负载成本。
- Pixi 采纳条件仍按 plan：需先卸载干净（本 PoC 不涉及 dispose/texture 泄漏测量）。
