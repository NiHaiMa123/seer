# ADR-004：TypeScript 模块化单体、本地 Host 优先

状态：采纳路线；精确工具链安装/基准待 M0。日期：2026-09-26。

## 决策

TS 6.0 系列/Node 24 LTS/ESM/pnpm；React+Vite 管 UI，PixiJS 8.21.0 WebGL 优先；Fastify HTTP/WS，JSON Schema+Ajv 边界；SQLite 本机事务。M3 Agent 独立 TS 进程 + 模拟 Worker 池，云/本地模型走 provider port。M4 需要正式联网时增认证/房主/fencing/PostgreSQL，不先建微服务。

Pixi 稳定发布、Node LTS、TS 类型擦除、Worker/VM 约束已核验，[S05–S10/S12–S14](../sources.md)。TS 不能保证 FPS，Worker 不能保证安全。其余依赖精确补丁必须 M0 实装后锁定，不用本文替代 lockfile。

## Alternatives / trade-off

| 替代 | 暂不选原因 / 触发条件 |
|---|---|
| Python Agent 起步 | 增跨语言序列化/调试；需要训练库时再 adapter |
| 纯浏览器起步 | 离线方便，但模型密钥/资源/持久化/多人公正不同；后续用同 core Worker |
| Phaser/全功能游戏引擎 | 内置功能更多，但目前只需 2D 场景且要明确游戏规则边界；地图需求证明确有收益再复评 |
| Rust/WASM core | 性能潜力但规则开发和跨语言成本高；CPU profile 证明 TS 核心不足后才评估 |
| WebGPU/OffscreenCanvas 默认 | 增驱动/生命周期/线程复杂性；先同负载 A/B 证收益 |
| PostgreSQL/微服务/Redis 起步 | 本地首轮不需运维面；有实际多人/并发需求才引入 |

## 可逆性与验证

core 不依赖框架；DB/模型/传输有稳定 port，web 独立；迁至多人还需一致性工作，不能宣称换 adapter 即完成。M0 运行 Pixi 挂卸与 Worker 成本 PoC，M1 本机闭环/recovery，性能见 performance-plan。TS 6 不兼容可退 5.9 并记录版本原因，不能跳过 typecheck。
