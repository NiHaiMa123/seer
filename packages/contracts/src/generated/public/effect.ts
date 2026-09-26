// Generated from schemas/public/effect.schema.json — do not edit; run pnpm contracts:gen.
export const effectSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/public/effect.schema.json",
  "title": "EffectDefinition",
  "description": "Authoring form for mechanic content. ops use the closed IR; condition is a bounded AST. Concrete unitId must not appear (selectors only).",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "effectId",
    "trigger",
    "effects",
    "duration",
    "stackPolicy"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1
    },
    "effectId": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9-]*$"
    },
    "trigger": {
      "enum": [
        "on_entry",
        "before_action",
        "on_hit",
        "on_damage_taken",
        "turn_end",
        "on_ko",
        "manual"
      ]
    },
    "condition": {
      "$ref": "#/definitions/condition"
    },
    "effects": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/effectOp"
      }
    },
    "duration": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind"
          ],
          "properties": {
            "kind": {
              "const": "instant"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "turns"
          ],
          "properties": {
            "kind": {
              "const": "turns"
            },
            "turns": {
              "type": "integer",
              "minimum": 1,
              "maximum": 99
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind"
          ],
          "properties": {
            "kind": {
              "const": "persistent"
            }
          }
        }
      ]
    },
    "stackPolicy": {
      "enum": [
        "replace",
        "stack",
        "refresh",
        "independent"
      ]
    }
  },
  "definitions": {
    "effectOp": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "power"
          ],
          "properties": {
            "op": {
              "const": "damage"
            },
            "power": {
              "type": "integer",
              "minimum": 1
            },
            "target": {
              "enum": [
                "self",
                "opponent"
              ]
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "stat",
            "delta",
            "target"
          ],
          "properties": {
            "op": {
              "const": "apply_stat_stage"
            },
            "stat": {
              "enum": [
                "atk",
                "def",
                "spd"
              ]
            },
            "delta": {
              "anyOf": [
                {
                  "type": "integer",
                  "minimum": -6,
                  "maximum": -1
                },
                {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 6
                }
              ]
            },
            "target": {
              "enum": [
                "self",
                "opponent"
              ]
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "numerator",
            "denominator",
            "target"
          ],
          "properties": {
            "op": {
              "const": "heal"
            },
            "numerator": {
              "type": "integer",
              "minimum": 1
            },
            "denominator": {
              "type": "integer",
              "minimum": 1
            },
            "target": {
              "enum": [
                "self",
                "opponent"
              ]
            }
          }
        }
      ]
    },
    "condition": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "items"
          ],
          "properties": {
            "kind": {
              "enum": [
                "and",
                "or"
              ]
            },
            "items": {
              "type": "array",
              "minItems": 1,
              "items": {
                "$ref": "#/definitions/condition"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "item"
          ],
          "properties": {
            "kind": {
              "const": "not"
            },
            "item": {
              "$ref": "#/definitions/condition"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "path",
            "op",
            "value"
          ],
          "properties": {
            "kind": {
              "const": "cmp"
            },
            "path": {
              "type": "string",
              "pattern": "^(self|opponent)\\.(hp|maxHp|atk|def|spd|atkStage|defStage|spdStage|pp)$"
            },
            "op": {
              "enum": [
                "eq",
                "ne",
                "lt",
                "le",
                "gt",
                "ge"
              ]
            },
            "value": {
              "anyOf": [
                {
                  "type": "number"
                },
                {
                  "type": "boolean"
                },
                {
                  "type": "string"
                }
              ]
            }
          }
        }
      ]
    }
  }
};

export type Condition =
  | {
      kind: "and" | "or";
      /**
       * @minItems 1
       */
      items: Condition[];
    }
  | {
      kind: "not";
      item: Condition;
    }
  | {
      kind: "cmp";
      path: string;
      op: "eq" | "ne" | "lt" | "le" | "gt" | "ge";
      value: number | boolean | string;
    };
export type EffectOp =
  | {
      op: "damage";
      power: number;
      target?: "self" | "opponent";
    }
  | {
      op: "apply_stat_stage";
      stat: "atk" | "def" | "spd";
      delta: number;
      target: "self" | "opponent";
    }
  | {
      op: "heal";
      numerator: number;
      denominator: number;
      target: "self" | "opponent";
    };

/**
 * Authoring form for mechanic content. ops use the closed IR; condition is a bounded AST. Concrete unitId must not appear (selectors only).
 */
export interface EffectDefinition {
  schemaVersion: 1;
  effectId: string;
  trigger:
    "on_entry" | "before_action" | "on_hit" | "on_damage_taken" | "turn_end" | "on_ko" | "manual";
  condition?: Condition;
  /**
   * @minItems 1
   */
  effects: EffectOp[];
  duration:
    | {
        kind: "instant";
      }
    | {
        kind: "turns";
        turns: number;
      }
    | {
        kind: "persistent";
      };
  stackPolicy: "replace" | "stack" | "refresh" | "independent";
}
