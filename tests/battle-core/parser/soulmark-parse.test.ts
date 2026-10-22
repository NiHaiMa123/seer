/**
 * soulmark-parse —— S2 触发前缀解析的分层回归。
 * 断言条目形状与 soulmarks.schema.json soulHook 对齐；未支持族必须落显式 reason 分桶。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import { condOf } from "../../../tools/effects-parse.mjs";

const creatureRows = JSON.parse(readFileSync(fileURLToPath(new URL("../../../content/creatures/creatures.json", import.meta.url)), "utf8")).creatures as Record<string, {
  name: string;
  soulMark?: { text?: string | null };
}>;

const first = (t: string) => parseSoulmarkText(t).entries[0];

describe("soulmark trigger prefixes", () => {
  it("回合开始时 → onTurnStart", () => {
    expect(first("回合开始时恢复自身100点体力")).toMatchObject({ hook: "onTurnStart", ops: [{ op: "heal", flat: 100, target: "self" }] });
  });
  it("每回合结束时 → onTurnEnd", () => {
    expect(first("每回合结束时恢复自身最大体力的1/3")).toMatchObject({ hook: "onTurnEnd", ops: [{ op: "heal", numerator: 1, denominator: 3 }] });
  });
  it("裸'每回合X' → onTurnEnd（与 legacy turn_heal 同族）", () => {
    expect(first("每回合恢复150点体力")).toMatchObject({ hook: "onTurnEnd" });
  });
  it("登场时 → onEntry", () => {
    expect(first("登场时消除对手能力提升状态")).toMatchObject({ hook: "onEntry" });
  });
  it("受到攻击时 → onDamaged", () => {
    expect(first("受到攻击时50%令对手烧伤")).toMatchObject({ hook: "onDamaged" });
  });
  it("击败对手后 → onKO victim:foe", () => {
    expect(first("击败对手后恢复自身全部体力")).toMatchObject({ hook: "onKO", guard: { victim: "foe" } });
  });
  it("自身被击败后 → onKO victim:self", () => {
    expect(first("自身被击败后令对手害怕")).toMatchObject({ hook: "onKO", guard: { victim: "self" } });
  });
  it("换下时 → onSwitchOut switcher:self", () => {
    expect(first("换下时令对手烧伤")).toMatchObject({ hook: "onSwitchOut" });
  });
  it("对手换下时 → onSwitchOut switcher:foe", () => {
    expect(first("对手换下时恢复自身50点体力")).toMatchObject({ hook: "onSwitchOut", guard: { switcher: "foe" } });
  });
  it("自身使用攻击技能时 → 出招前 react trigger:11 cat:4", () => {
    const text = "自身使用攻击技能时30%令对手麻痹";
    expect(first(text)).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 4 }, stack: true,
        payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 30 }],
      }],
    });
    expect(parseSoulmarkText(text).unparsed).toEqual([]);
  });
  it("自身属性技能命中后走命中成功的 onMoveUsed 类别窗", () => {
    expect(first("自身属性技能命中后100%令对手麻痹")).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", cat: 1 }, ops: [{ op: "apply_status", name: "paralysis", chance: 100 }] });
  });
  it("裸‘自身使用技能N%令’ → react trigger:11 与概率载荷", () => {
    expect(first("自身使用技能50%令对手害怕")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11 }, stack: true,
        payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
      }],
    });
  });
  it("裸技能 react 保留物理/特殊类别门控与各自载荷", () => {
    expect(first("自身使用物理技能附加100点固定伤害")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: 2 }, stack: true,
        payload: [{ op: "damage", kind: "fixed", power: 100, target: "opponent" }],
      }],
    });
    expect(first("自身使用特殊技能50%令对手麻痹")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: 3 }, stack: true,
        payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50 }],
      }],
    });
  });
  it("对手使用属性技能时 → 出招前 react trigger:3 cat:1", () => {
    const text = "对手使用属性技能则令对手害怕";
    expect(first(text)).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 3, cat: 1 }, stack: true,
        payload: [{ op: "apply_status", name: "fear", target: "opponent" }],
      }],
    });
    expect(parseSoulmarkText(text).unparsed).toEqual([]);
  });
  it("先出手时X → onMoveUsed + order 守卫下沉到 ops", () => {
    const e = first("先出手时恢复自身100点体力");
    expect(e).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self" } });
    expect(e?.ops?.[0]).toMatchObject({ if: { order: "first" } });
  });
  it("战斗开始时 → onBattleStart", () => {
    expect(first("战斗开始时恢复自身全部体力")).toMatchObject({ hook: "onBattleStart" });
  });
  it("选择技能的回合先制+N → beforeOrder prio", () => {
    expect(first("选择技能的回合先制+2")).toMatchObject({ hook: "beforeOrder", ops: [{ op: "priority", min: 2, max: 2 }] });
    expect(first("选择技能的回合先制+2")).not.toHaveProperty("prio");
  });
  it("常驻被动 → onBattleStart + apply_status 永久（零新 op）", () => {
    expect(first("攻击伤害提升25%")).toMatchObject({ hook: "onBattleStart", ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 25 } }] });
    expect(first("受到的伤害减少30%")).toMatchObject({ ops: [{ name: "dmg_taken_down", params: { pct: 30 } }] });
    expect(first("免疫所有异常状态")).toMatchObject({ ops: [{ name: "immune_status" }] });
    expect(first("致命一击几率上升1/16")).toMatchObject({ ops: [{ name: "crit_up", params: { n: 1, d: 16 } }] });
  });
  it("概率累积尾句 → entry.chance + chanceGrow（ops 同值 chance 吊到 entry）", () => {
    const e = first("使用技能时50%令对手害怕，之后本次在场该概率提升5%，最高75%");
    expect(e).toMatchObject({ hook: "onMoveUsed", chance: { base: 50, grow: { add: 5, cap: 75 } } });
    expect(e?.ops?.[0]?.chance).toBeUndefined();
  });
});

describe("soulmark text preprocessing", () => {
  it("名前缀剥离：'蜜：回合开始时X'", () => {
    expect(first("蜜：回合开始时恢复自身100点体力")).toMatchObject({ hook: "onTurnStart" });
  });
  it("逐子句代号前缀（半角冒号）：'防:回合开始时X'", () => {
    expect(first("防:回合结束时恢复自身100点体力")).toMatchObject({ hook: "onTurnEnd" });
  });
  it("编号项前缀：'2、回合结束时X'", () => {
    expect(first("2、回合结束时恢复自身100点体力")).toMatchObject({ hook: "onTurnEnd" });
  });
  it("子句级（boss无效）→ bossGate:true", () => {
    expect(first("回合结束时恢复自身100点体力（boss无效）")).toMatchObject({ bossGate: true });
  });
  it("文本级'以上效果boss无效' → 所有条目 bossGate", () => {
    const r = parseSoulmarkText("回合开始时恢复自身100点体力；回合结束时令对手中毒；以上效果boss无效");
    expect(r.bossGate).toBe(true);
    expect(r.entries.every((e) => e.bossGate === true)).toBe(true);
  });
  it("局部 boss 无效只标注所在子句，不向后污染独立子句", () => {
    const r = parseSoulmarkText("回合开始时恢复自身10点体力（boss无效）；回合开始时恢复自身20点体力");
    expect(r.entries).toMatchObject([
      { hook: "onTurnStart", bossGate: true, ops: [{ op: "heal", flat: 10 }] },
      { hook: "onTurnStart", ops: [{ op: "heal", flat: 20 }] },
    ]);
    expect(r.entries[1]).not.toHaveProperty("bossGate");
  });
  it.each(["；恢复自身50点体力", "，恢复自身50点体力"])("未知守卫内的回合触发不能被局部 boss 尾注切开，裸尾句隔离（尾段 %s）", (tail) => {
    const r = parseSoulmarkText(`若回合结束时未知条件则恢复自身100点体力（boss无效）${tail}；回合开始时自身攻击+1`);
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] }),
    ]);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("若回合结束时未知条件") && fragment.reason?.includes("guard unmodeled"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("恢复自身50点体力"))).toBe(true);
  });
  it("无标点长段尾注只门控最近的独立时序效果", () => {
    const r = parseSoulmarkText("战斗开始时恢复自身10点体力，回合开始时恢复自身20点体力（boss无效）");
    expect(r.entries).toMatchObject([
      { hook: "onBattleStart", ops: [{ op: "heal", flat: 10 }] },
      { hook: "onTurnStart", bossGate: true, ops: [{ op: "heal", flat: 20 }] },
    ]);
    expect(r.entries[0]).not.toHaveProperty("bossGate");
  });
  it("statDiff 的单句尾注与全文尾注都落在 entry 层", () => {
    const base = "回合开始时自身根据双方攻击值之差N触发以下效果：①恢复N点体力";
    for (const suffix of ["（boss无效）", "以上效果boss无效"]) {
      const r = parseSoulmarkText(base + suffix);
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]).toMatchObject({ hook: "onTurnStart", bossGate: true });
      expect(r.entries[0]?.ops?.[0]).not.toHaveProperty("bossGate");
    }
  });
  it("原文局部括注与明确全文尾注按同一范围契约落 gate", () => {
    const rows = creatureRows;
    const pet4742 = parseSoulmarkText(rows["pet-4742"]!.soulMark!.text, rows["pet-4742"]!.name);
    expect(pet4742.entries[0]).toMatchObject({ hook: "onBattleStart", ops: [{ op: "stat_boost", add: 100 }] });
    expect(pet4742.entries[0]).not.toHaveProperty("bossGate");
    const pet3419 = parseSoulmarkText(rows["pet-3419"]!.soulMark!.text, rows["pet-3419"]!.name);
    expect(pet3419.entries[0]).toMatchObject({ hook: "onBattleStart", ops: [{ op: "stat_boost", add: 200 }] });
    expect(pet3419.entries[0]).not.toHaveProperty("bossGate");
    expect(pet3419.entries.find((entry) => entry.hook === "beforeOrder")).toHaveProperty("bossGate", true);
    const explicitAll = parseSoulmarkText(rows["pet-3584"]!.soulMark!.text, rows["pet-3584"]!.name);
    expect(explicitAll.entries.length).toBeGreaterThan(0);
    expect(explicitAll.entries.every((entry) => entry.bossGate === true)).toBe(true);
  });
  it("FAQ 块抽取正文：'问：...答：X是： <真魂印>'", () => {
    const r = parseSoulmarkText("问：赛尔号甲虫是什么？甲虫专属特性是什么？ 答：赛尔号甲虫是：回合结束时恢复自身50点体力");
    expect(r.entries[0]).toMatchObject({ hook: "onTurnEnd" });
  });
  it("FAQ 直接答正文与带印名的答案都提取真实特性", () => {
    const direct = parseSoulmarkText("问：是什么？ 答：回合开始时恢复自身50点体力");
    const named = parseSoulmarkText("问：是什么？ 答：赛尔号地狱魔龙兽的魂印是狱：回合开始时恢复自身50点体力", "地狱魔龙兽");
    expect(direct.entries[0]).toMatchObject({ hook: "onTurnStart", ops: [{ op: "heal", flat: 50 }] });
    expect(named.entries[0]).toMatchObject({ hook: "onTurnStart", ops: [{ op: "heal", flat: 50 }] });
  });
  it("FAQ 答案仍支持‘魂印是印名，效果如下’旧变体及无特性答复", () => {
    const old = parseSoulmarkText("问：赛尔号测试魂印是什么？ 答：赛尔号测试的魂印是骁，效果如下：回合结束时恢复自身50点体力");
    const numbered = parseSoulmarkText("问：赛尔号测试魂印是什么？ 答：赛尔号测试的魂印是骁，效果如下：1、回合结束时恢复自身50点体力");
    const empty = parseSoulmarkText("问：赛尔号测试魂印是什么？ 答：  该精灵没有专属特性");
    expect(old.entries[0]).toMatchObject({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 50 }] });
    expect(numbered.entries[0]).toMatchObject({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 50 }] });
    expect(empty).toMatchObject({ entries: [], unparsed: [], clauseTotal: 0, clausesParsed: 0 });
  });
  it.each(["pet-4931", "pet-4930", "pet-3336"])("真实 FAQ 源记录 %s 不得被整条静默过滤", (id) => {
    const row = creatureRows[id]!;
    expect(row?.soulMark?.text).toBeTruthy();
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    expect(result.clauseTotal).toBeGreaterThan(0);
    expect(result.unparsed.length + result.entries.length).toBeGreaterThan(0);
    expect(result.unparsed.every((fragment) => !fragment.clause.startsWith("问："))).toBe(true);
    // 这些真实魂印含有尚未建模的复杂触发，必须留下显式 residual，而不能虚报全完成。
    expect(result.unparsed.length).toBeGreaterThan(0);
    if (id !== "pet-4930") {
      // 炎龙铠甲与地狱魔龙兽各有一段能由现有 guard/chance/ops 表达，其余语义仍留 residual。
      expect(result.clausesParsed).toBeGreaterThan(0);
      expect(result.entries.some((entry) => (entry.ops?.length ?? 0) > 0)).toBe(true);
    } else {
      // 帝皇铠甲这条包含跨事件聚合、具名印记和计数分支；正文要完整落入显式 residual。
      expect(result.entries).toEqual([]);
      expect(result.unparsed.some((fragment) => fragment.clause.includes("五行印记"))).toBe(true);
    }
  });
  it("首次登场首回合使用技能不是 once 窗，整条依赖分支留 residual", () => {
    const generic = parseSoulmarkText("首次登场首回合使用攻击技能后攻击伤害提升50%");
    expect(generic.entries).toEqual([]);
    expect(generic.unparsed[0]?.reason).toContain("first-entry move window");

    const row = creatureRows["pet-4727"]!;
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    expect(result.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "max_hp_down")).toBe(false);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("首次登场首回合使用攻击技能后"))).toBe(true);
    expect(result.entries.some((entry) => entry.hook === "onMoveUsed")).toBe(true);
  });
  it("每层魂印的动态幅值不转换为固定常驻效果", () => {
    const generic = parseSoulmarkText("每有1层魂印造成的攻击伤害提升5%");
    expect(generic.entries).toEqual([]);
    expect(generic.unparsed[0]?.reason).toContain("per-mark scaling");

    const row = creatureRows["pet-4762"]!;
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    const ops = result.entries.flatMap((entry) => entry.ops ?? []);
    expect(ops.some((op) => op.name === "dmg_boost" || op.name === "dmg_taken_down")).toBe(false);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("每有1层受到的攻击伤害减少5%"))).toBe(true);
  });
  it("出伤依赖分支和用技后分支不能改挂到回合末", () => {
    const lowHpDrain = creatureRows["pet-3875"]!;
    const lowHpResult = parseSoulmarkText(lowHpDrain.soulMark!.text, lowHpDrain.name);
    const lowHpOps = lowHpResult.entries.flatMap((entry) => entry.ops ?? []);
    expect(lowHpOps.some((op) => op.name === "drain_atk")).toBe(true);
    expect(lowHpOps.some((op) => op.name === "dmg_flat" || op.op === "flat")).toBe(false);
    expect(lowHpResult.unparsed.some((fragment) => fragment.clause.includes("附加等量固伤") && fragment.reason?.includes("damage-result reference"))).toBe(true);
    expect(lowHpResult.unparsed.some((fragment) => fragment.reason?.includes("stage-state split"))).toBe(true);

    const hitResult = creatureRows["pet-3870"]!;
    const hitResultParsed = parseSoulmarkText(hitResult.soulMark!.text, hitResult.name);
    expect(hitResultParsed.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "petrify")).toBe(false);
    expect(hitResultParsed.unparsed.some((fragment) => fragment.clause.includes("令对手石化"))).toBe(true);

    const postUse = creatureRows["pet-4634"]!;
    const postUseParsed = parseSoulmarkText(postUse.soulMark!.text, postUse.name);
    expect(postUseParsed.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "fear")).toBe(false);
    expect(postUseParsed.unparsed.some((fragment) => fragment.clause.includes("本次技能打出了致命一击"))).toBe(true);

    const invalidFallback = creatureRows["pet-4132"]!;
    const invalidParsed = parseSoulmarkText(invalidFallback.soulMark!.text, invalidFallback.name);
    expect(invalidParsed.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.op === "drain" || op.name === "drain_atk")).toBe(false);
    expect(invalidParsed.unparsed.some((fragment) => fragment.clause.includes("未触发则当回合技能命中后随机吸取"))).toBe(true);
  });
  it("回合开始时体力比较授予当回合致命概率，必须保留在击前窗口", () => {
    const row = creatureRows["pet-3843"]!;
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    const critEntries = result.entries.filter((entry) => entry.ops?.some((op) => op.name === "crit_up"));
    expect(critEntries).toMatchObject([
      { hook: "onTurnStart", guard: { selfHpAboveFoe: true }, ops: [{ name: "crit_up", params: { n: 50, d: 100 } }] },
      { hook: "onTurnStart", guard: { selfHpBelowFoe: true }, ops: [{ name: "crit_up", params: { n: 25, d: 100 } }] },
    ]);
    expect(critEntries.every((entry) => entry.hook !== "onDamageDealt")).toBe(true);
  });
  it("重放登场效果的 else payload 不挂到之前已建模的守卫宿主", () => {
    const row = creatureRows["pet-4903"]!;
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    const ops = result.entries.flatMap((entry) => entry.ops ?? []);
    expect(ops.some((op) => op.op === "cleanse")).toBe(false);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("未触发则重新触发自身的登场效果") && fragment.reason?.includes("entry-effect replay"))).toBe(true);
    expect(result.unparsed.some((fragment) => fragment.reason?.includes("damage-result branch"))).toBe(true);
  });
  it("霍莱跨回合与出招窗口的组合显式延期，独立回合末护盾仍可解析", () => {
    const row = creatureRows["pet-4294"]!;
    const result = parseSoulmarkText(row.soulMark!.text, row.name);
    expect(result.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "fear" || op.op === "cleanse")).toBe(false);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("自身使用技能50%令对手害怕"))).toBe(true);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("未触发则消除对手回合类效果"))).toBe(true);
    expect(result.entries.some((entry) => entry.hook === "onTurnEnd" && entry.ops?.some((op) => op.name === "shield"))).toBe(true);
  });
  it("技能无效事件不能把后续下回合登场效果变成无条件", () => {
    const r = parseSoulmarkText("战斗开始时恢复自身10点体力；己方精灵技能无效时，自身下回合登场时消除对手回合类效果与能力提升状态，消除成功则令对手沉默（boss无效）");
    expect(r.entries).toMatchObject([{ hook: "onBattleStart", ops: [{ op: "heal", flat: 10 }] }]);
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.op === "clear_stages" || op.name === "silence")).toBe(false);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("己方精灵技能无效时") && fragment.reason?.includes("cross-event prerequisite"))).toBe(true);
  });
  it("护盾/护罩量相等的条件不能丢失后执行无条件清盾", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力；回合结束时获得等同于对手的护盾、护罩，若对手的护盾、护罩相等，则额外消除对手的护盾、护罩并附加等量的固定伤害；回合开始时恢复自身20点体力");
    expect(r.entries).toMatchObject([
      { hook: "onTurnEnd", ops: [{ op: "heal", flat: 10 }] },
      { hook: "onTurnStart", ops: [{ op: "heal", flat: 20 }] },
    ]);
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.op === "cleanse" && op.scope === "shield")).toBe(false);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("若对手的护盾、护罩相等") && fragment.reason?.includes("shield-value comparison"))).toBe(true);
  });
  it("'每场战斗限一次' → limitBattle", () => {
    expect(first("每场战斗限一次，回合结束时恢复自身全部体力")).toMatchObject({ chance: { once: true } });
  });
  it("首次登场 → onEntry + limitBattle", () => {
    expect(first("首次登场时令对手麻痹")).toMatchObject({ hook: "onEntry", chance: { once: true } });
  });
  it("'该精灵没有专属特性' → 空条目零 unparsed", () => {
    const r = parseSoulmarkText("该精灵没有专属特性");
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toEqual([]);
  });
});

describe("soulmark clause composition", () => {
  it("触发器继承：后句沿用前句 hook", () => {
    const r = parseSoulmarkText("回合结束时恢复自身100点体力；令对手中毒");
    expect(r.entries.map((e) => e.hook)).toEqual(["onTurnEnd", "onTurnEnd"]);
  });
  it("逗号段内嵌触发词开新组：'回合结束时A，回合开始时B'", () => {
    const r = parseSoulmarkText("回合结束时恢复自身100点体力，回合开始时令对手烧伤");
    expect(r.entries.map((e) => e.hook)).toEqual(["onTurnEnd", "onTurnStart"]);
  });
  it("前置守卫：'当自身体力低于对手时回合结束时X' —— 若P则沉入 ops", () => {
    const e = parseSoulmarkText("当自身体力低于对手时回合结束时恢复自身100点体力").entries[0];
    expect(e).toMatchObject({ hook: "onTurnEnd" });
    expect(e?.ops?.[0]?.if).toBeDefined();
  });
  it("'未触发则Y' → 第二 op 带 not.prevApplied", () => {
    const e = first("回合结束时50%令对手失神，未触发则100%令对手失明");
    expect(e?.ops?.length).toBeGreaterThanOrEqual(2);
    expect(e?.ops?.[1]).toMatchObject({ if: { not: { prevApplied: true } } });
  });
  it("'免疫成功则Y' → 正向 prevApplied 守卫（与未触发同族反相）", () => {
    const r = parseSoulmarkText("回合开始时，若自身体力高于1/2则当回合免疫受到的麻痹状态，免疫成功则消除对手的回合类效果");
    expect(r.entries[0]?.ops).toEqual([
      expect.objectContaining({ op: "apply_status", name: "immune_status", ailment: "paralysis" }),
    ]);
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.op === "cleanse")).toBe(false);
    expect(r.unparsed).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("免疫成功则消除对手的回合类效果"),
      reason: expect.stringContaining("prevApplied prerequisite"),
    }));
  });
  it("跨多个 entry 的‘均未触发’不可假定共享 prevApplied", () => {
    const r = parseSoulmarkText("每次使用技能时，40%几率使对手损失1/3的最大体力，40%几率使自身损失1/3的最大体力，均未触发则自身下回合先制+2");
    expect(r.entries).toHaveLength(2);
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "prio_up")).toBe(false);
    expect(r.unparsed).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("均未触发则自身下回合先制+2"),
      reason: expect.stringContaining("aggregate prerequisite"),
    }));
  });
  it("同一 op 的 chance 失败可门控 else op", () => {
    const r = parseSoulmarkText("回合开始时50%令对手害怕，未触发则令对手失明");
    expect(r.entries[0]?.ops).toMatchObject([
      { op: "apply_status", name: "fear", chance: 50 },
      { op: "apply_status", name: "blind", if: { not: { prevApplied: true } } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("PP 实际变更是可观测结果，可承接同事件失败分支", () => {
    const r = parseSoulmarkText("回合开始时50%恢复自身所有技能1点PP，未触发则令对手麻痹");
    expect(r.entries[0]?.ops).toMatchObject([
      { op: "pp_delta", amount: 1, target: "self", scope: "all", chance: 50 },
      { op: "apply_status", name: "paralysis", if: { not: { prevApplied: true } } },
    ]);
    expect(r.unparsed).toEqual([]);
  });
  it("安装后续 react 或 drain_atk 窗不是当次成功结果宿主", () => {
    const react = parseSoulmarkText("自身使用攻击技能后，下次使用属性技能时附加200点真实伤害，未触发则令对手麻痹");
    expect(react.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "react")).toBe(true);
    expect(react.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "paralysis")).toBe(false);
    expect(react.unparsed.some((fragment) => fragment.reason?.includes("no same-event fallback host"))).toBe(true);

    const drain = parseSoulmarkText("所有攻击附带5%的吸血效果，未触发则令对手麻痹");
    expect(drain.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "drain_atk")).toBe(true);
    expect(drain.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "paralysis")).toBe(false);
    expect(drain.unparsed.some((fragment) => fragment.reason?.includes("no same-event fallback host"))).toBe(true);
  });
  it("entry-level chance 的失败分支写入 elseOps，不能在被跳过的 ops 上测试 prevApplied", () => {
    const r = parseSoulmarkText("每次使用技能时，40%几率使对手损失1/3的最大体力，未触发则令对手麻痹");
    expect(r.entries[0]).toMatchObject({
      hook: "onMoveUsed",
      chance: { base: 40 },
      elseOps: [{ op: "apply_status", name: "paralysis", target: "opponent" }],
    });
    expect(r.entries[0]?.ops?.some((op) => JSON.stringify(op.if) === JSON.stringify({ not: { prevApplied: true } }))).toBe(false);
    expect(r.unparsed).toEqual([]);
  });
  it("安装闪避窗口不等于本次已闪避，不能驱动未触发后续", () => {
    const r = parseSoulmarkText("回合开始时50%闪避对手攻击，未触发闪避则当回合受到的攻击伤害减少50%");
    expect(r.entries).toMatchObject([
      { hook: "onTurnStart", ops: [{ op: "apply_status", name: "dodge", params: { pct: 50, cat: 4 } }] },
    ]);
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "dmg_taken_down")).toBe(false);
    expect(r.unparsed).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("未触发闪避"),
      reason: expect.stringContaining("no same-event fallback host"),
    }));
  });
  it("明确闪避对手攻击技能只拦攻击类；闪避所有技能仍不加类别门", () => {
    const attack = parseSoulmarkText("50%的几率闪避对手的攻击技能，自身体力低于对手时概率提升至80%");
    expect(attack.entries[0]?.hook).toBe("onBattleStart");
    const dodgeOps = attack.entries.flatMap((entry) => entry.ops ?? []).filter((op) => op.name === "dodge");
    expect(dodgeOps).toHaveLength(2);
    expect(dodgeOps).toMatchObject([
      { stack: true, params: { pct: 50, cat: 4, notSelfHpBelowFoe: 1 } },
      { stack: true, params: { pct: 80, cat: 4, selfHpBelowFoe: 1 } },
    ]);
    expect(attack.unparsed).toEqual([]);

    const allSkills = parseSoulmarkText("50%闪避所有技能");
    expect(allSkills.entries[0]?.ops?.[0]).toMatchObject({
      name: "dodge",
      params: { pct: 50 },
    });
    expect(allSkills.entries[0]?.ops?.[0]?.params).not.toHaveProperty("cat");
  });
  it("'使对手损失1/3的最大体力' → damage percent frac（40% 几率承接 entry.chance）", () => {
    const r = parseSoulmarkText("每次使用技能时，40%几率使对手损失1/3的最大体力");
    const e = r.entries[0];
    expect(e).toMatchObject({ hook: "onMoveUsed", chance: { base: 40 } });
    expect(e?.ops?.[0]).toMatchObject({ op: "damage", kind: "percent", target: "opponent" });
    expect(e?.ops?.[1]).toEqual({ op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } });
  });
  it("'免疫受到的麻痹状态' → immune_status + ailment 限定字段", () => {
    const r = parseSoulmarkText("当回合免疫受到的麻痹状态");
    const op = r.entries[0]?.ops?.[0] as { name?: string; ailment?: string } | undefined;
    expect(op).toMatchObject({ op: "apply_status", name: "immune_status", ailment: "paralysis" });
  });
  it("'汲取' 归一化为吸取（同义词族）", () => {
    const r = parseSoulmarkText("每次使用技能时，汲取对手最大体力的1/4");
    expect(r.unparsed).toEqual([{
      clause: "每次使用技能时，汲取对手最大体力的1/4",
      reason: "move-use scope — additional guard, limit, linked trigger, or payload is not supported by the plain-use react path (deferred)",
    }]);
    expect(r.entries).toEqual([{
      hook: "onMoveUsed",
      ops: [
        { op: "damage", power: 1, kind: "percent" },
        { op: "formula", of: "frac", value: { numerator: 1, denominator: 4 } },
        { op: "heal", numerator: 1, denominator: 4, target: "self" },
      ],
      guard: { actor: "self" },
    }]);
  });
});

describe("soulmark unsupported buckets — 诚实分桶不臆造", () => {
  const reason = (t: string) => parseSoulmarkText(t).unparsed[0]?.reason;
  it("受到致命伤害时保留1点体力 → endure flag（已实现，非 hook ops）", () => {
    const r = parseSoulmarkText("受到致命伤害时保留1点体力");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries[0]).toMatchObject({ op: "endure" });
    // 无留血体的裸致命触发仍诚实分桶
    expect(reason("受到致命伤害则恢复自身所有体力")).toBe("fatal-trigger");
  });
  it("endure/revive flag 族 → soulOp 顶层条目", () => {
    expect(parseSoulmarkText("受到致命一击残留1点HP").entries[0]).toMatchObject({ op: "endure" });
    expect(parseSoulmarkText("受到致命伤害时有1次机会残留1点体力(boss免疫)").entries[0]).toMatchObject({ op: "endure", bossGate: true });
    expect(parseSoulmarkText("自身下1次受到致命攻击时残留1点血").entries[0]).toMatchObject({ op: "endure" });
    expect(parseSoulmarkText("50%概率重生").entries[0]).toMatchObject({ op: "revive", chance: 50 });
    expect(parseSoulmarkText("自身死亡时30%几率重生").entries[0]).toMatchObject({ op: "revive", chance: 30 });
    expect(parseSoulmarkText("死亡时100%浴火重生一次").entries[0]).toMatchObject({ op: "revive" });
    expect(parseSoulmarkText("自身死亡时30%复活").entries[0]).toMatchObject({ op: "revive", chance: 30 });
    // 条件致命保留/重生后效果仍显式延期
    expect(reason("受到致死攻击时若对手体力不足1/4时残留1点体力")).toBe("fatal-trigger");
    expect(reason("重生时消除对手能力提升状态")).toBe("revive/checkpoint — hook not modeled (deferred)");
  });
  it("回卷句并进 endure 的快照恢复，不再发 state_rewind", () => {
    const paired = parseSoulmarkText("受到致命伤害时残留1点血，同时回合结束后自身体力、pp值、能力等级返回上回合结束时状态（每场战斗仅触发1次，boss无效）");
    expect(paired.entries).toEqual([expect.objectContaining({ op: "endure", bossGate: true })]);
    expect(paired.unparsed).toEqual([]);
    expect(paired.clauseTotal).toBe(1);
    expect(paired.clausesParsed).toBe(1);
    const flipped = parseSoulmarkText("回合结束后自身体力PP能力等级返回上回合结束时状态，受到致命伤害时残留1点血");
    expect(flipped.entries).toEqual([expect.objectContaining({ op: "endure" })]);
    expect(flipped.unparsed).toEqual([]);
    const alone = parseSoulmarkText("回合结束后自身体力、pp值、能力等级返回上回合结束时状态");
    expect(alone.entries).toEqual([]);
    expect(alone.clausesParsed).toBe(0);
    expect(alone.unparsed[0]?.reason).toBe("snapshot rewind belongs to endure; no endure on this mark");
  });
  it("致命一击触发 → onDamageDealt + prevCrit 守卫（已实现，不再是 deferred 桶）", () => {
    const e = first("打出致命一击时令对手烧伤");
    expect(e).toMatchObject({ hook: "onDamageDealt", guard: { prevCrit: true } });
    expect(e?.ops?.[0]?.name).toBe("burn");
  });
  it("造成伤害后 → onDamageDealt；无分母的'吸取体力'体仍记 no-rule", () => {
    const e = first("造成攻击伤害后令对手烧伤");
    expect(e?.hook).toBe("onDamageDealt");
    expect(reason("造成攻击伤害后吸取对手体力")).toBe("no-rule");
  });
  it("背包内无物种名'每存在N种精灵' → onTurnEnd + flatPerAlive 缩放", () => {
    const e = first("背包内每存在1种精灵时回复体力");
    expect(e?.hook).toBe("onTurnEnd");
  });
  it("登场N回合内 → onEntry + react 受击窗（已实现）", () => {
    const e = first("登场3回合内受到攻击则对手烧伤");
    expect(e?.hook).toBe("onEntry");
    expect(e?.ops?.[0]?.name).toBe("react");
    expect((e?.ops?.[0]?.payload as { name?: string }[] | undefined)?.[0]?.name).toBe("burn");
  });
  it("使用第N技能 → slot-mark（S4）", () => {
    expect(reason("使用第2技能时消除对手强化")).toBe("slot-mark");
  });
  it("体力+N 常驻 → stat_boost（base-stat 族已实现）", () => {
    const e = first("体力+40 攻击+25 速度+11");
    expect(e?.hook).toBe("onBattleStart");
    expect(e?.ops?.every((o) => o.op === "stat_boost")).toBe(true);
  });
  it("概率免疫 → immune_chance 参数窗（已实现）", () => {
    const e = first("50%概率免疫所有异常状态");
    expect(e?.hook).toBe("onBattleStart");
    expect(e?.ops?.[0]?.name).toBe("immune_chance");
  });
  it("抵挡攻击 → passive-modifier", () => {
    expect(reason("抵挡所有攻击")).toBe("passive-modifier");
  });
  it("威力翻倍 → power_mul 状态窗（已实现）", () => {
    const e = first("回合结束时威力翻倍");
    expect(e?.hook).toBe("onTurnEnd");
    expect(e?.ops?.[0]?.name).toBe("power_mul");
  });
  it("FAQ/链接残片 → dirty-text 不入分母", () => {
    const r = parseSoulmarkText("回合结束时恢复自身100点体力；进化图种族值技能表>>>");
    expect(r.clauseTotal).toBe(1);
    expect(r.clausesParsed).toBe(1);
  });
  it("'P时提升效果翻倍' → 宿主克隆带 and 复合守卫（非幻影 dmg_boost pct:100）", () => {
    const r = parseSoulmarkText("自身先出手时伤害提升50%，体力低于对手时提升效果翻倍");
    expect(r.unparsed).toHaveLength(0);
    const ops = r.entries[0]?.ops ?? [];
    const base = ops.find((o) => o?.name === "dmg_boost" && (o?.if as { order?: string })?.order === "first");
    const dbl = ops.find((o) => o?.name === "dmg_boost" && (o?.if as { and?: unknown[] })?.and !== undefined);
    expect((base?.params as { pct?: number })?.pct).toBe(50);
    expect((dbl?.params as { pct?: number })?.pct).toBe(50);
    expect(ops.filter((o) => (o?.params as { pct?: number })?.pct === 100)).toHaveLength(0); // 无幻影 pct:100
  });
  it("'X，效果翻倍' → 无条件就地翻倍", () => {
    const heal = first("回合结束时恢复1/4最大体力，效果翻倍");
    expect(heal?.ops?.[0]).toMatchObject({ op: "heal", numerator: 2, denominator: 4 });
    const boost = first("自身攻击伤害提升50%，效果翻倍");
    expect((boost?.ops?.[0]?.params as { pct?: number })?.pct).toBe(100);
  });
  it("'若P则效果翻倍'/'未受攻击则翻倍' → damage/heal 挂 mulIf 条件倍率", () => {
    const h = first("回合结束时恢复1/4最大体力，若体力低于1/2则效果翻倍");
    expect(h?.ops?.[0]).toMatchObject({ op: "heal", numerator: 1, denominator: 4, mulIf: { when: { selfHpBelow: { numerator: 1, denominator: 2 } }, numerator: 2, denominator: 1 } });
    const d = first("回合结束时附加对手50点固定伤害，未受到攻击则效果翻倍");
    expect(d?.ops?.[0]).toMatchObject({ op: "damage", kind: "fixed", power: 50 });
    expect(d?.ops?.[1]).toEqual({ op: "scale", of: "mulIf", value: { when: { prevTakenZero: true }, numerator: 2, denominator: 1 } });
  });
  it("react payload：'受到的攻击伤害超过300则下回合减伤50%' → trigger1 min+减伤窗", () => {
    const e = first("受到的攻击伤害超过300则下回合自身受到的伤害减少50%");
    expect(e?.hook).toBe("onDamaged");
    expect(e?.ops?.[0]).toMatchObject({ op: "apply_status", name: "dmg_taken_down", turns: 1, params: { pct: 50 } });
  });
  it("'N%触发<名>:Y' → 具名剥离，几率+实体保留", () => {
    const r = parseSoulmarkText("受到攻击时50%触发寒霜结界:免疫此次受到的攻击伤害");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ name: "dmg_immune", chance: 50 });
  });
  it("印记生命周期：'激活N层/消耗N层/达到N层时' → mark 原子族", () => {
    expect(first("回合结束时立刻激活4层自然祝福")?.ops?.[0]).toMatchObject({ op: "apply_mark", mark: "自然祝福", count: 4 });
    expect(first("回合结束时消耗1层自然祝福")?.ops?.[0]).toMatchObject({ op: "consume_mark", mark: "自然祝福", count: 1 });
    const e = first("自然祝福达到6层时自身所有技能额外先制+1");
    expect(e?.ops?.[0]).toMatchObject({ name: "prio_up", if: { markCountAtLeast: { mark: "自然祝福", n: 6 } } });
  });
  it("'最多可叠加N次'跨组回挂 → apply_mark.cap", () => {
    const r = parseSoulmarkText("回合结束时获得1层狩杀之魂，最多可叠加5次");
    const mk = r.entries[0]?.ops?.find((o) => o.op === "apply_mark");
    expect(mk).toMatchObject({ mark: "狩杀之魂", cap: 5 });
  });
  it("'将对手体力降为1点' → onKO victim:self + damage leaveHp 压血线", () => {
    const e = first("被对手击败时将对手体力降为1点");
    expect(e).toMatchObject({ hook: "onKO", guard: { victim: "self" } });
    expect(e?.ops?.[0]).toMatchObject({ op: "damage", target: "opponent" });
    expect(e?.ops?.[1]).toEqual({ op: "cap", of: "leaveHp", value: 1 });
  });
  it("'无视对手双防能力提升' → pierce_stages 单次窗", () => {
    expect(first("使用属性技能则下回合自身攻击无视对手双防能力提升状态")?.ops?.[0]).toMatchObject({ name: "pierce_stages", turns: 1 });
  });
  it("'对手攻击miss' → self dodge", () => {
    expect(first("回合结束时使对手攻击miss")?.ops?.[0]).toMatchObject({ name: "dodge", params: { pct: 100 } });
  });
  it("'先出手几率翻倍' → chance 宿主挂 chanceMulIf{order:first}", () => {
    const r = parseSoulmarkText("回合开始时50%令对手害怕，先出手几率翻倍");
    const op = r.entries[0]?.ops?.find((o) => o.chance === 50);
    expect(op).toMatchObject({ chanceMulIf: { when: { order: "first" } } });
  });
});

describe("batch-2025-11 residual harvest", () => {
  it("'每回合令自身全属性+1' → onTurnEnd 五维 stage", () => {
    const e = first("每回合令自身全属性+1");
    expect(e?.hook).toBe("onTurnEnd");
    expect(e?.ops).toHaveLength(5);
    expect(e?.ops?.[0]).toMatchObject({ op: "apply_stat_stage", delta: 1, target: "self" });
  });
  it("'受到攻击伤害则反弹N点固伤' → onDamaged counter", () => {
    const e = first("自身受到攻击伤害则反弹300点固定伤害");
    expect(e?.hook).toBe("onDamaged");
    expect(e?.ops?.[0]).toMatchObject({ name: "counter", params: { flat: 300 } });
  });
  it("'对手每回合随机两项属性-1' → onTurnEnd random stage", () => {
    const e = first("对手每回合随机两项属性-1");
    expect(e?.hook).toBe("onTurnEnd");
    expect(e?.ops?.[0]).toMatchObject({ op: "apply_stat_stage", stat: "random", randomCount: 2, delta: -1, target: "opponent" });
  });
  it("'结束后自身恢复1/3最大HP' → onTurnEnd heal 分数前置", () => {
    const e = first("结束后自身恢复1/3最大HP");
    expect(e?.hook).toBe("onTurnEnd");
    expect(e?.ops?.[0]).toMatchObject({ op: "heal", numerator: 1, denominator: 3 });
  });
  it("'首次登场前2回合免疫异常' → onEntry immune + limitBattle", () => {
    const e = first("首次登场前2回合免疫异常状态");
    expect(e?.hook).toBe("onEntry");
    expect(e?.chance).toEqual({ once: true });
    expect(e?.ops?.[0]).toMatchObject({ name: "immune_status" });
  });
  it("'自身击败对手时X' → onKO victim:foe", () => {
    const e = first("自身击败对手时恢复自身最大体力1/3");
    expect(e?.hook).toBe("onKO");
    expect(e?.ops?.[0]?.op).toBe("heal");
  });
  it("'50%概率使对手在回合结束时减少1/5最大HP' → foe_dot + chance", () => {
    const e = first("50%概率使对手在回合结束时减少1/5最大HP");
    expect(e?.chance).toEqual({ base: 50 });
    expect(e?.ops?.[0]).toMatchObject({ name: "foe_dot", params: { n: 1, d: 5 } });
  });
  it("'每场战斗中仅限一次' → limitBattle", () => {
    const r = parseSoulmarkText("每场战斗中仅限一次，恢复自身最大体力的1/3");
    expect(r.entries[0]?.chance).toEqual({ once: true });
  });
  it("'自身所有能力等级均不高于对手' → not selfStageAboveFoe 谓词", () => {
    const r = parseSoulmarkText("回合结束时，若自身所有能力等级均不高于对手则攻击+1");
    const g = r.entries[0]?.guard ?? r.entries[0]?.ops?.[0]?.if;
    expect(g).toMatchObject({ not: { selfStageAboveFoe: true } });
  });
  it("'每场战斗只能触发N次'(N>1) → battle-limit-count 显式延后", () => {
    const r = parseSoulmarkText("每场战斗只能触发2次");
    expect(r.unparsed.some((u) => u.reason?.includes("battle-limit-count") ?? false)).toBe(true);
  });
  it("'自身对应的能力值+1' → contextual-stat 显式延后", () => {
    const r = parseSoulmarkText("自身对应的能力值+1");
    expect(r.unparsed.some((u) => u.reason?.includes("contextual-stat") ?? false)).toBe(true);
  });
});

describe("batch-2025-11-b residual harvest", () => {
  it("'X，2回合内' 裸时长尾 → 最近 op turns 覆盖", () => {
    const e = first("使对手属性技能无效，2回合内");
    expect(e?.ops?.[0]).toMatchObject({ name: "status_lock", turns: 2 });
  });
  it("'免疫异常状态以及能力下降状态' → 双 immune", () => {
    const r = parseSoulmarkText("免疫异常状态以及能力下降状态");
    const names = r.entries.flatMap((e) => (e.ops ?? []).map((o) => o.name));
    expect(names).toContain("immune_status");
    expect(names).toContain("immune_degrade");
  });
  it("'免疫中毒以及烧伤' → ailment scoped 双免疫", () => {
    const r = parseSoulmarkText("免疫中毒以及烧伤");
    const ails = r.entries.flatMap((e) => (e.ops ?? []).map((o) => o.ailment)).filter(Boolean);
    expect(ails).toEqual(expect.arrayContaining(["poison", "burn"]));
  });
  it("'附带N%吸血' → drain_atk 窗", () => {
    const e = first("所有攻击附带5%的吸血效果");
    expect(e?.ops?.[0]).toMatchObject({ name: "drain_atk", params: { n: 5, d: 100 } });
  });
  it("'对手技能命中下降N%' → self dodge", () => {
    const e = first("对手所有技能命中下降10%");
    expect(e?.ops?.[0]).toMatchObject({ name: "dodge", params: { pct: 10 } });
  });
  it("'任何攻击技能都将附带N点固伤' → dmg_flat", () => {
    expect(first("任何攻击技能都将附带100点固定伤害")?.ops?.[0]).toMatchObject({ name: "dmg_flat" });
  });
  it("'15%令对手害怕' 裸几率前缀 → chance 注入", () => {
    const e = first("15%令对手害怕");
    if (e?.chance !== undefined) expect(e.chance).toEqual({ base: 15 });
    else expect(e?.ops?.[0]?.chance).toBe(15);
  });
  it("'电系技能伤害提升' → element-typed boost 显式延后", () => {
    const r = parseSoulmarkText("电系技能伤害提升20%");
    expect(r.unparsed.some((u) => u.reason?.includes("element-typed"))).toBe(true);
  });
});

describe("batch-2025-11-c enum-split/dynChance/count-passive", () => {
  it("'15%令对手害怕、对手命中下降10%' — 顿号边界不跨 dynChance", () => {
    const r = parseSoulmarkText("每回合15%令对手害怕、对手所有技能命中下降10%");
    const ops = r.entries[0]?.ops ?? [];
    expect(ops.find((o) => o.name === "fear")?.chance).toBe(15);
    expect(ops.find((o) => o.name === "dodge")?.chance).toBeUndefined();
  });
  it("'5%令对方疲惫，1回合无法攻击' — 逗号续段仍共享 chance", () => {
    const e = first("5%令对方疲惫，1回合无法攻击");
    expect(e?.chance).toEqual({ base: 5 });
  });
  it("'免疫一次异常状态' count 被动 → onBattleStart", () => {
    const e = first("得到一块护盾，免疫一次异常状态");
    expect(e?.hook).toBe("onBattleStart");
    expect(e?.ops?.[0]).toMatchObject({ name: "immune_status", params: { count: 1 } });
  });
  it("petName 尾部简称剥离（夜魔之神布莱克→布莱克）", () => {
    const e = (parseSoulmarkText as (t: string, n?: string) => { entries: { ops?: { name?: string }[] }[] })("布莱克所有攻击附带5%的吸血效果", "夜魔之神布莱克").entries[0];
    expect(e?.ops?.[0]).toMatchObject({ name: "drain_atk" });
  });
  // remain2：裸性别谓词（foeGender）本来就有结算，这句只是"来自X性精灵"的词形——已收成 onDamaged+守卫。
  // 仍然延后的是取反形（谓词取反未建模）。
  it("'来自雄性精灵' → onDamaged + foeGender 守卫（取反形仍 gender-cond 延后）", () => {
    const e = first("减少200来自雄性精灵的伤害");
    expect(e).toMatchObject({ hook: "onDamaged", guard: { foeGender: "male" } });
    expect(parseSoulmarkText("若对手不是雄性精灵，则恢复250点HP").unparsed[0]?.reason).toContain("gender-cond");
  });
  it("'异常状态只持续N回合' → ailment-duration-cap 显式延后", () => {
    expect(parseSoulmarkText("所有自身受到的异常状态只持续1回合").unparsed[0]?.reason).toContain("ailment-duration-cap");
  });
  it("'增加N%的闪避率' → dodge", () => {
    const r = parseSoulmarkText("受到伤害减少15%，增加5%的闪避率");
    expect(r.entries.flatMap((e) => e.ops ?? []).some((o) => o.name === "dodge" && (o.params as { pct?: number } | undefined)?.pct === 5)).toBe(true);
  });
});

describe("batch-2025-11-d cond-gate/set-override/floor", () => {
  it("'P时额外提高N%' → dmg_boost params 门控（selfHpBelowFoe）", () => {
    const r = parseSoulmarkText("造成的伤害提高35%，自身体力低于对手时额外提高25%");
    const win = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "dmg_boost" && (o.params as { selfHpBelowFoe?: number } | undefined)?.selfHpBelowFoe === 1);
    expect(win).toMatchObject({ name: "dmg_boost", params: { pct: 25, selfHpBelowFoe: 1 } });
    expect(r.unparsed).toHaveLength(0);
  });
  it("'使用攻击技能造成的伤害不少于N' → dmg_out_floor + order 守卫", () => {
    const e = first("先出手时使用攻击技能造成的伤害不少于280");
    expect(e?.hook).toBe("onMoveUsed");
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_out_floor", params: { min: 280 }, if: { order: "first" } });
  });
  it("'免疫下次受到的攻击伤害' → dmg_immune count:1", () => {
    const r = parseSoulmarkText("本回合若受到伤害则使自身免疫下次受到的攻击伤害");
    const op = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "dmg_immune");
    expect(op).toMatchObject({ name: "dmg_immune", params: { count: 1 } });
  });
  it("'对手所有技能失效' → move_null", () => {
    const r = parseSoulmarkText("自身处于异常状态时对手所有技能失效");
    const op = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "move_null");
    expect(op).toMatchObject({ name: "move_null", target: "opponent" });
  });
  it("'伤害减免提高到N%' → 条件克隆 pct 窗（互斥双窗，非 deferred）", () => {
    const r = parseSoulmarkText("受到伤害减少30%，自身体力低于对手时伤害减免提高到80%");
    expect(r.unparsed).toHaveLength(0);
    const ops = r.entries.flatMap((e) => e.ops ?? []).filter((o) => o?.name === "dmg_taken_down");
    const ps = (o: unknown) => (o as { params?: Record<string, unknown> }).params ?? {};
    expect(ops.some((o) => ps(o).pct === 80 && ps(o).selfHpBelowFoe === 1)).toBe(true);
    expect(ops.some((o) => ps(o).pct === 30 && ps(o).notSelfHpBelowFoe === 1)).toBe(true);
  });
  it("'先出手时所有攻击附加N点固定伤害' → flatBonus damage + order 守卫", () => {
    const e = first("先出手时所有攻击附加100点固定伤害");
    expect(e?.ops?.[0]).toMatchObject({ op: "damage", kind: "fixed", power: 100, if: { order: "first" } });
  });
});

describe("batch-2025-11-e enum-pool/upgrade/guard-carry", () => {
  it("'随机附加A、B、C、D中的一种异常状态' → random 枚举池", () => {
    const e = first("对手使用攻击技能时，为对手随机附加中毒、寄生、感染、睡眠中的一种异常状态");
    expect(e).toMatchObject({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "react", target: "self", params: { trigger: 3, cat: 4 }, stack: true }],
    });
    const react = e?.ops?.[0] as { payload?: { random?: { list?: string[]; count?: number } }[] } | undefined;
    const op = react?.payload?.[0];
    expect(op?.random?.list).toEqual(["poison", "parasite", "infect", "sleep"]);
    expect(op?.random?.count).toBe(1);
  });
  it("'若已处于能力提升则改为全属性+1' → 互斥升级双分支", () => {
    const r = parseSoulmarkText("回合开始时，自身防御、特防+2，若自身已处于能力提升状态则改为全属性+1");
    const g = r.entries.map((e) => e.guard);
    expect(g.some((x) => JSON.stringify(x) === JSON.stringify({ not: { selfStageUp: true } }))).toBe(true);
    expect(g.some((x) => JSON.stringify(x) === JSON.stringify({ selfStageUp: true }))).toBe(true);
    expect(r.unparsed).toHaveLength(0);
  });
  it("'造成的伤害低于N，回合结束时P则X' → 阈值守卫跨组结转", () => {
    const e = first("造成的伤害低于200，回合结束时自身体力低于对手则回合结束与对手互换体力");
    const op = e?.ops?.[0] as { if?: unknown } | undefined;
    expect(op?.if).toMatchObject({ and: [{ prevDamageBelowAbs: 200 }, { selfHpBelowFoe: true }] });
  });
  it("'若本回合未受到攻击伤害则下回合必定致命' → prevTakenZero + crit_always", () => {
    const e = first("回合结束时，若本回合未受到攻击伤害则下回合攻击技能必定致命一击");
    expect(e?.guard).toMatchObject({ actor: "self", cat: [2, 3], if: { prevTakenZero: true } });
    expect(e?.ops?.[0]).toMatchObject({ name: "crit_always", params: { count: 1 } });
  });
  it("'此技能的类型本次登场未使用过' → skill-type-usage 显式延后", () => {
    expect(parseSoulmarkText("若此技能的类型本次登场未使用过则消除对手回合类效果").unparsed[0]?.reason).toContain("skill-type-usage");
  });
  it("'随机触发以下效果中的N个' → random-choice 显式延后", () => {
    expect(parseSoulmarkText("随机触发以下效果中的1个：恢复250点体力、全属性+1").unparsed[0]?.reason).toContain("random-choice");
  });
  it("'回合类效果被消除时' → cleanse-react 显式延后", () => {
    expect(parseSoulmarkText("对手的回合类效果被消除时，2回合内技能无法附加异常状态").unparsed[0]?.reason).toContain("cleanse-react");
  });
  it("'附加后若体力减少值低于N则X' → onDamageDealt + prevDamageBelowAbs", () => {
    const e = first("附加后若对手体力减少值低于150则对手2回合内属性技能命中效果失效");
    expect(e?.hook).toBe("onDamageDealt");
    expect(e?.guard).toMatchObject({ prevDamageBelowAbs: 150 });
    expect((e?.ops?.[0] as { name?: string } | undefined)?.name).toBe("hit_fx_null");
  });
});

describe("batch-2025-11-f chanceSet/ppAt-any/exclusive-clone", () => {
  it("'P时几率变为N%' → chanceSetIf 挂宿主 chance op", () => {
    const e = first("自身攻击技能40%几率使对手随机进入1-2种异常状态，先出手时几率变为60%");
    const op = e?.ops?.[0] as { chance?: number; chanceSetIf?: { when: unknown; value: number } } | undefined;
    expect(op?.chanceSetIf).toMatchObject({ when: { order: "first" }, value: 60 });
  });
  it("'P时几率变成N%' pct 窗 → 互斥克隆（基窗 not* 门 + 条件窗正门）", () => {
    const e = first("回合开始时若自身体力高于对手则40%几率闪避对手攻击，自身体力低于对手时几率变成60%");
    const ops = (e?.ops ?? []) as { name?: string; stack?: boolean; params?: Record<string, number> }[];
    const base = ops.find((o) => o.params?.pct === 40);
    const alt = ops.find((o) => o.params?.pct === 60);
    expect(base?.params?.notSelfHpBelowFoe).toBe(1);
    expect(alt?.params?.selfHpBelowFoe).toBe(1);
    expect(ops.every((o) => o.stack === undefined)).toBe(true);
  });
  it("'任意1个技能PP值为零时' → ppAt slot:any 谓词", () => {
    const e = first("对手使用攻击技能则50%麻痹，任意1个技能PP值为零时几率提升至100%");
    const react = e?.ops?.[0] as { payload?: { chanceSetIf?: { when: unknown; value: number } }[] } | undefined;
    const op = react?.payload?.[0];
    expect(op?.chanceSetIf).toMatchObject({ when: { ppAt: { slot: "any", value: 0 } }, value: 100 });
  });
  it("';' 子句边界——几率提升不跨子句挂载", () => {
    const r = parseSoulmarkText("对手使用攻击技能则50%麻痹；对手使用属性技能则50%随机1个技能PP值归零，自身体力高于最大体力的1/2时几率提升至100%");
    const payloads = r.entries.map((e) => {
      const react = e.ops?.[0] as { name?: string; payload?: Record<string, unknown>[] } | undefined;
      return react?.name === "react" ? react.payload ?? [] : [];
    }).flat();
    const par = payloads.find((o) => o.name === "paralysis") as { chanceSetIf?: unknown } | undefined;
    const pp = payloads.find((o) => o.op === "pp_delta") as { chanceSetIf?: { value: number } } | undefined;
    expect(par?.chanceSetIf).toBeUndefined();
    expect(pp?.chanceSetIf?.value).toBe(100);
  });
  it("'使用工具技能时' → 出招前 react cat:1", () => {
    const e = first("使用工具技能时50%几率令对手害怕");
    expect(e).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 1 }, stack: true,
        payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
      }],
    });
  });
  it("'出场前N回合' → onEntry + injectTurns 窗", () => {
    const r = parseSoulmarkText("出场时若自身体力低于对手，则出场前2回合免疫并反弹异常状态");
    const e = r.entries.find((x) => x.hook === "onEntry");
    expect(e).toBeDefined();
    expect(e?.ops?.some((o) => o.name === "reflect_status")).toBe(true);
  });
});

describe("batch-2025-11-g kindMask/mark-threshold/mark-declare", () => {
  it("最大体力永久成本当前不可表达时，不输出临时扣上限与免费回血", () => {
    const r = parseSoulmarkText("战斗阶段结束时，若自身的体力低于最大体力的1/3，则消耗自身200点体力上限并恢复全部体力");
    expect(r.entries).toEqual([]);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("消耗自身200点体力上限并恢复全部体力"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.reason?.includes("permanent max-HP cost"))).toBe(true);
  });
  it("'受到的固定伤害减少N%' → dmg_taken_down kindMask=1", () => {
    const r = parseSoulmarkText("回合结束时受到的固定伤害减少30%");
    const op = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "dmg_taken_down") as { params?: Record<string, number> } | undefined;
    expect(op?.params).toMatchObject({ pct: 30, kindMask: 1 });
  });
  it("'造成的固定伤害和百分比伤害提高N%' → dmg_boost kindMask=3", () => {
    const r = parseSoulmarkText("自身造成的固定伤害和百分比伤害提高25%");
    const op = r.entries.flatMap((e) => e.ops ?? []).find((o) => o.name === "dmg_boost") as { params?: Record<string, number> } | undefined;
    expect(op?.params).toMatchObject({ pct: 25, kindMask: 3 });
  });
  it("'反转成功则当回合受到的固定伤害、百分比伤害减少50%' → prevApplied 门控 kindMask 窗", () => {
    const e = first("回合开始时反转对手的能力提升状态，反转成功则当回合受到的固定伤害、百分比伤害减少50%");
    const op = (e?.ops ?? []).find((o) => o.name === "dmg_taken_down") as { params?: Record<string, number>; if?: unknown } | undefined;
    expect(op?.params).toMatchObject({ pct: 50, kindMask: 3 });
    expect(op?.if).toMatchObject({ prevApplied: true });
  });
  it("'反转失败则对手2回合内无法主动切换精灵' → else 门控 no_switch", () => {
    const e = first("回合开始时反转对手的能力提升状态，反转失败则对手2回合内无法主动切换精灵");
    const op = (e?.ops ?? []).find((o) => o.name === "no_switch") as { turns?: number; if?: unknown } | undefined;
    expect(op?.turns).toBe(2);
    expect(op?.if).toMatchObject({ not: { prevApplied: true } });
  });
  it("'若对手不处于X触发X：该技能PP值归0' → markCountAtLeast 守卫 + apply_mark + pp_delta", () => {
    const e = first("若对手不处于记忆破碎触发记忆破碎：该技能PP值归0");
    expect(e?.guard).toMatchObject({ not: { markCountAtLeast: { mark: "记忆破碎", on: "foe" } } });
    const ops = e?.ops ?? [];
    expect(ops.some((o) => o.op === "apply_mark" && (o as { mark?: string }).mark === "记忆破碎")).toBe(true);
    expect(ops.some((o) => o.op === "pp_delta" && (o as { zero?: boolean }).zero === true)).toBe(true);
  });
  it("'自身X大于N个' → markCountAtLeast actor:self 谓词", () => {
    const e = first("对手使用技能时若自身风龙结大于500个则解除自身异常状态");
    expect(e?.guard).toMatchObject({ actor: "foe", if: { markCountAtLeast: { mark: "风龙结", n: 500, on: "self" } } });
  });
  it("'造成的攻击伤害不低于对手最大体力N%' → dmg_out_floor foeMaxPct", () => {
    const e = first("自身每次造成的攻击伤害不低于对手最大体力的40%");
    const op = e?.ops?.[0] as { name?: string; params?: Record<string, number> } | undefined;
    expect(op?.name).toBe("dmg_out_floor");
    expect(op?.params).toMatchObject({ foeMaxPct: 40 });
  });
  it("'战斗开始时自身获得1个风龙结' → apply_mark count", () => {
    const e = first("战斗开始时自身获得1个风龙结");
    expect(e?.ops?.[0]).toMatchObject({ op: "apply_mark", mark: "风龙结", count: 1 });
  });
  it("'对手未受到此伤害则焚烬' → foeTakenZero 谓词 + ember", () => {
    const e = first("战斗阶段结束时若对手未受到此伤害则令对手焚烬") as { guard?: unknown; ops?: { name?: string }[] } | undefined;
    expect(e?.guard).toMatchObject({ foeTakenZero: true });
    expect(e?.ops?.[0]?.name).toBe("ember");
  });
  it("'本次在场无视对手伤害减少效果' → pierce_limit", () => {
    const e = first("本次在场自身无视对手伤害减少效果");
    expect(e?.ops?.[0]).toMatchObject({ op: "apply_status", name: "pierce_limit" });
  });
  it("'X结束时' → mark-expiry refund 显式延后", () => {
    expect(parseSoulmarkText("记忆破碎结束时对手恢复因此损失的所有PP值").unparsed[0]?.reason).toContain("mark-expiry");
  });
  it("'无法触发被击败效果' → onKO-suppression 显式延后", () => {
    expect(parseSoulmarkText("其无法触发被击败效果").unparsed[0]?.reason).toContain("onKO-suppression");
  });
  it("'每出战1次' → entry-count 显式延后", () => {
    expect(parseSoulmarkText("本场战斗自身每出战1次，为对手附加300点固定伤害").unparsed[0]?.reason).toContain("entry-count");
  });
  it("'pp值分别随机变化为m-n' → pp-range 显式延后", () => {
    expect(parseSoulmarkText("使自身所有技能的pp值分别随机变化为1-5中的一个值").unparsed[0]?.reason).toContain("pp-range");
  });
  it("'为龙系' → attr-domain 显式延后", () => {
    expect(parseSoulmarkText("若自身不为龙系则消耗所有的风龙结").unparsed.some((u) => u.reason?.includes("attr-domain"))).toBe(true);
  });
  it("'受到真实伤害后X' → onDamaged + takenKind 守卫", () => {
    const e = first("自身受到真实伤害后获得等量的护盾");
    expect(e).toMatchObject({ hook: "onDamaged", guard: { takenKind: "true" } });
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_to_shield" });
  });
  it("'miss时X' → onMiss who:foe（对手落空=自身闪避）", () => {
    expect(first("miss时下回合自身免疫异常")).toMatchObject({ hook: "onMiss", guard: { who: "foe" } });
  });
  it("没有同事件成功宿主时‘触发成功’必须留 residual", () => {
    const r = parseSoulmarkText("触发成功自身恢复最大体力的1/2");
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("触发成功自身恢复最大体力的1/2"),
      reason: expect.stringContaining("no same-event successful host"),
    }));
  });
  it("'使用必中技能后' → onMoveUsed alwaysHit", () => {
    expect(first("自身使用必中技能后恢复100点体力")).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", alwaysHit: true } });
  });
  it("'使用非必中技能后' → onMoveUsed alwaysHit:false", () => {
    expect(first("自身使用非必中技能后恢复100点体力")).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", alwaysHit: false } });
  });
  it("'P时固伤翻倍' → 跨条目 flatMulIf 条件挂载", () => {
    const r = parseSoulmarkText("每回合结束附加150点固定伤害；自身体力低于对手时固伤翻倍");
    expect(r.entries[0]?.ops?.[1]).toMatchObject({ op: "flat", of: "flatMulIf", value: { when: { selfHpBelowFoe: true }, numerator: 2 } });
    expect(r.unparsed.filter((u) => u.reason === "no-op")).toHaveLength(0);
  });
  it("'受到的伤害低于N则X' → takenBelowAbs 守卫", () => {
    expect(first("若当回合自身受到的伤害低于300则吸取对手最大体力的1/4")).toMatchObject({ hook: "onTurnEnd", guard: { takenBelowAbs: 300 } });
  });
  it("'阈值降低' → threshold-delta 显式延后且不误伤并列子句", () => {
    const r = parseSoulmarkText("回合开始时消除对手能力提升状态，触发成功则阈值降低100点且本场战斗造成的攻击伤害提升10%");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ op: "clear_stages", target: "opponent", sign: "up" });
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "dmg_boost")).toBe(false);
    expect(r.unparsed.some((u) => u.reason?.includes("threshold-delta"))).toBe(true);
    expect(r.unparsed.some((u) => u.reason?.includes("prevApplied branch continuation") && u.clause.includes("本场战斗造成的攻击伤害提升10%"))).toBe(true);
  });
  it("'进入X每累计N次' → apply-counter 显式延后", () => {
    expect(parseSoulmarkText("自身进入烧伤状态每累计3次").unparsed[0]?.reason).toContain("apply-counter");
  });
  it("'免疫具名来源伤害' → source-filter 显式延后", () => {
    expect(parseSoulmarkText("自身免疫B-ROBO造成的攻击伤害").unparsed[0]?.reason).toContain("source-filter");
  });
  it("'获得等量护罩' → 护盾枚举尾 ignored 残留", () => {
    const r = parseSoulmarkText("自身受到攻击后获得等量的护盾、护罩");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ name: "dmg_to_shield" });
  });
  it("'恢复N/M并附加恢复量的百分比伤害' → heal + foeEcho", () => {
    const e = first("恢复自身最大体力的1/3并附加恢复量的百分比伤害");
    expect(e?.ops?.[0]).toMatchObject({ op: "heal", numerator: 1, denominator: 3, foeEcho: true });
  });
  it("'几率等同于(于)当前已损失体力百分比' → chanceDyn selfMissingHpPct", () => {
    const r = parseSoulmarkText("回合结束时有一定几率令对手害怕，几率等同于自身当前已损失体力百分比");
    expect(r.entries[0]).toMatchObject({ hook: "onTurnEnd", chance: { dyn: "selfMissingHpPct" } });
    expect(r.unparsed).toHaveLength(0);
  });
  it("'几率等同自身当前体力百分比' → chanceDyn selfHpPct", () => {
    const r = parseSoulmarkText("回合开始时有一定几率令自身当回合免疫异常，几率等同自身当前体力百分比");
    expect(r.entries[0]).toMatchObject({ hook: "onTurnStart", chance: { dyn: "selfHpPct" } });
    expect(r.unparsed).toHaveLength(0);
  });
  it("'未触发瘫痪则X' → 异常名单 else 链（瘫痪 入 AIL_ALT）", () => {
    const r = parseSoulmarkText("能力提升状态被消除则对手瘫痪，未触发瘫痪则消除对手回合类效果");
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.op === "cleanse")).toBe(false);
    expect(r.unparsed.some((u) => /瘫痪则/.test(u.clause) && u.reason?.includes("no same-event fallback host"))).toBe(true);
  });
  it("'攻击打出致命一击的几率提升N%' → crit_up n/100", () => {
    const e = first("攻击打出致命一击的几率提升20%");
    expect(e?.ops?.[0]).toMatchObject({ name: "crit_up", params: { n: 20, d: 100 } });
  });
  it("'获得N%的A、B伤害减免' → dmg_taken_down kindMask 位图", () => {
    const e = first("获得50%的攻击伤害、固定伤害和百分比伤害减免");
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_taken_down", params: { pct: 50, kindMask: 7 } });
  });
  it("'进入A、B、C中的M种' → random 枚举池（AIL数字种 不切碎枚举）", () => {
    const e = first("50%令对手进入害怕、麻痹、疲惫3种异常中的1种");
    expect(e).toMatchObject({ chance: { base: 50 } });
    expect(e?.ops?.[0]).toMatchObject({ name: "random", random: { list: ["fear", "paralysis", "fatigue"], count: 1 } });
  });
  it("'令对手进入A、B' → 并列施加两异常", () => {
    const r = parseSoulmarkText("令对手进入害怕、麻痹");
    expect(r.entries.flatMap((e) => e.ops?.map((o) => o.name) ?? [])).toEqual(["fear", "paralysis"]);
  });
  it("'弱化类异常' → 子集分类显式延后", () => {
    expect(parseSoulmarkText("令对手随机进入1种弱化类异常状态").unparsed[0]?.reason).toContain("UNVERIFIED");
  });
  it("'未触发则下次X几率提升N%最高M%' → chanceGrow（AIL 插槽容忍）", () => {
    const r = parseSoulmarkText("50%几率令对手冰封，未触发则下次冰封的几率提升10%，最高70%");
    expect((r.entries[0] as { chance?: { grow?: unknown } } | undefined)?.chance?.grow).toEqual({ add: 10, cap: 70, on: "fail" });
    expect(r.unparsed).toHaveLength(0);
  });
  it("'未触发则下次触发几率提升至N%' → pct 窗提升为 chance + chanceGrow 补齐", () => {
    const r = parseSoulmarkText("50%闪避对手攻击，未触发则下次触发几率提升至100%");
    expect(r.entries[0]).toMatchObject({ chance: { base: 50, grow: { add: 50 } } });
    expect((r.entries[0]?.ops?.[0] as { params?: Record<string, number> } | undefined)?.params?.pct).toBe(100);
    expect(r.unparsed).toHaveLength(0);
  });
  it("'若P则吸取效果翻倍' → drain/heal mulIf 条件翻倍（非无条件）", () => {
    const r = parseSoulmarkText("回合结束时吸取对手最大体力的1/4，若自身体力低于最大体力1/3则吸取效果翻倍");
    const ops = r.entries[0]?.ops ?? [];
    const doubled = ops.find((o) => o.op === "scale" && o.of === "mulIf");
    expect(doubled?.value).toMatchObject({ when: { selfHpBelow: { numerator: 1, denominator: 3 } }, numerator: 2 });
    expect(ops.find((o) => o.op === "heal")?.mulIf).toBeDefined();
    expect(r.unparsed.filter((u) => u.reason === "no-op")).toHaveLength(0);
  });
  it("'若P时减免效果翻倍' → 基窗反门 + 双倍克隆窗（互斥）", () => {
    const r = parseSoulmarkText("受到的伤害减少30%，若自身体力低于最大体力1/3时减免效果翻倍");
    const ops = r.entries[0]?.ops ?? [];
    expect(ops[0]).toMatchObject({ name: "dmg_taken_down", params: { pct: 30, notSelfHpBelowFracN: 1, notSelfHpBelowFracD: 3 } });
    expect(ops[1]).toMatchObject({ name: "dmg_taken_down", params: { pct: 60, selfHpBelowFracN: 1, selfHpBelowFracD: 3 } });
    expect(r.unparsed).toHaveLength(0);
  });
  it("'对手N回合内先制-K' → prio_up foe turns", () => {
    const e = first("若对手不处于能力下降状态则对手2回合内先制-1");
    expect(e?.guard).toEqual({ not: { foeStageDown: true } });
    expect(e?.ops?.[0]).toMatchObject({ name: "prio_up", target: "opponent", turns: 2, params: { add: -1 } });
  });
  it("'使用技能若击败对手则X' → onMoveUsed + foeFainted 守卫", () => {
    const e = first("自身使用技能若击败对手则自身攻击+2");
    expect(e).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", if: { foeFainted: true } } });
  });
  it("'在回合结束后X' → onTurnEnd", () => {
    expect(first("在回合结束后恢复自身最大体力1/3")).toMatchObject({ hook: "onTurnEnd" });
  });
  it("'自身每次登场时X' → onEntry", () => {
    expect(first("自身每次登场时恢复自身最大体力的1/3")).toMatchObject({ hook: "onEntry" });
  });
  it("'双防额外+N' → 别名枚举+额外容忍", () => {
    const e = first("体力低于对手时50%的几率令自身双防额外+1");
    expect(e?.ops?.map((o) => o.stat)).toEqual(["def", "sdf"]);
  });
  it("'命中则回合结束X' → hit-window 显式延后", () => {
    expect(parseSoulmarkText("命中则在回合结束后吸取对手最大体力的1/4").unparsed[0]?.reason).toContain("hit-window");
  });
  it("未建模条件连同效果体和继承/else 尾句一起隔离，明确新触发后恢复解析", () => {
    const r = parseSoulmarkText("若未知条件则回合结束时恢复自身100点体力，令对手麻痹，未触发则恢复自身50点体力；回合开始时恢复自身20点体力");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnStart", ops: [{ op: "heal", flat: 20, target: "self" }] }),
    ]);
    expect(r.unparsed).toEqual([
      expect.objectContaining({
        reason: "guard unmodeled — effect withheld (deferred)",
        clause: expect.stringContaining("若未知条件则回合结束时恢复自身100点体力"),
      }),
      expect.objectContaining({ clause: expect.stringContaining("未触发则恢复自身50点体力") }),
    ]);
    expect(r.unparsed[0]?.clause).toContain("令对手麻痹");
  });
  it("已支持触发器内嵌的未建模条件不会把效果体当作无条件效果", () => {
    const r = parseSoulmarkText("回合开始时若未知条件则恢复自身100点体力");
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toEqual([
      expect.objectContaining({
        clause: expect.stringContaining("若未知条件则恢复自身100点体力"),
        reason: "guard unmodeled — effect withheld (deferred)",
      }),
    ]);
  });
  it("逗号式未知条件隔离整段效果与后续继承，已知条件仍正常门控", () => {
    const unknown = parseSoulmarkText("回合开始时，若未知条件，恢复自身100点体力");
    expect(unknown.entries).toEqual([]);
    expect(unknown.unparsed.some((u) => u.reason?.includes("guard unmodeled") && u.clause.includes("若未知条件"))).toBe(true);
    expect(unknown.unparsed.some((u) => u.reason?.includes("guard unmodeled") && u.clause.includes("恢复自身100点体力"))).toBe(true);
    expect(unknown.clausesParsed).toBe(0);
    expect(unknown.fragmentsOnResidual).toBeGreaterThan(0);

    const known = parseSoulmarkText("回合开始时，若自身满体力，恢复自身100点体力");
    expect(known.unparsed).toEqual([]);
    expect(known.entries).toMatchObject([
      { hook: "onTurnStart", ops: [{ op: "heal", flat: 100, target: "self", if: { selfHpFull: true } }] },
    ]);
  });
  it("未知条件及其 else 不得串接前一个有效宿主，显式新触发保留前后独立效果", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力，若未知条件则恢复自身100点体力，未触发则令对手麻痹；回合开始时恢复自身20点体力");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }),
      expect.objectContaining({ hook: "onTurnStart", ops: [{ op: "heal", flat: 20, target: "self" }] }),
    ]);
    expect(r.unparsed.some((u) => u.reason?.includes("guard unmodeled") && u.clause.includes("若未知条件"))).toBe(true);
    expect(r.unparsed.some((u) => u.clause.includes("未触发则令对手麻痹"))).toBe(true);
  });
  it("quarantine 中的动态几率尾句不得回挂修改旧有效条目", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力，若未知条件则恢复自身100点体力；概率等同自身当前体力百分比");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }),
    ]);
    expect(r.unparsed.some((fragment) => fragment.reason?.includes("guard unmodeled") && fragment.clause.includes("若未知条件"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("概率等同自身当前体力百分比"))).toBe(true);
  });
  it("quarantine 中的增长尾句不得在子句预处理阶段改写旧条目", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力，若未知条件则恢复自身100点体力；每在场概率提升5%，最高100%");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }),
    ]);
    expect(r.unparsed.some((fragment) => fragment.reason?.includes("guard unmodeled") && fragment.clause.includes("若未知条件"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("每在场概率提升5%"))).toBe(true);
  });
  it("同一子句内 quarantine 后的动态几率不得回挂前一宿主", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力，若未知条件则恢复自身100点体力，概率等同自身当前体力百分比");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }),
    ]);
    expect(r.unparsed.some((fragment) => fragment.reason?.includes("guard unmodeled") && fragment.clause.includes("若未知条件"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("概率等同自身当前体力百分比"))).toBe(true);
  });
  it("同一子句内 quarantine 后的成长尾不得在预处理阶段改写旧条目", () => {
    const r = parseSoulmarkText("回合结束时恢复自身10点体力，若未知条件则恢复自身100点体力，每在场概率提升5%，最高100%");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }),
    ]);
    expect(r.unparsed.some((fragment) => fragment.reason?.includes("guard unmodeled") && fragment.clause.includes("若未知条件"))).toBe(true);
    expect(r.unparsed.some((fragment) => fragment.clause.includes("每在场概率提升5%"))).toBe(true);
  });
  it("未知 guard 后的裸语句不得继承旧钩子，直到显式新触发重新建立关联", () => {
    const r = parseSoulmarkText("若未知条件则回合结束时造成150点固定伤害；恢复自身100点体力；回合开始时自身攻击+1");
    expect(r.entries).toEqual([
      expect.objectContaining({ hook: "onTurnStart", ops: [{ op: "apply_stat_stage", stat: "atk", delta: 1, target: "self" }] }),
    ]);
    expect(r.unparsed.some((u) => u.reason?.includes("guard unmodeled") && u.clause.includes("造成150点固定伤害"))).toBe(true);
    expect(r.unparsed.some((u) => u.reason?.includes("guard unmodeled") && u.clause.includes("恢复自身100点体力"))).toBe(true);
  });
  it("quarantine 跨子句延续时，真实残留仍计入子句分母和 residual 片段", () => {
    const r = parseSoulmarkText("若未知条件则恢复自身100点体力；恢复自身50点体力");
    expect(r.entries).toEqual([]);
    expect(r.clauseTotal).toBe(2);
    expect(r.clausesParsed).toBe(0);
    expect(r.fragmentsOnResidual).toBe(2);
    expect(r.fragmentsOutside).toBe(0);
    expect(r.unparsed).toHaveLength(2);
  });
  it("可解析但使用默认时序的条件不能解除未知 guard 隔离", () => {
    const r = parseSoulmarkText("若未知条件则恢复自身100点体力，若自身满体力则令对手麻痹");
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toEqual([
      expect.objectContaining({ clause: expect.stringContaining("若未知条件则恢复自身100点体力"), reason: "guard unmodeled — effect withheld (deferred)" }),
      expect.objectContaining({ clause: expect.stringContaining("若自身满体力则令对手麻痹"), reason: "guard unmodeled — effect withheld (deferred)" }),
    ]);
  });
  it("'若回合结束时P则X' → onTurnEnd + guard", () => {
    expect(first("若回合结束时自身满体力则恢复自身最大体力的1/4")).toMatchObject({ hook: "onTurnEnd", guard: { selfHpFull: true }, ops: [{ op: "heal", numerator: 1, denominator: 4 }] });
    expect(first("若回合开始时自身满体力则当回合免疫异常状态")).toMatchObject({ hook: "onTurnStart", guard: { selfHpFull: true } });
  });
  it("'自身受到的伤害不足N，则回合结束时X' → onTurnEnd + prevDamageBelowAbs 守卫", () => {
    const e = first("自身受到的伤害不足250，则回合结束时对手有30%几率流血");
    expect(e).toMatchObject({ hook: "onTurnEnd", guard: { prevDamageBelowAbs: 250 }, ops: [{ op: "apply_status", name: "bleed", chance: 30 }] });
  });
  it("'对手造成的攻击伤害低于N则X' → foe 出伤守卫", () => {
    expect(first("对手造成的攻击伤害低于300则回合结束时吸取对手最大体力的1/3")).toMatchObject({ hook: "onTurnEnd", guard: { prevDamageBelowAbs: 300 } });
  });
  it("'每次使用X技能都有N%令对手AIL' → react 保留概率、类别和载荷", () => {
    expect(first("每次使用技能都有30%令对手麻痹")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11 }, stack: true,
        payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 30 }],
      }],
    });
    expect(first("每次使用属性技能恢复200HP")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: 1 }, stack: true,
        payload: [{ op: "heal", flat: 200, target: "self" }],
      }],
    });
    expect(first("每次使用攻击技能减少对手1/3当前体力")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11, cat: 4 }, stack: true,
        payload: [
          { op: "damage", kind: "percent", power: 1, target: "opponent" },
          { op: "formula", of: "percentBase", value: "current" },
          { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
        ],
      }],
    });
  });
  it("'使自身回合结束后攻击+N' → onTurnEnd（中置回合词重挂钩）", () => {
    expect(first("有50%的几率使自身回合结束后攻击+2")).toMatchObject({ hook: "onTurnEnd", chance: { base: 50 }, ops: [{ op: "apply_stat_stage", stat: "atk", delta: 2 }] });
    expect(first("50%概率使对手在回合结束时减少1/5最大HP")).toMatchObject({ hook: "onTurnEnd", chance: { base: 50 }, ops: [{ name: "foe_dot" }] });
  });
  it("'每次回合结束时X' → onTurnEnd", () => {
    expect(first("每次回合结束时恢复自身已损失血量的50%")).toMatchObject({ hook: "onTurnEnd", ops: [{ op: "heal", missing: true }] });
  });
  it("'对手能力不处于提升状态' → not foeStageUp（语序变体）", () => {
    expect(first("若对手能力不处于提升状态时，则每回合结束时减少对手1/5最大HP")?.guard).toEqual({ not: { foeStageUp: true } });
  });
  it("'低于当回合开始时' → hpBelowTurnStart 快照谓词", () => {
    expect(first("若自身体力低于当回合开始时的体力，则附加自身最大体力25%的固定伤害")?.guard).toEqual({ hpBelowTurnStart: true });
  });
  it("'若自身后出手则X' → onMoveUsed + order:last 守卫", () => {
    expect(first("若自身后出手则自身攻击+1")).toMatchObject({ hook: "onMoveUsed", guard: { actor: "self", if: { order: "last" } } });
  });
  it("'若被对手击败则X'/'若自身死亡则X' → onKO victim:self", () => {
    expect(first("若被对手击败则对手烧伤")).toMatchObject({ hook: "onKO", guard: { victim: "self" } });
    expect(first("若自身死亡则对手麻痹")).toMatchObject({ hook: "onKO", guard: { victim: "self" } });
  });
  it("'若对手体力为满则X' → not foeHpBelow 1/1", () => {
    expect(first("若对手体力为满则自身攻击+1")?.guard).toEqual({ not: { foeHpBelow: { numerator: 1, denominator: 1 } } });
  });
  it("'若触发则X' → prevApplied 守卫", () => {
    expect(first("若触发则自身速度+1")?.guard).toEqual({ prevApplied: true });
  });
  it("'若当回合自身受到攻击则X' → not prevTakenZero", () => {
    expect(first("若当回合自身受到攻击则自身攻击+1")?.guard).toEqual({ not: { prevTakenZero: true } });
  });
  it("'受到异常状态时有N%免疫' → immune_chance", () => {
    const e = first("自身受到异常状态时有50%免疫") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "immune_chance", params: { pct: 50 } });
  });
  it("'受到的攻击伤害减半' → dmg_taken_down 50", () => {
    const e = first("自身受到的攻击伤害减半") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_taken_down", params: { pct: 50 } });
    expect(first("自身后出手时50%使自身受到的攻击伤害减半")).toMatchObject({ hook: "onMoveUsed", ops: [{ name: "dmg_taken_down", chance: 50, if: { order: "last" } }] });
  });
  it("'回合开始50%X' → onTurnStart（无时变体）", () => {
    expect(first("回合开始50%令对手全属性-1")).toMatchObject({ hook: "onTurnStart" });
  });
  it("'攻击必定致命一击并附加X' → crit flag + 附加合并", () => {
    const e = first("回合开始时自身体力高于1/2则当回合攻击必定致命一击并附加自身最大体力1/3的固伤");
    expect(e?.ops?.[0]).toMatchObject({ name: "crit_always", if: { selfHpAbove: { numerator: 1, denominator: 2 } } });
    expect(e?.ops?.[1]).toMatchObject({ op: "damage", kind: "fixed" });
  });
});

// ── next-apply 窗（"下次X"——count:1 挂载 / react 单次载荷 / next_chance 触发几率窗）──
describe("next-apply window（下N次族）", () => {
  it("'下次受到的伤害减少N点' → dmg_reduce{flat,count:1}", () => {
    const e = first("造成的伤害低于300则下次受到的伤害减少250点") as { ops?: { name?: string; params?: Record<string, number>; turns?: number }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_reduce", params: { flat: 250, count: 1 } });
    expect(e?.ops?.[0]?.turns).toBeUndefined(); // count 即生命周期——不吃 injectTurns
  });
  it("未触发后跨到下次攻击的效果不能缩成同事件 fallback", () => {
    const r = parseSoulmarkText("攻击25%造成2倍伤害，未触发则下次攻击附加自身1/3最大体力固伤");
    expect(r.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "dmg_flat")).toBe(false);
    expect(r.unparsed).toContainEqual(expect.objectContaining({
      clause: expect.stringContaining("未触发则下次攻击附加自身1/3最大体力固伤"),
      reason: expect.stringContaining("same-event fallback host"),
    }));
  });
  it("'下次攻击伤害提升N%' → dmg_boost{count:1,pct}", () => {
    const e = first("若当回合未击败对手则下次攻击伤害提升50%") as { ops?: { name?: string; params?: Record<string, number>; turns?: number }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_boost", params: { count: 1, pct: 50 } });
  });
  it("'下次攻击技能令对手随机N个技能PP归零' → react{trigger:11,cat:4,count:1}+pp_delta payload", () => {
    const e = first("回合结束时则下次攻击技能令对手随机3个技能PP归零") as { ops?: Record<string, unknown>[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "react", params: { trigger: 11, cat: 4, count: 1 }, payload: [{ op: "pp_delta", target: "opponent", zeroRandom: 3 }] });
  });
  it("'下次使用属性技能时附加N点真实伤害' → react{trigger:11,cat:1}+damage kind:true", () => {
    const e = first("自身使用攻击技能后，下次使用属性技能时附加200点真实伤害") as { ops?: Record<string, unknown>[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({
      name: "react", params: { trigger: 11, cat: 1, count: 1 },
      payload: [
        { op: "damage", kind: "true", power: 0, target: "opponent" },
        { op: "flat", of: "flatBonus", value: 200 },
      ],
    });
  });
  it("'下次使用攻击技能时必定致命' → crit_always{count:1}", () => {
    const e = first("自身使用属性技能后，下次使用攻击技能时使本次攻击必定打出致命一击") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "crit_always", params: { count: 1 } });
  });
  it("'下次触发几率翻倍/提升N%/提升至N%' → next_chance mul/add/set", () => {
    const r = parseSoulmarkText("自身使用攻击技能40%令对手害怕，未触发则下次触发几率翻倍");
    const nc = r.entries[0]?.ops?.find((o) => o.name === "next_chance");
    expect(nc).toMatchObject({ params: { mul: 2, count: 1, ei: 0 } });
    const r2 = parseSoulmarkText("自身先出手时50%使对手疲惫，未触发则下次先出手时几率提升至80%");
    const nc2 = r2.entries[0]?.ops?.find((o) => o.name === "next_chance");
    expect(nc2).toMatchObject({ params: { set: 80, count: 1, ei: 0 } });
    const r3 = parseSoulmarkText("自身攻击技能命中后50%令对手害怕，未触发则吸取对手最大体力1/4且下次害怕几率提升10%");
    const nc3 = r3.entries[0]?.ops?.find((o) => o.name === "next_chance");
    expect(nc3).toMatchObject({ params: { add: 10, count: 1, ei: 0 } });
  });
  it("'下次使用技能给对手造成等同于恢复量的固定伤害' → react payload flatSelfLastHeal", () => {
    const e = first("回合开始时若自身体力低于对手则下次使用技能给对手造成等同于恢复量的固定伤害") as { ops?: Record<string, unknown>[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({
      name: "react", params: { trigger: 11, count: 1 },
      payload: [
        { op: "damage", kind: "fixed", power: 0, target: "opponent" },
        { op: "flat", of: "flatSelfLastHeal", value: true },
      ],
    });
  });
  it("'有自身已损失体力百分比的几率造成伤害提升N%' → dmg_boost 动态已损率门", () => {
    const e = first("攻击命中后有自身已损失体力百分比的几率造成伤害提升100%") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_boost", params: { pct: 100, chanceSelfMissingPct: 1 } });
  });
  it("'下次攻击命中后有已损%几率提升N%' → dmg_boost{count:1,chanceSelfMissingPct}", () => {
    const e = first("若当回合攻击造成伤害低于300则下次攻击命中后有自身已损失体力百分比的几率造成伤害提升150%") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "dmg_boost", params: { count: 1, pct: 150, chanceSelfMissingPct: 1 } });
  });
  it("'下次出手先制+N' → prio_count{count:1}（出手变体）", () => {
    const e = first("后出手时自身下次出手先制+1") as { ops?: { name?: string; params?: Record<string, number> }[] } | undefined;
    expect(e?.ops?.[0]).toMatchObject({ name: "prio_count", params: { count: 1, add: 1 } });
  });
});

// ── 类别连用（"连续使用攻击/属性技能时X"）。同一技能 / 威力成长仍延期。──
describe("streak（连续使用攻击/属性技能）", () => {
  it("'连续使用攻击技能时先制+1' → beforeOrder，本回合排序读上一动", () => {
    const r = parseSoulmarkText("连续使用攻击技能时先制+1");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{ hook: "beforeOrder", ops: [{ op: "priority", min: 1, max: 1 }], guard: { streak: "attack", cat: [2, 3] } }]);
  });

  it("'连续使用攻击技能时，造成的伤害提高50%' → onMoveUsed dmg_boost，count 由运行时盖章", () => {
    const r = parseSoulmarkText("连续使用攻击技能时，造成的伤害提高50%");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{
      hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3], streak: "attack" },
      ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 } }],
    }]);
  });

  it("先制+1且Y：先制单独成 beforeOrder，其余留在 onMoveUsed", () => {
    const dmg = parseSoulmarkText("连续使用攻击技能时先制+1且造成伤害提升100%");
    expect(dmg.unparsed).toEqual([]);
    expect(dmg.entries[0]).toMatchObject({ hook: "beforeOrder", ops: [{ op: "priority", min: 1, max: 1 }], guard: { streak: "attack", cat: [2, 3] } });
    expect(dmg.entries[1]).toMatchObject({
      hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3], streak: "attack" },
      ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 100 } }],
    });
    const pp = parseSoulmarkText("连续使用攻击技能时先制+1且使对手随机1项技能PP值归零");
    expect(pp.unparsed).toEqual([]);
    expect(pp.entries[1]?.ops?.[0]).toMatchObject({ op: "pp_delta", zeroRandom: 1, target: "opponent" });
    // 空触发组把 hook 继承给逗号后段
    const inherit = parseSoulmarkText("连续使用攻击技能时先制+1，令对手睡眠");
    expect(inherit.entries[1]).toMatchObject({
      hook: "onMoveUsed", guard: { actor: "self", streak: "attack" },
      ops: [{ op: "apply_status", name: "sleep", target: "opponent" }],
    });
  });

  it("几率在 op 上；下回合先制仍是 onMoveUsed，不提前到本回合排序", () => {
    const sleep = parseSoulmarkText("自身连续使用攻击技能则50%令对手睡眠");
    expect(sleep.unparsed).toEqual([]);
    expect(sleep.entries).toHaveLength(1);
    expect(sleep.entries[0]).toMatchObject({
      hook: "onMoveUsed", guard: { actor: "self", cat: [2, 3], streak: "attack" },
      ops: [{ op: "apply_status", name: "sleep", target: "opponent", chance: 50 }],
    });
    const next = parseSoulmarkText("自身连续使用 属性技能则下回合50%先制+2");
    expect(next.unparsed).toEqual([]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.hook).toBe("onMoveUsed");
    expect(next.entries[0]).toMatchObject({
      guard: { actor: "self", cat: 1, streak: "status" },
      ops: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, chance: 50, params: { add: 2 } }],
    });
  });

  it("属性连用：净化、回复并等量固伤、对手连用", () => {
    expect(parseSoulmarkText("连续使用属性技能时，消除对手回合类效果").entries[0]).toMatchObject({
      hook: "onMoveUsed", guard: { actor: "self", cat: 1, streak: "status" },
      ops: [{ op: "cleanse", target: "opponent", scope: "timed" }],
    });
    // 等量指本次实际回复量；不能读取上一击伤害。
    expect(parseSoulmarkText("连续使用属性技能时，恢复自身最大体力1/3并造成等量固定伤害").entries[0]?.ops).toEqual([
      { op: "heal", numerator: 1, denominator: 3, target: "self", foeEcho: true },
    ]);
    expect(parseSoulmarkText("对手连续使用属性技能时造成25点固定伤害").entries[0]).toMatchObject({
      hook: "onMoveUsed", guard: { actor: "foe", cat: 1, streak: "status" },
      ops: [{ op: "damage", kind: "fixed", power: 25, target: "opponent" }],
    });
  });

  it("'必定打出致命一击' → crit_always 自带 count:1", () => {
    const r = parseSoulmarkText("连续使用攻击技能时必定打出致命一击");
    expect(r.unparsed).toEqual([]);
    expect(r.entries[0]?.ops?.[0]).toMatchObject({
      op: "apply_status", name: "crit_always", target: "self", turns: 1, params: { count: 1 },
    });
  });

  it("威力成长 / 附加固伤翻倍仍整句延期，不假装解析成功", () => {
    for (const s of [
      "自身连续使用攻击技能时每次威力提升20%，最高提升100%",
      "自身连续使用攻击技能每次威力提升30%，最高提升120%",
      "连续使用属性技能时附加的固定伤害翻倍",
    ]) {
      const r = parseSoulmarkText(s);
      expect(r.entries).toEqual([]);
      expect(r.unparsed.map((u) => u.reason)).toEqual(["consecutive-use — move-power scaling stays deferred"]);
    }
  });

  it("相同类型 / 每连续使用1回合 / 叠加仍是旧延期桶", () => {
    for (const s of [
      "连续使用叠加10%，最高忽略45%",
      "对手连续使用相同类型的技能则减少对手所有技能1点PP",
      "自身连续使用相同类型的技能则吸取对手最大体力的1/3并恢复所有技能1点PP值",
      "每连续使用1回合则附加的百分比系数提升25%，最高提升至100%",
    ]) {
      const r = parseSoulmarkText(s);
      expect(r.entries).toEqual([]);
      expect(r.unparsed[0]?.reason).toBe("consecutive-use — streak tracking not modeled (deferred)");
    }
  });
});

// ── R3 同一技能连用（"连续使用同一技能 / 相同的技能时X"）→ 已有 sameMove 门控。合成句，不进技能 golden。──
describe("sameMove（连续使用同一技能）", () => {
  it("自身同招 → onMoveUsed sameMove，不带 cat / streak", () => {
    const r = parseSoulmarkText("自身连续使用同一技能时造成的伤害提高50%");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{
      hook: "onMoveUsed", guard: { actor: "self", sameMove: true },
      ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 50 } }],
    }]);
  });

  it("对手同招（相同的技能）→ actor foe，效果体走已有 op", () => {
    const r = parseSoulmarkText("对手连续使用相同的技能时造成25点固定伤害");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([{
      hook: "onMoveUsed", guard: { actor: "foe", sameMove: true },
      ops: [{ op: "damage", kind: "fixed", power: 25, target: "opponent" }],
    }]);
  });

  it("纯先制 → beforeOrder sameMove；先制+N且Y 拆两条，后段继承门控", () => {
    expect(parseSoulmarkText("连续使用同一技能时先制+1").entries).toEqual([
      { hook: "beforeOrder", ops: [{ op: "priority", min: 1, max: 1 }], guard: { sameMove: true } },
    ]);
    const r = parseSoulmarkText("连续使用同一技能时先制+1且令对手害怕");
    expect(r.unparsed).toEqual([]);
    expect(r.entries).toEqual([
      { hook: "beforeOrder", ops: [{ op: "priority", min: 1, max: 1 }], guard: { sameMove: true } },
      { hook: "onMoveUsed", guard: { actor: "self", sameMove: true }, ops: [{ op: "apply_status", name: "fear", target: "opponent" }] },
    ]);
  });

  it("不改 streak：类别连用句的输出不带 sameMove", () => {
    const r = parseSoulmarkText("连续使用攻击技能时，造成的伤害提高50%");
    expect(r.entries[0]).not.toHaveProperty("sameMove");
    expect(r.entries[0]?.guard).not.toHaveProperty("sameMove");
    expect(r.entries[0]).toMatchObject({ guard: { streak: "attack", cat: [2, 3] } });
  });

  it("体挂到回合末：门控在 onTurnEnd 不结算，整组退回 deferred，不落条目", () => {
    const r = parseSoulmarkText("若对手连续使用同一技能则回合结束时吸取对手300点体力");
    expect(r.entries).toEqual([]);
    expect(r.unparsed[0]?.reason).toBe("consecutive-use — same-move gate not evaluated on onTurnEnd (deferred)");
  });

  it("同招叠加（每次触发增加 / 最高叠加）仍延期", () => {
    const r = parseSoulmarkText("自身连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%，最高叠加至150%");
    expect(r.entries).toEqual([]);
    expect(r.unparsed.map((u) => u.reason)).toEqual(["consecutive-use — move-power scaling stays deferred"]);
  });

  it("相同类型不当成同一技能", () => {
    const r = parseSoulmarkText("自身连续使用相同类型的技能则吸取对手最大体力的1/3");
    expect(r.entries).toEqual([]);
    expect(r.unparsed[0]?.reason).toBe("consecutive-use — streak tracking not modeled (deferred)");
  });
});

// ── Bug E：FAQ/编号子句不得静默消失 + 裸值成长封顶 + 子句计数口径 ──
describe("FAQ/编号子句与裸值成长（Bug E）", () => {
  it("编号子句 + 精灵资料噪声尾：有效头保留，噪声只截尾不丢句", () => {
    const r = parseSoulmarkText(
      "回合开始时，若自身体力高于对手则令自身防御+1、特防+1，回合开始时若自身体力低于对手则当回合受到的攻击伤害降低50%；回合结束时吸取对手200点体力，之后每回合增加50点，最高400点 3、精灵资料：赛尔号拉克希斯进化图种族值技能表>>>"
    );
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ hook: "onTurnStart", guard: { selfHpAboveFoe: true } });
    expect(r.entries[1]).toMatchObject({ hook: "onTurnStart", guard: { selfHpBelowFoe: true } });
    expect(r.entries[2]).toMatchObject({ hook: "onTurnEnd" });
    expect(r.unparsed).toEqual([]);
  });
  it("每回合增加50点，最高400点 → 裸值域 grow op（step/magCap/point）", () => {
    const r = parseSoulmarkText("回合结束时吸取对手200点体力，之后每回合增加50点，最高400点");
    const drain = r.entries.find((e) => e.hook === "onTurnEnd");
    expect(drain?.ops?.[0]).toMatchObject({ op: "grow", of: "magnitude", step: 50, magCap: 400, point: true });
    expect(drain).not.toHaveProperty("growStep");
    expect(r.unparsed).toEqual([]);
  });
  it("悬挂编号尾（3、）不产生裸数残留", () => {
    const r = parseSoulmarkText("回合结束时吸取对手200点体力 3、");
    expect(r.entries).toHaveLength(1);
    expect(r.unparsed).toEqual([]);
  });
  it("子句计数按分号段计：单句多组产出 clausesParsed=1，不超过 clauseTotal", () => {
    const r = parseSoulmarkText("回合结束时吸取对手200点体力，之后每回合增加50点，最高400点");
    expect(r.clauseTotal).toBe(1);
    expect(r.clausesParsed).toBe(1);
    const r2 = parseSoulmarkText("回合结束时吸取对手200点体力；回合开始时自身攻击+1");
    expect(r2.clauseTotal).toBe(2);
    expect(r2.clausesParsed).toBe(2);
  });
  it("覆盖率只按子句：已产出 entry 的残留片段不算残余子句", () => {
    const mixed = parseSoulmarkText("若自身是雄性则回合结束时恢复自身100点体力");
    expect(mixed.clauseTotal).toBe(1);
    expect(mixed.entries).toEqual([]);
    expect(mixed.clausesParsed).toBe(0);
    expect(mixed.fragmentsOnParsed).toBe(0);
    expect(mixed.fragmentsOnResidual).toBe(1);
    expect(mixed.unparsed[0]?.reason).toContain("guard unmodeled");
    const partial = parseSoulmarkText("回合结束时恢复自身10点体力，若自身是雄性则回合开始时恢复自身100点体力");
    expect(partial.entries).toMatchObject([{ hook: "onTurnEnd", ops: [{ op: "heal", flat: 10, target: "self" }] }]);
    expect(partial.clausesParsed).toBe(1);
    expect(partial.fragmentsOnParsed).toBe(1);
    expect(partial.fragmentsOnResidual).toBe(0);
    const failed = parseSoulmarkText("自身连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%，最高叠加至150%");
    expect(failed.clauseTotal).toBe(1);
    expect(failed.clausesParsed).toBe(0);
    expect(failed.fragmentsOnResidual).toBe(1);
    const outside = parseSoulmarkText("缔结契约期间回合结束时恢复100点体力");
    expect(outside.clauseTotal).toBe(0);
    expect(outside.clausesParsed).toBe(0);
    expect(outside.fragmentsOutside).toBe(1);
    for (const r of [mixed, failed, outside]) {
      expect(r.fragmentsOnParsed + r.fragmentsOnResidual + r.fragmentsOutside).toBe(r.unparsed.length);
    }
  });
  it("延期组后的修饰尾并入同一 deferred 残留（同招叠加整句仍一条原因）", () => {
    const r = parseSoulmarkText("自身连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%，最高叠加至150%");
    expect(r.entries).toEqual([]);
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]!.reason).toBe("consecutive-use — move-power scaling stays deferred");
    expect(r.unparsed[0]!.clause).toContain("最高叠加至150%");
  });
  it("guard 谓词批：此时/最大分数/不超过/为N等值/未造成/同时处于/吸取量/存活且/快照分数", () => {
    const c = parseSoulmarkText("回合结束时，若此时体力低于最大体力的1/2则恢复100点体力");
    expect(c.entries[0]?.guard).toEqual({ selfHpBelow: { numerator: 1, denominator: 2 } });
    const eq = parseSoulmarkText("本回合自身造成的攻击伤害为0则吸取对手最大体力1/3");
    expect(eq.entries).toEqual([]);
    expect(eq.unparsed).toEqual([
      expect.objectContaining({
        clause: expect.stringContaining("造成的攻击伤害为0"),
        reason: "damage-result branch — hit outcome/amount cannot be represented by the current hook window (deferred)",
      }),
    ]);
    const le = parseSoulmarkText("若造成的伤害不超过300则自身防御+1");
    expect(le.entries[0]?.guard).toEqual({ prevDamageBelowAbs: 301 });
    const du = parseSoulmarkText("若对手同时处于害怕和冰封则自身攻击+1");
    expect(du.entries[0]?.guard).toEqual({ and: [{ foeHas: "fear" }, { foeHas: "freeze" }] });
    const ts = parseSoulmarkText("若自身体力低于当回合开始时的50%则自身恢复100点");
    expect(ts.entries[0]?.guard).toEqual({ hpBelowTurnStartFrac: { numerator: 50, denominator: 100 } });
    const nd = parseSoulmarkText("若未造成攻击伤害则自身防御+1");
    expect(nd.entries[0]?.guard).toEqual({ not: { prevDamageAboveAbs: 0 } });
  });
  it("'若自身被对手击败则X' → onKO victim:self", () => {
    const r = parseSoulmarkText("若自身被对手击败则消除对手回合类效果");
    expect(r.entries[0]?.hook).toBe("onKO");
    expect((r.entries[0]?.guard as { victim?: string } | undefined)?.victim).toBe("self");
    expect(r.unparsed).toEqual([]);
  });
  it("'背包每有一只精灵存活附加护盾最高N' → shield flatPerBench+flatCap", () => {
    const r = parseSoulmarkText("每次登场时，背包每有一只精灵存活则为自身附加100点护盾，最高600点");
    const e = r.entries[0] as { hook?: string; ops?: { name?: string; params?: Record<string, number> }[] };
    expect(e.hook).toBe("onEntry");
    expect(e.ops?.[0]).toMatchObject({ name: "shield", params: { flat: 0, flatPerBench: 100, flatCap: 600 } });
    expect(r.unparsed).toEqual([]);
  });
  it("'之后每回合恢复量提升N%最高M%' → drain_atk 的 grow op/turnRearm→onTurnStart", () => {
    const r = parseSoulmarkText("登场后首回合造成攻击伤害的50%恢复自身体力，之后每回合恢复量提升10%，最高100%");
    const e = r.entries[0] as { hook?: string; ops?: { op?: string; step?: number; magCap?: number }[] };
    expect(e.hook).toBe("onTurnStart");
    expect(e.ops?.[0]).toMatchObject({ op: "grow", of: "magnitude", step: 10, magCap: 100 });
    expect(e).not.toHaveProperty("growStep");
    expect(r.unparsed).toEqual([]);
  });
  it("'N%触发<名>：<payload>' 具名内联定义 → chance 绑 payload + chanceGrow fail 成长", () => {
    const r = parseSoulmarkText("对手攻击技能命中自身后25%触发虚空黑洞：吸取此回合受到攻击伤害，未触发则下次提升15%，最高提升30%");
    const e = r.entries[0] as { hook?: string; chance?: { base?: number; grow?: unknown }; ops?: { op?: string; flatSelfLastTaken?: boolean }[] };
    expect(e.hook).toBe("onDamaged");
    expect(e.chance).toEqual({ base: 25, grow: { add: 15, on: "fail", cap: 30 } });
    expect(e.ops?.[0]).toMatchObject({ op: "damage" });
    expect(e.ops?.[1]).toEqual({ op: "flat", of: "flatSelfLastTaken", value: true });
    expect(r.unparsed).toEqual([]);
  });
  it("'最高叠加3次' → prio_up add 宿主 grow op step×N 封顶", () => {
    const r = parseSoulmarkText("后出手恢复自身最大体力的1/3且从下回合起所有技能先制+1，最高叠加3次");
    const e = r.entries[0] as { ops?: { op?: string }[] };
    expect(e?.ops?.[0]).toMatchObject({ op: "grow", of: "magnitude", step: 1, magCap: 3 });
    expect(e).not.toHaveProperty("growStep");
    expect(r.unparsed).toEqual([]);
  });

  // ── SM-52：守卫谓词批 + pendingEmpty opIf 结转 + 裸闪避/令自身AIL/最高先制 ──
  it("奇偶回合延迟效果保留原 IR 并说明未迁移原因", () => {
    const r = parseSoulmarkText("奇数回合，使用属性技能则50%使自身下回合攻击威力翻倍;偶数回合，使用攻击技能则50%使自身下回合闪避受到的攻击");
    expect(r.entries[0]).toMatchObject({ hook: "onMoveUsed", guard: { cat: 1 }, chance: { base: 50 } });
    expect(r.entries[0]?.ops?.[0]?.if).toEqual({ turnParity: "odd" });
    const dodge = r.entries[1]?.ops?.[0];
    expect(dodge).toMatchObject({ name: "dodge", params: { pct: 100 } });
    expect(dodge?.if).toEqual({ turnParity: "even" });
    expect(r.unparsed).toEqual([
      {
        clause: "使用属性技能则50%使自身下回合攻击威力翻倍",
        reason: "move-use scope — delayed or later-action effect is outside this immediate react window (deferred)",
      },
      {
        clause: "使用攻击技能则50%使自身下回合闪避受到的攻击",
        reason: "move-use scope — delayed or later-action effect is outside this immediate react window (deferred)",
      },
    ]);
  });
  it("体力跨侧比较/快照补形 → foeHpAboveSelf / not:foeHpBelowTurnStart / not:hpAboveTurnStart", () => {
    expect(parseSoulmarkText("若对手的体力值高于自身则自身攻击伤害提升50%").entries[0]?.guard).toEqual({ foeHpAboveSelf: true });
    expect(parseSoulmarkText("若对手体力不低于回合开始时则自身恢复100点体力").entries[0]?.guard).toEqual({ not: { foeHpBelowTurnStart: true } });
    expect(parseSoulmarkText("若自身体力不高于回合开始时则受到的伤害减少30%").entries[0]?.guard).toEqual({ not: { hpAboveTurnStart: true } });
  });
  it("'不处于全能力提升' → not:selfAllStagesUp（and 语义区别于双防 or 族）", () => {
    const r = parseSoulmarkText("若自身不处于全能力提升状态则全属性+1");
    expect(r.entries[0]?.guard).toEqual({ not: { selfAllStagesUp: true } });
  });
  it("'若为攻击/属性技能则X' → onMoveUsed + cat 门控（非守卫谓词）", () => {
    expect(parseSoulmarkText("若为攻击技能则威力翻倍").entries[0]).toMatchObject({ hook: "onMoveUsed", guard: { cat: [2, 3] } });
    expect(parseSoulmarkText("若为属性技能则恢复100点体力").entries[0]).toMatchObject({ hook: "onMoveUsed", guard: { cat: 1 } });
  });
  it("'若命中则X' → selfHitStreakAtLeast 记账谓词", () => {
    expect(parseSoulmarkText("若命中则令对手害怕").entries[0]?.guard).toEqual({ selfHitStreakAtLeast: 1 });
  });
  it("'令自身AIL N回合' → e45-05 令/让变体（与'使自身'同义）", () => {
    const r = parseSoulmarkText("令自身流血2回合");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ name: "bleed", target: "self", turns: 2 });
    expect(r.unparsed).toEqual([]);
  });
  it("'最高先制+N' → prio_up 常驻宿主 grow op（无 beforeOrder 区间时）", () => {
    const r = parseSoulmarkText("先制+1，最高先制+3");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ op: "grow", of: "magnitude", step: 1, magCap: 3 });
    expect(r.entries[0]).not.toHaveProperty("growStep");
    expect(r.unparsed).toEqual([]);
  });
  it("'双防能力等级之和高于对手' → selfStageSumAboveFoe；'双防总和'保持 selfDefSumAboveFoe 不被抢", () => {
    expect(parseSoulmarkText("若自身双防能力等级之和高于对手则受到伤害减少30%").entries[0]?.guard).toEqual({ selfStageSumAboveFoe: { stats: ["def", "sdf"] } });
    expect(condOf("自身双防总和高于对手")).toEqual({ selfDefSumAboveFoe: true });
  });
  it("'若自身的属性技能失效则X' → nullifiedCatMask（引擎 nullifiedMask 记账）", () => {
    expect(parseSoulmarkText("若自身的属性技能失效则对手麻痹2回合").entries[0]?.guard).toEqual({ nullifiedCatMask: 1 });
    expect(parseSoulmarkText("若攻击技能失效则恢复50点体力").entries[0]?.guard).toEqual({ nullifiedCatMask: 6 });
  });
  it("'若对手使用带有先手效果的技能则X' → foeMovePrioAbove:0", () => {
    expect(parseSoulmarkText("若对手使用带有先手效果的技能则自身先制+1").entries[0]?.guard).toEqual({ foeMovePrioAbove: 0 });
  });
  it("'令对手当回合使用的技能N%失效' → fumble 对手侧 turns:1（e52-05）", () => {
    const r = parseSoulmarkText("回合开始时，若自身处于能力提升状态或对手处于能力下降状态则令对手当回合使用的技能20%失效");
    const e = r.entries[0] as { hook?: string; guard?: unknown; ops?: { name?: string; target?: string; turns?: number; params?: Record<string, number> }[] };
    expect(e.hook).toBe("onTurnStart");
    expect(e.guard).toEqual({ or: [{ selfStageUp: true }, { foeStageDown: true }] });
    expect(e.ops?.[0]).toMatchObject({ name: "fumble", target: "opponent", turns: 1, params: { pct: 20 } });
    expect(r.unparsed).toEqual([]);
  });
  it("'自身解除所处的异常状态' 主语前置 → cleanse self ailment（e52-01）", () => {
    const r = parseSoulmarkText("自身解除所处的异常状态");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ op: "cleanse", target: "self", scope: "ailment" });
  });
  it("'随机令对手N个技能PP值归0' 语序变体 → zeroRandom（e52-02）", () => {
    const r = parseSoulmarkText("随机令对手2个技能PP值归0");
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ op: "pp_delta", zeroRandom: 2, target: "opponent" });
  });
  it("'战斗阶段结束消除…'（无'时'）→ onTurnEnd + cleanse timed", () => {
    const r = parseSoulmarkText("战斗阶段结束消除对手回合类效果");
    expect(r.entries[0]).toMatchObject({ hook: "onTurnEnd" });
    expect(r.entries[0]?.ops?.[0]).toMatchObject({ op: "cleanse", scope: "timed", target: "opponent" });
  });
  it("纯使用吸取并成长 → react 载荷按实际扣量回血，无 MISS residual", () => {
    const pct = parseSoulmarkText("使用攻击技能时吸取对手最大体力的20%，每次使用额外增加5%，最高30%");
    expect(pct.entries).toEqual([{
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 4 }, stack: true,
        payload: [
          { op: "grow", of: "magnitude", step: 5, magCap: 30 },
          {
            op: "hp_delta",
            target: "opponent",
            frac: { numerator: 20, denominator: 100, of: "max" },
            kind: "percent",
            cause: "soulmark:absorb",
            healSelf: { numerator: 1, denominator: 1, of: "dealt" },
          },
        ],
      }],
    }]);
    expect(pct.unparsed).toEqual([]);

    const frac = parseSoulmarkText("使用攻击技能时吸取对手最大体力的1/4，每次使用额外增加5%，最高30%");
    expect(frac.entries).toEqual([{
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 4 }, stack: true,
        payload: [
          { op: "grow", of: "magnitude", step: 5, magCap: 30 },
          {
            op: "hp_delta",
            target: "opponent",
            frac: { numerator: 1, denominator: 4, of: "max" },
            kind: "percent",
            cause: "soulmark:absorb",
            healSelf: { numerator: 1, denominator: 1, of: "dealt" },
          },
        ],
      }],
    }]);
    expect(frac.unparsed).toEqual([]);

    const hit = parseSoulmarkText("自身攻击技能命中后吸取对手最大体力的20%，每次使用额外增加5%，最高30%");
    expect(hit.entries).toEqual([{
      hook: "onMoveUsed",
      guard: { actor: "self", cat: [2, 3] },
      ops: [
        { op: "grow", of: "magnitude", step: 5, magCap: 30 },
        {
          op: "hp_delta",
          target: "opponent",
          frac: { numerator: 20, denominator: 100, of: "max" },
          kind: "percent",
          cause: "soulmark:absorb",
          healSelf: { numerator: 1, denominator: 1, of: "dealt" },
        },
      ],
    }]);
    expect(hit.unparsed).toEqual([]);
  });
  it("命中回调里的本击增伤/吸血不能安装成后续窗口", () => {
    for (const text of [
      "自身攻击技能命中后造成的伤害提升50%",
      "自身攻击技能命中后造成伤害的50%恢复自身体力",
    ]) {
      const r = parseSoulmarkText(text);
      expect(r.entries, text).toEqual([]);
      expect(r.unparsed, text).toMatchObject([{ clause: text, reason: expect.stringContaining("post-hit modifier") }]);
    }
    const observableEffect = parseSoulmarkText("自身攻击技能命中后50%令对手害怕");
    expect(observableEffect.entries[0]).toMatchObject({ hook: "onMoveUsed", guard: { cat: [2, 3] } });
    expect(observableEffect.unparsed).toEqual([]);
  });
});
