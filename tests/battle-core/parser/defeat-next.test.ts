/**
 * 「下1次击败对手后，恢复自身全部体力值与PP值」——击败即触发，合并句。
 *
 * 不带「下1次」的形态已支持（foeFainted 条件门）：
 *   「击败对手后恢复自身全部体力」→ heal{if:{foeFainted:true}}
 *   「击败对手后恢复自身全部PP值」→ pp_delta{full, if:{foeFainted:true}}
 * 但加上「下N次」前缀后整句不匹配。这里「下1次」只是"下一次发生时"的修饰，
 * 语义与裸形相同（都靠 foeFainted 门控），不需要新 trigger。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("下1次击败对手后", () => {
  it("恢复体力值+PP值（合并句）", () => {
    const r = parseEffectText("下1次击败对手后恢复自身全部体力值与PP值");
    expect(r.unparsed).toEqual([]);
    const s = JSON.stringify(r.effects);
    expect(s).toMatch(/foeFainted/);
    expect(s).toMatch(/"op":"heal"/);
    expect(s).toMatch(/pp_delta/);
  });

  it("只恢复体力也认", () => {
    const r = parseEffectText("下1次击败对手后恢复自身全部体力");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.effects)).toMatch(/foeFainted/);
  });

  it("裸形（无「下1次」）不回归", () => {
    const r = parseEffectText("击败对手后恢复自身全部体力");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.effects)).toMatch(/foeFainted/);
  });
});