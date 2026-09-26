// Generated from schemas/internal/state.schema.json — do not edit; run pnpm contracts:gen.
export const stateSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/internal/state.schema.json",
  "title": "BattleState",
  "description": "INTERNAL authoritative state. Contains secrets (full movesets, PP, RNG, inbox); never serialized to wire.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "battleId",
    "rules",
    "revision",
    "turn",
    "phase",
    "rng",
    "sides",
    "decision",
    "inbox",
    "eventSeq",
    "publicCursors",
    "speedTiebreak",
    "terminal"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1
    },
    "battleId": {
      "type": "string",
      "pattern": "^btl_[a-z0-9-]{1,60}$"
    },
    "rules": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rulesetId",
        "rulesetVersion",
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
        "rulesetVersion": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$"
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
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "turn": {
      "type": "integer",
      "minimum": 0
    },
    "phase": {
      "enum": [
        "init",
        "collect",
        "order",
        "before_action",
        "resolve_hit",
        "checkpoint",
        "after_action",
        "turn_end",
        "next",
        "end"
      ]
    },
    "rng": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "algorithmId",
        "seedHex",
        "drawCounter"
      ],
      "properties": {
        "algorithmId": {
          "type": "string",
          "minLength": 1
        },
        "seedHex": {
          "type": "string",
          "pattern": "^[0-9a-f]{32}$"
        },
        "drawCounter": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "sides": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "p1",
        "p2"
      ],
      "properties": {
        "p1": {
          "$ref": "#/definitions/internalSide"
        },
        "p2": {
          "$ref": "#/definitions/internalSide"
        }
      }
    },
    "decision": {
      "anyOf": [
        {
          "type": "null"
        },
        {
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
        }
      ]
    },
    "inbox": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "p1",
        "p2"
      ],
      "properties": {
        "p1": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/definitions/inboxSubmission"
            }
          ]
        },
        "p2": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/definitions/inboxSubmission"
            }
          ]
        }
      }
    },
    "eventSeq": {
      "type": "integer",
      "minimum": 0
    },
    "publicCursors": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "p1",
        "p2"
      ],
      "properties": {
        "p1": {
          "type": "integer",
          "minimum": 0
        },
        "p2": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "speedTiebreak": {
      "description": "Memoized once-per-battle speed-tie outcome (synthetic-v1 §6: at most one tiebreak draw per battle).",
      "anyOf": [
        {
          "type": "null"
        },
        {
          "enum": [
            "p1",
            "p2"
          ]
        }
      ]
    },
    "terminal": {
      "anyOf": [
        {
          "type": "null"
        },
        {
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
        }
      ]
    }
  },
  "definitions": {
    "internalSide": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unit"
      ],
      "properties": {
        "unit": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "unitId",
            "speciesId",
            "base",
            "currentHp",
            "stages",
            "moves",
            "revealedMoveIds",
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
            "base": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "hp",
                "atk",
                "def",
                "spd"
              ],
              "properties": {
                "hp": {
                  "type": "integer",
                  "minimum": 1
                },
                "atk": {
                  "type": "integer",
                  "minimum": 1
                },
                "def": {
                  "type": "integer",
                  "minimum": 1
                },
                "spd": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            },
            "currentHp": {
              "type": "integer",
              "minimum": 0
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
            "moves": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "moveId",
                  "pp",
                  "ppMax"
                ],
                "properties": {
                  "moveId": {
                    "type": "string",
                    "pattern": "^[a-z0-9][a-z0-9-]*$"
                  },
                  "pp": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "ppMax": {
                    "type": "integer",
                    "minimum": 1
                  }
                }
              }
            },
            "revealedMoveIds": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "uniqueItems": true
            },
            "effects": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind",
                  "effectInstanceId"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "minLength": 1
                  },
                  "effectInstanceId": {
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
                  },
                  "hidden": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        }
      }
    },
    "inboxSubmission": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "actionId",
        "idempotencyKey",
        "canonicalDigest",
        "receiptId",
        "receivedSeq"
      ],
      "properties": {
        "actionId": {
          "type": "string",
          "pattern": "^act_[a-z0-9-]{1,60}$"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 128
        },
        "canonicalDigest": {
          "type": "string",
          "pattern": "^sha256:[0-9a-f]{64}$"
        },
        "receiptId": {
          "type": "string",
          "pattern": "^rcpt_[a-z0-9-]{1,60}$"
        },
        "receivedSeq": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  }
};

/**
 * INTERNAL authoritative state. Contains secrets (full movesets, PP, RNG, inbox); never serialized to wire.
 */
export interface BattleState {
  schemaVersion: 1;
  battleId: string;
  rules: {
    rulesetId: string;
    rulesetVersion: string;
    rulesetHash: string;
    contentHash: string;
    executableHash: string;
    irVersion: 1;
  };
  revision: number;
  turn: number;
  phase:
    | "init"
    | "collect"
    | "order"
    | "before_action"
    | "resolve_hit"
    | "checkpoint"
    | "after_action"
    | "turn_end"
    | "next"
    | "end";
  rng: {
    algorithmId: string;
    seedHex: string;
    drawCounter: number;
  };
  sides: {
    p1: InternalSide;
    p2: InternalSide;
  };
  decision: null | {
    decisionId: string;
    kind: "turn" | "replacement";
    baseRevision: number;
    /**
     * @minItems 1
     */
    actors: ("p1" | "p2")[];
    deadlineMs: number;
  };
  inbox: {
    p1: null | InboxSubmission;
    p2: null | InboxSubmission;
  };
  eventSeq: number;
  publicCursors: {
    p1: number;
    p2: number;
  };
  /**
   * Memoized once-per-battle speed-tie outcome (synthetic-v1 §6: at most one tiebreak draw per battle).
   */
  speedTiebreak: null | ("p1" | "p2");
  terminal: null | {
    result: "p1" | "p2" | "draw";
    reason: "ko" | "concede" | "turn-limit" | "timeout";
  };
}
export interface InternalSide {
  unit: {
    unitId: string;
    speciesId: string;
    base: {
      hp: number;
      atk: number;
      def: number;
      spd: number;
    };
    currentHp: number;
    stages: {
      atk: number;
      def: number;
      spd: number;
    };
    /**
     * @minItems 1
     */
    moves: {
      moveId: string;
      pp: number;
      ppMax: number;
    }[];
    revealedMoveIds: string[];
    effects: {
      kind: string;
      effectInstanceId: string;
      remainingTurns?: number;
      stack?: number;
      hidden?: boolean;
    }[];
  };
}
export interface InboxSubmission {
  actionId: string;
  idempotencyKey: string;
  canonicalDigest: string;
  receiptId: string;
  receivedSeq: number;
}
