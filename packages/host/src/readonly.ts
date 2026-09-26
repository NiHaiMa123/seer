/**
 * 只读工具入口（未来 Agent 工具面的协议基座）：
 * 只暴露 side-locked 的 observe/legal_actions/history/resync；
 * 内部状态/RNG/inbox/内部事件不可达——返回对象不含 Host 引用。
 */
import type { BattleEvent, Observation } from "@seer/contracts";
import type { SideId } from "@seer/battle-core";
import { legalActionIds } from "./host.ts";
import type { BattleHost } from "./host.ts";

export interface ReadOnlyView {
  observe(): Observation;
  legalActions(): string[];
  history(sinceSeq?: number): { cursor: number; events: BattleEvent[] };
  resync(sinceSeq?: number): { cursor: number; events: BattleEvent[]; observation: Observation };
}

export function createReadOnlyView(host: BattleHost, playerId: string): ReadOnlyView {
  return {
    observe: () => host.observe(playerId),
    legalActions: () => {
      const obs = host.observe(playerId);
      const side: SideId = obs.side;
      return [...legalActionIds(host.state.battle, side)].sort();
    },
    history: (sinceSeq = 0) => host.history(playerId, sinceSeq),
    resync: (sinceSeq = 0) => host.resync(playerId, sinceSeq),
  };
}
