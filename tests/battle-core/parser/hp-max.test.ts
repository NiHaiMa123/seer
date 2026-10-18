/**
 * 体力上限变更（hpMax 域）——正向上限用 stat_boost{stats:["hp"]}，削减用 max_hp_down。
 *
 * 语料 26 处，形态：
 *   增加200点体力上限 / 自身增加100点体力上限
 *   自身体力上限提升20%
 *   减少对手120点体力上限 / 令对手的体力上限减少35%
 *
 * 引擎侧：
 *   · stat_boost 支持 stats:["hp"]——base.hp 加 delta 并同步 currentHp（上限提升即回血）
 *   · max_hp_down 有挂载+按新上限收拢 currentHp 的逻辑
 * 注意 stat_boost 的 add/pct 在 schema 里要求 >=1，**不能传负值**，
 * 所以"减少上限"必须走 max_hp_down，不能写成 add:-N。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

type Op = { op?: string; name?: string; stats?: string[]; add?: number; pct?: number; target?: string; params?: { n?: number; d?: number } };

const opsOf = (entries: { ops?: Op[] }[]) => entries.flatMap((e) => e.ops ?? []);

describe("体力上限：增加（stat_boost hp）", () => {
  it("「增加200点体力上限」→ +200 self", () => {
    const r = parseSoulmarkText("增加200点体力上限", "麦索瑞尔");
    expect(r.unparsed).toEqual([]);
    const op = opsOf(r.entries).find((o) => o.op === "stat_boost");
    expect(op?.stats).toEqual(["hp"]);
    expect(op?.add).toBe(200);
    expect(op?.target).toBe("self");
  });

  it("「自身增加100点体力上限」", () => {
    const r = parseSoulmarkText("自身增加100点体力上限", "驭火·迪尔克");
    expect(r.unparsed).toEqual([]);
    expect(opsOf(r.entries).some((o) => o.op === "stat_boost" && o.add === 100)).toBe(true);
  });

  it("「自身体力上限提升20%」→ pct 20", () => {
    const r = parseSoulmarkText("自身体力上限提升20%", "古代巨型机器人");
    expect(r.unparsed).toEqual([]);
    const op = opsOf(r.entries).find((o) => o.op === "stat_boost");
    expect(op?.pct).toBe(20);
  });
});

describe("体力上限：减少（max_hp_down，不能用负 add）", () => {
  it("「减少对手120点体力上限」→ max_hp_down n=120", () => {
    const r = parseSoulmarkText("减少对手120点体力上限", "友情机器人");
    expect(r.unparsed).toEqual([]);
    const op = opsOf(r.entries).find((o) => o.name === "max_hp_down");
    expect(op?.target).toBe("opponent");
    expect(op?.params).toEqual({ n: 120, d: 1 });
  });

  it("「令对手的体力上限减少35%」→ max_hp_down 35%", () => {
    const r = parseSoulmarkText("令对手的体力上限减少35%", "湮灭之主·咤克斯");
    expect(r.unparsed).toEqual([]);
    const op = opsOf(r.entries).find((o) => o.name === "max_hp_down");
    expect(op?.target).toBe("opponent");
    expect(op?.params).toEqual({ n: 35, d: 100 });
  });

  it("减少侧绝不产出负 add（schema 要求 >=1）", () => {
    const r = parseSoulmarkText("减少对手120点体力上限", "友情机器人");
    for (const o of opsOf(r.entries)) {
      if (o.op === "stat_boost") expect(o.add ?? 0).toBeGreaterThanOrEqual(1);
    }
  });
});