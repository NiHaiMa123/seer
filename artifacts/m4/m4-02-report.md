# M4-02 执行报告：PVE/BOSS 模式

日期：2026-09-27。基线：`62cc9ea`（M4-01）。

## 语义

`POST /api/battle {mode:"pve", team:{p1,boss队}}`：
- p2 席位 = `bot_{battleId}`——**不发 token**，外部永远无法扮演（token 表根本不注册）
- bot 策略 = `decideBaseline`（rule 基线）——M3 的 deterministic arm 复用为剧情 AI
- `drivePve`：create 后立刻补 t1 决策；每次玩家 submit 后即时回应；replacement 自动选存活 bench；guard≤8 防循环

## 闭环

TeamBuilder 加 "PVE（打 bot）" 勾选（默认开）→ v2 boss 队自动 `syn-epsilon` 领衔（boss overlay）→ 战局 `[PVE]` 徽标 + 对手 `[boss]` mode 标签（投影早已带）。

## 验收

- `pve.test.ts` 2/2：建局即开打（bot 已 inbox）、tokens.p2 不存在、对手 mode=boss 公开、单人链路打到终局
- e2e/UI 无回归（build + typecheck 绿）

## 边界

- bot 是 baseline 强度——比 planner 弱；上 LLM 对手需 M3 agent 接进服务端（后续可做 `difficulty` 参数 → planner arm）
- 异步 bot 延迟（伪真人对局节奏）未做——bot 即时回应；要加可加 `botDelayMs`
- pveSeats 只在内存——重启后 pve 局 bot 停摆（持久化恢复在 world service 阶段统一处理）