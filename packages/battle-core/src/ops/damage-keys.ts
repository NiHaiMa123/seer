/**
 * damage 与 attachDamage 的键清单。
 * 清单是契约，不是从类型里现算的：类型上多一个字段不会自动放行。
 * 已经有 rider 的键留在 damage-riders.ts，这里不新增 rider，也不再加键。
 * attachChance 只属于 attachDamage，合并时改写成信封上的 chance。
 * 非信封、非本体的键再归进 DAMAGE_FAMILIES：一个键恰好一个家族。
 * 家族按写进同一次命中的时刻切，不按键名前缀。
 */

export const DAMAGE_KEYS: readonly string[] = [
  "chance",
  "chanceMulIf",
  "chancePerMark",
  "chancePerMissing",
  "chancePerStage",
  "chancePerUse",
  "chancePerUseCap",
  "chanceSelfCurPct",
  "chanceSetIf",
  "if",
  "kind",
  "noHooks",
  "nullifyOnly",
  "onEnterTarget",
  "op",
  "plain",
  "power",
  "target"
];

/** 信封和这四个留在 damage 本体上，不进家族。 */
const DAMAGE_STRUCTURAL: readonly string[] = ["op", "power", "kind", "target"];

export const DAMAGE_FAMILY_NAMES = ["power", "formula", "crit", "scale", "flat", "cap", "drain", "onHit", "strike"] as const;

export type DamageFamilyName = (typeof DAMAGE_FAMILY_NAMES)[number];

/**
 * 按写进同一次命中的时刻归类，不按前缀。
 * scaleIf / powerDropPerHit / useCap / resetStacks 在威力段（resetStacks 只清连用计数，供后续威力叠用）。
 * selfHp / frac / percent / selfTradeFrac 决定这一击的数字，selfTradeFrac 在公式前整段返回。
 * flatIfBelow 在钳制之后抬下限；consumeShield 是耗盾，吸收量并进 flat 也不改家族。
 * flatEcho / flatOnHit / recoilFrac / selfCostEcho / flatIfFoeImmune 不并入本击数字。
 * hitsNoDecay 当前没人读，仍是连击标记。
 */
export const DAMAGE_FAMILIES: { readonly [K in DamageFamilyName]: readonly string[] } = {
  // 威力键在 power rider 的 of 上。家族名留着，九个家族不能少一个。
  power: [],
  // 公式键在 formula rider 的 of 上。家族名留着，九个家族不能少一个。
  formula: [],
  // 致命键在 crit rider 的 of 上。家族名留着，九个家族不能少一个。
  crit: [],
  // 倍率键在 scale rider 的 of 上。家族名留着，九个家族不能少一个。
  scale: [],
  // 固伤键在 flat rider 的 of 上。家族名留着，九个家族不能少一个。
  flat: [],
  // 钳制键在 cap rider 的 of 上。家族名留着，九个家族不能少一个。
  cap: [],
  // 吸血键在 applyDrainRider 上。家族名留着，九个家族不能少一个。
  drain: [],
  // 命中之后的键在各自的 apply* rider 上。家族名留着，九个家族不能少一个。
  onHit: [],
  // 连击键在 strike rider 的 of 上。家族名留着，九个家族不能少一个。
  strike: [],
};

export const ATTACH_DAMAGE_KEYS: readonly string[] = [
  "attachChance",
  "chanceMulIf",
  "kind",
  "power"
];

const DAMAGE_KEY_SET: ReadonlySet<string> = new Set(DAMAGE_KEYS);
const ATTACH_KEY_SET: ReadonlySet<string> = new Set(ATTACH_DAMAGE_KEYS);

const NESTED_EFFECTS = ["payload", "ops", "elseOps"] as const;

export interface DamageKeyHit {
  path: string;
  key: string;
}

/** 这个对象上不属于清单的键。顺序与对象自身一致。 */
export function unknownDamageKeys(fx: object): string[] {
  return Object.keys(fx).filter((k) => !DAMAGE_KEY_SET.has(k));
}

/** attachDamage 袋子上不属于清单的键。 */
export function unknownAttachDamageKeys(bag: object): string[] {
  return Object.keys(bag).filter((k) => !ATTACH_KEY_SET.has(k));
}

