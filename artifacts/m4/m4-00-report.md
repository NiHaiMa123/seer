# M4-00 执行报告：表现层债清偿

日期：2026-09-27。基线：`6ac3da9`（M3 收官）。

## 落地（纯表现层——无权威语义改动）

| 件 | 实现 |
|---|---|
| `GET /api/content/:packId` | 公开规则知识端点（moves: label/power/damageKind/ops；units: hp）——lookup_rule 的 HTTP 等价 |
| `meta.ts` | 客户端元数据缓存 + `moveBadge`（STD/FIX/PCT/TRU 徽标） |
| `main.tsx` | **bench 面板**（own.bench 卡：species/HP/effects/alive/mode/revives）· **对手 benchAlive 计数** · **effect chips**（kind:turns/×stack，隐藏效果不出网自然不显示）· **stage chips**（atk/def/spd ±N 红绿）· **replacement 横幅**（decision.kind=replacement + 我侧 actor 时红色横幅 + switch 按钮高亮描边）· 按钮显示 label + 徽标/power |
| `scene.ts` | `swapUnit`（旧单位淡出+新单位换入）、revive 闪金、effect-applied 紫闪、control-immune 绿闪、action-failed 抖动 |
| `ai.ts` | replacement 决策自动选首个存活 bench |

## 隐私保持

对手 bench 只渲染 `benchAlive` 数量计数；对手 hidden effects 本就不出网；徽标数据来自公开 pack 元数据——**零新信息面**。

## 验收

`test:e2e` **5/5**：新增 v2 用例实测——bench 面板可见、徽标 `[STD 40]` 渲染、delta KO 后 p2 侧 replacement 横幅出现、log 含 switch 事件。回归无破坏。

## 边界

- 生物美术仍是色块占位（合法路径：程序化/CC0/用户自备——不进仓库）
- banner/徽标样式是功能向极简风——美术迭代属后续
- `switch` 事件动画已在事件队列里串行化；HP 仍以 observe 权威对齐

## 下一步 = M4-01

队伍编辑（选首发+bench、合法校验、存档化）——world service 的前置。