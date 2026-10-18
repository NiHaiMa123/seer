/**
 * add-effect-r3b：「自身背包内每存活/阵亡 N 只精灵则 X% 的概率强化效果翻倍」。
 *
 * r2c 时这一类停住的原因不是规则写不出来，而是**形状没有读者**：当时只发得出
 * `periodic{params:{chance, perBenchAlive}}`，概率照旧静态 X%（periodic 判定只读
 * `chance.base`/`chance.dyn`），而且宿主整句的 effects 次序会被改掉。
 * r3b 的落地形状换成挂在现成的 `apply_stat_stage.deltaMulChance` 上：
 *   `{ chance: X, numerator: 2, denominator: 1, perBench: { of: "alive"|"dead", per: N } }`
 * 判定概率 = min(100, X × max(1, ⌊背包计数 / N⌋))（读法在 `ops/stat-stage.ts` 的 `benchMulChanceOf`，
 * 行为在 `tests/battle-core/ops/bench-stage.test.ts`）。这个形状与裸句 `timed-45`
 * （「30%概率强化效果翻倍」→ 同键、无 perBench）同构，因此宿主整句里只有原来那条
 * 「强化效果翻倍」子句的留档消失，**其它 effect 的种类与次序逐字不变**。
 *
 * 本文件锁：7 句逐句的 IR、宿主整句的次序、放行只限这 6 种字面（别的背包句仍 deferred）、
 * 以及 e26-df-02 的 re 逐字未动（放行写在 go 里）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as w08Rules } from "../../../tools/effects-rules/batch-w08.mjs";

const BENCH_REASON = "bench/party scope — unmodeled (deferred)";

type Parsed = {
  flags: Record<string, unknown>;
  effects: { op: string; stat?: string; delta?: number; deltaMulChance?: unknown; [k: string]: unknown }[];
  unparsed: { clause: string; reason: string }[];
};

/** 绕过 order 顺序跑本家族规则。 */
const direct = (s: string) => {
  for (const r of w08Rules as { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown }[]) {
    const m = s.match(r.re);
    if (m) return { id: r.id, out: r.go(m) as { attachAll?: Record<string, unknown> } };
  }
  return undefined;
};

/** 全库技能里含「背包」的 7 条（pet/skill → 整句文本 + 该子句）。 */
function benchSkills(): { key: string; text: string; clause: string }[] {
  const cat = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")) as {
    creatures: Record<string, { name: string; skills?: { name: string; effect?: string | null; power?: number }[] }>;
  };
  const out: { key: string; text: string; clause: string }[] = [];
  for (const c of Object.values(cat.creatures)) {
    for (const s of c.skills ?? []) {
      const text = (s.effect ?? "").trim();
      if (!text.includes("背包")) continue;
      // 「背包」子句自身不含逗号——按 ；与 ，切开取那一片
      out.push({ key: `${c.name}:${s.name}`, text, clause: text.split(/[；;，,]/).find((x) => x.includes("背包"))!.trim() });
    }
  }
  return out;
}

/** 这一条里正 delta 的 stage 条目（7 句都是「全属性+1」→ 5 条）。 */
const ups = (p: Parsed) => p.effects.filter((e) => e.op === "apply_stat_stage" && (e.delta ?? 0) > 0);

/** 去掉 deltaMulChance 的骨架——用来比「其它 effect 一字不变」。 */
const skeleton = (p: Parsed) => p.effects.map(({ deltaMulChance: _d, ...rest }) => rest);

