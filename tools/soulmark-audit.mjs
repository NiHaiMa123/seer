/**
 * Read-only, live soulmark status and pack-directory audit.
 *
 * Default: read creatures.json and the current peak pack, then write JSON to stdout.
 * Use --report PATH to save a report explicitly. Reports are never written under content/.
 * This audits parser output and pack synchronization; neither a clean parse nor a successful
 * compile check establishes behavioral completeness.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSoulmarkText } from "./soulmark-parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CATALOG = join(ROOT, "content/creatures/creatures.json");
const DEFAULT_PACK_DIR = join(ROOT, "content/peak");

// These are hand-authored roster units. build-pet-roster intentionally keeps their default
// unit records without a soulMark reference; their directory entries must not be auto-mounted.
export const MANUAL_PEAK_IDS = Object.freeze([
  "pet-5000", "pet-3550", "pet-3577", "pet-3291", "pet-3673", "pet-4169",
  "pet-2987", "pet-3986", "pet-4275", "pet-3033", "pet-3788", "pet-4321",
]);

const NO_TRAIT_RE = /^(?:该精灵)?(?:没有专属特性|暂无特性|没有特性|无专属特性|无特性|特性暂未开放)(?:[。！!，,\s]|$)/;

export function isExplicitNoTrait(text) {
  return NO_TRAIT_RE.test(String(text ?? "").trim());
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
  }
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(sortedJson(a)) === JSON.stringify(sortedJson(b));
}

function identityFor(catalogKey, creature) {
  const rawId = creature?.id;
  const hasId = typeof rawId === "string" && rawId.trim() !== "";
  return {
    associationId: hasId ? rawId.trim() : String(catalogKey),
    declaredId: hasId ? rawId.trim() : null,
    idSource: hasId ? "creature.id" : "catalog-key",
  };
}

function rowsForCatalog(catalog) {
  const source = catalog?.creatures;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("catalog.creatures must be an object keyed by encyclopedia record");
  }
  return Object.entries(source).map(([catalogKey, creature], index) => ({
    catalogKey,
    creature,
    index,
    ...identityFor(catalogKey, creature),
  }));
}

function grouped(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || key === undefined || key === "") continue;
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }
  return map;
}

function reasonText(residual) {
  return typeof residual?.reason === "string" && residual.reason.trim() !== ""
    ? residual.reason
    : "unspecified";
}

function detailFor(row, parsedRecord) {
  return {
    creatureId: row.declaredId,
    catalogKey: row.catalogKey,
    associationId: row.associationId,
    idSource: row.idSource,
    petNo: row.creature?.petNo == null ? null : String(row.creature.petNo),
    name: row.creature?.name == null ? null : String(row.creature.name),
    status: parsedRecord.status,
    entries: parsedRecord.entries.length,
    residualFragments: parsedRecord.unparsed.length,
    residualReasons: [...new Set(parsedRecord.unparsed.map(reasonText))],
    inPackScope: parsedRecord.inPackScope,
    packDirectory: parsedRecord.directoryStatus,
    defaultMount: parsedRecord.mountStatus,
    expectedSoulmarkId: parsedRecord.expectedSoulmarkId,
  };
}

function countStatuses(records) {
  const counts = {
    explicitNoTrait: 0,
    noEntryWithResidual: 0,
    noEntryNoResidual: 0,
    partial: 0,
    entryNoResidual: 0,
    parserError: 0,
  };
  for (const record of records) {
    switch (record.status) {
      case "explicit-no-trait": counts.explicitNoTrait++; break;
      case "no-entry-with-residual": counts.noEntryWithResidual++; break;
      case "no-entry-no-residual": counts.noEntryNoResidual++; break;
      case "partial": counts.partial++; break;
      case "entry-no-residual": counts.entryNoResidual++; break;
      case "parser-error": counts.parserError++; break;
    }
  }
  return counts;
}

function aggregateReasons(records) {
  const rows = new Map();
  for (const record of records) {
    if (record.status === "explicit-no-trait" || record.status === "parser-error") continue;
    for (const residual of record.unparsed) {
      const reason = reasonText(residual);
      let row = rows.get(reason);
      if (row === undefined) {
        row = { reason, fragments: 0, distinctRecords: new Set(), examples: [] };
        rows.set(reason, row);
      }
      row.fragments++;
      row.distinctRecords.add(record.row.catalogKey);
      if (row.examples.length < 3) {
        row.examples.push({
          creatureId: record.row.declaredId,
          catalogKey: record.row.catalogKey,
          petNo: record.row.creature?.petNo == null ? null : String(record.row.creature.petNo),
          clause: typeof residual?.clause === "string" ? residual.clause : null,
        });
      }
    }
  }
  return [...rows.values()]
    .map(({ distinctRecords, ...row }) => ({ ...row, distinctRecords: distinctRecords.size }))
    .sort((a, b) => b.fragments - a.fragments || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

function unitsById(units) {
  const rows = Array.isArray(units) ? units : units?.units;
  if (!Array.isArray(rows)) throw new Error("pack units must be an array or a { units: [] } document");
  return grouped(rows, (unit) => typeof unit?.id === "string" ? unit.id : null);
}

function markIdFor(associationId) {
  return `sm-${String(associationId).replace(/^pet-/, "")}`;
}

function classifyResult(parsed, explicitNoTrait) {
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const unparsed = Array.isArray(parsed?.unparsed) ? parsed.unparsed : [];
  if (explicitNoTrait) return "explicit-no-trait";
  if (entries.length > 0 && unparsed.length > 0) return "partial";
  if (entries.length > 0) return "entry-no-residual";
  if (unparsed.length > 0) return "no-entry-with-residual";
  return "no-entry-no-residual";
}

/**
 * Build a deterministic audit object from in-memory source and pack data.
 * The function only reads the supplied values and never changes either document.
 */
