/**
 * parser-regression —— T7 门禁修复批的回归锁定。
 * 每条用例对应一个曾产生畸形 IR 的规则 bug（捕获组错位/键名写错/缺省值缺失）。
 */
import { describe, it, expect } from "vitest";
import { isHitRider, parseEffectText } from "../../../tools/effects-parse.mjs";

const fx = (t: string) => (parseEffectText(t) as any).effects;
/** 家族键现在在 rider 上。这个视图把 rider 摊回旧键，锁定的是取值不是袋子。 */
const familyBag = (parsed: { flags?: { attachDamage?: Record<string, unknown> }; effects?: unknown[] }): Record<string, unknown> => {
  const bag: Record<string, unknown> = { ...(parsed.flags?.attachDamage ?? {}) };
  const take = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (e === null || typeof e !== "object") continue;
      const rec = e as Record<string, unknown>;
      take(rec.payload);
      take(rec.ops);
      take(rec.elseOps);
      take(rec.atCapOps);
      if (!isHitRider(rec.op)) continue;
      if (rec.of !== undefined) bag[String(rec.of)] = rec.value;
      else for (const k of Object.keys(rec)) if (k !== "op") bag[k] = rec[k];
    }
  };
  take(parsed.effects);
  return bag;
};
const ad = (t: string) => familyBag(parseEffectText(t) as any);
const asRec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? v as Record<string, unknown> : {});
const un = (t: string) => (parseEffectText(t) as any).unparsed;

describe("parser regression: capture-group / emit-shape bugs", () => {
  it("随机使自己3项能力+2 → stat:random randomCount:3 delta:2", () => {
    expect(fx("随机使自己3项能力+2")).toEqual([
      { op: "apply_stat_stage", stat: "random", randomCount: 3, delta: 2, target: "self" },
    ]);
  });
  it("1回合做12-16次攻击 → hits{min:12,max:16}", () => {
    expect(ad("1回合做12-16次攻击").hits).toEqual({ min: 12, max: 16 });
  });
  it("造成的伤害提高50% → mul 150/100", () => {
    expect(ad("造成的伤害提高50%").mul).toEqual({ numerator: 150, denominator: 100 });
  });
  it("若先出手则当回合对手无法造成攻击伤害 → dmg_weaken turns:1 + order:first", () => {
    expect(fx("若先出手则当回合对手无法造成攻击伤害")).toEqual([
      { op: "apply_status", name: "dmg_weaken", target: "opponent", turns: 1, params: { n: 0, d: 1 }, if: { order: "first" } },
    ]);
  });
  it("给予对象损伤的1/4，会回复自己的HP → drain{1/4}（numerator/denominator 键）", () => {
    expect(fx("给予对象损伤的1/4，会回复自己的HP")).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 4 } },
    ]);
  });
  it("所受伤害的1/4反弹给自己 → recoilFrac{n,d}", () => {
    expect(ad("所受伤害的1/4反弹给自己").recoilFrac).toEqual({ n: 1, d: 4 });
  });
  it("随机吸取对手3项属性-2并附加给自己 → 单条 transfer_stages（无 target/无重复 op）", () => {
    expect(fx("随机吸取对手3项属性-2，并将该属性附加给自己")).toEqual([
      { op: "transfer_stages", randomCount: 3, randomDelta: 2 },
    ]);
  });
  it("将自身能力下降状态10倍返还给对手 → push mul{10/1}", () => {
    expect(fx("将自身的能力下降状态10倍返还给对手")).toEqual([
      { op: "transfer_stages", direction: "push", mul: { numerator: 10, denominator: 1 } },
    ]);
  });
  it("截断源文本（'每回合反弹对手1/'）→ 走 unparsed 而非 NaN 字段", () => {
    const r = parseEffectText("每回合反弹对手1/") as any;
    expect(r.effects).toEqual([]);
    expect(r.unparsed.length).toBeGreaterThan(0);
  });
  it("畸形 stat op（'使对手20' 截断源）→ 不产 op，写明 delta 0 的 unparsedReason", () => {
    const r = parseEffectText("使对手20") as any;
    expect(r.effects).toEqual([]);
    expect(r.unparsed).toEqual([{ clause: "使对手20", reason: "stat stage delta 0 — stat code fused with number (source text truncated)" }]);
  });
  // R1：(${NUM}) 双层捕获组让第二个分支取错下标，产出 null 后被 sweep 记成 malformed
  it("R1 每回合附加N点固伤（第二分支）→ dot_field flat 是整数", () => {
    expect(fx("3回合每回合附加30点固伤")).toEqual([{ op: "apply_status", name: "dot_field", target: "opponent", params: { flat: 30 }, turns: 3 }]);
  });
  it("R1 N回合内使用技能恢复X点体力 → hot 回合窗，不是一次性 heal", () => {
    expect(fx("3回合内使用技能恢复200点体力")).toEqual([{ op: "apply_status", name: "hot", target: "self", params: { flat: 200 }, turns: 3 }]);
  });
  it("R1 回复N体力（第二分支）→ heal flat 整数", () => {
    expect(fx("消除对手能力提升状态，消除成功则回复200体力")).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "heal", flat: 200, target: "self", if: { prevApplied: true } },
    ]);
  });
  it("R1 每回合攻击等级+1（第二分支）→ stage_tick stat/delta 齐全", () => {
    expect(fx("每回合攻击等级+1")).toEqual([{ op: "apply_status", name: "periodic", target: "self", params: { win: 6 }, payload: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", plain: true }] }]);
  });
  it("R1 后出手威力2倍 → scaleIf numerator 2", () => {
    expect(ad("后出手威力2倍").scaleIf).toEqual({ when: { order: "last" }, numerator: 2, denominator: 1 });
  });
  it("R1 无主语「技能威力提升N%」→ 本招 powerMul，不再产出 n:null 的 power_mul", () => {
    expect(ad("技能威力提升60%").powerMul).toEqual({ numerator: 160, denominator: 100 });
  });
  it("R1 回合前缀剥掉后的「对手属性技能命中效果失效」→ turns 由前缀注入", () => {
    expect(fx("1回合内对手属性技能命中效果失效")).toEqual([{ op: "apply_status", name: "hit_fx_null", target: "opponent", params: { cat: 1 }, turns: 1 }]);
  });
  it("R1 逗号切断的 stat 列表续段（dynStage）→ delta 取对下标", () => {
    expect(fx("100%改变对方攻击、特攻和速度等级-1")).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent", chance: 100 },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent", chance: 100 },
      { op: "apply_stat_stage", stat: "spd", delta: -1, target: "opponent", chance: 100 },
    ]);
  });
  // R2：「、」切分让后段丢主语
  it("R2 使对手攻击-1、特攻-1 → 两维都落对手", () => {
    expect(fx("使对手攻击-1、特攻-1")).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
    ]);
  });
  it("R2 每回合对手防御-1、命中-1 → 两条对手侧 stage_tick", () => {
    expect(fx("3回合内，每回合对手防御-1、命中-1")).toEqual([
      { op: "apply_status", name: "periodic", target: "opponent", turns: 3, params: { win: 6 }, payload: [{ op: "apply_stat_stage", stat: "def", delta: -1, target: "self", plain: true }] },
      { op: "apply_status", name: "periodic", target: "opponent", turns: 3, params: { win: 6 }, payload: [{ op: "apply_stat_stage", stat: "acc", delta: -1, target: "self", plain: true }] },
    ]);
  });
  it("chance>100 源数据 → 钳制到 100", () => {
    const r = fx("技能使用成功时，115%改变自身攻击等级+1");
    expect(r[0].chance).toBe(100);
  });
  it("回合结束后解除异常状态 → 自解异常窗", () => {
    expect(fx("回合结束后解除自身异常状态")).toEqual([
      { op: "apply_status", name: "periodic", target: "self", params: { win: 15 }, payload: [{ op: "cleanse", target: "self", scope: "ailment", plain: true, noHooks: true }] },
    ]);
  });
});

describe("parser regression: S4 印记/嵌套 NUM 捕获组", () => {
  it("对手下回合先制-2 → prio_up opponent add:-2（嵌套 NUM 组错位修复）", () => {
    expect(fx("对手下回合先制-2")).toEqual([
      { op: "apply_status", name: "prio_up", target: "opponent", turns: 1, params: { add: -2 } },
    ]);
  });
  it("消除成功使对手下回合先制-2 → prevApplied 吊装", () => {
    expect(fx("消除成功使对手下回合先制-2")).toEqual([
      { op: "apply_status", name: "prio_up", target: "opponent", turns: 1, params: { add: -2 }, if: { prevApplied: true } },
    ]);
  });
  it("使对手下2回合受到的伤害提升50% → dmg_taken_up turns:2 pct:50", () => {
    expect(fx("使对手下2回合受到的伤害提升50%")).toEqual([
      { op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: 2, params: { pct: 50 } },
    ]);
  });
  it("使自身下3回合所有技能先制+2 → prio_up turns:3 add:2", () => {
    expect(fx("使自身下3回合所有技能先制+2")).toEqual([
      { op: "apply_status", name: "prio_up", target: "self", turns: 3, params: { add: 2 } },
    ]);
  });
});

describe("parser regression: S4 印记 op/谓词", () => {
  it("对手每存在1层致命裂痕则附加100点真实伤害 → flatPerMark + markCountAtLeast 门", () => {
    const r = fx("对手每存在1层致命裂痕则附加100点真实伤害");
    expect(r[0]).toMatchObject({ op: "damage", kind: "true" });
    expect(r[1]).toEqual({ op: "flat", of: "flatPerMark", value: { mark: "致命裂痕", add: 100, on: "foe" } });
    expect(r[0].if).toEqual({ markCountAtLeast: { mark: "致命裂痕", n: 1, on: "foe" } });
  });
  it("场上每有1种五行印记，伤害提升25% → attachDamage.mulPerMark kinds+both", () => {
    expect(ad("场上每有1种五行印记，自身造成的攻击伤害提升25%").mulPerMark)
      .toMatchObject({ kinds: true, on: "both", per: 1, add: 25 });
  });
  it("对手每存在2层处决印记则附加50点固定伤害 → flatPerMark per:2", () => {
    const r = fx("对手每存在2层处决印记则附加50点固定伤害");
    expect(r[1]).toEqual({ op: "flat", of: "flatPerMark", value: { mark: "处决印记", add: 50, per: 2, on: "foe" } });
  });
  it("对手每存在1层处决印记则几率提升10% → attachDamage.mulChancePerMark", () => {
    expect(ad("对手每存在1层处决印记则几率提升10%").mulChancePerMark)
      .toMatchObject({ mark: "处决印记", add: 10, on: "foe" });
  });
  it("对手每存在1层处决印记自身免疫1次受到的异常状态 → countPerMark", () => {
    const r = fx("对手每存在1层处决印记则自身免疫1次受到的异常状态");
    expect(r[0]).toMatchObject({ op: "apply_status", name: "immune_status", countPerMark: { mark: "处决印记", on: "foe" } });
  });
});

