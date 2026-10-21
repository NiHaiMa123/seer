/**
 * add-soulmark-p3 —— p3 加的魂印句子（一次一条）。
 * 每条都锁住一条已经能解析的相邻旧句子，证明新条没有把它截走。
 * 只调用 parseSoulmarkText，不改 effects-parse / effects-rules。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const first = (t: string) => parseSoulmarkText(t).entries[0];
const all = (t: string) => parseSoulmarkText(t).entries;

describe("p3-1 自身受到物理/特殊攻击时X → 受击窗（自身主语冗余剥除）", () => {
  it("新句：'自身受到物理攻击时50%令对手害怕' → 受击 react 窗 + 50% 害怕", () => {
    const e = first("自身受到物理攻击时50%令对手害怕");
    expect(e).toMatchObject({ hook: "onBattleStart", ops: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, cat: 2 } }] });
    expect(e?.ops?.[0]?.payload).toMatchObject([{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }]);
    expect(parseSoulmarkText("自身受到物理攻击时50%令对手害怕").unparsed).toHaveLength(0);
  });

  it("新句：'自身受到特殊攻击时50%令对手麻痹' → 受击 react 窗 + cat 3", () => {
    expect(first("自身受到特殊攻击时50%令对手麻痹")).toMatchObject({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, cat: 3 }, payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50 }] }],
    });
  });

  it("邻句不变：无'自身'的裸句式仍是同一条 react 窗", () => {
    expect(first("受到物理攻击时50%令对手害怕")).toMatchObject({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 1, cat: 2 }, payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }] }],
    });
  });

  it("邻句不变：'自身受到攻击时X' 仍走 onDamaged（未被新条截走）", () => {
    expect(first("自身受到攻击时50%令对手害怕")).toMatchObject({ hook: "onDamaged", ops: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }] });
  });

  it("邻句不变：'自身受到物理攻击伤害后…'（伤害后，非时/后/则）不被新条吞掉", () => {
    const r = parseSoulmarkText("自身受到物理攻击伤害后，抵挡下次受到的物理攻击");
    expect(r.entries).toHaveLength(0);
    expect(r.unparsed.some((u) => u.clause.startsWith("自身受到物理攻击伤害后"))).toBe(true);
  });
});

describe("p3-3 所有技能命中时X → 同挂点（命中时/命中后同义）", () => {
  it("新句：'所有技能命中时50%令对手害怕' 与 '命中后' 同形", () => {
    expect(first("所有技能命中时50%令对手害怕")).toEqual(first("所有技能命中后50%令对手害怕"));
    expect(first("所有技能命中时50%令对手害怕")).toMatchObject({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
    });
    expect(parseSoulmarkText("所有技能命中时50%令对手害怕").unparsed).toHaveLength(0);
  });

  it("新句：完整句里条件守卫仍落位（月影·阿德莱特）", () => {
    const es = all("回合开始时若自身为满体力则当回合所有技能命中时50%令对手害怕，若自身不为满体力则当回合所有技能先制+1");
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ hook: "onTurnStart", guard: { selfHpFull: true }, ops: [{ op: "apply_status", name: "fear", chance: 50 }] });
    expect(es[1]).toMatchObject({ hook: "onTurnStart", guard: { not: { selfHpFull: true } }, ops: [{ op: "apply_status", name: "prio_up", params: { add: 1 } }] });
  });

  it("邻句不变：'所有技能命中后X' 结果一样（未被截走）", () => {
    expect(first("所有技能命中后100%令对手烧伤")).toMatchObject({ hook: "onBattleStart", ops: [{ op: "apply_status", name: "burn", target: "opponent", chance: 100 }] });
  });

  it("邻句不变：'自身攻击技能命中时X' 仍走 onMoveUsed（未被新条吞掉）", () => {
    expect(first("自身攻击技能命中时吸取对手100点体力")).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3] }, ops: [{ op: "damage", kind: "fixed", power: 100 }, { op: "heal", flat: 100, target: "self" }] });
  });
});

describe("remain2 性别限定族：foeGender 谓词是现成格子，只补词形", () => {
  // 结算早就有（guard.foeGender 读 pack 单位 gender，ops/cond.ts），缺的只是把
  // 「X性精灵…」的三种词形改写成 condOf/mk 已认识的裸谓词。不新增谓词、不新增钩子。
  it("减少200来自雄性精灵的伤害 → onDamaged + foeGender 守卫 + 定额承伤减免", () => {
    expect(first("减少200来自雄性精灵的伤害")).toEqual({
      hook: "onDamaged", guard: { foeGender: "male" },
      ops: [{ op: "apply_status", name: "dmg_reduce", target: "self", params: { flat: 200 } }],
    });
    expect(parseSoulmarkText("减少200来自雄性精灵的伤害").unparsed).toHaveLength(0);
  });

  it("减少30%来自雄性精灵的攻击伤害 / 雄性精灵对自身造成的攻击伤害减少15% → 同形百分比减免", () => {
    expect(first("减少30%来自雄性精灵的攻击伤害")).toEqual({
      hook: "onDamaged", guard: { foeGender: "male" },
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 30 } }],
    });
    expect(first("雄性精灵对自身造成的攻击伤害减少15%")).toEqual({
      hook: "onDamaged", guard: { foeGender: "male" },
      ops: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 15 } }],
    });
  });

  it("雄性精灵攻击我方时75%令对方烧伤 → 受击钩 + 性别守卫 + 概率异常", () => {
    expect(first("雄性精灵攻击我方时75%令对方烧伤")).toEqual({
      hook: "onDamaged", guard: { foeGender: "male" },
      ops: [{ op: "apply_status", name: "burn", target: "opponent", chance: 75 }],
    });
    expect(first("雌性精灵攻击我方时75%令对方失明")).toEqual({
      hook: "onDamaged", guard: { foeGender: "female" },
      ops: [{ op: "apply_status", name: "blind", target: "opponent", chance: 75 }],
    });
  });

  it("对雄性精灵造成的伤害提升30% → 出伤侧钩 + 性别守卫", () => {
    expect(first("对雄性精灵造成的伤害提升30%")).toEqual({
      hook: "onDamageDealt", guard: { foeGender: "male" },
      ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 30 } }],
    });
  });

  it("邻句不变：裸形「对手为雄性…」仍被性别门挡住（本次不动 e46-12，旧 IR 逐字不变）", () => {
    const r = parseSoulmarkText("对手为雄性精灵时自身受到的攻击伤害减少30%");
    expect(r.entries).toHaveLength(0);
    expect(r.unparsed[0]).toEqual({ clause: "对手为雄性精灵时自身受到的攻击伤害减少30%", reason: "gender domain unmodeled (deferred)" });
  });
});

describe("remain2 只差触发词的常驻被动：体内谓词已有格子，补触发词前缀", () => {
  it("受到的攻击伤害反弹给对手 → onDamaged + reflect_dmg（宿主 帝皇之御/莎利奥/艾斯德诺）", () => {
    expect(first("受到的攻击伤害反弹给对手")).toEqual({
      hook: "onDamaged", ops: [{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } }],
    });
    expect(parseSoulmarkText("受到的攻击伤害反弹给对手").unparsed).toHaveLength(0);
  });

  it("自身免疫并反弹异常状态 → onBattleStart + immune_status + reflect_status", () => {
    expect(first("自身免疫并反弹异常状态")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "immune_status", target: "self" }, { op: "apply_status", name: "reflect_status", target: "self" }],
    });
    // 邻句不变：裸句「免疫并反弹异常状态」仍按两句分别落位（不被新条吞掉）
    expect(all("免疫并反弹异常状态")).toHaveLength(2);
  });

  it("所有技能必定先手 / 必定先手 → 与既有「攻击必定先手」同形", () => {
    const base = first("攻击必定先手");
    expect(first("所有技能必定先手")).toEqual(base);
    expect(first("必定先手")).toEqual(base);
    expect(base).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3] } });
  });

  it("出手恢复自身最大体力的1/3 → onMoveUsed + actor:self（与「出手时…」同形）", () => {
    expect(first("出手恢复自身最大体力的1/3")).toEqual(first("出手时恢复自身最大体力的1/3"));
    expect(first("出手恢复自身最大体力的1/3")).toEqual({
      hook: "onMoveUsed", ops: [{ op: "heal", numerator: 1, denominator: 3, target: "self" }], guard: { actor: "self" },
    });
    expect(parseSoulmarkText("出手时恢复自身最大体力的1/3").unparsed).toHaveLength(0);
  });

  it("邻句不变：带续段的宿主不被「自身免疫并反弹异常状态」改写（冥霞仍是回合开始钩）", () => {
    const es = all("回合开始时若对手处于能力提升或自身处于能力下降，则当回合自身免疫并反弹受到的异常状态且使用技能无视对手能力提升状态、无视自身能力下降状态");
    expect(es[0]).toMatchObject({ hook: "onTurnStart" });
  });
});
