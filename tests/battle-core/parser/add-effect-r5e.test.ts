/**
 * add-effect-r5e：seer-r5e 这一路（r5e.md 点名的「令对方场下阵亡的首位精灵消逝」）的结论记录。
 *
 * 这句话只动了一处：`tools/effects-rules/deferred.mjs` 里在 `deferred-165` **之前**加了一条
 * `r5e-banish-dead-first-01`，发 IR `{ op: "banish_dead", target: "opponent" }`。
 * 没有新 op、没有新状态名、没有新 params 键、没有新结算分支。
 *
 * 为什么对得上（逐字核对 `packages/battle-core/src/ops/banish-dead.ts`）：
 *   - 「对方」→ `targetSideOf` 把 `target:"opponent"` 解析成对手侧；`OpTarget` 里本来就有 `opponent`。
 *     （那个 `"bench"` 不是侧别，是「自己这一侧的背包」——见 `ops/heal.ts` 的 `fx.target === "bench"` 分支，
 *      所以「令对方场下…」不能用它。）
 *   - 「场下」→ 处理器读的就是 `next.sides[targetSide].bench`。
 *   - 「阵亡」→ `findIndex((b) => b.currentHp <= 0 && b.banished !== true)`，正是阵亡槽。
 *   - 「首位」→ `findIndex` 取的就是第一个命中的槽位。
 * 四个词各有现成落点，全部对得上，所以按 r5e.md 落成规则，而不是写 need-op。
 *
 * 规则表里更早的 `e34-banish-01`（`tools/effects-rules/batch-e34.mjs`）正则只认裸句，
 * 接不住宿主整段里的带条件形态（「未击败对手则…」），所以六处宿主一直落在 deferred-165 上。
 * 这条新规则不删旧条、不改它的字面，只是排在宽留档前面接住带条件形态。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { RULES } from "../../../tools/effects-rules/order.mjs";
import { rules as deferredRules } from "../../../tools/effects-rules/deferred.mjs";
import { rules as e34Rules } from "../../../tools/effects-rules/batch-e34.mjs";

type Parsed = { effects: unknown[]; unparsed: { clause?: string; reason?: string }[]; flags: Record<string, unknown> };

const BANISH = [{ op: "banish_dead", target: "opponent" }];
const DEFERRED_REASON = "bench-side target unmodeled (deferred)";

/** content/creatures/creatures.json 里这句话的六处宿主（整段技能文本）。 */
const HOSTS: readonly { pet: string; text: string }[] = [
  {
    pet: "pet-4762/技能14",
    text: "必中；若自身处于能力下降状态则先制+3；反转自身能力下降状态，反转成功则附加给对手等同的能力下降状态；令对方体力上限最低的存活精灵体力上限提升至与自身相等并恢复等量体力，然后此精灵所有非体力上限的能力值减少提升的数值，最多减少50点且最多减少至1；未击败对手则令对方场下阵亡的首位精灵消逝；击败对手则对方下只出战精灵首回合先制效果失效",
  },
  {
    pet: "pet-4875/技能19",
    text: "先出手时100%使对手烧伤，未触发则附加280点固定伤害；后出手时令对手下2回合属性技能无效；未击败对手则令对方场下阵亡的首位精灵消逝；击败对手则下回合开始后随机附加烧伤、冻伤、中毒中的3种异常状态",
  },
  {
    pet: "pet-4942/技能26",
    text: "必中；消除对手回合类效果，消除成功100%令对手冰封，未触发则造成的攻击伤害翻倍；造成伤害的100%恢复自身体力，若对手处于异常状态则附加等量百分比伤害；未击败对手则令对方场下阵亡的首位精灵消逝；击败对手则吸取对手最大体力的1/3",
  },
  {
    pet: "pet-4594/技能16",
    text: "必中；消除对手能力提升状态，消除成功则2回合内令对手使用的属性技能无效；损失自身200点体力，给对手造成300点固定伤害，若自身体力不足200则剩下1点体力；未击败对手则令对方场下阵亡的首位精灵消逝；每使用此技能击败一只精灵则减少对手下只出场精灵25%最大体力",
  },
  {
    pet: "pet-4642/技能20",
    text: "先制+1；必中；自身体力低于对手时造成的伤害提高100%；造成的伤害低于300则附加300点固定伤害，若先出手则固定伤害提高150点；未击败对手则令对方场下阵亡的首位精灵消逝",
  },
  {
    pet: "pet-4875/技能19 变体（敌方字面）",
    text: "未击败对手则令敌方场下阵亡的首位精灵消逝",
  },
];

