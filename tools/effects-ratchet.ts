/**
 * effects-ratchet —— T9 覆盖率棘轮门禁。
 *
 * 对比 content/claims/_effects-coverage.json 与基线
 * content/claims/_coverage-baseline.json：
 *   - clauseCoverage 回退超过 0.1pp → FAIL
 *   - fullyParsed 回退 → FAIL
 *   - topUnparsed 前 50 条中无 reason 的占比上升 → FAIL
 *
 * 基线更新：node tools/effects-ratchet.ts --update-baseline
 * （只允许在评审确认覆盖率提升/等价时更新）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COV = join(ROOT, "content/claims/_effects-coverage.json");
const BASE = join(ROOT, "content/claims/_coverage-baseline.json");

const cov = JSON.parse(readFileSync(COV, "utf8"));
const coveragePct = Number(String(cov.clauseCoverage).replace("%", ""));
const topNoReason = (cov.topUnparsed ?? []).slice(0, 50).filter((t: any) => t.reason === undefined).length;

if (process.argv.includes("--update-baseline")) {
  writeFileSync(BASE, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    clauseCoverage: coveragePct,
    fullyParsed: cov.fullyParsed,
    skillsWithText: cov.skillsWithText,
    top50NoReason: topNoReason,
  }, null, 2));
  console.log(`baseline updated: coverage=${coveragePct}% fully=${cov.fullyParsed}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, "utf8"));
const fails: string[] = [];
if (coveragePct < base.clauseCoverage - 0.1) fails.push(`clauseCoverage ${coveragePct}% < baseline ${base.clauseCoverage}% - 0.1pp`);
if (cov.fullyParsed < base.fullyParsed) fails.push(`fullyParsed ${cov.fullyParsed} < baseline ${base.fullyParsed}`);
if (topNoReason > base.top50NoReason) fails.push(`topUnparsed[50] without reason: ${topNoReason} > baseline ${base.top50NoReason}`);

console.log(`coverage=${coveragePct}% (base ${base.clauseCoverage}%) fully=${cov.fullyParsed} (base ${base.fullyParsed}) top50NoReason=${topNoReason} (base ${base.top50NoReason})`);
if (fails.length > 0) {
  for (const f of fails) console.error(`RATCHET FAIL: ${f}`);
  process.exit(1);
}
console.log("ratchet PASS");
