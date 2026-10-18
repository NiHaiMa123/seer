/**
 * vitest 配置。
 *
 * 仓库里有两套浏览器测试：
 *   - `*.spec.ts` → Playwright（playwright.config.ts 的 testMatch 只认它）
 *   - `*.test.ts` → vitest
 *
 * vitest 默认会把 `*.spec.ts` 也当成测试收集，于是 Playwright 的 `test` 在
 * vitest 里被调用时抛 "Playwright Test did not expect test() to be called here"。
 * 这不是产品 bug，是收集范围重叠 —— 在这里显式排除，让两套 runner 各管各的。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "experiments/**/tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.spec.ts",
    ],
  },
});
