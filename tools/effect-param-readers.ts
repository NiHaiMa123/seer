/**
 * apply_status / apply_effect 的 params 键必须被这个状态名自己的读取点碰到。
 * 表从 battle-core 源码扫出来，不另写一份靠名单放行的总表。
 * 扫不到的键就失败。counter 的 foeMaxN / foeMaxD / flat 只留在 counter 上。
 * 不改结算。解析器若还在发扫不到的键，改发已有的键或留下 unparsedReason，不新造键。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECT_DEFS } from "../packages/battle-core/src/ops/effects.ts";
import { axesFormOf } from "../packages/battle-core/src/ops/axes.ts";
import { periodicFormOf } from "../packages/battle-core/src/ops/periodic.ts";

const NESTED = ["payload", "ops", "elseOps"] as const;

export interface ParamKeyHit {
  path: string;
  key: string;
  name: string;
}

interface Fn {
  name: string;
  sig: string;
  body: string;
  file: string;
}

type Gate =
  | { kind: "slot"; slot: string }
  | { kind: "immune" }
  | { kind: "reflect" }
  | { kind: "react" }
  | { kind: "periodic" }
  | { kind: "dmgShield" };

interface ScanOut {
  /** 有门的读取。 */
  gated: Map<string, Set<string>>;
  /** 整函数没有门时的读取。有门的函数里、门之外的读取丢掉，避免漏给别的名字。 */
  free: Set<string>;
  slots: Set<string>;
  kinds: Set<string>;
}

