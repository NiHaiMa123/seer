import { afterEach, describe, expect, it, vi } from "vitest";
import { BattleClient } from "../../apps/client/src/api.ts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("BattleClient 轮询生命周期", () => {
  it("destroy 后丢弃尚未完成的响应", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const client = new BattleClient("", "btl_test", "tok_test"), callback = vi.fn();
    client.poll(100, 0, callback);
    await vi.advanceTimersByTimeAsync(100);
    client.destroy();
    pending.resolve(new Response(JSON.stringify({ cursor: 1, events: [] })));
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).not.toHaveBeenCalled();
  });
  it("重新启动轮询撤销旧定时器和旧响应", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetcher = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ cursor: 10, events: [] }))));
    vi.stubGlobal("fetch", fetcher);
    const client = new BattleClient("", "btl_test", "tok_test"), old = vi.fn(), latest = vi.fn();
    client.poll(100, 0, old);
    await vi.advanceTimersByTimeAsync(100);
    client.poll(100, 9, latest);
    pending.resolve(new Response(JSON.stringify({ cursor: 1, events: [] })));
    await vi.advanceTimersByTimeAsync(100);
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(10, []);
    client.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("HTTP 错误不得当作成功的观察数据", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 }))));
    const client = new BattleClient("", "btl_test", "tok_test");
    await expect(client.observe()).rejects.toThrow(/401/);
  });
});
