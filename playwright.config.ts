import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  use: { browserName: "chromium" },
  workers: 1,
});
