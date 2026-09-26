import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "experiments/determinism/tests",
  testMatch: /\.spec\.ts$/,
  use: { browserName: "chromium" },
  workers: 1,
});
