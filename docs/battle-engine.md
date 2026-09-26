# 战斗引擎：确定性状态机与 Effect DSL v0.1

## 设计目标

- 复刻选定版本的赛尔号规则，先以精简 1v1 验证，再扩展队伍、PVE/BOSS、特殊场景。
- 同一 state snapshot + 同一双方 action + 同一 seed + 同一 ruleset_hash 必须得到完全相同结果。
- Battle Core 是权威状态唯一修改者；Agent、UI、插件和动画不能直接 set HP/PP/状态。
- 规则未知时 fail closed：停止导入该技能/内容，列入待核验，不用猜测补全。
- Engine/Simulator 必须复用同一纯状态转移实现，不能维护两套规则。

## 核心类型与安全边界（接口草案）

~~~typescript
type BattleCommand =
  | { kind: "use_move"; actorId: string; moveSlot: number; targetId: string }
  | { kind: "switch"; actorId: string; benchId: string }
  | { kind: "other"; actorId: string; actionId: string };

interface ActionEnvelope {
  battleId: string;
  turnId: number;
  expectedStateVersion: number;
  idempotencyKey: string;
  command: BattleCommand;
}

interface RulesetRef {
  gameMode: "pvp" | "pve" | "boss";
  version: string;
  contentHash: string;
  executableHash: string;
}

interface BattleState {
  ruleset: RulesetRef;
  turn: number;
  phase: BattlePhase;
  rngState: RngState;
  units: UnitState[];
  fieldEffects: ActiveEffect[];
  eventSeq: number;
  stateVersion: number;
}
interface TransitionResult {
  state: BattleState;
  events: BattleEvent[];
  terminal?: { outcome: string; reason: string };
}
~~~

内部真实状态与外部 Observation 分离。服务器返回玩家允许看到的信息；未揭示技能/PP/特殊资源等严格按规则决定，不因 AI 客户端而额外暴露。

## 回合生命周期：初始抽象而非已核验原作顺序

~~~text
COLLECT_ACTIONS
  -> VALIDATE_ACTIONS
  -> PRE_TURN / ENTRY / SWITCH HANDLING
  -> ORDER_RESOLUTION
  -> BEFORE_ACTION / ACTION_RESOLUTION / AFTER_ACTION
  -> END_PHASE_EFFECTS
  -> FAINT / REPLACEMENT / TERMINAL_CHECK
  -> NEXT_TURN
~~~

真正顺序必须用版本化 Rule Table 显式指定：切换与登场、先制/速度、命中与技能执行、伤害前后、异常及持续效果、击败/复活、回合结束、PVE/BOSS 例外。不能凭上述抽象推断原作结算时点。

处理双方行动采用“双方合法意图 → 权威排序 → 执行”，同时检查行动被对方效果改变后是否仍合法；允许状态改变导致行动失败。具体退款/PP/技能消耗等由版本规则决定。

## 两级事件

1. Domain Event：事实和审计日志，可回放、可投影给客户端；
2. Internal Trigger：阶段内的逻辑触发，不代表 UI 动画帧。

所有效果都以 causation_id 追踪链路：原始 Action → trigger → effect → state mutation → secondary trigger。Effect Queue 有 stable order、深度/总数上限、循环检测；触发链递归不得无限执行。需要覆盖替代、取消、反弹和同阶段冲突而非单一 priority。

## Effect DSL / IR 草案

~~~json
{
  "id": "seer.effect.example.priority_if_lower_hp",
  "version": 1,
  "trigger": "TURN_START",
  "conditions": [
    {
      "op": "LT",
      "left": {"ref":"self.hp.current"},
      "right": {"ref":"opponent.hp.current"}
    }
  ],
  "commands": [
    {
      "op": "MODIFY_PRIORITY",
      "target": {"ref":"self.moves"},
      "delta": 1,
      "duration": {"kind":"CURRENT_TURN"}
    }
  ],
  "priority": {"phase":"TURN_START","group":"NORMAL","index":100}
}
~~~

