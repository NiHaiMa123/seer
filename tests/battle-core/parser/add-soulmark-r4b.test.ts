/**
 * add-soulmark-r4b —— r4b 做的魂印句子（只改 `tools/soulmark-parse.mjs` 一处：段级「冗余主语」剥除的锚点表）。
 *
 * 这一类是"语意已经写清、而且同一处已经有一句能解的旧句"：魂印语境里句首「自身」恒为持有者，
 * 剥掉它之后紧跟的动词短语本身就是规则表里已经落地的旧句开头（"吸取对手400点体力"、
 * "属性技能命中后100%令对手失神"、"每回合都有一定几率闪避…" 等一直在发）。
 * 做法是把句式改写成已经能解析的旧句——剥掉句首冗余主语，不发明系数、不新 op / 状态名 / params 键、
 * 不改数、不换主语、不改挂点。
 *
 * 剥除沿用 r3c 的门槛（写在代码里，不是口头约定）：只在"剥后确实整句落到规则表（unparsed 空且 entries>0）
 * 且未剥本来解不出"时才生效；否则整段保持原文。所以：
 *  - 未剥本来就解得出的（"自身属性技能命中后100%令对手失神"、"自身免疫并反弹…"、"自身保留1点体力"…）
 *    剥除不抢，IR 逐字不变；
 *  - "自身所有技能吸取对手400点体力" 这类原句本身就是 deferred 档（逐招 rider 挂不上魂印体），
 *    剥掉"自身"后仍然 deferred —— reason 逐字保留，没被顺手放宽；
 *  - "自身受到技能伤害后…"（受击后式）、"自身受到特殊伤害降低15%"（不属于那条 FALLTHROUGH 行）
 *    剥后仍落不到格子，整段保持原文。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const first = (t: string) => parseSoulmarkText(t).entries[0];
const entries = (t: string) => parseSoulmarkText(t).entries;
const reasons = (t: string) => parseSoulmarkText(t).unparsed.map((u) => u.reason);

describe("r4b-self-subject：句首冗余主语的「自身+旧句动词」落回裸形旧格", () => {
  it("新句：'自身吸取对手240点体力' → 与裸 '吸取对手240点体力' 逐字同 IR（骑乘式吸取+回血）", () => {
    const IR = [
      { hook: "onMoveUsed", ops: [{ op: "damage", power: 240, kind: "fixed" }], guard: { actor: "self" } },
      { hook: "onMoveUsed", ops: [{ op: "heal", flat: 240, target: "self" }], guard: { actor: "self" } },
    ];
    expect(entries("自身吸取对手240点体力")).toEqual(IR);
    expect(parseSoulmarkText("自身吸取对手240点体力").unparsed).toHaveLength(0);
    expect(entries("自身吸取对手240点体力")).toEqual(entries("吸取对手240点体力"));
  });

  it("同族：'自身吸取对手最大体力的1/3' → 与裸形同 IR（分数窗）", () => {
    expect(entries("自身吸取对手最大体力的1/3")).toEqual(entries("吸取对手最大体力的1/3"));
    expect(entries("自身吸取对手最大体力的1/3")).toEqual([
      {
        hook: "onMoveUsed",
        ops: [
          { op: "damage", power: 1, kind: "percent" },
          { op: "formula", of: "frac", value: { numerator: 1, denominator: 3 } },
        ],
        guard: { actor: "self" },
      },
      {
        hook: "onMoveUsed",
        ops: [{ op: "heal", numerator: 1, denominator: 3, target: "self" }],
        guard: { actor: "self" },
      },
    ]);
    expect(parseSoulmarkText("自身吸取对手最大体力的1/3").unparsed).toHaveLength(0);
  });

  it("新句：'自身每回合都有一定几率闪避对手攻击技能，几率等同于自身当前体力百分比' → 与裸形同 IR（dyn 概率窗）", () => {
    const S = "自身每回合都有一定几率闪避对手攻击技能，几率等同于自身当前体力百分比";
    expect(entries(S)).toEqual([
      {
        hook: "onTurnEnd",
        ops: [{ op: "apply_status", name: "dodge", target: "self", turns: 1, params: { pct: 100 }, chance: 50 }],
        chance: { dyn: "selfHpPct" },
      },
    ]);
    expect(entries(S)).toEqual(entries("每回合都有一定几率闪避对手攻击技能，几率等同于自身当前体力百分比"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身每次使用技能有30%令对手害怕' → 与裸形同 IR（出招前 react 概率附加）", () => {
    const S = "自身每次使用技能有30%令对手害怕";
    expect(entries(S)).toEqual([
      {
        hook: "onBattleStart",
        ops: [{
          op: "apply_status", name: "react", target: "self",
          params: { trigger: 11 }, stack: true,
          payload: [{ op: "apply_status", name: "fear", target: "opponent", chance: 30 }],
        }],
      },
    ]);
    expect(entries(S)).toEqual(entries("每次使用技能有30%令对手害怕"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身所有攻击50%的几率打出致命一击' → 与裸形同 IR（战首 react 概率窗）", () => {
    const S = "自身所有攻击50%的几率打出致命一击";
    const IR = [
      {
        hook: "onBattleStart",
        ops: [
          {
            op: "apply_status",
            name: "react",
            target: "self",
            params: { trigger: 12, chance: 50 },
            payload: [{ op: "apply_status", name: "crit_up", target: "self", params: { n: 50, d: 100 } }],
          },
        ],
      },
    ];
    expect(entries(S)).toEqual(IR);
    expect(entries(S)).toEqual(entries("所有攻击50%的几率打出致命一击"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身受到攻击伤害有50%令对手烧伤' → 与裸形同 IR（受击 react 载荷）", () => {
    const S = "自身受到攻击伤害有50%令对手烧伤";
    const IR = [
      {
        hook: "onBattleStart",
        ops: [
          {
            op: "apply_status",
            name: "react",
            target: "self",
            params: { trigger: 1 },
            payload: [{ op: "apply_status", name: "burn", target: "opponent", chance: 50 }],
          },
        ],
      },
    ];
    expect(entries(S)).toEqual(IR);
    expect(entries(S)).toEqual(entries("受到攻击伤害有50%令对手烧伤"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身受到特殊攻击时50%令对手麻痹' → 与裸形同 IR（受击 react + cat:3）", () => {
    const S = "自身受到特殊攻击时50%令对手麻痹";
    const IR = [
      {
        hook: "onBattleStart",
        ops: [
          {
            op: "apply_status",
            name: "react",
            target: "self",
            params: { trigger: 1, cat: 3 },
            payload: [{ op: "apply_status", name: "paralysis", target: "opponent", chance: 50 }],
          },
        ],
      },
    ];
    expect(entries(S)).toEqual(IR);
    expect(entries(S)).toEqual(entries("受到特殊攻击时50%令对手麻痹"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身体力每损失1%则当回合攻击造成的伤害提升1%' → 与裸形同 IR（perHpLostStep 烘焙窗）", () => {
    const S = "自身体力每损失1%则当回合攻击造成的伤害提升1%";
    expect(entries(S)).toEqual([
      {
        hook: "onTurnEnd",
        ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { perHpLostStep: 1, perHpLostPct: 1 }, turns: 1 }],
      },
    ]);
    expect(entries(S)).toEqual(entries("体力每损失1%则当回合攻击造成的伤害提升1%"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%' → 与裸形同 IR（sameMove 门控）", () => {
    const S = "自身连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%";
    const BARE = "连续使用同一技能时造成的攻击伤害提升30%，每次触发增加30%";
    expect(entries(S)).toEqual([
      {
        hook: "onMoveUsed",
        ops: [{ op: "apply_status", name: "dmg_boost", target: "self", params: { pct: 30, growStep: 30 } }],
        guard: { actor: "self", sameMove: true },
      },
    ]);
    expect(entries(S)).toEqual(entries(BARE));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身攻击有50%使对手随机进入害怕、麻痹、疲惫中的一种异常状态' → 与裸形同 IR（random 列表）", () => {
    const S = "自身攻击有50%使对手随机进入害怕、麻痹、疲惫中的一种异常状态";
    expect(entries(S)).toEqual([
      {
        hook: "onDamageDealt",
        ops: [
          {
            op: "apply_status",
            name: "random",
            random: { list: ["fear", "paralysis", "fatigue"], count: 1 },
            target: "opponent",
            chance: 50,
          },
        ],
      },
    ]);
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });

  it("新句：'自身吸取对手已损失体力的1/2' → 与裸形同 IR（missing 基线 + drain rider）", () => {
    const S = "自身吸取对手已损失体力的1/2";
    expect(entries(S)).toEqual([
      {
        hook: "onMoveUsed",
        ops: [
          { op: "damage", kind: "fixed", power: 0 },
          { op: "flat", of: "flatFoeFrac", value: { base: "missing", numerator: 1, denominator: 2 } },
          { op: "applyDrainRider", drain: { numerator: 1, denominator: 1 } },
        ],
        guard: { actor: "self" },
      },
    ]);
    expect(entries(S)).toEqual(entries("吸取对手已损失体力的1/2"));
    expect(parseSoulmarkText(S).unparsed).toHaveLength(0);
  });
});

describe("r4b-已有句保持同形，属性技能命中绑定成功招式事件", () => {
  it("'自身属性技能命中后100%令对手失神' 挂属性招式命中窗，与裸形同 IR", () => {
    const S = "自身属性技能命中后100%令对手失神";
    const IR = [{ hook: "onMoveUsed", guard: { actor: "self", cat: 1 }, ops: [{ op: "apply_status", name: "daze", target: "opponent", chance: 100 }] }];
    expect(entries(S)).toEqual(IR);
    expect(entries(S)).toEqual(entries("属性技能命中后100%令对手失神"));
  });

  it("'自身攻击技能命中后造成的伤害提升50%' 留残，命中回调已错过本次伤害", () => {
    const r = parseSoulmarkText("自身攻击技能命中后造成的伤害提升50%");
    expect(r.entries).toEqual([]);
    expect(r.unparsed.map((u) => u.reason)).toEqual([
      "post-hit modifier — current damage/heal has already resolved before this hook (deferred)",
    ]);
  });

  it("'自身攻击后附加伤害值99%的百分比伤害' 与裸形同 IR（lastDmgFrac 载体）", () => {
    const S = "自身攻击后附加伤害值99%的百分比伤害";
    expect(entries(S)).toEqual([
      {
        hook: "onMoveUsed",
        ops: [
          { op: "damage", kind: "percent" },
          { op: "flat", of: "lastDmgFrac", value: { numerator: 99, denominator: 100 } },
        ],
        guard: { actor: "self", cat: [2, 3] },
      },
    ]);
    expect(entries(S)).toEqual(entries("攻击后附加伤害值99%的百分比伤害"));
  });

  it("'自身使用技能时附加350点固定伤害' 迁移到 react；'自身攻击必定暴击' 仍走招式钩", () => {
    expect(first("自身使用技能时附加350点固定伤害")).toEqual({
      hook: "onBattleStart",
      ops: [{
        op: "apply_status", name: "react", target: "self",
        params: { trigger: 11 }, stack: true,
        payload: [{ op: "damage", kind: "fixed", power: 350, target: "opponent" }],
      }],
    });
    expect(first("自身攻击必定暴击")).toEqual({
      hook: "onMoveUsed",
      ops: [{ op: "apply_status", name: "crit_always", target: "self" }],
      guard: { actor: "self", cat: [2, 3] },
    });
  });

  it("'自身保留1点体力' 与裸形逐字同 IR（endure）", () => {
    expect(entries("自身保留1点体力")).toEqual([{ op: "endure" }]);
    expect(entries("自身保留1点体力")).toEqual(entries("保留1点体力"));
  });

  it("'自身免疫并反弹受到的异常状态' 未剥本来就解得出 —— 剥除不抢，保持它自己的旧条目形状", () => {
    // 未剥已解的门槛拦下了剥除：这两句本来就走各自的老收法（裸形是两条条目，句首带「自身」的是一条两条 op），
    // 所以这里锁的是"没被顺手改写"，不是与裸形逐字相等。
    expect(entries("自身免疫并反弹受到的异常状态")).toEqual([
      {
        hook: "onBattleStart",
        ops: [
          { op: "apply_status", name: "immune_status", target: "self" },
          { op: "apply_status", name: "reflect_status", target: "self" },
        ],
      },
    ]);
    expect(entries("免疫并反弹受到的异常状态")).toEqual([
      { hook: "onBattleStart", ops: [{ op: "apply_status", name: "immune_status", target: "self" }] },
      { hook: "onBattleStart", ops: [{ op: "apply_status", name: "reflect_status", target: "self" }] },
    ]);
    expect(parseSoulmarkText("自身免疫并反弹受到的异常状态").unparsed).toHaveLength(0);
  });
});

describe("r4b-未放宽：剥后仍落不到格子的整段保持原文（reason 逐字不变）", () => {
  it("'自身所有技能吸取对手400点体力' 仍是逐招 rider 的 deferred 档（剥掉「自身」也不放宽）", () => {
    for (const s of ["自身所有技能吸取对手400点体力", "自身全部技能吸取对手400点体力"]) {
      expect(entries(s), s).toHaveLength(0);
      expect(reasons(s), s).toEqual(["moveset-wide drain — per-move rider cannot attach from soulmark body (deferred)"]);
      expect(parseSoulmarkText(s).unparsed.map((u) => u.clause), s).toEqual([s]);
    }
  });

  it("'自身受到技能伤害后…'（受击后式）剥后仍解析不出，整段保持原文", () => {
    const S = "自身受到技能伤害后，对手3回合内攻击免疫效果失效";
    expect(entries(S)).toHaveLength(0);
    expect(reasons(S)).toEqual(["no-trigger-prefix"]);
    expect(parseSoulmarkText(S).unparsed.map((u) => u.clause)).toEqual([S]);
  });

  it("'自身受到特殊伤害降低15%' 的 reason 不变（它从未进过那条 FALLTHROUGH 行）", () => {
    expect(reasons("自身受到特殊伤害降低15%")).toEqual(["no-trigger-prefix"]);
  });

  it("r3c 的旧边界不变：'自身恢复当前体力的30%' 等剥后落不到格子的整段保持原文", () => {
    for (const s of ["自身恢复当前体力的30%", "自身恢复等同于消除护盾数值的体力", "自身恢复体力时"]) {
      expect(parseSoulmarkText(s).entries, s).toHaveLength(0);
      expect(parseSoulmarkText(s).unparsed.map((u) => u.clause), s).toEqual([s]);
    }
  });

  it("r2b 的旧边界不变：'自身受到攻击伤害降低' 无数值时仍在 deferred，没被补出系数", () => {
    expect(entries("自身受到攻击伤害降低")).toHaveLength(0);
    expect(parseSoulmarkText("自身受到攻击伤害降低").unparsed.length).toBeGreaterThan(0);
  });
});