describe("parser regression: S4 固伤免疫/kindIfImmune/臣服", () => {
  it("己方1回合内免疫固定伤害、百分比伤害 → flat_immune turns:1", () => {
    expect(fx("己方1回合内免疫固定伤害")).toEqual([
      { op: "apply_status", name: "flat_immune", target: "self", turns: 1 },
    ]);
  });
  it("对手免疫百分比伤害时转变为250点真实伤害 → drain_dot params.kiiFlat", () => {
    const r = fx("4回合内每回合吸取对手最大体力的1/3，对手免疫百分比伤害时转变为250点真实伤害");
    const dot = r.find((e: any) => e.name === "drain_dot");
    expect(dot?.params?.kiiFlat).toBe(250);
  });
  it("使对手臣服 / 100%臣服 → submit ailment", () => {
    expect(fx("使对手臣服")).toEqual([{ op: "apply_status", name: "submit", target: "opponent" }]);
    expect(fx("100%臣服")[0]).toMatchObject({ name: "submit", chance: 100 });
  });
  it("3回合内对手主动切换精灵出战时100%臣服 → react trigger9 turns:3 payload submit", () => {
    const r = fx("3回合内对手主动切换精灵出战时100%臣服");
    expect(r[0]).toMatchObject({ op: "apply_status", name: "react", turns: 3, params: { trigger: 9 } });
    expect(r[0].payload[0]).toMatchObject({ name: "submit", chance: 100 });
  });
  it("附加给对手300点固定伤害 → attachDamage.flatBonus", () => {
    expect(ad("附加给对手300点固定伤害").flatBonus).toBe(300);
  });
});

