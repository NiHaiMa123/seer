/**
 * add-effect-w04：seer-w04 这一类是「记录体力」。
 * 全量核对（`scratch/parallel/w04-probe.mjs`，只读）之后本类没有做成任何一条：
 * 技能侧 0 命中，唯一写全系数的整句是魂印（伊塔·回溯型），要一个本仓库还没有的
 * 体力快照存/取 op。缺的结算写在 `scratch/parallel/w04-need-op.md`。
 * 所以 `tools/effects-rules/batch-w04.mjs` 保持空表，这里是这一类的**现状锁**：
 * ① 本类那句话的存/取两个子句仍原样留档（没有规则截走），同一条魂印的另一半条目也不变；
 * ② 技能侧全库枚举仍只有那 5 条含「记录」的文本、没有一条是体力快照，
 *    同类旧句（两条 OCR 残字）结果不变——半截 op 不许假装解析成功。
 * 没有新 id，故不写 tests/fixtures/effects-rule-order.json。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const CHECKPOINT_REASON = "checkpoint-restore — hp snapshot/restore pair not modeled (deferred)";

describe("add one effect (w04：记录体力)", () => {
  it("伊塔·回溯型：快照存取与下只精灵作用域都留档", () => {
    const r = parseSoulmarkText(
      "每次登场时记录自身的体力值，自身受到致死攻击伤害时，使自身的体力值回归记录的体力值，每场战斗限一次；"
      + "自身被击败后，己方下只精灵登场首回合免疫受到的攻击，触发成功则令对手瘫痪（boss无效）",
      "伊塔·回溯型",
    ) as { entries: unknown[]; unparsed: { clause: string; reason: string }[] };
    // 存/取两个子句仍显式留档（新 op 未落地前不许静默丢掉）
    expect(r.unparsed.map((u) => u.reason)).toEqual([
      CHECKPOINT_REASON,
      CHECKPOINT_REASON,
      "party-scope — off-field/next-ally target unmodeled (deferred)",
      "party-scope — off-field/next-ally target unmodeled (deferred)",
    ]);
    expect(r.unparsed.map((u) => u.clause)).toEqual([
      "每次登场时记录自身的体力值，自身受到致死攻击伤害时",
      "使自身的体力值回归记录的体力值",
      "己方下只精灵登场首回合免疫受到的攻击",
      "触发成功则令对手瘫痪",
    ]);
    // 下一名队友的效果没有受体/出场窗口支持，不能被拆成孤立免疫与瘫痪条目。
    expect(r.entries).toEqual([]);
  });

  it("技能侧 0 命中：招式文本里的「记录」没有一条是体力快照，旧句结果不变", () => {
    const cat = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")) as {
      creatures: Record<string, { name: string; skills?: { name: string; power?: number | null; effect?: string | null }[] }>;
    };
    const withRecord: { pet: string; move: string; text: string }[] = [];
    for (const c of Object.values(cat.creatures)) {
      for (const s of c.skills ?? []) {
        const text = (s.effect ?? "").trim();
        if (text.includes("记录")) withRecord.push({ pet: c.name, move: s.name, text });
      }
    }
    // 全库只有这 5 条（两条 OCR 残文 + 蓓丽安特三招的「星执记录的异常状态」），没有体力快照句
    expect(withRecord.map((x) => `${x.pet}::${x.move}`).sort()).toEqual([
      "坤格::神火罩",
      "蓓丽安特::星垂穹仪",
      "蓓丽安特::星执·浩邃星幕",
      "蓓丽安特::星河入眸",
      "远古圣卫::圣卫之盾",
    ]);
    expect(withRecord.some((x) => /记录[^，。；;]{0,6}体力|回归记录的体力/.test(x.text))).toBe(false);

    // 同类旧句不变：坤格/远古圣卫的「记录」是 OCR 残字，旧规则照旧吃下，逐字子句不残留
    const kunge = parseEffectText("100%记录将对方烧伤", { hasDamage: false }) as { effects: unknown[]; unparsed: unknown[] };
    expect(kunge.unparsed).toEqual([]);
    expect(kunge.effects).toEqual([{ op: "apply_status", name: "burn", target: "opponent", chance: 100 }]);
    const guard = parseEffectText(
      "3回合内若对手使用攻击技能则有100%记录随机进入烧伤、冻伤、中毒、麻痹、害怕、睡眠中的一种异常状态",
      { hasDamage: false },
    ) as { effects: unknown[]; unparsed: { reason: string }[] };
    // payload 里那个 OCR 残字「记录」照旧留档，没有半截 op 假装解析成功（这一类不动它）
    expect(guard.effects).toEqual([]);
    expect(guard.unparsed.map((u) => u.reason)).toEqual([
      "react payload unparsed: 有100%记录随机进入烧伤、冻伤、中毒、麻痹、害怕、睡眠中的一种异常状态",
    ]);
  });
});
