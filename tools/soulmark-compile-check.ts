/**
 * soulmark-compile-check —— S5 全量魂印编译门禁。
 *
 * creatures.json 每只精灵的 soulMark.text → parseSoulmarkText → 装配 soulmark
 * 文档（{id:sm-<creature-id-suffix>, name, desc, effects:entries}），三层检查：
 *
 *   1. schema：单条 soulmark 文档过 soulmarks.schema.json#/definitions/soulmark
 *      （hook/guard/ops 跨文件 $ref 经 addSchema moves.schema 解析）
 *   2. op 存在性：hook 条目的 ops/elseOps 每个 op ∈ OPS 注册表（payload 递归）
 *   3. status 名存在性：apply_status/apply_effect 的 name ∈ EFFECT_DEFS（payload 递归）
 *   4. damage 键清单：ops / elseOps 里的 damage（含 payload）不得带清单外的键
 *   5. 编译器 IR：条目键必须落在 SoulHookOp 或 SoulFlagOp 上；嵌套 op 的键必须落在
 *      该 op 分支加信封上（IR_KEY）。活解析，不读旧的覆盖率文件。
 *   6. params 键：apply_status / apply_effect 的 params 必须落在该状态名的读取表上（PARAM_KEY）
 *   7. 真实装载路径：全部条目装进一份 soulmarks 文档跑 soulmarkMechanic.compile
 *      （生产同款 vSoulmarks + 注册表校验），fail() 抛错即门禁失败
 *
 * 失败按 (kind, 错误摘要) 聚类写 content/claims/_soulmark-compile-failures.json。
 * 退出码：有失败 → 1；干净 → 0。
 *
 * 用法：node tools/soulmark-compile-check.ts [creatures.json] [--no-write] [--out PATH]
 * --no-write 保持旧门禁检查路径，只把完整报告打印到 stdout。
 */
