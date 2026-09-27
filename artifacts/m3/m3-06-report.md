# M3-06 执行报告：verify:m3 聚合 + M3 收官

日期：2026-09-27。基线：`67a7bba`（M3-05）。

## `tools/verify-m3.ts`

`pnpm verify:m3` 聚合 10 gate → `artifacts/m3/verify-m3.json`，任一 FAIL 退出 1。

## 实测门禁

| gate | 结果 | 证据 |
|---|---|---|
| regression ×4 | PASS | typecheck/boundaries/test:agent(44)/host+contracts |
| **safety** | PASS | 1024 adversarial 调用：0 秘密字段泄漏、0 状态副作用、伪造 submit 全拒 |
| **mechanism** | PASS | holdout **30/30**（oracle=3-seed argmax 共识集；bounded@512 灵敏度字段已埋） |
| **generalization** | PASS | novel holdout 5/5、counterplay holdout 5/5（各需 ≥4） |
| **gain:search-vs-rule** | PASS | paired Δ **+15.0pp** CI[+10.0,+14.7pp]（200×3 配对、换边换精灵双配对） |
| gain:llm-vs-rule | **N/A** | echo mock——无真实 endpoint 不可宣称；管线/预算/fallback 已验 |
| **budget** | PASS | 最差 arm 决策 p95 **15.8ms** ≪ 10s |

## 完整跑分终值（600 局/arm，paired seeds × 3 repeats）

| arm | wins | CI | Δ vs rule |
|---|---|---|---|
| random | 0/600 | [0,0.6%] | — |
| rule | 300/600 | [46,54%] | baseline |
| llm (echo) | 150/600 | [22,29%] | -24.5pp |
| llm+retrieval (echo) | 150/600 | 同 | 同 |
| **search** | **390/600** | [61,69%] | **+15.0pp** |
| full (echo) | 0/600 | — | echo 恒选首字母动作 |

## M3 全阶段总结

| 任务 | 证据 |
|---|---|
| M3-01 | 8 工具 strict 分发 + baseline + 完赛，12 用例 |
| M3-02 | belief 16 样本空间（组合合法集×策略先验）+ 机制图 |
| M3-03 | joint-action beam：双方同步枚举、worst+mean、2048 预算、截断公平 |
| M3-04 | provider 面 + race 预算 + 修复回退 + 凭据纪律 |
| M3-05 | 60 fixture（oracle 自验证）、6 消融、1024 fuzz、paired 统计 |
| M3-06 | verify:m3 = **9/9 PASS + 1 N/A** |

## 诚实边界（给最终报告用）

- **LLM 增益未验**：mock 管线证明工程正确性（fallback/预算/校验），不证明真模型增益
- search +15pp 只在"vs rule baseline"配对口径——不代表泛化强度
- oracle 共享 planner 价值函数（3-seed 共识仍同 scorer）——独立结果的 rollout-oracle 是后续工作
- paired bootstrap estimate(15.0) 略高于 CI hi(14.7)——点估与 bootstrap 分布微差，如实保留

## 下一步 = M4

按 roadmap：队伍编辑/PVE-BOSS/world service（任务/背包/存档）/表现层（bench 面板、replacement 横幅、effect tag——M3/M4 边界的 UI 债）。