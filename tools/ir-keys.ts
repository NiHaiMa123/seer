/**
 * 编译器发出的 IR 必须落在已经封住的清单里。
 * 效果键来自 CompiledEffect 的对应分支加信封，不在这里另抄一份。
 * 招式旗标是另一张短表：清单外的旗标和插错规则顺序一样，检查失败。
 * 不搬 order.mjs，也不把战斗核心接进 Cordis。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 编译器可以留在 flags 上的键。attachDamage 的内部键另由 ATTACH_DAMAGE_KEYS 管。 */
export const MOVE_FLAG_KEYS: readonly string[] = [
  "accuracy",
  "attachDamage",
  "hitIf",
  "ignoreFoePrioPos",
  "ignoreFoeSpeed",
  "ppFreeIf",
  "prioPerFoeLowPp",
  "prioPerUse",
  "priority",
  "priorityIf",
  "priorityMin",
  "priorityMinIf",
  "targetScope",
  "targets",
];

const MOVE_FLAG_SET: ReadonlySet<string> = new Set(MOVE_FLAG_KEYS);

const NESTED_EFFECTS = ["payload", "ops", "elseOps"] as const;

export interface IrKeyHit {
  path: string;
  key: string;
}

export interface IrAllow {
  /** op → 该分支自己的字段（含 op）。信封另给。 */
  ops: ReadonlyMap<string, ReadonlySet<string>>;
  envelope: ReadonlySet<string>;
  hookKeys: ReadonlySet<string>;
  flagOpKeys: ReadonlySet<string>;
}

function typeBlock(src: string, name: string): string {
  const needle = name === "CompiledEffect" ? "export type CompiledEffect"
    : name === "EffectEnvelope" ? "interface EffectEnvelope"
    : name === "SoulHookOp" ? "export interface SoulHookOp"
    : name === "SoulFlagOp" ? "export interface SoulFlagOp"
    : `export type ${name}`;
  const start = src.indexOf(needle);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const m = /\nexport |\ninterface [A-Z]/.exec(rest);
  return src.slice(start, m === null ? undefined : start + 1 + m.index);
}

/** 与 schema-sync-check 同一套剥法：嵌套对象去掉，只留顶层字段名。 */
function topKeys(memberBody: string, stripOuter = false): Set<string> {
  let s = memberBody.replace(/\/\*\*[\s\S]*?\*\//g, "");
  if (stripOuter) s = s.slice(s.indexOf("{") + 1);
  for (let i = 0; i < 24 && /{[^{}]*}/.test(s); i++) s = s.replace(/{[^{}]*}/g, "");
  const out = new Set<string>();
  for (const m of s.matchAll(/([a-zA-Z_]\w*)\s*\?*:/g)) out.add(m[1]!);
  return out;
}

export function irAllowFromSources(loaderSrc: string, soulSrc: string): IrAllow {
  const ce = typeBlock(loaderSrc, "CompiledEffect").replace(/\/\*\*[\s\S]*?\*\//g, "");
  const ops = new Map<string, Set<string>>();
  for (const part of ce.split(/\n\s*\|\s*\{/).slice(1)) {
    const om = /op:\s*"(\w+)"/.exec(part);
    if (om?.[1] !== undefined) ops.set(om[1], topKeys(part));
  }
  return {
    ops,
    envelope: topKeys(typeBlock(loaderSrc, "EffectEnvelope"), true),
    hookKeys: topKeys(typeBlock(soulSrc, "SoulHookOp"), true),
    flagOpKeys: topKeys(typeBlock(soulSrc, "SoulFlagOp"), true),
  };
}

export function loadIrAllow(root = ROOT): IrAllow {
  return irAllowFromSources(
    readFileSync(join(root, "packages/battle-core/src/loader.ts"), "utf8"),
    readFileSync(join(root, "packages/battle-core/src/mechanics/soulmark/index.ts"), "utf8"),
  );
}

/** flags 上不属于招式旗标清单的键。 */
export function flagKeyHits(flags: object, allow: ReadonlySet<string> = MOVE_FLAG_SET): string[] {
  return Object.keys(flags).filter((k) => !allow.has(k));
}

/**
 * 每条效果上不属于该 op 分支、也不属于信封的键。
 * 未知 op 不在这里报（编译检查另有 UNKNOWN_OP）。
 */
export function effectKeyHits(
  nodes: readonly unknown[] | undefined,
  allow: IrAllow,
  path = "effects",
): IrKeyHit[] {
  const out: IrKeyHit[] = [];
  const walk = (list: readonly unknown[] | undefined, p: string): void => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i];
      if (fx === null || typeof fx !== "object") continue;
      const rec = fx as Record<string, unknown>;
      const here = `${p}[${i}]`;
      const op = rec.op;
      if (typeof op === "string") {
        const member = allow.ops.get(op);
        if (member !== undefined) {
          for (const k of Object.keys(rec)) {
            if (!member.has(k) && !allow.envelope.has(k)) out.push({ path: here, key: k });
          }
        }
      }
      for (const nest of NESTED_EFFECTS) {
        const child = rec[nest];
        if (Array.isArray(child)) walk(child, `${here}.${nest}`);
      }
    }
  };
  walk(nodes, path);
  return out;
}

/** 魂印条目：hook 用 SoulHookOp，flag 用 SoulFlagOp。ops 里的效果另走 effectKeyHits。 */
export function soulEntryKeyHits(
  entries: readonly unknown[] | undefined,
  allow: IrAllow,
  path = "effects",
): IrKeyHit[] {
  const out: IrKeyHit[] = [];
  if (!Array.isArray(entries)) return out;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === null || typeof e !== "object") continue;
    const rec = e as Record<string, unknown>;
    const here = `${path}[${i}]`;
    const keys = typeof rec.hook === "string" ? allow.hookKeys : typeof rec.op === "string" ? allow.flagOpKeys : undefined;
    if (keys === undefined) {
      out.push({ path: here, key: "shape" });
      continue;
    }
    for (const k of Object.keys(rec)) {
      if (!keys.has(k)) out.push({ path: here, key: k });
    }
  }
  return out;
}
