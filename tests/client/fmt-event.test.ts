/**
 * fmt-event — 播报文案夹具（阶段 1）。
 * 每个公开事件类型至少一条夹具：返回值非空、不含「?」占位、含预期子串。
 * 新增公开类型而本表不更新 → PUBLIC_TYPES 循环生成的那条断言失败，逼人补播报。
 */
import { describe, expect, it } from "vitest";
import { fmtEvent } from "../../apps/client/src/battle/format.ts";
import { PUBLIC_TYPES } from "../../packages/host/src/events.ts";

// 固定观察夹具：带 side 的事件需要 obs.side/own/opponent，缺了会在 obs.opponent 上抛——那是夹具错误不是产品错误
const OBS = { side: "p1", own: { speciesId: "a" }, opponent: { speciesId: "b" } };
const fmt = (ev: Record<string, unknown>): string => fmtEvent(ev, OBS, null);

const FIXTURES: Record<string, { ev: Record<string, unknown>; contains: string }> = {
  "turn-begin": { ev: { type: "turn-begin", turn: 2 }, contains: "第 2 回合" },
  "action-declared": { ev: { type: "action-declared", side: "p1", moveId: "syn-strike" }, contains: "使出" },
  damage: { ev: { type: "damage", side: "p2", amount: 3 }, contains: "3 点伤害" },
  heal: { ev: { type: "heal", side: "p1", amount: 5 }, contains: "恢复" },
  "stat-stage": { ev: { type: "stat-stage", side: "p1", stat: "atk", deltaApplied: 1 }, contains: "+1" },
  "stages-transferred": { ev: { type: "stages-transferred", side: "p1" }, contains: "吸取" },
  "stages-cleared": { ev: { type: "stages-cleared", side: "p1" }, contains: "清除" },
  "effect-applied": { ev: { type: "effect-applied", side: "p1", name: "烧伤" }, contains: "「烧伤」" },
  "effect-faded": { ev: { type: "effect-faded", side: "p1", name: "烧伤" }, contains: "消退" },
  "control-immune": { ev: { type: "control-immune", side: "p1" }, contains: "免疫" },
  switch: { ev: { type: "switch", side: "p1" }, contains: "换人" },
  revive: { ev: { type: "revive", side: "p1" }, contains: "重新站" },
  "action-failed": { ev: { type: "action-failed", side: "p1" }, contains: "无法行动" },
  missed: { ev: { type: "missed", side: "p1", moveId: "syn-strike" }, contains: "没有命中" },
  protected: { ev: { type: "protected", side: "p1" }, contains: "保护" },
  "pp-delta": { ev: { type: "pp-delta", side: "p1", delta: 1, moveId: "secret-move" }, contains: "PP变化" },
  "struggle-used": { ev: { type: "struggle-used", side: "p1" }, contains: "挣扎" },
  ko: { ev: { type: "ko", side: "p1" }, contains: "倒下" },
  "battle-end": { ev: { type: "battle-end", reason: "ko" }, contains: "击倒" },
  soulmark: { ev: { type: "soulmark", side: "p1", name: "坚韧", mark: "sm-1", effect: "endure" }, contains: "保留了 1 点体力" },
};

describe("fmtEvent：每个公开类型一条播报夹具", () => {
  for (const type of PUBLIC_TYPES) {
    it(`"${type}" 有夹具且播报非空、无「?」`, () => {
      const fx = FIXTURES[type];
      expect(fx, `FIXTURES 缺 "${type}"——新增公开类型要补一条播报夹具`).toBeDefined();
      const line = fmt(fx!.ev);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain("「?」");
      expect(line).toContain(fx!.contains);
    });
  }

  it("pp-delta 夹具额外断言：脱敏——整句不得含 moveId", () => {
    const line = fmt(FIXTURES["pp-delta"]!.ev);
    expect(line).not.toContain("secret-move");
  });
});

describe("fmtEvent：行为锁（非覆盖率）", () => {
  it.each(["effect-applied", "effect-faded"] as const)("%s 播报 name，不播报 kind", (type) => {
    const line = fmt({ type, side: "p1", name: "烧伤", kind: "SHOULD_NOT_SHOW" });
    expect(line).toContain("烧伤");
    expect(line).not.toContain("SHOULD_NOT_SHOW");
  });

  it("pp-spent 仍返回空串（引擎私有事件，不要改成战报）", () => {
    expect(fmt({ type: "pp-spent" })).toBe("");
  });
});
