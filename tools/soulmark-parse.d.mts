/** soulmark-parse.mjs 的类型声明。条目形状由 soulmarks.schema.json 的 soulHook 定义保证。 */
export interface SoulHookEntry {
  hook: string;
  /** 主语谓词，或世界 Condition；两者都有时世界谓词在 guard.if。 */
  guard?: Record<string, unknown>;
  /** 概率闭类型。flag op 的数字 chance 不在这条上。 */
  chance?: {
    base?: number;
    dyn?: "selfHpPct" | "selfMissingHpPct" | "foeHpPct" | "foeMissingHpPct";
    grow?: { add: number; cap?: number; on?: "fail" | "always" };
    resetOnFire?: true;
    once?: true;
  };
  bossGate?: boolean;
  prio?: { min: number; max: number };
  ops?: Record<string, unknown>[];
}
export interface SoulUnparsed { clause: string; reason?: string }
export interface SoulParseResult {
  entries: SoulHookEntry[];
  unparsed: SoulUnparsed[];
  bossGate: boolean;
  clauseTotal: number;
  clausesParsed: number;
  /** 已产出 entry 的子句内部残留。不参与 clauseCoverage。 */
  fragmentsOnParsed: number;
  /** 未产出 entry 的子句上的 unparsed 条数。 */
  fragmentsOnResidual: number;
  /** 没进入子句分母的 unparsed（伴生整段、循环后的空体）。 */
  fragmentsOutside: number;
}
export declare function parseSoulmarkText(text: string | null | undefined): SoulParseResult;
export declare function run(catalogPath?: string, outDir?: string): unknown;
