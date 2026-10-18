/**
 * effects-golden —— T1 parser golden fixture 生成器。
 *
 * 从 content/creatures/creatures.json 按固定步长分层抽样真实技能文本，
 * 逐条跑 parseEffectText，把 {flags,effects,unparsed} 落成
 * tests/fixtures/parser-golden.json。
 *
 * parser-golden.test.ts 逐条回放对比——任何规则重排/正则漂移导致的输出
 * 变化都会显式失败。
 *
 * 默认只校验（不写盘）：与现有 fixture 有差异就列出并 exit 1。
 * 确认语义变更属实后，显式加 --update 才重写。
 *
 * 用法：node tools/effects-golden.ts [--sample N] [--update]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEffectText } from "./effects-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "content/creatures/creatures.json");
const OUT = join(ROOT, "tests/fixtures/parser-golden.json");
const SAMPLE = Math.max(1, Number(process.argv.find((a) => a === "--sample") ? process.argv[process.argv.indexOf("--sample") + 1] : 350) || 350);

const cat = JSON.parse(readFileSync(SRC, "utf8"));
const all: { key: string; text: string }[] = [];
for (const c of Object.values(cat.creatures) as any[]) {
  for (const s of c.skills ?? []) {
    const text = (s.effect ?? "").trim();
    if (text) all.push({ key: `${c.petNo ?? c.id}:${s.name}`, text });
  }
}
// 等距分层抽样（确定性）：覆盖长中短文本与各机制簇
const stride = all.length / SAMPLE;
const picked: typeof all = [];
for (let i = 0; i < SAMPLE; i++) picked.push(all[Math.floor(i * stride)]!);

// 钉住的条目（pinned：某批修复专门抽的原失败句）不在步长样本里，重新生成时按原文重解析并保留
let pinnedSrc: { key: string; text: string; pinned: string }[] = [];
try { pinnedSrc = (JSON.parse(readFileSync(OUT, "utf8")).entries as any[]).filter((e) => typeof e.pinned === "string"); } catch { /* 首次生成 */ }
const entries = [
  ...picked.map(({ key, text }) => {
    const { flags, effects, unparsed } = parseEffectText(text);
    return { key, text, flags, effects, unparsed };
  }),
  ...pinnedSrc.map(({ key, text, pinned }) => {
    const { flags, effects, unparsed } = parseEffectText(text);
    return { key, text, flags, effects, unparsed, pinned };
  }),
];
mkdirSync(dirname(OUT), { recursive: true });

// 默认只校验：与现有 fixture 比对，有差异就列出并失败退出，不写盘。
// 只有显式 --update 才重写（"显式确认语义变更"）。这样误跑不会毁基线。
const next = { generated: new Date().toISOString().slice(0, 10), count: entries.length, entries };

/** 键序无关的规范化：对象按键名排序，数组保序（与 parser-golden.test.ts 一致）。 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
const sig = (v: unknown) => JSON.stringify(canon(v));

if (!process.argv.includes("--update")) {
  let prev: typeof next | undefined;
  try { prev = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* 首次生成 */ }

  if (prev === undefined) {
    console.error(`parser-golden: ${OUT} 不存在。首次生成请加 --update。`);
    process.exit(1);
  }

  const prevByKey = new Map(prev.entries.map((e) => [e.key, e]));
  const diffs: string[] = [];
  for (const a of next.entries) {
    const b = prevByKey.get(a.key);
    if (b === undefined) { diffs.push(`+ ${a.key}（新增）`); continue; }
    for (const f of ["flags", "effects", "unparsed"] as const) {
      if (sig(a[f]) !== sig(b[f])) diffs.push(`~ ${a.key} [${f}]`);
    }
  }
  const nextKeys = new Set(next.entries.map((e) => e.key));
  for (const b of prev.entries) if (!nextKeys.has(b.key)) diffs.push(`- ${b.key}（移除）`);

  if (diffs.length > 0) {
    console.error(`parser-golden: ${diffs.length} 处与 ${OUT} 不一致（只校验，未写盘）：`);
    for (const d of diffs.slice(0, 40)) console.error("  " + d);
    if (diffs.length > 40) console.error(`  … 其余 ${diffs.length - 40} 处`);
    console.error("确认语义变更属实后，用 --update 重生成并评审 diff。");
    process.exit(1);
  }
  console.log(`parser-golden: ${entries.length} entries 与 ${OUT} 一致（只校验）`);
  process.exit(0);
}

writeFileSync(OUT, JSON.stringify(next, null, 2));
console.log(`parser-golden: ${entries.length} entries → ${OUT}（--update 已写盘）`);
