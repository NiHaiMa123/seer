/**
 * add-effect-w01：seer-w01 这一路加的技能规则。
 * 只做「(若)被(对手)击败(，)则对手损失 N (点)体力」这一类整句（含省写「点」的变体）。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 * 复用既有格子：react{trigger:5} + payload 一笔 fixed damage，不新增 op / 状态名 / params 键。
 * 这些 id 不写进 tests/fixtures/effects-rule-order.json（顺序快照只锁已存 id 的相对次序）。
 *
 * 认领范围说明：规则只认「触发头 + 损失尾句」同现的整句。语料里的逗号形都带回合窗前缀，
 * 解析器的 "X若P，则Y" 续接会把两段拼回一整段交给规则，所以逗号形照常被认领；
 * 不带任何前缀的裸逗号形（"若被击败，则对手损失300体力"）在通用续接之前就被逗号切开，
 * 题头/尾句各自成段——那条通用续接不在本路预算里，故该形状维持原样（no-rule），本条不接管。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

/** react{trigger:5} + 对手承损 N 点固定伤害。 */
const koLoss = (n: number, turns?: number) => ({
  op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
  payload: [{ op: "damage", kind: "fixed", power: n, target: "opponent" }],
  ...(turns !== undefined ? { turns } : {}),
});

describe("add one effect (w01)", () => {
  it("w01-ko-loss-01：若被击败则对手损失 N 体力（省写「点」，语料整句）", () => {
    // 语料整句：回合窗 + 逗号 + 省写「点」（原为 no-rule）
    const comma = parseEffectText("4回合内若被击败，则对手损失500体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(comma.unparsed).toEqual([]);
    expect(comma.effects).toEqual([koLoss(500, 4)]);

    const three = parseEffectText("3回合内若被对手击败，则对手损失500体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(three.unparsed).toEqual([]);
    expect(three.effects).toEqual([koLoss(500, 3)]);

    // 同义整句：主语从简 / 省写「点」的"体力值"尾 / 回合数不同
    const foe = parseEffectText("3回合内若被对方击败，则对手损失350体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(foe.unparsed).toEqual([]);
    expect(foe.effects).toEqual([koLoss(350, 3)]);

    const value = parseEffectText("3回合内若被对手击败，则对手损失500体力值") as { effects: unknown[]; unparsed: unknown[] };
    expect(value.unparsed).toEqual([]);
    expect(value.effects).toEqual([koLoss(500, 3)]);

    // 全语料里唯一被本条改写的另一条：同一宿主句的「造成致命伤害时…剩余1点体力」尾句
    // 会并入本条产出的 react payload（与带「点」的旧形逐字同构）——见 scratch/parallel/w01-diff.txt
    const full = parseEffectText("4回合内若被击败，则对手损失500体力，造成致命伤害时，对手剩余1点体力；攻击、防御、特防+1，速度+2") as { effects: unknown[]; unparsed: unknown[] };
    expect(full.unparsed).toEqual([]);
    expect(full.effects).toEqual([
      {
        op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
        payload: [
          { op: "damage", kind: "fixed", power: 500, target: "opponent" },
          { op: "damage", kind: "fixed", power: 1, target: "opponent", if: { prevCrit: true } },
          { op: "cap", of: "leaveHp", value: 1 },
        ],
        turns: 4, if: { prevCrit: true },
      },
      { op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "def", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "sdf", delta: 1, target: "self" },
      { op: "apply_stat_stage", stat: "spd", delta: 2, target: "self" },
    ]);

    const five = parseEffectText("5回合内若被对手击败，则对手损失350体力") as { effects: unknown[]; unparsed: unknown[] };
    expect(five.unparsed).toEqual([]);
    expect(five.effects).toEqual([koLoss(350, 5)]);
  });

  it("w01-ko-loss-01：旧句结果不变（带「点」的旧形、不带窗的裸逗号形、同触发头的其它负载）", () => {
    // 旧句不变 0：带「点」的同族整句（含同样的致命尾句）本来就是同一形状，本条不得改它的 IR
    const sibling = parseEffectText("5回合内若被对手击败则对手损失350点体力，造成致命伤害时，对手剩余1点体力") as { effects: unknown[] };
    expect(sibling.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
      payload: [
        { op: "damage", kind: "fixed", power: 350, target: "opponent" },
        { op: "damage", kind: "fixed", power: 1, target: "opponent", if: { prevCrit: true } },
        { op: "cap", of: "leaveHp", value: 1 },
      ],
      turns: 5, if: { prevCrit: true },
    }]);

    // 旧句不变 1：带「点」的旧形本来就落成同一形状（heal-216 + heal-54），本条不得改它的 IR
    const dotted = parseEffectText("2回合内若被对手击败则对手损失500点体力") as { effects: unknown[] };
    expect(dotted.effects).toEqual([koLoss(500, 2)]);
    const dottedComma = parseEffectText("若被对手击败，则对手损失300点体力") as { effects: unknown[] };
    expect(dottedComma.effects).toEqual([koLoss(300)]);

    // 旧句不变 2：无回合窗的两条旧形各自维持原样——
    // 无逗号形是 heal-216 认了触发头、payload「对手损失300体力」无规则（react payload unparsed）；
    // 裸逗号形在通用续接之前就被逗号切成两段（两段各 no-rule）。本条的 re 只认整句，两者都不接管。
    const plain = parseEffectText("若被对手击败则对手损失300体力") as { effects: unknown[]; unparsed: { clause: string; reason: string }[] };
    expect(plain.effects).toEqual([]);
    expect(plain.unparsed).toEqual([{ clause: "若被对手击败则对手损失300体力", reason: "react payload unparsed: 对手损失300体力" }]);

    const bareComma = parseEffectText("若被击败，则对手损失300体力") as { effects: unknown[]; unparsed: { clause: string; reason: string }[] };
    expect(bareComma.effects).toEqual([]);
    expect(bareComma.unparsed).toEqual([
      { clause: "若被击败", reason: "no-rule" },
      { clause: "对手损失300体力", reason: "no-rule" },
    ]);

    // 旧句不变 3：同一触发头的其它负载不受影响
    const fatigue = parseEffectText("3回合若被击败则对手疲惫2回合") as { effects: unknown[] };
    expect(fatigue.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
      payload: [{ op: "apply_status", name: "fatigue", target: "opponent", turns: 2 }], turns: 3,
    }]);
    const fear = parseEffectText("若被对手击败则对手害怕") as { effects: unknown[] };
    expect(fear.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
      payload: [{ op: "apply_status", name: "fear", target: "opponent" }],
    }]);
    const nextAlly = parseEffectText("自身被击败后下一只出场的精灵攻击+2") as { effects: unknown[] };
    expect(nextAlly.effects).toEqual([{
      op: "apply_status", name: "react", target: "self", params: { trigger: 5 },
      payload: [{ op: "apply_stat_stage", stat: "atk", delta: 2, target: "nextAlly" }],
    }]);
  });
});
