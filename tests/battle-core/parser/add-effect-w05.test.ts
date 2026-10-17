/**
 * add-effect-w05：seer-w05 这一路点名的「复活句子」。
 * 步骤见 plans/add-effect.md，预算见 plans/touch-budget.md。
 *
 * 结论：本轮做成的 id = 0。技能侧含「复活/重生」的整句全库只有一句
 * `自身下次受到致死伤害时重生`（华光之翼·杰洛恩/光之边际），它没写复活血量——
 * 按 w05 的「没写系数的不做」停在未解析，不加规则。
 * 本文件锁住两件事：这条句子加了空表之后 IR 一字不变；同族的既有复活/留血句子结果不变。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

type Out = { flags: unknown; effects: unknown[]; unparsed: { clause: string; reason: string }[] };

const HOST = "先制+3；必中；此技能PP值不为满时先制+1；4回合内免疫所有受到的异常状态；消除双方能力提升、下降状态和护盾效果，消除任意一项成功则使对手随机进入两种异常状态，未触发则回合结束时吸取对手最大体力的1/3；若先出手则自身下次受到致死伤害时重生";

describe("add one effect (w05 · 复活句子)", () => {
  it("w05-revive-01：`自身下次受到致死伤害时重生` 仍停在未解析（没写复活血量）", () => {
    const bare = parseEffectText("自身下次受到致死伤害时重生") as Out;
    expect(bare.effects).toEqual([]);
    expect(bare.flags).toEqual({});
    expect(bare.unparsed).toEqual([{ clause: "自身下次受到致死伤害时重生", reason: "no-rule" }]);

    // 宿主整句：条件前缀被条件解析吃掉，只剩这一个子句落 no-rule
    const host = parseEffectText(HOST) as Out;
    expect(host.flags).toEqual({ priority: 3, accuracy: "always" });
    expect(host.effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", turns: 4 },
      { op: "clear_stages", sign: "up", target: "self" },
      { op: "clear_stages", sign: "down", target: "self" },
      { op: "cleanse", scope: "shield", target: "self" },
      { op: "clear_stages", sign: "up", target: "opponent" },
      { op: "clear_stages", sign: "down", target: "opponent" },
      { op: "cleanse", scope: "shield", target: "opponent" },
      {
        op: "apply_status", name: "random",
        random: { list: ["burn", "frostbite", "poison", "paralysis", "fear", "sleep", "blind", "daze", "bind", "confuse", "parasite", "curse", "fatigue", "bleed", "silence", "freeze", "flammable", "ember", "petrify", "shock", "infect", "rage", "feeble", "submit", "freeze"], count: 2 },
        target: "opponent", if: { prevApplied: true },
      },
      { op: "apply_status", name: "drain_dot", target: "self", params: { n: 1, d: 3 }, if: { not: { prevApplied: true } } },
    ]);
    expect(host.unparsed).toEqual([
      { clause: "此技能PP值不为满时先制+1", reason: "no-rule" },
      { clause: "自身下次受到致死伤害时重生", reason: "no-rule" },
    ]);
  });

  it("w05-revive-02：同族既有句结果不变（留血 / 当回合死亡恢复）", () => {
    // 留血：endure（留着血量的同族句子本来就有读数，本轮不碰）
    expect((parseEffectText("受到致死攻击时则余下1点体力") as Out).effects).toEqual([
      { op: "apply_status", name: "endure", target: "self", params: { hp: 1 } },
    ]);
    expect((parseEffectText("1回合内受到致死攻击时则余下1点体力") as Out).effects).toEqual([
      { op: "apply_status", name: "endure", target: "self", params: { hp: 1 }, turns: 1 },
    ]);
    // 复活窗：revive_fx（写清了复活血量 pct=100 的形态，既有规则 e36-11 已认领）
    expect((parseEffectText("若本回合自身死亡则立刻恢复自身所有体力且解除自身异常状态和能力下降状态") as Out).effects).toEqual([
      { op: "apply_status", name: "revive_fx", target: "self", turns: 1, params: { pct: 100 } },
      { op: "cleanse", target: "self", scope: "ailment" },
      { op: "clear_stages", target: "self", sign: "down" },
    ]);
  });
});
