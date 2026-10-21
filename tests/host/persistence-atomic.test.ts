import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { BattleStore, PersistedBattleHost } from "@seer/host";
import { canonicalJson } from "@seer/contracts";

const pack = loadPackFromDir(join(process.cwd(), "content"), "synthetic-v1");
const config = { pack, battleId: "btl_atomic", seedHex: "ab".repeat(16), species: { p1: "syn-alpha", p2: "syn-beta" }, players: { p1: "A", p2: "B" }, deadlineMs: 30000 };
afterEach(() => vi.restoreAllMocks());
const command = (h: PersistedBattleHost, key: string) => ({ battleId: config.battleId, decisionId: h.host.state.battle.decision!.decisionId, baseRevision: h.host.state.battle.revision, actionId: "act_syn-strike", idempotencyKey: key });

describe("持久化失败的原子性", () => {
  it("resolution 写入失败同时撤销 receipt、快照和内存状态，同键可重试", () => {
    const store = new BattleStore(":memory:");
    try {
      const host = PersistedBattleHost.create(store, config);
      host.submit("A", command(host, "atomic-a"));
      const cmd = command(host, "atomic-b");
      const before = canonicalJson(host.host.state.battle);
      const row = store.loadBattle(config.battleId);
      vi.spyOn(store, "commitResolution").mockImplementationOnce(() => { throw new Error("disk failed"); });
      expect(() => host.submit("B", cmd)).toThrow("disk failed");
      expect(store.loadBattle(config.battleId)).toEqual(row);
      expect(canonicalJson(host.host.state.battle)).toBe(before);
      expect(host.receiptFor("B", cmd.idempotencyKey)).toBeUndefined();
      expect(host.submit("B", cmd).ok).toBe(true);
      expect(host.host.state.battle.revision).toBe(1);
      expect(store.loadResolvedInputs(config.battleId)).toHaveLength(1);
    } finally { store.close(); }
  });

  it("ACK 落盘失败不推进内存游标", () => {
    const store = new BattleStore(":memory:");
    try {
      const host = PersistedBattleHost.create(store, config);
      vi.spyOn(store, "commitMeta").mockImplementationOnce(() => { throw new Error("disk failed"); });
      expect(() => host.ack("A", 1)).toThrow("disk failed");
      expect(host.host.state.battle.publicCursors.p1).toBe(0);
    } finally { store.close(); }
  });

  it("建局事件提交失败不留下半条对局", () => {
    const store = new BattleStore(":memory:");
    try {
      vi.spyOn(store, "commitEventsOnly").mockImplementationOnce(() => { throw new Error("disk failed"); });
      expect(() => PersistedBattleHost.create(store, config)).toThrow("disk failed");
      expect(store.loadBattle(config.battleId)).toBeNull();
    } finally { store.close(); }
  });
});