export function auditSoulmarkState({
  catalog,
  units = [],
  soulmarks = {},
  parse = parseSoulmarkText,
  manualPeakIds = MANUAL_PEAK_IDS,
} = {}) {
  const allRows = rowsForCatalog(catalog);
  const markedRows = allRows.filter((row) => String(row.creature?.soulMark?.text ?? "").trim() !== "");
  const rowsById = grouped(allRows, (row) => row.declaredId);
  const duplicateCreatureIds = [...rowsById.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([creatureId, rows]) => ({ creatureId, catalogKeys: rows.map((row) => row.catalogKey) }));
  const missingIdRecords = allRows
    .filter((row) => row.declaredId === null)
    .map((row) => ({ catalogKey: row.catalogKey, fallbackAssociationId: row.associationId }));
  const duplicatePackUnitIds = [...unitsById(units).entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([unitId, rows]) => ({ unitId, count: rows.length }));
  const unitGroups = unitsById(units);
  const manualIds = [...new Set(manualPeakIds.map(String))];
  const manualSet = new Set(manualIds);
  const markDirectory = soulmarks?.soulmarks && typeof soulmarks.soulmarks === "object" ? soulmarks.soulmarks : soulmarks;
  if (markDirectory === null || typeof markDirectory !== "object" || Array.isArray(markDirectory)) {
    throw new Error("pack soulmarks must be keyed by soulmark id");
  }

  const records = [];
  for (const row of markedRows) {
    const text = String(row.creature.soulMark.text).trim();
    const explicitNoTrait = isExplicitNoTrait(text);
    let parsed;
    let parseError;
    try {
      parsed = parse(text, row.creature?.name);
    } catch (error) {
      parseError = String(error?.message ?? error);
      parsed = { entries: [], unparsed: [] };
    }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const unparsed = Array.isArray(parsed?.unparsed) ? parsed.unparsed : [];
    const status = parseError === undefined ? classifyResult(parsed, explicitNoTrait) : "parser-error";
    const idAmbiguous = row.declaredId !== null && (rowsById.get(row.declaredId)?.length ?? 0) > 1;
    const unitMatches = unitGroups.get(row.associationId) ?? [];
    let inPackScope;
    if (idAmbiguous || unitMatches.length > 1) inPackScope = null;
    else inPackScope = unitMatches.length === 1;

    const expectedSoulmarkId = row.associationId === "" ? null : markIdFor(row.associationId);
    const stored = expectedSoulmarkId === null ? undefined : markDirectory[expectedSoulmarkId];
    let directoryStatus;
    if (idAmbiguous) directoryStatus = "ambiguous-source-id";
    else if (unitMatches.length > 1) directoryStatus = "ambiguous-pack-unit-id";
    else if (unitMatches.length === 0) directoryStatus = "outside-pack";
    else if (entries.length > 0 && stored === undefined) directoryStatus = "missing";
    else if (stored === undefined) directoryStatus = "not-generated";
    else if (entries.length === 0) directoryStatus = "unexpected-stored-entry";
    else if (sameJson(stored.effects, entries)) directoryStatus = "same-effects";
    else directoryStatus = "different-effects";

    let mountStatus;
    const unit = unitMatches.length === 1 ? unitMatches[0] : undefined;
    if (idAmbiguous) mountStatus = "ambiguous-source-id";
    else if (unitMatches.length > 1) mountStatus = "ambiguous-pack-unit-id";
    else if (unit === undefined) mountStatus = "outside-pack";
    else if (entries.length === 0) mountStatus = "no-current-entry";
    else if (unit.soulMark === expectedSoulmarkId) mountStatus = "mounted";
    else if (manualSet.has(row.associationId) && unit.soulMark == null) mountStatus = "manual-peak-unmounted";
    else if (unit.soulMark == null) mountStatus = "unmounted";
    else mountStatus = "different-reference";

    records.push({
      row,
      status,
      entries,
      unparsed,
      parseError,
      explicitNoTrait,
      inPackScope,
      expectedSoulmarkId,
      directoryStatus,
      mountStatus,
      storedEffectCount: Array.isArray(stored?.effects) ? stored.effects.length : null,
    });
  }

  const statusCounts = countStatuses(records);
  const directoryCounts = {
    missing: 0,
    different: 0,
    same: 0,
    notGenerated: 0,
    outsidePack: 0,
    ambiguous: 0,
  };
  const mountCounts = {
    eligibleInPack: 0,
    mounted: 0,
    unmounted: 0,
    eligibleManualPeakUnmounted: 0,
    differentReference: 0,
    ambiguous: 0,
  };
  const directoryMissing = [];
  const directoryDifferent = [];
  const directorySame = [];
  const outsidePackEntries = [];
  const unmountedNonManual = [];
  const manualPeakUnmounted = [];
  for (const record of records) {
    const detail = detailFor(record.row, record);
    if (record.directoryStatus === "missing") {
      directoryCounts.missing++;
      directoryMissing.push(detail);
    } else if (record.directoryStatus === "different-effects" || record.directoryStatus === "unexpected-stored-entry") {
      directoryCounts.different++;
      directoryDifferent.push({ ...detail, storedEffects: record.storedEffectCount });
    } else if (record.directoryStatus === "same-effects") {
      directoryCounts.same++;
      directorySame.push(detail);
    } else if (record.directoryStatus === "not-generated") directoryCounts.notGenerated++;
    else if (record.directoryStatus === "outside-pack") {
      directoryCounts.outsidePack++;
      if (record.entries.length > 0) outsidePackEntries.push(detail);
    } else directoryCounts.ambiguous++;

    if (record.entries.length === 0 || record.inPackScope !== true) continue;
    mountCounts.eligibleInPack++;
    if (record.mountStatus === "mounted") mountCounts.mounted++;
    else if (record.mountStatus === "unmounted") {
      mountCounts.unmounted++;
      unmountedNonManual.push(detail);
    } else if (record.mountStatus === "manual-peak-unmounted") mountCounts.eligibleManualPeakUnmounted++;
    else if (record.mountStatus === "different-reference") mountCounts.differentReference++;
    else mountCounts.ambiguous++;
  }

  const sourceById = grouped(markedRows, (row) => row.associationId);
  for (const id of manualIds) {
    const unitMatches = unitGroups.get(id) ?? [];
    if (unitMatches.length !== 1 || unitMatches[0].soulMark != null) continue;
    const source = sourceById.get(id)?.length === 1 ? sourceById.get(id)[0] : undefined;
    const record = source === undefined ? undefined : records.find((candidate) => candidate.row === source);
    manualPeakUnmounted.push({
      creatureId: source?.declaredId ?? null,
      catalogKey: source?.catalogKey ?? null,
      unitId: id,
      name: unitMatches[0].name ?? source?.creature?.name ?? null,
      sourceHasSoulmarkText: source !== undefined,
      parseStatus: record?.status ?? null,
      directoryEntryPresent: record?.storedEffectCount !== null && record?.storedEffectCount !== undefined,
      policy: "manual-peak-default-unmounted; do not auto-mount",
    });
  }

  const duplicateSourceIdByKey = new Map(duplicateCreatureIds.flatMap((group) => group.catalogKeys.map((key) => [key, group.creatureId])));
  return {
    schemaVersion: 1,
    phase: "after-named-parser-arguments",
    baselineArtifact: "artifacts/soulmark-audit-2026-10-20.md",
    semantics: "Parser and compile status measure generated IR and residuals; they do not establish behavioral completeness.",
    source: {
      catalogRecords: allRows.length,
      recordsWithSoulmarkText: markedRows.length,
    },
    statusCounts,
    implementationCandidates: markedRows.length - statusCounts.explicitNoTrait,
    explicitNoTraitExcluded: statusCounts.explicitNoTrait,
    emptyWithoutResidualAnomalies: records
      .filter((record) => record.status === "no-entry-no-residual")
      .map((record) => detailFor(record.row, record)),
    parserErrors: records
      .filter((record) => record.status === "parser-error")
      .map((record) => ({ ...detailFor(record.row, record), error: record.parseError })),
    residualReasons: aggregateReasons(records),
    identityIssues: {
      missingCreatureId: missingIdRecords,
      duplicateCreatureIds,
      duplicatePackUnitIds,
      recordsWithAmbiguousCreatureId: markedRows.filter((row) => duplicateSourceIdByKey.has(row.catalogKey)).map((row) => ({
        creatureId: row.declaredId,
        catalogKey: row.catalogKey,
      })),
    },
    pack: {
      unitCount: unitGroups.size,
      soulmarkDirectoryCount: Object.keys(markDirectory).length,
      sourceRecordsOutsidePackWithEntries: outsidePackEntries.length,
      directoryCounts,
      directoryMissing,
      directoryDifferent,
      directorySame,
      outsidePackEntries,
      defaultMount: {
        ...mountCounts,
        manualPeakUnmountedCount: manualPeakUnmounted.length,
        unmountedNonManual,
        manualPeakUnmounted,
        manualPeakRosterIds: manualIds,
        manualPeakMountPolicy: "Report these hand-authored units separately; never count them as automatic mount repairs.",
      },
    },
    records: records.map((record) => ({
      ...detailFor(record.row, record),
      ...(record.parseError === undefined ? {} : { parseError: record.parseError }),
    })),
  };
}

