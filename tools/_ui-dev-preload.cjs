// TEMP (UI work only): peak pack is mid-refactor (target-route.md); loader rejects some move fields.
// Strip those keys in memory so the demo server boots. Does not touch content/ or the loader.
// Source patches (loader fail() lax + per-pack skip) are applied at readFileSync level too,
// because Playwright loads spec deps through its own transform, bypassing ESM load hooks.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const STRIP = new Set((process.env.UI_DEV_STRIP ?? "targetScope,targets").split(",").filter(Boolean));
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  const out = orig.call(this, p, ...rest);
  if (typeof p === "string" && /battle-core[\\/]src[\\/]loader\.ts$/.test(p)) {
    // per-move load errors warn instead of throw（半成品迁移的招式不再拖垮整个包）
    let s = out.toString("utf8");
    const a = /function fail\(msg: string\): never \{\r?\n\s*throw new PackLoadError\(msg\);/;
    if (a.test(s)) {
      s = s.replace(a, "function fail(msg: string): never {\n  if (/^move /.test(msg)) { globalThis.__uiLax = (globalThis.__uiLax || 0) + 1; return undefined as never; }\n  throw new PackLoadError(msg);");
      return typeof out === "string" ? s : Buffer.from(s);
    }
    return out;
  }
  if (typeof p === "string" && /apps[\\/]server[\\/]src[\\/]index\.ts$/.test(p)) {
    // 加载失败的包跳过而不是整站崩溃
    let s = out.toString("utf8");
    const a = '.map((id) => [id, loadPackFromDir(join(ROOT, "content"), id)]),';
    const b = '.flatMap((id) => { try { return [[id, loadPackFromDir(join(ROOT, "content"), id)]]; } catch (e) { console.warn("[ui-dev] skip pack " + id + ": " + String(e && e.message).slice(0, 140)); return []; } }),';
    if (s.includes(a)) {
      s = s.replace(a, b);
      return typeof out === "string" ? s : Buffer.from(s);
    }
    return out;
  }
  if (typeof p === "string" && /[\\/]peak[\\/]moves\.json$/.test(p)) {
    const j = JSON.parse(typeof out === "string" ? out : out.toString("utf8"));
    const list = Array.isArray(j) ? j : Array.isArray(j.moves) ? j.moves : Object.values(j);
    let n = 0;
    for (const m of list) for (const k of STRIP) if (m && typeof m === "object" && k in m) { delete m[k]; n++; }
    console.log(`[ui-dev-preload] stripped ${[...STRIP].join("/")} (${n} keys) from peak moves`);
    const s = JSON.stringify(j);
    return typeof out === "string" ? s : Buffer.from(s);
  }
  if (typeof p === "string" && /[\\/](peak|synthetic-v2)[\\/]soulmarks\.json$/.test(p) && process.env.UI_DEV_SOUL !== "keep") {
    const j = JSON.parse(typeof out === "string" ? out : out.toString("utf8"));
    const map = j.soulmarks ?? j;
    let n = 0;
    for (const v of Object.values(map)) {
      if (!v || typeof v !== "object" || !Array.isArray(v.effects)) continue;
      const keep = v.effects.filter((e) => e && typeof e.op === "string" && !("hook" in e) && !("guard" in e));
      if (keep.length !== v.effects.length) n++;
      v.effects = keep.length > 0 ? keep : [{ op: "immune_control" }];
    }
    console.log(`[ui-dev-preload] dropped new-shape effects in ${n} soulmarks of ${p.split(/[\\/]/).slice(-2).join("/")}`);
    const s = JSON.stringify(j);
    return typeof out === "string" ? s : Buffer.from(s);
  }
  return out;
};
syncBuiltinESMExports();
