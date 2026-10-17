/**
 * add-effect-w08：seer-w08 这一类是「出战背包」。
 *
 * 这份文件原来记的是「这一类做不出来」的现状锁——r2c 时停在
 * 「规则写得出来但形状没有读者」。r3b 已把结算补上（`apply_stat_stage.deltaMulChance.perBench`，
 * 读法在 `ops/stat-stage.ts` 的 `benchMulChanceOf`），本类的那 7 句现在走
 * `tools/effects-rules/batch-w08.mjs` 的三条规则落地；逐句 IR 与顺序契约见
 * `add-effect-r3b.test.ts`。这里保留的是**没被这一次改动碰到的边界**：
 *   ① 技能侧含「背包」的仍是那 7 条（不多不少，没有别的背包形态混进来）；
 *   ② 逗号变体（计数片段被逗号切开）**不**走新规则——它照旧挂 `flags.benchCtx` + 裸
 *      `multiplySelf`，引擎侧那份 `benchCtx` 没有消费者；
 *   ③ 魂印侧的出战背包句仍停在位置谓词（这一类不动 `soulmark-parse.mjs`）；
 *   ④ 顺序契约：本家族排在 `batchE26` 之后，`e26-df-02` 的 `re` 逐字未动（放行写在 `go` 里）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";

/** 全库技能文本里含「背包」的条目（pet:skill → 文本）。 */
function benchSkills(): { key: string; text: string }[] {
  const cat = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")) as {
    creatures: Record<string, { name: string; skills?: { name: string; effect?: string | null }[] }>;
  };
  const out: { key: string; text: string }[] = [];
  for (const c of Object.values(cat.creatures)) {
    for (const s of c.skills ?? []) {
      const text = (s.effect ?? "").trim();
      if (text.includes("背包")) out.push({ key: `${c.name}:${s.name}`, text });
    }
  }
  return out;
}

describe("add one effect (w08：出战背包)", () => {
  it("技能侧「出战背包」0 命中，「背包」面只有那 7 条（r3b 落地后条数不变）", () => {
    const skills = benchSkills();
    // 「出战背包」在技能侧一条都没有（该类只在魂印/巅峰文本里）
    expect(skills.filter((s) => s.text.includes("出战背包"))).toEqual([]);
    // 含「背包」的恰好 7 条，全是「自身背包内每(存活|阵亡)N只精灵则X%的几率强化效果翻倍」的宿主整句
    expect(skills.map((s) => s.key).sort()).toEqual([
      "堕魂·格特鲁德:魔血沸腾",
      "天后·弗丽嘉:苍鹭幻翎",
      "娜诺:征程星火",
      "尤莉米特:辉弥天野",
      "贝利亚奥特曼:百体怪兽装填",
      "镇世·乔特鲁德:浴血奋战",
      "阿华华:细胞分裂",
    ]);
    for (const s of skills) expect(s.text).toMatch(/自身背包内每(存活|阵亡)\d+只精灵则\d+%的(概率|几率)强化效果翻倍/);
  });

  it("逗号变体不走新规则：照旧只挂 benchCtx + 裸 multiplySelf（引擎侧那份 benchCtx 仍无消费者）", () => {
    // 同一条「背包」面的旧写法（计数片段被逗号切开）——r3b 只认「…则X%…强化效果翻倍」整句
    const comma = parseEffectText("背包内每存活1只精灵，则50%的概率强化效果翻倍", { hasDamage: false }) as {
      flags: Record<string, unknown>;
      effects: unknown[];
      unparsed: unknown[];
    };
    expect(comma.flags).toEqual({ benchCtx: { dead: false, per: 1 } });
    expect(comma.effects).toEqual([{ op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self" }]);
    expect(comma.unparsed).toEqual([]);

    // 没写「背包」的纯强化翻倍旧句照旧——不带任何 bench 计数语境
    const plain = parseEffectText("强化效果翻倍", { hasDamage: false }) as { flags: Record<string, unknown>; effects: unknown[] };
    expect(plain.flags).toEqual({});
    expect(plain.effects).toEqual([{ op: "apply_stat_stage", stat: "all", multiplySelf: true, delta: 1, target: "self" }]);
  });

  it("魂印侧的出战背包句仍停在位置谓词（这一类不动 soulmark-parse.mjs）", () => {
    const r = parseSoulmarkText("自身位于出战背包时，己方免疫受到的失明状态 （boss无效）", "灯珑鱼") as {
      entries: unknown[];
      unparsed: { clause: string; reason: string }[];
      bossGate: boolean;
    };
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toEqual([{ clause: "自身位于出战背包时，己方免疫受到的失明状态", reason: "bench-position predicate (UNVERIFIED)" }]);
    expect(r.bossGate).toBe(true);
  });

  it("顺序契约：本家族排在 e26-df-02 之后，且 e26-df-02 的 re 逐字未动", () => {
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(ids.indexOf("w08-bench-stage-01")).toBeGreaterThan(ids.indexOf("e26-df-02"));
    const orderSrc = readFileSync(fileURLToPath(new URL("../../../tools/effects-rules/order.mjs", import.meta.url)), "utf8");
    expect(orderSrc.indexOf("...batchE26")).toBeGreaterThanOrEqual(0);
    expect(orderSrc.indexOf("...batchW08")).toBeGreaterThan(orderSrc.indexOf("...batchE26"));
    // 宽兜底整面仍在（`re` 不动），放行只写在 go 里——`re` 收窄会把别的背包形态放到 no-rule
    const src = readFileSync(fileURLToPath(new URL("../../../tools/effects-rules/batch-e26.mjs", import.meta.url)), "utf8");
    expect(src.slice(src.indexOf('{ id: "e26-df-02"'), src.indexOf('{ id: "e26-df-03"'))).toContain("re: /^背包|背包内|己方背包/,");
  });
});
