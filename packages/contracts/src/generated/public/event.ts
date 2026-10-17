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
        "damageKind": {
          "enum": [
            "standard",
            "fixed",
            "percent",
            "true"
          ]
        },
        "eff16": {
          "type": "integer",
          "minimum": 0
        },
        "stab": {
          "type": "boolean"
        },
        "moveType": {
          "type": "string"
        },
        "category": {
          "enum": [
            "physical",
            "special"
          ]
        },
        "cause": {
          "type": "string",
          "description": "伤害来源标记：struggle=挣扎反噬 / 魂印固伤=sm-* 等公开归因"
        },
        "crit": {
          "type": "boolean",
          "description": "致命一击"
        },
        "recoil": {
          "type": "boolean"
        },
        "hit": {
          "type": "integer",
          "minimum": 1,
          "description": "连击第几击（hits>1 时出现）"
        },
        "hits": {
          "type": "integer",
          "minimum": 2,
          "description": "连击总次数"
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
        "source": {
          "type": "string",
          "description": "回复来源标记（如魂印 id）"
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
          "anyOf": [
            {
              "enum": [
                "stage-at-cap",
                "hp-full",
                "invalid-action",
                "controlled",
                "overlay_immune",
                "no-stages",
                "no-control",
                "status-locked",
                "move-nullified",
                "bound",
                "heal-blocked",
                "down_lock",
                "up_lock",
                "no-bench",
                "no-boost",
                "pp-delta-noop",
                "pp-slot-missing"
              ]
            },
            {
              "type": "string",
              "pattern": "^status:[a-z_-]{1,30}$"
            }
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
          "const": "missed"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
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
        "side"
      ],
      "properties": {
        "type": {
          "const": "protected"
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
        "side",
        "delta"
      ],
      "properties": {
        "type": {
          "const": "pp-delta"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "delta": {
          "type": "integer",
          "description": "PP 增减量（脱敏后仅透出侧别与增减量——不公开 moveId/ppAfter）"
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
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "name",
        "turns"
      ],
      "properties": {
        "type": {
          "const": "effect-applied"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "turns": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "name"
      ],
      "properties": {
        "type": {
          "const": "effect-faded"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "name"
      ],
      "properties": {
        "type": {
          "const": "control-immune"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "stages"
      ],
      "properties": {
        "type": {
          "const": "stages-transferred"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
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
              "minimum": 0,
              "maximum": 6
            },
            "def": {
              "type": "integer",
              "minimum": 0,
              "maximum": 6
            },
            "spd": {
              "type": "integer",
              "minimum": 0,
              "maximum": 6
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
        "side"
      ],
      "properties": {
        "type": {
          "const": "stages-cleared"
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
        "side",
        "outUnitId",
        "inUnitId",
        "via"
      ],
      "properties": {
        "type": {
          "const": "switch"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "outUnitId": {
          "type": "string",
          "minLength": 1
        },
        "inUnitId": {
          "type": "string",
          "minLength": 1
        },
        "via": {
          "enum": [
            "action",
            "replacement",
            "forced"
          ]
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "side",
        "hpAfter"
      ],
      "properties": {
        "type": {
          "const": "revive"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
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
        "mark",
        "effect"
      ],
      "properties": {
        "type": {
          "const": "soulmark"
        },
        "side": {
          "enum": [
            "p1",
            "p2"
          ]
        },
        "mark": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string"
        },
        "effect": {
          "type": "string",
          "minLength": 1
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
      damageKind?: "standard" | "fixed" | "percent" | "true";
      eff16?: number;
      stab?: boolean;
      moveType?: string;
      category?: "physical" | "special";
      /**
       * 伤害来源标记：struggle=挣扎反噬 / 魂印固伤=sm-* 等公开归因
       */
      cause?: string;
      /**
       * 致命一击
       */
      crit?: boolean;
      recoil?: boolean;
      /**
       * 连击第几击（hits>1 时出现）
       */
      hit?: number;
      /**
       * 连击总次数
       */
      hits?: number;
      hpAfter: {
        current: number;
        max: number;
      };
    }
  | {
      type: "heal";
      side: "p1" | "p2";
      amount: number;
      /**
       * 回复来源标记（如魂印 id）
       */
      source?: string;
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
      reason:
        | (
            | "stage-at-cap"
            | "hp-full"
            | "invalid-action"
            | "controlled"
            | "overlay_immune"
            | "no-stages"
            | "no-control"
            | "status-locked"
            | "move-nullified"
            | "bound"
            | "heal-blocked"
            | "down_lock"
            | "up_lock"
            | "no-bench"
            | "no-boost"
            | "pp-delta-noop"
            | "pp-slot-missing"
          )
        | string;
    }
  | {
      type: "struggle-used";
      side: "p1" | "p2";
    }
  | {
      type: "missed";
      side: "p1" | "p2";
      moveId?: string;
    }
  | {
      type: "protected";
      side: "p1" | "p2";
    }
  | {
      type: "pp-delta";
      side: "p1" | "p2";
      /**
       * PP 增减量（脱敏后仅透出侧别与增减量——不公开 moveId/ppAfter）
       */
      delta: number;
    }
  | {
      type: "ko";
      side: "p1" | "p2";
    }
  | {
      type: "battle-end";
      result: "p1" | "p2" | "draw";
      reason: "ko" | "concede" | "turn-limit" | "timeout";
    }
  | {
      type: "effect-applied";
      side: "p1" | "p2";
      name: string;
      turns: number;
    }
  | {
      type: "effect-faded";
      side: "p1" | "p2";
      name: string;
    }
  | {
      type: "control-immune";
      side: "p1" | "p2";
      name: string;
    }
  | {
      type: "stages-transferred";
      side: "p1" | "p2";
      stages: {
        atk: number;
        def: number;
        spd: number;
      };
    }
  | {
      type: "stages-cleared";
      side: "p1" | "p2";
    }
  | {
      type: "switch";
      side: "p1" | "p2";
      outUnitId: string;
      inUnitId: string;
      via: "action" | "replacement" | "forced";
    }
  | {
      type: "revive";
      side: "p1" | "p2";
      hpAfter: {
        current: number;
        max: number;
      };
    }
  | {
      type: "soulmark";
      side: "p1" | "p2";
      mark: string;
      name?: string;
      effect: string;
    };
