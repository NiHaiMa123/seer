import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "artifacts", "m2", "verify-m2.json");

interface GateResult {
  command: string;
  exitCode: number;
  durationMs: number;
  status: "PASS" | "FAIL";
}

const GATES = [
  "pnpm install --frozen-lockfile",
  "pnpm typecheck",
  "pnpm content:validate",
  "pnpm contracts:check",
  "pnpm check:boundaries",
  "pnpm test:contracts",
  "pnpm test:privacy",
  "pnpm test:core",
  "pnpm test:interactions",
  "pnpm test:protocol",
  "pnpm test:recovery",
  "pnpm test:plugin",
  "pnpm test:assembly",
  "pnpm test:generations",
  "pnpm test:artifacts",
  "pnpm test:executables",
  "pnpm test:determinism",
  "pnpm test:determinism:browser",
  "pnpm replay:verify",
  "pnpm demo:m1",
  "pnpm test:e2e",
  "worktree whitespace check",
];

const checkWorktreeWhitespace = (): number => {
  const tracked = spawnSync("git diff --check", { cwd: ROOT, shell: true, stdio: "inherit" });
  if ((tracked.status ?? 1) !== 0) return tracked.status ?? 1;
  const listed = execSync("git ls-files --others --exclude-standard -z", { cwd: ROOT, encoding: "buffer" });
  const files = listed.toString("utf8").split("\0").filter(Boolean);
  let failed = false;
  for (const file of files) {
    const content = readFileSync(join(ROOT, file));
    if (content.includes(0)) continue;
    const lines = content.toString("utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        console.error(`${file}:${index + 1}: trailing whitespace`);
        failed = true;
      }
    });
  }
  return failed ? 1 : 0;
};

const results: GateResult[] = [];
for (const command of GATES) {
  const started = performance.now();
  const exitCode = command === "worktree whitespace check"
    ? checkWorktreeWhitespace()
    : (spawnSync(command, {
        cwd: ROOT,
        shell: true,
        stdio: "inherit",
      }).status ?? 1);
  const gate: GateResult = {
    command,
    exitCode,
    durationMs: Math.round(performance.now() - started),
    status: exitCode === 0 ? "PASS" : "FAIL",
  };
  results.push(gate);
  console.log(`${gate.status} ${command} (${gate.durationMs}ms)`);
}

const failed = results.filter((result) => result.status === "FAIL");
const report = {
  gate: "verify:m2",
  executedAt: new Date().toISOString(),
  gitSha: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
  node: process.version,
  pnpm: execSync("pnpm --version", { cwd: ROOT, encoding: "utf8" }).trim(),
  workingTree: execSync("git status --short", { cwd: ROOT, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean),
  results,
  summary: { total: results.length, pass: results.length - failed.length, fail: failed.length },
  status: failed.length === 0 ? "PASS" : "FAIL",
};
mkdirSync(join(ROOT, "artifacts", "m2"), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(`verify:m2 ${report.status} — ${report.summary.pass}/${report.summary.total} gates passed`);
process.exit(failed.length === 0 ? 0 : 1);