describe("parser: 随机在主语前的 N 项能力", () => {
  const stage = (randomCount: number, delta: number, target: "self" | "opponent" = "self") =>
    ({ op: "apply_stat_stage", stat: "random", randomCount, delta, target });

  it("随机自身3项属性+1", () => {
    expect(fx("随机自身3项属性+1")).toEqual([stage(3, 1)]);
  });
  it("随机自身三项属性+1（中文数字）", () => {
    expect(fx("随机自身三项属性+1")).toEqual([stage(3, 1)]);
  });
  it("随机自身2项属性+1", () => {
    expect(fx("随机自身2项属性+1")).toEqual([stage(2, 1)]);
  });
  it("随机自身3项属性等级+1", () => {
    expect(fx("随机自身3项属性等级+1")).toEqual([stage(3, 1)]);
  });
  it("必中；消除对手能力提升；随机自身3项属性+1", () => {
    const r = parseEffectText("必中；消除对手能力提升；随机自身3项属性+1") as any;
    expect(r.flags).toEqual({ accuracy: "always" });
    expect(r.effects).toEqual([
      { op: "clear_stages", target: "opponent", sign: "up" },
      stage(3, 1),
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("降低对手所有PP一点，并恢复自身所有PP一点；随机自身3项属性+1", () => {
    const r = parseEffectText("降低对手所有PP一点，并恢复自身所有PP一点；随机自身3项属性+1") as any;
    expect(r.effects).toEqual([
      { op: "pp_delta", amount: -1, target: "opponent", scope: "all" },
      { op: "pp_delta", amount: 1, target: "self", scope: "all" },
      stage(3, 1),
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("先制+3；30%使对手麻痹；随机自身2项属性+1", () => {
    const r = parseEffectText("先制+3；30%使对手麻痹；随机自身2项属性+1") as any;
    expect(r.flags).toEqual({ priority: 3 });
    expect(r.effects).toEqual([
      { op: "apply_status", name: "paralysis", target: "opponent", chance: 30 },
      stage(2, 1),
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("随机自身3项属性+1；下3回合受到致命伤害时残留1点体力", () => {
    expect(fx("随机自身3项属性+1；下3回合受到致命伤害时残留1点体力")).toEqual([
      stage(3, 1),
      { op: "apply_status", name: "endure", target: "self", params: { hp: 1 }, turns: 3 },
    ]);
  });
  it("先制+1；随机自身3项属性+1；若对手体力不足300则直接秒杀", () => {
    const r = parseEffectText("先制+1；随机自身3项属性+1；若对手体力不足300则直接秒杀") as any;
    expect(r.flags).toEqual({ priority: 1 });
    expect(r.effects).toEqual([
      stage(3, 1),
      { op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 300 } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("3回合内对手释放技能所消耗的PP为2倍；随机自身3项属性+1", () => {
    expect(fx("3回合内对手释放技能所消耗的PP为2倍；随机自身3项属性+1")).toEqual([
      { op: "apply_status", name: "pp_double", target: "opponent", params: { mul: 2 }, turns: 3 },
      stage(3, 1),
    ]);
  });
  it("随机对手3项能力值-2 / 随机自己一项属性＋1", () => {
    expect(fx("随机对手3项能力值-2")).toEqual([stage(3, -2, "opponent")]);
    expect(fx("随机自己一项属性＋1")).toEqual([stage(1, 1)]);
  });
  it("无主语随机多维弱化收编（原作语义=随机N项）", () => {
    // "使对手N项能力值-1" —— 原作中未指名维度的 N 项即随机选取
    expect(fx("使对手3项能力值-1")).toEqual([{ op: "apply_stat_stage", stat: "random", randomCount: 3, delta: -1, target: "opponent" }]);
    expect(un("使对手3项能力值-1")).toEqual([]);
    expect(fx("使对手三项能力值-1并附加到自己身上")).toEqual([{ op: "transfer_stages", randomCount: 3, randomDelta: 1 }]);
    expect(un("使对手三项能力值-1并附加到自己身上")).toEqual([]);
    const steal = parseEffectText("随机对手2项属性-2并反转属性能力") as any;
    expect(steal.effects).toEqual([]);
    expect(fx("随机使自己3项能力+2")).toEqual([stage(3, 2)]);
  });
});

describe("parser: 几率倍数 / 属性技能失效 / 随机 PP 变 0", () => {
  it("9%的几率造成9倍伤害 → mulChance 9×9", () => {
    expect(ad("9%的几率造成9倍伤害").mulChance).toEqual({ chance: 9, numerator: 9, denominator: 1 });
  });
  it("9%的几率造成4倍伤害", () => {
    expect(ad("9%的几率造成4倍伤害").mulChance).toEqual({ chance: 9, numerator: 4, denominator: 1 });
  });
  it("10%的几率造成3倍伤害", () => {
    expect(ad("10%的几率造成3倍伤害").mulChance).toEqual({ chance: 10, numerator: 3, denominator: 1 });
  });
  it("40%的几率造成2倍伤害", () => {
    expect(ad("40%的几率造成2倍伤害").mulChance).toEqual({ chance: 40, numerator: 2, denominator: 1 });
  });
  it("9%的几率造成9倍伤害；造成伤害的49%恢复自身体力", () => {
    const r = parseEffectText("9%的几率造成9倍伤害；造成伤害的49%恢复自身体力") as any;
    expect(familyBag(r).mulChance).toEqual({ chance: 9, numerator: 9, denominator: 1 });
    expect(r.effects).toEqual([
      { op: "scale", of: "mulChance", value: { chance: 9, numerator: 9, denominator: 1 } },
      { op: "apply_status", name: "drain_atk", target: "self", params: { n: 49, d: 100 } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("每次使用几率增加不写进倍数（走 mulChancePerUse/mulChanceUseCap 独立通道）", () => {
    const r = parseEffectText("10%的几率造成3倍伤害，每次使用几率增加10%，最高几率30%") as any;
    expect(familyBag(r).mulChance).toEqual({ chance: 10, numerator: 3, denominator: 1 });
    expect(asRec(familyBag(r).mulChance).chancePerUse).toBeUndefined();
    expect(familyBag(r).mulChancePerUse).toBe(10);
    expect(familyBag(r).mulChanceUseCap).toBe(30);
    expect(r.unparsed).toEqual([]);
  });
  it("必中；反转自身能力下降状态；9%的几率造成4倍伤害，每次使用几率增加9％，最高几率27%", () => {
    const r = parseEffectText("必中；反转自身能力下降状态；9%的几率造成4倍伤害，每次使用几率增加9％，最高几率27%") as any;
    expect(r.flags.accuracy).toBe("always");
    expect(familyBag(r).mulChance).toEqual({ chance: 9, numerator: 4, denominator: 1 });
    expect(r.effects[0]).toEqual({ op: "scale", of: "mulChance", value: { chance: 9, numerator: 4, denominator: 1 } });
    expect(r.effects).toContainEqual({ op: "invert_stages", sign: "down", target: "self" });
  });
  it("先制+3；消除对手回合类效果，消除成功则攻击+2、速度+2；10%的几率造成3倍伤害", () => {
    const r = parseEffectText("先制+3；消除对手回合类效果，消除成功则攻击+2、速度+2；10%的几率造成3倍伤害，每次使用几率增加10％，最高几率30%") as any;
    expect(r.flags.priority).toBe(3);
    expect(familyBag(r).mulChance).toEqual({ chance: 10, numerator: 3, denominator: 1 });
  });
  it("造成2倍伤害（无概率）→ powerMul", () => {
    expect(ad("造成2倍伤害").powerMul).toEqual({ numerator: 2, denominator: 1 });
  });
  it("3回合内50%概率使对手的属性技能失效", () => {
    expect(fx("3回合内50%概率使对手的属性技能失效")).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, turns: 3, chance: 50 },
    ]);
  });
  it("全属性+1；4回合，每回合恢复1/3HP；3回合内50%概率使对手的属性技能失效", () => {
    const r = parseEffectText("全属性+1；4回合，每回合恢复1/3HP；3回合内50%概率使对手的属性技能失效") as any;
    expect(r.effects.at(-1)).toEqual({ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, turns: 3, chance: 50 });
    expect(r.unparsed).toEqual([]);
  });
  it("降低对手所有PP一点，并恢复自身所有PP一点；3回合内50%概率使对手的属性技能失效", () => {
    const r = parseEffectText("降低对手所有PP一点，并恢复自身所有PP一点；3回合内50%概率使对手的属性技能失效") as any;
    expect(r.effects.at(-1)).toEqual({ op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 }, turns: 3, chance: 50 });
    expect(r.effects.slice(0, 2)).toEqual([
      { op: "pp_delta", amount: -1, target: "opponent", scope: "all" },
      { op: "pp_delta", amount: 1, target: "self", scope: "all" },
    ]);
  });
  it("使对手的属性技能失效（无回合）不带次数", () => {
    expect(fx("使对手的属性技能失效")).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { cat: 1 } },
    ]);
  });
  it("使对手属性技能失效仍是一次次数制，不被新规则抢走", () => {
    expect(fx("使对手属性技能失效")).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { count: 1, cat: 1 } },
    ]);
  });
  it("50%的概率使对手的随机2项技能PP值变0", () => {
    expect(fx("50%的概率使对手的随机2项技能PP值变0")).toEqual([
      { op: "pp_delta", zeroRandom: 2, target: "opponent", chance: 50 },
    ]);
  });
  it("60%的概率使对手的随机1项技能PP值变0", () => {
    expect(fx("60%的概率使对手的随机1项技能PP值变0")).toEqual([
      { op: "pp_delta", zeroRandom: 1, target: "opponent", chance: 60 },
    ]);
  });
  it("30%的概率使对手的随机3项技能PP值变0", () => {
    expect(fx("30%的概率使对手的随机3项技能PP值变0")).toEqual([
      { op: "pp_delta", zeroRandom: 3, target: "opponent", chance: 30 },
    ]);
  });
  it("使对手的随机1项技能PP值变0 / 2项", () => {
    expect(fx("使对手的随机1项技能PP值变0")).toEqual([{ op: "pp_delta", zeroRandom: 1, target: "opponent" }]);
    expect(fx("使对手的随机2项技能PP值变0")).toEqual([{ op: "pp_delta", zeroRandom: 2, target: "opponent" }]);
  });
  it("将下一次受到的伤害的80%反馈给对手；50%的概率使对手的随机2项技能PP值变0", () => {
    expect(fx("将下一次受到的伤害的80%反馈给对手；50%的概率使对手的随机2项技能PP值变0")).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 80, d: 100, count: 1 } },
      { op: "pp_delta", zeroRandom: 2, target: "opponent", chance: 50 },
    ]);
  });
  it("使对手下2回合先制-1；60%的概率使对手的随机1项技能PP值变0", () => {
    expect(fx("使对手下2回合先制-1；60%的概率使对手的随机1项技能PP值变0")).toEqual([
      { op: "apply_status", name: "prio_up", target: "opponent", turns: 2, params: { add: -1 } },
      { op: "pp_delta", zeroRandom: 1, target: "opponent", chance: 60 },
    ]);
  });
  it("归零句式和没有「随机」的归 0 不被这条抢走", () => {
    expect(fx("使对手随机2项技能PP值归零")).toEqual([{ op: "pp_delta", zeroRandom: 2, target: "opponent" }]);
    expect(un("30%几率令对手3项技能PP归0")).toEqual([{ clause: "30%几率令对手3项技能PP归0", reason: "no-rule" }]);
  });
});

describe("parser: 无视对手速度", () => {
  const ig = (t: string) => (parseEffectText(t) as any).flags.ignoreFoeSpeed;

  it("残句本身 → ignoreFoeSpeed", () => {
    const r = parseEffectText("无视对手速度") as any;
    expect(r.flags).toEqual({ ignoreFoeSpeed: true });
    expect(r.effects).toEqual([]);
    expect(r.unparsed).toEqual([]);
  });
  it("无视对手速度以及防御能力强化状态 → ignoreFoeSpeed + pierce_stages", () => {
    const r = parseEffectText("无视对手速度以及防御能力强化状态") as any;
    expect(ig("无视对手速度以及防御能力强化状态")).toBe(true);
    expect(r.effects).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("以及防御能力强化（无「状态」）", () => {
    const r = parseEffectText("无视对手速度以及防御能力强化") as any;
    expect(r.flags.ignoreFoeSpeed).toBe(true);
    expect(r.unparsed).toEqual([{ clause: "防御能力强化", reason: "no-rule" }]);
  });
  it("以及防御能力提升状态", () => {
    const r = parseEffectText("无视对手速度以及防御能力提升状态") as any;
    expect(r.flags.ignoreFoeSpeed).toBe(true);
    expect(r.effects).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("先制+2；以及所有防御能力强化状态", () => {
    const r = parseEffectText("先制+2；无视对手速度以及所有防御能力强化状态") as any;
    expect(r.flags).toEqual({ priority: 2, ignoreFoeSpeed: true });
    expect(r.effects).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("先制+2，以及防御能力强化状态（逗号）", () => {
    const r = parseEffectText("先制+2，无视对手速度以及防御能力强化状态") as any;
    expect(r.flags).toEqual({ priority: 2, ignoreFoeSpeed: true });
    expect(r.effects).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("顿号切开防御强化，秒杀仍在", () => {
    const r = parseEffectText("无视对手速度、防御强化；对手体力低于200直接秒杀") as any;
    expect(r.flags.ignoreFoeSpeed).toBe(true);
    expect(r.effects).toEqual([{ op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 200 } }]);
    expect(r.unparsed).toEqual([{ clause: "防御强化", reason: "no-rule" }]);
  });
  it("先制+3 后反转能力提升", () => {
    const r = parseEffectText("先制+3；无视对手速度以及防御能力强化状态；反转对手能力提升") as any;
    expect(r.flags).toEqual({ priority: 3, ignoreFoeSpeed: true });
    expect(r.effects).toEqual([
      { op: "apply_status", name: "pierce_stages", target: "self" },
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("必中与消除回合类效果仍在", () => {
    const r = parseEffectText("必中；无视对手速度以及防御能力强化状态；消除对手回合类效果，消除成功则50%令对手失明，未触发则100%令对手焚烬") as any;
    expect(r.flags).toEqual({ accuracy: "always", ignoreFoeSpeed: true });
    expect(r.effects).toEqual([
      { op: "apply_status", name: "pierce_stages", target: "self" },
      { op: "cleanse", target: "opponent", scope: "timed" },
      { op: "apply_status", name: "blind", target: "opponent", chance: 50, if: { prevApplied: true } },
      { op: "apply_status", name: "ember", target: "opponent", chance: 100, if: { not: { prevApplied: true } } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("威力翻倍仍是 mulChance，条件概率提升挂 chanceMulIf", () => {
    const r = parseEffectText("无视对手速度以及防御能力强化状态；30%概率威力翻倍，体力低于1/2时概率提升50%") as any;
    expect(r.flags.ignoreFoeSpeed).toBe(true);
    expect(familyBag(r).mulChance).toEqual({
      chance: 30, numerator: 2, denominator: 1,
      chanceMulIf: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 150, denominator: 100 },
    });
    expect(r.unparsed).toEqual([]);
  });
  it("随机异常旁边的裸「无视对手」不抢走", () => {
    const r = parseEffectText("令对手随机进入烧伤、冻伤、中毒、麻痹、害怕、睡眠中的一种异常状态；无视对手；无视对手速度以及防御能力强化状态") as any;
    expect(r.flags.ignoreFoeSpeed).toBe(true);
    expect(r.effects).toEqual([
      {
        op: "apply_status", name: "random", target: "opponent",
        random: { list: ["burn", "frostbite", "poison", "paralysis", "fear", "sleep"], count: 1 },
      },
      { op: "apply_status", name: "pierce_stages", target: "self" },
    ]);
    expect(r.unparsed).toEqual([{ clause: "无视对手", reason: "no-rule" }]);
  });
  it("及/和粘连三句发齐两个格子；带概率、速度能力提升仍不写成排序旗标", () => {
    // 「及/和」粘连的三句已由 r2d-pierce-speed-01/02 整句落地（两个格子都发：ignoreFoeSpeed + pierce_stages）。
    // 这道哨兵防的是「旗标单独命中、穿强化没跟上」的半个匹配——下面用例改成断言两个格子都在；
    // 带概率的「50%概率无视对手速度」与「无视对手速度能力提升状态」仍按原样保持 no-rule。
    for (const t of [
      "无视对手速度及防御强化；遇到天敌附加160固伤",
      "无视对手速度和防御能力强化状态",
      "无视对手速度和防御能力提升",
      "50%概率无视对手速度",
      "无视对手速度能力提升状态",
    ]) {
      if (/无视(对手|对方|敌方)速度(及|和|与)/.test(t)) continue; // 这三句的旗标断言在下面（成对出现）
      expect(ig(t), t).toBeUndefined();
    }
    expect(ig("无视对手速度和防御能力强化状态")).toBe(true);
    expect(fx("无视对手速度和防御能力强化状态")).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(ig("无视对手速度和防御能力提升")).toBe(true);
    expect(fx("无视对手速度和防御能力提升")).toEqual([{ op: "apply_status", name: "pierce_stages", target: "self" }]);
    expect(un("无视对手速度和防御能力强化状态")).toEqual([]);
    expect(un("无视对手速度和防御能力提升")).toEqual([]);
    expect(un("50%概率无视对手速度")).toEqual([{ clause: "50%概率无视对手速度", reason: "no-rule" }]);
    expect(un("无视对手速度能力提升状态")).toEqual([{ clause: "无视对手速度能力提升状态", reason: "no-rule" }]);
    // 「遇到天敌」= foeCountersUs 已落地（"遇到天敌威力翻倍"→scaleIf×2 同条件通道）——后半句不受本路影响
    expect(ig("无视对手速度及防御强化；遇到天敌附加160固伤")).toBe(true);
    expect(fx("无视对手速度及防御强化；遇到天敌附加160固伤")).toEqual([
      { op: "flat", of: "flatIf", value: { when: { foeCountersUs: true }, flat: 160 } },
      { op: "apply_status", name: "pierce_stages", target: "self" },
    ]);
    expect(un("无视对手速度及防御强化；遇到天敌附加160固伤")).toEqual([]);
    expect(familyBag(parseEffectText("无视对手速度及防御强化；遇到天敌附加160固伤") as any).flatIf)
      .toEqual({ when: { foeCountersUs: true }, flat: 160 });
  });
});

describe("parser: 防御、特防总和固定伤害", () => {
  const sum = (t: string) => familyBag(parseEffectText(t) as any).flatSelfDefSumPct;

  it("附加防御、特防总和10%的固定伤害", () => {
    const r = parseEffectText("附加防御、特防总和10%的固定伤害") as any;
    expect(sum("附加防御、特防总和10%的固定伤害")).toBe(10);
    expect(r.effects).toEqual([{ op: "flat", of: "flatSelfDefSumPct", value: 10 }]);
    expect(r.unparsed).toEqual([]);
  });
  it("附加自身防御、特防总和30%", () => {
    expect(sum("附加自身防御、特防总和30%的固定伤害")).toBe(30);
    expect(un("附加自身防御、特防总和30%的固定伤害")).toEqual([]);
  });
  it("附加自身防御、特防总和20%", () => {
    expect(sum("附加自身防御、特防总和20%的固定伤害")).toBe(20);
  });
  it("附加防御、特防总和20%", () => {
    expect(sum("附加防御、特防总和20%的固定伤害")).toBe(20);
  });
  it("附加自身防御、特防总和25%", () => {
    expect(sum("附加自身防御、特防总和25%的固定伤害")).toBe(25);
  });
  it("必中；消除对手回合类效果；附加防御、特防总和10%的固定伤害", () => {
    const r = parseEffectText("必中；消除对手回合类效果；附加防御、特防总和10%的固定伤害") as any;
    expect(r.flags).toEqual({ accuracy: "always" });
    expect(r.effects).toEqual([
      { op: "flat", of: "flatSelfDefSumPct", value: 10 },
      { op: "cleanse", target: "opponent", scope: "timed" },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("必中；附加防御、特防总和10%；20%睡眠", () => {
    const r = parseEffectText("必中；附加防御、特防总和10%的固定伤害；20%使对手睡眠") as any;
    expect(familyBag(r).flatSelfDefSumPct).toBe(10);
    expect(r.effects).toEqual([
      { op: "flat", of: "flatSelfDefSumPct", value: 10 },
      { op: "apply_status", name: "sleep", target: "opponent", chance: 20 },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("消除成功吸取与双防总和分句", () => {
    const r = parseEffectText("必中；消除对手回合类效果，消除成功则吸取对手最大体力的1/3；附加自身防御、特防总和30%的固定伤害") as any;
    expect(familyBag(r).flatSelfDefSumPct).toBe(30);
    expect(r.effects[0]).toEqual({ op: "cleanse", target: "opponent", scope: "timed" });
    expect(r.unparsed).toEqual([]);
  });
  it("防御、特防+1 仍是两段强化，不被总和规则抢走", () => {
    const r = parseEffectText("先制+3；消除对手能力提升状态，消除成功则自身防御、特防+1；附加自身防御、特防总和30%的固定伤害") as any;
    expect(r.flags.priority).toBe(3);
    expect(familyBag(r).flatSelfDefSumPct).toBe(30);
    expect(r.effects).toEqual([
      { op: "flat", of: "flatSelfDefSumPct", value: 30 },
      { op: "clear_stages", target: "opponent", sign: "up" },
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self", if: { prevApplied: true } },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self", if: { prevApplied: true } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("解除弱化后的 25% 总和", () => {
    const r = parseEffectText("必中；解除自身能力下降效果，解除成功则下1回合先制+3；附加自身防御、特防总和25%的固定伤害") as any;
    expect(r.flags.accuracy).toBe("always");
    expect(familyBag(r).flatSelfDefSumPct).toBe(25);
    expect(r.effects).toEqual([
      { op: "flat", of: "flatSelfDefSumPct", value: 25 },
      { op: "clear_stages", target: "self", sign: "down" },
      { op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: 3 }, if: { prevApplied: true } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("下N回合限时窗的总和折算限时 dmg_flat；带速度的总和仍不拼", () => {
    // 限时窗合并后折算 dmg_flat{defSumPct}——固伤随回合窗过期，不落成常驻 attachDamage
    const timed = parseEffectText("下3回合，自身攻击伤害附加防御、特防总和30%的固定伤害") as any;
    expect(timed.flags.attachDamage).toBeUndefined();
    expect(timed.effects).toEqual([{ op: "apply_status", name: "dmg_flat", target: "self", turns: 3, params: { defSumPct: 30 } }]);
    expect(timed.unparsed).toEqual([]);
    // 三属性总和（含速度）经 flatSelfStatPct{stats[]} 复刻——枚举合段 + 多属性缩放固伤通道
    const tri = parseEffectText("附加自身防御、特防和速度总和20%的固定伤害") as any;
    expect(familyBag(tri).flatSelfStatPct).toEqual({ stats: ["def", "sdf", "spd"], pct: 20 });
    expect(tri.unparsed).toEqual([]);
    const gated = parseEffectText("先出手时令对手随机进入1种控制类异常状态，附加自身防御、特防总和50%的固定伤害，击败对手则对手下只出场精灵2回合内先制-1") as any;
    // 双防总和 50% 固伤合段后进 attachDamage.flatSelfDefSumPct；下只先制-1 经 nextFoe 复刻（先出手+击败复合门控）
    expect(familyBag(gated).flatSelfDefSumPct).toBe(50);
    expect(gated.effects).toContainEqual({ op: "apply_status", name: "prio_up", target: "nextFoe", turns: 2, params: { add: -1 }, if: { and: [{ order: "first" }, { foeFainted: true }] } });
    expect(gated.unparsed).toEqual([
      { clause: "令对手随机进入1种控制类异常状态", reason: "control/weaken-class ailment subset undocumented (UNVERIFIED)" },
    ]);
  });
});

describe("parser: 任意异常时全额恢复", () => {
  const drainIf = { when: { foeStatused: true }, numerator: 1, denominator: 1 };
  const rider = { op: "applyDrainRider", drainIf };

  it("对手处于任意异常状态时造成的伤害将全额恢复体力", () => {
    const r = parseEffectText("对手处于任意异常状态时造成的伤害将全额恢复体力") as any;
    expect(r.effects).toEqual([rider]);
    expect(r.flags.attachDamage).toBeUndefined();
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("任意异常");
  });
  it("必中；对手处于任意异常状态时造成的伤害将全额恢复体力", () => {
    const r = parseEffectText("必中；对手处于任意异常状态时造成的伤害将全额恢复体力") as any;
    expect(r.flags).toEqual({ accuracy: "always" });
    expect(r.effects).toEqual([rider]);
    expect(r.unparsed).toEqual([]);
  });
  it("属性技能则害怕，再全额恢复", () => {
    const r = parseEffectText("5回合内若对手使用属性技能则对手100%害怕；对手处于任意异常状态时造成的伤害将全额恢复体力") as any;
    expect(r.flags.attachDamage).toBeUndefined();
    expect(r.effects).toEqual([rider, {
      op: "apply_status", name: "react", target: "self", turns: 5,
      params: { trigger: 3, cat: 1 },
      payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 100 }],
    }]);
    expect(r.unparsed).toEqual([]);
  });
  it("令对手害怕的同义句", () => {
    const r = parseEffectText("5回合内若对手使用属性技能则100%令对手害怕；对手处于任意异常状态时造成的伤害将全额恢复体力") as any;
    expect(r.effects[0]).toEqual(rider);
    expect(r.effects[1].payload).toEqual([{ op: "apply_status", name: "fear", target: "opponent", chance: 100 }]);
    expect(r.unparsed).toEqual([]);
  });
  it("吸取成功后恢复，再全额恢复", () => {
    const r = parseEffectText("先制+3；吸取对手能力提升状态，吸取成功则恢复自身最大体力的1/3；对手处于任意异常状态时造成的伤害将全额恢复体力") as any;
    expect(r.flags.priority).toBe(3);
    expect(r.flags.attachDamage).toBeUndefined();
    expect(r.effects).toEqual([
      rider,
      { op: "transfer_stages", direction: "steal", sign: "up" },
      { op: "heal", numerator: 1, denominator: 3, target: "self", if: { prevApplied: true } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("消除成功则全属性+1；没有「将」的全额恢复", () => {
    const r = parseEffectText("先制+3；消除对手回合类效果，消除成功则自身全属性+1；对手处于任意异常状态时造成的伤害全额恢复体力") as any;
    expect(r.flags.priority).toBe(3);
    expect(r.effects[0]).toEqual(rider);
    expect(r.effects[1]).toEqual({ op: "cleanse", target: "opponent", scope: "timed" });
    expect(r.effects).toHaveLength(7);
    expect(r.unparsed).toEqual([]);
  });
  it("害怕或中毒，全额恢复，满体力必暴", () => {
    const r = parseEffectText("必中；消除对手回合类效果，消除成功则50%令对手害怕，未触发则100%令对手中毒；对手处于任意异常状态时造成的伤害将全额恢复体力；出手时若自身满体力则100%打出致命一击") as any;
    expect(r.flags.accuracy).toBe("always");
    expect(familyBag(r).critChanceIf).toEqual({ when: { selfHpFull: true }, chance: 100 });
    expect(r.effects).toEqual([
      { op: "crit", of: "critChanceIf", value: { when: { selfHpFull: true }, chance: 100 } },
      rider,
      { op: "cleanse", target: "opponent", scope: "timed" },
      { op: "apply_status", name: "fear", target: "opponent", chance: 50, if: { prevApplied: true } },
      { op: "apply_status", name: "poison", target: "opponent", chance: 100, if: { not: { prevApplied: true } } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
});

// ── 复刻批 bug 回归（docs/remaining-replication-plan.md 末批 A–D + 封顶尾通道）──
describe("replication bugs A–D + per-use cap tails", () => {
  // Bug A：整句条件泄漏到后一反条件子句 → and[X, not X]（74 招永不触发）
  it("A 若先出手…；若后出手… → 各自 order 谓词，不交 and", () => {
    const r = parseEffectText("若先出手则使对手麻痹；若后出手则自身攻击+1") as any;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "paralysis", target: "opponent", if: { order: "first" } },
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self", if: { order: "last" } },
    ]);
    expect(JSON.stringify(r.effects)).not.toContain('"and"');
  });
  // Bug B：condOf 把"自身处于能力强化状态"解析成名为"能力强化"的印记 → 必须先走 stage/timed 谓词
  it("B 自身/对手处于能力强化状态 → selfStageUp/foeStageUp，非具名印记", () => {
    const self = parseEffectText("自身处于能力强化状态则威力提升50%") as any;
    expect(asRec(familyBag(self).mulIf).when).toEqual({ selfStageUp: true });
    const foe = parseEffectText("对手处于能力强化状态则威力提升50%") as any;
    expect(asRec(familyBag(foe).mulIf).when).toEqual({ foeStageUp: true });
    expect(JSON.stringify({ self, foe })).not.toContain("能力强化");
  });
  it("B 自身处于能力下降状态 → selfStageDown；对手处于回合类效果 → foeHasTimed", () => {
    const down = parseEffectText("自身处于能力下降状态则先制+1") as any;
    expect(down.flags.priorityIf.when).toEqual({ selfStageDown: true });
    const timed = parseEffectText("对手处于回合类效果则附加200点固定伤害") as any;
    expect(asRec(familyBag(timed).flatIf).when).toEqual({ foeHasTimed: true });
  });
  // Bug C：对手侧触发下"受到300点固定伤害"曾误挂自身 → 现在载荷 target=opponent
  it("C 对手使用攻击技能时受到300点固定伤害 → react 载荷打对手", () => {
    const r = parseEffectText("对手使用攻击技能时受到300点固定伤害") as any;
    const react = r.effects.find((e: any) => e.name === "react");
    expect(react.payload).toEqual([{ op: "damage", kind: "fixed", power: 300, target: "opponent" }]);
  });
  // Bug D：reactWrap 半解析时载荷残余必须进 unparsed，不得丢弃
  it("D react 载荷半解析 → 不识别部分进 unparsed", () => {
    const r = parseEffectText("对手使用攻击技能时自身防御+1并使对手3项能力值-1") as any;
    const react = r.effects.find((e: any) => e.name === "react");
    expect(react.payload).toEqual([
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "random", randomCount: 3, delta: -1, target: "opponent" },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  // 封顶尾通道：值载体不得静默吞掉——挂 growth 宿主或落孤儿残留
  it("连续使用威力增加25%，最高增加100% → powerMulPerUse + powerMulPerUseCap", () => {
    const r = parseEffectText("连续使用威力增加25%，最高增加100%") as any;
    expect(familyBag(r).powerMulPerUse).toEqual({ numerator: 125, denominator: 100 });
    expect(familyBag(r).powerMulPerUseCap).toEqual({ numerator: 200, denominator: 100 });
    expect(r.unparsed).toEqual([]);
  });
  it("30%令对手麻痹，每次使用概率增加20%，最高概率100% → chancePerUse/Cap 挂状态条目", () => {
    const r = parseEffectText("30%令对手麻痹，每次使用概率增加20%，最高概率100%") as any;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "paralysis", target: "opponent", chance: 30, chancePerUse: 20, chancePerUseCap: 100 },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("每次使用增加50点固定伤害，最高400点 → flatPerUse + flatPerUseCap", () => {
    const r = parseEffectText("每次使用增加50点固定伤害，最高400点") as any;
    expect(familyBag(r).flatPerUse).toBe(50);
    expect(familyBag(r).flatPerUseCap).toBe(400);
    expect(r.unparsed).toEqual([]);
  });
  // hits perUse 合并：不得用 {min:1,max:1} 浅合并覆盖基准攻击次数
  it("连续攻击4次，每次攻击次数+1，最多8次 → hits{min:4,max:4,perUse:1,cap:8}", () => {
    const r = parseEffectText("消强化，连续攻击对手4次，每次攻击次数+1，最多8次") as any;
    expect(familyBag(r).hits).toEqual({ min: 4, max: 4, perUse: 1, cap: 8 });
  });
  // e41：条件分数换档 / 威力门控反应 / 概率免疫窗 / 随机连击 / 敌我双方异常
  it("吸取1/4，自身体力低于对手时变为1/3 → fracIf 条件分数", () => {
    const r = parseEffectText("吸取对手最大体力的1/4，自身体力低于对手时变为1/3") as any;
    expect(r.effects[1]).toEqual({ op: "formula", of: "fracIf", value: { when: { selfHpBelowFoe: true }, numerator: 1, denominator: 3 } });
    expect(r.effects[3].fracIf).toEqual({ when: { selfHpBelowFoe: true }, numerator: 1, denominator: 3 });
    expect(r.unparsed).toEqual([]);
  });
  it("若下次对手使用的攻击技能威力大于120则免疫此次攻击 → react trigger3 powerMin:121", () => {
    const r = parseEffectText("若下次对手使用的攻击技能威力大于120，则免疫此次攻击") as any;
    const react = r.effects.find((e: any) => e.name === "react");
    expect(react.params).toMatchObject({ trigger: 3, powerMin: 121 });
    expect(react.payload).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }]);
    expect(r.unparsed).toEqual([]);
  });
  it("每回合有60%几率免疫当回合受到的攻击伤害 → dmg_immune{chance:60}", () => {
    const r = parseEffectText("每回合有60%的几率免疫当回合受到的攻击伤害") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", params: { chance: 60 } }]);
    expect(r.unparsed).toEqual([]);
  });
  it("随机做10-13次攻击 → hits{min:10,max:13}", () => {
    const r = parseEffectText("随机做10-13次攻击") as any;
    expect(familyBag(r).hits).toEqual({ min: 10, max: 13 });
  });
  it("使敌我双方同时冻伤3回合 → 双条 frostbite", () => {
    const r = parseEffectText("使敌我双方同时冻伤3回合") as any;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "frostbite", target: "self", turns: 3 },
      { op: "apply_status", name: "frostbite", target: "opponent", turns: 3 },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("使用时若有一方处于烧伤状态则必定威力翻倍 → scaleIf or(selfHas,foeHas)", () => {
    const r = parseEffectText("使用时若有一方处于烧伤状态，则必定威力翻倍") as any;
    expect(familyBag(r).scaleIf).toEqual({ when: { or: [{ selfHas: "burn" }, { foeHas: "burn" }] }, numerator: 2, denominator: 1 });
    expect(r.unparsed).toEqual([]);
  });
  it("攻击+2，自身当前体力若低于对手则强化效果翻倍 → deltaMulIf selfHpBelowFoe", () => {
    const r = parseEffectText("攻击+2，自身当前体力若低于对手则强化效果翻倍") as any;
    expect(r.effects[0]).toMatchObject({ op: "apply_stat_stage", stat: "atk", delta: 2, deltaMulIf: { when: { selfHpBelowFoe: true }, numerator: 2, denominator: 1 } });
    expect(r.unparsed).toEqual([]);
  });
  it("消耗自身所有体力给对手造成300-400点伤害，若造成伤害大于对手体力则对手必定留1点血", () => {
    const r = parseEffectText("消耗自身所有体力给对手造成300-400点伤害,若造成伤害大于对手体力,则对手必定留1点血") as any;
    expect(r.effects.find((e: { op?: string; of?: string }) => e.op === "flat" && e.of === "flatRange")?.value).toEqual({ min: 300, max: 400 });
    expect(familyBag(r).leaveHp).toBe(1);
    expect(r.unparsed).toEqual([]);
  });
  // e42：timed 净化锁 / 列表解除 / 承伤定额减免 / 几率句家族 / 承伤吸血分数形
  it("自身的回合类效果无法被消除 → timed_lock", () => {
    const r = parseEffectText("自身的回合类效果无法被消除") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "timed_lock", target: "self" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("解除自身烧伤、冻伤、中毒状态 → cleanse ailment effect名单", () => {
    const r = parseEffectText("解除自身烧伤、冻伤、中毒状态") as any;
    expect(r.effects).toEqual([{ op: "cleanse", scope: "ailment", target: "self", effect: ["burn", "frostbite", "poison"] }]);
    expect(r.unparsed).toEqual([]);
  });
  it("每回合受到伤害减100 → dmg_reduce flat", () => {
    const r = parseEffectText("每回合受到伤害减100") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 100 } }]);
    expect(r.unparsed).toEqual([]);
  });
  it("50%几率对手害怕1到3回合 → turnsRange + dynChance 注入", () => {
    const r = parseEffectText("50%几率对手害怕1到3回合") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "fear", target: "opponent", turnsRange: { min: 1, max: 3 }, chance: 50 }]);
    expect(r.unparsed).toEqual([]);
  });
  it("50%几率对方减血1/4 → percent damage + chance", () => {
    const r = parseEffectText("50%几率对方减血1/4") as any;
    expect(r.effects).toEqual([
      { op: "damage", kind: "percent", power: 1, target: "opponent", chance: 50 },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 4 } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("对方造成伤害的1/2恢复自身体力 → dmg_to_heal{n,d}", () => {
    const r = parseEffectText("对方造成伤害的1/2恢复自身体力") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "dmg_to_heal", target: "self", params: { n: 1, d: 2 } }]);
    expect(r.unparsed).toEqual([]);
  });
  it("对手的能力提升效果变能力下降 → invert_stages", () => {
    const r = parseEffectText("对手的能力提升效果变能力下降") as any;
    expect(r.effects).toEqual([{ op: "invert_stages", sign: "up", target: "opponent" }]);
    expect(r.unparsed).toEqual([]);
  });
  it("为自身附加等同于双方最大体力差值的护盾 → flatMaxHpDiff", () => {
    const r = parseEffectText("为自身附加等同于双方最大体力差值的护盾") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "shield", target: "self", params: { flatMaxHpDiff: 1 } }]);
    expect(r.unparsed).toEqual([]);
  });
  it("使用成功时速度20%+1 → chance 中嵌 stat", () => {
    const r = parseEffectText("使用成功时速度20%+1") as any;
    expect(r.effects).toEqual([{ op: "apply_stat_stage", stat: "spd", delta: 1, target: "self", chance: 20 }]);
    expect(r.unparsed).toEqual([]);
  });
  // ── e43 ──
  it("连击成长+上限 → hits{min,max,growPerHit,cap}", () => {
    const r = parseEffectText("连击5次，每次命中后连击数+1，最高连击10次") as any;
    expect(familyBag(r).hits).toEqual({ min: 5, max: 5, growPerHit: 1, cap: 10 });
    expect(r.unparsed).toEqual([]);
  });
  it("耗盾条件分支 → flatSelfFracIf + heal and 门控", () => {
    const r = parseEffectText("消耗自身所有护盾值并造成等量固定伤害，若消耗的护盾值大于300则额外附加自身最大体力1/3的百分比伤害，小于300且大于0则恢复自身最大体力的1/3并造成等量百分比伤害") as any;
    expect(r.effects[0]).toMatchObject({ op: "damage", kind: "fixed" });
    expect(r.effects[2]).toEqual({ op: "strike", of: "consumeShield", value: true });
    expect(r.effects[3]).toMatchObject({ op: "heal", numerator: 1, denominator: 3, if: { and: [{ shieldConsumedBelow: 300 }, { shieldConsumedAbove: 0 }] } });
    expect(familyBag(r).flatSelfFracIf).toMatchObject({ when: { shieldConsumedAbove: 300 }, numerator: 1, denominator: 3 });
    expect(r.unparsed).toEqual([]);
  });
  it("免疫并反弹固定+百分比伤害 → dmg_immune+reflect_dmg kindMask:3", () => {
    const r = parseEffectText("4回合内免疫并反弹自身受到的固定伤害和百分比伤害") as any;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self", turns: 4, params: { kindMask: 3 } },
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, kindMask: 3 } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("消耗自身当前最大体力1/2并使对手受到等量百分比伤害 → selfCostEcho", () => {
    const r = parseEffectText("消耗自身当前最大体力的1/2并使对手受到等量百分比伤害") as any;
    expect(r.effects).toEqual([
      { op: "damage", power: 0, kind: "percent", target: "self" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 2 } },
      { op: "applySelfCostEcho", selfCostEcho: true },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("每转移一项吸取N点体力 → transfer_ailments.drainPer", () => {
    const r = parseEffectText("将对手所处的异常状态转移给自身，每转移一项吸取对手404点体力") as any;
    expect(r.effects).toEqual([{ op: "transfer_ailments", direction: "pull", target: "opponent", drainPer: 404 }]);
    expect(r.unparsed).toEqual([]);
  });
  it("烧伤转化为焚烬 → 条件 ember + cleanse burn", () => {
    const r = parseEffectText("将对手所处的烧伤转化为焚烬") as any;
    expect(r.effects).toEqual([
      { op: "apply_status", name: "ember", target: "opponent", if: { foeHas: "burn" } },
      { op: "cleanse", scope: "ailment", target: "opponent", effect: ["burn"] },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("当对方强化效果消失时X → react trigger17", () => {
    const r = parseEffectText("当对方强化效果消失时，消除对手回合类效果") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "react", target: "self", params: { trigger: 17 }, payload: [{ op: "cleanse", target: "opponent", scope: "timed" }] }]);
    expect(r.unparsed).toEqual([]);
  });
  it("裸触发词独句 → dynTrigger 悬空审计", () => {
    const r = parseEffectText("对方强化效果消失") as any;
    expect(r.unparsed.map((u: { clause: string }) => u.clause)).toEqual(["<dynTrigger>"]);
  });
  it("几率等同于自身当前体力百分比 → chanceSelfCurPct", () => {
    const r = parseEffectText("出手时有几率使对手害怕，几率等同于出手时自身当前体力百分比") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "fear", target: "opponent", params: {}, chanceSelfCurPct: true }]);
    expect(r.unparsed).toEqual([]);
  });
  it("被攻击伤害不超过N → dmg_cap；对手N回合内无法行动 → stun turns", () => {
    const r = parseEffectText("被攻击伤害不超过250") as any;
    expect(r.effects).toEqual([{ op: "apply_status", name: "dmg_cap", target: "self", params: { cap: 250 } }]);
    const r2 = parseEffectText("对手3回合内无法行动") as any;
    expect(r2.effects).toEqual([{ op: "control", name: "stun", target: "opponent", turns: 3 }]);
    expect(r2.unparsed).toEqual([]);
  });

  it("e44: 恢复N/M体力值 / 区间回复 / 清强化", () => {
    expect(parseEffectText("恢复自身1/3体力值").effects).toEqual([{ op: "heal", numerator: 1, denominator: 3, target: "self" }]);
    expect(parseEffectText("随机回复100~200点HP").effects).toEqual([{ op: "heal", flatRange: { min: 100, max: 200 }, target: "self" }]);
    expect(parseEffectText("消除自身能力提升状态").effects).toEqual([{ op: "clear_stages", target: "self", sign: "up" }]);
    expect(parseEffectText("清除对方能力提升的效果").effects).toEqual([{ op: "clear_stages", target: "opponent", sign: "up" }]);
  });
  it("e44: 强化转移 / 体力压为N / 己方下N回合必致命", () => {
    expect(parseEffectText("将对手的能力强化效果转移到自己身上").effects).toEqual([{ op: "transfer_stages", direction: "steal", sign: "up" }]);
    expect(parseEffectText("将自身当前体力降低为1").effects).toEqual([
      { op: "damage", kind: "fixed", power: 0, target: "self" },
      { op: "cap", of: "leaveHp", value: 1 },
    ]);
    expect(parseEffectText("使己方下3回合攻击必定致命").effects).toEqual([{ op: "apply_status", name: "crit_always", target: "self", turns: 3 }]);
  });
  it("e44: 恢复效果削减 / 固定+百分比转护罩 kindMask / 枚举异常池", () => {
    expect(parseEffectText("对手3回合内体力恢复效果减少50%").effects).toEqual([{ op: "apply_status", name: "heal_cut", target: "opponent", turns: 3, params: { pct: 50 } }]);
    expect(parseEffectText("将自身下2次受到的固定伤害和百分比伤害转化为等量护罩").effects).toEqual([{ op: "apply_status", name: "dmg_to_shield", target: "self", params: { count: 2, kindMask: 3 } }]);
    const r = parseEffectText("使对手随机进入烧伤、冻伤、中毒、害怕、疲惫、麻痹其中1种异常状态") as any;
    expect(r.effects[0].random.list).toEqual(["burn", "frostbite", "poison", "fear", "fatigue", "paralysis"]);
    expect(r.effects[0].random.count).toBe(1);
  });
  it("e44: maxhp_tick chance / 伤害若低于N 谓词 / 双方任意一方能力下降 / 附加N%几率前缀", () => {
    expect(parseEffectText("每回合有50%的几率降低对手最大HP的1/4").effects).toEqual([{ op: "apply_status", name: "periodic", target: "opponent", params: { win: 20, chance: 50 }, payload: [{ op: "apply_status", name: "max_hp_down", target: "opponent", accFlat: true, params: { fracFoeMaxHpN: 1, fracFoeMaxHpD: 4 } }] }]);
    expect(parseEffectText("造成的攻击伤害若低于300则恢复自身200点体力").effects).toEqual([{ op: "heal", flat: 200, target: "self", if: { prevDamageBelowAbs: 300 } }]);
    const r = parseEffectText("双方任意一方处于能力下降状态均会附加200点固定伤害") as any;
    expect(familyBag(r).flatIf).toMatchObject({ flat: 200, when: { or: [{ selfStageDown: true }, { foeStageDown: true }] } });
    expect(parseEffectText("额外附加100%几率令对手害怕").effects).toEqual([{ op: "apply_status", name: "fear", target: "opponent", chance: 100 }]);
  });
  it("e44: benchAliveEq / 每回合清负压对手 / 吸取后条件延续", () => {
    const r = parseEffectText("自身为己方最后1只存活精灵时先制+3") as any;
    expect(r.flags.priorityIf).toMatchObject({ when: { benchAliveEq: 0 }, add: 3 });
    expect(parseEffectText("每回合解除自身能力下降状态并附加给对手相同的能力下降状态").effects).toEqual([{ op: "apply_status", name: "periodic", target: "self", turns: 1, params: { win: 12 }, payload: [{ op: "transfer_stages", direction: "push", plain: true, noHooks: true }] }]);
    const r2 = parseEffectText("吸取后若对手体力未减少则延续至下回合") as any;
    expect(r2.unparsed.map((u: { clause: string }) => u.clause)).toEqual(["<attachAll extendTurnsIf>"]);
  });
  it("e45: 免疫成功吸血/反噬 / 双防条件护罩追加 / 能力等级全同谓词", () => {
    expect(parseEffectText("自身免疫下1次受到的异常状态，每次免疫成功吸取对手150点体力").effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", params: { count: 1, onImmuneDrain: 150 } },
    ]);
    const r = parseEffectText("免疫下2次自身受到的异常状态，每次免疫成功则在回合结束时附加150点真实伤害") as any;
    expect(r.effects[1]).toMatchObject({ name: "periodic", params: { win: 17, foeAlive: 1 }, payload: [{ op: "hp_delta", perImmuneFlat: 150, if: { immunedThisTurn: true } }] });
    const r2 = parseEffectText("使自身获得1个200点的护罩，若自身双防总和高于对手则额外获得50点") as any;
    expect(r2.effects[1]).toMatchObject({ name: "ward", params: { flat: 50 }, if: { selfDefSumAboveFoe: true } });
    expect(parseEffectText("双方6项能力等级状态全部相同时造成的攻击伤害翻倍").effects[0]?.if).toEqual({ stagesAllEqual: 6 });
  });
  it("e45: foeMoveCat 条件先制 / 场下死亡计费固伤 / 其他技能承伤翻倍 / zeroMaxPower", () => {
    const r = parseEffectText("对手选择攻击技能时此技能先制+3") as any;
    expect(r.flags.priorityIf).toMatchObject({ when: { foeMoveCat: "attack" }, add: 3 });
    const r2 = parseEffectText("对方场下每死亡一只精灵则附加给对手100点固定伤害") as any;
    expect(familyBag(r2).flatPerFoeDead).toEqual({ per: 1, add: 100 });
    expect(parseEffectText("使对手下回合受到其他技能的伤害翻倍").effects).toEqual([
      { op: "apply_status", name: "dmg_taken_up", target: "opponent", turns: 1, params: { pct: 100, excludeSelfMove: 1 } },
    ]);
    expect(parseEffectText("令对手威力最高的攻击技能PP值归零").effects).toEqual([{ op: "pp_delta", zeroMaxPower: true, target: "opponent" }]);
  });
  it("e46: drain_atk 变体 / 抵挡下N回合 / 裸减半 / 属性技快出手", () => {
    expect(parseEffectText("造成伤害的30%将恢复体力").effects).toEqual([{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 30, d: 100 } }]);
    expect(parseEffectText("可以抵挡下2回合对手的攻击伤害").effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", turns: 2 }]);
    expect(parseEffectText("特殊攻击减半").effects).toEqual([{ op: "apply_status", name: "spec_half", target: "self" }]);
    expect(parseEffectText("自身使用属性技能时能较快出手").effects).toEqual([{ op: "apply_status", name: "prio_up", target: "self", params: { add: 1, cat: 1 } }]);
  });
  it("e46: 熔句免疫+先制 / 降等级无符号 / 恢复Nhp / 满体力吸取反哺背包", () => {
    expect(parseEffectText("自身不受能力下降技能影响下3回合自身攻击先制+1").effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self", turns: 3 },
      { op: "apply_status", name: "prio_up", target: "self", turns: 3, params: { add: 1, cat: 4 } },
    ]);
    expect(parseEffectText("降低对方命中等级1").effects).toEqual([{ op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent" }]);
    expect(parseEffectText("恢复200hp").effects).toEqual([{ op: "heal", flat: 200, target: "self" }]);
    const r = parseEffectText("每回合吸取对手1/3最大体力，吸取时若自身满体力则为己方所有不在场精灵恢复100点体力") as any;
    expect(r.effects[0]?.params).toMatchObject({ n: 1, d: 3, benchHealFlat: 100, benchHealHpFull: 1 });
  });
  it("e47: 在场精灵最大体力吸血 / 消耗体力等量固伤 / 系别谓词 / 永久必致命", () => {
    expect(parseEffectText("己方在场精灵吸取对手最大体力的25%").effects).toEqual([
      { op: "damage", power: 25, kind: "percent" },
      { op: "heal", numerator: 25, denominator: 100, target: "self" },
    ]);
    expect(parseEffectText("给对手附加消耗体力1/2等量的固定伤害").effects).toEqual([
      { op: "flat", of: "flatSelfFrac", value: { numerator: 1, denominator: 2, base: "missing" } },
    ]);
    expect(parseEffectText("若对手不是龙系精灵则恢复自身200点体力").effects).toEqual([
      { op: "heal", flat: 200, target: "self", if: { foeTypeNot: "龙" } },
    ]);
    // e5f-08 修复："致命一击"的"一"是名词不是次数——不再产出 count:1 单次消耗
    expect(parseEffectText("从下回合开始必定致命一击").effects).toEqual([{ op: "apply_status", name: "crit_always", target: "self" }]);
  });
  it("e47: 害怕减伤窗 / 连续攻击几率步进 / deferred 域归类", () => {
    // "对手害怕则承伤减少"经 condOf 落成 foeHas 门控的 dmg_reduce 次数窗
    expect(parseEffectText("使对手害怕则下2次受到的伤害减少50点").effects).toEqual([
      { op: "apply_status", name: "fear", target: "opponent" },
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { count: 2, flat: 50 }, if: { prevApplied: true } },
    ]);
    expect(parseEffectText("对手害怕则下2次受到的伤害减少50点").effects).toEqual([
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { count: 2, flat: 50 }, if: { foeHas: "fear" } },
    ]);
    expect((parseEffectText("连续攻击每次提高10%几率，最多提高40%") as any).unparsed?.[0]?.clause).toBe("<attachAll chancePerUse+chancePerUseCap>");
    const r = parseEffectText("以神灵系进行伤害结算");
    expect(r.unparsed?.[0]?.reason).toMatch(/type override/);
    expect(parseEffectText("令对手随机进入2种控制类异常状态").unparsed?.[0]?.reason).toMatch(/control|UNVERIFIED/);
  });
  it("e48: 衰弱层数 / 属性技封印 / nextFoe 削血 / 视为别名 / 反弹 / 串联能力组", () => {
    expect(parseEffectText("10%几率令对手增加一层衰弱").effects).toEqual([
      { op: "apply_status", name: "feeble", target: "opponent", params: { layers: 1 }, chance: 10 },
    ]);
    expect(parseEffectText("下2次对手使用的属性技能无效").effects).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { count: 2, cat: 1 } },
    ]);
    const ko = parseEffectText("当次击败对手，对方下只精灵体力减少1/4").effects;
    expect(ko?.[0]?.op).toBe("apply_status");
    expect(ko?.[0]?.params).toMatchObject({ trigger: 5 });
    expect(ko?.[0]?.payload).toEqual([
      { op: "damage", power: 0, kind: "percent", frac: { numerator: 1, denominator: 4 }, target: "nextFoe" },
    ]);
    expect(parseEffectText("将自身的防御、特防能力提升分别视为攻击、特攻能力提升").effects).toEqual([
      { op: "apply_status", name: "stage_alias", target: "self" },
    ]);
    expect(parseEffectText("将受伤害2倍返还给对手").effects).toEqual([
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 2, d: 1 } },
    ]);
    expect(parseEffectText("攻击+1防御速度+1").effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "spd", delta: 1, target: "self" },
    ]);
    expect(parseEffectText("对方攻击特攻-1命中-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "spa", delta: -1, target: "opponent" },
      { op: "apply_stat_stage", stat: "acc", delta: -1, target: "opponent" },
    ]);
    const sw = parseEffectText("每次对手主动切换下场则令对方下只精灵出战时30%进入冻伤状态").effects;
    expect(sw?.[0]?.params).toMatchObject({ trigger: 9, chance: 30 });
    expect(sw?.[0]?.payload).toEqual([
      { op: "apply_status", name: "frostbite", target: "opponent" },
    ]);
  });
  it("e49: 概率回避 / 牺牲当前体力 / 连击成长+先制 / 累用威力封顶 / 双侧消除", () => {
    expect(parseEffectText("50%回避攻击").effects).toEqual([
      { op: "apply_status", name: "dodge", target: "self", params: { pct: 100 }, turns: 1, chance: 50 },
    ]);
    expect(parseEffectText("损失一半当前体力值").effects).toEqual([
      { op: "damage", power: 0, kind: "percent", target: "self" },
      { op: "formula", of: "percentBase", value: "current" },
      { op: "formula", of: "frac", value: { numerator: 1, denominator: 2 } },
    ]);
    expect(parseEffectText("消耗自身体力至1点").effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self" },
      { op: "cap", of: "leaveHp", value: 1 },
    ]);
    expect(parseEffectText("使自己获得一个双方最大体力差值的护盾").effects).toEqual([
      { op: "apply_status", name: "shield", target: "self", params: { flatMaxHpDiff: 1 } },
    ]);
    expect(parseEffectText("连续使用每次威力提升10%，最高提升至100").effects).toEqual([
      { op: "power", of: "powerPerUse", value: 10 },
      { op: "power", of: "useCap", value: 100 },
    ]);
    expect(parseEffectText("附加20点固定伤害，连续使用叠加最高100").effects).toEqual([
      { op: "flat", of: "flatBonus", value: 20 },
      { op: "flat", of: "flatStackCap", value: 100 },
    ]);
    expect(parseEffectText("30%疲惫2回合").effects).toEqual([
      { op: "apply_status", name: "fatigue", target: "opponent", turns: 2, chance: 30 },
    ]);
    expect(parseEffectText("25%麻痹、烧伤、冻伤").effects).toEqual([
      { op: "apply_status", name: "random", target: "opponent", random: { list: ["paralysis", "burn", "frostbite"], count: 1 }, chance: 25 },
    ]);
    expect(parseEffectText("使得对方的技能消失").effects).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 } },
    ]);
    expect(parseEffectText("消除双方护盾").effects).toEqual([
      { op: "cleanse", scope: "shield", target: "self" },
      { op: "cleanse", scope: "shield", target: "opponent" },
    ]);
    expect(parseEffectText("对方每比己方多存活一只精灵，威力提升100点").effects).toEqual([
      { op: "power", of: "powerPerAliveDiff", value: { per: 1, add: 100 } },
    ]);
    expect(parseEffectText("若本次技能造成的伤害低于200则恢复体力").effects).toEqual([
      { op: "heal", numerator: 1, denominator: 1, target: "self", if: { prevDamageBelowAbs: 200 } },
    ]);
    expect(parseEffectText("若自身先制等级大于0时提升为+2").flags).toEqual({
      priorityIf: { when: { selfPrioAbove: 0 }, min: 2 },
    });
    expect(parseEffectText("自身每有1级先制则连击次数+1，最高连击5次").effects).toEqual([
      { op: "strike", of: "hits", value: { min: 1, max: 1, cap: 5 } },
      { op: "strike", of: "hitsPerPrio", value: { per: 1, add: 1 } },
    ]);
  });
  it("e49: 恢复体力时条件回响（hot 门编码 / 翻倍 / 满体力转变）", () => {
    const g = parseEffectText("3回合内每回合使用技能则出手流程结束后恢复自身最大体力的1/2，恢复体力时若自身体力低于最大体力的1/2则附加给对手等量百分比伤害").effects;
    expect(g?.[0]).toMatchObject({ op: "apply_status", name: "hot", params: { n: 1, d: 2, echoN: 1, echoD: 1, echoLN: 1, echoLD: 2 } });
    const dbl = parseEffectText("4回合内每回合使用技能恢复自身最大体力的1/3并造成等量百分比伤害，恢复体力时若自身体力低于最大体力的1/2则恢复效果和百分比伤害翻倍").effects;
    expect(dbl?.[0]).toEqual({ op: "scale", of: "mulIf", value: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } });
    expect(dbl?.[1]).toMatchObject({ op: "apply_status", name: "hot", params: { n: 1, d: 3, mulLN: 1, mulLD: 2, echoN: 100, echoD: 100 } });
    const swap = parseEffectText("4回合内每回合使用技能恢复自身最大体力的1/3并造成等量百分比伤害，恢复体力时若自身为满体力则效果转变为附加自身最大体力1/4的百分比伤害").effects;
    expect(swap?.[0]).toMatchObject({ op: "apply_status", name: "hot", params: { n: 1, d: 3, pctConvN: 1, pctConvD: 4, pctConvFull: 1 } });
    // 无 heal 宿主时等量伤害回退 flatEcho（与 heal-42 旧行为一致）
    expect(parseEffectText("造成等量百分比伤害").effects).toEqual([{ op: "applyFlatEcho", flatEcho: { pct: 100 } }]);
    // heal op 宿主 → foeEcho + 条件门
    const h = parseEffectText("恢复自身体力，恢复体力时若自身体力低于最大体力的1/2则附加给对手等量百分比伤害").effects;
    expect(h?.[0]).toMatchObject({ op: "heal", foeEcho: true, foeEchoIf: { when: { selfHpBelow: { numerator: 1, denominator: 2 } } } });
  });
  it("e50: 尾部清晰簇（威力区间/对手回复/承伤折扣/先手封印/PP全削/次数反应窗）", () => {
    expect(parseEffectText("威力随机150~200").effects).toEqual([{ op: "power", of: "powerRange", value: { min: 150, max: 200 } }]);
    expect(parseEffectText("恢复对手体力上限1/3的体力").effects).toEqual([
      { op: "heal", numerator: 1, denominator: 3, target: "opponent" },
    ]);
    expect(parseEffectText("回满自身体力").effects).toEqual([
      { op: "heal", numerator: 1, denominator: 1, target: "self" },
    ]);
    expect(parseEffectText("改变对方物攻等级-1").effects).toEqual([
      { op: "apply_stat_stage", stat: "atk", delta: -1, target: "opponent" },
    ]);
    expect(parseEffectText("受到正常伤害1/2").effects).toEqual([
      { op: "apply_status", name: "atk_taken_frac", target: "self", params: { cat: 4, n: 1, d: 2 } },
    ]);
    expect(parseEffectText("本方先手对方技能无效").effects).toEqual([
      { op: "apply_status", name: "move_null", target: "opponent", params: { count: 1 }, if: { order: "first" } },
    ]);
    expect(parseEffectText("免疫能力下降技能").effects).toEqual([
      { op: "apply_status", name: "immune_degrade", target: "self" },
    ]);
    expect(parseEffectText("对手能力提升转成下降").effects).toEqual([
      { op: "invert_stages", sign: "up", target: "opponent" },
    ]);
    expect(parseEffectText("对手强化转化给自身").effects).toEqual([
      { op: "transfer_stages", direction: "steal", sign: "up" },
    ]);
    expect(parseEffectText("必定降低对方所有技能2点PP").effects).toEqual([
      { op: "pp_delta", amount: -2, target: "opponent" },
    ]);
    expect(parseEffectText("30%的概率免疫对手攻击技能造成的伤害").effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self", chance: 30 },
    ]);
    expect(parseEffectText("若对手恢复体力则自身也恢复等量体力的3/5倍").effects).toEqual([
      { op: "apply_status", name: "react", target: "self", params: { trigger: 14 }, payload: [{ op: "heal", foeLastHealPct: 60, target: "self" }] },
    ]);
    expect(parseEffectText("连攻对手8次每次次数+1，最大攻击12次").effects).toEqual([
      { op: "strike", of: "hits", value: { min: 8, max: 8, perUse: 1, cap: 12 } },
    ]);
    expect(parseEffectText("下2次受到攻击伤害时使自身恢复100点体力").effects).toEqual([
      { op: "apply_status", name: "react", target: "self", params: { trigger: 1, count: 2 }, payload: [{ op: "heal", flat: 100, target: "self" }] },
    ]);
    expect(parseEffectText("先制+3必中").flags).toEqual({ priority: 3, accuracy: "always" });
    expect(parseEffectText("伤害数值50%恢复自身体力").effects).toEqual([{ op: "applyDrainRider", drain: { numerator: 50, denominator: 100 } }]);
    expect(parseEffectText("伤害数值50%恢复自身体力").flags).toEqual({});
    expect(parseEffectText("令对手在2回合内害怕").effects).toEqual([
      { op: "apply_status", name: "fear", target: "opponent", turns: 2 },
    ]);
    expect(parseEffectText("若没触发害怕效果则自身恢复100点体力").effects).toEqual([
      { op: "heal", flat: 100, target: "self", if: { not: { prevApplied: true } } },
    ]);
    expect(parseEffectText("连续攻击每次提高10%，最高到40%").effects).toEqual([
      { op: "power", of: "powerMulPerUse", value: { numerator: 110, denominator: 100 } },
      { op: "power", of: "powerMulPerUseCap", value: { numerator: 140, denominator: 100 } },
    ]);
    // 这一句（原锁成 element-scaled 留档）已由 r4d 落成已解析：翻倍 = 翻2倍，走 e50-14 里
    // 「翻N倍」同一条公式（pct=(N-1)*100），发已有的 dmg_boost{pct,moveType}，没有新 op、新 params 键、新状态名。
    // 同一个留档桶里只剩「为随机倍数」（随机区间没有建模，不编范围）。
    expect(parseEffectText("电系技能威力翻倍").effects).toEqual([
      { op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 100 }, moveType: "电" },
    ]);
    expect(parseEffectText("电系技能威力为随机倍数").unparsed?.[0]?.reason).toMatch(/deferred/);
  });

  it("e51: 当前体力%固伤 / fumble 概率失效 / hit_fx_null / 出伤上限 / 技能封印 / 损伤吸血", () => {
    expect(parseEffectText("附加15%当前体力值的伤害").effects).toEqual([{ op: "flat", of: "flatFoeCurPct", value: 15 }]);
    expect(parseEffectText("附加对手当前体力值20%的伤害").effects).toEqual([
      { op: "damage", power: 20, kind: "percent" },
      { op: "formula", of: "percentBase", value: "current" },
    ]);
    expect(parseEffectText("所有技能有30%概率失效").effects).toEqual([
      { op: "apply_status", name: "fumble", target: "self", params: { pct: 30 } },
    ]);
    expect(parseEffectText("对手2回合内所有技能有50%概率失效").effects).toEqual([
      { op: "apply_status", name: "fumble", target: "opponent", params: { pct: 50 }, turns: 2 },
    ]);
    expect(parseEffectText("对手属性技能命中效果失效").effects).toEqual([
      { op: "apply_status", name: "hit_fx_null", target: "opponent", params: { cat: 1 } },
    ]);
    expect(parseEffectText("未触发则对手下2回合属性技能命中效果失效").effects).toEqual([
      { op: "apply_status", name: "hit_fx_null", target: "opponent", params: { cat: 1 }, turns: 2, if: { not: { prevApplied: true } } },
    ]);
    expect(parseEffectText("技能命中效果失效").effects).toEqual([
      { op: "apply_status", name: "hit_fx_null", target: "self" },
    ]);
    expect(parseEffectText("对手3回合内造成的伤害不超过200").effects).toEqual([
      { op: "apply_status", name: "dmg_out_cap", target: "opponent", params: { cap: 200 }, turns: 3 },
    ]);
    // tpm3 补剥窗的 foeCtx 结转（"若X，则对手N回合内Y"逗号变体）
    expect(parseEffectText("若对手处于能力提升状态，则对手3回合内造成的伤害不超过200").effects).toEqual([
      { op: "apply_status", name: "dmg_out_cap", target: "opponent", params: { cap: 200 }, turns: 3, if: { foeStageUp: true } },
    ]);
    expect(parseEffectText("先出手时使对手当回合内无法通过技能恢复自身体力").effects).toEqual([
      { op: "apply_status", name: "heal_block", target: "opponent", if: { order: "first" } },
    ]);
    expect(parseEffectText("2回合内令对手使用的属性技能无效").effects).toEqual([
      { op: "apply_status", name: "status_lock", target: "opponent", params: { cat: 1 }, turns: 2 },
    ]);
    expect(parseEffectText("给予对方损伤的1/4会回复自己的体力").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 4 } },
    ]);
    // 合法 deferred 桶保持
    expect(parseEffectText("下1次击败对手时吸取对手全部体力").unparsed?.[0]?.reason).toMatch(/next-apply/);
    expect(parseEffectText("随机附加2种非限制类异常状态").unparsed?.[0]?.reason).toMatch(/non-control/);
    expect(parseEffectText("增加致命一击的概率").unparsed?.[0]?.reason).toMatch(/unquantified/);
    // 这一句（原锁成 stage-mirror 保残）已由 r4e 落成已解析：自身正级等额转为对手负级，
    // 走已有格子 transfer_stages 的 direction:"upToDown"，与 batch-e6-236／e8-st-03／batch-e5c-04 同一条 IR。
    // 同一个保残桶里剩下的「作用在自己身上」（batch-e6-84）不动。
    expect(parseEffectText("附加给对手等同于自身能力提升状态的能力下降状态").effects).toEqual([
      { op: "transfer_stages", direction: "upToDown" },
    ]);
    expect(parseEffectText("附加给对手等同于自身能力提升状态的能力下降状态").unparsed).toEqual([]);
    expect(parseEffectText("作用在自己身上").unparsed?.[0]?.reason).toMatch(/stage-mirror/);
  });

  it("e51b: 续段（每回合损失/损伤HP吸血/携带光环/具名形态/克制碎片/二次条件前缀）", () => {
    expect(parseEffectText("令对手每回合损失100点体力").effects).toEqual([
      { op: "apply_status", name: "dot_field", target: "opponent", params: { flat: 100 } },
    ]);
    expect(parseEffectText("使对手5回合内每回合损失100点体力").effects).toEqual([
      { op: "apply_status", name: "dot_field", target: "opponent", params: { flat: 100 }, turns: 5 },
    ]);
    expect(parseEffectText("给予对方损伤的1/2会恢复自身HP").effects).toEqual([
      { op: "applyDrainRider", drain: { numerator: 1, denominator: 2 } },
    ]);
    // 复合句：二次条件前缀把"未触发害怕"拆成 not:prevApplied + foeHas:fear
    expect(parseEffectText("3回合内每回合都有60%几率令对手害怕，未触发害怕则下1次受到的伤害减少200点").effects).toEqual([
      { op: "apply_status", name: "periodic", target: "self", params: { win: 16, foeAlive: 1 }, payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 60 }], turns: 3 },
      { op: "apply_status", name: "dmg_reduce", target: "self", params: { count: 1, flat: 200 }, turns: 3, if: { and: [{ not: { prevApplied: true } }, { foeHas: "fear" }] } },
    ]);
    // 新回合窗 + 每回合 tick 不并入先前 react payload
    expect(parseEffectText("4回合，每回合恢复1/3HP，3回合内若受到攻击则有50%概率使对手携带的1个技能PP归零，5回合内每回合损失120点固定伤害").effects).toEqual([
      { op: "apply_status", name: "hot", target: "self", params: { n: 1, d: 3 }, turns: 4 },
      { op: "apply_status", name: "react", target: "self", params: { trigger: 1 }, payload: [{ op: "pp_delta", zeroRandom: 1, target: "opponent", chance: 50 }], turns: 3 },
      { op: "apply_status", name: "dot_field", target: "self", params: { flat: 120 }, turns: 5 },
    ]);
    // 归桶断言
    expect(parseEffectText("携带此技能时对手无法恢复体力").unparsed?.[0]?.reason).toMatch(/carry-skill/);
    expect(parseEffectText("自身进入的百天浮世络增加1回合").unparsed?.[0]?.reason).toMatch(/named-stance/);
    expect(parseEffectText("对手对自身克制倍数中的最大值").unparsed?.[0]?.reason).toMatch(/type override/);
    expect(parseEffectText("激发啵啵家族天生的防御能力").unparsed ?? []).toEqual([]);
  });
});
