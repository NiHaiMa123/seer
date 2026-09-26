/** Bundles the Pixi render PoC for perf:render. */
import { mkdirSync } from "node:fs";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "experiments", "render", "dist");
mkdirSync(outDir, { recursive: true });
buildSync({
  entryPoints: [join(root, "experiments", "render", "src", "main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: join(outDir, "render-bundle.js"),
});
console.log("render-bundle.js written");