此为虚构测试效果，不是原作技能文本。所有 ref/operator 必须在白名单，禁止任意表达式 eval。用 schema 编译为 typed IR，并在加载时生成可查询的机制元数据：requires / produces / consumes / prevents / amplifies / counters（最后一种通过验证标注，不直接相信模型推测）。

### 必需 DSL 维度

- 目标与归属：self、opponent、active、bench、field；source/owner/target 分开；
- 触发：登场、切换、行动前后、命中、伤害前后、属性改变、状态变化、击败/复活、回合阶段；
- 条件：数值比较、标签、状态、持续时间、计数、模式、触发来源；
- 效果：伤害（分类）、恢复、强化/弱化、吸强/消强、控制/免控/反控、PP/资源、先制、屏障、替代、封锁、切换；
- 时长：持续回合、触发次数、离场/死亡是否保留；倒计时起点和归属必须显式；
- 概率：每次随机判定由命名 RNG stream 记录 draw ID；模拟 fork 不能知道真实未来随机抽样；
- 冲突：叠加策略、互斥策略、免疫/穿透、固定/百分比/特殊伤害类别、模式例外。

特殊原作效果如果不能表达，增加新的 operator/trigger，而不是把不可维护的自由文本交给 LLM 执行。大型专属规则也可以是受控的 typed handler，但需纯函数、版本化和测试。

## 规则顺序表而非魔法 priority

定义 RuleTable 包括 action order、trigger groups、replacement/interruption、damage stages、expiry stages、tie-break、switch side effects。每一个在证据缺失时标记 UNVERIFIED，禁止直接向外宣称等同原作。

Priority 仅用于一个已有确定阶段内的排序，不允许覆盖规则层面的取消/替代关系。稳定 tie-break 使用明确业务键而非插件安装顺序。

## RNG、重放与快照

- 纯可复现 PRNG，有显式 seed/state，禁止 Math.random/Date.now 参与规则结算；
- 保存 match manifest（ruleset/content/executable hashes）、初始 state hash、ordered commands、seed、版本化事件；
- 回放应重新执行命令校验 state/event hashes，而不是只播放存储的动画；
- snapshots 用于随机访问和模拟 fork；日志与快照的兼容迁移有独立版本；
- 隐藏 RNG 信息不能进入 Agent 的可见输入。

## 可验证的 Counterfactual Simulation

~~~text
snapshot (visible belief-consistent sample) + candidate actions
  -> headless core -> branch traces/state statistics
  -> planner risk analysis
  -> submit chosen action to authoritative host
~~~

Simulator 不接入真实局的未来 RNG，也不开放对手隐藏状态；遇到隐藏信息时从 BeliefState 按假设采样。Simulation result 带 ruleset hash、sample assumptions、estimated confidence 和 branch cost。不能把假设模拟写成确定未来。

## Golden Tests 最小矩阵

- 行动合法性、PP、失败行动、状态版本/幂等；
- 不同先制/速度/相同优先级；切换与登场；
- 强化/吸强/消强；控制/免控/反控；
- 普通/固定/百分比/特殊伤害与减免、回复、护盾；
- 多触发同回合、替代/中断、上限与循环；
- 击败、复活、离场、持续效果归属；
- PVP/PVE/BOSS 限制；
- 规则版本变化后的旧局 replay；
- 不同插件加载顺序但相同规则快照结果相同。

每条 fixture 记录：源规则版本、证据链接/截图（素材版权另管）、given state、when actions/seed、expected event sequence/state hash、验证者和日期。未知规则保留 pending 测试，不允许改 expected 让实现通过。

## 运行性能

- 战斗创建时只激活当前双方及战场生效 effect；按 trigger 建立索引；
- DSL 在加载时编译/验证，运行时不解析文本；
- 采用独立 profiling：events/turn、hot handler、alloc/GC、turns/sec、snapshot clone time；
- 客户端只订阅结构化状态变化与 RenderEvent，跳动画不跳逻辑。

## 首个闭环

只选择少量基础机制的 1v1 + 2~3 个复杂被动组合，建设可重复 replay 与 Golden Test。原则是用机制覆盖率选择精灵，不是盲目一口气录入大量资料。
