/**
 * content:validate — M0-01 内容校验。
 *
 * 校验 content 根目录：
 *   <root>/schemas/*.schema.json   JSON Schema 真源（draft-07，Ajv 编译）
 *   <root>/rulesets/*.json         冻结规则工件（operatorAllowlist 等）
 *   <root>/claims/*.json           原作规则 claim（跳过 "_" 前缀文件）
 *   <root>/<pack>/pack.json        内容包清单 + files 引用的 units/moves 数据
 *
 * 拒绝类别：SCHEMA（缺字段/未知字段/类型）、UNKNOWN_OPERATOR、LICENSE
 * （public 但许可不明）、REF（悬空引用/未知 ruleset）、IO。
 *
 * 用法：
 *   node tools/content-validate.ts [contentRoot]   默认 "content"
 *   node tools/content-validate.ts --selftest      用临时 fixture 验证拒绝行为
 */
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = Record<string, Json>;
interface Finding { code: string; file: string; message: string }
interface PackSummary { packId: string; verification: string }
interface Result {
  findings: Finding[];
  filesChecked: string[];
  claimVerification: Record<string, number>;
  packs: PackSummary[];
}

const isObj = (v: Json | undefined): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isArr = (v: Json | undefined): v is Json[] => Array.isArray(v);
const isStr = (v: Json | undefined): v is string => typeof v === "string";

const RESERVED_DIRS = new Set(["schemas", "rulesets", "claims"]);
const UNCLEAR_LICENSE_IDS = new Set(["", "UNKNOWN", "UNLICENSED", "TBD", "NONE", "TODO"]);
const KNOWN_LICENSE_IDS = new Set([
  "CC0-1.0", "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
  "CC-BY-4.0", "CC-BY-SA-4.0", "OFL-1.1", "ISC",
]);

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f))
    .sort();
}

function loadJson(file: string, findings: Finding[]): Json | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  } catch (e) {
    findings.push({ code: "IO", file, message: `unreadable or invalid JSON: ${(e as Error).message}` });
    return undefined;
  }
}

function checkLicense(lic: Json | undefined, file: string, where: string, findings: Finding[]): void {
  if (!isObj(lic)) {
    findings.push({ code: "LICENSE", file, message: `${where}: missing license object` });
    return;
  }
  if (lic["public"] !== true) return;
  const id = lic["identifier"];
  if (!isStr(id) || UNCLEAR_LICENSE_IDS.has(id.trim().toUpperCase())) {
    findings.push({ code: "LICENSE", file, message: `${where}: public=true but license.identifier unclear` });
    return;
  }
  if (!KNOWN_LICENSE_IDS.has(id) && !isStr(lic["reference"])) {
    findings.push({
      code: "LICENSE",
      file,
      message: `${where}: license.identifier "${id}" not in known list and no written-grant reference`,
    });
  }
}

