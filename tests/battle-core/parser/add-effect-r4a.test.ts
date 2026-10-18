/**
 * add-effect-r4a：被 `marks-21` 整段留档（或同族 no-rule）、但后文（`marks-21` 之后）已有现成 op 的
 * 「下(一)?N次」句子。规则加在 `tools/effects-rules/marks.mjs` 里 `marks-21` 之前，
 * id 前缀 `r4a-`，每条只做「窗口头 + 余部」的复合匹配，**不发新 op**：
 *
 *   | 句子形态 | 命中规则 | 发出的状态 |
 *   |---|---|---|
 *   | `下N次自身技能先制+M` | `r4a-next-prio-01` | `prio_count{add,count}`（= e32-prio-02） |
 *   | `下N次攻击(技能)?(时)?无视(对手)?(攻击)?免疫…` | `r4a-next-pierce-01` | `pierce{count}`（= e32-pi-01 / e36-35） |
 *   | `下N次攻击命中时消耗…全部PP值` | `r4a-next-ppcon-01` | `pp_consume_hit{count}`（= e34-ppcon-01） |
 *   | `下N次(造成的)?伤害提高N%` | `r4a-next-dmgboost-01` | `dmg_boost{pct,count}`（= e31-cb-01） |
 *   | `下N次(自身)?受到的伤害减少N%` | `r4a-next-taken-01` | `dmg_taken_down{pct,count}`（= e9-tk-03） |
 *   | `下N次攻击(技能)必定打出偶数攻击伤害` | `r4a-next-even-01` | `even_dmg{count}`（= e40-10） |
 *
 * 本文件锁：① 39 条宿主技能里那 14 个字面的 IR 与宿主整句次序；
 * ② 规则直调（含省略「自身」「的」「技能」的近形）；③ 没做的形态仍原样由 marks-21 留档（旧结果不变）；
 * ④ marks-21 逐字未动、位置仍在全部 r4a 之后。
 *
 * 注一：`marks.mjs` 的 `NUM` 自带捕获组（`(?:下(?:${NUM}|一)次)` 里那个），所以每条的
 * 「次数」在 `m[1]`、余部在 `m[2]`，余部里的数字在 `m[3]`——与下游规则直吃整句时的下标不同，
 * 写错会把 `[+-]` 的交替换进 `num()`（试过一次：`add` 变成 null，条目被 loader 判 malformed）。
 * 注二：耗 PP 那族在同一招里会被 `effects-parse.mjs` 的「每消耗N点…」后处理**回挂**进同一条
 * `pp_consume_hit` 的 params（`pctPerPp`/`foeAllDown`/`ppStep`），那一步是既有行为，
 * 所以宿主的 params 比单句形态多键——本文件按「多键也认」来锁，不按单句的精确形状锁。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as markRules } from "../../../tools/effects-rules/marks.mjs";

const DEFERRED = "next-apply window — single-use mounting not modeled (deferred)";

type Eff = { op: string; name?: string; target?: string; params?: Record<string, unknown>; turns?: number; if?: unknown };
type Parsed = { flags: Record<string, unknown>; effects: Eff[]; unparsed: { clause: string; reason: string }[] };
type Rule = { id: string; re: RegExp; go: (m: RegExpMatchArray) => unknown };

const parse = (s: string) => parseEffectText(s, { hasDamage: false }) as Parsed;
const ruleOf = (id: string) => (markRules as Rule[]).find((r) => r.id === id)!;
/** 绕过 order 顺序跑本批规则（余部命中判定用）；整条不匹配返回哨兵 NO_MATCH。 */
const NO_MATCH = Symbol("no-match");
const direct = (id: string, s: string) => {
  const m = s.match(ruleOf(id).re);
  return m === null ? NO_MATCH : ruleOf(id).go(m);
};

/** 宿主文本里被本批吃掉的那个字面（EXPECT 的键，逐字出现在文本中）。 */
const clauseOf = (text: string) => Object.keys(EXPECT).find((cl) => text.includes(cl))!;

