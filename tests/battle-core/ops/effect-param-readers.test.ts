/**
 * apply_status / apply_effect 的 params 键必须被这个状态名自己的读取点碰到。
 * 负例给 counter 加一个没人读的键，不改语料。
 */
import { describe, expect, it } from "vitest";
import { paramKeyHits, paramKeysFromRepo } from "../../../tools/effect-param-readers.ts";

describe("status params keys", () => {
  const allowed = paramKeysFromRepo();

  it("counter 读 foeMaxN / foeMaxD / flat，这三个不漏给别的名字", () => {
    expect(allowed.get("counter")?.has("foeMaxN")).toBe(true);
    expect(allowed.get("counter")?.has("foeMaxD")).toBe(true);
    expect(allowed.get("counter")?.has("flat")).toBe(true);
    expect(allowed.get("hot")?.has("foeMaxN")).toBe(false);
    expect(allowed.get("burn")?.has("foeMaxN")).toBe(false);
    expect(allowed.has("stage_tick")).toBe(false);
    expect(allowed.get("pp_drain")?.has("flat")).toBe(true);
    expect(allowed.get("pp_drain")?.has("stat")).toBe(false);
    expect(allowed.get("must_miss")?.has("count")).toBe(false);
    expect(allowed.get("must_miss")?.has("scope")).toBe(true);
  });

  it("counter 上多一个没人读的 params 键就失败", () => {
    expect(paramKeyHits([
      { op: "apply_status", name: "counter", params: { foeMaxN: 1, foeMaxD: 3, flat: 1 } },
    ], allowed)).toEqual([]);
    expect(paramKeyHits([
      { op: "apply_status", name: "counter", params: { foeMaxN: 1, unread: 1 } },
    ], allowed)).toEqual([{ path: "effects[0]", key: "unread", name: "counter" }]);
    expect(paramKeyHits([
      { op: "apply_effect", name: "not_a_status", params: { nope: 1 } },
    ], allowed)).toEqual([]);
  });
});
