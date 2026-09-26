# 性能计划 v0.2

当前没有运行结果。下面是 M0 起实现的工作负载、命令约定和**预算**；不能当成测得的 FPS/吞吐，也不能仅凭 TS/Pixi/Worker 推断不卡顿。

## 1. 测试环境

| ID | 环境 | 用途 |
|---|---|---|
| D1 基准 | 建议 i5-8250U / UHD 620 / 8GB / Windows 11，1920×1080、DPR=1、60Hz；无此设备时记录实际替代机并重新冻结预算 | 低配桌面可玩门槛，不能以高配结果代替 |
| D2 实用 | 用户已有 M1 Max / 16GB，实际 macOS 与 Chrome/Safari 版本记录 | 日常使用与跨浏览器兼容 |
| D3 上限 | 用户已有 9800X3D / 32GB / RTX 5080，Windows/浏览器版本待记录；1080p 与 4K 分开 | 扩容/4K 探索，不作最低门槛 |
| S1 固定模拟 | Node 24 精确补丁、4 vCPU/8GB 配额、Linux x64；专用运行机记录 CPU 型号与频率 | 单 worker 与池吞吐/Host 负载 |
| CI | Linux runner + headless browser | 功能/趋势检查；不把共享 CI GPU/FPS 当实机结果 |

这些是建议目标设备，不表示当前已取得或运行。D1 缺失写 BLOCKED，不能通过浏览器 CPU throttling 冒充真实 UHD 620；降速模拟仅诊断。移动端先可用性探索，不纳入 M1 60FPS 承诺。M0 需确定真正可执行的 D1 替代设备和版本，否则性能 release gate 仍未通过。

## 2. 固定负载

- R1 基础：自制 2048² atlas 一张、2 个单位各 8 帧动画、100 个 UI/场景对象、普通技能与 HP 面板；120 秒持续操作。
- R2 压力：4 张 2048² atlas、500 个同时可见 sprites、1000 粒子、2 个全屏 filter；持续 120 秒。D1 压力超标可降级特效，但不影响输入/规则；实际对象/纹理数写入 report。
- R3 生命周期：50 次进入/退出战斗，资源组加载/卸载，观察最后 10 次与前 10 次稳定段的 heap/texture ownership/listener 数。
- B1 core：固定 2 单位、8 动作、10 active effects，10000 个 transition（fixture 循环，不因早终局少跑）。
- B2 组合：4 单位、100 active effects、KO/替代/控制交互，10000 transitions；合成内容与预期机制明确。
- B3 全库：编译 100/1000/10000 内容定义，但保持 B1 的 active effects 不变；分开报告启动/索引内存与每 transition 成本。
- S1 search：固定 Observation + 16 个 belief 样本、最多 2048 transitions、深度 2；single worker 和 2/4 workers 对照，禁止每分支创建 Worker。
- H1 Host：50 个同时等待输入的局、每秒 20 次决策结算，另启动有配额的搜索池；连同 DB/WS 开销。

所有 fixture/seed/atlas hash、core/规则版本固定；基准报告带 git SHA。M0 可以用 transport/渲染原型先测开销；B1/B2 必须等真实 M1/M2 core 才有可比较数据，不能用空循环宣称战斗性能。

## 3. 预算与测量

