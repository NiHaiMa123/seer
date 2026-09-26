/**
 * build:client —— esbuild 打包 apps/client/src/main.tsx → apps/client/dist/client.js
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "apps", "client", "dist");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, "apps", "client", "src", "main.tsx")],
  bundle: true,
  outfile: join(OUT, "client.js"),
  format: "esm",
  jsx: "automatic",
  platform: "browser",
  sourcemap: true,
  loader: { ".ts": "ts", ".tsx": "tsx" },
});
console.log("client.js built →", join(OUT, "client.js"));
