/**
 * 魂印定点同步工具（tools/sync-soulmarks.mjs）的行为锁。
 *
 * 工具存在的理由：解析器或规则改动后只想更新几只精灵的魂印，
 * 而 build-pet-roster.mjs 是整库生成器（会重写 moves/units/soulmarks），
 * 计划里禁止整库重建。
 *
 * 这里锁三件事：
 *  - 编译口径与 build-pet-roster.mjs 一致（条目形状、id、name、desc 截断）
 *  - 巅峰 12 只手工单位：魂印本体照常编译，但不挂 unit.soulMark
 *  - 幂等：对同一批目标再跑一次不应产生差异
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

interface Creature {
  id?: string;
  name?: string;
  soulMark?: { text?: string };
}

const cat = JSON.parse(readFileSync("content/creatures/creatures.json", "utf8")) as {
  creatures: Record<string, Creature>;
};
const marks = JSON.parse(readFileSync("content/peak/soulmarks.json", "utf8")).soulmarks as Record<
  string,
  { id: string; name: string; desc: string; effects: unknown[] }
>;
const units = JSON.parse(readFileSync("content/peak/units.json", "utf8")).units as {
  id: string;
  soulMark?: string;
}[];

const creature = (id: string): Creature | undefined => {
  for (const [key, c] of Object.entries(cat.creatures)) if ((c.id ?? key) === id) return c;
  return undefined;
};

/** 与 sync-soulmarks.mjs 的 compile() 同口径。 */
const compile = (c: Creature) => {
  const text = String(c.soulMark?.text ?? "").trim();
  if (text === "") return null;
  const sm = parseSoulmarkText(text, c.name);
  if (sm.entries.length === 0) return null;
  const suffix = String(c.id ?? "").replace(/^pet-/, "");
  return { id: `sm-${suffix}`, name: `${c.name}魂印`, desc: text.slice(0, 2000), effects: sm.entries };
};

describe("魂印定点同步工具", () => {
  it("没有活动条目的魂印仍如实报告未实现子句", () => {
    const c = creature("pet-4035")!;
    const residual = parseSoulmarkText(c.soulMark!.text!, c.name).unparsed.length;
    expect(residual).toBeGreaterThan(0);
    const out = execFileSync("node", ["tools/sync-soulmarks.mjs", "--dry-run", "pet-4035"], { encoding: "utf8" });
    expect(out).toContain(`条目 0，残文 ${residual}`);
  });

  it("编译口径与生成器一致：条目 id/name/desc 与 parseSoulmarkText 同源", () => {
    const c = creature("pet-3398");
    expect(c).toBeDefined();
    const compiled = compile(c!);
    expect(compiled?.id).toBe("sm-3398");
    expect(compiled?.name).toBe(`${c!.name}魂印`);
    expect(compiled?.desc).toBe(String(c!.soulMark?.text ?? "").slice(0, 2000));
    // 包内条目与当前解析一致（定点同步后应当如此）
    const stored = marks["sm-3398"];
    expect(stored).toBeDefined();
    expect(stored?.effects).toEqual(compiled?.effects);
  });

  it("巅峰手工单位：魂印本体在包里，但不挂 unit.soulMark", () => {
    const manual = units.find((u) => u.id === "pet-5000");
    expect(manual).toBeDefined();
    expect(manual?.soulMark).toBeUndefined();
    // 魂印本体仍然编译进 soulmarks.json
    const c = creature("pet-5000");
    const compiled = compile(c!);
    if (compiled !== null) expect(marks[compiled.id]).toBeDefined();
  });

  it("幂等：再跑一次同步没有待写回的差异", () => {
    const out = execFileSync("node", ["tools/sync-soulmarks.mjs", "--dry-run", "pet-3398", "pet-2909"], {
      encoding: "utf8",
    });
    expect(out).toContain("已是最新");
    expect(out).toContain("条目变化 0、挂载变化 0");
  });

  it("不在包范围的精灵被跳过（生成器也不会给它们出条目）", () => {
    const out = execFileSync("node", ["tools/sync-soulmarks.mjs", "--dry-run", "pet-3513"], { encoding: "utf8" });
    // pet-3513 没有 unit：要么跳过，要么已是最新——不能出现待写回
    expect(out).not.toContain("条目 不同");
  });
});