describe("add one effect (r5e · 令对方场下阵亡的首位精灵消逝)", () => {
  it("裸句落成 banish_dead：场下／阵亡／首位 三个词都落在处理器的现有读法上", () => {
    const r = parseEffectText("令对方场下阵亡的首位精灵消逝") as Parsed;
    expect(r.effects).toEqual(BANISH);
    expect(r.unparsed).toEqual([]);
  });

  it("同义字面（对手/敌方、第一只/首个、省略「令」）走同一条", () => {
    for (const s of [
      "令对手场下阵亡的首位精灵消逝",
      "令敌方场下阵亡的首位精灵消逝",
      "令对方场下阵亡的第一只精灵消逝",
      "令对方场下阵亡的首个精灵消逝",
      "对方场下阵亡的首位精灵消逝",
    ]) {
      const r = parseEffectText(s) as Parsed;
      expect(r.effects, s).toEqual(BANISH);
      expect(r.unparsed, s).toEqual([]);
    }
  });

  it("六处宿主：条件形态被接住，句子的 if 门照旧由条件通道挂上", () => {
    for (const host of HOSTS) {
      const r = parseEffectText(host.text) as Parsed;
      const banished = r.effects.filter((e) => (e as { op?: string }).op === "banish_dead");
      expect(banished, host.pet).toEqual([{ op: "banish_dead", target: "opponent", if: { not: { foeFainted: true } } }]);
      // 这句不再落在板凳侧留档上
      expect(r.unparsed.some((u) => u.reason === DEFERRED_REASON && /消逝/.test(u.clause ?? "")), host.pet).toBe(false);
    }
  });

  it("别的「场下」句子仍然 deferred：侧别不对、范围不对、语意不是首位阵亡", () => {
    for (const s of [
      "令己方场下阵亡的首位精灵消逝", // 己方侧——处理器只按 targetSide 取一侧，本句语义要的是自己侧，留档
      "令对手场下全部阵亡精灵消逝",   // 「全部」——处理器只消逝首位一个槽位
      "令对方场下存活的首位精灵消逝", // 「存活」——不是阵亡槽
      "吸取对方场下阵亡的首位精灵消逝",
      "令对方场下阵亡的精灵消逝",
    ]) {
      const r = parseEffectText(s) as Parsed;
      expect(r.effects, s).toEqual([]);
      expect(r.unparsed, s).toEqual([{ clause: s, reason: DEFERRED_REASON }]);
    }
  });

  it("deferred-165 的正则逐字未改，仍接住它原来接的那批", () => {
    const d165 = deferredRules.find((r: { id: string }) => r.id === "deferred-165") as { re: RegExp; go: () => unknown } | undefined;
    expect(d165).toBeDefined();
    expect(d165!.re.source).toBe("^(?:令|使|吸取|对)?(?:对方|对手|敌方|己方|我方|本方)?场下");
    expect(d165!.go()).toEqual({ unparsedReason: DEFERRED_REASON });
    expect(d165!.re.test("令己方场下阵亡的首位精灵消逝")).toBe(true);
    expect(d165!.re.test("令对手场下全部阵亡精灵消逝")).toBe(true);
  });

  it("旧条 e34-banish-01 未删未改（仍排在 e34 家族原位），只是被更靠前的 r5e 条抢先接住裸句", () => {
    const old = e34Rules.find((r: { id: string }) => r.id === "e34-banish-01") as { re: RegExp } | undefined;
    expect(old).toBeDefined();
    expect(old!.re.source).toBe("^令?(?:对手|对方|敌方)场下阵亡的?(?:首位|第一只|首个)?精灵消逝$");
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(ids).toContain("e34-banish-01");
    expect(ids.indexOf("r5e-banish-dead-first-01")).toBeLessThan(ids.indexOf("e34-banish-01"));
  });

  it("顺序：r5e- 只有这一条，且排在 deferred-165 之前", () => {
    const ids = RULES.map((r: { id: string }) => r.id);
    expect(ids.filter((id) => id.startsWith("r5e-"))).toEqual(["r5e-banish-dead-first-01"]);
    expect(ids.indexOf("r5e-banish-dead-first-01")).toBeLessThan(ids.indexOf("deferred-165"));
    expect(ids.indexOf("deferred-164")).toBeLessThan(ids.indexOf("r5e-banish-dead-first-01"));
  });
});
