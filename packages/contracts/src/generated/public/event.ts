// Generated from schemas/public/event.schema.json — do not edit; run pnpm contracts:gen.
export const eventSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/public/event.schema.json",
  "title": "BattleEvent",
  "description": "Public per-side event union, rebuilt from whitelisted facts only. Internal fields (causeId, seq, rngDraw, patch refs) are rejected by additionalProperties=false.",
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "turn",
        "decisionId"
      ],
      "properties": {
        "type": {
          "const": "turn-begin"
        },
        "turn": {
          "type": "integer",
          "minimum": 0
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
        "type",
        "side",
        "actionId"
      ],
      "properties": {
        "type": {
          "const": "action-declared"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "actionId": {
          "type": "string",
          "pattern": "^act_[a-z0-9-]{1,60}$"
        },
        "moveId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "amount",
        "hpAfter"
      ],
      "properties": {
        "type": {
          "const": "damage"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "amount": {
          "type": "integer",
          "minimum": 0
        },
        "hpAfter": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "current",
            "max"
          ],
          "properties": {
            "current": {
              "type": "integer",
              "minimum": 0
            },
            "max": {
              "type": "integer",
              "minimum": 1
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "amount",
        "hpAfter"
      ],
      "properties": {
        "type": {
          "const": "heal"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "amount": {
          "type": "integer",
          "minimum": 0
        },
        "hpAfter": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "current",
            "max"
          ],
          "properties": {
            "current": {
              "type": "integer",
              "minimum": 0
            },
            "max": {
              "type": "integer",
              "minimum": 1
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "stat",
        "deltaApplied",
        "stageAfter"
      ],
      "properties": {
        "type": {
          "const": "stat-stage"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "stat": {
          "enum": [
            "atk",
            "def",
            "spd"
          ]
        },
        "deltaApplied": {
          "type": "integer",
          "minimum": -6,
          "maximum": 6
        },
        "stageAfter": {
          "type": "integer",
          "minimum": -6,
          "maximum": 6
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "reason"
      ],
      "properties": {
        "type": {
          "const": "action-failed"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "reason": {
          "enum": [
            "stage-at-cap",
            "hp-full",
            "invalid-action"
          ]
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side"
      ],
      "properties": {
        "type": {
          "const": "struggle-used"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side"
      ],
      "properties": {
        "type": {
          "const": "ko"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "result",
        "reason"
      ],
      "properties": {
        "type": {
          "const": "battle-end"
        },
        "result": {
          "enum": [
            "p1",
            "p2",
            "draw"
          ]
        },
        "reason": {
          "enum": [
            "ko",
            "concede",
            "turn-limit",
            "timeout"
          ]
        }
      }
    }
  ]
};

/**
 * Public per-side event union, rebuilt from whitelisted facts only. Internal fields (causeId, seq, rngDraw, patch refs) are rejected by additionalProperties=false.
 */
export type BattleEvent =
  | {
      type: "turn-begin";
      turn: number;
      decisionId: string;
    }
  | {
      type: "action-declared";
      side: "p1" | "p2";
      actionId: string;
      moveId?: string;
    }
  | {
      type: "damage";
      side: "p1" | "p2";
      amount: number;
      hpAfter: {
        current: number;
        max: number;
      };
    }
  | {
      type: "heal";
      side: "p1" | "p2";
      amount: number;
      hpAfter: {
        current: number;
        max: number;
      };
    }
  | {
      type: "stat-stage";
      side: "p1" | "p2";
      stat: "atk" | "def" | "spd";
      deltaApplied: number;
      stageAfter: number;
    }
  | {
      type: "action-failed";
      side: "p1" | "p2";
      reason: "stage-at-cap" | "hp-full" | "invalid-action";
    }
  | {
      type: "struggle-used";
      side: "p1" | "p2";
    }
  | {
      type: "ko";
      side: "p1" | "p2";
    }
  | {
      type: "battle-end";
      result: "p1" | "p2" | "draw";
      reason: "ko" | "concede" | "turn-limit" | "timeout";
    };
