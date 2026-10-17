/**
 * 没人读的 EffectDef 旗标必须失败。负例用假旗标，不写进 EFFECT_DEFS。
 */
import { describe, expect, it } from "vitest";
import { unreadEffectFlags, unreadEffectFlagsFromRepo } from "../../../tools/effect-flag-readers.ts";

describe("effect flag readers", () => {
  it("仓库里的旗标要么有读取，要么在 DEFERRED_FLAGS", () => {
    expect(unreadEffectFlagsFromRepo()).toEqual([]);
  });

  it("负例：noSuchFlag 无人读取 → 点名", () => {
    const text = unreadEffectFlags({
      effectsSrc: "",
      otherSrc: "",
      flags: ["noSuchFlag"],
      deferred: [],
    }).join("\n");
    expect(text).toContain("noSuchFlag");
  });
});
