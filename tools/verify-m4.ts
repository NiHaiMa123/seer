/**
 * verify:m4 — M4 收官聚合器。
 * 门禁（roadmap M4 口径）：
 *  1 presentation   表现层 e2e（bench/replacement/effect/stage/徽标）
 *  2 team           队伍编辑校验 + 建局展开
 *  3 pve            PVE/BOSS 单人链路（bot 席位、终局可达）
 *  4 world:save     存档/背包/任务持久化 + reward outbox exactly-once
 *  5 world:ops      会话预算 + 不可逆策略门控 + challenge→建局
 *  6 world:agent    WorldAgent 编排（BFS/目标驱动/预算收敛）
 *  另：typecheck + boundaries + 全量回归。
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const gates: Array<{ gate: string; status: "PASS" | "FAIL" | "N/A"; evidence: string }> = [];

const run = (cmd: string): boolean => {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

// ── 回归基线 ────────────────────────────────────────────────
gates.push({ gate: "regression:typecheck", status: run("pnpm typecheck") ? "PASS" : "FAIL", evidence: "tsc -p tsconfig.json" });
gates.push({ gate: "regression:boundaries", status: run("pnpm check:boundaries") ? "PASS" : "FAIL", evidence: "public/internal 边界扫描" });
gates.push({
  gate: "regression:unit",
  status: run("pnpm vitest run tests/battle-core tests/host tests/contracts tests/agent tests/server experiments/cordis/tests experiments/determinism/tests/determinism.test.ts") ? "PASS" : "FAIL",
  evidence: "vitest 全量（不含 e2e/playwright spec）",
});

// ── 门 1：表现层 ────────────────────────────────────────────
const built = run("pnpm build:client");
gates.push({
  gate: "presentation:e2e",
  status: built && run("pnpm playwright test tests/e2e --reporter=line") ? "PASS" : "FAIL",
  evidence: "bench 面板/replacement 横幅/effect+stage chips/伤害徽标（5 用例）",
});

// ── 门 2：队伍编辑 ──────────────────────────────────────────
gates.push({
  gate: "team",
  status: run("pnpm vitest run tests/server/team.test.ts") ? "PASS" : "FAIL",
  evidence: "有序展开/bench≤maxBenchSize/v1 门禁/互斥（9 用例）",
});

// ── 门 3：PVE/BOSS ─────────────────────────────────────────
gates.push({
  gate: "pve",
  status: run("pnpm vitest run tests/server/pve.test.ts") ? "PASS" : "FAIL",
  evidence: "bot 席位无 token、boss overlay、单人到终局（2 用例）",
});

// ── 门 4：world 持久化 + outbox exactly-once ───────────────
gates.push({
  gate: "world:persistence+outbox",
  status: run("pnpm vitest run tests/server/world.test.ts") ? "PASS" : "FAIL",
  evidence: "outbox 键 (battleId,recipient,resultRevision)、重放不重复入账、db 重开存活（5 用例）",
});

// ── 门 5：世界 op 预算/策略 ────────────────────────────────
gates.push({
  gate: "world:ops",
  status: run("pnpm vitest run tests/server/world-ops.test.ts") ? "PASS" : "FAIL",
  evidence: "会话预算耗尽/停机全拒/邻接校验/POLICY_DENIED/challenge→建局（4 用例）",
});

// ── 门 6：World Agent ──────────────────────────────────────
gates.push({
  gate: "world:agent",
  status: run("pnpm vitest run tests/agent/world-agent.test.ts") ? "PASS" : "FAIL",
  evidence: "目标驱动 BFS/预算收敛/不可逆不误触（4 用例）",
});

// ── 汇总 ────────────────────────────────────────────────────
const fails = gates.filter((g) => g.status === "FAIL").length;
const na = gates.filter((g) => g.status === "N/A").length;
for (const g of gates) console.log(`${g.status.padEnd(4)} ${g.gate} — ${g.evidence}`);
console.log(`\nverify:m4 ${gates.length - fails - na}/${gates.length - na} PASS${na > 0 ? ` (+${na} N/A)` : ""}`);

writeFileSync(join(ROOT, "artifacts", "m4", "verify-m4.json"), JSON.stringify({ date: new Date().toISOString(), gates }, null, 2));
process.exit(fails > 0 ? 1 : 0);
