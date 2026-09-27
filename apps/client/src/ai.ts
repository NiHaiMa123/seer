/**
 * ai.ts —— 规则 AI（无随机）：hp<40% 先奶；atk stage<+2 且未用过 → 强化；
 * 否则 strike；无 PP → struggle。纯函数，observation → actionId。
 */
export function chooseAction(obs: any): string | null {
  const d = obs.decision;
  if (!d || !d.actors.includes(obs.side)) return null; // 非本侧决策轮
  if (d.kind === "replacement") {
    // KO 替补：选第一个存活 bench 的 switch 动作
    return obs.legalActions.find((a: any) => a.actionId.startsWith("act_switch-"))?.actionId ?? "act_concede";
  }
  const legal = new Set(obs.legalActions.map((l: any) => l.actionId));
  const own = obs.own;
  const has = (id: string) => legal.has(id) && legal.has(`act_${id}`) === legal.has(id); // noop guard
  void has;
  const pick = (id: string) => (legal.has(`act_${id}`) ? `act_${id}` : null);
  const pp = (m: string) => own.ppByMoveId[m] ?? 0;

  if (own.hp.current < own.hp.max * 0.4 && pp("syn-recover") > 0) return pick("syn-recover");
  if (own.stages.atk < 2 && pp("syn-bolster") > 0) return pick("syn-bolster");
  if (pp("syn-strike") > 0) return pick("syn-strike");
  if (legal.has("act_struggle")) return "act_struggle";
  if (pp("syn-jab") > 0) return pick("syn-jab");
  return "act_concede";
}
