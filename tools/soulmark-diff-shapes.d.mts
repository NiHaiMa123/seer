export type DiffShape = "条目顺序改写" | "条件/概率/门控改写" | "同事件负载改写" | "事件窗口/条目结构改写";
export interface ConditionLoss {
  /** 条目数是否相同（相同＝只是条件被扔；不同＝整条读法改写，另判） */
  sameCount: boolean;
  /** 包里有、当前解析没有的条件 */
  lost: string[];
  /** 当前解析有、包里没有的条件 */
  gained: string[];
}
export interface DiffReport {
  scanned: number;
  buckets: Record<"same" | "equiv" | "more" | "fewer" | "differ" | "missing" | "stale", number>;
  byShape: Partial<Record<DiffShape, number>>;
  records: { id: string; name?: string; shape: DiffShape; source: string; before: unknown[]; after: unknown[] }[];
  /** 同条目数下「解析丢条件」的记录——回填等于把有条件的现网效果改成无条件执行，禁止回填 */
  condLost: { id: string; name?: string; shape: DiffShape; lost: string[]; gained: string[] }[];
}
export function classifyShape(oldEntries: readonly unknown[], newEntries: readonly unknown[]): DiffShape | null;
export function analyzeConditionLoss(oldEntries: readonly unknown[], newEntries: readonly unknown[]): ConditionLoss;
export function analyzeSoulmarkDiffs(
  catalog: { creatures: Record<string, { id?: string; name?: string; soulMark?: { text?: string | null } }> },
  marks: Record<string, { effects: unknown[] }>,
  unitIds: ReadonlySet<string>,
): DiffReport;
export function run(args?: string[]): DiffReport;
