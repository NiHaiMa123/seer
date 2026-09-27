/**
 * M4-01：队伍编辑——有序 team → {species,bench} 展开 + 全链路 create。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadPackFromDir } from "@seer/battle-core";
import { teamToConfig, TeamError } from "@seer/host";
import { startServer } from "../../apps/server/src/index.ts";

const CONTENT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "content");
const V2 = loadPackFromDir(CONTENT, "synthetic-v2");
const V1 = loadPackFromDir(CONTENT, "synthetic-v1");

describe("teamToConfig", () => {
  it("单人队 → 仅 species 无 bench", () => {
    expect(teamToConfig(V2, ["syn-gamma"])).toEqual({ species: "syn-gamma" });
  });
  it("有序展开：[0] 首发，余下 bench", () => {
    expect(teamToConfig(V2, ["syn-delta", "syn-epsilon", "syn-gamma"])).toEqual({
      species: "syn-delta", bench: ["syn-epsilon", "syn-gamma"],
    });
  });
  it("未知 species 拒绝", () => {
    expect(() => teamToConfig(V2, ["syn-gamma", "syn-mewtwo"])).toThrow(TeamError);
    expect(() => teamToConfig(V2, ["syn-mewtwo"])).toThrow(TeamError);
  });
  it("超 maxBenchSize=2 拒绝", () => {
    expect(() => teamToConfig(V2, ["syn-gamma", "syn-delta", "syn-epsilon", "syn-gamma"]))
      .toThrowError(/maxBenchSize/);
  });
  it("v1 规则集（无 bench feature）拒绝任何 bench", () => {
    expect(() => teamToConfig(V1, ["syn-alpha", "syn-beta"])).toThrowError(/bench/);
    expect(teamToConfig(V1, ["syn-alpha"])).toEqual({ species: "syn-alpha" });
  });
  it("空队拒绝", () => {
    expect(() => teamToConfig(V2, [])).toThrow(TeamError);
  });
});

describe("POST /api/battle team 字段", () => {
  it("team 创建 → observe 显示首发 + bench", async () => {
    const server = await startServer(0);
    try {
      const r = await fetch(`${server.url}/api/battle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seedHex: "ab".repeat(16), pack: "synthetic-v2",
          team: { p1: ["syn-delta", "syn-epsilon"], p2: ["syn-gamma", "syn-delta"] },
        }),
      });
      const { battleId, tokens } = await r.json() as { battleId: string; tokens: { p1: string } };
      const obs = await fetch(`${server.url}/api/battle/${battleId}/observe?player=${tokens.p1}`).then((x) => x.json());
      expect(obs.own.speciesId).toBe("syn-delta");
      expect(obs.own.bench).toHaveLength(1);
      expect(obs.own.bench[0].speciesId).toBe("syn-epsilon");
      expect(obs.opponent.benchAlive).toBe(1);
    } finally {
      await server.close();
    }
  });
  it("team 与 species 互斥", async () => {
    const server = await startServer(0);
    try {
      const r = await fetch(`${server.url}/api/battle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seedHex: "cd".repeat(16), pack: "synthetic-v2",
          species: { p1: "syn-gamma", p2: "syn-delta" },
          team: { p1: ["syn-gamma"], p2: ["syn-delta"] },
        }),
      });
      expect(r.status).toBe(400);
    } finally {
      await server.close();
    }
  });
  it("team 引用未知 species → 400", async () => {
    const server = await startServer(0);
    try {
      const r = await fetch(`${server.url}/api/battle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seedHex: "ef".repeat(16), pack: "synthetic-v2",
          team: { p1: ["syn-gamma", "syn-x"], p2: ["syn-delta"] },
        }),
      });
      expect(r.status).toBe(400);
      const body = await r.json() as { message: string };
      expect(body.message).toContain("syn-x");
    } finally {
      await server.close();
    }
  });
});
