/**
 * 逐只处理：pet-3668 混沌伊洛维奇
 * （魂印「自身不出能力提升状态则必定打出致命一击且回合结束时全属性+1」）。
 *
 * 缺口：语料里「不出能力提升状态」是「不处于能力提升状态」的异写，
 * condOf 认不出 → 整句 no-rule，条件与效果一起丢失。
 *
 * 改法：tools/effects-parse.mjs 的 condOf 归一链加一条
 * 「不出(能力提升|能力下降|异常|控制类异常)状态」→「不处于$1状态」。
 * 只是把异写归一成已有谓词，没有新 op、没有新状态名、没有新 params 键。
 */
import { describe, it, expect } from "vitest";
import { condOf } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("逐只处理 pet-3668 伊洛维奇：「不出X状态」异写归一", () => {
  it("异写与正写归一到同一谓词", () => {
    expect(condOf("不出能力提升状态")).toEqual(condOf("不处于能力提升状态"));
    expect(condOf("不出能力提升状态")).toEqual({ not: { selfStageUp: true } });
  });

  it("旧谓词不回归：其它条件形态不受影响", () => {
    expect(condOf("不处于能力提升状态")).toEqual({ not: { selfStageUp: true } });
    expect(condOf("对手处于冻伤状态")).toEqual({ foeHas: "frostbite" });
    expect(condOf("不处于能力提升状态")).not.toEqual(condOf("不处于能力下降状态"));
  });

  it("魂印层：条件 + 必定致命一击落成一条带守卫的条目", () => {
    const r = parseSoulmarkText(
      "自身不出能力提升状态则必定打出致命一击且回合结束时全属性+1",
      "伊洛维奇",
    );
    expect(r.unparsed).toEqual([]);
    const crit = r.entries.find((e) => e.ops?.some((o) => o.op === "apply_status" && o.name === "crit_always"));
    expect(crit).toBeDefined();
    expect(crit?.guard).toEqual({ not: { selfStageUp: true } });
  });
});
