/**
 * contracts:gen — 从 JSON Schema 真源生成 TS 类型并内嵌 schema 常量。
 *
 *   node tools/gen-contract-types.ts           生成到 packages/contracts/src/generated/
 *   node tools/gen-contract-types.ts --check   只比对，不一致则 exit 1（防漂移）
 */
import { compile } from "json-schema-to-typescript";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = fileURLToPath(new URL("../packages/contracts", import.meta.url));
const SCHEMAS_DIR = join(PKG_ROOT, "schemas");
const OUT_DIR = join(PKG_ROOT, "src", "generated");
const SCOPES = ["public", "internal"] as const;

const TYPE_NAMES: Record<string, string> = {
  command: "Command",
  observation: "Observation",
  event: "BattleEvent",
  manifest: "PluginManifest",
  effect: "EffectDefinition",
  tool: "ToolRequest",
  error: "ApiError",
  state: "BattleState",
  "event-internal": "InternalEvent",
  input: "ResolvedInput",
};

const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

async function renderFile(scope: string, file: string): Promise<string> {
  const name = basename(file, ".schema.json");
  const typeName = TYPE_NAMES[name];
  if (!typeName) throw new Error(`no type name mapped for schema "${name}"`);
  const schema = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const types = await compile(schema as never, typeName, {
    bannerComment: "",
    ignoreMinAndMaxItems: true,
    style: { printWidth: 100, singleQuote: false },
  });
  return [
    `// Generated from schemas/${scope}/${name}.schema.json — do not edit; run pnpm contracts:gen.`,
    `export const ${camel(name)}Schema: Record<string, unknown> = ${JSON.stringify(schema, null, 2)};`,
    ``,
    types.trimEnd(),
    ``,
  ].join("\n");
}

async function main(): Promise<number> {
  const checkOnly = process.argv.includes("--check");
  const stale: string[] = [];
  let written = 0;
  for (const scope of SCOPES) {
    const dir = join(SCHEMAS_DIR, scope);
    const outDir = join(OUT_DIR, scope);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".schema.json")).sort()) {
      const out = join(outDir, basename(f, ".schema.json") + ".ts");
      const text = await renderFile(scope, join(dir, f));
      if (checkOnly) {
        if (!existsSync(out) || readFileSync(out, "utf8") !== text) stale.push(out);
      } else {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(out, text);
        written += 1;
      }
    }
  }
  if (checkOnly) {
    for (const s of stale) console.log(`STALE ${s}`);
    console.log(stale.length === 0 ? "contracts:check PASS" : `contracts:check FAIL (${stale.length} stale)`);
    return stale.length === 0 ? 0 : 1;
  }
  console.log(`contracts:gen wrote ${written} files`);
  return 0;
}

process.exit(await main());
