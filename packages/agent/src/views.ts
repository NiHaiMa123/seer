/**
 * Agent 与 Host 之间的最小结构接口——Agent 包不 import @seer/host，
 * 任何满足形状的对象都可注入（in-process ReadOnlyView、HTTP adapter、
 * 评测 mock）。由此结构性保证 agent 永远拿不到 BattleState/Store。
 */
import type { BattleEvent, Command, Observation } from "@seer/contracts";

export interface AgentView {
  observe(): Observation;
  legalActions(): string[];
  history(sinceSeq?: number): { cursor: number; events: BattleEvent[] };
  resync(sinceSeq?: number): { cursor: number; events: BattleEvent[]; observation: Observation };
}

export type SubmitOutcome =
  | { ok: true; receipt: { decisionId: string; side: string; actionId: string; baseRevision: number; status: string; resolved: boolean } }
  | { ok: false; error: { code: string; message: string } };

export type SubmitFn = (cmd: Omit<Command, "schemaVersion">) => SubmitOutcome;
