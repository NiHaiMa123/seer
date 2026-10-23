/**
 * 第十五到二十二轮留下的「条件被切开后，后半句无条件执行」。
 *
 * 三类缺口：
 * - 「且」切开后，后半句丢掉前半句的出招门，落到回合末就每回合都触发
 *   （pet-3320 茉蕊儿：对手用了属性技能才解除能力下降，包里却每回合末都解除）。
 * - boss 切分把句首「若P」（P 自己没有「则」）留在前一段，后一段的「若R则」丢掉 P
 *   （pet-3793 庚辰：束缚只剩「未受到攻击」，体力低于对手的前提丢了）。
 * - 「未触发则回合结束时…」的结果跨到另一个时点，前一轮的触发结果守不住后一段，
 *   包里仍把这段无条件挂上（pet-3422 / 3446 / 4061 / 4141 / 4137 / 4459）。
 *
 * 修法只动已有守卫和已有条目：认得出的条件抄回后半句；抄不回去、运行时也看不见的，
 * 整段留下不解析。不新增结算分支。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const names = (r: { entries: Array<{ ops?: Array<{ op?: string; name?: string }> }> }) =>
  r.entries.flatMap((e) => e.ops ?? []).map((o) => o.name ?? o.op);

describe("且切分：后半句带回自己的条件，出招门落不到回合末就扣下", () => {
  it("pet-3320 茉蕊儿：回合末不再无条件解除能力下降", () => {
    const r = parseSoulmarkText(
      "蕊：若对手使用攻击技能则造成的攻击伤害不超过自身最大体力的一半，若对手使用属性技能则当回合免疫异常且回合结束后解除自身能力下降状态（BOSS无效）；自身死亡后则下只登场精灵获得500点护盾且免疫1次异常状态",
      "茉蕊儿",
    );
    expect(r.entries.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect(names(r)).not.toContain("clear_stages");
    const immune = r.entries.find((e) => e.ops?.some((o) => o.name === "immune_status" && e.hook === "onMoveUsed"));
    expect(immune?.bossGate).toBe(true);
    expect(immune?.guard).toMatchObject({ actor: "foe", cat: 1 });
    expect(r.entries.some((e) => e.hook === "onKO")).toBe(true);
    expect(r.unparsed.some((u) => u.reason === "linked effect — move-use condition is not visible on this hook (deferred)")).toBe(true);
  });

  it("pet-3733 弗洛娅：回合末回血带着「自身处于中毒」", () => {
    const r = parseSoulmarkText(
      "娅：回合开始时50%令对手中毒，50%令己方中毒；对手处于中毒状态时当回合50%属性技能无效，我方处于中毒时则当回合受到的攻击伤害减少50%且回合结束时恢复自身最大体力1/3（boss无效）",
      "弗洛娅",
    );
    expect(r.unparsed).toEqual([]);
    const heal = r.entries.find((e) => e.ops?.some((o) => o.op === "heal"));
    expect(heal?.hook).toBe("onTurnEnd");
    expect(heal?.bossGate).toBe(true);
    expect(heal?.guard).toEqual({ selfHas: "poison" });
    const reduce = r.entries.find((e) => e.ops?.some((o) => o.name === "dmg_taken_down"));
    expect(reduce?.guard).toEqual({ selfHas: "poison" });
  });

  it("pet-3839 索格瑞亚：且后的回血沿用「不处于双防提升」，不取反也不整段丢掉", () => {
    const r = parseSoulmarkText(
      "攻击命中对手时若自身处于双防能力提升状态则造成的伤害提高100%，受到攻击时若自身不处于双防能力提升状态则将受到的攻击伤害降低50%且回合结束时恢复自身最大体力的1/3",
      "索格瑞亚",
    );
    expect(r.unparsed).toEqual([]);
    const heal = r.entries.find((e) => e.ops?.some((o) => o.op === "heal"));
    expect(heal?.hook).toBe("onTurnEnd");
    expect(JSON.stringify(heal?.guard ?? {}) + JSON.stringify(heal?.ops ?? [])).toContain("not");
  });
});

describe("boss 切分：句首没有「则」的若P 抄进后一段", () => {
  it("pet-3793 庚辰：束缚同时要「体力低于对手」和「当回合未受到攻击」", () => {
    const r = parseSoulmarkText(
      "辰：若对手为自身天敌则受到的攻击伤害随机减少25%-50%；回合开始时若自身体力低于对手，若当回合受到攻击伤害后免疫下回合受到的攻击伤害，若当回合未受到攻击则回合结束时100%令对手束缚（boss无效）",
      "庚辰",
    );
    const taken = r.entries.find((e) => e.ops?.some((o) => o.name === "dmg_taken_down"));
    expect(taken?.guard).toEqual({ foeCountersUs: true });
    const bind = r.entries.find((e) => e.ops?.some((o) => o.name === "bind"));
    expect(bind?.hook).toBe("onTurnEnd");
    expect(bind?.bossGate).toBe(true);
    expect(bind?.guard).toEqual({ prevTakenZero: true });
    const bindOp = bind?.ops?.find((o) => o.name === "bind") as { if?: unknown } | undefined;
    expect(bindOp?.if).toEqual({ selfHpBelowFoe: true });
    // 「受到攻击后免疫」仍没有对应规则，留残文，不改成无条件免疫
    expect(r.unparsed.some((u) => String(u.clause).includes("免疫下回合受到的攻击伤害"))).toBe(true);
  });
});

describe("跨时点的「未触发则」不再无条件执行", () => {
  it("pet-3422 蒂亚斯：害怕保留体力条件，回合末固伤不挂", () => {
    const r = parseSoulmarkText(
      "每回合开始时令对手随机2项属性-1；回合开始时自身体力低于对手则当回合自身技能有70%几率令对手害怕，未触发则回合结束时附加对手最大体力1/4的固定伤害（BOSS无效）",
      "蒂亚斯",
    );
    expect(r.entries.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect(JSON.stringify(r.entries)).toContain("selfHpBelowFoe");
    expect(r.unparsed.some((u) => u.reason?.includes("cross-event outcome"))).toBe(true);
  });

  it("pet-3446 混沌蒂亚斯：回合末吸取不挂", () => {
    const r = parseSoulmarkText(
      "回合开始时自身体力低于对手则当回合技能80%令对手害怕，未触发则回合结束时吸取对手1/4最大体力且下次触发几率提升100%（boss无效）",
      "混沌蒂亚斯",
    );
    expect(r.entries.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect(r.entries.some((e) => e.ops?.some((o) => o.op === "heal" || o.name === "drain_atk"))).toBe(false);
  });

  it("pet-4061 法莉：闪避只针对攻击，回合末不再扣 PP", () => {
    const r = parseSoulmarkText(
      "后出手时所有技能附加自身防御值和特防值总和25%的固定伤害，若附加的固定伤害高于250则额外附加对手最大体力25%的固定伤害；回合开始时，若自身体力低于对手则当回合50%闪避对手攻击，若自身体力高于对手则当回合攻击50%打出致命一击，未触发则回合结束时令对手所有PP值-1（boss无效）",
      "法莉",
    );
    expect(names(r)).not.toContain("pp_delta");
    const dodge = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "dodge") as { params?: { pct?: number; cat?: number } } | undefined;
    expect(dodge?.params).toEqual({ pct: 50, cat: 4 });
  });

  it("pet-4141 夜使库帕帕：不再多挂一段 300 固定伤害", () => {
    const r = parseSoulmarkText(
      "自身造成的攻击伤害低于300则50%令对手害怕，未触发则附加300点固定伤害；回合开始时自身体力低于对手则当回合对手使用的攻击技能威力降低25%，若自身体力低于最大体力的1/2则当回合对手使用的攻击技能威力额外降低15%且在回合结束时附加对手当回合造成攻击伤害值100%的固定伤害（boss无效）",
      "夜使库帕帕",
    );
    expect(r.entries.flatMap((e) => e.ops ?? []).some((o) => o.op === "damage")).toBe(false);
    expect(r.entries.some((e) => e.ops?.some((o) => o.name === "fear"))).toBe(true);
  });

  it("pet-4137 坚盾·瓦尔德：未死亡的 1/3 固伤不挂；护盾条目仍在", () => {
    const r = parseSoulmarkText(
      "若对手当回合使用的攻击技能威力大于等于80则回合结束时为自身附加1个250点的护盾，威力每大于等于20点则附加的护盾值增加50点；自身护盾被击破而导致死亡则消除对手能力提升状态和回合类效果，未死亡则回合结束时附加对手最大体力1/3的固定伤害（boss无效）",
      "坚盾·瓦尔德",
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.guard).toEqual({ movePowerAtLeast: 80 });
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ name: "shield" });
    expect(r.unparsed.some((u) => String(u.clause).includes("1/3"))).toBe(true);
  });

  it("pet-4459 恶鬼·图伽：整条拼不出可执行效果，解析器不产出条目", () => {
    const r = parseSoulmarkText(
      "令对手随机进入2种弱化类异常状态，若均未触发则吸取对手最大体力的1/3；对手每处于1种异常状态则当回合自身使用技能后吸取对手100点体力（boss无效）",
      "恶鬼·图伽",
    );
    expect(r.entries).toEqual([]);
  });

  it("pet-4023 哀目黑子：禁疗挂在自身使用属性技能上，不再几乎每回合末都禁疗", () => {
    const r = parseSoulmarkText(
      "回合开始时，若自身未满体力则回合结束时令自身防御、特防+1；自身当回合使用属性技能则下回合令对手无法通过自身技能恢复体力，自身连续2回合使用属性技能则下回合额外攻击打出致命一击，自身连续3回合以上使用属性技能则下回合额外免疫受到的对手攻击伤害（boss无效）",
      "哀目黑子",
    );
    const cut = r.entries.find((e) => e.ops?.some((o) => o.name === "heal_cut"));
    expect(cut?.hook).toBe("onMoveUsed");
    expect(cut?.bossGate).toBe(true);
    expect(cut?.guard).toMatchObject({ actor: "self", cat: 1 });
    expect(r.entries.some((e) => e.hook === "onTurnEnd" && e.ops?.some((o) => o.name === "heal_cut"))).toBe(false);
    const stages = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(stages?.guard).toEqual({ not: { selfHpFull: true } });
    expect(r.unparsed.some((u) => String(u.clause).includes("连续3回合"))).toBe(true);
  });
});

describe("内容包：这几条不再挂被切开的效果", () => {
  const marks = JSON.parse(readFileSync("content/peak/soulmarks.json", "utf8")).soulmarks as Record<string, { effects?: Array<{ hook?: string; guard?: unknown; bossGate?: boolean; ops?: Array<Record<string, unknown>> }> }>;
  const units = JSON.parse(readFileSync("content/peak/units.json", "utf8")).units as Array<{ id: string; soulMark?: string; fifthMoveId?: string }>;

  it("sm-3793 束缚带体力前提，天敌减伤守卫不变", () => {
    const fx = marks["sm-3793"]?.effects ?? [];
    const bind = fx.find((e) => e.ops?.some((o) => o.name === "bind"));
    expect(bind?.guard).toEqual({ prevTakenZero: true });
    expect(bind?.bossGate).toBe(true);
    expect(bind?.ops?.find((o) => o.name === "bind")?.if).toEqual({ selfHpBelowFoe: true });
    expect(fx.find((e) => e.ops?.some((o) => o.name === "dmg_taken_down"))?.guard).toEqual({ foeCountersUs: true });
  });

  it("sm-3733 回血守卫是自身中毒", () => {
    const heal = marks["sm-3733"]?.effects?.find((e) => e.ops?.some((o) => o.op === "heal"));
    expect(heal?.guard).toEqual({ selfHas: "poison" });
    expect(heal?.bossGate).toBe(true);
  });

  it("sm-3839 回合末回血带着「不处于双防提升」，不再每回合都回", () => {
    const heal = marks["sm-3839"]?.effects?.find((e) => e.ops?.some((o) => o.op === "heal"));
    expect(heal?.hook).toBe("onTurnEnd");
    expect(heal?.guard).toEqual({
      not: {
        or: [
          { selfStatAtLeast: { stat: "def", stage: 1 } },
          { selfStatAtLeast: { stat: "sdf", stage: 1 } },
        ],
      },
    });
  });

  it("sm-3320 没有回合末解除能力下降", () => {
    const fx = marks["sm-3320"]?.effects ?? [];
    expect(fx.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect(fx.flatMap((e) => e.ops ?? []).some((o) => o.name === "clear_stages")).toBe(false);
  });

  it("sm-3422 / sm-3446 / sm-4061 / sm-4141 / sm-4137 不再挂无条件的后半句", () => {
    expect(marks["sm-3422"]?.effects?.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect(marks["sm-3446"]?.effects?.some((e) => e.hook === "onTurnEnd")).toBe(false);
    expect((marks["sm-4061"]?.effects ?? []).flatMap((e) => e.ops ?? []).some((o) => o.op === "pp_delta")).toBe(false);
    expect((marks["sm-4061"]?.effects ?? []).flatMap((e) => e.ops ?? []).find((o) => o.name === "dodge")?.params).toEqual({ pct: 50, cat: 4 });
    expect((marks["sm-4141"]?.effects ?? []).flatMap((e) => e.ops ?? []).some((o) => o.op === "damage")).toBe(false);
    expect((marks["sm-4137"]?.effects ?? []).flatMap((e) => e.ops ?? []).some((o) => o.op === "damage")).toBe(false);
    expect(marks["sm-4137"]?.effects?.[0]?.guard).toEqual({ movePowerAtLeast: 80 });
  });

  it("sm-4023 禁疗在出招钩子上", () => {
    const cut = marks["sm-4023"]?.effects?.find((e) => e.ops?.some((o) => o.name === "heal_cut"));
    expect(cut?.hook).toBe("onMoveUsed");
    expect(cut?.guard).toMatchObject({ actor: "self", cat: 1 });
    expect(cut?.bossGate).toBe(true);
  });

  it("sm-4459 已卸下，恶鬼·图伽不再挂这条魂印", () => {
    expect(marks["sm-4459"]).toBeUndefined();
    const unit = units.find((u) => u.id === "pet-4459");
    expect(unit?.soulMark).toBeUndefined();
    expect(unit?.fifthMoveId).toBe("mv-4459-f");
  });
});
