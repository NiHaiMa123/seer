# M4-05 — verify:m4 聚合收官

## `verify:m4` = **9/9 PASS**（`artifacts/m4/verify-m4.json`）

| Gate | 证据 |
|---|---|
| regression:typecheck | tsc 0 错 |
| regression:boundaries | public/internal 扫描 PASS |
| regression:unit | vitest 全量 305 用例 |
| presentation:e2e | playwright 5/5（bench/replacement/chips/徽标） |
| team | 9/9（展开/上限/v1 门禁/互斥） |
| pve | 2/2（bot 席位/overlay/单人终局 344ms） |
| world:persistence+outbox | 5/5（exactly-once/db 重开） |
| world:ops | 4/4（预算/停机/门控/challenge） |
| world:agent | 4/4（BFS/收敛/不误触） |

## M4 总览

| 子任务 | 产出 |
|---|---|
| M4-00 `b5d74c4` | 表现层：bench 面板/replacement 横幅/effect+stage chips/伤害徽标/场景动画 |
| M4-01 `62cc9ea` | 队伍编辑：有序 team→{species,bench} 展开 + TeamBuilder UI |
| M4-02 `6914f8e` | PVE/BOSS：`mode:"pve"` bot 席位 + boss overlay + 单人链路 |
| M4-03 `74fdbd8` | `packages/world`：存档/背包/任务持久化 + reward outbox exactly-once |
| M4-04 `4097d21` | 世界地图/BFS 寻路/会话预算/不可逆门控 + `WorldAgent` 分离 |
| M4-05 | `verify:m4` 9/9 聚合 |

## 诚实边界

- World Agent 是确定性编排器——LLM 编排 adapter 属后续可选
- 视觉/点击 adapter 未做（AGENT.md §8 后置项）
- 地图/任务/掉落内容是合成最小集，非原作数据
- `owners`/`wpl_*` 是本地单机身份，无鉴权（公网化时需真认证层）

## M5+ 方向

世界任务与战斗的深联动（地图掉落→背包→配队→挑战闭环扩展）、World Agent LLM 编排评测、地图编辑器、成就/图鉴。自我对战/蒸馏仍按 AGENT.md 排到 M6 且需前置可信条件。
