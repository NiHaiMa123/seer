/**
 * add-effect-r4c：「免疫并反弹对手下次造成的伤害」。
 *
 * 这条句子原先落在 `batch-e6-177` 的留档里，和真正的具名来源（B-ROBO、某只精灵名、系别）
 * 混在同一个 reason（`source-filter`）。两者不是一回事：
 *   - 「对手下次造成的伤害」是**受方自己的下一次承伤窗**，来源就是对手，没有来源过滤；
 *     次数和回合窗都有现成格子——`dmg_immune.params.count`（读在 `ops/damage.ts` 的免疫结算点）
 *     与 `reflect_dmg.params.count`（读在 `ops/damage-riders.ts` 的反弹结算点），回合形用 `turns`。
 *   - 「免疫B-ROBO造成的伤害」缺的是一个**来源限定谓词**（没有来源字段可写），继续 deferred。
 * 所以只在 batch-e6-177 之前加一条更窄的 `r4c-immune-reflect-next-01`，177 的 re 与 reason 逐字未动。
 *
 * 两张窗同时发才算「免疫并反弹」：只发 dmg_immune 是纯免疫，只发 reflect_dmg 是纯反弹。
 *
 * 本文件锁：这一族的 IR、紧跟旧留档句、宿主整句里旧句次序不变、以及 177 仍然接住具名来源。
 */
import { describe, expect, it } from "vitest";
import { parseEffectText } from "../../../tools/effects-parse.mjs";
import { rules as e6Rules } from "../../../tools/effects-rules/batch-e6.mjs";

const R177 = "source-filter — named-origin immunity unmodeled (deferred)";
type Effect = { op: string; name?: string; target?: string; turns?: number; params?: Record<string, unknown> };
type Parsed = { effects: Effect[]; unparsed: { clause: string; reason: string }[] };

const parse = (s: string) => parseEffectText(s, { hasDamage: false }) as Parsed;

/** 这一族的形状：承伤免疫窗 + 等额反弹窗，两张窗共用同一个次数/回合参数。 */
const pair = (count: number) => [
  { op: "apply_status", name: "dmg_immune", target: "self", params: { count } },
  { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, count } },
];
const pairTurns = (turns: number) => [
  { op: "apply_status", name: "dmg_immune", target: "self", turns },
  { op: "apply_status", name: "reflect_dmg", target: "self", turns, params: { n: 1, d: 1 } },
];

/** 新规则自身（绕过 order，直接跑 batch-e6 家族规则）。 */
const r4c = (e6Rules as { id: string; re: RegExp }[]).find((r) => r.id === "r4c-immune-reflect-next-01")!;

