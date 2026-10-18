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
 *
 * 默认读的是 content/claims/_effects-coverage.json —— 那是 `effects-parse.mjs`
 * 跑出来的**静态快照**，日期可能远早于当前解析器。快照不更新时，这个门禁
 * 等于拿旧文件比旧基线，永远 PASS，测不出解析器回退。
 * 加 --live 改用当前解析器实时重扫（慢，但反映真实状态）：
 *   node tools/effects-ratchet.ts --live
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEffectText } from "./effects-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COV = join(ROOT, "content/claims/_effects-coverage.json");
const BASE = join(ROOT, "content/claims/_coverage-baseline.json");
const SRC = join(ROOT, "content/creatures/creatures.json");

/**
 * 用当前解析器实时重算子句覆盖率。
 *
 * 口径与 effects-parse.mjs 的报告一致：子句 = 先按 ；/。 切，再按 ，/, 切。
 * top50NoReason 在实时模式下无法从旧快照的 topUnparsed 取，取 0（该项由快照模式守）。
 */
function liveStats(): { coveragePct: number; fullyParsed: number; skillsWithText: number; topNoReason: number } {
  const cat = JSON.parse(readFileSync(SRC, "utf8")) as {
    creatures: Record<string, { skills?: { effect?: string | null; power?: number | null }[] }>;
  };
  let skills = 0;
  let fully = 0;
  let clauses = 0;
  let unparsed = 0;
  for (const c of Object.values(cat.creatures)) {
    for (const s of c.skills ?? []) {
      const text = (s.effect ?? "").trim();
      if (text === "") continue;
      skills += 1;
      const parts = String(text).split(/[；;。]/).flatMap((x) => x.split(/[，,]/)).map((x) => x.trim()).filter(Boolean);
      clauses += parts.length;
      const r = parseEffectText(text, { hasDamage: (s.power ?? 0) > 0 });
      const un = r.unparsed ?? [];
      unparsed += un.length;
      if (un.length === 0) fully += 1;
    }
  }
  return {
    coveragePct: Number((((clauses - unparsed) / Math.max(1, clauses)) * 100).toFixed(1)),
    fullyParsed: fully,
    skillsWithText: skills,
    topNoReason: 0,
  };
}

const live = process.argv.includes("--live");
const stats = live ? liveStats() : undefined;
const cov = live ? undefined : JSON.parse(readFileSync(COV, "utf8"));
const coveragePct = live ? stats!.coveragePct : Number(String(cov!.clauseCoverage).replace("%", ""));
const fullyParsed = live ? stats!.fullyParsed : (cov!.fullyParsed as number);
const skillsWithText = live ? stats!.skillsWithText : (cov!.skillsWithText as number);
const topNoReason = live ? stats!.topNoReason : (cov!.topUnparsed ?? []).slice(0, 50).filter((t: any) => t.reason === undefined).length;

if (process.argv.includes("--update-baseline")) {
  writeFileSync(BASE, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    clauseCoverage: coveragePct,
    fullyParsed,
    skillsWithText,
    top50NoReason: topNoReason,
  }, null, 2));
  console.log(`baseline updated: coverage=${coveragePct}% fully=${fullyParsed}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, "utf8"));
const fails: string[] = [];
if (coveragePct < base.clauseCoverage - 0.1) fails.push(`clauseCoverage ${coveragePct}% < baseline ${base.clauseCoverage}% - 0.1pp`);
if (fullyParsed < base.fullyParsed) fails.push(`fullyParsed ${fullyParsed} < baseline ${base.fullyParsed}`);
if (topNoReason > base.top50NoReason) fails.push(`topUnparsed[50] without reason: ${topNoReason} > baseline ${base.top50NoReason}`);

console.log(`coverage=${coveragePct}% (base ${base.clauseCoverage}%) fully=${fullyParsed} (base ${base.fullyParsed}) top50NoReason=${topNoReason} (base ${base.top50NoReason})${live ? " [live]" : ""}`);
if (fails.length > 0) {
  for (const f of fails) console.error(`RATCHET FAIL: ${f}`);
  process.exit(1);
}
console.log("ratchet PASS");
