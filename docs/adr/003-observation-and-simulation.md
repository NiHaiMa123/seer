# ADR-003：按视角投影与从假设构造模拟

状态：采纳；待隐私/信息集实验。日期：2026-09-26。

## 决策

Agent 和真人共用可见性策略。公共 Observation/Event/trace/legal action 单独构建，不从 TrueState spread。模拟器没有当前局 DB/真实 RNG 的访问路径；只从观察与显式 belief 样本构造世界。内部事件序号、hash、cause、日志也不能泄露秘密。同一可见历史的后续搜索策略必须一致。

## Alternatives / trade-off

完整快照给 Agent 最省事但相当于作弊；仅删几个隐藏字段会漏事件/合法动作侧信道；模拟真实世界再隐藏输出仍可通过伤害查询推断秘密。选假设模拟，代价是 belief 错误、搜索方差、统计结果不确定。未知 operator 不能靠 belief 猜成真实规则。

## 可逆性与验证

visibility policy 随模式/版本单独固定，增加公开字段必须审查其可推断内容。M0/M1 对两秘密世界测所有公开工具相等，M3 注入隐藏差异验证模拟/策略不依赖真实状态；未来已公开事件可使观察不同。训练时 privileged critic 如以后需要，必须隔离离线评测入口，不能转移到线上 Actor。
