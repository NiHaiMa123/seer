/**
 * EFFECT_DEFS 的每个名字必须落在一根已有读取的轴上。
 * 旗标本身不是读取：immune / reflect / modifier / periodic 要脱糖成功，
 * 并且消费点认这个形态。
 * random 不是轴，是挂载前改写。只在 apply-effect 仍消费 fx.random 时放行。
 * 不要为了过检查去补结算，也不要再加一个靠名单放行的名字。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { axesFormOf } from "../packages/battle-core/src/ops/axes.ts";
import { periodicFormOf } from "../packages/battle-core/src/ops/periodic.ts";
import { EFFECT_DEFS } from "../packages/battle-core/src/ops/effects.ts";

const AXIS_FIELDS = ["ailment", "periodic", "immune", "reflect", "modifier", "dmgShield", "reactive"] as const;
type AxisName = (typeof AXIS_FIELDS)[number];

export interface AxisDef {
  ailment?: boolean;
  periodic?: "params";
  immune?: "params";
  reflect?: "params";
  modifier?: "params";
  dmgShield?: "params";
  reactive?: "params";
}

export interface AxisMiss {
  name: string;
  reason: string;
}

export interface AxisScanInput {
  defs: Record<string, AxisDef>;
  /** battle-core 源码，用来找轴的消费点。 */
  src: string;
  /** apply-effect.ts。random 的改写证明只认这一份。 */
  applySrc: string;
  /** 缺省视为脱糖失败。测试负例注入；仓库扫描用真正的 periodicFormOf。 */
  periodicForm?: (name: string) => unknown;
  /** 同上，仓库扫描用 axesFormOf。返回值要带 kind，modifier 还要带 at。 */
  axesForm?: (name: string) => { kind?: string; at?: string } | undefined;
}

function axesOf(def: AxisDef): AxisName[] {
  const out: AxisName[] = [];
  if (def.ailment === true) out.push("ailment");
  if (def.periodic === "params") out.push("periodic");
  if (def.immune === "params") out.push("immune");
  if (def.reflect === "params") out.push("reflect");
  if (def.modifier === "params") out.push("modifier");
  if (def.dmgShield === "params") out.push("dmgShield");
  if (def.reactive === "params") out.push("reactive");
  return out;
}

/** isMod(e, "at") / modsAt(u, "at")，单引号或双引号。不认变量，也不认注释里的裸槽位名。 */
function slotRead(src: string, at: string): boolean {
  const q = at.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:isMod|modsAt)\\s*\\(\\s*[^,)]*\\s*,\\s*["']${q}["']`).test(src);
}

function hasCall(src: string, exportName: string): boolean {
  return src.includes(`export const ${exportName}`) && src.includes(`${exportName}(`);
}

/** 返回轴上没有对应读取的状态名。空数组 = 全部能读。 */
export function unreadEffectAxes(input: AxisScanInput): AxisMiss[] {
  const misses: AxisMiss[] = [];
  for (const [name, def] of Object.entries(input.defs)) {
    const axes = axesOf(def);
    if (axes.length === 0) {
      if (name === "random" && input.applySrc.includes("fx.random")) continue;
      misses.push({
        name,
        reason: name === "random"
          ? "random 只在 apply-effect 仍消费 fx.random 时不算轴"
          : "没有轴",
      });
      continue;
    }
    if (axes.length > 1) {
      misses.push({ name, reason: `同时标了 ${axes.join("、")}` });
      continue;
    }
    const axis = axes[0];
    if (axis === "ailment") {
      if (!input.src.includes("?.ailment")) misses.push({ name, reason: "没有 ?.ailment 读取" });
      continue;
    }
    if (axis === "dmgShield") {
      if (!input.src.includes("?.dmgShield")) misses.push({ name, reason: "没有 ?.dmgShield 读取" });
      continue;
    }
    if (axis === "reactive") {
      if (name !== "react") {
        misses.push({ name, reason: "reactive 只认名字 react，别的名字挂上去不会派发" });
      } else if (!input.src.includes('kind === "react"')) {
        misses.push({ name, reason: '没有 kind === "react" 派发' });
      }
      continue;
    }
    if (axis === "periodic") {
      const dispatched = input.src.includes('kind === "periodic"');
      if (name === "periodic") {
        if (!dispatched) misses.push({ name, reason: '没有 kind === "periodic" 派发' });
        continue;
      }
      const form = input.periodicForm?.(name);
      if (!dispatched || form === undefined) {
        misses.push({ name, reason: "periodic 脱糖没有这个名字，或窗口派发不在了" });
      }
      continue;
    }
    const hit = input.axesForm?.(name);
    if (axis === "immune") {
      if (hit?.kind !== "immune") misses.push({ name, reason: "immune 没有脱糖成位" });
      else if (!hasCall(input.src, "immuneOn")) misses.push({ name, reason: "没有 immuneOn 读取" });
      continue;
    }
    if (axis === "reflect") {
      if (hit?.kind !== "reflect") misses.push({ name, reason: "reflect 没有脱糖成位" });
      else if (!hasCall(input.src, "reflectOn")) misses.push({ name, reason: "没有 reflectOn 读取" });
      continue;
    }
    if (hit?.kind !== "modifier" || hit.at === undefined || hit.at === "") {
      misses.push({ name, reason: "modifier 没有脱糖成槽位" });
    } else if (!slotRead(input.src, hit.at)) {
      misses.push({ name, reason: `槽位 ${hit.at} 没有 isMod/modsAt 读取` });
    }
  }
  return misses;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTs(p, out);
    else if (name.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

export function unreadEffectAxesFromRepo(root = join(dirname(fileURLToPath(import.meta.url)), "..")): AxisMiss[] {
  const srcDir = join(root, "packages/battle-core/src");
  const src = walkTs(srcDir).map((p) => readFileSync(p, "utf8")).join("\n");
  const applySrc = readFileSync(join(srcDir, "ops/apply-effect.ts"), "utf8");
  return unreadEffectAxes({
    defs: EFFECT_DEFS,
    src,
    applySrc,
    periodicForm: (name) => periodicFormOf({ op: "apply_status", name, target: "self", params: {} }),
    axesForm: (name) => axesFormOf({ op: "apply_status", name, target: "self", params: {} }),
  });
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const misses = unreadEffectAxesFromRepo();
  if (misses.length === 0) console.log("effect-axes: PASS");
  else {
    console.error(`effect-axes: ${misses.length} 个状态名的轴没有对应读取`);
    for (const miss of misses) console.error(`  ${miss.name}: ${miss.reason}`);
    process.exitCode = 1;
  }
}
