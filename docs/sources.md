# 技术来源与版本核验

核验日期：2026-09-26。来源只支持对应技术事实；预算、流程和领域规则属于项目设计。关键 GitHub 文档固定为此次读取的 commit。

| ID | 官方来源 / 版本 | 核验所得及设计影响 |
|---|---|---|
| S01 | [DSH architecture @477b4f4](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/architecture.md) | Context、可撤销注册、Profile/Bundle、definition/provider/consumer；借鉴组合，不引入整套编码 harness |
| S02 | [DSH vendor，同 commit](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/vendor/README.md) | vendor 基于 Cordis rc.7，有生命周期修复；loader 不保证事务回滚；使用 `@deepseek-ai` scope。与上游分别验证 |
| S03 | [Cordis README](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/README.md) / [manifest](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/packages/core/package.json) | 上游候选 `cordis@4.0.0-rc.10`、MIT；API 未稳定。固定版本、窄适配；本次未验证 npm 安装 |
| S04 | [官方指向的 primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) / [Context](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/context) / [Fiber](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/fiber) | inject/effect/dispose；文档描述 DSH vendor。Seer 以实际安装上游类型/测试为准 |
| S05 | [PixiJS v8.21.0](https://github.com/pixijs/pixijs/releases/tag/v8.21.0) / [Application v8](https://pixijs.com/8.x/guides/components/application) | 最新稳定 release 指向 8.21.0；异步 init、canvas、renderer preference；不用 v7 示例 |
| S06 | [Pixi Assets](https://pixijs.com/8.x/guides/components/assets) / [GC](https://pixijs.com/8.x/guides/concepts/garbage-collection) | 缓存与纹理生命周期要管理；Seer 另做 bundle 引用计数 |
| S07 | [Node 发布状态](https://nodejs.org/en/about/previous-releases) | v24 为 LTS、v26 为 Current；选 Node 24，M0 锁补丁 |
| S08 | [Node Worker](https://nodejs.org/api/worker_threads.html) / [VM](https://nodejs.org/api/vm.html) | CPU 任务用池避免重复建线程；VM 不是安全机制 |
| S09 | [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | Worker 无直接 DOM；消息复制/transfer 语义不同；先测跨线程成本 |
| S10 | [TS basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) / [6.0 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) | 类型被擦除，不是 wire 校验；6.0 文档可用；strict TS 配 runtime Schema |
| S11 | [MCP tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | 工具 schema 和错误结构；MCP 只是可选 transport，不能代替权限 |
| S12 | [Ajv](https://ajv.js.org/guide/getting-started.html) | 编译/复用 validator；不在伤害热循环反复编译 |
| S13 | [React effects](https://react.dev/learn/synchronizing-with-effects) | 外部系统同步需 cleanup；Pixi 挂载/ticker/listener 配对释放 |
| S14 | [SQLite WAL](https://www.sqlite.org/wal.html) | 单写者与 checkpoint 成本；不声称换 DB adapter 自动解决多实例 |
| S15 | [PRNG 作者说明](https://prng.di.unimi.it/) / [xoshiro128** C 参考](https://prng.di.unimi.it/xoshiro128starstar.c) | 非密码学、32bit 候选；仅用于工程/local；实现与 seed 映射另测 |
| S16 | [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439) | ChaCha20 定义/向量；正式 PVP 的密码学随机流候选，未实现 |

`cordis.js.org` 指定页面本次无法访问，改查官方 README 指向的文档及仓库 manifest；未用二手教程补 API 保证。模型 API/版本到 M3 对接时再核验，本轮仅定义供应商中立端口。
