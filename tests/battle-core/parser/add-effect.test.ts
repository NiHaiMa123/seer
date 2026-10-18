/**
 * 一次加一条效果。步骤见 plans/add-effect.md。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect", () => {
  it("自身下次攻击造成的伤害提升60% → 一次 dmg_boost", () => {
    const next = parseEffectText("自身下次攻击造成的伤害提升60%") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 60, count: 1 } },
    ]);
    const old = parseEffectText("自身下次造成的伤害提升60%") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 60, count: 1 } },
    ]);
  });

  it("恢复对方精灵的全部体力 → 对手回满", () => {
    const foe = parseEffectText("恢复对方精灵的全部体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(foe.unparsed).toEqual([]);
    expect(foe.effects).toEqual([
      { op: "heal", numerator: 1, denominator: 1, target: "opponent" },
    ]);
    const self = parseEffectText("恢复自身全部体力") as { effects: unknown[] };
    expect(self.effects).toEqual([
      { op: "heal", numerator: 1, denominator: 1, target: "self" },
    ]);
  });

  it("对对方伤害的1/2恢复体力 → 吸取一半", () => {
    const foe = parseEffectText("对对方伤害的1/2恢复体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(foe.unparsed).toEqual([]);
    expect(foe.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
    const old = parseEffectText("造成伤害1/2恢复体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
  });

  it("令对手的技能先制-1 → 对手先制一直 -1", () => {
    const foe = parseEffectText("令对手的技能先制-1") as { effects: unknown[]; unparsed: unknown[] };
    expect(foe.unparsed).toEqual([]);
    expect(foe.effects).toEqual([
      { op: "apply_status", name: "prio_up", target: "opponent", params: { add: -1 } },
    ]);
    const timed = parseEffectText("对手下回合先制-2") as { effects: unknown[] };
    expect(timed.effects).toEqual([
      { op: "apply_status", name: "prio_up", target: "opponent", turns: 1, params: { add: -2 } },
    ]);
  });

  it("附加额外100点固定伤害 → 固伤 100", () => {
    const extra = parseEffectText("附加额外100点固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(extra.unparsed).toEqual([]);
    expect(extra.effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
    const old = parseEffectText("额外附加100点固定伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
  });

  it("恢复自身最大体力的1/3 → 回复三分之一", () => {
    const heal = parseEffectText("恢复自身最大体力的1/3") as { effects: unknown[]; unparsed: unknown[] };
    expect(heal.unparsed).toEqual([]);
    expect(heal.effects).toEqual([{ op: "heal", numerator: 1, denominator: 3, target: "self" }]);
    const old = parseEffectText("恢复自身最大体力的1/2体力") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "heal", numerator: 1, denominator: 2, target: "self" }]);
  });

  it("给敌方伤害的一半回复为己方体力 → 吸取一半", () => {
    const half = parseEffectText("给敌方伤害的一半回复为己方体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(half.unparsed).toEqual([]);
    expect(half.effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } },
    ]);
    const old = parseEffectText("给予对方伤害的一半会恢复自身体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } },
    ]);
  });

  it("直接攻击50%令对手冻伤 → 命中后 50% 冻伤", () => {
    const hit = parseEffectText("直接攻击50%令对手冻伤") as { effects: unknown[]; unparsed: unknown[] };
    expect(hit.unparsed).toEqual([]);
    expect(hit.effects).toEqual([
      { op: "applyAilmentOnHit", ailmentOnHit: { name: "frostbite", pct: 50 } },
    ]);
    const old = parseEffectText("每次攻击50%令对手冻伤") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "applyAilmentOnHit", ailmentOnHit: { name: "frostbite", pct: 50 } },
    ]);
  });

  it("对对方造成的1/2伤害恢复自身体力 → 吸取一半", () => {
    const drain = parseEffectText("对对方造成的1/2伤害恢复自身体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(drain.unparsed).toEqual([]);
    expect(drain.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
    const old = parseEffectText("对对方伤害的1/2恢复体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
  });

  it("自身受特攻伤害减半 → 特攻伤害减半", () => {
    const next = parseEffectText("自身受特攻伤害减半") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual((parseEffectText("受到特攻伤害减半") as { effects: unknown[] }).effects);
  });

  it("令对手当回合体力恢复效果减少99% → 当回合减疗", () => {
    const next = parseEffectText("令对手当回合体力恢复效果减少99%") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "heal_cut", target: "opponent", turns: 1, params: { pct: 99 } },
    ]);
    const old = parseEffectText("令对手体力恢复效果减少50%") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "heal_cut", target: "opponent", params: { pct: 50 } },
    ]);
  });

  it("固定加上20点固定伤害 → 固伤 20", () => {
    const next = parseEffectText("固定加上20点固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual((parseEffectText("附加20点固定伤害") as { effects: unknown[] }).effects);
  });

  it("10%加150点固定伤害 → 10% 固伤 150", () => {
    const next = parseEffectText("10%加150点固定伤害") as { effects: unknown[]; unparsed: unknown[]; flags?: unknown };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "flat", of: "flatBonus", value: 150 },
      { op: "flat", of: "flatChance", value: 10 },
    ]);
    expect(next.flags).toEqual({});
  });

  it("消耗自身的护盾并附加等量的固定伤害 → 护盾转固伤", () => {
    const next = parseEffectText("消耗自身的护盾并附加等量的固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual((parseEffectText("消耗自身护盾并造成等量固定伤害") as { effects: unknown[] }).effects);
  });

  it("受到的所有类型伤害的1/2转化为自身体力 → 一半伤转回复", () => {
    const next = parseEffectText("受到的所有类型伤害的1/2转化为自身体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 2 } },
    ]);
    const old = parseEffectText("受到伤害的30%转化为自身体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "dmg_to_heal", target: "self", params: { pct: 30 } },
    ]);
  });

  it("容让对手受到50点固定伤害 → 对敌固伤 50", () => {
    const next = parseEffectText("容让对手受到50点固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "damage", kind: "fixed", power: 50, target: "opponent" },
    ]);
    const old = parseEffectText("令对手受到50点固定伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "damage", kind: "fixed", power: 50, target: "opponent" },
    ]);
  });

  it("3回合攻击命中40%烧伤 → 三回合 40% 烧伤", () => {
    const next = parseEffectText("3回合攻击命中40%烧伤") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "burn", target: "opponent", chance: 40, turns: 3 },
    ]);
    const old = parseEffectText("40%烧伤") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "burn", target: "opponent", chance: 40 },
    ]);
  });

  it("自身不会被弱化 → 免疫弱化", () => {
    const next = parseEffectText("自身不会被弱化") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self" },
    ]);
    const old = parseEffectText("不会能力下降") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self" },
    ]);
  });

  it("必定会心一击 → 本招必暴", () => {
    const next = parseEffectText("必定会心一击") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "crit", of: "crit", value: true }]);
    const old = parseEffectText("必定致命一击") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "crit", of: "crit", value: true }]);
  });

  it("下2回合必定先手必定致命 → 先制+3窗 与 必暴窗", () => {
    const next = parseEffectText("下2回合必定先手必定致命") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "prio_up", target: "self", turns: 2, params: { add: 3 } },
      { op: "apply_status", name: "crit_always", target: "self", turns: 2 },
    ]);
    const old = parseEffectText("必定先手") as { flags: unknown };
    expect(old.flags).toEqual({ priority: 3 });
  });

  it("3回合免疫异常且不会能力下降 → 免异常+免弱化双窗", () => {
    const next = parseEffectText("3回合免疫异常且不会能力下降") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", turns: 3 },
      { op: "apply_status", name: "immune_degrade", target: "self", turns: 3 },
    ]);
    const old = parseEffectText("免疫异常状态和能力下降") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self" },
      { op: "apply_status", name: "immune_degrade", target: "self" },
    ]);
  });

  it("直接造成100点固定伤害 → 固伤 100", () => {
    const next = parseEffectText("直接造成100点固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
    const old = parseEffectText("造成100点固定伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
  });

  it("自身所受特殊攻击伤害减半 → 特攻伤害减半", () => {
    const next = parseEffectText("自身所受特殊攻击伤害减半") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "spec_half", target: "self", params: { cat: 3, n: 1, d: 2 } },
    ]);
    const old = parseEffectText("自身受到特殊攻击伤害减半") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "spec_half", target: "self", params: { cat: 3, n: 1, d: 2 } },
    ]);
  });

  it("1回合对手用技能无法恢复HP → 对手封疗1回合", () => {
    const next = parseEffectText("1回合对手用技能无法恢复HP") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "heal_block", target: "opponent", turns: 1 },
    ]);
    const old = parseEffectText("令对手无法恢复HP") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "heal_block", target: "opponent", turns: 1 },
    ]);
  });

  it("5回合每回合回1/3HP → 每回合回1/3", () => {
    const next = parseEffectText("5回合每回合回1/3HP") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 3 }, turns: 5 },
    ]);
    const old = parseEffectText("每回合恢复1/3体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 3 } },
    ]);
  });

  it("恢复自身HP1/4 → 回复四分之一", () => {
    const next = parseEffectText("恢复自身HP1/4") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "heal", numerator: 1, denominator: 4, target: "self" }]);
    const old = parseEffectText("恢复自身1/4体力") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "heal", numerator: 1, denominator: 4, target: "self" }]);
  });

  it("2回合内受伤减少100 → 定额承伤减免窗", () => {
    const next = parseEffectText("2回合内受伤减少100") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 100 }, turns: 2 },
    ]);
    const old = parseEffectText("受到的伤害减少50点") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 50 } },
    ]);
  });

  it("使对手随即进入1种异常状态 → 随机异常一种", () => {
    const next = parseEffectText("使对手随即进入1种异常状态") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual((parseEffectText("使对手随机进入1种异常状态") as { effects: unknown[] }).effects);
    const old = parseEffectText("使对手随机进入1种异常状态") as { effects: Array<{ op: string; name?: string; random?: { count: number }; target?: string }> };
    expect(old.effects[0]!.op).toBe("apply_status");
    expect(old.effects[0]!.name).toBe("random");
    expect(old.effects[0]!.random?.count).toBe(1);
    expect(old.effects[0]!.target).toBe("opponent");
  });

  it("对手无法处于能力强化状态 → 对手禁强化", () => {
    const next = parseEffectText("对手无法处于能力强化状态") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "no_stage_up", target: "opponent" },
    ]);
    const old = parseEffectText("令对手无法处于能力强化状态") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "no_stage_up", target: "opponent" },
    ]);
  });

  it("直接攻击造成伤害的20%回体 → 吸取 1/5", () => {
    const next = parseEffectText("直接攻击造成伤害的20%回体") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 20, denominator: 100 } },
    ]);
    const old = parseEffectText("攻击造成伤害的20%恢复体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 20, denominator: 100 } },
    ]);
  });

  it("3回合免疫暴击 → 免暴击窗", () => {
    const next = parseEffectText("3回合免疫暴击") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "crit_immune", target: "self", turns: 3 },
    ]);
    const old = parseEffectText("免疫致命一击") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "crit_immune", target: "self" },
    ]);
  });

  it("必定造成双倍伤害 → 伤害 ×2", () => {
    const next = parseEffectText("必定造成双倍伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "scale", of: "mul", value: { numerator: 2, denominator: 1 } },
    ]);
    const old = parseEffectText("造成双倍伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "scale", of: "mul", value: { numerator: 2, denominator: 1 } },
    ]);
  });

  it("攻击对象要害慨率增加1/16 → 要害率 +1/16", () => {
    const next = parseEffectText("攻击对象要害慨率增加1/16") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
    const old = parseEffectText("攻击击中对方要害的概率增加1/16") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
  });

  it("对方所有强化消失 → 清对手强化", () => {
    const next = parseEffectText("对方所有强化消失") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
    const old = parseEffectText("令对手能力增强效果消失") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
  });

  it("2回合内受到伤害反弹100点固定伤害 → 定额反伤窗", () => {
    const next = parseEffectText("2回合内受到伤害反弹100点固定伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "counter", target: "self", params: { flat: 100 }, turns: 2 },
    ]);
    const old = parseEffectText("反弹100点固定伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "counter", target: "self", params: { flat: 100 } },
    ]);
  });

  it("每次增加20，最高165 → 每次威力+20 上限165", () => {
    const next = parseEffectText("每次增加20，最高165") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "power", of: "powerPerUse", value: 20 },
      { op: "power", of: "useCap", value: 165 },
    ]);
    const old = parseEffectText("每次使用增加20，最高165") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "power", of: "powerPerUse", value: 20 },
      { op: "power", of: "useCap", value: 165 },
    ]);
  });

  it("物攻伤害减半 → 物理伤害减半", () => {
    const next = parseEffectText("物攻伤害减半") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "phys_half", target: "self" },
    ]);
    const old = parseEffectText("受到物攻伤害减半") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "phys_half", target: "self" },
    ]);
  });

  it("2回合每回合减伤害110 → 每回合定额减免窗", () => {
    const next = parseEffectText("2回合每回合减伤害110") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 110 }, turns: 2 },
    ]);
    const old = parseEffectText("每回合受到的伤害减少110点") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 110 } },
    ]);
  });

  it("对方能力强化转移给自己 → 偷取对手强化", () => {
    const next = parseEffectText("对方能力强化转移给自己") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "transfer_stages", direction: "steal", sign: "up" }]);
    const old = parseEffectText("将对手能力提升状态转移给自己") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "transfer_stages", direction: "steal", sign: "up" }]);
  });

  it("能力下降状态反馈给对方 → 弱化推给对手", () => {
    const next = parseEffectText("能力下降状态反馈给对方") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "transfer_stages", direction: "push" }]);
    const old = parseEffectText("将自身能力下降状态反馈给对手") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "transfer_stages", direction: "push" }]);
  });

  it("体力少于1/3先制+2 → 条件先制", () => {
    const next = parseEffectText("体力少于1/3先制+2") as { flags: unknown; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.flags).toEqual({
      priorityIf: { when: { selfHpBelow: { numerator: 1, denominator: 3 } }, add: 2 },
    });
    const old = parseEffectText("体力低于1/3时先制+2") as { flags: unknown };
    expect(old.flags).toEqual({
      priorityIf: { when: { selfHpBelow: { numerator: 1, denominator: 3 } }, add: 2 },
    });
  });

  it("自身处于能力强化状态先制+2 → 强化态先制", () => {
    const next = parseEffectText("自身处于能力强化状态先制+2") as { flags: unknown; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.flags).toEqual({
      priorityIf: { when: { selfStageUp: true }, add: 2 },
    });
    const old = parseEffectText("自身处于护盾状态下先制+2") as { flags: unknown };
    expect(old.flags).toEqual({
      priorityIf: { when: { selfHas: "shield" }, add: 2 },
    });
  });

  it("若对手体力低于280则必定秒杀 → 阈值秒杀", () => {
    const next = parseEffectText("若对手体力低于280则必定秒杀") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 280 } },
    ]);
    const old = parseEffectText("若对手体力低于280则秒杀") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 280 } },
    ]);
  });

  it("3回合直接攻击附带80%烧伤 → 命中附加 80% 烧伤", () => {
    const next = parseEffectText("3回合直接攻击附带80%烧伤") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "applyAilmentOnHit", ailmentOnHit: { name: "burn", pct: 80 } },
    ]);
    const old = parseEffectText("直接攻击80%令对手烧伤") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "applyAilmentOnHit", ailmentOnHit: { name: "burn", pct: 80 } },
    ]);
  });

  it("恢复自身pp1点 → 回 1 点 PP", () => {
    const next = parseEffectText("恢复自身pp1点") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "pp_delta", amount: 1, target: "self" }]);
    const old = parseEffectText("恢复自身1点PP值") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "pp_delta", amount: 1, target: "self" }]);
  });

  it("2回合内每回合造成的攻击伤害提升50% → 出伤提升窗", () => {
    const next = parseEffectText("2回合内每回合造成的攻击伤害提升50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 }, turns: 2 },
    ]);
    const old = parseEffectText("每回合造成攻击伤害减少50%") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: -50 } },
    ]);
  });

  it("3回合自身能力不受影响 → 免弱化窗", () => {
    const next = parseEffectText("3回合自身能力不受影响") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self", turns: 3 },
    ]);
    const old = parseEffectText("自身不会被弱化") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self" },
    ]);
  });

  it("双防额外+2 → 防御特防各+2", () => {
    const next = parseEffectText("双防额外+2") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: 2, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 2, target: "self" },
    ]);
    const old = parseEffectText("双防+2") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: 2, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 2, target: "self" },
    ]);
  });

  it("自身攻击无视对手护盾 → 本招穿盾", () => {
    const next = parseEffectText("自身攻击无视对手护盾") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "strike", of: "pierceShield", value: true }]);
    const old = parseEffectText("无视对手护盾效果") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "strike", of: "pierce", value: true }]);
  });

  it("随机自身3属性+1 → 随机三维+1", () => {
    const next = parseEffectText("随机自身3属性+1") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "apply_stat_stage", stat: "random", randomCount: 3, delta: 1, target: "self" },
    ]);
    const old = parseEffectText("令自身随机2项属性+1") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "apply_stat_stage", stat: "random", randomCount: 2, delta: 1, target: "self" },
    ]);
  });

  it("若体力不足300则剩1点 → 自损留 1 点", () => {
    const next = parseEffectText("若体力不足300则剩1点") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self", if: { selfHpBelowAbs: 300 } },
      { op: "cap", of: "leaveHp", value: 1 },
    ]);
    const old = parseEffectText("若自身体力不足300则剩下1点体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self", if: { selfHpBelowAbs: 300 } },
      { op: "cap", of: "leaveHp", value: 1 },
    ]);
  });

  it("损失1/3HP → 自损三分之一", () => {
    const next = parseEffectText("损失1/3HP") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "damage", power: 0, kind: "percent", target: "self" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
    ]);
    const old = parseEffectText("损失1/3体力") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "damage", power: 0, kind: "percent", target: "self" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
    ]);
  });
});