/** 14 个字面 → 期望的 (规则, 状态名, params)。 */
const EXPECT: Record<string, { id: string; name: string; params: Record<string, unknown> }> = {
  "下1次自身技能先制+2": { id: "r4a-next-prio-01", name: "prio_count", params: { add: 2, count: 1 } },
  "下1次自身技能先制+1": { id: "r4a-next-prio-01", name: "prio_count", params: { add: 1, count: 1 } },
  "下2次攻击技能无视对手攻击免疫效果": { id: "r4a-next-pierce-01", name: "pierce", params: { count: 2 } },
  "下1次攻击技能无视对手攻击免疫效果": { id: "r4a-next-pierce-01", name: "pierce", params: { count: 1 } },
  "下2次攻击技能无视攻击免疫效果": { id: "r4a-next-pierce-01", name: "pierce", params: { count: 2 } },
  "下1次攻击技能无视攻击免疫效果": { id: "r4a-next-pierce-01", name: "pierce", params: { count: 1 } },
  "下1次攻击命中时消耗所使用攻击技能的全部PP值": { id: "r4a-next-ppcon-01", name: "pp_consume_hit", params: { count: 1 } },
  "下2次攻击命中时消耗所使用攻击技能的全部PP值": { id: "r4a-next-ppcon-01", name: "pp_consume_hit", params: { count: 2 } },
  "下1次造成的伤害提高100%": { id: "r4a-next-dmgboost-01", name: "dmg_boost", params: { pct: 100, count: 1 } },
  "下2次造成的伤害提高100%": { id: "r4a-next-dmgboost-01", name: "dmg_boost", params: { pct: 100, count: 2 } },
  "下1次造成伤害提升100%": { id: "r4a-next-dmgboost-01", name: "dmg_boost", params: { pct: 100, count: 1 } },
  "下1次造成的伤害提高50%": { id: "r4a-next-dmgboost-01", name: "dmg_boost", params: { pct: 50, count: 1 } },
  "下2次自身受到的伤害减少50%": { id: "r4a-next-taken-01", name: "dmg_taken_down", params: { pct: 50, count: 2 } },
  "下2次攻击技能必定打出偶数攻击伤害": { id: "r4a-next-even-01", name: "even_dmg", params: { count: 2 } },
};

/** 宿主「宿主句」的对照：去掉被吃掉的子句（连着左侧分隔符）后重解析（证明别的子句一字未动）。 */
const ctrlOf = (h: { text: string; clause: string }) =>
  parse(
    h.text
      .split(h.clause)
      .join("")
      // 子句前留着的空分隔符（"…X；<子句>" → "…X；"）一并去掉，免得对照多出个空 part
      .replace(/[；;，,]\s*$/, ""),
  );

/** 宿主里允许被既有后处理「回挂」进同一条的键（"每消耗N点威力提升10%/令对手全属性-1"）。 */
const REGRAFTED = ["pctPerPp", "foeAllDown", "ppStep"];

/** 全库技能里含这 14 个字面的宿主（pet:skill → 文本 + 子句 + 期望）。 */
function hostSkills(): { key: string; text: string; clause: string; want: (typeof EXPECT)[string] }[] {
  const cat = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")) as {
    creatures: Record<string, { name: string; skills?: { name: string; effect?: string | null; power?: number }[] }>;
  };
  const out: { key: string; text: string; clause: string; want: (typeof EXPECT)[string] }[] = [];
  for (const c of Object.values(cat.creatures)) {
    for (const s of c.skills ?? []) {
      const text = (s.effect ?? "").trim();
      const literal = Object.keys(EXPECT).find((cl) => text.includes(cl));
      if (literal === undefined) continue;
      out.push({ key: `${c.name}:${s.name}`, text, clause: literal, want: EXPECT[literal]! });
    }
  }
  return out;
}