/** 1=代码，2=字符串，0=注释。槽位名写在字符串里，匹配可以穿过字符串，不能穿过注释。模板里的 ${ } 是代码。 */
function codeMask(src: string): Uint8Array {
  const m = new Uint8Array(src.length);
  let i = 0;
  const mode: { k: "code" | "sq" | "dq" | "tpl"; br: number }[] = [{ k: "code", br: 0 }];
  while (i < src.length) {
    const top = mode[mode.length - 1]!;
    const c = src[i]!;
    const n = src[i + 1];
    if (top.k === "sq" || top.k === "dq" || top.k === "tpl") {
      if (c === "\\") { m[i] = 2; if (i + 1 < src.length) m[i + 1] = 2; i += 2; continue; }
      if (top.k === "sq" && c === "'") { m[i] = 2; mode.pop(); i++; continue; }
      if (top.k === "dq" && c === '"') { m[i] = 2; mode.pop(); i++; continue; }
      if (top.k === "tpl" && c === "`") { m[i] = 2; mode.pop(); i++; continue; }
      if (top.k === "tpl" && c === "$" && n === "{") {
        m[i] = 2;
        m[i + 1] = 1;
        mode.push({ k: "code", br: 1 });
        i += 2;
        continue;
      }
      m[i] = 2;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'") { m[i] = 2; mode.push({ k: "sq", br: 0 }); i++; continue; }
    if (c === '"') { m[i] = 2; mode.push({ k: "dq", br: 0 }); i++; continue; }
    if (c === "`") { m[i] = 2; mode.push({ k: "tpl", br: 0 }); i++; continue; }
    if (c === "{") {
      m[i] = 1;
      if (top.br > 0) top.br++;
      i++;
      continue;
    }
    if (c === "}" && top.br > 0) {
      m[i] = 1;
      top.br--;
      i++;
      if (top.br === 0) mode.pop();
      continue;
    }
    m[i] = 1;
    i++;
  }
  return m;
}

function isCodeSpan(mask: Uint8Array, start: number, len: number): boolean {
  if (mask[start] !== 1) return false;
  for (let i = start; i < start + len && i < mask.length; i++) if (mask[i] === 0) return false;
  return true;
}

function skipSpace(src: string, i: number, mask: Uint8Array): number {
  while (i < src.length && (mask[i] !== 1 || /\s/.test(src[i]!))) i++;
  return i;
}

function skipBrackets(src: string, i: number, mask: Uint8Array, open: string): number {
  const closeOf: Record<string, string> = { "(": ")", "{": "}", "[": "]", "<": ">" };
  const stack = [closeOf[open]!];
  i++;
  while (i < src.length && stack.length > 0) {
    if (mask[i] !== 1) { i++; continue; }
    const c = src[i]!;
    // 只有紧贴标识符的 < 是泛型。<<、<= 和比较式不算括号，否则函数体对不齐。
    if (c === "<") {
      const prev = src[i - 1];
      const next = src[i + 1];
      if (prev !== undefined && /[A-Za-z0-9_$]/.test(prev) && next !== "<" && next !== "=") stack.push(">");
    } else if (c === "(" || c === "{" || c === "[") stack.push(closeOf[c]!);
    else if (c === ")" || c === "}" || c === "]" || c === ">") {
      if (c === stack[stack.length - 1]) stack.pop();
    }
    i++;
  }
  return i;
}

interface BodyRange { sig: string; bodyStart: number; bodyEnd: number }

/** 函数体。返回类型里的 `{ ... }` 不算函数体。箭头没有花括号时收到分号为止。 */
function bodyAfterParams(src: string, i: number, mask: Uint8Array, arrow: boolean): BodyRange | undefined {
  i = skipSpace(src, i, mask);
  if (arrow) {
    if (src[i] === "(") i = skipBrackets(src, i, mask, "(");
    else while (i < src.length && mask[i] === 1 && /[A-Za-z0-9_]/.test(src[i]!)) i++;
    i = skipSpace(src, i, mask);
  }
  let sawType = false;
  let balanced = false;
  let depth = 0;
  if (!arrow && i < src.length && src[i] === ":") {
    i++;
    while (i < src.length) {
      if (mask[i] !== 1) { i++; continue; }
      const c = src[i]!;
      if (c === "{") {
        if (depth === 0 && (sawType || balanced)) break;
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) balanced = true;
        i++;
        continue;
      }
      if (depth === 0 && /[A-Za-z0-9_|]/.test(c)) sawType = true;
      i++;
    }
    if (i >= src.length || src[i] !== "{") return undefined;
    const bodyStart = i;
    const bodyEnd = skipBrackets(src, i, mask, "{");
    return { sig: src.slice(0, bodyStart), bodyStart, bodyEnd };
  }
  if (arrow) {
    if (i < src.length && src[i] === ":") {
      depth = 0;
      i++;
      while (i < src.length) {
        if (mask[i] !== 1) { i++; continue; }
        const c = src[i]!;
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (depth === 0 && src.startsWith("=>", i)) break;
        i++;
      }
    }
    i = skipSpace(src, i, mask);
    if (!src.startsWith("=>", i)) return undefined;
    i = skipSpace(src, i + 2, mask);
    if (src[i] === "{") {
      const bodyStart = i;
      return { sig: src.slice(0, bodyStart), bodyStart, bodyEnd: skipBrackets(src, i, mask, "{") };
    }
    const bodyStart = i;
    let paren = 0;
    let brace = 0;
    while (i < src.length) {
      if (mask[i] !== 1) { i++; continue; }
      const c = src[i]!;
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === ";" && paren === 0 && brace === 0) { i++; break; }
      i++;
    }
    return { sig: src.slice(0, bodyStart), bodyStart, bodyEnd: i };
  }
  if (src[i] !== "{") return undefined;
  const bodyStart = i;
  return { sig: src.slice(0, bodyStart), bodyStart, bodyEnd: skipBrackets(src, i, mask, "{") };
}

