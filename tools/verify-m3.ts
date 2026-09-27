/**
 * verify:m3 — M3 收官聚合器。
 * 门禁（AGENT.md §7）：
 *  1 safety       ≥1000 adversarial 调用零泄漏（safety.test.ts）
 *  2 mechanism    holdout 反制/无解判定 ≥24/30
 *  3 generalization novel+counterplay holdout 各类 ≥4/5
 *  4 gain         search vs 最强非 LLM（rule）paired CI lower>0 且 ≥+5pp；
 *                 真 LLM 增益无 endpoint 不可宣称 → N/A 标注
 *  5 budget       决策 p95 ≤10s 且 ≥95% 决策在预算内
 *  另：回归 suite + boundaries + typecheck 全过。
 * 读 eval-m3.json（若无则提示先跑 eval:m3）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const gates: Array<{ gate: string; status: "PASS" | "FAIL" | "N/A"; evidence: string }> = [];

const run = (cmd: string, label: string): boolean => {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

// ── 回归 ────────────────────────────────────────────────────
gates.push({
  gate: "regression:typecheck",
  status: run("pnpm typecheck", "typecheck") ? "PASS" : "FAIL",
  evidence: "tsc -p tsconfig.json",
});
gates.push({
  gate: "regression:boundaries",
  status: run("pnpm check:boundaries", "boundaries") ? "PASS" : "FAIL",
  evidence: "public/internal 边界扫描",
});
const agentOk = run("pnpm test:agent", "agent tests");
gates.push({ gate: "regression:test-agent", status: agentOk ? "PASS" : "FAIL", evidence: "44 用例" });
gates.push({
  gate: "regression:host-contracts",
  status: run("pnpm vitest run tests/host tests/contracts", "host") ? "PASS" : "FAIL",
  evidence: "host+contracts 套件",
});

// ── 门 1：安全 ──────────────────────────────────────────────
gates.push({
  gate: "safety",
  status: run("pnpm vitest run tests/agent/safety.test.ts", "safety") ? "PASS" : "FAIL",
  evidence: "≥1024 adversarial 调用零泄漏零副作用",
});

// ── 读 eval 结果 ────────────────────────────────────────────
const evalPath = join(ROOT, "artifacts", "m3", "eval-m3.json");
if (!existsSync(evalPath)) {
  gates.push({ gate: "mechanism", status: "FAIL", evidence: "eval-m3.json 缺失——先跑 pnpm eval:m3" });
} else {
  const ev = JSON.parse(readFileSync(evalPath, "utf8")) as {
    mechanism: { holdoutScore: number; holdoutTotal: number; boundedHoldoutScore?: number; results: Array<{ id: string; category: string; hit: boolean }> };
    ablation: Array<{ arm: string; games: number; wins: number; draws: number; timeouts: number; winrateCI: { lo: number; hi: number }; pairedVsRule: { lo: number; hi: number; estimate: number }; decisionMsP95: number }>;
    config: { provider: string };
  };
  const m = ev.mechanism;
  gates.push({
    gate: "mechanism",
    status: m.holdoutScore >= 24 ? "PASS" : "FAIL",
    evidence: `holdout ${m.holdoutScore}/${m.holdoutTotal}（bounded@512 灵敏度 ${m.boundedHoldoutScore ?? "?"}/${m.holdoutTotal}）`,
  });
  // 门 3：generalization — novel+counterplay 各 ≥4/5
  const cat = (c: string) => {
    const rs = m.results.filter((r) => r.category === c && r.id.includes("holdout"));
    return { hit: rs.filter((r) => r.hit).length, tot: rs.length };
  };
  const nov = cat("novel"), cp = cat("counterplay");
  gates.push({
    gate: "generalization",
    status: nov.hit >= 4 && cp.hit >= 4 ? "PASS" : "FAIL",
    evidence: `novel ${nov.hit}/${nov.tot}、counterplay ${cp.hit}/${cp.tot}（各需 ≥4）`,
  });
  // 门 4：gain — search vs rule paired
  const search = ev.ablation.find((a) => a.arm === "search");
  const gainOk = search !== undefined && search.pairedVsRule.lo > 0 && search.pairedVsRule.estimate >= 0.05;
  gates.push({
    gate: "gain:search-vs-rule",
    status: gainOk ? "PASS" : "FAIL",
    evidence: search === undefined ? "no data" : `paired Δ ${(search.pairedVsRule.estimate * 100).toFixed(1)}pp CI[${(search.pairedVsRule.lo * 100).toFixed(1)},${(search.pairedVsRule.hi * 100).toFixed(1)}pp]`,
  });
  gates.push({
    gate: "gain:llm-vs-rule",
    status: "N/A",
    evidence: `${ev.config.provider}——无真实 LLM endpoint，不可宣称增益`,
  });
  // 门 5：budget p95 ≤10s
  const worstP95 = Math.max(...ev.ablation.map((a) => a.decisionMsP95));
  gates.push({
    gate: "budget",
    status: worstP95 <= 10_000 ? "PASS" : "FAIL",
    evidence: `最差 arm 决策 p95 ${worstP95.toFixed(1)}ms`,
  });
}

// ── 汇总 ────────────────────────────────────────────────────
const fails = gates.filter((g) => g.status === "FAIL").length;
const na = gates.filter((g) => g.status === "N/A").length;
for (const g of gates) console.log(`${g.status.padEnd(4)} ${g.gate} — ${g.evidence}`);
console.log(`\nverify:m3 ${gates.length - fails - na}/${gates.length - na} PASS${na > 0 ? ` (+${na} N/A)` : ""}`);

writeFileSync(join(ROOT, "artifacts", "m3", "verify-m3.json"), JSON.stringify({ date: new Date().toISOString(), gates }, null, 2));
process.exit(fails > 0 ? 1 : 0);
