/**
 * effects-golden —— T1 parser golden fixture 生成器。
 *
 * 从 content/creatures/creatures.json 按固定步长分层抽样真实技能文本，
 * 逐条跑 parseEffectText，把 {flags,effects,unparsed} 落成
 * tests/fixtures/parser-golden.json。
 *
 * parser-golden.test.ts 逐条回放对比——任何规则重排/正则漂移导致的输出
 * 变化都会显式失败，必须 --update 重新生成（即"显式确认语义变更"）。
 *
 * 用法：node tools/effects-golden.ts [--sample N]
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
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: entries.length, entries }, null, 2));
console.log(`parser-golden: ${entries.length} entries → ${OUT}`);
