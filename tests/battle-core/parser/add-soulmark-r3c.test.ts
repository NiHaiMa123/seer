/**
 * add-soulmark-r3c —— r3c 做的魂印句子（只改 `tools/soulmark-parse.mjs` 一处：切段时的"冗余主语"剥除）。
 *
 * 这一类是"语意已经写清、而且同一处已经有一句能解的旧句"：魂印语境里句首「自身」恒为持有者，
 * 裸形同族句本来就已在规则表落地（"恢复最大体力的1/4"、"自身恢复150点体力" 一直在发）。
 * 做法是把句式改写成已经能解析的旧句——剥掉句首冗余主语，不发明系数、不新 op / 状态名 / params 键、
 * 不改数、不换主语、不改挂点。
 *
 * 落地的一条：`^自身(?=恢复)`（裸"恢复X"=每回合回血 tick 的旧格子）。
 * 剥除只在"剥后确实整句落到规则表、且未剥本来解不出"时才生效：
 *  - "自身恢复最大体力的1/4"/"自身恢复150点体力" 本来就解得出 —— 剥除不抢（IR 逐字不变）；
 *  - "自身恢复200点体力并造成等量固定伤害" 使用 heal.foeEcho，与是否带「自身」无关；
 *  - "自身恢复当前体力的30%"/"自身恢复等同于消除护盾数值的体力"/"自身恢复体力时" 剥后仍落不到格子
 *    —— 整段保持原文，残句报告的 clause 文本逐字不变；
 *  - "自身吸取…"/"自身所有技能…"/"自身攻击技能命中后…" 等别的「自身+动词」行没被顺手放宽。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

const first = (t: string) => parseSoulmarkText(t).entries[0];
const entries = (t: string) => parseSoulmarkText(t).entries;

describe("r3c-recover-subject：句首冗余主语的「自身恢复…」落回旧回血 tick", () => {
  it("新句：'自身恢复最大体力的17%' → onTurnEnd + heal 17%，与裸形逐字同 IR", () => {
    expect(first("自身恢复最大体力的17%")).toEqual({
      hook: "onTurnEnd",
      ops: [{ op: "heal", numerator: 17, denominator: 100, target: "self" }],
    });
    expect(parseSoulmarkText("自身恢复最大体力的17%").unparsed).toHaveLength(0);
    expect(first("自身恢复最大体力的17%")).toEqual(first("恢复最大体力的17%"));
  });

  it("同形：'自身恢复最大体力的1/3与所有技能1点PP值' → heal + pp_delta（连词白名单内的复合句）", () => {
    expect(first("自身恢复最大体力的1/3与所有技能1点PP值")).toEqual({
      hook: "onTurnEnd",
      ops: [
        { op: "heal", numerator: 1, denominator: 3, target: "self" },
        { op: "pp_delta", amount: 1, target: "self" },
      ],
    });
    expect(parseSoulmarkText("自身恢复最大体力的1/3与所有技能1点PP值").unparsed).toHaveLength(0);
  });

  it("旧句不变：'自身恢复最大体力的1/4' / '自身恢复150点体力' 本来就解得出（剥除不抢已能解的句子）", () => {
    expect(first("自身恢复最大体力的1/4")).toEqual({
      hook: "onTurnEnd",
      ops: [{ op: "heal", numerator: 1, denominator: 4, target: "self" }],
    });
    expect(first("自身恢复150点体力")).toEqual({
      hook: "onTurnEnd",
      ops: [{ op: "heal", flat: 150, target: "self" }],
    });
  });

  it("回复后的等量固伤读取本次实际回复量", () => {
    expect(entries("自身恢复200点体力并造成等量固定伤害")).toEqual([
      {
        hook: "onTurnEnd",
        ops: [
          { op: "heal", flat: 200, target: "self", foeEcho: true },
        ],
      },
    ]);
  });

  it("边界：剥后落不到规则表的整段保持原文（unparsed 的 clause 文本逐字不变）", () => {
    for (const s of ["自身恢复当前体力的30%", "自身恢复等同于消除护盾数值的体力", "自身恢复体力时"]) {
      expect(parseSoulmarkText(s).entries, s).toHaveLength(0);
      expect(parseSoulmarkText(s).unparsed.map((u) => u.clause), s).toEqual([s]);
    }
  });

  it("未被顺手放宽：别的「自身+动词」句仍是原样（本条剥除只认『恢复』一个动词锚）", () => {
    // 仍是残句、reason 逐字不变（"自身吸取对手240点体力" 已由 r4b 新增的锚点表承接，故从这条边界里移出）
    for (const [s, reason] of [
      ["自身所有技能吸取对手400点体力", "moveset-wide drain — per-move rider cannot attach from soulmark body (deferred)"],
      ["自身受到技能伤害后，对手3回合内攻击免疫效果失效", "no-trigger-prefix"],
    ] as const) {
      expect(parseSoulmarkText(s).unparsed.map((u) => u.reason), s).toEqual([reason]);
      expect(parseSoulmarkText(s).entries, s).toHaveLength(0);
    }
    // 命中回调发生在该击伤害结算后，不能再安装一个冒充本击增伤的后续窗口。
    const lateBoost = parseSoulmarkText("自身攻击技能命中后造成的伤害提升50%");
    expect(lateBoost.entries).toEqual([]);
    expect(lateBoost.unparsed).toEqual([{
      clause: "自身攻击技能命中后造成的伤害提升50%",
      reason: "post-hit modifier — current damage/heal has already resolved before this hook (deferred)",
    }]);
    expect(first("自身属性技能命中后100%令对手失神")).toEqual({
      hook: "onMoveUsed",
      guard: { actor: "self", cat: 1 },
      ops: [{ op: "apply_status", name: "daze", target: "opponent", chance: 100 }],
    });
  });
});
