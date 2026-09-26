/**
 * Internal contract entry — Authority/host side only.
 * Importable by host, battle-core, tests and tools; forbidden for client/agent code
 * (enforced by pnpm check:boundaries).
 */
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";

import { eventInternalSchema } from "./generated/internal/event-internal.ts";
import { inputSchema } from "./generated/internal/input.ts";
import { stateSchema } from "./generated/internal/state.ts";

import type { InternalEvent } from "./generated/internal/event-internal.ts";
import type { ResolvedAction, ResolvedInput } from "./generated/internal/input.ts";
import type { BattleState, InboxSubmission, InternalSide } from "./generated/internal/state.ts";

export { canonicalJson } from "./canonical.ts";
export type { Json } from "./canonical.ts";
export type {
  BattleState,
  InboxSubmission,
  InternalEvent,
  InternalSide,
  ResolvedAction,
  ResolvedInput,
};
export { eventInternalSchema, inputSchema, stateSchema };

const ajv = new Ajv({ allErrors: true, strict: true });

export interface InternalValidators {
  state: ValidateFunction<BattleState>;
  internalEvent: ValidateFunction<InternalEvent>;
  resolvedInput: ValidateFunction<ResolvedInput>;
}

export const internalValidators: InternalValidators = {
  state: ajv.compile(stateSchema) as ValidateFunction<BattleState>,
  internalEvent: ajv.compile(eventInternalSchema) as ValidateFunction<InternalEvent>,
  resolvedInput: ajv.compile(inputSchema) as ValidateFunction<ResolvedInput>,
};
