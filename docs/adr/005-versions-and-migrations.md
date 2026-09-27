# ADR-005：多版本轴、工件固定与非破坏迁移

状态：采纳；M2-05 已实现同 executableHash generations，M2-06 已实现三 hash 工件恢复，M2-08 已实现不同 executableHash 的独立进程执行域。日期：2026-09-26，2026-09-27 落地。

## 决策

| 版本轴 | 改变条件 | 旧会话/消费者 |
|---|---|---|
| wire schema | 公共命令/观察/事件不兼容 | 主版本拒绝；兼容新增也受严格 schema 协商 |
| engine/executable | reducer/handler/RNG/canonical 实现变更 | 固定旧工件重放 |
| ruleset | 公式/阶段/可见性/模式顺序变更 | 新局用新规则；旧局不迁移 |
| IR schema/handler ABI | 新操作/字段/phase 语义 | 编译期检查；不支持就拒绝 |
| content | 精灵/技能逻辑数据变化 | 新局生效；秘密队伍不并入公开 content hash |
| assets | 图像/动画/音频变化 | 独立资源 hash，不改变逻辑 |
| save schema | 局外持久化格式变化 | 显式迁移/备份/原子切换 |
| replay schema | 日志 envelope/编码变化 | reader adapter 或旧 reader；语义不改写 |

Match manifest 记录所有逻辑工件摘要及 runtime/toolchain。semver 是兼容声明，hash 是内容标识；两者不能互相替代。升级不通过 Node module-cache 热覆盖旧 handler，使用独立 generation/worker，代码不兼容时进程隔离。旧工件保留到回放保留期结束；期限在发行前配置。缺工件就报错，不能伪重放。

## Alternatives / trade-off

单一应用版本简单但无法区分资源/数据/规则；就地迁移旧战局容易改变胜负；永远保留所有运行进程资源不可控。选择最多 2 活跃 generation、旧 artifact 可离线存储、新版本等待 drain；用存储换可追溯性，控制在线内存。

## 可逆性与验证

存档迁移 source→target 链：dry-run→新数据→完整性校验→备份→事务切换；失败不覆盖原件，未知 plugin namespace 保留。M2-05 已覆盖 v1 局运行中装 v2、使用中卸载被拒、第三代等待 drain、旧 replay 不变；M2-06 以 catalog 按三类 hash 恢复绑定，缺失/错误/篡改工件均 `ARTIFACT_UNAVAILABLE`；M2-08 让可信 catalog 为不同 executableHash 指定独立进程 entrypoint，Host 的 init/legal/transition/restore/replay 全部经该执行域。M4 测迁移中断、重复执行、回滚与未知 namespace。
