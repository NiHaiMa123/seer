/**
 * perf:render —— M0-05 渲染/主线程成本 PoC。
 * 起本地静态服务器 → headless Chromium → 10k sprite Pixi 场景 →
 * 收集冷启动/帧统计/Worker RTT/structuredClone → 写 artifacts/m0/render-report.json。
 * 本机高性能桌面数据；低配阈值在 M1-06 / Q06 测试机上才判定。
 */
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const dir = fileURLToPath(new URL("..", import.meta.url));
const repo = join(dir, "..", "..");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
};

function serveStatic(rootDir: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const path = req.url === "/" ? "/index.html" : req.url ?? "/";
    const file = join(rootDir, path === "/render-bundle.js" ? "/dist/render-bundle.js" : path);
    try {
      const body = readFileSync(file);
      const ext = "." + (file.split(".").pop() ?? "");
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

test.setTimeout(120_000);
// Headless shell 默认 SwiftShader（软光栅，10k sprite 会拖到分钟级）；
// --enable-gpu 让 headless Chromium 走真实 GPU 合成，数值才有参考意义。
test.use({ launchOptions: { args: ["--enable-gpu"] } });

test("render perf: 10k sprites cold start + frames + worker rtt", async ({ page }) => {
  const { server, port } = await serveStatic(dir);
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(
      () => (globalThis as Record<string, unknown>)["__renderStats"] !== undefined
          || (globalThis as Record<string, unknown>)["__renderError"] !== undefined,
      { timeout: 90_000 },
    );
    const error = await page.evaluate(() => (globalThis as Record<string, unknown>)["__renderError"]);
    expect(error).toBeUndefined();
    const stats = await page.evaluate(() => (globalThis as Record<string, unknown>)["__renderStats"]);

    const report = {
      task: "M0-05 render PoC",
      executedAt: new Date().toISOString(),
      scene: "pixi.js 8.21.0, 10000 procedural sprites (8x8 generated texture), 1280x720, headless chromium",
      stats,
      note: "桌面 headless 实测；不构成低配阈值结论（performance-plan P-01/P-02 由 M1-06 + 低配机判定）",
    };
    mkdirSync(join(repo, "artifacts", "m0"), { recursive: true });
    writeFileSync(join(repo, "artifacts", "m0", "render-report.json"), JSON.stringify(report, null, 2));

    const s = stats as { spriteCount: number; frames: { count: number; fpsMean: number }; workerRoundTrip: { meanMs: number } };
    expect(s.spriteCount).toBe(10_000);
    expect(s.frames.count).toBeGreaterThanOrEqual(240);
    expect(s.frames.fpsMean).toBeGreaterThan(5); // sanity: actually rendered
    expect(s.workerRoundTrip.meanMs).toBeLessThan(50);
  } finally {
    server.close();
  }
});
