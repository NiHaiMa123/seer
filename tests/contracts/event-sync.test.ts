/**
 * event-sync — 公开事件五方一致（阶段 1 负例测试）。
 * 负例只在内存里改输入，不写回仓库文件，也不在工作区里临时删白名单再还原。
 */
import { describe, expect, it } from "vitest";
import { eventSyncErrors, loadEventSyncInput, type EventSyncInput } from "../../tools/schema-sync-check.ts";

/** 深拷贝输入为可写形状——负例只改内存副本，不回写仓库。 */
const clone = (input: EventSyncInput) => ({
  schemaBranches: new Map([...input.schemaBranches].map(([k, v]) => [k, new Set(v)])),
  publicTypes: new Set(input.publicTypes),
  publicFields: Object.fromEntries(Object.entries(input.publicFields).map(([k, v]) => [k, new Set(v)])),
  coreEventTypes: [...input.coreEventTypes],
  internalEnum: [...input.internalEnum],
  zhEventNames: { ...input.zhEventNames } as Record<string, string>,
});

describe("eventSyncErrors", () => {
  it("仓库现状返回空数组", () => {
    expect(eventSyncErrors(loadEventSyncInput())).toEqual([]);
  });

  it("负例：类型集去掉 protected → 报错点名 protected", () => {
    const bad = clone(loadEventSyncInput());
    bad.schemaBranches.delete("protected");
    expect(eventSyncErrors(bad).join("\n")).toContain("protected");
  });

  it("负例：pp-delta schema 字段加 moveId → 报错点名 moveId", () => {
    const bad = clone(loadEventSyncInput());
    bad.schemaBranches.get("pp-delta")!.add("moveId");
    expect(eventSyncErrors(bad).join("\n")).toContain("moveId");
  });

  it("负例：ZH_EVENT 去掉 soulmark → 报错点名 soulmark", () => {
    const bad = clone(loadEventSyncInput());
    delete bad.zhEventNames["soulmark"];
    expect(eventSyncErrors(bad).join("\n")).toContain("soulmark");
  });

  it("负例：公开类型缺整份字段白名单 → 报错点名该类型", () => {
    const bad = clone(loadEventSyncInput());
    delete bad.publicFields["protected"];
    const text = eventSyncErrors(bad).join("\n");
    expect(text).toContain("protected");
    expect(text).toContain("PUBLIC_FIELDS 没有该类型的字段集");
  });
});