function validateRoot(root: string, schemasDir: string): Result {
  const findings: Finding[] = [];
  const filesChecked: string[] = [];
  const claimVerification: Record<string, number> = {};
  const packs: PackSummary[] = [];

  const ajv = new Ajv({ allErrors: true, strict: true });
  const validators = new Map<string, ValidateFunction>();
  for (const f of listJsonFiles(schemasDir)) {
    const schema = loadJson(f, findings);
    if (schema !== undefined) validators.set(basename(f, ".schema.json"), ajv.compile(schema as object));
  }

  const check = (schemaName: string, data: Json | undefined, file: string): boolean => {
    if (data === undefined) return false;
    const v = validators.get(schemaName);
    if (!v) {
      findings.push({ code: "SCHEMA", file, message: `validator missing for schema "${schemaName}"` });
      return false;
    }
    if (v(data)) return true;
    for (const e of v.errors ?? []) {
      findings.push({ code: "SCHEMA", file, message: `${e.instancePath || "/"} ${e.message ?? "schema violation"}` });
    }
    return false;
  };

  // --- rulesets ---
  const rulesets = new Map<string, Obj>();
  for (const f of listJsonFiles(join(root, "rulesets"))) {
    filesChecked.push(f);
    const data = loadJson(f, findings);
    if (data === undefined) continue;
    // 目录内除 ruleset 外还可能有引用型资源（typeChartFile → 克制表 / naturesFile → 性格表）
    if (!isStr((data as Obj)["rulesetId"])) {
      check((data as Obj)["natures"] !== undefined ? "natures" : "typechart", data, f);
      continue;
    }
    if (!check("ruleset", data, f)) continue;
    const rs = data as Obj;
    const id = rs["rulesetId"];
    if (isStr(id)) rulesets.set(id, rs);
  }

  // --- claims (skip "_" prefixed templates) ---
  for (const f of listJsonFiles(join(root, "claims"))) {
    if (basename(f).startsWith("_")) continue;
    filesChecked.push(f);
    const data = loadJson(f, findings);
    if (!check("claim", data, f)) continue;
    const ver = (data as Obj)["verification"];
    const key = isStr(ver) ? ver : "MISSING";
    claimVerification[key] = (claimVerification[key] ?? 0) + 1;
  }

  // --- packs: <root>/<dir>/pack.json ---
  const packDirs = existsSync(root)
    ? readdirSync(root)
        .filter((d) => !RESERVED_DIRS.has(d) && existsSync(join(root, d, "pack.json")))
        .sort()
    : [];
  for (const dir of packDirs) {
    const packFile = join(root, dir, "pack.json");
    filesChecked.push(packFile);
    const data = loadJson(packFile, findings);
    if (!check("pack", data, packFile)) continue;
    const pack = data as Obj;
    packs.push({ packId: String(pack["packId"]), verification: String(pack["verification"]) });

    checkLicense(pack["license"], packFile, "pack.license", findings);
    const assets = pack["assets"];
    if (isArr(assets)) {
      assets.forEach((a, i) => {
        if (isObj(a)) checkLicense(a["license"], packFile, `assets[${i}].license`, findings);
      });
    }

    const rulesetId = pack["rulesetId"];
    const ruleset = isStr(rulesetId) ? rulesets.get(rulesetId) : undefined;
    if (!ruleset) {
      findings.push({ code: "REF", file: packFile, message: `unknown rulesetId "${String(rulesetId)}"` });
      continue;
    }
    const allowlist = new Set(
      isArr(ruleset["operatorAllowlist"]) ? ruleset["operatorAllowlist"].filter(isStr) : [],
    );
    const stats = new Set(isArr(ruleset["stats"]) ? ruleset["stats"].filter(isStr) : []);

    const files = pack["files"];
    const unitFile = isObj(files) && isStr(files["units"]) ? join(root, dir, files["units"]) : undefined;
    const moveFile = isObj(files) && isStr(files["moves"]) ? join(root, dir, files["moves"]) : undefined;
    const sealFile = isObj(files) && isStr(files["seals"]) ? join(root, dir, files["seals"]) : undefined;

    // 刻印库：schema 校验 + 收集 id 供 unit.seals 引用检查（规则语义由 loader 把关）
    const sealIds = new Set<string>();
    if (sealFile !== undefined) {
      filesChecked.push(sealFile);
      const sdata = loadJson(sealFile, findings);
      if (check("seals", sdata, sealFile)) {
        for (const s of Object.values((sdata as Obj)["seals"] as Obj)) {
          if (isObj(s) && isStr(s["id"])) sealIds.add(s["id"]);
        }
      }
    }

    const moves = new Map<string, Obj>();
    if (moveFile) {
      filesChecked.push(moveFile);
      const mdata = loadJson(moveFile, findings);
      if (check("moves", mdata, moveFile)) {
        for (const m of (mdata as Obj)["moves"] as Json[]) {
          if (!isObj(m)) continue;
          const mid = m["id"];
          if (isStr(mid)) moves.set(mid, m);
          const effects = m["effects"];
          if (!isArr(effects)) continue;
          for (const eff of effects) {
            if (!isObj(eff)) continue;
            const op = eff["op"];
            if (isStr(op) && !allowlist.has(op)) {
              findings.push({
                code: "UNKNOWN_OPERATOR",
                file: moveFile,
                message: `move "${String(mid)}" uses op "${op}" not in ${String(rulesetId)} operatorAllowlist`,
              });
            }
            const stat = eff["stat"];
            if (stat !== undefined && (!isStr(stat) || !stats.has(stat))) {
              findings.push({
                code: "SCHEMA",
                file: moveFile,
                message: `move "${String(mid)}" references unknown stat "${String(stat)}"`,
              });
            }
          }
        }
      }
    }

    if (unitFile) {
      filesChecked.push(unitFile);
      const udata = loadJson(unitFile, findings);
      if (check("units", udata, unitFile)) {
        for (const u of (udata as Obj)["units"] as Json[]) {
          if (!isObj(u)) continue;
          const moveIds = u["moveIds"];
          if (!isArr(moveIds)) continue;
          for (const ref of moveIds) {
            if (isStr(ref) && !moves.has(ref)) {
              findings.push({
                code: "REF",
                file: unitFile,
                message: `unit "${String(u["id"])}" references missing move "${ref}"`,
              });
            }
          }
          const seals = u["seals"];
          if (isArr(seals)) {
            for (const ref of seals) {
              if (isStr(ref) && !sealIds.has(ref)) {
                findings.push({
                  code: "REF",
                  file: unitFile,
                  message: `unit "${String(u["id"])}" references missing seal "${ref}"`,
                });
              }
            }
          }
        }
      }
    }
  }

  return { findings, filesChecked, claimVerification, packs };
}

