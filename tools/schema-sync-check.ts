/**
 * schema-sync-check —— T10 三处同步静态校验。
 *
 * moves.schema.json 的 effects.items（properties + allOf if/then 门控）
 * 必须与 loader.ts 的 CompiledEffect 判别联合、ops/index.ts 的 OPS
 * 注册表、以及 ruleset 的 operatorAllowlist 保持一致：
 *
 *   1. schema if.op 覆盖集 == OPS 注册表（每个注册的 op 都有 schema 门控分支）
 *   2. 每个 then.properties ⊆ 顶层 properties（AJV strict 已挡过一半，这里保回归）
 *   3. 每个 then.properties ⊆ 对应 union 成员的字段集（schema 放行的字段必须有 TS 承载）
 *   4. union 成员字段 ⊆ then.properties ∪ 顶层公共字段（TS 有字段而 schema 不放行 = 死字段）
 *   5. Condition 联合成员键 == definitions.condition.properties 键
 *   6. 各 ruleset 的 operatorAllowlist ⊆ OPS；features ⊆ FeatureFlag
 *   7. 公开事件四件套互钉：公开 schema oneOf == host PUBLIC_TYPES/PUBLIC_FIELDS
 *      == CORE_EVENT_TYPES 减引擎私有钉 == 内部 enum 减 Host 专属钉，
 *      且 ZH_EVENT 覆盖全部公开类型（eventSyncErrors，纯函数可测负例）。
 *
 * 退出码：不一致 → 1。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPS } from "../packages/battle-core/src/ops/index.ts";
import { damageFamilyDrift, damageManifestDrift } from "../packages/battle-core/src/ops/damage-keys.ts";
import { CORE_EVENT_TYPES } from "../packages/battle-core/src/types.ts";
import { PUBLIC_FIELDS, PUBLIC_TYPES } from "../packages/host/src/events.ts";
import { ZH_EVENT } from "../apps/client/src/meta.ts";
import movesSchemaJson from "../content/schemas/moves.schema.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const loaderSrc = readFileSync(join(ROOT, "packages/battle-core/src/loader.ts"), "utf8");

let errors = 0;
const fail = (msg: string) => {
  errors++;
  console.error(`  ✗ ${msg}`);
};

/** 从 `export type X =` 或 `interface X` 截到下一个顶层 export。 */
function typeBlock(src: string, name: string): string {
  const start = src.indexOf(name === "CompiledEffect" ? "export type CompiledEffect" : name === "EffectEnvelope" ? "interface EffectEnvelope" : `export type ${name}`);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const m = /\nexport |\ninterface [A-Z]/.exec(rest);
  return src.slice(start, m === null ? undefined : start + 1 + m.index);
}

/** 成员体去注释后剥掉所有嵌套 {}（最内层到最外层），留下的顶层 `key:`/`key?:` 名集合。
 *  `stripOuter`=true 时把 `interface X {`/`type X = {` 的头部开括号先切除。 */
