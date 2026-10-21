/**
 * 机制登记是手写数组，不是扫目录。sixstat 必须在 seals 前面。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { MECHANICS } from "../../../packages/battle-core/src/mechanics/index.ts";

const MECH_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/battle-core/src/mechanics");

describe("MECHANICS registry", () => {
  it("id 不重复，sixstat 在 seals 之前，目录名等于 id", () => {
    const ids = MECHANICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (ids.includes("sixstat") && ids.includes("seals")) {
      expect(ids.indexOf("sixstat")).toBeLessThan(ids.indexOf("seals"));
    }
    const dirs = readdirSync(MECH_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect([...ids].sort()).toEqual(dirs);
    const source = readFileSync(join(MECH_DIR, "index.ts"), "utf8");
    // 类型转导出也会造成删除时的编译依赖，不能因为 bundler 擦除类型而漏检。
    expect([...source.matchAll(/^export (?:type )?\{[^}]*\} from "\.\/([^"/]+)\/index\.ts";/gm)]).toEqual([]);
  });

  // 在内存中删模块和注册项，真实链接消费者，防止专用 export/import 再漏出边界。
  it.each(MECHANICS.map((m) => m.id))("移除 %s 后 core/agent/server 仍可链接", async (id) => {
    const root = join(MECH_DIR, "../../../..");
    const registry = join(MECH_DIR, "index.ts");
    const source = readFileSync(registry, "utf8");
    const pattern = new RegExp(`^import \\{ (\\w+) \\} from "\\./${id}/index\\.ts";\\r?\\n`, "m");
    const binding = source.match(pattern)?.[1];
    expect(binding).toBeDefined();
    const without = source.replace(pattern, "").replace(new RegExp(`\\b${binding}\\b,?\\s*`, "g"), "");
    await build({
      absWorkingDir: root,
      entryPoints: ["packages/battle-core/src/index.ts", "packages/agent/src/index.ts", "apps/server/src/index.ts"],
      outdir: "unused", bundle: true, write: false, platform: "node", format: "esm", packages: "external", logLevel: "silent",
      plugins: [{ name: "remove-mechanic", setup(b) {
        b.onResolve({ filter: /^@seer\/battle-core$/ }, () => ({ path: join(root, "packages/battle-core/src/index.ts") }));
        b.onResolve({ filter: new RegExp(`[/\\\\]${id}[/\\\\]`) }, (args) => {
          throw new Error(`dependency on removed mechanic: ${args.path}`);
        });
        b.onLoad({ filter: /mechanics[/\\]index\.ts$/ }, () => ({ contents: without, loader: "ts", resolveDir: MECH_DIR }));
      } }],
    });
  });
});
