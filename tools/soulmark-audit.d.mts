/** Public types for the read-only soulmark audit API. */
export type SoulmarkAuditStatus =
  | "explicit-no-trait"
  | "no-entry-with-residual"
  | "no-entry-no-residual"
  | "partial"
  | "entry-no-residual"
  | "parser-error";

export type SoulmarkDirectoryStatus =
  | "ambiguous-source-id"
  | "ambiguous-pack-unit-id"
  | "outside-pack"
  | "missing"
  | "not-generated"
  | "unexpected-stored-entry"
  | "same-effects"
  | "different-effects";

export type SoulmarkMountStatus =
  | "ambiguous-source-id"
  | "ambiguous-pack-unit-id"
  | "outside-pack"
  | "no-current-entry"
  | "mounted"
  | "manual-peak-unmounted"
  | "unmounted"
  | "different-reference";

export interface SoulmarkAuditCreature {
  id?: string | null;
  petNo?: string | number | null;
  name?: string | null;
  soulMark?: { text?: string | null } | null;
}

export interface SoulmarkAuditCatalog {
  creatures: Record<string, SoulmarkAuditCreature>;
}

export interface SoulmarkAuditUnit {
  id?: string | null;
  name?: string | null;
  soulMark?: string | null;
}

export interface SoulmarkAuditPackUnits {
  units: readonly SoulmarkAuditUnit[];
}

export interface SoulmarkAuditDirectoryEntry {
  id?: string;
  effects?: readonly unknown[];
}

export interface SoulmarkAuditDirectory {
  soulmarks?: Record<string, SoulmarkAuditDirectoryEntry>;
  [id: string]: unknown;
}

export interface SoulmarkAuditResidual {
  clause?: string;
  reason?: string;
}

export interface SoulmarkAuditParseResult {
  entries: readonly unknown[];
  unparsed: readonly SoulmarkAuditResidual[];
  inPackScope?: boolean | null;
  directoryStatus?: SoulmarkDirectoryStatus;
  mountStatus?: SoulmarkMountStatus;
  expectedSoulmarkId?: string | null;
}

export interface SoulmarkAuditInput {
  catalog: SoulmarkAuditCatalog;
  units?: readonly SoulmarkAuditUnit[] | SoulmarkAuditPackUnits;
  soulmarks?: SoulmarkAuditDirectory | Record<string, SoulmarkAuditDirectoryEntry>;
  parse?: (text: string, petName?: string | null) => SoulmarkAuditParseResult;
  manualPeakIds?: readonly string[];
}

export interface SoulmarkAuditRecord {
  creatureId: string | null;
  catalogKey: string;
  associationId: string;
  idSource: "creature.id" | "catalog-key";
  petNo: string | null;
  name: string | null;
  status: SoulmarkAuditStatus;
  entries: number;
  residualFragments: number;
  residualReasons: string[];
  inPackScope: boolean | null;
  packDirectory: SoulmarkDirectoryStatus;
  defaultMount: SoulmarkMountStatus;
  expectedSoulmarkId: string | null;
  parseError?: string;
}

export interface SoulmarkAuditStatusCounts {
  explicitNoTrait: number;
  noEntryWithResidual: number;
  noEntryNoResidual: number;
  partial: number;
  entryNoResidual: number;
  parserError: number;
}

export interface SoulmarkAuditReason {
  reason: string;
  fragments: number;
  distinctRecords: number;
  examples: Array<{
    creatureId: string | null;
    catalogKey: string;
    petNo: string | null;
    clause: string | null;
  }>;
}

export interface SoulmarkAuditManualPeakRecord {
  creatureId: string | null;
  catalogKey: string | null;
  unitId: string;
  name: string | null;
  sourceHasSoulmarkText: boolean;
  parseStatus: SoulmarkAuditStatus | null;
  directoryEntryPresent: boolean;
  policy: "manual-peak-default-unmounted; do not auto-mount";
}

export interface SoulmarkAuditReport {
  schemaVersion: 1;
  phase: "after-named-parser-arguments";
  baselineArtifact: string;
  semantics: string;
  source: {
    catalogRecords: number;
    recordsWithSoulmarkText: number;
  };
  statusCounts: SoulmarkAuditStatusCounts;
  implementationCandidates: number;
  explicitNoTraitExcluded: number;
  emptyWithoutResidualAnomalies: SoulmarkAuditRecord[];
  parserErrors: Array<SoulmarkAuditRecord & { error: string }>;
  residualReasons: SoulmarkAuditReason[];
  identityIssues: {
    missingCreatureId: Array<{ catalogKey: string; fallbackAssociationId: string }>;
    duplicateCreatureIds: Array<{ creatureId: string; catalogKeys: string[] }>;
    duplicatePackUnitIds: Array<{ unitId: string; count: number }>;
    recordsWithAmbiguousCreatureId: Array<{ creatureId: string | null; catalogKey: string }>;
  };
  pack: {
    unitCount: number;
    soulmarkDirectoryCount: number;
    sourceRecordsOutsidePackWithEntries: number;
    directoryCounts: {
      missing: number;
      different: number;
      same: number;
      notGenerated: number;
      outsidePack: number;
      ambiguous: number;
    };
    directoryMissing: SoulmarkAuditRecord[];
    directoryDifferent: Array<SoulmarkAuditRecord & { storedEffects: number | null }>;
    directorySame: SoulmarkAuditRecord[];
    outsidePackEntries: SoulmarkAuditRecord[];
    defaultMount: {
      eligibleInPack: number;
      mounted: number;
      unmounted: number;
      eligibleManualPeakUnmounted: number;
      differentReference: number;
      ambiguous: number;
      manualPeakUnmountedCount: number;
      unmountedNonManual: SoulmarkAuditRecord[];
      manualPeakUnmounted: SoulmarkAuditManualPeakRecord[];
      manualPeakRosterIds: string[];
      manualPeakMountPolicy: string;
    };
  };
  records: SoulmarkAuditRecord[];
}

export declare const MANUAL_PEAK_IDS: readonly string[];
export declare function isExplicitNoTrait(text: unknown): boolean;
export declare function auditSoulmarkState(input: SoulmarkAuditInput): SoulmarkAuditReport;
export declare function loadPackSnapshot(packDir?: string): {
  descriptor: Record<string, unknown>;
  units: SoulmarkAuditUnit[];
  soulmarks: Record<string, SoulmarkAuditDirectoryEntry>;
  inputPaths: [string, string, string];
};
export declare function runSoulmarkAudit(argv?: readonly string[]): void;
