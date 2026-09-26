/**
 * check:boundaries — 强制 contracts 的 public/internal 分入口。
 *
 * 规则：
 * 1. 公开入口 packages/contracts/src/index.ts 的传递 import 图不得抵达
 *    internal 模块（src/internal.ts、src/internal/**、src/generated/internal/**）。
 * 2. internal 契约只允许被登记的 host 侧消费者导入（见 ALLOWED_INTERNAL_IMPORTERS）；
 *    新增合法消费者（如未来 apps/host）须显式登记，而不是放宽规则。
 *
 * 用法：node tools/check-boundaries.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = join(REPO_ROOT, "packages", "contracts");
const PUBLIC_ENTRY = join(CONTRACTS, "src", "index.ts");
const CONTRACTS_PKG = "@seer/contracts";

// Importer path prefixes (relative to repo root) allowed to reference internal contracts.
const ALLOWED_INTERNAL_IMPORTERS = [
  "packages/contracts",
  "packages/battle-core",
  "apps/host",
  "apps/headless",
  "tests",
  "tools",
  "experiments",
];

const SCAN_DIRS = ["packages", "apps", "tests", "tools", "experiments", "docs/examples"];

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["']([^"'\n]+)["']|import\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?[tj]s)$/.test(e) && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const s = m[1] ?? m[2];
    if (s) specs.push(s);
  }
  return specs;
}

const isUnder = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** Specifier references internal contract surface? Returns resolved path or true for pkg specifier. */
function internalTarget(importer: string, spec: string): string | null {
  if (spec === `${CONTRACTS_PKG}/internal` || spec.startsWith(`${CONTRACTS_PKG}/internal/`)) {
    return spec;
  }
  if (spec.startsWith(".")) {
    const resolved = resolve(dirname(importer), spec);
    const internalFile = join(CONTRACTS, "src", "internal.ts");
    const internalDirs = [join(CONTRACTS, "src", "internal"), join(CONTRACTS, "src", "generated", "internal")];
    if (resolved === internalFile || internalDirs.some((d) => isUnder(resolved, d))) return resolved;
    // ../internal.ts style without extension
    for (const ext of [".ts", ".mts", ".js"]) {
      if (resolved + ext === internalFile) return resolved + ext;
    }
  }
  return null;
}

function resolveLocal(importer: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    if (spec === CONTRACTS_PKG) return PUBLIC_ENTRY;
    return null;
  }
  const base = resolve(dirname(importer), spec);
  for (const cand of [base, `${base}.ts`, `${base}.mts`, `${base}.js`, join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function main(): number {
  const findings: string[] = [];

  // --- check 1: public entry import graph must not reach internal ---
  const seen = new Set<string>();
  const stack: { file: string; via: string[] }[] = [{ file: PUBLIC_ENTRY, via: [PUBLIC_ENTRY] }];
  while (stack.length > 0) {
    const { file, via } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (internalTarget(via[via.length - 2] ?? file, "") !== null) continue;
    if (file !== PUBLIC_ENTRY && internalTarget(file, "__self__") !== null) continue;
    if (file !== PUBLIC_ENTRY && isUnder(file, join(CONTRACTS, "src", "generated", "internal"))) {
      findings.push(`public entry reaches internal file: ${via.map((v) => relative(REPO_ROOT, v)).join(" -> ")}`);
      continue;
    }
    if (file !== PUBLIC_ENTRY && file === join(CONTRACTS, "src", "internal.ts")) {
      findings.push(`public entry reaches internal entry: ${via.map((v) => relative(REPO_ROOT, v)).join(" -> ")}`);
      continue;
    }
    for (const spec of specifiersOf(file)) {
      const t = internalTarget(file, spec);
      if (t !== null) {
        findings.push(
          `${relative(REPO_ROOT, file)} imports internal contract "${spec}" (reachable from public entry)`,
        );
        continue;
      }
      const next = resolveLocal(file, spec);
      if (next) stack.push({ file: next, via: [...via, next] });
    }
  }

  // --- check 2: internal importers must be registered ---
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const internalImporters: string[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    for (const spec of specifiersOf(file)) {
      if (internalTarget(file, spec) === null) continue;
      internalImporters.push(`${rel} -> ${spec}`);
      const allowed = ALLOWED_INTERNAL_IMPORTERS.some(
        (p) => rel === p || rel.startsWith(p + "/"),
      );
      if (!allowed) {
        findings.push(
          `${rel} imports internal contract "${spec}" but is not a registered host-side consumer`,
        );
      }
    }
  }

  console.log(`scanned ${files.length} files; internal importers: ${internalImporters.length}`);
  for (const i of internalImporters) console.log(`  ${i}`);
  for (const f of findings) console.log(`VIOLATION ${f}`);
  console.log(findings.length === 0 ? "check:boundaries PASS" : `check:boundaries FAIL (${findings.length})`);
  return findings.length === 0 ? 0 : 1;
}

process.exit(main());
