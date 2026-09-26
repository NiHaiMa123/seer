/** Bundles the browser payload for the Node↔Chromium determinism gate. */
import { mkdirSync } from "node:fs";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "experiments", "determinism", "dist");
mkdirSync(outDir, { recursive: true });
buildSync({
  entryPoints: [join(root, "experiments", "determinism", "src", "browser-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: join(outDir, "det-bundle.js"),
});
console.log("det-bundle.js written");
