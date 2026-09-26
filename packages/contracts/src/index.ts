/**
 * Public contract entry — importable by client, agent and host.
 * Must NEVER re-export internal types/schemas (enforced by pnpm check:boundaries).
 */
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";

import { commandSchema } from "./generated/public/command.ts";
import { effectSchema } from "./generated/public/effect.ts";
import { errorSchema } from "./generated/public/error.ts";
import { eventSchema } from "./generated/public/event.ts";
import { manifestSchema } from "./generated/public/manifest.ts";
import { observationSchema } from "./generated/public/observation.ts";
import { toolSchema } from "./generated/public/tool.ts";

import type { Command } from "./generated/public/command.ts";
import type { Condition, EffectDefinition, EffectOp } from "./generated/public/effect.ts";
import type { ApiError } from "./generated/public/error.ts";
import type { BattleEvent } from "./generated/public/event.ts";
import type { PluginManifest } from "./generated/public/manifest.ts";
import type {
  DecisionInfo,
  LegalAction,
  Observation,
  OwnUnit,
  PublicEffect,
  RulesRef,
  Stages,
  VisibleOpponent,
} from "./generated/public/observation.ts";
import type { ToolRequest } from "./generated/public/tool.ts";

export { canonicalJson } from "./canonical.ts";
export type { Json } from "./canonical.ts";

export type {
  ApiError,
  BattleEvent,
  Command,
  Condition,
  DecisionInfo,
  EffectDefinition,
  EffectOp,
  LegalAction,
  Observation,
  OwnUnit,
  PluginManifest,
  PublicEffect,
  RulesRef,
  Stages,
  ToolRequest,
  VisibleOpponent,
};
export {
  commandSchema,
  effectSchema,
  errorSchema,
  eventSchema,
  manifestSchema,
  observationSchema,
  toolSchema,
};

const ajv = new Ajv({ allErrors: true, strict: true });

export interface Validators {
  command: ValidateFunction<Command>;
  observation: ValidateFunction<Observation>;
  event: ValidateFunction<BattleEvent>;
  manifest: ValidateFunction<PluginManifest>;
  effect: ValidateFunction<EffectDefinition>;
  tool: ValidateFunction<ToolRequest>;
  error: ValidateFunction<ApiError>;
}

export const validators: Validators = {
  command: ajv.compile(commandSchema) as ValidateFunction<Command>,
  observation: ajv.compile(observationSchema) as ValidateFunction<Observation>,
  event: ajv.compile(eventSchema) as ValidateFunction<BattleEvent>,
  manifest: ajv.compile(manifestSchema) as ValidateFunction<PluginManifest>,
  effect: ajv.compile(effectSchema) as ValidateFunction<EffectDefinition>,
  tool: ajv.compile(toolSchema) as ValidateFunction<ToolRequest>,
  error: ajv.compile(errorSchema) as ValidateFunction<ApiError>,
};
