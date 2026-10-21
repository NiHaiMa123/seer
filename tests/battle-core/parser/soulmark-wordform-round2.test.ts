/**
 * 魂印词形扩展（2026-10-21 第二轮）——5 只闭合 + 1 只转入 deferred 族。
 *
 * 本轮全部是「现成格子」的写法缺口，不新增 op / 状态名 / params 键：
 *   pet-3882 「100%等量固定伤害」        → flatSelfLastDmgPct（当次出伤的 N% 作固伤）
 *   pet-3965 「100%消除对手回合类效果和能力提升状态」 → clear_stages(up) + cleanse(timed)
 *   pet-4075 「将自身相应的能力提升状态赋予给对手相应的能力下降状态」 → transfer_stages(upToDown)
 *   pet-4248 「附加造成伤害量50%的固定伤害」 → flatSelfLastDmgPct（「伤害值」多一个「量」字）
 *   pet-4587 「对手攻击时70%闪避对手的攻击」 → onDamaged + dodge(pct 70) + turnParity 门
 *   pet-4668 「附加给对手自身所处的所有异常状态」 → transfer_ailments(push)
 *
 * 改动点：
 *   tools/effects-rules/batch-e6.mjs   batch-e6-159（「伤害[值量]」）/ batch-e6-159b（「N%等量固伤」）
 *                                      batch-e6-206b（「附加给对手…所有异常状态」）
 *   tools/effects-rules/attach-damage.mjs attach-damage-81（「(100%)?消除…回合类效果和能力提升状态」）
 *   tools/effects-rules/batch-e5c.mjs   batch-e5c-04（「能力提升(状态)?…能力下降(状态)?」）
 *   tools/soulmark-parse.mjs            TRIGGERS 新增「对手攻击时」→ onDamaged；
 *                                      body 二次匹配前的 break 条件放开「对手攻击时」这一形态
 *
 * 边界（护栏锁住）：
 *   - 「对手使用攻击技能时…」是**纯用技反应窗**（onMoveUsed actor:foe），
 *     不能被「对手攻击时」触发词抢走改挂 onDamaged（触发时机整体前移 = 语义回归）。
 *   - 「对手使用攻击时提前触发」（pet-4355）不是「对手攻击时」，不得被当触发词剥掉。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("魂印词形扩展：伤害量 / 状态后缀 / 消除并列 / 能力赋予", () => {
  it("pet-3882：「100%等量固伤」= 当次出伤的 100% 作固定伤害", () => {
    const r = parseSoulmarkText(
      "自身攻击技能造成伤害100%恢复体力，若造成伤害值尾数为6则额外附加100%等量固伤",
      "姗姗",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onDamageDealt",
        ops: [{ op: "apply_status", name: "drain_atk", target: "self", params: { n: 100, d: 100 } }],
      },
      {
        hook: "onTurnEnd",
        guard: { damageDigitEq: 6 },
        ops: [
          { op: "damage", kind: "fixed", power: 0, target: "opponent" },
          { op: "flat", of: "flatSelfLastDmgPct", value: 100 },
        ],
      },
    ]);
  });

  it("pet-4248：「造成伤害量」的「量」字与「造成伤害值」同读法", () => {
    const r = parseSoulmarkText(
      "自身造成的攻击伤害低于300则附加造成伤害量50%的固定伤害",
      "辛迪拉",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onDamageDealt",
        guard: { prevDamageBelowAbs: 300 },
        ops: [
          { op: "damage", kind: "fixed", power: 0, target: "opponent" },
          { op: "flat", of: "flatSelfLastDmgPct", value: 50 },
        ],
      },
    ]);
  });

  it("pet-3965：「100%消除对手回合类效果和能力提升状态」两个都消", () => {
    const r = parseSoulmarkText(
      "首次登场时，若对手为雄性精灵则100%消除对手回合类效果和能力提升状态",
      "闭月之姿·貂蝉",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onEntry",
        guard: { foeGender: "male" },
        ops: [
          { op: "clear_stages", target: "opponent", sign: "up" },
          { op: "cleanse", target: "opponent", scope: "timed" },
        ],
        chance: { once: true },
      },
    ]);
  });

  it("pet-4075：「能力提升状态赋予给…能力下降状态」= 正转位", () => {
    const r = parseSoulmarkText(
      "自身使用技能后吸取对手能力提升状态,之后将自身相应的能力提升状态赋予给对手相应的能力下降状态",
      "混沌界神",
    );
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onMoveUsed",
        ops: [
          { op: "transfer_stages", direction: "steal", sign: "up" },
          { op: "transfer_stages", direction: "upToDown" },
        ],
        guard: { actor: "self" },
      },
    ]);
  });

  it("pet-4668：「附加给对手自身所处的所有异常状态」= 异常整体迁移", () => {
    const r = parseSoulmarkText(
      "对手使用攻击技能时，若自身处于束缚状态，则附加给对手自身所处的所有异常状态",
      "尚克斯",
    );
    expect(r.entries).toEqual([
      {
        hook: "onMoveUsed",
        guard: { actor: "foe", cat: [2, 3], if: { selfHas: "bind" } },
        ops: [{ op: "transfer_ailments", direction: "push", target: "opponent" }],
      },
    ]);
    // 剩余残文是「boss 门跨 react 窗」这一已知 deferred 族，不是规则缺口
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]?.reason).toContain("move-use scope");
  });
});

describe("魂印词形扩展：「对手攻击时」触发词（受击事件点）", () => {
  it("pet-4587：奇数回合对手攻击时 70% 闪避对手的攻击", () => {
    const r = parseSoulmarkText("奇数回合对手攻击时70%闪避对手的攻击", "蛇舞·天鸣");
    expect(r.unparsed).toHaveLength(0);
    expect(r.entries).toEqual([
      {
        hook: "onDamaged",
        ops: [{ op: "apply_status", name: "dodge", target: "self", params: { pct: 70 }, if: { turnParity: "odd" } }],
      },
    ]);
  });

  it("护栏：「对手使用攻击技能时…」仍是纯用技反应窗，不得被抢挂 onDamaged", () => {
    const r = parseSoulmarkText("自身受到的攻击伤害降低25%；对手使用攻击技能时所有pp-2（boss无效）", "坚壁机甲");
    // 不得出现 onDamaged 条目（被抢挂 = 触发时机从「对手出招时」前移到「我方受击时」）
    expect(r.entries.some((e) => e.hook === "onDamaged")).toBe(false);
    expect(r.entries[0]?.hook).toBe("onBattleStart");
  });

  it("护栏：「对手使用攻击时提前触发」不是「对手攻击时」，不得被剥成触发词", () => {
    const r = parseSoulmarkText(
      "自身不处于能力提升状态时100%闪避对手攻击且回合结束触发诫罚之刻，对手使用攻击时提前触发",
      "终末大天使",
    );
    expect(r.unparsed.some((u) => u.clause.includes("对手使用攻击时提前触发"))).toBe(true);
  });
});
