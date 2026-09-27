// Generated from schemas/public/observation.schema.json — do not edit; run pnpm contracts:gen.
export const observationSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/public/observation.schema.json",
  "title": "Observation",
  "description": "Per-side public projection. Contains no internal seq, RNG, inbox, or hidden move data.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "battleId",
    "side",
    "viewCursor",
    "revision",
    "turn",
    "rules",
    "own",
    "opponent",
    "decision",
    "terminal",
    "legalActions"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1
    },
    "battleId": {
      "type": "string",
      "pattern": "^btl_[a-z0-9-]{1,60}$"
    },
    "side": {
      "enum": [
        "p1",
        "p2"
      ]
    },
    "viewCursor": {
      "type": "integer",
      "minimum": 0
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "turn": {
      "type": "integer",
      "minimum": 0
    },
    "rules": {
      "$ref": "#/definitions/rulesRef"
    },
    "own": {
      "$ref": "#/definitions/ownUnit"
    },
    "opponent": {
      "$ref": "#/definitions/visibleOpponent"
    },
    "decision": {
      "anyOf": [
        {
          "$ref": "#/definitions/decisionInfo"
        },
        {
          "type": "null"
        }
      ]
    },
    "terminal": {
      "anyOf": [
        {
          "$ref": "#/definitions/terminalInfo"
        },
        {
          "type": "null"
        }
      ]
    },
    "legalActions": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/legalAction"
      }
    }
  },
  "definitions": {
    "rulesRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rulesetId",
        "rulesetHash",
        "contentHash",
        "executableHash",
        "irVersion"
      ],
      "properties": {
        "rulesetId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        },
        "rulesetHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "contentHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "executableHash": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "irVersion": {
          "const": 1
        }
      }
    },
    "hp": {
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
    },
    "stages": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "atk",
        "def",
        "spd"
      ],
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
    "publicEffect": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "type": "string",
          "minLength": 1
        },
        "remainingTurns": {
          "type": "integer",
          "minimum": 0
        },
        "stack": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "ownUnit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unitId",
        "speciesId",
        "hp",
        "ppByMoveId",
        "stages",
        "effects"
      ],
      "properties": {
        "unitId": {
          "type": "string",
          "pattern": "^unit_[a-z0-9-]{1,60}$"
        },
        "speciesId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        },
        "hp": {
          "$ref": "#/definitions/hp"
        },
        "ppByMoveId": {
          "type": "object",
          "additionalProperties": {
            "type": "integer",
            "minimum": 0
          }
        },
        "stages": {
          "$ref": "#/definitions/stages"
        },
        "effects": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/publicEffect"
          }
        },
        "mode": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "revives": {
          "type": "integer",
          "minimum": 0
        },
        "bench": {
          "description": "v2：己方后备单位（含血量/PP——自身秘密可知）；v1 局不出现该字段。",
          "type": "array",
          "items": {
            "$ref": "#/definitions/benchEntry"
          }
        }
      }
    },
    "benchEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unitId",
        "speciesId",
        "hp",
        "ppByMoveId",
        "stages",
        "effects",
        "alive"
      ],
      "properties": {
        "unitId": {
          "type": "string",
          "pattern": "^unit_[a-z0-9-]{1,60}$"
        },
        "speciesId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        },
        "hp": {
          "$ref": "#/definitions/hp"
        },
        "ppByMoveId": {
          "type": "object",
          "additionalProperties": {
            "type": "integer",
            "minimum": 0
          }
        },
        "stages": {
          "$ref": "#/definitions/stages"
        },
        "effects": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/publicEffect"
          }
        },
        "mode": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "revives": {
          "type": "integer",
          "minimum": 0
        },
        "alive": {
          "type": "boolean"
        }
      }
    },
    "visibleOpponent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unitId",
        "speciesId",
        "hp",
        "revealedMoveIds",
        "ppEstimate",
        "stages",
        "effects"
      ],
      "properties": {
        "unitId": {
          "type": "string",
          "pattern": "^unit_[a-z0-9-]{1,60}$"
        },
        "speciesId": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*$"
        },
        "hp": {
          "$ref": "#/definitions/hp"
        },
        "revealedMoveIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "ppEstimate": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind"
              ],
              "properties": {
                "kind": {
                  "const": "unknown"
                }
              }
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind",
                "value"
              ],
              "properties": {
                "kind": {
                  "const": "exact"
                },
                "value": {
                  "type": "integer",
                  "minimum": 0
                }
              }
            }
          ]
        },
        "stages": {
          "$ref": "#/definitions/stages"
        },
        "effects": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/publicEffect"
          }
        },
        "mode": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "benchAlive": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "terminalInfo": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "result",
        "reason"
      ],
      "properties": {
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
    },
    "decisionInfo": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "decisionId",
        "kind",
        "baseRevision",
        "actors",
        "deadlineMs"
      ],
      "properties": {
        "decisionId": {
          "type": "string",
          "pattern": "^dec_[a-z0-9-]{1,60}$"
        },
        "kind": {
          "enum": [
            "turn",
            "replacement"
          ]
        },
        "baseRevision": {
          "type": "integer",
          "minimum": 0
        },
        "actors": {
          "type": "array",
          "items": {
            "enum": [
              "p1",
              "p2"
            ]
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "deadlineMs": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "legalAction": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "actionId",
        "action",
        "label"
      ],
      "properties": {
        "actionId": {
          "type": "string",
          "pattern": "^act_[a-z0-9-]{1,60}$"
        },
        "action": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind",
                "moveSlot",
                "target"
              ],
              "properties": {
                "kind": {
                  "const": "move"
                },
                "moveSlot": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 3
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
                "kind",
                "unitId"
              ],
              "properties": {
                "kind": {
                  "const": "switch"
                },
                "unitId": {
                  "type": "string",
                  "pattern": "^unit_[a-z0-9-]{1,60}$"
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
                  "const": "struggle"
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
                  "const": "concede"
                }
              }
            }
          ]
        },
        "label": {
          "type": "string",
          "minLength": 1
        }
      }
    }
  }
};

