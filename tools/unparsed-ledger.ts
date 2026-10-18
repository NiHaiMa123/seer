/**
 * unparsed-ledger —— 重建「未解析语句底账」。
 *
 * artifacts/unparsed-reasons.json 和 residue-skills.json 是 2026-10-04 的旧快照，
 * 之后解析器改了多轮，里面的数字已经不代表现状。这个工具用当前解析器重扫全库，
 * 输出两份可 diff 的底账：
 *
 *   artifacts/unparsed-reasons.json
 *     { generated, effects: { clauses, parsed, unparsed, byReason[], topNoRule[] },
 *       soulmarks: {...}, noRuleTop: [...] }
 *   artifacts/residue-skills.json
 *     { generated, totalResidue, movesWithResidue, byReason, byPattern }
 *
 * 只读 content/，只写 artifacts/。不碰覆盖率基线（那是 ratchet 的输入）。
 *
 * 用法：node tools/unparsed-ledger.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEffectText } from "./effects-parse.mjs";
import { parseSoulmarkText } from "./soulmark-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "artifacts");
const SRC = join(ROOT, "content/creatures/creatures.json");

/** 把子句归一成可聚合的模式：数字与量词换成 #，避免每个数字各占一行。 */
const norm = (s: string): string =>
  String(s)
    .replace(/\d+(?:\.\d+)?%?/g, "#")
    .replace(/[一二两三四五六七八九十百]/g, "#")
    .replace(/\s+/g, "");

interface ReasonRow {
  pattern: string;
  reason: string;
  count: number;
  examples: string[];
}

const bump = (rows: Map<string, ReasonRow>, clause: string, reason: string, example: string): void => {
  const pattern = norm(clause);
  const key = `${pattern}\u0000${reason}`;
  const cur = rows.get(key);
  if (cur === undefined) rows.set(key, { pattern, reason, count: 1, examples: [example] });
  else {
    cur.count += 1;
    if (cur.examples.length < 3) cur.examples.push(example);
  }
};

const sortRows = (rows: Map<string, ReasonRow>): ReasonRow[] =>
  [...rows.values()].sort((a, b) => b.count - a.count);

const cat = JSON.parse(readFileSync(SRC, "utf8")) as {
  creatures: Record<string, { id?: string; name?: string; petNo?: string | number; skills?: { name?: string; effect?: string | null; power?: number | null }[]; soulMark?: { text?: string } }>;
};

// ── 技能 ───────────────────────────────────────────────────────────────
let skillsWithText = 0;
let fullyParsed = 0;
let partialParsed = 0;
let clauses = 0;
let unparsedClauses = 0;
const skillRows = new Map<string, ReasonRow>();
/** 整招仍有残留的技能（movesWithResidue 的分子口径）。 */
let movesWithResidue = 0;

for (const c of Object.values(cat.creatures)) {
  for (const s of c.skills ?? []) {
    const text = (s.effect ?? "").trim();
    if (text === "") continue;
    skillsWithText += 1;
    // 子句口径与 effects-parse 的覆盖率一致：；/。 先切，再按 ，/, 切
    const parts = String(text).split(/[；;。]/).flatMap((x) => x.split(/[，,]/)).map((x) => x.trim()).filter(Boolean);
    clauses += parts.length;
    const r = parseEffectText(text, { hasDamage: (s.power ?? 0) > 0 });
    const un = r.unparsed ?? [];
    unparsedClauses += un.length;
    if (un.length === 0) fullyParsed += 1;
    else {
      partialParsed += 1;
      movesWithResidue += 1;
    }
    for (const u of un) {
      bump(skillRows, (u as { clause?: string }).clause ?? "?", (u as { reason?: string }).reason ?? "?", `${c.petNo ?? c.id}:${s.name ?? "?"}`);
    }
  }
}

// ── 魂印 ───────────────────────────────────────────────────────────────
let marksWithText = 0;
let marksFully = 0;
let markUnparsed = 0;
const soulRows = new Map<string, ReasonRow>();

for (const c of Object.values(cat.creatures)) {
  const text = (c.soulMark?.text ?? "").trim();
  if (text === "") continue;
  marksWithText += 1;
  const r = parseSoulmarkText(text, c.name);
  const un = r.unparsed ?? [];
  markUnparsed += un.length;
  if (un.length === 0) marksFully += 1;
  for (const u of un) {
    bump(soulRows, (u as { clause?: string }).clause ?? "?", (u as { reason?: string }).reason ?? "?", `${c.petNo ?? c.id}`);
  }
}

mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const noRuleTop = sortRows(skillRows).filter((r) => r.reason === "no-rule");
const effects = {
  clauses,
  parsed: clauses - unparsedClauses,
  unparsed: unparsedClauses,
  coverage: `${(((clauses - unparsedClauses) / Math.max(1, clauses)) * 100).toFixed(1)}%`,
  skillsWithText,
  fullyParsed,
  partialParsed,
  byReason: sortRows(skillRows),
  topNoRule: noRuleTop.slice(0, 50),
};
const soulmarks = {
  marksWithText,
  marksFully,
  unparsed: markUnparsed,
  byReason: sortRows(soulRows),
};

writeFileSync(
  join(OUT, "unparsed-reasons.json"),
  JSON.stringify({ generated: today, effects, soulmarks, noRuleTop: noRuleTop.slice(0, 100) }, null, 2),
);

// 残留技能清单：byReason 与 byPattern 两种视角
const byReason: Record<string, number> = {};
for (const r of skillRows.values()) byReason[r.reason] = (byReason[r.reason] ?? 0) + r.count;
const byPattern: Record<string, number> = {};
for (const r of sortRows(skillRows).slice(0, 200)) byPattern[r.pattern] = r.count;

writeFileSync(
  join(OUT, "residue-skills.json"),
  JSON.stringify({ generated: today, totalResidue: unparsedClauses, movesWithResidue, byReason, byPattern }, null, 2),
);

// 成段的 no-rule 骨架（每条取一句原文），供人工判断"缺哪种语义"
writeFileSync(
  join(OUT, "norule-skeletons.json"),
  JSON.stringify(noRuleTop.slice(0, 500).map((r) => ({ pattern: r.pattern, count: r.count, examples: r.examples })), null, 2),
);

console.log(
  `skills=${skillsWithText} clauses=${clauses} parsed=${clauses - unparsedClauses} (${effects.coverage}) fully=${fullyParsed} partial=${partialParsed}`,
);
console.log(`soulmarks=${marksWithText} fully=${marksFully} unparsed=${markUnparsed}`);
console.log(`residue reasons=${Object.keys(byReason).length} patterns=${Object.keys(byPattern).length}`);