import Ajv from "ajv";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import soulmarksSchemaJson from "../content/schemas/soulmarks.schema.json" with { type: "json" };
import movesSchemaJson from "../content/schemas/moves.schema.json" with { type: "json" };
import { OPS } from "../packages/battle-core/src/ops/index.ts";
import { EFFECT_DEFS } from "../packages/battle-core/src/ops/effects.ts";
import { soulmarkMechanic } from "../packages/battle-core/src/mechanics/soulmark/index.ts";
import { parseSoulmarkText } from "./soulmark-parse.mjs";
import { damageKeyHits } from "../packages/battle-core/src/ops/damage-keys.ts";
import { effectKeyHits, loadIrAllow, soulEntryKeyHits } from "./ir-keys.ts";
import { paramKeyHits, paramKeysFromRepo } from "./effect-param-readers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const irAllow = loadIrAllow(ROOT);
const paramAllow = paramKeysFromRepo(ROOT);
const cli = process.argv.slice(2);
let sourceArg: string | undefined;
let outArg: string | undefined;
let noWrite = false;
for (let i = 0; i < cli.length; i++) {
  const arg = cli[i]!;
  if (arg === "--no-write") noWrite = true;
  else if (arg === "--out") {
    const value = cli[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("--out requires a path");
    outArg = value;
  } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
  else if (sourceArg === undefined) sourceArg = arg;
  else throw new Error(`unexpected argument: ${arg}`);
}
const SRC = sourceArg === undefined ? join(ROOT, "content/creatures/creatures.json") : resolve(sourceArg);
const OUT = outArg === undefined ? join(ROOT, "content/claims/_soulmark-compile-failures.json") : resolve(outArg);

// 单条 soulmark 校验：definitions 平移以保内部 $ref 可解析，moves.schema 经 addSchema 挂载
const itemSchema = (soulmarksSchemaJson as any).definitions.soulmark;
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(movesSchemaJson as any);
const vSoulmark = ajv.compile({ ...itemSchema, $id: "seer/soulmark-item", definitions: (soulmarksSchemaJson as any).definitions });

interface Eff { op?: string; name?: string; payload?: Eff[]; [k: string]: unknown }
function* walk(effs: Eff[] | undefined, path = ""): Generator<{ e: Eff; path: string }> {
  for (const [i, e] of (effs ?? []).entries()) {
    const p = `${path}[${i}]`;
    yield { e, path: p };
    if (Array.isArray(e.payload)) yield* walk(e.payload, `${p}.payload`);
  }
}

const failures: { key: string; kind: string; detail: string; mark: string }[] = [];
const failKinds = new Map<string, number>();
const bump = (kind: string) => failKinds.set(kind, (failKinds.get(kind) ?? 0) + 1);

const cat = JSON.parse(readFileSync(SRC, "utf8"));
let checked = 0;
let petsWithMark = 0;
let entryTotal = 0;
const doc: { soulmarks: Record<string, unknown> } = { soulmarks: {} };
const seenCreatureIds = new Set<string>();

for (const [catalogKey, c] of Object.entries(cat.creatures) as [string, any][]) {
  const text = (c.soulMark?.text ?? "").trim();
  if (text === "") continue;
  petsWithMark++;
  const petNo = String(c.petNo ?? c.id);
  const creatureId = String(c.id ?? catalogKey);
  if (seenCreatureIds.has(creatureId)) {
    failures.push({ key: creatureId, kind: "DUPLICATE_CREATURE_ID", detail: `duplicate creature identity at ${catalogKey}`, mark: String(c.name ?? petNo) });
    bump("DUPLICATE_CREATURE_ID");
    continue;
  }
  seenCreatureIds.add(creatureId);
  const idSuffix = creatureId.replace(/^pet-/, "");
  const { entries } = parseSoulmarkText(text, c.name);
  if (entries.length === 0) continue; // 全量 unparsed/空文本 → 无可装载条目（覆盖率脚本另有分桶）
  const markName = String(c.name ?? petNo);
  const mark = { id: `sm-${idSuffix}`, name: markName, desc: text.slice(0, 2000), effects: entries };
  checked++;
  entryTotal += entries.length;

  if (!vSoulmark(mark)) {
    for (const err of vSoulmark.errors ?? []) {
      const detail = `${err.instancePath} ${err.message}`.slice(0, 160);
      failures.push({ key: creatureId, kind: "SCHEMA", detail, mark: markName });
      bump(`SCHEMA:${(err.params as any)?.additionalProperty ?? err.keyword}`);
    }
    continue; // schema 不过则不再做 op/name 检查（字段可能畸形）
  }
  for (const hit of soulEntryKeyHits(entries, irAllow)) {
    failures.push({ key: creatureId, kind: "IR_KEY", detail: `${hit.path} key=${hit.key}`, mark: markName });
    bump(`IR_KEY:${hit.key}`);
  }
  for (const [ei, e] of (entries as { hook?: string; ops?: Eff[]; elseOps?: Eff[] }[]).entries()) {
    for (const listName of ["ops", "elseOps"] as const) {
      for (const hit of damageKeyHits(e[listName], `effects[${ei}].${listName}`)) {
        failures.push({ key: creatureId, kind: "DAMAGE_KEY", detail: `${hit.path} key=${hit.key}`, mark: markName });
        bump(`DAMAGE_KEY:${hit.key}`);
      }
      for (const hit of effectKeyHits(e[listName], irAllow, `effects[${ei}].${listName}`)) {
        failures.push({ key: creatureId, kind: "IR_KEY", detail: `${hit.path} key=${hit.key}`, mark: markName });
        bump(`IR_KEY:${hit.key}`);
      }
      for (const hit of paramKeyHits(e[listName], paramAllow, `effects[${ei}].${listName}`)) {
        failures.push({ key: creatureId, kind: "PARAM_KEY", detail: `${hit.path} ${hit.name}.${hit.key}`, mark: markName });
        bump(`PARAM_KEY:${hit.name}.${hit.key}`);
      }
    }
    for (const { e: fx, path } of walk(e.ops, `effects[${ei}].ops`)) {
      if (typeof fx.op !== "string" || !(fx.op in OPS)) {
        failures.push({ key: creatureId, kind: "UNKNOWN_OP", detail: `${path} op=${String(fx.op)}`, mark: markName });
        bump(`UNKNOWN_OP:${String(fx.op)}`);
      }
      if ((fx.op === "apply_status" || fx.op === "apply_effect") && typeof fx.name === "string" && !(fx.name in EFFECT_DEFS)) {
        failures.push({ key: creatureId, kind: "UNKNOWN_STATUS", detail: `${path} name=${fx.name}`, mark: markName });
        bump(`UNKNOWN_STATUS:${fx.name}`);
      }
    }
    for (const { e: fx, path } of walk(e.elseOps, `effects[${ei}].elseOps`)) {
      if (typeof fx.op !== "string" || !(fx.op in OPS)) {
        failures.push({ key: creatureId, kind: "UNKNOWN_OP", detail: `${path} op=${String(fx.op)}`, mark: markName });
        bump(`UNKNOWN_OP:${String(fx.op)}`);
      }
      if ((fx.op === "apply_status" || fx.op === "apply_effect") && typeof fx.name === "string" && !(fx.name in EFFECT_DEFS)) {
        failures.push({ key: creatureId, kind: "UNKNOWN_STATUS", detail: `${path} name=${fx.name}`, mark: markName });
        bump(`UNKNOWN_STATUS:${fx.name}`);
      }
    }
  }
  doc.soulmarks[mark.id] = mark;
}

// 生产装载路径端到端复核：全部合格条目组成一份 soulmarks 文档过 mechanic.compile
if (failures.length === 0 && Object.keys(doc.soulmarks).length > 0) {
  try {
    const c = soulmarkMechanic.compile!({
      raw: { pack: { files: { soulmarks: "soulmarks.json" } }, soulmarks: doc },
      ruleset: {},
      fail: (msg: string): never => { throw new Error(msg); },
    } as never);
    if (c === undefined) {
      failures.push({ key: "_pack", kind: "COMPILE", detail: "mechanic.compile returned undefined", mark: "_all" });
      bump("COMPILE:undefined");
    }
  } catch (err) {
    failures.push({ key: "_pack", kind: "COMPILE", detail: String((err as Error).message).slice(0, 200), mark: "_all" });
    bump("COMPILE:fail");
  }
}

const report = {
  generated: new Date().toISOString().slice(0, 10),
  petsWithMark,
  marksChecked: checked,
  entriesChecked: entryTotal,
  failures: failures.length,
  failKinds: [...failKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ kind: k, count: c })),
  items: failures.slice(0, 2000),
};
if (noWrite) console.log(JSON.stringify(report, null, 2));
else {
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`petsWithMark=${petsWithMark} marks=${checked} entries=${entryTotal} failures=${failures.length} → ${OUT}`);
  for (const { kind, count } of report.failKinds.slice(0, 20)) console.log(`  ${String(count).padStart(5)}  ${kind}`);
}
if (failures.length > 0) process.exitCode = 1;