/**
 * Per-side public projection. Contains no internal seq, RNG, inbox, or hidden move data.
 */
export interface Observation {
  schemaVersion: 1;
  battleId: string;
  side: "p1" | "p2";
  viewCursor: number;
  revision: number;
  turn: number;
  rules: RulesRef;
  own: OwnUnit;
  opponent: VisibleOpponent;
  decision: DecisionInfo | null;
  terminal: TerminalInfo | null;
  legalActions: LegalAction[];
}
export interface RulesRef {
  rulesetId: string;
  rulesetHash: string;
  contentHash: string;
  executableHash: string;
  irVersion: 1;
}
export interface OwnUnit {
  unitId: string;
  speciesId: string;
  hp: Hp;
  ppByMoveId: {
    [k: string]: number;
  };
  stages: Stages;
  effects: PublicEffect[];
  mode?: string;
  revives?: number;
  /**
   * v2：己方后备单位（含血量/PP——自身秘密可知）；v1 局不出现该字段。
   */
  bench?: BenchEntry[];
}
export interface Hp {
  current: number;
  max: number;
}
export interface Stages {
  atk: number;
  def: number;
  spd: number;
}
export interface PublicEffect {
  kind: string;
  remainingTurns?: number;
  stack?: number;
}
export interface BenchEntry {
  unitId: string;
  speciesId: string;
  hp: Hp;
  ppByMoveId: {
    [k: string]: number;
  };
  stages: Stages;
  effects: PublicEffect[];
  mode?: string;
  revives?: number;
  alive: boolean;
}
export interface VisibleOpponent {
  unitId: string;
  speciesId: string;
  hp: Hp;
  revealedMoveIds: string[];
  ppEstimate:
    | {
        kind: "unknown";
      }
    | {
        kind: "exact";
        value: number;
      };
  stages: Stages;
  effects: PublicEffect[];
  mode?: string;
  benchAlive?: number;
}
export interface DecisionInfo {
  decisionId: string;
  kind: "turn" | "replacement";
  baseRevision: number;
  /**
   * @minItems 1
   */
  actors: ("p1" | "p2")[];
  deadlineMs: number;
}
export interface TerminalInfo {
  result: "p1" | "p2" | "draw";
  reason: "ko" | "concede" | "turn-limit" | "timeout";
}
export interface LegalAction {
  actionId: string;
  action:
    | {
        kind: "move";
        moveSlot: number;
        target: "self" | "opponent";
      }
    | {
        kind: "switch";
        unitId: string;
      }
    | {
        kind: "struggle";
      }
    | {
        kind: "concede";
      };
  label: string;
}