function findFunctions(file: string, src: string): Fn[] {
  const mask = codeMask(src);
  const out: Fn[] = [];
  let i = 0;
  while (i < src.length) {
    if (mask[i] !== 1) { i++; continue; }
    const rest = src.slice(i);
    const fn = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/.exec(rest);
    const cn = fn === null ? /^(?:export\s+)?const\s+([A-Za-z_]\w*)/.exec(rest) : null;
    if (fn === null && cn === null) { i++; continue; }
    const name = (fn?.[1] ?? cn?.[1])!;
    if (fn !== null) {
      let j = i + fn[0].length;
      j = skipSpace(src, j, mask);
      if (src[j] === "<") j = skipBrackets(src, j, mask, "<");
      j = skipSpace(src, j, mask);
      if (src[j] !== "(") { i++; continue; }
      const after = skipBrackets(src, j, mask, "(");
      const body = bodyAfterParams(src, after, mask, false);
      if (body === undefined) { i++; continue; }
      out.push({
        name,
        sig: src.slice(i, body.bodyStart),
        body: src.slice(body.bodyStart, body.bodyEnd),
        file,
      });
      i = body.bodyEnd;
      continue;
    }
    // const name ... = arrow | object
    let j = i + cn![0].length;
    let depth = 0;
    while (j < src.length) {
      if (mask[j] !== 1) { j++; continue; }
      const c = src[j]!;
      if (c === "(" || c === "{" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "}" || c === "]" || c === ">") depth--;
      else if (c === "=" && depth === 0 && src[j + 1] !== "=" && src[j - 1] !== "=" && src[j - 1] !== "!" && src[j - 1] !== "<" && src[j - 1] !== ">") break;
      j++;
    }
    if (src[j] !== "=") { i++; continue; }
    j = skipSpace(src, j + 1, mask);
    if (src[j] === "{") { i++; continue; }
    const arrow = bodyAfterParams(src, j, mask, true);
    if (arrow === undefined) { i++; continue; }
    out.push({
      name,
      sig: src.slice(i, arrow.bodyStart),
      body: src.slice(arrow.bodyStart, arrow.bodyEnd),
      file,
    });
    i = arrow.bodyEnd;
  }
  return out;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTs(p, out);
    else if (name.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Ev { at: number; pri: number; run: (s: Walker) => void }

interface Frame { gates: Gate[]; pAlias: boolean; bind: Map<string, Gate> }

class Walker {
  paren = 0;
  pending: Gate[] = [];
  stack: Frame[] = [{ gates: [], pAlias: false, bind: new Map() }];
  body: string;
  mask: Uint8Array;
  pRanges: readonly (readonly [number, number])[];
  donors: ReadonlyMap<string, ReadonlySet<string>>;
  slotOf: ReadonlyMap<string, string>;
  out: ScanOut;
  sink: boolean;
  constructor(
    body: string,
    mask: Uint8Array,
    pRanges: readonly (readonly [number, number])[],
    donors: ReadonlyMap<string, ReadonlySet<string>>,
    slotOf: ReadonlyMap<string, string>,
    out: ScanOut,
    sink: boolean,
  ) {
    this.body = body;
    this.mask = mask;
    this.pRanges = pRanges;
    this.donors = donors;
    this.slotOf = slotOf;
    this.out = out;
    this.sink = sink;
  }

  frame(): Frame { return this.stack[this.stack.length - 1]!; }

  pOn(at: number): boolean {
    if (this.frame().pAlias) return true;
    return this.pRanges.some(([a, b]) => at >= a && at < b);
  }

  active(): Gate[] {
    return this.pending.length > 0 ? this.pending : this.frame().gates;
  }

  addGate(g: Gate): void {
    const key = g.kind === "slot" ? `slot:${g.slot}` : g.kind;
    const has = this.pending.some((x) => (x.kind === "slot" ? `slot:${x.slot}` : x.kind) === key);
    if (!has) this.pending.push(g);
  }

  note(gates: readonly Gate[], key: string): void {
    if (!this.sink) {
      if (gates.length === 0) this.out.free.add(key);
      return;
    }
    for (const g of gates) {
      const id = g.kind === "slot" ? `slot:${g.slot}` : g.kind;
      let set = this.out.gated.get(id);
      if (set === undefined) this.out.gated.set(id, set = new Set());
      set.add(key);
    }
  }

  read(at: number, key: string, recv?: string): void {
    if (recv !== undefined) {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        const g = this.stack[i]!.bind.get(recv);
        if (g !== undefined) { this.note([g], key); return; }
      }
    }
    const gates = this.active();
    if (gates.length === 0) {
      if (!this.sink) this.out.free.add(key);
      return;
    }
    this.note(gates, key);
  }
}

function scanFn(fn: Fn, donors: ReadonlyMap<string, ReadonlySet<string>>, slotOf: ReadonlyMap<string, string>, sink: boolean): ScanOut {
  const body = fn.body;
  const mask = codeMask(body);
  const out: ScanOut = { gated: new Map(), free: new Set(), slots: new Set(), kinds: new Set() };
  const sigAlias = /\bp\s*:\s*(?:P|Record)\b/.test(fn.sig);
  const pRanges: (readonly [number, number])[] = [];
  if (sigAlias) pRanges.push([0, body.length]);
  // const/let p = ...params 只在它所在的块里算别名
  {
    let depth = 0;
    const depths: number[] = [];
    for (let i = 0; i < body.length; i++) {
      if (mask[i] !== 1) continue;
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
      depths[i] = depth;
    }
    for (const m of body.matchAll(/\b(?:const|let)\s+p\s*=/g)) {
      const at = m.index ?? 0;
      if (mask[at] !== 1) continue;
      const semi = body.indexOf(";", at);
      const stmt = body.slice(at, semi === -1 ? body.length : semi);
      if (!/\bparams\b|\bP\s*\(/.test(stmt)) continue;
      const d = depths[at] ?? 0;
      let end = body.length;
      for (let i = at; i < body.length; i++) {
        if (mask[i] !== 1) continue;
        if ((depths[i] ?? 0) < d) { end = i; break; }
      }
      pRanges.push([at, end]);
    }
  }
  const w = new Walker(body, mask, pRanges, donors, slotOf, out, sink);
  const ev: Ev[] = [];
  const push = (re: RegExp, pri: number, run: (m: RegExpMatchArray, s: Walker) => void) => {
    for (const m of body.matchAll(re)) {
      const at = m.index ?? 0;
      if (!isCodeSpan(mask, at, m[0].length)) continue;
      ev.push({ at, pri, run: (s) => run(m, s) });
    }
  };
  push(/(?:isMod|modsAt)\s*\(\s*[^,)]*\s*,\s*["']([A-Za-z_]\w*)["']/g, 1, (m, s) => {
    const slot = m[1]!;
    s.out.slots.add(slot);
    s.addGate({ kind: "slot", slot });
  });
  push(/(?:\.kind|\bkind)\s*(?:===|!==)\s*["'](immune|reflect|react|periodic|shield|ward)["']/g, 1, (m, s) => {
    const k = m[1]!;
    s.out.kinds.add(k);
    if (k === "shield" || k === "ward") s.addGate({ kind: "dmgShield" });
    else s.addGate({ kind: k as "immune" | "reflect" | "react" | "periodic" });
  });
  push(/\bisDmgImmune\s*\(/g, 1, (_m, s) => {
    s.out.kinds.add("immune");
    s.addGate({ kind: "immune" });
  });
  push(/effectDefOf\s*\([^)]*\)\s*\?\.\s*dmgShield|\.dmgShield\s*(?:===|!==)/g, 1, (_m, s) => {
    s.out.kinds.add("dmgShield");
    s.addGate({ kind: "dmgShield" });
  });
  push(/for\s*\(\s*const\s+(?:\[[^\]]+\]|[A-Za-z_]\w*)\s+of\s+([A-Za-z_]\w*)\s*\(/g, 0, (m, s) => {
    const slot = s.slotOf.get(m[1]!);
    if (slot !== undefined) s.addGate({ kind: "slot", slot });
  });
  push(/\bconst\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(/g, 0, (m, s) => {
    const slot = s.slotOf.get(m[2]!);
    if (slot !== undefined) s.frame().bind.set(m[1]!, { kind: "slot", slot });
  });
  // ident.params。前面还有 .ident 的（igDef.fx.params）交给下一条，避免把 fx 当成接收者。
  push(/(?<![.\w])([A-Za-z_]\w*)\s*\??\.\s*params\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 2, (m, s) => {
    s.read(m.index ?? 0, m[2]!, m[1]!);
  });
  push(/(?<![.\w])([A-Za-z_]\w*)(?:\s*\.\s*[A-Za-z_]\w*)+\s*\??\.\s*params\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 2, (m, s) => {
    s.read(m.index ?? 0, m[2]!, m[1]!);
  });
  // find(... isMod ...)?.params.key 的接收者不是标识符，键算在同一句还没提交的门上。
  push(/[)\]]\s*\??\.\s*params\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 2, (m, s) => {
    s.read(m.index ?? 0, m[1]!);
  });
  push(/(?<![.\w])params(?![A-Za-z0-9_])\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 2, (m, s) => {
    s.read(m.index ?? 0, m[1]!);
  });
  push(/(?<![A-Za-z0-9_])p\s*\??\.\s*([A-Za-z_]\w*)/g, 2, (m, s) => {
    if (!s.pOn(m.index ?? 0)) return;
    const key = m[1]!;
    if (key === "params") return;
    s.read(m.index ?? 0, key);
  });
  push(/\b([A-Za-z_]\w*)\s*\(/g, 3, (m, s) => {
    const name = m[1]!;
    const extra = s.donors.get(name);
    if (extra === undefined) return;
    const gates = s.active();
    if (gates.length === 0) return;
    for (const key of extra) s.note(gates, key);
  });
  ev.sort((a, b) => a.at - b.at || a.pri - b.pri);
  let ei = 0;
  for (let i = 0; i < body.length; i++) {
    while (ei < ev.length && ev[ei]!.at === i) {
      ev[ei]!.run(w);
      ei++;
    }
    if (mask[i] !== 1) continue;
    const c = body[i]!;
    if (c === "(") w.paren++;
    else if (c === ")") w.paren = Math.max(0, w.paren - 1);
    else if (c === "{") {
      const gates = w.pending.length > 0 ? w.pending.slice() : w.frame().gates.slice();
      const bind = new Map(w.frame().bind);
      w.stack.push({ gates, pAlias: w.frame().pAlias, bind });
      w.pending = [];
    } else if (c === "}" && w.stack.length > 1) {
      w.stack.pop();
      w.pending = [];
    } else if (c === ";" && w.paren === 0) {
      if (w.pending.length > 0) w.frame().gates = w.pending.slice();
      w.pending = [];
    }
  }
  return out;
}

function keysIn(src: string, pAlias: boolean): Set<string> {
  const mask = codeMask(src);
  const out = new Set<string>();
  const take = (re: RegExp, group: number, guard?: (m: RegExpMatchArray) => boolean) => {
    for (const m of src.matchAll(re)) {
      const at = m.index ?? 0;
      if (!isCodeSpan(mask, at, m[0].length)) continue;
      if (guard !== undefined && !guard(m)) continue;
      out.add(m[group]!);
    }
  };
  take(/(?<![.\w])params(?![A-Za-z0-9_])\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 1);
  take(/\b([A-Za-z_]\w*)\s*\??\.\s*params\s*!?\s*\??\.\s*([A-Za-z_]\w*)/g, 2);
  if (pAlias) take(/(?<![A-Za-z0-9_])p\s*\??\.\s*([A-Za-z_]\w*)/g, 1, (m) => m[1] !== "params");
  return out;
}

function hpPrefixes(sig: string): string[] {
  return [...sig.matchAll(/"([A-Za-z]\w*)"/g)].map((m) => m[1]!).filter((s) => s.length > 0);
}

function helperKeys(fns: readonly Fn[], name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const fn = fns.find((f) => f.name === name);
  if (fn === undefined) return new Set();
  const alias = /\bp\s*:\s*(?:P|Record)\b/.test(fn.sig) || /\b(?:const|let)\s+p\s*=/.test(fn.body);
  const keys = keysIn(fn.sig + fn.body, alias);
  for (const pre of name === "hpGate" ? hpPrefixes(fn.sig) : []) {
    keys.add(`${pre}N`);
    keys.add(`${pre}D`);
  }
  for (const m of fn.body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const callee = m[1]!;
    if (callee === name) continue;
    if (!fns.some((f) => f.name === callee)) continue;
    for (const k of helperKeys(fns, callee, seen)) keys.add(k);
  }
  return keys;
}

function periodicCases(fn: Fn, helpers: readonly Fn[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const sw = /switch\s*\(\s*fx\.name\s*\)/.exec(fn.body);
  if (sw === null || sw.index === undefined) return out;
  const open = fn.body.indexOf("{", sw.index);
  if (open < 0) return out;
  const mask = codeMask(fn.body);
  const end = skipBrackets(fn.body, open, mask, "{");
  const text = fn.body.slice(open + 1, end - 1);
  const parts = [...text.matchAll(/\bcase\s+"([A-Za-z_]\w*)"\s*:/g)];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const name = part[1]!;
    const from = (part.index ?? 0) + part[0].length;
    const to = i + 1 < parts.length ? (parts[i + 1]!.index ?? text.length) : text.length;
    let body = text.slice(from, to);
    const def = /\bdefault\s*:/.exec(body);
    if (def !== null && def.index !== undefined) body = body.slice(0, def.index);
    // 落到下一个 case 且自己没有 return：键算在后面那个 case 的身体上，这里先记下空，下面再补
    if (!/\breturn\b|\bbase\s*\(/.test(body)) {
      out.set(name, new Set());
      continue;
    }
    const keys = keysIn(body, true);
    const called = new Set<string>();
    for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) called.add(m[1]!);
    for (const c of called) for (const k of helperKeys(helpers, c)) keys.add(k);
    // 穿透的 case 共用这段身体
    const share = [name];
    for (let j = i - 1; j >= 0; j--) {
      const prev = parts[j]![1]!;
      const prevKeys = out.get(prev);
      if (prevKeys === undefined || prevKeys.size > 0) break;
      const prevBody = text.slice((parts[j]!.index ?? 0) + parts[j]![0].length, parts[j + 1]!.index ?? 0);
      if (/\breturn\b|\bbase\s*\(/.test(prevBody)) break;
      share.push(prev);
    }
    for (const n of share) out.set(n, new Set(keys));
  }
  return out;
}

function bakeKeys(src: string): Set<string> {
  const mask = codeMask(src);
  const out = new Set<string>();
  for (const re of [/\bfxParams\s*\??\.\s*([A-Za-z_]\w*)/g, /\bparams0\s*\??\.\s*([A-Za-z_]\w*)/g]) {
    for (const m of src.matchAll(re)) {
      const at = m.index ?? 0;
      if (!isCodeSpan(mask, at, m[0].length)) continue;
      const key = m[1]!;
      // flat 只在 perStage / flatPerBench 分支里被碰到，槽位自己读 flat 的才留。
      if (key === "flat") continue;
      out.add(key);
    }
  }
  return out;
}

function addAll(into: Set<string>, keys: Iterable<string> | undefined): void {
  if (keys === undefined) return;
  for (const k of keys) into.add(k);
}

export interface ParamScan {
  byName: Map<string, Set<string>>;
}

export function paramScanFromSources(files: readonly { file: string; src: string }[]): ParamScan {
  const fns: Fn[] = [];
  for (const f of files) fns.push(...findFunctions(f.file, f.src));
  const slotOf = new Map<string, string>();
  const donors = new Map<string, Set<string>>();
  // 第一遍：谁是单槽函数，谁是没有门的读取函数
  const first = new Map<string, ScanOut>();
  for (const fn of fns) first.set(`${fn.file}:${fn.name}`, scanFn(fn, new Map(), new Map(), false));
  for (const fn of fns) {
    const got = first.get(`${fn.file}:${fn.name}`)!;
    if (got.slots.size === 1 && got.kinds.size === 0) slotOf.set(fn.name, [...got.slots][0]!);
  }
  for (const fn of fns) {
    const got = first.get(`${fn.file}:${fn.name}`)!;
    if (got.slots.size === 0 && got.kinds.size === 0 && got.free.size > 0 && !fn.body.includes("effectDefOf(e.kind)")) {
      donors.set(fn.name, got.free);
    }
  }
  const gated = new Map<string, Set<string>>();
  const merge = (id: string, keys: Iterable<string>) => {
    let set = gated.get(id);
    if (set === undefined) gated.set(id, set = new Set());
    for (const k of keys) set.add(k);
  };
  for (const fn of fns) {
    const got = scanFn(fn, donors, slotOf, true);
    for (const [id, keys] of got.gated) merge(id, keys);
  }
  // mech: 引用不带括号，读取在被引用的函数里
  for (const fn of fns) {
    for (const kind of ["react", "periodic"] as const) {
      if (!fn.body.includes(`kind === "${kind}"`) || !fn.body.includes("mech:")) continue;
      for (const m of fn.body.matchAll(/mech\s*:\s*([A-Za-z_]\w*)/g)) {
        const donor = fns.find((f) => f.name === m[1]!);
        if (donor === undefined) continue;
        const keys = first.get(`${donor.file}:${donor.name}`)?.free ?? new Set<string>();
        merge(kind, keys);
      }
    }
  }
  const periodicFns = fns.filter((f) => f.file.endsWith("periodic.ts"));
  const form = periodicFns.find((f) => f.name === "periodicFormOf");
  const cases = form !== undefined ? periodicCases(form, periodicFns) : new Map<string, Set<string>>();
  let bake = new Set<string>();
  for (const f of files) if (f.file.endsWith("apply-effect.ts")) bake = bakeKeys(f.src);

  const dot = new Set<string>();
  for (const fn of fns) {
    if (!fn.body.includes("effectDefOf(e.kind)") || !/\bkind\s*:\s*"dot"/.test(fn.sig + fn.body)) continue;
    addAll(dot, first.get(`${fn.file}:${fn.name}`)?.free);
    for (const m of fn.body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const callee = fns.find((f) => f.name === m[1]!);
      if (callee === undefined) continue;
      addAll(dot, first.get(`${callee.file}:${callee.name}`)?.free);
    }
  }

  const byName = new Map<string, Set<string>>();
  for (const name of Object.keys(EFFECT_DEFS)) {
    const fx = { op: "apply_status" as const, name, target: "self" as const, params: {} as Record<string, number> };
    const keys = new Set<string>();
    const def = EFFECT_DEFS[name]!;
    if (periodicFormOf(fx) !== undefined) {
      addAll(keys, cases.get(name));
      byName.set(name, keys);
      continue;
    }
    addAll(keys, bake);
    if (def.dot !== undefined) addAll(keys, dot);
    const ax = axesFormOf(fx);
    if (ax?.kind === "modifier" && ax.at !== undefined) addAll(keys, gated.get(`slot:${ax.at}`));
    if (ax?.kind === "immune") addAll(keys, gated.get("immune"));
    if (ax?.kind === "reflect") addAll(keys, gated.get("reflect"));
    if (def.dmgShield === "params") addAll(keys, gated.get("dmgShield"));
    if (def.reactive === "params") addAll(keys, gated.get("react"));
    if (def.periodic === "params") addAll(keys, gated.get("periodic"));
    byName.set(name, keys);
  }
  return { byName };
}

export function paramKeysFromRepo(root = join(dirname(fileURLToPath(import.meta.url)), "..")): Map<string, Set<string>> {
  const dir = join(root, "packages/battle-core/src");
  const files = walkTs(dir).map((file) => ({ file, src: readFileSync(file, "utf8") }));
  return paramScanFromSources(files).byName;
}

/** apply_status / apply_effect 的 params 里，这张表没有的键。未知状态名留给 UNKNOWN_STATUS。 */
export function paramKeyHits(
  nodes: readonly unknown[] | undefined,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
  path = "effects",
): ParamKeyHit[] {
  const out: ParamKeyHit[] = [];
  const walk = (list: readonly unknown[] | undefined, p: string): void => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i];
      if (fx === null || typeof fx !== "object") continue;
      const rec = fx as Record<string, unknown>;
      const here = `${p}[${i}]`;
      const op = rec.op;
      if ((op === "apply_status" || op === "apply_effect") && typeof rec.name === "string") {
        const table = allowed.get(rec.name);
        const params = rec.params;
        if (table !== undefined && params !== null && typeof params === "object" && !Array.isArray(params)) {
          for (const key of Object.keys(params as Record<string, unknown>)) {
            if (!table.has(key)) out.push({ path: here, key, name: rec.name });
          }
        }
      }
      for (const nest of NESTED) {
        const child = rec[nest];
        if (Array.isArray(child)) walk(child, `${here}.${nest}`);
      }
    }
  };
  walk(nodes, path);
  return out;
}
