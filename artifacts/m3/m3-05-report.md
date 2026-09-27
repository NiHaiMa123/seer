# M3-05 执行报告：评测 harness + 60 fixture + 消融/门禁

日期：2026-09-27。基线：`3d7979b`（M3-04）。

## 产出

| 件 | 说明 |
|---|---|
| `packages/agent/src/eval.ts` | `mkPolicy`（6 消融组统一入口）+ `playGame`（配对对局）+ `oraclePickSet`（可证最优集）+ Wilson CI + paired bootstrap（999 重抽） |
| `tools/m3-fixtures.ts` | 60 自制战术态：basic/synergy/counterplay/hidden/novel/adversarial ×10，dev/holdout 各半；eval-only patch 注入 stage/hp/effects |
| `tools/eval-m3.ts` | `eval:m3` runner——机制门 + 消融跑分 → `artifacts/m3/eval-m3.json` |
| `tests/agent/safety.test.ts` | ≥1024 adversarial fuzz + submit 伪造——**零秘密字段泄漏、零状态副作用** |
| planner 修进 | RootScore 加 `evaluated`/`mixedMilli`；未评估样本按 worst 计入（截断公平）；选根 mean×0.7+worst×0.3 |

## 过程中抓到的真实 bug（5 个）

1. **幂等 key 同回合跨 decisionType 碰撞** → IDEMPOTENCY_CONFLICT → 死锁（伪"卡死"的真因）
2. `players` 座位写死 → arm 坐 p2 时绑错玩家、0 决策 timeout
3. **未评估样本的截断偏差**：hex 靠 7/16 乐观 worst 赢满评 strike
4. **depth-1 短视**：连选 4 回合 bolster 拖死（depth2 后 W7/L3）
5. fixture 主题标签错标真最优（oracle 自验证替代手写标签）

## quick 口径实测（20 局/arm，fixture 判定）

- **机制门 holdout 25/30 ≥ 24**（oracle=depth2/2048 可证集，主题分歧单列）
- rule 10/20（对称基线）· random 0 · llm/llm+ret 5（echo mock 按字母选）· **search 13/20（+15pp）** · full 0（echo 弱点全选 blast）
- p95 决策延迟 ≤16ms ≪ 10s 门
- 安全门：**1024 调用 0 泄漏**

## 诚实声明

- **无真实 LLM**：llm/full 组跑 echo mock——"增益门 ≥5pp vs 最强非 LLM" 对真模型无法宣称；search vs rule 配对区间 CI 跨 0（quick 样本小）
- 完整 200×3 跑分后台进行中（`artifacts/m3/eval-full.log`），数字以 eval-m3.json 终值为准
- generalization 门（改名/数值迁移对）未单独构造——fixture 已覆盖 novel 类但迁移动作对是后续工作
- fixture 的 counterplay "theme" 列保留人工意图，oracle 判才是门禁口径——分歧已显式记录
