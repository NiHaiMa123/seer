/**
 * invert_stages 的 stat 字段：规则 e27-df-02 已经在发它，但 CompiledEffect
 * 与 moves.schema 都没有这个字段 —— 属于「规则已发、契约没跟上」。
 *
 * 语义（copy_stages.ts 文件头与实现）：stat 给定时只反转那一维
 * （"反转对手速度能力提升状态"），sign 仍按原句的提升/下降。
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("invert_stages.stat", () => {
  it("带能力名的反转只产出该维，并带上 stat", () => {
    const r = parseEffectText("反转对手速度能力提升状态");
    expect(r.effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent", stat: "spd" },
    ]);
  });

  it("无能力名的全维反转不带 stat", () => {
    const r = parseEffectText("反转对手能力提升状态");
    expect(r.effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
});
