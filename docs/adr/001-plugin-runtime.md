# ADR-001：Cordis core + 薄 Seer 适配层

状态：路线采纳；运行时采用待 M0-03 实验通过。日期：2026-09-26。

## 问题与证据

需要依赖注入/可撤销 scope，却不应建设第二套通用框架。官方 DSH 基于 vendor Cordis，和上游 rc.10 存在生命周期/loader 差异；上游 README 明示 API 未稳定。[S01–S04](../sources.md)。

## 决策

候选锁上游 `cordis@4.0.0-rc.10`，只使用 core；Seer require/register/own + manifest policy 为窄适配。Profile 解析为无可执行表达式的数据；不引入 DSH CLI、全套 loader/HMR 或 agent loop。战斗 dispatcher 独立纯库。首期可信代码，scope 不是恶意代码隔离。

## Alternatives / trade-off

| 方案 | 取舍 |
|---|---|
| 直接让业务依赖 Cordis 全 API | 少适配代码，但 RC API、DI 与 core 耦合；不选 |
| 采用完整 DSH/vendor fork | 有既有修复与 Agent 功能，但产品/构建/升级面过大；本项目不选 |
| 自研通用插件框架 | 控制多但承担依赖、异步生命周期与配置复杂性；不先做 |
| 静态 composition root | 灵活性较少、可验证性高；PoC 失败时的最小降级 |

## 可逆性与验证

适配层不得复制 Cordis 全 API；只有这一包 import Cordis。M0 用 provider/consumer 验证失败清理/重入卸载/依赖失效/100 cycles。两轮或 2 工作日仍不达标：禁动态 reload，使用静态 composition + 显式资源释放，记录新 ADR；保留未来替换点，不无止境 fork 修框架。本轮没安装或执行该 PoC，不能标运行时验证通过。
