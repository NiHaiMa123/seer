/**
 * effects-compile-check —— T7 全语料编译门禁。
 *
 * 把 content/claims/_effects-coverage.json（effects-parse 产物）里每一条招式的
 * parsed IR 装配成 moves.schema 可校验的 move 文档，做三层检查：
 *
 *   1. schema：move 文档必须过 moves.schema.json（含 then 分支白名单）
 *   2. op 存在性：每个 effect.op ∈ OPS 注册表（payload 递归检查）
 *   3. status 名存在性：apply_status/apply_effect 的 name ∈ EFFECT_DEFS（payload 递归）
 *   4. 轴读取：EFFECT_DEFS 每个名字落在已有读取的一根轴上（不扫语料，UNREAD_AXIS）
 *   5. damage / attachDamage 键清单：合并前拒清单外的 attachDamage 键，
 *      合并后拒清单外的 damage 键（含 payload）
 *   6. 编译器 IR：合并前拒清单外的招式旗标（FLAG_KEY）；schema 通过后，
 *      每条效果上不属于该 op 分支、也不属于信封的键失败（IR_KEY，含 payload）
 *   7. params 键：apply_status / apply_effect 的 params 必须落在该状态名的读取表上（PARAM_KEY）
 *
 * 失败按 (op/字段, 错误摘要) 聚类写 content/claims/_compile-failures.json。
 * 退出码：有失败 → 1；干净 → 0。
 *
 * 用法：node tools/effects-compile-check.ts [coverageJson] [--update-ok]
 */
import Ajv from "ajv";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import movesSchemaJson from "../content/schemas/moves.schema.json" with { type: "json" };
import { OPS } from "../packages/battle-core/src/ops/index.ts";
import { EFFECT_DEFS } from "../packages/battle-core/src/ops/effects.ts";
import { unreadEffectFlagsFromRepo } from "./effect-flag-readers.ts";
import { unreadEffectAxesFromRepo } from "./effect-axis-readers.ts";
import { damageKeyHits, unknownAttachDamageKeys } from "../packages/battle-core/src/ops/damage-keys.ts";
import { mergeAttachDamage } from "./attach-damage.ts";
import { effectKeyHits, flagKeyHits, loadIrAllow } from "./ir-keys.ts";
import { paramKeyHits, paramKeysFromRepo } from "./effect-param-readers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const irAllow = loadIrAllow(ROOT);
const paramAllow = paramKeysFromRepo(ROOT);
const COV = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : join(ROOT, "content/claims/_effects-coverage.json");
const OUT = join(dirname(COV), "_compile-failures.json");

// 单条 move item 校验：把 items 子 schema 提成根，definitions 平移以保 $ref 可解析
const itemSchema = (movesSchemaJson as any).properties.moves.items;
const ajv = new Ajv({ allErrors: true, strict: true });
const vMove = ajv.compile({ ...itemSchema, $id: "seer/move-item", definitions: (movesSchemaJson as any).definitions });

interface Eff { op?: string; name?: string; payload?: Eff[]; [k: string]: unknown }

function* walk(effs: Eff[] | undefined, path = ""): Generator<{ e: Eff; path: string }> {
  for (const [i, e] of (effs ?? []).entries()) {
    const p = `${path}[${i}]`;
    yield { e, path: p };
    if (Array.isArray(e.payload)) yield* walk(e.payload, `${p}.payload`);
  }
}

const failures: { key: string; kind: string; detail: string; move: string; text?: string }[] = [];
const failKinds = new Map<string, number>();