describe("add one effect (r4a：被 marks-21 留档但后文有格子的「下N次」)", () => {
  it("39 条宿主：14 个字面都不再留档，效果与下游同族规则逐字同形", () => {
    const hosts = hostSkills();
    // 39 = 13 个字面的 38 条 + 没被 marks-21 吃掉、但同样由本批接住的
    // 「下1次攻击技能无视攻击免疫效果」（原本停在 no-rule）
    expect(hosts).toHaveLength(39);
    for (const h of hosts) {
      const p = parse(h.text);
      // 这一句不留档：既不是 marks-21 的理由，也不是任何别的理由
      expect(p.unparsed.filter((u) => u.clause === h.clause), h.key).toEqual([]);
      // 效果条目：op 名 / target 逐字，params 至少含单句形态那一份（耗 PP 族会被后处理回挂多键）
      const hit = p.effects.find((e) => e.op === "apply_status" && e.name === h.want.name);
      expect(hit, `${h.key} ${h.clause}`).toBeDefined();
      expect(hit!.target).toBe("self");
      expect(hit!.params).toMatchObject(h.want.params);
      expect(hit!.turns).toBeUndefined(); // 次数窗不落在 turns 上（与下游同族规则的形状一致）
      // 条目形状：apply_status + target:self + 无 turns；params 除「回挂键」外与规则直调那份逐字相等；
      // 唯一允许的额外条目键是条件 `if`（宿主里「未触发则自身下1次…」会把条件挂上来）
      expect(hit).toMatchObject({ op: "apply_status", name: h.want.name, target: "self", params: expect.objectContaining(h.want.params) });
      expect(Object.keys(hit!).filter((k) => !["op", "name", "target", "params", "if"].includes(k)), h.key).toEqual([]);
      for (const k of Object.keys(hit!.params!)) {
        if (!(k in h.want.params)) expect(REGRAFTED, `${h.key} 多出的键 ${k}`).toContain(k);
      }
      // 命中者就是本批规则（下游那条在 marks-21 之后，轮不到）
      expect(RULES.find((r) => r.re.test(h.clause))!.id).toBe(h.want.id);
    }
  });

  it("14 个字面逐条直调：次数与幅值都落在对的捕获组上（一次错位就会全表漂）", () => {
    for (const [literal, want] of Object.entries(EXPECT)) {
      expect(direct(want.id, literal), literal).toEqual({ effects: [{ op: "apply_status", name: want.name, target: "self", params: want.params }] });
    }
  });

  it("宿主整句：该子句被本批接住，且不破坏同句其它子句", () => {
    // 基准不再是外部快照，而是「把本批吃掉的子句删掉后重新解析」的结果 —— 不依赖任何
    // 未入库的临时文件（旧实现读 scratch/parallel/r4a-base.json，那是 gitignored 的 13MB
    // 快照，干净检出上不存在）。
    //
    // 注意 ctrlOf 的边界：子句若从半句中间切走（"…低于对手是<子句>"），删除后会留下
    // 无主残片 "…低于对手是"，它必然留档。这类残片是删除动作本身造成的，不算回归——
    // 只要求「完整句的留档不包含该子句，且不因本批多出无关留档」。
    const skip = new Set(["prio_count", "pierce", "pp_consume_hit", "dmg_boost", "dmg_taken_down", "even_dmg"]);
    const hosts = hostSkills();
    let changed = 0;
    for (const h of hosts) {
      const before = ctrlOf(h);
      const after = parse(h.text);
      // ① 其余效果逐字保留、次序不变（跳过本批会新增的那一类次数窗条目）
      const beforeRest = (before.effects ?? []).filter((e) => e.name === undefined || !skip.has(e.name));
      const afterRest = after.effects.filter((e) => e.name === undefined || !skip.has(e.name));
      // 只约束「完整句不该比删除版少东西」；删除版可能多出无主残片，不在此断言。
      for (const b of beforeRest) expect(afterRest, h.key).toContainEqual(b);
      // ② 这一条子句现在不留档了
      expect(after.unparsed.map((u) => u.clause), h.key).not.toContain(h.clause);
      // ③ flags 一字未动
      expect(after.flags, h.key).toEqual(before.flags);
      // ④ 本批只新增一条：该状态名下的条目数不变或 +1
      const cnt = (list: Eff[]) => list.filter((e) => e.name === h.want.name && e.target === "self").length;
      const nBefore = cnt(before.effects ?? []);
      const nAfter = cnt(after.effects);
      expect(nAfter, h.key).toBeGreaterThanOrEqual(nBefore);
      expect(nAfter - nBefore, h.key).toBeLessThanOrEqual(1);
      // 耗 PP 族：删除版「每消耗N点…」自立一条 `turns:1` 的窗，完整句由这条子句接管，
      // 窗口从 `turns:1` 挪到 `params.count:N`（唯一一处条目形状变化）。
      if (h.want.name === "pp_consume_hit" && nAfter === nBefore) {
        const b = (before.effects ?? []).find((e) => e.name === "pp_consume_hit");
        const a = after.effects.find((e) => e.name === "pp_consume_hit");
        if (b !== undefined && a !== undefined) {
          expect(a.turns, h.key).toBeUndefined();
          expect(Object.keys(a.params ?? {}).filter((k) => k !== "count"), h.key).toEqual(Object.keys(b.params ?? {}).filter((k) => k !== "count"));
        }
      }
      if (JSON.stringify(after) !== JSON.stringify(before)) changed++;
    }
    // 删掉子句必然改变 IR（至少少一条/多一条留档），所以 changed 应为 hosts.length。
    // 更重要的是每个宿主都确实产出了该状态名下的条目 —— 上面 ①④ 已逐条断言。
    expect(changed).toBe(hosts.length);
    // 这 4 条形如「未触发则自身下1次造成的伤害提高100%」：子句先被「未触发则」拆掉前缀，
    // 余部本就由 e31-cb-01 产出逐字相同的那一条，本批只换了命中的规则。
    const unchanged = hosts.filter((h) => JSON.stringify(parse(h.text)) === JSON.stringify(ctrlOf(h)));
    for (const h of unchanged) expect(h.text, h.key).toContain("未触发则自身下1次造成的伤害提高100%");
  });

  it("规则直调：省略「自身」「的」「技能」的近形也认，次数与幅值取对捕获组", () => {
    // 裸先制（省略「自身」「使用」「所有」），负号也认
    expect(direct("r4a-next-prio-01", "下3次技能先制-1")).toEqual({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: -1, count: 3 } }] });
    expect(direct("r4a-next-prio-01", "下一次自身技能先手+2")).toEqual({ effects: [{ op: "apply_status", name: "prio_count", target: "self", params: { add: 2, count: 1 } }] });
    // 无视免疫：省略「技能」与「对手的」
    expect(direct("r4a-next-pierce-01", "下2次攻击时无视对手免疫")).toEqual({ effects: [{ op: "apply_status", name: "pierce", target: "self", params: { count: 2 } }] });
    // 耗 PP：余部自带「攻击」
    expect(direct("r4a-next-ppcon-01", "下一次攻击命中时消耗所使用攻击技能的全部PP值")).toEqual({ effects: [{ op: "apply_status", name: "pp_consume_hit", target: "self", params: { count: 1 } }] });
    // 增伤：省略「造成的」与「攻击」
    expect(direct("r4a-next-dmgboost-01", "下2次伤害提高30%")).toEqual({ effects: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 30, count: 2 } }] });
    // 承伤：省略「自身」与「攻击」
    expect(direct("r4a-next-taken-01", "下一次受到的伤害减少20%")).toEqual({ effects: [{ op: "apply_status", name: "dmg_taken_down", target: "self", params: { pct: 20, count: 1 } }] });
    // 偶数：省「必定」也认
    expect(direct("r4a-next-even-01", "下2次攻击技能打出偶数攻击伤害")).toEqual({ effects: [{ op: "apply_status", name: "even_dmg", target: "self", params: { count: 2 } }] });
    // 余部对不上 → 整条不匹配（交回 marks-21）
    expect(direct("r4a-next-prio-01", "下次自身技能先制+2")).toBe(NO_MATCH);
    expect(direct("r4a-next-dmgboost-01", "下2次技能先制+2")).toBe(NO_MATCH);
  });

  it("没做的形态仍原样留档（旧结果不变）", () => {
    const stillDeferred = [
      // 「下次X」裸形（无数字）——本轮只收有数字的窗头
      "下次自身技能先制+2",
      "下次攻击技能无视对手攻击免疫效果",
      "下次攻击命中时消耗所使用攻击技能的全部PP值",
      "下次造成的伤害提高100%",
      "下次自身受到的伤害减少50%",
      "下次攻击技能必定打出偶数攻击伤害",
      // 有数字但余部没有现成 op：自身体力分数 rider / 视为能力下降 / 无效触发 / PP 倍率 / 裸先制
      "下1次自身技能附加自身最大体力1/3的固定伤害",
      "下1次自身技能附加自身最大体力1/4固伤",
      "下1次自身技能附加自身最大体力1/3的百分比伤害",
      "下2次选择使用攻击技能时将对手能力提升状态视为相应能力下降状态",
      "下1次选择使用攻击技能时将对手的能力提升状态视为相应的能力下降状态",
      // 注：「下N次技能无效时令对手X」已由 e35-null15 + 引擎 trigger 19 实现，
      //     不再是"没做的形态"，已从本清单移除（见 tests/battle-core/ops/move-null-trigger.test.ts）
      "下3次使用技能时释放技能所消耗的PP为3倍",
      "下次攻击必定先手",
      "下一次先制+1",
      "下一次无视攻击免疫效果",
      "下1次自身技能80%使对手进入睡眠状态",
      // 无后文 / 无数字的「下次」半句
      "下次击败对手时",
      "下1次击败对手后",
      "下次击败对手恢复自身全部体力与PP值",
    ];
    for (const s of stillDeferred) {
      const p = parse(s);
      expect(p.effects, s).toEqual([]);
      expect(p.unparsed, s).toEqual([{ clause: s, reason: DEFERRED }]);
    }
  });

  it("宿主里没做的那些子句照旧留档（同一招里 r4a 只吃自己做的那一句）", () => {
    // 灭战神决·盖亚 战·归真复元：r4a 不吃「下1次衍化时时全属性+1」
    const p = parse("必中；复原自身的武道衍化轨迹，下1次衍化时时全属性+1；全属性+1，自身当前体力高于对手时强化效果翻倍；下2回合令自身所有技能先制+2");
    expect(p.unparsed).toEqual([{ clause: "下1次衍化时时全属性+1", reason: DEFERRED }]);
    expect(p.effects.some((e) => e.name === "prio_count")).toBe(false);
    // 炎龙铠甲 封魔斩：同句里「下1次技能先制+2」被吃、「下1次击败对手后」仍留档
    const q = parse("必中；消除对手回合类效果，消除成功则令对手烧伤；造成的伤害低于300则自身下1次技能先制+2；若造成的伤害低于300，则下2回合每回合造成300点固定伤害；下1次击败对手后，恢复自身全部体力值与PP值");
    expect(q.unparsed.map((u) => u.clause)).toContain("下1次击败对手后");
    expect(q.effects.some((e) => e.op === "apply_status" && e.name === "prio_count" && e.params?.add === 2)).toBe(true);
  });

  it("顺序契约：规则插在 marks-21 之前，且 marks-21 逐字未动", () => {
    const ids = markRules.map((r) => r.id);
    const m21 = ids.indexOf("marks-21");
    expect(m21).toBe(ids.length - 1); // marks-21 仍是本家族最后一条
    for (const id of [...new Set(Object.values(EXPECT).map((v) => v.id))]) expect(ids.indexOf(id), id).toBeLessThan(m21);
    expect(ids.indexOf("marks-20")).toBeLessThan(ids.indexOf("r4a-next-prio-01"));
    // marks-21 的 re 仍是原来那条（数字窗被本批吃掉后，仍要接住「下次X」裸形与对手/受方向）
    const m21rule = ruleOf("marks-21");
    expect(m21rule.re.source).toContain("^下(?:次|");
    expect(m21rule.go([] as unknown as RegExpMatchArray)).toEqual({ unparsedReason: DEFERRED });
    // 「下次X」裸形（含自身/对手主语）仍归 marks-21
    for (const s of ["下次自身技能先制+2", "下次造成的伤害提高100%", "下2次自身受到的伤害减少50%"]) {
      expect(m21rule.re.test(s), s).toBe(true);
    }
    // 否定前瞻挡下的方向：受 / 对手 / 对方 / 敌方（这些有各自的下游规则）
    for (const s of ["下次对手使用技能时", "下2次受到攻击伤害时", "下2次对方技能无效", "下2次敌方技能无效"]) {
      expect(m21rule.re.test(s), s).toBe(false);
    }
    // 「下一次对手…」被否定前瞻放行（下游有自己的对手侧规则）
    expect(m21rule.re.test("下一次对手使用攻击技能时")).toBe(false);
  });

  it("没有新 op：本批只发 apply_status 六种现成状态名", () => {
    const names = new Set(Object.values(EXPECT).map((v) => v.name));
    expect([...names].sort()).toEqual(["dmg_boost", "dmg_taken_down", "even_dmg", "pierce", "pp_consume_hit", "prio_count"]);
    // 38 条宿主整句里，本批新加的那一条永远是 apply_status
    for (const h of hostSkills()) {
      const hit = parse(h.text).effects.find((e) => e.name === h.want.name)!;
      expect(hit.op, h.key).toBe("apply_status");
    }
  });
});
