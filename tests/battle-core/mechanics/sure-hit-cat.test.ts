/**
 * 类别必中（sure_hit）的 cat 编码：4 = 任意攻击招。
 *
 * 引擎侧的缺口：ops/effects.ts 的 mustHitOn 用 `params.cat === cat` 精确比较，
 * 没实现全引擎统一的 `cat === 4`（任意非属性招）约定。引擎里其他类别读数器
 * （hit_fx_null / nullifyEntryFor / dmgTakenCatFracOf / blockedCategories /
 * prioAddOf / pp-delta 的 cat 过滤）都有这一支，只有必中读数器漏了——
 * 于是 sure_hit{cat:4}（"攻击技能必定命中"）是永不触发的死路径。
 *
 * 解析侧的配套：魂印里「自身攻击技能必定命中」说的是**攻击招式**必定命中，
 * 原先折算成 must_hit（无 cat ＝全类别），把属性技能也带上了。
 * 技能侧不动：技能里的同一串指的是"这一招自己必中"（accuracy 旗标），是另一层语义。
 */
import { describe, it, expect } from "vitest";
import { mustHitOn } from "../../../packages/battle-core/src/ops/effects.ts";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

/** 只带 effects 的最小持有者——mustHitOn 只读 effects。 */
const holder = (cat: number | undefined) =>
  ({
    effects: [{ kind: "modifier", at: "mustHit", ...(cat !== undefined ? { params: { cat } } : {}) }],
  }) as unknown as Parameters<typeof mustHitOn>[0];

describe("类别必中 cat 编码：4 = 任意攻击招", () => {
  it("cat:4 只覆盖攻击招（物理2/特殊3），属性招（1）不吃", () => {
    const u = holder(4);
    expect(mustHitOn(u, 2)).toBe(true); // 物理攻击招
    expect(mustHitOn(u, 3)).toBe(true); // 特殊攻击招
    expect(mustHitOn(u, 1)).toBe(false); // 属性招——不该被"攻击招必中"罩住
  });

  it("cat:4 缺省类别时（cat 未知）不生效", () => {
    expect(mustHitOn(holder(4), undefined)).toBe(false);
  });

  it("精确类别不回归：cat1/2/3 只对自己的类别生效，缺省 cat 覆盖全部", () => {
    expect(mustHitOn(holder(3), 3)).toBe(true);
    expect(mustHitOn(holder(3), 2)).toBe(false);
    expect(mustHitOn(holder(2), 2)).toBe(true);
    expect(mustHitOn(holder(1), 1)).toBe(true);
    expect(mustHitOn(holder(1), 2)).toBe(false);
    const any = holder(undefined);
    expect(mustHitOn(any, 1)).toBe(true);
    expect(mustHitOn(any, 2)).toBe(true);
    expect(mustHitOn(any, 3)).toBe(true);
  });

  it("魂印层：「自身攻击技能必定命中」只罩攻击招", () => {
    const r = parseSoulmarkText("先出手时自身攻击技能必定命中", "残晓·星纹");
    expect(r.unparsed).toEqual([]);
    const hit = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.op === "apply_status" && (o.name === "must_hit" || o.name === "sure_hit"));
    expect(hit).toEqual({
      op: "apply_status",
      name: "sure_hit",
      target: "self",
      turns: 1,
      params: { cat: 4 },
      if: { order: "first" },
    });
  });

  it("魂印层：不带类别限定的「所有技能必定命中」仍是全类别", () => {
    const r = parseSoulmarkText("自身所有技能必定命中", "某精灵");
    expect(r.unparsed).toEqual([]);
    const hit = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.op === "apply_status" && (o.name === "must_hit" || o.name === "sure_hit"));
    expect(hit).toEqual({ op: "apply_status", name: "must_hit", target: "self" });
  });
});
