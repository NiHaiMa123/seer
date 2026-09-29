/**
 * mechanics/seals —— 刻印机制模块。
 *
 * 机制知识全部在本目录：刻印目录 schema 校验、佩戴规则（≤3 枚/同 id≤2/同系列≤2/专属）、
 * 满数值平面叠加（初始+隐藏已合并，不吃性格/等级）、预设+运行时 loadout、投影描述符。
 * 流水线只通过 Mechanic 钩子触达本模块；删除本目录 + mechanics/index.ts 注册行即卸载。
 */
import Ajv from "ajv";
import sealsSchemaJson from "../../../../../content/schemas/seals.schema.json" with { type: "json" };
import { sha256hex } from "../../sha256.ts";
import { EngineFault, type SideId } from "../../types.ts";
import type { StatKey, StatSpread } from "../../loader.ts";
import type { Mechanic, MechanicCompileCtx, MechanicContribution, PackMechView } from "../types.ts";

/** 刻印（满数值：初始+隐藏已合并为 stats，平面叠加面板，不吃性格）。 */
export interface CompiledSeal {
  id: string;
  name: string;
  type: "全能刻印" | "能力刻印" | "技能刻印" | "通用刻印";
  series?: string;
  stats: StatSpread;
  /** 专属精灵名（为空=通用）。装备校验按单位 name 匹配。 */
  exclusive?: string;
}

export interface SealRules {
  maxPerUnit: number;
  maxIdentical: number;
  maxPerSeries: number;
}

