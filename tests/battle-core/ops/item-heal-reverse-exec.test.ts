/**
 * item_heal_reverse 的**结算级**验证。
 *
 * 解析出字段不等于生效 —— items 的 planAction 必须真的把 heal 换成 hp_delta。
 * 这里直接调 itemsMechanic.planAction，用带 item_heal_reverse 的单位验证。
 */
import { describe, it, expect } from "vitest";
import { loadPackFromDir } from "@seer/battle-core";
import { itemsMechanic } from "../../../packages/battle-core/src/mechanics/items/index.ts";
import { join } from "node:path";

const PACK = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v2");

const mkUnit = (effects: unknown[] = [], hp = 100) => ({
  unitId: "u1",
  base: { hp: 400, atk: 100, def: 100, spa: 100, sdf: 100, spd: 100 },
  currentHp: hp,
  stages: {},
  effects,
});

const mkCtx = (unit: ReturnType<typeof mkUnit>) => ({
  pack: PACK,
  side: "p1",
  actionId: "act_item-hp-200",
  state: {
    sides: {
      p1: { unit, bench: [], stocks: { "hp-200": 2 } },
      p2: { unit: mkUnit(), bench: [], stocks: {} },
    },
  },
});

describe("hp 药剂的结算", () => {
  it("无状态 → heal 200", () => {
    const unit = mkUnit();
    const out = itemsMechanic.planAction!(mkCtx(unit) as never) as { op: string; flat?: number }[];
    expect(out).toBeDefined();
    const heal = out.find((e) => e.op === "heal");
    expect(heal?.flat).toBe(200);
  });

  it("带 item_heal_reverse → 变成 hp_delta（等量固定伤害）", () => {
    // 当前体力 300 > heal 200，反转量应完整取 200
    const unit = mkUnit([{ kind: "modifier", at: "itemHealReverse", params: {} }], 300);
    const out = itemsMechanic.planAction!(mkCtx(unit) as never) as { op: string; flat?: number }[];
    expect(out).toBeDefined();
    expect(out.some((e) => e.op === "heal")).toBe(false);
    const dmg = out.find((e) => e.op === "hp_delta");
    expect(dmg?.flat).toBe(200);
  });

  it("反转量不超过当前体力（不会扣成负数）", () => {
    const unit = mkUnit([{ kind: "modifier", at: "itemHealReverse", params: {} }], 50);
    const out = itemsMechanic.planAction!(mkCtx(unit) as never) as { op: string; flat?: number }[];
    const dmg = out.find((e) => e.op === "hp_delta");
    expect(dmg?.flat).toBe(50);
  });
});