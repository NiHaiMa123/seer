/**
 * verify:m0 —— M0 全部硬 gate 聚合（roadmap §2 出口）。
 * 顺序执行并记录每条命令的 exit code / 时长 / 环境 / git SHA，
 * 任一非 PASS 即整体非零退出。结果写 artifacts/m0/verify-m0.json。
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface GateResult {
  cmd: string;
  exitCode: number;
  durationMs: number;
  status: "PASS" | "FAIL";
}

const GATES = [
  "pnpm install --frozen-lockfile",
  "pnpm typecheck",
  "pnpm content:validate",
  "pnpm content:validate:selftest",
  "pnpm contracts:check",
  "pnpm check:boundaries",
  "pnpm test:contracts",
  "pnpm test:privacy",
  "pnpm test:plugin",
  "pnpm test:determinism",
  "pnpm test:determinism:browser",
  "pnpm perf:render",
  "git diff --check",
];

const results: GateResult[] = [];
for (const cmd of GATES) {
  const t0 = performance.now();
  const r = spawnSync(cmd, {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const durationMs = Math.round(performance.now() - t0);
  const exitCode = r.status ?? 1;
  results.push({ cmd, exitCode, durationMs, status: exitCode === 0 ? "PASS" : "FAIL" });
  console.log(`${exitCode === 0 ? "PASS" : "FAIL"} ${cmd} (${durationMs}ms)`);
  if (exitCode !== 0 && r.stderr) console.log(r.stderr.slice(-800));
}

const failed = results.filter((r) => r.status === "FAIL");
const sha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
const report = {
  gate: "verify:m0",
  executedAt: new Date().toISOString(),
  gitSha: sha,
  node: process.version,
  results,
  summary: { total: results.length, pass: results.length - failed.length, fail: failed.length },
  status: failed.length === 0 ? "PASS" : "FAIL",
};
mkdirSync(join(ROOT, "artifacts", "m0"), { recursive: true });
writeFileSync(join(ROOT, "artifacts", "m0", "verify-m0.json"), JSON.stringify(report, null, 2));
console.log(`verify:m0 ${report.status} — ${report.summary.pass}/${report.summary.total} gates passed`);
process.exit(failed.length === 0 ? 0 : 1);
