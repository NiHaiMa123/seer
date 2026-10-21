/**
 * add-effect-w07：seer-w07 这一路（w07.md 点名的「相邻、隔位、站位句子」）的结论记录。
 *
 * **本路没有加任何规则**（tools/effects-rules/batch-w07.mjs 保持 `export const rules = []`）。
 * 语料里带站位词的片段一共十来条，全在同一个双形态魂印族（萌芽之薇 `pet-4852`、纷争之薇 `pet-4862`、
 * 初诞之薇 `pet-4889`、荣光之薇 `pet-4899`，另加薇尔诗 `pet-4000`）和一个句式的四只宿主里。
 * 逐条核对后三类缺口全部超出本路触点预算（第四类见下），缺口与要补的结算写在
 * scratch/parallel/w07-need-op.md：
 *   - 「与自身相邻/隔位的精灵」当**受体**：站位序没有建模。engine 的侧状态只有 unit + bench
 *     两个箱子（packages/battle-core/src/engine.ts:189），没有相邻/隔位的槽位序、没有小队队列；
 *     mechanics 下没有任何位置域。
     *   - 「自身位于场下时」：非出战位作用域没有运行时受体，魂印层按
     *     `party-scope — off-field/next-ally target unmodeled (deferred)` 留档。
 *   - 「每损失/每有 N% 的体力」的档数：这一族的步进在引擎里只有**威力**形
 *     （`{ op:"power", of:"powerPerMissing", value:{per,pow} }`），要落在出伤/吸取上得加新
 *     `params` 键加新结算读取——touch-budget 明令停下的那一档。
 *
 * 第四类「自身为（己方）最后一只存活精灵时先制+N」不是缺谓词而是**规则表到不了**：
 * 句首条件半句先被 condPrefix/condOf 剥走（effects-parse.mjs:382），条件半句单独成段时又撞上
 * attach-all.mjs:14 的 whole-clause 守卫（`last-alive cond — E4`）。
 * 试写又撤回的三条（含这一条）都记在 tools/effects-rules/batch-w07.mjs 的文件头。
 * 本文件只做结论记录：把这几句现在的形状钉住，免得后来者按「站位词」去匹配整句，
 * 把「相邻的精灵恢复150点体力」落成自身回血。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import { rules as w07Rules } from "../../../tools/effects-rules/batch-w07.mjs";

type Parsed = { flags: Record<string, unknown>; effects: unknown[]; unparsed: { clause?: string; reason?: string }[] };

describe("add one effect (w07 · 站位/相邻/隔位)", () => {
  it("规则表保持空：这一族没有一条落在触点预算内", () => {
    expect(w07Rules).toEqual([]);
  });

  it("「相邻的精灵」当受体：停在未解析，不许落成自身回血", () => {
    const heal = parseEffectText("与自身相邻的精灵恢复150点体力") as Parsed;
    expect(heal.effects).toEqual([]);
    expect(heal.unparsed).toEqual([{ clause: "与自身相邻的精灵恢复150点体力", reason: "no-rule" }]);
    // 双形态宿主句的前半：只有「自身恢复150点体力」那半边落地，触发半句与站位的受体都留在未解析
    const host = parseEffectText("自身位于场下时，与自身相邻的精灵每次受到攻击伤害后，自身恢复150点体力") as Parsed;
    expect(host.effects).toEqual([{ op: "heal", flat: 150, target: "self" }]);
    expect(host.unparsed).toEqual([
      { clause: "自身位于场下时", reason: "no-rule" },
      { clause: "与自身相邻的精灵每次受到攻击伤害后", reason: "no-rule" },
    ]);
    // 「隔位的精灵」作受体的整句（宿主 初诞之薇）同理
    const separated = parseEffectText("自身隔位的精灵存活时，自身登场时双方在场精灵本场战斗免疫下1次受到的异常状态") as Parsed;
    expect(separated.effects).toEqual([]);
    expect(separated.unparsed).toEqual([
      { clause: "自身隔位的精灵存活时", reason: "no-rule" },
      { clause: "自身登场时双方在场精灵本场战斗免疫下1次受到的异常状态", reason: "no-rule" },
    ]);
  });

  it("「首位/末位的精灵」条件半句：仍是孤儿谓词，效果半边是既有的自身侧近似", () => {
    // 宿主 薇尔诗「己方首位的精灵存活时，己方每损失1%的体力，自身造成的攻击伤害提升1%」的后半
    const first = parseEffectText("己方首位的精灵存活时，自身造成的攻击伤害提升1%") as Parsed;
    expect(first.effects).toEqual([{ op: "scale", of: "mul", value: { numerator: 101, denominator: 100 } }]);
    expect(first.unparsed).toEqual([{ clause: "己方首位的精灵存活时", reason: "no-rule" }]);
    // 「己方末位的精灵死亡时，本场战斗自身免疫受到的固定伤害」：死亡触发未建模，免疫半边照旧落地
    const last = parseEffectText("己方末位的精灵死亡时，本场战斗自身免疫受到的固定伤害") as Parsed;
    expect(last.effects).toEqual([{ op: "apply_status", name: "flat_immune", target: "self" }]);
    expect(last.unparsed).toEqual([{ clause: "己方末位的精灵死亡时", reason: "no-rule" }]);
  });

  it("「每损失/每有N%的体力」的步进没有落点：宿主半句留在未解析，效果半边是既有近似", () => {
    const dmg = parseEffectText("自身每损失10%的体力，下只出战精灵造成的攻击伤害提升3%") as Parsed;
    expect(dmg.unparsed).toContainEqual({ clause: "自身每损失10%的体力", reason: "no-rule" });
    const drain = parseEffectText("自身每有10%的体力，下只出战精灵吸取对手最大体力的2%") as Parsed;
    expect(drain.unparsed).toContainEqual({ clause: "自身每有10%的体力", reason: "no-rule" });
    // 无逗号的整段形（魂印层 go() 拿到的形态）仍整段未解析——本路没有撤回中的常量形残留
    const whole = parseEffectText("自身每损失10%的体力下只出战精灵造成的攻击伤害提升3%") as Parsed;
    expect(whole.effects).toEqual([]);
    expect(whole.unparsed).toEqual([
      { clause: "自身每损失10%的体力下只出战精灵造成的攻击伤害提升3%", reason: "no-rule" },
    ]);
  });

  it("「最后一只存活精灵」条件：走 condOf 的 benchAliveEq:0，不是本路能改的谓词", () => {
    // 宿主 古代巨型机器人/终结·独立日、喧云/世末歌者、奥菲利娅/祈愿·拂晓之诗、星光·艾欧丽娅/歼世灭尽的隆冬
    const src = "自身为己方最后一只存活精灵时先制+1";
    const next = parseEffectText(src) as Parsed;
    expect(next.flags).toEqual({ priorityIf: { when: { benchAliveEq: 0 }, add: 1 } });
    expect(next.effects).toEqual([]);
    expect(next.unparsed).toEqual([]);
    const lone = parseEffectText("自身为己方最后一只存活精灵时") as Parsed;
    expect(lone.effects).toEqual([]);
    expect(lone.unparsed).toEqual([{ clause: "自身为己方最后一只存活精灵时", reason: "last-alive cond — E4" }]);
    // 条件半句单独出现时被 attach-all.mjs:14 的 whole-clause 守卫挡下（规则表里的另一道门）；
    // 带「先制+N」尾巴时则由 condPrefix → condOf 认走（effects-parse.mjs:382）——
    // 两条路都轮不到规则表，所以本路没法只换 when。
  });

  it("非出战位生效域：魂印层整句留档，不落成常驻效果", () => {
    const offField = parseSoulmarkText("自身位于场下时，与自身相邻的精灵每次受到攻击伤害后，自身恢复150点体力") as {
      entries: unknown[];
      unparsed: { reason?: string }[];
    };
    expect(offField.entries).toEqual([]);
    expect(offField.unparsed).toEqual([
      {
        clause: "自身位于场下时，与自身相邻的精灵每次受到攻击伤害后，自身恢复150点体力",
        reason: "party-scope — off-field/next-ally target unmodeled (deferred)",
      },
    ]);
  });
});
