/**
 * 「位于出战背包时」前置守卫 + 「己方」主语。
 *
 * 语料 13 处，两种缺口：
 *   ① 「己方免疫X」——现有规则只认「自身/自己/本方」作主语，不认「己方」
 *   ② 「自身位于/存活于出战背包时，<效果>」——这是**守卫条件**，后面的效果才是本体
 *
 * 语义：该魂印只在持有者坐板凳（出战背包）时生效。
 * 若持有者已经出场，条件不成立，效果不该生效。
 *
 * 实现选择：不新增条件谓词，而是把效果原样落地——因为"位于出战背包时"在本项目的
 * 对局模型里意味着持有者不在场，而魂印 hook 本来就只对该持有者自身结算；
 * 真正的差别（在场时不生效）需要一个"当前是否在场"的读数。
 * 先做**能确定的部分**：剥离前缀 + 认「己方」主语，让效果本体落地；
 * "在场即失效"这一半记录为待办，不假装已实现。
 */
import { describe, it, expect } from "vitest";
import { parseSoulmarkText } from "../../../tools/soulmark-parse.mjs";

describe("己方主语", () => {
  it("「己方免疫X」等价于自身免疫（单人魂印语境）", () => {
    const r = parseSoulmarkText("己方免疫混乱状态", "测试");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.entries)).toMatch(/immune_status/);
  });

  it("「己方精灵免疫X」", () => {
    const r = parseSoulmarkText("己方精灵免疫混乱状态", "测试");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.entries)).toMatch(/immune_status/);
  });

  it("原有「自身」主语不回归", () => {
    const r = parseSoulmarkText("自身免疫混乱状态", "测试");
    expect(JSON.stringify(r.entries)).toMatch(/immune_status/);
  });
});

describe("位于出战背包时 前置", () => {
  it("剥离前缀后效果本体落地", () => {
    const r = parseSoulmarkText("自身位于出战背包时，己方免疫受到的失明状态", "测试");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.entries)).toMatch(/immune_status/);
  });

  it("「存活于出战背包时」同样", () => {
    const r = parseSoulmarkText("自身存活于出战背包时，己方精灵免疫混乱状态", "小珍妮");
    expect(r.unparsed).toEqual([]);
    expect(JSON.stringify(r.entries)).toMatch(/immune_status/);
  });

  it("纯前缀（后面没有效果）不产条目也不报错", () => {
    const r = parseSoulmarkText("自身位于出战背包时", "测试");
    expect(r.entries).toEqual([]);
  });
});