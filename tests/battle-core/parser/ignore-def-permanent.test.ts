/**
 * 逐只处理：pet-3513 哈恩特（魂印「哈：攻击忽略对手防御值的20%」）。
 *
 * 缺口：整句不是「规则不认识」，而是**规则认错了**——
 *   heal-226 的正则是 `^下?次?攻击忽略…`，「下」「次」两个都可选，
 *   于是把常驻的「攻击忽略对手防御值的20%」也吞进去，并挂上 count:1
 *   （次数窗＝只生效一次）。结果：永久被动被凭空缩成一次，
 *   而句子里根本没有「下次」二字。
 *
 * 改法（都在家族规则里，不动 engine / damage）：
 *   - tools/effects-rules/heal.mjs  heal-226：「次」必须写出来（`^下次攻击忽略…`）。
 *   - tools/effects-rules/batch-e8.mjs e8-tn-05：补「攻击/所有攻击/自身」主语前缀，
 *     常驻语义不挂 count。
 * 触点预算 2：家族规则一条 + 同族宽规则的先后；没有新 op / 新状态名 / 新 params 键。
 *
 * 本文件同时锁住两条相邻旧句子，证明新规则没有把它们截走：
 *   - 「下次攻击忽略对手防御值的20%」→ 仍是 count:1 的次数窗
 *   - 「忽略对手防御值的20%」→ 仍是常驻
 */
import { describe, it, expect } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const effectsOf = (s: string) => (parseEffectText(s) as { effects: unknown[]; unparsed: unknown[] });

describe("逐只处理 pet-3513 哈恩特：常驻「攻击忽略对手防御值的N%」", () => {
  it("新句：常驻形不带 count（不再是「一次」）", () => {
    const r = effectsOf("攻击忽略对手防御值的20%");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "ignore_def", target: "self", params: { pct: 20 } },
    ]);
  });

  it("旧句不回归：「下次攻击忽略…」仍是次数窗 count:1", () => {
    const r = effectsOf("下次攻击忽略对手防御值的20%");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "ignore_def", target: "self", params: { pct: 20, count: 1 } },
    ]);
  });

  it("旧句不回归：裸形仍是常驻", () => {
    const r = effectsOf("忽略对手防御值的20%");
    expect(r.unparsed).toEqual([]);
    expect(r.effects).toEqual([
      { op: "apply_status", name: "ignore_def", target: "self", params: { pct: 20 } },
    ]);
  });

  it("魂印层：pet-3513 整条无残文，产出 onBattleStart 常驻窗 + 回合末吸取", () => {
    const r = parseSoulmarkText(
      "哈：攻击忽略对手防御值的20%，每回合吸取对手100点体力（BOSS无效）",
      "哈恩特",
    );
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      {
        hook: "onBattleStart",
        bossGate: true,
        ops: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: 20 } }],
      },
      {
        hook: "onTurnEnd",
        bossGate: true,
        ops: [
          { op: "damage", power: 100, kind: "fixed" },
          { op: "heal", flat: 100, target: "self" },
        ],
      },
    ]);
  });
});
