/**
 * 一个已经迁完的回合窗名字：解析器发 periodic，旧名再出现则编译检查拒。
 * 状态名门与 tools/effects-compile-check.ts 的 UNKNOWN_STATUS 是同一条：name 不在 EFFECT_DEFS。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { EFFECT_DEFS } from "../../../packages/battle-core/src/ops/effects.ts";
import { effectKeyHits, loadIrAllow } from "../../../tools/ir-keys.ts";
import { paramKeyHits, paramKeysFromRepo } from "../../../tools/effect-param-readers.ts";

const SHAPE = {
  op: "apply_status",
  name: "periodic",
  target: "self",
  params: { win: 19 },
  payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }],
};

describe("transfer_down_tick 收到 periodic", () => {
  it("三条句子都发原来的转移窗，键落在已有清单里", () => {
    for (const text of [
      "每回合自身的能力下降状态都会转移到对手身上",
      "每回合将自身能力下降状态转移给对手",
      "自身的能力下降状态每回合转移给对手",
    ]) {
      const got = (parseEffectText(text) as { effects: unknown[] }).effects;
      expect(got).toEqual([SHAPE]);
    }
    expect(effectKeyHits([SHAPE], loadIrAllow())).toEqual([]);
    expect(paramKeyHits([SHAPE], paramKeysFromRepo())).toEqual([]);
  });

  it("旧名不在 EFFECT_DEFS，编译检查会把它当成未知状态", () => {
    expect("transfer_down_tick" in EFFECT_DEFS).toBe(false);
    const stale = [{ op: "apply_status", name: "transfer_down_tick", target: "self" }];
    const unknown = stale.filter((e) => !(e.name in EFFECT_DEFS));
    expect(unknown.map((e) => e.name)).toEqual(["transfer_down_tick"]);
  });
});

const AIL = {
  op: "apply_status",
  name: "periodic",
  target: "self",
  params: { win: 15 },
  payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }],
};

describe("cleanse_self_ail 收到 periodic", () => {
  it("四条句子都发原来的自解异常窗，键落在已有清单里", () => {
    for (const text of [
      "回合结束后解除自身异常状态",
      "回合结束时解除自身所有异常状态",
      "每回合解除自身所有异常状态",
      "每回合解除自身异常状态",
    ]) {
      const got = (parseEffectText(text) as { effects: unknown[] }).effects;
      expect(got).toEqual([AIL]);
    }
    expect(effectKeyHits([AIL], loadIrAllow())).toEqual([]);
    expect(paramKeyHits([AIL], paramKeysFromRepo())).toEqual([]);
  });

  it("旧名不在 EFFECT_DEFS，编译检查会把它当成未知状态", () => {
    expect("cleanse_self_ail" in EFFECT_DEFS).toBe(false);
    const stale = [{ op: "apply_status", name: "cleanse_self_ail", target: "self" }];
    expect(stale.filter((e) => !(e.name in EFFECT_DEFS)).map((e) => e.name)).toEqual(["cleanse_self_ail"]);
  });
});

const UP = {
  op: "apply_status",
  name: "periodic",
  target: "self",
  params: { win: 14 },
  payload: [{ op: "clear_stages", target: "opponent", sign: "up", plain: true }],
};

describe("cleanse_up_tick 收到 periodic", () => {
  it("三条句子都发原来的消强化窗，键落在已有清单里", () => {
    for (const text of [
      "每回合消除对手能力提升状态",
      "每回合自身技能消除对手能力强化状态",
      "每回合消除对方的能力提升状态",
    ]) {
      const got = (parseEffectText(text) as { effects: unknown[] }).effects;
      expect(got).toEqual([UP]);
    }
    expect(effectKeyHits([UP], loadIrAllow())).toEqual([]);
    expect(paramKeyHits([UP], paramKeysFromRepo())).toEqual([]);
  });

  it("旧名不在 EFFECT_DEFS，编译检查会把它当成未知状态", () => {
    expect("cleanse_up_tick" in EFFECT_DEFS).toBe(false);
    const stale = [{ op: "apply_status", name: "cleanse_up_tick", target: "self" }];
    expect(stale.filter((e) => !(e.name in EFFECT_DEFS)).map((e) => e.name)).toEqual(["cleanse_up_tick"]);
  });
});

const REST: { name: string; text: string; effects: unknown[] }[] = [
  { name: "stage_tick", text: "每回合攻击等级+1", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 6 }, payload: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", plain: true }] }] },
  { name: "pp_tick", text: "每回合恢复自身所有技能2点PP值", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 7 }, payload: [{ op: "pp_delta", target: "self", scope: "all", amount: 2, plain: true }] }] },
  { name: "prio_push_tick", text: "每回合都使对手的先制-1", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 8 }, payload: [{ op: "apply_status", name: "prio_up", target: "opponent", stack: true, params: { add: -1 } }] }] },
  { name: "steal_stages_tick", text: "每回合吸取对手能力提升状态", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 10 }, payload: [{ op: "transfer_stages", sign: "up", plain: true, noHooks: true }] }] },
  { name: "steal_rand_tick", text: "每回合使对手1项能力值-1并附加到自身", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 11 }, payload: [{ op: "transfer_stages", randomCount: 1, randomDelta: 1, plain: true, noHooks: true }] }] },
  { name: "cleanse_down_tick", text: "每回合解除自身能力下降状态", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 12 }, payload: [{ op: "clear_stages", target: "self", sign: "down", plain: true, noHooks: true }] }] },
  { name: "down_push_tick", text: "每回合解除自身能力下降状态并附加给对手相同的能力下降状态", effects: [{ op: "apply_status", name: "periodic", target: "self", turns: 1, params: { win: 12 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }] }] },
  { name: "ailment_tick", text: "每回合令对手害怕", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 16, foeAlive: 1 }, payload: [{ op: "apply_status", name: "fear", target: "opponent" }] }] },
  { name: "pp_zero_tick", text: "每回合使对手随机1个技能PP归零", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 16, foeAlive: 1 }, payload: [{ op: "pp_delta", zeroRandom: 1, target: "opponent" }] }] },
  { name: "dealt_tick", text: "回合结束时附加100%伤害量的固定伤害", effects: [{ op: "apply_status", name: "periodic", target: "self", params: { win: 17, foeAlive: 1 }, payload: [{ op: "hp_delta", target: "opponent", kind: "fixed", ofSelfDealt: { numerator: 100, denominator: 100 }, if: { selfDealtAboveAbs: 1 } }] }] },
  { name: "maxhp_tick", text: "每回合减少对手最大体力的1/4", effects: [{ op: "apply_status", name: "periodic", target: "opponent", params: { win: 20 }, payload: [{ op: "apply_status", name: "max_hp_down", target: "opponent", accFlat: true, params: { fracFoeMaxHpN: 1, fracFoeMaxHpD: 4 } }] }] },
];

describe("其余 *_tick 收到 periodic", () => {
  it("每条句子都发原来的窗口，键落在已有清单里", () => {
    const allow = loadIrAllow();
    const params = paramKeysFromRepo();
    for (const row of REST) {
      const got = (parseEffectText(row.text) as { effects: unknown[] }).effects;
      expect(got, row.text).toEqual(row.effects);
      expect(effectKeyHits(got, allow), row.text).toEqual([]);
      expect(paramKeyHits(got, params), row.text).toEqual([]);
    }
  });

  it("旧名不在 EFFECT_DEFS，编译检查会把它们当成未知状态", () => {
    const names = [...REST.map((r) => r.name), "cleanse_foe_tick"];
    expect(names.filter((n) => n in EFFECT_DEFS)).toEqual([]);
    const stale = names.map((name) => ({ op: "apply_status", name, target: "self" }));
    expect(stale.filter((e) => !(e.name in EFFECT_DEFS)).map((e) => e.name)).toEqual(names);
  });
});
