/**
 * w09：改克制 / 属性相克改写的句子。
 *
 * 这一类的规则落在 tools/effects-rules/batch-w09.mjs：
 *   - `w09-weak-prio-01`     「此技能微弱对手时技能先制+N」（宿主句 薇尔诗/乐园之初诞）
 *   - `w09-typeswap-flip-01` 「与对方翻转属性」（宿主句 龙尊/帝龙圣尊/天尊龙帝 的 日月乾坤）
 *   - `w09-effmax-01`        「克制倍数取自身对对手、对手对自身克制倍数中的最大值」（宿主句 娜诺/撬动世界）
 *
 * `...batchW09` 已前移到 `...batchE47` 之前：第二条因此取代了 e48-28 的 deferred 留档，
 * 第三条的 op（eff_max）按五处契约注册（处理器 ops/slots/w09.ts）。但第三条的句子在解析器里
 * 被顿号切成两段（「克制倍数取自身对对手」+「对手对自身克制倍数中的最大值」），
 * 本规则写的是整句，两段都轮不到它，仍各自被 e47-08 留档——见下面「线上仍留档」那条。
 *
 * 下面锁四件事：
 *   1) 规则本身发什么 IR；
 *   2) 顺序：两条改克制的规则都排在 e47-08 之前；「翻转属性」不再被 e48-28 留档；
 *   3) e47-08 仍留档的三条硬句不变；
 *   4) 旧句子的 IR 一字不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as w09Rules } from "../../../tools/effects-rules/batch-w09.mjs";

const direct = (s: string) => {
  for (const r of w09Rules as { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown }[]) {
    const m = s.match(r.re);
    if (m) return { id: r.id, out: r.go(m) };
  }
  return undefined;
};
const idx = (id: string) => (RULES as { id: string }[]).findIndex((r) => r.id === id);

describe("w09 改克制", () => {
  it("w09-weak-prio-01：X时Y 形发 priorityIf effWeakVsFoe", () => {
    const r = parseEffectText("此技能微弱对手时技能先制+3") as { flags: unknown; effects: unknown[]; unparsed: unknown[] };
    expect(r.unparsed).toEqual([]);
    expect(r.flags).toEqual({ priorityIf: { when: { effWeakVsFoe: true }, add: 3 } });
    expect(r.effects).toEqual([]);
    // 全宽加号、省掉「技能」二字的词形同一 IR
    expect((parseEffectText("此技能微弱对手时技能先制＋1") as { flags: unknown }).flags).toEqual({
      priorityIf: { when: { effWeakVsFoe: true }, add: 1 },
    });
    expect((parseEffectText("此技能微弱对手时先制+2") as { flags: unknown }).flags).toEqual({
      priorityIf: { when: { effWeakVsFoe: true }, add: 2 },
    });
  });

  it("宿主句：只补先制旗标，本系加成与「以X系进行伤害结算」各自照旧", () => {
    const r = parseEffectText("必中；此技能微弱对手时技能先制+3、获得本系属性加成并以神灵系进行伤害结算", { hasDamage: true }) as {
      flags: unknown; effects: unknown[]; unparsed: unknown[];
    };
    expect(r.flags).toEqual({ accuracy: "always", priorityIf: { when: { effWeakVsFoe: true }, add: 3 } });
    expect(r.effects).toEqual([{ op: "formula", of: "forceStab", value: true }]);
    expect(r.unparsed).toEqual([{ clause: "以神灵系进行伤害结算", reason: "type override / element settle unmodeled (deferred)" }]);
  });

  it("w09-typeswap-flip-01：规则发 type_swap，前移之后线上不再是留档", () => {
    const mine = (RULES as { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown }[]).find((x) => x.id === "w09-typeswap-flip-01")!;
    expect(mine.go("与对方翻转属性".match(mine.re)!)).toEqual({ effects: [{ op: "apply_status", name: "type_swap", target: "self" }] });
    // e48-28 的 deferred 留档已被本规则取代
    const r = parseEffectText("与对方翻转属性") as { effects: unknown[]; unparsed: unknown[] };
    expect(r.effects).toEqual([{ op: "apply_status", name: "type_swap", target: "self" }]);
    expect(r.unparsed).toEqual([]);
    // 带回合窗的宿主句：窗照剥，标记带上 turns
    expect((parseEffectText("5回合内与对方翻转属性") as { effects: unknown[] }).effects).toEqual([
      { op: "apply_status", name: "type_swap", target: "self", turns: 5 },
    ]);
    // 同族已有 e53-v26-03 的「反转战斗时属性」词形，IR 一致（只是换了个动词）
    expect((parseEffectText("自身与对方反转战斗时属性") as { effects: unknown[] }).effects).toEqual([
      { op: "apply_status", name: "type_swap", target: "self" },
    ]);
    expect((parseEffectText("5回合内和对方的属性交换") as { effects: unknown[] }).effects).toEqual([
      { op: "apply_status", name: "type_swap", target: "self", turns: 5 },
    ]);
  });

  it("w09-effmax-01：规则本身发 eff_max；线上仍留档（分段器把整句切成两段）", () => {
    const d = direct("克制倍数取自身对对手、对手对自身克制倍数中的最大值") as { id: string; out: unknown };
    expect(d.id).toBe("w09-effmax-01");
    expect(d.out).toEqual({ effects: [{ op: "eff_max", target: "self" }] });
    // 分段器在顿号处切开（前段收尾「对对手」不是 stat 名），本规则只认整句 → 两段各被 e47-08 留档
    const r = parseEffectText("克制倍数取自身对对手、对手对自身克制倍数中的最大值", { hasDamage: true }) as {
      effects: unknown[]; unparsed: unknown[];
    };
    expect(r.effects).toEqual([]);
    expect(r.unparsed).toEqual([
      { clause: "克制倍数取自身对对手", reason: "type override / element settle unmodeled (deferred)" },
      { clause: "对手对自身克制倍数中的最大值", reason: "type override / element settle unmodeled (deferred)" },
    ]);
  });

  it("顺序：两条改克制的规则都排在 e47-08 之前；e47-08 仍在表里", () => {
    expect(idx("w09-typeswap-flip-01")).toBeGreaterThan(-1);
    expect(idx("w09-effmax-01")).toBeGreaterThan(-1);
    expect(idx("w09-effmax-01")).toBeLessThan(idx("e47-08"));
    expect(idx("e47-08")).toBeGreaterThan(-1);
    // 新 id 不进顺序快照：快照里已有的 id 相对顺序不动（effects-rule-order.test.ts 那侧锁死）
    expect(idx("w09-typeswap-flip-01")).toBeLessThan(idx("e48-28")); // 「翻转属性」的 deferred 档现在排在它之后
  });

  it("旧结果不变：已认领的克制/微弱/天敌句一字不动", () => {
    const ir = (s: string) => parseEffectText(s, { hasDamage: true }) as { flags: unknown; effects: unknown[]; unparsed: unknown[]; orphanCond?: unknown };
    // 微弱先制（同形但带「若…则」的旧句，e48-24）
    const weakPrio = ir("若本次技能微弱对手则先制+1");
    expect(weakPrio.flags).toEqual({ priorityIf: { when: { effWeakVsFoe: true }, add: 1 } });
    expect(weakPrio.unparsed).toEqual([]);
    const weakPrio2 = ir("若自身攻击对手时克制关系为微弱则先制+2");
    expect(weakPrio2.flags).toEqual({ priorityIf: { when: { effWeakVsFoe: true }, add: 2 } });
    expect(weakPrio2.orphanCond).toEqual({ effWeakVsFoe: true });
    // 天敌先制（flags-02b / e48 族）
    const foePrio = ir("遇到天敌时先制+1");
    expect(foePrio.flags).toEqual({ priorityIf: { when: { foeCountersUs: true }, add: 1 } });
    const foePrio2 = ir("遇天敌先制+3");
    expect(foePrio2.flags).toEqual({ priorityIf: { when: { foeCountersUs: true }, add: 3 } });
    // 克制下限 1.0（r3-noresist-01）与不微弱（heal-11）都仍是 noResist
    expect(ir("伤害计算时克制倍数至少为1").effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
    expect(ir("攻击时造成的伤害不会出现微弱").effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
    // 本系加成条件（e33-stab-01/02）
    expect(ir("克制对手时获得本系属性加成").effects).toEqual([{ op: "formula", of: "forceStabIf", value: { when: { weCounterFoe: true } } }]);
    // 天敌固伤（attach-damage-64）
    expect(ir("遇到天敌时附加200点固定伤害").effects).toEqual([{ op: "flat", of: "flatIf", value: { when: { foeCountersUs: true }, flat: 200 } }]);
  });

  it("旧结果不变：e47-08 的三条硬句仍留档（本轮没做，也没被抢走）", () => {
    const ir = (s: string) => parseEffectText(s, { hasDamage: true }) as { flags: unknown; effects: unknown[]; unparsed: unknown[]; orphanCond?: unknown };
    // 以指定系别结算
    expect(ir("以神灵系进行伤害结算").unparsed).toEqual([{ clause: "以神灵系进行伤害结算", reason: "type override / element settle unmodeled (deferred)" }]);
    expect(ir("此技能以自然、光、冰、超能、神灵系中的最优系别计算克制倍数").unparsed).toEqual([
      { clause: "此技能以自然", reason: "no-rule" },
      { clause: "光", reason: "no-rule" },
      { clause: "冰", reason: "no-rule" },
      { clause: "超能", reason: "no-rule" },
      { clause: "神灵系中的最优系别计算克制倍数", reason: "no-rule" },
    ]);
    // 克制倍率的条件下限（要任意下限，本轮没做）
    const floor = ir("若自身拥有1层未来奇点则克制倍数至少为1.25");
    expect(floor.effects).toEqual([]);
    expect(floor.unparsed).toEqual([{ clause: "克制倍数至少为1.25", reason: "type override / element settle unmodeled (deferred)" }]);
    expect(floor.orphanCond).toEqual({ markCountAtLeast: { mark: "1层未来奇点", n: 1, on: "self" } });
  });
});
