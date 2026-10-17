/**
 * p1：技能家族（ailment/clear/attach-damage/attach-all）一次加一条。步骤见 plans/add-effect.md。
 * 新 id 全部以 p1- 开头，不放 tests/fixtures/effects-rule-order.json。
 * 每条断言同时锁住被改窄规则放出来的那条旧句子，证明没有截走。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

const go = (s: string) => parseEffectText(s) as { effects: unknown[]; unparsed: unknown[] };

describe("add one effect (p1: 让字等级句式)", () => {
  it("让对方防御等级-2 → 对手防御 -2", () => {
    expect(go("让对方防御等级-2").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -2, target: "opponent" },
    ]);
  });
  it("50%让对方速度等级-1 → 对手速度 -1 + chance", () => {
    expect(go("50%让对方速度等级-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", chance: 50 },
    ]);
  });
  it("旧句不变：使对方防御等级-2（ailment-07）", () => {
    expect(go("使对方防御等级-2").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -2, target: "opponent" },
    ]);
  });
  it("旧句不变：50%使对方速度等级-1（ailment-07）", () => {
    expect(go("50%使对方速度等级-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", chance: 50 },
    ]);
  });
});

describe("add one effect (p1: 解除自身所有能力下降)", () => {
  it("解除自身所有的能力下降状态 → clear_stages self/down", () => {
    expect(go("解除自身所有的能力下降状态").effects).toEqual([
      { op: "clear_stages", target: "self", sign: "down" },
    ]);
  });
  it("旧句不变：解除自身的能力下降状态（clear-03）", () => {
    expect(go("解除自身的能力下降状态").effects).toEqual([
      { op: "clear_stages", target: "self", sign: "down" },
    ]);
  });
});

describe("add one effect (p1: 提升效果尾词)", () => {
  it("反转对手能力提升效果 → invert up", () => {
    expect(go("反转对手能力提升效果").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
  it("旧句不变：反转对手能力提升状态（clear-06）", () => {
    expect(go("反转对手能力提升状态").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
});

describe("add one effect (p1: 视为能力下降)", () => {
  it("将其能力提升状态视为相应的能力下降状态 → invert up", () => {
    expect(go("将其能力提升状态视为相应的能力下降状态").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
  it("将对手能力提升状态视为相应能力下降状态（省「的」）→ invert up", () => {
    expect(go("将对手能力提升状态视为相应能力下降状态").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
  it("旧句不变：将对手能力提升状态视为相应的能力下降状态（attach-damage-76）", () => {
    expect(go("将对手能力提升状态视为相应的能力下降状态").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
  });
});

describe("add one effect (p1: 侧词变体)", () => {
  it("无视对方伤害限制效果 → pierce", () => {
    expect(go("无视对方伤害限制效果").effects).toEqual([
      { op: "strike", of: "pierce", value: true },
    ]);
  });
  it("旧句不变：无视对手伤害限制效果（attach-all-08）", () => {
    expect(go("无视对手伤害限制效果").effects).toEqual([
      { op: "strike", of: "pierce", value: true },
    ]);
  });
  it("为自己创造1个可以吸收500点伤害的护盾 → shield 500 count 1", () => {
    expect(go("为自己创造1个可以吸收500点伤害的护盾").effects).toEqual([
      { op: "apply_status", name: "shield", target: "self", params: { flat: 500, count: 1 } },
    ]);
  });
  it("旧句不变：为自身创造1个可以吸收500点伤害的护盾（attach-damage-92）", () => {
    expect(go("为自身创造1个可以吸收500点伤害的护盾").effects).toEqual([
      { op: "apply_status", name: "shield", target: "self", params: { flat: 500, count: 1 } },
    ]);
  });
});

describe("add one effect (p1: 固伤翻倍/双防固伤)", () => {
  it("造成固伤翻倍 → flatDouble", () => {
    expect(go("造成固伤翻倍").effects).toEqual([{ op: "flat", of: "flatMul", value: { numerator: 2, denominator: 1 } }]);
  });
  it("旧句不变：固伤翻倍（penalty-17）", () => {
    expect(go("固伤翻倍").effects).toEqual([{ op: "flat", of: "flatMul", value: { numerator: 2, denominator: 1 } }]);
  });
  it("旧句不变：固定伤害翻倍（penalty-17）", () => {
    expect(go("固定伤害翻倍").effects).toEqual([{ op: "flat", of: "flatMul", value: { numerator: 2, denominator: 1 } }]);
  });
  it("附加对手防御值与特防值之和10%的固定伤害 → 双防 10%", () => {
    expect(go("附加对手防御值与特防值之和10%的固定伤害").effects).toEqual([
      { op: "flat", of: "flatFoeStatPct", value: { stats: ["def", "sdf"], pct: 10 } },
    ]);
  });
  it("附加对手特防值的固定伤害 → 特防 100%", () => {
    expect(go("附加对手特防值的固定伤害").effects).toEqual([
      { op: "flat", of: "flatFoeStatPct", value: { stats: ["sdf"], pct: 100 } },
    ]);
  });
  it("附加对手防御值的固伤 → 防御 100%", () => {
    expect(go("附加对手防御值的固伤").effects).toEqual([
      { op: "flat", of: "flatFoeStatPct", value: { stats: ["def"], pct: 100 } },
    ]);
  });
});

describe("add one effect (p1: 整句无残留)", () => {
  it("分裂两句仍可整体通过", () => {
    const r = parseEffectText("先制+3；让对方防御等级-2") as { unparsed: unknown[] };
    expect(r.unparsed).toEqual([]);
  });
});

describe("add one effect (p1: 先手威力倍率)", () => {
  it("先出手技能威力2倍 → scaleIf first ×2", () => {
    expect(go("先出手技能威力2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("先出手的威力2倍 → scaleIf first ×2", () => {
    expect(go("先出手的威力2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("先出招威力加倍 → scaleIf first ×2", () => {
    expect(go("先出招威力加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("先手加倍/先手2倍 → scaleIf first ×2", () => {
    const expectFx = [{ op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } }];
    expect(go("先手加倍").effects).toEqual(expectFx);
    expect(go("先手2倍").effects).toEqual(expectFx);
  });
  it("旧句不变：先出手威力2倍（batch-e5c-52）", () => {
    expect(go("先出手威力2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：先手威力翻倍（attach-all-15/batch-e6-189）", () => {
    expect(go("先手威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });
});

describe("add one effect (p1: 自身HP阈值威力)", () => {
  it("体力低于1/4威力翻倍 → selfHpBelow 1/4 ×2", () => {
    expect(go("体力低于1/4威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 4 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("HP低于1/3威力翻倍 → selfHpBelow 1/3 ×2", () => {
    expect(go("HP低于1/3威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 3 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("自身HP小于1/2为2倍 → selfHpBelow 1/2 ×2", () => {
    expect(go("自身HP小于1/2为2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：自身HP低于1/2威力翻倍（batch-e5g-05）", () => {
    expect(go("自身HP低于1/2威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
});

describe("add one effect (p1: 对方HP阈值威力)", () => {
  it("对方体力少于一半时威力加倍 → foeHpBelow 1/2 ×2", () => {
    expect(go("对方体力少于一半时威力加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { foeHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("对手少于一半血威力加倍 → foeHpBelow 1/2 ×2", () => {
    expect(go("对手少于一半血威力加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { foeHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：对方体力少于1/2时威力加倍（attach-all-19）", () => {
    expect(go("对方体力少于1/2时威力加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { foeHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
});

describe("add one effect (p1: 先制等级/解除弱化)", () => {
  it("先制等级+1 → priority 1", () => {
    expect((parseEffectText("先制等级+1") as { flags: unknown }).flags).toEqual({ priority: 1 });
  });
  it("先制等级-2 → priority -2", () => {
    expect((parseEffectText("先制等级-2") as { flags: unknown }).flags).toEqual({ priority: -2 });
  });
  it("旧句不变：先制+1（flags-02）", () => {
    expect((parseEffectText("先制+1") as { flags: unknown }).flags).toEqual({ priority: 1 });
  });
  it("解除弱化状态 → clear_stages self/down", () => {
    expect(go("解除弱化状态").effects).toEqual([{ op: "clear_stages", target: "self", sign: "down" }]);
  });
  it("旧句不变：解除弱化（batch-e5b-13）", () => {
    expect(go("解除弱化").effects).toEqual([{ op: "clear_stages", target: "self", sign: "down" }]);
  });
  it("消除对手所有强化状态 → clear_stages opponent/up", () => {
    expect(go("消除对手所有强化状态").effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
  });
  it("旧句不变：消除对手能力提升状态（clear-01）", () => {
    expect(go("消除对手能力提升状态").effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
  });
});

describe("add one effect (p1: 锁强化/反射窗口/属性技无效)", () => {
  it("对手无法使用自身能力提升状态 → no_stage_up", () => {
    expect(go("对手无法使用自身能力提升状态").effects).toEqual([
      { op: "apply_status", name: "no_stage_up", target: "opponent" },
    ]);
  });
  it("旧句不变：对手无法使自身能力提升（batch-e5c-09）", () => {
    expect(go("对手无法使自身能力提升").effects).toEqual([
      { op: "apply_status", name: "no_stage_up", target: "opponent" },
    ]);
  });
  it("将下一次受到的伤害100%反馈给对手 → reflect_dmg count 1", () => {
    expect(go("将下一次受到的伤害100%反馈给对手").effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 100, d: 100, count: 1 } },
    ]);
  });
  it("旧句不变：将下次受到的伤害100%反馈给对手（batch-e5c-46）", () => {
    expect(go("将下次受到的伤害100%反馈给对手").effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 100, d: 100, count: 1 } },
    ]);
  });
  it("对方用的属性技能无效果 → status_lock cat1", () => {
    expect(go("对方用的属性技能无效果").effects).toEqual([
      { op: "apply_status", name: "status_lock", target: "opponent", params: { cat: 1 } },
    ]);
  });
  it("旧句不变：对方属性技能无效（heal-20）", () => {
    expect(go("对方属性技能无效").effects).toEqual([
      { op: "apply_status", name: "status_lock", target: "opponent", turns: 1, params: { cat: 1 } },
    ]);
  });
});

describe("add one effect (p1: 命中回血/要害概率/异常状态威力)", () => {
  it("每次攻击恢复自身1/4体力 → healOnHit 1/4", () => {
    expect(go("每次攻击恢复自身1/4体力").effects).toEqual([
      { op: "applyHealOnHit", healOnHit: { numerator: 1, denominator: 4 } },
    ]);
  });
  it("旧句不变：每次攻击回复自身最大体力的1/3（batch-e5c-61）", () => {
    expect(go("每次攻击回复自身最大体力的1/3").effects).toEqual([
      { op: "applyHealOnHit", healOnHit: { numerator: 1, denominator: 3 } },
    ]);
  });
  it("攻击击中目标要害概率增加1/16 → crit_up 1/16", () => {
    expect(go("攻击击中目标要害概率增加1/16").effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
  });
  it("攻击致命一击率增加1/16 → crit_up 1/16", () => {
    expect(go("攻击致命一击率增加1/16").effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
  });
  it("旧句不变：攻击击中对手要害的概率增加1/16（batch-e5d-02）", () => {
    expect(go("攻击击中对手要害的概率增加1/16").effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
  });
  it("旧句不变：致命一击率增加1/16（batch-e6-223）", () => {
    expect(go("致命一击率增加1/16").effects).toEqual([
      { op: "apply_status", name: "crit_up", target: "self", params: { n: 1, d: 16 } },
    ]);
  });
  it("对手处于烧伤状态下威力翻倍 → scaleIf foeStatused ×2", () => {
    expect(go("对手处于烧伤状态下威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { foeStatused: true }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：对手处于异常状态时威力加倍（attach-all-20）", () => {
    expect(go("对手处于异常状态时威力加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { foeStatused: true }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("对方所有能力增强状态消失 → clear_stages opponent/up", () => {
    expect(go("对方所有能力增强状态消失").effects).toEqual([
      { op: "clear_stages", sign: "up", target: "opponent" },
    ]);
  });
  it("旧句不变：对方所有能力增强效果消失（attach-damage-42）", () => {
    expect(go("对方所有能力增强效果消失").effects).toEqual([
      { op: "clear_stages", sign: "up", target: "opponent" },
    ]);
  });
});

describe("add one effect (p1: 已损失体力/最大体力固伤)", () => {
  it("附加自身已损失体力的70%的固定伤害 → flatSelfFrac missing 70%", () => {
    expect(go("附加自身已损失体力的70%的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfFrac", value: { numerator: 70, denominator: 100, base: "missing" } },
    ]);
  });
  it("附加自身已损失体力的固定伤害 → flatSelfFrac missing 100%", () => {
    expect(go("附加自身已损失体力的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfFrac", value: { numerator: 100, denominator: 100, base: "missing" } },
    ]);
  });
  it("旧句不变：附加自身已损失体力70%的固定伤害（timed-37）", () => {
    expect(go("附加自身已损失体力70%的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfFrac", value: { numerator: 70, denominator: 100, base: "missing" } },
    ]);
  });
  it("附加相当于自身最大体力30%的固定伤害 → flatSelfPct 30", () => {
    expect(go("附加相当于自身最大体力30%的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfPct", value: 30 },
    ]);
  });
  it("旧句不变：附加自身最大体力30%的固定伤害（heal-61）", () => {
    expect(go("附加自身最大体力30%的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfPct", value: 30 },
    ]);
  });
  it("每次受到攻击对手命中-2 → react trigger1", () => {
    expect(go("每次受到攻击对手命中-2").effects).toEqual([
      { op: "apply_status", name: "react", target: "self", params: { trigger: 1 }, payload: [{ op: "apply_stat_stage", stat: "acc", delta: -2, target: "opponent" }] },
    ]);
  });
  it("旧句不变：受到攻击对手命中-2（heal-83）", () => {
    expect(go("受到攻击对手命中-2").effects).toEqual([
      { op: "apply_status", name: "react", target: "self", params: { trigger: 1 }, payload: [{ op: "apply_stat_stage", stat: "acc", delta: -2, target: "opponent" }] },
    ]);
  });
});

describe("add one effect (p1: 必定让 / 对手异常强化翻倍)", () => {
  it("必定让对方速度等级-1 → 对手速度 -1", () => {
    expect(go("必定让对方速度等级-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent" },
    ]);
  });
  it("旧句不变：让对方防御等级-2（p1-ail-01 自身）", () => {
    expect(go("让对方防御等级-2").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -2, target: "opponent" },
    ]);
  });
  it("对手烧伤强化效果翻倍（带宿主时才落地 → deltaMulIf foeHas burn）", () => {
    const r = go("攻击、双防、速度+1，对手烧伤强化效果翻倍");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", deltaMulIf: { when: { foeHas: "burn" }, numerator: 2, denominator: 1 } },
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self", deltaMulIf: { when: { foeHas: "burn" }, numerator: 2, denominator: 1 } },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self", deltaMulIf: { when: { foeHas: "burn" }, numerator: 2, denominator: 1 } },
      { op: "apply_stat_stage", stat: "spd", delta: 1, target: "self", deltaMulIf: { when: { foeHas: "burn" }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：对手处于烧伤时强化效果翻倍（batch-e5b-17）", () => {
    expect(go("对手处于烧伤时强化效果翻倍").effects).toEqual([
      { op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self", if: { and: [{ foeHas: "burn" }, { foeHas: "burn" }] } },
    ]);
  });
});

describe("add one effect (p1: 附带固伤 / 未命中反式)", () => {
  it("攻击附带100点固定伤害 → flatBonus 100", () => {
    expect(go("攻击附带100点固定伤害").effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
  });
  it("自身所有攻击附带50点固定伤害 → flatBonus 50", () => {
    expect(go("自身所有攻击附带50点固定伤害").effects).toEqual([{ op: "flat", of: "flatBonus", value: 50 }]);
  });
  it("旧句不变：攻击附加100点固定伤害（heal-199）", () => {
    expect(go("攻击附加100点固定伤害").effects).toEqual([{ op: "flat", of: "flatBonus", value: 100 }]);
  });
  it("下3回合攻击附带100点固定伤害 → dmg_flat turns 3", () => {
    expect(go("下3回合攻击附带100点固定伤害").effects).toEqual([
      { op: "apply_status", name: "dmg_flat", target: "self", turns: 3, params: { flat: 100 } },
    ]);
  });
  it("技能未命中时恢复自身最大体力的1/3 → react trigger6", () => {
    expect(go("技能未命中时恢复自身最大体力的1/3").effects).toEqual([
      { op: "apply_status", name: "react", target: "self", params: { trigger: 6 }, payload: [{ op: "heal", numerator: 1, denominator: 3, target: "self" }] },
    ]);
  });
  it("旧句不变：未命中时恢复自身最大体力的1/3（misc-22 族）", () => {
    expect(go("未命中时恢复自身最大体力的1/3").effects).toEqual([
      { op: "heal", numerator: 1, denominator: 3, target: "self", if: { not: { prevApplied: true } } },
    ]);
  });
  it("每回合减少200点伤害 → dmg_reduce flat 200", () => {
    expect(go("每回合减少200点伤害").effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 200 } },
    ]);
  });
  it("旧句不变：每回合减伤害200（batch-e5-20a）", () => {
    expect(go("每回合减伤害200").effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 200 } },
    ]);
  });
  it("旧句不变：每回合受到伤害减少200（batch-e5-20）", () => {
    expect(go("每回合受到伤害减少200").effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 200 } },
    ]);
  });
});

describe("add one effect (p1: 弱化翻倍 / 防御提升消除 / 每回合固伤)", () => {
  it("后出手弱化效果翻倍（带宿主）→ 负级翻倍（与同族「先出手时弱化效果翻倍」同形）", () => {
    const r = go("对手速度、命中、攻击、特攻-1，后出手弱化效果翻倍");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: -2, target: "opponent" },
      { op: "apply_stat_stage", stat: "acc", delta: -2, target: "opponent" },
      { op: "apply_stat_stage", stat: "atk", delta: -2, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -2, target: "opponent" },
    ]);
  });
  it("旧句不变：先出手时弱化效果翻倍（batch-e6-189）带宿主时同为负级翻倍", () => {
    expect(go("对手防御-1，先出手时弱化效果翻倍").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -2, target: "opponent" },
    ]);
  });
  it("50%弱化翻倍（带宿主）→ deltaMulChance 50", () => {
    const r = go("对手命中-2、速度-1，50%弱化翻倍");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_stat_stage", stat: "acc", delta: -2, target: "opponent", deltaMulChance: { chance: 50, numerator: 2, denominator: 1 } },
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", deltaMulChance: { chance: 50, numerator: 2, denominator: 1 } },
    ]);
  });
  it("消除对手相应的防御提升效果 → clear_stages def+sdf", () => {
    expect(go("消除对手相应的防御提升效果").effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up", stats: ["def", "sdf"] },
    ]);
  });
  it("旧句不变：消除对手相应的防御能力提升效果（heal-49）", () => {
    expect(go("消除对手相应的防御能力提升效果").effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up", stats: ["def", "sdf"] },
    ]);
  });
  it("每回合增加30点固定伤害 → dot_field flat 30", () => {
    expect(go("每回合增加30点固定伤害").effects).toEqual([
      { op: "apply_status", name: "dot_field", target: "opponent", params: { flat: 30 } },
    ]);
  });
  it("旧句不变：每回合附加30点固定伤害（deferred-129）", () => {
    expect(go("每回合附加30点固定伤害").effects).toEqual([
      { op: "apply_status", name: "dot_field", target: "opponent", params: { flat: 30 } },
    ]);
  });
});

describe("add one effect (p1: 斜杠多维 / 概率后置 stat)", () => {
  it("自身防御/特防+1 → def/sdf 各 +1", () => {
    expect(go("自身防御/特防+1").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self" },
    ]);
  });
  it("对手防御/特防-1 → def/sdf 各 -1", () => {
    expect(go("对手防御/特防-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "sdf", delta: -1, target: "opponent" },
    ]);
  });
  it("旧句不变：自身防御、特防+1（stages-09）", () => {
    expect(go("自身防御、特防+1").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self" },
    ]);
  });
  it("对方10%特防-1 → 对手特防 -1 chance 10", () => {
    expect(go("对方10%特防-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "sdf", delta: -1, target: "opponent", chance: 10 },
    ]);
  });
  it("对方40%速度-1 → 对手速度 -1 chance 40", () => {
    expect(go("对方40%速度-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", chance: 40 },
    ]);
  });
  it("25%是对手命中-1 → 对手命中 -1 chance 25", () => {
    expect(go("25%是对手命中-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent", chance: 25 },
    ]);
  });
  it("旧句不变：50%对方防御-1（attach-damage-01）", () => {
    expect(go("50%对方防御-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: -1, target: "opponent", chance: 50 },
    ]);
  });
});

describe("add one effect (p1: HP 以内阈值)", () => {
  it("自身HP在1/2以内的时候威力加2倍 → selfHpBelow 1/2 ×2", () => {
    expect(go("自身HP在1/2以内的时候威力加2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("HP在1/3以内威力加2倍 → selfHpBelow 1/3 ×2", () => {
    expect(go("HP在1/3以内威力加2倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 3 } }, numerator: 2, denominator: 1 } },
    ]);
  });
  it("旧句不变：自身HP低于1/2威力翻倍（batch-e5g-05）", () => {
    expect(go("自身HP低于1/2威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } },
    ]);
  });
});

describe("add one effect (p1: 清除异常状态)", () => {
  it("清除自身所有异常状态 → cleanse self/ailment", () => {
    expect(go("清除自身所有异常状态").effects).toEqual([{ op: "cleanse", target: "self", scope: "ailment" }]);
  });
  it("清除对手所有异常状态 → cleanse opponent/ailment", () => {
    expect(go("清除对手所有异常状态").effects).toEqual([{ op: "cleanse", target: "opponent", scope: "ailment" }]);
  });
  it("旧句不变：解除自身所有异常状态（clear-13）", () => {
    expect(go("解除自身所有异常状态").effects).toEqual([{ op: "cleanse", target: "self", scope: "ailment" }]);
  });
  it("旧句不变：消除对方所有异常状态（clear-14）", () => {
    expect(go("消除对方所有异常状态").effects).toEqual([{ op: "cleanse", target: "opponent", scope: "ailment" }]);
  });
});

describe("add one effect (p1: 每回合回满)", () => {
  it("每回合回合结束时恢复自身全部体力 → hot 1/1", () => {
    expect(go("每回合回合结束时恢复自身全部体力").effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 1 } },
    ]);
  });
  it("每回合恢复自身全部体力 → hot 1/1", () => {
    expect(go("每回合恢复自身全部体力").effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 1 } },
    ]);
  });
  it("旧句不变：每回合恢复自身最大体力的1/1（timed-04）", () => {
    expect(go("每回合恢复自身最大体力的1/1").effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 1 } },
    ]);
  });
});

describe("add one effect (p1: 会令 PP 归零)", () => {
  it("45%会令对手随机1项技能PP值归零 → zeroRandom 1 chance 45", () => {
    expect(go("45%会令对手随机1项技能PP值归零").effects).toEqual([
      { op: "pp_delta", zeroRandom: 1, target: "opponent", chance: 45 },
    ]);
  });
  it("旧句不变：45%令对手随机1项技能PP值归零（batch-e5f-28 族）", () => {
    expect(go("45%令对手随机1项技能PP值归零").effects).toEqual([
      { op: "pp_delta", zeroRandom: 1, target: "opponent", chance: 45 },
    ]);
  });
});

describe("add one effect (p1: 每击吸血变体)", () => {
  it("每次造成的伤害1/2会恢复自己的HP → drain_atk 1/2", () => {
    expect(go("每次造成的伤害1/2会恢复自己的HP").effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } },
    ]);
  });
  it("旧句不变：每次造成伤害的1/2会恢复自己的体力（deferred-18）", () => {
    expect(go("每次造成伤害的1/2会恢复自己的体力").effects).toEqual([
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 1, d: 2 } },
    ]);
  });
});

describe("add one effect (p1: 恢复变体)", () => {
  it("恢复100固定体力值 → heal flat 100", () => {
    expect(go("恢复100固定体力值").effects).toEqual([{ op: "heal", flat: 100, target: "self" }]);
  });
  it("恢复最大生命的1/2 → heal 1/2", () => {
    expect(go("恢复最大生命的1/2").effects).toEqual([{ op: "heal", numerator: 1, denominator: 2, target: "self" }]);
  });
  it("旧句不变：恢复自身最大体力的1/3（heal-01）", () => {
    expect(go("恢复自身最大体力的1/3").effects).toEqual([{ op: "heal", numerator: 1, denominator: 3, target: "self" }]);
  });
  it("旧句不变：恢复自身100点体力（heal-03）", () => {
    expect(go("恢复自身100点体力").effects).toEqual([{ op: "heal", flat: 100, target: "self" }]);
  });
});

describe("add one effect (p1: 伤害%回血变体)", () => {
  it("攻击伤害的20%恢复体力 → drain 20/100", () => {
    expect(go("攻击伤害的20%恢复体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 20, denominator: 100 } },
    ]);
  });
  it("伤害值20%恢复体力 → drain 20/100", () => {
    expect(go("伤害值20%恢复体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 20, denominator: 100 } },
    ]);
  });
  it("旧句不变：造成伤害的20%恢复体力（heal-10）", () => {
    expect(go("造成伤害的20%恢复体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 20, denominator: 100 } },
    ]);
  });
});
