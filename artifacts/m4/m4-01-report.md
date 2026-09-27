# M4-01 执行报告：队伍编辑

日期：2026-09-27。基线：`b5d74c4`（M4-00）。

## 语义

`team: {p1: string[], p2: string[]}` —— 有序列表：**[0] 首发，余下进 bench**。

校验（`packages/host/src/team.ts` `teamToConfig`）：
- 空队 / 未知 species → `INVALID_SCHEMA`（消息含具体 id）
- bench 数 > `limits.maxBenchSize`（v2=2）→ 拒
- pack 无 bench feature（v1）→ 任何 bench 项拒
- `team` 与 `species/bench` **互斥**（同传 400）

## 链路

- transport：`parseCreateBattle` 加 team + 互斥校验
- server：team → `teamToConfig` 展开成 `species`/`bench` → 原 create 路径（generation/persist 不变）
- 客户端：`TeamBuilder`（无 `?battle` 参数时渲染）——pack 下拉 + 有序点选（序即上场序）+ bench ≤2 提示 + 建局跳转
- AI 侧（`ai.ts` 已在 M4-00 支持 replacement 选替补）

## 验收

- `tests/server/team.test.ts` **9/9**：展开语义/未知种/超 bench/v1 门禁/互斥/建局后 observe 证实 bench 配置生效
- e2e 新增"队伍编辑器"用例：点选 gamma+epsilon → 开战 → bench-0 显示 syn-epsilon（真浏览器全链）
- 回归 164 用例绿、boundaries PASS

## 边界

- 队伍**存档化**（跨会话持久）属 M4-03 world service——当前仅建局时生效
- 重复 species 允许（无规则禁止）；若有公平性需要再加 unique 校验
- `team.p2` 目前客户端自动取"非首发前二"——真实对手/AI 配队策略属 M4-02+