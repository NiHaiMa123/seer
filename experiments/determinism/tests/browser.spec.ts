/**
 * Node↔Chromium 字节一致 gate（M0-04）：
 * 同一份 esbuild bundle 在 Chromium 里跑 runDeterministicPayload，
 * 输出 canonical 字符串与 sha256 必须与 Node 侧逐字节相同。
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runDeterministicPayload } from "../src/browser-entry.ts";

const dir = fileURLToPath(new URL("..", import.meta.url));

const SEEDS = [
  "0123456789abcdef0123456789abcdef",
  "ffffffffffffffffffffffffffffffff",
  "00000000000000000000000000000001",
];

test("Chromium produces byte-identical canonical output and hash", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ path: join(dir, "dist", "det-bundle.js") });
  for (const seed of SEEDS) {
    const browser = await page.evaluate(
      (s) =>
        (globalThis as { __det: { runDeterministicPayload: (x: string, n: number) => { canonical: string; hash: string } } }).__det.runDeterministicPayload(
          s,
          4,
        ),
      seed,
    );
    const node = runDeterministicPayload(seed, 4);
    expect(browser.canonical).toBe(node.canonical);
    expect(browser.hash).toBe(node.hash);
  }
});
