/**
 * verify:m1 —— M1 聚合门禁。顺序执行全部命令，任一非零即整体非零。
 * 结果落盘 artifacts/m1/verify-m1.json。
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "artifacts", "m1", "verify-m1.json");

const GATES: { name: string; cmd: string }[] = [
  { name: "typecheck", cmd: "pnpm typecheck" },
  { name: "contracts:check", cmd: "pnpm contracts:check" },
  { name: "check:boundaries", cmd: "pnpm check:boundaries" },
  { name: "test:contracts", cmd: "pnpm test:contracts" },
  { name: "test:privacy", cmd: "pnpm test:privacy" },
  { name: "test:core", cmd: "pnpm test:core" },
  { name: "test:protocol", cmd: "pnpm test:protocol" },
  { name: "test:recovery", cmd: "pnpm test:recovery" },
  { name: "test:plugin", cmd: "pnpm test:plugin" },
  { name: "test:determinism", cmd: "pnpm test:determinism" },
  { name: "test:determinism:browser", cmd: "pnpm test:determinism:browser" },
  { name: "replay:verify", cmd: "pnpm replay:verify" },
  { name: "perf:render", cmd: "pnpm perf:render" },
  { name: "demo:m1", cmd: "pnpm demo:m1" },
  { name: "test:e2e", cmd: "pnpm test:e2e" },
  { name: "git-diff-check", cmd: "git diff --check" },
];

const results: { name: string; exit: number; ms: number }[] = [];
for (const g of GATES) {
  const t = Date.now();
  try {
    execSync(g.cmd, { cwd: ROOT, stdio: "inherit" });
    results.push({ name: g.name, exit: 0, ms: Date.now() - t });
    console.log(`PASS ${g.name}`);
  } catch {
    results.push({ name: g.name, exit: 1, ms: Date.now() - t });
    console.log(`FAIL ${g.name}`);
    break;
  }
}
const passed = results.filter((r) => r.exit === 0).length;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ gates: results, passed, total: GATES.length, ok: passed === GATES.length }, null, 2) + "\n");
console.log(`verify:m1 — ${passed}/${GATES.length} gates passed`);
process.exit(passed === GATES.length ? 0 : 1);
