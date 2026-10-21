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
    "suspension": {
      "description": "v2 mid-turn KO suspend: KO 方有待替补且未终局。含未执行完的另一方 actionId（阵亡者原行动作废）。",
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "koSide",
            "remaining"
          ],
          "properties": {
            "teDone": {
              "type": "boolean",
              "description": "true = 挂起由 TURN_END 钩子产出（回合末固伤 KO）→ applyReplacement 不得再跑 runTurnEnd（防二次衰减/钩子双触发）"
            },
            "teCursor": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "side",
                "unitId",
                "win",
                "item"
              ],
              "properties": {
                "side": {
                  "enum": [
                    "p1",
                    "p2"
                  ]
                },
                "unitId": {
                  "type": "string"
                },
                "win": {
                  "type": "integer",
                  "minimum": 0
                },
                "item": {
                  "type": "integer",
                  "minimum": 0
                }
              },
              "description": "TURN_END 挂起恢复游标：win=该侧已挂起的窗口序号，item=窗口内已结算条目序数（该条目伤害已落账，续跑从 item+1 起）。unitId 校验：替补换入后剩余窗口归属旧单位，整体跳过"
            },
            "firstSide": {
              "enum": [
                "p1",
                "p2"
              ],
              "description": "本回合先行动方——续跑行动评估 order 条件（先出手威力加倍等）用"
            },
            "koSide": {
              "enum": [
                "p1",
                "p2"
              ]
            },
            "remaining": {
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
                      "type": "string",
                      "pattern": "^act_[a-z0-9-]{1,60}$"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "p2": {
                  "anyOf": [
                    {
                      "type": "string",
                      "pattern": "^act_[a-z0-9-]{1,60}$"
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            }
          }
        }
      ]
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
    "numericValue": {
      "title": "NumericValue",
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "stat"
          ],
          "properties": {
            "stat": {
              "enum": [
                "hp",
                "atk",
                "def",
                "spa",
                "sdf",
                "spd"
              ]
            },
            "of": {
              "enum": [
                "self",
                "foe",
                "target"
              ]
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "count"
          ],
          "properties": {
            "count": {
              "const": "ailments"
            },
            "of": {
              "enum": [
                "self",
                "foe",
                "target"
              ]
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "sum"
          ],
          "properties": {
            "sum": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "$ref": "#/definitions/numericValue"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "product"
          ],
          "properties": {
            "product": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "$ref": "#/definitions/numericValue"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "difference"
          ],
          "properties": {
            "difference": {
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "$ref": "#/definitions/numericValue"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "divide"
          ],
          "properties": {
            "divide": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "value",
                "by"
              ],
              "properties": {
                "value": {
                  "$ref": "#/definitions/numericValue"
                },
                "by": {
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
            "min"
          ],
          "properties": {
            "min": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "$ref": "#/definitions/numericValue"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "max"
          ],
          "properties": {
            "max": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "$ref": "#/definitions/numericValue"
              }
            }
          }
        }
      ]
    },
    "internalSide": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "unit"
      ],
      "properties": {
        "bench": {
          "description": "v2 bench：后备单位数组；v1 包不写该字段（hash 不变靠不写）。",
          "type": "array",
          "items": {
            "$ref": "#/definitions/internalUnit"
          }
        },
        "unit": {
          "$ref": "#/definitions/internalUnit"
        },
        "stocks": {
          "description": "机制消耗品剩余次数（itemId → 剩余）。无机制不写。只投影给己方。",
          "type": "object",
          "additionalProperties": {
            "type": "integer",
            "minimum": 0
          }
        },
        "fieldMarks": {
          "description": "场地印记（五行印记/圣剑等挂在侧而非单位的计数印记）：kind=mark:*，count=层数，remainingTurns 随回合末递减。",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "count"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "pattern": "^mark:.+$"
              },
              "count": {
                "type": "integer",
                "minimum": 1
              },
              "remainingTurns": {
                "type": "integer",
                "minimum": 0
              },
              "appliedTurn": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        },
        "nextInFx": {
          "description": "下只出场精灵效果队列（'对手下只出场精灵X'）：登场时逐条以 target:self 结算；moveId 供 payload ctx 还原。",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "moveId",
              "fx"
            ],
            "properties": {
              "moveId": {
                "type": "string"
              },
              "fx": {
                "type": "object"
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
    },
    "internalUnit": {
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
        "level": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "seals": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^seal-\\d+$"
          },
          "maxItems": 6
        },
        "soul": {
          "description": "soulmark 机制：魂印运行时状态（prev=回合末快照，供 endure 回卷）。",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "id"
          ],
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^sm-[a-z0-9-]+$"
            },
            "endured": {
              "type": "boolean"
            },
            "endurePending": {
              "type": "boolean"
            },
            "revived": {
              "type": "boolean"
            },
            "shield": {
              "type": "boolean"
            },
            "shieldUsed": {
              "type": "boolean"
            },
            "firedOnce": {
              "type": "object",
              "description": "limitBattle 条目已触发的 effects 下标（内部状态，不经 projections 公开）",
              "additionalProperties": {
                "type": "boolean"
              }
            },
            "chanceAcc": {
              "type": "object",
              "description": "chanceGrow 累积值（内部状态，不经 projections 公开）",
              "additionalProperties": {
                "type": "integer"
              }
            },
            "magAcc": {
              "type": "object",
              "description": "growStep 幅度累积值（内部状态，不经 projections 公开）",
              "additionalProperties": {
                "type": "integer"
              }
            },
            "entryInit": {
              "type": "boolean",
              "description": "登场生命周期已初始化：首发/换入的 onEntry 只应结算一次"
            },
            "battleStartDone": {
              "type": "boolean",
              "description": "onBattleStart 已结算：每场战斗至多一次"
            },
            "teResume": {
              "type": "object",
              "description": "hook/flag 条目内挂起的续跑游标：同回合同 hook 重派时从断点续跑。phase=flags 表示 flag 段挂起（item=下一待结算 effects 下标）；缺省=hooks 段（item=挂起条目下标，opItem=条目内已结算 op 数，branch=已选定 else 分支）",
              "additionalProperties": false,
              "required": [
                "hook",
                "item",
                "opItem",
                "turn"
              ],
              "properties": {
                "hook": {
                  "type": "string"
                },
                "item": {
                  "type": "integer",
                  "minimum": 0
                },
                "opItem": {
                  "type": "integer",
                  "minimum": 0
                },
                "turn": {
                  "type": "integer",
                  "minimum": 0
                },
                "phase": {
                  "enum": [
                    "flags"
                  ]
                },
                "branch": {
                  "enum": [
                    "else"
                  ]
                }
              }
            },
            "prev": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "hp",
                "pp",
                "stages"
              ],
              "properties": {
                "hp": {
                  "type": "integer",
                  "minimum": 0
                },
                "pp": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "integer",
                    "minimum": 0
                  }
                },
                "stages": {
                  "type": "object"
                }
              }
            }
          }
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
            "spa": {
              "type": "integer",
              "minimum": 1
            },
            "sdf": {
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
            "spa": {
              "type": "integer",
              "minimum": -6,
              "maximum": 6
            },
            "sdf": {
              "type": "integer",
              "minimum": -6,
              "maximum": 6
            },
            "spd": {
              "type": "integer",
              "minimum": -6,
              "maximum": 6
            },
            "acc": {
              "type": "integer",
              "minimum": -6,
              "maximum": 6
            },
            "crt": {
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
        "mode": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "revives": {
          "type": "integer",
          "minimum": 0
        },
        "moveStacks": {
          "type": "object",
          "additionalProperties": {
            "type": "integer",
            "minimum": 0
          },
          "description": "连续使用计数：moveId → 已连用次数（叠用机制 powerPerUse/flatPerUse/prioPerUse）"
        },
        "moveMarks": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 1
            }
          },
          "description": "招式槽印记（致命印记等挂在招式上的计数印记）：moveId → 印记名 → 层数。随单位迁移（换下保留），死亡清空。"
        },
        "lastMoveId": {
          "type": "string",
          "description": "本回合前最近一次成功声明的招式（叠用连续性判定）"
        },
        "lastMoveCat": {
          "type": "integer",
          "enum": [
            1,
            2,
            3
          ],
          "description": "最近一次声明的招式类别（1属性 2物理 3特殊；与 lastMoveId 同点写入，含失败声明）。魂印类别连用读的是回合初快照 prevMoveCat，不读本字段。"
        },
        "prevMoveCat": {
          "type": "integer",
          "enum": [
            1,
            2,
            3
          ],
          "description": "本回合开始时从 lastMoveCat 拷下的上一动类别。回合中不刷新，保证排序与双方出招看到同一连用判定。"
        },
        "prevMoveId": {
          "type": "string",
          "description": "本回合开始时从 lastMoveId 拷下的上一动招式。同一技能连用读这个，不读声明后已覆写的 lastMoveId。回合中不刷新。"
        },
        "turnPrio": {
          "type": "integer",
          "description": "本回合的实际先制等级（engine 的 prio() 结果：基础 priority + prio_up 窗 + 条件先制 + 机制钩子 + 连用加成）。排序时写回，供 prioZero 等谓词读「本回合实际先制」而不是面板 priority。"
        },
        "catStreak": {
          "type": "integer",
          "minimum": 0,
          "description": "同类招式连续声明计数（'连续N次使用攻击技能时X' 的 N 判定）：与 lastMoveCat 同点写入——同类 +1，换类回 1。"
        },
        "turnStartHp": {
          "type": "integer",
          "minimum": 0,
          "description": "回合开始体力快照（'若自身体力等于回合开始时'/'恢复至回合开始时体力'谓词）。applyTurnInner 首行写入，回合中不刷新。"
        },
        "turnStartStages": {
          "type": "object",
          "additionalProperties": {
            "type": "integer"
          },
          "description": "回合开始能力等级快照（'回退到回合开始时强化'类谓词）。与 turnStartHp 同点写入。"
        },
        "effFloor": {
          "type": "integer",
          "minimum": 0,
          "description": "这一击的克制倍率下限（×16 定点，1.0=16）。eff_max（'克制倍数取自身对对手、对手对自身克制倍数中的最大值'）写在行动方单位上，再被同一次命中的克制读法（formula.resist）用掉即清——不跨回合留存。"
        },
        "missStreak": {
          "type": "integer",
          "minimum": 0,
          "description": "连续未命中计数（'前N个回合对手攻击均未命中'窗谓词）：对手命中清零，MISS +1。"
        },
        "hitStreak": {
          "type": "integer",
          "minimum": 0,
          "description": "攻击方连续命中计数（'对手连续命中则X'读 foe.hitStreak）：攻击招式命中 +1，MISS 清零。"
        },
        "orderStreak": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "order",
            "n"
          ],
          "properties": {
            "order": {
              "enum": [
                "first",
                "last"
              ]
            },
            "n": {
              "type": "integer",
              "minimum": 1
            }
          },
          "description": "连续先/后出手计数（'连续N回合后出手则X'谓词）：同序 n+1，换序重置。"
        },
        "entryWasSwitch": {
          "type": "boolean",
          "description": "本次登场为主动切换（'若本次登场为主动切换登场则X'谓词）：doSwitch via=action 写入 true，战后补位/首发为 false。"
        },
        "stageUpLog": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "本回合内被提升的能力键（'与上回合增加的属性不同'谓词——回合开始拷入 prevStageUpLog 后清空）"
        },
        "prevStageUpLog": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "上回合被提升的能力键（stageUpLog 的回合初快照）"
        },
        "immuneThisTurn": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合成功免疫次数（'若成功触发免疫则'/'每次免疫成功后'谓词）：异常免疫/伤害免疫/致命免疫等闸门点递增，回合初清零。"
        },
        "immunedMask": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合成功免疫的种类位掩码（bit1=攻击伤害 bit2=固定伤害 bit4=百分比伤害 bit8=异常/控制 bit16=能力下降）——'若当回合自身成功免疫X则'分类谓词"
        },
        "nullifiedMask": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合招式被无效化的类别位掩码（bit1=属性 bit2=物理 bit4=特殊——status-locked/move-nullified 路径写入；'若自身的属性技能失效则'谓词读位）"
        },
        "lastDealt": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合行动中已造成的累计伤害（'使自身下次受到的伤害减少n点，n等于本回合自身造成的伤害'/'附加对手上次造成伤害'）"
        },
        "dealtThisTurn": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合已造成的累计伤害（dealt_tick'回合结束时附加N%伤害量的固定伤害'读取——回合开始时清零，回合末窗口结算后归零）"
        },
        "banished": {
          "type": "boolean",
          "description": "消逝标记（'令对方场下阵亡的首位精灵消逝'——场下阵亡单位不可被选中/复活，存活扫描一律排除）"
        },
        "lastTaken": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合行动中已承受的累计伤害（'附加自身当回合所受技能伤害N%的百分比伤害'）"
        },
        "lastTakenKind": {
          "type": "string",
          "enum": [
            "standard",
            "fixed",
            "percent",
            "true"
          ],
          "description": "本回合最近一次受击的伤害类型（'受到真实伤害后X'谓词）"
        },
        "lastHeal": {
          "type": "integer",
          "minimum": 0,
          "description": "当次行动最近一次实际回复量（'恢复的体力值低于N则X'谓词）"
        },
        "lastHealOverflow": {
          "type": "integer",
          "minimum": 0,
          "description": "当次行动最近一次回复溢出量（'获得等同于溢出量的护罩'——amount-healed 封顶外溢）"
        },
        "prevHeal": {
          "type": "integer",
          "minimum": 0,
          "description": "最近一次实际回复量持久快照（跨回合'下次…等同于恢复量的固定伤害'——不随回合清除，仅被新回复覆写）"
        },
        "prevTaken": {
          "type": "integer",
          "minimum": 0,
          "description": "上次行动回合期间承受的累计伤害快照（'若上回合自身未受到攻击伤害则X'谓词）"
        },
        "shieldAbsorbed": {
          "type": "integer",
          "minimum": 0,
          "description": "本回合护盾/护罩吸收量累计（'护盾所吸收的伤害值N%反弹'读取——回合开始清零）"
        },
        "lastShieldConsumed": {
          "type": "integer",
          "minimum": 0,
          "description": "最近一次 consumeShield 消耗量快照（'若当前护罩值低于N'条件读——消耗语义下当前值=消耗值）"
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
              "amountExpr": {
                "$ref": "#/definitions/numericValue"
              },
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
              "appliedTurn": {
                "type": "integer",
                "minimum": 0
              },
              "params": {
                "type": "object",
                "additionalProperties": {
                  "type": "integer"
                },
                "description": "效果幅值参数（timed 效果的 n/d/add 等）"
              },
              "stack": {
                "type": "integer",
                "minimum": 1
              },
              "label": {
                "type": "string",
                "description": "审计标签（periodic/immune/reflect/modifier 轴条目的原语义名——合并键与事件 cause）"
              },
              "at": {
                "type": "string",
                "minLength": 1,
                "description": "modifier 轴管线槽位（kind=modifier 时存在；消费点 isMod(e,at) 匹配）"
              },
              "ailment": {
                "type": "string",
                "description": "定向域子类（immune{of:status}+ailment=仅挡该异常；对应原 name:ailment 复合 kind）"
              },
              "moveType": {
                "type": "string",
                "description": "系别门控（来招 type 与门控名不符则该条目窗口关闭——'受到的火系攻击伤害减半'/'电系技能威力翻倍'）"
              },
              "payload": {
                "type": "array",
                "items": {
                  "type": "object"
                },
                "description": "react 触发器的内嵌 op 列表（kind=react 时存在；params.trigger 编码触发点）"
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
};

export type NumericValue =
  | number
  | {
      stat: "hp" | "atk" | "def" | "spa" | "sdf" | "spd";
      of?: "self" | "foe" | "target";
    }
  | {
      count: "ailments";
      of?: "self" | "foe" | "target";
    }
  | {
      /**
       * @minItems 1
       * @maxItems 32
       */
      sum: NumericValue[];
    }
  | {
      /**
       * @minItems 1
       * @maxItems 32
       */
      product: NumericValue[];
    }
  | {
      /**
       * @minItems 2
       * @maxItems 2
       */
      difference: NumericValue[];
    }
  | {
      divide: {
        value: NumericValue;
        by: number;
      };
    }
  | {
      /**
       * @minItems 1
       * @maxItems 32
       */
      min: NumericValue[];
    }
  | {
      /**
       * @minItems 1
       * @maxItems 32
       */
      max: NumericValue[];
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
  /**
   * v2 mid-turn KO suspend: KO 方有待替补且未终局。含未执行完的另一方 actionId（阵亡者原行动作废）。
   */
  suspension?: null | {
    /**
     * true = 挂起由 TURN_END 钩子产出（回合末固伤 KO）→ applyReplacement 不得再跑 runTurnEnd（防二次衰减/钩子双触发）
     */
    teDone?: boolean;
    /**
     * TURN_END 挂起恢复游标：win=该侧已挂起的窗口序号，item=窗口内已结算条目序数（该条目伤害已落账，续跑从 item+1 起）。unitId 校验：替补换入后剩余窗口归属旧单位，整体跳过
     */
    teCursor?: {
      side: "p1" | "p2";
      unitId: string;
      win: number;
      item: number;
    };
    /**
     * 本回合先行动方——续跑行动评估 order 条件（先出手威力加倍等）用
     */
    firstSide?: "p1" | "p2";
    koSide: "p1" | "p2";
    remaining: {
      p1: string | null;
      p2: string | null;
    };
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
  /**
   * v2 bench：后备单位数组；v1 包不写该字段（hash 不变靠不写）。
   */
  bench?: InternalUnit[];
  unit: InternalUnit;
  /**
   * 机制消耗品剩余次数（itemId → 剩余）。无机制不写。只投影给己方。
   */
  stocks?: {
    [k: string]: number;
  };
  /**
   * 场地印记（五行印记/圣剑等挂在侧而非单位的计数印记）：kind=mark:*，count=层数，remainingTurns 随回合末递减。
   */
  fieldMarks?: {
    kind: string;
    count: number;
    remainingTurns?: number;
    appliedTurn?: number;
  }[];
  /**
   * 下只出场精灵效果队列（'对手下只出场精灵X'）：登场时逐条以 target:self 结算；moveId 供 payload ctx 还原。
   */
  nextInFx?: {
    moveId: string;
    fx: {
      [k: string]: unknown;
    };
  }[];
}
export interface InternalUnit {
  unitId: string;
  speciesId: string;
  level?: number;
  /**
   * @maxItems 6
   */
  seals?: string[];
  /**
   * soulmark 机制：魂印运行时状态（prev=回合末快照，供 endure 回卷）。
   */
  soul?: {
    id: string;
    endured?: boolean;
    endurePending?: boolean;
    revived?: boolean;
    shield?: boolean;
    shieldUsed?: boolean;
    /**
     * limitBattle 条目已触发的 effects 下标（内部状态，不经 projections 公开）
     */
    firedOnce?: {
      [k: string]: boolean;
    };
    /**
     * chanceGrow 累积值（内部状态，不经 projections 公开）
     */
    chanceAcc?: {
      [k: string]: number;
    };
    /**
     * growStep 幅度累积值（内部状态，不经 projections 公开）
     */
    magAcc?: {
      [k: string]: number;
    };
    /**
     * 登场生命周期已初始化：首发/换入的 onEntry 只应结算一次
     */
    entryInit?: boolean;
    /**
     * onBattleStart 已结算：每场战斗至多一次
     */
    battleStartDone?: boolean;
    /**
     * hook/flag 条目内挂起的续跑游标：同回合同 hook 重派时从断点续跑。phase=flags 表示 flag 段挂起（item=下一待结算 effects 下标）；缺省=hooks 段（item=挂起条目下标，opItem=条目内已结算 op 数，branch=已选定 else 分支）
     */
    teResume?: {
      hook: string;
      item: number;
      opItem: number;
      turn: number;
      phase?: "flags";
      branch?: "else";
    };
    prev?: {
      hp: number;
      pp: {
        [k: string]: number;
      };
      stages: {
        [k: string]: unknown;
      };
    };
  };
  base: {
    hp: number;
    atk: number;
    def: number;
    spa?: number;
    sdf?: number;
    spd: number;
  };
  currentHp: number;
  stages: {
    atk: number;
    def: number;
    spa?: number;
    sdf?: number;
    spd: number;
    acc?: number;
    crt?: number;
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
  mode?: string;
  revives?: number;
  /**
   * 连续使用计数：moveId → 已连用次数（叠用机制 powerPerUse/flatPerUse/prioPerUse）
   */
  moveStacks?: {
    [k: string]: number;
  };
  /**
   * 招式槽印记（致命印记等挂在招式上的计数印记）：moveId → 印记名 → 层数。随单位迁移（换下保留），死亡清空。
   */
  moveMarks?: {
    [k: string]: {
      [k: string]: number;
    };
  };
  /**
   * 本回合前最近一次成功声明的招式（叠用连续性判定）
   */
  lastMoveId?: string;
  /**
   * 最近一次声明的招式类别（1属性 2物理 3特殊；与 lastMoveId 同点写入，含失败声明）。魂印类别连用读的是回合初快照 prevMoveCat，不读本字段。
   */
  lastMoveCat?: 1 | 2 | 3;
  /**
   * 本回合开始时从 lastMoveCat 拷下的上一动类别。回合中不刷新，保证排序与双方出招看到同一连用判定。
   */
  prevMoveCat?: 1 | 2 | 3;
  /**
   * 本回合开始时从 lastMoveId 拷下的上一动招式。同一技能连用读这个，不读声明后已覆写的 lastMoveId。回合中不刷新。
   */
  prevMoveId?: string;
  /**
   * 本回合的实际先制等级（engine 的 prio() 结果：基础 priority + prio_up 窗 + 条件先制 + 机制钩子 + 连用加成）。排序时写回，供 prioZero 等谓词读「本回合实际先制」而不是面板 priority。
   */
  turnPrio?: number;
  /**
   * 同类招式连续声明计数（'连续N次使用攻击技能时X' 的 N 判定）：与 lastMoveCat 同点写入——同类 +1，换类回 1。
   */
  catStreak?: number;
  /**
   * 回合开始体力快照（'若自身体力等于回合开始时'/'恢复至回合开始时体力'谓词）。applyTurnInner 首行写入，回合中不刷新。
   */
  turnStartHp?: number;
  /**
   * 回合开始能力等级快照（'回退到回合开始时强化'类谓词）。与 turnStartHp 同点写入。
   */
  turnStartStages?: {
    [k: string]: number;
  };
  /**
   * 这一击的克制倍率下限（×16 定点，1.0=16）。eff_max（'克制倍数取自身对对手、对手对自身克制倍数中的最大值'）写在行动方单位上，再被同一次命中的克制读法（formula.resist）用掉即清——不跨回合留存。
   */
  effFloor?: number;
  /**
   * 连续未命中计数（'前N个回合对手攻击均未命中'窗谓词）：对手命中清零，MISS +1。
   */
  missStreak?: number;
  /**
   * 攻击方连续命中计数（'对手连续命中则X'读 foe.hitStreak）：攻击招式命中 +1，MISS 清零。
   */
  hitStreak?: number;
  /**
   * 连续先/后出手计数（'连续N回合后出手则X'谓词）：同序 n+1，换序重置。
   */
  orderStreak?: {
    order: "first" | "last";
    n: number;
  };
  /**
   * 本次登场为主动切换（'若本次登场为主动切换登场则X'谓词）：doSwitch via=action 写入 true，战后补位/首发为 false。
   */
  entryWasSwitch?: boolean;
  /**
   * 本回合内被提升的能力键（'与上回合增加的属性不同'谓词——回合开始拷入 prevStageUpLog 后清空）
   */
  stageUpLog?: string[];
  /**
   * 上回合被提升的能力键（stageUpLog 的回合初快照）
   */
  prevStageUpLog?: string[];
  /**
   * 本回合成功免疫次数（'若成功触发免疫则'/'每次免疫成功后'谓词）：异常免疫/伤害免疫/致命免疫等闸门点递增，回合初清零。
   */
  immuneThisTurn?: number;
  /**
   * 本回合成功免疫的种类位掩码（bit1=攻击伤害 bit2=固定伤害 bit4=百分比伤害 bit8=异常/控制 bit16=能力下降）——'若当回合自身成功免疫X则'分类谓词
   */
  immunedMask?: number;
  /**
   * 本回合招式被无效化的类别位掩码（bit1=属性 bit2=物理 bit4=特殊——status-locked/move-nullified 路径写入；'若自身的属性技能失效则'谓词读位）
   */
  nullifiedMask?: number;
  /**
   * 本回合行动中已造成的累计伤害（'使自身下次受到的伤害减少n点，n等于本回合自身造成的伤害'/'附加对手上次造成伤害'）
   */
  lastDealt?: number;
  /**
   * 本回合已造成的累计伤害（dealt_tick'回合结束时附加N%伤害量的固定伤害'读取——回合开始时清零，回合末窗口结算后归零）
   */
  dealtThisTurn?: number;
  /**
   * 消逝标记（'令对方场下阵亡的首位精灵消逝'——场下阵亡单位不可被选中/复活，存活扫描一律排除）
   */
  banished?: boolean;
  /**
   * 本回合行动中已承受的累计伤害（'附加自身当回合所受技能伤害N%的百分比伤害'）
   */
  lastTaken?: number;
  /**
   * 本回合最近一次受击的伤害类型（'受到真实伤害后X'谓词）
   */
  lastTakenKind?: "standard" | "fixed" | "percent" | "true";
  /**
   * 当次行动最近一次实际回复量（'恢复的体力值低于N则X'谓词）
   */
  lastHeal?: number;
  /**
   * 当次行动最近一次回复溢出量（'获得等同于溢出量的护罩'——amount-healed 封顶外溢）
   */
  lastHealOverflow?: number;
  /**
   * 最近一次实际回复量持久快照（跨回合'下次…等同于恢复量的固定伤害'——不随回合清除，仅被新回复覆写）
   */
  prevHeal?: number;
  /**
   * 上次行动回合期间承受的累计伤害快照（'若上回合自身未受到攻击伤害则X'谓词）
   */
  prevTaken?: number;
  /**
   * 本回合护盾/护罩吸收量累计（'护盾所吸收的伤害值N%反弹'读取——回合开始清零）
   */
  shieldAbsorbed?: number;
  /**
   * 最近一次 consumeShield 消耗量快照（'若当前护罩值低于N'条件读——消耗语义下当前值=消耗值）
   */
  lastShieldConsumed?: number;
  effects: {
    amountExpr?: NumericValue;
    kind: string;
    effectInstanceId: string;
    remainingTurns?: number;
    appliedTurn?: number;
    /**
     * 效果幅值参数（timed 效果的 n/d/add 等）
     */
    params?: {
      [k: string]: number;
    };
    stack?: number;
    /**
     * 审计标签（periodic/immune/reflect/modifier 轴条目的原语义名——合并键与事件 cause）
     */
    label?: string;
    /**
     * modifier 轴管线槽位（kind=modifier 时存在；消费点 isMod(e,at) 匹配）
     */
    at?: string;
    /**
     * 定向域子类（immune{of:status}+ailment=仅挡该异常；对应原 name:ailment 复合 kind）
     */
    ailment?: string;
    /**
     * 系别门控（来招 type 与门控名不符则该条目窗口关闭——'受到的火系攻击伤害减半'/'电系技能威力翻倍'）
     */
    moveType?: string;
    /**
     * react 触发器的内嵌 op 列表（kind=react 时存在；params.trigger 编码触发点）
     */
    payload?: {
      [k: string]: unknown;
    }[];
    hidden?: boolean;
  }[];
}
export interface InboxSubmission {
  actionId: string;
  idempotencyKey: string;
  canonicalDigest: string;
  receiptId: string;
  receivedSeq: number;
}
