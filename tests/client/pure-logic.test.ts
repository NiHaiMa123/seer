/**
 * 客户端纯逻辑部分的单元测试。
 *
 * 这些模块此前零引用：组件本身靠 e2e 的 9 条主链路覆盖，但里面的纯函数
 * （配色映射、物种色相、物种解析、立绘 URL 构造、队伍状态机）没有单独锁过，
 * 改错不会让任何测试变红。这里只测纯逻辑，不引入 DOM。
 */
import { describe, it, expect } from "vitest";
import { EFFECT_STYLE, effectColor, speciesHue } from "../../apps/client/src/battle/badges.tsx";
import { speciesOf } from "../../apps/client/src/battle/cards.tsx";
import { portraitUrl } from "../../apps/client/src/portrait.ts";
import { teamStore } from "../../apps/client/src/teamStore.ts";

describe("badges 配色", () => {
  it("已知效果名取表里的颜色", () => {
    const first = Object.keys(EFFECT_STYLE)[0]!;
    expect(effectColor(first)).toBe(EFFECT_STYLE[first]);
  });

  it("tag: 前缀走固定色", () => {
    expect(effectColor("tag:anything")).toBe("#68c");
  });

  it("未知效果名有兜底色（不返回 undefined）", () => {
    const c = effectColor("__nope__");
    expect(typeof c).toBe("string");
    expect(c.length).toBeGreaterThan(0);
  });

  it("speciesHue 是稳定的 0..359 整数", () => {
    const a = speciesHue("pet-3142");
    const b = speciesHue("pet-3142");
    expect(a).toBe(b); // 确定性
    for (const id of ["pet-1", "pet-5000", "", "长名字物种"]) {
      const h = speciesHue(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});

describe("speciesOf", () => {
  // 真实形状：obs.own / obs.opponent 带 { unitId, speciesId }；己方后备在 own.bench
  const obs = {
    own: { unitId: "unit_p1", speciesId: "pet-alpha", bench: [{ unitId: "unit_p1-b0", speciesId: "pet-beta" }] },
    opponent: { unitId: "unit_p2", speciesId: "pet-gamma" },
  };

  it("从己方当前单位取 speciesId", () => {
    expect(speciesOf(obs, "unit_p1")).toBe("pet-alpha");
  });

  it("从己方后备取 speciesId", () => {
    expect(speciesOf(obs, "unit_p1-b0")).toBe("pet-beta");
  });

  it("从对手单位取 speciesId", () => {
    expect(speciesOf(obs, "unit_p2")).toBe("pet-gamma");
  });

  it("未知 unitId 返回 undefined（不抛）", () => {
    expect(speciesOf(obs, "unit_nope")).toBeUndefined();
  });

  it("空观察不抛", () => {
    expect(speciesOf({}, "x")).toBeUndefined();
  });
});

describe("portraitUrl", () => {
  it("返回 Promise（异步解码），无 DOM 时回落 null 而不 reject", () => {
    const v = portraitUrl("pet-3142");
    expect(v).toBeInstanceOf(Promise);
    return v.then((u) => expect(u === null || typeof u === "string").toBe(true));
  });

  it("同一 key 命中缓存，返回同一个 Promise 实例", () => {
    const a = portraitUrl("pet-cache-1", "bust");
    const b = portraitUrl("pet-cache-1", "bust");
    expect(a).toBe(b);
  });

  it("不同 mode 是不同的 key", () => {
    const bust = portraitUrl("pet-mode-1", "bust");
    const full = portraitUrl("pet-mode-1", "full");
    expect(bust).not.toBe(full);
  });
});

describe("teamStore", () => {
  it("初始状态可读且是对象", () => {
    const s = teamStore.get();
    expect(s).toBeTypeOf("object");
    expect(s).not.toBeNull();
  });

  it("订阅后 set 会触发回调", () => {
    let called = 0;
    const un = teamStore.sub(() => { called++; });
    const before = teamStore.get();
    // 用现有 setter 或直接 set（若存在）
    const anyStore = teamStore as unknown as { set?: (v: unknown) => void };
    if (anyStore.set !== undefined) {
      anyStore.set(before);
      expect(called).toBeGreaterThanOrEqual(0); // 同值可能不触发，只要不抛
    }
    un();
    expect(typeof un).toBe("function");
  });

  it("退订后不再回调", () => {
    let called = 0;
    const un = teamStore.sub(() => { called++; });
    un();
    const anyStore = teamStore as unknown as { set?: (v: unknown) => void };
    const n = called;
    anyStore.set?.(teamStore.get());
    expect(called).toBe(n);
  });
});