| 项目 | 初始门槛 | 衡量/排除 |
|---|---|---|
| R1 帧间隔 | D1 60Hz 前台 p95 ≤20ms、p99 ≤33.4ms，>50ms 帧 <1% | rAF 间隔；同时报告 dropped frames，不能用平均 FPS 掩盖停顿 |
| 主线程 CPU | 单帧 JS p95 ≤8ms；稳定段 long task >50ms ≤1 次/分钟，无 >200ms | PerformanceObserver 支持时采集 + Chrome trace；不把缺 API 当零 |
| 操作反馈 | 本地按键到按钮反馈 p95 ≤100ms | Playwright/手动 marker + performance marks，不含 LLM 等待 |
| 加载 | 冷缓存到可操作 ≤3s（20Mbps/80ms RTT）；warm 场景 ≤1s | 包含下载/解码/上传；资源与网络配置固定 |
| 资源 | R1 估算 GPU texture ≤128MiB；R2 ≤256MiB；R3 稳定 heap 增长 ≤10% 且 ≤10MiB | RGBA 估算 width×height×4，mipmap 等另计；GPU 实际占用不可普遍直接查询 |
| 释放 | R3 owned listener/ticker/worker/asset reference 回到基线 | 全局有意缓存单列；不要求浏览器立即归还所有 GPU/heap |
| B1 | S1 单 worker ≥5000 transitions/s，p95 ≤1ms | 无渲染/IO，含规则/事件分配；hash 成本单列 |
| B2 | S1 单 worker ≥1000 transitions/s，p95 ≤5ms | 记录 events/transition、GC、分配量 |
| B3 | active 不变时执行耗时相对 B1 增长 ≤15% | 编译/启动时长单列，不隐藏加载成本 |
| S1 search | 2048 transition budget 内 p95 ≤3s | 含 clone、postMessage、排队、聚合；报告截断比例 |
| H1 | 命令持久化 ACK p95 ≤100ms，event-loop delay p99 ≤20ms | 含 SQLite commit、搜索并发；不含公网 RTT |
| Agent | 总 decision p95 ≤10s、按时自主完成 ≥95% | 含 provider latency，fallback 与正常完成分开 |

阈值未达：先 profiler 定位；允许在 M0 基线冻结前调整一次并写理由，冻结后不能为当前失败直接放宽。功能正确与性能通过分别报告。内存/句柄泄漏、隐藏信息边界、原子性属于硬门禁，不能降低特效掩盖。

## 4. 执行方法与报告格式

M0 实现这些**未来命令**，目前仓库没有 package scripts：

```sh
pnpm bench:render -- --scenario R1 --duration 120 --runs 5 --out artifacts/perf/R1.json
pnpm bench:core -- --fixture B1 --warmup 2000 --iterations 10000 --runs 5
pnpm bench:sim -- --fixture S1 --workers 1,2,4 --runs 5
pnpm bench:host -- --scenario H1 --duration 120
pnpm bench:resources -- --cycles 50
```

浏览器先预热 10 秒；core 预热 2000 次不计分；5 次独立进程运行，报告每次分位数、总体中位数和最差一次，不只取最佳。后台窗口/休眠/热节流标无效或单列；屏幕录制会影响性能，主测试不录屏。冷缓存和 warm cache、debug/prod、WebGL/WebGPU 分开。

输出结构：`status/measuredAt/gitSha/toolchain/device/browser/display/power/network/fixtureHash/runs/rawSamples/summary/budgets/failures`。未测为 `NOT_RUN`，不能填零。保存 rAF samples、性能 trace、JS heap/owned texture 估计、events/turn、clone/hash/IPC/queue 时间与 provider usage。汇总页链接原始结果。

## 5. 设计措施与优化触发条件

Pixi 8 按 `const app = new Application(); await app.init({preference: 'webgl'}); host.appendChild(app.canvas)` 初始化；React effect 管 mount/cleanup，使用自有 ticker。正确 destroy/unload 签名在固定版本 PoC 编译检验，不能混用 v7 文档。[来源 S05/S06/S13](sources.md)。

资源按场景 bundle 管引用计数，异步预载但限制并发；离开场景释放引用，最后用户消失才卸载共享 atlas。限制 DPR（首期上限 2）、filter 区域/粒子数、分批纹理上传；降级只影响表现。大列表虚拟化，AI 思考不阻塞 render。

core 先 immutable/plain object + 明确 copy，编译时建立 trigger 索引。只有 profile 证明 clone/GC 占搜索成本 >25% 才试结构共享/COW；不能先用复杂池造成别名错误。transfer 会使原 ArrayBuffer 失效，不能转移权威状态正在使用的缓冲。搜索池先最多 2 workers，保留 Host/渲染资源；测 4 workers 不保证更快。

Rust/WASM、WebGPU、OffscreenCanvas、Redis、分布式模拟均延期；只有 CPU 热点/IPC/填充率等证据对应后提出 ADR 和相同负载 A/B。优化后仍跑同一 deterministic/privacy gate，不维护第二套战斗规则。