function topKeys(memberBody: string, stripOuter = false): Set<string> {
  let s = memberBody.replace(/\/\*\*[\s\S]*?\*\//g, "");
  if (stripOuter) s = s.slice(s.indexOf("{") + 1);
  for (let i = 0; i < 20 && /{[^{}]*}/.test(s); i++) s = s.replace(/{[^{}]*}/g, "");
  const out = new Set<string>();
  for (const m of s.matchAll(/([a-zA-Z_]\w*)\s*\?*:/g)) out.add(m[1]!);
  return out;
}

// ── TS 侧：CompiledEffect 每成员字段集 + EffectEnvelope 字段集 ──
const ceBlock = typeBlock(loaderSrc, "CompiledEffect").replace(/\/\*\*[\s\S]*?\*\//g, "");
const memberKeys = new Map<string, Set<string>>(); // op -> keys
{
  // 成员边界：`\n  | {`（联合分支可跨多行）
  const parts = ceBlock.split(/\n\s*\|\s*\{/);
  for (const part of parts.slice(1)) {
    const om = /op:\s*"(\w+)"/.exec(part);
    if (om === null) continue;
    memberKeys.set(om[1]!, topKeys(part));
  }
}
const envKeys = topKeys(typeBlock(loaderSrc, "EffectEnvelope"), true);
const condKeys = new Set<string>();
for (const m of typeBlock(loaderSrc, "Condition").matchAll(/\|\s*\{\s*(\w+):/g)) condKeys.add(m[1]!);
const featureFlags = new Set<string>();
for (const m of typeBlock(loaderSrc, "FeatureFlag").matchAll(/"(\w+)"/g)) featureFlags.add(m[1]!);

console.log(`TS: ops=${memberKeys.size} envelope=${envKeys.size} conditions=${condKeys.size} features=${featureFlags.size}`);

// ── schema 侧 ──
const item = (movesSchemaJson as any).properties.moves.items;
const effItem = item.properties.effects.items;
const props = new Set<string>(Object.keys(effItem.properties));
const condProps = new Set<string>(Object.keys((movesSchemaJson as any).definitions.condition.properties));

/** 每个 op 的 schema 键集：allowed=then.properties 里非 false 的键；forbidden=`false` 标记。 */
const gateOps = new Map<string, { allowed: Set<string>; forbidden: Set<string> }>();
for (const branch of effItem.allOf ?? []) {
  const c = branch?.if?.properties?.op;
  const ops: string[] = c?.const !== undefined ? [c.const] : (c?.enum ?? []);
  for (const op of ops) {
    const cur = gateOps.get(op) ?? { allowed: new Set(), forbidden: new Set() };
    for (const [k, v] of Object.entries(branch.then?.properties ?? {})) {
      if (v === false) cur.forbidden.add(k);
      else cur.allowed.add(k);
    }
    gateOps.set(op, cur);
  }
}
console.log(`schema: gatedOps=${gateOps.size} props=${props.size} conditions=${condProps.size}`);

// 1. op 门控覆盖 == OPS
for (const op of Object.keys(OPS)) {
  if (!gateOps.has(op)) fail(`op "${op}" 已注册但 schema 无 if/then 门控分支`);
}
for (const op of gateOps.keys()) {
  if (!(op in OPS)) fail(`schema 门控了未注册的 op "${op}"`);
}

// 2/3/4. per-op 键集三方一致
for (const [op, gate] of gateOps) {
  const tsKeys = new Set([...(memberKeys.get(op) ?? []), ...envKeys]);
  for (const k of gate.allowed) {
    if (!props.has(k)) fail(`${op}: schema then 键 "${k}" 未在顶层 properties 声明`);
    if (!tsKeys.has(k)) fail(`${op}: schema 放行键 "${k}" 在 TS CompiledEffect/Envelope 中无字段`);
  }
  for (const k of gate.forbidden) {
    if (tsKeys.has(k)) fail(`${op}: schema 禁止键 "${k}" 却在 TS 成员中声明（死字段）`);
  }
  for (const k of tsKeys) {
    if (k === "op") continue;
    if (gate.forbidden.has(k)) fail(`${op}: TS 字段 "${k}" 被 schema 明确禁止（类型与门控冲突）`);
    if (!gate.allowed.has(k) && !props.has(k) && !envKeys.has(k)) {
      fail(`${op}: TS 字段 "${k}" 既不在 then.properties 也不在顶层 properties`);
    }
  }
}

// 5. Condition 键同步
for (const k of condKeys) if (!condProps.has(k)) fail(`Condition "${k}" 在 schema condition.properties 缺失`);
for (const k of condProps) if (!condKeys.has(k)) fail(`schema condition "${k}" 在 TS Condition 联合中无成员`);

// 6. ruleset operatorAllowlist/features
const RULESETS = join(ROOT, "content/rulesets");
for (const f of readdirSync(RULESETS)) {
  if (!f.endsWith(".json") || f === "natures.json" || f === "typechart.json") continue;
  const rs = JSON.parse(readFileSync(join(RULESETS, f), "utf8"));
  for (const op of rs.operatorAllowlist ?? []) {
    if (!(op in OPS)) fail(`${f}: operatorAllowlist 含未注册 op "${op}"`);
  }
  for (const ft of rs.features ?? []) {
    if (!featureFlags.has(ft)) fail(`${f}: feature "${ft}" 不在 FeatureFlag 联合中`);
  }
}

// ── 7. 公开事件同步：schema / host 白名单 / 引擎 / 内部 enum / 中文名互钉 ──
/** Host 专属内部事件钉：在内部 enum 但不在 CORE_EVENT_TYPES，且不公开。 */
const HOST_ONLY_EVENTS = new Set(["decision-opened", "input-received"]);
/** 引擎私有事件钉：在 CORE_EVENT_TYPES 但有意不公开。 */
const ENGINE_PRIVATE_EVENTS = new Set(["pp-spent", "rng-draw"]);

export interface EventSyncInput {
  /** 公开 schema oneOf：type → detail 字段集（"type" 本身不计入）。 */
  schemaBranches: ReadonlyMap<string, ReadonlySet<string>>;
  /** host 投影白名单（机制 eventFields 并入后的版本）。 */
  publicTypes: ReadonlySet<string>;
  publicFields: Readonly<Record<string, ReadonlySet<string>>>;
  coreEventTypes: readonly string[];
  internalEnum: readonly string[];
  /** 客户端中文事件名表（ZH_EVENT）。 */
  zhEventNames: Readonly<Record<string, string>>;
}

/** 从仓库读全量输入——调用方不另维护表。 */
export function loadEventSyncInput(root: string = ROOT): EventSyncInput {
  const pub = JSON.parse(readFileSync(join(root, "packages/contracts/schemas/public/event.schema.json"), "utf8"));
  const branches = new Map<string, Set<string>>();
  for (const b of pub.oneOf ?? []) {
    const type = b?.properties?.type?.const;
    if (typeof type !== "string") continue;
    branches.set(type, new Set(Object.keys(b.properties ?? {}).filter((k) => k !== "type")));
  }
  const internal = JSON.parse(readFileSync(join(root, "packages/contracts/schemas/internal/event-internal.schema.json"), "utf8"));
  return {
    schemaBranches: branches,
    publicTypes: PUBLIC_TYPES,
    publicFields: PUBLIC_FIELDS,
    coreEventTypes: CORE_EVENT_TYPES,
    internalEnum: internal?.properties?.type?.enum ?? [],
    zhEventNames: ZH_EVENT,
  };
}

/** 公开事件五方一致性检查——纯函数，返回全部错误（不逐条退出，负例能测全部条件）。 */
export function eventSyncErrors(input: EventSyncInput): string[] {
  const errs: string[] = [];
  const diff = (a: ReadonlySet<string>, b: ReadonlySet<string>) => ({
    onlyA: [...a].filter((x) => !b.has(x)),
    onlyB: [...b].filter((x) => !a.has(x)),
  });
  const schemaTypes = new Set(input.schemaBranches.keys());
  const core = new Set(input.coreEventTypes);
  const internal = new Set(input.internalEnum);

  // 1. schema 类型集 == PUBLIC_TYPES
  const t = diff(schemaTypes, input.publicTypes);
  for (const n of t.onlyA) errs.push(`公开 schema 有类型 "${n}"，PUBLIC_TYPES 没有`);
  for (const n of t.onlyB) errs.push(`PUBLIC_TYPES 有类型 "${n}"，公开 schema oneOf 没有`);

  // 2. 每类型字段集相等（type 不参与）。整份白名单缺失也是不一致，不能跳过。
  for (const [type, fields] of input.schemaBranches) {
    const allow = input.publicFields[type];
    if (allow === undefined) {
      errs.push(`"${type}" 在公开 schema 中，但 PUBLIC_FIELDS 没有该类型的字段集`);
      continue;
    }
    const f = diff(fields, allow);
    if (f.onlyA.length > 0 || f.onlyB.length > 0) {
      errs.push(`"${type}" 字段不一致：schema 多出 [${f.onlyA.join(",")}] / 白名单多出 [${f.onlyB.join(",")}]`);
    }
  }

  // 3. pp-delta 脱敏钉：集合相等之外单独报隐私（看出这是脱敏，不是普通键漂移）
  const ppSchema = input.schemaBranches.get("pp-delta") ?? new Set<string>();
  const pp = diff(ppSchema, new Set(["side", "delta"]));
  if (pp.onlyA.length > 0 || pp.onlyB.length > 0) {
    errs.push(`"pp-delta" schema 字段必须恰好是 {side, delta}：多出 [${pp.onlyA.join(",")}] / 缺少 [${pp.onlyB.join(",")}]`);
  }
  for (const k of ["moveId", "ppAfter"]) {
    if (ppSchema.has(k) || input.publicFields["pp-delta"]?.has(k) === true) {
      errs.push(`隐私："pp-delta" 放行 "${k}"——PP 脱敏字段（招式 id / 剩余 PP）不得公开`);
    }
  }

  // 4. 内部 enum − CORE_EVENT_TYPES == HOST_ONLY_EVENTS；且这两个不得公开；core ⊆ internal
  for (const n of internal) {
    if (!core.has(n) && !HOST_ONLY_EVENTS.has(n)) {
      errs.push(`"${n}" 在内部 enum 却不在 CORE_EVENT_TYPES，也不是已知 Host 专属事件——新内部事件要更新 HOST_ONLY_EVENTS 钉`);
    }
  }
  for (const n of HOST_ONLY_EVENTS) {
    if (!internal.has(n) || core.has(n)) errs.push(`"${n}" 应在内部 enum 且不在 CORE_EVENT_TYPES（Host 专属钉）`);
    if (input.publicTypes.has(n) || schemaTypes.has(n)) errs.push(`"${n}" 是 Host 内部事件，不得出现在公开类型/schema`);
  }
  for (const n of core) {
    if (!internal.has(n)) errs.push(`CORE_EVENT_TYPES 的 "${n}" 不在内部 enum`);
  }

  // 5. CORE_EVENT_TYPES − PUBLIC_TYPES == ENGINE_PRIVATE_EVENTS（新引擎事件不允许"忘了"）
  for (const n of core) {
    if (!input.publicTypes.has(n) && !ENGINE_PRIVATE_EVENTS.has(n)) {
      errs.push(`引擎事件 "${n}" 不在公开类型也不在私有钉 [${[...ENGINE_PRIVATE_EVENTS].join(",")}]——要么进公开四件套，要么有意加钉`);
    }
  }
  for (const n of ENGINE_PRIVATE_EVENTS) {
    if (input.publicTypes.has(n)) errs.push(`"${n}" 本意不公开，却出现在 PUBLIC_TYPES`);
    if (!core.has(n)) errs.push(`私有钉里的 "${n}" 已不在 CORE_EVENT_TYPES——钉已过时`);
  }

  // 6. ZH_EVENT 覆盖全部公开类型（多余键允许，如 turn-end）
  for (const n of input.publicTypes) {
    if (!(n in input.zhEventNames)) errs.push(`ZH_EVENT 缺公开类型 "${n}" 的中文名`);
  }
  return errs;
}

for (const msg of eventSyncErrors(loadEventSyncInput())) fail(msg);

// damage / attachDamage 键清单：类型 ∪ 信封 == DAMAGE_KEYS，schema then 不得超出，
// 非信封的 damage 字段必须出现在 then。清单外的键由装载拒绝，这里只钉三者一致。
// 家族：去掉信封和 op/power/kind/target 之后，DAMAGE_KEYS 与九个家族的并集相等。
const damageMembers = memberKeys.get("damage") ?? new Set<string>();
const damageThen = gateOps.get("damage")?.allowed ?? new Set<string>();
for (const msg of damageManifestDrift({
  memberKeys: damageMembers,
  envelopeKeys: envKeys,
  schemaThen: damageThen,
})) fail(msg);
for (const msg of damageFamilyDrift({
  memberKeys: damageMembers,
  envelopeKeys: envKeys,
})) fail(msg);

if (errors === 0) console.log("schema-sync: PASS（schema/TS/ops/ruleset 四方一致）");
else console.error(`schema-sync: ${errors} 处不一致`);
process.exitCode = errors === 0 ? 0 : 1;
