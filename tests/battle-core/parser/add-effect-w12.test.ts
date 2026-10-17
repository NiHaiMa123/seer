/**
 * add-effect-w12：seer-w12 这一路加的技能规则（语意清楚、当前仍 no-rule、且不属于 w01–w10 那些类）。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 * 每条：新规则解析出的 IR + 相邻旧句子结果不变（顺序测试只锁已快照 id，本文件的 id 不进快照）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

type R = { effects: unknown[]; flags: Record<string, unknown>; unparsed: unknown[] };
const p = (t: string) => parseEffectText(t, { hasDamage: true }) as unknown as R;

describe("add one effect (w12)", () => {
  it("w12-pw-most-01：每次使用威力增加10，最多增加40（宿主句 阿苏亚/狂战刃）", () => {
    const r = p("每次使用威力增加10，最多增加40");
    expect(r.effects).toEqual([
      { op: "power", of: "powerPerUse", value: 10 },
      { op: "power", of: "useCap", value: 40 },
    ]);
    expect(r.unparsed).toEqual([]);
    expect(p("每次使用威力增加10").effects).toEqual([{ op: "power", of: "powerPerUse", value: 10 }]);
  });

  it("w12-pw-order-01：连续使用威力每次增加20，最高威力60（宿主句 哈尼卡/能量球）", () => {
    const r = p("连续使用威力每次增加20，最高威力60");
    expect(r.effects).toEqual([
      { op: "power", of: "powerPerUse", value: 20 },
      { op: "power", of: "useCap", value: 60 },
    ]);
    expect(r.unparsed).toEqual([]);
    expect(p("连续使用威力增加20，最高120").effects).toEqual([
      { op: "power", of: "powerPerUse", value: 20 },
      { op: "power", of: "useCap", value: 120 },
    ]);
  });

  it("w12-pw-pct-01：连续使用时威力提升100%，最高提升400%（宿主句 涂蝶/陶醉）", () => {
    const r = p("连续使用时威力提升100%，最高提升400%");
    expect(r.effects).toEqual([
      { op: "power", of: "powerMulPerUse", value: { numerator: 200, denominator: 100 } },
      { op: "power", of: "powerMulPerUseCap", value: { numerator: 500, denominator: 100 } },
    ]);
    expect(r.unparsed).toEqual([]);
    expect(p("连续使用每次增加15%，最高60%").effects).toEqual([
      { op: "power", of: "powerMulPerUse", value: { numerator: 115, denominator: 100 } },
      { op: "power", of: "powerMulPerUseCap", value: { numerator: 160, denominator: 100 } },
    ]);
  });

  it("w12-crit-use-01：每次攻击提升10%致命几率，最高提升40（宿主句 圣魂奥斯卡/灵光分裂斩）", () => {
    const r = p("每次攻击提升10%致命几率，最高提升40");
    expect(r.effects).toEqual([
      { op: "crit", of: "critPerUsePct", value: 10 },
      { op: "crit", of: "critPerUseCap", value: 40 },
    ]);
    expect(r.unparsed).toEqual([]);
    expect(p("每次攻击提升10%的致命几率，最高提升30%").effects).toEqual([
      { op: "crit", of: "critPerUsePct", value: 10 },
      { op: "crit", of: "critPerUseCap", value: 30 },
    ]);
  });

  it("w12-crit-frac-01：3/16概率暴击（宿主句 草灵灵/刃叶）", () => {
    const r = p("3/16概率暴击");
    expect(r.effects).toEqual([{ op: "crit", of: "critChanceFrac", value: { numerator: 3, denominator: 16 } }]);
    expect(r.unparsed).toEqual([]);
    expect(p("3/16几率致命").effects).toEqual([{ op: "crit", of: "critChanceFrac", value: { numerator: 3, denominator: 16 } }]);
  });

  it("w12-reflect-opp-01：将对手的攻击伤害100%反馈给对手（宿主句 万世北溟·玄武/万劫沙柩）", () => {
    const r = p("将对手的攻击伤害100%反馈给对手");
    expect(r.effects).toEqual([{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 100, d: 100 } }]);
    expect(r.unparsed).toEqual([]);
    expect(p("2回合将对手的攻击伤害100%反馈给对手（双方同时死亡时对手残留1点体力）").effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 100, d: 100 }, turns: 2 },
    ]);
    expect(p("将本回合受到的攻击伤害100%反馈给对方").effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 100, d: 100 } },
    ]);
  });

  it("w12-reflect-direct-01：自身受到直接伤害的50%反馈给对手（宿主句 泠月/风雪交加）", () => {
    const r = p("自身受到直接伤害的50%反馈给对手");
    expect(r.effects).toEqual([{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 50, d: 100 } }]);
    expect(r.unparsed).toEqual([]);
    expect(p("将所受的伤害2倍反馈给对手").effects).toEqual([
      { op: "apply_status", name: "counter", target: "self", params: { mul: 2 } },
    ]);
  });

  it("w12-down-push-01：将能力下降的状态反馈给对手（宿主句 卡西露/海流漩涡）", () => {
    expect(p("将能力下降的状态反馈给对手").effects).toEqual([
      { op: "transfer_stages", direction: "push", sign: "down" },
    ]);
    expect(p("降能力下降状态反馈给对手").effects).toEqual([
      { op: "transfer_stages", direction: "push", sign: "down" },
    ]);
    expect(p("将能力下降反馈给对手").effects).toEqual([
      { op: "transfer_stages", direction: "push", sign: "down" },
    ]);
    expect(p("下降状态反馈给对手").effects).toEqual([]);
    expect(p("降低状态反馈给对手").effects).toEqual([]);
  });

  it("w12-down-push-tick-01：每回合自身的能力下降状态都会反馈到对手身上（宿主句 月影·阿德洛卡/永黯月辉）", () => {
    const r = p("每回合自身的能力下降状态都会反馈到对手身上");
    expect(r.effects).toEqual([{
      op: "apply_status", name: "periodic", target: "self", params: { win: 12 },
      payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }],
    }]);
    expect(r.unparsed).toEqual([]);
    expect(p("4回合内，每回合自身的能力下降状态都会反馈到对手身上").effects).toEqual([{
      op: "apply_status", name: "periodic", target: "self", turns: 4, params: { win: 12 },
      payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }],
    }]);
    expect(p("回合结束时解除自身能力下降状态并反弹给对手").effects).toEqual([{
      op: "apply_status", name: "periodic", target: "self", params: { win: 12 },
      payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }],
    }]);
  });

  it("w12-first-pow-01：先手2倍攻击（宿主句 炽寒妖兽/火光四射）", () => {
    expect(p("先手2倍攻击").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
    expect(p("先手加倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "first" }, numerator: 2, denominator: 1 } },
    ]);
  });

  it("w12-first-flat-01：先手加100固伤（宿主句 龙神·哈克萨斯/天霸龙魂斩）", () => {
    expect(p("先手加100固伤").effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { order: "first" }, flat: 100 } },
    ]);
    expect(p("先出手时附加100点固定伤害").effects).toEqual([
      { op: "flat", of: "flatIf", value: { when: { order: "first" }, flat: 100 } },
    ]);
  });

  it("w12-first-stage-01：先手对方命中-1（宿主句 震天·猛虎王/狂怒弑神爪）", () => {
    expect(p("先手对方命中-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent", if: { order: "first" } },
    ]);
    expect(p("每次加30固伤，最高150。先手对方命中-1，后手威力翻倍").effects).toEqual([
      { op: "power", of: "scaleIf", value: { when: { order: "last" }, numerator: 2, denominator: 1 } },
      { op: "flat", of: "flatPerUse", value: 30 },
      { op: "flat", of: "flatPerUseCap", value: 150 },
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent", if: { order: "first" } },
    ]);
  });

  it("w12-first-dodge-01：先手躲避本回合攻击（宿主句 邪影之尊/邪王焚天斩）", () => {
    expect(p("先手躲避本回合攻击").effects).toEqual([
      { op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: 100 }, if: { order: "first" } },
    ]);
  });

  it("w12-first-immune-01：先手2回合免疫异常（宿主句 创世圣弓/圣光创世箭）", () => {
    expect(p("先手2回合免疫异常").effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", turns: 2, if: { order: "first" } },
    ]);
    expect(p("3回合内免疫能力下降状态").effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self", turns: 3 },
    ]);
  });

  it("w12-crit-turns-01：对下2回合自身直接攻击必定暴击（宿主句 忍王·壬无月/天沐剑雨）", () => {
    expect(p("对下2回合自身直接攻击必定暴击").effects).toEqual([
      { op: "apply_status", name: "crit_always", target: "self", turns: 2 },
    ]);
    expect(p("自身直接攻击必定暴击").effects).toEqual([
      { op: "apply_status", name: "crit_always", target: "self" },
    ]);
  });

  it("w12-chance-use-01：每次使用烧伤概率提升20%，最高概率100%（宿主句 不动明王/明王焚天照）", () => {
    const solo = p("每次使用烧伤概率提升20%，最高概率100%");
    expect(solo.effects).toEqual([]);
    expect(solo.unparsed).toEqual([]);
    expect(p("40%概率另对手烧伤，每次使用烧伤概率提升20%，最高概率100%").effects).toEqual([
      { op: "apply_status", name: "burn", target: "opponent", chance: 40, chancePerUse: 20, chancePerUseCap: 100 },
    ]);
    expect(p("每次使用概率增加20%，最高概率100%").effects).toEqual([]);
  });

  it("w12-drain-half-01：给予对方伤害的一半会回复自己的体力（宿主句 伊洛花/强力吸取）", () => {
    expect(p("给予对方伤害的一半会回复自己的体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
    expect(p("给与对方损伤的一半会回复自己的体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
    expect(p("给予对方损伤的一半会回复自己的体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
  });

  it("w12-heal-full-01：恢复全身体力（宿主句 弗希斯/暗影微光）", () => {
    expect(p("恢复全身体力").effects).toEqual([{ op: "heal", numerator: 1, denominator: 1, target: "self" }]);
    expect(p("恢复全体力").effects).toEqual([{ op: "heal", numerator: 1, denominator: 1, target: "self" }]);
    expect(p("恢复全部体力").effects).toEqual([{ op: "heal", numerator: 1, denominator: 1, target: "self" }]);
  });

  it("w12-drain-direct-01：直接攻击伤害40%恢复体力（宿主句 萨恩德斯/飞沙走砾）", () => {
    expect(p("直接攻击伤害40%恢复体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 40, denominator: 100 } },
    ]);
    expect(p("造成伤害的100%恢复体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 100, denominator: 100 } },
    ]);
  });

  it("w12-type-null-01：对草系无效留档（宿主句 寄生种子一族）", () => {
    const r = p("对草系无效");
    expect(r.effects).toEqual([]);
    expect(r.unparsed).toEqual([{
      clause: "对草系无效",
      reason: "type-null note (草系免疫寄生种子) — move-level type immunity unmodeled (deferred)",
    }]);
  });

  it("w12 撤回的那条已由 r2d 落地：三个「及/和」语序都是完整 IR（非 no-rule）", () => {
    // r2d 落地（tools/effects-rules/batch-w12.mjs 的 r2d-pierce-speed-01/02）：
    // 两个格子都发——flags.ignoreFoeSpeed + apply_status pierce_stages。详见 scratch/parallel/r2d.done。
    const full = {
      effects: [{ op: "apply_status", name: "pierce_stages", target: "self" }],
      flags: { ignoreFoeSpeed: true },
      unparsed: [],
    };
    expect(p("无视对手速度和防御能力强化状态")).toEqual(full);
    expect(p("无视对手速度及防御强化")).toEqual(full);
    expect(p("无视对手速度和防御能力提升")).toEqual(full);
    // 「以及」语序（旧句）不变，仍是同两个格子
    expect(p("无视对手速度以及防御能力强化状态")).toEqual(full);
  });
});
