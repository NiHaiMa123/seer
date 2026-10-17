/**
 * parser-golden —— T1 真实语料 golden。
 * tests/fixtures/parser-golden.json 里每条原文的 {flags,effects,unparsed}
 * 必须与当前 parseEffectText 输出**语义一致**。
 *
 * 比较用键序无关的规范化（对象键排序、数组保序）：IR 的语义由键值决定，
 * 不由 JSON 键的书写顺序决定。规则里通道（flags/attachDamage/op 字段）的
 * 追加顺序会随实现调整而变，那不该算语义变更；反之值、结构、数组顺序变
 * 了就必须报错。
 *
 * 变更语义 → 显式 `node tools/effects-golden.ts` 重新生成并评审 diff。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/parser-golden.json");
const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  count: number;
  entries: { key: string; text: string; flags: unknown; effects: unknown[]; unparsed: unknown[] }[];
};

/** 键序无关的规范化：对象按键名排序，数组保持原序（数组顺序是语义）。 */
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

describe("parser golden fixture (real corpus strided sample)", () => {
  it("fixture loaded", () => {
    expect(golden.entries.length).toBe(golden.count);
    expect(golden.entries.length).toBeGreaterThan(200);
  });
  it.each(golden.entries.map((e) => [e.key, e] as const))("%s", (_k, e) => {
    const got = parseEffectText(e.text);
    expect(sig(got.effects), `${e.key} effects`).toBe(sig(e.effects));
    expect(sig(got.flags), `${e.key} flags`).toBe(sig(e.flags));
    expect(sig(got.unparsed), `${e.key} unparsed`).toBe(sig(e.unparsed));
  });
});
