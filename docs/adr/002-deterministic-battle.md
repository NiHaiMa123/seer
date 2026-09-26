# ADR-002：纯 transition、原子回合与冻结规则

状态：采纳设计；实现验证待 M0-04/M1。日期：2026-09-26。

## 决策与理由

单一纯 TS transition 同时服务 Authority 与 Simulator；输入是已收齐的联合动作或明确的替换/timeout 决定。整数公式、舍入、RNG算法/向量、稳定阶段顺序与 canonical 编码一起版本化。handler 只能输出封闭 EffectOp；失败整次回滚，不留部分 HP/PP/RNG 更新。规则表是 synthetic 规范，原作必须另核验。

## Alternatives / trade-off

通用 event bus 直接改状态便于开发，但顺序、回滚、回放难保证；两套游戏/模拟代码容易漂移；逐帧结算受动画和刷新率影响；浮点近似 replay 不能用于逐事件一致。这些均不选。纯对象复制先简单正确，可能较慢；性能证据出现后才做结构共享/Worker/WASM。

## 可逆性与验证

Authority/transport 可更换，规则行为不可静默改变；新 core/IR 用新 executable/ruleset hash，旧回放配旧工件。M0 固定 RNG/canonical vectors，M1 ≥24 golden、10000 seeded 属性样例、跨进程/浏览器一致；M2 加 interrupted replacement/复活/反弹链及 fault 原子性。改变数值/排序视为规则变更，不能只改 fixture expected。
