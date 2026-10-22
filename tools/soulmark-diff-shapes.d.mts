export type DiffShape = "条目顺序改写" | "条件/概率/门控改写" | "同事件负载改写" | "事件窗口/条目结构改写";
export interface DiffReport {
  scanned: number;
  buckets: Record<"same" | "equiv" | "more" | "fewer" | "differ" | "missing" | "stale", number>;
  byShape: Partial<Record<DiffShape, number>>;
  records: { id: string; name?: string; shape: DiffShape; source: string; before: unknown[]; after: unknown[] }[];
}
export function classifyShape(oldEntries: readonly unknown[], newEntries: readonly unknown[]): DiffShape | null;
export function analyzeSoulmarkDiffs(
  catalog: { creatures: Record<string, { id?: string; name?: string; soulMark?: { text?: string | null } }> },
  marks: Record<string, { effects: unknown[] }>,
  unitIds: ReadonlySet<string>,
): DiffReport;
export function run(args?: string[]): DiffReport;
