import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "../../packages/agent/src/provider.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const provider = () => {
  vi.stubEnv("SEER_TEST_KEY", "offline-test-key");
  return new OpenAiProvider({ endpoint: "https://example.invalid/v1", model: "offline", credentialRef: "SEER_TEST_KEY" });
};
describe("provider 取消和错误分类", () => {
  it("预先取消的请求不发网络调用", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const ctrl = new AbortController(); ctrl.abort();
    expect(await provider().generate({ prompt: "test" }, ctrl.signal)).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("用户取消不能误报模型超时", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    })));
    const ctrl = new AbortController();
    const request = provider().generate({ prompt: "test" }, ctrl.signal);
    ctrl.abort();
    expect(await request).toMatchObject({ ok: false, error: { code: "aborted", retryable: false } });
  });
  it("损坏的响应 JSON 分类为 parse", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("bad JSON"))));
    expect(await provider().generate({ prompt: "test" }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: "parse" } });
  });
});
