import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("reset 在首次 GET 返回前执行时，迟到的存档不能覆盖重置", async () => {
  vi.resetModules();
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((r) => { resolve = r; });
  vi.stubGlobal("fetch", vi.fn((_url, init?: RequestInit) => init?.method === "PUT" ? Promise.resolve(new Response("{}")) : pending));
  const { teamStore } = await import("../../apps/client/src/teamStore.ts");
  teamStore.reset();
  resolve(new Response(JSON.stringify({ team: ["pet-stale"], loadout: {}, carried: {} })));
  await vi.waitFor(() => expect(teamStore.get().team).toEqual([]));
  // 等待 GET 的 json/then 链完整执行，避免只检查到响应前的瞬间。
  await new Promise((r) => setTimeout(r, 10));
  expect(teamStore.get().team).toEqual([]);
});
