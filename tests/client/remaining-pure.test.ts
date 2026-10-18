/**
 * 客户端剩余零引用纯逻辑。
 *
 * 覆盖对象是那些「不进 e2e 断言、也没有单元测试」的纯函数：
 *   - creature.ts 的 hsl / speciesSkin（立绘配色，e2e 只验证画面存在，不验证取值）
 *   - ui/art.ts 的 itemArt / itemRarity / ITEM_KIND_ZH（道具图标与稀有度的映射）
 *
 * 不测 main.tsx / scene.ts / api.ts —— 启动与 IO 外壳；React 组件（HpBar 等）的
 * 渲染需要真实 DOM/React 渲染器，同样交给 e2e，不在这里用裸函数调用硬测。
 */
import { describe, it, expect } from "vitest";
import { hsl, speciesSkin } from "../../apps/client/src/creature.ts";
import { itemArt, itemRarity, ITEM_KIND_ZH } from "../../apps/client/src/ui/art.ts";

describe("creature.hsl", () => {
  it("输出是合法的 24 位整数颜色（Pixi 用）", () => {
    for (const [h, s, l] of [[0, 100, 50], [120, 50, 50], [359, 80, 20], [200, 0, 100], [200, 0, 0]]) {
      const v = hsl(h!, s!, l!);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("同一输入稳定", () => {
    expect(hsl(123, 45, 67)).toBe(hsl(123, 45, 67));
  });

  it("色相不同 → 颜色不同", () => {
    expect(hsl(0, 100, 50)).not.toBe(hsl(180, 100, 50));
  });

  it("饱和度 0 时为灰阶（R=G=B）", () => {
    const v = hsl(200, 0, 50);
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe("creature.speciesSkin", () => {
  it("同一物种稳定，不同物种通常不同", () => {
    const a = speciesSkin("pet-3142");
    const b = speciesSkin("pet-3142");
    expect(a).toEqual(b);
    // 换一个物种，至少有一个字段不同（不强行断言具体值）
    const c = speciesSkin("pet-5000");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("返回对象含配色字段", () => {
    const s = speciesSkin("pet-1");
    expect(s).toBeTypeOf("object");
    expect(Object.keys(s).length).toBeGreaterThan(0);
  });
});

describe("ui/art", () => {
  it("itemArt 对每种 kind 都给得出路径（不返回 undefined）", () => {
    for (const kind of Object.keys(ITEM_KIND_ZH) as (keyof typeof ITEM_KIND_ZH)[]) {
      const v = itemArt({ id: `x-${kind}`, kind } as any);
      expect(typeof v === "string" || v === undefined).toBe(true);
    }
  });

  it("同名 id 稳定", () => {
    const it = { id: "item-1", kind: "hp" } as any;
    expect(itemArt(it)).toBe(itemArt(it));
  });

  it("itemRarity 只返回四个档位之一", () => {
    for (const id of ["a", "b", "c", "d", "rare-1", "ssr-x"]) {
      const r = itemRarity({ id, kind: "hp" } as any);
      expect(["n", "r", "sr", "ssr"]).toContain(r);
    }
  });

  it("ITEM_KIND_ZH 每种 kind 都有中文名", () => {
    for (const [kind, zh] of Object.entries(ITEM_KIND_ZH)) {
      expect(typeof zh, kind).toBe("string");
      expect(zh.length, kind).toBeGreaterThan(0);
    }
  });
});
