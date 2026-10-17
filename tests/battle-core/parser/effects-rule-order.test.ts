/**
 * 技能规则顺序快照。加一条效果的顺序见 plans/add-effect.md。
 * 已写入快照的 id 必须仍按原相对顺序出现。新 id 可以先不写进快照，
 * 这样三路并行时不必抢这份文件。调换或删掉已快照的 id 就是截走了旧句子，撤回。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES } from "../../../tools/effects-rules/order.mjs";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/effects-rule-order.json");
const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as string[];

describe("effects rule order", () => {
  it("已快照 id 的相对顺序不变，且全部 id 不重复", () => {
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(expected);
    expect(ids.filter((id) => known.has(id))).toEqual(expected);
  });
});
