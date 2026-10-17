/**
 * add-effect-remain：seer-remain 这一路加的技能规则（上一轮 mech 判定「现有钩子接不住」、
 * 但句子本身把系数写清了的那些）。步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 * 每条：新规则解析出的 IR + 该句子原来的 no-rule 事实、以及同类旧句子结果不变。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("add one effect (remain)", () => {
  it("remain-reflect-pct-01：伤害N%反馈对手", () => {
    const next = parseEffectText("伤害40%反馈对手") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 40, d: 100 } }]);
    const taken = parseEffectText("受到伤害40%反馈给对手") as { effects: unknown[] };
    expect(taken.effects).toEqual([{ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 40, d: 100 } }]);
    const merged = parseEffectText("1回合内免疫并反弹自身受到的固定伤害和百分比伤害") as { effects: unknown[] };
    expect(merged.effects[0]).toMatchObject({ op: "apply_status", name: "dmg_immune" });
    const split = parseEffectText("2回合免疫异常状态；3回合反弹对手1/2伤害") as { effects: unknown[] };
    expect(split.effects[0]).toMatchObject({ op: "apply_status", name: "immune_status", turns: 2 });
  });

  it("remain-selfcost-01：消耗自身体力至残留N点 + 区间固伤（宿主句 风翼蝶舞祭）", () => {
    const next = parseEffectText("消耗自身体力至残留1点HP给对手造成250-350点伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self" },
      { op: "cap", of: "leaveHp", value: 1 },
      { op: "damage", kind: "fixed", power: 250, target: "opponent" },
      { op: "flat", of: "flatRange", value: { min: 250, max: 350 } },
    ]);
    // 无「残留」/无「HP」的同义句形
    const bare = parseEffectText("消耗自身体力至残留1点给对手造成350-550点伤害") as { effects: unknown[] };
    expect(bare.effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self" },
      { op: "cap", of: "leaveHp", value: 1 },
      { op: "damage", kind: "fixed", power: 350, target: "opponent" },
      { op: "flat", of: "flatRange", value: { min: 350, max: 550 } },
    ]);
    // 旧句不变：e49-04 的裸自耗（不带后续伤害）仍是单条 self damage + cap
    const old = parseEffectText("消耗自身体力至1点") as { effects: unknown[] };
    expect(old.effects).toEqual([
      { op: "damage", kind: "fixed", power: 1, target: "self" },
      { op: "cap", of: "leaveHp", value: 1 },
    ]);
  });

  it("remain-taken-random-01：受击阈值 → 对手随机 M 种异常（宿主句 轮回之狱/永恒长眠）", () => {
    const AILS = ["burn","frostbite","poison","paralysis","fear","sleep","blind","daze","bind","confuse","parasite","curse","fatigue","bleed","silence","freeze","flammable","ember","petrify","shock","infect","rage","feeble","submit"];
    const next = parseEffectText("每次受到伤害时若高于280则使对手随机进入2种异常状态") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", params: { trigger: 1, min: 280 },
      payload: [{ op: "apply_status", name: "random", target: "opponent", random: { list: AILS, count: 2 } }],
    }]);
    // 语料整句：3回合窗同时落在外层 dmg_taken_down 与 react 上
    const full = parseEffectText("3回合内受到的攻击伤害减少50%，每次受到伤害时若高于280则使对手随机进入2种异常状态") as { effects: unknown[] };
    expect(full.effects).toEqual([
      { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 }, turns: 3 },
      {
        op: "apply_status", name: "react", target: "self", params: { trigger: 1, min: 280 }, turns: 3,
        payload: [{ op: "apply_status", name: "random", target: "opponent", random: { list: AILS, count: 2 } }],
      },
    ]);
  });


  it("remain-pp-turn-01：每回合对手所有招式 PP 值 -N（已有 pp_drain，周期名不动）", () => {
    const next = parseEffectText("每回合对手所有招式PP值-1") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: 1 } }]);
    // 带回合窗：窗落在同一条 pp_drain 上
    const win = parseEffectText("3回合内每回合对手所有招式PP值-2") as { effects: unknown[] };
    expect(win.effects).toEqual([{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: 2 }, turns: 3 }]);
    // 旧句（deferred-11 / heal-207）不变：仍然出同一条 pp_drain，本条不截它们
    const old1 = parseEffectText("每回合结束时降低对手所有技能1点PP值") as { effects: unknown[] };
    expect(old1.effects).toEqual([{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: 1 } }]);
    const old2 = parseEffectText("每回合对手所有技能PP-1") as { effects: unknown[] };
    expect(old2.effects).toEqual([{ op: "apply_status", name: "pp_drain", target: "self", params: { flat: 1 } }]);
  });

  it("remain-typeswap-01：和对方的属性交换（动宾倒装，同族 p2-type-02 是动宾正序）", () => {
    const next = parseEffectText("5回合内和对方的属性交换") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "type_swap", target: "self", turns: 5 }]);
    // 旧句不变：动宾正序仍走 p2-type-02
    const old = parseEffectText("和对手交换属性") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "apply_status", name: "type_swap", target: "self" }]);
  });

  it("remain-seekill-01：若敌方血量低于N则必定秒杀（走百分百伤害通道 + 血量门）", () => {
    const next = parseEffectText("若敌方血量低于280则必定秒杀") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 280 } }]);
    // 旧句不变：另一条同义句形仍走原规则
    const old = parseEffectText("若对手体力不足350则直接秒杀") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "damage", power: 100, kind: "percent", if: { foeHpBelowAbs: 350 } }]);
  });

  it("remain-weaken-01：使对手造成伤害是原来N/M（压制对手出伤，与承伤减半方向相反）", () => {
    const next = parseEffectText("使对手1回合造成伤害是原来1/2") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: 1, d: 2 }, turns: 1 }]);
    const half = parseEffectText("使对手造成的伤害减半") as { effects: unknown[] };
    expect(half.effects).toEqual([{ op: "apply_status", name: "dmg_weaken", target: "opponent", params: { n: 1, d: 2 } }]);
    // 方向相反：无「使/令」主语的「对手造成的伤害减半」是自身承伤减半，本条不截它
    const taken = parseEffectText("对手造成的伤害减半") as { effects: unknown[] };
    expect(taken.effects).toEqual([{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }]);
  });

  it("remain-taken-all-01：受到所有伤害减半 / 减少N%（整句写法，dmg_taken_down 是已有状态名）", () => {
    const next = parseEffectText("受到所有伤害减半") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }]);
    // 带回合窗的宿主整句
    const full = parseEffectText("3回合内受到所有伤害减半；每回合恢复170点体力") as { effects: unknown[] };
    expect(full.effects).toEqual([
      { op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 }, turns: 3 },
      { op: "apply_status", name: "hot", target: "self", params: { flat: 170 } },
    ]);
    // 旧句不变：既有 dmg_taken_down 正序写法仍走原规则
    const old = parseEffectText("受到的攻击伤害减少50%") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 50 } }]);
  });

  it("remain-taken-cat-inv-01：减少受到的N%的X攻击伤害（动宾倒装，走已有 spec_half/phys_half 分数窗）", () => {
    const next = parseEffectText("减少受到的25%的特殊攻击伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "spec_half", target: "self", params: { cat: 3, n: 75, d: 100 } }]);
    const phys = parseEffectText("减少受到的30%的物理攻击伤害") as { effects: unknown[] };
    expect(phys.effects).toEqual([{ op: "apply_status", name: "phys_half", target: "self", params: { cat: 2, n: 70, d: 100 } }]);
    // 旧句不变：正序「受到X攻击伤害减半」仍走 e34-half-02
    const old = parseEffectText("受到特殊攻击伤害减半") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "apply_status", name: "spec_half", target: "self" }]);
  });

  it("r3-wudao-*：衍化/复原/改为逆转（新 op set_mode_flag，开关位无计时）", () => {
    const fwd = parseEffectText("衍化自身的武道") as { effects: unknown[]; unparsed: unknown[] };
    expect(fwd.unparsed).toEqual([]);
    expect(fwd.effects).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self" }]);
    // 宿主整句：开关位与「下1回合造成的攻击伤害额外提升50%」各自成 op
    const full = parseEffectText("先制+3；消除对手回合类效果，消除成功则令对手攻击技能PP值归0；衍化自身的武道；下1回合造成的攻击伤害额外提升50%") as { effects: unknown[]; unparsed: unknown[] };
    expect(full.unparsed).toEqual([]);
    expect(full.effects).toEqual([
      { op: "scale", of: "mul", value: { numerator: 150, denominator: 100 } },
      { op: "cleanse", target: "opponent", scope: "timed" },
      { op: "pp_delta", target: "opponent", cat: 4, zero: true, if: { prevApplied: true } },
      { op: "set_mode_flag", name: "wudao", target: "self" },
    ]);
    expect((full as { flags?: unknown }).flags).toEqual({ priority: 3 });
    const back = parseEffectText("复原自身的武道衍化轨迹") as { effects: unknown[]; unparsed: unknown[] };
    expect(back.unparsed).toEqual([]);
    expect(back.effects).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self", clear: true }]);
    const rev = parseEffectText("将自身的武道衍化轨迹改为逆转") as { effects: unknown[]; unparsed: unknown[] };
    expect(rev.unparsed).toEqual([]);
    expect(rev.effects).toEqual([{ op: "set_mode_flag", name: "wudao", target: "self", to: "revert" }]);
    // 旧句不变：同族已经把「衍化」当触发点的效果仍走原通道
    const old1 = parseEffectText("下1次衍化时时全属性+1") as { unparsed: { reason?: string }[] };
    expect(old1.unparsed[0]?.reason).toBe("next-apply window — single-use mounting not modeled (deferred)");
    const old2 = parseEffectText("将武道正转期间抵挡的伤害以固定伤害的形式反馈给对手") as { unparsed: { reason?: string }[] };
    expect(old2.unparsed[0]?.reason).toBe("no-rule");
  });

  it("r3-noresist-01：伤害计算时克制倍数至少为1（走已有 noResist，不动 damage.ts）", () => {
    const next = parseEffectText("伤害计算时克制倍数至少为1") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
    // 宿主整句：条件分支（"若拥有1层未来奇点则克制倍数至少为1.25"）不在本条内，仍留档
    const full = parseEffectText("必中；当自身处于能力下降状态时先制+3；将自身的能力下降状态双倍反馈给对手，反馈成功则对手下1次技能无效；伤害计算时克制倍数至少为1，若自身拥有1层未来奇点则克制倍数至少为1.25") as { effects: unknown[]; unparsed: { clause?: string }[] };
    expect(full.effects[0]).toEqual({ op: "formula", of: "noResist", value: true });
    expect(full.unparsed.map((u) => u.clause)).toEqual(["克制倍数至少为1.25"]);
    // 旧句不变：同义的「伤害不会出现微弱」仍走 heal-11（同一条 noResist）
    const old = parseEffectText("攻击时伤害不会出现微弱") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "formula", of: "noResist", value: true }]);
  });

  it("remain-first-immune-01：先手免疫当回合伤害（前缀写作「先手」而非「先出手时」）", () => {
    const next = parseEffectText("先手免疫当回合伤害") as { effects: unknown[]; unparsed: unknown[] };
    expect(next.unparsed).toEqual([]);
    expect(next.effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", turns: 1, if: { order: "first" } }]);
    // 整句：后半 "并恢复1/5体力" 由切分独立成 heal
    const full = parseEffectText("先手免疫当回合伤害并恢复1/5体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(full.unparsed).toEqual([]);
    expect(full.effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self", turns: 1, if: { order: "first" } },
      { op: "heal", numerator: 1, denominator: 5, target: "self" },
    ]);
    // 旧句不变：「先出手时免疫…」仍走既有规则（无显式 turns）
    const old = parseEffectText("先出手时免疫当回合受到的攻击伤害") as { effects: unknown[] };
    expect(old.effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", if: { order: "first" } }]);
  });
});