/** 效果数组里每条 damage（含 payload / ops / elseOps）的清单外键。 */
export function damageKeyHits(nodes: readonly unknown[] | undefined, path = "effects"): DamageKeyHit[] {
  const out: DamageKeyHit[] = [];
  const walk = (list: readonly unknown[] | undefined, p: string): void => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const fx = list[i];
      if (fx === null || typeof fx !== "object") continue;
      const rec = fx as Record<string, unknown>;
      const here = `${p}[${i}]`;
      if (rec.op === "damage") {
        for (const k of Object.keys(rec)) {
          if (!DAMAGE_KEY_SET.has(k)) out.push({ path: here, key: k });
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

export interface DamageManifestInput {
  memberKeys: ReadonlySet<string>;
  envelopeKeys: ReadonlySet<string>;
  schemaThen: ReadonlySet<string>;
}

/** 类型、schema 的 damage then、两份清单三者不一致时的全部错误。 */
export function damageManifestDrift(input: DamageManifestInput): string[] {
  const errs: string[] = [];
  if (new Set(DAMAGE_KEYS).size !== DAMAGE_KEYS.length) errs.push("DAMAGE_KEYS 有重复");
  if (new Set(ATTACH_DAMAGE_KEYS).size !== ATTACH_DAMAGE_KEYS.length) errs.push("ATTACH_DAMAGE_KEYS 有重复");
  const unionKeys = new Set([...input.memberKeys, ...input.envelopeKeys]);
  for (const k of DAMAGE_KEYS) {
    if (!unionKeys.has(k)) errs.push(`DAMAGE_KEYS 有 "${k}"，CompiledEffect 的 damage 分支和信封没有`);
  }
  for (const k of unionKeys) {
    if (!DAMAGE_KEY_SET.has(k)) errs.push(`CompiledEffect 的 damage 分支或信封有 "${k}"，DAMAGE_KEYS 没有`);
  }
  for (const k of input.schemaThen) {
    if (!DAMAGE_KEY_SET.has(k)) errs.push(`schema damage then 放行 "${k}"，不在 DAMAGE_KEYS`);
  }
  for (const k of input.memberKeys) {
    if (k === "op" || input.envelopeKeys.has(k)) continue;
    if (!input.schemaThen.has(k)) errs.push(`damage 字段 "${k}" 不在 schema damage then`);
  }
  if (!ATTACH_KEY_SET.has("attachChance")) errs.push("ATTACH_DAMAGE_KEYS 必须包含 attachChance");
  if (DAMAGE_KEY_SET.has("attachChance")) errs.push("attachChance 不是 damage 字段");
  for (const k of ATTACH_DAMAGE_KEYS) {
    if (k === "attachChance") continue;
    if (!DAMAGE_KEY_SET.has(k)) errs.push(`attachDamage 键 "${k}" 不是 damage 字段`);
  }
  return errs;
}

export interface DamageFamilyInput {
  memberKeys: ReadonlySet<string>;
  envelopeKeys: ReadonlySet<string>;
  /** 负例替换家族表。缺省用 DAMAGE_FAMILIES。 */
  families?: { readonly [K in DamageFamilyName]: readonly string[] };
}

const familyWhere = (fams: readonly string[] | undefined): string =>
  fams === undefined || fams.length === 0 ? "无" : fams.join("、");

/** DAMAGE_KEYS 去掉信封和本体之后必须等于九个家族的并集。类型上多一个字段却不在恰好一个家族里，同样失败。 */
export function damageFamilyDrift(input: DamageFamilyInput): string[] {
  const families = input.families ?? DAMAGE_FAMILIES;
  const errs: string[] = [];
  const names = Object.keys(families);
  const want = new Set<string>(DAMAGE_FAMILY_NAMES);
  if (names.length !== want.size || names.some((n) => !want.has(n))) {
    errs.push(`家族名必须正好是 ${DAMAGE_FAMILY_NAMES.join("、")}`);
  }
  const owner = new Map<string, string[]>();
  const excluded = new Set<string>([...input.envelopeKeys, ...DAMAGE_STRUCTURAL]);
  for (const [fam, keys] of Object.entries(families)) {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) errs.push(`家族 ${fam} 里 "${k}" 写了两次`);
      else seen.add(k);
      if (input.envelopeKeys.has(k)) errs.push(`家族 ${fam} 的 "${k}" 是信封字段，不属于任何家族`);
      if (DAMAGE_STRUCTURAL.includes(k)) errs.push(`家族 ${fam} 的 "${k}" 是 damage 本体字段`);
      if (!DAMAGE_KEY_SET.has(k)) errs.push(`家族 ${fam} 的 "${k}" 不在 DAMAGE_KEYS`);
      const list = owner.get(k);
      if (list === undefined) owner.set(k, [fam]);
      else if (!list.includes(fam)) list.push(fam);
    }
  }
  for (const k of DAMAGE_KEYS) {
    if (excluded.has(k)) continue;
    const fams = owner.get(k);
    if (fams === undefined || fams.length !== 1) {
      errs.push(`DAMAGE_KEYS 的 "${k}" 不在恰好一个家族（${familyWhere(fams)}）`);
    }
  }
  for (const k of input.memberKeys) {
    if (excluded.has(k) || DAMAGE_KEY_SET.has(k)) continue;
    const fams = owner.get(k);
    if (fams === undefined || fams.length !== 1) {
      errs.push(`damage 字段 "${k}" 不在恰好一个家族（${familyWhere(fams)}）`);
    }
  }
  return errs;
}