describe("add one effect (r4c)", () => {
  it("r4c-immune-reflect-next-01：免疫并反弹对手下次造成的伤害（宿主句 永恒装甲）", () => {
    const bare = parse("免疫并反弹对手下次造成的伤害");
    expect(bare.unparsed).toEqual([]);
    expect(bare.effects).toEqual(pair(1));

    // 「下N次」次数形与「下N回合」窗形
    expect(parse("免疫并反弹对手下1次造成的伤害").effects).toEqual(pair(1));
    expect(parse("免疫并反弹对手下2次造成的伤害").effects).toEqual(pair(2));
    expect(parse("免疫并反弹对手下2回合造成的伤害").effects).toEqual(pairTurns(2));
    // 「造成的攻击伤害」同义
    expect(parse("免疫并反弹对手下1次造成的攻击伤害").effects).toEqual(pair(1));
    // 主语变体：省略「对手」
    expect(parse("免疫并反弹下次造成的伤害").effects).toEqual(pair(1));

    // 宿主整句（马尔修斯（防）:永恒装甲）：免疫反弹两窗在前，后面三段旧句逐字不变
    const host = parse("免疫并反弹对手下次造成的伤害；3回合内每回合自身防御+1、特防+1、速度+1；恢复自身最大HP的1/2");
    expect(host.unparsed).toEqual([]);
    expect(host.effects.slice(0, 2)).toEqual(pair(1));
    expect(host.effects[2]).toMatchObject({ op: "apply_status", name: "periodic", turns: 3, params: { win: 6 }, payload: [{ op: "apply_stat_stage", stat: "def", delta: 1, target: "self", plain: true }] });
    expect(host.effects[3]).toMatchObject({ op: "apply_status", name: "periodic", payload: [{ op: "apply_stat_stage", stat: "sdf", delta: 1 }] });
    expect(host.effects[4]).toMatchObject({ op: "apply_status", name: "periodic", payload: [{ op: "apply_stat_stage", stat: "spd", delta: 1 }] });
    expect(host.effects[5]).toEqual({ op: "heal", numerator: 1, denominator: 2, target: "self" });

    // 「未触发则」条件窗（墨莲:碧落戚戚 / 巴斯蒂安:邪恶凝视 / 弑神猎皇:暗猎惊魂）
    const cond = parse("80%令对手害怕，未触发则免疫并反弹对手下1次造成的伤害");
    expect(cond.unparsed).toEqual([]);
    expect(cond.effects[1]).toEqual({ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 }, if: { not: { prevApplied: true } }, chance: 80 });
    expect(cond.effects[2]).toEqual({ op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, count: 1 }, if: { not: { prevApplied: true } }, chance: 80 });
  });

  it("两条窗同挂：一张 dmg_immune + 一张 reflect_dmg，与同族旧句并列不串", () => {
    // 裸免疫（对手下次）仍然只发免疫窗——不是「并反弹」，不加反弹
    const immuneOnly = parse("免疫对手下次造成的伤害");
    expect(immuneOnly.unparsed).toEqual([]);
    expect(immuneOnly.effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self", params: { count: 1 } }]);

    // 无「下N次/回合」限定的旧句不变
    expect(parse("免疫并反弹对手的攻击伤害").effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self" },
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1 } },
    ]);
    expect(parse("免疫并反弹物理伤害").effects).toEqual([
      { op: "apply_status", name: "dmg_immune", target: "self", params: { cat: 2 } },
      { op: "apply_status", name: "counter", target: "self", params: { mul: 1, cat: 2 } },
    ]);
    // 相邻旧句不变：异常侧「免疫异常状态 + 反弹N/M伤害」的分段窗没被这条窄规则截走
    expect(parse("2回合免疫异常状态；3回合反弹对手1/2伤害").effects).toEqual([
      { op: "apply_status", name: "immune_status", target: "self", turns: 2 },
      { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 2 }, turns: 3 },
    ]);
    // 反例（不放行「且」连词、「自身受到的」宾语）：仍只由旧规则/旧通道接住，形状与改动前逐字一致
    const variants = [
      ["免疫且反弹对手下次造成的伤害", [
        { op: "apply_status", name: "dmg_immune", target: "self" },
        { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, count: 1 } },
      ]],
      ["1回合内免疫并反弹自身受到的固定伤害和百分比伤害", [
        { op: "apply_status", name: "dmg_immune", target: "self", params: { kindMask: 3 }, turns: 1 },
        { op: "apply_status", name: "reflect_dmg", target: "self", params: { n: 1, d: 1, kindMask: 3 } },
      ]],
    ] as const;
    for (const [text, shape] of variants) {
      expect(r4c.re.test(text)).toBe(false); // 新规则不碰它们
      expect(parse(text).effects).toEqual(shape); // 旧结果逐字不变
    }
  });

  it("具名来源仍然 deferred：B-ROBO / 系别 / 致命一击需要来源过滤，没编来源字段", () => {
    for (const s of ["免疫并反弹B-ROBO造成的伤害", "免疫并反弹草系技能造成的伤害", "免疫并反弹对手致命一击造成的伤害"]) {
      const r = parse(s);
      expect(r.effects).toEqual([]);
      expect(r.unparsed.map((u) => u.reason)).toEqual([R177]);
    }
    // 「造成的固定伤害/百分比伤害」这一类走的是另一条 tail 通道，同样没有来源过滤谓词，仍留档
    const flat = parse("免疫并反弹对手下次造成的固定伤害");
    expect(flat.effects).toEqual([]);
    expect(flat.unparsed).toEqual([{ clause: "免疫并反弹对手下次造成的固定伤害", reason: "immune-tail residual: 反弹对手下次造成的固定伤害" }]);
    // 「免疫对手造成的攻击伤害」本来就走更宽的旧规则（无次数的通用承伤免疫），新规则不碰
    const bareSource = parse("免疫对手造成的攻击伤害");
    expect(r4c.re.test("免疫对手造成的攻击伤害")).toBe(false);
    expect(bareSource.unparsed).toEqual([]);
    expect(bareSource.effects).toEqual([{ op: "apply_status", name: "dmg_immune", target: "self" }]);
  });

  it("batch-e6-177 逐字未动，且仍排在 r4c 之后接住具名来源", () => {
    const ids = (e6Rules as { id: string }[]).map((r) => r.id);
    const i177 = ids.indexOf("batch-e6-177");
    const iNew = ids.indexOf("r4c-immune-reflect-next-01");
    expect(iNew).toBeGreaterThanOrEqual(0);
    expect(i177).toBeGreaterThan(iNew); // 窄规则在前，留档规则在后
    const r177 = (e6Rules as { id: string; re: RegExp; go: () => { unparsedReason?: string } }[])[i177];
    expect(r177.re.source).toBe(String.raw`^免疫(?!下?\d+次|下[一二两三四五六七八九十]+次|下?次|对手下?|对方下?|敌方下?)[\p{Script=Han}A-Za-z0-9-]{2,}造成的(?:攻击)?伤害$`);
    expect(r177.go().unparsedReason).toBe(R177);
  });
});
