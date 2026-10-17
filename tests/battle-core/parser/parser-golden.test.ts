/**
 * parser-golden —— T1 真实语料 golden。
 * tests/fixtures/parser-golden.json 里每条原文的 {flags,effects,unparsed}
 * 必须与当前 parseEffectText 输出逐字节一致（JSON.stringify 序）。
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

describe("parser golden fixture (real corpus strided sample)", () => {
  it("fixture loaded", () => {
    expect(golden.entries.length).toBe(golden.count);
    expect(golden.entries.length).toBeGreaterThan(200);
  });
  it.each(golden.entries.map((e) => [e.key, e] as const))("%s", (_k, e) => {
    const got = parseEffectText(e.text);
    expect(JSON.stringify(got.effects), `${e.key} effects`).toBe(JSON.stringify(e.effects));
    expect(JSON.stringify(got.flags), `${e.key} flags`).toBe(JSON.stringify(e.flags));
    expect(JSON.stringify(got.unparsed), `${e.key} unparsed`).toBe(JSON.stringify(e.unparsed));
  });
});