describe("add one effect (r3b：背包计数放大强化翻倍概率)", () => {
  it("技能侧含「背包」的仍是那 7 条，且都带了背包计数子句", () => {
    const skills = benchSkills();
    expect(skills.map((s) => s.key).sort()).toEqual([
      "堕魂·格特鲁德:魔血沸腾",
      "天后·弗丽嘉:苍鹭幻翎",
      "娜诺:征程星火",
      "尤莉米特:辉弥天野",
      "贝利亚奥特曼:百体怪兽装填",
      "镇世·乔特鲁德:浴血奋战",
      "阿华华:细胞分裂",
    ]);
    for (const s of skills) expect(s.clause).toMatch(/^(?:自身|己方)?背包内每(存活|阵亡)\d只精灵则\d+%的(概率|几率)强化效果翻倍$/);
  });

  it("7 句逐句：正 delta 的 stage 挂上 deltaMulChance.perBench，X 与 of 逐条对上", () => {
    const expected: Record<string, { chance: number; of: "alive" | "dead" }> = {
      "娜诺:征程星火": { chance: 50, of: "alive" },
      "阿华华:细胞分裂": { chance: 25, of: "alive" },
      "天后·弗丽嘉:苍鹭幻翎": { chance: 50, of: "alive" },
      "尤莉米特:辉弥天野": { chance: 20, of: "alive" },
      "镇世·乔特鲁德:浴血奋战": { chance: 10, of: "alive" },
      "堕魂·格特鲁德:魔血沸腾": { chance: 10, of: "dead" },
      "贝利亚奥特曼:百体怪兽装填": { chance: 30, of: "dead" },
    };
    for (const s of benchSkills()) {
      const exp = expected[s.key]!;
      const p = parseEffectText(s.text, { hasDamage: false }) as Parsed;
      // 这一句不再留档
      expect(p.unparsed.filter((u) => u.reason === BENCH_REASON)).toEqual([]);
      // 全属性 +1 → 5 条正 delta stage，全部带同一份判定
      expect(ups(p)).toHaveLength(5);
      for (const e of ups(p)) {
        expect(e.deltaMulChance).toEqual({ chance: exp.chance, numerator: 2, denominator: 1, perBench: { of: exp.of, per: 1 } });
      }
      // 只有正 delta 条目带——负 delta 的 stage（若有）不受影响
      for (const e of p.effects.filter((x) => x.op === "apply_stat_stage" && (x.delta ?? 0) < 0)) expect(e.deltaMulChance).toBeUndefined();
      // 不再发 periodic、不再多发 op：整句只多出 deltaMulChance 这一个键
      expect(p.effects.some((e) => e.op === "apply_status" && (e as { name?: string }).name === "periodic")).toBe(false);
      const stripped = parseEffectText(s.text.replace(/，?(?:自身|己方)?背包内每[^；;]*/, ""), { hasDamage: false }) as Parsed;
      expect(skeleton(p)).toEqual(skeleton(stripped));
      expect(p.flags).toEqual(stripped.flags);
      expect(p.unparsed).toEqual(stripped.unparsed);
    }
  });

  it("宿主整句：只有原来那条「强化效果翻倍」留档消失，其余 effect 的种类与次序不变", () => {
    const host = "必中；全属性+1，自身背包内每存活1只精灵则25%的概率强化效果翻倍；100%降低对手所有技能1点PP值，然后若对手所选择的技能PP值为0则当回合对手无法行动；下2回合令自身所有技能先制+2";
    const p = parseEffectText(host, { hasDamage: false }) as Parsed;
    expect(p.flags).toEqual({ accuracy: "always" });
    // PP 子句现在也能落地（cond 加了 foeMovePpZero），所以多出一条 control
    expect(p.effects.map((e) => e.op)).toEqual([
      "apply_stat_stage", "apply_stat_stage", "apply_stat_stage", "apply_stat_stage", "apply_stat_stage",
      "pp_delta", "control", "apply_status",
    ]);
    for (const e of ups(p)) expect(e.deltaMulChance).toEqual({ chance: 25, numerator: 2, denominator: 1, perBench: { of: "alive", per: 1 } });
    // 背包子句不再留档，别的留档原样
    // 该 PP 子句已由 e41-pp-01 + cond 的 foeMovePpZero 实现，不再留档
    expect(p.unparsed).toEqual([]);
  });

  it("规则本身：整句 → attachAll.stageChanceMul + bench（N 分母与 of 都从捕获组来）", () => {
    expect(direct("自身背包内每存活1只精灵则50%的概率强化效果翻倍")).toEqual({
      id: "w08-bench-stage-01",
      out: { attachAll: { stageChanceMul: 50, bench: { of: "alive", per: 1 } } },
    });
    // 阵亡 + 非 1 分母 + 省略「自身」
    expect(direct("背包内每阵亡3只精灵则30%的几率强化效果翻倍")).toEqual({
      id: "w08-bench-stage-01",
      out: { attachAll: { stageChanceMul: 30, bench: { of: "dead", per: 3 } } },
    });
    // 省略「的」；省略概率词（按 100% 判定）
    expect(direct("己方背包内每存活1只精灵则20%强化效果翻倍")).toEqual({
      id: "w08-bench-stage-02",
      out: { attachAll: { stageChanceMul: 20, bench: { of: "alive", per: 1 } } },
    });
    expect(direct("自身背包内每存活1只精灵则强化效果翻倍")).toEqual({
      id: "w08-bench-stage-03",
      out: { attachAll: { stageChanceMul: 100, bench: { of: "alive", per: 1 } } },
    });
    // 非 1 分母整句：per 走到 IR 上
    const p = parseEffectText("全属性+1，自身背包内每存活3只精灵则30%的概率强化效果翻倍", { hasDamage: false }) as Parsed;
    expect(ups(p)[0]!.deltaMulChance).toEqual({ chance: 30, numerator: 2, denominator: 1, perBench: { of: "alive", per: 3 } });
  });

  it("放行只限这 6 种字面：别的「背包」句子仍 deferred", () => {
    for (const clause of [
      "背包内每少携带一个精灵20%的概率议事成功", // 攻略散文里的同头异体
      "对手背包内每有一只阵亡精灵则自身闪避率提升20%",
      "自身背包内每存活1只精灵则50%的概率使对手害怕", // 同头但尾巴不是「强化效果翻倍」
      "自身背包内每存活1只精灵", // 只有前缀没有载荷
    ]) {
      const p = parseEffectText(clause, { hasDamage: false }) as Parsed;
      expect(p.effects).toEqual([]);
      expect(p.unparsed).toEqual([{ clause: p.unparsed[0]!.clause, reason: BENCH_REASON }]);
      expect(p.unparsed).toHaveLength(1);
    }
  });

  it("e26-df-02 的 re 逐字未动，放行写在 go 里；w08 规则排在它之后", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../tools/effects-rules/batch-e26.mjs", import.meta.url)), "utf8");
    const block = src.slice(src.indexOf('{ id: "e26-df-02"'), src.indexOf('{ id: "e26-df-03"'));
    expect(block).toContain("re: /^背包|背包内|己方背包/,");
    // 唯一命中者仍是 e26-df-02（w08 在它之后，靠 go 放行才轮得到）
    const clause = "自身背包内每存活1只精灵则50%的概率强化效果翻倍";
    expect(RULES.filter((r: { re: RegExp }) => r.re.test(clause)).map((r: { id: string }) => r.id)).toEqual(["e26-df-02", "w08-bench-stage-01"]);
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(ids.indexOf("w08-bench-stage-01")).toBeGreaterThan(ids.indexOf("e26-df-02"));
  });
});
