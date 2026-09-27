import type { IncomingMessage } from "node:http";
import { validators, type Command } from "@seer/contracts";

export class TransportError extends Error {
  readonly code = "INVALID_SCHEMA";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TransportError";
    this.status = status;
  }
}

export interface CreateBattleRequest {
  seedHex: string;
  /** 未给时由 server 按 pack 前两个单位补默认 */
  species?: { p1: string; p2: string };
  bench?: { p1?: string[]; p2?: string[] };
  /** 有序队伍（[0]首发，余下 bench）——与 species/bench 互斥 */
  team?: { p1: string[]; p2: string[] };
  pack?: string;
  /** pve：p2 为服务端 bot 席位（不发 token，自动提交） */
  mode?: "pvp" | "pve";
  /** 世界席位登记：side → wpl_* playerId（奖励归属用） */
  owners?: { p1?: string; p2?: string };
  deadlineMs: number;
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TransportError(400, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const exact = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new TransportError(400, `${label} has unknown field ${extras[0]}`);
};

const text = (value: unknown, label: string, pattern?: RegExp): string => {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new TransportError(400, `${label} is invalid`);
  }
  return value;
};

const integer = (value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new TransportError(400, `${label} is invalid`);
  }
  return value as number;
};

const speciesPair = (value: unknown): { p1: string; p2: string } => {
  const pair = asRecord(value, "species");
  exact(pair, ["p1", "p2"], "species");
  const pattern = /^[a-z0-9][a-z0-9-]*$/;
  return { p1: text(pair.p1, "species.p1", pattern), p2: text(pair.p2, "species.p2", pattern) };
};

const benchSide = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length > 64) throw new TransportError(400, `${label} is invalid`);
  return value.map((item, index) => text(item, `${label}[${index}]`, /^[a-z0-9][a-z0-9-]*$/));
};

const bench = (value: unknown): { p1?: string[]; p2?: string[] } => {
  const input = asRecord(value, "bench");
  exact(input, ["p1", "p2"], "bench");
  return {
    ...(input.p1 !== undefined ? { p1: benchSide(input.p1, "bench.p1") } : {}),
    ...(input.p2 !== undefined ? { p2: benchSide(input.p2, "bench.p2") } : {}),
  };
};

const teamPair = (value: unknown): { p1: string[]; p2: string[] } => {
  const input = asRecord(value, "team");
  exact(input, ["p1", "p2"], "team");
  return { p1: benchSide(input.p1, "team.p1"), p2: benchSide(input.p2, "team.p2") };
};

const worldPlayer = (value: unknown, label: string): string =>
  text(value, label, /^wpl_[a-z0-9-]{1,60}$/);

const owners = (value: unknown): { p1?: string; p2?: string } => {
  const input = asRecord(value, "owners");
  exact(input, ["p1", "p2"], "owners");
  return {
    ...(input.p1 !== undefined ? { p1: worldPlayer(input.p1, "owners.p1") } : {}),
    ...(input.p2 !== undefined ? { p2: worldPlayer(input.p2, "owners.p2") } : {}),
  };
};

export function parseCreateBattle(value: unknown): CreateBattleRequest {
  const input = asRecord(value, "create battle body");
  exact(input, ["seedHex", "species", "bench", "team", "pack", "mode", "owners", "deadlineMs"], "create battle body");
  if (input.mode !== undefined && input.mode !== "pvp" && input.mode !== "pve") {
    throw new TransportError(400, "mode must be pvp or pve");
  }
  if (input.team !== undefined && (input.species !== undefined || input.bench !== undefined)) {
    throw new TransportError(400, "team is mutually exclusive with species/bench");
  }
  return {
    seedHex: input.seedHex === undefined ? "f".repeat(32) : text(input.seedHex, "seedHex", /^[0-9a-f]{32}$/),
    ...(input.species !== undefined ? { species: speciesPair(input.species) } : {}),
    ...(input.team !== undefined ? { team: teamPair(input.team) } : {}),
    ...(input.bench !== undefined ? { bench: bench(input.bench) } : {}),
    ...(input.pack !== undefined ? { pack: text(input.pack, "pack", /^[a-z0-9][a-z0-9-]*$/) } : {}),
    ...(input.mode !== undefined ? { mode: input.mode as "pvp" | "pve" } : {}),
    ...(input.owners !== undefined ? { owners: owners(input.owners) } : {}),
    deadlineMs: input.deadlineMs === undefined ? 30_000 : integer(input.deadlineMs, "deadlineMs", 1, 300_000),
  };
}

const WORLD_ID = /^wpl_[a-z0-9-]{1,60}$/;

export function parseWorldPlayer(value: string | null): string {
  return text(value, "playerId", WORLD_ID);
}

export function parseRegisterPlayer(value: unknown): { playerId: string; name: string } {
  const input = asRecord(value, "register body");
  exact(input, ["playerId", "name"], "register body");
  return { playerId: worldPlayer(input.playerId, "playerId"), name: text(input.name, "name") };
}

export function parseSaveTeam(value: unknown): { name: string; pack: string; species: string[] } {
  const input = asRecord(value, "save team body");
  exact(input, ["name", "pack", "species"], "save team body");
  return {
    name: text(input.name, "name", /^[a-z0-9][a-z0-9-]{0,60}$/),
    pack: text(input.pack, "pack", /^[a-z0-9][a-z0-9-]*$/),
    species: benchSide(input.species, "species"),
  };
}

export function parseClaimReward(value: unknown): { playerId: string; battleId: string } {
  const input = asRecord(value, "claim body");
  exact(input, ["playerId", "battleId"], "claim body");
  return {
    playerId: worldPlayer(input.playerId, "playerId"),
    battleId: text(input.battleId, "battleId", /^btl_[a-z0-9-]{1,60}$/),
  };
}

export function parseSubmit(battleId: string, value: unknown): { token: string; command: Omit<Command, "schemaVersion"> } {
  const input = asRecord(value, "submit body");
  exact(input, ["player", "decisionId", "actionId", "baseRevision", "idempotencyKey"], "submit body");
  const token = text(input.player, "player", /^tok_[a-f0-9]{32}$/);
  const candidate = {
    schemaVersion: 1 as const,
    battleId,
    decisionId: input.decisionId,
    actionId: input.actionId,
    baseRevision: input.baseRevision,
    idempotencyKey: input.idempotencyKey,
  };
  if (!validators.command(candidate)) {
    const first = validators.command.errors?.[0];
    throw new TransportError(400, `command ${first?.instancePath || "/"} ${first?.message ?? "is invalid"}`);
  }
  const { schemaVersion: _, ...command } = candidate;
  return { token, command };
}

export function parseAck(value: unknown): { token: string; seq: number } {
  const input = asRecord(value, "ack body");
  exact(input, ["player", "seq"], "ack body");
  return {
    token: text(input.player, "player", /^tok_[a-f0-9]{32}$/),
    seq: integer(input.seq, "seq", 0),
  };
}

export function parseToken(value: string | null): string {
  return text(value, "player", /^tok_[a-f0-9]{32}$/);
}

export function parseCursor(value: string | null): number {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) throw new TransportError(400, "cursor is invalid");
  return integer(Number(value), "cursor", 0);
}

export function parseDelay(value: string | null): number {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) throw new TransportError(400, "slow is invalid");
  return integer(Number(value), "slow", 0, 5_000);
}

export const readJsonBody = (req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) tooLarge = true;
      else body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) return reject(new TransportError(413, "request body too large"));
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new TransportError(400, "request body is not valid JSON"));
      }
    });
  });