function printResult(root: string, r: Result): void {
  for (const f of r.findings) console.log(`${f.code} ${f.file}: ${f.message}`);
  const verified = r.claimVerification["VERIFIED"] ?? 0;
  console.log(
    JSON.stringify({
      status: r.findings.length === 0 ? "PASS" : "FAIL",
      root,
      filesChecked: r.filesChecked.length,
      findings: r.findings.length,
      packs: r.packs,
      claimVerification: r.claimVerification,
      originalClaimsVerified: verified,
    }),
  );
  console.log(`original-rule claims VERIFIED=${verified}`);
}

// --- selftest: build temp content roots, expect specific rejection codes ---

interface Case { name: string; files: Record<string, Json>; expect: string[] }

function selftest(): number {
  const schemasDir = join(REPO_ROOT, "content", "schemas");
  const ruleset = loadJson(join(REPO_ROOT, "content", "rulesets", "synthetic-v1.json"), []) as Obj;

  const validPack: Obj = {
    packId: "fx-pack", version: "1.0.0", schemaVersion: 1,
    rulesetId: "synthetic-v1", verification: "SYNTHETIC",
    license: { identifier: "CC0-1.0", public: true },
    files: { units: "units.json", moves: "moves.json" }, assets: [],
  };
  const validUnit: Obj = {
    units: [{ id: "u-1", name: "U1", base: { hp: 10, atk: 5, def: 5, spd: 5 }, moveIds: ["m-1"] }],
  };
  const validMove: Obj = {
    moves: [{ id: "m-1", name: "M1", pp: 5, priority: 0, effects: [{ op: "damage", power: 10 }] }],
  };

  const cases: Case[] = [
    {
      name: "valid-baseline",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": validPack,
        "pack/units.json": validUnit,
        "pack/moves.json": validMove,
      },
      expect: [],
    },
    {
      name: "missing-field",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": validPack,
        "pack/units.json": {
          units: [{ id: "u-1", name: "U1", base: { hp: 10, atk: 5, def: 5 }, moveIds: ["m-1"] }],
        },
        "pack/moves.json": validMove,
      },
      expect: ["SCHEMA"],
    },
    {
      name: "unknown-operator",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": validPack,
        "pack/units.json": validUnit,
        "pack/moves.json": {
          moves: [{ id: "m-1", name: "M1", pp: 5, priority: 0, effects: [{ op: "drain_soul", power: 10 }] }],
        },
      },
      expect: ["UNKNOWN_OPERATOR"],
    },
    {
      name: "public-license-unclear",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": { ...validPack, license: { identifier: "UNKNOWN", public: true } },
        "pack/units.json": validUnit,
        "pack/moves.json": validMove,
      },
      expect: ["LICENSE"],
    },
    {
      name: "dangling-move-ref",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": validPack,
        "pack/units.json": {
          units: [{ id: "u-1", name: "U1", base: { hp: 10, atk: 5, def: 5, spd: 5 }, moveIds: ["nope"] }],
        },
        "pack/moves.json": validMove,
      },
      expect: ["REF"],
    },
    {
      name: "bad-claim-verification",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "claims/c1.claim.json": {
          claimId: "CLAIM-X", targetSnapshot: "snap", mode: "m",
          statement: "s", boundaries: "b",
          source: { kind: "observation", uri: "u" },
          observedAt: "2026-01-01",
          evidenceDigest: `sha256:${"0".repeat(64)}`,
          reviewer: "r", verification: "PROBABLY", fixtureIds: [],
        },
      },
      expect: ["SCHEMA"],
    },
    {
      name: "unknown-ruleset-ref",
      files: {
        "rulesets/synthetic-v1.json": ruleset,
        "pack/pack.json": { ...validPack, rulesetId: "synthetic-v99" },
        "pack/units.json": validUnit,
        "pack/moves.json": validMove,
      },
      expect: ["REF"],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), `seer-cv-${c.name}-`));
    try {
      for (const [rel, data] of Object.entries(c.files)) {
        const p = join(dir, rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify(data, null, 2));
      }
      const r = validateRoot(dir, schemasDir);
      const found = new Set(r.findings.map((f) => f.code));
      const ok = c.expect.length === 0
        ? r.findings.length === 0
        : c.expect.every((code) => found.has(code)) && r.findings.length > 0;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.name}: expect=[${c.expect.join(",")}] found=[${[...found].join(",")}]`,
      );
      if (!ok) failed += 1;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`selftest ${failed === 0 ? "PASS" : "FAIL"} (${cases.length} cases, ${failed} failed)`);
  return failed === 0 ? 0 : 1;
}

// --- CLI ---

const arg = process.argv[2];
if (arg === "--selftest") {
  process.exit(selftest());
} else {
  const root = resolve(arg ?? "content");
  const r = validateRoot(root, join(root, "schemas"));
  printResult(root, r);
  process.exit(r.findings.length === 0 ? 0 : 1);
}