/** pack.mechanics.seals 的形状。 */
export interface SealPackData {
  /** 刻印库（pack.files.seals 声明时才有）；rules 可单独存在（无目录时 unit/loadout 均拒）。 */
  catalog?: ReadonlyMap<string, CompiledSeal>;
  rules?: SealRules;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const vSeals = ajv.compile(sealsSchemaJson);

/** 类型化读取 pack.mechanics.seals。 */
export const sealsOf = (pack: PackMechView): SealPackData | undefined =>
  pack.mechanics?.["seals"] as SealPackData | undefined;

/**
 * 刻印佩戴规则校验（loader 期预设 & 运行时 loadout 共用）：
 * ≤maxPerUnit 枚、同 id ≤maxIdentical、同系列 ≤maxPerSeries、专属刻印须匹配单位名。
 */
export function checkSealLoadout(
  catalog: ReadonlyMap<string, CompiledSeal>,
  rules: SealRules,
  unitName: string,
  sealIds: readonly string[],
): string | null {
  if (sealIds.length > rules.maxPerUnit) return `seals count ${sealIds.length} exceeds maxPerUnit ${rules.maxPerUnit}`;
  const byId = new Map<string, number>();
  const bySeries = new Map<string, number>();
  for (const id of sealIds) {
    const seal = catalog.get(id);
    if (seal === undefined) return `seal ${id} not in seal catalog`;
    const n = (byId.get(id) ?? 0) + 1;
    if (n > rules.maxIdentical) return `seal ${id} count ${n} exceeds maxIdentical ${rules.maxIdentical}`;
    byId.set(id, n);
    if (seal.series !== undefined) {
      const s = (bySeries.get(seal.series) ?? 0) + 1;
      if (s > rules.maxPerSeries) return `series "${seal.series}" count ${s} exceeds maxPerSeries ${rules.maxPerSeries}`;
      bySeries.set(seal.series, s);
    }
    if (seal.exclusive !== undefined && seal.exclusive !== unitName) {
      return `seal ${id} is exclusive to "${seal.exclusive}", not "${unitName}"`;
    }
  }
  return null;
}

const catalogAndRules = (pack: PackMechView, unitId: string): { catalog: ReadonlyMap<string, CompiledSeal>; rules: SealRules } => {
  const d = sealsOf(pack);
  if (d?.catalog === undefined || d.rules === undefined) {
    throw new EngineFault("SEAL_UNSUPPORTED", `pack ${pack.rules.rulesetId} has no seal catalog (unit ${unitId})`);
  }
  return { catalog: d.catalog, rules: d.rules };
};

export const sealsMechanic: Mechanic = {
  id: "seals",
  doc: { rawKey: "seals", packFile: "seals" },
  unitFieldClaims: ["seals"],

  compile(ctx: MechanicCompileCtx): MechanicContribution | undefined {
    const { raw, ruleset, fail } = ctx;
    const declared = (raw["pack"] as { files?: Record<string, string> }).files?.["seals"] !== undefined;
    const rules = (ruleset["sealRules"] as SealRules | undefined);
    if (!declared) {
      if (raw["seals"] !== undefined) fail("seals document provided but pack declares no files.seals");
      // sealRules 可单独声明：ruleset 开了能力但本 pack 不出刻印库 → unit.seals/loadout 仍被拒。
      const data: SealPackData = rules !== undefined
        ? { rules: { maxPerUnit: rules.maxPerUnit, maxIdentical: rules.maxIdentical, maxPerSeries: rules.maxPerSeries } }
        : {};
      return Object.keys(data).length > 0 ? { data } : undefined;
    }
    if (raw["seals"] === undefined) fail("pack declares files.seals but no seals document was provided");
    if (!vSeals(raw["seals"])) fail(`seals schema: ${ajv.errorsText(vSeals.errors)}`);
    if (rules === undefined) fail("pack declares files.seals but ruleset lacks sealRules");
    const catalog = new Map<string, CompiledSeal>(
      Object.values((raw["seals"] as { seals: Record<string, CompiledSeal> }).seals).map((s) => [s.id, s]),
    );
    for (const [id, s] of catalog) {
      if (s.id !== id) fail(`seal key ${id} != seal.id ${s.id}`);
    }
    const data: SealPackData = {
      catalog,
      rules: { maxPerUnit: rules!.maxPerUnit, maxIdentical: rules!.maxIdentical, maxPerSeries: rules!.maxPerSeries },
    };
    return {
      data,
      hashExtra: { sealsSha256: sha256hex(JSON.stringify(raw["seals"])) },
    };
  },

  checkUnit(unit, pack): string | null {
    if (unit.seals === undefined) return null;
    const d = sealsOf(pack);
    if (d?.catalog === undefined || d.rules === undefined) {
      return `unit ${unit.id} sets seals but pack declares no files.seals`;
    }
    const err = checkSealLoadout(d.catalog, d.rules, unit.name, unit.seals);
    return err === null ? null : `unit ${unit.id} ${err}`;
  },

  unitFields(unit): Record<string, unknown> | undefined {
    return unit.seals !== undefined && unit.seals.length > 0 ? { seals: [...unit.seals] } : undefined;
  },

  checkInitSlots(arr, side: SideId, unitCount): void {
    if (arr.length > unitCount) {
      throw new EngineFault("SEAL_RULE", `seal loadout ${arr.length} slots > unit count ${unitCount} on ${side}`);
    }
    for (const slot of arr) {
      if (slot !== undefined && !Array.isArray(slot)) {
        throw new EngineFault("SEAL_RULE", `seal loadout slot must be an array of seal ids on ${side}`);
      }
    }
  },

  applyUnit(pack, unit, slotInit, base): Record<string, unknown> | undefined {
    const sealIds = (slotInit as string[] | undefined) ?? unit.seals;
    if (sealIds === undefined || sealIds.length === 0) return undefined;
    const { catalog, rules } = catalogAndRules(pack, unit.id);
    const err = checkSealLoadout(catalog, rules, unit.name, sealIds);
    if (err !== null) throw new EngineFault("SEAL_RULE", `unit ${unit.id} ${err}`);
    // 满数值平面叠加在推导面板之上（不吃性格/等级缩放）。
    for (const id of sealIds) {
      const stats = catalog.get(id)!.stats;
      for (const k of Object.keys(stats) as StatKey[]) base[k] += stats[k];
    }
    return { seals: [...sealIds] };
  },

  projections: [
    // 己方/替补可见；对手不投影（隐藏信息）。
    { key: "seals", into: "own", get: (u) => (u.seals !== undefined ? [...u.seals] : undefined) },
  ],

  /** content 端点片段：刻印图鉴库 + 佩戴规则（客户端检索/校验提示用）。 */
  meta(pack): Record<string, unknown> | undefined {
    const d = sealsOf(pack);
    if (d?.catalog === undefined) return undefined;
    return {
      seals: Object.fromEntries([...d.catalog.values()].map((s) => [s.id, s])),
      ...(d.rules !== undefined ? { sealRules: d.rules } : {}),
    };
  },
};
