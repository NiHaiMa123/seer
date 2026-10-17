/**
 * EffectDef 旗标必须有结算读取，或者写进 DEFERRED_FLAGS。
 * 动态读取只认两处：effectTickAmount 的 dot/hot，effectMul 的 accMul/atkMul。
 * 不把任意 ?.[key] 当成全部旗标已读。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface FlagScanInput {
  /** effects.ts 全文（接口、动态函数、DEFERRED_FLAGS 都在这里）。 */
  effectsSrc: string;
  /** battle-core 其余源码，用来找 ?.旗标名。 */
  otherSrc: string;
  /** 覆盖从 effectsSrc 解析出的集合。测试负例用。 */
  deferred?: readonly string[];
  /** 覆盖从接口解析出的旗标。测试负例用。 */
  flags?: readonly string[];
}

const SKIP = new Set(["zh"]);

/** 从 export interface EffectDef 抽出字段名。嵌套类型都在同一行，首个换行的 } 即接口结束。 */
export function effectDefFlags(effectsSrc: string): string[] {
  const m = effectsSrc.match(/export interface EffectDef \{([\s\S]*?)\n\}/);
  const body = m?.[1];
  if (body === undefined) throw new Error("EffectDef interface not found");
  const names: string[] = [];
  for (const hit of body.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\??:/gm)) {
    const name = hit[1];
    if (name !== undefined && !SKIP.has(name)) names.push(name);
  }
  return names;
}

function deferredFromSrc(effectsSrc: string): string[] {
  const m = effectsSrc.match(/export const DEFERRED_FLAGS[\s\S]*?new Set(?:<[^>]*>)?\(\[([\s\S]*?)\]\)/);
  const body = m?.[1];
  if (body === undefined) return [];
  const names: string[] = [];
  for (const hit of body.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
    const name = hit[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/**
 * 从 function 名截到下一个顶层 export。
 * 不用第一对花括号：返回类型 `{ ... }` 会把函数体截掉。
 */
function functionSpan(src: string, name: string): string | undefined {
  const at = src.search(new RegExp(`function ${name}\\b`));
  if (at < 0) return undefined;
  const rest = src.slice(at + 1);
  const next = rest.search(/\nexport (?:function|const|class|interface|type) /);
  return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next);
}

/** 只认计划点名的两处动态读取。函数被删或签名变了，对应旗标就不再算已读。 */
export function dynamicReadFlags(effectsSrc: string): Set<string> {
  const out = new Set<string>();
  // 动态 dot 读取在 tickAmountOfEntry（kind:"dot" + ?.[kind]）；hot 已迁移 periodic 无旗标
  const tick = functionSpan(effectsSrc, "tickAmountOfEntry");
  if (tick !== undefined && /kind:\s*"dot"/.test(tick) && tick.includes("?.[kind]")) {
    out.add("dot");
  }
  const mul = functionSpan(effectsSrc, "effectMul");
  if (mul !== undefined && /key:\s*"accMul"\s*\|\s*"atkMul"/.test(mul) && mul.includes("?.[key]")) {
    out.add("accMul");
    out.add("atkMul");
  }
  return out;
}

function staticallyRead(flag: string, text: string): boolean {
  return new RegExp(`\\?\\.${flag}\\b`).test(text);
}

/** 返回还没人读、也不在 DEFERRED_FLAGS 里的旗标名。 */
export function unreadEffectFlags(input: FlagScanInput): string[] {
  const flags = input.flags ?? effectDefFlags(input.effectsSrc);
  const deferred = new Set(input.deferred ?? deferredFromSrc(input.effectsSrc));
  const dynamic = dynamicReadFlags(input.effectsSrc);
  const text = input.effectsSrc + "\n" + input.otherSrc;
  const unread: string[] = [];
  for (const flag of flags) {
    if (deferred.has(flag)) continue;
    if (dynamic.has(flag)) continue;
    if (staticallyRead(flag, text)) continue;
    unread.push(flag);
  }
  return unread;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTs(p, out);
    else if (name.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

export function unreadEffectFlagsFromRepo(root = join(dirname(fileURLToPath(import.meta.url)), "..")): string[] {
  const effectsPath = join(root, "packages/battle-core/src/ops/effects.ts");
  const effectsSrc = readFileSync(effectsPath, "utf8");
  const others = walkTs(join(root, "packages/battle-core/src"))
    .filter((p) => p !== effectsPath)
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  return unreadEffectFlags({ effectsSrc, otherSrc: others });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const unread = unreadEffectFlagsFromRepo();
  if (unread.length === 0) console.log("effect-flags: PASS");
  else {
    console.error(`effect-flags: ${unread.length} 个旗标无人读取且不在 DEFERRED_FLAGS`);
    for (const name of unread) console.error(`  ${name}`);
    process.exitCode = 1;
  }
}
