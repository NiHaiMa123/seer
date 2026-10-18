/** effects-parse.mjs 的类型声明（parser IR 形状由 moves.schema.json 契约保证，此处用结构化宽松类型）。 */
export interface ParsedEffect {
  op: string;
  [k: string]: unknown;
}
export interface ParseResult {
  flags: Record<string, unknown>;
  effects: ParsedEffect[];
  unparsed: { clause: string; reason: string }[];
  /** 条件本系加成等悬挂谓词（无宿主 op 时上交）。 */
  effDoubleFlag?: unknown;
  /** 零效果时无处可挂的谓词（"后出手时"独占一组）。 */
  orphanCond?: Record<string, unknown>;
  /** 尾部裸时长残段（"麻痹，2回合"）。 */
  turnsTail?: number;
}
export declare function parseEffectText(text: string | null | undefined, opts?: { hasDamage?: boolean }): ParseResult;
/** 命中 rider 的 op 名。分组前用来认出紧跟 damage 的那几条。 */
export declare function isHitRider(op: unknown): boolean;
/** 把 damage 和 attachDamage 上的家族键收成紧跟的 rider。keepDrainKeys 为真时袋子原样留下。 */
export declare function liftDrainRiders(effects: unknown, flags: object | undefined, opts?: { lone?: "all" | "drain" | "keep"; keepDrainKeys?: boolean }): void;
/** 守卫谓词抽取："若P则X" 的 P → Condition IR（未识别返回 undefined）。 */
export declare function condOf(s0: string): Record<string, unknown> | undefined;
