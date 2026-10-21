/**
 * add-soulmark-w11 —— w11 加的魂印句子（一次一条）。
 *
 * 这一类是「句首冗余主语的组首形」：触发词已经剥掉了，句首剩一个「自身/自己」，
 * 让规则链的两侧都认不出它——裸句通道要求「自身」后面紧跟触发词，规则表又只认「攻击…」不带主语。
 * 只改 `tools/soulmark-parse.mjs` 的一处（normalizeSoulBody 的 R4 同义改写链），
 * 不补数、不换主语、不发新 op / 新状态名、不新增 params 键。
 *
 * 每条都锁住一条已经能解析的相邻旧句子，证明新条没有把它截走。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const first = (t: string) => parseSoulmarkText(t).entries[0];
const all = (t: string) => parseSoulmarkText(t).entries;
const unparsedOf = (t: string) => parseSoulmarkText(t).unparsed.map((u) => u.clause);

describe("w11-自身-攻击-lookahead：句首「自身」落在一个已认动词上时冗余（行走/命中族）", () => {
  it("新句：'自身攻击必定暴击' → 裸'攻击必定暴击' 同形（onMoveUsed + crit_always）", () => {
    expect(first("自身攻击必定暴击")).toEqual(first("攻击必定暴击"));
    expect(first("自身攻击必定暴击")).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "apply_status", name: "crit_always", target: "self" }],
      guard: { actor: "self", cat: [2, 3] },
    });
    expect(parseSoulmarkText("自身攻击必定暴击").unparsed).toHaveLength(0);
  });

  it("新句：'自身攻击技能命中后50%令对手害怕' → 成功招式回调 + 类别守卫", () => {
    expect(first("自身攻击技能命中后50%令对手害怕")).toEqual({
      hook: "onMoveUsed",
      guard: { actor: "self", cat: [2, 3] },
      ops: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
    });
  });

  it("新句：'自身攻击技能命中后造成伤害的50%恢复自身体力' 留残，drain_atk 窗口会晚一击", () => {
    const r = parseSoulmarkText("自身攻击技能命中后造成伤害的50%恢复自身体力");
    expect(r.entries).toEqual([]);
    expect(r.unparsed.map((u) => u.reason)).toEqual([
      "post-hit modifier — current damage/heal has already resolved before this hook (deferred)",
    ]);
  });

  it("新句：'自身攻击技能无视对手能力提升状态' → pierce_stages", () => {
    expect(first("自身攻击技能无视对手能力提升状态")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "pierce_stages", target: "self" }],
    });
  });

  it("邻句不变：'自身攻击技能命中时吸取对手100点体力' 仍走命中后族（触发词必须在句首，不被中间截断）", () => {
    expect(first("自身攻击技能命中时吸取对手100点体力")).toEqual({
      hook: "onMoveUsed",
      guard: { actor: "self", cat: [2, 3] },
      ops: [{ op: "damage", power: 100, kind: "fixed" }, { op: "heal", flat: 100, target: "self" }],
    });
  });

  it("纯使用时句式：'自身使用攻击技能时30%令对手麻痹' → 攻击类 react", () => {
    expect(first("自身使用攻击技能时30%令对手麻痹")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11, cat: 4 }, stack: true,
        payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 30 }],
      }],
    });
    expect(parseSoulmarkText("自身使用攻击技能时30%令对手麻痹").unparsed).toEqual([]);
  });

  it("自身属性技能命中后明确绑定成功招式类别窗", () => {
    expect(first("自身属性技能命中后100%令对手失神")).toEqual({
      hook: "onMoveUsed",
      guard: { actor: "self", cat: 1 },
      ops: [{ op: "apply_status", name: "daze", target: "opponent", chance: 100 }],
    });
  });

  it("邻句不变：'自身技能无视对手防御' 仍认不出（技能起首只有「技能」引导词无动词锚，不剥）", () => {
    expect(unparsedOf("自身技能无视对手防御")).toEqual(["自身技能无视对手防御"]);
  });
});

describe("w11-自身-使用技能：句首「自身」落在「使用技能」上时冗余", () => {
  it("纯使用句式：'自身使用技能50%令对手害怕' → 与裸形同 react IR", () => {
    expect(first("自身使用技能50%令对手害怕")).toEqual(first("使用技能50%令对手害怕"));
    expect(first("自身使用技能50%令对手害怕")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self", params: { trigger: 11 }, stack: true,
        payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 50 }],
      }],
    });
    expect(parseSoulmarkText("自身使用技能50%令对手害怕").unparsed).toHaveLength(0);
  });

  it("新句：'自身使用技能无视对手能力提升状态' → pierce_stages", () => {
    expect(first("自身使用技能无视对手能力提升状态")).toEqual({
      hook: "onBattleStart",
      ops: [{ op: "apply_status", name: "pierce_stages", target: "self" }],
    });
  });

  it("整句：霍莱回合开始快照不能改挂为后续出招条件，关联 else 一起延期", () => {
    const text = "回合开始时若自身满体力则自身使用技能50%令对手害怕，未触发则消除对手回合类效果";
    const result = parseSoulmarkText(text);
    expect(result.entries.flatMap((entry) => entry.ops ?? []).some((op) => op.name === "fear" || op.op === "cleanse")).toBe(false);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("自身使用技能50%令对手害怕"))).toBe(true);
    expect(result.unparsed.some((fragment) => fragment.clause.includes("未触发则消除对手回合类效果"))).toBe(true);
  });

  it("纯使用吸取的damage+heal序列保留旧招式窗并标记时序残留", () => {
    const text = "自身使用技能时吸取对手200点体力";
    const parsed = parseSoulmarkText(text);
    expect(first(text)).toEqual({
      hook: "onMoveUsed",
      ops: [
        { op: "damage", power: 200, kind: "fixed" },
        { op: "heal", flat: 200, target: "self" },
      ],
      guard: { actor: "self" },
    });
    expect(parsed.unparsed).toEqual([{
      clause: text,
      reason: "move-use scope — additional guard, limit, linked trigger, or payload is not supported by the plain-use react path (deferred)",
    }]);
  });

  it("邻句不变：'自身所有技能必定先手' 旧 IR 逐字不变（所有技能起首无动词锚，不剥）", () => {
    expect(first("自身所有技能必定先手")).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "apply_status", name: "prio_up", target: "self", turns: 1, params: { add: 3 } }],
      guard: { actor: "self", cat: [2, 3] },
    });
  });
});

describe("w11 语料面：残句条目数只增不减，且相邻旧句照旧", () => {
  it("南十字·克鲁斯：'若自身处于能力提升状态则自身攻击忽略对手25%的防御值' 从 no-rule 变成 ignore_def 窗", () => {
    const t = "回合开始时，若自身处于能力提升状态则自身攻击忽略对手25%的防御值";
    expect(first(t)).toEqual({
      hook: "onTurnStart",
      guard: { selfStageUp: true },
      ops: [{ op: "apply_status", name: "ignore_def", target: "self", params: { pct: 25 }, turns: 1 }],
    });
    expect(parseSoulmarkText(t).unparsed).toHaveLength(0);
  });

  it("迹：'自身使用技能无视对手能力提升状态' 单条无残留", () => {
    expect(all("自身使用技能无视对手能力提升状态")).toHaveLength(1);
    expect(parseSoulmarkText("自身使用技能无视对手能力提升状态").unparsed).toHaveLength(0);
  });

  it("邻句不变：p3 加的受击窗与命中窗逐字不变", () => {
    expect(first("自身受到物理攻击时50%令对手害怕")).toEqual(first("受到物理攻击时50%令对手害怕"));
    expect(first("所有技能命中时50%令对手害怕")).toEqual(first("所有技能命中后50%令对手害怕"));
  });

  it("邻句不变：裸句仍落同一条规则（新句只是把「自身」形改成裸形，没有第二种落点）", () => {
    expect(all("使用技能50%令对手害怕")).toHaveLength(1);
    expect(all("攻击必定暴击")).toHaveLength(1);
    expect(first("攻击必定暴击")).toEqual(first("自身攻击必定暴击"));
  });
});
