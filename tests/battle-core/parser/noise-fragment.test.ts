/**
 * 纯噪声片段不再计入残文。
 *
 * 缺口：切分后剩下的碎片会以残文形态留在记录里——
 *  - 裸主语代词（"自身"——「自身受到攻击时…」的主语被触发词切走后剩下的）
 *  - 图鉴页尾巴（"精灵资料：" / ">>>" / 编号残渣）
 * 它们**构造上不可能承载效果**（裸代词没有谓语，页尾是抓取残留），
 * 记成残文会让整条记录永远算不上完成。
 *
 * 改法：tools/effects-parse.mjs 的「no-rule」推送点先过一遍噪声判定。
 * 只在词形上判定，不做语义猜测：
 *  - 「赛尔号X的魂印是Y，：<效果>」这种 FAQ 引导语**不是**噪声——它常带真内容
 *    （pet-3289 / pet-3320 就是），所以噪声表只收「纯代词 / 纯页尾 / 编号残渣」。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";
import { parseEffectText } from "../../../tools/effects-parse.mjs";

describe("纯噪声片段不记残文", () => {
  it("裸主语代词碎片不再进残文（pet-3327 霜焱圣君）", () => {
    const r = parseSoulmarkText(
      "淡：自身使用攻击技能时50%令对方烧伤，50%令对方冻伤；自身受到攻击时50%令对手冰封，未触发则消除对手回合类效果（BOSS无效）",
      "霜焱圣君",
    );
    expect(r.unparsed.some((u) => u.clause === "自身")).toBe(false);
    // 效果一条不少（burn 在 react 窗的 payload 里，其余在条目 ops 上）
    const all = JSON.stringify(r.entries);
    expect(all).toContain('"burn"');
    expect(all).toContain('"frostbite"');
    expect(all).toContain('"freeze"');
  });

  it("图鉴页尾巴不进残文", () => {
    const r = parseSoulmarkText("自身受到攻击时50%令对手冰封 精灵资料：赛尔号某进化图种族值技能表>>>");
    expect(r.unparsed.some((u) => u.clause.includes("精灵资料"))).toBe(false);
  });

  it("FAQ 引导语不算噪声——它带的内容不许被悄悄丢掉", () => {
    // 「赛尔号X是草系精灵王，她的魂印是蕊，：若对手使用攻击技能则…」这种 FAQ 引导语
    // **不是**噪声（它后面常跟着真效果）。目前这形的正文还没解析出来（既有缺口），
    // 但必须**留在残文里**——不能被噪声过滤当成页面尾巴删掉，那样就等于把没实现的
    // 内容伪装成已实现。
    const r = parseSoulmarkText(
      "赛尔号茉蕊儿是草系精灵王，她的魂印是蕊，：若对手使用攻击技能则造成的攻击伤害不超过自身最大体力的一半",
      "茉蕊儿",
    );
    expect(r.unparsed.length).toBeGreaterThan(0);
    expect(r.unparsed.some((u) => u.clause.includes("伤害不超过"))).toBe(true);
  });

  it("效果层：内层仍照常报 no-rule（过滤在魂印层做）", () => {
    // 噪声过滤**不在**效果层做：魂印层靠「内层是否报过 no-rule」决定整组要不要整段留档
    // （probe3.unparsed.every(u => u.reason !== "no-rule")）。内层少报一条，那条整组留档
    // 就会消失——把真内容静默丢掉。所以内层照常报，由魂印层决定丢不丢。
    const r = parseEffectText("自身") as { effects: unknown[]; unparsed: { clause?: string }[] };
    expect(r.unparsed.some((u) => u.clause === "自身")).toBe(true);
  });
});
