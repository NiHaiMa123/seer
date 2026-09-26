// Generated from schemas/public/tool.schema.json — do not edit; run pnpm contracts:gen.
export const toolSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/public/tool.schema.json",
  "title": "ToolRequest",
  "description": "Agent tool call union. simulate_batch takes explicit hypotheses and never a real-state snapshot id.",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId"
      ],
      "properties": {
        "tool": {
          "const": "observe"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "cursor": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId",
        "cursor"
      ],
      "properties": {
        "tool": {
          "const": "history"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "cursor": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId",
        "decisionId"
      ],
      "properties": {
        "tool": {
          "const": "legal_actions"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "decisionId": {
          "type": "string",
          "pattern": "^dec_[a-z0-9-]{1,60}$"
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "rulesetHash",
        "id"
      ],
      "properties": {
        "tool": {
          "const": "lookup_rule"
        },
        "rulesetHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "id": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId",
        "cursor"
      ],
      "properties": {
        "tool": {
          "const": "explain_trace"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "cursor": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId",
        "hypotheses",
        "candidates",
        "seed",
        "budget"
      ],
      "properties": {
        "tool": {
          "const": "simulate_batch"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "hypotheses": {
          "type": "array",
          "minItems": 1,
          "maxItems": 16,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "opponentMoveIds": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "^[a-z0-9][a-z0-9-]*$"
                },
                "maxItems": 8
              },
              "oppStages": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "atk": {
                    "type": "integer",
                    "minimum": -6,
                    "maximum": 6
                  },
                  "def": {
                    "type": "integer",
                    "minimum": -6,
                    "maximum": 6
                  },
                  "spd": {
                    "type": "integer",
                    "minimum": -6,
                    "maximum": 6
                  }
                }
              },
              "note": {
                "type": "string",
                "maxLength": 200
              }
            }
          }
        },
        "candidates": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "type": "string",
            "pattern": "^act_[a-z0-9-]{1,60}$"
          }
        },
        "seed": {
          "type": "integer",
          "minimum": 0
        },
        "budget": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "maxTransitions"
          ],
          "properties": {
            "maxTransitions": {
              "type": "integer",
              "minimum": 1,
              "maximum": 2048
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "moveId",
        "assumptions"
      ],
      "properties": {
        "tool": {
          "const": "calculate_damage"
        },
        "moveId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        },
        "assumptions": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "oppDefStage": {
              "type": "integer",
              "minimum": -6,
              "maximum": 6
            },
            "oppDefOverride": {
              "type": "integer",
              "minimum": 1
            },
            "oppSpeciesId": {
              "type": "string",
              "pattern": "^[a-z0-9][a-z0-9-]*$"
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "battleId",
        "mechanismQuery"
      ],
      "properties": {
        "tool": {
          "const": "search_counterplay"
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "mechanismQuery": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "trigger"
          ],
          "properties": {
            "trigger": {
              "type": "string",
              "minLength": 1
            },
            "produces": {
              "type": "string"
            },
            "targetPath": {
              "type": "string"
            }
          }
        },
        "budget": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "maxTransitions"
          ],
          "properties": {
            "maxTransitions": {
              "type": "integer",
              "minimum": 1,
              "maximum": 2048
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tool",
        "schemaVersion",
        "battleId",
        "decisionId",
        "baseRevision",
        "idempotencyKey",
        "actionId"
      ],
      "properties": {
        "tool": {
          "const": "submit_action"
        },
        "schemaVersion": {
          "const": 1
        },
        "battleId": {
          "type": "string",
          "pattern": "^btl_[a-z0-9-]{1,60}$"
        },
        "decisionId": {
          "type": "string",
          "pattern": "^dec_[a-z0-9-]{1,60}$"
        },
        "baseRevision": {
          "type": "integer",
          "minimum": 0
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128
        },
        "actionId": {
          "type": "string",
          "pattern": "^act_[a-z0-9-]{1,60}$"
        }
      }
    }
  ]
};

/**
 * Agent tool call union. simulate_batch takes explicit hypotheses and never a real-state snapshot id.
 */
export type ToolRequest =
  | {
      tool: "observe";
      battleId: string;
      cursor?: number;
    }
  | {
      tool: "history";
      battleId: string;
      cursor: number;
    }
  | {
      tool: "legal_actions";
      battleId: string;
      decisionId: string;
    }
  | {
      tool: "lookup_rule";
      rulesetHash: string;
      id: string;
    }
  | {
      tool: "explain_trace";
      battleId: string;
      cursor: number;
    }
  | {
      tool: "simulate_batch";
      battleId: string;
      /**
       * @minItems 1
       * @maxItems 16
       */
      hypotheses: {
        /**
         * @maxItems 8
         */
        opponentMoveIds?: string[];
        oppStages?: {
          atk?: number;
          def?: number;
          spd?: number;
        };
        note?: string;
      }[];
      /**
       * @minItems 1
       * @maxItems 8
       */
      candidates: string[];
      seed: number;
      budget: {
        maxTransitions: number;
      };
    }
  | {
      tool: "calculate_damage";
      moveId: string;
      assumptions: {
        oppDefStage?: number;
        oppDefOverride?: number;
        oppSpeciesId?: string;
      };
    }
  | {
      tool: "search_counterplay";
      battleId: string;
      mechanismQuery: {
        trigger: string;
        produces?: string;
        targetPath?: string;
      };
      budget?: {
        maxTransitions: number;
      };
    }
  | {
      tool: "submit_action";
      schemaVersion: 1;
      battleId: string;
      decisionId: string;
      baseRevision: number;
      idempotencyKey: string;
      actionId: string;
    };