export function loadPackSnapshot(packDir = DEFAULT_PACK_DIR) {
  const packPath = join(packDir, "pack.json");
  const descriptor = JSON.parse(readFileSync(packPath, "utf8"));
  const unitsPath = resolve(packDir, descriptor.files?.units ?? "units.json");
  const soulmarksPath = resolve(packDir, descriptor.files?.soulmarks ?? "soulmarks.json");
  const unitsDoc = JSON.parse(readFileSync(unitsPath, "utf8"));
  const soulmarksDoc = JSON.parse(readFileSync(soulmarksPath, "utf8"));
  return {
    descriptor,
    units: Array.isArray(unitsDoc) ? unitsDoc : unitsDoc.units,
    soulmarks: soulmarksDoc.soulmarks ?? soulmarksDoc,
    inputPaths: [packPath, unitsPath, soulmarksPath],
  };
}

function isInside(parent, target) {
  const rel = relative(parent, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function parseCli(argv) {
  const options = { source: DEFAULT_CATALOG, packDir: DEFAULT_PACK_DIR, report: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--source" || arg === "--pack-dir" || arg === "--report") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      if (arg === "--source") options.source = resolve(value);
      else if (arg === "--pack-dir") options.packDir = resolve(value);
      else options.report = resolve(value);
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export function runSoulmarkAudit(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) {
    process.stdout.write("Usage: node tools/soulmark-audit.mjs [--source creatures.json] [--pack-dir content/peak] [--report PATH]\nDefault output is stdout. --report cannot target content/.\n");
    return;
  }
  const catalog = JSON.parse(readFileSync(options.source, "utf8"));
  const pack = loadPackSnapshot(options.packDir);
  const report = auditSoulmarkState({ catalog, units: pack.units, soulmarks: pack.soulmarks });
  const output = `${JSON.stringify({
    ...report,
    packInfo: { packId: pack.descriptor.packId, packDirectory: relative(ROOT, options.packDir).replaceAll("\\", "/") },
  }, null, 2)}\n`;
  if (options.report === null) process.stdout.write(output);
  else {
    const contentRoot = join(ROOT, "content");
    if (isInside(contentRoot, options.report)) throw new Error("report path cannot be inside content/; choose an explicit artifacts/ or scratch/ path");
    if ([options.source, ...pack.inputPaths].some((inputPath) => samePath(options.report, inputPath))) {
      throw new Error("report path cannot overwrite an audit input");
    }
    mkdirSync(dirname(options.report), { recursive: true });
    writeFileSync(options.report, output, "utf8");
    process.stdout.write(`Soulmark audit report written to ${options.report}\n`);
  }
}

function samePath(a, b) {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32" ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US") : left === right;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && samePath(invokedPath, fileURLToPath(import.meta.url))) {
  try {
    runSoulmarkAudit();
  } catch (error) {
    process.stderr.write(`soulmark-audit: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
