// Generated from schemas/internal/input.schema.json — do not edit; run pnpm contracts:gen.
export const inputSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/internal/input.schema.json",
  "title": "ResolvedInput",
  "description": "INTERNAL ordered joint intent produced by Authority once a decision closes. Feeds the pure transition; players never see this object.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "decisionId",
    "baseRevision",
    "resolvedSeq",
    "actions"
  ],
  "properties": {
    "decisionId": {
      "type": "string",
      "pattern": "^dec_[a-z0-9-]{1,60}$"
    },
    "baseRevision": {
      "type": "integer",
      "minimum": 0
    },
    "resolvedSeq": {
      "type": "integer",
      "minimum": 0
    },
    "actions": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "p1",
        "p2"
      ],
      "properties": {
        "p1": {
          "$ref": "#/definitions/resolvedAction"
        },
        "p2": {
          "$ref": "#/definitions/resolvedAction"
        }
      }
    }
  },
  "definitions": {
    "resolvedAction": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "actionId",
            "origin",
            "idempotencyKey"
          ],
          "properties": {
            "actionId": {
              "type": "string",
              "pattern": "^act_[a-z0-9-]{1,60}$"
            },
            "origin": {
              "enum": [
                "player",
                "timeout_default"
              ]
            },
            "idempotencyKey": {
              "type": "string",
              "minLength": 8,
              "maxLength": 128
            }
          }
        }
      ]
    }
  }
};

export type ResolvedAction = null | {
  actionId: string;
  origin: "player" | "timeout_default";
  idempotencyKey: string;
};

/**
 * INTERNAL ordered joint intent produced by Authority once a decision closes. Feeds the pure transition; players never see this object.
 */
export interface ResolvedInput {
  decisionId: string;
  baseRevision: number;
  resolvedSeq: number;
  actions: {
    p1: ResolvedAction;
    p2: ResolvedAction;
  };
}
