// TEMP (UI work only): engine is mid-refactor (plans/target-route.md). In memory only:
//  - apps/server/src/index.ts: skip packs that still fail to load
//  - battle-core loader: per-move load errors warn instead of throw (half-migrated moves)
// Run: node --require ./tools/_ui-dev-preload.cjs --import ./tools/_ui-dev-register.mjs apps/server/src/index.ts 8787
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
let lax = 0;
export async function load(url, ctx, next) {
  const r = await next(url, ctx);
  if (/apps\\/server\\/src\\/index\\.ts$/.test(url)) {
    let src = String(r.source);
    const a = '.map((id) => [id, loadPackFromDir(join(ROOT, "content"), id)]),';
    const b = '.flatMap((id) => { try { return [[id, loadPackFromDir(join(ROOT, "content"), id)]]; } catch (e) { console.warn("[ui-dev] skip pack " + id + ": " + String(e && e.message).slice(0, 140)); return []; } }),';
    if (src.includes(a)) src = src.replace(a, b); else console.warn("[ui-dev] index.ts pattern not found");
    return { ...r, source: src };
  }
  if (/battle-core\\/src\\/loader\\.ts$/.test(url)) {
    let src = String(r.source);
    const a = "function fail(msg: string): never {\\n  throw new PackLoadError(msg);";
    const b = "function fail(msg: string): never {\\n  if (/^move /.test(msg)) { globalThis.__uiLax = (globalThis.__uiLax || 0) + 1; return undefined as never; }\\n  throw new PackLoadError(msg);";
    const s2 = src.replace(/\\r\\n/g, "\\n");
    if (s2.includes(a)) src = s2.replace(a, b); else console.warn("[ui-dev] loader fail() pattern not found");
    return { ...r, source: src };
  }
  return r;
}`));