const rep = JSON.parse(readFileSync(COV, "utf8"));
let checked = 0;
let emptyMoves = 0;
let emptyWithUnparsed = 0;
let emptyFlagsOnly = 0;
let idx = 0;
for (const [key, v] of Object.entries(rep.moves) as [string, any][]) {
  idx++;
  const flags = v.flags ?? {};
  const effects: Eff[] = structuredClone(v.effects ?? []);
  for (const k of flagKeyHits(flags)) {
    failures.push({ key, kind: "FLAG_KEY", detail: `flags.${k}`, move: v.skill ?? key });
    failKinds.set(`FLAG_KEY:${k}`, (failKinds.get(`FLAG_KEY:${k}`) ?? 0) + 1);
  }
  // attachDamage → 合并进首个 damage op；无则合成基线 damage op（power 用原威力，缺省 1）
  const ad = flags.attachDamage;
  if (ad !== undefined && typeof ad === "object") {
    for (const k of unknownAttachDamageKeys(ad as object)) {
      failures.push({ key, kind: "ATTACH_KEY", detail: `attachDamage.${k}`, move: v.skill ?? key });
      failKinds.set(`ATTACH_KEY:${k}`, (failKinds.get(`ATTACH_KEY:${k}`) ?? 0) + 1);
    }
  }
  if (ad !== undefined || (v.power ?? 0) > 0) {
    let dmg = effects.find((e) => e.op === "damage");
    if (dmg === undefined) {
      dmg = { op: "damage", power: Math.max(1, v.power ?? 0) };
      effects.unshift(dmg);
    }
    if (ad !== undefined) mergeAttachDamage(dmg, ad as Record<string, unknown>);
  }
  if (effects.length === 0) {
    // 零 op 招式合法（schema 允许空 effects）：纯 flags 招式（必中/先制）或全留档文本
    emptyMoves++;
    if ((v.unparsed?.length ?? 0) > 0) emptyWithUnparsed++;
    else emptyFlagsOnly++;
  }
  const move: Record<string, unknown> = {
    id: `mv-${idx}`,
    name: v.skill ?? key,
    pp: v.pp ?? 20,
    priority: flags.priority ?? 0,
    effects,
  };
  if (flags.accuracy !== undefined) move.accuracy = flags.accuracy;
  if (flags.priorityIf !== undefined) move.priorityIf = flags.priorityIf;
  if (flags.priorityMin !== undefined) move.priorityMin = flags.priorityMin;
  if (flags.priorityMinIf !== undefined) move.priorityIf = { ...(move.priorityIf ?? { when: flags.priorityMinIf.when, add: 0 }), ...{ when: flags.priorityMinIf.when, min: flags.priorityMinIf.min } };
  if (flags.hitIf !== undefined) move.hitIf = flags.hitIf;
  if (flags.prioPerUse !== undefined) move.prioPerUse = flags.prioPerUse;
  if (flags.ignoreFoeSpeed === true) move.ignoreFoeSpeed = true;
  if (flags.prioPerFoeLowPp !== undefined) move.prioPerFoeLowPp = flags.prioPerFoeLowPp;
  if (flags.targets !== undefined) move.targets = flags.targets;
  if (flags.targetScope !== undefined) move.targetScope = flags.targetScope;
  if (typeof v.kind === "string" && /物理/.test(v.kind)) move.category = "physical";
  else if (typeof v.kind === "string" && /特殊/.test(v.kind)) move.category = "special";
  checked++;

  if (!vMove(move)) {
    for (const err of vMove.errors ?? []) {
      const detail = `${err.instancePath} ${err.message}`.slice(0, 160);
      failures.push({ key, kind: "SCHEMA", detail, move: v.skill ?? key });
      const agg = `SCHEMA:${(err.params as any)?.additionalProperty ?? err.keyword}`;
      failKinds.set(agg, (failKinds.get(agg) ?? 0) + 1);
    }
    continue; // schema 不过则不再做 op/name 检查（字段可能畸形）
  }
  for (const { e, path } of walk(effects)) {
    if (typeof e.op !== "string" || !(e.op in OPS)) {
      failures.push({ key, kind: "UNKNOWN_OP", detail: `${path} op=${String(e.op)}`, move: v.skill ?? key });
      failKinds.set(`UNKNOWN_OP:${String(e.op)}`, (failKinds.get(`UNKNOWN_OP:${String(e.op)}`) ?? 0) + 1);
    }
    if ((e.op === "apply_status" || e.op === "apply_effect") && typeof e.name === "string" && !(e.name in EFFECT_DEFS)) {
      failures.push({ key, kind: "UNKNOWN_STATUS", detail: `${path} name=${e.name}`, move: v.skill ?? key });
      failKinds.set(`UNKNOWN_STATUS:${e.name}`, (failKinds.get(`UNKNOWN_STATUS:${e.name}`) ?? 0) + 1);
    }
  }
  for (const hit of damageKeyHits(effects)) {
    failures.push({ key, kind: "DAMAGE_KEY", detail: `${hit.path} key=${hit.key}`, move: v.skill ?? key });
    failKinds.set(`DAMAGE_KEY:${hit.key}`, (failKinds.get(`DAMAGE_KEY:${hit.key}`) ?? 0) + 1);
  }
  for (const hit of effectKeyHits(effects, irAllow)) {
    failures.push({ key, kind: "IR_KEY", detail: `${hit.path} key=${hit.key}`, move: v.skill ?? key });
    failKinds.set(`IR_KEY:${hit.key}`, (failKinds.get(`IR_KEY:${hit.key}`) ?? 0) + 1);
  }
  for (const hit of paramKeyHits(effects, paramAllow)) {
    failures.push({ key, kind: "PARAM_KEY", detail: `${hit.path} ${hit.name}.${hit.key}`, move: v.skill ?? key });
    failKinds.set(`PARAM_KEY:${hit.name}.${hit.key}`, (failKinds.get(`PARAM_KEY:${hit.name}.${hit.key}`) ?? 0) + 1);
  }
}

for (const flag of unreadEffectFlagsFromRepo()) {
  failures.push({ key: flag, kind: "UNREAD_FLAG", detail: `${flag} 无人读取且不在 DEFERRED_FLAGS`, move: "" });
  failKinds.set(`UNREAD_FLAG:${flag}`, (failKinds.get(`UNREAD_FLAG:${flag}`) ?? 0) + 1);
}

for (const miss of unreadEffectAxesFromRepo()) {
  failures.push({ key: miss.name, kind: "UNREAD_AXIS", detail: miss.reason, move: "" });
  failKinds.set(`UNREAD_AXIS:${miss.name}`, (failKinds.get(`UNREAD_AXIS:${miss.name}`) ?? 0) + 1);
}

const report = {
  generated: new Date().toISOString().slice(0, 10),
  movesChecked: checked,
  emptyMoves: { total: emptyMoves, flagsOnly: emptyFlagsOnly, withUnparsed: emptyWithUnparsed },
  failures: failures.length,
  failKinds: [...failKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ kind: k, count: c })),
  items: failures.slice(0, 2000),
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`checked=${checked} failures=${failures.length} emptyMoves=${emptyMoves}(flags=${emptyFlagsOnly},unparsed=${emptyWithUnparsed}) → ${OUT}`);
for (const { kind, count } of report.failKinds.slice(0, 20)) console.log(`  ${String(count).padStart(5)}  ${kind}`);
if (failures.length > 0) process.exitCode = 1;
