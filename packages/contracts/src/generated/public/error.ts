// Generated from schemas/public/error.schema.json — do not edit; run pnpm contracts:gen.
export const errorSchema: Record<string, unknown> = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seer/public/error.schema.json",
  "title": "ApiError",
  "description": "Wire-facing error: safe code, retryable flag, request id. No internal detail or stack (contracts.md §5).",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "code",
    "retryable",
    "requestId"
  ],
  "properties": {
    "code": {
      "enum": [
        "INVALID_SCHEMA",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "STALE_DECISION",
        "ILLEGAL_ACTION",
        "ALREADY_SUBMITTED",
        "IDEMPOTENCY_CONFLICT",
        "DEADLINE_EXCEEDED",
        "BUDGET_EXCEEDED",
        "RULESET_MISMATCH",
        "UNSUPPORTED_OPERATOR",
        "ARTIFACT_UNAVAILABLE",
        "PLUGIN_IN_USE",
        "ENGINE_FAULT",
        "PROVIDER_UNAVAILABLE"
      ]
    },
    "retryable": {
      "type": "boolean"
    },
    "requestId": {
      "type": "string",
      "pattern": "^req_[a-z0-9-]{1,60}$"
    }
  }
};

/**
 * Wire-facing error: safe code, retryable flag, request id. No internal detail or stack (contracts.md §5).
 */
export interface ApiError {
  code:
    | "INVALID_SCHEMA"
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "STALE_DECISION"
    | "ILLEGAL_ACTION"
    | "ALREADY_SUBMITTED"
    | "IDEMPOTENCY_CONFLICT"
    | "DEADLINE_EXCEEDED"
    | "BUDGET_EXCEEDED"
    | "RULESET_MISMATCH"
    | "UNSUPPORTED_OPERATOR"
    | "ARTIFACT_UNAVAILABLE"
    | "PLUGIN_IN_USE"
    | "ENGINE_FAULT"
    | "PROVIDER_UNAVAILABLE";
  retryable: boolean;
  requestId: string;
}
